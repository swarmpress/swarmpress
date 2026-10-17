//! `swarmpress-wp-migrate`: a JSON-block site moved onto a WordPress sandbox (plan M8).
//!
//! ```text
//! swarmpress-wp-migrate plan    --content DIR --out plan.json [--newsletter] [--theme-data FILE]
//! swarmpress-wp-migrate apply   --plan plan.json --sandbox URL --repo URL [--branch NAME] [--assets DIR]
//!                               [--theme-data FILE]
//! swarmpress-wp-migrate theme   --theme-data FILE --sandbox URL --repo URL --branch NAME
//! swarmpress-wp-migrate export  --sandbox URL --repo URL --public-origin URL --out DIR
//!                               [--forms-endpoint URL] [--forecasts DIR] [--plan plan.json]
//!                               [--branch NAME]
//! swarmpress-wp-migrate forecast --export DIR [--forecasts DIR]
//! swarmpress-wp-migrate design-check --export DIR --plan plan.json --live URL --out report.json
//!                               [--retired FILE] [--exceptions FILE]
//! swarmpress-wp-migrate compare --reference DIR --live URL --export DIR --out report.json
//!                               [--plan plan.json] [--cache DIR] [--skip PREFIX]…
//! swarmpress-wp-migrate release --cr N --report report.json --sandbox URL --repo URL
//! swarmpress-wp-migrate qa      --facts facts.jsonl --export DIR --out report.json
//!                               [--production URL] [--public-origin URL] [--theme-data FILE]
//!                               [--exceptions FILE] [--bench FILE] [--site ID]
//!                               [--branch NAME --commit SHA] [--repo URL]
//! ```
//!
//! `qa` is the site QA stage's judge (ADR-0094, FEAT-116): the facts the browser observed on every
//! page of the export (`apps/game/e2e/page-audit.mts`) judged against site-standard v1
//! (`crates/site-quality`), the listed content gaps applied (`--exceptions`: `[{rule, page, why}]`,
//! each reason a content gap), the report written (`report.json`: findings, classes by rule × page
//! type × owner, scores per dimension, the gate, the digest; `summary.json`: the digest and the
//! table per rule and page type). `apply --hold` writes the branch and opens its change request
//! without merging it; `export --branch NAME` exports that branch; `release` is the import's gate:
//! it merges the held change request into `live` and tags the release only when the QA report is
//! about that branch's current head and its gate passed, and keeps the report as a `qa` note on
//! the audited commit and the merge (exit 1 when blocked). With `--repo` the report is kept as a note on the audited commit
//! (`--commit`, else the branch's head) in the governed repository. Exit 1 when the gate blocks.
//!
//! `plan` leaves the newsletter out (the owner's decision of 2026-10-13: no form until the central
//! server has a public address, a privacy line and a double opt-in); `--newsletter` composes it
//! (the home's form, the header's button, the footer's link), for an export with
//! `--forms-endpoint`. `--theme-data` (a `ThemeData` JSON file, ADR-0093; its font files are paths
//! relative to it) imports the site onto the neutral theme `canvas` and writes its design as data
//! before the documents (`content_import_wp::theme`: fonts, global styles, template parts,
//! templates, patterns, navigation, each updated by slug when it exists); without it the site gets
//! the fallback theme folder (Coast, or cinqueterre.travel's own until its design runs on data).
//! On `apply` it replaces the plan's theme data. `theme` writes theme data alone on a new branch
//! from `live` and shows that branch to visitors (the web designer's visual check renders it). `apply` writes the plan through the sandbox's REST API on a branch of its own, as the CEO, then
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
                ..Default::default()
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
            apply(&wp, &p, &branch, assets.as_deref(), args.iter().any(|a| a == "--hold")).await
        }
        Some("theme") => {
            // A theme as data on a branch of its own, shown to visitors (the visual check).
            let wp = Wp::new(&need(&args, "--sandbox")?, &need(&args, "--repo")?);
            let branch = need(&args, "--branch")?;
            let data = read_theme_data(Path::new(&need(&args, "--theme-data")?))?;
            let ceo: Value = serde_json::from_str(CEO)?;
            let _ = wp.repo(json!({"op": "branch.delete", "name": branch})).await;
            wp.repo(json!({"op": "branch.create", "name": branch, "from": "live"}))
                .await?;
            wp.repo(json!({"op": "session.set", "branch": branch, "user_id": 1, "author": ceo, "read_only": false}))
                .await?;
            write_theme(&wp, &data, theme::BASE_THEME).await?;
            wp.repo(json!({"op": "session.set", "branch": branch, "user_id": 0, "read_only": true}))
                .await?;
            eprintln!("the theme is on {branch}, shown to visitors");
            Ok(())
        }
        Some("export") => {
            let wp = Wp::new(&need(&args, "--sandbox")?, &need(&args, "--repo")?);
            let plan: Option<Plan> = arg(&args, "--plan")
                .map(|f| -> Result<Plan> { Ok(serde_json::from_str(&std::fs::read_to_string(f)?)?) })
                .transpose()?;
            export(
                &wp,
                &need(&args, "--public-origin")?,
                Path::new(&need(&args, "--out")?),
                arg(&args, "--forms-endpoint"),
                arg(&args, "--forecasts").map(PathBuf::from).as_deref(),
                arg(&args, "--theme-data")
                    .map(|f| read_theme_data(Path::new(&f)))
                    .transpose()?
                    .as_ref(),
                plan.as_ref(),
                arg(&args, "--branch").as_deref(),
            )
            .await
        }
        Some("design-check") => {
            let code = design_check(
                Path::new(&need(&args, "--export")?),
                Path::new(&need(&args, "--plan")?),
                &need(&args, "--live")?,
                arg(&args, "--retired").map(PathBuf::from).as_deref(),
                arg(&args, "--exceptions").map(PathBuf::from).as_deref(),
                Path::new(&need(&args, "--out")?),
            )
            .await?;
            std::process::exit(code)
        }
        Some("forecast") => {
            let labels = match arg(&args, "--theme-data") {
                Some(f) => read_theme_data(Path::new(&f))?.labels,
                None => BTreeMap::new(),
            };
            refill_forecasts(
                Path::new(&need(&args, "--export")?),
                arg(&args, "--forecasts").map(PathBuf::from).as_deref(),
                &site_export::labels::with_defaults(&labels),
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
        Some("release") => {
            let wp = Wp::new(&need(&args, "--sandbox")?, &need(&args, "--repo")?);
            let id: u64 = need(&args, "--cr")?.parse().context("--cr is a number")?;
            let code = release(&wp, id, Path::new(&need(&args, "--report")?)).await?;
            std::process::exit(code)
        }
        Some("qa") => {
            let code = qa(&args).await?;
            std::process::exit(code)
        }
        _ => bail!(
            "usage: swarmpress-wp-migrate plan|apply|export|forecast|compare|qa (see the source's header)"
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

async fn apply(wp: &Wp, p: &Plan, branch: &str, assets: Option<&Path>, hold: bool) -> Result<()> {
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

    // WordPress's own first post and page are not the site's.
    for (rest, slug) in [("posts", "hello-world"), ("pages", "sample-page")] {
        let (_, found) = wp
            .rest(
                M::GET,
                &format!("/wp/v2/{rest}?slug={slug}&_fields=id"),
                None,
            )
            .await?;
        if let Some(id) = first_id(&found) {
            wp.rest_ok(
                M::DELETE,
                &format!("/wp/v2/{rest}/{id}?force=true"),
                &json!({}),
            )
            .await?;
        }
    }
    // The site's content types (wp-sandbox 0.9.0), before anything names their fields.
    wp.rest_ok(
        M::POST,
        "/swarmpress/v1/content-types",
        &json!({"types": p.content_types.iter().map(|t| json!({
            "name": t.name,
            "label": t.label,
            "fields": t.fields.iter().map(|(k, l)| json!({"key": k, "label": l})).collect::<Vec<_>>(),
        })).collect::<Vec<_>>()}),
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
        // A page under the page above it (a village's sections under the village; the routes are
        // in order, so the parent is written first): WordPress's parent, the breadcrumb's path.
        let parent = d.parent.as_ref().and_then(|r| ids.get(r)).copied();
        let id = write_doc(wp, d, &categories, &tags, parent)
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
    write_entries(wp, p).await?;
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
    if hold {
        // The release waits for the QA stage (`release --cr N --report FILE`, ADR-0094).
        let head = branch_head(wp, branch).await?;
        println!(
            "{}",
            json!({"change_request": cr["id"], "branch": branch, "head": head})
        );
        eprintln!(
            "{} documents written on {branch} in {}s; change request {} held for the QA stage (head {head})",
            p.docs.len(),
            started.elapsed().as_secs(),
            cr["id"]
        );
        return Ok(());
    }
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
    if let Err(issues) = theme::checked(&data) {
        bail!(
            "{}: the theme data is not well formed:\n  {}",
            file.display(),
            issues.join("\n  ")
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
    // Nothing of malformed data reaches the branch (ADR-0093).
    theme::checked(data)
        .map_err(|i| anyhow!("the theme data is not well formed: {}", i.join("; ")))?;
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
                // The collection may answer every family (its `slug` filter is not one the font
                // library honours everywhere): the family is the one whose settings carry the slug.
                let (_, found) = wp
                    .rest(
                        M::GET,
                        &format!("/wp/v2/font-families?slug={slug}&per_page=100&_fields=id,slug,font_family_settings"),
                        None,
                    )
                    .await?;
                let mine = found.as_array().into_iter().flatten().find(|f| {
                    f["slug"].as_str() == Some(slug.as_str())
                        || f["font_family_settings"]["slug"].as_str() == Some(slug.as_str())
                });
                let id = match mine.and_then(|f| f["id"].as_u64()) {
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
                        &format!("{route}?per_page=100&_fields=id,parent,font_face_settings"),
                        None,
                    )
                    .await?;
                // Only this family's faces (the collection has answered other families' too).
                let same = faces.as_array().into_iter().flatten().find(|f| {
                    if f["parent"].as_u64().is_some_and(|p| p != id) {
                        return false;
                    }
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
    parent: Option<u64>,
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
    if d.sticky {
        body["sticky"] = json!(true);
    }
    if let Some(t) = &d.template {
        body["template"] = json!(t);
    }
    if let (Some(pid), "page") = (parent, d.post_type.as_str()) {
        body["parent"] = json!(pid);
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

/// The site's entries (`content_import_wp::entries`): their places as `sp_place` terms, then each
/// entry with its language, link, place and fields.
async fn write_entries(wp: &Wp, p: &Plan) -> Result<()> {
    let mut places: BTreeMap<String, u64> = BTreeMap::new();
    for e in &p.entries {
        if let Some(pl) = &e.place {
            if !places.contains_key(pl) {
                places.insert(pl.clone(), term(wp, "sp_place", pl).await?);
            }
        }
    }
    let started = std::time::Instant::now();
    for (i, e) in p.entries.iter().enumerate() {
        let mut meta: BTreeMap<String, String> = e.fields.clone();
        meta.insert("_swarmpress_lang".into(), e.lang.clone());
        meta.insert("_swarmpress_link".into(), e.link.clone());
        let mut body = json!({
            "title": e.title,
            "slug": e.slug,
            "status": "publish",
            "content": e.content,
            "excerpt": e.excerpt,
            "menu_order": e.order,
            "meta": meta,
        });
        if let Some(id) = e.place.as_ref().and_then(|pl| places.get(pl)) {
            body["sp_place"] = json!([id]);
        }
        wp.rest_ok(
            reqwest::Method::POST,
            &format!("/wp/v2/{}", e.post_type),
            &body,
        )
        .await
        .with_context(|| format!("{} {}", e.post_type, e.slug))?;
        if (i + 1).is_multiple_of(100) {
            eprintln!(
                "{} of {} entries written ({}s)",
                i + 1,
                p.entries.len(),
                started.elapsed().as_secs()
            );
        }
    }
    Ok(())
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

#[allow(clippy::too_many_arguments)]
async fn export(
    wp: &Wp,
    public_origin: &str,
    out: &Path,
    forms_endpoint: Option<String>,
    recorded: Option<&Path>,
    theme_data: Option<&ThemeData>,
    plan: Option<&Plan>,
    branch: Option<&str>,
) -> Result<()> {
    let branch = branch.unwrap_or("live");
    wp.repo(json!({"op": "session.set", "branch": branch, "user_id": 0, "author": {"kind": "system", "id": "visitor"}, "read_only": true}))
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
    // Author archives only for the authors the content names (never the importing user's).
    let authors = e.content_authors();
    let dropped = e.keep_author_archives(&authors);
    if !dropped.is_empty() {
        eprintln!(
            "author archives: {} kept, dropped {} (no content of theirs)",
            authors.len(),
            dropped.join(", ")
        );
    }
    // WordPress's home answered for paths that name no page: not pages of the site.
    let stand_ins = e.drop_home_stand_ins(public_origin);
    if !stand_ins.is_empty() {
        eprintln!(
            "{} paths answered with the home page left out (e.g. {})",
            stand_ins.len(),
            stand_ins[0]
        );
    }
    // The forecast blocks, filled when the site is published (never in WordPress).
    let places = e.forecast_places().map_err(|err| anyhow!(err))?;
    if !places.is_empty() {
        let forecasts = fetch_forecasts(&places, recorded).await?;
        let n = e.fill_forecasts(&forecasts).map_err(|err| anyhow!(err))?;
        eprintln!("{n} pages got the forecast for {} places", places.len());
    }
    // The site's label table over the platform's words (site_export::labels).
    let labels = site_export::labels::with_defaults(
        &theme_data.map(|d| d.labels.clone()).unwrap_or_default(),
    );
    // The essentials tickers (the design's live facts of a place), filled the same way.
    let table = essentials_places();
    let mut wanted = std::collections::BTreeSet::new();
    for html in e.pages().values() {
        wanted.extend(site_export::essentials::needed(html, &table).map_err(|err| anyhow!(err))?);
    }
    if !wanted.is_empty() {
        let values = fetch_essentials(&wanted, recorded).await?;
        let n = e
            .map_html(&|_, html| site_export::essentials::fill(html, &table, &values, &labels))
            .map_err(|err| anyhow!(err))?;
        eprintln!("{n} pages got the essentials of {} places", wanted.len());
    }
    // The theme's own files (the icon sprite, the one audited enhancement script, ADR-0093's
    // addendum), and the script on every page.
    if let Some(data) = theme_data {
        for f in &data.files {
            e.add_file(
                &format!("/{}", f.path),
                &f.content_type,
                f.content.clone().into_bytes(),
            );
        }
        if data
            .files
            .iter()
            .any(|f| f.path == content_import_wp::theme_data::ENHANCEMENT_PATH)
        {
            let src = format!("/{}", content_import_wp::theme_data::ENHANCEMENT_PATH);
            let n = e
                .map_html(&|_, html| Ok(site_export::with_script(html, &src)))
                .map_err(|err| anyhow!(err))?;
            eprintln!("{n} pages load {src}");
        }
        // The design's words in each page's language, where the templates and WordPress wrote
        // them in English.
        let n = e
            .map_html(&|_, html| {
                Ok(site_export::labels::page_lang(html)
                    .and_then(|lang| site_export::labels::localize(html, &lang, &labels)))
            })
            .map_err(|err| anyhow!(err))?;
        eprintln!("{n} pages got the design's words in their language");
    }
    // The platform's rules for a site of its own (site_export::hygiene, ADR-0094): no WordPress
    // runtime extras, every page's canonical and language versions, a sitemap of its pages.
    {
        use site_export::hygiene;
        let origin = public_origin.trim_end_matches('/').to_string();
        let versions = plan
            .map(content_import_wp::plan::versions)
            .unwrap_or_default();
        let pages: std::collections::BTreeSet<String> = e.pages().into_keys().collect();
        let n = e
            .map_html(&|path, html| {
                if path == "/404.html" {
                    return Ok(hygiene::strip_runtime(html));
                }
                let stripped = hygiene::strip_runtime(html);
                let stripped =
                    match hygiene::noindex_term_archive(stripped.as_deref().unwrap_or(html)) {
                        Some(t) => Some(t),
                        None => stripped,
                    };
                let h = stripped.as_deref().unwrap_or(html);
                let v = versions.get(path);
                let canon = match (v, hygiene::canonical(h)) {
                    (Some(v), _) if pages.contains(&v.canonical) => {
                        Some(format!("{origin}{}", v.canonical))
                    }
                    (_, Some(_)) => None,
                    (_, None) => Some(format!("{origin}{path}")),
                };
                let alts: BTreeMap<String, String> = v
                    .map(|v| {
                        v.alternates
                            .iter()
                            .filter(|(_, r)| pages.contains(*r))
                            .map(|(l, r)| (l.clone(), format!("{origin}{r}")))
                            .collect()
                    })
                    .unwrap_or_default();
                // A page in one language only names itself (its language from `<html lang>`).
                let alts = if alts.keys().filter(|k| *k != "x-default").count() > 1 {
                    alts
                } else {
                    site_export::labels::page_lang(h)
                        .map(|l| BTreeMap::from([(l, format!("{origin}{path}"))]))
                        .unwrap_or_default()
                };
                Ok(hygiene::with_head_links(h, canon.as_deref(), &alts).or(stripped))
            })
            .map_err(|err| anyhow!(err))?;
        eprintln!("{n} pages without WordPress's runtime extras, with their canonical and language versions");
        let mut urls: Vec<String> = e
            .pages()
            .into_iter()
            .filter(|(p, h)| {
                p != "/404.html"
                    && !hygiene::noindex(h)
                    && hygiene::canonical(h).is_none_or(|c| c == format!("{origin}{p}"))
            })
            .map(|(p, _)| format!("{origin}{p}"))
            .collect();
        urls.sort();
        e.add_file(
            "/sitemap.xml",
            "application/xml",
            hygiene::sitemap(&urls).into_bytes(),
        );
        let robots = e
            .release
            .files
            .get("/robots.txt")
            .and_then(|f| e.blobs.get(&f.sha256))
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default();
        e.add_file(
            "/robots.txt",
            "text/plain; charset=utf-8",
            hygiene::robots_with_sitemap(&robots, &format!("{origin}/sitemap.xml")).into_bytes(),
        );
        eprintln!("the sitemap lists {} pages", urls.len());
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

/// The places a template's essentials ticker may name (`sp-place-{slug}`), with their coordinates.
fn essentials_places() -> BTreeMap<String, site_export::forecast::Place> {
    compose::COORDINATES
        .iter()
        .filter_map(|(slug, _, _)| compose::place(slug, "en").map(|p| (slug.to_string(), p)))
        .collect()
}

/// Each place's live values (sea, air, sunset): from Open-Meteo, or from `recorded`
/// (`essentials-{lat},{lng}.json`: `{"now": …, "marine": …}`). A place without values fails the
/// export.
async fn fetch_essentials(
    places: &std::collections::BTreeSet<site_export::forecast::Place>,
    recorded: Option<&Path>,
) -> Result<BTreeMap<String, site_export::essentials::Essentials>> {
    use site_export::essentials;
    let http = reqwest::Client::builder()
        .user_agent("swarm.press site export (cinqueterre.travel)")
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let get = |url: String, name: String| {
        let http = http.clone();
        async move {
            let mut tries = 0;
            loop {
                tries += 1;
                match http.get(&url).send().await {
                    Ok(r) if r.status().is_success() => return Ok(r.bytes().await?.to_vec()),
                    Ok(r) if tries >= 3 => bail!("Open-Meteo answered {} for {name}", r.status()),
                    Err(e) if tries >= 3 => {
                        return Err(anyhow!(e).context(format!("Open-Meteo for {name}")))
                    }
                    _ => tokio::time::sleep(std::time::Duration::from_secs(2 * tries)).await,
                }
            }
        }
    };
    let mut out = BTreeMap::new();
    for p in places {
        let key = p.key();
        let (now, marine) = match recorded {
            Some(dir) => {
                let file = dir.join(format!("essentials-{key}.json"));
                let v: Value =
                    serde_json::from_slice(&std::fs::read(&file).with_context(|| {
                        format!("{}: no recorded essentials for {}", file.display(), p.name)
                    })?)?;
                (
                    v["now"].to_string().into_bytes(),
                    v["marine"].to_string().into_bytes(),
                )
            }
            None => (
                get(essentials::now_url(p), p.name.clone()).await?,
                get(essentials::marine_url(p), p.name.clone()).await?,
            ),
        };
        let v = essentials::parse(&now, &marine)
            .map_err(|e| anyhow!("the essentials of {}: {e}", p.name))?;
        out.insert(key, v);
    }
    Ok(out)
}

/// The daily rebuild: an export directory's forecast blocks filled again, in place.
async fn refill_forecasts(
    export_dir: &Path,
    recorded: Option<&Path>,
    labels: &site_export::labels::Labels,
) -> Result<()> {
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
    // The essentials tickers too: their values are live.
    let table = essentials_places();
    let mut wanted = std::collections::BTreeSet::new();
    for (_, f) in release
        .files
        .iter()
        .filter(|(_, f)| f.content_type.starts_with("text/html"))
    {
        if let Some(b) = read(&f.sha256) {
            wanted.extend(
                site_export::essentials::needed(&String::from_utf8_lossy(&b), &table)
                    .map_err(|e| anyhow!(e))?,
            );
        }
    }
    if places.is_empty() && wanted.is_empty() {
        eprintln!("no forecast blocks in {}", export_dir.display());
        return Ok(());
    }
    let forecasts = fetch_forecasts(&places, recorded).await?;
    let values = fetch_essentials(&wanted, recorded).await?;
    let mut changed =
        site_export::fill_release(&mut release, &read, &forecasts).map_err(|e| anyhow!(e))?;
    // Read the pages as they are now (the forecast filled) and fill their tickers.
    let now: BTreeMap<String, Vec<u8>> = changed.clone();
    let shas: BTreeMap<String, String> = release
        .files
        .iter()
        .map(|(p, f)| (f.sha256.clone(), p.clone()))
        .collect();
    let read2 = |sha: &str| {
        shas.get(sha)
            .and_then(|p| now.get(p).cloned())
            .or_else(|| read(sha))
    };
    let more = site_export::map_release_html(&mut release, &read2, &|_, html| {
        site_export::essentials::fill(html, &table, &values, labels)
    })
    .map_err(|e| anyhow!(e))?;
    changed.extend(more);
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

// ------------------------------------------------------------------ the design's checks

/// A JSON object of path → reason (`{"/en/#subscribe": "the newsletter is hidden"}`), or empty.
fn reasons(file: Option<&Path>) -> Result<BTreeMap<String, String>> {
    match file {
        Some(f) => Ok(serde_json::from_str(
            &std::fs::read_to_string(f).with_context(|| f.display().to_string())?,
        )?),
        None => Ok(BTreeMap::new()),
    }
}

/// The exported site against the live one and the plan (ADR-0093 addendum): the live menus'
/// every entry on the export (nested ones under their parents, links working), every source page
/// on a template composed for its type, no "Uncategorized", and the content gaps. Writes the
/// report; the exit code is 1 when a check fails.
async fn design_check(
    export_dir: &Path,
    plan_file: &Path,
    live: &str,
    retired: Option<&Path>,
    exceptions: Option<&Path>,
    out: &Path,
) -> Result<i32> {
    use content_import_wp::{design, parity};
    let release: site_export::Release =
        serde_json::from_str(&std::fs::read_to_string(export_dir.join("release.json"))?)?;
    let mut pages: BTreeMap<String, String> = BTreeMap::new();
    for (path, f) in &release.files {
        if !f.content_type.starts_with("text/html") {
            continue;
        }
        let file = export_dir
            .join("files")
            .join(site_export::Release::file_path(path, &f.content_type).trim_start_matches('/'));
        if let Ok(b) = std::fs::read(&file) {
            pages.insert(path.clone(), String::from_utf8_lossy(&b).into_owned());
        }
    }
    let plan: Plan = serde_json::from_str(&std::fs::read_to_string(plan_file)?)?;
    // The live pages whose menus are compared: each language's home and its first village's
    // section page (the menus mark the current page and its ancestors there).
    let mut compared: Vec<String> = Vec::new();
    for lang in content_import_wp::LANGS {
        compared.push(format!("/{lang}/"));
        if let Some(d) = plan.docs.iter().find(|d| {
            d.lang == lang
                && d.meta
                    .get("_swarmpress_page_type")
                    .is_some_and(|t| t.starts_with("village-"))
        }) {
            compared.push(d.route.clone());
        }
    }
    let http = reqwest::Client::builder()
        .user_agent("swarm.press design check")
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut live_pages = BTreeMap::new();
    for path in &compared {
        let url = format!("{}{path}", live.trim_end_matches('/'));
        let body = http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        live_pages.insert(path.clone(), body);
    }
    let origin = live.trim_end_matches('/').to_string();
    let www = origin.replace("://", "://www.");
    let origins = [origin.as_str(), www.as_str()];
    let exists = |p: &str| {
        release.files.contains_key(p)
            || release.redirects.contains_key(p)
            || release.redirects.contains_key(p.trim_end_matches('/'))
    };
    let nav = parity::navigation_parity(&live_pages, &pages, &origins, &exists, &reasons(retired)?);
    let source: Vec<String> = plan.docs.iter().map(|d| d.route.clone()).collect();
    let (templates, generic) = parity::templates(&pages, &source, &reasons(exceptions)?);
    let uncategorized = parity::uncategorized(&pages);
    let gaps = design::gaps(&plan.docs, &plan.entries);
    // The design's words in each page's language: none left in English where a label stands
    // alone (site_export::labels), by page.
    let labels = site_export::labels::with_defaults(
        &plan
            .theme_data
            .as_ref()
            .map(|d| d.labels.clone())
            .unwrap_or_default(),
    );
    let mut english: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (path, html) in &pages {
        if let Some(lang) = site_export::labels::page_lang(html) {
            let left = site_export::labels::left_in_english(html, &lang, &labels);
            if !left.is_empty() {
                english.insert(path.clone(), left);
            }
        }
    }
    // Author archives only for the authors the content names.
    let authors = site_export::content_authors(pages.values().map(String::as_str));
    let stray_authors: Vec<String> = pages
        .keys()
        .filter_map(|p| p.strip_prefix("/author/"))
        .filter_map(|r| r.split('/').next())
        .filter(|s| !authors.contains(*s))
        .map(String::from)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    // Ways to arrive are one mode table (4.14), never stacked sections.
    let stacked_modes: Vec<String> = pages
        .iter()
        .filter(|(_, html)| html.contains("ct-mode-") && html.contains("ct-items-transport"))
        .filter(|(_, html)| !html.contains("ct-mode-table"))
        .map(|(p, _)| p.clone())
        .collect();
    let ok = nav.ok()
        && stacked_modes.is_empty()
        && generic.is_empty()
        && uncategorized.is_empty()
        && english.is_empty()
        && stray_authors.is_empty();
    let report = json!({
        "ok": ok,
        "navigation": nav,
        "templates": templates,
        "generic": generic,
        "uncategorized": uncategorized,
        "left_in_english": english,
        "author_archives_without_content": stray_authors,
        "ways_to_arrive_not_a_mode_table": stacked_modes,
        "content_gaps": gaps,
    });
    std::fs::write(out, serde_json::to_string_pretty(&report)?)?;
    eprintln!(
        "navigation: {} entries found ({} nested) on {} pages, {} missing, {} broken, {} retired; templates: {} kinds, {} generic pages; \"Uncategorized\" on {} pages; the design's words left in English on {} pages; {} author archives without content; {} pages with ways to arrive not in a mode table; {} content gaps",
        nav.found,
        nav.nested,
        nav.pages.len(),
        nav.missing.len(),
        nav.broken.len(),
        nav.retired.len(),
        templates.len(),
        generic.len(),
        uncategorized.len(),
        english.len(),
        stray_authors.len(),
        stacked_modes.len(),
        gaps.len()
    );
    for m in nav
        .missing
        .iter()
        .chain(nav.broken.iter())
        .chain(generic.iter())
        .take(30)
    {
        eprintln!("  - {m}");
    }
    Ok(if ok { 0 } else { 1 })
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

// ------------------------------------------------------------------ the QA stage's judge

async fn qa(args: &[String]) -> Result<i32> {
    use site_quality::{build, route, Exception, PageFacts, Standard, Subject};
    let facts_file = need(args, "--facts")?;
    let export_dir = PathBuf::from(need(args, "--export")?);
    let out = PathBuf::from(need(args, "--out")?);
    let production = arg(args, "--production").unwrap_or_default();
    let public_origin = arg(args, "--public-origin").unwrap_or_else(|| production.clone());
    let mut pages: Vec<PageFacts> = Vec::new();
    for (i, line) in std::fs::read_to_string(&facts_file)
        .with_context(|| facts_file.clone())?
        .lines()
        .enumerate()
    {
        if line.trim().is_empty() {
            continue;
        }
        pages.push(serde_json::from_str(line).with_context(|| format!("{facts_file}:{}", i + 1))?);
    }
    let release: Value =
        serde_json::from_str(&std::fs::read_to_string(export_dir.join("release.json"))?)?;
    let files = export_dir.join("files");
    let read = |p: &str| std::fs::read_to_string(files.join(p.trim_start_matches('/'))).ok();
    let labels = match arg(args, "--theme-data") {
        Some(f) => {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(&f)?)?;
            serde_json::from_value(v["labels"].clone()).unwrap_or_default()
        }
        None => BTreeMap::new(),
    };
    let site = content_import_wp::qa::site_facts(
        &release,
        &read,
        &public_origin,
        &production,
        labels,
        &pages,
    );
    let exceptions: Vec<Exception> = match arg(args, "--exceptions") {
        Some(f) => serde_json::from_str(&std::fs::read_to_string(&f)?)
            .with_context(|| format!("{f}: the exceptions"))?,
        None => Vec::new(),
    };
    let wp = arg(args, "--repo").map(|r| Wp::new("http://127.0.0.1:1", &r));
    let branch = arg(args, "--branch").unwrap_or_else(|| "live".into());
    let mut commit = arg(args, "--commit").unwrap_or_default();
    if commit.is_empty() {
        if let Some(wp) = &wp {
            let bs = wp.repo(json!({"op": "branches"})).await?;
            commit = bs
                .as_array()
                .and_then(|a| a.iter().find(|b| b["name"] == branch.as_str()))
                .and_then(|b| b["head"].as_str())
                .unwrap_or("")
                .to_string();
        }
    }
    let std_v1 = Standard::current();
    let subject = Subject {
        site: arg(args, "--site").unwrap_or_else(|| site_quality::facts::host_of(&public_origin)),
        branch: branch.clone(),
        commit: commit.clone(),
        release: None,
    };
    let report = match build(&std_v1, subject, &site, &pages, &exceptions) {
        Ok(r) => r,
        Err(errors) => {
            for e in errors {
                eprintln!("qa: {e}");
            }
            return Ok(2);
        }
    };
    if let Some(d) = out.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(&out, serde_json::to_string_pretty(&report)?)?;
    let routing = route(&std_v1, &report);
    let summary = json!({
        "digest": report.digest,
        "gate": report.gate,
        "table": report.table(),
        "excepted": report.excepted.iter().fold(BTreeMap::<String, BTreeMap<String, u32>>::new(), |mut t, f| {
            *t.entry(f.rule.clone()).or_default().entry(f.page_type.clone()).or_default() += 1;
            t
        }),
        "classes": report.clusters.iter().map(|c| json!({"rule": c.rule, "page_type": c.page_type, "route": c.route, "findings": c.findings, "pages": c.pages, "example": c.examples.first().map(|e| format!("{} @{}: {}", e.page, e.width, e.detail))})).collect::<Vec<_>>(),
        "work_orders": routing.content,
        "unused_exceptions": report.unused_exceptions,
    });
    std::fs::write(
        out.with_file_name("summary.json"),
        serde_json::to_string_pretty(&summary)?,
    )?;
    if let Some(wp) = &wp {
        if !commit.is_empty() {
            wp.repo(json!({"op": "note.put", "commit": commit, "kind": "qa", "value": report}))
                .await
                .context("keeping the report on the audited commit")?;
            eprintln!(
                "the report is a note (qa) on {}",
                &commit[..commit.len().min(12)]
            );
        }
    }
    if let Some(bench) = arg(args, "--bench") {
        let mut metrics = Vec::new();
        for r in std_v1
            .rules
            .iter()
            .filter(|r| r.kind == site_quality::Kind::Deterministic)
        {
            let n = report.findings.iter().filter(|f| f.rule == r.id).count();
            metrics.push(json!({"name": format!("findings_{}", r.id.replace('-', "_")), "subject": "export", "unit": "findings", "value": n, "determinism": "deterministic", "direction": "lower_is_better", "budget": {"max": 0}}));
        }
        for d in site_quality::Dimension::ALL {
            metrics.push(json!({"name": format!("score_{}", d.slug()), "subject": "export", "unit": "permille", "value": report.scores.get(d), "determinism": "deterministic", "direction": "higher_is_better", "budget": {"min": 1000}}));
        }
        metrics.push(json!({"name": "pages", "subject": "export", "unit": "pages", "value": report.pages, "determinism": "deterministic", "direction": "informational"}));
        metrics.push(json!({"name": "listed_content_gaps", "subject": "export", "unit": "findings", "value": report.excepted.len(), "determinism": "deterministic", "direction": "informational"}));
        let git = |a: &[&str]| {
            std::process::Command::new("git")
                .args(a)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default()
        };
        let doc = json!({
            "schema": "cockpit.benchmark.v1",
            "name": "site-quality",
            "feature_ids": ["FEAT-116"],
            "component": "content",
            "provenance": {
                "commit": git(&["rev-parse", "HEAD"]),
                "branch": git(&["rev-parse", "--abbrev-ref", "HEAD"]),
                "dirty": !git(&["status", "--porcelain"]).is_empty(),
                "tool": {"name": "swarmpress-wp-migrate qa", "version": format!("{} {}", std_v1.id, std_v1.version)},
            },
            "build": {"profile": "static-export"},
            "machine": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH, "runner": "local"},
            "workload": {"pages": report.pages, "widths": report.widths, "site": report.subject.site, "branch": report.subject.branch, "commit": report.subject.commit},
            "metrics": metrics,
        });
        if let Some(d) = Path::new(&bench).parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&bench, serde_json::to_string_pretty(&doc)?)?;
    }
    eprintln!("{}", report.line());
    for c in report.clusters.iter().take(40) {
        eprintln!(
            "  {:<20} {:<28} {:<13} {:>5} on {:>4} pages",
            c.rule,
            c.page_type,
            c.route.slug(),
            c.findings,
            c.pages
        );
    }
    if report.clusters.len() > 40 {
        eprintln!(
            "  … {} more classes (summary.json)",
            report.clusters.len() - 40
        );
    }
    for b in &report.gate.blocking {
        eprintln!("blocked: {b}");
    }
    Ok(if report.gate.passed { 0 } else { 1 })
}

/// The head of `branch` in the governed repository.
async fn branch_head(wp: &Wp, branch: &str) -> Result<String> {
    let bs = wp.repo(json!({"op": "branches"})).await?;
    bs.as_array()
        .and_then(|a| a.iter().find(|b| b["name"] == branch))
        .and_then(|b| b["head"].as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("no branch {branch}"))
}

/// The import's release gate (ADR-0094): the held change request merged only on a passing QA
/// report of its branch's current head.
async fn release(wp: &Wp, id: u64, report_file: &Path) -> Result<i32> {
    let report: site_quality::QaReport =
        serde_json::from_str(&std::fs::read_to_string(report_file)?).context("the QA report")?;
    let cr = wp.repo(json!({"op": "cr.get", "id": id})).await?;
    let source = cr["change_request"]["source"]
        .as_str()
        .ok_or_else(|| anyhow!("change request {id} has no source"))?
        .to_string();
    let head = branch_head(wp, &source).await?;
    if report.subject.branch != source || report.subject.commit != head {
        eprintln!(
            "blocked: the report is about {} at {}, the change request's branch {source} is at {head}",
            report.subject.branch, report.subject.commit
        );
        return Ok(1);
    }
    wp.repo(json!({"op": "note.put", "commit": head, "kind": "qa", "value": report}))
        .await?;
    if !report.gate.passed {
        eprintln!("blocked by the QA stage: {}", report.line());
        for b in &report.gate.blocking {
            eprintln!("  {b}");
        }
        return Ok(1);
    }
    let ceo: Value = serde_json::from_str(CEO)?;
    let merged = wp
        .repo(json!({"op": "cr.merge", "id": id, "author": ceo}))
        .await?;
    let merge = merged["head"].as_str().unwrap_or_default().to_string();
    if !merge.is_empty() {
        wp.repo(json!({"op": "note.put", "commit": merge, "kind": "qa", "value": report}))
            .await?;
    }
    let rel = wp.repo(json!({"op": "release", "name": "import"})).await?;
    eprintln!(
        "change request {id} merged into live at {merge} after the QA stage ({}); release {}",
        report.line(),
        rel["id"]
    );
    Ok(0)
}
