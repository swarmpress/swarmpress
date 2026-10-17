//! `swarmpress-site-theme`: the web designer's job (ADR-0093, FEAT-115) run once on a design, outside
//! the game: the runner's step for a design before its theme goes to a site.
//!
//! ```text
//! swarmpress-site-theme --design FILE|DIR --content DIR --out DIR
//!                       [--llm fake|hosted] [--server URL] [--login NAME] [--version N]
//!                       [--wordpress URL --repo URL]
//! swarmpress-site-theme --design FILE|DIR --content DIR --out DIR --rebuild-from THEME_DATA
//! swarmpress-site-theme … [--revise-from THEME_DATA] [--wordpress URL --repo URL --audit PLAN
//!                       [--exceptions FILE] [--public-origin URL] [--restart CMD]]
//! ```
//!
//! `--revise-from` runs the job on an earlier theme: its templates, parts and labels stand as the
//! first answers, so only what does not pass its checks or the QA stage costs a model call.
//! `--audit PLAN` (with `--wordpress` and `--repo`) gives the job its QA stage (ADR-0094): each
//! round writes the theme on `{branch}-qa-{n}`, exports that branch with the import plan, audits
//! every page (`apps/game/e2e/page-audit.mts` and `swarmpress-wp-migrate qa`, `--exceptions` the
//! site's listed content gaps) and keeps it in `qa/round-{n}/`; `--restart CMD` runs before each round
//! and before each look of the visual check (a fresh WordPress: the Node sandbox tires after
//! thousands of requests). A theme the gate blocks fails the
//! job; its data is kept as `theme-data.blocked.json`.
//!
//! `--rebuild-from` makes a theme again from an earlier run's model answers without a model call:
//! this code's deterministic plan (styles, menus, block styles, files) with that run's templates,
//! parts and labels, assembled and checked as the job does, and says which parts changed.
//!
//! `--design` is a Claude Design standalone export (one `.html`) or a bundle directory; `--content`
//! the site repo's `content/` (cinqueterre.travel's): its menus and footer give the pages a menu
//! may link (the site's closed world). The orchestrator's own `SiteTheme` job runs on it, with the
//! fake web designer (`--llm fake`, the default) or GPT-6-Luna through the central server's
//! `/api/llm/generate` (`--llm hosted`: a dev login, its company and lease; the server holds the
//! provider's key, this program never sees it). Nothing is deployed and no site repository is
//! touched: the theme goes on an in-memory branch, and `--out` gets:
//!
//! - `theme-data.json`: the `ThemeData` with its font files under `assets/` (for
//!   `swarmpress-wp-migrate --theme-data`: the importer writes it onto `canvas`);
//! - `report.json`: the digest, every template's and part's outcome (repair rounds and the issues
//!   repaired), the notes, the model calls, or the failure and why;
//! - `site.json`: the site as the job saw it; `design/`: the bundle's files and the design's
//!   static pages (`*.static.html`, their regions marked);
//! - with `--wordpress URL --repo URL` (a Node WordPress that has the site, and its governed API):
//!   the job's visual check. Each look writes the theme on `design-v{n}-look-{round}`
//!   (`swarmpress-wp-migrate theme`, shown to visitors) and runs `apps/game/e2e/theme-visual.mts`
//!   on the design's static pages and the site's pages (the front page, the other languages' home,
//!   a listing page of a village per listing template); `visual/round-{n}/` keeps the spec, the
//!   screenshots and `visual.json`. The sandbox serves thousands of requests over a run: start it
//!   fresh for each run.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use agents::fake_writer::fake_writer;
use agents::llm::{DeltaSink, LlmRole};
use agents::{Llm, LlmError, LlmRequest};
use async_trait::async_trait;
use content_import_wp::plan::MenuItem;
use orchestrator::{
    FakeGateway, JobKind, JobRequest, MemStore, Orchestrator, Outcome, SiteBinding, StaffRef, Store,
};
use serde_json::{json, Value};
use site_design::model::QuerySource;
use site_design::{interpret, DesignBundle, DesignSource};
use theme_designer::model::{Place, SiteImage};
use theme_designer::{Collection, SiteContext, SiteLink};

const COMPANY: &str = "cli";
const ITEM: &str = "work-item-1";

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn die(msg: impl std::fmt::Display) -> ! {
    eprintln!("swarmpress-site-theme: {msg}");
    std::process::exit(2)
}

fn read_dir(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap_or_else(|e| die(format!("{}: {e}", d.display()))) {
            let p = e.unwrap_or_else(|e| die(e)).path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(rel, std::fs::read(&p).unwrap_or_else(|e| die(e)));
            }
        }
    }
    out
}

fn bundle(path: &Path) -> DesignBundle {
    if path.is_dir() {
        DesignBundle::new(read_dir(path), DesignSource::Upload, 0)
            .unwrap_or_else(|e| die(format!("{}: {e:?}", path.display())))
    } else {
        let name = path
            .file_name()
            .map_or("design.html".into(), |n| n.to_string_lossy().into_owned());
        let bytes = std::fs::read(path).unwrap_or_else(|e| die(format!("{}: {e}", path.display())));
        DesignBundle::from_upload(BTreeMap::from([(name, bytes)]), DesignSource::Upload, 0)
            .unwrap_or_else(|e| die(format!("{}: {e:?}", path.display())))
    }
}

fn flatten(lang: &str, items: &[MenuItem], keys: Option<&[MenuItem]>, out: &mut Vec<SiteLink>) {
    for (i, it) in items.iter().enumerate() {
        let url = it.url.trim();
        let en = keys.and_then(|k| k.get(i));
        if !url.is_empty() && !url.contains('#') && !it.label.trim().is_empty() {
            out.push(SiteLink {
                lang: lang.to_string(),
                label: it.label.clone(),
                url: url.to_string(),
                key: en.map(|e| theme_designer::styles::label_key(&e.label)),
            });
        }
        flatten(lang, &it.children, en.map(|e| e.children.as_slice()), out);
    }
}

/// `pages/06-home.html` → `pages/06-home.static.html`.
fn static_name(path: &str) -> String {
    match path.strip_suffix(".html") {
        Some(p) => format!("{p}.static.html"),
        None => format!("{path}.static.html"),
    }
}

/// Collections the site's WordPress lists (content-import-wp's entries, wp-sandbox 0.9.0): each a
/// `core/query` the theme may use, its fields for block bindings, the design's listing it fills.
fn collections() -> Vec<Collection> {
    let c = |name: &str,
             label: &str,
             source: QuerySource,
             keywords: &[&str],
             query: Value,
             fields: &[&str],
             listing: Option<&str>| Collection {
        name: name.into(),
        label: label.into(),
        source,
        keywords: keywords.iter().map(|k| k.to_string()).collect(),
        query,
        fields: fields.iter().map(|f| f.to_string()).collect(),
        listing: listing.map(String::from),
    };
    vec![
        c(
            "latest-stories",
            "Latest stories",
            QuerySource::Latest,
            &["stories", "dispatch", "latest"],
            json!({"postType": "post", "order": "desc", "orderBy": "date"}),
            &["image", "image_alt"],
            None,
        ),
        c(
            "editors-picks",
            "Editors' picks",
            QuerySource::Featured,
            &["picks", "curated", "editors"],
            json!({"postType": "post", "sticky": "only", "order": "desc", "orderBy": "date"}),
            &["image", "image_alt"],
            None,
        ),
        c(
            "villages",
            "The five villages",
            QuerySource::Collection,
            &["villages", "destinations", "five"],
            json!({"postType": "sp_village", "order": "asc", "orderBy": "menu_order"}),
            &["number", "line", "image", "image_alt"],
            None,
        ),
        c(
            "stays",
            "Places to stay",
            QuerySource::Collection,
            &["stay", "stays", "sleep", "places", "hotels"],
            json!({"postType": "sp_stay", "order": "asc", "orderBy": "menu_order"}),
            &[
                "village",
                "kind",
                "price",
                "price_unit",
                "rating",
                "rating_scale",
                "image",
                "image_alt",
            ],
            Some("stay"),
        ),
        c(
            "restaurants",
            "Restaurants",
            QuerySource::Collection,
            &["restaurants", "eat", "food"],
            json!({"postType": "sp_restaurant", "order": "asc", "orderBy": "menu_order", "place": "current"}),
            &[
                "village",
                "cuisine",
                "line",
                "price",
                "price_rest",
                "price_label",
                "rating",
                "rating_scale",
                "closed",
                "book",
                "closed_label",
                "book_label",
            ],
            Some("restaurant"),
        ),
        c(
            "activities",
            "Things to do",
            QuerySource::Collection,
            &["activities", "things", "do"],
            json!({"postType": "sp_activity", "order": "asc", "orderBy": "menu_order", "place": "current"}),
            &[
                "village",
                "label",
                "line",
                "image",
                "image_alt",
                "duration",
                "cost",
                "best",
                "time_label",
                "cost_label",
                "best_label",
            ],
            Some("activity"),
        ),
        c(
            "editors",
            "The editors",
            QuerySource::Collection,
            &["editors", "team", "people"],
            json!({"postType": "sp_editor", "order": "asc", "orderBy": "menu_order"}),
            &["role", "line", "bio", "first", "image", "image_alt"],
            Some("editor"),
        ),
    ]
}

/// A source menu item as the theme's navigation item.
fn nav_item(m: &MenuItem) -> site_design::wordpress::NavigationItem {
    site_design::wordpress::NavigationItem {
        label: m.label.clone(),
        url: m.url.clone(),
        children: m.children.iter().map(nav_item).collect(),
        class: None,
    }
}

/// The site as the theme sees it, from its content (the import's menus, pages and entries) and
/// the design's listing templates (`archive-…`: which pages they take).
fn site_of(content: &Path, design: &site_design::SiteDesign) -> SiteContext {
    let site = content_import_wp::Site::read(content).unwrap_or_else(|e| die(e));
    let plan = content_import_wp::plan::plan(&site);
    let mut links = Vec::new();
    let en_menu = plan.menus.get("en").cloned().unwrap_or_default();
    for (lang, items) in &plan.menus {
        flatten(lang, items, Some(&en_menu), &mut links);
    }
    for by_lang in plan.named_menus.values() {
        let en = by_lang.get("en").cloned().unwrap_or_default();
        for (lang, items) in by_lang {
            flatten(lang, items, Some(&en), &mut links);
        }
    }
    // The site's hubs under the words a design uses for them: the page's own title in each
    // language, one key for all.
    let titles: BTreeMap<&str, &str> = plan
        .docs
        .iter()
        .map(|d| (d.route.as_str(), d.title.as_str()))
        .collect();
    // (the design's word, the hub, the word in en, de, fr, it)
    for (alias, seg, words) in [
        (
            "Stories",
            "blog",
            ["Stories", "Geschichten", "Histoires", "Storie"],
        ),
        (
            "All stories",
            "blog",
            [
                "All stories",
                "Alle Geschichten",
                "Toutes les histoires",
                "Tutte le storie",
            ],
        ),
        (
            "Places to Stay",
            "accommodations",
            [
                "Places to Stay",
                "Unterkünfte",
                "Hébergements",
                "Dove dormire",
            ],
        ),
        (
            "See all stays",
            "accommodations",
            [
                "See all stays",
                "Alle Unterkünfte",
                "Tous les hébergements",
                "Tutti gli alloggi",
            ],
        ),
        (
            "Explore the villages",
            "village",
            [
                "Explore the villages",
                "Die Dörfer entdecken",
                "Découvrir les villages",
                "Scopri i borghi",
            ],
        ),
        (
            "Plan your trip",
            "itinerary",
            [
                "Plan your trip",
                "Reise planen",
                "Préparer le voyage",
                "Pianifica il viaggio",
            ],
        ),
        (
            "Read the itinerary",
            "itinerary",
            [
                "Read the itinerary",
                "Zur Route",
                "Lire l'itinéraire",
                "Leggi l'itinerario",
            ],
        ),
        (
            "Itineraries",
            "itinerary",
            ["Itineraries", "Routen", "Itinéraires", "Itinerari"],
        ),
        (
            "Things to Do",
            "things-to-do",
            ["Things to Do", "Aktivitäten", "À faire", "Cosa fare"],
        ),
        (
            "Food & Drink",
            "culinary",
            [
                "Food & Drink",
                "Essen & Trinken",
                "Gastronomie",
                "Cibo e vino",
            ],
        ),
        (
            "Weather",
            "weather",
            ["Weather", "Wetter", "Météo", "Meteo"],
        ),
        (
            "Our Team",
            "team",
            ["Our Team", "Unser Team", "Notre équipe", "Il nostro team"],
        ),
        (
            "Getting Around",
            "transportation",
            [
                "Getting Around",
                "Unterwegs",
                "Se déplacer",
                "Come muoversi",
            ],
        ),
        (
            "Events",
            "events",
            ["Events", "Veranstaltungen", "Événements", "Eventi"],
        ),
        (
            "Sights",
            "sights",
            ["Sights", "Sehenswürdigkeiten", "Sites", "Attrazioni"],
        ),
    ] {
        for (i, lang) in content_import_wp::LANGS.iter().enumerate() {
            let url = format!("/{lang}/{seg}/");
            if !titles.contains_key(url.as_str()) {
                continue;
            }
            links.push(SiteLink {
                lang: lang.to_string(),
                label: words[i].to_string(),
                url,
                key: Some(theme_designer::styles::label_key(alias)),
            });
        }
    }
    links.sort_by(|a, b| (&a.lang, &a.url, &a.label).cmp(&(&b.lang, &b.url, &b.label)));
    links.dedup();
    let places = content_import_wp::routes::VILLAGES
        .iter()
        .map(|(slug, names)| Place {
            slug: slug.to_string(),
            label: names[0].to_string(),
            // A place's line: its hero's subtitle, per language.
            lines: content_import_wp::LANGS
                .iter()
                .filter_map(|l| {
                    let line = site
                        .villages
                        .get(*slug)?
                        .get("hero")?
                        .get("subtitle")
                        .and_then(|s| content_import_wp::localized(s, l))?;
                    Some((l.to_string(), line.to_string()))
                })
                .collect(),
        })
        .collect();
    // The source site's menus, nested, per language (the theme keeps every entry).
    let menus = content_import_wp::plan::source_menus(&site, Default::default())
        .into_iter()
        .map(|m| theme_designer::model::SourceMenu {
            name: m.name,
            lang: m.lang,
            area: match m.area.as_str() {
                "header" => theme_designer::model::MenuArea::Header,
                "footer" => theme_designer::model::MenuArea::Footer,
                _ => theme_designer::model::MenuArea::Other,
            },
            items: m.items.iter().map(nav_item).collect(),
        })
        .collect();
    // The page types, from the content as the import gives it a design (its classes), with the
    // templates the import assigns.
    let designed = content_import_wp::plan::plan_with(
        &site,
        content_import_wp::compose::Options {
            design: true,
            ..Default::default()
        },
    );
    let listings: std::collections::BTreeSet<String> = design
        .templates
        .iter()
        .filter(|t| t.kind == site_design::model::TemplateKind::Listing)
        .map(|t| site_design::wordpress::template_slug(t.kind, &t.slug))
        .collect();
    let page_types = content_import_wp::design::page_types(&designed.docs, &listings)
        .into_iter()
        .filter(|p| p.key != "home")
        .map(|p| theme_designer::model::PageType {
            key: p.key,
            label: p.label,
            template: p.template,
            count: p.count,
            sample: p.sample,
            kinds: p.kinds,
            post: p.post,
            placed: p.placed,
        })
        .collect();
    // A story to feature per place and language: the newest that names the place.
    let mut featured = Vec::new();
    for (slug, _) in content_import_wp::routes::VILLAGES {
        for lang in content_import_wp::LANGS {
            let story = designed
                .docs
                .iter()
                .filter(|d| {
                    d.post_type == "post"
                        && d.lang == lang
                        && d.meta.get("_swarmpress_story_place").map(String::as_str) == Some(slug)
                })
                .max_by(|a, b| a.date.cmp(&b.date).then_with(|| b.route.cmp(&a.route)));
            if let Some(d) = story {
                featured.push(theme_designer::model::Featured {
                    place: slug.to_string(),
                    lang: lang.to_string(),
                    title: d.title.clone(),
                    url: d.route.clone(),
                    image: d.meta.get("image").cloned(),
                });
            }
        }
    }
    let images = content_import_wp::routes::VILLAGES
        .iter()
        .filter_map(|(slug, names)| {
            let hero = site.villages.get(*slug)?.get("hero")?;
            let url = hero.get("image")?.as_str()?.to_string();
            let alt = hero
                .get("imageAlt")
                .and_then(|a| content_import_wp::localized(a, "en"))
                .unwrap_or(names[0])
                .to_string();
            Some(SiteImage {
                label: format!("{} {alt}", names[0]),
                url,
                alt,
            })
        })
        .collect();
    SiteContext {
        name: plan.title.clone(),
        languages: content_import_wp::LANGS
            .iter()
            .map(|l| l.to_string())
            .collect(),
        links,
        collections: collections(),
        places,
        images,
        menus,
        retired: Vec::new(),
        page_types,
        featured,
        forms: false,
        words: content_import_wp::design::content_words(&plan.docs),
    }
}

// ------------------------------------------------------------------ the visual check

/// The visual check's host side (`theme_designer::visual`): writes the theme on a branch of a
/// WordPress that has the site (`swarmpress-wp-migrate theme`), shows it to visitors, and runs
/// `apps/game/e2e/theme-visual.mts` on the design's static pages and the site's pages.
struct Visual {
    wp: String,
    repo: String,
    out: PathBuf,
    bundle: DesignBundle,
    design: site_design::SiteDesign,
    site: SiteContext,
    content: PathBuf,
    restart: Option<String>,
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

impl Visual {
    fn fail(e: impl std::fmt::Display) -> orchestrator::GatewayError {
        orchestrator::GatewayError(format!("the visual check: {e}"))
    }

    /// The pages to compare: every template with a design page, at the site URL that renders it.
    fn spec(&self, data: &site_design::ThemeData) -> Value {
        let plan = theme_designer::plan(&self.design, &self.bundle.manifest(), &self.site);
        let docs = content_import_wp::Site::read(&self.content)
            .map(|s| content_import_wp::plan::plan(&s).docs)
            .unwrap_or_default();
        let url_for = |slug: &str| -> Option<String> {
            match slug {
                "front-page" => Some("/".into()),
                _ if slug == theme_designer::plan::LANGUAGE_HOME => {
                    self.site.langs().get(1).map(|l| format!("/{l}/"))
                }
                _ => {
                    let listing = slug.strip_prefix("archive-")?;
                    // A listing of a place where there is one (the place's own entries).
                    let mut routes: Vec<&str> = docs
                        .iter()
                        .map(|d| d.route.as_str())
                        .filter(|r| r.starts_with("/en/"))
                        .filter(|r| content_import_wp::plan::listing_of(r) == Some(listing))
                        .collect();
                    // A village's page first (the listing in one place), then the deepest.
                    let village = |r: &str| {
                        let seg = r.split('/').nth(2).unwrap_or("");
                        content_import_wp::routes::VILLAGES
                            .iter()
                            .any(|(v, _)| *v == seg)
                    };
                    routes.sort_by_key(|r| {
                        (
                            !village(r),
                            std::cmp::Reverse(r.matches('/').count()),
                            r.to_string(),
                        )
                    });
                    routes.first().map(|r| r.to_string())
                }
            }
        };
        let mut pages = Vec::new();
        for t in &data.templates {
            let Some(task) = plan.tasks.iter().find(|x| {
                x.slug == t.slug
                    || (t.slug == theme_designer::plan::LANGUAGE_HOME && x.slug == "front-page")
            }) else {
                continue;
            };
            let Some(dt) = task
                .design
                .as_ref()
                .and_then(|d| self.design.templates.iter().find(|x| &x.slug == d))
            else {
                continue;
            };
            let Some(url) = url_for(&t.slug) else {
                continue;
            };
            let mut regions = Vec::new();
            let listing = dt.kind == site_design::model::TemplateKind::Listing;
            if !listing {
                regions.push(json!({"name": "header", "design": "[data-sp-part=header]", "site": "header.wp-block-template-part"}));
            }
            for s in &task.sections {
                let comp = match (&s.kind[..], &s.what) {
                    ("component", Some(c)) | ("query", Some(c)) if listing => Some(c.clone()),
                    _ => None,
                };
                let design_sel = match comp {
                    Some(c) => format!("[data-sp-component={c}] > :nth-child(2)"),
                    None if !listing && dt.sections.iter().any(|x| x.id == s.id) => {
                        format!("[data-sp-section={}]", s.id)
                    }
                    None => continue,
                };
                regions.push(json!({"name": s.id, "design": design_sel, "site": format!(".{}", s.class), "sameAspect": listing}));
            }
            if !listing {
                regions.push(json!({"name": "footer", "design": "[data-sp-part=footer]", "site": "footer.wp-block-template-part"}));
            }
            pages.push(json!({
                "name": t.slug,
                "design": static_name(&dt.source),
                "site": url,
                "regions": regions,
            }));
        }
        json!({
            "design": self.out.join("design"),
            "site": self.wp,
            "widths": [375, 1280],
            "mask": {"design": ".ph", "site": ".ds-tile,.ds-card-img,.wp-block-post-featured-image"},
            "pages": pages,
        })
    }

    fn check(
        &self,
        version: u32,
        data: &site_design::ThemeData,
        round: u32,
    ) -> Result<Option<theme_designer::visual::VisualReport>, orchestrator::GatewayError> {
        let dir = self.out.join("visual").join(format!("round-{round}"));
        std::fs::create_dir_all(&dir).map_err(Self::fail)?;
        if let Some(cmd) = &self.restart {
            let ok = std::process::Command::new("sh")
                .args(["-c", cmd])
                .status()
                .map_err(|e| Self::fail(format!("--restart: {e}")))?;
            if !ok.success() {
                return Err(Self::fail("--restart failed"));
            }
        }
        // The data with its font files beside it, as the importer reads it.
        let mut data = data.clone();
        for f in &mut data.fonts {
            for face in &mut f.faces {
                let bytes = self.bundle.bytes(&face.file.path).ok_or_else(|| {
                    Self::fail(format!("{} is not in the bundle", face.file.path))
                })?;
                let p = dir.join(&face.file.path);
                if let Some(d) = p.parent() {
                    std::fs::create_dir_all(d).map_err(Self::fail)?;
                }
                std::fs::write(&p, bytes).map_err(Self::fail)?;
            }
        }
        data.design = self.bundle.hash().to_string();
        let file = dir.join("theme-data.json");
        std::fs::write(
            &file,
            serde_json::to_string_pretty(&data).map_err(Self::fail)?,
        )
        .map_err(Self::fail)?;
        let migrate = root().join("target/release/swarmpress-wp-migrate");
        let branch = format!("design-v{version}-look-{round}");
        let status = std::process::Command::new(&migrate)
            .args(["theme", "--theme-data"])
            .arg(&file)
            .args([
                "--sandbox",
                &self.wp,
                "--repo",
                &self.repo,
                "--branch",
                &branch,
            ])
            .status()
            .map_err(|e| Self::fail(format!("{}: {e}", migrate.display())))?;
        if !status.success() {
            return Err(Self::fail(format!("writing the theme on {branch} failed")));
        }
        let spec = dir.join("spec.json");
        std::fs::write(
            &spec,
            serde_json::to_string_pretty(&self.spec(&data)).map_err(Self::fail)?,
        )
        .map_err(Self::fail)?;
        let status = std::process::Command::new("bun")
            .current_dir(root().join("apps/game"))
            .args(["e2e/theme-visual.mts", "--spec"])
            .arg(&spec)
            .arg("--out")
            .arg(&dir)
            .status()
            .map_err(|e| Self::fail(format!("bun: {e}")))?;
        if !status.success() {
            return Err(Self::fail("the screenshots failed"));
        }
        let text = std::fs::read_to_string(dir.join("visual.json")).map_err(Self::fail)?;
        let report: theme_designer::visual::VisualReport =
            serde_json::from_str(&text).map_err(Self::fail)?;
        for line in report.lines() {
            eprintln!("look {round}: {line}");
        }
        Ok(Some(report))
    }
}

// ------------------------------------------------------------------ the QA stage

/// The QA stage's host side (ADR-0094, FEAT-116): the branch's theme written on a branch of a
/// WordPress that has the site, that branch exported (`swarmpress-wp-migrate export --branch`, the
/// import plan giving the pages' language versions), every page of the export observed at 1280 and
/// 390 px and judged (`apps/game/e2e/page-audit.mts`, then `swarmpress-wp-migrate qa`) with the
/// site's listed content gaps; `qa/round-{n}/` keeps the export, the facts and the report.
struct Audit {
    wp: String,
    repo: String,
    out: PathBuf,
    bundle: DesignBundle,
    plan: PathBuf,
    exceptions: Option<PathBuf>,
    public_origin: String,
    /// A command that gives each round a fresh WordPress (`--restart CMD`; the Node sandbox
    /// tires after thousands of requests).
    restart: Option<String>,
}

impl Audit {
    fn fail(e: impl std::fmt::Display) -> orchestrator::GatewayError {
        orchestrator::GatewayError(format!("the QA stage: {e}"))
    }

    fn check(
        &self,
        branch: &str,
        head: &str,
        round: u32,
        theme: Option<&str>,
    ) -> Result<Option<site_quality::QaReport>, orchestrator::GatewayError> {
        let theme = theme.ok_or_else(|| Self::fail(format!("no theme on {branch}")))?;
        let mut data: site_design::ThemeData = serde_json::from_str(theme).map_err(Self::fail)?;
        let dir = self.out.join("qa").join(format!("round-{round}"));
        std::fs::create_dir_all(&dir).map_err(Self::fail)?;
        for f in &mut data.fonts {
            for face in &mut f.faces {
                let bytes = self.bundle.bytes(&face.file.path).ok_or_else(|| {
                    Self::fail(format!("{} is not in the bundle", face.file.path))
                })?;
                let p = dir.join(&face.file.path);
                if let Some(d) = p.parent() {
                    std::fs::create_dir_all(d).map_err(Self::fail)?;
                }
                std::fs::write(&p, bytes).map_err(Self::fail)?;
            }
        }
        data.design = self.bundle.hash().to_string();
        let file = dir.join("theme-data.json");
        std::fs::write(
            &file,
            serde_json::to_string_pretty(&data).map_err(Self::fail)?,
        )
        .map_err(Self::fail)?;
        if let Some(cmd) = &self.restart {
            let ok = std::process::Command::new("sh")
                .args(["-c", cmd])
                .status()
                .map_err(|e| Self::fail(format!("--restart: {e}")))?;
            if !ok.success() {
                return Err(Self::fail("--restart failed"));
            }
        }
        let migrate = root().join("target/release/swarmpress-wp-migrate");
        let qa_branch = format!("{branch}-qa-{round}");
        let run = |cmd: &mut std::process::Command, what: &str| {
            let status = cmd
                .status()
                .map_err(|e| Self::fail(format!("{what}: {e}")))?;
            if status.success() {
                Ok(())
            } else {
                Err(Self::fail(format!("{what} failed")))
            }
        };
        run(
            std::process::Command::new(&migrate)
                .args(["theme", "--theme-data"])
                .arg(&file)
                .args([
                    "--sandbox",
                    &self.wp,
                    "--repo",
                    &self.repo,
                    "--branch",
                    &qa_branch,
                ]),
            "writing the theme",
        )?;
        let export = dir.join("export");
        let _ = std::fs::remove_dir_all(&export);
        run(
            std::process::Command::new(&migrate)
                .args(["export", "--sandbox", &self.wp, "--repo", &self.repo])
                .args([
                    "--public-origin",
                    &self.public_origin,
                    "--branch",
                    &qa_branch,
                ])
                .arg("--out")
                .arg(&export)
                .arg("--theme-data")
                .arg(&file)
                .arg("--plan")
                .arg(&self.plan),
            "the export",
        )?;
        let mut audit = std::process::Command::new("bun");
        audit
            .current_dir(root().join("apps/game"))
            .args(["e2e/page-audit.mts", "--export"])
            .arg(&export)
            .arg("--out")
            .arg(dir.join("audit"))
            .arg("--theme-data")
            .arg(&file)
            .args([
                "--production",
                &self.public_origin,
                "--branch",
                branch,
                "--commit",
                head,
            ]);
        if let Some(e) = &self.exceptions {
            audit.arg("--exceptions").arg(e);
        }
        // Exit 1 is a blocked gate, not a failure of the stage.
        let status = audit
            .status()
            .map_err(|e| Self::fail(format!("bun: {e}")))?;
        if status.code().is_none_or(|c| c > 1) {
            return Err(Self::fail("the audit did not run"));
        }
        let text =
            std::fs::read_to_string(dir.join("audit").join("report.json")).map_err(Self::fail)?;
        let report: site_quality::QaReport = serde_json::from_str(&text).map_err(Self::fail)?;
        eprintln!("qa {round}: {}", report.line());
        Ok(Some(report))
    }
}

// ------------------------------------------------------------------ hosted GPT-6-Luna

/// GPT-6-Luna through the central server (`POST /api/llm/generate`, ADR-0067): signed in with a
/// dev login, the company's lease renewed as it goes. The key stays on the server.
struct Hosted {
    http: reqwest::Client,
    server: String,
    cookie: String,
    company: String,
    lease: Mutex<(String, std::time::Instant)>,
    calls: Mutex<Vec<Value>>,
}

impl Hosted {
    async fn connect(server: &str, login: &str) -> Result<Hosted, String> {
        let http = reqwest::Client::new();
        let res = http
            .post(format!("{server}/auth/dev/login"))
            .json(&json!({"login": login}))
            .send()
            .await
            .map_err(|e| format!("dev login: {e}"))?;
        if !res.status().is_success() {
            return Err(format!(
                "dev login: {} (the server needs SWARMPRESS_DEV_AUTH=1)",
                res.status()
            ));
        }
        let cookie = res
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|v| v.split(';').next())
            .collect::<Vec<_>>()
            .join("; ");
        let me = |http: &reqwest::Client| {
            http.get(format!("{server}/api/companies/me"))
                .header(reqwest::header::COOKIE, cookie.clone())
                .send()
        };
        let mut res = me(&http).await.map_err(|e| e.to_string())?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            http.post(format!("{server}/api/companies"))
                .header(reqwest::header::COOKIE, cookie.clone())
                .json(&json!({"name": "Web designer (CLI)"}))
                .send()
                .await
                .map_err(|e| format!("company: {e}"))?;
            res = me(&http).await.map_err(|e| e.to_string())?;
        }
        let company: Value = res.json().await.map_err(|e| format!("company: {e}"))?;
        let company = company["id"]
            .as_str()
            .ok_or("the dev login has no company")?
            .to_string();
        let h = Hosted {
            http,
            server: server.to_string(),
            cookie,
            company,
            lease: Mutex::new((String::new(), std::time::Instant::now())),
            calls: Mutex::new(Vec::new()),
        };
        h.lease("acquire").await?;
        Ok(h)
    }

    async fn lease(&self, mode: &str) -> Result<String, String> {
        let current = self
            .lease
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .clone();
        let mut req = self
            .http
            .post(format!(
                "{}/api/companies/{}/lease",
                self.server, self.company
            ))
            .header(reqwest::header::COOKIE, self.cookie.clone())
            .json(&json!({"device_id": "cli-site-theme", "mode": mode, "kind": "self"}));
        if mode == "renew" {
            req = req.header("x-swarmpress-lease", current);
        }
        let res = req.send().await.map_err(|e| format!("lease: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("lease ({mode}): {}", res.status()));
        }
        let v: Value = res.json().await.map_err(|e| format!("lease: {e}"))?;
        let token = v["token"].as_str().ok_or("lease: no token")?.to_string();
        *self.lease.lock().unwrap_or_else(|e| e.into_inner()) =
            (token.clone(), std::time::Instant::now());
        Ok(token)
    }

    async fn token(&self) -> Result<String, String> {
        let (token, at) = self.lease.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if at.elapsed().as_secs() < 30 {
            return Ok(token);
        }
        self.lease("renew").await
    }

    async fn release(&self) {
        let token = self
            .lease
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .clone();
        let _ = self
            .http
            .delete(format!(
                "{}/api/companies/{}/lease",
                self.server, self.company
            ))
            .header(reqwest::header::COOKIE, self.cookie.clone())
            .header("x-swarmpress-lease", token)
            .send()
            .await;
    }

    async fn turn(&self, req: &LlmRequest, schema: Option<&Value>) -> Result<String, LlmError> {
        let mut messages = vec![json!({"role": "system", "content": req.system.join("\n\n")})];
        for m in &req.messages {
            let role = match m.role {
                LlmRole::User => "user",
                LlmRole::Assistant => "assistant",
            };
            messages.push(json!({"role": role, "content": m.text}));
        }
        let reasoning = req.reasoning_tokens.unwrap_or(0);
        let mut body = json!({
            "messages": messages,
            "kind": "web-design",
            "max_output_tokens": req.max_tokens + reasoning,
            "reasoning_effort": if reasoning > 0 { "medium" } else { "none" },
            "service_tier": "default",
        });
        if let Some(s) = schema {
            body["json_schema"] = s.clone();
        }
        let token = self.token().await.map_err(LlmError::Unavailable)?;
        let started = std::time::Instant::now();
        let res = self
            .http
            .post(format!("{}/api/llm/generate", self.server))
            .header(reqwest::header::COOKIE, self.cookie.clone())
            .header("x-swarmpress-lease", token)
            .json(&body)
            .send()
            .await
            .map_err(|e| LlmError::Unavailable(e.to_string()))?;
        let status = res.status();
        let v: Value = res.json().await.unwrap_or(Value::Null);
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(json!({
                "status": status.as_u16(),
                "finish": v["finish"],
                "usage": v["usage"],
                "cost_micros": v["cost_micros"],
                "duration_ms": started.elapsed().as_millis() as u64,
            }));
        match status.as_u16() {
            200 => {}
            503 | 504 => return Err(LlmError::Unavailable(format!("{status}: {}", v["error"]))),
            _ => return Err(LlmError::Backend(format!("{status}: {}", v["error"]))),
        }
        if v["finish"] == "length" {
            return Err(LlmError::Truncated {
                partial: v["text"].as_str().unwrap_or("").chars().take(200).collect(),
            });
        }
        Ok(v["text"].as_str().unwrap_or("").to_string())
    }
}

#[async_trait]
impl Llm for Hosted {
    async fn generate(
        &self,
        req: &LlmRequest,
        _on_delta: Option<DeltaSink<'_>>,
    ) -> Result<String, LlmError> {
        self.turn(req, None).await
    }

    async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError> {
        let text = self.turn(req, Some(schema)).await?;
        let value = claude::extract_json(&text).map_err(|e| LlmError::InvalidOutput {
            errors: vec![e],
            answer: Some(text.chars().take(2000).collect()),
        })?;
        let validator = claude::SchemaValidator::new(schema)
            .map_err(|e| LlmError::Backend(format!("bad schema: {e}")))?;
        validator
            .validate(&value)
            .map_err(|errors| LlmError::InvalidOutput {
                errors,
                answer: Some(value.to_string().chars().take(2000).collect()),
            })?;
        Ok(value)
    }

    fn model_id(&self) -> Option<String> {
        Some("gpt-6-luna".into())
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        println!("usage: swarmpress-site-theme --design FILE|DIR --content DIR --out DIR [--llm fake|hosted] [--server URL] [--login NAME] [--version N] [--wordpress URL --repo URL]");
        return;
    }
    let need = |n: &str| arg(&args, n).unwrap_or_else(|| die(format!("missing {n}")));
    let design_path = PathBuf::from(need("--design"));
    let content = PathBuf::from(need("--content"));
    let out = PathBuf::from(need("--out"));
    let version: u32 = arg(&args, "--version")
        .map(|v| v.parse().unwrap_or_else(|_| die("--version is a number")))
        .unwrap_or(1);
    let which = arg(&args, "--llm").unwrap_or_else(|| "fake".into());
    std::fs::create_dir_all(&out).unwrap_or_else(|e| die(e));

    let b = bundle(&design_path);
    let design = interpret(&b);
    let site = site_of(&content, &design);
    eprintln!(
        "design {} ({} files, bundle {}): {} templates, {} parts, {} pages read",
        design.title,
        b.files().len(),
        &b.hash()[..12],
        design.templates.len(),
        design.parts.len(),
        design.pages.len()
    );
    std::fs::write(
        out.join("site.json"),
        serde_json::to_string_pretty(&site).unwrap(),
    )
    .unwrap_or_else(|e| die(e));
    // The deterministic plan (tasks, navigation, block styles, files), for review.
    let the_plan = theme_designer::plan(&design, &b.manifest(), &site);
    std::fs::write(
        out.join("plan.json"),
        serde_json::to_string_pretty(&the_plan).unwrap(),
    )
    .unwrap_or_else(|e| die(e));
    for (path, bytes) in b.files() {
        let p = out.join("design").join(path);
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).unwrap_or_else(|e| die(e));
        }
        std::fs::write(&p, bytes).unwrap_or_else(|e| die(e));
    }
    // The design's pages as a visitor sees them, their regions marked (the visual check's side).
    let texts: BTreeMap<String, String> = b
        .files()
        .iter()
        .filter_map(|(p, bytes)| {
            (p.ends_with(".html") || p.ends_with(".css") || p == "design.json")
                .then(|| {
                    std::str::from_utf8(bytes)
                        .ok()
                        .map(|t| (p.clone(), t.to_string()))
                })
                .flatten()
        })
        .collect();
    for (path, html) in site_design::render::static_pages(&design, &texts) {
        let p = out.join("design").join(static_name(&path));
        std::fs::write(&p, html).unwrap_or_else(|e| die(e));
    }
    // The report of a site already made (`--report-export DIR --theme-data FILE`): the coverage of
    // the design's components and the site's page types, and their visual comparison at 375 and
    // 1280 px on the static export, without a job.
    // A theme made again from a run's model answers (`--rebuild-from FILE`, no model call): the
    // deterministic plan of this code with the run's templates, parts and labels, assembled as
    // the job assembles them, checked as the job checks them; written as `theme-data.json` beside
    // FILE's assets in `--out`.
    if let Some(file) = arg(&args, "--rebuild-from") {
        let old: site_design::ThemeData = serde_json::from_str(
            &std::fs::read_to_string(&file).unwrap_or_else(|e| die(format!("{file}: {e}"))),
        )
        .unwrap_or_else(|e| die(format!("{file}: {e}")));
        let mut markup = BTreeMap::new();
        for t in &the_plan.tasks {
            let content = match t.kind {
                theme_designer::TaskKind::Template => old
                    .templates
                    .iter()
                    .find(|x| x.slug == t.slug)
                    .map(|x| x.content.clone()),
                theme_designer::TaskKind::Part => old
                    .template_parts
                    .iter()
                    .find(|x| x.slug == t.slug)
                    .map(|x| x.content.clone()),
            };
            match content {
                Some(c) => {
                    markup.insert(t.label(), c);
                }
                None => die(format!("{file} has no {}", t.label())),
            }
        }
        let mut data = theme_designer::assemble(&the_plan, &markup);
        let mut errors: Vec<String> = theme_designer::check_theme(&data, &the_plan)
            .into_iter()
            .filter(theme_designer::Issue::is_error)
            .map(|i| i.line())
            .collect();
        errors.extend(
            theme_designer::catalog::coverage(&design, &the_plan, &data)
                .1
                .iter()
                .map(theme_designer::Issue::line),
        );
        errors.extend(
            theme_designer::navigation::check_pigments(&design, &data, &site)
                .iter()
                .map(theme_designer::Issue::line),
        );
        if !old.labels.is_empty() {
            data.global_styles
                .css
                .push_str(&theme_designer::labels::css(&old.labels));
            data.labels = old.labels.clone();
        }
        if !errors.is_empty() {
            die(errors.join("\n"));
        }
        let changed: Vec<&str> = [
            ("global_styles", data.global_styles != old.global_styles),
            ("templates", data.templates != old.templates),
            ("template_parts", data.template_parts != old.template_parts),
            ("navigation", data.navigation != old.navigation),
            ("fonts", data.fonts != old.fonts),
            ("block_styles", data.block_styles != old.block_styles),
            ("files", data.files != old.files),
            ("labels", data.labels != old.labels),
        ]
        .into_iter()
        .filter_map(|(k, c)| c.then_some(k))
        .collect();
        let target = out.join("theme-data.json");
        std::fs::write(&target, serde_json::to_string_pretty(&data).unwrap())
            .unwrap_or_else(|e| die(e));
        eprintln!(
            "rebuilt {} from {file}: changed {}",
            target.display(),
            if changed.is_empty() {
                "nothing".to_string()
            } else {
                changed.join(", ")
            }
        );
        return;
    }
    if let Some(export) = arg(&args, "--report-export") {
        let file = need("--theme-data");
        let data: site_design::ThemeData = serde_json::from_str(
            &std::fs::read_to_string(&file).unwrap_or_else(|e| die(format!("{file}: {e}"))),
        )
        .unwrap_or_else(|e| die(format!("{file}: {e}")));
        let p = theme_designer::plan(&design, &b.manifest(), &site);
        let (coverage, issues) = theme_designer::catalog::coverage(&design, &p, &data);
        let mut pages =
            theme_designer::visual::coverage_pages(&design, &p, &data, &coverage, &static_name);
        // A component is compared on a page that has it: when its sample page lacks every one of
        // its classes in its markup, the first exported page (the site's first language first)
        // that has one.
        let files = PathBuf::from(&export).join("files");
        let html_of = |url: &str| {
            std::fs::read_to_string(files.join(url.trim_start_matches('/')).join("index.html")).ok()
        };
        let has = |html: &str, sel: &str| {
            sel.split(", ").any(|c| {
                let c = c.trim_start_matches('.');
                html.match_indices("class=\"").any(|(i, _)| {
                    let rest = &html[i + 7..];
                    rest[..rest.find('"').unwrap_or(0)]
                        .split_whitespace()
                        .any(|x| x == c)
                })
            })
        };
        let mut all: Vec<String> = Vec::new();
        let mut stack = vec![files.clone()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
                let path = e.path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.file_name().is_some_and(|n| n == "index.html") {
                    if let Some(rel) = path.parent().and_then(|d| d.strip_prefix(&files).ok()) {
                        let r = rel.to_string_lossy();
                        all.push(if r.is_empty() {
                            "/".into()
                        } else {
                            format!("/{r}/")
                        });
                    }
                }
            }
        }
        let first = format!("/{}/", site.langs()[0]);
        all.sort_by_key(|u| (!u.starts_with(&first), u.len(), u.clone()));
        for page in pages.iter_mut().filter(|x| {
            x["name"]
                .as_str()
                .is_some_and(|n| n.starts_with("component "))
        }) {
            let sel = page["regions"][0]["site"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let url = page["site"].as_str().unwrap_or("/").to_string();
            if html_of(&url).is_some_and(|h| has(&h, &sel)) {
                continue;
            }
            if let Some(u) = all
                .iter()
                .find(|u| html_of(u).is_some_and(|h| has(&h, &sel)))
            {
                page["site"] = json!(u);
            }
        }
        let spec = json!({
            "design": out.join("design"),
            "site": PathBuf::from(&export).join("files"),
            "widths": [375, 1280],
            "mask": {"design": ".ph", "site": ".ds-tile,.ds-card-img,.wp-block-post-featured-image"},
            "pages": pages,
        });
        let dir = out.join("visual-coverage");
        std::fs::create_dir_all(&dir).unwrap_or_else(|e| die(e));
        std::fs::write(
            dir.join("spec.json"),
            serde_json::to_string_pretty(&spec).unwrap(),
        )
        .unwrap_or_else(|e| die(e));
        std::fs::write(
            out.join("coverage.json"),
            serde_json::to_string_pretty(&json!({"coverage": coverage, "issues": issues})).unwrap(),
        )
        .unwrap_or_else(|e| die(e));
        let status = std::process::Command::new("bun")
            .current_dir(root().join("apps/game"))
            .args(["e2e/theme-visual.mts", "--spec"])
            .arg(dir.join("spec.json"))
            .arg("--out")
            .arg(&dir)
            .status()
            .unwrap_or_else(|e| die(format!("bun: {e}")));
        if !status.success() {
            die("the screenshots failed");
        }
        eprintln!(
            "coverage: {} components used, {} unused; {} page types; {} issues",
            coverage
                .components
                .iter()
                .filter(|c| !c.used_in.is_empty())
                .count(),
            coverage
                .components
                .iter()
                .filter(|c| c.used_in.is_empty())
                .count(),
            coverage.page_types.len(),
            issues.len()
        );
        return;
    }

    let gateway = FakeGateway::new();
    gateway.put_design(
        version,
        json!({"version": version, "manifest": b.manifest(), "design": design}),
    );
    // The visual check on a WordPress that has the site (`--wordpress`, `--repo`): the theme on a
    // branch of its own, the design's pages and the site's screenshotted and compared.
    if let (Some(wp), Some(repo)) = (arg(&args, "--wordpress"), arg(&args, "--repo")) {
        let v = Visual {
            wp: wp.trim_end_matches('/').to_string(),
            repo,
            out: out.clone(),
            bundle: b.clone(),
            design: design.clone(),
            site: site.clone(),
            content: content.clone(),
            restart: arg(&args, "--restart"),
        };
        gateway.set_visual(Arc::new(move |version, data, round| {
            v.check(version, data, round)
        }));
    }
    // The QA stage on that WordPress (`--audit PLAN`: the import plan; `--exceptions FILE`: the
    // site's listed content gaps).
    if let (Some(wp), Some(repo), Some(plan)) = (
        arg(&args, "--wordpress"),
        arg(&args, "--repo"),
        arg(&args, "--audit"),
    ) {
        let a = Audit {
            wp: wp.trim_end_matches('/').to_string(),
            repo,
            out: out.clone(),
            bundle: b.clone(),
            plan: PathBuf::from(plan),
            exceptions: arg(&args, "--exceptions").map(PathBuf::from),
            public_origin: arg(&args, "--public-origin")
                .unwrap_or_else(|| "https://cinqueterre.travel".into()),
            restart: arg(&args, "--restart"),
        };
        gateway.set_audit(Arc::new(move |branch, head, round, theme| {
            a.check(branch, head, round, theme)
        }));
    }
    // A revision of an earlier theme (`--revise-from FILE`): its templates, parts and labels are
    // the first answers; only what does not pass costs a model call.
    let mut context = json!({"site": site});
    if let Some(file) = arg(&args, "--revise-from") {
        let old: site_design::ThemeData = serde_json::from_str(
            &std::fs::read_to_string(&file).unwrap_or_else(|e| die(format!("{file}: {e}"))),
        )
        .unwrap_or_else(|e| die(format!("{file}: {e}")));
        let mut start = serde_json::Map::new();
        for t in &old.templates {
            start.insert(format!("template {}", t.slug), json!(t.content));
        }
        for t in &old.template_parts {
            start.insert(format!("part {}", t.slug), json!(t.content));
        }
        context["start_from"] = Value::Object(start);
        context["labels"] = json!(old.labels);
    }
    let mut hosted: Option<Arc<Hosted>> = None;
    let llm: Arc<dyn Llm> = match which.as_str() {
        "fake" => Arc::new(fake_writer([])),
        "hosted" => {
            let server = arg(&args, "--server").unwrap_or_else(|| "http://127.0.0.1:8081".into());
            let login = arg(&args, "--login").unwrap_or_else(|| "web-designer-cli".into());
            let h = Arc::new(
                Hosted::connect(&server, &login)
                    .await
                    .unwrap_or_else(|e| die(e)),
            );
            hosted = Some(h.clone());
            h
        }
        other => die(format!("--llm {other}: fake or hosted")),
    };
    let binding = SiteBinding::from_json(&json!({
        "site_id": "cinqueterre.travel",
        "brand_name": site.name,
        "language": "en",
        "quality_bar": 7,
        "llm_profile": "local",
    }))
    .unwrap_or_else(|e| die(e));
    let o = Orchestrator::new(MemStore::new(), gateway, llm, binding);
    let req = JobRequest {
        company_id: COMPANY.into(),
        job_id: 1,
        kind: JobKind::SiteTheme,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(u64::from(version)),
        revision: 0,
        staff: vec![StaffRef {
            id: "staff-1".into(),
            persona: "serena".into(),
            role: "web-designer".into(),
        }],
        meeting: None,
        context,
        approved_by: None,
    };
    let started = std::time::Instant::now();
    let result = o.run(&req).await;
    if let Some(h) = &hosted {
        h.release().await;
    }
    let posts = o.store().plan_json(COMPANY).await.unwrap_or_default()["posts"][ITEM].clone();
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap_or_default();
    let calls = hosted
        .as_ref()
        .map(|h| Value::Array(h.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()))
        .unwrap_or(Value::Null);
    let mut report = json!({
        "design": {"title": design.title, "bundle": b.hash(), "version": version, "templates": design.templates.iter().map(|t| &t.slug).collect::<Vec<_>>()},
        "llm": which,
        "seconds": started.elapsed().as_secs(),
        "posts": posts,
        "calls": calls,
    });
    let code = match result {
        Err(e) => {
            report["error"] = json!(e.to_string());
            eprintln!("the job did not run: {e}");
            1
        }
        Ok(outcomes) => {
            report["outcomes"] = serde_json::to_value(&outcomes).unwrap_or_default();
            match outcomes.last() {
                Some(Outcome::JobCompleted { digest, .. }) => {
                    let rec = &art
                        .as_ref()
                        .map(|a| a["site_theme"].clone())
                        .unwrap_or_default();
                    report["tasks"] = rec["tasks"].clone();
                    report["quality"] = rec["quality"].clone();
                    report["notes"] = rec["notes"].clone();
                    report["summary"] = rec["summary"].clone();
                    let mut theme: site_design::ThemeData =
                        serde_json::from_value(rec["theme"].clone()).unwrap_or_else(|e| die(e));
                    // The font files beside the data (the importer reads them relative to it).
                    for f in &mut theme.fonts {
                        for face in &mut f.faces {
                            let bytes = b.bytes(&face.file.path).unwrap_or_else(|| {
                                die(format!("{} is not in the bundle", face.file.path))
                            });
                            let p = out.join(&face.file.path);
                            if let Some(d) = p.parent() {
                                std::fs::create_dir_all(d).unwrap_or_else(|e| die(e));
                            }
                            std::fs::write(&p, bytes).unwrap_or_else(|e| die(e));
                        }
                    }
                    theme.design = b.hash().to_string();
                    std::fs::write(
                        out.join("theme-data.json"),
                        serde_json::to_string_pretty(&theme).unwrap(),
                    )
                    .unwrap_or_else(|e| die(e));
                    eprintln!(
                        "{}\ndigest: ok {}, score {}, {} tasks, {} issues repaired",
                        rec["summary"].as_str().unwrap_or(""),
                        digest.ok,
                        digest.score,
                        digest.words,
                        digest.qa_defects
                    );
                    0
                }
                Some(Outcome::JobFailed { reason, .. }) => {
                    eprintln!("the job failed ({reason:?}); report.json has the thread");
                    let rec = art
                        .as_ref()
                        .map(|a| a["site_theme"].clone())
                        .unwrap_or_default();
                    report["quality"] = rec["quality"].clone();
                    // A theme blocked by the QA stage is kept for the record (never as passing).
                    if !rec["theme"].is_null() {
                        std::fs::write(
                            out.join("theme-data.blocked.json"),
                            serde_json::to_string_pretty(&rec["theme"]).unwrap(),
                        )
                        .unwrap_or_else(|e| die(e));
                    }
                    1
                }
                other => {
                    eprintln!("unexpected outcome {other:?}");
                    1
                }
            }
        }
    };
    std::fs::write(
        out.join("report.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .unwrap_or_else(|e| die(e));
    std::process::exit(code);
}
