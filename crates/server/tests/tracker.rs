//! First-party tracker (ADR-0032): collector checks, salts and visitor
//! hashing, privacy of the schema, rollup, retention, nightly signals and
//! the analytics API.

mod common;

use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use common::{Opts, TestServer};
use reqwest::header::{CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use serde_json::{json, Value};
use swarmpress_server::db::tracker::{self as store, DailyRow};
use swarmpress_server::db::{accounts, Db};
use swarmpress_server::tracker::{
    self, AnalyticsSignal, AnalyticsSignalSink, CleanEvent, PendingSignalSink, SaltKeeper,
    SinkOutcome,
};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const SITE: &str = "https://cinqueterre.travel";

async fn project(s: &TestServer, cookie: &str) -> Value {
    let (st, p) = s
        .post_json(
            "/api/projects",
            Some(cookie),
            json!({ "simProjectId": "project-1", "slug": "cinqueterre", "name": "Cinque Terre Dispatch",
                    "domain": "https://www.CinqueTerre.travel/", "repo": "swarmpress/cinqueterre.travel" }),
        )
        .await;
    assert_eq!(st, 201, "{p}");
    p
}

struct Beacon<'a> {
    s: &'a TestServer,
    origin: Option<&'a str>,
    referer: Option<&'a str>,
    ua: &'a str,
    ip: &'a str,
    extra: Vec<(&'static str, &'static str)>,
}

impl<'a> Beacon<'a> {
    fn new(s: &'a TestServer) -> Self {
        Self {
            s,
            origin: Some(SITE),
            referer: None,
            ua: UA,
            ip: "203.0.113.5",
            extra: vec![],
        }
    }

    async fn send_raw(&self, body: String) -> reqwest::Response {
        let mut req = self
            .s
            .http
            .post(self.s.url("/t/e"))
            .header(CONTENT_TYPE, "text/plain;charset=UTF-8")
            .header(USER_AGENT, self.ua)
            .header("x-forwarded-for", self.ip)
            .body(body);
        if let Some(o) = self.origin {
            req = req.header(ORIGIN, o);
        }
        if let Some(r) = self.referer {
            req = req.header(REFERER, r);
        }
        for (k, v) in &self.extra {
            req = req.header(*k, *v);
        }
        req.send().await.unwrap()
    }

    async fn send(&self, body: Value) -> u16 {
        self.send_raw(body.to_string()).await.status().as_u16()
    }
}

async fn event_count(db: &Db) -> i64 {
    store::event_count(db).await.unwrap()
}

/// A migrated private in-memory database.
async fn mem() -> Db {
    Db::memory().await.unwrap()
}

#[tokio::test]
async fn projects_get_public_tracker_keys_and_snippets() {
    let s = TestServer::start().await;
    let (a, _) = s.player(1).await;
    let (b, _) = s.player(2).await;
    let p = project(&s, &a).await;
    let key = p["trackerKey"].as_str().unwrap();
    assert!(key.starts_with("pk_") && key.len() == 27, "{key}");
    assert_eq!(p["domain"], "cinqueterre.travel");
    assert!(p["snippet"]
        .as_str()
        .unwrap()
        .contains(&format!("data-project=\"{key}\"")));
    assert!(p["snippet"].as_str().unwrap().contains("/t/s.js"));
    // Duplicate slug → 409; other companies don't see it.
    let (st, _) = s
        .post_json(
            "/api/projects",
            Some(&a),
            json!({ "simProjectId": "project-1", "slug": "cinqueterre", "name": "x" }),
        )
        .await;
    assert_eq!(st, 409);
    let (_, list_b) = s.get_json("/api/projects", Some(&b)).await;
    assert_eq!(list_b, json!([]));
    let (_, list_a) = s.get_json("/api/projects", Some(&a)).await;
    assert_eq!(list_a.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn script_is_served() {
    let s = TestServer::start().await;
    let res = s.http.get(s.url("/t/s.js")).send().await.unwrap();
    assert_eq!(res.status(), 200);
    assert!(res.headers()[CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("application/javascript"));
    let body = res.text().await.unwrap();
    assert_eq!(body, tracker::TRACKER_JS);
    assert!(body.contains("sendBeacon"), "the built tracker is embedded");
}

#[tokio::test]
async fn collector_checks() {
    let s = TestServer::start().await;
    let (a, _) = s.player(1).await;
    let key = project(&s, &a).await["trackerKey"]
        .as_str()
        .unwrap()
        .to_string();
    let ev = |t: &str| {
        json!({ "k": key, "t": t, "p": "/en/blog/harvest?x=1", "l": "en", "v": "l",
                               "r": "www.google.com", "us": "Newsletter" })
    };

    // Valid event stored, with CORS for the site origin.
    let b = Beacon::new(&s);
    let res = b.send_raw(ev("pageview").to_string()).await;
    assert_eq!(res.status(), 204);
    assert_eq!(
        res.headers()["access-control-allow-origin"]
            .to_str()
            .unwrap(),
        SITE
    );
    let row = store::event_summaries(&s.db).await.unwrap().remove(0);
    assert_eq!(
        row,
        (
            "pageview".into(),
            "/en/blog/harvest".into(),
            "en".into(),
            Some("google.com".into()),
            Some("newsletter".into()),
            "desktop".into()
        )
    );

    // Subdomain and Referer-only requests are fine too.
    let mut sub = Beacon::new(&s);
    sub.origin = None;
    sub.referer = Some("https://www.cinqueterre.travel/en/");
    assert_eq!(sub.send(ev("pageview")).await, 204);

    // Wrong origin → 403, missing origin → 403.
    let mut evil = Beacon::new(&s);
    evil.origin = Some("https://evil.example");
    assert_eq!(evil.send(ev("pageview")).await, 403);
    let mut lookalike = Beacon::new(&s);
    lookalike.origin = Some("https://notcinqueterre.travel");
    assert_eq!(lookalike.send(ev("pageview")).await, 403);
    let mut none = Beacon::new(&s);
    none.origin = None;
    assert_eq!(none.send(ev("pageview")).await, 403);

    // Unknown key → 404.
    assert_eq!(
        b.send(json!({ "k": "pk_000000000000000000000000", "t": "pageview", "p": "/" }))
            .await,
        404
    );
    // Oversize → 413 (both just over the 2 KB cap and far over it).
    let big = json!({ "k": key, "t": "pageview", "p": format!("/{}", "a".repeat(2100)) });
    assert_eq!(b.send(big).await, 413);
    assert_eq!(b.send_raw("x".repeat(20_000)).await.status().as_u16(), 413);
    // Malformed → 400.
    assert_eq!(b.send_raw("not json".into()).await.status().as_u16(), 400);
    assert_eq!(
        b.send(json!({ "k": key, "t": "scroll", "p": "/", "s": 33 }))
            .await,
        400
    );

    // Bots, DNT and GPC are accepted and dropped.
    let before = event_count(&s.db).await;
    for ua in [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
        "curl/8.4.0",
        "",
    ] {
        let mut bot = Beacon::new(&s);
        bot.ua = ua;
        assert_eq!(bot.send(ev("pageview")).await, 204, "{ua}");
    }
    let mut dnt = Beacon::new(&s);
    dnt.extra = vec![("dnt", "1")];
    assert_eq!(dnt.send(ev("pageview")).await, 204);
    let mut gpc = Beacon::new(&s);
    gpc.extra = vec![("sec-gpc", "1")];
    assert_eq!(gpc.send(ev("pageview")).await, 204);
    assert_eq!(event_count(&s.db).await, before, "nothing stored");

    // CORS preflight for a registered domain only.
    let pre = s
        .http
        .request(reqwest::Method::OPTIONS, s.url("/t/e"))
        .header(ORIGIN, "https://www.cinqueterre.travel")
        .send()
        .await
        .unwrap();
    assert_eq!(pre.status(), 204);
    let pre = s
        .http
        .request(reqwest::Method::OPTIONS, s.url("/t/e"))
        .header(ORIGIN, "https://evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(pre.status(), 403);

    // The collector never needed a cookie.
    let _ = COOKIE;
}

#[tokio::test]
async fn collector_rate_limits_per_ip() {
    let s = TestServer::start_with(Opts {
        tweak: Box::new(|c| {
            c.tracker.burst = 3;
            c.tracker.rate_per_min = 1;
        }),
    })
    .await;
    let (a, _) = s.player(1).await;
    let key = project(&s, &a).await["trackerKey"]
        .as_str()
        .unwrap()
        .to_string();
    let ev = json!({ "k": key, "t": "pageview", "p": "/" });
    let b = Beacon::new(&s);
    for _ in 0..3 {
        assert_eq!(b.send(ev.clone()).await, 204);
    }
    assert_eq!(b.send(ev.clone()).await, 429);
    let mut other = Beacon::new(&s);
    other.ip = "198.51.100.7";
    assert_eq!(other.send(ev).await, 204);
    assert_eq!(event_count(&s.db).await, 4);
}

#[tokio::test]
async fn salts_rotate_daily_and_visitor_hashes_follow() {
    let pool = mem().await;
    let p = "6f1c2c9e-0d5b-4b8e-9a39-3f0a7f2d1c11";
    let day1 = Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap();
    let keeper = SaltKeeper::default();
    let s1 = keeper.salt_for(&pool, day1).await.unwrap();
    let s1_late = keeper
        .salt_for(&pool, day1 + Duration::hours(14))
        .await
        .unwrap();
    assert_eq!(s1, s1_late);
    // Another process adopts the same day's salt from the table.
    let other = SaltKeeper::default();
    assert_eq!(
        other
            .salt_for(&pool, day1 + Duration::hours(1))
            .await
            .unwrap(),
        s1
    );
    let h = |salt: &[u8; 32]| tracker::visitor_hash(salt, "203.0.113.5", UA, p);
    assert_eq!(h(&s1), h(&s1_late), "stable within a day");
    assert_ne!(
        tracker::visitor_hash(&s1, "203.0.113.6", UA, p),
        h(&s1),
        "ip matters"
    );
    assert_ne!(
        tracker::visitor_hash(&s1, "203.0.113.5", UA, "another-project"),
        h(&s1),
        "project matters"
    );

    let day2 = Utc.with_ymd_and_hms(2026, 10, 2, 0, 5, 0).unwrap();
    let s2 = keeper.salt_for(&pool, day2).await.unwrap();
    assert_ne!(s1, s2);
    assert_ne!(h(&s1), h(&s2), "different across rotation");
    // Yesterday's salt is destroyed after rotation.
    let days = store::salt_days(&pool).await.unwrap();
    assert_eq!(days, vec![day2.date_naive()]);
}

#[tokio::test]
async fn schema_has_no_ip_or_user_agent_columns() {
    let pool = mem().await;
    let cols = store::schema_columns(&pool).await.unwrap();
    assert!(cols.iter().any(|(t, _)| t == "tracker_events"));
    for (t, c) in &cols {
        let c = c.to_ascii_lowercase();
        let suspicious = c == "ip"
            || c.contains("ip_")
            || c.ends_with("_ip")
            || c.contains("addr")
            || c == "ua"
            || c.contains("user_agent")
            || c.contains("useragent");
        assert!(!suspicious, "{t}.{c} looks like personal data");
    }
}

fn ev(kind: &'static str, path: &str) -> CleanEvent {
    CleanEvent {
        kind,
        path: path.into(),
        lang: "en".into(),
        ref_domain: None,
        utm_source: None,
        utm_medium: None,
        utm_campaign: None,
        viewport: "desktop",
        engaged_ms: None,
        scroll_pct: None,
        outbound_domain: None,
    }
}

async fn new_project(pool: &Db, gh: i64) -> (String, String) {
    let u = accounts::upsert_github_user(pool, gh, &format!("u{gh}"), None, None, 0)
        .await
        .unwrap();
    let c = accounts::create_company(pool, &u.id, "Gazette", 1, "o/r", "main", 0)
        .await
        .unwrap()
        .unwrap();
    let p = tracker::create_project(
        pool,
        &c.id,
        &tracker::NewProject {
            sim_project_id: "project-1".into(),
            slug: "cinqueterre".into(),
            name: "Cinque Terre".into(),
            domain: Some("cinqueterre.travel".into()),
            repo: None,
        },
    )
    .await
    .unwrap()
    .unwrap();
    (c.id, p.id)
}

/// Three sessions on `day` (see the assertions for the expected rollup).
async fn fixture(pool: &Db, project: &str, day: NaiveDate) {
    let at = |h: u32, m: u32| -> DateTime<Utc> {
        Utc.from_utc_datetime(&day.and_hms_opt(h, m, 0).unwrap())
    };
    let (v1, v2) = (11u64, 22u64);
    let (s1, s2, s3) = (101u64, 102u64, u64::MAX); // u64::MAX checks the i64 cast
    let mut google = ev("pageview", "/a");
    google.ref_domain = Some("google.com".into());
    let ins = |t, e: CleanEvent, v, s| async move {
        tracker::insert_event(pool, project, t, &e, v, s)
            .await
            .unwrap()
    };
    // S1 (V1, from google): /a with scroll 75 and 12 s, then /b and an outbound click.
    ins(at(10, 0), google, v1, s1).await;
    let mut sc = ev("scroll", "/a");
    sc.scroll_pct = Some(75);
    ins(at(10, 1), sc.clone(), v1, s1).await;
    sc.scroll_pct = Some(100);
    ins(at(10, 1), sc, v1, s1).await;
    let mut en = ev("engagement", "/a");
    en.engaged_ms = Some(12_000);
    ins(at(10, 2), en, v1, s1).await;
    ins(at(10, 5), ev("pageview", "/b"), v1, s1).await;
    let mut out = ev("outbound", "/b");
    out.outbound_domain = Some("trenitalia.com".into());
    ins(at(10, 6), out, v1, s1).await;
    // S2 (V1 again, later, direct): /a with 3 s.
    ins(at(15, 0), ev("pageview", "/a"), v1, s2).await;
    let mut en = ev("engagement", "/a");
    en.engaged_ms = Some(3_000);
    ins(at(15, 1), en, v1, s2).await;
    // S3 (V2, newsletter, German).
    let mut de = ev("pageview", "/de/a");
    de.lang = "de".into();
    de.utm_source = Some("newsletter".into());
    ins(at(11, 0), de, v2, s3).await;
}

type Daily = (String, String, String, i64, i64, i64, i64, i64, i64, i64);

async fn daily(pool: &Db, day: NaiveDate) -> Vec<Daily> {
    store::daily_rows(pool, day)
        .await
        .unwrap()
        .into_iter()
        .map(|r: DailyRow| {
            (
                r.path,
                r.lang,
                r.source,
                r.sessions,
                r.visitors,
                r.pageviews,
                r.engaged_ms_sum,
                r.engaged_count,
                r.scroll_75_count,
                r.outbound_count,
            )
        })
        .collect()
}

#[tokio::test]
async fn rollup_is_correct_and_idempotent() {
    let pool = mem().await;
    let (_, p) = new_project(&pool, 1).await;
    let p = p.as_str();
    let day = NaiveDate::from_ymd_opt(2026, 9, 30).unwrap();
    fixture(&pool, p, day).await;
    // An event far outside the complete-day window is not rolled up.
    tracker::insert_event(
        &pool,
        p,
        Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap(),
        &ev("pageview", "/old"),
        1,
        1,
    )
    .await
    .unwrap();
    let now = Utc.with_ymd_and_hms(2026, 10, 1, 1, 0, 0).unwrap();
    tracker::rollup(&pool, now, 7).await.unwrap();

    let s = |x: &str| x.to_string();
    let expected: Vec<Daily> = vec![
        (s("/a"), s("en"), s("direct"), 1, 1, 1, 3000, 1, 0, 0),
        (s("/a"), s("en"), s("google.com"), 1, 1, 1, 12000, 1, 1, 0),
        (s("/b"), s("en"), s("google.com"), 1, 1, 1, 0, 0, 0, 1),
        (s("/de/a"), s("de"), s("newsletter"), 1, 1, 1, 0, 0, 0, 0),
    ];
    assert_eq!(daily(&pool, day).await, expected);
    let t = store::totals_row(&pool, p, day).await.unwrap().unwrap();
    // S1 is engaged (12 s, 2 pageviews); S2 (3 s, 1 pv) and S3 are not.
    assert_eq!(
        (
            t.sessions,
            t.visitors,
            t.pageviews,
            t.engaged_sessions,
            t.engaged_ms_sum
        ),
        (3, 2, 4, 1, 15_000)
    );
    let old_day = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
    assert!(daily(&pool, old_day).await.is_empty());

    // Deterministic: re-running yields the same rows.
    tracker::rollup(&pool, now + Duration::hours(1), 7)
        .await
        .unwrap();
    assert_eq!(daily(&pool, day).await, expected);
}

#[tokio::test]
async fn retention_deletes_old_raw_events_and_expired_salts() {
    let pool = mem().await;
    let (_, p) = new_project(&pool, 1).await;
    let p = p.as_str();
    let now = Utc.with_ymd_and_hms(2026, 10, 10, 12, 0, 0).unwrap();
    for (age_days, path) in [(8, "/old"), (6, "/recent"), (0, "/today")] {
        tracker::insert_event(
            &pool,
            p,
            now - Duration::days(age_days),
            &ev("pageview", path),
            1,
            1,
        )
        .await
        .unwrap();
    }
    SaltKeeper::default()
        .salt_for(&pool, now - Duration::days(2))
        .await
        .unwrap();
    let (events, salts) = tracker::retention(&pool, now, 7).await.unwrap();
    assert_eq!((events, salts), (1, 1));
    let left = store::event_paths(&pool).await.unwrap();
    assert_eq!(left, vec![s("/recent"), s("/today")]);

    fn s(x: &str) -> String {
        x.to_string()
    }
}

#[derive(Default)]
struct RecordingSink {
    got: Mutex<Vec<AnalyticsSignal>>,
}

#[async_trait::async_trait]
impl AnalyticsSignalSink for RecordingSink {
    async fn deliver(&self, signal: &AnalyticsSignal) -> anyhow::Result<SinkOutcome> {
        self.got.lock().unwrap().push(signal.clone());
        Ok(SinkOutcome::Applied)
    }
}

#[tokio::test]
async fn nightly_signals_are_deterministic_and_marked() {
    let pool = mem().await;
    let (company, p) = new_project(&pool, 1).await;
    let p = p.as_str();
    let day = NaiveDate::from_ymd_opt(2026, 9, 30).unwrap();
    fixture(&pool, p, day).await;
    let now = Utc.with_ymd_and_hms(2026, 10, 1, 1, 0, 0).unwrap();
    tracker::rollup(&pool, now, 7).await.unwrap();

    // The pending sink stores the row and leaves it pending.
    assert_eq!(
        tracker::nightly_signals(&pool, &PendingSignalSink, now)
            .await
            .unwrap(),
        1
    );
    let status = store::signal_statuses(&pool).await.unwrap();
    assert_eq!(status, ["pending"]);

    let a = tracker::compute_signal(&pool, p, day)
        .await
        .unwrap()
        .unwrap();
    let b = tracker::compute_signal(&pool, p, day)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(a, b);
    assert_eq!(
        (a.sessions, a.visitors, a.pageviews, a.engagement_pm),
        (3, 2, 4, 333)
    );
    assert_eq!(a.sim_project_id, "project-1");
    assert_eq!(a.company_id, company);
    // Top pages: /a (2 pv), then ties by path: /b, /de/a.
    assert_eq!(
        a.top_pages_digest,
        tracker::top_pages_digest(&["/a", "/b", "/de/a"])
    );

    // A real sink gets the stored integers and the row flips to applied.
    let sink = Arc::new(RecordingSink::default());
    assert_eq!(
        tracker::nightly_signals(&pool, sink.as_ref(), now)
            .await
            .unwrap(),
        0,
        "no duplicate rows"
    );
    let got = sink.got.lock().unwrap().clone();
    assert_eq!(got, vec![a]);
    let status = store::signal_statuses(&pool).await.unwrap();
    assert_eq!(status, ["applied"]);
    // Today's (unfinished) day never gets a signal.
    tracker::insert_event(&pool, p, now, &ev("pageview", "/today"), 5, 5)
        .await
        .unwrap();
    tracker::rollup(&pool, now, 7).await.unwrap();
    assert_eq!(
        tracker::nightly_signals(&pool, sink.as_ref(), now)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn analytics_api_shape() {
    let s = TestServer::start().await;
    let (a, _) = s.player(1).await;
    let (b, _) = s.player(2).await;
    let p = project(&s, &a).await;
    let pid = p["id"].as_str().unwrap().to_string();
    let yesterday = Utc::now().date_naive() - Duration::days(1);
    fixture(&s.db, &pid, yesterday).await;
    tracker::rollup(&s.db, Utc::now(), 7).await.unwrap();

    let (st, body) = s
        .get_json("/api/analytics?project=cinqueterre&days=7", Some(&a))
        .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["project"]["slug"], "cinqueterre");
    let days = body["days"].as_array().unwrap();
    assert_eq!(days.len(), 7);
    let y = days
        .iter()
        .find(|d| d["day"] == json!(yesterday))
        .expect("yesterday in series");
    assert_eq!(y["sessions"], 3);
    assert_eq!(y["visitors"], 2);
    assert_eq!(y["pageviews"], 4);
    assert_eq!(y["engagementRate"], 0.3333);
    assert_eq!(days[0]["sessions"], 0, "missing days are zero-filled");
    assert_eq!(body["totals"]["pageviews"], 4);
    assert_eq!(body["totals"]["engagementPm"], 333);
    assert_eq!(body["topPages"][0]["path"], "/a");
    assert_eq!(body["topPages"][0]["pageviews"], 2);
    assert_eq!(body["topPages"][0]["avgEngagedMs"], 7500);
    assert_eq!(
        body["languages"][0],
        json!({ "lang": "en", "pageviews": 3 })
    );
    let sources: Vec<_> = body["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["source"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(sources, ["google.com", "direct", "newsletter"]);

    // Also addressable by sim id and uuid; other companies get 404.
    assert_eq!(
        s.get_json("/api/analytics?project=project-1", Some(&a))
            .await
            .0,
        200
    );
    assert_eq!(
        s.get_json(&format!("/api/analytics?project={pid}"), Some(&a))
            .await
            .0,
        200
    );
    assert_eq!(
        s.get_json("/api/analytics?project=cinqueterre", Some(&b))
            .await
            .0,
        404
    );
    assert_eq!(
        s.get_json("/api/analytics?project=cinqueterre", None)
            .await
            .0,
        401
    );
}

#[tokio::test]
async fn collected_events_get_hashed_sessions() {
    let s = TestServer::start().await;
    let (a, _) = s.player(1).await;
    let key = project(&s, &a).await["trackerKey"]
        .as_str()
        .unwrap()
        .to_string();
    let b = Beacon::new(&s);
    let mut other = Beacon::new(&s);
    other.ip = "198.51.100.9";
    for beacon in [&b, &b, &other] {
        assert_eq!(
            beacon
                .send(json!({ "k": key, "t": "pageview", "p": "/" }))
                .await,
            204
        );
    }
    let rows = store::event_hashes(&s.db).await.unwrap();
    assert_eq!(rows[0], rows[1], "same visitor, same session");
    assert_ne!(rows[0].0, rows[2].0, "different visitor");
}
