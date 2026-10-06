//! The audit of a company's site (ADR-0070 decision 1) and the read of one
//! page through the gateway (decision 7).
//!
//! `GET /api/site/audit` (session cookie and the company lease, like the
//! gateway) answers the audit of the site at the head of the company's base
//! branch: what the sim's `SiteSignals` carries (live pages, languages,
//! broken links, media), the broken links per page, the orphan pages, the
//! stale articles (last date more than [`STALE_DAYS`] ago, by the server's
//! clock) and the linking-policy findings. The audit itself is
//! `knowledge::KnowledgeBase::audit` over the same `content/` snapshot the
//! knowledge pack is built from; it is deterministic for a commit and cached
//! per (repository, commit). The ETag is the commit; `If-None-Match` gets 304.
//!
//! `GET /api/gateway/file?path=content/pages/…` answers one page at the base
//! head with its blob sha (`{path, sha, commit, page}`), for the refresh and
//! fix jobs, which name that sha when they draft the update (ADR-0070
//! decision 6). 404 when the file does not exist; 403 outside
//! `content/pages/`.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use axum::extract::{Query, State};
use axum::http::header::{CACHE_CONTROL, ETAG};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::error::{AppError, AppResult};
use crate::gateway::{company_repo, gh_error};
use crate::site_knowledge::{base_head, if_none_match, site_pack, SNAPSHOT_PREFIX};

/// An article whose last date is older than this many days is stale
/// (`docs/game-design/economy.md`: full freshness for 90 days).
pub const STALE_DAYS: i64 = 90;
/// Entries per list in the report, so a broken site does not answer megabytes.
pub const LIST_CAP: usize = 100;
/// Audits kept in memory.
const CACHE_ENTRIES: usize = 8;

/// The audit report of one commit, before the stale list (which depends on
/// the day it is asked).
#[derive(Debug)]
struct Audited {
    repo: String,
    commit: String,
    report: Value,
    /// (path, title, YYYY-MM-DD) of every dated article.
    articles: Vec<(String, String, String)>,
}

/// Audits by (repository, commit), most recently used last.
#[derive(Debug, Default)]
pub struct AuditCache {
    entries: Mutex<VecDeque<Arc<Audited>>>,
}

impl AuditCache {
    fn get(&self, repo: &str, sha: &str) -> Option<Arc<Audited>> {
        let mut e = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        let at = e.iter().position(|a| a.repo == repo && a.commit == sha)?;
        let hit = e.remove(at)?;
        e.push_back(hit.clone());
        Some(hit)
    }

    fn insert(&self, a: Arc<Audited>) {
        let mut e = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        e.retain(|x| !(x.repo == a.repo && x.commit == a.commit));
        e.push_back(a);
        while e.len() > CACHE_ENTRIES {
            e.pop_front();
        }
    }
}

/// Days since 1970-01-01 of a `YYYY-MM-DD` (proleptic Gregorian); `None` when malformed.
pub fn days_from_civil(date: &str) -> Option<i64> {
    let mut it = date.get(..10)?.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn title_of(kb: &knowledge::KnowledgeBase, path: &str) -> String {
    kb.pages
        .pages
        .iter()
        .find(|p| p.path == path)
        .map(|p| p.title(&kb.manifest.default_language).to_string())
        .unwrap_or_default()
}

async fn audited(st: &AppState, company: &crate::db::Company) -> AppResult<(Arc<Audited>, String)> {
    let repo = company_repo(st, company)?;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let name = repo.to_string().to_ascii_lowercase();
    if let Some(hit) = st.audits.get(&name, &head) {
        return Ok((hit, head));
    }
    let pack = site_pack(st, api.as_ref(), &repo, &head).await?;
    let kb = pack.kb.clone();
    let snap = api
        .snapshot(&repo, &head, SNAPSHOT_PREFIX)
        .await
        .map_err(gh_error)?;
    let audit = kb.audit(&snap).map_err(|e| {
        AppError::BadGateway(format!(
            "the site of {repo} at {head} cannot be audited: {e}"
        ))
    })?;
    let mut per_page: BTreeMap<&str, usize> = BTreeMap::new();
    for (path, _) in &audit.broken {
        *per_page.entry(path.as_str()).or_default() += 1;
    }
    let broken_pages: Vec<Value> = per_page
        .iter()
        .take(LIST_CAP)
        .map(|(path, n)| json!({"path": path, "title": title_of(&kb, path), "broken": n}))
        .collect();
    let orphans: Vec<Value> = audit
        .orphans
        .iter()
        .take(LIST_CAP)
        .map(|path| json!({"path": path, "title": title_of(&kb, path)}))
        .collect();
    let policy: Vec<Value> = audit
        .policy
        .iter()
        .take(LIST_CAP)
        .map(|f| json!({"path": f.path, "pointer": f.pointer, "block": f.block, "links": f.links, "min": f.min, "max": f.max}))
        .collect();
    let live_pages = kb
        .pages
        .pages
        .iter()
        .filter(|p| p.status.as_deref().is_none_or(|s| s == "published"))
        .count();
    let languages = kb.manifest.languages.len();
    let signals = json!({
        "live_pages": live_pages,
        "languages": languages,
        "broken_links": audit.broken.len(),
        "media_count": kb.media.len(),
        // Lighthouse is not measured by this audit (later: the deployed site).
        "lighthouse_performance": 0,
        "lighthouse_accessibility": 0,
        "lighthouse_seo": 0,
    });
    let report = json!({
        "commit": head,
        "pages": kb.pages.pages.len(),
        "links_checked": audit.links_checked,
        "broken_links": audit.broken.len(),
        "broken_pages": broken_pages,
        "orphans": orphans,
        "orphan_count": audit.orphans.len(),
        "policy": policy,
        "policy_count": audit.policy.len(),
        "articles": audit.articles.len(),
        "signals": signals,
    });
    let articles = audit
        .articles
        .iter()
        .filter_map(|a| Some((a.path.clone(), a.title.clone(), a.date.clone()?)))
        .collect();
    let entry = Arc::new(Audited {
        repo: name,
        commit: head.clone(),
        report,
        articles,
    });
    st.audits.insert(entry.clone());
    Ok((entry, head))
}

/// `GET /api/site/audit` (module docs).
pub async fn audit(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
) -> AppResult<Response> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let (a, head) = audited(&st, &fenced.company).await?;
    // The stale list depends on today: the ETag carries the day too.
    let today = st.now_ms().div_euclid(86_400_000);
    let tag = format!("{head}-{today}");
    let etag =
        HeaderValue::from_str(&format!("\"{tag}\"")).map_err(|e| AppError::Internal(e.into()))?;
    let cache = HeaderValue::from_static("no-cache");
    if if_none_match(&headers, &tag) {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [(ETAG, etag), (CACHE_CONTROL, cache)],
        )
            .into_response());
    }
    let mut stale: Vec<(i64, &str, &str, &str)> = a
        .articles
        .iter()
        .filter_map(|(path, title, date)| {
            let age = today - days_from_civil(date)?;
            (age > STALE_DAYS).then_some((age, path.as_str(), title.as_str(), date.as_str()))
        })
        .collect();
    // the oldest first
    stale.sort_by(|x, y| y.0.cmp(&x.0).then(x.1.cmp(y.1)));
    let mut report = a.report.clone();
    report["stale_count"] = json!(stale.len());
    report["stale"] = Value::Array(
        stale
            .into_iter()
            .take(LIST_CAP)
            .map(|(age, path, title, date)| json!({"path": path, "title": title, "date": date, "age_days": age}))
            .collect(),
    );
    report["stale_days"] = json!(STALE_DAYS);
    Ok(([(ETAG, etag), (CACHE_CONTROL, cache)], Json(report)).into_response())
}

#[derive(Deserialize)]
pub struct FileQuery {
    pub path: String,
}

/// `GET /api/gateway/file?path=…` (module docs).
pub async fn file(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Query(q): Query<FileQuery>,
) -> AppResult<Json<Value>> {
    let fenced = require_lease(&st, &headers, &user).await?;
    let company = &fenced.company;
    let path = q.path.trim().trim_start_matches('/');
    if !path.starts_with("content/pages/") || !path.ends_with(".json") || path.contains("..") {
        return Err(AppError::Forbidden(
            "only content/pages/**/*.json can be read through the gateway".into(),
        ));
    }
    let repo = company_repo(&st, company)?;
    let api = st.github.api_for(&repo).await?;
    let head = base_head(api.as_ref(), &repo, &company.site_base_branch).await?;
    let f = api
        .get_file(&repo, &head, path)
        .await
        .map_err(gh_error)?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "{path} does not exist on {}",
                company.site_base_branch
            ))
        })?;
    let text = f
        .text()
        .map_err(|_| AppError::BadGateway(format!("{path} is not UTF-8")))?;
    let page: Value = serde_json::from_str(text)
        .map_err(|e| AppError::BadGateway(format!("{path} is not JSON: {e}")))?;
    Ok(Json(
        json!({"path": path, "sha": f.sha, "commit": head, "page": page}),
    ))
}

#[cfg(test)]
mod tests {
    use super::days_from_civil;

    #[test]
    fn civil_days() {
        assert_eq!(days_from_civil("1970-01-01"), Some(0));
        assert_eq!(days_from_civil("2026-10-06"), Some(20_732));
        assert_eq!(days_from_civil("2024-02-29T10:00:00Z"), Some(19_782));
        assert_eq!(days_from_civil("2026-13-01"), None);
        assert_eq!(days_from_civil("nope"), None);
    }
}
