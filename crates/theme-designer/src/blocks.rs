//! A small parser for WordPress's block grammar: `<!-- wp:name {json} -->`, its closer
//! `<!-- /wp:name -->` and the void form `<!-- wp:name {json} /-->`, with HTML between.
//!
//! It is strict where WordPress is lenient, because a template is written once and then
//! rendered for every visitor: names are lower-case `[a-z][a-z0-9-]*` with an optional
//! namespace (`group` is `core/group`), attributes are one JSON object, every opener is
//! closed by its own closer, and nothing but whitespace sits outside the top-level blocks.
//! Errors name the line.

use serde_json::{Map, Value};

/// A parsed block.
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    /// With its namespace (`core/group`).
    pub name: String,
    /// The attributes (an empty object when there are none).
    pub attrs: Map<String, Value>,
    pub inner: Vec<Node>,
    /// 1-based line of the opener.
    pub line: usize,
}

impl Block {
    /// The `className` attribute's classes.
    pub fn classes(&self) -> Vec<&str> {
        self.attrs
            .get("className")
            .and_then(Value::as_str)
            .map(|c| c.split_whitespace().collect())
            .unwrap_or_default()
    }

    /// The HTML directly inside the block (not inside inner blocks).
    pub fn own_html(&self) -> String {
        self.inner
            .iter()
            .filter_map(|n| match n {
                Node::Html(h) => Some(h.as_str()),
                Node::Block(_) => None,
            })
            .collect()
    }

    /// The block's text: the HTML inside it and its inner blocks, tags removed.
    pub fn text(&self) -> String {
        let mut html = String::new();
        fn collect(nodes: &[Node], out: &mut String) {
            for n in nodes {
                match n {
                    Node::Html(h) => out.push_str(h),
                    Node::Block(b) => collect(&b.inner, out),
                }
            }
        }
        collect(&self.inner, &mut html);
        strip_tags(&html)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Block(Block),
    Html(String),
}

/// A grammar error, with its line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GrammarError {
    pub line: usize,
    pub message: String,
}

fn line_at(s: &str, at: usize) -> usize {
    s[..at.min(s.len())].matches('\n').count() + 1
}

/// Text without tags, entities decoded for the common ones, whitespace collapsed.
pub fn strip_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn valid_part(p: &str) -> bool {
    let mut chars = p.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// `group` → `core/group`; `ns/name` stays; `None` when it is not a block name.
pub fn block_name(raw: &str) -> Option<String> {
    match raw.split_once('/') {
        None if valid_part(raw) => Some(format!("core/{raw}")),
        Some((ns, name)) if valid_part(ns) && valid_part(name) => Some(raw.to_string()),
        _ => None,
    }
}

/// One delimiter: `(closer, name, attrs, void, end offset)`.
type Delimiter = (bool, String, Map<String, Value>, bool, usize);

/// Reads the delimiter starting at `at` (`<!--` already seen); `Ok(None)` when the comment
/// is not a block delimiter at all.
fn delimiter(s: &str, at: usize) -> Result<Option<Delimiter>, String> {
    let after = at + 4;
    let lead = s[after..].len() - s[after..].trim_start().len();
    let start = after + lead;
    let (closer, name_at) = if s[start..].starts_with("/wp:") {
        (true, start + 4)
    } else if s[start..].starts_with("wp:") {
        (false, start + 3)
    } else {
        return Ok(None);
    };
    if lead == 0 {
        return Err("a block comment starts `<!-- wp:` with a space after `<!--`".into());
    }
    let name_end = s[name_at..]
        .find(char::is_whitespace)
        .map_or(s.len(), |i| name_at + i);
    let raw = &s[name_at..name_end];
    if raw.contains("-->") {
        return Err(format!(
            "`{raw}`: a space goes between the block name and `-->`"
        ));
    }
    let name = block_name(raw)
        .ok_or_else(|| format!("`{raw}` is not a block name (lower-case, `ns/name` or `name`)"))?;
    let mut pos = name_end;
    let skip_ws = |p: &mut usize| {
        while s[*p..].starts_with(char::is_whitespace) {
            *p += s[*p..].chars().next().map_or(1, char::len_utf8);
        }
    };
    skip_ws(&mut pos);
    let mut attrs = Map::new();
    if s[pos..].starts_with('{') {
        if closer {
            return Err(format!("the closer of {name} carries attributes"));
        }
        let mut it = serde_json::Deserializer::from_str(&s[pos..]).into_iter::<Value>();
        match it.next() {
            Some(Ok(Value::Object(m))) => {
                attrs = m;
                pos += it.byte_offset();
            }
            Some(Ok(_)) => return Err(format!("the attributes of {name} are not a JSON object")),
            Some(Err(e)) => {
                return Err(format!("the attributes of {name} are not valid JSON: {e}"))
            }
            None => return Err(format!("the attributes of {name} are missing")),
        }
        skip_ws(&mut pos);
    } else if s[pos..].starts_with('[') || s[pos..].starts_with('"') {
        return Err(format!("the attributes of {name} are not a JSON object"));
    }
    if s[pos..].starts_with("/-->") {
        if closer {
            return Err(format!(
                "`<!-- /wp:{raw} /-->` is neither a closer nor a void block"
            ));
        }
        return Ok(Some((closer, name, attrs, true, pos + 4)));
    }
    if s[pos..].starts_with("-->") {
        return Ok(Some((closer, name, attrs, false, pos + 3)));
    }
    Err(format!(
        "the comment of {name} does not end with `-->` or `/-->` after its attributes"
    ))
}

/// Parses `markup` into its top-level blocks (whitespace between them dropped).
pub fn parse(markup: &str) -> Result<Vec<Node>, Vec<GrammarError>> {
    let mut errors = Vec::new();
    // The stack of open blocks; index 0 is the document.
    let mut stack: Vec<Block> = vec![Block {
        name: String::new(),
        attrs: Map::new(),
        inner: Vec::new(),
        line: 1,
    }];
    let mut pos = 0;
    let mut text_from = 0;
    let push_html =
        |stack: &mut Vec<Block>, html: &str, line: usize, errors: &mut Vec<GrammarError>| {
            if html.is_empty() {
                return;
            }
            if stack.len() == 1 {
                if !html.trim().is_empty() {
                    errors.push(GrammarError {
                        line,
                        message: format!(
                            "HTML outside any block: `{}` (wrap it in a core block)",
                            html.trim().chars().take(60).collect::<String>()
                        ),
                    });
                }
                return;
            }
            if let Some(top) = stack.last_mut() {
                top.inner.push(Node::Html(html.to_string()));
            }
        };
    while let Some(i) = markup[pos..].find("<!--") {
        let at = pos + i;
        let line = line_at(markup, at);
        match delimiter(markup, at) {
            Ok(None) => {
                // An HTML comment: part of the HTML.
                let end = markup[at..]
                    .find("-->")
                    .map_or(markup.len(), |e| at + e + 3);
                pos = end;
                continue;
            }
            Err(message) => {
                errors.push(GrammarError { line, message });
                let end = markup[at..]
                    .find("-->")
                    .map_or(markup.len(), |e| at + e + 3);
                pos = end;
                text_from = end;
                continue;
            }
            Ok(Some((closer, name, attrs, void, end))) => {
                push_html(
                    &mut stack,
                    &markup[text_from..at],
                    line_at(markup, text_from),
                    &mut errors,
                );
                if closer {
                    if stack.len() == 1 {
                        errors.push(GrammarError {
                            line,
                            message: format!(
                                "`<!-- /wp:{} -->` closes a block that was never opened",
                                short(&name)
                            ),
                        });
                    } else if stack.last().is_some_and(|b| b.name == name) {
                        let done = stack.pop().unwrap_or_else(|| unreachable!());
                        if let Some(parent) = stack.last_mut() {
                            parent.inner.push(Node::Block(done));
                        }
                    } else {
                        let open = stack
                            .last()
                            .map(|b| (b.name.clone(), b.line))
                            .unwrap_or_default();
                        errors.push(GrammarError {
                            line,
                            message: format!(
                                "`<!-- /wp:{} -->` closes {} but {} (line {}) is still open",
                                short(&name),
                                name,
                                open.0,
                                open.1
                            ),
                        });
                    }
                } else if void {
                    let b = Block {
                        name,
                        attrs,
                        inner: Vec::new(),
                        line,
                    };
                    if let Some(top) = stack.last_mut() {
                        top.inner.push(Node::Block(b));
                    }
                } else {
                    stack.push(Block {
                        name,
                        attrs,
                        inner: Vec::new(),
                        line,
                    });
                }
                pos = end;
                text_from = end;
            }
        }
    }
    push_html(
        &mut stack,
        &markup[text_from..],
        line_at(markup, text_from),
        &mut errors,
    );
    while stack.len() > 1 {
        let b = stack.pop().unwrap_or_else(|| unreachable!());
        errors.push(GrammarError {
            line: b.line,
            message: format!(
                "{} opened here is never closed (`<!-- /wp:{} -->`)",
                b.name,
                short(&b.name)
            ),
        });
    }
    if errors.is_empty() {
        Ok(stack.pop().map(|d| d.inner).unwrap_or_default())
    } else {
        Err(errors)
    }
}

/// `core/group` → `group` (how the markup writes it).
pub fn short(name: &str) -> &str {
    name.strip_prefix("core/").unwrap_or(name)
}

/// Every block, depth first, with its ancestors (outermost first).
pub fn walk<'a>(nodes: &'a [Node], f: &mut dyn FnMut(&'a Block, &[&'a Block])) {
    fn go<'a>(
        nodes: &'a [Node],
        path: &mut Vec<&'a Block>,
        f: &mut dyn FnMut(&'a Block, &[&'a Block]),
    ) {
        for n in nodes {
            if let Node::Block(b) = n {
                f(b, path);
                path.push(b);
                go(&b.inner, path, f);
                path.pop();
            }
        }
    }
    go(nodes, &mut Vec::new(), f);
}

/// Every block, depth first.
pub fn all(nodes: &[Node]) -> Vec<&Block> {
    let mut out = Vec::new();
    walk(nodes, &mut |b, _| out.push(b));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_nest_and_carry_their_attributes() {
        let m = "<!-- wp:group {\"className\":\"sp-hero a\"} -->\n<div class=\"wp-block-group\"><!-- wp:heading {\"level\":1} -->\n<h1>Five villages</h1>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->\n<!-- wp:template-part {\"slug\":\"footer\"} /-->";
        let nodes = parse(m).unwrap();
        assert_eq!(nodes.len(), 2);
        let blocks = all(&nodes);
        assert_eq!(blocks[0].name, "core/group");
        assert_eq!(blocks[0].classes(), vec!["sp-hero", "a"]);
        assert_eq!(blocks[1].name, "core/heading");
        assert_eq!(blocks[1].attrs["level"], 1);
        assert_eq!(blocks[1].text(), "Five villages");
        assert_eq!(blocks[2].name, "core/template-part");
        assert_eq!(blocks[0].line, 1);
        assert_eq!(blocks[1].line, 2);
    }

    #[test]
    fn grammar_errors_name_the_line() {
        let msgs = |m: &str| -> Vec<String> {
            parse(m)
                .unwrap_err()
                .into_iter()
                .map(|e| format!("{}: {}", e.line, e.message))
                .collect()
        };
        assert_eq!(
            msgs("<!-- wp:group -->\n<div></div>"),
            vec!["1: core/group opened here is never closed (`<!-- /wp:group -->`)"]
        );
        assert_eq!(
            msgs("<!-- wp:group -->\n<!-- wp:column -->\n<!-- /wp:group -->\n<!-- /wp:column -->")
                [0],
            "3: `<!-- /wp:group -->` closes core/group but core/column (line 2) is still open"
        );
        assert!(msgs("<!-- wp:heading {\"level\":1 -->")[0]
            .starts_with("1: the attributes of core/heading are not valid JSON"));
        assert!(msgs("<!-- wp:Group /-->")[0].contains("`Group` is not a block name"));
        assert!(msgs("<p>loose</p>")[0].contains("HTML outside any block"));
        assert!(msgs("<!-- /wp:group -->")[0].contains("never opened"));
        assert!(msgs("<!-- wp:heading [1] /-->")[0].contains("not a JSON object"));
        // HTML comments are HTML.
        assert!(parse("<!-- wp:group --><!-- a note --><!-- /wp:group -->").is_ok());
    }

    #[test]
    fn names_take_core_as_their_namespace() {
        assert_eq!(block_name("post-title").as_deref(), Some("core/post-title"));
        assert_eq!(
            block_name("swarmpress/forecast").as_deref(),
            Some("swarmpress/forecast")
        );
        assert_eq!(block_name("Post"), None);
        assert_eq!(strip_tags("<p>Food &amp; <b>Drink</b></p>"), "Food & Drink");
    }
}
