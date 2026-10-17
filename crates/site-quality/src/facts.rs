//! What a browser observes on a rendered page, and what the release says about the site. The
//! collector (`apps/game/e2e/page-audit.mts` today, the browser executor later) only observes:
//! boxes, pictures, links, requests, headings, labels and the head. Every judgement (the rules,
//! their thresholds) is made here, in one place.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// The facts of one page at one width.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PageFacts {
    /// The page's path in the release (`/en/vernazza/`).
    pub path: String,
    /// The viewport's width, px.
    pub width: u32,
    /// The page's language (`<html lang>`, its first two letters).
    pub lang: String,
    /// The page's template (`page-village`, `single`, `archive-activity`, `front-page`).
    pub page_type: String,
    /// The HTTP status the page was served with.
    pub status: u16,
    /// Why the page did not render, when it did not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub head: Head,
    /// Visible headings in document order.
    pub headings: Vec<Heading>,
    /// The page's authored hero (a hero block of its own content), if it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero: Option<Hero>,
    /// Visible picture boxes.
    pub frames: Vec<Frame>,
    /// Visible pictures (`img`), not hidden from assistive technology.
    pub images: Vec<Image>,
    /// Every `a[href]`.
    pub links: Vec<Link>,
    /// Requests that failed or answered 400 or more, and every request to another host.
    pub requests: Vec<Request>,
    /// Scripts and styles of the document.
    pub assets: Vec<Asset>,
    /// The document's scroll width, px.
    pub scroll_width: u32,
    /// Elements reaching past the viewport's right edge (at most a few, for the evidence).
    pub wide: Vec<String>,
    /// Visible layout blocks narrower than their page container at a desktop width.
    pub blocks: Vec<Block>,
    /// Visible chips, badges, eyebrows, filters and tags.
    pub chips: Vec<Chip>,
    /// Visible short texts (one text node each, whitespace collapsed), distinct.
    pub texts: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Head {
    /// `document.title`.
    pub title: String,
    /// `meta[name=description]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `link[rel=canonical]`'s href.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical: Option<String>,
    /// `link[rel=alternate][hreflang]`.
    pub alternates: Vec<Alternate>,
    /// `meta[name=robots]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub robots: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Alternate {
    pub lang: String,
    pub href: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    /// In the header, the footer or a menu.
    pub chrome: bool,
    /// In the page's authored content.
    pub authored: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Hero {
    /// Its title (its first heading).
    pub title: String,
    /// The page's h1 is inside it.
    pub contains_h1: bool,
    /// Listings, filter bars and card grids above it (their labels).
    pub after: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Frame {
    /// The element (`div.ds-card-img "Vernazza"`).
    pub label: String,
    /// `card`, `image`, `featured`, `tile`, `figure`.
    pub kind: String,
    pub w: u32,
    pub h: u32,
    /// Pictures in it with a source.
    pub images: u32,
    /// Of those, loaded and visible.
    pub loaded: u32,
    /// Other media in it (svg, video, iframe, canvas, table).
    pub media: u32,
    /// It has a background image.
    pub background: bool,
    /// Characters of text in it.
    pub text: u32,
    pub authored: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Image {
    pub src: String,
    /// `None`: no alt attribute.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    /// Loaded (`naturalWidth > 0`).
    pub loaded: bool,
    /// Marked decorative (`role=presentation`/`none`).
    pub decorative: bool,
    pub authored: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Link {
    /// The `href` attribute as written.
    pub href: String,
    /// The element (`a.wp-block-button__link "Where to Stay"`).
    pub label: String,
    pub authored: bool,
    /// For an in-page link (`#id`): whether the page has the target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_found: Option<bool>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Request {
    pub url: String,
    /// The answer's status (0: no answer).
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    /// The resource type (`script`, `image`, `stylesheet`, `image-head` for a remote picture
    /// checked from outside the page).
    pub kind: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Asset {
    /// `script` or `style`.
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// An inline asset's first characters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Block {
    pub label: String,
    pub w: u32,
    /// Its page container's inner width.
    pub container: u32,
    pub h: u32,
    /// Something visible stands beside it in its rows.
    pub beside: bool,
    /// A story's text at its reading measure.
    pub measure: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Chip {
    pub label: String,
    pub text: String,
}

/// What the release says about the site as a whole.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SiteFacts {
    /// The site's public origin (`https://cinqueterre.travel`): absolute links and canonicals
    /// on it are the site's own.
    pub public_origin: String,
    /// Hosts a release must not request (the production site it replaces).
    pub production_hosts: BTreeSet<String>,
    /// The site's languages.
    pub languages: BTreeSet<String>,
    /// The site's name (the titles' suffix).
    pub site_title: String,
    /// Every path the release serves (files and redirects).
    pub paths: BTreeSet<String>,
    /// Whether the release has a sitemap.
    pub sitemap_found: bool,
    /// The paths its sitemap lists.
    pub sitemap: BTreeSet<String>,
    /// The design's own words: English → language → its text there (the theme's label table).
    pub labels: BTreeMap<String, BTreeMap<String, String>>,
}

impl SiteFacts {
    /// Whether the release serves `path` (with or without its trailing slash, or as a
    /// directory's `index.html`).
    pub fn serves(&self, path: &str) -> bool {
        let p = path.split(['?', '#']).next().unwrap_or("");
        if p.is_empty() {
            return true;
        }
        let trimmed = p.trim_end_matches('/');
        [
            p.to_string(),
            format!("{trimmed}/"),
            trimmed.to_string(),
            format!("{trimmed}/index.html"),
        ]
        .iter()
        .any(|v| self.paths.contains(v))
    }

    /// The site's own path of `href` seen from `page`, or `None` for another site, `mailto:`
    /// and the like.
    pub fn own_path(&self, page: &str, href: &str) -> Option<String> {
        let h = href.trim();
        let lower = h.to_ascii_lowercase();
        if lower.starts_with("mailto:")
            || lower.starts_with("tel:")
            || lower.starts_with("data:")
            || lower.starts_with("sms:")
            || lower.starts_with("javascript:")
        {
            return None;
        }
        let origin = self.public_origin.trim_end_matches('/');
        let rest = if let Some(r) = strip_scheme_host(h) {
            let host = host_of(h);
            let own = !origin.is_empty() && host_of(origin) == host;
            let local = host.starts_with("127.0.0.1") || host.starts_with("localhost");
            if !own && !local {
                return None;
            }
            r.to_string()
        } else if h.starts_with('/') {
            h.to_string()
        } else {
            // Relative to the page's directory.
            let base = if page.ends_with('/') {
                page.to_string()
            } else {
                page.rsplit_once('/')
                    .map_or("/".into(), |(d, _)| format!("{d}/"))
            };
            format!("{base}{h}")
        };
        let path = rest.split(['?', '#']).next().unwrap_or("").to_string();
        Some(if path.is_empty() { "/".into() } else { path })
    }
}

/// `https://host/x` → `/x`.
pub(crate) fn strip_scheme_host(u: &str) -> Option<&str> {
    let after = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .or_else(|| u.strip_prefix("//"))?;
    Some(after.find('/').map_or("", |i| &after[i..]))
}

/// `https://Host:8080/x` → `host:8080`.
pub fn host_of(u: &str) -> String {
    let after = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .or_else(|| u.strip_prefix("//"))
        .unwrap_or("");
    after
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}
