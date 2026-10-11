//! Forms and comments of an exported WordPress site (ADR-0083 §3): a public endpoint records each
//! submission as a FormSubmitted event in the company's inbox and sends the visitor back.

mod common;

use common::TestServer;

#[tokio::test]
async fn a_comment_becomes_an_inbox_event_and_the_visitor_goes_back() {
    let s = TestServer::start().await;
    let (cookie, company) = s.player(1).await;
    let post = |body: &'static str, ct: &'static str, referer: String| {
        let url = s.url(&format!("/f/{company}?to=/wp-comments-post.php"));
        let http = s.http.clone();
        async move {
            http.post(url)
                .header("content-type", ct)
                .header("referer", referer)
                .body(body)
                .send()
                .await
                .unwrap()
        }
    };
    let page = format!("{}/sites/{company}/harvest-week/", s.url(""));
    let res = post(
        "author=Rosa&email=r%40example.org&comment=Lovely+piece%21&comment_post_ID=7",
        "application/x-www-form-urlencoded",
        page.clone(),
    )
    .await;
    assert_eq!(res.status(), 303);
    assert_eq!(
        res.headers()["location"],
        format!("/sites/{company}/harvest-week/")
    );
    let ev: Vec<serde_json::Value> = s
        .inbox(&cookie)
        .await
        .into_iter()
        .filter(|e| e["kind"] == "FormSubmitted")
        .collect();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["payload"]["to"], "/wp-comments-post.php");
    assert_eq!(ev[0]["payload"]["fields"]["comment"], "Lovely piece!");

    // A referer off the site goes to the site's home; JSON is refused; an unknown site is 404.
    let res = post(
        "comment=x",
        "application/x-www-form-urlencoded",
        "https://evil.example/".into(),
    )
    .await;
    assert_eq!(res.headers()["location"], format!("/sites/{company}/"));
    assert_eq!(
        post("{}", "application/json", page.clone()).await.status(),
        415
    );
    let res = s
        .http
        .post(s.url("/f/no-such-company"))
        .header("content-type", "application/x-www-form-urlencoded")
        .body("a=b")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);
    // Ten a minute per address and site.
    let mut last = 0;
    for _ in 0..12 {
        last = post(
            "comment=x",
            "application/x-www-form-urlencoded",
            page.clone(),
        )
        .await
        .status()
        .as_u16();
    }
    assert_eq!(last, 429);
}
