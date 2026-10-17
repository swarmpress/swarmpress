//! site-standard v1 over fixtures: the clean site passes every rule; each failing fixture
//! breaks exactly its rule; each rule's mutation breaks exactly that rule; without the rule in
//! the standard its fixture passes (the rule, and nothing else, is what catches it); the same
//! facts give the same report bytes.

use std::collections::BTreeSet;

use serde::Deserialize;
use serde_json::Value;
use site_quality::facts::{Alternate, PageFacts, Request};
use site_quality::rules::EVALUATED;
use site_quality::{build, evaluate, route, Exception, Kind, Route, SiteFacts, Standard, Subject};

#[derive(Deserialize)]
struct Set {
    site: SiteFacts,
    pages: Vec<PageFacts>,
}

#[derive(Deserialize)]
struct Failing {
    rule: String,
    why: String,
    set: serde_json::Map<String, Value>,
}

fn clean_value() -> Value {
    serde_json::from_str(include_str!("fixtures/clean.json")).unwrap()
}

fn clean() -> Set {
    serde_json::from_value(clean_value()).unwrap()
}

fn failing() -> Vec<Failing> {
    serde_json::from_str(include_str!("fixtures/failing.json")).unwrap()
}

fn patched(f: &Failing) -> Set {
    let mut v = clean_value();
    for (pointer, value) in &f.set {
        if let Some(slot) = v.pointer_mut(pointer) {
            *slot = value.clone();
            continue;
        }
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        v.pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .unwrap_or_else(|| panic!("{}: no {parent} in the clean fixture", f.rule))
            .insert(key.to_string(), value.clone());
    }
    serde_json::from_value(v).unwrap()
}

fn rules_of(std: &Standard, s: &Set) -> BTreeSet<String> {
    evaluate(std, &s.site, &s.pages)
        .into_iter()
        .map(|f| f.rule)
        .collect()
}

fn one(rule: &str) -> BTreeSet<String> {
    BTreeSet::from([rule.to_string()])
}

#[test]
fn the_shipped_standard_parses_and_names_exactly_the_evaluated_rules() {
    let std = Standard::from_json(site_quality::standard::V1_JSON).expect("v1 parses");
    assert_eq!((std.id.as_str(), std.version), ("site-standard", 1));
    assert_eq!(std.widths, vec![1280, 390]);
    let det: BTreeSet<&str> = std
        .rules
        .iter()
        .filter(|r| r.kind == Kind::Deterministic)
        .map(|r| r.id.as_str())
        .collect();
    let evaluated: BTreeSet<&str> = EVALUATED.iter().copied().collect();
    assert_eq!(det, evaluated);
    // Judged rules are listed and not enforced before their calibration.
    let judged: Vec<_> = std
        .rules
        .iter()
        .filter(|r| r.kind == Kind::Judged)
        .collect();
    assert!(judged.len() >= 3);
    assert!(judged.iter().all(|r| r.min_score.is_none()));
    assert_eq!(std.reference(), Standard::v1().reference());
    assert_eq!(std.reference().digest.len(), 64);
}

#[test]
fn a_standard_naming_a_rule_without_evaluation_is_refused() {
    let mut v: Value = serde_json::from_str(site_quality::standard::V1_JSON).unwrap();
    v["rules"][0]["id"] = Value::from("made-up-rule");
    assert!(Standard::from_json(&v.to_string())
        .unwrap_err()
        .contains("made-up-rule"));
}

#[test]
fn the_clean_site_passes_every_rule() {
    let std = Standard::v1();
    let s = clean();
    let found = evaluate(&std, &s.site, &s.pages);
    assert!(found.is_empty(), "{found:#?}");
    let r = build(&std, Subject::default(), &s.site, &s.pages, &[]).unwrap();
    assert!(r.gate.passed, "{:?}", r.gate);
    assert_eq!(r.scores.min(), 1000);
    assert_eq!((r.pages, r.audits), (2, 4));
    assert_eq!(r.gate.not_judged.len(), 3);
}

#[test]
fn every_rule_has_a_failing_fixture_that_breaks_exactly_it() {
    let std = Standard::v1();
    let fixtures = failing();
    let covered: BTreeSet<&str> = fixtures.iter().map(|f| f.rule.as_str()).collect();
    for rule in EVALUATED {
        assert!(covered.contains(rule), "{rule} has no failing fixture");
    }
    for f in &fixtures {
        let s = patched(f);
        assert_eq!(rules_of(&std, &s), one(&f.rule), "{}: {}", f.rule, f.why);
        // Without the rule the fixture passes: the rule is what catches it.
        let without = std.without(&f.rule);
        assert!(
            rules_of(&without, &s).is_empty(),
            "{}: other rules catch it too",
            f.rule
        );
        let r = build(&std, Subject::default(), &s.site, &s.pages, &[]).unwrap();
        assert!(!r.gate.passed, "{} does not block", f.rule);
        assert!(r.findings.iter().all(|x| !x.detail.is_empty()));
    }
}

type Mutation = fn(&mut Set);

/// Each rule broken a second way, in code (not the fixture's way).
fn mutations() -> Vec<(&'static str, Mutation)> {
    vec![
        ("page-render", |s| s.pages[3].status = 500),
        ("empty-frame", |s| {
            let mut f = s.pages[1].frames[0].clone();
            f.kind = "figure".into();
            f.images = 0;
            f.loaded = 0;
            f.label = "figure.wp-block-image".into();
            s.pages[1].frames.push(f);
        }),
        ("broken-image", |s| {
            s.pages[2].requests.push(Request {
                url: "https://images.example.org/gone.jpg".into(),
                status: 404,
                failure: None,
                kind: "image-head".into(),
            })
        }),
        ("alt-missing", |s| s.pages[2].images[0].alt = None),
        ("alt-title", |s| {
            s.pages[2].images[0].alt = Some("Example Coast".into())
        }),
        ("link-hash", |s| {
            s.pages[2].links[2].href = "javascript:void(0)".into()
        }),
        ("link-broken", |s| {
            s.pages[2].links[2].href = "../nicht-da/".into()
        }),
        ("link-anchor", |s| {
            s.pages[2].links[1].href = "#plan".into();
            s.pages[2].links[1].target_found = Some(false);
        }),
        ("request-failed", |s| {
            s.pages[3].requests[0].status = 0;
            s.pages[3].requests[0].failure = Some("net::ERR_NAME_NOT_RESOLVED".into());
        }),
        ("request-production", |s| {
            s.pages[3].requests[0].url = "https://www.example.travel/x.css".into()
        }),
        ("export-hygiene", |s| {
            s.pages[2].assets[1].snippet = Some("window._wpemojiSettings = {}".into())
        }),
        ("overflow", |s| {
            s.pages[3].scroll_width = 391 + 1;
            s.pages[3].wide = vec!["table \"Day Sky\"".into()];
        }),
        ("narrow-column", |s| {
            s.pages[2].blocks[0].measure = false;
            s.pages[2].blocks[0].w = 800;
        }),
        ("h1-count", |s| {
            let mut h = s.pages[3].headings[0].clone();
            h.text = "Another".into();
            s.pages[3].headings.push(h);
        }),
        ("h1-own", |s| {
            s.pages[2].hero = None;
            s.pages[2].headings[0].text = "Willkommen an der Küste".into();
        }),
        ("heading-order", |s| s.pages[2].headings[1].level = 3),
        ("hero-first", |s| {
            if let Some(h) = s.pages[2].hero.as_mut() {
                h.after.push("div.wp-block-query".into());
            }
        }),
        ("raw-slug", |s| {
            s.pages[2].chips[0].text = "boat_tours".into()
        }),
        ("english-label", |s| {
            s.pages[2].texts.push(" Read  more ".into());
        }),
        ("seo-title", |s| s.pages[2].head.title = "x".repeat(120)),
        ("seo-description", |s| {
            s.pages[2].head.description = Some("Kurz.".into())
        }),
        ("seo-canonical", |s| s.pages[2].head.canonical = None),
        ("seo-hreflang", |s| {
            s.pages[2].head.alternates.retain(|a| a.lang != "en");
            // The English page still names the German one, which no longer lists it back.
            let _ = Alternate::default();
        }),
        ("seo-sitemap", |s| {
            s.site.sitemap_found = false;
            s.site.sitemap.clear();
        }),
        ("seo-duplicate-title", |s| {
            s.pages[0].head.title = "Der Hafen | Example Coast".into();
        }),
    ]
}

#[test]
fn every_rule_has_a_mutation_that_breaks_exactly_it() {
    let std = Standard::v1();
    let ms = mutations();
    let covered: BTreeSet<&str> = ms.iter().map(|(r, _)| *r).collect();
    for rule in EVALUATED {
        assert!(covered.contains(rule), "{rule} has no mutation test");
    }
    for (rule, m) in ms {
        let mut s = clean();
        m(&mut s);
        let got = rules_of(&std, &s);
        assert_eq!(got, one(rule), "the mutation of {rule}");
        assert!(rules_of(&std.without(rule), &s).is_empty(), "{rule}");
    }
}

#[test]
fn the_same_facts_give_the_same_report_bytes() {
    let std = Standard::v1();
    let mut s = clean();
    for f in failing() {
        let p = patched(&f);
        s.pages.extend(p.pages.into_iter().map(|mut x| {
            x.path = format!("{}{}/", x.path, f.rule);
            x
        }));
    }
    let a = build(&std, Subject::default(), &s.site, &s.pages, &[]).unwrap();
    let mut rev = s.pages.clone();
    rev.reverse();
    let b = build(&std, Subject::default(), &s.site, &rev, &[]).unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}

#[test]
fn exceptions_are_content_gaps_of_content_classes_only() {
    let std = Standard::v1();
    let bad_reason = Exception {
        rule: "alt-missing".into(),
        page: "/en/*".into(),
        why: "looks fine to me".into(),
        detail: None,
    };
    let designer_rule = Exception {
        rule: "narrow-column".into(),
        page: "/en/harbour/".into(),
        why: "content gap: nothing to show".into(),
        detail: None,
    };
    let s = clean();
    let errs = build(
        &std,
        Subject::default(),
        &s.site,
        &s.pages,
        &[bad_reason, designer_rule],
    )
    .unwrap_err();
    assert_eq!(errs.len(), 2, "{errs:?}");

    // An authored picture without alt: the photo editor's, excepted as a listed content gap.
    let mut s = clean();
    s.pages[0].images[0].alt = None;
    s.pages[0].links[0].href = "#".into(); // a template link: the web designer's
    let gap = Exception {
        rule: "alt-missing".into(),
        page: "/en/*".into(),
        why: "content gap: the source has no description of this picture".into(),
        detail: None,
    };
    let stale = Exception {
        rule: "raw-slug".into(),
        page: "/fr/*".into(),
        why: "content gap: an old label".into(),
        detail: None,
    };
    let r = build(&std, Subject::default(), &s.site, &s.pages, &[gap, stale]).unwrap();
    assert_eq!(r.excepted.len(), 1);
    assert_eq!(r.excepted[0].route, Route::PhotoEditor);
    assert_eq!(r.unused_exceptions.len(), 1);
    assert_eq!(r.findings.len(), 1);
    assert_eq!(r.findings[0].rule, "link-hash");
    assert!(!r.gate.passed);
    assert_eq!(r.digest.exceptions, 1);
    assert_eq!(r.digest.findings, 1);
    // A template's `#` link is not a content gap, whatever the list says.
    let not_a_gap = Exception {
        rule: "link-hash".into(),
        page: "/en/*".into(),
        why: "content gap: no target".into(),
        detail: None,
    };
    let r = build(&std, Subject::default(), &s.site, &s.pages, &[not_a_gap]).unwrap();
    assert!(r.findings.iter().any(|f| f.rule == "link-hash"));
}

#[test]
fn classes_are_rule_by_page_type_by_owner_and_route_to_roles() {
    let std = Standard::v1();
    let mut s = clean();
    // A design class on two pages of one type, a content class, a platform class.
    for p in &mut s.pages {
        if p.width == 1280 {
            p.blocks[1].beside = false;
        }
    }
    s.pages[0].images[0].alt = None;
    s.pages[0].links[1].target_found = Some(false);
    s.pages[1].assets.push(site_quality::facts::Asset {
        kind: "script".into(),
        src: Some("/wp-includes/js/wp-emoji-release.min.js".into()),
        ..Default::default()
    });
    let r = build(&std, Subject::default(), &s.site, &s.pages, &[]).unwrap();
    let narrow = r
        .clusters
        .iter()
        .find(|c| c.rule == "narrow-column")
        .unwrap();
    assert_eq!((narrow.pages, narrow.findings), (2, 2));
    assert_eq!(narrow.route, Route::WebDesigner);
    let routing = route(&std, &r);
    assert_eq!(routing.design.len(), 1);
    assert_eq!(routing.platform.len(), 0, "the emoji script is at 390 only");
    let roles: BTreeSet<Route> = routing.content.iter().map(|w| w.role).collect();
    assert_eq!(roles, BTreeSet::from([Route::PhotoEditor, Route::Editor]));
    assert!(routing
        .content
        .iter()
        .all(|w| w.evidence.contains("/en/harbour/")));
    assert!(narrow.evidence(&std).contains("600 of 1200 px"));
    assert!(r.scores.layout < 1000 && r.scores.seo == 1000);
    let table = r.table();
    assert_eq!(table["narrow-column"]["page-village"], 2);
    assert!(r.line().contains("blocked"));
}

#[test]
fn a_declared_second_url_carries_no_language_versions_sitemap_entry_or_title_of_its_own() {
    let std = Standard::v1();
    let mut s = clean();
    // `/de/harbour/` beside `/de/hafen/`: the same page under its English slug, its canonical
    // the German page's.
    s.site.paths.insert("/de/harbour/".into());
    for i in [2, 3] {
        let mut p = s.pages[i].clone();
        p.path = "/de/harbour/".into();
        p.head.alternates.clear();
        s.pages.push(p);
    }
    assert!(evaluate(&std, &s.site, &s.pages).is_empty());
    // A canonical naming a page the release does not have is a finding.
    let n = s.pages.len();
    s.pages[n - 2].head.canonical = Some("https://example.travel/de/weg/".into());
    let got = rules_of(&std, &s);
    assert!(got.contains("seo-canonical"), "{got:?}");
}

#[test]
fn a_page_that_asks_not_to_be_indexed_needs_no_snippet_or_title_of_its_own() {
    let std = Standard::v1();
    let mut s = clean();
    for p in &mut s.pages {
        if p.path == "/de/hafen/" {
            p.head.robots = Some("noindex, follow".into());
            p.head.description = None;
            p.head.title = "The Harbour | Example Coast".into();
        }
    }
    s.site.sitemap.remove("/de/hafen/");
    assert!(evaluate(&std, &s.site, &s.pages).is_empty());
    // Indexed again, the same page breaks three rules.
    for p in &mut s.pages {
        p.head.robots = None;
    }
    let got = rules_of(&std, &s);
    assert_eq!(
        got,
        BTreeSet::from([
            "seo-description".to_string(),
            "seo-duplicate-title".to_string(),
            "seo-sitemap".to_string()
        ])
    );
}
