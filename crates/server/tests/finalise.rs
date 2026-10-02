//! Finalise on merge (ADR-0061 decision 6): an article's pull request is
//! made publishable in the same pull request before the squash merge. The
//! page gets `status: "published"` and `updated_at`; the story list
//! `content/pages/blog-index.json` gets its entry; the base branch is merged
//! in first, so two pull requests opened from the same base both merge.

mod common;

use common::{article, article_path, GatewayPlayer, TestServer};
use github::{GitHubError, PutFile, RepoApi};
use serde_json::{json, Value};

const INDEX_PATH: &str = "content/pages/blog-index.json";

/// The real `content/pages/blog-index.json` of cinqueterre.travel, cut down
/// by hand to its first and last story (same key order, same indentation,
/// no trailing newline).
const INDEX: &str = r#"{
  "id": "blog-index",
  "slug": {
    "en": "/en/blog",
    "de": "/de/blog",
    "fr": "/fr/blog",
    "it": "/it/blog"
  },
  "title": {
    "en": "The Dispatch | Stories & Guides from Cinque Terre"
  },
  "page_type": "blog-index",
  "template": "cinque-terre-blog-index",
  "body": [
    {
      "type": "blog-index",
      "title": "The Dispatch",
      "subtitle": "Slow Journalism for a Fast-Moving Coastline.",
      "categories": [
        "All Stories",
        "Guides",
        "Food & Drink",
        "Culture",
        "Photography",
        "Hotels"
      ],
      "stories": [
        {
          "id": 1,
          "slug": "the-ultimate-guide-to-cinque-terres-best-beaches",
          "title": "The Ultimate Guide to Cinque Terre's Best Beaches",
          "excerpt": "From the sandy shores of Monterosso to the hidden rocky coves of Riomaggiore, we explore the most pristine swimming spots in the Italian Riviera.",
          "author": "Giulia Rossi",
          "date": "Oct 15, 2023",
          "readTime": "8 min read",
          "category": "Guides",
          "image": "https://images.unsplash.com/photo-1534445867742-43195f401b6c?q=80&w=2670&auto=format&fit=crop",
          "isLead": true
        },
        {
          "id": 13,
          "slug": "local-festivals-in-november",
          "title": "Local Festivals in November",
          "excerpt": "Discover the cultural celebrations that make visiting in the off-season special.",
          "author": "Marco Bianchi",
          "date": "Jan 5, 2026",
          "readTime": "4 min read",
          "category": "Culture",
          "image": "https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=2632&auto=format&fit=crop"
        }
      ],
      "newsletter": {
        "title": "Get the Dispatch in Your Inbox."
      }
    }
  ],
  "status": "published",
  "created_at": "2026-01-05T12:00:00.000Z",
  "updated_at": "2026-01-05T12:00:00.000Z"
}"#;

/// The keys of a real story entry, in the order the file has them.
const STORY_KEYS: [&str; 9] = [
    "id", "slug", "title", "excerpt", "author", "date", "readTime", "category", "image",
];

/// A site with the story list and one existing article on `main`.
async fn site(s: &TestServer, n: i64) -> GatewayPlayer {
    let p = s.gateway_player(n).await;
    s.fake_github().create_repo(
        &p.repo,
        &[
            (INDEX_PATH, INDEX),
            (
                "content/pages/blog/local-festivals-in-november.json",
                "{\"id\":\"legacy\"}\n",
            ),
        ],
    );
    p
}

async fn draft(
    s: &TestServer,
    p: &GatewayPlayer,
    id: &str,
    slug: &str,
    title: &str,
) -> (u64, String) {
    let (st, d) = s.draft_article(p, id, slug, article(id, slug, title)).await;
    assert_eq!(st, 200, "{d}");
    (
        d["number"].as_u64().unwrap(),
        d["head_sha"].as_str().unwrap().to_string(),
    )
}

async fn merge(s: &TestServer, p: &GatewayPlayer, number: u64, head: &str) -> (u16, Value) {
    s.gateway(p, "merge", json!({ "number": number, "head_sha": head }))
        .await
}

fn on_main(s: &TestServer, p: &GatewayPlayer, path: &str) -> String {
    s.fake_github()
        .file_text(&p.repo, "main", path)
        .unwrap_or_else(|| panic!("{path} on main"))
}

fn stories(index_text: &str) -> Vec<Value> {
    let doc: Value = serde_json::from_str(index_text).unwrap();
    doc["body"][0]["stories"].as_array().unwrap().clone()
}

/// The keys of the story object whose text starts at `"slug": "<slug>"`,
/// in file order.
fn keys_in_file(index_text: &str, slug: &str) -> Vec<String> {
    let at = index_text.find(&format!("\"slug\": \"{slug}\"")).unwrap();
    let from = index_text[..at].rfind('{').unwrap();
    let to = index_text[from..].find('}').unwrap() + from;
    index_text[from..to]
        .lines()
        .filter_map(|l| {
            l.trim()
                .strip_prefix('"')?
                .split_once('"')
                .map(|(k, _)| k.to_string())
        })
        .collect()
}

#[tokio::test]
async fn a_merge_publishes_the_page_and_lists_the_story() {
    let s = TestServer::start().await;
    let p = site(&s, 1).await;
    let slug = "harvest-week-in-manarola";
    let (number, head) = draft(&s, &p, "c1", slug, "Harvest Week in Manarola").await;
    // Nothing touches the story list before the merge.
    assert_eq!(
        s.fake_github()
            .file_text(&p.repo, "drafts/content-c1", INDEX_PATH)
            .as_deref(),
        Some(INDEX)
    );

    let (st, m) = merge(&s, &p, number, &head).await;
    assert_eq!(st, 200, "{m}");
    assert_eq!(m["finalized"]["index"], "added");
    let merged = m["merged_sha"].as_str().unwrap();
    assert_eq!(
        s.fake_github().branch_head(&p.repo, "main").as_deref(),
        Some(merged)
    );

    // The page on main is published, with the instant of the merge.
    let page: Value = serde_json::from_str(&on_main(&s, &p, &article_path(slug))).unwrap();
    assert_eq!(page["status"], "published");
    let updated = page["updated_at"].as_str().unwrap();
    assert!(
        updated.len() == 24 && updated.ends_with('Z') && updated.contains('T'),
        "{updated}"
    );
    assert_eq!(
        page["body"],
        article("c1", slug, "Harvest Week in Manarola")["body"]
    );

    // The story list: every old byte is still there, and the new entry has
    // exactly the shape of the real ones.
    let index = on_main(&s, &p, INDEX_PATH);
    let cut = INDEX.find("\n      ],\n      \"newsletter\"").unwrap();
    assert!(index.starts_with(&INDEX[..cut]), "{index}");
    assert!(index.ends_with(&INDEX[cut..]), "{index}");
    assert_eq!(keys_in_file(&index, slug), STORY_KEYS);
    assert_eq!(
        keys_in_file(&index, "local-festivals-in-november"),
        STORY_KEYS,
        "the fixture is a real entry"
    );
    let list = stories(&index);
    assert_eq!(list.len(), 3);
    let (real, new) = (&list[1], &list[2]);
    for key in STORY_KEYS {
        assert_eq!(
            std::mem::discriminant(&real[key]),
            std::mem::discriminant(&new[key]),
            "{key}: {} vs {}",
            real[key],
            new[key]
        );
    }
    assert_eq!(new.as_object().unwrap().len(), STORY_KEYS.len());
    assert_eq!(new["id"], 14);
    assert_eq!(new["slug"], slug);
    assert_eq!(new["title"], "Harvest Week in Manarola");
    assert_eq!(
        new["excerpt"],
        "Harvest Week in Manarola: what the terraces look like when the whole village picks grapes."
    );
    assert_eq!(new["author"], "Giulia Rossi");
    assert_eq!(new["category"], "Culture");
    assert!(new["readTime"].as_str().unwrap().ends_with(" min read"));
    assert_eq!(
        new["image"],
        "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop"
    );
    // "Oct 2, 2026": month, day without padding, year.
    let date: Vec<&str> = new["date"].as_str().unwrap().split(' ').collect();
    assert_eq!(date.len(), 3, "{date:?}");
    assert!(
        date[1].ends_with(',') && !date[1].starts_with('0'),
        "{date:?}"
    );

    // One squash commit on main: its parent is the old main.
    let squash = s.fake_github().get_commit(&p.repo, merged).await.unwrap();
    assert_eq!(squash.parents.len(), 1);
    let changed: Vec<&str> = squash.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(changed, vec![INDEX_PATH, article_path(slug).as_str()]);

    // Merging again is idempotent: same sha, no second entry, one event.
    let (st, again) = merge(&s, &p, number, &head).await;
    assert_eq!(st, 200, "{again}");
    assert_eq!(again["merged_sha"], merged);
    assert_eq!(stories(&on_main(&s, &p, INDEX_PATH)).len(), 3);
    assert_eq!(s.inbox(&p.cookie).await.len(), 1);
    // ... and another head is not what was merged.
    let (st, _) = merge(&s, &p, number, "0000000000000000000000000000000000000000").await;
    assert_eq!(st, 409);
}

#[tokio::test]
async fn two_pull_requests_from_the_same_base_both_merge() {
    let s = TestServer::start().await;
    let p = site(&s, 1).await;
    // Both drafts branch from the same main.
    let (n1, h1) = draft(
        &s,
        &p,
        "c1",
        "harvest-week-in-manarola",
        "Harvest Week in Manarola",
    )
    .await;
    let (n2, h2) = draft(
        &s,
        &p,
        "c2",
        "the-anchovy-boats-of-monterosso",
        "The Anchovy Boats of Monterosso",
    )
    .await;

    let (st, m1) = merge(&s, &p, n1, &h1).await;
    assert_eq!(st, 200, "{m1}");
    let (st, m2) = merge(&s, &p, n2, &h2).await;
    assert_eq!(st, 200, "{m2}");
    assert_eq!(m2["finalized"]["index"], "added");

    let list = stories(&on_main(&s, &p, INDEX_PATH));
    let slugs: Vec<&str> = list.iter().map(|s| s["slug"].as_str().unwrap()).collect();
    assert_eq!(
        slugs,
        vec![
            "the-ultimate-guide-to-cinque-terres-best-beaches",
            "local-festivals-in-november",
            "harvest-week-in-manarola",
            "the-anchovy-boats-of-monterosso",
        ]
    );
    let ids: Vec<u64> = list.iter().map(|s| s["id"].as_u64().unwrap()).collect();
    assert_eq!(ids, vec![1, 13, 14, 15]);
    for slug in [
        "harvest-week-in-manarola",
        "the-anchovy-boats-of-monterosso",
    ] {
        let page: Value = serde_json::from_str(&on_main(&s, &p, &article_path(slug))).unwrap();
        assert_eq!(page["status"], "published", "{slug}");
    }
    // The article that was already there is untouched.
    assert_eq!(
        on_main(
            &s,
            &p,
            "content/pages/blog/local-festivals-in-november.json"
        ),
        "{\"id\":\"legacy\"}\n"
    );
}

#[tokio::test]
async fn a_moved_head_is_refused() {
    let s = TestServer::start().await;
    let p = site(&s, 1).await;
    let slug = "harvest-week-in-manarola";
    let (number, head) = draft(&s, &p, "c1", slug, "Harvest Week in Manarola").await;
    let main_before = s.fake_github().branch_head(&p.repo, "main");

    // Somebody pushes to the draft branch after the review.
    let gh = s.fake_github();
    let current = gh
        .get_file(&p.repo, "drafts/content-c1", &article_path(slug))
        .await
        .unwrap()
        .unwrap();
    gh.put_file(
        &p.repo,
        &PutFile {
            branch: "drafts/content-c1".into(),
            path: article_path(slug),
            content: b"{\"id\":\"c1\",\"body\":\"not what the editor read\"}\n".to_vec(),
            message: "sneak".into(),
            expected_sha: Some(current.sha),
            author: None,
        },
    )
    .await
    .unwrap();
    gh.clear_calls();

    let (st, b) = merge(&s, &p, number, &head).await;
    assert_eq!(st, 409, "{b}");
    assert!(b["error"].as_str().unwrap().contains("reviewed"), "{b}");
    assert_eq!(
        gh.branch_head(&p.repo, "main"),
        main_before,
        "nothing merged"
    );
    let calls = gh.calls();
    assert!(
        !calls
            .iter()
            .any(|c| c == "put_file" || c == "merge_branch" || c == "merge_pr"),
        "nothing is written before the head is verified: {calls:?}"
    );
    assert_eq!(on_main(&s, &p, INDEX_PATH), INDEX);
    assert!(s.inbox(&p.cookie).await.is_empty());
}

#[tokio::test]
async fn a_retried_merge_resumes_its_own_finalise() {
    let s = TestServer::start().await;
    let p = site(&s, 1).await;
    let (n1, h1) = draft(
        &s,
        &p,
        "c1",
        "harvest-week-in-manarola",
        "Harvest Week in Manarola",
    )
    .await;
    let (n2, h2) = draft(
        &s,
        &p,
        "c2",
        "the-anchovy-boats-of-monterosso",
        "The Anchovy Boats of Monterosso",
    )
    .await;

    // The first merge finalises its branch, then GitHub fails the squash.
    s.fake_github().fail_next(
        "merge_pr",
        GitHubError::Transport("connection reset".into()),
    );
    let (st, b) = merge(&s, &p, n1, &h1).await;
    assert_eq!(st, 502, "{b}");
    assert_eq!(on_main(&s, &p, INDEX_PATH), INDEX, "nothing reached main");
    let branch_index = s
        .fake_github()
        .file_text(&p.repo, "drafts/content-c1", INDEX_PATH)
        .unwrap();
    assert_eq!(stories(&branch_index).len(), 3, "the branch was finalised");

    // Meanwhile the second article is merged: main's story list moved on.
    let (st, m2) = merge(&s, &p, n2, &h2).await;
    assert_eq!(st, 200, "{m2}");

    // The retry names the same reviewed head. The branch head is the
    // gateway's own finalise commit, so it resumes; the list on the branch
    // is rebuilt on top of main's.
    let (st, m1) = merge(&s, &p, n1, &h1).await;
    assert_eq!(st, 200, "{m1}");
    let list = stories(&on_main(&s, &p, INDEX_PATH));
    let slugs: Vec<&str> = list.iter().map(|s| s["slug"].as_str().unwrap()).collect();
    assert_eq!(
        slugs[2..],
        [
            "the-anchovy-boats-of-monterosso",
            "harvest-week-in-manarola"
        ]
    );
    let ids: Vec<u64> = list.iter().map(|s| s["id"].as_u64().unwrap()).collect();
    assert_eq!(ids, vec![1, 13, 14, 15]);

    // A head that is neither the reviewed one nor the gateway's own is
    // still refused on a retry.
    let (n3, h3) = draft(
        &s,
        &p,
        "c3",
        "sunrise-at-the-sanctuary",
        "Sunrise at the Sanctuary",
    )
    .await;
    s.fake_github().fail_next(
        "merge_pr",
        GitHubError::Transport("connection reset".into()),
    );
    let (st, _) = merge(&s, &p, n3, &h3).await;
    assert_eq!(st, 502);
    let gh = s.fake_github();
    let current = gh
        .get_file(&p.repo, "drafts/content-c3", INDEX_PATH)
        .await
        .unwrap()
        .unwrap();
    gh.put_file(
        &p.repo,
        &PutFile {
            branch: "drafts/content-c3".into(),
            path: INDEX_PATH.into(),
            content: b"{}".to_vec(),
            message: "sneak".into(),
            expected_sha: Some(current.sha),
            author: None,
        },
    )
    .await
    .unwrap();
    let (st, b) = merge(&s, &p, n3, &h3).await;
    assert_eq!(st, 409, "{b}");
}

#[tokio::test]
async fn sites_without_a_story_list_and_pages_outside_the_blog() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    // No blog-index.json in this repository: the page is still published.
    let slug = "harvest-week-in-manarola";
    let (number, head) = draft(&s, &p, "c1", slug, "Harvest Week in Manarola").await;
    let (st, m) = merge(&s, &p, number, &head).await;
    assert_eq!(st, 200, "{m}");
    assert_eq!(m["finalized"]["index"], "absent");
    let page: Value = serde_json::from_str(&on_main(&s, &p, &article_path(slug))).unwrap();
    assert_eq!(page["status"], "published");
    assert!(s
        .fake_github()
        .file_text(&p.repo, "main", INDEX_PATH)
        .is_none());

    // A page outside the blog merges as it always did: byte for byte.
    let (st, d) = s
        .gateway(
            &p,
            "draft",
            json!({ "content_id": "c2", "path": "content/pages/en/about.json",
                    "page": { "status": "draft", "title": { "en": "About" } }, "message": "About" }),
        )
        .await;
    assert_eq!(st, 200, "{d}");
    let before = s
        .fake_github()
        .file_text(&p.repo, "drafts/content-c2", "content/pages/en/about.json")
        .unwrap();
    s.fake_github().clear_calls();
    let (st, m) = merge(
        &s,
        &p,
        d["number"].as_u64().unwrap(),
        d["head_sha"].as_str().unwrap(),
    )
    .await;
    assert_eq!(st, 200, "{m}");
    assert!(m.get("finalized").is_none(), "{m}");
    assert_eq!(on_main(&s, &p, "content/pages/en/about.json"), before);
    let calls = s.fake_github().calls();
    assert!(
        !calls.iter().any(|c| c == "merge_branch" || c == "put_file"),
        "{calls:?}"
    );
}

#[tokio::test]
async fn a_broken_story_list_blocks_the_merge() {
    let s = TestServer::start().await;
    let p = s.gateway_player(1).await;
    s.fake_github()
        .create_repo(&p.repo, &[(INDEX_PATH, "{\"body\":[]}\n")]);
    let (number, head) = draft(
        &s,
        &p,
        "c1",
        "harvest-week-in-manarola",
        "Harvest Week in Manarola",
    )
    .await;
    let main_before = s.fake_github().branch_head(&p.repo, "main");
    let (st, b) = merge(&s, &p, number, &head).await;
    assert_eq!(st, 409, "{b}");
    assert!(b["error"].as_str().unwrap().contains("blog index"), "{b}");
    assert_eq!(s.fake_github().branch_head(&p.repo, "main"), main_before);
}
