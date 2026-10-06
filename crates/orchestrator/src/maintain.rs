//! Refreshing and fixing a published page (ADR-0070 decisions 3 and 5).
//!
//! A work item of kind `Refresh` or `Fix` has a brief that names its page
//! (`BriefRecord::target`). Its Draft job reads the page through the gateway
//! with its blob sha and commits an update that names that sha
//! ([`Gateway::open_update_as`]); its Review job reviews the changes, not a new
//! article.
//!
//! - **Fix** (revision 0): the page's broken internal links are removed
//!   (`knowledge::KnowledgeBase::check_links` against the site's knowledge
//!   pack), keeping their text. No model call.
//! - **Refresh**, and a fix sent back by the editor: `research#n` on what may
//!   have changed (with the editor's notes on a revision), then `refresh#n`:
//!   the writer reads the page's prose passages (`P1`…) against the evidence
//!   and rewrites only those that are out of date. A changed localized field
//!   keeps only its new English text (its translations no longer match).
//! - Nothing to change is not a success (rule 11): the job ends not-ok with a
//!   status post, and the sim raises an escalation the CEO can kill.
//!
//! The review (`update_review#0`) shows the editor each change, with the
//! evidence; its verdict is a normal review digest.

use agents::article_prompts::{
    page_passages, refresh_prompt, refresh_schema, update_review_prompt, Passage, RefreshAnswer,
    ReviewFrame,
};
use agents::pipeline::{review_schema, Brief, EditorReview, ReviewDecision};
use agents::prompts::{templates, Vars};
use agents::research::evidence_lines;
use agents::{CallProfile, Role};
use content_model::registry::LINK_KEYS;
use knowledge::kb::RefKind;
use serde_json::{json, Value};

use crate::gateway::Gateway;
use crate::run::{invalid, persona, Orchestrator, Result};
use crate::staged::{Cx, Halt};
use crate::store::{BriefRecord, Store};
use crate::{Digest, JobFailure, JobRequest, Outcome, ProgressState};

/// The brief kind of a refresh.
pub const REFRESH: &str = "refresh";
/// The brief kind of a fix.
pub const FIX: &str = "fix";
/// The brief kind of a translation (ADR-0073); the brief's `language` is the target.
pub const TRANSLATION: &str = "translation";

/// Whether a brief changes a published page (refresh, fix or translation).
pub fn is_maintenance(rec: &BriefRecord) -> bool {
    matches!(rec.kind.as_deref(), Some(REFRESH | FIX | TRANSLATION))
}

fn is_lang_code(k: &str) -> bool {
    k.len() == 2 && k.chars().all(|c| c.is_ascii_lowercase())
}

/// The page's `LocalizedString` fields (objects of language codes with an
/// `en` string), slugs left out: `(pointer, English)`, in page order
/// (ADR-0073).
pub fn localized_fields(page: &Value) -> Vec<(String, String)> {
    fn walk(v: &Value, ptr: &str, key: &str, out: &mut Vec<(String, String)>) {
        match v {
            Value::Object(m) => {
                let localized = !m.is_empty()
                    && m.keys().all(|k| is_lang_code(k))
                    && m.get("en")
                        .and_then(Value::as_str)
                        .is_some_and(|t| !t.trim().is_empty());
                if localized {
                    if key != "slug" {
                        out.push((ptr.to_string(), m["en"].as_str().unwrap_or("").to_string()));
                    }
                    return;
                }
                for (k, child) in m {
                    walk(
                        child,
                        &format!("{ptr}/{}", k.replace('~', "~0").replace('/', "~1")),
                        k,
                        out,
                    );
                }
            }
            Value::Array(a) => {
                for (i, child) in a.iter().enumerate() {
                    walk(child, &format!("{ptr}/{i}"), key, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(page, "", "", &mut out);
    out
}

/// The parent pointer and the last key of a JSON pointer.
fn split_pointer(ptr: &str) -> Option<(&str, String)> {
    let (parent, last) = ptr.rsplit_once('/')?;
    Some((parent, last.replace("~1", "/").replace("~0", "~")))
}

/// Removes the value at `ptr` from its parent object, or its element from its
/// parent array. `false` when there is nothing there.
fn remove_at(page: &mut Value, ptr: &str) -> bool {
    let Some((parent, key)) = split_pointer(ptr) else {
        return false;
    };
    match page.pointer_mut(parent) {
        Some(Value::Object(m)) => m.remove(&key).is_some(),
        Some(Value::Array(a)) => match key.parse::<usize>() {
            Ok(i) if i < a.len() => {
                a.remove(i);
                true
            }
            _ => false,
        },
        _ => false,
    }
}

/// Removes the page's broken internal links (hrefs and page slugs; a
/// collection reference is left for a person), keeping their text. Returns
/// one line per removed link.
pub fn remove_broken_links(kb: &knowledge::KnowledgeBase, page: &mut Value) -> Vec<String> {
    let report = kb.check_links(page);
    let mut broken: Vec<_> = report
        .broken
        .into_iter()
        .filter(|b| matches!(b.kind, RefKind::Href | RefKind::PageSlug))
        .collect();
    // From the end, so removing an array element moves no pointer still to come.
    broken.sort_by(|a, b| b.pointer.cmp(&a.pointer));
    let mut changes = Vec::new();
    for b in broken {
        let removed = match b.kind {
            RefKind::Href => {
                let done = remove_at(page, &b.pointer);
                // A per-language href left empty goes too.
                if let Some((parent, _)) = split_pointer(&b.pointer) {
                    let empty = page
                        .pointer(parent)
                        .and_then(Value::as_object)
                        .is_some_and(serde_json::Map::is_empty);
                    let is_link =
                        split_pointer(parent).is_some_and(|(_, k)| LINK_KEYS.contains(&k.as_str()));
                    if empty && is_link {
                        remove_at(page, parent);
                    }
                }
                done
            }
            // A slug reference (a related post): the whole entry when it is
            // an element of a list, else the slug.
            _ => {
                let entry = split_pointer(&b.pointer).map(|(p, _)| p.to_string());
                let in_list = entry
                    .as_deref()
                    .and_then(split_pointer)
                    .and_then(|(gp, _)| page.pointer(gp))
                    .is_some_and(Value::is_array);
                match (in_list, entry) {
                    (true, Some(e)) => remove_at(page, &e),
                    _ => remove_at(page, &b.pointer),
                }
            }
        };
        if removed {
            changes.push(format!(
                "removed the link to {} at {}: {}",
                b.value, b.pointer, b.reason
            ));
        }
    }
    changes
}

/// Puts `text` as the English text at a passage's pointer; a localized field
/// keeps only English (its translations no longer match).
fn set_passage(page: &mut Value, p: &Passage, text: &str) -> bool {
    if let Some(parent) = p.pointer.strip_suffix("/en") {
        if let Some(v) = page.pointer_mut(parent) {
            *v = json!({"en": text});
            return true;
        }
        return false;
    }
    match page.pointer_mut(&p.pointer) {
        Some(v) => {
            *v = Value::String(text.to_string());
            true
        }
        None => false,
    }
}

fn page_words(page: &Value) -> u32 {
    let n: usize = page_passages(page)
        .iter()
        .map(|p| p.text.split_whitespace().count())
        .sum();
    u32::try_from(n).unwrap_or(u32::MAX)
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// The Draft job of a refresh or a fix (module docs).
    pub(crate) async fn maintenance_draft(
        &self,
        req: &JobRequest,
        item: &str,
        rec: &BriefRecord,
    ) -> Result<Vec<Outcome>> {
        let kind = rec.kind.clone().unwrap_or_default();
        let path = rec
            .target
            .clone()
            .ok_or_else(|| invalid(format!("job {}: a {kind} without its page", req.job_id)))?;
        let writer = self.staff_by_id(req, rec, &rec.writer, "writer")?;
        let editor = self.staff_by_id(req, rec, &rec.editor, "editor")?;
        let brief_ref = req.brief_ref.unwrap_or_default();
        self.attach_brief(req, item, rec, brief_ref).await?;
        let (mut art, predecessor) = self.begin(req, item, "draft", brief_ref).await?;
        let cx = self.writer_cx(req, item, writer.clone(), predecessor)?;
        self.emit_job(
            &cx,
            ProgressState::Started,
            json!({"kind": kind, "page": path}),
        );

        let Some(file) = self.gateway.read_page(&path).await? else {
            self.system_post(
                req,
                item,
                "status",
                0,
                &format!(
                    "{path} is no longer on the site; there is nothing to {kind} (NEEDS_PAGE)."
                ),
                json!({"failure": "needs-page", "page": path}),
            )
            .await?;
            self.emit_job(&cx, ProgressState::Failed, json!({"halt": "needs-page"}));
            return Ok(vec![Outcome::JobFailed {
                job_id: req.job_id,
                reason: JobFailure::NeedsPage,
            }]);
        };
        let mut page = file.page.clone();
        let content_id = page["id"]
            .as_str()
            .map_or_else(|| rec.brief.content_id.clone(), String::from);

        let mut evidence = if req.revision == 0 {
            Vec::new()
        } else {
            art.evidence.clone()
        };
        let changes = if kind == TRANSLATION {
            match self.translate_page(&cx, rec, &mut page).await? {
                Ok(c) => c,
                Err(halt) => return self.halted(&cx, halt).await,
            }
        } else if kind == FIX && req.revision == 0 {
            let kb = self.site.knowledge.as_ref().ok_or_else(|| {
                invalid(format!(
                    "job {}: a fix needs the site's knowledge pack",
                    req.job_id
                ))
            })?;
            remove_broken_links(&kb.kb, &mut page)
        } else {
            match self
                .refresh_page(&cx, rec, &art, &mut page, &mut evidence)
                .await?
            {
                Ok(c) => c,
                Err(halt) => return self.halted(&cx, halt).await,
            }
        };
        if changes.is_empty() {
            let text = if kind == TRANSLATION {
                "The page has no localized fields left to translate into this language; nothing was changed."
            } else if kind == FIX {
                "The page has no broken internal links left to remove; nothing was changed."
            } else {
                "Nothing on the page was found out of date against the research; nothing was changed."
            };
            self.system_post(
                req,
                item,
                "status",
                0,
                text,
                json!({"kind": kind, "changes": 0}),
            )
            .await?;
            self.emit_job(&cx, ProgressState::Done, json!({"changes": 0}));
            return Ok(vec![Outcome::JobCompleted {
                job_id: req.job_id,
                digest: Digest {
                    ok: false,
                    score: 0,
                    words: page_words(&page),
                    qa_defects: 0,
                    artifact_sha: None,
                },
            }]);
        }
        if let Some(reason) = self.cancelled(req) {
            return self.halted(&cx, Halt::Cancelled(reason)).await;
        }

        self.emit(&cx, "commit", 0, 1, ProgressState::Started, json!({}));
        let title = page["title"]["en"]
            .as_str()
            .or_else(|| page["title"].as_str())
            .unwrap_or(&rec.brief.title)
            .to_string();
        let verb = match kind.as_str() {
            FIX => "Fix links".to_string(),
            TRANSLATION => format!("Translate into {}", rec.brief.language),
            _ => "Refresh".to_string(),
        };
        let message = if req.revision == 0 {
            format!("{verb}: {title}")
        } else {
            format!("{verb} (revision {}): {title}", req.revision)
        };
        let who = self.attribution(req, &writer, "draft");
        let pr = self
            .gateway
            .open_update_as(&content_id, &path, &page, &message, Some(&who), &file.sha)
            .await?;
        let words = page_words(&page);
        art.model = who.model.clone();
        art.brief_ref = brief_ref;
        art.page = Some(page.clone());
        art.parts = None;
        art.revision = req.revision;
        art.path = Some(path.clone());
        art.branch = Some(pr.branch.clone());
        art.pr_number = Some(pr.number);
        art.head_sha = Some(pr.head_sha.clone());
        art.evidence = evidence;
        art.changes = changes.clone();
        self.save_artifact(req, item, &art).await?;
        let detail = json!({"pr": pr.number, "branch": pr.branch, "sha": pr.head_sha, "path": path, "changes": changes.len()});
        self.emit(&cx, "commit", 0, 1, ProgressState::Done, detail.clone());
        self.system_post(
            req,
            item,
            "artifact",
            0,
            &format!("PR #{} on {} ({} changes to {path})", pr.number, pr.branch, changes.len()),
            json!({"pr": pr.number, "branch": pr.branch, "path": path, "sha": pr.head_sha, "revision": req.revision, "changes": changes}),
        )
        .await?;
        let handoff = format!(
            "{verb} of \"{title}\": {} change{} in PR #{} for review.",
            changes.len(),
            if changes.len() == 1 { "" } else { "s" },
            pr.number
        );
        let key = format!("{}:handoff:0", req.job_id);
        self.post(
            req,
            item,
            "handoff",
            &writer.id,
            Some(&editor.id),
            &handoff,
            json!({}),
            Some(&key),
        )
        .await?;
        self.emit_job(&cx, ProgressState::Done, detail);
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words,
                qa_defects: 0,
                artifact_sha: Some(pr.head_sha),
            },
        }])
    }

    /// `translate#i` (ADR-0073): the page's localized fields into the brief's
    /// language, in batches; the changed lines (a sample, then a count), or
    /// why the job halts. Fields the language has text for already are kept,
    /// except on a revision (the editor asked for another translation).
    async fn translate_page(
        &self,
        cx: &Cx<'_>,
        rec: &BriefRecord,
        page: &mut Value,
    ) -> Result<std::result::Result<Vec<String>, Halt>> {
        use agents::article_prompts::{
            translate_prompt, translate_schema, TranslateAnswer, TRANSLATE_BATCH,
            TRANSLATE_BATCH_CHARS,
        };
        let req = cx.req;
        let lang = rec.brief.language.trim().to_string();
        if !is_lang_code(&lang) || lang == "en" {
            return Err(invalid(format!(
                "job {}: a translation into {lang:?}",
                req.job_id
            )));
        }
        let title = page["title"]["en"]
            .as_str()
            .unwrap_or(&rec.brief.title)
            .to_string();
        let todo: Vec<(String, String)> = localized_fields(page)
            .into_iter()
            .filter(|(ptr, _)| {
                req.revision > 0
                    || page
                        .pointer(ptr)
                        .and_then(|o| o.get(&lang))
                        .and_then(Value::as_str)
                        .is_none_or(|t| t.trim().is_empty())
            })
            .collect();
        // Batches by count and by characters.
        let mut batches: Vec<Vec<(String, String)>> = Vec::new();
        for f in todo {
            let full = batches.last().is_none_or(|b| {
                b.len() >= TRANSLATE_BATCH
                    || b.iter().map(|(_, t)| t.len()).sum::<usize>() + f.1.len()
                        > TRANSLATE_BATCH_CHARS
            });
            if full {
                batches.push(Vec::new());
            }
            if let Some(b) = batches.last_mut() {
                b.push(f);
            }
        }
        // The site's voice, from its style guide, when the pack carries one.
        let style = self
            .site
            .knowledge
            .as_ref()
            .and_then(|k| k.file_json(crate::STYLE_GUIDE_PATH).ok().flatten())
            .and_then(|g| {
                g["voice"]
                    .as_str()
                    .map(|v| format!("## House style\nVoice: {v}\n"))
            })
            .unwrap_or_default();
        let total = u32::try_from(batches.len()).unwrap_or(u32::MAX);
        let mut changes: Vec<String> = Vec::new();
        let mut translated = 0usize;
        let mut budget = crate::staged::JOB_REPAIRS;
        for (i, batch) in batches.iter().enumerate() {
            let fields: Vec<(String, String)> = batch
                .iter()
                .enumerate()
                .map(|(n, (_, t))| (format!("F{}", n + 1), t.clone()))
                .collect();
            let prompt =
                translate_prompt(&self.site.llm, &cx.system, &lang, &title, &fields, &style);
            let schema = translate_schema(fields.len());
            let aliases: Vec<String> = fields.iter().map(|(a, _)| a.clone()).collect();
            let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
                let a: TranslateAnswer =
                    serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])?;
                let mut problems = Vec::new();
                for alias in &aliases {
                    match a.translations.iter().filter(|t| &t.field == alias).count() {
                        0 => problems.push(format!("{alias} is missing.")),
                        1 => {}
                        _ => problems.push(format!("{alias} is given twice.")),
                    }
                }
                if a.translations.iter().any(|t| t.text.trim().is_empty()) {
                    problems.push("every translation needs text".into());
                }
                if problems.is_empty() {
                    Ok(())
                } else {
                    Err(problems)
                }
            };
            let index = u32::try_from(i).unwrap_or(u32::MAX) + u32::from(req.revision) * 1000;
            let answer: TranslateAnswer = match self
                .structured_stage(
                    cx,
                    "translate",
                    index,
                    total,
                    &prompt,
                    &schema,
                    &check,
                    &mut budget,
                )
                .await?
            {
                Ok(a) => a,
                Err(h) => return Ok(Err(h)),
            };
            for (n, (ptr, en)) in batch.iter().enumerate() {
                let alias = format!("F{}", n + 1);
                let Some(t) = answer.translations.iter().find(|t| t.field == alias) else {
                    continue;
                };
                if let Some(Value::Object(m)) = page.pointer_mut(ptr) {
                    m.insert(lang.clone(), Value::String(t.text.trim().to_string()));
                    translated += 1;
                    if changes.len() < 12 {
                        changes.push(format!(
                            "{ptr} ({lang}): \u{ab}{en}\u{bb} → \u{ab}{}\u{bb}",
                            t.text.trim()
                        ));
                    }
                }
            }
        }
        if translated > changes.len() {
            changes.push(format!(
                "… and {} more fields translated into {lang}",
                translated - changes.len()
            ));
        }
        Ok(Ok(changes))
    }

    /// `research#n` then `refresh#n` (module docs): the changed lines, or why
    /// the job halts.
    async fn refresh_page(
        &self,
        cx: &Cx<'_>,
        rec: &BriefRecord,
        art: &crate::store::ArtifactRecord,
        page: &mut Value,
        evidence: &mut Vec<agents::research::Evidence>,
    ) -> Result<std::result::Result<Vec<String>, Halt>> {
        let req = cx.req;
        let title = page["title"]["en"]
            .as_str()
            .or_else(|| page["title"].as_str())
            .unwrap_or(&rec.brief.title)
            .to_string();
        let why = rec.brief.angle.clone();
        // The editor's notes on the last update, on a revision.
        let notes: Vec<String> = match (&art.review, req.revision) {
            (Some(r), n) if n > 0 => {
                let mut v = vec![r.notes.clone()];
                v.extend(r.issues.iter().cloned());
                v.retain(|x| !x.trim().is_empty());
                v
            }
            _ => Vec::new(),
        };
        let research_brief = Brief {
            title: title.clone(),
            angle: format!("Bring this published article up to date. {why}"),
            ..rec.brief.clone()
        };
        let passages = page_passages(page);
        let facts: Vec<String> = passages
            .iter()
            .take(12)
            .map(|p| {
                format!(
                    "The article says: {}",
                    p.text.chars().take(240).collect::<String>()
                )
            })
            .collect();
        if let Err(h) = self
            .research_stage(
                cx,
                u32::from(req.revision),
                &research_brief,
                &facts,
                evidence,
                &notes,
            )
            .await?
        {
            return Ok(Err(h));
        }
        let lines = evidence_lines(evidence);
        let ids: Vec<String> = evidence.iter().map(|e| e.id.clone()).collect();
        let prompt = refresh_prompt(
            &self.site.llm,
            &cx.system,
            &title,
            &why,
            &passages,
            &lines,
            &notes,
        );
        let schema = refresh_schema(passages.len());
        let aliases: Vec<String> = passages.iter().map(|p| p.alias.clone()).collect();
        let check = |v: &Value| -> std::result::Result<(), Vec<String>> {
            let a: RefreshAnswer =
                serde_json::from_value(v.clone()).map_err(|e| vec![e.to_string()])?;
            let mut problems = Vec::new();
            let mut seen = Vec::new();
            for u in &a.updates {
                if !aliases.contains(&u.passage) {
                    problems.push(format!("{} is not a passage of the article.", u.passage));
                } else if seen.contains(&u.passage) {
                    problems.push(format!("{} is updated twice: give it once.", u.passage));
                }
                seen.push(u.passage.clone());
                for e in &u.evidence {
                    if !ids.contains(e) {
                        problems.push(format!(
                            "{} cites {e}, which is not in the evidence.",
                            u.passage
                        ));
                    }
                }
                if u.text.contains("**") || u.text.trim_start().starts_with('#') {
                    problems.push(format!("{}: plain text only, no Markdown.", u.passage));
                }
            }
            if problems.is_empty() {
                Ok(())
            } else {
                Err(problems)
            }
        };
        let mut budget = crate::staged::JOB_REPAIRS;
        let answer: RefreshAnswer = match self
            .structured_stage(
                cx,
                "refresh",
                u32::from(req.revision),
                1,
                &prompt,
                &schema,
                &check,
                &mut budget,
            )
            .await?
        {
            Ok(a) => a,
            Err(h) => return Ok(Err(h)),
        };
        let mut changes = Vec::new();
        for u in &answer.updates {
            let Some(p) = passages.iter().find(|p| p.alias == u.passage) else {
                continue;
            };
            if p.text.trim() == u.text.trim() {
                continue;
            }
            if set_passage(page, p, u.text.trim()) {
                let ev = if u.evidence.is_empty() {
                    String::new()
                } else {
                    format!("; evidence {}", u.evidence.join(", "))
                };
                changes.push(format!(
                    "{}: \u{ab}{}\u{bb} → \u{ab}{}\u{bb} ({}{ev})",
                    p.alias,
                    p.text.trim(),
                    u.text.trim(),
                    u.why.trim()
                ));
            }
        }
        Ok(Ok(changes))
    }

    /// The Review job of a refresh or a fix: `update_review#0` over the changes.
    pub(crate) async fn maintenance_review(
        &self,
        req: &JobRequest,
        item: &str,
        rec: &BriefRecord,
    ) -> Result<Vec<Outcome>> {
        let editor = self.staff_by_id(req, rec, &rec.editor, "editor")?;
        let mut art = self
            .load_artifact(req, item)
            .await?
            .ok_or_else(|| invalid(format!("review of {item} before any update")))?;
        let page = art
            .page
            .clone()
            .ok_or_else(|| invalid(format!("review of {item} without a page")))?;
        let (_, predecessor) = self
            .begin(req, item, "review", req.brief_ref.unwrap_or_default())
            .await?;
        art.last_job.insert("review".into(), req.job_id);
        let p = persona(&editor.persona)?;
        let system = self.system_prompt(&templates::editor(), &p, Vars::new())?;
        let cx = Cx {
            req,
            item,
            worker: editor.clone(),
            predecessor,
            system,
            call: CallProfile {
                job: agents::JobKind::EditReview,
                role: Role::Editor,
                seniority: Some(p.seniority),
                staff_id: Some(editor.id.clone()),
            },
        };
        self.emit_job(
            &cx,
            ProgressState::Started,
            json!({"predecessor": predecessor}),
        );
        let kind = match rec.kind.as_deref() {
            Some(FIX) => "fix of broken links".to_string(),
            Some(TRANSLATION) => format!(
                "translation into {}",
                agents::article_prompts::language_name(&rec.brief.language)
            ),
            _ => "refresh".to_string(),
        };
        let evidence = evidence_lines(&art.evidence);
        let frame = ReviewFrame {
            brief: &rec.brief,
            revision: req.revision,
            bar: self.site.quality_bar,
            checks: &[],
            evidence: &evidence,
            previous: &[],
        };
        let prompt = update_review_prompt(&self.site.llm, &cx.system, &frame, &kind, &art.changes);
        let schema = review_schema();
        let ok = |_: &Value| -> std::result::Result<(), Vec<String>> { Ok(()) };
        let mut budget = crate::staged::JOB_REPAIRS;
        let review: EditorReview = match self
            .structured_stage(
                &cx,
                "update_review",
                0,
                1,
                &prompt,
                &schema,
                &ok,
                &mut budget,
            )
            .await?
        {
            Ok(r) => r,
            Err(h) => return self.halted(&cx, h).await,
        };
        art.review = Some(review.clone());
        art.sectioned_review = None;
        self.save_artifact(req, item, &art).await?;
        let verdict = match review.decision {
            ReviewDecision::Approve if review.score >= self.site.quality_bar => "approve",
            ReviewDecision::Reject => "reject",
            _ => "changes",
        };
        let mut text = review.notes.clone();
        for i in &review.issues {
            text.push_str(&format!("\n- {i}"));
        }
        let key = format!("{}:review:0", req.job_id);
        self.post(
            req,
            item,
            "review",
            &editor.id,
            None,
            &text,
            json!({"verdict": verdict, "score": review.score, "issues": review.issues}),
            Some(&key),
        )
        .await?;
        self.emit_job(
            &cx,
            ProgressState::Done,
            json!({"score": review.score, "verdict": verdict}),
        );
        let ok = review.high_risk.is_empty() && review.decision != ReviewDecision::Reject;
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok,
                score: review.score,
                words: page_words(&page),
                qa_defects: u16::try_from(review.issues.len()).unwrap_or(u16::MAX),
                artifact_sha: None,
            },
        }])
    }
}
