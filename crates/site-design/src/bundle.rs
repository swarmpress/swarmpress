//! The design bundle: the files of a design as they were sent (ADR-0093).
//!
//! A bundle is a set of files by relative path: pages (HTML), stylesheets,
//! images, fonts and JSON. Its **hash** depends only on the files (paths and
//! contents), not on where it came from or when, so the same design sent
//! twice is the same version. Scripts are never part of a bundle: a design is
//! data, and nothing in it runs (Claude Design's page data is read from its
//! inline data script by [`crate::dc`], without executing it).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The manifest's format id.
pub const BUNDLE_FORMAT: &str = "swarmpress.design-bundle.v1";
/// The most bytes one bundle holds, all files together.
pub const MAX_BUNDLE_BYTES: usize = 20 * 1024 * 1024;
/// The most files one bundle holds.
pub const MAX_FILES: usize = 512;
/// The longest file path.
pub const MAX_PATH: usize = 200;
/// The largest page or stylesheet that is interpreted (larger ones are kept, not read).
pub const MAX_PARSE_BYTES: usize = 2 * 1024 * 1024;
/// The most pages one interpretation reads.
pub const MAX_PAGES: usize = 48;

/// Where a design came from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum DesignSource {
    /// A file a player uploaded (Mode A: an HTML page, a ZIP, a Claude Design export).
    Upload,
    /// Sent by a connected client (Claude's "Send to", Mode B); `client` names it.
    Connector { client: String },
    /// A Claude Design project, by its URL.
    ClaudeDesign { url: String },
}

/// One file of a bundle.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileEntry {
    pub path: String,
    /// Lower-case hex SHA-256 of the bytes.
    pub sha256: String,
    pub size: u64,
    pub content_type: String,
}

/// What a server keeps about a bundle version: everything but the bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BundleManifest {
    pub format: String,
    /// [`bundle_hash`] of `files`.
    pub hash: String,
    pub source: DesignSource,
    /// Unix ms, passed in by the caller (the crate has no clock).
    pub created_at: i64,
    /// In path order.
    pub files: Vec<FileEntry>,
}

/// A problem with a bundle's files.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundleIssue {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub message: String,
}

impl BundleIssue {
    fn at(path: &str, message: impl Into<String>) -> Self {
        BundleIssue {
            path: Some(path.into()),
            message: message.into(),
        }
    }
    fn whole(message: impl Into<String>) -> Self {
        BundleIssue {
            path: None,
            message: message.into(),
        }
    }
}

/// A design's files, checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesignBundle {
    files: BTreeMap<String, Vec<u8>>,
    pub source: DesignSource,
    pub created_at: i64,
    hash: String,
}

/// The media type of an allowed file, by extension; `None` for anything else
/// (scripts above all).
pub fn content_type(path: &str) -> Option<&'static str> {
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "json" => "application/json",
        _ => return None,
    })
}

/// The extension a media type is stored under, for the types a bundle allows.
pub fn extension_of(mime: &str) -> Option<&'static str> {
    Some(
        match mime.split(';').next()?.trim().to_ascii_lowercase().as_str() {
            "text/html" => "html",
            "text/css" => "css",
            "image/svg+xml" => "svg",
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/webp" => "webp",
            "font/woff2" | "application/font-woff2" => "woff2",
            "application/json" => "json",
            _ => return None,
        },
    )
}

/// A relative path of plain segments: no `..`, no leading `/`, no backslashes.
pub fn check_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > MAX_PATH {
        return Err(format!("a path is 1 to {MAX_PATH} bytes"));
    }
    if path.starts_with('/') || path.contains('\\') || path.contains("//") {
        return Err("a path is relative, with forward slashes".into());
    }
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." || seg.starts_with('.') {
            return Err("a path has no empty, dot or hidden segments".into());
        }
        if !seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.~ +()@,".contains(c))
        {
            return Err("a path uses letters, digits and - _ . ~ space + ( ) @ , only".into());
        }
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from(HEX[usize::from(b >> 4)]));
        s.push(char::from(HEX[usize::from(b & 15)]));
    }
    s
}

/// `sha256("swarmpress:design-bundle:v1\n" ‖ for each file in path order:
/// path "\n" sha256 "\n")`: the bundle's identity, computable from a
/// manifest without the bytes.
pub fn bundle_hash(files: &[FileEntry]) -> String {
    let mut sorted: Vec<&FileEntry> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    let mut h = Sha256::new();
    h.update(b"swarmpress:design-bundle:v1\n");
    for f in sorted {
        h.update(f.path.as_bytes());
        h.update(b"\n");
        h.update(f.sha256.as_bytes());
        h.update(b"\n");
    }
    hex(&h.finalize())
}

impl DesignBundle {
    /// Checks and keeps the files: allowed types, plain paths, the size
    /// limits, at least one page.
    pub fn new(
        files: BTreeMap<String, Vec<u8>>,
        source: DesignSource,
        created_at: i64,
    ) -> Result<DesignBundle, Vec<BundleIssue>> {
        let mut issues = Vec::new();
        if files.is_empty() {
            issues.push(BundleIssue::whole("a bundle has at least one file"));
        }
        if files.len() > MAX_FILES {
            issues.push(BundleIssue::whole(format!(
                "a bundle has at most {MAX_FILES} files"
            )));
        }
        let total: usize = files.values().map(Vec::len).sum();
        if total > MAX_BUNDLE_BYTES {
            issues.push(BundleIssue::whole(format!(
                "a bundle is at most {MAX_BUNDLE_BYTES} bytes ({total} sent)"
            )));
        }
        for path in files.keys() {
            if let Err(e) = check_path(path) {
                issues.push(BundleIssue::at(path, e));
            } else if content_type(path).is_none() {
                issues.push(BundleIssue::at(
                    path,
                    "not an allowed file type (html, css, svg, png, jpg, webp, woff2, json; never scripts)",
                ));
            }
        }
        if !files.keys().any(|p| is_page(p)) {
            issues.push(BundleIssue::whole("a bundle has at least one HTML page"));
        }
        if !issues.is_empty() {
            return Err(issues);
        }
        let mut b = DesignBundle {
            files,
            source,
            created_at,
            hash: String::new(),
        };
        b.hash = bundle_hash(&b.entries());
        Ok(b)
    }

    /// Files as uploaded: a single Claude Design standalone export (one HTML
    /// page carrying `__bundler/manifest`) is unpacked into its pages and
    /// assets ([`crate::export`]); anything else is taken as it is.
    pub fn from_upload(
        files: BTreeMap<String, Vec<u8>>,
        source: DesignSource,
        created_at: i64,
    ) -> Result<DesignBundle, Vec<BundleIssue>> {
        if files.len() == 1 {
            let (path, bytes) = files.iter().next().expect("one file");
            if is_page(path) {
                if let Ok(text) = std::str::from_utf8(bytes) {
                    if crate::export::is_export(text) {
                        let unpacked = crate::export::unpack(text)
                            .map_err(|e| vec![BundleIssue::at(path, e)])?;
                        return DesignBundle::new(unpacked, source, created_at);
                    }
                }
            }
        }
        DesignBundle::new(files, source, created_at)
    }

    pub fn hash(&self) -> &str {
        &self.hash
    }

    pub fn files(&self) -> &BTreeMap<String, Vec<u8>> {
        &self.files
    }

    pub fn bytes(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }

    /// A file as UTF-8 text, when it is.
    pub fn text(&self, path: &str) -> Option<&str> {
        std::str::from_utf8(self.files.get(path)?).ok()
    }

    pub fn total_bytes(&self) -> usize {
        self.files.values().map(Vec::len).sum()
    }

    fn entries(&self) -> Vec<FileEntry> {
        self.files
            .iter()
            .map(|(path, bytes)| FileEntry {
                path: path.clone(),
                sha256: sha256_hex(bytes),
                size: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
                content_type: content_type(path)
                    .unwrap_or("application/octet-stream")
                    .into(),
            })
            .collect()
    }

    pub fn manifest(&self) -> BundleManifest {
        BundleManifest {
            format: BUNDLE_FORMAT.into(),
            hash: self.hash.clone(),
            source: self.source.clone(),
            created_at: self.created_at,
            files: self.entries(),
        }
    }
}

pub fn is_page(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    p.ends_with(".html") || p.ends_with(".htm")
}

pub fn is_css(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".css")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(list: &[(&str, &str)]) -> BTreeMap<String, Vec<u8>> {
        list.iter()
            .map(|(p, t)| ((*p).to_string(), t.as_bytes().to_vec()))
            .collect()
    }

    #[test]
    fn the_hash_is_the_files_only() {
        let a = DesignBundle::new(
            files(&[("index.html", "<h1>x</h1>"), ("a.css", "")]),
            DesignSource::Upload,
            1,
        )
        .unwrap();
        let b = DesignBundle::new(
            files(&[("a.css", ""), ("index.html", "<h1>x</h1>")]),
            DesignSource::ClaudeDesign {
                url: "https://claude.ai/design/p/1".into(),
            },
            2,
        )
        .unwrap();
        assert_eq!(a.hash(), b.hash());
        assert_eq!(a.hash().len(), 64);
        assert_eq!(bundle_hash(&a.manifest().files), a.hash());
        let c = DesignBundle::new(
            files(&[("index.html", "<h1>y</h1>")]),
            DesignSource::Upload,
            1,
        )
        .unwrap();
        assert_ne!(a.hash(), c.hash());
    }

    #[test]
    fn refuses_scripts_bad_paths_and_pageless_bundles() {
        let e = DesignBundle::new(
            files(&[
                ("app.js", "x"),
                ("../up.html", ""),
                ("/abs.css", ""),
                (".hidden/a.png", ""),
            ]),
            DesignSource::Upload,
            0,
        )
        .unwrap_err();
        let msgs: Vec<String> = e
            .iter()
            .map(|i| format!("{}: {}", i.path.clone().unwrap_or_default(), i.message))
            .collect();
        assert_eq!(msgs.len(), 4, "{msgs:?}");
        assert!(msgs.iter().any(|m| m.starts_with("app.js: not an allowed")));
        let e = DesignBundle::new(files(&[("a.css", "")]), DesignSource::Upload, 0).unwrap_err();
        assert!(e[0].message.contains("at least one HTML page"));
    }
}
