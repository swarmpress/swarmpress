//! The static export of a WordPress site (ADR-0083): the public site is `live` crawled over HTTP
//! and written as a content-addressed release. No WordPress is ever public.
//!
//! The crate is sans-IO, so the same code runs natively (the runner, the server) and in wasm (the
//! browser, where every request goes through the sandbox's MessagePort): a [`Crawler`] says which
//! path to fetch next ([`Crawler::next_path`]), the caller fetches it from the sandbox checked out on
//! `live` and hands the answer back ([`Crawler::feed`]), and [`Crawler::finish`] assembles the
//! [`Export`].
//!
//! - **What is crawled:** the seeds (home, the sitemap, the feeds, robots.txt), then every
//!   same-origin link, image, stylesheet and script the pages, stylesheets, sitemaps and feeds
//!   reference. WordPress's dynamic endpoints (`/wp-admin/`, `/wp-login.php`, `/wp-json/`,
//!   `xmlrpc.php`, `wp-cron.php`, comment posting) are never exported, and a URL with a query
//!   string is not a static page (it is reported, not exported; static assets keep their files
//!   and drop the `?ver=` WordPress appends).
//! - **URLs:** text bodies (HTML, CSS, JS, XML, JSON, text) have the sandbox's origin rewritten to
//!   the public origin, JSON-escaped forms included.
//! - **The release:** each file's SHA-256, type and size by URL path, redirects, and the release
//!   id, a domain-separated SHA-256 (`swarmpress:release:v1`) over that manifest: the same site
//!   gives the same id. Blobs are returned by digest; a store keeps each once.
//! - **Search:** a static index (`/search-index.json`: url, title, text) built from the pages.
//! - **Incremental** ([`Crawler::incremental`]): the touched URLs (from the change request's
//!   semantic diff), the seeds, and the pages one link away from a touched page are fetched again;
//!   new links are followed; everything else is carried over from the previous release. A touched
//!   page that answers 404 leaves the release.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

/// What the sandbox answered for one path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub content_type: String,
    /// `Location` of a redirect.
    pub location: Option<String>,
    pub body: Vec<u8>,
}

/// One exported file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub sha256: String,
    pub content_type: String,
    pub size: u64,
}

/// A content-addressed release: what the static data plane serves.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Release {
    /// SHA-256 over the manifest (`swarmpress:release:v1`).
    pub id: String,
    /// By URL path (`/`, `/harvest-week/`, `/wp-content/uploads/dot.png`).
    pub files: BTreeMap<String, FileEntry>,
    /// Redirects by URL path, to a path or an absolute URL.
    pub redirects: BTreeMap<String, String>,
}

impl Release {
    /// The id this release's manifest gives: a release whose `id` differs was altered.
    pub fn computed_id(&self) -> String {
        Release::digest(&self.files, &self.redirects)
    }

    fn digest(files: &BTreeMap<String, FileEntry>, redirects: &BTreeMap<String, String>) -> String {
        let manifest = serde_json::json!({ "files": files, "redirects": redirects });
        let mut h = Sha256::new();
        h.update(b"swarmpress:release:v1:");
        h.update(serde_json::to_vec(&manifest).expect("a manifest serializes"));
        hex(&h.finalize())
    }

    /// Where a URL path lives on a static host: `/a/` → `a/index.html` (or `index.xml`, by type).
    pub fn file_path(url_path: &str, content_type: &str) -> String {
        let p = url_path.trim_start_matches('/');
        if p.is_empty() || p.ends_with('/') {
            let ext = if is_type(content_type, "html") {
                "html"
            } else if is_type(content_type, "xml")
                || is_type(content_type, "rss")
                || is_type(content_type, "atom")
            {
                "xml"
            } else if is_type(content_type, "json") {
                "json"
            } else {
                "txt"
            };
            format!("{p}index.{ext}")
        } else {
            p.to_string()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Options {
    /// The origin WordPress believes it has (its `siteurl`), e.g. `http://sandbox.invalid`.
    pub origin: String,
    /// The public origin the export is for, e.g. `https://cinqueterre.travel`.
    pub public_origin: String,
    /// Where crawling starts.
    pub seeds: Vec<String>,
    /// A guard against a runaway crawl.
    pub max_files: usize,
}

impl Options {
    pub fn new(origin: &str, public_origin: &str) -> Options {
        Options {
            origin: origin.trim_end_matches('/').to_string(),
            public_origin: public_origin.trim_end_matches('/').to_string(),
            seeds: ["/", "/wp-sitemap.xml", "/feed/", "/robots.txt"]
                .map(String::from)
                .to_vec(),
            max_files: 20_000,
        }
    }
}

/// Why a URL was not exported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Skipped {
    pub url: String,
    pub reason: String,
    /// The page that linked it.
    pub from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Report {
    pub fetched: usize,
    /// Files taken from the previous release unchanged (incremental).
    pub carried: usize,
    /// Pages that answered 4xx/5xx and who linked them (seeds that do not exist are not listed).
    pub broken: Vec<Skipped>,
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Export {
    pub release: Release,
    /// Bytes of the files fetched in this export, by SHA-256.
    pub blobs: BTreeMap<String, Vec<u8>>,
    pub report: Report,
}

/// A page's text for the search index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchEntry {
    pub url: String,
    pub title: String,
    pub text: String,
}

const DYNAMIC: &[&str] = &[
    "/wp-admin",
    "/wp-login.php",
    "/wp-json",
    "/xmlrpc.php",
    "/wp-cron.php",
    "/wp-comments-post.php",
    "/wp-signup.php",
    "/wp-activate.php",
    "/wp-trackback.php",
];
const SEARCH_INDEX: &str = "/search-index.json";
const SEARCH_TEXT_CHARS: usize = 2_000;

pub struct Crawler {
    opts: Options,
    queue: VecDeque<(String, Option<String>)>,
    /// Paths queued or fetched in this export.
    seen: BTreeSet<String>,
    /// What to fetch with: the path plus the query WordPress gave an asset.
    fetch_as: BTreeMap<String, String>,
    files: BTreeMap<String, FileEntry>,
    redirects: BTreeMap<String, String>,
    blobs: BTreeMap<String, Vec<u8>>,
    search: BTreeMap<String, SearchEntry>,
    report: Report,
    in_flight: Option<(String, Option<String>)>,
    /// Incremental: the previous release, the touched paths and the pages to refresh (one hop).
    prev: Option<Release>,
    prev_search: BTreeMap<String, SearchEntry>,
    touched: BTreeSet<String>,
    refresh: BTreeSet<String>,
}

impl Crawler {
    /// A full export: every page reachable from the seeds.
    pub fn full(opts: Options) -> Crawler {
        let mut c = Crawler {
            queue: VecDeque::new(),
            seen: BTreeSet::new(),
            fetch_as: BTreeMap::new(),
            files: BTreeMap::new(),
            redirects: BTreeMap::new(),
            blobs: BTreeMap::new(),
            search: BTreeMap::new(),
            report: Report::default(),
            in_flight: None,
            prev: None,
            prev_search: BTreeMap::new(),
            touched: BTreeSet::new(),
            refresh: BTreeSet::new(),
            opts,
        };
        for s in c.opts.seeds.clone() {
            c.enqueue(&s, None);
        }
        c
    }

    /// An incremental export after a merge: `touched` are the URL paths the change request's
    /// diff names (new, changed or deleted posts and pages). `prev_search` is the previous
    /// release's search index (`/search-index.json`), so carried pages stay searchable.
    pub fn incremental(
        opts: Options,
        prev: Release,
        prev_search: Vec<SearchEntry>,
        touched: &[String],
    ) -> Crawler {
        let mut c = Crawler::full(opts);
        c.touched = touched.iter().map(|t| normalize_path(t)).collect();
        for t in c.touched.clone() {
            c.enqueue(&t, None);
        }
        c.prev_search = prev_search
            .into_iter()
            .map(|e| (e.url.clone(), e))
            .collect();
        c.prev = Some(prev);
        c
    }

    /// The next path to fetch (with its query, as WordPress linked it), or `None` when done.
    pub fn next_path(&mut self) -> Option<String> {
        assert!(
            self.in_flight.is_none(),
            "feed() the answer to the previous path first"
        );
        let (path, from) = self.queue.pop_front()?;
        let fetch = self
            .fetch_as
            .get(&path)
            .cloned()
            .unwrap_or_else(|| path.clone());
        self.in_flight = Some((path, from));
        Some(fetch)
    }

    /// The answer to the path [`Crawler::next_path`] gave.
    pub fn feed(&mut self, response: Response) {
        let (path, from) = self
            .in_flight
            .take()
            .expect("next_path() gives the path to feed");
        self.report.fetched += 1;
        if (300..400).contains(&response.status) {
            if let Some(loc) = &response.location {
                let target = match self.local_path(loc, &path) {
                    Some(p) => {
                        self.enqueue(&p, Some(path.clone()));
                        p
                    }
                    None => loc.replace(&self.opts.origin, &self.opts.public_origin),
                };
                self.redirects.insert(path, target);
            }
            return;
        }
        if response.status >= 400 {
            let seed = self.opts.seeds.contains(&path);
            if !seed || self.touched.contains(&path) {
                self.report.broken.push(Skipped {
                    url: path.clone(),
                    reason: format!("HTTP {}", response.status),
                    from,
                });
            }
            // A touched page that is gone leaves the release (and any redirect from it).
            self.files.remove(&path);
            self.redirects.remove(&path);
            self.search.remove(&path);
            if let Some(prev) = &mut self.prev {
                prev.files.remove(&path);
            }
            self.prev_search.remove(&path);
            return;
        }
        let ct = response.content_type.clone();
        let textual = is_text(&ct);
        let body = if textual {
            self.rewrite(&response.body)
        } else {
            response.body.clone()
        };
        if textual {
            let text = String::from_utf8_lossy(&response.body).into_owned();
            let links = if is_type(&ct, "html") {
                if let Some(entry) = search_entry(&path, &text) {
                    self.search.insert(path.clone(), entry);
                }
                html_links(&text)
            } else if is_type(&ct, "css") {
                css_links(&text)
            } else if is_type(&ct, "xml") || is_type(&ct, "rss") || is_type(&ct, "atom") {
                xml_links(&text)
            } else {
                vec![]
            };
            let refreshing_from_touched = self.touched.contains(&path);
            for link in links {
                if let Some(p) = self.local_path_or_skip(&link, &path) {
                    if refreshing_from_touched {
                        self.refresh.insert(p.clone());
                    }
                    self.enqueue(&p, Some(path.clone()));
                }
            }
        }
        let sha = hex(&Sha256::digest(&body));
        self.files.insert(
            path,
            FileEntry {
                sha256: sha.clone(),
                content_type: ct,
                size: body.len() as u64,
            },
        );
        self.blobs.entry(sha).or_insert(body);
    }

    /// The release: this export's files over the previous release's (incremental), plus the
    /// search index.
    pub fn finish(mut self) -> Export {
        assert!(
            self.queue.is_empty() && self.in_flight.is_none(),
            "crawl until next_path() is None"
        );
        let mut files = BTreeMap::new();
        let mut redirects = BTreeMap::new();
        let mut search = std::mem::take(&mut self.prev_search);
        if let Some(prev) = self.prev.take() {
            for (p, f) in prev.files {
                if p != SEARCH_INDEX && !self.files.contains_key(&p) {
                    self.report.carried += 1;
                    files.insert(p, f);
                }
            }
            for (p, r) in prev.redirects {
                if !self.files.contains_key(&p) {
                    redirects.insert(p, r);
                }
            }
        }
        files.extend(std::mem::take(&mut self.files));
        redirects.extend(std::mem::take(&mut self.redirects));
        search.extend(std::mem::take(&mut self.search));
        search.retain(|url, _| files.contains_key(url));
        let index: Vec<&SearchEntry> = search.values().collect();
        let bytes = serde_json::to_vec(&index).expect("the index serializes");
        let sha = hex(&Sha256::digest(&bytes));
        files.insert(
            SEARCH_INDEX.into(),
            FileEntry {
                sha256: sha.clone(),
                content_type: "application/json".into(),
                size: bytes.len() as u64,
            },
        );
        self.blobs.insert(sha, bytes);
        let id = Release::digest(&files, &redirects);
        Export {
            release: Release {
                id,
                files,
                redirects,
            },
            blobs: self.blobs,
            report: self.report,
        }
    }

    fn enqueue(&mut self, path: &str, from: Option<String>) {
        let (bare, query) = match path.split_once('?') {
            Some((b, q)) => (b.to_string(), Some(q.to_string())),
            None => (path.to_string(), None),
        };
        if self.seen.contains(&bare) {
            return;
        }
        // Incremental: a page of the previous release is fetched again only when it is a seed,
        // touched, or one link away from a touched page.
        if let Some(prev) = &self.prev {
            let listed = prev.files.contains_key(&bare) || prev.redirects.contains_key(&bare);
            if listed
                && !self.touched.contains(&bare)
                && !self.refresh.contains(&bare)
                && !self.opts.seeds.contains(&bare)
            {
                return;
            }
        }
        if self.seen.len() >= self.opts.max_files {
            self.report.skipped.push(Skipped {
                url: bare,
                reason: format!("more than {} files", self.opts.max_files),
                from,
            });
            return;
        }
        if let Some(q) = query {
            self.fetch_as.insert(bare.clone(), format!("{bare}?{q}"));
        }
        self.seen.insert(bare.clone());
        self.queue.push_back((bare, from));
    }

    /// A link as a local path to export, or `None` (another origin, a fragment, `mailto:`…).
    fn local_path(&self, link: &str, base: &str) -> Option<String> {
        let link = link.trim();
        let link = link.split('#').next().unwrap_or("");
        if link.is_empty() {
            return None;
        }
        let path = if let Some(rest) = link.strip_prefix(&self.opts.origin) {
            if rest.is_empty() {
                "/".to_string()
            } else if rest.starts_with('/') || rest.starts_with('?') {
                rest.to_string()
            } else {
                return None;
            }
        } else if link.starts_with("//")
            || link.contains("://")
            || link.contains(':') && !link.starts_with('/') && !link.starts_with('.')
        {
            return None;
        } else if link.starts_with('/') {
            link.to_string()
        } else {
            let dir = &base[..base.rfind('/').map(|i| i + 1).unwrap_or(0)];
            format!("{dir}{link}")
        };
        Some(normalize_path(&path))
    }

    /// As [`Crawler::local_path`], reporting the local links that are not static.
    fn local_path_or_skip(&mut self, link: &str, base: &str) -> Option<String> {
        let p = self.local_path(&html_unescape(link), base)?;
        let bare = p.split('?').next().unwrap_or("");
        if DYNAMIC.iter().any(|d| {
            bare == *d
                || bare.starts_with(&format!("{d}/"))
                || (d.ends_with(".php") && bare.starts_with(d))
        }) {
            return None;
        }
        if let Some((b, q)) = p.split_once('?') {
            // An asset keeps its file and drops `?ver=`; a page with a query is not static.
            let asset =
                b.rsplit('/').next().is_some_and(|f| f.contains('.')) && !b.ends_with(".php");
            if !(asset && q.split('&').all(|kv| kv.starts_with("ver="))) {
                if !self.report.skipped.iter().any(|s| s.url == p) {
                    self.report.skipped.push(Skipped {
                        url: p.clone(),
                        reason: "a URL with a query string is not a static page".into(),
                        from: Some(base.to_string()),
                    });
                }
                return None;
            }
        }
        Some(p)
    }

    fn rewrite(&self, body: &[u8]) -> Vec<u8> {
        let text = String::from_utf8_lossy(body);
        let o = &self.opts.origin;
        let p = &self.opts.public_origin;
        let mut out = text
            .replace(o.as_str(), p.as_str())
            .replace(&o.replace('/', "\\/"), &p.replace('/', "\\/"));
        // URL-encoded, as WordPress puts its own URLs in query strings (oEmbed discovery links).
        for upper in [true, false] {
            out = out.replace(&url_encode(o, upper), &url_encode(p, upper));
        }
        out.into_bytes()
    }
}

/// `s` percent-encoded as `encodeURIComponent` does, with upper- or lower-case hex.
fn url_encode(s: &str, upper: bool) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ if upper => format!("%{b:02X}"),
            _ => format!("%{b:02x}"),
        })
        .collect()
}

/// `/a/./b/../c` → `/a/c`; keeps a trailing slash and the query.
fn normalize_path(p: &str) -> String {
    let (path, query) = match p.split_once('?') {
        Some((a, q)) => (a, Some(q)),
        None => (p, None),
    };
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    let trailing =
        path.ends_with('/') || path.is_empty() || path.ends_with("/.") || path.ends_with("/..");
    let mut out = format!("/{}", parts.join("/"));
    if trailing && !out.ends_with('/') {
        out.push('/');
    }
    match query {
        Some(q) if !q.is_empty() => format!("{out}?{q}"),
        _ => out,
    }
}

fn is_type(ct: &str, sub: &str) -> bool {
    ct.split(';')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .contains(sub)
}

fn is_text(ct: &str) -> bool {
    let t = ct
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    t.starts_with("text/")
        || ["json", "xml", "javascript", "rss", "atom", "svg"]
            .iter()
            .any(|s| t.contains(s))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&#038;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
}

/// `href`, `src` and `srcset` attribute values, in document order.
fn html_links(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    for attr in ["href=", "src=", "srcset="] {
        let mut from = 0;
        while let Some(i) = lower[from..].find(attr) {
            let at = from + i + attr.len();
            from = at;
            // An attribute, not the end of another word (data-src=).
            let before = lower[..from - attr.len()].chars().last();
            if before.is_some_and(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                continue;
            }
            let rest = &html[at..];
            let value = match rest.chars().next() {
                Some(q @ ('"' | '\'')) => rest[1..].split(q).next().unwrap_or(""),
                _ => rest
                    .split(|c: char| c.is_whitespace() || c == '>')
                    .next()
                    .unwrap_or(""),
            };
            if attr == "srcset=" {
                out.extend(
                    value
                        .split(',')
                        .filter_map(|c| c.split_whitespace().next())
                        .map(str::to_string),
                );
            } else {
                out.push(value.to_string());
            }
        }
    }
    out
}

/// `url(…)` and `@import "…"` in a stylesheet.
fn css_links(css: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = css[from..].find("url(") {
        let at = from + i + 4;
        let end = css[at..].find(')').map(|e| at + e).unwrap_or(css.len());
        let v = css[at..end].trim().trim_matches(|c| c == '"' || c == '\'');
        if !v.starts_with("data:") {
            out.push(v.to_string());
        }
        from = end;
    }
    let mut from = 0;
    while let Some(i) = css[from..].find("@import") {
        let at = from + i + "@import".len();
        let end = css[at..].find(';').map(|e| at + e).unwrap_or(css.len());
        let v = css[at..end].trim().trim_matches(|c| c == '"' || c == '\'');
        if !v.starts_with("url(") {
            out.push(v.to_string());
        }
        from = end;
    }
    out
}

/// Sitemap `<loc>`, feed `<link>` and enclosure `url="…"` values.
fn xml_links(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    for tag in ["loc", "link"] {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        let mut from = 0;
        while let Some(i) = xml[from..].find(&open) {
            let at = from + i + open.len();
            let end = xml[at..].find(&close).map(|e| at + e).unwrap_or(xml.len());
            out.push(
                xml[at..end]
                    .trim()
                    .trim_start_matches("<![CDATA[")
                    .trim_end_matches("]]>")
                    .to_string(),
            );
            from = end;
        }
    }
    let mut from = 0;
    while let Some(i) = xml[from..].find("url=\"") {
        let at = from + i + 5;
        let end = xml[at..].find('"').map(|e| at + e).unwrap_or(xml.len());
        out.push(xml[at..end].to_string());
        from = end;
    }
    out
}

/// The page's title and readable text (the main element when there is one), for search.
fn search_entry(path: &str, html: &str) -> Option<SearchEntry> {
    let lower = html.to_ascii_lowercase();
    let title = lower.find("<title").and_then(|i| {
        let start = i + lower[i..].find('>')? + 1;
        let end = start + lower[start..].find("</title>")?;
        Some(html_unescape(html[start..end].trim()))
    })?;
    let (start, end) = match (lower.find("<main"), lower.rfind("</main>")) {
        (Some(s), Some(e)) if s < e => (s, e),
        _ => (
            lower.find("<body").unwrap_or(0),
            lower.rfind("</body>").unwrap_or(html.len()),
        ),
    };
    let mut text = String::new();
    let mut skip_until: Option<&str> = None;
    let mut in_tag = false;
    let body = &html[start..end];
    let lower_body = &lower[start..end];
    let mut i = 0;
    while i < body.len() {
        if let Some(close) = skip_until {
            match lower_body[i..].find(close) {
                Some(j) => {
                    i += j + close.len();
                    skip_until = None;
                    continue;
                }
                None => break,
            }
        }
        let c = body[i..].chars().next().expect("in bounds");
        if c == '<' {
            if lower_body[i..].starts_with("<script") {
                skip_until = Some("</script>");
            } else if lower_body[i..].starts_with("<style") {
                skip_until = Some("</style>");
            }
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
            text.push(' ');
        } else if !in_tag {
            text.push(c);
        }
        i += c.len_utf8();
    }
    let text: String = html_unescape(&text.split_whitespace().collect::<Vec<_>>().join(" "))
        .chars()
        .take(SEARCH_TEXT_CHARS)
        .collect();
    Some(SearchEntry {
        url: path.to_string(),
        title,
        text,
    })
}

#[cfg(test)]
mod tests;
