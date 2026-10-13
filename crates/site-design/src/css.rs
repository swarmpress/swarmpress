//! What a design's stylesheets say about its tokens, read without a CSS
//! engine: custom properties on `:root`, `@font-face` rules, `@media`
//! widths and the font stacks in `font-family` declarations.

use std::collections::BTreeMap;

/// `--name: value` declarations of `:root` rules (later ones win).
pub fn root_properties(css: &str, out: &mut BTreeMap<String, String>) {
    let mut rest = css;
    while let Some(a) = rest.find(":root") {
        let after = rest[a + 5..].trim_start();
        rest = &rest[a + 5..];
        let Some(block) = after.strip_prefix('{') else {
            continue;
        };
        let end = block.find('}').unwrap_or(block.len());
        for decl in block[..end].split(';') {
            let Some((k, v)) = decl.split_once(':') else {
                continue;
            };
            let k = k.trim();
            if k.len() > 2
                && k.starts_with("--")
                && k[2..]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                out.insert(k.to_string(), v.trim().to_string());
            }
        }
    }
}

/// One `@font-face` rule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FontFaceRule {
    pub family: String,
    pub weight: String,
    pub style: String,
    /// The `url(…)`s of its `src`, as written.
    pub urls: Vec<String>,
    pub unicode_range: Option<String>,
}

fn unquote(s: &str) -> String {
    s.trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .trim()
        .to_string()
}

/// The declarations of a block, as `(property, value)`.
fn declarations(block: &str) -> Vec<(String, String)> {
    block
        .split(';')
        .filter_map(|d| {
            let (k, v) = d.split_once(':')?;
            Some((k.trim().to_ascii_lowercase(), v.trim().to_string()))
        })
        .collect()
}

/// Every `@font-face` rule.
pub fn font_faces(css: &str) -> Vec<FontFaceRule> {
    let mut out = Vec::new();
    let mut rest = css;
    while let Some(a) = rest.find("@font-face") {
        let tail = &rest[a..];
        let (Some(o), Some(c)) = (tail.find('{'), tail.find('}')) else {
            break;
        };
        if c < o {
            rest = &tail[c + 1..];
            continue;
        }
        let mut face = FontFaceRule {
            family: String::new(),
            weight: "400".into(),
            style: "normal".into(),
            urls: Vec::new(),
            unicode_range: None,
        };
        for (k, v) in declarations(&tail[o + 1..c]) {
            match k.as_str() {
                "font-family" => face.family = unquote(&v),
                "font-weight" => face.weight = v,
                "font-style" => face.style = v,
                "unicode-range" => face.unicode_range = Some(v),
                "src" => {
                    let mut s = v.as_str();
                    while let Some(u) = s.find("url(") {
                        let t = &s[u + 4..];
                        let e = t.find(')').unwrap_or(t.len());
                        face.urls.push(unquote(&t[..e]));
                        s = &t[e..];
                    }
                }
                _ => {}
            }
        }
        if !face.family.is_empty() {
            out.push(face);
        }
        rest = &tail[c + 1..];
    }
    out
}

/// Pixel widths in `@media` conditions (`min-width`/`max-width`, px or em/rem × 16).
pub fn media_widths(css: &str) -> Vec<u32> {
    let mut out = Vec::new();
    let mut rest = css;
    while let Some(a) = rest.find("@media") {
        let tail = &rest[a..];
        let end = tail.find('{').unwrap_or(tail.len());
        let cond = &tail[..end];
        for key in ["min-width", "max-width"] {
            let mut c = cond;
            while let Some(k) = c.find(key) {
                let v = c[k + key.len()..]
                    .trim_start()
                    .trim_start_matches(':')
                    .trim_start();
                let num: String = v.chars().take_while(char::is_ascii_digit).collect();
                let unit: String = v[num.len()..]
                    .chars()
                    .take_while(char::is_ascii_alphabetic)
                    .collect();
                if let Ok(n) = num.parse::<u32>() {
                    match unit.as_str() {
                        "px" => out.push(n),
                        "em" | "rem" => out.push(n.saturating_mul(16)),
                        _ => {}
                    }
                }
                c = &c[k + key.len()..];
            }
        }
        rest = &tail[end.min(tail.len())..];
        if end == tail.len() {
            break;
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// `font-family` stacks used in rules and inline styles, keyed by their first family.
pub fn font_stacks(css: &str, out: &mut BTreeMap<String, String>) {
    let mut rest = css;
    while let Some(a) = rest.find("font-family") {
        let tail = &rest[a + 11..];
        let Some(v) = tail.trim_start().strip_prefix(':') else {
            rest = tail;
            continue;
        };
        let end = v.find([';', '}']).unwrap_or(v.len());
        let stack = v[..end].trim().to_string();
        if let Some(first) = stack.split(',').next() {
            let first = unquote(first);
            if !first.is_empty() && stack.contains(',') {
                let e = out.entry(first).or_default();
                if e.len() < stack.len() {
                    *e = stack.clone();
                }
            }
        }
        rest = &v[end.min(v.len())..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_root_faces_media_and_stacks() {
        let css = "a{--x:1} :root{ --y: 2px; --z:#fff } :root, .dark { --no: 1 }\
            @font-face{font-family:'Bodoni Moda';font-style:italic;font-weight:400 900;src:url(\"../assets/a.woff2\") format('woff2')}\
            @media (min-width: 600px) and (max-width:59em){} @media (min-width:960px){}\
            .disp{font-family:'Bodoni Moda','Didot',Georgia,serif}";
        let mut p = BTreeMap::new();
        root_properties(css, &mut p);
        assert_eq!(p.len(), 2);
        assert_eq!(p["--y"], "2px");
        let f = font_faces(css);
        assert_eq!(f[0].family, "Bodoni Moda");
        assert_eq!(f[0].weight, "400 900");
        assert_eq!(f[0].urls, vec!["../assets/a.woff2".to_string()]);
        assert_eq!(media_widths(css), vec![600, 944, 960]);
        let mut s = BTreeMap::new();
        font_stacks(css, &mut s);
        assert_eq!(s["Bodoni Moda"], "'Bodoni Moda','Didot',Georgia,serif");
    }
}
