//! A small owned HTML tree.
//!
//! Pages are parsed with html5ever (the browser's algorithm: implied tags,
//! misnested markup) and converted at once into [`El`], which the rest of the
//! crate reads. The conversion drops what never matters to a design and must
//! never run: `<script>` elements other than data islands, comments, `on*`
//! attributes and `javascript:` URLs. Imported files are untrusted data:
//! nothing is fetched, nothing executes.

use std::fmt::Write as _;

use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};

/// A node: an element or a run of text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Node {
    El(El),
    Text(String),
}

/// An element: lower-case tag, attributes in source order, children.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct El {
    pub tag: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

/// Script types that are data, not code: kept as text so their data can be read.
const DATA_SCRIPTS: [&str; 6] = [
    "text/x-dc",
    "__bundler/manifest",
    "__bundler/template",
    "__bundler/page_order",
    "__bundler/ext_resources",
    "application/json",
];

/// Parses a whole document; the result is the `<html>` element.
pub fn parse(html: &str) -> El {
    let dom = html5ever::parse_document(RcDom::default(), Default::default()).one(html);
    let mut root = El {
        tag: "#document".into(),
        ..El::default()
    };
    for c in dom.document.children.borrow().iter() {
        if let Some(n) = convert(c) {
            root.children.push(n);
        }
    }
    root.children
        .into_iter()
        .find_map(|n| match n {
            Node::El(e) if e.tag == "html" => Some(e),
            _ => None,
        })
        .unwrap_or_default()
}

fn convert(h: &Handle) -> Option<Node> {
    match &h.data {
        NodeData::Text { contents } => Some(Node::Text(contents.borrow().to_string())),
        NodeData::Element { name, attrs, .. } => {
            let tag = name.local.to_string().to_ascii_lowercase();
            let attrs: Vec<(String, String)> = attrs
                .borrow()
                .iter()
                .map(|a| {
                    (
                        a.name.local.to_string().to_ascii_lowercase(),
                        a.value.to_string(),
                    )
                })
                .filter(|(k, v)| {
                    !k.starts_with("on")
                        && !((k == "href" || k == "src" || k == "action")
                            && v.trim_start()
                                .to_ascii_lowercase()
                                .starts_with("javascript:"))
                })
                .collect();
            if tag == "script" {
                let ty = attrs
                    .iter()
                    .find(|(k, _)| k == "type")
                    .map(|(_, v)| v.trim().to_ascii_lowercase())
                    .unwrap_or_default();
                if !DATA_SCRIPTS.contains(&ty.as_str()) {
                    return None;
                }
            }
            let mut el = El {
                tag,
                attrs,
                children: Vec::new(),
            };
            for c in h.children.borrow().iter() {
                if let Some(n) = convert(c) {
                    el.children.push(n);
                }
            }
            Some(Node::El(el))
        }
        _ => None,
    }
}

const VOID: [&str; 14] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// Tags that never hold layout: skipped when looking for sections.
pub const NOT_CONTENT: [&str; 8] = [
    "script", "style", "noscript", "template", "link", "meta", "helmet", "title",
];

impl El {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    pub fn set_attr(&mut self, name: &str, value: String) {
        if let Some(a) = self.attrs.iter_mut().find(|(k, _)| k == name) {
            a.1 = value;
        } else {
            self.attrs.push((name.into(), value));
        }
    }

    pub fn has_class(&self, class: &str) -> bool {
        self.attr("class")
            .is_some_and(|c| c.split_ascii_whitespace().any(|x| x == class))
    }

    /// Element children.
    pub fn elements(&self) -> impl Iterator<Item = &El> {
        self.children.iter().filter_map(|n| match n {
            Node::El(e) => Some(e),
            Node::Text(_) => None,
        })
    }

    /// Every descendant element in document order (not `self`).
    pub fn descendants(&self) -> Vec<&El> {
        let mut out = Vec::new();
        fn walk<'a>(e: &'a El, out: &mut Vec<&'a El>) {
            for c in e.elements() {
                out.push(c);
                walk(c, out);
            }
        }
        walk(self, &mut out);
        out
    }

    /// The first descendant (document order) that satisfies `f`.
    pub fn find(&self, f: &dyn Fn(&El) -> bool) -> Option<&El> {
        for c in self.elements() {
            if f(c) {
                return Some(c);
            }
            if let Some(x) = c.find(f) {
                return Some(x);
            }
        }
        None
    }

    pub fn count(&self, f: &dyn Fn(&El) -> bool) -> u32 {
        let n = self.descendants().into_iter().filter(|e| f(e)).count();
        u32::try_from(n).unwrap_or(u32::MAX)
    }

    pub fn find_tag(&self, tag: &str) -> Option<&El> {
        self.find(&|e| e.tag == tag)
    }

    /// The element's text: its text nodes joined by spaces, whitespace
    /// collapsed (adjacent elements do not run together). `<style>` and data
    /// scripts are not text.
    pub fn text(&self) -> String {
        let mut parts: Vec<&str> = Vec::new();
        fn walk<'a>(e: &'a El, parts: &mut Vec<&'a str>) {
            if e.tag == "style" || e.tag == "script" {
                return;
            }
            for c in &e.children {
                match c {
                    Node::Text(t) => parts.push(t),
                    Node::El(x) => walk(x, parts),
                }
            }
        }
        walk(self, &mut parts);
        collapse(&parts.join(" "))
    }

    /// The raw text of the element's own text children (style and script contents).
    pub fn raw_text(&self) -> String {
        let mut s = String::new();
        for c in &self.children {
            if let Node::Text(t) = c {
                s.push_str(t);
            }
        }
        s
    }

    /// Serialises the element (outer HTML).
    pub fn outer_html(&self) -> String {
        let mut out = String::new();
        self.write_html(&mut out);
        out
    }

    fn write_html(&self, out: &mut String) {
        out.push('<');
        out.push_str(&self.tag);
        for (k, v) in &self.attrs {
            let _ = write!(out, " {k}=\"{}\"", escape(v, true));
        }
        out.push('>');
        if VOID.contains(&self.tag.as_str()) {
            return;
        }
        let raw = matches!(self.tag.as_str(), "style" | "script");
        for c in &self.children {
            match c {
                Node::Text(t) if raw => out.push_str(t),
                Node::Text(t) => out.push_str(&escape(t, false)),
                Node::El(e) => e.write_html(out),
            }
        }
        let _ = write!(out, "</{}>", self.tag);
    }
}

/// Whitespace runs to one space, trimmed.
pub fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn escape(s: &str, attr: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' if !attr => out.push_str("&lt;"),
            '>' if !attr => out.push_str("&gt;"),
            '"' if attr => out.push_str("&quot;"),
            '\u{a0}' => out.push_str("&nbsp;"),
            c => out.push(c),
        }
    }
    out
}

/// The `<body>` of a document.
pub fn body(html: &El) -> Option<&El> {
    html.elements().find(|e| e.tag == "body")
}

/// The `<title>` text.
pub fn title(html: &El) -> Option<String> {
    html.find_tag("title")
        .map(|t| t.text())
        .filter(|t| !t.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_drops_code_and_keeps_data() {
        let h = parse(
            "<p onclick='x()'>a<b>b</b><script>evil()</script><a href='javascript:x'>l</a>\
             <script type='text/x-dc'>data</script>",
        );
        let b = body(&h).unwrap();
        assert_eq!(b.text(), "a b l");
        let html = b.outer_html();
        assert!(!html.contains("evil"));
        assert!(!html.contains("onclick"));
        assert!(!html.contains("javascript"));
        assert!(html.contains("data"));
    }
}
