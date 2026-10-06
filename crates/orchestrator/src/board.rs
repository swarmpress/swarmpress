//! The weekly editorial board (ADR-0069; `docs/game-design/publishing-plan.md`
//! section 4).
//!
//! ```text
//! frame#0   no model: the cap, the editors, the context pack and the calendar
//!           topics, fixed by the first run
//!   cap 0  ─► one system transcript line, BoardOutcome{items: []}, no model call
//! plan#0    the strategist's plan: {say, week_theme, proposals[≤cap], big_bets};
//!           one repair turn for an unknown calendar topic, a taken or repeated
//!           title, a forward `after`
//! check#i   each proposal's central promise checked on the web (ADR-0068);
//!           an unverifiable one is set aside, a failed check keeps it
//!   ─► briefs (no writer: the sim staffs an item when it starts), workstream
//!      titles, minutes ─► BoardOutcome{workstreams, items}
//! ```
//!
//! - **Scheduling is the orchestrator's**, not the model's: the model names a
//!   publish day; the item may start two days before it (`start_offset`), and
//!   the reviewing editors take the items in turn. The editor-in-chief's own
//!   scheduling call (`PlanSchedule`) is a later increment.
//! - **Closed world**: a proposal names a calendar topic only by its alias
//!   (`T1` …) from the frame; the dedupe against published, in-flight and
//!   planned titles is the standup's ([`crate::standup`]).
//! - **Text never enters the sim** (rule 2): titles, angles and workstream
//!   names are store text; the outcome carries opaque refs. The board's
//!   briefs are plan text under `brief:<ref>`, its workstreams under
//!   `workstream:<ref>`, so the Plan panel can name an item before it starts.
//! - **Stage store**: every stage is stored under `(company, job, stage,
//!   index)`; a re-run job repeats no completed call.

use agents::llm::{structured_with_repair, Repaired};
use agents::meetings::{
    board_cap, board_prompt, board_schema, pitch_check_prompt, pitch_check_schema, schedule_prompt,
    schedule_schema, BoardPlan, BoardProposal, BoardSchedule, BoardSite, BoardTopic, Pitch,
    ScheduleItem, BOARD_ANSWER, BOARD_CAP_LABEL, CAP_LABEL, DEFAULT_TARGET_WORDS, MAX_PUBLISH_DAY,
    MODEL_MINUTES_PER_DAY, PITCH_REASONING, SCHEDULE_ANSWER,
};
use agents::prompts::{templates, Vars};
use agents::{Brief, CallProfile, LlmMessage, LlmRequest, Role};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::article::{brief_ref_for, slugify};
use crate::gateway::Gateway;
use crate::run::{corrupt, invalid, persona, role_of, Orchestrator, Result};
use crate::staged::stage_hash;
use crate::standup::{
    clean, context_pack, published, season, staff_order, Line, PitchCheck, StandupContext, Taken,
    CALENDAR_PATH, CHECK_ANSWER,
};
use crate::store::{BriefRecord, Store};
use crate::{JobFailure, JobRequest, Outcome, PlannedOut, ProgressState, SiteBinding, StaffRef};

/// Calendar topics the board's frame offers.
const BOARD_TOPICS: usize = 8;
/// Days before its publish day a planned item may start.
const LEAD_DAYS: u32 = 2;
/// Repair turns the plan gets.
pub const PLAN_REPAIRS: u32 = 1;

// ---------------------------------------------------------------- what the host says

/// What the host adds to a board's request (`JobRequest::context`): the
/// standup's context (the date, items in flight and planned, with titles,
/// the measured throughput) plus the room under the sim's limit of planned
/// items:
///
/// ```json
/// { "today": "2026-10-05", "in_flight": [{"id": "work-item-4", "status": "planned", "title": "…"}],
///   "planned_room": 8, "minutes_per_article": 7.5, "model_minutes_per_day": 45 }
/// ```
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BoardContext {
    #[serde(flatten)]
    pub standup: StandupContext,
    /// Planned items the project may still take (the sim's `MAX_PLANNED`
    /// minus its unstarted items).
    #[serde(default)]
    pub planned_room: Option<usize>,
    /// The latest site audit's findings the board may plan care for
    /// (ADR-0070), from `GET /api/site/audit`.
    #[serde(default)]
    pub site: Option<SiteHealth>,
}

/// What the host passes of the site audit (ADR-0070): the stale articles and
/// the pages with broken internal links, each with its path and title.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SiteHealth {
    #[serde(default)]
    pub stale: Vec<StalePage>,
    #[serde(default)]
    pub broken: Vec<BrokenPage>,
    /// Articles whose follow-up scored low (ADR-0071), by brief ref (decimal
    /// text); their page is resolved from the brief.
    #[serde(default)]
    pub underperforming: Vec<Underperforming>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Underperforming {
    pub brief_ref: String,
    #[serde(default)]
    pub title: String,
    pub score: u8,
    /// Resolved by the orchestrator from the brief (not from the host).
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StalePage {
    pub path: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub age_days: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrokenPage {
    pub path: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub broken: u32,
}

/// Site pages the board's frame offers at most (ADR-0070).
const SITE_PAGES: usize = 6;

/// A page of the frame's site-health section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FrameSite {
    alias: String,
    /// `refresh` or `fix`.
    kind: String,
    path: String,
    title: String,
    detail: String,
}

impl BoardContext {
    /// The context of a request (`null`: none); a malformed one is an invalid job.
    pub fn of(req: &JobRequest) -> Result<Self> {
        if req.context.is_null() {
            return Ok(Self::default());
        }
        serde_json::from_value(req.context.clone())
            .map_err(|e| invalid(format!("board context: {e}")))
    }
}

/// A calendar topic of the frame: alias, title, keywords, season.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FrameTopic {
    alias: String,
    title: String,
    keywords: Vec<String>,
    /// The season (or `Evergreen`) it belongs to.
    season: String,
    /// The calendar's priority (`critical`, `high`, `medium`, `low`).
    #[serde(default)]
    priority: String,
}

/// The first run's frame (`frame#0`), reused by every re-run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Frame {
    cap: usize,
    /// Reviewing editors' staff ids, in turn order.
    editors: Vec<String>,
    pack: String,
    topics: Vec<FrameTopic>,
    /// Pages that need care (ADR-0070).
    #[serde(default)]
    site: Vec<FrameSite>,
    #[serde(default)]
    why_not: String,
}

/// The stored planning stage: the plan, or why there is none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Planned {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plan: Option<BoardPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// `model`, `invalid-output` or `infrastructure`, when there is no plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure: Option<String>,
}

/// The stored scheduling stage: the editor-in-chief's schedule, or why there is none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Scheduled {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    schedule: Option<BoardSchedule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// The problems of a schedule, for its repair turn (empty: none).
fn schedule_problems(
    s: &BoardSchedule,
    n: usize,
    editors: &[String],
    after_kept: &[Option<usize>],
) -> Vec<String> {
    let mut problems = Vec::new();
    let mut seen = vec![false; n];
    let mut publish = vec![0u32; n];
    for it in &s.items {
        let k = it.item as usize;
        if k == 0 || k > n {
            problems.push(format!(
                "Item {} does not exist: number them 1 to {n}.",
                it.item
            ));
            continue;
        }
        if std::mem::replace(&mut seen[k - 1], true) {
            problems.push(format!("Item {k} is scheduled twice."));
        }
        if !editors.contains(&it.editor) {
            problems.push(format!(
                "Item {k}: {} is not an editor on the list ({}).",
                it.editor,
                editors.join(", ")
            ));
        }
        if it.start_day > it.publish_day {
            problems.push(format!(
                "Item {k} starts on day {} after its publish day {}.",
                it.start_day, it.publish_day
            ));
        }
        publish[k - 1] = it.publish_day;
    }
    for (k, done) in seen.iter().enumerate() {
        if !done {
            problems.push(format!("Item {} is missing.", k + 1));
        }
    }
    for (k, a) in after_kept.iter().enumerate() {
        if let Some(a) = a {
            if seen[k] && seen[*a] && publish[k] < publish[*a] {
                problems.push(format!(
                    "Item {} builds on item {} and must not publish before it.",
                    k + 1,
                    a + 1
                ));
            }
        }
    }
    problems
}

/// A workstream's store ref: stable per company and name (lower case), so
/// the sim reuses a workstream week after week.
pub fn workstream_ref_for(company: &str, name: &str) -> u64 {
    let mut buf = Vec::with_capacity(company.len() + name.len() + 12);
    buf.extend_from_slice(company.as_bytes());
    buf.extend_from_slice(b"\0workstream\0");
    buf.extend_from_slice(name.trim().to_lowercase().as_bytes());
    xxhash_rust::xxh3::xxh3_64(&buf) & (i64::MAX as u64)
}

/// Day of the year of a `MM-DD` (a year of 365 days; 0 when malformed).
fn day_of_year(md: &str) -> u32 {
    const BEFORE: [u32; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let mut parts = md.split('-').map(|x| x.parse::<u32>().unwrap_or(0));
    let (m, d) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
    if !(1..=12).contains(&m) {
        return 0;
    }
    BEFORE[(m - 1) as usize] + d.saturating_sub(1)
}

/// Days from `today` (`YYYY-MM-DD`) to the next `MM-DD`.
fn days_until(today: &str, md: &str) -> u32 {
    let now = today.get(5..10).map_or(0, day_of_year);
    (day_of_year(md) + 365 - now) % 365
}

/// The rank of a calendar priority (`critical` first).
fn priority_rank(p: &str) -> u8 {
    match p {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 2,
    }
}

/// The calendar topics a board may plan, up to [`BOARD_TOPICS`], nobody
/// having them yet (published, in flight, planned): the current season's,
/// then the next season's once its publish window is within its lead time
/// (`ideal_generation_lead_time_weeks`, else the calendar's
/// `trigger_weeks_before_publish_window`, else 4), then the evergreen ones;
/// each group by the calendar's priority.
fn board_topics(site: &SiteBinding, today: Option<&str>, taken: &Taken) -> Vec<FrameTopic> {
    let Some(k) = site.knowledge.as_ref() else {
        return Vec::new();
    };
    let Ok(Some(calendar)) = k.file_json(CALENDAR_PATH) else {
        return Vec::new();
    };
    let Some(today) = today else {
        return Vec::new();
    };
    let default_lead = calendar
        .pointer("/content_generation_rules/automatic_triggers/seasonal/trigger_weeks_before_publish_window")
        .and_then(Value::as_u64)
        .unwrap_or(4);
    // (group label, topics)
    let mut groups: Vec<(String, &Vec<Value>)> = Vec::new();
    if let Some(seasons) = calendar["seasonal_content"].as_object() {
        let current = season(seasons, today);
        if let Some(s) = current {
            if let Some(t) = s["topics"].as_array() {
                groups.push((
                    s["season_name"]
                        .as_str()
                        .unwrap_or("The season")
                        .to_string(),
                    t,
                ));
            }
        }
        let mut next: Vec<(u32, String, &Vec<Value>)> = seasons
            .values()
            .filter(|s| !current.is_some_and(|c| std::ptr::eq(c, *s)))
            .filter_map(|s| {
                let start = s.pointer("/publish_window/start")?.as_str()?;
                let lead = s["ideal_generation_lead_time_weeks"]
                    .as_u64()
                    .unwrap_or(default_lead);
                let days = days_until(today, start);
                if u64::from(days) > lead * 7 {
                    return None;
                }
                let name = s["season_name"].as_str().unwrap_or("The next season");
                Some((
                    days,
                    format!("{name}, from {start}"),
                    s["topics"].as_array()?,
                ))
            })
            .collect();
        next.sort_by_key(|(d, ..)| *d);
        groups.extend(next.into_iter().map(|(_, n, t)| (n, t)));
    }
    if let Some(t) = calendar
        .pointer("/evergreen_content/topics")
        .and_then(Value::as_array)
    {
        groups.push(("Evergreen".to_string(), t));
    }
    let mut out: Vec<FrameTopic> = Vec::new();
    for (label, topics) in groups {
        let mut fresh: Vec<(u8, String, Vec<String>, String)> = topics
            .iter()
            .filter_map(|t| {
                let title = t["title"].as_str()?.trim().to_string();
                let keywords: Vec<String> = t["keywords"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect();
                let slug = t["slug"]
                    .as_str()
                    .map_or_else(|| slugify(&title), String::from);
                let probe = Pitch {
                    say: String::new(),
                    title: title.clone(),
                    angle: String::new(),
                    keywords: keywords.clone(),
                };
                let fresh = !taken.paths.contains(&slug) && taken.conflict(&probe).is_none();
                let priority = t["priority"].as_str().unwrap_or("medium").to_string();
                fresh.then(|| (priority_rank(&priority), title, keywords, priority))
            })
            .collect();
        // stable: the calendar's own order within a priority
        fresh.sort_by_key(|(rank, ..)| *rank);
        for (_, title, keywords, priority) in fresh {
            if out.len() >= BOARD_TOPICS || out.iter().any(|t| t.title == title) {
                continue;
            }
            out.push(FrameTopic {
                alias: format!("T{}", out.len() + 1),
                title,
                keywords,
                season: label.clone(),
                priority,
            });
        }
    }
    out
}

/// The site-health section of a frame: the oldest stale articles, then the
/// pages with the most broken links, at most [`SITE_PAGES`], each page once.
fn frame_site(site: Option<&SiteHealth>) -> Vec<FrameSite> {
    let Some(site) = site else {
        return Vec::new();
    };
    let mut out: Vec<FrameSite> = Vec::new();
    let mut broken: Vec<&BrokenPage> = site.broken.iter().collect();
    broken.sort_by(|a, b| b.broken.cmp(&a.broken).then(a.path.cmp(&b.path)));
    let stale = site.stale.iter().take(SITE_PAGES / 2 + 1).map(|s| {
        (
            "refresh",
            s.path.clone(),
            s.title.clone(),
            format!("last updated {}, {} days ago", s.date, s.age_days),
        )
    });
    let under = site.underperforming.iter().map(|u| {
        (
            "refresh",
            u.path.clone(),
            u.title.clone(),
            format!("its 14-day follow-up scored {}/10", u.score),
        )
    });
    let fixes = broken.into_iter().map(|b| {
        let s = if b.broken == 1 { "" } else { "s" };
        (
            "fix",
            b.path.clone(),
            b.title.clone(),
            format!("{} broken internal link{s}", b.broken),
        )
    });
    for (kind, path, title, detail) in under.chain(stale).chain(fixes) {
        if out.len() >= SITE_PAGES || out.iter().any(|x| x.path == path) {
            continue;
        }
        let title = if title.trim().is_empty() {
            path.clone()
        } else {
            title
        };
        out.push(FrameSite {
            alias: format!("S{}", out.len() + 1),
            kind: kind.to_string(),
            path,
            title,
            detail,
        });
    }
    out
}

/// The problems of a plan, for its repair turn (empty: none).
fn plan_problems(
    plan: &BoardPlan,
    topics: &[FrameTopic],
    site: &[FrameSite],
    taken: &Taken,
) -> Vec<String> {
    let mut problems = Vec::new();
    let mut seen = taken.clone();
    let mut cared: Vec<&str> = Vec::new();
    for (i, p) in plan.proposals.iter().enumerate() {
        let n = i + 1;
        if p.is_maintenance() {
            let kind = p.kind.trim();
            let page = p.page.trim();
            match site.iter().find(|s| s.alias == page) {
                None => problems.push(format!(
                    "Proposal {n} is a {kind} of {page:?}, which is not in the site-health list: use one of its S aliases."
                )),
                Some(s) if s.kind != kind => problems.push(format!(
                    "Proposal {n}: {page} needs a {}, not a {kind}.",
                    s.kind
                )),
                Some(_) if cared.contains(&page) => {
                    problems.push(format!("Proposal {n}: {page} is planned twice."))
                }
                Some(_) => cared.push(page),
            }
            if !(1..=MAX_PUBLISH_DAY).contains(&p.publish_day) {
                problems.push(format!(
                    "Proposal {n} is published on day {}: use 1 to {MAX_PUBLISH_DAY}.",
                    p.publish_day
                ));
            }
            continue;
        }
        if !p.page.trim().is_empty() {
            problems.push(format!(
                "Proposal {n} is an article: leave `page` empty (it is for a refresh or a fix)."
            ));
        }
        let topic = p.topic.trim();
        if !topic.is_empty() && !topics.iter().any(|t| t.alias == topic) {
            problems.push(format!(
                "Proposal {n} names the calendar topic {topic:?}, which is not in the list: use one of its T aliases or an empty string."
            ));
        }
        if p.after as usize >= n {
            problems.push(format!(
                "Proposal {n} builds on proposal {}: `after` must name an earlier proposal, or be 0.",
                p.after
            ));
        }
        if !(1..=MAX_PUBLISH_DAY).contains(&p.publish_day) {
            problems.push(format!(
                "Proposal {n} is published on day {}: use 1 to {MAX_PUBLISH_DAY}.",
                p.publish_day
            ));
        }
        let pitch = as_pitch(p);
        if let Some(conflict) = seen.conflict(&pitch) {
            problems.push(format!("Proposal {n}: {conflict}"));
        }
        seen.pitched("the board", &pitch);
    }
    problems
}

fn as_pitch(p: &BoardProposal) -> Pitch {
    clean(Pitch {
        say: String::new(),
        title: p.title.clone(),
        angle: p.angle.clone(),
        keywords: p.keywords.clone(),
    })
}

fn priority_of(p: &str) -> &'static str {
    match p.trim() {
        "high" => "High",
        "low" => "Low",
        _ => "Normal",
    }
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// The board job (module docs).
    pub(crate) async fn board(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let speaker = self
            .find(req, "strategist")
            .or_else(|| self.find(req, "editor-in-chief"))
            .or_else(|| self.find(req, "editor"))
            .ok_or_else(|| invalid("board without a strategist or editor"))?;
        let ctx = BoardContext::of(req)?;

        // frame#0: fixed by the first run, whatever the host says later.
        let frame: Frame = match self.recall(req, "frame", 0, None).await? {
            Some(v) => serde_json::from_value(v).map_err(corrupt)?,
            None => {
                let ctx = self.with_store_facts(req, ctx.clone()).await?;
                let mut frame = self.board_frame(req, &ctx);
                // The latest KPI report's recommendations (ADR-0071).
                if frame.cap > 0 {
                    if let Some(recs) = self.latest_kpi_recommendations(req).await? {
                        frame
                            .pack
                            .push_str("\n\n## Last KPI report's recommendations\n");
                        for r in recs {
                            frame.pack.push_str(&format!("- {r}\n"));
                        }
                    }
                }
                let hash = stage_hash(&["board-frame", &req.context.to_string()]);
                self.remember(req, "frame", 0, hash, &frame).await?
            }
        };
        let mut seq = 0u32;
        if frame.cap == 0 {
            let line = Line {
                seq,
                speaker: "system".into(),
                text: format!("Nothing is planned this week. {}", frame.why_not),
            };
            self.spoke(req, &line, None, false).await?;
            return Ok(vec![Outcome::BoardOutcome {
                job_id: req.job_id,
                workstreams: Vec::new(),
                items: Vec::new(),
            }]);
        }

        // plan#0
        let p = persona(&speaker.persona)?;
        let mut vars = Vars::new();
        vars.insert(
            "agenda".into(),
            json!("The Monday editorial board: plan the next two weeks."),
        );
        let system = self.system_prompt(&templates::strategist(), &p, vars)?;
        let profile = CallProfile {
            job: agents::JobKind::WeeklyPlan,
            role: role_of(&speaker.role).unwrap_or(Role::Strategist),
            seniority: Some(p.seniority),
            staff_id: Some(speaker.id.clone()),
        };
        let topics: Vec<BoardTopic<'_>> = frame
            .topics
            .iter()
            .map(|t| BoardTopic {
                alias: &t.alias,
                title: &t.title,
                keywords: &t.keywords,
                season: &t.season,
                priority: &t.priority,
            })
            .collect();
        let site: Vec<BoardSite<'_>> = frame
            .site
            .iter()
            .map(|s| BoardSite {
                alias: &s.alias,
                kind: &s.kind,
                title: &s.title,
                detail: &s.detail,
            })
            .collect();
        let user = board_prompt(&frame.pack, &topics, &site, frame.cap);
        let schema = board_schema(frame.cap, !frame.site.is_empty());
        let request = LlmRequest {
            profile: profile.clone(),
            system: vec![system.clone()],
            messages: vec![LlmMessage::user(user.clone())],
            max_tokens: BOARD_ANSWER,
            reasoning_tokens: Some(PITCH_REASONING),
        };
        let published = published(&self.site);
        let taken = Taken::new(&self.site, &ctx.standup, &published);
        let hash = stage_hash(&["plan", &system, &user, &schema.to_string()]);
        let (planned, fresh): (Planned, bool) =
            match self.recall(req, "plan", 0, Some(&hash)).await? {
                Some(v) => {
                    self.report(
                        req,
                        Some(speaker),
                        "plan",
                        0,
                        1,
                        ProgressState::Reused,
                        json!({}),
                    );
                    (serde_json::from_value(v).map_err(corrupt)?, false)
                }
                None => {
                    self.report(
                        req,
                        Some(speaker),
                        "plan",
                        0,
                        1,
                        ProgressState::Started,
                        json!({}),
                    );
                    let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                        let plan: BoardPlan =
                            serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])?;
                        let problems = plan_problems(&plan, &frame.topics, &frame.site, &taken);
                        if problems.is_empty() {
                            Ok(())
                        } else {
                            Err(problems)
                        }
                    };
                    let r = structured_with_repair(
                        self.llm.as_ref(),
                        &request,
                        &schema,
                        &check,
                        PLAN_REPAIRS,
                    )
                    .await;
                    let planned = match r {
                        Ok(Repaired { value, .. }) => match serde_json::from_value(value) {
                            Ok(plan) => Planned {
                                plan: Some(plan),
                                error: None,
                                failure: None,
                            },
                            Err(e) => Planned {
                                plan: None,
                                error: Some(e.to_string()),
                                failure: Some("invalid-output".into()),
                            },
                        },
                        Err(f) => Planned {
                            plan: None,
                            error: Some(f.error.to_string()),
                            failure: Some(crate::standup::failure_of(&f.error).into()),
                        },
                    };
                    let state = if planned.plan.is_some() {
                        ProgressState::Done
                    } else {
                        ProgressState::Failed
                    };
                    let detail = json!({
                        "proposals": planned.plan.as_ref().map(|p| p.proposals.len()),
                        "error": planned.error,
                    });
                    self.report(req, Some(speaker), "plan", 0, 1, state, detail);
                    (self.remember(req, "plan", 0, hash, &planned).await?, true)
                }
            };
        let Some(plan) = planned.plan else {
            let line = Line {
                seq,
                speaker: "system".into(),
                text: "The board could not agree on a plan; the CEO is told.".into(),
            };
            self.spoke(req, &line, None, false).await?;
            let reason = match planned.failure.as_deref() {
                Some("infrastructure") => JobFailure::Infrastructure,
                Some("model") => JobFailure::Model,
                Some("timeout") => JobFailure::Timeout,
                _ => JobFailure::InvalidOutput,
            };
            return Ok(vec![Outcome::JobFailed {
                job_id: req.job_id,
                reason,
            }]);
        };
        let opening = Line {
            seq,
            speaker: speaker.id.clone(),
            text: plan.say.trim().to_string(),
        };
        self.spoke(req, &opening, Some(speaker), fresh).await?;
        let mut lines = vec![opening];
        seq += 1;

        // check#1…N (ADR-0068)
        let total = u32::try_from(plan.proposals.len()).unwrap_or(u32::MAX);
        // (index in the plan, proposal)
        let mut kept: Vec<(usize, &BoardProposal)> = Vec::new();
        for (i, proposal) in plan.proposals.iter().enumerate() {
            let index = u32::try_from(i + 1).unwrap_or(u32::MAX);
            // Site care promises nothing new to check: its research runs in the job.
            if proposal.is_maintenance() {
                kept.push((i, proposal));
                continue;
            }
            let pitch = as_pitch(proposal);
            let user = pitch_check_prompt(&frame.pack, &pitch);
            let schema = pitch_check_schema();
            let request = LlmRequest {
                profile: profile.clone(),
                system: vec![system.clone()],
                messages: vec![LlmMessage::user(user.clone())],
                max_tokens: CHECK_ANSWER,
                reasoning_tokens: Some(PITCH_REASONING),
            };
            let hash = stage_hash(&["check", &system, &user, &schema.to_string()]);
            let check: PitchCheck = match self.recall(req, "check", index, Some(&hash)).await? {
                Some(v) => {
                    self.report(
                        req,
                        Some(speaker),
                        "check",
                        index,
                        total,
                        ProgressState::Reused,
                        json!({}),
                    );
                    serde_json::from_value(v).map_err(corrupt)?
                }
                None => {
                    self.report(
                        req,
                        Some(speaker),
                        "check",
                        index,
                        total,
                        ProgressState::Started,
                        json!({}),
                    );
                    let c = match self.llm.research(&request, &schema).await {
                        Ok(r) => PitchCheck::from_answer(&r.value, &r.sources),
                        Err(e) => PitchCheck {
                            verifiable: None,
                            note: String::new(),
                            claims: 0,
                            error: Some(e.to_string()),
                        },
                    };
                    let state = if c.error.is_some() {
                        ProgressState::Failed
                    } else {
                        ProgressState::Done
                    };
                    let detail = json!({"title": pitch.title, "verifiable": c.verifiable, "claims": c.claims, "error": c.error});
                    self.report(req, Some(speaker), "check", index, total, state, detail);
                    self.remember(req, "check", index, hash, &c).await?
                }
            };
            if check.verifiable == Some(false) {
                let why = if check.note.is_empty() {
                    "nothing on the web verifies what it promises".to_string()
                } else {
                    check.note.clone()
                };
                let line = Line {
                    seq,
                    speaker: "system".into(),
                    text: format!("\u{ab}{}\u{bb} is set aside: {why}", pitch.title),
                };
                self.spoke(req, &line, None, false).await?;
                lines.push(line);
                seq += 1;
            } else {
                kept.push((i, proposal));
            }
        }

        // The earlier kept item each kept item builds on (its index in `kept`).
        let after_kept: Vec<Option<usize>> = kept
            .iter()
            .enumerate()
            .map(|(n, (_, p))| {
                (p.after > 0)
                    .then(|| kept.iter().position(|(j, _)| *j == p.after as usize - 1))
                    .flatten()
                    .filter(|at| *at < n)
            })
            .collect();
        // schedule#0: the editor-in-chief's editors and days, else the fixed rule.
        let slots = self
            .board_schedule(req, &frame, &kept, &after_kept, &mut seq, &mut lines)
            .await?;

        // Items in plan order; each waits for the earlier item it builds on,
        // if that one was kept.
        let mut workstreams: Vec<(u64, String)> = Vec::new();
        let mut items: Vec<PlannedOut> = Vec::new();
        let mut titles: Vec<String> = Vec::new();
        let minutes: Vec<Value> = lines
            .iter()
            .map(|l| json!({"seq": l.seq, "speaker": l.speaker, "text": l.text}))
            .collect();
        for (n, (i, proposal)) in kept.iter().enumerate() {
            let pitch = as_pitch(proposal);
            let (editor_id, start, publish) = &slots[n];
            let (start, publish) = (*start, *publish);
            let editor = req
                .staff
                .iter()
                .find(|s| &s.id == editor_id)
                .cloned()
                .ok_or_else(|| invalid(format!("board editor {editor_id} is not in the job")))?;
            let ws_name = proposal.workstream.trim().to_string();
            let workstream = if ws_name.is_empty() {
                None
            } else {
                let r = workstream_ref_for(&req.company_id, &ws_name);
                let at = match workstreams.iter().position(|(x, _)| *x == r) {
                    Some(at) => at,
                    None => {
                        workstreams.push((r, ws_name.clone()));
                        workstreams.len() - 1
                    }
                };
                u8::try_from(at).ok()
            };
            let depends_on: Vec<u8> = after_kept[n]
                .and_then(|at| u8::try_from(at).ok())
                .into_iter()
                .collect();
            let brief_ref = brief_ref_for(&req.company_id, req.job_id, *i);
            // Site care: the page's own title and path (ADR-0070).
            let care = proposal
                .is_maintenance()
                .then(|| frame.site.iter().find(|s| s.alias == proposal.page.trim()))
                .flatten();
            let pitch = match care {
                Some(s) => Pitch {
                    title: s.title.clone(),
                    ..pitch
                },
                None => pitch,
            };
            let slug = care.map_or_else(
                || slugify(&pitch.title),
                |s| {
                    s.path
                        .rsplit('/')
                        .next()
                        .and_then(|f| f.strip_suffix(".json"))
                        .unwrap_or("")
                        .to_string()
                },
            );
            let record = BriefRecord {
                job_id: req.job_id,
                brief: Brief {
                    content_id: format!("content-{brief_ref:x}"),
                    title: pitch.title.clone(),
                    slug,
                    angle: pitch.angle.clone(),
                    keywords: pitch.keywords.clone(),
                    target_words: DEFAULT_TARGET_WORDS,
                    language: self.site.language.clone(),
                    notes: String::new(),
                },
                writer: String::new(),
                editor: editor.id.clone(),
                minutes: minutes.clone(),
                work_item: None,
                staff: vec![editor.clone()],
                kind: care.map(|s| s.kind.clone()),
                target: care.map(|s| s.path.clone()),
            };
            self.store
                .put_brief(
                    &req.company_id,
                    brief_ref,
                    serde_json::to_value(&record).map_err(corrupt)?,
                )
                .await?;
            self.store
                .set_item_text(
                    &req.company_id,
                    &format!("brief:{brief_ref}"),
                    Some(&pitch.title),
                    Some(&pitch.angle),
                )
                .await?;
            titles.push(format!("\u{ab}{}\u{bb} on day {publish}", pitch.title));
            items.push(PlannedOut {
                kind: match care.map(|s| s.kind.as_str()) {
                    Some("refresh") => "Refresh",
                    Some("fix") => "Fix",
                    _ => "Article",
                }
                .to_string(),
                brief_ref,
                editor: editor.id.clone(),
                priority: priority_of(&proposal.priority).to_string(),
                workstream,
                start_offset: u8::try_from(start).unwrap_or(0),
                publish_offset: u8::try_from(publish).unwrap_or(13),
                depends_on,
            });
        }
        for (r, name) in &workstreams {
            self.store
                .set_item_text(
                    &req.company_id,
                    &format!("workstream:{r}"),
                    Some(name),
                    None,
                )
                .await?;
        }

        // The strategist closes with the plan; the minutes keep the theme
        // and the big bets (no ticket: the CEO does not approve the plan).
        let closing = if titles.is_empty() {
            "Nothing survived the checks; nothing is planned this week.".to_string()
        } else {
            format!("The plan: {}.", titles.join("; "))
        };
        let line = Line {
            seq,
            speaker: speaker.id.clone(),
            text: closing,
        };
        self.spoke(req, &line, Some(speaker), fresh).await?;
        lines.push(line);
        let mut text = vec![format!("Theme of the week: {}", plan.week_theme.trim())];
        text.extend(
            plan.big_bets
                .iter()
                .map(|b| format!("Big bet: {}", b.trim())),
        );
        text.extend(lines.iter().skip(1).map(|l| l.text.clone()));
        let item = req
            .meeting
            .clone()
            .unwrap_or_else(|| format!("board-{}", req.job_id));
        let key = format!("{}:minutes:0", req.job_id);
        self.post(
            req,
            &item,
            "minutes",
            &speaker.id,
            None,
            &text.join("\n"),
            json!({"job": req.job_id, "week_theme": plan.week_theme, "big_bets": plan.big_bets, "items": items.len()}),
            Some(&key),
        )
        .await?;

        Ok(vec![Outcome::BoardOutcome {
            job_id: req.job_id,
            workstreams: workstreams.into_iter().map(|(r, _)| r).collect(),
            items,
        }])
    }

    /// `schedule#0` (ADR-0069): the editor-in-chief gives each kept item an
    /// editor, a start and a publish day, checked (every item once, an editor
    /// of the frame, start not after publish, after what it builds on) with one
    /// repair turn. Without an editor-in-chief, or when the call fails, the
    /// fixed rule: the strategist's day, [`LEAD_DAYS`] of lead, editors in turn.
    /// Returns `(editor, start, publish)` per kept item.
    async fn board_schedule(
        &self,
        req: &JobRequest,
        frame: &Frame,
        kept: &[(usize, &BoardProposal)],
        after_kept: &[Option<usize>],
        seq: &mut u32,
        lines: &mut Vec<Line>,
    ) -> Result<Vec<(String, u32, u32)>> {
        let fixed: Vec<(String, u32, u32)> = kept
            .iter()
            .enumerate()
            .map(|(n, (_, p))| {
                let publish = p.publish_day.clamp(1, MAX_PUBLISH_DAY);
                (
                    frame.editors[n % frame.editors.len()].clone(),
                    publish.saturating_sub(LEAD_DAYS),
                    publish,
                )
            })
            .collect();
        let Some(chief) = self.find(req, "editor-in-chief") else {
            return Ok(fixed);
        };
        if kept.is_empty() {
            return Ok(fixed);
        }
        let p = persona(&chief.persona)?;
        let system = self.system_prompt(&templates::editorial_board(), &p, Vars::new())?;
        let names: Vec<(String, String)> = frame
            .editors
            .iter()
            .map(|id| {
                let name = req
                    .staff
                    .iter()
                    .find(|s| &s.id == id)
                    .map_or_else(|| id.clone(), Self::name_of);
                (id.clone(), name)
            })
            .collect();
        let editors: Vec<(&str, &str)> = names
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let items: Vec<ScheduleItem<'_>> = kept
            .iter()
            .enumerate()
            .map(|(n, (_, p))| ScheduleItem {
                title: p.title.trim(),
                priority: p.priority.trim(),
                proposed_day: p.publish_day.clamp(1, MAX_PUBLISH_DAY),
                after: after_kept[n].map_or(0, |a| u32::try_from(a + 1).unwrap_or(0)),
            })
            .collect();
        let user = schedule_prompt(&items, &editors);
        let schema = schedule_schema(kept.len());
        let request = LlmRequest {
            profile: CallProfile {
                job: agents::JobKind::PlanSchedule,
                role: role_of(&chief.role).unwrap_or(Role::EditorInChief),
                seniority: Some(p.seniority),
                staff_id: Some(chief.id.clone()),
            },
            system: vec![system.clone()],
            messages: vec![LlmMessage::user(user.clone())],
            max_tokens: SCHEDULE_ANSWER,
            reasoning_tokens: Some(PITCH_REASONING),
        };
        let n = kept.len();
        let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
            let s: BoardSchedule =
                serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])?;
            let problems = schedule_problems(&s, n, &frame.editors, after_kept);
            if problems.is_empty() {
                Ok(())
            } else {
                Err(problems)
            }
        };
        let hash = stage_hash(&["schedule", &system, &user, &schema.to_string()]);
        let (stored, fresh): (Scheduled, bool) =
            match self.recall(req, "schedule", 0, Some(&hash)).await? {
                Some(v) => {
                    self.report(
                        req,
                        Some(chief),
                        "schedule",
                        0,
                        1,
                        ProgressState::Reused,
                        json!({}),
                    );
                    (serde_json::from_value(v).map_err(corrupt)?, false)
                }
                None => {
                    self.report(
                        req,
                        Some(chief),
                        "schedule",
                        0,
                        1,
                        ProgressState::Started,
                        json!({}),
                    );
                    let r = structured_with_repair(
                        self.llm.as_ref(),
                        &request,
                        &schema,
                        &check,
                        PLAN_REPAIRS,
                    )
                    .await;
                    let stored = match r {
                        Ok(Repaired { value, .. }) => {
                            match serde_json::from_value::<BoardSchedule>(value) {
                                Ok(s) => Scheduled {
                                    schedule: Some(s),
                                    error: None,
                                },
                                Err(e) => Scheduled {
                                    schedule: None,
                                    error: Some(e.to_string()),
                                },
                            }
                        }
                        Err(f) => Scheduled {
                            schedule: None,
                            error: Some(f.error.to_string()),
                        },
                    };
                    let state = if stored.schedule.is_some() {
                        ProgressState::Done
                    } else {
                        ProgressState::Failed
                    };
                    let detail =
                        json!({"fallback": stored.schedule.is_none(), "error": stored.error});
                    self.report(req, Some(chief), "schedule", 0, 1, state, detail);
                    (
                        self.remember(req, "schedule", 0, hash, &stored).await?,
                        true,
                    )
                }
            };
        let Some(schedule) = stored.schedule else {
            let line = Line {
                seq: *seq,
                speaker: "system".into(),
                text: "The editor-in-chief's schedule could not be used; the editors take the items in turn."
                    .into(),
            };
            self.spoke(req, &line, None, false).await?;
            lines.push(line);
            *seq += 1;
            return Ok(fixed);
        };
        let line = Line {
            seq: *seq,
            speaker: chief.id.clone(),
            text: schedule.say.trim().to_string(),
        };
        self.spoke(req, &line, Some(chief), fresh).await?;
        lines.push(line);
        *seq += 1;
        let mut out = fixed;
        for it in &schedule.items {
            if let Some(slot) = (it.item as usize)
                .checked_sub(1)
                .and_then(|k| out.get_mut(k))
            {
                *slot = (it.editor.clone(), it.start_day, it.publish_day);
            }
        }
        Ok(out)
    }

    /// The frame of a first run: the cap, the reviewing editors, the pack and
    /// the season's calendar topics.
    /// The context with what the store knows: the pages of underperforming
    /// articles, from their briefs (ADR-0071).
    async fn with_store_facts(
        &self,
        req: &JobRequest,
        mut ctx: BoardContext,
    ) -> Result<BoardContext> {
        if let Some(site) = ctx.site.as_mut() {
            for u in &mut site.underperforming {
                let Ok(r) = u.brief_ref.parse::<u64>() else {
                    continue;
                };
                let Some(v) = self.store.get_brief(&req.company_id, r).await? else {
                    continue;
                };
                let rec: BriefRecord = serde_json::from_value(v).map_err(corrupt)?;
                u.path = rec
                    .target
                    .clone()
                    .unwrap_or_else(|| format!("content/pages/blog/{}.json", rec.brief.slug));
                if u.title.trim().is_empty() {
                    u.title = rec.brief.title.clone();
                }
            }
            site.underperforming.retain(|u| !u.path.is_empty());
        }
        Ok(ctx)
    }

    /// The recommendations of the newest KPI report in the plan text, if any.
    async fn latest_kpi_recommendations(&self, req: &JobRequest) -> Result<Option<Vec<String>>> {
        let text = self.store.plan_json(&req.company_id).await?;
        let mut best: Option<(i64, Vec<String>)> = None;
        for posts in text["posts"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.values())
        {
            for p in posts.as_array().into_iter().flatten() {
                if p["payload"]["kpi_report"] != json!(true) {
                    continue;
                }
                let at = p["day"].as_i64().unwrap_or(0) * 1440 + p["minute"].as_i64().unwrap_or(0);
                let recs: Vec<String> = p["payload"]["recommendations"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect();
                if !recs.is_empty() && best.as_ref().is_none_or(|(b, _)| at >= *b) {
                    best = Some((at, recs));
                }
            }
        }
        Ok(best.map(|(_, r)| r))
    }

    fn board_frame(&self, req: &JobRequest, ctx: &BoardContext) -> Frame {
        let mut editors: Vec<&StaffRef> = req.staff.iter().filter(|s| s.role == "editor").collect();
        if editors.is_empty() {
            editors = req
                .staff
                .iter()
                .filter(|s| s.role == "editor-in-chief")
                .collect();
        }
        editors.sort_by(|a, b| staff_order(&a.id).cmp(&staff_order(&b.id)));
        let cap = if editors.is_empty() {
            0
        } else {
            board_cap(
                ctx.planned_room,
                ctx.standup.minutes_per_article,
                ctx.standup
                    .model_minutes_per_day
                    .unwrap_or(MODEL_MINUTES_PER_DAY),
            )
        };
        let why_not = if !editors.is_empty() && cap == 0 {
            "The plan is full: every planned item still waits to start.".to_string()
        } else if editors.is_empty() {
            "Nobody on the board reviews.".to_string()
        } else {
            String::new()
        };
        let published = published(&self.site);
        let taken = Taken::new(&self.site, &ctx.standup, &published);
        let topics = if cap > 0 {
            board_topics(&self.site, ctx.standup.today.as_deref(), &taken)
        } else {
            Vec::new()
        };
        // The standup's pack without its calendar section (the frame lists
        // the topics with their aliases), the cap line the board's own.
        let pack = if cap > 0 {
            let mut c = ctx.standup.clone();
            c.today = None;
            let p = context_pack(&self.site, &c, cap);
            let head = match ctx.standup.today.as_deref() {
                Some(d) => format!("{BOARD_CAP_LABEL}{cap}\nDate: {d}"),
                None => format!("{BOARD_CAP_LABEL}{cap}"),
            };
            p.text.replacen(&format!("{CAP_LABEL}{cap}"), &head, 1)
        } else {
            String::new()
        };
        Frame {
            cap,
            editors: editors.iter().map(|s| s.id.clone()).collect(),
            pack,
            topics,
            site: if cap > 0 {
                frame_site(ctx.site.as_ref())
            } else {
                Vec::new()
            },
            why_not,
        }
    }
}
