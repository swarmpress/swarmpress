//! A mutation test (FEAT-115, like the office designer's): seeded random changes to markup
//! that passes. Every change of the kinds below breaks a rule, so every mutant must be
//! caught; and the markup that passes keeps passing.
mod common;

use common::*;
use theme_designer::{check_template, TaskKind};

struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n.max(1)
    }
}

/// Positions of `needle` in `s`.
fn at(s: &str, needle: &str) -> Vec<usize> {
    s.match_indices(needle).map(|(i, _)| i).collect()
}

/// One mutation at a random place it applies; `None` when it applies nowhere.
fn mutate(kind: u64, s: &str, g: &mut Lcg) -> Option<(String, &'static str)> {
    let pick = |v: Vec<usize>, g: &mut Lcg| -> Option<usize> {
        (!v.is_empty()).then(|| v[usize::try_from(g.next(v.len() as u64)).unwrap()])
    };
    let splice = |i: usize, len: usize, with: &str| {
        let mut o = s.to_string();
        o.replace_range(i..i + len, with);
        o
    };
    match kind {
        // drop a closer
        0 => pick(at(s, "<!-- /wp:"), g).map(|i| {
            let end = s[i..].find("-->").unwrap() + 3;
            (splice(i, end, ""), "a closer dropped")
        }),
        // break an attribute object
        1 => pick(at(s, "\"} -->"), g).map(|i| (splice(i, 6, "\" -->"), "attributes broken")),
        // a block outside core
        2 => pick(at(s, "<!-- wp:paragraph"), g).map(|i| {
            let m = splice(i, 17, "<!-- wp:acme/text");
            (
                m.replacen("<!-- /wp:paragraph -->", "<!-- /wp:acme/text -->", 1),
                "a foreign block",
            )
        }),
        // a raw colour in an attribute
        3 => pick(at(s, "{\"align\":\"wide\""), g).map(|i| {
            (
                splice(i, 1, "{\"overlayColor\":\"#123456\","),
                "a raw colour",
            )
        }),
        // an unknown preset
        4 => pick(at(s, "\"fontSize\":\""), g)
            .map(|i| (splice(i, 12, "\"fontSize\":\"zz-"), "an unknown size")),
        // a script
        5 => pick(at(s, "</div>"), g).map(|i| (splice(i, 0, "<script>x()</script>"), "a script")),
        // a placeholder link
        6 => pick(at(s, "</p>"), g).map(|i| (splice(i, 0, "<a href=\"#\">more</a>"), "a # link")),
        // a section's class lost
        7 => pick(at(s, "\"className\":\"sp-"), g)
            .map(|i| (splice(i, 17, "\"className\":\"xx-"), "a section's class")),
        // a part dropped
        8 => pick(at(s, "<!-- wp:template-part"), g).map(|i| {
            let end = s[i..].find("/-->").unwrap() + 4;
            (splice(i, end, ""), "a part dropped")
        }),
        // a query changed
        9 => pick(at(s, "\"perPage\":"), g)
            .map(|i| (splice(i, 10, "\"perPage\":9"), "a query changed")),
        // an inline handler
        10 => pick(at(s, "<p"), g).map(|i| (splice(i, 2, "<p onmouseover=\"x()\""), "a handler")),
        // the site's title as a heading
        11 => {
            pick(at(s, "\"level\":0"), g).map(|i| (splice(i, 9, "\"level\":1"), "site title as h1"))
        }
        _ => None,
    }
}

#[test]
fn every_mutant_is_caught() {
    let p = dispatch_full_tokens();
    let mut rules = p.rules.clone();
    rules.push((
        "fix-02".into(),
        site_design::model::RuleCheck::HeadlineWithoutSiteName,
    ));
    let parts = p.part_slugs();
    let mut ctx = p.context(&parts);
    ctx.rules = &rules;
    let s = sketches(&p);
    let mut g = Lcg(0x5eed_7e3e);
    let mut caught = 0;
    for t in &p.tasks {
        let good = &s[&t.label()];
        assert!(check_template(t, good, &ctx).is_empty(), "{}", t.label());
        for _ in 0..40 {
            let kind = g.next(12);
            if kind == 8 && t.kind == TaskKind::Part {
                continue;
            }
            let Some((bad, what)) = mutate(kind, good, &mut g) else {
                continue;
            };
            let issues = check_template(t, &bad, &ctx);
            assert!(
                issues.iter().any(|i| i.is_error()),
                "{}: {what} escaped the checks:\n{bad}",
                t.label()
            );
            caught += 1;
        }
    }
    assert!(caught > 200, "only {caught} mutants applied");
}
