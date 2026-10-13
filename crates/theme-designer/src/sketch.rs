//! The reference rendering of a task: plain, correct block markup from the task's spec and
//! the theme's presets. It is what the fake web designer answers (tests, `?llm=fake`) and
//! the shape the prompt describes; a model's answer is judged by the same checks, never
//! compared with this.

use std::fmt::Write as _;

use serde_json::{json, Map, Value};

use crate::model::{Presets, SectionSpec, TaskKind, TemplateTask};

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

fn void(name: &str, a: Value) -> String {
    let m = a.as_object().cloned().unwrap_or_default();
    format!("<!-- wp:{name}{} /-->\n", attrs(&m))
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

fn size<'a>(p: &Presets, want: &'a str) -> Option<&'a str> {
    p.font_sizes.contains(want).then_some(want)
}

fn paragraph(p: &Presets, text: &str, size_slug: Option<&str>) -> String {
    let mut a = Map::new();
    let mut class = String::new();
    if let Some(s) = size_slug.and_then(|s| size(p, s)) {
        a.insert("fontSize".into(), json!(s));
        class = format!(" class=\"has-{}-font-size\"", crate::styles::wp_kebab(s));
    }
    format!(
        "<!-- wp:paragraph{} -->\n<p{class}>{}</p>\n<!-- /wp:paragraph -->\n",
        attrs(&a),
        esc(text)
    )
}

fn heading(text: &str, level: u8) -> String {
    let a = if level == 2 {
        String::new()
    } else {
        format!(" {{\"level\":{level}}}")
    };
    format!(
        "<!-- wp:heading{a} -->\n<h{level} class=\"wp-block-heading\">{}</h{level}>\n<!-- /wp:heading -->\n",
        esc(text)
    )
}

fn group(p: &Presets, class: &str, background: Option<&str>, inner: &str) -> String {
    let mut a = Map::new();
    let mut classes = vec![
        "wp-block-group".to_string(),
        "alignwide".into(),
        class.to_string(),
    ];
    a.insert("className".into(), json!(class));
    a.insert("align".into(), json!("wide"));
    if let Some(bg) = background.filter(|b| p.colors.contains_key(*b)) {
        a.insert("backgroundColor".into(), json!(bg));
        classes.push(format!(
            "has-{}-background-color",
            crate::styles::wp_kebab(bg)
        ));
        classes.push("has-background".into());
        if let Some(t) = best_text(p, bg) {
            // Links on the band in its text colour (the theme's link colour may not read on it).
            a.insert(
                "style".into(),
                json!({"elements": {"link": {"color": {"text": format!("var:preset|color|{t}")}}}}),
            );
            a.insert("textColor".into(), json!(t));
            classes.push(format!("has-{}-color", crate::styles::wp_kebab(&t)));
            classes.push("has-text-color".into());
        }
    }
    a.insert("layout".into(), json!({"type": "constrained"}));
    format!(
        "<!-- wp:group{} -->\n<div class=\"{}\">\n{inner}</div>\n<!-- /wp:group -->\n",
        attrs(&a),
        classes.join(" ")
    )
}

fn query(p: &Presets, q: &Value, listing: bool) -> String {
    let mut s = String::new();
    let cols = q
        .get("perPage")
        .and_then(Value::as_u64)
        .unwrap_or(3)
        .clamp(1, 3);
    let _ = writeln!(
        s,
        "<!-- wp:query {} -->\n<div class=\"wp-block-query\">",
        json!({"query": q})
    );
    let _ = writeln!(
        s,
        "<!-- wp:post-template {} -->",
        json!({"layout": {"type": "grid", "columnCount": cols}})
    );
    s.push_str(&void(
        "post-featured-image",
        json!({"isLink": true, "aspectRatio": "3/2"}),
    ));
    let mut terms = json!({"term": "category"});
    if size(p, "eyebrow").is_some() {
        terms["fontSize"] = json!("eyebrow");
    }
    s.push_str(&void("post-terms", terms));
    s.push_str(&void("post-title", json!({"level": 3, "isLink": true})));
    s.push_str(&void("post-excerpt", json!({"excerptLength": 24})));
    let mut date = json!({});
    if size(p, "meta").is_some() {
        date["fontSize"] = json!("meta");
    }
    s.push_str(&void("post-date", date));
    s.push_str("<!-- /wp:post-template -->\n");
    if listing {
        s.push_str("<!-- wp:query-pagination -->\n");
        s.push_str(&void("query-pagination-previous", json!({})));
        s.push_str(&void("query-pagination-numbers", json!({})));
        s.push_str(&void("query-pagination-next", json!({})));
        s.push_str("<!-- /wp:query-pagination -->\n");
    }
    s.push_str("<!-- wp:query-no-results -->\n");
    s.push_str(&paragraph(p, "Nothing here yet.", None));
    s.push_str("<!-- /wp:query-no-results -->\n</div>\n<!-- /wp:query -->\n");
    s
}

fn section(task: &TemplateTask, s: &SectionSpec, p: &Presets, h1: &mut bool) -> String {
    let mut inner = String::new();
    if let Some(e) = &s.eyebrow {
        inner.push_str(&paragraph(p, e, Some("eyebrow")));
    }
    let mut level = |inner: &mut String, text: &str| {
        let l = if *h1 { 2 } else { 1 };
        *h1 = true;
        inner.push_str(&heading(text, l));
    };
    match s.kind.as_str() {
        "entry" => {
            if task.slug != "front-page" {
                inner.push_str(&void("post-title", json!({"level": 1})));
                *h1 = true;
            }
            if task.slug == "single" {
                let mut terms = json!({"term": "category"});
                if size(p, "eyebrow").is_some() {
                    terms["fontSize"] = json!("eyebrow");
                }
                inner.push_str(&void("post-terms", terms));
                inner.push_str(&void("post-date", json!({})));
                inner.push_str(&void("post-featured-image", json!({"aspectRatio": "16/9"})));
            }
            inner.push_str(&void(
                "post-content",
                json!({"layout": {"type": "constrained"}}),
            ));
        }
        "query" => {
            if let Some(h) = &s.heading {
                inner.push_str(&heading(h, 2));
            }
            if let Some(q) = &s.query {
                let listing = q.get("inherit") == Some(&Value::Bool(true));
                inner.push_str(&query(p, q, listing));
            }
        }
        _ => match s.what.as_deref() {
            Some("page-header") if task.slug == "archive" => {
                inner.push_str(&void("query-title", json!({"type": "archive", "level": 1})));
                inner.push_str(&void("term-description", json!({})));
                *h1 = true;
            }
            Some("page-header") => level(&mut inner, &task.title),
            Some("not-found") => {
                level(&mut inner, "Page not found");
                inner.push_str(&paragraph(
                    p,
                    "The page you were looking for is not here. Search the site or go back to the start.",
                    None,
                ));
                inner.push_str(&void(
                    "search",
                    json!({"label": "Search", "showLabel": false, "buttonText": "Search"}),
                ));
                inner.push_str(
                    "<!-- wp:paragraph -->\n<p><a href=\"/\">Back to the front page</a></p>\n<!-- /wp:paragraph -->\n",
                );
            }
            Some("image") => {
                inner.push_str(&void("spacer", json!({"height": "320px"})));
            }
            _ => {
                if let Some(h) = &s.heading {
                    level(&mut inner, h);
                } else if let Some(n) = s.notes.as_deref().or(s.what.as_deref()) {
                    let first = n.split(['.', ':']).next().unwrap_or(n);
                    inner.push_str(&paragraph(p, first, Some("meta")));
                }
            }
        },
    }
    group(p, &s.class, s.background.as_deref(), &inner)
}

/// The reference markup of `task` (module docs).
pub fn template(task: &TemplateTask, p: &Presets) -> String {
    let mut s = String::new();
    match task.kind {
        TaskKind::Part => {
            let mut inner = String::new();
            inner.push_str(&void("site-title", json!({"level": 0, "isLink": true})));
            if task.slug == "footer" {
                inner.push_str(&void("site-tagline", json!({})));
            }
            for m in &task.menus {
                inner.push_str(&void(
                    "navigation",
                    json!({"className": m.class, "overlayMenu": "mobile", "ariaLabel": m.label}),
                ));
            }
            let layout = if task.slug == "header" {
                json!({"type": "flex", "justifyContent": "space-between", "flexWrap": "wrap"})
            } else {
                json!({"type": "constrained"})
            };
            let a = json!({"className": format!("sp-{}", task.slug), "align": "wide", "layout": layout});
            let _ = write!(
                s,
                "<!-- wp:group {a} -->\n<div class=\"wp-block-group alignwide sp-{}\">\n{inner}</div>\n<!-- /wp:group -->\n",
                task.slug
            );
        }
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
                main.push_str(&section(task, sec, p, &mut h1));
            }
            let _ = write!(
                s,
                "<!-- wp:group {} -->\n<main class=\"wp-block-group\">\n{main}</main>\n<!-- /wp:group -->\n",
                json!({"tagName": "main", "layout": {"type": "constrained"}})
            );
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
