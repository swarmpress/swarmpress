//! Integration over the real cinqueterre.travel checkout. Ignored by default:
//! `cargo test -p knowledge --test real_repo -- --ignored --nocapture`.
//! `CINQUETERRE_REPO` overrides the checkout path.

use content_model::{validate_page_v1, validate_page_v2, SchemaRegistry};
use knowledge::{DirSource, DuplicateKind, EntityKind, KnowledgeBase, SiteSource, SiteSummary};

const REPO: &str = "/home/user/cinqueterre.travel";

#[test]
#[ignore = "needs the cinqueterre.travel checkout at /home/user/cinqueterre.travel"]
fn indexes_the_real_site() {
    let src = DirSource::new(std::env::var("CINQUETERRE_REPO").unwrap_or_else(|_| REPO.into()));
    let kb = KnowledgeBase::build(&src).unwrap();
    let audit = kb.audit(&src).unwrap();
    println!("{}", SiteSummary::new(&kb, Some(&audit)));

    assert_eq!(kb.pages.len(), 157);
    assert!(kb.pages.errors.is_empty(), "{:?}", kb.pages.errors);
    assert_eq!(kb.media.len(), 338);
    assert!(kb.media.issues.is_empty(), "{:?}", kb.media.issues);
    assert_eq!(kb.manifest.regions.len(), 5);
    assert_eq!(kb.entities.count(EntityKind::Village), 5);
    assert_eq!(kb.manifest.languages.len(), 4);

    // content/blog mirrors content/pages/blog: 18 copies, 2 of which differ.
    let stray: Vec<bool> = kb
        .pages
        .duplicates
        .iter()
        .filter_map(|d| match d.kind {
            DuplicateKind::StrayCopy { identical } => Some(identical),
            _ => None,
        })
        .collect();
    assert_eq!(stray.len(), 18);
    assert_eq!(stray.iter().filter(|i| !**i).count(), 2);

    assert_eq!(
        kb.resolve_link("riomaggiore", "de").unwrap(),
        "/de/riomaggiore"
    );
    assert_eq!(
        kb.suggest_media(Some("vernazza"), Some("sights"), None, 1)
            .unwrap()[0]
            .entry
            .tags
            .village,
        "vernazza"
    );

    let registry = SchemaRegistry::core();
    let (mut v1, mut v2) = (0, 0);
    for p in &kb.pages.pages {
        let v = src.read_json(&p.path).unwrap().unwrap();
        v1 += usize::from(validate_page_v1(&v).is_ok());
        v2 += usize::from(validate_page_v2(&v, &registry).is_ok());
    }
    println!("schema: v1 {v1}/157, v2 {v2}/157");
    assert!(v2 >= v1);
}
