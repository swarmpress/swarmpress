//! `swarmpress-wp-migrate`: a JSON-block site moved onto a WordPress sandbox (plan M8).
//!
//! ```text
//! swarmpress-wp-migrate plan    --content DIR --out plan.json
//! swarmpress-wp-migrate apply   --plan plan.json --sandbox URL --repo URL [--branch NAME] [--assets DIR]
//! swarmpress-wp-migrate export  --sandbox URL --repo URL --public-origin URL --out DIR
//! swarmpress-wp-migrate compare --reference DIR --live URL --export DIR --out report.json
//!                               [--plan plan.json] [--cache DIR] [--skip PREFIX]…
//! ```
//!
//! `apply` writes the plan through the sandbox's REST API on a branch of its own, as the CEO, then
//! opens a change request and merges it into `live` (ADR-0083 §5). A site image the pages name by
//! path (`/giulia_rossi.png`) and `--assets` holds is uploaded as media first, and the pages point
//! at the upload. `export` crawls `live` as a
//! visitor into a release directory (`release.json` and the files by path). `compare` takes the URL
//! list from a build of the frozen theme (`--reference`, every `index.html` under it), fetches each
//! URL from the live site (cached under `--cache`), and compares it with the export.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use content_import_wp::compare::{compare_with, Facts};
use content_import_wp::plan::{plan, Doc, MenuItem, Plan};
use content_import_wp::Site;
use serde_json::{json, Value};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn need(args: &[String], name: &str) -> Result<String> {
    arg(args, name).ok_or_else(|| anyhow!("missing {name}"))
}

fn all(args: &[String], name: &str) -> Vec<String> {
    args.windows(2)
        .filter(|w| w[0] == name)
        .map(|w| w[1].clone())
        .collect()
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("plan") => {
            let site = Site::read(Path::new(&need(&args, "--content")?)).map_err(|e| anyhow!(e))?;
            let p = plan(&site);
            std::fs::write(need(&args, "--out")?, serde_json::to_string_pretty(&p)?)?;
            eprintln!(
                "{} documents ({} posts), {} empty routes, empty block kinds: {:?}",
                p.docs.len(),
                p.docs.iter().filter(|d| d.post_type == "post").count(),
                p.report.empty_routes.len(),
                p.report.empty_blocks
            );
            Ok(())
        }
        Some("apply") => {
            let p: Value = serde_json::from_str(&std::fs::read_to_string(need(&args, "--plan")?)?)?;
            let wp = Wp::new(&need(&args, "--sandbox")?, &need(&args, "--repo")?);
            let branch = arg(&args, "--branch").unwrap_or_else(|| "import-site".into());
            let assets = arg(&args, "--assets").map(PathBuf::from);
            apply(
                &wp,
                &serde_json::from_value(p).context("the plan")?,
                &branch,
                assets.as_deref(),
            )
            .await
        }
        Some("export") => {
            let wp = Wp::new(&need(&args, "--sandbox")?, &need(&args, "--repo")?);
            export(
                &wp,
                &need(&args, "--public-origin")?,
                Path::new(&need(&args, "--out")?),
            )
            .await
        }
        Some("compare") => {
            let reference = PathBuf::from(need(&args, "--reference")?);
            let live = need(&args, "--live")?;
            let out = PathBuf::from(need(&args, "--export")?);
            let cache = arg(&args, "--cache").map(PathBuf::from);
            let skip = all(&args, "--skip");
            // The most pages one source is published on (from the plan): above that, the theme's.
            let shared = match arg(&args, "--plan") {
                Some(p) => {
                    let plan: Plan = serde_json::from_str(&std::fs::read_to_string(p)?)?;
                    let mut per: BTreeMap<String, usize> = BTreeMap::new();
                    for d in &plan.docs {
                        let src = d
                            .meta
                            .get("_swarmpress_source")
                            .cloned()
                            .unwrap_or_default();
                        *per.entry(src).or_default() += 1;
                    }
                    per.into_values().max()
                }
                None => None,
            };
            let report =
                compare_site(&reference, &live, &out, cache.as_deref(), &skip, shared).await?;
            let s = &report.summary;
            eprintln!(
                "{}/{} URLs pass; status {} · content below {} · titles differ {} · missing links {} · median content {}‰ · extra {}",
                s.passed, s.urls, s.status_mismatches, s.content_below, s.titles_differ, s.missing_links, s.content_median_permille, s.extra_in_export.len()
            );
            std::fs::write(
                need(&args, "--out")?,
                serde_json::to_string_pretty(&report)?,
            )?;
            Ok(())
        }
        _ => bail!(
            "usage: swarmpress-wp-migrate plan|apply|export|compare (see the source's header)"
        ),
    }
}

// ------------------------------------------------------------------ the sandbox

struct Wp {
    http: reqwest::Client,
    sandbox: String,
    repo: String,
}

impl Wp {
    fn new(sandbox: &str, repo: &str) -> Wp {
        Wp {
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("an HTTP client"),
            sandbox: sandbox.trim_end_matches('/').to_string(),
            repo: repo.to_string(),
        }
    }

    async fn repo(&self, msg: Value) -> Result<Value> {
        let v: Value = self
            .http
            .post(&self.repo)
            .json(&msg)
            .send()
            .await?
            .json()
            .await?;
        if let Some(e) = v.get("error") {
            bail!("repo {}: {e}", msg["op"]);
        }
        Ok(v)
    }

    /// A REST call (`/wp/v2/pages`), through `?rest_route=` as the sandbox serves it.
    async fn rest(
        &self,
        method: reqwest::Method,
        route: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Value)> {
        let (path, query) = route.split_once('?').unwrap_or((route, ""));
        let url = format!(
            "{}/?rest_route={}{}{}",
            self.sandbox,
            path,
            if query.is_empty() { "" } else { "&" },
            query
        );
        let mut req = self.http.request(method, url);
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await?;
        let status = res.status().as_u16();
        let text = res.text().await?;
        Ok((
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        ))
    }

    async fn rest_ok(&self, method: reqwest::Method, route: &str, body: &Value) -> Result<Value> {
        let (status, v) = self.rest(method, route, Some(body)).await?;
        if !(200..300).contains(&status) {
            bail!("{route}: {status} {}", truncate(&v.to_string(), 400));
        }
        Ok(v)
    }
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

const CEO: &str = r#"{"kind":"human","id":"ceo"}"#;

async fn apply(wp: &Wp, p: &Plan, branch: &str, assets: Option<&Path>) -> Result<()> {
    let ceo: Value = serde_json::from_str(CEO)?;
    wp.repo(json!({"op": "branch.create", "name": branch, "from": "live"}))
        .await?;
    wp.repo(json!({"op": "session.set", "branch": branch, "user_id": 1, "author": ceo, "read_only": false}))
        .await?;
    use reqwest::Method as M;
    wp.rest_ok(
        M::POST,
        "/swarmpress/v1/theme",
        &json!({"stylesheet": p.theme}),
    )
    .await?;
    wp.rest_ok(
        M::POST,
        "/wp/v2/settings",
        &json!({"title": p.title, "description": p.tagline}),
    )
    .await?;

    // Terms first, by name.
    let mut categories: BTreeMap<String, u64> = BTreeMap::new();
    let mut tags: BTreeMap<String, u64> = BTreeMap::new();
    for d in &p.docs {
        if let Some(c) = &d.category {
            if !categories.contains_key(c) {
                categories.insert(c.clone(), term(wp, "categories", c).await?);
            }
        }
        for t in &d.tags {
            if !tags.contains_key(t) {
                tags.insert(t.clone(), term(wp, "tags", t).await?);
            }
        }
    }

    let docs = match assets {
        Some(dir) => upload_assets(wp, &p.docs, dir).await?,
        None => p.docs.clone(),
    };
    let mut ids: BTreeMap<String, u64> = BTreeMap::new();
    let started = std::time::Instant::now();
    for (i, d) in docs.iter().enumerate() {
        let id = write_doc(wp, d, &categories, &tags)
            .await
            .with_context(|| d.route.clone())?;
        ids.insert(d.route.clone(), id);
        if (i + 1).is_multiple_of(50) {
            eprintln!(
                "{} of {} written ({}s)",
                i + 1,
                p.docs.len(),
                started.elapsed().as_secs()
            );
        }
    }
    if let Some(home) = ids.get("/") {
        wp.rest_ok(
            M::POST,
            "/wp/v2/settings",
            &json!({"show_on_front": "page", "page_on_front": home}),
        )
        .await?;
    }
    for (lang, items) in &p.menus {
        let content: String = items.iter().map(nav_markup).collect();
        wp.rest_ok(
            M::POST,
            "/wp/v2/navigation",
            &json!({"title": format!("Navigation ({lang})"), "slug": format!("nav-{lang}"), "status": "publish", "content": content}),
        )
        .await?;
    }
    let cr = wp
        .repo(json!({"op": "cr.open", "source": branch, "title": format!("Import: {} ({} documents)", p.title, p.docs.len()), "author": ceo}))
        .await?;
    let merged = wp
        .repo(json!({"op": "cr.merge", "id": cr["id"], "author": ceo}))
        .await?;
    let release = wp.repo(json!({"op": "release", "name": "import"})).await?;
    eprintln!(
        "{} documents imported in {}s; change request {} merged into live at {}; release {}",
        p.docs.len(),
        started.elapsed().as_secs(),
        cr["id"],
        merged["head"],
        release["id"]
    );
    Ok(())
}

/// Uploads the site images the documents name by path (`src="/x.png"`) and `dir` holds; the
/// documents then point at the uploads.
async fn upload_assets(wp: &Wp, docs: &[Doc], dir: &Path) -> Result<Vec<Doc>> {
    let mut named = std::collections::BTreeSet::new();
    for d in docs {
        for part in d.content.split("src=\"/").skip(1) {
            let name = part.split('"').next().unwrap_or("");
            if !name.is_empty() && !name.contains('/') && dir.join(name).is_file() {
                named.insert(name.to_string());
            }
        }
    }
    let mut urls = BTreeMap::new();
    for name in named {
        let bytes = std::fs::read(dir.join(&name))?;
        let mime = match name.rsplit('.').next().unwrap_or("") {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            _ => "application/octet-stream",
        };
        let res = wp
            .http
            .post(format!("{}/?rest_route=/wp/v2/media", wp.sandbox))
            .header("content-type", mime)
            .header(
                "content-disposition",
                format!("attachment; filename=\"{name}\""),
            )
            .body(bytes)
            .send()
            .await?;
        let status = res.status().as_u16();
        let v: Value = res.json().await?;
        let url = v["source_url"]
            .as_str()
            .filter(|_| status == 201)
            .ok_or_else(|| anyhow!("media {name}: {status} {}", truncate(&v.to_string(), 300)))?;
        let path = url.strip_prefix(&wp.sandbox).unwrap_or(url).to_string();
        eprintln!("uploaded /{name} as {path}");
        urls.insert(name, path);
    }
    Ok(docs
        .iter()
        .map(|d| {
            let mut d = d.clone();
            for (name, path) in &urls {
                d.content = d
                    .content
                    .replace(&format!("src=\"/{name}\""), &format!("src=\"{path}\""));
            }
            d
        })
        .collect())
}

async fn term(wp: &Wp, taxonomy: &str, name: &str) -> Result<u64> {
    let (status, v) = wp
        .rest(
            reqwest::Method::POST,
            &format!("/wp/v2/{taxonomy}"),
            Some(&json!({"name": name})),
        )
        .await?;
    if status == 201 {
        return v["id"].as_u64().ok_or_else(|| anyhow!("{taxonomy}: no id"));
    }
    // An existing term: WordPress names it in the error.
    v["data"]["term_id"].as_u64().ok_or_else(|| {
        anyhow!(
            "{taxonomy} {name}: {status} {}",
            truncate(&v.to_string(), 300)
        )
    })
}

async fn write_doc(
    wp: &Wp,
    d: &Doc,
    categories: &BTreeMap<String, u64>,
    tags: &BTreeMap<String, u64>,
) -> Result<u64> {
    let mut body = json!({
        "title": d.title,
        "slug": d.slug,
        "status": "publish",
        "content": d.content,
        "excerpt": d.excerpt,
        "meta": d.meta,
    });
    if let Some(date) = &d.date {
        body["date"] = json!(date);
    }
    if d.post_type == "post" {
        if let Some(c) = d.category.as_ref().and_then(|c| categories.get(c)) {
            body["categories"] = json!([c]);
        }
        body["tags"] = json!(d
            .tags
            .iter()
            .filter_map(|t| tags.get(t))
            .collect::<Vec<_>>());
    }
    let route = if d.post_type == "post" {
        "/wp/v2/posts"
    } else {
        "/wp/v2/pages"
    };
    let v = wp.rest_ok(reqwest::Method::POST, route, &body).await?;
    v["id"].as_u64().ok_or_else(|| anyhow!("no id"))
}

fn nav_markup(item: &MenuItem) -> String {
    let attrs =
        json!({"label": item.label, "url": item.url, "kind": "custom", "isTopLevelLink": true});
    if item.children.is_empty() {
        return format!("<!-- wp:navigation-link {attrs} /-->");
    }
    let inner: String = item.children.iter().map(nav_markup).collect();
    let attrs = json!({"label": item.label, "url": item.url, "kind": "custom"});
    format!("<!-- wp:navigation-submenu {attrs} -->{inner}<!-- /wp:navigation-submenu -->")
}

// ------------------------------------------------------------------ the export

async fn export(wp: &Wp, public_origin: &str, out: &Path) -> Result<()> {
    wp.repo(json!({"op": "session.set", "branch": "live", "user_id": 0, "author": {"kind": "system", "id": "visitor"}, "read_only": true}))
        .await?;
    let mut crawler =
        site_export::Crawler::full(site_export::Options::new(&wp.sandbox, public_origin));
    let started = std::time::Instant::now();
    let mut n = 0usize;
    while let Some(path) = crawler.next_path() {
        let res = wp
            .http
            .get(format!("{}{}", wp.sandbox, path))
            .send()
            .await?;
        let status = res.status().as_u16();
        let content_type = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let location = res
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let body = res.bytes().await?.to_vec();
        crawler.feed(site_export::Response {
            status,
            content_type,
            location,
            body,
        });
        n += 1;
        if n.is_multiple_of(200) {
            eprintln!("{n} fetched ({}s)", started.elapsed().as_secs());
        }
    }
    let e = crawler.finish();
    std::fs::create_dir_all(out.join("files"))?;
    for (path, f) in &e.release.files {
        let file = out
            .join("files")
            .join(site_export::Release::file_path(path, &f.content_type).trim_start_matches('/'));
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let blob = e
            .blobs
            .get(&f.sha256)
            .ok_or_else(|| anyhow!("no blob for {path}"))?;
        std::fs::write(file, blob)?;
    }
    std::fs::write(
        out.join("release.json"),
        serde_json::to_string_pretty(&e.release)?,
    )?;
    std::fs::write(
        out.join("export-report.json"),
        serde_json::to_string_pretty(&e.report)?,
    )?;
    eprintln!(
        "release {}: {} files, {} redirects, {} broken, {} skipped, in {}s",
        e.release.id,
        e.release.files.len(),
        e.release.redirects.len(),
        e.report.broken.len(),
        e.report.skipped.len(),
        started.elapsed().as_secs()
    );
    Ok(())
}

// ------------------------------------------------------------------ the comparison

fn reference_urls(dir: &Path, skip: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d)? {
            let p = e?.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.file_name().is_some_and(|n| n == "index.html") {
                let rel = p
                    .parent()
                    .unwrap_or(dir)
                    .strip_prefix(dir)?
                    .to_string_lossy()
                    .replace('\\', "/");
                let url = if rel.is_empty() {
                    "/".to_string()
                } else {
                    format!("/{rel}/")
                };
                if !skip.iter().any(|s| url.starts_with(s.as_str())) {
                    out.push(url);
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

async fn compare_site(
    reference: &Path,
    live: &str,
    export_dir: &Path,
    cache: Option<&Path>,
    skip: &[String],
    shared: Option<usize>,
) -> Result<content_import_wp::compare::Report> {
    let urls = reference_urls(reference, skip)?;
    let release: site_export::Release =
        serde_json::from_str(&std::fs::read_to_string(export_dir.join("release.json"))?)?;
    let origin = live.trim_end_matches('/').to_string();
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("swarm.press migration check (cinqueterre.travel owner)")
        .build()?;
    let sem = Arc::new(tokio::sync::Semaphore::new(4));
    let mut tasks = Vec::new();
    for url in urls.clone() {
        let http = http.clone();
        let sem = sem.clone();
        let origin = origin.clone();
        let cache = cache.map(Path::to_path_buf);
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;
            fetch_live(&http, &origin, &url, cache.as_deref())
                .await
                .map(|f| (url, f))
        }));
    }
    let mut live_facts = BTreeMap::new();
    for t in tasks {
        let (url, f) = t.await??;
        live_facts.insert(url, f);
    }
    let mut export_facts = BTreeMap::new();
    for (path, f) in &release.files {
        if !f.content_type.starts_with("text/html") {
            continue;
        }
        let file = export_dir
            .join("files")
            .join(site_export::Release::file_path(path, &f.content_type).trim_start_matches('/'));
        let html = std::fs::read_to_string(&file).with_context(|| file.display().to_string())?;
        export_facts.insert(path.clone(), Facts::from_html(200, &html, &origin));
    }
    for path in release.redirects.keys() {
        export_facts.insert(
            path.clone(),
            Facts {
                status: 301,
                ..Facts::default()
            },
        );
    }
    let pages = live_facts.values().filter(|f| f.status == 200).count();
    let shared = shared.unwrap_or(pages / 2);
    eprintln!("the theme's: what more than {shared} of {pages} live pages have");
    Ok(compare_with(&live_facts, &export_facts, shared))
}

async fn fetch_live(
    http: &reqwest::Client,
    origin: &str,
    url: &str,
    cache: Option<&Path>,
) -> Result<Facts> {
    let key = |ext: &str| {
        cache.map(|c| {
            let name = if url == "/" {
                "_root".to_string()
            } else {
                url.trim_matches('/').replace('/', "__")
            };
            c.join(format!("{name}.{ext}"))
        })
    };
    if let (Some(h), Some(s)) = (key("html"), key("status")) {
        if let (Ok(html), Ok(status)) = (std::fs::read_to_string(&h), std::fs::read_to_string(&s)) {
            return Ok(Facts::from_html(
                status.trim().parse().unwrap_or(200),
                &html,
                origin,
            ));
        }
    }
    // A 5xx is the host's moment, not the page: tried again, and never kept.
    let mut tries = 0;
    let (status, html) = loop {
        let res = http.get(format!("{origin}{url}")).send().await?;
        let status = res.status().as_u16();
        let html = res.text().await.unwrap_or_default();
        tries += 1;
        if status < 500 || tries == 4 {
            break (status, html);
        }
        tokio::time::sleep(std::time::Duration::from_secs(2 * tries)).await;
    };
    if status >= 500 {
        bail!("{url}: the live site answered {status} {tries} times");
    }
    if let (Some(h), Some(s)) = (key("html"), key("status")) {
        if let Some(dir) = h.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(h, &html)?;
        std::fs::write(s, status.to_string())?;
    }
    Ok(Facts::from_html(status, &html, origin))
}
