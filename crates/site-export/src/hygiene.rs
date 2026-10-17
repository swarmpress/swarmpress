//! A static release as a site of its own (ADR-0094's platform rules, FEAT-116): WordPress's
//! runtime extras left out (the emoji script, its settings and styles), every page naming its
//! canonical URL and its language versions (hreflang), and a sitemap of the pages the release
//! serves. Pure text functions over a page's HTML; the export applies them.

use std::collections::BTreeMap;

/// The page without WordPress's emoji runtime: the `wp-emoji-settings` JSON, the loader module,
/// the `concatemoji` script and the `wp-emoji-styles` inline styles (`None`: nothing to remove).
pub fn strip_runtime(html: &str) -> Option<String> {
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    let mut changed = false;
    loop {
        let next = ["<script", "<style"]
            .iter()
            .filter_map(|t| html[at..].find(t).map(|i| (at + i, *t)))
            .min_by_key(|(i, _)| *i);
        let Some((start, tag)) = next else { break };
        let close = if tag == "<script" {
            "</script>"
        } else {
            "</style>"
        };
        let Some(open_end) = html[start..].find('>').map(|i| start + i + 1) else {
            break;
        };
        let Some(end) = html[open_end..]
            .find(close)
            .map(|i| open_end + i + close.len())
        else {
            break;
        };
        let open = html[start..open_end].to_ascii_lowercase();
        let body = html[open_end..end - close.len()].to_ascii_lowercase();
        let emoji = open.contains("wp-emoji")
            || body.contains("wp-emoji-settings")
            || body.contains("_wpemojisettings")
            || body.contains("wp-emoji-loader")
            || (tag == "<style" && body.contains("img.wp-smiley"));
        out.push_str(&html[at..start]);
        if emoji {
            changed = true;
            // The line the element stood on goes with it.
            if html[end..].starts_with('\n') {
                at = end + 1;
            } else {
                at = end;
            }
            while out.ends_with([' ', '\t']) {
                out.pop();
            }
        } else {
            out.push_str(&html[start..end]);
            at = end;
        }
    }
    out.push_str(&html[at..]);
    changed.then_some(out)
}

/// The `href` of the page's `<link rel="canonical">`.
pub fn canonical(html: &str) -> Option<String> {
    let head = &html[..html.find("</head>").unwrap_or(html.len())];
    let mut rest = head;
    while let Some(i) = rest.find("<link") {
        let tag_end = rest[i..].find('>').map_or(rest.len(), |j| i + j + 1);
        let tag = &rest[i..tag_end];
        if attr(tag, "rel").is_some_and(|r| r.eq_ignore_ascii_case("canonical")) {
            return attr(tag, "href");
        }
        rest = &rest[tag_end..];
    }
    None
}

fn attr(tag: &str, name: &str) -> Option<String> {
    for q in ['"', '\''] {
        let key = format!("{name}={q}");
        if let Some(i) = tag.find(&key) {
            let v = &tag[i + key.len()..];
            return v.find(q).map(|j| v[..j].to_string());
        }
    }
    None
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

fn with_head(html: &str, lines: &str) -> String {
    match html.find("</head>") {
        Some(i) => format!("{}{lines}{}", &html[..i], &html[i..]),
        None => html.to_string(),
    }
}

/// The page with its head links set: its canonical (`canonical`, an absolute URL; an existing
/// one is replaced) and its language versions (`alternates`: language → absolute URL, plus
/// `x-default`; existing `hreflang` links are replaced). `None`: unchanged.
pub fn with_head_links(
    html: &str,
    canonical_url: Option<&str>,
    alternates: &BTreeMap<String, String>,
) -> Option<String> {
    let mut out = html.to_string();
    let head_end = out.find("</head>")?;
    // Existing canonical and hreflang links out.
    let mut kept = String::new();
    let head = &out[..head_end];
    let mut at = 0;
    while let Some(i) = head[at..].find("<link") {
        let s = at + i;
        let e = head[s..].find('>').map_or(head.len(), |j| s + j + 1);
        let tag = &head[s..e];
        let drop = (canonical_url.is_some()
            && attr(tag, "rel").is_some_and(|r| r.eq_ignore_ascii_case("canonical")))
            || (!alternates.is_empty() && attr(tag, "hreflang").is_some());
        kept.push_str(&head[at..s]);
        if drop {
            let e2 = if head[e..].starts_with('\n') {
                e + 1
            } else {
                e
            };
            at = e2;
        } else {
            kept.push_str(tag);
            at = e;
        }
    }
    kept.push_str(&head[at..]);
    let mut lines = String::new();
    if let Some(c) = canonical_url {
        lines.push_str(&format!("<link rel=\"canonical\" href=\"{}\" />\n", esc(c)));
    }
    for (lang, url) in alternates {
        lines.push_str(&format!(
            "<link rel=\"alternate\" hreflang=\"{}\" href=\"{}\" />\n",
            esc(lang),
            esc(url)
        ));
    }
    out = format!("{kept}{}", &out[head_end..]);
    out = with_head(&out, &lines);
    (out != html).then_some(out)
}

/// A sitemap of `urls` (absolute), in order.
pub fn sitemap(urls: &[String]) -> String {
    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
    );
    for u in urls {
        s.push_str(&format!("<url><loc>{}</loc></url>\n", esc(u)));
    }
    s.push_str("</urlset>\n");
    s
}

/// `robots` naming `sitemap_url` (added once).
pub fn robots_with_sitemap(robots: &str, sitemap_url: &str) -> String {
    let line = format!("Sitemap: {sitemap_url}");
    if robots.lines().any(|l| l.trim() == line) {
        return robots.to_string();
    }
    let mut r = robots.trim_end().to_string();
    if !r.is_empty() {
        r.push('\n');
    }
    r.push_str(&line);
    r.push('\n');
    r
}

/// A tag or category archive asks not to be indexed (`noindex, follow`): WordPress makes one for
/// every term, with no text of its own (no description, a title shared with its namesake term);
/// it stays for readers who follow a tag, and leaves the sitemap. `None`: not such an archive, or
/// already so.
pub fn noindex_term_archive(html: &str) -> Option<String> {
    let i = html.find("<body")?;
    let end = i + html[i..].find('>')?;
    let classes = attr(&html[i..end], "class")?;
    let term = classes
        .split_whitespace()
        .any(|c| c == "tag" || c == "category");
    if !term || noindex(html) {
        return None;
    }
    let head_end = html.find("</head>")?;
    let head = &html[..head_end];
    let meta = "<meta name='robots' content='noindex, follow' />";
    // WordPress's own robots meta is replaced; else one is added.
    if let Some(m) = head
        .find("<meta name='robots'")
        .or_else(|| head.find("<meta name=\"robots\""))
    {
        let e = m + head[m..].find('>')? + 1;
        return Some(format!("{}{meta}{}", &html[..m], &html[e..]));
    }
    Some(with_head(html, &format!("{meta}\n")))
}

/// Whether the page asks not to be indexed (`<meta name="robots" content="noindex…">`).
pub fn noindex(html: &str) -> bool {
    let head = &html[..html.find("</head>").unwrap_or(html.len())];
    head.match_indices("<meta").any(|(i, _)| {
        let e = head[i..].find('>').map_or(head.len(), |j| i + j + 1);
        let tag = &head[i..e];
        attr(tag, "name").is_some_and(|n| n.eq_ignore_ascii_case("robots"))
            && attr(tag, "content").is_some_and(|c| c.to_ascii_lowercase().contains("noindex"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "<html><head>\n<title>A</title>\n<style id=\"wp-emoji-styles-inline-css\">\nimg.wp-smiley{}\n</style>\n<link rel=\"canonical\" href=\"https://ex.travel/old/\" />\n<style id=\"keep\">a{}</style>\n</head><body><p>x</p>\n<script id=\"wp-emoji-settings\" type=\"application/json\">{\"source\":{}}</script>\n<script type=\"module\">var e=\"script#wp-emoji-settings\";window._wpemojiSettings=1</script>\n<script src=\"/ds.js\" defer></script>\n</body></html>";

    #[test]
    fn the_emoji_runtime_leaves_and_everything_else_stays() {
        let s = strip_runtime(PAGE).unwrap();
        assert!(!s.to_ascii_lowercase().contains("emoji"), "{s}");
        assert!(s.contains("<style id=\"keep\">a{}</style>"));
        assert!(s.contains("<script src=\"/ds.js\" defer></script>"));
        assert!(s.contains("<p>x</p>"));
        assert_eq!(strip_runtime(&s), None);
    }

    #[test]
    fn head_links_are_set_once() {
        assert_eq!(canonical(PAGE).as_deref(), Some("https://ex.travel/old/"));
        let alts = BTreeMap::from([
            ("de".to_string(), "https://ex.travel/de/a/".to_string()),
            ("en".to_string(), "https://ex.travel/en/a/".to_string()),
            (
                "x-default".to_string(),
                "https://ex.travel/en/a/".to_string(),
            ),
        ]);
        let s = with_head_links(PAGE, Some("https://ex.travel/en/a/"), &alts).unwrap();
        assert_eq!(canonical(&s).as_deref(), Some("https://ex.travel/en/a/"));
        assert_eq!(s.matches("rel=\"canonical\"").count(), 1);
        assert_eq!(s.matches("hreflang=").count(), 3);
        assert_eq!(
            with_head_links(&s, Some("https://ex.travel/en/a/"), &alts),
            None
        );
        assert!(!noindex(&s));
        assert!(noindex(
            "<head><meta name='robots' content='noindex, follow' /></head>"
        ));
    }

    #[test]
    fn a_sitemap_and_robots_name_each_other() {
        let x = sitemap(&["https://ex.travel/a/?b&c".to_string()]);
        assert!(x.contains("<loc>https://ex.travel/a/?b&amp;c</loc>"));
        let r = robots_with_sitemap("User-agent: *\n", "https://ex.travel/sitemap.xml");
        assert_eq!(r, "User-agent: *\nSitemap: https://ex.travel/sitemap.xml\n");
        assert_eq!(robots_with_sitemap(&r, "https://ex.travel/sitemap.xml"), r);
    }
}
