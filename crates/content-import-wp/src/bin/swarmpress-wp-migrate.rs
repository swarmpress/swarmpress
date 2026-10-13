//! `swarmpress-wp-migrate`: a JSON-block site moved onto a WordPress sandbox (plan M8).
//!
//! ```text
//! swarmpress-wp-migrate plan    --content DIR --out plan.json [--newsletter] [--theme-data FILE]
//! swarmpress-wp-migrate apply   --plan plan.json --sandbox URL --repo URL [--branch NAME] [--assets DIR]
//!                               [--theme-data FILE]
//! swarmpress-wp-migrate export  --sandbox URL --repo URL --public-origin URL --out DIR
//!                               [--forms-endpoint URL] [--forecasts DIR]
//! swarmpress-wp-migrate forecast --export DIR [--forecasts DIR]
//! swarmpress-wp-migrate compare --reference DIR --live URL --export DIR --out report.json
//!                               [--plan plan.json] [--cache DIR] [--skip PREFIX]…
//! ```
//!
//! `plan` leaves the newsletter out (the owner's decision of 2026-10-13: no form until the central
//! server has a public address, a privacy line and a double opt-in); `--newsletter` composes it
//! (the home's form, the header's button, the footer's link), for an export with
//! `--forms-endpoint`. `--theme-data` (a `ThemeData` JSON file, ADR-0093; its font files are paths
//! relative to it) imports the site onto the neutral theme `canvas` and writes its design as data
//! before the documents (`content_import_wp::theme`: fonts, global styles, template parts,
//! templates, patterns, navigation, each updated by slug when it exists); without it the site gets
//! the fallback theme folder (Coast, or cinqueterre.travel's own until its design runs on data).
//! On `apply` it replaces the plan's theme data. `apply` writes the plan through the sandbox's REST API on a branch of its own, as the CEO, then
//! opens a change request and merges it into `live` (ADR-0083 §5). A site image the pages name by
//! path (`/giulia_rossi.png`) and `--assets` holds is uploaded as media first, and the pages point
//! at the upload. `export` crawls `live` as a
//! visitor into a release directory (`release.json` and the files by path, plus WordPress's
//! not-found page as `404.html` and Cloudflare Pages' `_redirects` and `_headers`, ADR-0091); forms
//! that post to WordPress post to `--forms-endpoint` (the platform's `/f/{company}`) instead; pages
//! with a forecast block get the forecast, fetched from Open-Meteo (or read from `--forecasts`, a
//! directory of recorded answers named `{lat},{lng}.json`). `forecast` fetches the forecasts again
//! and fills an export directory in place: the daily rebuild of a static site. `compare` takes the URL
//! list from a build of the frozen theme (`--reference`, every `index.html` under it), fetches each
//! URL from the live site (cached under `--cache`), and compares it with the export.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use content_import_wp::compare::{compare_with, Facts};
use content_import_wp::compose;
use content_import_wp::plan::{plan_with_theme, Doc, MenuItem, Plan};
use content_import_wp::theme::{self, Call, Kind};
use content_import_wp::theme_data::{ThemeData, THEME_DATA_FORMAT};
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
            let opts = compose::Options {
                newsletter: args.iter().any(|a| a == "--newsletter"),
            };
            let theme_data = arg(&args, "--theme-data")
                .map(|f| read_theme_data(Path::new(&f)))
                .transpose()?;
            let p = plan_with_theme(&site, opts, theme_data);
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
            let mut p: Plan = serde_json::from_value(p).context("the plan")?;
            if let Some(f) = arg(&args, "--theme-data") {
                p.theme_data = Some(read_theme_data(Path::new(&f))?);
                p.theme = theme::BASE_THEME.into();
            }
            apply(&wp, &p, &branch, assets.as_deref()).await
        }
        Some("export") => {
            let wp = Wp::new(&need(&args, "--sandbox")?, &need(&args, "--repo")?);
            export(
                &wp,
                &need(&args, "--public-origin")?,
                Path::new(&need(&args, "--out")?),
                arg(&args, "--forms-endpoint"),
                arg(&args, "--forecasts").map(PathBuf::from).as_deref(),
            )
            .await
        }
        Some("forecast") => {
            refill_forecasts(
                Path::new(&need(&args, "--export")?),
                arg(&args, "--forecasts").map(PathBuf::from).as_deref(),
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
            "usage: swarmpress-wp-migrate plan|apply|export|forecast|compare (see the source's header)"
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
    // The design: as data on canvas (ADR-0093), else the fallback theme folder.
    let theme_menus = match &p.theme_data {
        Some(data) => write_theme(wp, data, &p.theme).await?,
        None => {
            wp.rest_ok(
                M::POST,
                "/swarmpress/v1/theme",
                &json!({"stylesheet": p.theme}),
            )
            .await?;
            std::collections::BTreeSet::new()
        }
    };
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

    // Terms the composed pages refer to (the latest stories' language tag), even without a post.
    for d in &p.docs {
        for (tax, name) in compose::term_refs(&d.content) {
            let map = match tax.as_str() {
                "post_tag" => &mut tags,
                "category" => &mut categories,
                other => bail!("{}: a reference to a {other} term", d.route),
            };
            if !map.contains_key(&name) {
                let rest = if tax == "post_tag" {
                    "tags"
                } else {
                    "categories"
                };
                map.insert(name.clone(), term(wp, rest, &name).await?);
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
    // The site's menus, by slug (a second import updates them); a menu the design's data wrote
    // stays the design's.
    for (lang, items) in &p.menus {
        let slug = format!("nav-{lang}");
        if theme_menus.contains(&slug) {
            continue;
        }
        let content: String = items.iter().map(nav_markup).collect();
        upsert(
            wp,
            Kind::Navigation,
            &p.theme,
            &slug,
            &json!({"title": format!("Navigation ({lang})"), "slug": slug, "status": "publish", "content": content}),
        )
        .await?;
    }
    // The theme's named menus (`{name}-{lang}`: the wordmark, the header's button, the footer).
    for (name, by_lang) in &p.named_menus {
        for (lang, items) in by_lang {
            let slug = format!("{name}-{lang}");
            if theme_menus.contains(&slug) {
                continue;
            }
            let content: String = items.iter().map(nav_markup).collect();
            upsert(
                wp,
                Kind::Navigation,
                &p.theme,
                &slug,
                &json!({"title": format!("{name} ({lang})"), "slug": slug, "status": "publish", "content": content}),
            )
            .await?;
        }
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

/// A `ThemeData` JSON file, its font files made paths from here (they are relative to the file)
/// and checked against their SHA-256: a file that is not the one the data names fails the import.
fn read_theme_data(file: &Path) -> Result<ThemeData> {
    use sha2::{Digest as _, Sha256};
    let text = std::fs::read_to_string(file).with_context(|| file.display().to_string())?;
    let mut data: ThemeData =
        serde_json::from_str(&text).with_context(|| format!("{}: theme data", file.display()))?;
    if data.format != THEME_DATA_FORMAT {
        bail!(
            "{}: format {:?}, expected {THEME_DATA_FORMAT}",
            file.display(),
            data.format
        );
    }
    let dir = file.parent().unwrap_or(Path::new("."));
    for f in &mut data.fonts {
        for face in &mut f.faces {
            let path = dir.join(&face.file.path);
            let bytes = std::fs::read(&path)
                .with_context(|| format!("{}: font file {}", file.display(), path.display()))?;
            let sha: String = Sha256::digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            if sha != face.file.sha256 {
                bail!(
                    "{}: {} has sha256 {sha}, the data names {}",
                    file.display(),
                    path.display(),
                    face.file.sha256
                );
            }
            face.file.path = path.to_string_lossy().into_owned();
        }
    }
    Ok(data)
}

/// The site's design as data, written on the session's branch in the fixed order of
/// [`theme::calls`]. Returns the menus it wrote (by slug).
async fn write_theme(
    wp: &Wp,
    data: &ThemeData,
    stylesheet: &str,
) -> Result<std::collections::BTreeSet<String>> {
    use reqwest::Method as M;
    let mut families: BTreeMap<String, u64> = BTreeMap::new();
    // A face's file where WordPress keeps it, when that is not where the plan expected it.
    let mut moved: Vec<(String, String)> = Vec::new();
    let mut menus = std::collections::BTreeSet::new();
    let calls = theme::calls(data, stylesheet);
    for call in &calls {
        match call {
            Call::SwitchTheme { stylesheet } => {
                wp.rest_ok(
                    M::POST,
                    "/swarmpress/v1/theme",
                    &json!({"stylesheet": stylesheet}),
                )
                .await?;
            }
            Call::FontFamily { slug, settings } => {
                let body = json!({"font_family_settings": settings.to_string()});
                let (_, found) = wp
                    .rest(
                        M::GET,
                        &format!("/wp/v2/font-families?slug={slug}&_fields=id"),
                        None,
                    )
                    .await?;
                let id = match first_id(&found) {
                    Some(id) => {
                        // A family's slug is its identity: the update leaves it out.
                        let mut kept = settings.clone();
                        if let Some(o) = kept.as_object_mut() {
                            o.remove("slug");
                        }
                        let body = json!({"font_family_settings": kept.to_string()});
                        wp.rest_ok(M::POST, &format!("/wp/v2/font-families/{id}"), &body)
                            .await?;
                        id
                    }
                    None => wp.rest_ok(M::POST, "/wp/v2/font-families", &body).await?["id"]
                        .as_u64()
                        .ok_or_else(|| anyhow!("font family {slug}: no id"))?,
                };
                families.insert(slug.clone(), id);
            }
            Call::FontFace {
                family,
                settings,
                file,
                file_name,
                mime,
                src,
            } => {
                let id = *families
                    .get(family)
                    .ok_or_else(|| anyhow!("a face of {family} before its family"))?;
                let route = format!("/wp/v2/font-families/{id}/font-faces");
                let (_, faces) = wp
                    .rest(
                        M::GET,
                        &format!("{route}?per_page=100&_fields=id,font_face_settings"),
                        None,
                    )
                    .await?;
                let same = faces.as_array().into_iter().flatten().find(|f| {
                    let s = &f["font_face_settings"];
                    s["fontWeight"] == settings["fontWeight"]
                        && s["fontStyle"] == settings["fontStyle"]
                });
                let at = match same {
                    Some(f) => f["font_face_settings"]["src"].clone(),
                    None => {
                        let bytes = std::fs::read(file).with_context(|| file.clone())?;
                        let form = reqwest::multipart::Form::new()
                            .text("font_face_settings", settings.to_string())
                            .part(
                                "file-0",
                                reqwest::multipart::Part::bytes(bytes)
                                    .file_name(file_name.clone())
                                    .mime_str(mime)?,
                            );
                        let res = wp
                            .http
                            .post(format!("{}/?rest_route={route}", wp.sandbox))
                            .multipart(form)
                            .send()
                            .await?;
                        let status = res.status().as_u16();
                        let v: Value = res.json().await?;
                        if status != 201 {
                            bail!(
                                "font face {file_name}: {status} {}",
                                truncate(&v.to_string(), 300)
                            );
                        }
                        v["font_face_settings"]["src"].clone()
                    }
                };
                let at = at.as_str().map(site_path).unwrap_or_default();
                if !at.is_empty() && at != *src {
                    moved.push((src.clone(), at));
                }
            }
            Call::GlobalStyles { body } => {
                let mut text = body.to_string();
                for (from, to) in &moved {
                    text = text.replace(from.as_str(), to);
                }
                let (_, themes) = wp.rest(M::GET, "/wp/v2/themes?status=active", None).await?;
                let href = themes[0]["_links"]["wp:user-global-styles"][0]["href"]
                    .as_str()
                    .unwrap_or("");
                let id: u64 = href
                    .rsplit("global-styles/")
                    .next()
                    .and_then(|t| {
                        t.chars()
                            .take_while(char::is_ascii_digit)
                            .collect::<String>()
                            .parse()
                            .ok()
                    })
                    .ok_or_else(|| anyhow!("the active theme has no user global styles"))?;
                wp.rest_ok(
                    M::POST,
                    &format!("/wp/v2/global-styles/{id}"),
                    &serde_json::from_str(&text)?,
                )
                .await?;
            }
            Call::Upsert {
                kind,
                slug,
                body,
                categories,
            } => {
                let mut body = body.clone();
                if !categories.is_empty() {
                    let mut ids = Vec::new();
                    for c in categories {
                        ids.push(term(wp, "wp_pattern_category", c).await?);
                    }
                    body["wp_pattern_category"] = json!(ids);
                }
                upsert(wp, *kind, stylesheet, slug, &body).await?;
                if *kind == Kind::Navigation {
                    menus.insert(slug.clone());
                }
            }
        }
    }
    eprintln!(
        "the design {} as data on {stylesheet}: {} fonts, {} parts, {} templates, {} patterns, {} menus",
        data.design,
        data.fonts.len(),
        data.template_parts.len(),
        data.templates.len(),
        data.patterns.len(),
        data.navigation.len()
    );
    Ok(menus)
}

/// An object by slug: updated where it exists, created otherwise.
async fn upsert(wp: &Wp, kind: Kind, theme: &str, slug: &str, body: &Value) -> Result<()> {
    use reqwest::Method as M;
    let (status, found) = wp.rest(M::GET, &kind.lookup(theme, slug), None).await?;
    let existing = match kind {
        // A template or part the theme or the site has (a theme file's is written as the site's).
        Kind::Template | Kind::TemplatePart => (status == 200).then_some(0),
        Kind::Pattern | Kind::Navigation => first_id(&found),
    };
    let route = match existing {
        Some(id) => kind.item(theme, slug, id),
        None => kind.collection().to_string(),
    };
    wp.rest_ok(M::POST, &route, body)
        .await
        .with_context(|| format!("{slug} ({})", kind.collection()))?;
    Ok(())
}

fn first_id(v: &Value) -> Option<u64> {
    v.as_array()
        .and_then(|a| a.first())
        .and_then(|x| x["id"].as_u64())
}

/// A URL's path from `/wp-content/` on (the sandbox writes absolute URLs).
fn site_path(url: &str) -> String {
    url.find("/wp-content/")
        .map(|i| url[i..].to_string())
        .unwrap_or_else(|| url.to_string())
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
    let ids = BTreeMap::from([
        ("post_tag".to_string(), tags.clone()),
        ("category".to_string(), categories.clone()),
    ]);
    let content = compose::resolve_terms(&d.content, &ids).map_err(|e| anyhow!(e))?;
    let mut body = json!({
        "title": d.title,
        "slug": d.slug,
        "status": "publish",
        "content": content,
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

async fn export(
    wp: &Wp,
    public_origin: &str,
    out: &Path,
    forms_endpoint: Option<String>,
    recorded: Option<&Path>,
) -> Result<()> {
    wp.repo(json!({"op": "session.set", "branch": "live", "user_id": 0, "author": {"kind": "system", "id": "visitor"}, "read_only": true}))
        .await?;
    let mut opts = site_export::Options::new(&wp.sandbox, public_origin);
    opts.forms_endpoint = forms_endpoint;
    let mut crawler = site_export::Crawler::full(opts);
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
    // WordPress's page for a path that does not exist: the static host's 404.html.
    let res = wp
        .http
        .get(format!("{}/swarmpress-not-found/", wp.sandbox))
        .send()
        .await?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = res.bytes().await?.to_vec();
    crawler.feed_not_found(site_export::Response {
        status,
        content_type,
        location: None,
        body,
    });
    let mut e = crawler.finish();
    // The forecast blocks, filled when the site is published (never in WordPress).
    let places = e.forecast_places().map_err(|err| anyhow!(err))?;
    if !places.is_empty() {
        let forecasts = fetch_forecasts(&places, recorded).await?;
        let n = e.fill_forecasts(&forecasts).map_err(|err| anyhow!(err))?;
        eprintln!("{n} pages got the forecast for {} places", places.len());
    }
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
    write_cloudflare_pages(out, &e.release)?;
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

/// Cloudflare Pages' `_redirects` and `_headers` beside the files (ADR-0091).
fn write_cloudflare_pages(out: &Path, release: &site_export::Release) -> Result<()> {
    for (name, bytes) in site_export::cloudflare_pages(release).map_err(|e| anyhow!(e))? {
        std::fs::write(out.join("files").join(name), bytes)?;
    }
    Ok(())
}

// ------------------------------------------------------------------ the forecast

/// Each place's forecast: from Open-Meteo, or from `recorded` (`{lat},{lng}.json`, the answers
/// tests and offline runs use). A place without a forecast fails the export.
async fn fetch_forecasts(
    places: &std::collections::BTreeSet<site_export::forecast::Place>,
    recorded: Option<&Path>,
) -> Result<BTreeMap<String, site_export::forecast::Forecast>> {
    use site_export::forecast;
    let http = reqwest::Client::builder()
        .user_agent("swarm.press site export (cinqueterre.travel)")
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let mut out = BTreeMap::new();
    for p in places {
        let key = p.key();
        if out.contains_key(&key) {
            continue;
        }
        let body = match recorded {
            Some(dir) => {
                let file = dir.join(format!("{key}.json"));
                std::fs::read(&file).with_context(|| {
                    format!("{}: no recorded forecast for {}", file.display(), p.name)
                })?
            }
            None => {
                let url = forecast::request_url(p);
                let mut tries = 0;
                loop {
                    tries += 1;
                    let res = http.get(&url).send().await;
                    match res {
                        Ok(r) if r.status().is_success() => break r.bytes().await?.to_vec(),
                        Ok(r) if tries >= 3 => {
                            bail!("Open-Meteo answered {} for {}", r.status(), p.name)
                        }
                        Err(e) if tries >= 3 => {
                            return Err(e).with_context(|| format!("Open-Meteo for {}", p.name))
                        }
                        _ => tokio::time::sleep(std::time::Duration::from_secs(2 * tries)).await,
                    }
                }
            }
        };
        let f = forecast::parse(&body).map_err(|e| anyhow!("the forecast for {}: {e}", p.name))?;
        out.insert(key, f);
    }
    Ok(out)
}

/// The daily rebuild: an export directory's forecast blocks filled again, in place.
async fn refill_forecasts(export_dir: &Path, recorded: Option<&Path>) -> Result<()> {
    let manifest = export_dir.join("release.json");
    let mut release: site_export::Release = serde_json::from_str(
        &std::fs::read_to_string(&manifest).with_context(|| manifest.display().to_string())?,
    )?;
    if release.id != release.computed_id() {
        bail!(
            "{}: the release's id is not its manifest's",
            manifest.display()
        );
    }
    let by_sha: BTreeMap<String, PathBuf> = release
        .files
        .iter()
        .filter(|(_, f)| f.content_type.starts_with("text/html"))
        .map(|(path, f)| {
            (
                f.sha256.clone(),
                export_dir.join("files").join(
                    site_export::Release::file_path(path, &f.content_type).trim_start_matches('/'),
                ),
            )
        })
        .collect();
    let read = |sha: &str| by_sha.get(sha).and_then(|p| std::fs::read(p).ok());
    let places = site_export::release_places(&release, &read).map_err(|e| anyhow!(e))?;
    if places.is_empty() {
        eprintln!("no forecast blocks in {}", export_dir.display());
        return Ok(());
    }
    let forecasts = fetch_forecasts(&places, recorded).await?;
    let changed =
        site_export::fill_release(&mut release, &read, &forecasts).map_err(|e| anyhow!(e))?;
    for (path, bytes) in &changed {
        let f = &release.files[path];
        let file = export_dir
            .join("files")
            .join(site_export::Release::file_path(path, &f.content_type).trim_start_matches('/'));
        std::fs::write(file, bytes)?;
    }
    std::fs::write(&manifest, serde_json::to_string_pretty(&release)?)?;
    eprintln!(
        "{} pages got the forecast for {} places; release {}",
        changed.len(),
        places.len(),
        release.id
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
