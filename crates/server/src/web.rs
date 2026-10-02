//! Web access for local models (ADR-0040).
//!
//! `GET /web/fetch?url=` is the free tier's fetch proxy: the browser cannot
//! read cross-origin pages, so the server fetches and returns readable text;
//! all parsing and analysis stays in the browser. Rules:
//! - signed-in players only, per-user token bucket (429);
//! - `http`/`https` only, no credentials in the URL (400);
//! - every host is resolved and **every** address must be public: loopback,
//!   private, link-local, CGNAT, multicast, documentation, reserved and
//!   their IPv6 equivalents (incl. v4-mapped/NAT64/6to4) are refused (403);
//!   the connection is pinned to the checked address (no DNS rebinding) and
//!   redirects are followed by hand (at most 5), re-checking each hop;
//! - no proxy, 10 s overall timeout (504), HTML/text/JSON only (415),
//!   2 MiB cap (413);
//! - the answer is `{url, status, content_type, text}`; HTML is reduced to
//!   readable text (tags stripped, scripts/styles dropped, entities decoded).
//!
//! Fetched text is untrusted data, never instructions.
//!
//! `POST /web/firecrawl/{*rest}` is the paid tier: 501 until credits ship.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppState;
use crate::auth::CurrentUser;
use crate::error::{AppError, AppResult};

pub const USER_AGENT: &str = concat!(
    "SwarmPressFetch/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/swarmpress/swarmpress)"
);

// ------------------------------------------------------------ SSRF guard

/// Whether `ip` is a public unicast address the proxy may connect to.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0                                  // 0.0.0.0/8 "this network"
        || (a == 100 && (64..=127).contains(&b))   // 100.64.0.0/10 CGNAT
        || (a == 192 && b == 0 && c == 0)          // 192.0.0.0/24 IETF protocol
        || (a == 198 && (b == 18 || b == 19))      // 198.18.0.0/15 benchmarking
        || a >= 240) // 240.0.0.0/4 reserved (+ broadcast)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let s = ip.segments();
    // NAT64 64:ff9b::/96 and 6to4 2002::/16 embed an IPv4 address.
    if s[0] == 0x0064 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
        return is_public_v4(Ipv4Addr::new(
            (s[6] >> 8) as u8,
            s[6] as u8,
            (s[7] >> 8) as u8,
            s[7] as u8,
        ));
    }
    if s[0] == 0x2002 {
        return is_public_v4(Ipv4Addr::new(
            (s[1] >> 8) as u8,
            s[1] as u8,
            (s[2] >> 8) as u8,
            s[2] as u8,
        ));
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (s[0] & 0xfe00) == 0xfc00      // fc00::/7 unique local
        || (s[0] & 0xffc0) == 0xfe80      // fe80::/10 link-local
        || (s[0] & 0xffc0) == 0xfec0      // fec0::/10 site-local (deprecated)
        || (s[0] == 0x2001 && s[1] == 0x0db8) // 2001:db8::/32 documentation
        || (s[0] == 0x0100 && s[1..4] == [0, 0, 0]) // 100::/64 discard
        || s[..6] == [0, 0, 0, 0, 0, 0]) // ::/96 IPv4-compatible (deprecated)
}

/// Validate a fetch URL: http(s), a host, no credentials.
pub fn check_url(raw: &str) -> AppResult<url::Url> {
    let u = url::Url::parse(raw).map_err(|_| AppError::BadRequest("invalid url".into()))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(AppError::BadRequest("only http and https urls".into()));
    }
    if u.host_str().is_none_or(str::is_empty) {
        return Err(AppError::BadRequest("url needs a host".into()));
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err(AppError::BadRequest(
            "credentials in urls are not allowed".into(),
        ));
    }
    Ok(u)
}

/// Resolve the url's host and refuse unless every address is public.
async fn resolve_public(u: &url::Url, allow_private: bool) -> AppResult<Vec<SocketAddr>> {
    let port = u
        .port_or_known_default()
        .ok_or_else(|| AppError::BadRequest("url needs a port".into()))?;
    let addrs: Vec<SocketAddr> = match u.host() {
        Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Some(url::Host::Domain(d)) => tokio::net::lookup_host((d, port))
            .await
            .map_err(|_| AppError::BadGateway(format!("cannot resolve {d}")))?
            .collect(),
        None => return Err(AppError::BadRequest("url needs a host".into())),
    };
    if addrs.is_empty() {
        return Err(AppError::BadGateway("host has no addresses".into()));
    }
    if !allow_private && addrs.iter().any(|a| !is_public_ip(a.ip())) {
        return Err(AppError::Forbidden(
            "url resolves to a private or reserved address".into(),
        ));
    }
    Ok(addrs)
}

// ------------------------------------------------------------ HTML → text

const SKIP_TAGS: &[&str] = &[
    "script", "style", "noscript", "template", "svg", "head", "iframe", "object",
];
const BLOCK_TAGS: &[&str] = &[
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
    "tr",
    "td",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "aside",
    "main",
    "blockquote",
    "pre",
    "table",
    "hr",
    "dt",
    "dd",
    "figcaption",
    "title",
    "body",
];

fn decode_entity(name: &str) -> Option<char> {
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        "ndash" => '\u{2013}',
        "mdash" => '\u{2014}',
        "hellip" => '\u{2026}',
        "copy" => '\u{a9}',
        "rsquo" => '\u{2019}',
        "lsquo" => '\u{2018}',
        "rdquo" => '\u{201d}',
        "ldquo" => '\u{201c}',
        _ => {
            let n = name.strip_prefix('#')?;
            let code = match n.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => n.parse().ok()?,
            };
            return char::from_u32(code).filter(|c| !c.is_control() || c.is_whitespace());
        }
    })
}

fn decode_entities(s: &str, out: &mut String) {
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        match tail.find(';').filter(|&e| e <= 10) {
            Some(e) => match decode_entity(&tail[..e]) {
                Some(c) => {
                    out.push(c);
                    rest = &tail[e + 1..];
                }
                None => {
                    out.push('&');
                    rest = tail;
                }
            },
            None => {
                out.push('&');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
}

/// Reduce HTML to readable text: drop comments and non-content elements,
/// one line per block element, decode entities, collapse whitespace.
pub fn html_to_text(html: &str) -> String {
    // ASCII lowercasing keeps byte offsets identical.
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len() / 2);
    let mut i = 0;
    while i < html.len() {
        if !html[i..].starts_with('<') {
            let next = html[i..].find('<').map_or(html.len(), |e| i + e);
            // Source line breaks are just whitespace; lines come from block tags.
            let mut seg = String::new();
            decode_entities(&html[i..next], &mut seg);
            out.extend(
                seg.chars()
                    .map(|c| if c == '\n' || c == '\r' { ' ' } else { c }),
            );
            i = next;
            continue;
        }
        if lower[i..].starts_with("<!--") {
            i = lower[i + 4..]
                .find("-->")
                .map_or(html.len(), |e| i + 4 + e + 3);
            continue;
        }
        let Some(rel) = html[i..].find('>') else {
            break;
        };
        let end = i + rel + 1;
        let inner = &lower[i + 1..end - 1];
        let closing = inner.starts_with('/');
        let name: String = inner
            .trim_start_matches('/')
            .chars()
            .take_while(char::is_ascii_alphanumeric)
            .collect();
        if !closing && !inner.ends_with('/') && SKIP_TAGS.contains(&name.as_str()) {
            let close = format!("</{name}");
            i = match lower[end..].find(&close) {
                Some(e) => {
                    let at = end + e;
                    lower[at..].find('>').map_or(html.len(), |x| at + x + 1)
                }
                None => html.len(),
            };
            continue;
        }
        if BLOCK_TAGS.contains(&name.as_str()) {
            out.push('\n');
        }
        i = end;
    }
    let mut text = String::with_capacity(out.len());
    for line in out.lines() {
        let words: Vec<&str> = line.split_whitespace().collect();
        if !words.is_empty() {
            text.push_str(&words.join(" "));
            text.push('\n');
        }
    }
    text.trim().to_string()
}

// ------------------------------------------------------------ fetch

#[derive(Deserialize)]
pub struct FetchQuery {
    pub url: String,
}

fn allowed_content_type(ct: &str) -> bool {
    let mime = ct
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    mime.starts_with("text/")
        || mime == "application/json"
        || mime.ends_with("+json")
        || mime == "application/xhtml+xml"
        || mime == "application/xml"
        || mime.ends_with("+xml")
}

/// `GET /web/fetch?url=`
pub async fn fetch(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<FetchQuery>,
) -> AppResult<Json<Value>> {
    if !st.web_limiter.allow(user.id.clone(), Instant::now()) {
        return Err(AppError::TooManyRequests("web fetch rate limit".into()));
    }
    let start = check_url(&q.url)?;
    let cfg = st.cfg.web.clone();
    let res = tokio::time::timeout(cfg.timeout, fetch_inner(start, &cfg)).await;
    let out = match res {
        Ok(r) => r?,
        Err(_) => return Err(AppError::GatewayTimeout("fetch timed out".into())),
    };
    tracing::info!(user_id = %user.id, host = %out.0.host_str().unwrap_or(""), status = out.1, "web fetch");
    Ok(Json(json!({
        "url": out.0.as_str(),
        "status": out.1,
        "content_type": out.2,
        "text": out.3,
    })))
}

async fn fetch_inner(
    mut u: url::Url,
    cfg: &crate::config::WebConfig,
) -> AppResult<(url::Url, u16, String, String)> {
    for _ in 0..=cfg.max_redirects {
        let addrs = resolve_public(&u, cfg.allow_private_for_tests).await?;
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(5))
            .timeout(cfg.timeout);
        if let Some(url::Host::Domain(d)) = u.host() {
            // Pin the connection to the address we checked.
            builder = builder.resolve(d, addrs[0]);
        }
        let client = builder
            .build()
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        let mut res = client
            .get(u.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
            )
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("fetch failed: {e}")))?;
        let status = res.status();
        if status.is_redirection() {
            let loc = res
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| AppError::BadGateway("redirect without location".into()))?;
            let next = u
                .join(loc)
                .map_err(|_| AppError::BadGateway("bad redirect location".into()))?;
            u = check_url(next.as_str())?;
            continue;
        }
        let ct = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !allowed_content_type(&ct) {
            return Err(AppError::UnsupportedMediaType(format!(
                "content type {ct:?} is not html, text or json"
            )));
        }
        if res
            .content_length()
            .is_some_and(|n| n > cfg.max_bytes as u64)
        {
            return Err(AppError::PayloadTooLarge("response exceeds 2 MiB".into()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = res
            .chunk()
            .await
            .map_err(|e| AppError::BadGateway(format!("fetch body: {e}")))?
        {
            if body.len() + chunk.len() > cfg.max_bytes {
                return Err(AppError::PayloadTooLarge("response exceeds 2 MiB".into()));
            }
            body.extend_from_slice(&chunk);
        }
        let raw = String::from_utf8_lossy(&body);
        let lower = ct.to_ascii_lowercase();
        let text = if lower.contains("html") {
            html_to_text(&raw)
        } else {
            raw.into_owned()
        };
        return Ok((u, status.as_u16(), ct, text));
    }
    Err(AppError::BadGateway("too many redirects".into()))
}

/// `POST /web/firecrawl/{*rest}`: the credits-metered tier (wave 3).
pub async fn firecrawl() -> AppError {
    AppError::NotImplemented("firecrawl requires credits (wave 3)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn blocks_private_and_reserved_addresses() {
        for s in [
            "127.0.0.1",
            "127.255.0.9",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254", // cloud metadata
            "100.64.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "255.255.255.255",
            "224.0.0.1",
            "240.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.9",
            "198.18.0.1",
            "192.0.0.8",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "fec0::1",
            "ff02::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::7f00:1",
            "2002:7f00:1::1",
            "2002:a00:1::",
            "::127.0.0.1",
            "100::1",
        ] {
            assert!(!is_public_ip(ip(s)), "{s} must be blocked");
        }
    }

    #[test]
    fn allows_public_addresses() {
        for s in [
            "1.1.1.1",
            "8.8.8.8",
            "93.184.216.34",
            "172.32.0.1",
            "100.128.0.1",
            "2606:4700:4700::1111",
            "2a00:1450:4001:80b::200e",
            "::ffff:8.8.8.8",
            "64:ff9b::808:808",
            "2002:808:808::1",
        ] {
            assert!(is_public_ip(ip(s)), "{s} must be allowed");
        }
    }

    #[test]
    fn url_checks() {
        assert!(check_url("https://example.com/a?b").is_ok());
        assert!(check_url("http://example.com:8080/").is_ok());
        for bad in [
            "ftp://example.com/",
            "file:///etc/passwd",
            "gopher://x/",
            "javascript:alert(1)",
            "https://user:pw@example.com/",
            "not a url",
            "data:text/plain,hi",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[tokio::test]
    async fn literal_and_resolved_private_hosts_are_refused() {
        for u in [
            "http://127.0.0.1:9/",
            "http://[::1]/",
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost/",
            "http://0x7f.1/",
        ] {
            let parsed = check_url(u).unwrap();
            let err = resolve_public(&parsed, false).await.unwrap_err();
            assert_eq!(err.status().as_u16(), 403, "{u}: {err}");
        }
    }

    #[test]
    fn html_becomes_text() {
        let html = r#"<!doctype html><html><head><title>T</title><style>p{color:red}</style>
            <script>alert("x<y")</script></head><body><!-- hidden -->
            <h1>Cinque&nbsp;Terre</h1><p>Trains &amp; ferries&#33; <b>Bold</b>
            caf&#xe9;</p><ul><li>One</li><li>Two</li></ul><noscript>no</noscript>
            <p>a &unknown; b &amp</p></body></html>"#;
        let t = html_to_text(html);
        assert_eq!(
            t,
            "Cinque Terre\nTrains & ferries! Bold café\nOne\nTwo\na &unknown; b &amp"
        );
        assert!(!t.contains("alert"));
        assert!(!t.contains("color"));
        assert!(!t.contains("hidden"));
    }

    #[test]
    fn content_types() {
        assert!(allowed_content_type("text/html; charset=utf-8"));
        assert!(allowed_content_type("application/json"));
        assert!(allowed_content_type("application/ld+json"));
        assert!(!allowed_content_type("image/png"));
        assert!(!allowed_content_type("application/octet-stream"));
        assert!(!allowed_content_type(""));
    }
}
