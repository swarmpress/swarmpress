//! Claude Design's standalone HTML export, unpacked natively.
//!
//! The export is one HTML file whose loader script unpacks it in the browser.
//! The crate reads its data islands instead:
//!
//! * `<script type="__bundler/manifest">`: JSON `uuid → {mime, compressed,
//!   data}`; `data` is base64, gzip-compressed when `compressed` is true;
//! * `<script type="__bundler/page_order">`: the page uuids in order (empty
//!   in a page's own bundle);
//! * `<script type="__bundler/template">`: a JSON string of HTML. At the
//!   root it is the **board**: one `<section>` per page with an `<h2>` title
//!   and an `<iframe src="about:blank#<uuid>">`; in a page bundle it is the
//!   page, whose resources are named by their uuids;
//! * `<script type="__bundler/ext_resources">`: the CDN scripts it inlined
//!   (React): not part of a design.
//!
//! Each page is itself a bundle of the same format, unpacked recursively.
//! The result is a plain bundle: `pages/NN-title.html` per page (resource
//! uuids and `data:` URIs replaced by relative paths), `assets/<sha256
//! prefix>.<ext>` per font and image (deduplicated by content: every page
//! carries its own copy of the fonts), and `design.json`, which lists the
//! pages with their board titles in order. Scripts (the runtime, React) are
//! dropped; the page's `text/x-dc` data script stays inline, as data.

use std::collections::BTreeMap;
use std::io::Read;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bundle::{extension_of, sha256_hex, MAX_BUNDLE_BYTES};

/// `design.json`'s format id.
pub const EXPORT_INDEX_FORMAT: &str = "swarmpress.design-pages.v1";
/// The deepest page nesting followed.
const MAX_DEPTH: u32 = 4;

/// `design.json`: the pages of an unpacked export, in the board's order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PagesIndex {
    pub format: String,
    pub title: String,
    pub pages: Vec<IndexedPage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexedPage {
    pub path: String,
    /// The board's title (`06 — Applied: Homepage`).
    pub title: String,
    pub uuid: String,
}

#[derive(Deserialize)]
struct Entry {
    mime: String,
    #[serde(default)]
    compressed: bool,
    data: String,
}

/// Is this HTML a Claude Design standalone export?
pub fn is_export(html: &str) -> bool {
    html.contains("type=\"__bundler/manifest\"") && html.contains("type=\"__bundler/template\"")
}

/// The text of `<script type="{ty}">…</script>`.
fn island<'a>(html: &'a str, ty: &str) -> Option<&'a str> {
    let open = format!("<script type=\"{ty}\"");
    let a = html.find(&open)?;
    let body = a + html[a..].find('>')? + 1;
    let end = body + html[body..].find("</script>")?;
    Some(&html[body..end])
}

fn decode(e: &Entry, budget: usize) -> Result<Vec<u8>, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(e.data.trim())
        .map_err(|x| format!("a resource is not base64: {x}"))?;
    if !e.compressed {
        return Ok(raw);
    }
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(raw.as_slice())
        .take(u64::try_from(budget).unwrap_or(u64::MAX) + 1)
        .read_to_end(&mut out)
        .map_err(|x| format!("a resource is not gzip: {x}"))?;
    if out.len() > budget {
        return Err("the export unpacks to more than a bundle may hold".into());
    }
    Ok(out)
}

fn kebab(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "page".into()
    } else {
        out.chars()
            .take(60)
            .collect::<String>()
            .trim_end_matches('-')
            .to_string()
    }
}

struct Unpacker {
    files: BTreeMap<String, Vec<u8>>,
    total: usize,
}

impl Unpacker {
    /// Keeps an asset (by content) and returns its bundle path.
    fn asset(&mut self, mime: &str, bytes: Vec<u8>) -> Option<String> {
        let ext = extension_of(mime)?;
        if ext == "html" || ext == "json" {
            return None;
        }
        let path = format!("assets/{}.{ext}", &sha256_hex(&bytes)[..16]);
        if !self.files.contains_key(&path) {
            self.total += bytes.len();
            self.files.insert(path.clone(), bytes);
        }
        Some(path)
    }

    /// Replaces `data:<mime>;base64,…` URIs with asset paths (relative to `pages/`).
    fn data_uris(&mut self, html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut rest = html;
        while let Some(a) = rest.find("data:") {
            out.push_str(&rest[..a]);
            let tail = &rest[a..];
            let end = tail
                .find(|c: char| c == '"' || c == '\'' || c == ')' || c.is_whitespace())
                .unwrap_or(tail.len());
            let uri = &tail[..end];
            let replaced = uri
                .strip_prefix("data:")
                .and_then(|u| u.split_once(";base64,"))
                .and_then(|(mime, b64)| {
                    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
                    self.asset(mime, bytes)
                });
            match replaced {
                Some(p) => out.push_str(&format!("../{p}")),
                None => out.push_str(uri),
            }
            rest = &tail[end..];
        }
        out.push_str(rest);
        out
    }

    /// A page's own bundle → its HTML with resources as bundle paths.
    fn page(&mut self, html: &str, depth: u32) -> Result<String, String> {
        if !is_export(html) {
            return Ok(self.data_uris(html));
        }
        if depth > MAX_DEPTH {
            return Err("pages nest too deep".into());
        }
        let manifest: BTreeMap<String, Entry> =
            serde_json::from_str(island(html, "__bundler/manifest").unwrap_or("{}"))
                .map_err(|e| format!("the page manifest is not JSON: {e}"))?;
        let template: String =
            serde_json::from_str(island(html, "__bundler/template").unwrap_or("\"\""))
                .map_err(|e| format!("the page template is not a JSON string: {e}"))?;
        let mut page = template;
        for (uuid, e) in &manifest {
            if !page.contains(uuid.as_str()) {
                continue;
            }
            let bytes = decode(e, MAX_BUNDLE_BYTES.saturating_sub(self.total))?;
            if let Some(p) = self.asset(&e.mime, bytes) {
                page = page.replace(uuid.as_str(), &format!("../{p}"));
            }
            // Scripts and nested documents are not assets: their uuids stay as
            // dangling names (a runtime that never loads).
        }
        Ok(self.data_uris(&page))
    }
}

/// The pages of the board, in order: `(uuid, title)`.
fn board_pages(board: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = board;
    while let Some(a) = rest.find("<section") {
        let sec = &rest[a..];
        let end = sec.find("</section>").unwrap_or(sec.len());
        let s = &sec[..end];
        let title = s
            .find("<h2")
            .and_then(|h| {
                let t = &s[h..];
                let open = t.find('>')? + 1;
                let close = t.find("</h2>")?;
                Some(crate::dom::collapse(&unescape(&t[open..close])))
            })
            .unwrap_or_default();
        if let Some(u) = s.find("about:blank#") {
            let id: String = s[u + 12..]
                .chars()
                .take_while(|c| c.is_ascii_hexdigit() || *c == '-')
                .collect();
            out.push((id, title));
        }
        rest = &sec[end.min(sec.len())..];
        if end == sec.len() {
            break;
        }
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Unpacks an export into bundle files (module docs).
pub fn unpack(html: &str) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut u = Unpacker {
        files: BTreeMap::new(),
        total: 0,
    };
    let title = island(html, "__bundler/template")
        .and_then(|t| serde_json::from_str::<String>(t).ok())
        .and_then(|t| crate::dom::title(&crate::dom::parse(&t)))
        .or_else(|| crate::dom::title(&crate::dom::parse(&html[..html.len().min(4096)])))
        .unwrap_or_else(|| "Claude Design export".into());
    let order: Vec<String> = island(html, "__bundler/page_order")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(serde_json::from_str::<Value>)
        .transpose()
        .map_err(|e| format!("the page order is not JSON: {e}"))?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let mut pages = Vec::new();
    if order.is_empty() {
        // A single page's bundle.
        let page = u.page(html, 0)?;
        let path = format!("pages/01-{}.html", kebab(&title));
        u.total += page.len();
        u.files.insert(path.clone(), page.into_bytes());
        pages.push(IndexedPage {
            path,
            title: title.clone(),
            uuid: String::new(),
        });
    } else {
        let manifest: BTreeMap<String, Entry> =
            serde_json::from_str(island(html, "__bundler/manifest").unwrap_or("{}"))
                .map_err(|e| format!("the manifest is not JSON: {e}"))?;
        let board: String =
            serde_json::from_str(island(html, "__bundler/template").unwrap_or("\"\""))
                .map_err(|e| format!("the board is not a JSON string: {e}"))?;
        let titles: BTreeMap<String, String> = board_pages(&board).into_iter().collect();
        for (n, uuid) in order.iter().enumerate() {
            let Some(e) = manifest.get(uuid) else {
                return Err(format!("page {uuid} is not in the manifest"));
            };
            let text = decode(e, MAX_BUNDLE_BYTES)?;
            let text = String::from_utf8(text).map_err(|_| format!("page {uuid} is not UTF-8"))?;
            let page = u.page(&text, 1)?;
            let title = titles.get(uuid).cloned().unwrap_or_else(|| {
                crate::dom::title(&crate::dom::parse(&page)).unwrap_or_default()
            });
            // `06 — Applied: Homepage` → `pages/06-applied-homepage.html`.
            let slug = kebab(&title);
            let path = if slug.starts_with(|c: char| c.is_ascii_digit()) {
                format!("pages/{slug}.html")
            } else {
                format!("pages/{:02}-{slug}.html", n + 1)
            };
            u.total += page.len();
            if u.total > MAX_BUNDLE_BYTES {
                return Err("the export unpacks to more than a bundle may hold".into());
            }
            u.files.insert(path.clone(), page.into_bytes());
            pages.push(IndexedPage {
                path,
                title,
                uuid: uuid.clone(),
            });
        }
    }
    let index = PagesIndex {
        format: EXPORT_INDEX_FORMAT.into(),
        title,
        pages,
    };
    u.files.insert(
        "design.json".into(),
        serde_json::to_vec_pretty(&index).map_err(|e| e.to_string())?,
    );
    Ok(u.files)
}

/// A resource of a packed page: `(uuid, mime, bytes)`.
pub type PackedResource<'a> = (&'a str, &'a str, Vec<u8>);
/// A packed page: `(uuid, board title, page html, resources)`.
pub type PackedPage<'a> = (&'a str, &'a str, &'a str, Vec<PackedResource<'a>>);

/// Builds an export (root with nested page bundles) from pages: the inverse
/// of [`unpack`], for tests and fixtures.
pub fn pack(title: &str, pages: &[PackedPage<'_>]) -> String {
    use std::io::Write as _;
    let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
    let gz = |b: &[u8]| {
        let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(b).expect("in memory");
        e.finish().expect("in memory")
    };
    let script = |ty: &str, body: &str| format!("<script type=\"{ty}\">{body}</script>\n");
    let mut manifest = serde_json::Map::new();
    let mut board = format!("<!DOCTYPE html><html><head><title>{title}</title></head><body>");
    for (uuid, ptitle, html, res) in pages {
        let mut inner = serde_json::Map::new();
        for (id, mime, bytes) in res {
            inner.insert(
                (*id).to_string(),
                serde_json::json!({"mime": mime, "compressed": false, "data": b64(bytes)}),
            );
        }
        let page = format!(
            "<!DOCTYPE html><html><body>\n{}{}{}{}</body></html>",
            script("__bundler/manifest", &Value::Object(inner).to_string()),
            script("__bundler/page_order", "[]"),
            script("__bundler/ext_resources", "[]"),
            script(
                "__bundler/template",
                &Value::String((*html).to_string())
                    .to_string()
                    .replace("</", "<\\/")
            ),
        );
        manifest.insert(
            (*uuid).to_string(),
            serde_json::json!({"mime": "text/html", "compressed": true, "data": b64(&gz(page.as_bytes()))}),
        );
        board.push_str(&format!(
            "<section class=\"board\"><h2>{}</h2><iframe src=\"about:blank#{uuid}\" title=\"{}\"></iframe></section>",
            crate::dom::escape(ptitle, false),
            crate::dom::escape(ptitle, true)
        ));
    }
    board.push_str("</body></html>");
    let order: Vec<&str> = pages.iter().map(|p| p.0).collect();
    format!(
        "<!DOCTYPE html><html><head><title>{title}</title></head><body>\n{}{}{}{}</body></html>",
        script("__bundler/manifest", &Value::Object(manifest).to_string()),
        script(
            "__bundler/page_order",
            &serde_json::to_string(&order).expect("strings")
        ),
        script("__bundler/ext_resources", "[]"),
        script(
            "__bundler/template",
            &Value::String(board).to_string().replace("</", "<\\/")
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpacks_nested_pages_and_dedupes_assets() {
        let font = b"wOF2 fake font".to_vec();
        let page = |h: &str| {
            format!(
                "<html><head><title>{h}</title><script src=\"rt-uuid\"></script><style>@font-face{{font-family:'X';src:url(\"font-uuid\") format('woff2')}}</style></head>\
                 <body><h1>{h}</h1><img src=\"data:image/png;base64,iVBORw0K\"></body></html>"
            )
        };
        let home = page("Home");
        let colour = page("Colour");
        let export = pack(
            "Guide",
            &[
                (
                    "11111111-1111-1111-1111-111111111111",
                    "01 — Colour",
                    &colour,
                    vec![
                        ("font-uuid", "font/woff2", font.clone()),
                        ("rt-uuid", "text/javascript", b"x()".to_vec()),
                    ],
                ),
                (
                    "22222222-2222-2222-2222-222222222222",
                    "06 — Applied: Homepage",
                    &home,
                    vec![("font-uuid", "font/woff2", font.clone())],
                ),
            ],
        );
        assert!(is_export(&export));
        let files = unpack(&export).unwrap();
        let paths: Vec<&str> = files.keys().map(String::as_str).collect();
        let fpath = format!("assets/{}.woff2", &sha256_hex(&font)[..16]);
        assert!(paths.contains(&"pages/01-colour.html"), "{paths:?}");
        assert!(paths.contains(&"pages/06-applied-homepage.html"));
        assert!(paths.contains(&fpath.as_str()));
        assert!(paths.contains(&"design.json"));
        assert_eq!(paths.iter().filter(|p| p.ends_with(".woff2")).count(), 1);
        assert_eq!(paths.iter().filter(|p| p.ends_with(".png")).count(), 1);
        assert!(!paths.iter().any(|p| p.ends_with(".js")));
        let html = std::str::from_utf8(&files["pages/06-applied-homepage.html"]).unwrap();
        assert!(html.contains(&format!("url(\"../{fpath}\")")));
        assert!(!html.contains("data:image"));
        let idx: PagesIndex = serde_json::from_slice(&files["design.json"]).unwrap();
        assert_eq!(idx.title, "Guide");
        assert_eq!(idx.pages[1].title, "06 — Applied: Homepage");
    }
}
