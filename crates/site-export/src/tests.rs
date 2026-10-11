//! The exporter against a small fake WordPress site: what is crawled and what is not, URL
//! rewriting, the release's id and search index, and incremental exports.

use super::*;

const O: &str = "http://sandbox.invalid";

fn html(title: &str, body: &str) -> Response {
    Response {
        status: 200,
        content_type: "text/html; charset=UTF-8".into(),
        location: None,
        body: format!("<!doctype html><html><head><title>{title}</title><link rel=\"stylesheet\" href=\"{O}/wp-content/themes/t/style.css?ver=1.2\"></head><body><main>{body}</main><link rel=\"alternate\" href=\"/oembed?url=http%3A%2F%2Fsandbox.invalid%2Fpost-a%2F\"><script>var x = \"http:\\/\\/sandbox.invalid\\/wp-json\";</script></body></html>").into_bytes(),
    }
}

fn typed(ct: &str, body: &str) -> Response {
    Response {
        status: 200,
        content_type: ct.into(),
        location: None,
        body: body.as_bytes().to_vec(),
    }
}

fn not_found() -> Response {
    Response {
        status: 404,
        content_type: "text/html".into(),
        location: None,
        body: b"nope".to_vec(),
    }
}

/// A site: home lists two posts; post A links a category archive and an image; the sitemap lists
/// everything; a page with a query, wp-admin and wp-json links must not be exported.
fn site(post_a: &str, with_b: bool) -> BTreeMap<String, Response> {
    let mut s = BTreeMap::new();
    let b_link = if with_b {
        format!("<a href=\"{O}/post-b/\">B</a>")
    } else {
        String::new()
    };
    s.insert("/".into(), html("Cinque Terre", &format!("<h1>Home</h1><a href=\"{O}/post-a/\">A</a>{b_link}<a href=\"/?s=search\">Search</a><a href=\"{O}/wp-admin/\">Admin</a><a href=\"mailto:x@example.org\">Mail</a>")));
    s.insert("/post-a/".into(), html("Post A", &format!("<p>{post_a}</p><a href=\"../category/news/\">News</a><img src=\"{O}/wp-content/uploads/a.png\" srcset=\"{O}/wp-content/uploads/a-300.png 300w, {O}/wp-content/uploads/a.png 600w\"><a href=\"{O}/wp-json/wp/v2/posts/1\">json</a>")));
    if with_b {
        s.insert(
            "/post-b/".into(),
            html("Post B", "<p>The second post &amp; more.</p>"),
        );
    }
    s.insert(
        "/category/news/".into(),
        html("News", &format!("<a href=\"{O}/post-a/\">A</a>")),
    );
    s.insert(
        "/wp-content/themes/t/style.css".into(),
        typed(
            "text/css",
            "body{background:url('../t/bg.jpg')} @import \"print.css\";",
        ),
    );
    s.insert(
        "/wp-content/themes/t/bg.jpg".into(),
        typed("image/jpeg", "JPEG"),
    );
    s.insert(
        "/wp-content/themes/t/print.css".into(),
        typed("text/css", "p{}"),
    );
    s.insert(
        "/wp-content/uploads/a.png".into(),
        typed("image/png", "PNG-A"),
    );
    s.insert(
        "/wp-content/uploads/a-300.png".into(),
        typed("image/png", "PNG-A-300"),
    );
    let b_loc = if with_b {
        format!("<url><loc>{O}/post-b/</loc></url>")
    } else {
        String::new()
    };
    s.insert("/wp-sitemap.xml".into(), typed("application/xml", &format!("<urlset><url><loc>{O}/</loc></url><url><loc>{O}/post-a/</loc></url>{b_loc}</urlset>")));
    s.insert("/feed/".into(), typed("application/rss+xml; charset=UTF-8", &format!("<rss><channel><link>{O}/</link><item><link>{O}/post-a/</link></item></channel></rss>")));
    s.insert(
        "/old/".into(),
        Response {
            status: 301,
            content_type: "text/html".into(),
            location: Some(format!("{O}/post-a/")),
            body: vec![],
        },
    );
    s
}

fn crawl(mut c: Crawler, site: &BTreeMap<String, Response>, log: &mut Vec<String>) -> Export {
    while let Some(p) = c.next_path() {
        log.push(p.clone());
        let bare = p.split('?').next().unwrap();
        c.feed(site.get(bare).cloned().unwrap_or_else(not_found));
    }
    c.finish()
}

fn opts() -> Options {
    let mut o = Options::new(O, "https://cinqueterre.travel/");
    o.seeds.push("/old/".into());
    o
}

#[test]
fn a_full_export_crawls_the_static_site_and_nothing_dynamic() {
    let mut log = vec![];
    let e = crawl(
        Crawler::full(opts()),
        &site("Harvest week.", true),
        &mut log,
    );
    let paths: Vec<&str> = e.release.files.keys().map(String::as_str).collect();
    assert_eq!(
        paths,
        [
            "/",
            "/category/news/",
            "/feed/",
            "/post-a/",
            "/post-b/",
            "/search-index.json",
            "/wp-content/themes/t/bg.jpg",
            "/wp-content/themes/t/print.css",
            "/wp-content/themes/t/style.css",
            "/wp-content/uploads/a-300.png",
            "/wp-content/uploads/a.png",
            "/wp-sitemap.xml",
        ]
    );
    // The stylesheet was fetched with WordPress's ?ver= and stored without it.
    assert!(log.contains(&"/wp-content/themes/t/style.css?ver=1.2".to_string()));
    assert!(!log
        .iter()
        .any(|p| p.starts_with("/wp-admin") || p.starts_with("/wp-json")));
    assert_eq!(
        e.release.redirects.get("/old/").map(String::as_str),
        Some("/post-a/")
    );
    assert_eq!(
        e.report
            .skipped
            .iter()
            .map(|s| s.url.as_str())
            .collect::<Vec<_>>(),
        [
            "/?s=search",
            "/oembed?url=http%3A%2F%2Fsandbox.invalid%2Fpost-a%2F"
        ]
    );
    // robots.txt is a seed that does not exist: not reported as broken.
    assert!(e.report.broken.is_empty(), "{:?}", e.report.broken);

    let home = String::from_utf8(e.blobs[&e.release.files["/"].sha256].clone()).unwrap();
    assert!(
        home.contains("https://cinqueterre.travel/post-a/") && !home.contains(O),
        "{home}"
    );
    assert!(
        home.contains("https:\\/\\/cinqueterre.travel\\/wp-json"),
        "JSON-escaped origin rewritten"
    );
    assert!(
        home.contains("url=https%3A%2F%2Fcinqueterre.travel%2Fpost-a%2F"),
        "URL-encoded origin rewritten"
    );

    let index: Vec<SearchEntry> =
        serde_json::from_slice(&e.blobs[&e.release.files["/search-index.json"].sha256]).unwrap();
    let b = index.iter().find(|s| s.url == "/post-b/").unwrap();
    assert_eq!(
        (b.title.as_str(), b.text.as_str()),
        ("Post B", "The second post & more.")
    );

    // The same site gives the same release.
    let again = crawl(
        Crawler::full(opts()),
        &site("Harvest week.", true),
        &mut vec![],
    );
    assert_eq!(again.release, e.release);
}

#[test]
fn an_incremental_export_refreshes_the_touched_page_and_its_neighbours_and_carries_the_rest() {
    let before = crawl(
        Crawler::full(opts()),
        &site("Harvest week.", true),
        &mut vec![],
    );
    let prev_index: Vec<SearchEntry> =
        serde_json::from_slice(&before.blobs[&before.release.files["/search-index.json"].sha256])
            .unwrap();
    let mut log = vec![];
    let after = crawl(
        Crawler::incremental(
            opts(),
            before.release.clone(),
            prev_index,
            &["/post-a/".into()],
        ),
        &site("Harvest week, revised.", true),
        &mut log,
    );
    // Post A, the pages one link away from it (home through the sitemap and feed seeds, its
    // category, its images and the stylesheet), and the seeds; post B is carried.
    assert!(log.contains(&"/post-a/".to_string()) && log.contains(&"/category/news/".to_string()));
    assert!(!log.contains(&"/post-b/".to_string()), "{log:?}");
    assert_eq!(
        after.release.files["/post-b/"],
        before.release.files["/post-b/"]
    );
    assert_ne!(
        after.release.files["/post-a/"],
        before.release.files["/post-a/"]
    );
    assert_ne!(after.release.id, before.release.id);
    assert!(after.report.carried > 0);
    let index: Vec<SearchEntry> =
        serde_json::from_slice(&after.blobs[&after.release.files["/search-index.json"].sha256])
            .unwrap();
    assert!(
        index.iter().any(|s| s.url == "/post-b/"),
        "a carried page stays searchable"
    );
    assert!(index.iter().any(|s| s.text.contains("revised")));
}

#[test]
fn a_deleted_page_leaves_the_release() {
    let before = crawl(Crawler::full(opts()), &site("A.", true), &mut vec![]);
    let after = crawl(
        Crawler::incremental(opts(), before.release.clone(), vec![], &["/post-b/".into()]),
        &site("A.", false),
        &mut vec![],
    );
    assert!(!after.release.files.contains_key("/post-b/"));
    assert!(after.release.files.contains_key("/post-a/"));
    assert_eq!(
        after
            .report
            .broken
            .iter()
            .map(|b| b.url.as_str())
            .collect::<Vec<_>>(),
        ["/post-b/"]
    );
}

#[test]
fn paths_normalize_and_map_to_files() {
    assert_eq!(normalize_path("/a/./b/../c/"), "/a/c/");
    assert_eq!(normalize_path("/a/b/.."), "/a/");
    assert_eq!(normalize_path("/x.css?ver=1"), "/x.css?ver=1");
    assert_eq!(Release::file_path("/", "text/html"), "index.html");
    assert_eq!(
        Release::file_path("/feed/", "application/rss+xml"),
        "feed/index.xml"
    );
    assert_eq!(
        Release::file_path("/wp-content/a.png", "image/png"),
        "wp-content/a.png"
    );
}

#[test]
fn forms_that_post_to_wordpress_post_to_the_platform() {
    let mut o = opts();
    o.forms_endpoint = Some("https://swarm.press/f/c1".into());
    let mut site = site("A.", true);
    site.insert(
        "/post-a/".into(),
        html("Post A", &format!("<form id=\"commentform\" action=\"{O}/wp-comments-post.php\" method=\"post\"><input name=\"comment\"></form><form role=\"search\" action=\"{O}/\" method=\"get\"></form>")),
    );
    let e = crawl(Crawler::full(o), &site, &mut vec![]);
    let page = String::from_utf8(e.blobs[&e.release.files["/post-a/"].sha256].clone()).unwrap();
    assert!(
        page.contains("action=\"https://swarm.press/f/c1?to=/wp-comments-post.php\""),
        "{page}"
    );
    assert!(
        page.contains("action=\"https://cinqueterre.travel/\""),
        "the search form is left as it is"
    );
}
