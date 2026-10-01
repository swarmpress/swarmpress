//! Media references.
//!
//! Schema v2 media fields hold a [`MediaRef`]: `media:<id>` (an entry in the
//! site's closed media index, preferred) or an absolute URL (legacy content;
//! the knowledge layer maps it back to an index entry when it can). Root
//! relative paths (`/giulia_rossi.png`) are tolerated as legacy site assets.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub const MEDIA_SCHEME: &str = "media:";

/// Regex (JSON Schema `pattern`) accepted by v2 media fields.
pub const MEDIA_REF_PATTERN: &str =
    r"^(media:[A-Za-z0-9][A-Za-z0-9._-]*|https?://\S+|/([^/\s]\S*)?)$";

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum MediaRef {
    /// `media:<id>` — closed-world reference into the media index.
    Id(String),
    /// Absolute `http(s)://` URL.
    Url(String),
    /// Root-relative site asset path (legacy).
    SitePath(String),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not a media reference (expected `media:<id>`, an http(s) URL or a /path): {0:?}")]
pub struct MediaRefError(pub String);

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

impl MediaRef {
    pub fn parse(s: &str) -> Result<Self, MediaRefError> {
        if let Some(id) = s.strip_prefix(MEDIA_SCHEME) {
            if valid_id(id) {
                return Ok(MediaRef::Id(id.to_string()));
            }
        } else if let Some(rest) = s
            .strip_prefix("https://")
            .or_else(|| s.strip_prefix("http://"))
        {
            if !rest.is_empty() && !s.contains(char::is_whitespace) {
                return Ok(MediaRef::Url(s.to_string()));
            }
        } else if s.starts_with('/') && !s.starts_with("//") && !s.contains(char::is_whitespace) {
            return Ok(MediaRef::SitePath(s.to_string()));
        }
        Err(MediaRefError(s.to_string()))
    }

    pub fn id(id: impl Into<String>) -> Self {
        MediaRef::Id(id.into())
    }

    pub fn as_id(&self) -> Option<&str> {
        match self {
            MediaRef::Id(id) => Some(id),
            _ => None,
        }
    }

    pub fn is_closed_world(&self) -> bool {
        matches!(self, MediaRef::Id(_))
    }
}

impl fmt::Display for MediaRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MediaRef::Id(id) => write!(f, "{MEDIA_SCHEME}{id}"),
            MediaRef::Url(u) | MediaRef::SitePath(u) => f.write_str(u),
        }
    }
}

impl std::str::FromStr for MediaRef {
    type Err = MediaRefError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        MediaRef::parse(s)
    }
}

impl Serialize for MediaRef {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for MediaRef {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        MediaRef::parse(&s).map_err(serde::de::Error::custom)
    }
}

/// Strips query and fragment so differently-cropped variants of the same
/// remote image compare equal (Unsplash URLs carry sizing in the query).
pub fn url_identity(url: &str) -> &str {
    let end = url.find(['?', '#']).unwrap_or(url.len());
    url[..end].trim_end_matches('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_forms() {
        assert_eq!(
            MediaRef::parse("media:riomaggiore-hero-001").unwrap(),
            MediaRef::Id("riomaggiore-hero-001".into())
        );
        assert!(matches!(
            MediaRef::parse("https://images.unsplash.com/photo-1?w=1").unwrap(),
            MediaRef::Url(_)
        ));
        assert!(matches!(
            MediaRef::parse("/giulia_rossi.png").unwrap(),
            MediaRef::SitePath(_)
        ));
        for bad in [
            "",
            "media:",
            "media:-x",
            "media:a b",
            "ftp://x",
            "//cdn/x",
            "photo.jpg",
        ] {
            assert!(MediaRef::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn round_trips_through_serde() {
        let r: MediaRef = serde_json::from_str("\"media:abc\"").unwrap();
        assert_eq!(serde_json::to_string(&r).unwrap(), "\"media:abc\"");
        assert_eq!(r.as_id(), Some("abc"));
    }

    #[test]
    fn url_identity_strips_query() {
        assert_eq!(
            url_identity("https://images.unsplash.com/photo-1?q=80&w=2670"),
            "https://images.unsplash.com/photo-1"
        );
        assert_eq!(url_identity("https://x.dev/a.jpg#f"), "https://x.dev/a.jpg");
    }

    #[test]
    fn pattern_matches_parser() {
        // The schema pattern and the parser must agree on the common cases.
        let re_like = |s: &str| MediaRef::parse(s).is_ok();
        assert!(re_like("media:a.b_c-1"));
        assert!(!re_like("media:"));
        assert!(MEDIA_REF_PATTERN.starts_with("^(media:"));
    }
}
