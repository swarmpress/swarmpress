//! The data scientist's jobs (ADR-0071 decisions 3 and 4).
//!
//! - **Performance** (a follow-up, 14 game days after an item is published):
//!   the host passes the page's numbers (`GET /api/analytics/page`) as the
//!   request's context. The score (0 to 10) is computed here from the page
//!   views against the project's per-page median, without a model
//!   ([`performance_score`]); the data scientist writes the follow-up post,
//!   whose numbers must be among the ones given (else a plain sentence from
//!   the numbers is posted instead). Without numbers the follow-up is
//!   skipped loudly: a status post and `JobFailed{Infrastructure}`.
//! - **KpiReport** (the Monday KPI review): the host passes this week's and
//!   last week's aggregates; the report (headline, highlights, three
//!   recommendations) is posted as the meeting's minutes and its headline is
//!   spoken. Without data the report says so and the job ends not-ok.

use agents::analysis::{
    follow_up_prompt, follow_up_schema, kpi_report_prompt, kpi_report_schema, FollowUp, KpiReport,
    FOLLOW_UP_ANSWER, KPI_REPORT_ANSWER,
};
use agents::jobs::check_number_provenance;
use agents::llm::structured_with_repair;
use agents::prompts::{templates, Vars};
use agents::{CallProfile, LlmMessage, LlmRequest, Role};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::gateway::Gateway;
use crate::run::{corrupt, invalid, persona, role_of, Orchestrator, Result};
use crate::staged::stage_hash;
use crate::standup::Line;
use crate::store::Store;
use crate::{Digest, JobFailure, JobRequest, Outcome, ProgressState, StaffRef};

/// One page's numbers since it was published (`GET /api/analytics/page`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageNumbers {
    pub path: String,
    #[serde(default)]
    pub pageviews: i64,
    #[serde(default)]
    pub sessions: i64,
    #[serde(default)]
    pub avg_engaged_ms: i64,
    #[serde(default)]
    pub scroll_75: i64,
    #[serde(default)]
    pub days: i64,
    #[serde(default)]
    pub median_pageviews: i64,
    #[serde(default)]
    pub pages: i64,
}

/// What the host passes a follow-up.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PerformanceContext {
    #[serde(default)]
    pub page: Option<PageNumbers>,
}

/// A follow-up's score from the numbers (no model): page views against the
/// median page's, 2 for none at all, 9 for twice the median or more; 5 when
/// the site has no measured pages to compare with.
pub fn performance_score(n: &PageNumbers) -> u8 {
    if n.pages == 0 || n.median_pageviews <= 0 {
        return 5;
    }
    let (v, m) = (n.pageviews.max(0), n.median_pageviews);
    // Thresholds in quarters of the median, integers only.
    match v * 4 / m {
        0 if v == 0 => 2,
        0 => 3,
        1 => 4,
        2 => 5,
        3 => 6,
        4..=5 => 7,
        6..=7 => 8,
        _ => 9,
    }
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    fn analyst<'a>(&self, req: &'a JobRequest) -> Result<&'a StaffRef> {
        self.find(req, "data-scientist")
            .or_else(|| req.staff.first())
            .ok_or_else(|| invalid(format!("job {} has no data scientist", req.job_id)))
    }

    fn analyst_request(
        &self,
        who: &StaffRef,
        job: agents::JobKind,
        user: String,
        max_tokens: u32,
    ) -> Result<(String, LlmRequest)> {
        let p = persona(&who.persona)?;
        let system = self.system_prompt(&templates::data_scientist(), &p, Vars::new())?;
        let request = LlmRequest {
            profile: CallProfile {
                job,
                role: role_of(&who.role).unwrap_or(Role::DataScientist),
                seniority: Some(p.seniority),
                staff_id: Some(who.id.clone()),
            },
            system: vec![system.clone()],
            messages: vec![LlmMessage::user(user)],
            max_tokens,
            reasoning_tokens: Some(256),
        };
        Ok((system, request))
    }

    /// The Performance job (module docs).
    pub(crate) async fn performance(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?;
        let who = self.analyst(req)?.clone();
        let rec = self.load_brief(req).await?;
        let title = rec.brief.title.clone();
        let ctx: PerformanceContext = if req.context.is_null() {
            PerformanceContext::default()
        } else {
            serde_json::from_value(req.context.clone())
                .map_err(|e| invalid(format!("performance context: {e}")))?
        };
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let Some(n) = ctx.page.filter(|n| n.pages > 0 || n.pageviews > 0) else {
            self.system_post(
                req,
                item,
                "status",
                0,
                &format!(
                    "No tracker data for \u{ab}{title}\u{bb} yet; the 14-day follow-up is skipped."
                ),
                json!({"follow_up": "not-measured"}),
            )
            .await?;
            self.report_job(
                req,
                Some(&who),
                ProgressState::Failed,
                json!({"error": "not measured"}),
            );
            return Ok(vec![Outcome::JobFailed {
                job_id: req.job_id,
                reason: JobFailure::Infrastructure,
            }]);
        };
        let score = performance_score(&n);
        let numbers = json!({
            // the follow-up's own day count, so "+14 days" is a given number
            "follow_up_days": 14,
            "pageviews": n.pageviews,
            "sessions": n.sessions,
            "avg_engaged_seconds": n.avg_engaged_ms / 1000,
            "scrolled_75_percent": n.scroll_75,
            "days_with_views": n.days,
            "median_page_pageviews": n.median_pageviews,
            "pages_measured": n.pages,
        });
        let user = follow_up_prompt(&title, &n.path, &numbers);
        let (system, request) = self.analyst_request(
            &who,
            agents::JobKind::ContentPerformance,
            user.clone(),
            FOLLOW_UP_ANSWER,
        )?;
        let schema = follow_up_schema();
        let hash = stage_hash(&["follow_up", &system, &user]);
        let answer: Value = match self.recall(req, "follow_up", 0, Some(&hash)).await? {
            Some(v) => v,
            None => {
                let check = |v: &Value| check_number_provenance(v, &numbers, &[]);
                let v = match structured_with_repair(
                    self.llm.as_ref(),
                    &request,
                    &schema,
                    &check,
                    1,
                )
                .await
                {
                    Ok(r) => r.value,
                    // The model could not keep to the numbers: the numbers themselves.
                    Err(f) => json!({
                        "summary": format!("+14 days: {} views ({} for the median page), {} s engaged on average.",
                                           n.pageviews, n.median_pageviews, n.avg_engaged_ms / 1000),
                        "verdict": "",
                        "suggestion": "",
                        "fallback": f.error.to_string(),
                    }),
                };
                self.remember(req, "follow_up", 0, hash, &v).await?
            }
        };
        let f: FollowUp = serde_json::from_value(answer.clone()).map_err(corrupt)?;
        let mut text = f.summary.clone();
        if !f.suggestion.trim().is_empty() {
            text.push_str(&format!("\nSuggestion: {}", f.suggestion.trim()));
        }
        let key = format!("{}:performance:0", req.job_id);
        self.post(
            req,
            item,
            "performance",
            &who.id,
            None,
            &text,
            json!({"score": score, "verdict": f.verdict, "numbers": numbers, "path": n.path}),
            Some(&key),
        )
        .await?;
        self.report_job(
            req,
            Some(&who),
            ProgressState::Done,
            json!({"score": score}),
        );
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score,
                words: 0,
                qa_defects: 0,
                artifact_sha: None,
            },
        }])
    }

    /// The Promotion job (ADR-0073): copy for the newsletter and the site's
    /// channels when a page goes live, as a `distribution` post in the item's
    /// thread. Nothing is sent or posted.
    pub(crate) async fn promotion(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        use agents::analysis::{promotion_prompt, promotion_schema, Promotion, PROMOTION_ANSWER};
        let item = self.work_item(req)?;
        let who = req.staff.first().cloned().ok_or_else(|| {
            invalid(format!(
                "job {} has nobody to write promotion copy",
                req.job_id
            ))
        })?;
        let rec = self.load_brief(req).await?;
        let slug = rec
            .target
            .as_deref()
            .and_then(|t| t.rsplit('/').next())
            .and_then(|f| f.strip_suffix(".json"))
            .unwrap_or(&rec.brief.slug)
            .to_string();
        let base = self
            .site
            .knowledge
            .as_ref()
            .and_then(|k| k.kb.manifest.base_url.clone())
            .unwrap_or_else(|| format!("https://{}", self.site.site_id));
        let url = format!("{}/en/blog/{slug}", base.trim_end_matches('/'));
        self.report_job(req, Some(&who), ProgressState::Started, json!({"url": url}));
        let user = promotion_prompt(
            &rec.brief.title,
            &rec.brief.angle,
            &url,
            &self.site.brand_name,
        );
        let p = persona(&who.persona)?;
        let system = self.system_prompt(&templates::seo_marketing(), &p, Vars::new())?;
        let request = LlmRequest {
            profile: CallProfile {
                job: agents::JobKind::Brief,
                role: role_of(&who.role).unwrap_or(Role::MarketingManager),
                seniority: Some(p.seniority),
                staff_id: Some(who.id.clone()),
            },
            system: vec![system.clone()],
            messages: vec![LlmMessage::user(user.clone())],
            max_tokens: PROMOTION_ANSWER,
            reasoning_tokens: Some(0),
        };
        let schema = promotion_schema();
        let hash = stage_hash(&["promotion", &system, &user]);
        let copy: Option<Promotion> = match self.recall(req, "promotion", 0, Some(&hash)).await? {
            Some(v) => serde_json::from_value(v).map_err(corrupt)?,
            None => {
                let ok = |_: &Value| -> std::result::Result<(), Vec<String>> { Ok(()) };
                let r = structured_with_repair(self.llm.as_ref(), &request, &schema, &ok, 1)
                    .await
                    .ok()
                    .and_then(|r| serde_json::from_value::<Promotion>(r.value).ok());
                self.remember(req, "promotion", 0, hash, &r).await?
            }
        };
        let Some(copy) = copy else {
            self.system_post(
                req,
                item,
                "status",
                0,
                "The promotion copy could not be written.",
                json!({"promotion": "failed"}),
            )
            .await?;
            self.report_job(req, Some(&who), ProgressState::Failed, json!({}));
            return Ok(vec![Outcome::JobFailed {
                job_id: req.job_id,
                reason: JobFailure::Model,
            }]);
        };
        let text = format!(
            "Newsletter: {}\n\nInstagram: {}\n\nX: {}\n\nFacebook: {}",
            copy.newsletter.trim(),
            copy.instagram.trim(),
            copy.x.trim(),
            copy.facebook.trim()
        );
        let key = format!("{}:distribution:0", req.job_id);
        self.post(
            req,
            item,
            "distribution",
            &who.id,
            None,
            &text,
            json!({"url": url, "newsletter": copy.newsletter, "instagram": copy.instagram, "x": copy.x, "facebook": copy.facebook, "sent": false}),
            Some(&key),
        )
        .await?;
        self.report_job(req, Some(&who), ProgressState::Done, json!({"url": url}));
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words: 0,
                qa_defects: 0,
                artifact_sha: None,
            },
        }])
    }

    /// The KpiReport job (module docs).
    pub(crate) async fn kpi_report(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let who = self.analyst(req)?.clone();
        let item = req
            .meeting
            .clone()
            .unwrap_or_else(|| format!("kpi-report-{}", req.job_id));
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let numbers = req.context.clone();
        let measured = numbers
            .pointer("/week/totals/pageviews")
            .and_then(Value::as_i64)
            .is_some_and(|v| v > 0);
        if !measured {
            let line = Line {
                seq: 0,
                speaker: who.id.clone(),
                text: "The tracker has no traffic for this week yet, so there is no report today."
                    .into(),
            };
            self.spoke(req, &line, Some(&who), true).await?;
            self.system_post(
                req,
                &item,
                "status",
                0,
                &line.text,
                json!({"kpi_report": "not-measured"}),
            )
            .await?;
            self.report_job(
                req,
                Some(&who),
                ProgressState::Done,
                json!({"measured": false}),
            );
            return Ok(vec![Outcome::JobCompleted {
                job_id: req.job_id,
                digest: Digest {
                    ok: false,
                    score: 0,
                    words: 0,
                    qa_defects: 0,
                    artifact_sha: None,
                },
            }]);
        }
        let user = kpi_report_prompt(&numbers);
        let (system, request) = self.analyst_request(
            &who,
            agents::JobKind::KpiReport,
            user.clone(),
            KPI_REPORT_ANSWER,
        )?;
        let schema = kpi_report_schema();
        let hash = stage_hash(&["kpi_report", &system, &user]);
        let (report, fresh): (Option<KpiReport>, bool) =
            match self.recall(req, "kpi_report", 0, Some(&hash)).await? {
                Some(v) => (serde_json::from_value(v).map_err(corrupt)?, false),
                None => {
                    let check = |v: &Value| check_number_provenance(v, &numbers, &[]);
                    let r = structured_with_repair(self.llm.as_ref(), &request, &schema, &check, 1)
                        .await
                        .ok()
                        .and_then(|r| serde_json::from_value::<KpiReport>(r.value).ok());
                    (self.remember(req, "kpi_report", 0, hash, &r).await?, true)
                }
            };
        let Some(report) = report else {
            self.system_post(
                req,
                &item,
                "status",
                0,
                "The KPI report could not be written within the numbers it was given.",
                json!({"kpi_report": "failed"}),
            )
            .await?;
            self.report_job(req, Some(&who), ProgressState::Failed, json!({}));
            return Ok(vec![Outcome::JobFailed {
                job_id: req.job_id,
                reason: JobFailure::InvalidOutput,
            }]);
        };
        let line = Line {
            seq: 0,
            speaker: who.id.clone(),
            text: report.headline.trim().to_string(),
        };
        self.spoke(req, &line, Some(&who), fresh).await?;
        let mut text = format!("KPI report: {}", report.headline.trim());
        for h in &report.highlights {
            text.push_str(&format!("\n- {}", h.trim()));
        }
        for (i, r) in report.recommendations.iter().enumerate() {
            text.push_str(&format!("\nRecommendation {}: {}", i + 1, r.trim()));
        }
        let key = format!("{}:minutes:0", req.job_id);
        self.post(
            req,
            &item,
            "minutes",
            &who.id,
            None,
            &text,
            json!({"kpi_report": true, "headline": report.headline, "highlights": report.highlights, "recommendations": report.recommendations}),
            Some(&key),
        )
        .await?;
        self.report_job(
            req,
            Some(&who),
            ProgressState::Done,
            json!({"recommendations": report.recommendations.len()}),
        );
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words: 0,
                qa_defects: 0,
                artifact_sha: None,
            },
        }])
    }
}
