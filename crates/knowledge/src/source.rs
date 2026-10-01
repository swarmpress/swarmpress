//! Read-only access to a site repo checkout.
//!
//! [`SiteSource`] abstracts "a tree of files at a commit" so the indexes build
//! the same way from a local checkout ([`DirSource`]), an in-memory tree
//! ([`MemSource`], tests and fakes) or, later, the GitHub contents API.
//! Paths are always relative to the repo root and `/`-separated.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum KnowledgeError {
    #[error("{path}: {message}")]
    Io { path: String, message: String },
    #[error("{path}: invalid JSON: {message}")]
    Json { path: String, message: String },
    #[error("{path}: unexpected shape: {message}")]
    Shape { path: String, message: String },
}

pub trait SiteSource {
    /// File contents, or `None` if the file does not exist.
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, KnowledgeError>;

    /// Every file below `dir` (recursive), as repo-relative paths, sorted.
    /// A missing directory yields an empty list.
    fn list(&self, dir: &str) -> Result<Vec<String>, KnowledgeError>;

    /// Human-readable origin (for summaries and error messages).
    fn label(&self) -> String;

    fn exists(&self, path: &str) -> Result<bool, KnowledgeError> {
        Ok(self.read(path)?.is_some())
    }

    /// Parsed JSON, or `None` if the file does not exist.
    fn read_json(&self, path: &str) -> Result<Option<Value>, KnowledgeError> {
        let Some(bytes) = self.read(path)? else {
            return Ok(None);
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| KnowledgeError::Json {
                path: path.to_string(),
                message: e.to_string(),
            })
    }

    /// `*.json` files below `dir`, sorted.
    fn list_json(&self, dir: &str) -> Result<Vec<String>, KnowledgeError> {
        Ok(self
            .list(dir)?
            .into_iter()
            .filter(|p| p.ends_with(".json"))
            .collect())
    }
}

/// A site repo checked out on disk.
#[derive(Debug, Clone)]
pub struct DirSource {
    root: PathBuf,
}

impl DirSource {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn walk(&self, dir: &Path, out: &mut Vec<String>) -> Result<(), KnowledgeError> {
        let entries = fs::read_dir(dir).map_err(|e| KnowledgeError::Io {
            path: dir.display().to_string(),
            message: e.to_string(),
        })?;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                self.walk(&path, out)?;
            } else if ft.is_file() {
                if let Ok(rel) = path.strip_prefix(&self.root) {
                    let rel: Vec<_> = rel
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                        .collect();
                    out.push(rel.join("/"));
                }
            }
        }
        Ok(())
    }
}

impl SiteSource for DirSource {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, KnowledgeError> {
        let full = self.root.join(path);
        match fs::read(&full) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(KnowledgeError::Io {
                path: path.to_string(),
                message: e.to_string(),
            }),
        }
    }

    fn list(&self, dir: &str) -> Result<Vec<String>, KnowledgeError> {
        let full = self.root.join(dir.trim_end_matches('/'));
        if !full.is_dir() {
            return Ok(vec![]);
        }
        let mut out = vec![];
        self.walk(&full, &mut out)?;
        out.sort();
        Ok(out)
    }

    fn label(&self) -> String {
        self.root.display().to_string()
    }
}

/// An in-memory file tree (tests, fakes, or a snapshot fetched from GitHub).
#[derive(Debug, Clone, Default)]
pub struct MemSource {
    files: BTreeMap<String, Vec<u8>>,
}

impl MemSource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, path: impl Into<String>, contents: impl Into<Vec<u8>>) -> &mut Self {
        self.files.insert(path.into(), contents.into());
        self
    }

    pub fn insert_json(&mut self, path: impl Into<String>, value: &Value) -> &mut Self {
        self.insert(path, value.to_string())
    }
}

impl SiteSource for MemSource {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, KnowledgeError> {
        Ok(self.files.get(path).cloned())
    }

    fn list(&self, dir: &str) -> Result<Vec<String>, KnowledgeError> {
        let prefix = format!("{}/", dir.trim_end_matches('/'));
        Ok(self
            .files
            .keys()
            .filter(|k| dir.is_empty() || k.starts_with(&prefix))
            .cloned()
            .collect())
    }

    fn label(&self) -> String {
        format!("<memory: {} files>", self.files.len())
    }
}

/// File stem of a repo path (`content/x/riomaggiore.json` → `riomaggiore`).
pub fn file_stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".json").unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mem_source_lists_and_reads() {
        let mut s = MemSource::new();
        s.insert_json("content/pages/a.json", &json!({"id": "a"}))
            .insert_json("content/pages/blog/b.json", &json!({"id": "b"}))
            .insert("content/pagesx/c.json", "{}")
            .insert("README.md", "hi");
        assert_eq!(
            s.list_json("content/pages").unwrap(),
            vec!["content/pages/a.json", "content/pages/blog/b.json"]
        );
        assert_eq!(
            s.read_json("content/pages/a.json").unwrap().unwrap()["id"],
            "a"
        );
        assert!(s.read_json("missing.json").unwrap().is_none());
        s.insert("bad.json", "{");
        assert!(matches!(
            s.read_json("bad.json"),
            Err(KnowledgeError::Json { .. })
        ));
    }

    #[test]
    fn dir_source_walks_recursively() {
        let root = std::env::temp_dir().join(format!("knowledge-dirsource-{}", std::process::id()));
        fs::create_dir_all(root.join("content/pages/blog")).unwrap();
        fs::write(root.join("content/pages/a.json"), "{}").unwrap();
        fs::write(root.join("content/pages/blog/b.json"), "{}").unwrap();
        let s = DirSource::new(&root);
        let listed = s.list("content/pages").unwrap();
        assert!(s.list("nope").unwrap().is_empty());
        assert!(s.read("nope.json").unwrap().is_none());
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(
            listed,
            vec!["content/pages/a.json", "content/pages/blog/b.json"]
        );
    }

    #[test]
    fn stems() {
        assert_eq!(
            file_stem("content/collections/hikes/manarola.json"),
            "manarola"
        );
        assert_eq!(file_stem("x"), "x");
    }
}
