//! One failing fixture per check (FEAT-115): each starts from a template or part that
//! passes and breaks one thing; the check names it precisely.
mod common;

use common::*;
use site_design::model::RuleCheck;
use theme_designer::{
    assemble, check_template, check_theme, Issue, IssueCode, TemplateTask, ThemePlan,
};

struct Case {
    plan: ThemePlan,
}

impl Case {
    fn new() -> Case {
        let mut plan = dispatch_full_tokens();
        // The full guide's rules (the trimmed export has none of its sheets of rules).
        plan.rules = vec![
            (
                "fix-01".into(),
                RuleCheck::RatingScale {
                    max: 10,
                    decimals: 1,
                },
            ),
            ("fix-02".into(), RuleCheck::HeadlineWithoutSiteName),
            ("fix-03".into(), RuleCheck::NoPlaceholderLinks),
            (
                "fix-06".into(),
                RuleCheck::RequiredFields {
                    fields: vec!["category".into(), "alt".into()],
                },
            ),
            (
                "fix-10".into(),
                RuleCheck::PriceScale {
                    symbol: "€".into(),
                    max: 4,
                },
            ),
        ];
        Case { plan }
    }

    fn task(&self, slug: &str) -> &TemplateTask {
        self.plan.tasks.iter().find(|t| t.slug == slug).unwrap()
    }

    fn good(&self, slug: &str) -> String {
        theme_designer::sketch::template(self.task(slug), &self.plan.presets)
    }

    fn check(&self, slug: &str, markup: &str) -> Vec<Issue> {
        let parts = self.plan.part_slugs();
        check_template(self.task(slug), markup, &self.plan.context(&parts))
    }

    /// `slug`'s good markup with `from` replaced by `to` (once) fails with `code` and a
    /// message containing `want`.
    fn fails(&self, slug: &str, from: &str, to: &str, code: IssueCode, want: &str) -> Issue {
        let good = self.good(slug);
        assert!(
            self.check(slug, &good).is_empty(),
            "the base of {slug} passes"
        );
        assert!(good.contains(from), "{slug} has {from:?}");
        let bad = good.replacen(from, to, 1);
        let issues = self.check(slug, &bad);
        issues
            .iter()
            .find(|i| i.code == code && i.message.contains(want))
            .cloned()
            .unwrap_or_else(|| panic!("no {code:?} issue with {want:?} in {issues:#?}"))
    }
}

const HERO: &str = "<!-- wp:heading {\"level\":1} -->\n<h1 class=\"wp-block-heading\">Five villages, walked slowly.</h1>\n<!-- /wp:heading -->";

#[test]
fn grammar() {
    let c = Case::new();
    let i = c.fails(
        "front-page",
        "<!-- /wp:heading -->",
        "",
        IssueCode::Grammar,
        "is still open",
    );
    assert!(i.message.starts_with("line "), "{}", i.message);
    c.fails(
        "front-page",
        "{\"level\":1}",
        "{\"level\":1",
        IssueCode::Grammar,
        "not valid JSON",
    );
    c.fails(
        "single",
        "<!-- wp:template-part",
        "<p>x</p><!-- wp:template-part",
        IssueCode::Grammar,
        "HTML outside any block",
    );
}

#[test]
fn allowed_blocks() {
    let c = Case::new();
    let i = c.fails(
        "single",
        "wp:post-content",
        "wp:html",
        IssueCode::Block,
        "core/html is not an allowed block",
    );
    assert!(i.message.contains("core blocks only"));
    c.fails(
        "page",
        "wp:post-content",
        "wp:acme/slider",
        IssueCode::Block,
        "acme/slider is not an allowed block",
    );
}

#[test]
fn coverage_of_sections_parts_and_menus() {
    let c = Case::new();
    c.fails("front-page", "\"className\":\"sp-hero\"", "\"className\":\"hero\"", IssueCode::Missing, "the section hero is missing: render it as a block with \"className\":\"sp-hero\" (the design's \"Five villages, walked slowly.\")");
    c.fails(
        "single",
        "<!-- wp:post-content",
        "<!-- wp:post-excerpt",
        IssueCode::Missing,
        "it needs core/post-content",
    );
    c.fails(
        "page",
        "{\"slug\":\"footer\",\"tagName\":\"footer\"}",
        "{\"slug\":\"colophon\",\"tagName\":\"footer\"}",
        IssueCode::Missing,
        "the part footer is missing",
    );
    c.fails(
        "page",
        "{\"slug\":\"footer\",\"tagName\":\"footer\"}",
        "{\"slug\":\"colophon\",\"tagName\":\"footer\"}",
        IssueCode::Missing,
        "the part \"colophon\" does not exist",
    );
    c.fails("header", "sp-menu-villages", "sp-menu-towns", IssueCode::Missing, "the menu villages (Villages) is missing: add <!-- wp:navigation {\"className\":\"sp-menu-villages\"} /-->");
    c.fails(
        "header",
        "{\"ariaLabel\":\"Villages\"",
        "{\"ref\":12,\"ariaLabel\":\"Villages\"",
        IssueCode::Block,
        "never by a post id",
    );
}

#[test]
fn presets_only() {
    let c = Case::new();
    c.fails(
        "front-page",
        "\"fontSize\":\"eyebrow\"",
        "\"fontSize\":\"huge\"",
        IssueCode::Token,
        "the font-size preset \"huge\" does not exist",
    );
    c.fails(
        "front-page",
        "\"backgroundColor\":\"calce\"",
        "\"backgroundColor\":\"sand\"",
        IssueCode::Token,
        "the color preset \"sand\" does not exist; use one of: calce, corallo",
    );
    c.fails(
        "front-page",
        "\"align\":\"wide\"",
        "\"style\":{\"spacing\":{\"padding\":\"var:preset|spacing|99\"}},\"align\":\"wide\"",
        IssueCode::Token,
        "the spacing preset \"99\" does not exist",
    );
    c.fails(
        "front-page",
        "\"align\":\"wide\"",
        "\"style\":{\"color\":{\"background\":\"#ffffff\"}},\"align\":\"wide\"",
        IssueCode::Token,
        "sets the raw colour #ffffff in \"background\"; use a palette preset",
    );
    c.fails(
        "front-page",
        "<div class=\"wp-block-group alignwide sp-hero\">",
        "<div class=\"wp-block-group alignwide sp-hero\" style=\"color:rgb(0,0,0)\">",
        IssueCode::Token,
        "sets the raw colour rgb(…)",
    );
    c.fails(
        "front-page",
        "\"className\":\"sp-hero\"",
        "\"className\":\"sp-hero has-tiny-font-size\"",
        IssueCode::Token,
        "\"tiny\" names no font-size preset in CSS",
    );
}

#[test]
fn css_forms_follow_wordpress_kebab_case() {
    // WordPress writes the size `h1` as `has-h-1-font-size` and `--wp--preset--font-size--h-1`.
    let c = Case::new();
    let good = c
        .good("front-page")
        .replacen("\"className\":\"sp-hero\"", "\"className\":\"sp-hero has-h-1-font-size\"", 1)
        .replacen(
            "<div class=\"wp-block-group alignwide sp-hero\">",
            "<div class=\"wp-block-group alignwide sp-hero\" style=\"font-size:var(--wp--preset--font-size--h-1)\">",
            1,
        );
    assert!(
        c.check("front-page", &good).is_empty(),
        "{:#?}",
        c.check("front-page", &good)
    );
    let bad = good.replacen("--font-size--h-1)", "--font-size--h1)", 1);
    assert!(c
        .check("front-page", &bad)
        .iter()
        .any(|i| i.code == IssueCode::Token && i.message.contains("\"h1\" names no font-size preset in CSS (WordPress writes the slugs kebab-cased: body, eyebrow, h-1, h-2, meta)")));
}

#[test]
fn contrast() {
    let c = Case::new();
    // calce's band with the muted text on it
    let i = c.fails(
        "front-page",
        "{\"fontSize\":\"eyebrow\"} -->\n<p class=\"has-eyebrow-font-size\">Where to sleep",
        "{\"fontSize\":\"eyebrow\",\"textColor\":\"mist\"} -->\n<p class=\"has-eyebrow-font-size\">Where to sleep",
        IssueCode::Contrast,
        "paragraph text \"mist\" on \"calce\" is",
    );
    assert!(i.message.contains("WCAG AA needs 4.50:1"), "{}", i.message);
    assert!(i.message.contains("set \"textColor\":\""), "{}", i.message);
    // A dark band whose links keep the theme's link colour.
    let i = c.fails(
        "404",
        "{\"align\":\"wide\",\"className\":\"sp-not-found\"",
        "{\"align\":\"wide\",\"backgroundColor\":\"notte\",\"textColor\":\"salt\",\"className\":\"sp-not-found\"",
        IssueCode::Contrast,
        "paragraph links \"mare\" on \"notte\" are",
    );
    assert!(
        i.message
            .contains("\"link\":{\"color\":{\"text\":\"var:preset|color|"),
        "{}",
        i.message
    );
}

#[test]
fn safety() {
    let c = Case::new();
    c.fails(
        "404",
        "<p>The page",
        "<p><script>alert(1)</script>The page",
        IssueCode::Unsafe,
        "a <script> is not allowed",
    );
    c.fails(
        "404",
        "<p>The page",
        "<p><iframe src=\"/\"></iframe>The page",
        IssueCode::Unsafe,
        "an <iframe> is not allowed",
    );
    c.fails(
        "404",
        "<a href=\"/\">",
        "<a href=\"/\" onclick=\"go()\">",
        IssueCode::Unsafe,
        "the event handler onclick= on <a> is not allowed",
    );
    c.fails(
        "404",
        "<a href=\"/\">",
        "<a href=\"javascript:go()\">",
        IssueCode::Unsafe,
        "a javascript: URL",
    );
}

#[test]
fn links() {
    let c = Case::new();
    let i = c.fails(
        "404",
        "<a href=\"/\">",
        "<a href=\"#\">",
        IssueCode::Link,
        "a link to \"#\" goes nowhere",
    );
    assert_eq!(i.rule.as_deref(), Some("fix-03"));
    c.fails(
        "404",
        "<a href=\"/\">",
        "<a href=\"/en/nowhere/\">",
        IssueCode::Link,
        "/en/nowhere/ is not a page of the site",
    );
    let good = c
        .good("404")
        .replacen("<a href=\"/\">", "<a href=\"/de/vernazza/\">", 1);
    assert!(
        c.check("404", &good).is_empty(),
        "a page of the site in any language is a link"
    );
}

#[test]
fn queries_from_the_site_only() {
    let c = Case::new();
    c.fails("front-page", "\"perPage\":6", "\"perPage\":60", IssueCode::Query, "the section query-latest lists latest-stories: it needs a core/query with exactly \"query\":");
    c.fails(
        "front-page",
        "\"sticky\":\"only\"",
        "\"sticky\":\"exclude\"",
        IssueCode::Query,
        "is none the site offers here",
    );
}

#[test]
fn the_designs_rules() {
    let c = Case::new();
    let i = c.fails(
        "404",
        "<p>The page",
        "<p>Rated 4.5/5. The page",
        IssueCode::Rule,
        "the rating 4.5/5 is not on the design's scale: n/10 with 1 decimal(s)",
    );
    assert_eq!(i.rule.as_deref(), Some("fix-01"));
    c.fails(
        "404",
        "<p>The page",
        "<p>★★★★ The page",
        IssueCode::Rule,
        "ratings in stars",
    );
    let i = c.fails(
        "front-page",
        HERO,
        &HERO.replace(
            "Five villages, walked slowly.",
            "Five villages | Cinque Terre Dispatch",
        ),
        IssueCode::Rule,
        "the h1 carries the site's name",
    );
    assert_eq!(i.rule.as_deref(), Some("fix-02"));
    c.fails(
        "front-page",
        "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">The five villages</h2>",
        "<!-- wp:heading {\"level\":1} -->\n<h1 class=\"wp-block-heading\">The five villages</h1>",
        IssueCode::Rule,
        "the template has 2 h1s",
    );
    c.fails(
        "header",
        "{\"isLink\":true,\"level\":0}",
        "{\"isLink\":true}",
        IssueCode::Rule,
        "core/site-title renders the site's name as an h1; give it \"level\":0",
    );
    c.fails(
        "front-page",
        "{\"isLink\":true,\"level\":3}",
        "{\"isLink\":true,\"level\":1}",
        IssueCode::Rule,
        "an h1 inside a query repeats for every entry",
    );
    let i = c.fails(
        "404",
        "<p>The page",
        "<p><img src=\"/a.jpg\" alt=\"\">The page",
        IssueCode::Rule,
        "an <img> without alt text",
    );
    assert_eq!(i.rule.as_deref(), Some("fix-06"));
    c.fails("front-page", "<!-- wp:post-terms {\"fontSize\":\"eyebrow\",\"term\":\"category\"} /-->\n<!-- wp:post-title {\"isLink\":true,\"level\":3} /-->\n<!-- wp:post-excerpt {\"excerptLength\":24} /-->\n<!-- wp:post-date {\"fontSize\":\"meta\"} /-->\n<!-- /wp:post-template -->\n<!-- wp:query-no-results -->\n<!-- wp:paragraph -->\n<p>Nothing here yet.</p>\n<!-- /wp:paragraph -->\n<!-- /wp:query-no-results -->\n</div>\n<!-- /wp:query -->\n</div>\n<!-- /wp:group -->\n<!-- wp:group {\"align\":\"wide\",\"backgroundColor\":\"calce\"", "<!-- wp:post-title {\"isLink\":true,\"level\":3} /-->\n<!-- wp:post-excerpt {\"excerptLength\":24} /-->\n<!-- wp:post-date {\"fontSize\":\"meta\"} /-->\n<!-- /wp:post-template -->\n<!-- wp:query-no-results -->\n<!-- wp:paragraph -->\n<p>Nothing here yet.</p>\n<!-- /wp:paragraph -->\n<!-- /wp:query-no-results -->\n</div>\n<!-- /wp:query -->\n</div>\n<!-- /wp:group -->\n<!-- wp:group {\"align\":\"wide\",\"backgroundColor\":\"calce\"", IssueCode::Rule, "every listed story shows its category");
    c.fails(
        "404",
        "<p>The page",
        "<p>Price: €€€€€. The page",
        IssueCode::Rule,
        "a price of 5 €; prices go from 1 to 4 €",
    );
}

#[test]
fn an_empty_answer_is_missing() {
    let c = Case::new();
    let issues = c.check("index", "  ");
    assert_eq!(issues[0].code, IssueCode::Missing);
    assert_eq!(issues[0].message, "the markup is empty");
}

#[test]
fn the_whole_theme() {
    let c = Case::new();
    let s = sketches(&c.plan);
    // a required template missing
    let mut partial = s.clone();
    partial.remove("template 404");
    let data = assemble(&c.plan, &partial);
    let issues = check_theme(&data, &c.plan);
    assert!(issues
        .iter()
        .any(|i| i.code == IssueCode::Missing && i.message == "the template 404 is missing"));
    assert!(issues
        .iter()
        .any(|i| i.code == IssueCode::Shape && i.message == "has the template 404"));
    // a pair of the global styles below AA
    let mut data = assemble(&c.plan, &s);
    data.global_styles.styles["elements"]["link"]["color"]["text"] = "var:preset|color|mist".into();
    let issues = check_theme(&data, &c.plan);
    assert!(
        issues.iter().any(|i| i.code == IssueCode::Contrast
            && i.message.starts_with("links: \"mist\" on \"paper\" is")),
        "{issues:#?}"
    );
    // an unknown preset in the global styles
    let mut data = assemble(&c.plan, &s);
    data.global_styles.styles["color"]["text"] = "var:preset|color|nope".into();
    assert!(check_theme(&data, &c.plan)
        .iter()
        .any(|i| i.code == IssueCode::Token && i.message.contains("\"nope\"")));
}

#[test]
fn fonts_are_licensed() {
    // The coast journal's own serif is no licensed family.
    let (_, p) = plan_of(&coast(), &coast_site());
    let s = sketches(&p);
    let data = assemble(&p, &s);
    let issues = check_theme(&data, &p);
    let font: Vec<&Issue> = issues
        .iter()
        .filter(|i| i.code == IssueCode::Font)
        .collect();
    assert_eq!(font.len(), 1, "{issues:#?}");
    assert!(font[0]
        .message
        .starts_with("Coast Serif is not among the licensed families (SIL OFL)"));
    assert!(matches!(
        theme_designer::next_step(&issues, 0, 3),
        theme_designer::Step::GiveUp { .. }
    ));
    // the coast's menus resolve by label to the site's pages
    let main: Vec<_> = data
        .navigation
        .iter()
        .filter(|m| m.name == "main")
        .collect();
    assert_eq!(
        main[0]
            .items
            .iter()
            .map(|i| i.url.as_str())
            .collect::<Vec<_>>(),
        ["/en/", "/en/stories/"]
    );
}
