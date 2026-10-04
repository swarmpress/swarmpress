//! The site binding built from a knowledge pack (ADR-0061, increment K2,
//! FEAT-043): the style guide and the writer prompt are the site's own files,
//! and the binding carries the loaded closed world for the staged Draft job.
//! The pack is built from the `cinqueterre-mini` fixture of the knowledge
//! crate, as the central server builds it from a repository snapshot.

use std::collections::BTreeSet;
use std::path::PathBuf;

use agents::pipeline::Brief;
use agents::StyleGuide;
use knowledge::{pack, DirSource, KnowledgeBase, MemSource, SiteSource};
use orchestrator::{article_context, ConfigSource, SiteBinding, STYLE_GUIDE_PATH};
use serde_json::{json, Value};

const COMMIT: &str = "3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b";
/// The trimmed style guide the browser session bound before K2.
const FIXTURE_STYLE_GUIDE: &str = include_str!("../../agents/tests/fixtures/style-guide.json");

fn mini() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../knowledge/tests/fixtures/cinqueterre-mini"),
    )
}

fn mini_pack_json() -> String {
    pack::build(&mini(), COMMIT).unwrap().to_json().unwrap()
}

fn read_json(src: &dyn SiteSource, path: &str) -> Value {
    src.read_json(path).unwrap().unwrap()
}

fn binding(extra: Value) -> Result<SiteBinding, String> {
    let mut v = json!({"site_id": "cinqueterre.travel", "brand_name": "Cinque Terre Dispatch"});
    for (k, x) in extra.as_object().unwrap() {
        v[k] = x.clone();
    }
    SiteBinding::from_json(&v)
}

#[test]
fn a_binding_from_the_pack_carries_the_sites_style_guide_writer_prompt_and_closed_world() {
    let src = mini();
    // The binding also names the old fixture: the site's own file wins.
    let site = binding(json!({
        "knowledge_pack": mini_pack_json(),
        "style_guide": serde_json::from_str::<Value>(FIXTURE_STYLE_GUIDE).unwrap(),
    }))
    .unwrap();

    // The style guide is the site's `content/config/style-guide.json`.
    let own =
        StyleGuide::from_json_str(&read_json(&src, "content/config/style-guide.json").to_string())
            .unwrap();
    assert_eq!(site.style_source, ConfigSource::Pack);
    assert_eq!(site.context.style_guide, own);
    assert_ne!(
        site.context.style_guide,
        StyleGuide::from_json_str(FIXTURE_STYLE_GUIDE).unwrap(),
        "not the trimmed fixture"
    );
    assert!(site
        .context
        .style_guide
        .banned_phrases()
        .contains(&"hidden gem".to_string()));
    // The writer prompt is the site's `writer-prompt.json`: its template
    // additions are the writer's site layer.
    assert_eq!(site.writer_prompt_source, ConfigSource::Pack);
    let additions = site.context.layer.template_additions.as_deref().unwrap();
    let file = read_json(&src, "content/config/writer-prompt.json");
    assert_eq!(
        additions,
        file["website_prompt_template"]["template_additions"]
            .as_str()
            .unwrap()
    );
    assert!(additions.contains("Content Block Types for Cinque Terre"));

    // The closed world: the fixture's media and pages, at the pack's commit.
    let direct = KnowledgeBase::build(&src).unwrap();
    let k = site.knowledge.as_ref().unwrap();
    assert_eq!(k.commit, COMMIT);
    assert_eq!(k.kb.media.len(), direct.media.len());
    assert_eq!(k.kb.media.len(), 20);
    assert_eq!(k.kb.pages.len(), direct.pages.len());
    assert_eq!(
        k.blog_index.as_ref().unwrap(),
        &read_json(&src, "content/pages/blog-index.json")
    );
    assert!(std::sync::Arc::ptr_eq(site.kb().unwrap(), &k.kb));
    assert_eq!(
        site.summary(),
        json!({"site_id": "cinqueterre.travel", "commit": COMMIT, "pages": direct.pages.len(),
               "media": 20, "entities": direct.entities.entities.len(), "blog_index": true,
               "style_guide": "pack", "writer_prompt": "pack",
               "seo_suffix": "The Dispatch", "seo_suffix_source": "articles"})
    );

    // What the staged-drafting increment will call: the hero shortlist comes
    // from the pack's media index, the categories from its blog index.
    let brief = Brief {
        content_id: "content-1".into(),
        title: "Sunset in Riomaggiore".into(),
        slug: "sunset-in-riomaggiore".into(),
        angle: "Where to sit when the harbour turns gold".into(),
        keywords: vec!["riomaggiore".into(), "sunset".into()],
        target_words: 600,
        language: "en".into(),
        notes: String::new(),
    };
    let ctx = article_context(&k.kb, &brief, k.blog_index.as_ref(), &BTreeSet::new());
    assert!(!ctx.heroes.is_empty());
    assert!(ctx
        .heroes
        .iter()
        .all(|h| k.kb.media.get(&h.media_id).is_some()));
    assert!(!ctx.links.is_empty());
}

/// An article's `seo.title` ends with what the site's articles use (the live
/// site: "| The Dispatch"), not with the brand name "Cinque Terre Dispatch".
#[test]
fn the_seo_suffix_comes_from_the_sites_articles_then_its_blog_name_then_the_brand() {
    use orchestrator::SeoSuffixSource;

    // cinqueterre-mini: "Day Trip to Portovenere | The Dispatch" is its one
    // article title with a suffix; its other pages' "| Cinque Terre Dispatch"
    // (village pages, the home page) do not count.
    let site = binding(json!({"knowledge_pack": mini_pack_json()})).unwrap();
    assert_eq!(
        (site.seo_suffix.as_str(), site.seo_suffix_source),
        ("The Dispatch", SeoSuffixSource::Articles)
    );
    // The binding's own wins.
    let own =
        binding(json!({"knowledge_pack": mini_pack_json(), "seo_suffix": "Dispatch"})).unwrap();
    assert_eq!(
        (own.seo_suffix.as_str(), own.seo_suffix_source),
        ("Dispatch", SeoSuffixSource::Binding)
    );
    // No pack: the brand.
    let bare = binding(json!({})).unwrap();
    assert_eq!(
        (bare.seo_suffix.as_str(), bare.seo_suffix_source),
        ("Cinque Terre Dispatch", SeoSuffixSource::Brand)
    );

    // A site whose articles carry no suffix: the story section's name (the
    // blog index block's title); the most common article suffix otherwise.
    let page = |id: &str, slug: &str, title: &str, page_type: &str| {
        json!({"id": id, "slug": {"en": format!("/en{slug}")}, "title": {"en": title},
               "page_type": page_type, "body": []})
    };
    let mut src = MemSource::new();
    src.insert_json(
        "content/site.json",
        &json!({"name": "Mini", "locales": ["en"], "defaultLocale": "en"}),
    )
    .insert_json(
        "content/pages/blog-index.json",
        &json!({"id": "blog", "slug": {"en": "/en/blog"}, "title": {"en": "Stories"},
                "page_type": "blog-index",
                "body": [{"type": "blog-index", "title": "The Log", "stories": []}]}),
    )
    .insert_json(
        "content/pages/blog/a.json",
        &page("a", "/blog/a", "First walk", "blog-article"),
    )
    .insert_json(
        "content/pages/village.json",
        &page("v", "/village", "Village | Somewhere Else", "village"),
    );
    let pack_of = |src: &MemSource| pack::build(src, "c0ffee").unwrap().to_json().unwrap();
    let blog = binding(json!({"knowledge_pack": pack_of(&src)})).unwrap();
    assert_eq!(
        (blog.seo_suffix.as_str(), blog.seo_suffix_source),
        ("The Log", SeoSuffixSource::BlogIndex)
    );
    src.insert_json(
        "content/pages/blog/b.json",
        &page("b", "/blog/b", "Second walk | The Log Book", "blog-article"),
    )
    .insert_json(
        "content/pages/blog/c.json",
        &page("c", "/blog/c", "Third walk | The Log Book", "blog-article"),
    )
    .insert_json(
        "content/pages/blog/d.json",
        &page("d", "/blog/d", "Fourth walk | Old Name", "blog-article"),
    );
    let articles = binding(json!({"knowledge_pack": pack_of(&src)})).unwrap();
    assert_eq!(
        (articles.seo_suffix.as_str(), articles.seo_suffix_source),
        ("The Log Book", SeoSuffixSource::Articles)
    );
    assert_eq!(articles.summary()["seo_suffix_source"], json!("articles"));
}

/// The site's own writer prompt and style guide resolve into the prompts of
/// the jobs, which run as before (the Draft job does not read the pack yet).
#[tokio::test]
async fn standup_and_draft_run_on_a_pack_binding() {
    use std::sync::Arc;

    use agents::FakeReply;
    use orchestrator::{
        FakeGateway, JobKind, JobRequest, MemStore, Orchestrator, Outcome, StaffRef,
    };

    let team: Vec<StaffRef> = [
        ("staff-4", "sophia", "editor-in-chief"),
        ("staff-5", "marco", "editor"),
        ("staff-1", "giulia", "writer"),
    ]
    .into_iter()
    .map(|(id, persona, role)| StaffRef {
        id: id.into(),
        persona: persona.into(),
        role: role.into(),
    })
    .collect();
    let job = |job_id, kind, brief_ref, work_item: Option<&str>| JobRequest {
        company_id: "c1".into(),
        job_id,
        kind,
        project: "project-1".into(),
        work_item: work_item.map(String::from),
        brief_ref,
        revision: 0,
        staff: team.clone(),
        meeting: None,
        context: Value::Null,
        approved_by: None,
    };
    // The fake writer answers the standup's pitch round and the staged draft.
    let llm = Arc::new(agents::fake_writer::fake_writer(Vec::<FakeReply>::new()));
    let site = binding(json!({"knowledge_pack": mini_pack_json()})).unwrap();
    let orch = Orchestrator::new(MemStore::new(), FakeGateway::new(), llm.clone(), site);
    let out = orch
        .run(&job(1, JobKind::Standup, None, None))
        .await
        .unwrap();
    let brief_ref = match &out[..] {
        [Outcome::MeetingOutcome { briefs, .. }] => briefs[0].brief_ref,
        other => panic!("{other:?}"),
    };
    let out = orch
        .run(&job(
            2,
            JobKind::Draft,
            Some(brief_ref),
            Some("work-item-1"),
        ))
        .await
        .unwrap();
    assert!(
        matches!(&out[..], [Outcome::JobCompleted { digest, .. }] if digest.ok),
        "{out:?}"
    );
    // The writer's system prompt carries the site's own writer prompt.
    let writer_system = llm
        .calls()
        .last()
        .map(|c| c.request.system.join("\n"))
        .unwrap_or_default();
    assert!(
        writer_system.contains("Content Block Types for Cinque Terre"),
        "{writer_system}"
    );
}

#[test]
fn the_pack_may_be_text_or_an_object() {
    let text = mini_pack_json();
    let a = binding(json!({"knowledge_pack": text})).unwrap();
    let b =
        binding(json!({"knowledge_pack": serde_json::from_str::<Value>(&text).unwrap()})).unwrap();
    assert_eq!(a.context.style_guide, b.context.style_guide);
    assert_eq!(a.summary(), b.summary());
}

#[test]
fn without_a_pack_the_binding_falls_back_to_its_own_style_guide_then_to_none() {
    // Tests and the harness: the binding's `style_guide`, no closed world.
    let fixture: Value = serde_json::from_str(FIXTURE_STYLE_GUIDE).unwrap();
    let site = binding(json!({"style_guide": fixture, "knowledge_pack": null})).unwrap();
    assert!(site.knowledge.is_none() && site.kb().is_none());
    assert_eq!(site.style_source, ConfigSource::Binding);
    assert_eq!(site.writer_prompt_source, ConfigSource::Absent);
    assert_eq!(
        site.context.style_guide,
        StyleGuide::from_json_str(FIXTURE_STYLE_GUIDE).unwrap()
    );
    assert_eq!(site.summary()["commit"], Value::Null);

    // Nothing at all: an empty house style.
    let bare = binding(json!({})).unwrap();
    assert_eq!(bare.style_source, ConfigSource::Absent);
    assert_eq!(bare.context.style_guide, StyleGuide::default());
    assert!(bare.context.layer.template_additions.is_none());

    // A site without the two files: the pack still gives the closed world,
    // the style guide falls back to the binding's.
    let mut src = MemSource::new();
    src.insert_json(
        "content/config/media-index.json",
        &json!({"images": [{"id": "a-1", "url": "https://img.test/a", "tags": {"village": "a", "category": "sights"}}]}),
    );
    let pack = pack::build(&src, "c0ffee").unwrap().to_json().unwrap();
    let site = binding(json!({"knowledge_pack": pack, "style_guide": serde_json::from_str::<Value>(FIXTURE_STYLE_GUIDE).unwrap()})).unwrap();
    assert_eq!(site.style_source, ConfigSource::Binding);
    assert_eq!(site.writer_prompt_source, ConfigSource::Absent);
    assert_eq!(site.kb().unwrap().media.len(), 1);
    assert!(site.knowledge.as_ref().unwrap().blog_index.is_none());
}

#[test]
fn a_broken_pack_or_site_file_is_an_error_that_names_it() {
    let e = binding(json!({"knowledge_pack": "{ not a pack"}))
        .err()
        .unwrap();
    assert!(e.contains("knowledge pack"), "{e}");
    let e = binding(json!({"knowledge_pack": 42})).err().unwrap();
    assert!(e.contains("knowledge_pack"), "{e}");

    // A style guide that is JSON but not a style guide.
    let mut src = MemSource::new();
    src.insert(STYLE_GUIDE_PATH, "{\"vocabulary\": {\"avoid\": 7}}");
    let pack = pack::build(&src, "c0ffee").unwrap().to_json().unwrap();
    let e = binding(json!({"knowledge_pack": pack})).err().unwrap();
    assert!(e.contains(STYLE_GUIDE_PATH), "{e}");

    // The required fields are still required.
    let e = SiteBinding::from_json(&json!({"site_id": "x"}))
        .err()
        .unwrap();
    assert!(e.contains("brand_name"), "{e}");
}

/// The browser's tests (vitest, Bun) bind the orchestrator to this pack; it
/// must be the one the tree gives. Regenerate with
/// `cargo xtask site-pack crates/knowledge/tests/fixtures/cinqueterre-mini --commit 3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b --out apps/game/src/orchestrator/fixtures/cinqueterre-mini.pack.json`.
#[test]
fn the_pack_fixture_of_the_browser_tests_is_the_trees() {
    let committed: Value = serde_json::from_str(include_str!(
        "../../../apps/game/src/orchestrator/fixtures/cinqueterre-mini.pack.json"
    ))
    .unwrap();
    let built: Value = serde_json::from_str(&mini_pack_json()).unwrap();
    assert_eq!(committed, built);
}
