//! The storage API's host end to end (ADR-0084 §3, ADR-0080), driven by the statements
//! WordPress 7.1.3 sent (`fixtures/wp-corpus.jsonl`), request by request:
//!
//! 1. the installer imports a new company's first content onto `live`;
//! 2. every later request (front page, login, dashboard, editor, REST create/edit/tag/publish)
//!    runs on a work branch, and each request's governed changes become one attributed commit;
//! 3. the branch reaches the state WordPress's own SQLite integration reached;
//! 4. a change request merges it into `live`, whose projection follows.

use content_repo::{Author, Repo, LIVE};
use serde_json::Value;
use storage_api::{Host, Native};

const CORPUS: &str = include_str!("fixtures/wp-corpus.jsonl");

fn host() -> Host<Native> {
    Host::new(Repo::new(), "wp_", Box::new(Native::memory))
}

/// The corpus as requests: consecutive statements with the same URI.
fn requests() -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for line in CORPUS.lines() {
        let row: Value = serde_json::from_str(line).unwrap();
        let (uri, q) = (
            row["uri"].as_str().unwrap().to_string(),
            row["q"].as_str().unwrap().to_string(),
        );
        match out.last_mut() {
            Some((u, qs)) if *u == uri => qs.push(q),
            _ => out.push((uri, vec![q])),
        }
    }
    out
}

fn editor() -> Author {
    Author {
        kind: "human".into(),
        id: "ceo".into(),
        job: None,
        model: None,
    }
}

fn rows(h: &mut Host<Native>, branch: &str, sql: &str) -> String {
    let out = h.query(branch, sql).unwrap();
    serde_json::to_string(&out.rows).unwrap().replace('"', "")
}

#[test]
fn install_imports_then_work_happens_on_a_branch_and_merges_into_live() {
    let mut h = host();
    let reqs = requests();
    let (install, rest): (Vec<_>, Vec<_>) = reqs
        .into_iter()
        .partition(|(u, _)| u.contains("install.php"));
    for (uri, qs) in &install {
        for q in qs {
            let _ = h.query(LIVE, q);
        }
        h.end_request(
            LIVE,
            Author::system("install"),
            &format!("WordPress install: {uri}"),
        )
        .unwrap();
    }
    h.finish_import();
    let imported = h.repo.materialize(LIVE);
    assert!(
        imported.contains_key("post:1")
            && imported.contains_key("option:blogname")
            && imported.contains_key("user:1"),
        "{:?}",
        imported.keys().collect::<Vec<_>>()
    );
    assert!(
        !imported
            .keys()
            .any(|k| k.starts_with("option:_transient") || k == "option:cron"),
        "scratch never becomes an object"
    );
    assert!(
        imported["user:1"]["row"].get("user_pass").is_none(),
        "the password hash stays in the sandbox"
    );

    h.repo.create_branch("wi-1", LIVE).unwrap();
    let mut commits = 0;
    let mut refused = Vec::new();
    for (uri, qs) in &rest {
        for q in qs {
            if let Err(e) = h.query("wi-1", q) {
                refused.push(format!("{e}: {}", q.chars().take(120).collect::<String>()));
            }
        }
        if h.end_request("wi-1", editor(), &format!("Request {uri}"))
            .unwrap()
            .is_some()
        {
            commits += 1;
        }
    }
    assert!(refused.is_empty(), "{refused:#?}");
    assert!(
        commits >= 3,
        "creating, editing, tagging and publishing commit: {commits}"
    );
    let log = h.repo.log("wi-1");
    assert!(log.iter().all(|c| c.verify()));
    assert_eq!(log[0].author.id, "ceo");

    // The branch holds what WordPress's own integration stored for the same statements.
    let expected: Value = serde_json::from_str(include_str!("fixtures/wp-expected.json")).unwrap();
    let norm = |v: &Value| v.to_string().replace('"', "");
    let posts_sql = "SELECT ID, post_title, post_status, post_type, post_name FROM wp_posts WHERE post_type IN ('post','page') AND post_status <> 'auto-draft' ORDER BY ID";
    let expected_posts: Vec<&Value> = expected["posts"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r[2] != "auto-draft")
        .collect();
    assert_eq!(
        rows(&mut h, "wi-1", posts_sql),
        norm(&serde_json::to_value(&expected_posts).unwrap())
    );
    for (key, sql) in [
        ("terms", "SELECT t.term_id, t.name, t.slug, tt.taxonomy, tt.count FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id = t.term_id ORDER BY t.term_id"),
        ("options", "SELECT option_name, option_value FROM wp_options WHERE option_name IN ('blogname','siteurl','home','template','stylesheet','permalink_structure','default_category','posts_per_page') ORDER BY option_name"),
    ] {
        assert_eq!(rows(&mut h, "wi-1", sql), norm(&expected[key]), "{key}");
    }

    // A fresh projection of the branch, rebuilt from the repository alone, holds the same content.
    h.drop_projection("wi-1");
    assert_eq!(
        rows(&mut h, "wi-1", posts_sql),
        norm(&serde_json::to_value(&expected_posts).unwrap())
    );

    // live does not have the post yet; the change request brings it.
    let harvest =
        "SELECT post_title, post_status FROM wp_posts WHERE post_name = 'harvest-week-in-manarola'";
    assert_eq!(rows(&mut h, LIVE, harvest), "[]");
    let diff_keys: Vec<String> = {
        let cr = h
            .repo
            .open_change_request("wi-1", LIVE, "Harvest week", editor(), Some(1))
            .unwrap();
        let d = h.repo.change_request_diff(cr).unwrap();
        let live = h.repo.head(LIVE).cloned();
        h.repo
            .merge_change_request(cr, live.as_ref(), Author::system("merge-queue"), &|_| {})
            .unwrap();
        d.into_iter().map(|c| c.key).collect()
    };
    assert!(diff_keys.contains(&"post:8".to_string()), "{diff_keys:?}");
    assert_eq!(
        rows(&mut h, LIVE, harvest),
        "[[Harvest week in Manarola,publish]]"
    );
}

#[test]
fn live_refuses_governed_writes_and_accepts_scratch() {
    let mut h = host();
    for (uri, qs) in requests()
        .into_iter()
        .filter(|(u, _)| u.contains("install.php"))
    {
        for q in &qs {
            let _ = h.query(LIVE, q);
        }
        h.end_request(LIVE, Author::system("install"), &uri)
            .unwrap();
    }
    h.finish_import();
    let refused = h.query(
        LIVE,
        "UPDATE wp_posts SET post_title = 'Defaced' WHERE ID = 1",
    );
    assert!(
        matches!(
            refused,
            Err(storage_api::HostError::Projection(
                storage_api::ProjectionError::LiveIsReadOnly(_)
            ))
        ),
        "{refused:?}"
    );
    h.query(LIVE, "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('_transient_x', '1', 'no')").unwrap();
    assert_eq!(h.end_request(LIVE, editor(), "scratch only").unwrap(), None);
}

#[test]
fn two_branches_never_hand_out_the_same_id() {
    let mut h = host();
    for (uri, qs) in requests()
        .into_iter()
        .filter(|(u, _)| u.contains("install.php"))
    {
        for q in &qs {
            let _ = h.query(LIVE, q);
        }
        h.end_request(LIVE, Author::system("install"), &uri)
            .unwrap();
    }
    h.finish_import();
    h.repo.create_branch("a", LIVE).unwrap();
    h.repo.create_branch("b", LIVE).unwrap();
    let insert = "INSERT INTO wp_posts (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt, post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged, post_modified, post_modified_gmt, post_content_filtered, post_parent, guid, menu_order, post_type, post_mime_type, comment_count) VALUES (1, '2026-10-10 10:00:00', '2026-10-10 10:00:00', '', 'T', '', 'draft', 'open', 'open', '', 't', '', '', '2026-10-10 10:00:00', '2026-10-10 10:00:00', '', 0, '', 0, 'post', '', 0)";
    let a = h.query("a", insert).unwrap().insert_id;
    h.end_request("a", editor(), "a").unwrap();
    let b = h.query("b", insert).unwrap().insert_id;
    h.end_request("b", editor(), "b").unwrap();
    assert_ne!(a, b);
}
