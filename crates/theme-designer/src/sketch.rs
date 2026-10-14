//! The reference rendering of a task: correct block markup from the task's spec, laid out in the
//! theme's component vocabulary ([`crate::components`]) by each section's shape. It is what the
//! fake web designer answers (tests, `?llm=fake`) and the draft a model's call starts from (the
//! prompt carries it); a model's answer is judged by the same checks and the visual comparison,
//! never by its likeness to this.
//!
//! Copy comes from the task: the design's headings and eyebrows, and from the section's design
//! markup its lede, its list items and the italic word of its headline. Links to the site's pages
//! are one-item menus per language (the section's `links`), entries' fields are block bindings.

use std::fmt::Write as _;

use serde_json::{json, Map, Value};
use site_design::dom::{self, El};

use crate::model::{MenuSpec, Presets, SectionSpec, TaskKind, TemplateTask};
use crate::styles::wp_kebab;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn attrs(m: &Map<String, Value>) -> String {
    if m.is_empty() {
        String::new()
    } else {
        format!(" {}", Value::Object(m.clone()))
    }
}

fn obj(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap_or_default()
}

fn void(name: &str, a: Value) -> String {
    format!("<!-- wp:{name}{} /-->\n", attrs(&obj(a)))
}

/// The palette colour that reads best on `bg`.
pub fn best_text(p: &Presets, bg: &str) -> Option<String> {
    let gh = p.colors.get(bg)?;
    p.colors
        .iter()
        .filter(|(k, _)| k.as_str() != bg)
        .max_by_key(|(_, h)| site_design::contrast_x100(h, gh).unwrap_or(0))
        .map(|(k, _)| k.clone())
}

fn class_attr(class: &str) -> String {
    if class.is_empty() {
        String::new()
    } else {
        format!(" class=\"{}\"", esc(class))
    }
}

/// A paragraph with `class` and inline HTML (already escaped).
fn para(class: &str, html: &str) -> String {
    let mut a = Map::new();
    if !class.is_empty() {
        a.insert("className".into(), json!(class));
    }
    format!(
        "<!-- wp:paragraph{} -->\n<p{}>{html}</p>\n<!-- /wp:paragraph -->\n",
        attrs(&a),
        class_attr(class)
    )
}

/// A paragraph showing an entry's field.
fn field(class: &str, key: &str) -> String {
    let mut a = obj(
        json!({"metadata": {"bindings": {"content": {"source": "core/post-meta", "args": {"key": key}}}}}),
    );
    if !class.is_empty() {
        a.insert("className".into(), json!(class));
    }
    format!(
        "<!-- wp:paragraph{} -->\n<p{}></p>\n<!-- /wp:paragraph -->\n",
        attrs(&a),
        class_attr(class)
    )
}

/// An image showing an entry's picture field (`image`, with `image_alt`).
fn field_image() -> String {
    format!(
        "<!-- wp:image {} -->\n<figure class=\"wp-block-image\"><img alt=\"\"/></figure>\n<!-- /wp:image -->\n",
        json!({"metadata": {"bindings": {
            "url": {"source": "core/post-meta", "args": {"key": "image"}},
            "alt": {"source": "core/post-meta", "args": {"key": "image_alt"}}
        }}})
    )
}

fn heading(level: u8, class: &str, html: &str) -> String {
    let mut a = Map::new();
    if level != 2 {
        a.insert("level".into(), json!(level));
    }
    if !class.is_empty() {
        a.insert("className".into(), json!(class));
    }
    let cls = if class.is_empty() {
        "wp-block-heading".to_string()
    } else {
        format!("wp-block-heading {class}")
    };
    format!(
        "<!-- wp:heading{} -->\n<h{level} class=\"{}\">{html}</h{level}>\n<!-- /wp:heading -->\n",
        attrs(&a),
        esc(&cls)
    )
}

/// A group (`div`, or `tag`) with classes and optional colours.
fn group_full(
    p: &Presets,
    tag: &str,
    class: &str,
    background: Option<&str>,
    inner: &str,
) -> String {
    let mut a = Map::new();
    if tag != "div" {
        a.insert("tagName".into(), json!(tag));
    }
    let mut classes = vec!["wp-block-group".to_string()];
    if !class.is_empty() {
        a.insert("className".into(), json!(class));
        classes.push(class.to_string());
    }
    if let Some(bg) = background.filter(|b| p.colors.contains_key(*b)) {
        a.insert("backgroundColor".into(), json!(bg));
        classes.push(format!("has-{}-background-color", wp_kebab(bg)));
        classes.push("has-background".into());
        if let Some(t) = best_text(p, bg) {
            a.insert(
                "style".into(),
                json!({"elements": {"link": {"color": {"text": format!("var:preset|color|{t}")}}}}),
            );
            a.insert("textColor".into(), json!(t));
            classes.push(format!("has-{}-color", wp_kebab(&t)));
            classes.push("has-text-color".into());
            classes.push("has-link-color".into());
        }
    }
    format!(
        "<!-- wp:group{} -->\n<{tag} class=\"{}\">\n{inner}</{tag}>\n<!-- /wp:group -->\n",
        attrs(&a),
        esc(&classes.join(" "))
    )
}

fn group(class: &str, inner: &str) -> String {
    group_full(&Presets::default(), "div", class, None, inner)
}

/// A link menu (one item per language) as a navigation block with `extra` classes (and the
/// markers of the components it is).
fn nav(m: &MenuSpec, extra: &str) -> String {
    let marks: Vec<String> = m
        .components
        .iter()
        .map(|c| crate::catalog::marker(c))
        .collect();
    void(
        "navigation",
        json!({"className": format!("{} {extra} {}", m.class, marks.join(" ")).split_whitespace().collect::<Vec<_>>().join(" "), "overlayMenu": "never", "ariaLabel": m.label}),
    )
}

/// The design markup's first element matching `f`.
fn find<'a>(doc: &'a El, f: &dyn Fn(&El) -> bool) -> Option<&'a El> {
    doc.find(f)
}

fn parse(html: Option<&str>) -> El {
    dom::parse(&format!("<body>{}</body>", html.unwrap_or("")))
}

/// A headline's text with its `<em>` kept and its lines: a headline set as one element per line
/// (the design's line-by-line reveal) keeps its line breaks.
fn headline_html(e: &El) -> String {
    let lines: Vec<&El> = e.elements().collect();
    let text_children = e
        .children
        .iter()
        .any(|c| matches!(c, dom::Node::Text(t) if !t.trim().is_empty()));
    if lines.len() >= 2 && !text_children && lines.iter().all(|l| l.tag == "span" || l.tag == "div")
    {
        return lines
            .iter()
            .map(|l| text_with_em(l))
            .collect::<Vec<_>>()
            .join("<br>");
    }
    text_with_em(e)
}

/// The design markup's label before its heading: a mono or uppercase line (an eyebrow).
fn eyebrow_in(doc: &El) -> Option<String> {
    doc.find(&|e| {
        let class = e.attr("class").unwrap_or("");
        let style = e.attr("style").unwrap_or("");
        (class.split_whitespace().any(|c| c == "mono")
            || style.contains("text-transform:uppercase"))
            && e.elements().count() == 0
            && !e.text().trim().is_empty()
            && e.text().chars().count() <= 80
    })
    .map(|e| e.text().trim().to_string())
}

/// An element's text with its `<em>` kept (a headline's italic word).
fn text_with_em(e: &El) -> String {
    let mut out = String::new();
    fn walk(e: &El, out: &mut String) {
        for c in &e.children {
            match c {
                dom::Node::Text(t) => out.push_str(&esc(t)),
                dom::Node::El(x) if x.tag == "em" || x.tag == "i" => {
                    let _ = write!(out, "<em>{}</em>", esc(x.text().trim()));
                }
                dom::Node::El(x) if x.tag == "br" => out.push(' '),
                dom::Node::El(x) => {
                    out.push(' ');
                    walk(x, out);
                }
            }
        }
    }
    walk(e, &mut out);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn eyebrow(s: &SectionSpec) -> String {
    s.eyebrow
        .as_deref()
        .map(|e| para("ds-eyebrow", &esc(e)))
        .unwrap_or_default()
}

/// A section's head row: eyebrow and heading left, its first link right.
fn head(s: &SectionSpec, right: &str) -> String {
    let mut left = eyebrow(s);
    if let Some(h) = &s.heading {
        left.push_str(&heading(2, "", &esc(h)));
    }
    let mut inner = group("ds-stack", &left);
    inner.push_str(right);
    group("ds-head", &inner)
}

fn query_block(s: &SectionSpec, class: &str, template: &str) -> String {
    let q = s.query.clone().unwrap_or(json!({"inherit": true}));
    let inherit = q.get("inherit") == Some(&json!(true));
    let mut a = obj(json!({"query": q}));
    a.insert("className".into(), json!(class));
    // A list of its own (an archive, the search's results) has pages, and says when it is empty.
    let mut after = String::new();
    if inherit {
        after.push_str(
            "<!-- wp:query-pagination {\"className\":\"ds-pager\"} -->\n<!-- wp:query-pagination-previous /-->\n<!-- wp:query-pagination-numbers /-->\n<!-- wp:query-pagination-next /-->\n<!-- /wp:query-pagination -->\n",
        );
        after.push_str(&format!(
            "<!-- wp:query-no-results -->\n{}<!-- /wp:query-no-results -->\n",
            para(
                "ds-empty",
                "Nothing here yet. Try the search, or start from the front page."
            )
        ));
    }
    format!(
        "<!-- wp:query{} -->\n<div class=\"wp-block-query {}\">\n<!-- wp:post-template -->\n{template}<!-- /wp:post-template -->\n{after}</div>\n<!-- /wp:query -->\n",
        attrs(&a),
        esc(class)
    )
}

/// An essentials ticker the static export fills (a place's sea, air and sunset, live): its head and
/// three values held empty in the template, never written in.
fn ticker(e: &crate::model::EssentialsSpec) -> String {
    let mut head = String::new();
    if let Some(l) = &e.label {
        head.push_str(&para("", &esc(l)));
    }
    let mut inner = group("ds-ticker-head", &head);
    let mut values = String::new();
    for k in ["sea", "air", "sunset"] {
        values.push_str(&group(
            &format!("ds-ticker-value ds-ticker-{k}"),
            &para("ds-count", "–"),
        ));
    }
    inner.push_str(&group("ds-ticker-values", &values));
    group(
        &format!(
            "ds-ticker sp-essentials sp-place-{} {}",
            e.place,
            crate::catalog::marker(&e.component)
        ),
        &inner,
    )
}

fn has(s: &SectionSpec, f: &str) -> bool {
    s.fields.iter().any(|x| x == f)
}

/// The entry's picture frame: the bound picture when the entries have one, a chip with `chip`.
fn card_img(s: &SectionSpec, chip: Option<&str>) -> String {
    let mut inner = String::new();
    if has(s, "image") {
        inner.push_str(&field_image());
    }
    if let Some(k) = chip.filter(|k| has(s, k)) {
        inner.push_str(&field("ds-chip", k));
    }
    group("ds-card-img", &inner)
}

fn section_markup(task: &TemplateTask, s: &SectionSpec, p: &Presets, h1: &mut bool) -> String {
    let doc = parse(s.html.as_deref());
    let shape = s.shape.as_deref().unwrap_or("prose");
    // A section head's right side: its link, else the design's line beside the heading.
    let first_link = s
        .links
        .first()
        .map(|m| nav(m, "ds-more"))
        .or_else(|| {
            find(&doc, &|e| {
                e.tag == "p" && e.text().split_whitespace().count() >= 6 && e.text().len() <= 200
            })
            .map(|e| para("", &esc(e.text().trim())))
        })
        .unwrap_or_default();
    let markers: Vec<String> = s
        .components
        .iter()
        .map(|c| crate::catalog::marker(c))
        .collect();
    let outer = |extra: &str| {
        format!("{} {extra} {}", s.class, markers.join(" "))
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    match (s.kind.as_str(), shape) {
        ("entry", _) => {
            let mut inner = String::new();
            let mut headpart = String::new();
            if task.slug == "single" {
                headpart.push_str(&void(
                    "post-terms",
                    json!({"term": "category", "className": "ds-eyebrow"}),
                ));
            }
            if task.slug != "front-page" {
                headpart.push_str(&void("post-title", json!({"level": 1})));
                *h1 = true;
            }
            if task.slug == "single" {
                headpart.push_str(&void("post-excerpt", json!({"className": "ds-lede"})));
                headpart.push_str(&void("post-date", json!({"className": "ds-meta"})));
            }
            if !headpart.is_empty() {
                inner.push_str(&group("ds-page-head", &headpart));
            }
            inner.push_str(&void(
                "post-content",
                json!({"className": "ds-prose", "layout": {"type": "default"}}),
            ));
            group_full(p, "section", &outer("ds-wrap"), None, &inner)
        }
        ("title", _) => {
            let post = task.template_kind == Some(site_design::model::TemplateKind::Single);
            let mut inner = void(
                "breadcrumbs",
                json!({"showHomeItem": true, "showCurrentItem": true, "className": "ds-crumbs"}),
            );
            inner.push_str(&eyebrow(s));
            if post {
                inner.push_str(&void(
                    "post-terms",
                    json!({"term": "category", "className": "ds-eyebrow"}),
                ));
            }
            inner.push_str(&void("post-title", json!({"level": 1})));
            *h1 = true;
            if post {
                // The lede; the story's byline and dateline are its content's (`ct-byline`).
                inner.push_str(&void("post-excerpt", json!({"className": "ds-lede"})));
            }
            group_full(p, "section", &outer("ds-wrap ds-page-head"), None, &inner)
        }
        ("content", "article") => {
            let mut inner = group("ds-progress", "");
            inner.push_str(&void(
                "post-content",
                json!({"className": "ds-prose-article", "layout": {"type": "default"}}),
            ));
            group_full(
                p,
                "section",
                &outer("ds-wrap ds-article ds-section"),
                None,
                &inner,
            )
        }
        ("content", "prose-wide") => group_full(
            p,
            "section",
            &outer("ds-wrap ds-section"),
            None,
            &void(
                "post-content",
                json!({"className": "ds-prose-wide", "layout": {"type": "default"}}),
            ),
        ),
        ("content", _) => group_full(
            p,
            "section",
            &outer("ds-wrap ds-section"),
            None,
            &void(
                "post-content",
                json!({"className": "ds-prose", "layout": {"type": "default"}}),
            ),
        ),
        (_, "hero") => {
            let mut main = eyebrow(s);
            let h = find(&doc, &|e| e.tag == "h1")
                .map(headline_html)
                .or_else(|| s.heading.as_deref().map(esc))
                .unwrap_or_default();
            main.push_str(&heading(if *h1 { 2 } else { 1 }, "", &h));
            *h1 = true;
            if let Some(lede) = find(&doc, &|e| {
                e.tag == "p" && e.text().split_whitespace().count() > 6
            }) {
                main.push_str(&para("ds-lede", &esc(lede.text().trim())));
            }
            let mut buttons = String::new();
            for (i, m) in s.links.iter().enumerate() {
                buttons.push_str(&nav(
                    m,
                    if i == 0 {
                        "ds-btn-primary"
                    } else {
                        "ds-btn-secondary"
                    },
                ));
            }
            if !buttons.is_empty() {
                main.push_str(&group("ds-buttons", &buttons));
            }
            let mut row = group("ds-hero-main", &main);
            if let Some(e) = &s.essentials {
                row.push_str(&group("ds-hero-aside", &ticker(e)));
            }
            group_full(p, "section", &outer("ds-wrap ds-hero"), None, &row)
        }
        (_, "image-band") => {
            let mut inner = String::new();
            if let Some(img) = &s.image {
                inner.push_str(&format!(
                    "<!-- wp:image {} -->\n<figure class=\"wp-block-image size-full\"><img src=\"{}\" alt=\"{}\"/></figure>\n<!-- /wp:image -->\n",
                    json!({"sizeSlug": "full"}),
                    esc(&img.url),
                    esc(&img.alt)
                ));
                inner.push_str(&para("ds-meta", &esc(&img.alt)));
            }
            group_full(p, "section", &outer("ds-bleed ds-section"), None, &inner)
        }
        (_, "tiles") => {
            let mut tile = String::new();
            if has(s, "image") {
                tile.push_str(&field_image());
            }
            if has(s, "number") {
                tile.push_str(&field("ds-numeral", "number"));
            }
            let mut item = group("ds-tile", &tile);
            item.push_str(&void("post-title", json!({"level": 3, "isLink": true})));
            let mut inner = head(s, &first_link);
            inner.push_str(&query_block(s, "ds-tiles", &item));
            group_full(p, "section", &outer("ds-wrap ds-section"), None, &inner)
        }
        (_, "feature") => {
            let mut text = void(
                "post-terms",
                json!({"term": "category", "className": "ds-eyebrow"}),
            );
            text.push_str(&void("post-title", json!({"level": 3, "isLink": true})));
            text.push_str(&void("post-excerpt", json!({"excerptLength": 20})));
            let mut item = card_img(s, None);
            item.push_str(&group("ds-stack", &text));
            let mut inner = head(s, &first_link);
            inner.push_str(&query_block(s, "ds-feature", &item));
            group_full(p, "section", &outer("ds-wrap ds-section"), None, &inner)
        }
        (_, "cards") => {
            let mut text = void("post-title", json!({"level": 3, "isLink": true}));
            if has(s, "price") {
                let mut price = field("ds-meta", "price");
                if has(s, "price_unit") {
                    price.push_str(&field("ds-meta", "price_unit"));
                }
                text.push_str(&group("ds-price-line", &price));
            }
            let mut foot = group("ds-stack", &text);
            if has(s, "rating") {
                let mut r = field("ds-stat", "rating");
                if has(s, "rating_scale") {
                    r.push_str(&field("ds-meta", "rating_scale"));
                }
                foot.push_str(&group("ds-rating", &r));
            }
            let mut item = card_img(s, Some("village"));
            item.push_str(&group("ds-card-foot", &foot));
            let mut inner = head(s, &first_link);
            inner.push_str(&query_block(s, "ds-cards", &item));
            let wrap = group("ds-wrap", &inner);
            group_full(
                p,
                "section",
                &outer("ds-band"),
                s.background.as_deref(),
                &wrap,
            )
        }
        (_, "rows") => {
            let mut item = void(
                "post-date",
                json!({"className": "ds-meta", "format": "j M Y"}),
            );
            item.push_str(&void("post-title", json!({"level": 3, "isLink": true})));
            item.push_str(&void("post-terms", json!({"term": "category"})));
            let mut inner = head(s, &first_link);
            inner.push_str(&query_block(s, "ds-rows", &item));
            group_full(p, "section", &outer("ds-wrap ds-section"), None, &inner)
        }
        (_, "band") => {
            let mut main = eyebrow(s);
            if main.is_empty() {
                if let Some(e) = eyebrow_in(&doc) {
                    main.push_str(&para("ds-eyebrow", &esc(&e)));
                }
            }
            let h = find(&doc, &|e| e.tag == "h2" || e.tag == "h1")
                .map(text_with_em)
                .or_else(|| s.heading.as_deref().map(esc))
                .unwrap_or_default();
            main.push_str(&heading(2, "", &h));
            if let Some(par) = find(&doc, &|e| {
                e.tag == "p" && e.text().split_whitespace().count() > 6
            }) {
                main.push_str(&para("", &esc(par.text().trim())));
            }
            if let Some(m) = s.links.first() {
                main.push_str(&nav(m, "ds-btn-light"));
            }
            let mut row = group("ds-band-main", &main);
            if let Some(list) = find(&doc, &|e| e.tag == "ol" || e.tag == "ul") {
                let mut items = String::new();
                for li in list.elements().filter(|e| e.tag == "li") {
                    let title = li
                        .find(&|e| e.tag == "strong" || e.tag == "b")
                        .map(|e| e.text().trim().to_string())
                        .unwrap_or_default();
                    let meta = li
                        .find(&|e| e.attr("class").is_some_and(|c| c.contains("mono")))
                        .map(|e| e.text().trim().to_string())
                        .unwrap_or_default();
                    if title.is_empty() {
                        continue;
                    }
                    let _ = write!(
                        items,
                        "<!-- wp:list-item -->\n<li><strong>{}</strong><br><span class=\"ds-meta\">{}</span></li>\n<!-- /wp:list-item -->\n",
                        esc(&title),
                        esc(&meta)
                    );
                }
                if !items.is_empty() {
                    let _ = write!(
                        row,
                        "<!-- wp:list {} -->\n<ol class=\"wp-block-list ds-ledger\">\n{items}</ol>\n<!-- /wp:list -->\n",
                        json!({"ordered": true, "className": "ds-ledger"})
                    );
                }
            }
            let wrap = group("ds-wrap ds-band-row", &row);
            group_full(
                p,
                "section",
                &outer("ds-band ds-dark"),
                s.background.as_deref(),
                &wrap,
            )
        }
        (_, "bar") => {
            let mut inner = String::new();
            inner.push_str(&void(
                "post-title",
                json!({"level": 2, "className": "ds-meta", "isLink": false}),
            ));
            for m in &s.links {
                inner.push_str(&nav(m, "ds-chips"));
            }
            group_full(p, "section", &outer("ds-wrap ds-bar"), None, &inner)
        }
        (_, "entries") => {
            let mut item = card_img(s, Some("label"));
            item.push_str(&void("post-title", json!({"level": 3, "isLink": true})));
            if has(s, "line") {
                item.push_str(&field("ds-line", "line"));
            }
            let mut facts = String::new();
            for (k, l) in [
                ("duration", "time_label"),
                ("cost", "cost_label"),
                ("best", "best_label"),
            ] {
                if has(s, k) {
                    let mut cell = if has(s, l) {
                        field("ds-label", l)
                    } else {
                        String::new()
                    };
                    cell.push_str(&field("", k));
                    facts.push_str(&group("", &cell));
                }
            }
            if !facts.is_empty() {
                item.push_str(&group("ds-facts", &facts));
            }
            let inner = query_block(s, "ds-entries", &item);
            group_full(p, "section", &outer("ds-wrap"), None, &inner)
        }
        (_, "restaurants") => {
            let mut left = String::new();
            if has(s, "cuisine") {
                left.push_str(&field("ds-eyebrow", "cuisine"));
            }
            left.push_str(&void("post-title", json!({"level": 3, "isLink": true})));
            if has(s, "line") {
                left.push_str(&field("ds-line", "line"));
            }
            let mut head = group("ds-stack", &left);
            if has(s, "price") {
                let mut price = field("", "price");
                if has(s, "price_rest") {
                    price.push_str(&field("ds-price-rest", "price_rest"));
                }
                head.push_str(&group("ds-price", &price));
            }
            let mut text = group("ds-restaurant-head", &head);
            text.push_str(&void("post-excerpt", json!({"excerptLength": 40})));
            if has(s, "rating") {
                let mut r = field("ds-stat", "rating");
                if has(s, "rating_scale") {
                    r.push_str(&field("ds-meta", "rating_scale"));
                }
                text.push_str(&group("ds-rating-row", &r));
            }
            let mut know = String::new();
            for (k, l) in [("book", "book_label"), ("closed", "closed_label")] {
                if has(s, k) {
                    let mut cell = if has(s, l) {
                        field("ds-label", l)
                    } else {
                        String::new()
                    };
                    cell.push_str(&field("", k));
                    know.push_str(&group("", &cell));
                }
            }
            if !know.is_empty() {
                text.push_str(&group("ds-know", &know));
            }
            let mut item = card_img(s, Some("village"));
            item.push_str(&group("ds-restaurant-text", &text));
            let inner = query_block(s, "ds-restaurants", &item);
            group_full(p, "section", &outer("ds-wrap"), None, &inner)
        }
        (_, "people") => {
            let mut item = card_img(s, None);
            if has(s, "line") {
                item.push_str(&field("ds-line", "line"));
            }
            item.push_str(&void("post-title", json!({"level": 3})));
            if has(s, "role") {
                item.push_str(&field("ds-eyebrow", "role"));
            }
            if has(s, "bio") {
                item.push_str(&field("", "bio"));
            }
            let inner = query_block(s, "ds-people", &item);
            group_full(p, "section", &outer("ds-wrap"), None, &inner)
        }
        _ => match s.what.as_deref() {
            Some("page-header") if task.slug == "archive" || task.slug == "index" => {
                let mut inner = void("query-title", json!({"type": "archive", "level": 1}));
                inner.push_str(&void("term-description", json!({})));
                *h1 = true;
                group_full(p, "section", &outer("ds-wrap ds-page-head"), None, &inner)
            }
            Some("not-found") => {
                let mut inner = para("ds-eyebrow", "404");
                inner.push_str(&heading(1, "", "Page not found"));
                *h1 = true;
                inner.push_str(&para(
                    "ds-lede",
                    "The page you were looking for is not here: it may have moved or never existed. Search the site or go back to the start.",
                ));
                inner.push_str(&void(
                    "search",
                    json!({"label": "Search", "showLabel": false, "buttonText": "Search"}),
                ));
                inner.push_str(&para("ds-more", "<a href=\"/\">Back to the front page</a>"));
                group_full(
                    p,
                    "section",
                    &outer("ds-wrap ds-page-head ds-empty"),
                    None,
                    &inner,
                )
            }
            Some("search-header") => {
                let mut inner = void("query-title", json!({"type": "search", "level": 1}));
                *h1 = true;
                inner.push_str(&void(
                    "search",
                    json!({"label": "Search", "showLabel": false, "buttonText": "Search"}),
                ));
                group_full(p, "section", &outer("ds-wrap ds-page-head"), None, &inner)
            }
            _ => {
                let mut inner = eyebrow(s);
                if let Some(h) = &s.heading {
                    let l = if *h1 { 2 } else { 1 };
                    *h1 = true;
                    inner.push_str(&heading(l, "", &esc(h)));
                } else if let Some(n) = s.notes.as_deref().or(s.what.as_deref()) {
                    let first = n.split(['.', ':']).next().unwrap_or(n);
                    inner.push_str(&para("ds-meta", &esc(first)));
                }
                if s.query.is_some() {
                    let mut item = void("post-title", json!({"level": 3, "isLink": true}));
                    item.push_str(&void("post-excerpt", json!({})));
                    inner.push_str(&query_block(s, "ds-rows", &item));
                }
                group_full(
                    p,
                    "section",
                    &outer("ds-wrap ds-section"),
                    s.background.as_deref(),
                    &inner,
                )
            }
        },
    }
}

fn part_markup(task: &TemplateTask, p: &Presets) -> String {
    let doc = parse(task.html.as_deref());
    // The wordmark: the design's brand link, its last word in italics.
    let brand = find(&doc, &|e| {
        e.tag == "a" && e.elements().filter(|x| x.tag == "span").count() >= 2
    })
    .map(|a| {
        let spans: Vec<String> = a
            .elements()
            .filter(|x| x.tag == "span")
            .map(|x| x.text().trim().to_string())
            .collect();
        let (last, rest) = spans
            .split_last()
            .map_or((String::new(), Vec::new()), |(l, r)| {
                (l.clone(), r.to_vec())
            });
        format!("{} <em>{}</em>", esc(&rest.join(" ")), esc(&last))
    });
    let wordmark = |extra: &str| {
        let html = brand.clone().unwrap_or_else(|| "Home".into());
        para(
            format!("ds-wordmark {extra}").trim(),
            &format!("<a href=\"/\">{html}</a>"),
        )
    };
    let menus: Vec<&MenuSpec> = task.menus.iter().collect();
    let link_menus: Vec<&&MenuSpec> = menus
        .iter()
        .filter(|m| m.name.starts_with("link-"))
        .collect();
    let site_menus: Vec<&&MenuSpec> = menus
        .iter()
        .filter(|m| !m.name.starts_with("link-"))
        .collect();
    // The part's own components on its outer group; the menus' on their navigation blocks.
    let own: String = task
        .components
        .iter()
        .map(|c| crate::catalog::marker(c))
        .collect::<Vec<_>>()
        .join(" ");
    if task.slug == "header" {
        let mut row = match &task.brand {
            Some(b) => void(
                "navigation",
                json!({"className": format!("sp-menu-{b} ds-wordmark"), "overlayMenu": "never", "ariaLabel": "Home"}),
            ),
            None => wordmark(""),
        };
        let mut end = String::new();
        let mut main_done = false;
        for m in &site_menus {
            if m.name == "languages" {
                end.push_str(&void(
                    "navigation",
                    json!({"className": format!("{} ds-lang", m.class), "overlayMenu": "never", "ariaLabel": m.label}),
                ));
            } else if !main_done {
                main_done = true;
                let marks: String = m
                    .components
                    .iter()
                    .map(|c| crate::catalog::marker(c))
                    .collect::<Vec<_>>()
                    .join(" ");
                row.push_str(&void(
                    "navigation",
                    json!({"className": format!("{} ds-nav-dots {marks}", m.class).trim(), "overlayMenu": "mobile", "openSubmenusOnClick": false, "showSubmenuIcon": true, "ariaLabel": m.label}),
                ));
            } else {
                row.push_str(&void(
                    "navigation",
                    json!({"className": format!("{} ds-nav-dots", m.class), "overlayMenu": "never", "ariaLabel": m.label}),
                ));
            }
        }
        if let Some(search) = &task.search {
            end.push_str(&void(
                "search",
                json!({"label": "Search", "showLabel": false, "buttonPosition": "button-only", "buttonUseIcon": true, "className": format!("ds-search {}", crate::catalog::marker(search))}),
            ));
        }
        for m in &link_menus {
            end.push_str(&nav(m, "ds-btn-primary"));
        }
        if !end.is_empty() {
            row.push_str(&group("ds-masthead-end", &end));
        }
        let inner = group("ds-wrap ds-masthead-row", &row);
        let outer = format!("sp-header ds-masthead {own}");
        return group_full(p, "div", outer.trim(), None, &inner);
    }
    // The footer: brand and line, a column per menu, the colophon.
    let mut brand_col = wordmark("");
    brand_col.push_str(&void("site-tagline", json!({})));
    let mut cols = group("ds-footer-brand", &brand_col);
    for m in &site_menus {
        if m.name == "languages" {
            continue;
        }
        let mut col = para("ds-eyebrow", &esc(&m.label));
        col.push_str(&void(
            "navigation",
            json!({"className": m.class, "overlayMenu": "never", "orientation": "vertical", "ariaLabel": m.label}),
        ));
        cols.push_str(&group("ds-footer-col", &col));
    }
    let colophon_texts: Vec<String> = find(&doc, &|e| {
        e.attr("style").is_some_and(|s| s.contains("border-top"))
            && e.elements().count() >= 2
            && e.elements().all(|x| x.tag == "span")
    })
    .map(|e| e.elements().map(|x| x.text().trim().to_string()).collect())
    .unwrap_or_default();
    let mut colophon = String::new();
    for t in &colophon_texts {
        colophon.push_str(&para("", &esc(t)));
    }
    let mut inner = group("ds-footer-cols", &cols);
    if !colophon.is_empty() {
        inner.push_str(&group("ds-colophon", &colophon));
    }
    let wrap = group("ds-wrap ds-footer-inner", &inner);
    let outer = format!("sp-footer ds-footer {own}");
    group_full(p, "div", outer.trim(), None, &wrap)
}

/// The reference markup of `task` (module docs).
pub fn template(task: &TemplateTask, p: &Presets) -> String {
    let mut s = String::new();
    match task.kind {
        TaskKind::Part => s.push_str(&part_markup(task, p)),
        TaskKind::Template => {
            for part in task.parts.iter().filter(|x| *x == "header") {
                s.push_str(&void(
                    "template-part",
                    json!({"slug": part, "tagName": "header"}),
                ));
            }
            let mut h1 = false;
            let mut main = String::new();
            for sec in &task.sections {
                main.push_str(&section_markup(task, sec, p, &mut h1));
            }
            if task.classes.is_empty() {
                let _ = write!(
                    s,
                    "<!-- wp:group {} -->\n<main class=\"wp-block-group\">\n{main}</main>\n<!-- /wp:group -->\n",
                    json!({"tagName": "main"})
                );
            } else {
                let c = task.classes.join(" ");
                let _ = write!(
                    s,
                    "<!-- wp:group {} -->\n<main class=\"wp-block-group {}\">\n{main}</main>\n<!-- /wp:group -->\n",
                    json!({"tagName": "main", "className": c}),
                    esc(&c)
                );
            }
            for part in task.parts.iter().filter(|x| *x != "header") {
                s.push_str(&void(
                    "template-part",
                    json!({"slug": part, "tagName": "footer"}),
                ));
            }
        }
    }
    s
}
