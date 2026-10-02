//! The knowledge pack of a company's site (ADR-0061 decision 1; increment K1;
//! `docs/design/mvp-pipeline.md` section 3).
//!
//! `GET /api/gateway/knowledge` (session cookie and the company lease, like
//! the other gateway routes) answers the pack of the site at the head of the
//! company's base branch:
//!
//! - the head (`RepoApi::get_branch`) is the strong ETag `"<sha>"`;
//! - a request whose `If-None-Match` names it (or is `*`) gets
//!   `304 Not Modified`, no body;
//! - otherwise `200` with the pack JSON (`Content-Type: application/json`),
//!   the `ETag` and `Cache-Control: no-cache` (a cache must revalidate: the
//!   next commit is another pack). Both answers carry the ETag and
//!   `Cache-Control`.
//!
//! The pack is `knowledge::pack::build` over `RepoApi::snapshot(repo, sha,
//! "content")`, serialised with `Pack::to_json` (deterministic: one commit,
//! one byte string). It is cached in memory per (repository, sha) in
//! [`KnowledgeCache`], with the [`KnowledgeBase`] loaded from it
//! (`knowledge::pack::load`), which the gateway's draft check uses for the
//! closed world (`gateway::check_against_site`). A merge through the gateway
//! moves the base head; it drops the repository's entries
//! ([`KnowledgeCache::invalidate_repo`]).
//!
//! Status codes: 428 without the lease header, 409 with a stale lease; 404
//! when the base branch does not exist; 413 when the site is over the
//! snapshot caps (`GitHubError::TooLarge`; nothing partial is served, a
//! partial tree would be a wrong closed world); 502 when a carried file of
//! the site is broken (an index that is not JSON) or GitHub fails.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use github::{RepoApi, RepoId};
use knowledge::pack;
use knowledge::KnowledgeBase;

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::error::{AppError, AppResult};
use crate::gateway::{gh_error, parse_repo};

/// Packs kept in memory. The real site's pack is about 384 kB of JSON plus
/// its loaded indexes, so the cache holds a few MB at most; with one company
/// per repository an entry is replaced on every merge anyway.
pub const CACHE_ENTRIES: usize = 8;

/// The prefix the pack is built from: every file the indexes read is in it.
pub const SNAPSHOT_PREFIX: &str = "content";

/// One site commit's pack: what the route serves and what the draft check
/// checks against.
#[derive(Debug)]
pub struct SitePack {
    /// `owner/name`, lowercase.
    pub repo: String,
    /// The commit (the head of the base branch when it was built).
    pub commit: String,
    /// `Pack::to_json`.
    pub json: Bytes,
    /// `knowledge::pack::load` of the same pack.
    pub kb: Arc<KnowledgeBase>,
}

/// Packs by (repository, sha), most recently used last, at most
/// [`CACHE_ENTRIES`].
#[derive(Debug, Default)]
pub struct KnowledgeCache {
    entries: Mutex<VecDeque<Arc<SitePack>>>,
}

fn repo_key(repo: &str) -> String {
    repo.to_ascii_lowercase()
}

impl KnowledgeCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<Arc<SitePack>>> {
        self.entries.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The pack of `repo` at `sha`, if cached (it becomes the most recent).
    pub fn get(&self, repo: &str, sha: &str) -> Option<Arc<SitePack>> {
        let key = repo_key(repo);
        let mut e = self.lock();
        let at = e
            .iter()
            .position(|p| p.repo == key && p.commit.eq_ignore_ascii_case(sha))?;
        let hit = e.remove(at)?;
        e.push_back(hit.clone());
        Some(hit)
    }

    pub fn contains(&self, repo: &str, sha: &str) -> bool {
        let key = repo_key(repo);
        self.lock()
            .iter()
            .any(|p| p.repo == key && p.commit.eq_ignore_ascii_case(sha))
    }

    /// Adds a pack, replacing one at the same key and dropping the least
    /// recently used beyond [`CACHE_ENTRIES`].
    pub fn insert(&self, pack: Arc<SitePack>) {
        let mut e = self.lock();
        e.retain(|p| !(p.repo == pack.repo && p.commit.eq_ignore_ascii_case(&pack.commit)));
        e.push_back(pack);
        while e.len() > CACHE_ENTRIES {
            e.pop_front();
        }
    }

    /// Drops every pack of `repo` (its base head moved). Returns how many.
    pub fn invalidate_repo(&self, repo: &str) -> usize {
        let key = repo_key(repo);
        let mut e = self.lock();
        let before = e.len();
        e.retain(|p| p.repo != key);
        before - e.len()
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }
}

/// The head sha of `base`; 404 when the branch does not exist.
pub async fn base_head(api: &dyn RepoApi, repo: &RepoId, base: &str) -> AppResult<String> {
    api.get_branch(repo, base)
        .await
        .map_err(gh_error)?
        .map(|b| b.sha)
        .ok_or_else(|| {
            AppError::NotFound(format!("the base branch {base} of {repo} does not exist"))
        })
}

/// The pack of `repo` at `sha` (a full commit sha): from the cache, or built
/// from a snapshot of `content/` and cached.
pub async fn site_pack(
    st: &AppState,
    api: &dyn RepoApi,
    repo: &RepoId,
    sha: &str,
) -> AppResult<Arc<SitePack>> {
    let name = repo.to_string();
    if let Some(hit) = st.knowledge.get(&name, sha) {
        return Ok(hit);
    }
    let snap = api
        .snapshot(repo, sha, SNAPSHOT_PREFIX)
        .await
        .map_err(gh_error)?;
    let broken = |e: knowledge::KnowledgeError| {
        AppError::BadGateway(format!(
            "the knowledge files of {repo} at {} are broken: {e}",
            snap.sha
        ))
    };
    let built = pack::build(&snap, &snap.sha).map_err(broken)?;
    let json = built.to_json().map_err(broken)?;
    let kb = pack::load(&built).map_err(broken)?;
    tracing::info!(
        repo = %name,
        commit = %snap.sha,
        bytes = json.len(),
        pages = built.pages.len(),
        files = built.files.len(),
        skipped = snap.skipped.len(),
        "knowledge pack built"
    );
    let entry = Arc::new(SitePack {
        repo: repo_key(&name),
        // The cache is keyed by the sha asked for; for a full sha the
        // snapshot names the same commit.
        commit: sha.to_string(),
        json: Bytes::from(json),
        kb: Arc::new(kb),
    });
    st.knowledge.insert(entry.clone());
    Ok(entry)
}

/// Whether an `If-None-Match` header names the ETag of `sha` (weak or
/// strong, quoted or not), or is `*`.
pub fn if_none_match(headers: &HeaderMap, sha: &str) -> bool {
    headers
        .get_all(IF_NONE_MATCH)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .any(|tag| {
            let tag = tag.strip_prefix("W/").unwrap_or(tag);
            tag == "*" || tag.trim_matches('"').eq_ignore_ascii_case(sha)
        })
}

/// `GET /api/gateway/knowledge`: see the module docs.
pub async fn knowledge(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
) -> AppResult<Response> {
    // Only the lease holder reads the pack, as only it writes. A read has no
    // side effect to fence, so the company lock is not held across the
    // snapshot download: a takeover does not wait for it.
    let company = require_lease(&st, &headers, &user).await?.company.clone();
    let repo = parse_repo(&company.site_repo)
        .ok_or_else(|| AppError::Conflict("the company's site repo binding is invalid".into()))?;
    let api = st.github.api_for(&repo).await?;
    let sha = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let mut out = HeaderMap::new();
    out.insert(
        ETAG,
        HeaderValue::from_str(&format!("\"{sha}\"")).map_err(|_| {
            AppError::BadGateway(format!("the head of {repo} is not a sha: {sha:?}"))
        })?,
    );
    out.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    if if_none_match(&headers, &sha) {
        return Ok((StatusCode::NOT_MODIFIED, out).into_response());
    }
    let pack = site_pack(&st, api.as_ref(), &repo, &sha).await?;
    out.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok((StatusCode::OK, out, pack.json.clone()).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(repo: &str, sha: &str) -> Arc<SitePack> {
        Arc::new(SitePack {
            repo: repo_key(repo),
            commit: sha.into(),
            json: Bytes::from_static(b"{}"),
            kb: Arc::new(
                pack::load(&pack::Pack {
                    commit: sha.into(),
                    files: Default::default(),
                    manifest: knowledge::SiteManifest::infer(&knowledge::MemSource::new()).unwrap(),
                    pages: vec![],
                })
                .unwrap(),
            ),
        })
    }

    #[test]
    fn the_cache_is_bounded_keyed_by_repo_and_sha_and_drops_a_repo() {
        let c = KnowledgeCache::default();
        for i in 0..CACHE_ENTRIES + 2 {
            c.insert(entry("o/a", &format!("{i:040x}")));
        }
        assert_eq!(c.len(), CACHE_ENTRIES);
        assert!(!c.contains("o/a", &format!("{:040x}", 0)), "oldest dropped");
        // A hit becomes the most recent and survives the next insert.
        let first = format!("{:040x}", 2);
        assert!(c.get("O/A", &first).is_some(), "repo compared without case");
        c.insert(entry("o/b", "b"));
        assert!(c.contains("o/a", &first));
        assert!(!c.contains("o/a", &format!("{:040x}", 3)));
        // The same key replaces.
        c.insert(entry("o/b", "b"));
        assert_eq!(c.len(), CACHE_ENTRIES);
        assert_eq!(c.invalidate_repo("o/A"), CACHE_ENTRIES - 1);
        assert_eq!(c.len(), 1);
        assert!(c.contains("o/b", "B"));
    }

    #[test]
    fn if_none_match_forms() {
        let sha = "3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b";
        let with = |v: &str| {
            let mut h = HeaderMap::new();
            h.insert(IF_NONE_MATCH, HeaderValue::from_str(v).unwrap());
            if_none_match(&h, sha)
        };
        assert!(with(&format!("\"{sha}\"")));
        assert!(with(&format!("W/\"{sha}\"")));
        assert!(with(&format!("\"other\", \"{sha}\"")));
        assert!(with(sha));
        assert!(with("*"));
        assert!(!with("\"other\""));
        assert!(!with(""));
        assert!(!if_none_match(&HeaderMap::new(), sha));
    }
}
