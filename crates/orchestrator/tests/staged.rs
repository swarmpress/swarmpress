//! The staged Draft and Review jobs (ADR-0058, FEAT-032, FEAT-078;
//! `docs/design/mvp-pipeline.md` §1 and §8): what a failing part costs, what
//! a killed or retried job repeats, what a revision touches, that every
//! prompt fits the resident model's context, the NeedsMedia failure, and the
//! progress events. FakeLlm answers with the brief-driven fake writer.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use agents::article::SectionId;
use agents::fake_writer::{self, REVISION_LINE};
use agents::llm::RecordedCall;
use agents::pipeline::Brief;
use agents::{FakeLlm, FakeReply, LlmRequest};
use async_trait::async_trait;
use knowledge::{pack, MemSource};
use orchestrator::{
    send_back_issues, BriefRecord, FakeGateway, JobFailure, JobKind, JobRequest, LlmProfile,
    MemStore, Orchestrator, Outcome, ProgressEvent, ProgressState, SiteBinding, StageRow, Store,
    StoreError,
};
use serde_json::{json, Value};

mod common;
use common::{binding_json, mini_pack_json, site, team, COMPANY};

const ITEM: &str = "work-item-1";
const BRIEF_REF: u64 = 42;

fn brief(target_words: u32) -> Brief {
    Brief {
        content_id: "content-2a".into(),
        title: "Harvest week in Manarola".into(),
        slug: "harvest-week-in-manarola".into(),
        angle:
            "A day on the terraces with the pickers, and how to watch without getting in the way."
                .into(),
        keywords: vec![
            "Manarola".into(),
            "Sciacchetrà".into(),
            "wine harvest".into(),
            "terraces".into(),
        ],
        target_words,
        language: "en".into(),
        notes: String::new(),
    }
}

async fn put_brief(store: &dyn Store, target_words: u32) {
    let rec = BriefRecord {
        job_id: 1,
        brief: brief(target_words),
        writer: "staff-1".into(),
        editor: "staff-5".into(),
        minutes: vec![],
        work_item: None,
        staff: team(),
    };
    store
        .put_brief(COMPANY, BRIEF_REF, serde_json::to_value(rec).unwrap())
        .await
        .unwrap();
}

fn job(job_id: u64, kind: JobKind, revision: u8) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(BRIEF_REF),
        revision,
        staff: team(),
    }
}

fn task(call: &RecordedCall) -> String {
    call.request
        .messages
        .first()
        .and_then(|m| m.text.lines().next())
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .to_string()
}

fn tasks(llm: &FakeLlm) -> Vec<String> {
    llm.calls().iter().map(task).collect()
}

fn count(llm: &FakeLlm, t: &str) -> usize {
    tasks(llm).iter().filter(|x| *x == t).count()
}

fn digest(out: &[Outcome]) -> &orchestrator::Digest {
    match &out[0] {
        Outcome::JobCompleted { digest, .. } => digest,
        o => panic!("{o:?}"),
    }
}

/// The fake writer, with `bad` answering instead the first time a task
/// comes up.
fn writer_with(bad: Vec<(&'static str, FakeReply)>) -> Arc<FakeLlm> {
    let pending = Mutex::new(bad);
    Arc::new(FakeLlm::with_responder(
        [],
        move |req: &LlmRequest, schema| {
            let t = req
                .messages
                .first()
                .and_then(|m| m.text.lines().next())
                .and_then(|l| l.strip_prefix("## Task: "))
                .unwrap_or("")
                .to_string();
            let mut p = pending.lock().unwrap();
            // Only the first try of the task (not its repair turn).
            if req.messages.len() == 1 {
                if let Some(i) = p.iter().position(|(task, _)| *task == t) {
                    return p.remove(i).1;
                }
            }
            drop(p);
            fake_writer::answer(req, schema)
        },
    ))
}

fn orch(
    llm: Arc<FakeLlm>,
    store: Arc<dyn Store>,
) -> Orchestrator<Arc<dyn Store>, Arc<FakeGateway>> {
    Orchestrator::new(store, Arc::new(FakeGateway::new()), llm, site())
}

fn page(art: &Value) -> Value {
    art["page"].clone()
}

async fn artifact(store: &dyn Store) -> Value {
    store.get_artifact(COMPANY, ITEM).await.unwrap().unwrap()
}

async fn post_types(store: &dyn Store) -> Vec<String> {
    let plan = store.plan_json(COMPANY).await.unwrap();
    plan["posts"][ITEM]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| p["type"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Body blocks of a page grouped by the part they belong to (`[title]`, `[intro]`, `[s1]` …).
fn blocks_by_part(page: &Value) -> BTreeMap<String, Vec<Value>> {
    let body = page["body"].as_array().unwrap();
    let parts = agents::article::block_sections(body);
    let mut out: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for (block, part) in body.iter().zip(parts) {
        let key = part.map_or_else(|| "none".to_string(), |p| p.to_string());
        out.entry(key).or_default().push(block.clone());
    }
    out
}

// ---------------------------------------------------------------- repairs

#[tokio::test]
async fn a_failing_section_costs_exactly_one_extra_call() {
    // 900 words: an outline of four sections.
    let bad = FakeReply::Json(json!({"blocks": [
        {"type": "paragraph", "text": "A stunning view, and a short one.", "items": []}
    ]}));
    let llm = writer_with(vec![("section s3 of 4", bad)]);
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 900).await;
    let o = orch(llm.clone(), store.clone());
    let out = o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    assert!(digest(&out).ok, "{out:?}");
    assert_eq!(
        tasks(&llm),
        [
            "outline",
            "intro",
            "section s1 of 4",
            "section s2 of 4",
            "section s3 of 4",
            "section s3 of 4",
            "section s4 of 4",
            "closing"
        ]
    );
    // The repair turn is section 3's, with its problems and the answer it got, nothing else.
    let calls = llm.calls();
    let repair = &calls[5].request;
    assert_eq!(repair.messages.len(), 3);
    assert!(repair.messages[1].text.contains("A stunning view"));
    assert!(repair.messages[2]
        .text
        .contains("banned phrase \"stunning\""));
    assert!(repair.messages[2].text.contains("words"), "the length too");
    assert_eq!(repair.reasoning_tokens, Some(0));
    for t in ["section s1 of 4", "section s2 of 4", "section s4 of 4"] {
        assert_eq!(count(&llm, t), 1, "{t} is not asked again");
    }
}

#[tokio::test]
async fn a_section_that_will_not_pass_stops_the_job_after_its_repairs() {
    let bad = || {
        FakeReply::Json(json!({"blocks": [
            {"type": "paragraph", "text": "Short.", "items": []}
        ]}))
    };
    // The same answer again: no progress after the first repair.
    let llm = Arc::new(FakeLlm::with_responder([], {
        let bad = bad();
        move |req: &LlmRequest, schema| {
            if task_of(req) == "section s2 of 3" {
                bad.clone()
            } else {
                fake_writer::answer(req, schema)
            }
        }
    }));
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let o = orch(llm.clone(), store.clone());
    let out = o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    assert!(!digest(&out).ok);
    assert_eq!(
        count(&llm, "section s2 of 3"),
        2,
        "no progress stops the loop"
    );
    assert_eq!(count(&llm, "section s3 of 3"), 0);
    assert_eq!(post_types(store.as_ref()).await, ["minutes", "status"]);
}

fn task_of(req: &LlmRequest) -> String {
    req.messages
        .first()
        .and_then(|m| m.text.lines().next())
        .and_then(|l| l.strip_prefix("## Task: "))
        .unwrap_or("")
        .to_string()
}

#[tokio::test]
async fn a_section_cut_off_at_its_limit_is_written_in_two_halves() {
    let llm = writer_with(vec![(
        "section s1 of 3",
        FakeReply::Error(agents::LlmError::Truncated {
            partial: "{\"blocks\": [{\"type\": \"paragraph\", \"text\": \"The".into(),
        }),
    )]);
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let o = orch(llm.clone(), store.clone());
    let out = o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    assert!(
        digest(&out).ok,
        "{out:?} {}",
        store.plan_json(COMPANY).await.unwrap()
    );
    let t = tasks(&llm);
    assert_eq!(
        &t[2..5],
        [
            "section s1 of 3",
            "section s1 of 3 part 1 of 2",
            "section s1 of 3 part 2 of 2"
        ]
    );
    // The second half continues from the first.
    let second = &llm.calls()[4].request.messages[0].text;
    assert!(second.contains("## Where the previous part ended"));
}

// ---------------------------------------------------------------- kill, re-run, retry

/// A store whose `put_stage` fails once for one key: the job dies there, as
/// it would when the tab closes.
struct Dying {
    inner: MemStore,
    kill: Mutex<Option<(String, u32)>>,
}

#[async_trait]
impl Store for Dying {
    async fn put_brief(&self, c: &str, r: u64, v: Value) -> Result<(), StoreError> {
        self.inner.put_brief(c, r, v).await
    }
    async fn get_brief(&self, c: &str, r: u64) -> Result<Option<Value>, StoreError> {
        self.inner.get_brief(c, r).await
    }
    async fn claim_brief(&self, c: &str, r: u64, w: &str) -> Result<bool, StoreError> {
        self.inner.claim_brief(c, r, w).await
    }
    async fn put_artifact(&self, c: &str, w: &str, v: Value) -> Result<(), StoreError> {
        self.inner.put_artifact(c, w, v).await
    }
    async fn get_artifact(&self, c: &str, w: &str) -> Result<Option<Value>, StoreError> {
        self.inner.get_artifact(c, w).await
    }
    async fn append_transcript(
        &self,
        c: &str,
        j: u64,
        s: u32,
        sp: &str,
        t: &str,
    ) -> Result<(), StoreError> {
        self.inner.append_transcript(c, j, s, sp, t).await
    }
    async fn set_item_text(
        &self,
        c: &str,
        i: &str,
        t: Option<&str>,
        b: Option<&str>,
    ) -> Result<(), StoreError> {
        self.inner.set_item_text(c, i, t, b).await
    }
    async fn append_post(&self, c: &str, i: &str, p: Value) -> Result<String, StoreError> {
        self.inner.append_post(c, i, p).await
    }
    async fn plan_json(&self, c: &str) -> Result<Value, StoreError> {
        self.inner.plan_json(c).await
    }
    async fn get_stage(
        &self,
        c: &str,
        j: u64,
        s: &str,
        i: u32,
    ) -> Result<Option<StageRow>, StoreError> {
        self.inner.get_stage(c, j, s, i).await
    }
    async fn put_stage(
        &self,
        c: &str,
        j: u64,
        s: &str,
        i: u32,
        r: StageRow,
    ) -> Result<StageRow, StoreError> {
        let die = {
            let mut kill = self.kill.lock().unwrap();
            let hit = kill.as_ref() == Some(&(s.to_string(), i));
            if hit {
                *kill = None;
            }
            hit
        };
        if die {
            return Err(StoreError("the tab was closed".into()));
        }
        self.inner.put_stage(c, j, s, i, r).await
    }
}

fn dying_after_section_2() -> Arc<Dying> {
    Arc::new(Dying {
        inner: MemStore::new(),
        kill: Mutex::new(Some(("section".into(), 3))),
    })
}

#[tokio::test]
async fn a_job_killed_after_section_2_resumes_with_one_pr_and_one_post_of_each_kind() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let dying = dying_after_section_2();
    let store: Arc<dyn Store> = dying.clone();
    put_brief(store.as_ref(), 600).await;
    let gw = Arc::new(FakeGateway::new());
    let o = Orchestrator::new(store.clone(), gw.clone(), llm.clone(), site());
    let err = o.run(&job(2, JobKind::Draft, 0)).await.unwrap_err();
    assert!(err.to_string().contains("the tab was closed"), "{err}");
    assert_eq!(
        tasks(&llm),
        [
            "outline",
            "intro",
            "section s1 of 3",
            "section s2 of 3",
            "section s3 of 3"
        ]
    );
    assert!(
        gw.branch_head("drafts/content-content-2a").is_none(),
        "no PR yet"
    );

    // The same job again (a reload): only what was not stored calls the model.
    let before = llm.calls().len();
    let out = o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    assert!(digest(&out).ok);
    let again: Vec<String> = tasks(&llm)[before..].to_vec();
    assert_eq!(again, ["section s3 of 3", "closing"]);
    // And once more: nothing at all, the same PR, no new post.
    let out2 = o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    assert_eq!(llm.calls().len(), before + 2);
    assert_eq!(digest(&out2).artifact_sha, digest(&out).artifact_sha);
    assert_eq!(
        post_types(store.as_ref()).await,
        ["minutes", "artifact", "handoff"]
    );
    let pr = artifact(store.as_ref()).await["pr_number"]
        .as_u64()
        .unwrap();
    assert_eq!(pr, 1);
    assert!(gw.pr(2).is_none(), "one pull request");
}

#[tokio::test]
async fn a_retried_phase_adopts_the_stages_of_its_predecessor() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let dying = dying_after_section_2();
    let store: Arc<dyn Store> = dying.clone();
    put_brief(store.as_ref(), 600).await;
    let o = Orchestrator::new(
        store.clone(),
        Arc::new(FakeGateway::new()),
        llm.clone(),
        site(),
    );
    o.run(&job(2, JobKind::Draft, 0)).await.unwrap_err();
    let before = llm.calls().len();
    // The sim blocked the item; the CEO answered Retry: a new job id, same phase.
    let out = o.run(&job(7, JobKind::Draft, 0)).await.unwrap();
    assert!(digest(&out).ok);
    assert_eq!(tasks(&llm)[before..], ["section s3 of 3", "closing"]);
    // Job 7 holds the adopted rows as its own.
    let stages = dying.inner.stages(COMPANY);
    for (stage, index) in [
        ("context", 0),
        ("outline", 0),
        ("section", 0),
        ("section", 2),
    ] {
        assert!(
            stages.contains(&(7, stage.to_string(), index)),
            "{stage}#{index} adopted"
        );
    }
    assert_eq!(
        artifact(store.as_ref()).await["last_job"]["draft"],
        json!(7)
    );
}

// ---------------------------------------------------------------- revisions

async fn first_draft_and_review(o: &Orchestrator<Arc<dyn Store>, Arc<FakeGateway>>) -> Value {
    assert!(digest(&o.run(&job(2, JobKind::Draft, 0)).await.unwrap()).ok);
    let r = o.run(&job(3, JobKind::Review, 0)).await.unwrap();
    assert_eq!(digest(&r).score, 6);
    page(
        &o.store()
            .get_artifact(COMPANY, ITEM)
            .await
            .unwrap()
            .unwrap(),
    )
}

#[tokio::test]
async fn a_revision_naming_s2_changes_only_s2() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let o = orch(llm.clone(), store.clone());
    let before = first_draft_and_review(&o).await;
    let art = artifact(store.as_ref()).await;
    assert_eq!(art["sectioned_review"]["issues"][0]["section"], json!("s2"));

    let n = llm.calls().len();
    assert!(digest(&o.run(&job(4, JobKind::Draft, 1)).await.unwrap()).ok);
    assert_eq!(tasks(&llm)[n..], ["revise s2"]);
    let after = page(&artifact(store.as_ref()).await);
    let (b, a) = (blocks_by_part(&before), blocks_by_part(&after));
    assert_eq!(b.keys().collect::<Vec<_>>(), a.keys().collect::<Vec<_>>());
    for (part, blocks) in &b {
        if part == "s2" {
            assert_ne!(blocks, &a[part]);
            assert!(serde_json::to_string(&a[part])
                .unwrap()
                .contains(REVISION_LINE));
        } else {
            // Byte-identical.
            assert_eq!(
                serde_json::to_string(blocks).unwrap(),
                serde_json::to_string(&a[part]).unwrap(),
                "{part}"
            );
        }
    }
    let mut envelope_before = before.clone();
    let mut envelope_after = after.clone();
    envelope_before["body"] = json!(null);
    envelope_after["body"] = json!(null);
    assert_eq!(envelope_before, envelope_after);
}

#[tokio::test]
async fn the_ceos_send_back_note_becomes_an_issue() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let o = orch(llm.clone(), store.clone());
    first_draft_and_review(&o).await;
    o.run(&job(4, JobKind::Draft, 1)).await.unwrap();
    assert_eq!(
        digest(&o.run(&job(5, JobKind::Review, 1)).await.unwrap()).score,
        8
    );
    let approved = page(&artifact(store.as_ref()).await);

    // The Inbox's Send back: a note for the closing, then the revision job.
    let note = json!({"type": "status", "author": "ceo", "text": "closing: Say when the harvest ends.",
                      "payload": {"ui_type": "send-back-note", "ticket": "ticket-9"}});
    store.append_post(COMPANY, ITEM, note).await.unwrap();
    let n = llm.calls().len();
    assert!(digest(&o.run(&job(6, JobKind::Draft, 2)).await.unwrap()).ok);
    assert_eq!(tasks(&llm)[n..], ["revise closing"]);
    assert!(llm.calls()[n].request.messages[0]
        .text
        .contains("Say when the harvest ends."));
    let after = page(&artifact(store.as_ref()).await);
    let (b, a) = (blocks_by_part(&approved), blocks_by_part(&after));
    for part in ["intro", "s1", "s2", "s3", "title"] {
        assert_eq!(b[part], a[part], "{part} untouched");
    }
    assert_ne!(b["closing"], a["closing"]);

    // A later revision does not take the same note again; an untagged note is the whole.
    o.run(&job(7, JobKind::Review, 2)).await.unwrap();
    let note = json!({"type": "status", "author": "ceo", "text": "Too many generic sentences.",
                      "payload": {"ui_type": "send-back-note"}});
    store.append_post(COMPANY, ITEM, note).await.unwrap();
    let n = llm.calls().len();
    o.run(&job(8, JobKind::Draft, 3)).await.unwrap();
    assert_eq!(
        tasks(&llm)[n..],
        [
            "revise intro",
            "revise s1",
            "revise s2",
            "revise s3",
            "revise closing"
        ]
    );
}

#[test]
fn send_back_notes_are_tagged_by_part_or_whole() {
    let issues =
        send_back_issues("s2: Name the grower.\n[closing] Add the date.\nAnd shorten it all.");
    let tags: Vec<SectionId> = issues.iter().map(|i| i.section).collect();
    assert_eq!(
        tags,
        [SectionId::Section(2), SectionId::Closing, SectionId::Whole]
    );
    assert_eq!(issues[0].fix, "Name the grower.");
    assert!(issues[2].problem.contains("And shorten it all."));
    assert_eq!(
        send_back_issues("Note: nothing here is tagged.")[0].section,
        SectionId::Whole
    );
}

// ---------------------------------------------------------------- the context ceiling

#[tokio::test]
async fn every_rendered_prompt_fits_the_context_for_a_1500_word_article() {
    let llm = Arc::new(fake_writer::fake_writer([]));
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 1500).await;
    // A 1,500-word article estimates close to the default bar of 3,000
    // tokens of reading text (which side depends on the text); a lower bar
    // makes sure the review is read part by part here.
    let site = SiteBinding::from_json(&binding_json(
        &mini_pack_json(),
        json!({"review_single_tokens": 2000}),
    ))
    .unwrap();
    let o = Orchestrator::new(
        store.clone(),
        Arc::new(FakeGateway::new()),
        llm.clone(),
        site,
    );
    for (id, kind, rev) in [
        (2, JobKind::Draft, 0),
        (3, JobKind::Review, 0),
        (4, JobKind::Draft, 1),
        (5, JobKind::Review, 1),
    ] {
        let out = o.run(&job(id, kind, rev)).await.unwrap();
        assert!(
            digest(&out).ok,
            "job {id}: {out:?} {}",
            store.plan_json(COMPANY).await.unwrap()
        );
    }
    let t = tasks(&llm);
    // Five sections; the long article is reviewed part by part, then summed up.
    assert!(t.contains(&"section s5 of 5".to_string()), "{t:?}");
    assert!(t.contains(&"review section s3 of 5".to_string()), "{t:?}");
    assert!(t.contains(&"review summary".to_string()), "{t:?}");
    let profile = LlmProfile::LOCAL;
    let mut largest = 0;
    for call in llm.calls() {
        let ceiling = profile.ceiling(&call.request);
        largest = largest.max(ceiling);
        assert!(
            profile.fits(&call.request),
            "{}: {ceiling} > {}",
            task(&call),
            profile.limit()
        );
        assert!(call.request.reasoning_tokens.is_some());
    }
    assert!(largest > 4000, "the system prompts are real: {largest}");
    let words = artifact(store.as_ref()).await["parts"]["sections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["words"].as_u64().unwrap())
        .sum::<u64>();
    assert!((1100..=1900).contains(&words), "{words}");
}

// ---------------------------------------------------------------- NeedsMedia

#[tokio::test]
async fn an_empty_hero_shortlist_fails_the_job_with_needs_media() {
    let mut src = MemSource::new();
    src.insert_json(
        "content/site.json",
        &json!({"name": "Mini", "locales": ["en"], "defaultLocale": "en"}),
    )
    .insert_json(
        "content/config/media-index.json",
        &json!({"images": [{"id": "manarola-accommodations-001", "url": "https://images.unsplash.com/photo-a-room",
                             "tags": {"village": "manarola", "category": "accommodations"}}]}),
    )
    .insert_json(
        "content/pages/manarola.json",
        &json!({"id": "manarola", "slug": {"en": "/en/manarola"}, "title": {"en": "Manarola"}, "page_type": "village", "body": []}),
    );
    let pack_json = pack::build(&src, "c0ffee").unwrap().to_json().unwrap();
    let site = SiteBinding::from_json(&binding_json(&pack_json, json!({}))).unwrap();
    let llm = Arc::new(fake_writer::fake_writer([]));
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let gw = Arc::new(FakeGateway::new());
    let o = Orchestrator::new(store.clone(), gw.clone(), llm.clone(), site);
    let out = o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    assert_eq!(
        out,
        [Outcome::JobFailed {
            job_id: 2,
            reason: JobFailure::NeedsMedia
        }]
    );
    // The sim's command: `{"JobFailed":{"job_id":2,"reason":"NeedsMedia"}}`.
    assert_eq!(
        serde_json::to_value(&out[0]).unwrap(),
        json!({"JobFailed": {"job_id": 2, "reason": "NeedsMedia"}})
    );
    assert!(llm.calls().is_empty(), "no model call");
    assert!(gw.branch_head("drafts/content-content-2a").is_none());
    assert_eq!(post_types(store.as_ref()).await, ["minutes", "status"]);
    let plan = store.plan_json(COMPANY).await.unwrap();
    assert!(plan["posts"][ITEM][1]["text"]
        .as_str()
        .unwrap()
        .contains("NEEDS_MEDIA"));
}

#[tokio::test]
async fn a_draft_without_site_knowledge_is_an_invalid_job() {
    let mut v = binding_json(&mini_pack_json(), json!({}));
    v["knowledge_pack"] = Value::Null;
    let site = SiteBinding::from_json(&v).unwrap();
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let o = Orchestrator::new(
        store,
        Arc::new(FakeGateway::new()),
        Arc::new(fake_writer::fake_writer([])),
        site,
    );
    let err = o.run(&job(2, JobKind::Draft, 0)).await.unwrap_err();
    assert!(err.to_string().contains("knowledge pack"), "{err}");
}

// ---------------------------------------------------------------- progress (P5)

#[tokio::test]
async fn progress_is_reported_as_counts_and_reuse_is_visible() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::default();
    let sink = events.clone();
    let llm = Arc::new(fake_writer::fake_writer([]));
    let store: Arc<dyn Store> = Arc::new(MemStore::new());
    put_brief(store.as_ref(), 600).await;
    let o = Orchestrator::new(store, Arc::new(FakeGateway::new()), llm, site()).with_progress(
        Arc::new(move |e: &ProgressEvent| sink.lock().unwrap().push(e.clone())),
    );
    o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    let seen: Vec<(String, u32, u32, ProgressState)> = events
        .lock()
        .unwrap()
        .iter()
        .map(|e| (e.stage.clone(), e.index, e.total, e.state))
        .collect();
    use ProgressState::{Done, Reused, Started};
    assert_eq!(
        seen,
        [
            ("job".into(), 0, 1, Started),
            ("context".into(), 0, 1, Started),
            ("context".into(), 0, 1, Done),
            ("outline".into(), 0, 1, Started),
            ("outline".into(), 0, 1, Done),
            ("section".into(), 0, 3, Started),
            ("section".into(), 0, 3, Done),
            ("section".into(), 1, 3, Started),
            ("section".into(), 1, 3, Done),
            ("section".into(), 2, 3, Started),
            ("section".into(), 2, 3, Done),
            ("section".into(), 3, 3, Started),
            ("section".into(), 3, 3, Done),
            ("closing".into(), 0, 1, Started),
            ("closing".into(), 0, 1, Done),
            ("commit".into(), 0, 1, Started),
            ("commit".into(), 0, 1, Done),
            ("job".into(), 0, 1, Done),
        ]
    );
    let e = events.lock().unwrap()[0].clone();
    assert_eq!(
        (
            e.job_id,
            e.kind,
            e.staff.as_deref(),
            e.persona.as_deref(),
            e.role.as_deref()
        ),
        (
            2,
            JobKind::Draft,
            Some("staff-1"),
            Some("giulia"),
            Some("writer")
        )
    );
    let commit = events.lock().unwrap()[16].detail.clone();
    assert_eq!(commit["pr"], json!(1));
    assert!(commit["branch"].as_str().unwrap().starts_with("drafts/"));

    // A re-run reports every stage as reused.
    events.lock().unwrap().clear();
    o.run(&job(2, JobKind::Draft, 0)).await.unwrap();
    let reused = events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e.state == Reused)
        .count();
    assert_eq!(
        reused, 7,
        "context, outline, intro, three sections and the closing"
    );
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.state == Started && e.stage != "job" && e.stage != "commit")
            .count(),
        0
    );
}
