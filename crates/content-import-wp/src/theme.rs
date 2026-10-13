//! The theme as data, as REST calls (ADR-0093): what the sandbox's REST API writes, in order, to put
//! a site's [`ThemeData`] onto the neutral base theme [`BASE_THEME`] on a branch. Sans-IO, like
//! `site-export`: [`calls`] is pure, and the `swarmpress-wp-migrate` CLI runs the calls.
//!
//! The order is fixed: the theme switch, then fonts (a family, then each face with its file), global
//! styles (they name the fonts' files), template parts, templates (they name the parts and the
//! patterns), patterns, navigation. Every write is idempotent: an object that exists (by slug; a
//! face by weight and style) is updated or kept, never written twice.

use serde_json::{json, Map, Value};

use crate::theme_data::{NavigationItem, ThemeData, ThemeFontFace, ThemeFontFamily};

/// The sandbox's neutral block theme a design is written onto.
pub const BASE_THEME: &str = "canvas";

/// Where WordPress's font library keeps uploaded font files (the sandbox keeps them in the governed
/// layer as `fonts/{file}`).
pub const FONTS_PATH: &str = "/wp-content/uploads/fonts/";

/// One write, as the CLI performs it.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    /// `POST /swarmpress/v1/theme {stylesheet}`.
    SwitchTheme { stylesheet: String },
    /// A font family by slug: `GET /wp/v2/font-families?slug={slug}`, then
    /// `POST /wp/v2/font-families/{id}` or `POST /wp/v2/font-families`, with
    /// `{font_family_settings: <settings as a JSON string>}`.
    FontFamily { slug: String, settings: Value },
    /// A face of the family `family` (slug) with its file: kept when
    /// `GET /wp/v2/font-families/{id}/font-faces` has one of the same weight and style, else
    /// `POST /wp/v2/font-families/{id}/font-faces` as multipart (`font_face_settings` with
    /// `src: "file-0"`, and the file as `file-0`). Global styles name it at [`Call::FontFace::src`];
    /// where WordPress stores it elsewhere (a name taken), the CLI replaces that path in the global
    /// styles' body.
    FontFace {
        family: String,
        settings: Value,
        /// The font file (an asset path).
        file: String,
        /// Its name in the upload.
        file_name: String,
        mime: String,
        /// The path WordPress serves it at when the name is free.
        src: String,
    },
    /// The active theme's user global styles: `GET /wp/v2/themes?status=active` names them
    /// (`wp:user-global-styles`, created on the branch when missing), then
    /// `POST /wp/v2/global-styles/{id}` with `{settings, styles}`.
    GlobalStyles { body: Value },
    /// An object by slug, updated when it exists, created otherwise (see [`Kind`]).
    Upsert {
        kind: Kind,
        slug: String,
        body: Value,
        /// Pattern categories by name (`wp_pattern_category` terms, created when missing).
        categories: Vec<String>,
    },
}

/// The objects written by slug.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    TemplatePart,
    Template,
    Pattern,
    Navigation,
}

impl Kind {
    /// The collection a new object is created in.
    pub fn collection(self) -> &'static str {
        match self {
            Kind::TemplatePart => "/wp/v2/template-parts",
            Kind::Template => "/wp/v2/templates",
            Kind::Pattern => "/wp/v2/blocks",
            Kind::Navigation => "/wp/v2/navigation",
        }
    }

    /// Where an object with `slug` is looked up: a template or part by its id (`{theme}//{slug}`,
    /// a theme file's counts: writing it makes the site's own copy); a pattern or menu by
    /// `?slug=` in its collection.
    pub fn lookup(self, theme: &str, slug: &str) -> String {
        match self {
            Kind::TemplatePart | Kind::Template => format!("{}/{theme}//{slug}", self.collection()),
            Kind::Pattern | Kind::Navigation => format!(
                "{}?slug={slug}&status=publish,draft&_fields=id,slug",
                self.collection()
            ),
        }
    }

    /// The route an existing object is updated at: templates and parts by `{theme}//{slug}`, the
    /// rest by the id the lookup found.
    pub fn item(self, theme: &str, slug: &str, id: u64) -> String {
        match self {
            Kind::TemplatePart | Kind::Template => format!("{}/{theme}//{slug}", self.collection()),
            Kind::Pattern | Kind::Navigation => format!("{}/{id}", self.collection()),
        }
    }
}

/// The calls that put `data` onto `theme` (normally [`BASE_THEME`]), in their fixed order.
pub fn calls(data: &ThemeData, theme: &str) -> Vec<Call> {
    let mut out = vec![Call::SwitchTheme {
        stylesheet: theme.to_string(),
    }];
    for f in &data.fonts {
        out.push(Call::FontFamily {
            slug: f.slug.clone(),
            settings: json!({"name": f.name, "slug": f.slug, "fontFamily": f.family}),
        });
        for face in &f.faces {
            let file_name = face_file_name(f, face);
            let mut settings = face_settings(f, face);
            settings["src"] = json!("file-0");
            out.push(Call::FontFace {
                family: f.slug.clone(),
                settings,
                file: face.file.path.clone(),
                mime: if face.file.content_type.is_empty() {
                    font_mime(&file_name).to_string()
                } else {
                    face.file.content_type.clone()
                },
                src: format!("{FONTS_PATH}{file_name}"),
                file_name,
            });
        }
    }
    out.push(Call::GlobalStyles {
        body: global_styles_body(data),
    });
    for p in &data.template_parts {
        let area = p.area.as_str();
        out.push(Call::Upsert {
            kind: Kind::TemplatePart,
            slug: p.slug.clone(),
            body: json!({"slug": p.slug, "title": title_or_slug("", &p.slug), "area": area, "status": "publish", "content": p.content}),
            categories: vec![],
        });
    }
    for t in &data.templates {
        out.push(Call::Upsert {
            kind: Kind::Template,
            slug: t.slug.clone(),
            body: json!({"slug": t.slug, "title": title_or_slug(&t.title, &t.slug), "status": "publish", "content": t.content}),
            categories: vec![],
        });
    }
    for p in &data.patterns {
        let slug = pattern_post_name(&p.slug);
        out.push(Call::Upsert {
            kind: Kind::Pattern,
            slug: slug.clone(),
            body: json!({
                "slug": slug,
                "title": title_or_slug(&p.title, &p.slug),
                "status": "publish",
                "content": p.content,
                // A pattern, not a synced block: inserted as a copy, rendered by slug from templates.
                "meta": {"wp_pattern_sync_status": "unsynced"},
            }),
            categories: p.categories.clone(),
        });
    }
    for m in &data.navigation {
        let slug = m.post_name();
        let content: String = m.items.iter().map(nav_markup).collect();
        out.push(Call::Upsert {
            kind: Kind::Navigation,
            body: json!({"slug": slug, "title": format!("{} ({})", m.name, m.lang), "status": "publish", "content": content}),
            slug,
            categories: vec![],
        });
    }
    out
}

/// The user's global styles: the data's settings and styles, its CSS as `styles.css`, and every
/// font family with its faces' files (`settings.typography.fontFamilies`: WordPress prints the
/// `@font-face` rules of the families listed there). A family the settings list already (by slug)
/// gets the faces it lacks; another is added to the `custom` origin.
pub fn global_styles_body(data: &ThemeData) -> Value {
    let gs = &data.global_styles;
    let mut settings = object(&gs.settings);
    let mut styles = object(&gs.styles);
    if !gs.css.is_empty() {
        styles.insert("css".into(), Value::String(gs.css.clone()));
    }
    if !data.fonts.is_empty() {
        let typography = settings.entry("typography").or_insert_with(|| json!({}));
        if !typography.is_object() {
            *typography = json!({});
        }
        if let Some(t) = typography.as_object_mut() {
            let families = t.entry("fontFamilies").or_insert_with(|| json!([]));
            for f in &data.fonts {
                add_family(families, f);
            }
        }
    }
    json!({"settings": settings, "styles": styles})
}

fn add_family(families: &mut Value, f: &ThemeFontFamily) {
    let faces: Vec<Value> = f
        .faces
        .iter()
        .map(|face| {
            let mut v = face_settings(f, face);
            v["src"] = json!([format!("{FONTS_PATH}{}", face_file_name(f, face))]);
            v
        })
        .collect();
    // A plain list, or lists by origin (`{"theme": […], "custom": […]}`).
    let lists: Vec<&mut Vec<Value>> = match families {
        Value::Array(a) => vec![a],
        Value::Object(o) => o.values_mut().filter_map(Value::as_array_mut).collect(),
        _ => vec![],
    };
    for list in lists {
        if let Some(entry) = list
            .iter_mut()
            .find(|e| e.get("slug").and_then(Value::as_str) == Some(f.slug.as_str()))
        {
            let have = entry
                .as_object_mut()
                .map(|o| o.entry("fontFace").or_insert_with(|| json!([])));
            if let Some(Value::Array(have)) = have {
                for face in &faces {
                    let same = |h: &Value| {
                        h.get("fontWeight") == face.get("fontWeight")
                            && h.get("fontStyle") == face.get("fontStyle")
                    };
                    if !have.iter().any(same) {
                        have.push(face.clone());
                    }
                }
            }
            return;
        }
    }
    let entry = json!({"name": f.name, "slug": f.slug, "fontFamily": f.family, "fontFace": faces});
    match families {
        Value::Array(a) => a.push(entry),
        Value::Object(o) => match o.entry("custom").or_insert_with(|| json!([])) {
            Value::Array(a) => a.push(entry),
            other => *other = json!([entry]),
        },
        other => *other = json!([entry]),
    }
}

fn object(v: &Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap_or_default()
}

/// A face as WordPress's font library and `theme.json` name it (without its `src`).
fn face_settings(f: &ThemeFontFamily, face: &ThemeFontFace) -> Value {
    let mut v = json!({"fontFamily": f.name, "fontWeight": face.weight, "fontStyle": face.style});
    if let Some(r) = &face.unicode_range {
        v["unicodeRange"] = json!(r);
    }
    v
}

/// A pattern's `wp_block` post name: its slug's name (`swarmpress/editorial-hero` →
/// `editorial-hero`), which the sandbox's routes plugin finds for `wp:pattern {"slug": …}`.
pub fn pattern_post_name(slug: &str) -> String {
    slug.rsplit('/').next().unwrap_or(slug).to_string()
}

/// A menu item as navigation block markup (a link, or a submenu with its children).
pub fn nav_markup(item: &NavigationItem) -> String {
    let attrs =
        json!({"label": item.label, "url": item.url, "kind": "custom", "isTopLevelLink": true});
    if item.children.is_empty() {
        return format!("<!-- wp:navigation-link {attrs} /-->");
    }
    let inner: String = item.children.iter().map(nav_markup).collect();
    let attrs = json!({"label": item.label, "url": item.url, "kind": "custom"});
    format!("<!-- wp:navigation-submenu {attrs} -->{inner}<!-- /wp:navigation-submenu -->")
}

fn title_or_slug(title: &str, slug: &str) -> String {
    if title.is_empty() {
        slug.to_string()
    } else {
        title.to_string()
    }
}

/// The name a face's file is uploaded under: `{family}-{weight}-{style}.{ext}` (one name per face,
/// so a second import finds the face and WordPress never renames the file).
pub fn face_file_name(f: &ThemeFontFamily, face: &ThemeFontFace) -> String {
    let ext = face
        .file
        .path
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_else(|| "woff2".into());
    let weight: String = face
        .weight
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{}-{weight}-{}.{ext}", f.slug, face.style)
}

/// A font file's media type, by its extension (the font library's allowed types).
pub fn font_mime(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => "application/octet-stream",
    }
}
