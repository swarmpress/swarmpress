//! First-party analytics tracker (ADR-0032): the public collector, the daily
//! salt, the hourly rollup, retention and the nightly sim signals.
//!
//! - `GET /t/s.js` serves the beacon script (`assets/tracker.min.js`, a
//!   committed copy of `packages/tracker/dist/tracker.min.js`).
//! - `POST /t/e` collects one event: text/plain JSON ≤ 2 KB, no auth, CORS for
//!   registered project domains. Checks run cheapest first: rate limit (429),
//!   size (413), JSON shape (400), bot / DNT / GPC (204, dropped silently),
//!   project key (404), Origin/Referer host (403).
//! - Visitors: `xxh3(salt_day ‖ ip ‖ ua ‖ project)`. The salt is random per
//!   UTC day, held in memory and in `tracker_salts` until it expires, then
//!   deleted. IPs and user agents are never stored.
//! - Sessions: per visitor, a new session starts after 30 minutes without an
//!   event; `session_hash = xxh3(salt_day ‖ visitor_hash ‖ session_start)`.
//! - The rollup is computed in Rust from the raw rows (deterministic, plain
//!   SQL only; ADR-0041) and written by `crate::db::tracker`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::Hash;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use xxhash_rust::xxh3::xxh3_64;

use crate::app::{require_company, AppState};
use crate::auth::CurrentUser;
pub use crate::db::tracker::Project;
use crate::db::tracker::{self as store, DailyRow, NewProjectRow, TotalsRow};
use crate::db::Db;
use crate::error::{AppError, AppResult};

/// The built beacon script. Regenerate with `pnpm --filter tracker sync`;
/// `pnpm --filter tracker check-drift` (and the `assets_match_built_tracker`
/// test) fail when it differs from `packages/tracker/dist/tracker.min.js`.
pub const TRACKER_JS: &str = include_str!("../assets/tracker.min.js");

pub const SESSION_GAP_MS: i64 = 30 * 60 * 1000;
/// Visible time per engagement event is clamped to this (6 h).
pub const MAX_ENGAGED_MS: i64 = 6 * 3600 * 1000;

#[derive(Clone, Debug)]
pub struct TrackerConfig {
    /// Public origin sites beacon to (`SIMPRESS_TRACKER_ORIGIN`), used in snippets.
    pub origin: String,
    /// Raw events older than this are deleted (`SIMPRESS_TRACKER_RAW_RETENTION_DAYS`).
    pub raw_retention_days: u32,
    /// Accept events from localhost/127.0.0.1 origins (development).
    pub allow_localhost: bool,
    /// Take the client IP from the first `X-Forwarded-For` hop (behind a proxy).
    pub trust_forwarded_for: bool,
    /// Token bucket per IP: sustained events per minute and burst size.
    pub rate_per_min: u32,
    pub burst: u32,
    pub max_event_bytes: usize,
    /// Concurrent event inserts; beyond this events are shed (dropped).
    pub max_inflight: usize,
    /// How often the rollup/retention/signal job runs.
    pub rollup_interval: Duration,
}

impl Default for TrackerConfig {
    fn default() -> Self {
        Self {
            origin: "http://localhost:8080".into(),
            raw_retention_days: 7,
            allow_localhost: true,
            trust_forwarded_for: false,
            rate_per_min: 120,
            burst: 60,
            max_event_bytes: 2048,
            max_inflight: 64,
            rollup_interval: Duration::from_secs(3600),
        }
    }
}

// ------------------------------------------------------------ salt

/// The daily salt, cached in memory and shared across processes via
/// `tracker_salts`.
#[derive(Default)]
pub struct SaltKeeper {
    current: tokio::sync::Mutex<Option<(NaiveDate, [u8; 32])>>,
}

fn next_midnight(day: NaiveDate) -> DateTime<Utc> {
    let next = day.succ_opt().expect("date in range");
    Utc.from_utc_datetime(&next.and_hms_opt(0, 0, 0).expect("midnight"))
}

impl SaltKeeper {
    /// The salt for `now`'s UTC day. On the first call of a new day: create
    /// (or adopt another process's) salt and delete expired ones.
    pub async fn salt_for(&self, db: &Db, now: DateTime<Utc>) -> Result<[u8; 32]> {
        let day = now.date_naive();
        let mut cur = self.current.lock().await;
        if let Some((d, s)) = *cur {
            if d == day {
                return Ok(s);
            }
        }
        let mut fresh = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut fresh);
        let stored =
            store::ensure_salt(db, day, &fresh, next_midnight(day).timestamp_millis()).await?;
        store::delete_expired_salts(db, now.timestamp_millis()).await?;
        let salt: [u8; 32] = stored
            .as_slice()
            .try_into()
            .context("salt must be 32 bytes")?;
        *cur = Some((day, salt));
        Ok(salt)
    }
}

pub fn visitor_hash(salt: &[u8; 32], ip: &str, ua: &str, project: &str) -> u64 {
    let mut buf = Vec::with_capacity(32 + ip.len() + ua.len() + project.len() + 2);
    buf.extend_from_slice(salt);
    buf.extend_from_slice(ip.as_bytes());
    buf.push(0);
    buf.extend_from_slice(ua.as_bytes());
    buf.push(0);
    buf.extend_from_slice(project.as_bytes());
    xxh3_64(&buf)
}

fn session_hash(salt: &[u8; 32], visitor: u64, start_ms: i64) -> u64 {
    let mut buf = Vec::with_capacity(48);
    buf.extend_from_slice(salt);
    buf.extend_from_slice(&visitor.to_le_bytes());
    buf.extend_from_slice(&start_ms.to_le_bytes());
    xxh3_64(&buf)
}

/// In-memory session windows: visitor → (session start, last seen) in ms.
/// Cleared with the salt each day; bounded.
#[derive(Default)]
struct Sessions {
    day: Option<NaiveDate>,
    map: HashMap<u64, (i64, i64)>,
}

impl Sessions {
    const MAX: usize = 500_000;

    fn start_for(&mut self, day: NaiveDate, visitor: u64, now_ms: i64) -> i64 {
        if self.day != Some(day) {
            self.day = Some(day);
            self.map.clear();
        }
        if self.map.len() >= Self::MAX {
            self.map
                .retain(|_, (_, last)| now_ms - *last < SESSION_GAP_MS);
        }
        let e = self.map.entry(visitor).or_insert((now_ms, now_ms));
        if now_ms - e.1 > SESSION_GAP_MS {
            e.0 = now_ms;
        }
        e.1 = now_ms;
        e.0
    }
}

// ------------------------------------------------------------ rate limit

/// Token bucket per key (an IP for the collector, a user id for the web
/// fetch proxy), in integer milli-tokens. Memory only.
pub struct RateLimiter<K = IpAddr> {
    rate_per_min: u64,
    burst_milli: u64,
    buckets: Mutex<HashMap<K, (u64, Instant)>>,
}

impl<K: Hash + Eq> RateLimiter<K> {
    const MAX_KEYS: usize = 100_000;

    pub fn new(rate_per_min: u32, burst: u32) -> Self {
        Self {
            rate_per_min: u64::from(rate_per_min.max(1)),
            burst_milli: u64::from(burst.max(1)) * 1000,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, key: K, now: Instant) -> bool {
        let mut m = self.buckets.lock().expect("rate limiter lock");
        if m.len() >= Self::MAX_KEYS {
            let (rate, burst) = (self.rate_per_min, self.burst_milli);
            m.retain(|_, (tokens, last)| {
                let ms = u64::try_from(now.saturating_duration_since(*last).as_millis())
                    .unwrap_or(u64::MAX);
                tokens.saturating_add(ms.saturating_mul(rate) / 60) < burst
            });
        }
        let (tokens, last) = m.entry(key).or_insert((self.burst_milli, now));
        let ms =
            u64::try_from(now.saturating_duration_since(*last).as_millis()).unwrap_or(u64::MAX);
        // rate_per_min tokens/min = rate_per_min * 1000 milli-tokens / 60_000 ms.
        *tokens = tokens
            .saturating_add(ms.saturating_mul(self.rate_per_min) / 60)
            .min(self.burst_milli);
        *last = now;
        if *tokens >= 1000 {
            *tokens -= 1000;
            true
        } else {
            false
        }
    }
}

// ------------------------------------------------------------ bots

const BOT_MARKERS: &[&str] = &[
    "bot",
    "crawl",
    "spider",
    "slurp",
    "headless",
    "phantomjs",
    "selenium",
    "webdriver",
    "puppeteer",
    "playwright",
    "lighthouse",
    "pagespeed",
    "curl/",
    "wget",
    "python-requests",
    "python-urllib",
    "aiohttp",
    "go-http-client",
    "java/",
    "okhttp",
    "axios",
    "node-fetch",
    "undici",
    "httpclient",
    "libwww",
    "scrapy",
    "facebookexternalhit",
    "preview",
    "monitor",
    "pingdom",
    "uptime",
    "electron",
];

/// Heuristic bot filter on the user agent (ADR-0032: "good enough").
pub fn is_bot(ua: &str) -> bool {
    let ua = ua.trim();
    if ua.len() < 20 || !ua.starts_with("Mozilla/") {
        return true;
    }
    let l = ua.to_ascii_lowercase();
    BOT_MARKERS.iter().any(|m| l.contains(m))
}

// ------------------------------------------------------------ events

/// The beacon payload (short keys keep the script small).
#[derive(Debug, Deserialize)]
pub struct RawEvent {
    /// project tracker key
    pub k: String,
    /// type: pageview | engagement | scroll | outbound
    pub t: String,
    /// path
    pub p: String,
    /// document language
    #[serde(default)]
    pub l: Option<String>,
    /// referrer host
    #[serde(default)]
    pub r: Option<String>,
    /// viewport class s|m|l
    #[serde(default)]
    pub v: Option<String>,
    /// engaged ms
    #[serde(default)]
    pub e: Option<i64>,
    /// scroll milestone
    #[serde(default)]
    pub s: Option<i64>,
    /// outbound host
    #[serde(default)]
    pub o: Option<String>,
    #[serde(default)]
    pub us: Option<String>,
    #[serde(default)]
    pub um: Option<String>,
    #[serde(default)]
    pub uc: Option<String>,
}

/// A validated, normalized event ready to store.
#[derive(Debug, Clone, PartialEq)]
pub struct CleanEvent {
    pub kind: &'static str,
    pub path: String,
    pub lang: String,
    pub ref_domain: Option<String>,
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub viewport: &'static str,
    pub engaged_ms: Option<i64>,
    pub scroll_pct: Option<i64>,
    pub outbound_domain: Option<String>,
}

fn clean_host(s: &str) -> Option<String> {
    let h = s.trim().trim_end_matches('.').to_ascii_lowercase();
    let h = h.strip_prefix("www.").unwrap_or(&h).to_string();
    (!h.is_empty()
        && h.len() <= 253
        && h.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-'))
    .then_some(h)
}

fn clean_tag(s: Option<&str>) -> Option<String> {
    let s = s?.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.chars().take(100).collect::<String>().to_ascii_lowercase())
}

impl RawEvent {
    pub fn clean(&self) -> Result<CleanEvent, String> {
        let kind = match self.t.as_str() {
            "pageview" => "pageview",
            "engagement" => "engagement",
            "scroll" => "scroll",
            "outbound" => "outbound",
            other => return Err(format!("unknown event type {other:?}")),
        };
        let path = self.p.split(['?', '#']).next().unwrap_or("");
        if !path.starts_with('/') || path.len() > 512 || path.chars().any(char::is_control) {
            return Err("bad path".into());
        }
        let lang = self
            .l
            .as_deref()
            .map(|l| l.trim().to_ascii_lowercase())
            .filter(|l| l.len() <= 16 && l.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'))
            .unwrap_or_default();
        let viewport = match self.v.as_deref() {
            Some("s") => "mobile",
            Some("m") => "tablet",
            Some("l") => "desktop",
            _ => "",
        };
        let engaged_ms = match (kind, self.e) {
            ("engagement", Some(ms)) if ms > 0 => Some(ms.min(MAX_ENGAGED_MS)),
            ("engagement", _) => return Err("engagement needs e > 0".into()),
            _ => None,
        };
        let scroll_pct = match (kind, self.s) {
            ("scroll", Some(p @ (25 | 50 | 75 | 100))) => Some(p),
            ("scroll", _) => return Err("scroll needs s in 25/50/75/100".into()),
            _ => None,
        };
        let outbound_domain = match kind {
            "outbound" => Some(
                self.o
                    .as_deref()
                    .and_then(clean_host)
                    .ok_or("outbound needs o")?,
            ),
            _ => None,
        };
        Ok(CleanEvent {
            kind,
            path: path.to_string(),
            lang,
            ref_domain: self.r.as_deref().and_then(clean_host),
            utm_source: clean_tag(self.us.as_deref()),
            utm_medium: clean_tag(self.um.as_deref()),
            utm_campaign: clean_tag(self.uc.as_deref()),
            viewport,
            engaged_ms,
            scroll_pct,
            outbound_domain,
        })
    }
}

/// Whether `host` (from Origin/Referer) is the project's registered domain or
/// one of its subdomains, or localhost when allowed.
pub fn host_allowed(host: &str, domain: Option<&str>, allow_localhost: bool) -> bool {
    let host = host.to_ascii_lowercase();
    if allow_localhost && (host == "localhost" || host == "127.0.0.1" || host == "[::1]") {
        return true;
    }
    match domain {
        Some(d) if !d.is_empty() => {
            let d = d.to_ascii_lowercase();
            host == d || host.ends_with(&format!(".{d}"))
        }
        _ => false,
    }
}

fn header_str<'a>(h: &'a HeaderMap, name: &str) -> Option<&'a str> {
    h.get(name).and_then(|v| v.to_str().ok())
}

/// (origin to echo in CORS, host) from `Origin`, else `Referer`.
fn request_origin(h: &HeaderMap) -> Option<(String, String)> {
    let raw = header_str(h, "origin")
        .filter(|o| *o != "null")
        .or_else(|| header_str(h, "referer"))?;
    let u = url::Url::parse(raw).ok()?;
    let host = u.host_str()?.to_string();
    Some((u.origin().ascii_serialization(), host))
}

fn client_ip(h: &HeaderMap, peer: SocketAddr, trust_xff: bool) -> IpAddr {
    if trust_xff {
        if let Some(ip) = header_str(h, "x-forwarded-for")
            .and_then(|v| v.split(',').next())
            .and_then(|s| s.trim().parse().ok())
        {
            return ip;
        }
    }
    peer.ip()
}

/// Collector state shared by requests.
pub struct Tracker {
    pub cfg: TrackerConfig,
    pub salts: SaltKeeper,
    pub limiter: RateLimiter,
    sessions: Mutex<Sessions>,
    inflight: Semaphore,
}

impl Tracker {
    pub fn new(cfg: TrackerConfig) -> Self {
        Self {
            limiter: RateLimiter::new(cfg.rate_per_min, cfg.burst),
            inflight: Semaphore::new(cfg.max_inflight.max(1)),
            salts: SaltKeeper::default(),
            sessions: Mutex::new(Sessions::default()),
            cfg,
        }
    }

    pub fn snippet(&self, tracker_key: &str) -> String {
        let o = self.cfg.origin.trim_end_matches('/');
        format!(r#"<script defer src="{o}/t/s.js" data-project="{tracker_key}"></script>"#)
    }
}

fn status(code: StatusCode) -> Response {
    code.into_response()
}

fn with_cors(mut res: Response, origin: &str) -> Response {
    if let Ok(v) = HeaderValue::from_str(origin) {
        let h = res.headers_mut();
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    res
}

/// `GET /t/s.js`
pub async fn script() -> Response {
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/javascript; charset=utf-8"),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=3600"),
            ),
            (
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            ),
        ],
        TRACKER_JS,
    )
        .into_response()
}

/// `OPTIONS /t/e`: preflight for registered project domains.
pub async fn preflight(State(st): State<AppState>, headers: HeaderMap) -> Response {
    let Some((origin, host)) = request_origin(&headers) else {
        return status(StatusCode::FORBIDDEN);
    };
    let known = if host_allowed(&host, None, st.tracker.cfg.allow_localhost) {
        true
    } else {
        let bare = host
            .strip_prefix("www.")
            .unwrap_or(&host)
            .to_ascii_lowercase();
        store::domain_registered(&st.db, &bare)
            .await
            .unwrap_or(false)
    };
    if !known {
        return status(StatusCode::FORBIDDEN);
    }
    let mut res = with_cors(status(StatusCode::NO_CONTENT), &origin);
    let h = res.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    h.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("86400"),
    );
    res
}

/// `POST /t/e`
pub async fn collect(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let t = &st.tracker;
    let ip = client_ip(&headers, peer, t.cfg.trust_forwarded_for);
    if !t.limiter.allow(ip, Instant::now()) {
        return status(StatusCode::TOO_MANY_REQUESTS);
    }
    if body.len() > t.cfg.max_event_bytes {
        return status(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let Ok(raw) = serde_json::from_slice::<RawEvent>(&body) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let ev = match raw.clean() {
        Ok(ev) => ev,
        Err(_) => return status(StatusCode::BAD_REQUEST),
    };
    let ua = header_str(&headers, "user-agent").unwrap_or("");
    // Bots, Do-Not-Track and Global Privacy Control: accepted and dropped
    // (the script already stays silent under DNT/GPC; this is defense in depth).
    if is_bot(ua)
        || header_str(&headers, "dnt") == Some("1")
        || header_str(&headers, "sec-gpc") == Some("1")
    {
        return status(StatusCode::NO_CONTENT);
    }
    if raw.k.len() > 64 {
        return status(StatusCode::NOT_FOUND);
    }
    let project = match store::project_by_key(&st.db, &raw.k).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "tracker: project lookup failed");
            return status(StatusCode::SERVICE_UNAVAILABLE);
        }
    };
    let Some((project_id, domain)) = project else {
        return status(StatusCode::NOT_FOUND);
    };
    let Some((origin, host)) = request_origin(&headers) else {
        return status(StatusCode::FORBIDDEN);
    };
    if !host_allowed(&host, domain.as_deref(), t.cfg.allow_localhost) {
        return status(StatusCode::FORBIDDEN);
    }
    // Shed load instead of slowing the game server.
    let Ok(_permit) = t.inflight.try_acquire() else {
        tracing::debug!("tracker: shedding event under load");
        return with_cors(status(StatusCode::NO_CONTENT), &origin);
    };
    let now = Utc::now();
    match store_event(&st, &project_id, &ip.to_string(), ua, &ev, now).await {
        Ok(()) => with_cors(status(StatusCode::NO_CONTENT), &origin),
        Err(e) => {
            tracing::error!(error = %e, "tracker: storing event failed");
            with_cors(status(StatusCode::SERVICE_UNAVAILABLE), &origin)
        }
    }
}

/// Hash the visitor/session and insert the event. Never stores `ip` or `ua`.
pub async fn store_event(
    st: &AppState,
    project_id: &str,
    ip: &str,
    ua: &str,
    ev: &CleanEvent,
    now: DateTime<Utc>,
) -> Result<()> {
    let t = &st.tracker;
    let salt = t.salts.salt_for(&st.db, now).await?;
    let visitor = visitor_hash(&salt, ip, ua, project_id);
    let start = t.sessions.lock().expect("sessions lock").start_for(
        now.date_naive(),
        visitor,
        now.timestamp_millis(),
    );
    let session = session_hash(&salt, visitor, start);
    insert_event(&st.db, project_id, now, ev, visitor, session).await
}

/// Insert one normalized event (also used by test fixtures).
pub async fn insert_event(
    db: &Db,
    project_id: &str,
    ts: DateTime<Utc>,
    ev: &CleanEvent,
    visitor: u64,
    session: u64,
) -> Result<()> {
    store::insert_event(db, project_id, ts.timestamp_millis(), ev, visitor, session).await
}

// ------------------------------------------------------------ rollup

/// First day the rollup may (re)compute: every day from here on still has
/// all of its raw events (retention deletes strictly before `now - retention`).
fn first_complete_day(now: DateTime<Utc>, retention_days: u32) -> NaiveDate {
    let cutoff = now - chrono::Duration::days(i64::from(retention_days));
    cutoff.date_naive().succ_opt().expect("date in range")
}

fn day_of(ts_ms: i64) -> NaiveDate {
    Utc.timestamp_millis_opt(ts_ms)
        .single()
        .map_or(NaiveDate::MIN, |t| t.date_naive())
}

fn midnight_ms(day: NaiveDate) -> i64 {
    Utc.from_utc_datetime(&day.and_hms_opt(0, 0, 0).expect("midnight"))
        .timestamp_millis()
}

#[derive(Default)]
struct PageAgg {
    sessions: BTreeSet<i64>,
    visitors: BTreeSet<i64>,
    pageviews: i64,
    engaged_ms_sum: i64,
    engaged_count: i64,
    scroll_75: i64,
    outbound: i64,
}

type PageKey<'a> = (&'a str, NaiveDate, &'a str, &'a str, &'a str);
type DayKey<'a> = (&'a str, NaiveDate);

fn count(x: usize) -> i64 {
    i64::try_from(x).unwrap_or(i64::MAX)
}

/// The rollup of raw events (ordered by ts, id) as a pure function:
/// per-page rows and per-day totals for every (project, day) present.
pub fn compute_rollup(events: &[store::RawRow]) -> (Vec<DailyRow>, Vec<TotalsRow>) {
    // First-touch source per session: utm_source, else referrer, else direct.
    let mut first_touch: BTreeMap<(&str, i64), String> = BTreeMap::new();
    for e in events {
        first_touch
            .entry((e.project_id.as_str(), e.session_hash))
            .or_insert_with(|| {
                e.utm_source
                    .clone()
                    .or_else(|| e.ref_domain.clone())
                    .unwrap_or_else(|| "direct".into())
            });
    }
    let mut pages: BTreeMap<PageKey<'_>, PageAgg> = BTreeMap::new();
    // (project, day) → session → (pageviews, engaged ms); and visitors.
    let mut sessions: BTreeMap<DayKey<'_>, BTreeMap<i64, (i64, i64)>> = BTreeMap::new();
    let mut visitors: BTreeMap<DayKey<'_>, BTreeSet<i64>> = BTreeMap::new();
    for e in events {
        let day = day_of(e.ts);
        let project = e.project_id.as_str();
        let source = first_touch[&(project, e.session_hash)].as_str();
        let a = pages
            .entry((project, day, e.path.as_str(), e.lang.as_str(), source))
            .or_default();
        let s = sessions
            .entry((project, day))
            .or_default()
            .entry(e.session_hash)
            .or_default();
        match e.kind.as_str() {
            "pageview" => {
                a.sessions.insert(e.session_hash);
                a.visitors.insert(e.visitor_hash);
                a.pageviews += 1;
                s.0 += 1;
                visitors
                    .entry((project, day))
                    .or_default()
                    .insert(e.visitor_hash);
            }
            "engagement" => {
                let ms = e.engaged_ms.unwrap_or(0);
                a.engaged_ms_sum += ms;
                a.engaged_count += 1;
                s.1 += ms;
            }
            "scroll" if e.scroll_pct == Some(75) => a.scroll_75 += 1,
            "outbound" => a.outbound += 1,
            _ => {}
        }
    }
    let daily = pages
        .into_iter()
        .map(|((project, day, path, lang, source), a)| DailyRow {
            project_id: project.to_string(),
            day,
            path: path.to_string(),
            lang: lang.to_string(),
            source: source.to_string(),
            sessions: count(a.sessions.len()),
            visitors: count(a.visitors.len()),
            pageviews: a.pageviews,
            engaged_ms_sum: a.engaged_ms_sum,
            engaged_count: a.engaged_count,
            scroll_75_count: a.scroll_75,
            outbound_count: a.outbound,
        })
        .collect();
    // A session is engaged with >= 10 s visible time or >= 2 pageviews.
    let totals = sessions
        .into_iter()
        .map(|((project, day), ss)| TotalsRow {
            project_id: project.to_string(),
            day,
            sessions: count(ss.values().filter(|(pv, _)| *pv > 0).count()),
            visitors: count(visitors.get(&(project, day)).map_or(0, BTreeSet::len)),
            pageviews: ss.values().map(|(pv, _)| pv).sum(),
            engaged_sessions: count(
                ss.values()
                    .filter(|(pv, ms)| *pv > 0 && (*ms >= 10_000 || *pv >= 2))
                    .count(),
            ),
            engaged_ms_sum: ss.values().map(|(_, ms)| ms).sum(),
        })
        .collect();
    (daily, totals)
}

/// Recompute `analytics_daily` and `analytics_daily_totals` for every day
/// whose raw events are complete (deterministic: a pure function of the raw
/// rows). Returns the number of (project, day) pairs written.
pub async fn rollup(db: &Db, now: DateTime<Utc>, retention_days: u32) -> Result<u64> {
    let from = first_complete_day(now, retention_days);
    let events = store::raw_events_since(db, midnight_ms(from)).await?;
    let (daily, totals) = compute_rollup(&events);
    store::replace_rollup(db, &daily, &totals).await?;
    Ok(u64::try_from(totals.len()).unwrap_or(u64::MAX))
}

/// Delete raw events older than the retention window and expired salts.
/// Returns (events deleted, salts deleted).
pub async fn retention(db: &Db, now: DateTime<Utc>, retention_days: u32) -> Result<(u64, u64)> {
    let cutoff = now - chrono::Duration::days(i64::from(retention_days));
    let ev = store::delete_events_before(db, cutoff.timestamp_millis()).await?;
    let salts = store::delete_expired_salts(db, now.timestamp_millis()).await?;
    Ok((ev, salts))
}

// ------------------------------------------------------------ signals

/// The integers handed to the sim as `Cmd::AnalyticsSignals` (ADR-0032).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AnalyticsSignal {
    pub company_id: String,
    pub project_id: String,
    /// The sim's project id ("project-1").
    pub sim_project_id: String,
    pub day: NaiveDate,
    pub sessions: u32,
    pub visitors: u32,
    pub pageviews: u32,
    /// Engaged sessions per mille of sessions.
    pub engagement_pm: u32,
    /// xxh3 of the top-10 paths (pageviews desc, path asc), newline-joined.
    pub top_pages_digest: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SinkOutcome {
    /// The command was injected into the company's sim.
    Applied,
    /// Not delivered yet; the row stays `pending` and is retried next run.
    Pending,
}

/// Where nightly signals go. The company actor implements this once sim-core
/// and protocol carry `Cmd::AnalyticsSignals`; until then
/// [`PendingSignalSink`] keeps them as `pending` rows.
#[async_trait::async_trait]
pub trait AnalyticsSignalSink: Send + Sync + 'static {
    async fn deliver(&self, signal: &AnalyticsSignal) -> Result<SinkOutcome>;
}

/// STUB: logs and leaves every signal pending.
pub struct PendingSignalSink;

#[async_trait::async_trait]
impl AnalyticsSignalSink for PendingSignalSink {
    async fn deliver(&self, signal: &AnalyticsSignal) -> Result<SinkOutcome> {
        tracing::warn!(project = %signal.sim_project_id, day = %signal.day, sessions = signal.sessions,
            "AnalyticsSignals sim injection not implemented; signal stays pending");
        Ok(SinkOutcome::Pending)
    }
}

pub fn top_pages_digest<S: AsRef<str>>(paths: &[S]) -> u64 {
    let joined = paths
        .iter()
        .map(AsRef::as_ref)
        .collect::<Vec<_>>()
        .join("\n");
    xxh3_64(joined.as_bytes())
}

fn u32_of(v: i64) -> u32 {
    u32::try_from(v.max(0)).unwrap_or(u32::MAX)
}

/// Compute the signal of one project/day from the rollup tables.
pub async fn compute_signal(
    db: &Db,
    project_id: &str,
    day: NaiveDate,
) -> Result<Option<AnalyticsSignal>> {
    let Some(t) = store::totals_row(db, project_id, day).await? else {
        return Ok(None);
    };
    let Some((company_id, sim_project_id)) = store::project_owner(db, project_id).await? else {
        return Ok(None);
    };
    let paths = store::top_paths(db, project_id, day, 10).await?;
    let engagement_pm = if t.sessions > 0 {
        u32_of(t.engaged_sessions * 1000 / t.sessions)
    } else {
        0
    };
    Ok(Some(AnalyticsSignal {
        company_id,
        project_id: project_id.to_string(),
        sim_project_id,
        day,
        sessions: u32_of(t.sessions),
        visitors: u32_of(t.visitors),
        pageviews: u32_of(t.pageviews),
        engagement_pm: engagement_pm.min(1000),
        top_pages_digest: top_pages_digest(&paths),
    }))
}

/// For every finished day (before `now`'s UTC day) with totals and no signal
/// row yet: store a `pending` signal. Then hand every pending signal to the
/// sink and mark the applied ones. Returns the number of new signal rows.
pub async fn nightly_signals(
    db: &Db,
    sink: &dyn AnalyticsSignalSink,
    now: DateTime<Utc>,
) -> Result<u64> {
    let today = now.date_naive();
    let mut created = 0;
    for (project_id, day) in store::days_without_signal(db, today).await? {
        let Some(sig) = compute_signal(db, &project_id, day).await? else {
            continue;
        };
        created += store::insert_signal(
            db,
            &project_id,
            day,
            sig.sessions,
            sig.visitors,
            sig.pageviews,
            sig.engagement_pm,
            sig.top_pages_digest,
            now.timestamp_millis(),
        )
        .await?;
    }
    for row in store::pending_signals(db).await? {
        let sig = AnalyticsSignal {
            company_id: row.company_id,
            project_id: row.project_id.clone(),
            sim_project_id: row.sim_project_id,
            day: row.day,
            sessions: u32_of(row.sessions),
            visitors: u32_of(row.visitors),
            pageviews: u32_of(row.pageviews),
            engagement_pm: u32_of(row.engagement_pm),
            // The digest is a 64-bit pattern stored as INTEGER.
            top_pages_digest: row.top_pages_digest as u64,
        };
        match sink.deliver(&sig).await {
            Ok(SinkOutcome::Applied) => {
                store::mark_signal_applied(db, &row.project_id, row.day, now.timestamp_millis())
                    .await?;
            }
            Ok(SinkOutcome::Pending) => {}
            Err(e) => {
                tracing::error!(error = %e, project = %row.project_id, day = %row.day, "delivering analytics signal failed");
            }
        }
    }
    Ok(created)
}

/// One run of the hourly job: rollup, nightly signals, retention.
pub async fn run_maintenance(
    db: &Db,
    sink: &dyn AnalyticsSignalSink,
    cfg: &TrackerConfig,
    now: DateTime<Utc>,
) -> Result<()> {
    let n = rollup(db, now, cfg.raw_retention_days).await?;
    let s = nightly_signals(db, sink, now).await?;
    let (ev, salts) = retention(db, now, cfg.raw_retention_days).await?;
    tracing::info!(
        days = n,
        signals = s,
        deleted_events = ev,
        deleted_salts = salts,
        "tracker maintenance"
    );
    Ok(())
}

pub fn spawn_maintenance(st: &AppState) -> JoinHandle<()> {
    let db = st.db.clone();
    let sink = st.signal_sink.clone();
    let cfg = st.tracker.cfg.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(cfg.rollup_interval);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            if let Err(e) = run_maintenance(&db, sink.as_ref(), &cfg, Utc::now()).await {
                tracing::error!(error = ?e, "tracker maintenance failed");
            }
        }
    })
}

// ------------------------------------------------------------ projects API

/// Sim ids and slugs: lowercase letter first, then lowercase letters,
/// digits and dashes, at most 64 bytes ("project-1", "cinqueterre").
pub fn valid_sim_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub fn new_tracker_key() -> String {
    let mut b = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut b);
    format!("pk_{}", hex::encode(b))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub sim_project_id: String,
    pub slug: String,
    pub name: String,
    pub domain: Option<String>,
    pub repo: Option<String>,
}

/// `Ok(None)` when the sim id or slug is taken in the company.
pub async fn create_project(db: &Db, company_id: &str, p: &NewProject) -> Result<Option<Project>> {
    store::create_project(
        db,
        &NewProjectRow {
            company_id,
            sim_project_id: &p.sim_project_id,
            slug: &p.slug,
            name: &p.name,
            domain: p.domain.as_deref(),
            repo: p.repo.as_deref(),
            tracker_key: &new_tracker_key(),
        },
        Utc::now().timestamp_millis(),
    )
    .await
}

fn project_json(t: &Tracker, p: &Project) -> Value {
    let mut v = serde_json::to_value(p).expect("project serializes");
    v["snippet"] = Value::String(t.snippet(&p.tracker_key));
    v
}

pub async fn list_projects(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Vec<Value>>> {
    let c = require_company(&st, &user.id).await?;
    let rows = store::list_projects(&st.db, &c.id).await?;
    Ok(Json(
        rows.iter().map(|p| project_json(&st.tracker, p)).collect(),
    ))
}

pub async fn post_project(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(mut body): Json<NewProject>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let c = require_company(&st, &user.id).await?;
    if !valid_sim_id(&body.sim_project_id) {
        return Err(AppError::BadRequest("invalid simProjectId".into()));
    }
    body.name = body.name.trim().to_string();
    if body.name.is_empty() || body.name.chars().count() > 120 {
        return Err(AppError::BadRequest("name must be 1-120 characters".into()));
    }
    if !valid_sim_id(&body.slug) {
        return Err(AppError::BadRequest(
            "slug must be lowercase letters, digits and dashes".into(),
        ));
    }
    if let Some(d) = body.domain.take() {
        let d = d.trim();
        let full = if d.contains("://") {
            d.to_string()
        } else {
            format!("https://{d}")
        };
        let host = url::Url::parse(&full)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .and_then(|h| clean_host(&h))
            .ok_or_else(|| AppError::BadRequest("domain must be a host name".into()))?;
        body.domain = Some(host);
    }
    match create_project(&st.db, &c.id, &body).await? {
        Some(p) => Ok((StatusCode::CREATED, Json(project_json(&st.tracker, &p)))),
        None => Err(AppError::Conflict(
            "a project with this id or slug exists".into(),
        )),
    }
}

// ------------------------------------------------------------ analytics API

#[derive(Deserialize)]
pub struct AnalyticsQuery {
    /// Project uuid, slug or sim project id.
    pub project: String,
    pub days: Option<i32>,
}

/// `GET /api/analytics?project=&days=` for the UI Performance panel.
pub async fn get_analytics(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<AnalyticsQuery>,
) -> AppResult<Json<Value>> {
    let c = require_company(&st, &user.id).await?;
    let days = q.days.unwrap_or(28).clamp(1, 90);
    let project = store::find_project(&st.db, &c.id, &q.project)
        .await?
        .ok_or_else(|| AppError::NotFound("no such project".into()))?;
    let today = Utc::now().date_naive();
    let from = today - chrono::Duration::days(i64::from(days - 1));

    // Zero-filled day series (from..=today).
    let stored: BTreeMap<NaiveDate, store::DaySeriesRow> =
        store::day_series(&st.db, &project.id, from, today)
            .await?
            .into_iter()
            .map(|r| (r.day, r))
            .collect();
    let series: Vec<store::DaySeriesRow> = from
        .iter_days()
        .take_while(|d| *d <= today)
        .map(|d| {
            stored.get(&d).cloned().unwrap_or(store::DaySeriesRow {
                day: d,
                sessions: 0,
                visitors: 0,
                pageviews: 0,
                engaged_sessions: 0,
                engagement_rate: 0.0,
            })
        })
        .collect();
    let top_pages = store::top_pages(&st.db, &project.id, from).await?;
    let languages = store::languages(&st.db, &project.id, from).await?;
    let sources = store::sources(&st.db, &project.id, from).await?;

    let (mut ts, mut tv, mut tp, mut te) = (0i64, 0i64, 0i64, 0i64);
    for r in &series {
        ts += r.sessions;
        tv += r.visitors;
        tp += r.pageviews;
        te += r.engaged_sessions;
    }
    let engagement_pm = if ts > 0 { te * 1000 / ts } else { 0 };
    Ok(Json(json!({
        "project": { "id": project.id, "simProjectId": project.sim_project_id, "slug": project.slug,
                     "name": project.name, "domain": project.domain },
        "from": from, "to": today, "days": series.iter().map(|r| json!({
            "day": r.day, "sessions": r.sessions, "visitors": r.visitors, "pageviews": r.pageviews,
            "engagedSessions": r.engaged_sessions, "engagementRate": r.engagement_rate,
        })).collect::<Vec<_>>(),
        "totals": { "sessions": ts, "visitors": tv, "pageviews": tp, "engagedSessions": te,
                    "engagementPm": engagement_pm },
        "topPages": top_pages.iter().map(|r| json!({
            "path": r.0, "pageviews": r.1, "sessions": r.2, "avgEngagedMs": r.3,
        })).collect::<Vec<_>>(),
        "languages": languages.iter().map(|r| json!({ "lang": r.0, "pageviews": r.1 })).collect::<Vec<_>>(),
        "sources": sources.iter().map(|r| json!({ "source": r.0, "sessions": r.1, "pageviews": r.2 })).collect::<Vec<_>>(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bots() {
        assert!(is_bot(""));
        assert!(is_bot("curl/8.4.0"));
        assert!(is_bot(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36"
        ));
        assert!(is_bot(
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
        ));
        assert!(!is_bot(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        ));
    }

    #[test]
    fn limiter_refills() {
        let l = RateLimiter::new(60, 2);
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        let t0 = Instant::now();
        assert!(l.allow(ip, t0));
        assert!(l.allow(ip, t0));
        assert!(!l.allow(ip, t0));
        // 60/min = 1 token per second.
        assert!(l.allow(ip, t0 + Duration::from_millis(1000)));
        assert!(!l.allow(ip, t0 + Duration::from_millis(1100)));
        assert!(l.allow("10.0.0.2".parse().unwrap(), t0));
    }

    #[test]
    fn hosts() {
        assert!(host_allowed(
            "cinqueterre.travel",
            Some("cinqueterre.travel"),
            false
        ));
        assert!(host_allowed(
            "www.cinqueterre.travel",
            Some("cinqueterre.travel"),
            false
        ));
        assert!(!host_allowed(
            "evilcinqueterre.travel",
            Some("cinqueterre.travel"),
            false
        ));
        assert!(!host_allowed(
            "localhost",
            Some("cinqueterre.travel"),
            false
        ));
        assert!(host_allowed("localhost", None, true));
        assert_eq!(clean_host("WWW.Example.COM."), Some("example.com".into()));
    }

    #[test]
    fn events_clean() {
        let ev: RawEvent = serde_json::from_str(
            r#"{"k":"pk","t":"pageview","p":"/en/x?q=1#h","l":"EN","r":"www.google.com","v":"s","us":"News"}"#,
        )
        .unwrap();
        let c = ev.clean().unwrap();
        assert_eq!(c.path, "/en/x");
        assert_eq!(c.lang, "en");
        assert_eq!(c.ref_domain.as_deref(), Some("google.com"));
        assert_eq!(c.viewport, "mobile");
        assert_eq!(c.utm_source.as_deref(), Some("news"));
        let bad = |s: &str| {
            serde_json::from_str::<RawEvent>(s)
                .unwrap()
                .clean()
                .is_err()
        };
        assert!(bad(r#"{"k":"pk","t":"click","p":"/"}"#));
        assert!(bad(r#"{"k":"pk","t":"pageview","p":"x"}"#));
        assert!(bad(r#"{"k":"pk","t":"scroll","p":"/","s":30}"#));
        assert!(bad(r#"{"k":"pk","t":"engagement","p":"/"}"#));
        assert!(bad(r#"{"k":"pk","t":"outbound","p":"/"}"#));
    }

    #[test]
    fn sessions_split_after_gap() {
        let mut s = Sessions::default();
        let d = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        assert_eq!(s.start_for(d, 1, 1000), 1000);
        assert_eq!(s.start_for(d, 1, 1000 + SESSION_GAP_MS), 1000);
        let later = 2000 + 2 * SESSION_GAP_MS;
        assert_eq!(s.start_for(d, 1, later), later);
    }

    #[test]
    fn digest_is_order_sensitive_and_stable() {
        assert_eq!(
            top_pages_digest(&["/a", "/b"]),
            top_pages_digest(&["/a", "/b"])
        );
        assert_ne!(
            top_pages_digest(&["/a", "/b"]),
            top_pages_digest(&["/b", "/a"])
        );
    }

    /// CI drift check: when the tracker package has been built, the embedded
    /// copy must match it byte for byte (`pnpm --filter tracker sync` fixes it).
    #[test]
    fn assets_match_built_tracker() {
        let dist = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/tracker/dist/tracker.min.js"
        );
        match std::fs::read_to_string(dist) {
            Ok(built) => assert_eq!(
                built, TRACKER_JS,
                "crates/server/assets/tracker.min.js is stale: run pnpm --filter tracker sync"
            ),
            Err(_) => eprintln!("packages/tracker/dist not built; skipping drift check"),
        }
        assert!(TRACKER_JS.contains("sendBeacon"));
    }

    #[test]
    fn complete_day_window() {
        let now = Utc.with_ymd_and_hms(2026, 10, 8, 3, 0, 0).unwrap();
        assert_eq!(
            first_complete_day(now, 7),
            NaiveDate::from_ymd_opt(2026, 10, 2).unwrap()
        );
    }
}
