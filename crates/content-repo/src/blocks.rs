//! Gutenberg's block serialization, parsed into a tree that prints back byte for byte.
//!
//! A post's `post_content` is HTML with block delimiters:
//! `<!-- wp:name {"attrs"} -->inner<!-- /wp:name -->`, self-closing `<!-- wp:name /-->`, with
//! the `core/` namespace implied when a name has none. Text between blocks is freeform HTML.
//! The repository stores the tree (ADR-0080: diffs and merges work on blocks, not on text);
//! [`serialize`] gives back exactly what [`parse`] read, so the projection WordPress sees is the
//! content WordPress wrote.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One node of a block tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Node {
    /// Freeform HTML between blocks, verbatim.
    Html { html: String },
    /// A block. `name` is as written (`paragraph` or `acme/card`); `attrs_raw` is the attribute
    /// JSON exactly as written (key order and spacing kept); `attrs` is it parsed, for diffs.
    Block {
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        attrs_raw: Option<String>,
        #[serde(skip_serializing_if = "Value::is_null", default)]
        attrs: Value,
        /// `None` for a self-closing block.
        #[serde(skip_serializing_if = "Option::is_none")]
        inner: Option<Vec<Node>>,
    },
}

impl Node {
    /// The block's full name with its namespace (`core/paragraph`).
    pub fn full_name(&self) -> Option<String> {
        match self {
            Node::Block { name, .. } if name.contains('/') => Some(name.clone()),
            Node::Block { name, .. } => Some(format!("core/{name}")),
            Node::Html { .. } => None,
        }
    }
}

struct Delim<'a> {
    start: usize,
    end: usize,
    closing: bool,
    self_closing: bool,
    name: &'a str,
    attrs_raw: Option<&'a str>,
}

/// The next block delimiter at or after `from`.
fn next_delim(s: &str, from: usize) -> Option<Delim<'_>> {
    let mut at = from;
    while let Some(i) = s[at..].find("<!--") {
        let start = at + i;
        let rest = &s[start + 4..];
        let ws = rest.len() - rest.trim_start().len();
        let body = &rest[ws..];
        let (closing, body) = match body.strip_prefix("/wp:") {
            Some(b) => (true, b),
            None => match body.strip_prefix("wp:") {
                Some(b) => (false, b),
                None => {
                    at = start + 4;
                    continue;
                }
            },
        };
        let name_len = body
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/'))
            .unwrap_or(body.len());
        let name = &body[..name_len];
        let close = body.find("-->")?;
        let between = body[name_len..close].trim();
        let (attrs_raw, self_closing) = match between.strip_suffix('/') {
            Some(a) => (a.trim(), true),
            None => (between, false),
        };
        if name.is_empty() || (!attrs_raw.is_empty() && !attrs_raw.starts_with('{')) {
            at = start + 4;
            continue;
        }
        let end = start + 4 + ws + (s[start + 4 + ws..].len() - body.len()) + close + 3;
        return Some(Delim {
            start,
            end,
            closing,
            self_closing,
            name,
            attrs_raw: if attrs_raw.is_empty() {
                None
            } else {
                Some(attrs_raw)
            },
        });
    }
    None
}

/// Parses `post_content` into a tree. Unbalanced delimiters are kept as HTML, so nothing is lost.
pub fn parse(s: &str) -> Vec<Node> {
    let (nodes, _) = parse_level(s, 0, None);
    nodes
}

fn push_html(out: &mut Vec<Node>, html: &str) {
    if html.is_empty() {
        return;
    }
    if let Some(Node::Html { html: prev }) = out.last_mut() {
        prev.push_str(html);
    } else {
        out.push(Node::Html {
            html: html.to_string(),
        });
    }
}

/// Parses until the closing delimiter of `open` (or the end); returns the nodes and the offset
/// after the closer, or `None` if no closer was found.
fn parse_level(s: &str, from: usize, open: Option<&str>) -> (Vec<Node>, Option<usize>) {
    let mut out = Vec::new();
    let mut at = from;
    while let Some(d) = next_delim(s, at) {
        push_html(&mut out, &s[at..d.start]);
        if d.closing {
            if Some(d.name) == open {
                return (out, Some(d.end));
            }
            // A stray closer: keep it as text.
            push_html(&mut out, &s[d.start..d.end]);
            at = d.end;
            continue;
        }
        let attrs = d
            .attrs_raw
            .and_then(|a| serde_json::from_str(a).ok())
            .unwrap_or(Value::Null);
        if d.self_closing {
            out.push(Node::Block {
                name: d.name.to_string(),
                attrs_raw: d.attrs_raw.map(str::to_string),
                attrs,
                inner: None,
            });
            at = d.end;
            continue;
        }
        let (inner, after) = parse_level(s, d.end, Some(d.name));
        match after {
            Some(after) => {
                out.push(Node::Block {
                    name: d.name.to_string(),
                    attrs_raw: d.attrs_raw.map(str::to_string),
                    attrs,
                    inner: Some(inner),
                });
                at = after;
            }
            None => {
                // Never closed: the opener is text, and parsing goes on after it.
                push_html(&mut out, &s[d.start..d.end]);
                at = d.end;
            }
        }
    }
    push_html(&mut out, &s[at..]);
    (out, None)
}

/// Prints a tree back to `post_content`.
pub fn serialize(nodes: &[Node]) -> String {
    let mut out = String::new();
    write_nodes(&mut out, nodes);
    out
}

fn write_nodes(out: &mut String, nodes: &[Node]) {
    for n in nodes {
        match n {
            Node::Html { html } => out.push_str(html),
            Node::Block {
                name,
                attrs_raw,
                inner,
                ..
            } => {
                out.push_str("<!-- wp:");
                out.push_str(name);
                if let Some(a) = attrs_raw {
                    out.push(' ');
                    out.push_str(a);
                }
                match inner {
                    None => out.push_str(" /-->"),
                    Some(inner) => {
                        out.push_str(" -->");
                        write_nodes(out, inner);
                        out.push_str("<!-- /wp:");
                        out.push_str(name);
                        out.push_str(" -->");
                    }
                }
            }
        }
    }
}

/// A block with new attributes: `attrs_raw` is rewritten from them (compact JSON, the way
/// WordPress's serializer writes attributes).
pub fn set_attrs(node: &mut Node, new: Value) {
    if let Node::Block {
        attrs, attrs_raw, ..
    } = node
    {
        *attrs_raw = if new.is_null() || new.as_object().is_some_and(|o| o.is_empty()) {
            None
        } else {
            Some(serde_json::to_string(&new).unwrap_or_default())
        };
        *attrs = new;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_prints_back_byte_for_byte() {
        for src in [
            "",
            "plain classic content\n\nwith paragraphs",
            "<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->",
            "<!-- wp:group {\"layout\":{\"type\":\"constrained\"}} -->\n<div class=\"wp-block-group\"><!-- wp:heading {\"level\":3} -->\n<h3>Harvest</h3>\n<!-- /wp:heading -->\n\n<!-- wp:image {\"id\":12,  \"sizeSlug\":\"large\"} /--></div>\n<!-- /wp:group -->\n\ntrailing",
            "<!-- wp:shortcode -->[contact-form-7 id=\"10\"]<!-- /wp:shortcode -->",
            "<!-- wp:acme/card {\"a\":1} --><p>x</p><!-- /wp:acme/card --><!-- a comment --><!-- /wp:stray --><!-- wp:unclosed -->tail",
        ] {
            assert_eq!(serialize(&parse(src)), src, "{src}");
        }
    }

    #[test]
    fn the_tree_has_blocks_attributes_and_nesting() {
        let t = parse("<!-- wp:group {\"tagName\":\"section\"} --><!-- wp:paragraph --><p>a</p><!-- /wp:paragraph --><!-- /wp:group -->");
        let Node::Block {
            name,
            attrs,
            inner: Some(inner),
            ..
        } = &t[0]
        else {
            panic!("{t:?}")
        };
        assert_eq!(name, "group");
        assert_eq!(attrs["tagName"], "section");
        assert_eq!(inner[0].full_name().as_deref(), Some("core/paragraph"));
    }
}
