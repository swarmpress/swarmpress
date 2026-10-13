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
//! - **URLs:** a page's and a stylesheet's references to the site itself (links, images,
//!   stylesheets, scripts, fonts in `url()`) are written root-relative (`/vernazza/`), so the same
//!   export is served whole from any host: a preview at `*.pages.dev` loads its own theme files, not
//!   the domain's. What names the site to the outside keeps the public origin: the head's
//!   `<link rel="canonical|alternate|…">` and `<meta>` tags, sitemaps, feeds, robots.txt, and
//!   text in scripts and JSON (the sandbox's origin rewritten to the public origin, JSON-escaped and
//!   URL-encoded forms included).
//! - **The release:** each file's SHA-256, type and size by URL path, redirects, and the release
//!   id, a domain-separated SHA-256 (`swarmpress:release:v1`) over that manifest: the same site
//!   gives the same id. Blobs are returned by digest; a store keeps each once.
//! - **Search:** a static index (`/search-index.json`: url, title, text) built from the pages.
//! - **Incremental** ([`Crawler::incremental`]): the touched URLs (from the change request's
//!   semantic diff), the seeds, and the pages one link away from a touched page are fetched again;
//!   new links are followed; everything else is carried over from the previous release. A touched
//!   page that answers 404 leaves the release.
//! - **Not found:** [`Crawler::feed_not_found`] takes WordPress's answer to a path that does not
//!   exist and keeps it as `/404.html`, the page a static host answers unknown paths with.
//! - **The forecast block** ([`forecast`]): pages that ask for a weather forecast are filled at
//!   export with forecasts the caller fetched ([`Export::fill_forecasts`], [`fill_release`]).
//! - **Cloudflare Pages** ([`cloudflare_pages`]): the release's redirects and the rewrites a
//!   static host needs for non-HTML directory indexes (`/feed/`) as `_redirects`, and `_headers`
//!   (ADR-0091).

pub mod forecast;

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
    /// Where forms that post to WordPress go instead (ADR-0083 §3: the platform's endpoint, which
    /// records each submission in the company's inbox); `None` leaves forms as they are.
    #[serde(default)]
    pub forms_endpoint: Option<String>,
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
            forms_endpoint: None,
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

impl Export {
    /// The places the exported pages' forecast markers ask for.
    pub fn forecast_places(&self) -> Result<BTreeSet<forecast::Place>, String> {
        release_places(&self.release, &|sha: &str| self.blobs.get(sha).cloned())
    }

    /// Fills the exported pages' forecast markers ([`forecast`]); the release's entries and id
    /// follow. Returns how many pages changed.
    pub fn fill_forecasts(
        &mut self,
        forecasts: &BTreeMap<String, forecast::Forecast>,
    ) -> Result<usize, String> {
        let blobs = &self.blobs;
        let changed = fill_release(
            &mut self.release,
            &|sha: &str| blobs.get(sha).cloned(),
            forecasts,
        )?;
        let n = changed.len();
        for (_, body) in changed {
            let sha = hex(&Sha256::digest(&body));
            self.blobs.entry(sha).or_insert(body);
        }
        Ok(n)
    }
}

/// The places the forecast markers of `release`'s HTML files ask for; `read` gives a file's
/// bytes by SHA-256 (a file it cannot give is skipped: an incremental export's carried files).
pub fn release_places(
    release: &Release,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<BTreeSet<forecast::Place>, String> {
    let mut out = BTreeSet::new();
    for (path, f) in &release.files {
        if !is_type(&f.content_type, "html") {
            continue;
        }
        if let Some(body) = read(&f.sha256) {
            out.extend(
                forecast::needed(&String::from_utf8_lossy(&body))
                    .map_err(|e| format!("{path}: {e}"))?,
            );
        }
    }
    Ok(out)
}

/// Fills the forecast markers of `release`'s HTML files from `forecasts` (by
/// [`forecast::Place::key`]): each changed file's entry gets its new SHA-256 and size, the
/// release its new id. Returns the changed files' new bytes by URL path.
pub fn fill_release(
    release: &mut Release,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    forecasts: &BTreeMap<String, forecast::Forecast>,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut changed = BTreeMap::new();
    for (path, f) in release.files.iter_mut() {
        if !is_type(&f.content_type, "html") {
            continue;
        }
        let Some(body) = read(&f.sha256) else {
            continue;
        };
        let html = String::from_utf8_lossy(&body);
        let Some(filled) = forecast::fill(&html, forecasts).map_err(|e| format!("{path}: {e}"))?
        else {
            continue;
        };
        let bytes = filled.into_bytes();
        f.sha256 = hex(&Sha256::digest(&bytes));
        f.size = bytes.len() as u64;
        changed.insert(path.clone(), bytes);
    }
    release.id = release.computed_id();
    Ok(changed)
}

/// Cloudflare Pages' rule files for `release` (ADR-0091), by file name:
/// - `_redirects`: the release's redirects (301), and a rewrite (200) for each directory index
///   that is not HTML (`/feed/` → `/feed/index.xml`), which Pages would not find on its own;
/// - `_headers`: `nosniff` and a referrer policy for every path.
///
/// More rules than Pages accepts (2,000) is an error, not a silently cut list.
pub fn cloudflare_pages(release: &Release) -> Result<Vec<(String, Vec<u8>)>, String> {
    const MAX_RULES: usize = 2_000;
    let mut rules = Vec::new();
    for (from, to) in &release.redirects {
        rules.push(format!("{} {} 301", url_safe(from), url_safe(to)));
    }
    for (path, f) in &release.files {
        if path.ends_with('/') && !is_type(&f.content_type, "html") {
            let file = Release::file_path(path, &f.content_type);
            rules.push(format!("{} /{} 200", url_safe(path), url_safe(&file)));
        }
    }
    if rules.len() > MAX_RULES {
        return Err(format!(
            "{} redirect rules, more than Cloudflare Pages accepts ({MAX_RULES})",
            rules.len()
        ));
    }
    let mut redirects = String::from(
        "# The release's redirects and rewrites (swarm.press site-export, ADR-0091).\n",
    );
    for r in rules {
        redirects.push_str(&r);
        redirects.push('\n');
    }
    let headers = "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n";
    Ok(vec![
        ("_redirects".into(), redirects.into_bytes()),
        ("_headers".into(), headers.as_bytes().to_vec()),
    ])
}

/// A path or URL with its spaces encoded (a `_redirects` line is space-separated).
fn url_safe(s: &str) -> String {
    s.replace(' ', "%20")
}

/// A page's text for the search index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchEntry {
    pub url: String,
    pub title: String,
    pub text: String,
}

/// WordPress endpoints a form may post to; the export sends those forms to the platform.
const FORM_TARGETS: &[&str] = &[
    "/wp-comments-post.php",
    "/wp-admin/admin-post.php",
    "/wp-admin/admin-ajax.php",
];

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
/// Where the not-found page lives (Cloudflare Pages and most static hosts answer unknown paths
/// with it, status 404).
pub const NOT_FOUND: &str = "/404.html";
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
    /// WordPress's page for an unknown path, kept as `/404.html`.
    not_found: Option<Vec<u8>>,
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
            not_found: None,
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
        let mut body = if textual {
            self.rewrite_typed(&response.body, &ct)
        } else {
            response.body.clone()
        };
        if let (true, Some(endpoint)) = (is_type(&ct, "html"), &self.opts.forms_endpoint) {
            body = rewrite_forms(
                &String::from_utf8_lossy(&body),
                &self.opts.public_origin,
                endpoint,
            )
            .into_bytes();
        }
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

    /// WordPress's answer to a path that does not exist (a 404 with an HTML page), kept as
    /// `/404.html` with the public origin and the forms rewritten like any page. Anything else
    /// (a 200 for an unknown path) is ignored: the export then has no not-found page.
    pub fn feed_not_found(&mut self, response: Response) {
        if response.status != 404 || !is_type(&response.content_type, "html") {
            return;
        }
        let mut body = self.rewrite_typed(&response.body, &response.content_type);
        if let Some(endpoint) = &self.opts.forms_endpoint {
            body = rewrite_forms(
                &String::from_utf8_lossy(&body),
                &self.opts.public_origin,
                endpoint,
            )
            .into_bytes();
        }
        self.not_found = Some(body);
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
        if let Some(body) = self.not_found.take() {
            let sha = hex(&Sha256::digest(&body));
            files.insert(
                NOT_FOUND.into(),
                FileEntry {
                    sha256: sha.clone(),
                    content_type: "text/html; charset=UTF-8".into(),
                    size: body.len() as u64,
                },
            );
            self.blobs.entry(sha).or_insert(body);
        }
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

    /// A text body for the release: in a page or a stylesheet, references to the site
    /// root-relative ([`root_relative`]); then the sandbox's origin as the public origin.
    fn rewrite_typed(&self, body: &[u8], content_type: &str) -> Vec<u8> {
        if is_type(content_type, "html") || is_type(content_type, "css") {
            let text = String::from_utf8_lossy(body);
            let html = is_type(content_type, "html");
            self.rewrite(root_relative(&text, &self.opts.origin, html).as_bytes())
        } else {
            self.rewrite(body)
        }
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

/// `text` (a page when `html`, else a stylesheet) with its references to `origin` root-relative:
/// in a page, every tag's attributes (`href`, `src`, `srcset`, `action`…) but those of `<meta>`
/// and of `<link>`s that name the page to the outside (canonical, alternates, shortlink, the API),
/// `url()` in inline styles, and the import map's module URLs; in a stylesheet, its `url()`s.
/// Other scripts and text keep the origin (rewritten to the public origin afterwards).
pub fn root_relative(text: &str, origin: &str, html: bool) -> String {
    let origin = origin.trim_end_matches('/');
    let urls = |t: &str| {
        let mut t = t.to_string();
        for q in ["", "'", "\""] {
            t = t.replace(&format!("url({q}{origin}/"), &format!("url({q}/"));
        }
        t
    };
    if !html {
        return urls(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    // The import map's JSON names the script modules (the navigation's interactivity).
    let mut importmap = false;
    while let Some(i) = rest.find('<') {
        if importmap {
            out.push_str(&rest[..i].replace(&format!("\"{origin}/"), "\"/"));
        } else {
            out.push_str(&urls(&rest[..i]));
        }
        let tail = &rest[i..];
        let end = tail.find('>').map(|j| j + 1).unwrap_or(tail.len());
        let tag = &tail[..end];
        let lower = tag.to_ascii_lowercase();
        importmap = lower.starts_with("<script") && lower.contains("importmap");
        let named = lower.starts_with("<meta")
            || (lower.starts_with("<link")
                && [
                    "canonical",
                    "alternate",
                    "shortlink",
                    "api.w.org",
                    "edituri",
                ]
                .iter()
                .any(|r| lower.contains(r)));
        if named || lower.starts_with("<!--") {
            out.push_str(tag);
        } else {
            let mut t = tag.to_string();
            for q in ["\"", "'"] {
                t = t.replace(&format!("={q}{origin}/"), &format!("={q}/"));
                t = t.replace(&format!("={q}{origin}{q}"), &format!("={q}/{q}"));
            }
            // srcset lists and inline styles name the site after the attribute's start too.
            t = t.replace(&format!(", {origin}/"), ", /");
            out.push_str(&urls(&t));
        }
        rest = &tail[end..];
    }
    out.push_str(&urls(rest));
    out
}

/// Forms that post to one of WordPress's endpoints ([`FORM_TARGETS`]) post to `endpoint` instead,
/// with the endpoint they were meant for as `?to=`.
fn rewrite_forms(html: &str, public_origin: &str, endpoint: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.to_ascii_lowercase().find("<form") {
        out.push_str(&rest[..i]);
        let tag_end = rest[i..].find('>').map(|j| i + j + 1).unwrap_or(rest.len());
        let mut tag = rest[i..tag_end].to_string();
        if let Some(a) = tag.to_ascii_lowercase().find("action=\"") {
            let start = a + 8;
            if let Some(len) = tag[start..].find('"') {
                let value = tag[start..start + len].to_string();
                let path = value
                    .strip_prefix(public_origin)
                    .unwrap_or(&value)
                    .split('?')
                    .next()
                    .unwrap_or("")
                    .to_string();
                if FORM_TARGETS.contains(&path.as_str()) {
                    tag.replace_range(start..start + len, &format!("{endpoint}?to={path}"));
                }
            }
        }
        out.push_str(&tag);
        rest = &rest[tag_end..];
    }
    out.push_str(rest);
    out
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
    // Inline stylesheets name files too: the theme's fonts (`@font-face` from theme.json).
    let mut from = 0;
    while let Some(i) = lower[from..].find("<style") {
        let start = from + i;
        let Some(open) = lower[start..].find('>').map(|j| start + j + 1) else {
            break;
        };
        let end = lower[open..]
            .find("</style")
            .map_or(lower.len(), |j| open + j);
        out.extend(css_links(&html[open..end]));
        from = end;
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
