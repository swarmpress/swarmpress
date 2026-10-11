//! A company on WordPress through the orchestrator (ADR-0082, plan M4): the same article loop as
//! `loop.rs` (standup → draft → review 6 → revision → review 8 → publish), but the jobs reach the
//! site through `EngineGateway` over a fake `SiteEngine`, with a knowledge pack read from
//! WordPress's registries. The draft is a post of Gutenberg blocks on the item's branch with an
//! open change request; publish merges it into `live` once.

use std::sync::Arc;

use agents::fake_writer::{self, REVISION_LINE};
use agents::FakeReply;
use knowledge::wordpress::{Registries, SiteInfo, WpMedia, WpPostInfo, WpTerm};
use orchestrator::wordpress::{
    fake::FakeSiteEngine, page_to_post, post_to_page, EngineGateway, WpPostFile, ARTICLE_BLOCKS,
    LIVE,
};
use orchestrator::{
    BriefRecord, Digest, JobKind, JobRequest, MemStore, Orchestrator, Outcome, StaffRef, Store,
};
use serde_json::{json, Value};

mod common;
use common::{team, COMPANY};

const APPROVER: &str = "Ada Lovelace (CEO)";

fn standup() -> Vec<FakeReply> {
    vec![
        FakeReply::Text("Good morning. One new article today.".into()),
        FakeReply::Json(
            json!({"say": "The harvest starts Monday.", "title": "Harvest week in Manarola", "angle": "A day on the terraces", "keywords": ["harvest", "manarola"]}),
        ),
        FakeReply::Json(
            json!({"say": "Vernazza at first light.", "title": "Vernazza harbour at first light", "angle": "Before the first train", "keywords": ["vernazza"]}),
        ),
        FakeReply::Json(
            json!({"commission": [{"pitch": "P1", "target_words": 600}], "decisions": [], "escalations": []}),
        ),
    ]
}

fn registries() -> Registries {
    let url = "http://sandbox.invalid";
    let post = |id: u64, slug: &str, title: &str, cat: u64| WpPostInfo {
        id,
        post_type: "post".into(),
        slug: slug.into(),
        link: format!("{url}/{slug}/"),
        title: title.into(),
        status: "publish".into(),
        excerpt: format!("About {title}."),
        categories: vec![cat],
        ..Default::default()
    };
    let media = |id: u64, name: &str, alt: &str| WpMedia {
        id,
        source_url: format!("{url}/wp-content/uploads/{name}.jpg"),
        alt_text: alt.into(),
        mime_type: "image/jpeg".into(),
        width: Some(1600),
        height: Some(1000),
        ..Default::default()
    };
    let mut block_types: Vec<String> = ARTICLE_BLOCKS.iter().map(|s| s.to_string()).collect();
    block_types.push("core/cover".into());
    Registries {
        site: SiteInfo {
            name: "Cinque Terre Dispatch".into(),
            url: url.into(),
            description: String::new(),
        },
        posts: vec![
            post(5, "manarola-terraces", "The terraces of Manarola", 3),
            post(
                6,
                "trains-between-villages",
                "Trains between the villages",
                4,
            ),
        ],
        pages: vec![],
        terms: vec![
            WpTerm {
                id: 3,
                taxonomy: "category".into(),
                slug: "food-drink".into(),
                name: "Food & Drink".into(),
                link: format!("{url}/category/food-drink/"),
                description: String::new(),
            },
            WpTerm {
                id: 4,
                taxonomy: "category".into(),
                slug: "guides".into(),
                name: "Guides".into(),
                link: format!("{url}/category/guides/"),
                description: String::new(),
            },
        ],
        media: vec![
            media(21, "manarola-grapes", "Grapes on the Manarola terraces"),
            media(22, "manarola-harbour", "Manarola harbour at dusk"),
            media(23, "vernazza", "Vernazza from the trail"),
        ],
        block_types,
    }
}

fn binding() -> orchestrator::SiteBinding {
    let pack = knowledge::wordpress::pack(&registries(), "live-1")
        .unwrap()
        .to_json()
        .unwrap();
    orchestrator::SiteBinding::from_json(&common::binding_json(
        &pack,
        json!({"executor": "browser dev-1 epoch 1"}),
    ))
    .unwrap()
}

fn job(job_id: u64, kind: JobKind, brief_ref: Option<u64>, revision: u8) -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: (kind != JobKind::Standup).then(|| "work-item-1".to_string()),
        brief_ref,
        revision,
        staff: team(),
        meeting: None,
        context: Value::Null,
        approved_by: None,
    }
}

fn completed(out: &[Outcome]) -> &Digest {
    match &out[0] {
        Outcome::JobCompleted { digest, .. } => digest,
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn an_article_is_drafted_on_a_branch_reviewed_and_merged_into_live() {
    let engine = Arc::new(FakeSiteEngine::new());
    let blocks = knowledge::wordpress::block_types(&binding().knowledge.unwrap().pack);
    let gw = EngineGateway::new(engine.clone(), blocks);
    let orch = Orchestrator::new(
        MemStore::new(),
        gw,
        Arc::new(fake_writer::fake_writer(standup())),
        binding(),
    );

    let out = orch.run(&job(1, JobKind::Standup, None, 0)).await.unwrap();
    let brief_ref = match &out[..] {
        [Outcome::MeetingOutcome { briefs, .. }] => briefs[0].brief_ref,
        other => panic!("{other:?}"),
    };
    assert!(
        completed(
            &orch
                .run(&job(2, JobKind::Draft, Some(brief_ref), 0))
                .await
                .unwrap()
        )
        .ok
    );
    let art = orch
        .store()
        .get_artifact(COMPANY, "work-item-1")
        .await
        .unwrap()
        .unwrap();
    let branch = format!("draft-content-{brief_ref:x}");
    assert_eq!(art["branch"], json!(branch));
    assert_eq!(
        engine.head(&branch).as_deref(),
        art["head_sha"].as_str(),
        "the item's branch is at the stored head"
    );
    let draft = engine
        .post(&branch, "harvest-week-in-manarola")
        .expect("the post is on the branch");
    assert!(
        engine.post(LIVE, "harvest-week-in-manarola").is_none(),
        "nothing on live yet"
    );
    assert!(
        draft
            .content
            .starts_with("<!-- wp:paragraph {\"className\":\"sp-dek\"} -->"),
        "{}",
        draft.content
    );
    assert!(
        draft.content.contains("<!-- wp:heading -->")
            && draft
                .content
                .contains("<!-- wp:group {\"className\":\"sp-closing-note\"} -->")
    );
    assert!(
        matches!(draft.featured_media, Some(21..=23)),
        "the hero is an attachment: {:?}",
        draft.featured_media
    );

    // Review 6, revision, review 8: the revision updates the same post on the same branch.
    assert_eq!(
        completed(
            &orch
                .run(&job(3, JobKind::Review, Some(brief_ref), 0))
                .await
                .unwrap()
        )
        .score,
        6
    );
    assert!(
        completed(
            &orch
                .run(&job(4, JobKind::Draft, Some(brief_ref), 1))
                .await
                .unwrap()
        )
        .ok
    );
    assert_eq!(
        completed(
            &orch
                .run(&job(5, JobKind::Review, Some(brief_ref), 1))
                .await
                .unwrap()
        )
        .score,
        8
    );
    assert_eq!(
        engine.change_requests().len(),
        1,
        "one change request for the item"
    );

    // Publish (the CEO approved it): one merge into live.
    let publish = JobRequest {
        approved_by: Some(APPROVER.into()),
        ..job(6, JobKind::Publish, Some(brief_ref), 1)
    };
    let out = orch.run(&publish).await.unwrap();
    let merged = completed(&out).artifact_sha.clone().unwrap();
    assert_eq!(engine.merge_count(), 1);
    let live = engine
        .post(LIVE, "harvest-week-in-manarola")
        .expect("merged into live");
    assert!(
        live.content.contains(REVISION_LINE),
        "the revised draft is what shipped"
    );
    let who = engine.attribution(&merged).unwrap();
    assert_eq!(
        (who.job_kind.as_deref(), who.approved_by.as_deref()),
        (Some("publish"), Some(APPROVER))
    );
    // Publishing again is idempotent.
    assert_eq!(
        completed(&orch.run(&publish).await.unwrap())
            .artifact_sha
            .as_deref(),
        Some(merged.as_str())
    );
    assert_eq!(engine.merge_count(), 1);
}

#[test]
fn a_post_the_pipeline_wrote_reads_back_as_the_same_article() {
    let page = json!({
        "id": "content-1",
        "slug": {"en": "/en/blog/harvest-week"},
        "title": {"en": "Harvest week"},
        "seo": {"description": {"en": "On the terraces."}},
        "body": [
            {"type": "editorial-hero", "title": "Harvest week", "subtitle": "On the terraces.", "image": "x"},
            {"type": "paragraph", "markdown": "The **grapes** come in by [monorail](/trains/) & _cart_."},
            {"type": "heading", "level": 2, "text": "Morning"},
            {"type": "list", "ordered": false, "items": ["One", "Two <b>"]},
            {"type": "callout", "style": "info", "content": "Bring water."},
            {"type": "image", "src": "/u/a.jpg", "alt": "A \"view\"", "caption": "Credit"},
            {"type": "closing-note", "badge": "Plan your visit", "title": "Go", "content": "See you &amp; soon.", "actions": [{"label": "Trains", "href": "/trains/", "variant": "primary"}, {"label": "Food", "href": "/food/", "variant": "secondary"}]}
        ],
        "metadata": {"hero_media_id": "21", "category": "Food & Drink", "inline_media_id": "22"}
    });
    let post = page_to_post(&page, &[]).unwrap();
    assert_eq!(
        (
            post.slug.as_str(),
            post.featured_media,
            post.categories.clone()
        ),
        ("harvest-week", Some(21), vec!["Food & Drink".to_string()])
    );
    assert!(post.content.contains("<p>The <strong>grapes</strong> come in by <a href=\"/trains/\">monorail</a> &amp; <em>cart</em>.</p>"), "{}", post.content);
    let back = post_to_page(&WpPostFile {
        id: 9,
        post: post.clone(),
        version: "v1".into(),
        featured_url: Some("x".into()),
    })
    .unwrap();
    assert_eq!(
        back["body"][1],
        json!({"type": "paragraph", "markdown": "The **grapes** come in by [monorail](/trains/) & *cart*."})
    );
    assert_eq!(back["body"][3], page["body"][3]);
    assert_eq!(back["body"][4], page["body"][4]);
    assert_eq!(
        back["body"][5],
        json!({"type": "image", "src": "/u/a.jpg", "alt": "A \"view\"", "caption": "Credit"})
    );
    assert_eq!(back["body"][6], page["body"][6]);
    assert_eq!(back["body"][0]["subtitle"], json!("On the terraces."));

    // A block outside the site's block set is refused; so is a hero that is not an attachment.
    let set: Vec<String> = vec!["core/paragraph".into()];
    assert!(page_to_post(&page, &set)
        .unwrap_err()
        .iter()
        .any(|e| e.contains("core/heading")));
    let mut bad = page.clone();
    bad["metadata"]["hero_media_id"] = json!("riomaggiore-hero-001");
    assert!(page_to_post(&bad, &[]).unwrap_err()[0].contains("not an attachment"));
}

fn staff(id: &str) -> StaffRef {
    team().into_iter().find(|s| s.id == id).unwrap()
}

/// A fix on WordPress (ADR-0070 on ADR-0082): the post is read from live, its broken link is
/// removed without a model, and the update lands on a branch with a change request, naming the
/// version it read; live is untouched until the update is published.
#[tokio::test]
async fn a_fix_reads_the_post_from_live_and_updates_it_on_a_branch() {
    let engine = Arc::new(FakeSiteEngine::new());
    let article = json!({
        "slug": {"en": "/en/blog/terrace-walk"},
        "title": {"en": "A walk on the terraces"},
        "seo": {"description": {"en": "Up the stairs."}},
        "body": [
            {"type": "editorial-hero", "title": "A walk on the terraces", "subtitle": "Up the stairs."},
            {"type": "paragraph", "markdown": "Take the train or the ferry."},
            {"type": "closing-note", "badge": "Plan", "title": "Go", "content": "Go early.", "actions": [
                {"label": "Trains", "href": "/trains-between-villages/", "variant": "primary"},
                {"label": "Ferry", "href": "/no-such-page/", "variant": "secondary"}
            ]}
        ],
        "metadata": {"hero_media_id": "21", "category": "Guides"}
    });
    engine.put_live(page_to_post(&article, &[]).unwrap());
    let gw = EngineGateway::new(engine.clone(), vec![]);
    let o = Orchestrator::new(
        MemStore::new(),
        gw,
        Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new())),
        binding(),
    );
    let path = "content/pages/blog/terrace-walk.json";
    let rec = json!({
        "job_id": 19,
        "brief": {"content_id": "content-7", "title": "Care", "slug": "care", "angle": "Fix it.", "keywords": ["terraces"], "target_words": 800, "language": "en", "notes": ""},
        "writer": "", "editor": "staff-5", "minutes": [], "work_item": null,
        "staff": [staff("staff-5")], "kind": "fix", "target": path
    });
    let _: BriefRecord = serde_json::from_value(rec.clone()).unwrap();
    o.store().put_brief(COMPANY, 7, rec).await.unwrap();
    let req = JobRequest {
        work_item: Some("work-item-7".into()),
        staff: vec![staff("staff-1")],
        ..job(20, JobKind::Draft, Some(7), 0)
    };
    let out = o.run(&req).await.unwrap();
    assert!(completed(&out).ok, "{out:?}");
    let fixed = engine
        .post("update-post-101", "terrace-walk")
        .expect("the update is on its branch");
    assert!(
        fixed.content.contains("/trains-between-villages/")
            && !fixed.content.contains("/no-such-page/")
            && !fixed.content.contains("href=\"\""),
        "{}",
        fixed.content
    );
    assert!(
        engine
            .post(LIVE, "terrace-walk")
            .unwrap()
            .content
            .contains("/no-such-page/"),
        "live is untouched"
    );
    assert_eq!(engine.change_requests().len(), 1);
}

/// The writer is offered only the block kinds the site's block set can hold (ADR-0082 §1).
#[test]
fn section_kinds_follow_the_block_set() {
    use orchestrator::wordpress::section_kinds;
    let set = |b: &[&str]| b.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(section_kinds(&[]), None, "not WordPress: every kind");
    assert_eq!(
        section_kinds(&set(&[
            "core/paragraph",
            "core/list",
            "core/list-item",
            "core/quote"
        ])),
        Some(vec!["paragraph", "list", "tip"])
    );
    assert_eq!(
        section_kinds(&set(&["core/paragraph", "core/list"])),
        Some(vec!["paragraph"]),
        "a list needs its items too"
    );
    let schema = agents::article::section_schema_for(&["paragraph"]);
    assert_eq!(
        schema["properties"]["blocks"]["items"]["properties"]["type"]["enum"],
        json!(["paragraph"])
    );
}

/// The architects work on WordPress too (ADR-0082 §4): the structural job reads the site's models
/// from the engine (post types and regions) and proposes; nothing reaches the site; the publish of
/// the CEO's approval builds it through the engine.
#[tokio::test]
async fn an_architects_proposal_is_built_through_the_engine() {
    let engine = Arc::new(FakeSiteEngine::new());
    let blueprint = json!({
        "format": "swarmpress.blueprint.v1",
        "page_types": [
            {"id": "post", "label": {"en": "Posts"}, "route": "/{slug}/", "source": {"kind": "page"}, "slots": [{"id": "content", "blocks": ["paragraph", "heading"], "min": 0}]},
            {"id": "page", "label": {"en": "Pages"}, "route": "/{slug}/", "source": {"kind": "page"}, "slots": [{"id": "content", "blocks": ["paragraph"], "min": 0}]}
        ],
        "navigation": [{"page_type": "post"}, {"page_type": "page"}]
    });
    let hash = blueprint::hash(&blueprint::Blueprint::from_value(&blueprint).unwrap());
    engine.set_models(json!({"blueprint": blueprint, "types": {}, "context": {"custom_blocks": [], "sections": [], "collections": []}, "tools": [], "hash": hash}));
    let o = Orchestrator::new(
        MemStore::new(),
        EngineGateway::new(engine.clone(), vec![]),
        Arc::new(fake_writer::fake_writer(Vec::<FakeReply>::new())),
        binding(),
    );
    o.store()
        .put_brief(
            COMPANY,
            9,
            orchestrator::structure_brief(
                "structure",
                "Add an author page type and link articles to it",
            ),
        )
        .await
        .unwrap();
    let architect = JobRequest {
        work_item: Some("work-item-9".into()),
        brief_ref: Some(9),
        staff: vec![StaffRef {
            id: "staff-3".into(),
            persona: "rafael".into(),
            role: "ux-designer".into(),
        }],
        ..job(30, JobKind::Architect, None, 0)
    };
    let out = o.run(&architect).await.unwrap();
    assert!(completed(&out).ok, "{out:?}");
    let p = o
        .store()
        .get_artifact(COMPANY, "work-item-9")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(p["structure"]["base_hash"], json!(hash));
    assert_eq!(
        engine.models().unwrap()["hash"],
        json!(hash),
        "nothing reached the site"
    );

    let publish = JobRequest {
        approved_by: Some(APPROVER.into()),
        ..JobRequest {
            kind: JobKind::Publish,
            job_id: 31,
            ..architect
        }
    };
    let out = o.run(&publish).await.unwrap();
    assert!(completed(&out).ok, "{out:?}");
    let built = engine.models().unwrap();
    assert!(
        built["blueprint"]["page_types"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == "author"),
        "{built}"
    );
}
