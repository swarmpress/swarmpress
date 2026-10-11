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

/// A new company whose installer (WordPress's SQLite plugin, which recorded the corpus) made the
/// core tables itself: they are created from the governed definitions before the replay.
fn host() -> Host<Native> {
    let mut h = Host::new(Repo::new(), "wp_", Box::new(Native::memory));
    h.create_core_tables(LIVE).unwrap();
    h
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

/// WordPress's test suite isolates every test with a transaction (`START TRANSACTION` …
/// `ROLLBACK`): a rolled-back write leaves neither the projection nor a commit; a committed one
/// commits; a transaction left open at the end of a request is rolled back, as MySQL does.
#[test]
fn transactions_are_savepoints_on_the_projection() {
    let mut h = host();
    h.query(LIVE, "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('blogname', 'Cinque Terre', 'yes')").unwrap();
    h.end_request(LIVE, Author::system("install"), "install")
        .unwrap();
    h.finish_import();
    h.repo.create_branch("wi-1", LIVE).unwrap();
    let count = |h: &mut Host<Native>| {
        rows(
            h,
            "wi-1",
            "SELECT COUNT(*) FROM wp_options WHERE option_name = 'tagline'",
        )
    };

    h.query("wi-1", "START TRANSACTION").unwrap();
    h.query("wi-1", "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('tagline', 'Five villages', 'yes')").unwrap();
    assert_eq!(count(&mut h), "[[1]]");
    h.query("wi-1", "ROLLBACK").unwrap();
    assert_eq!(count(&mut h), "[[0]]");
    assert_eq!(
        h.end_request("wi-1", editor(), "rolled back").unwrap(),
        None
    );

    h.query("wi-1", "START TRANSACTION").unwrap();
    h.query("wi-1", "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('tagline', 'Five villages', 'yes')").unwrap();
    h.query("wi-1", "COMMIT").unwrap();
    assert!(h
        .end_request("wi-1", editor(), "committed")
        .unwrap()
        .is_some());

    h.query("wi-1", "START TRANSACTION").unwrap();
    h.query(
        "wi-1",
        "UPDATE wp_options SET option_value = 'Six villages' WHERE option_name = 'tagline'",
    )
    .unwrap();
    assert_eq!(h.end_request("wi-1", editor(), "left open").unwrap(), None);
    assert_eq!(
        rows(
            &mut h,
            "wi-1",
            "SELECT option_value FROM wp_options WHERE option_name = 'tagline'"
        ),
        "[[Five villages]]"
    );
}

/// What WordPress's own PHPUnit suite found missing: `ORDER BY FIELD(…)` (post__in, include
/// ordering) and upserts on a table whose unique key is its composite primary key.
#[test]
fn field_ordering_and_upserts_on_composite_primary_keys() {
    let mut h = host();
    for (id, name) in [(1, "a"), (2, "b"), (3, "c")] {
        h.query(
            LIVE,
            &format!(
                "INSERT INTO wp_terms (term_id, name, slug) VALUES ({id}, '{name}', '{name}')"
            ),
        )
        .unwrap();
    }
    assert_eq!(rows(&mut h, LIVE, "SELECT term_id FROM wp_terms WHERE term_id IN (1, 2, 3) ORDER BY FIELD(term_id, 3, 1, 2)"), "[[3],[1],[2]]");
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT slug FROM wp_terms ORDER BY FIELD(slug, 'b', 'c', 'a') ASC"
        ),
        "[[b],[c],[a]]"
    );
    h.query(LIVE, "INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (9, 1, 1),(9, 2, 2) ON DUPLICATE KEY UPDATE term_order = VALUES(term_order)").unwrap();
    h.query(LIVE, "INSERT INTO wp_term_relationships (object_id, term_taxonomy_id, term_order) VALUES (9, 2, 1),(9, 1, 2) ON DUPLICATE KEY UPDATE term_order = VALUES(term_order)").unwrap();
    assert_eq!(rows(&mut h, LIVE, "SELECT term_taxonomy_id, term_order FROM wp_term_relationships WHERE object_id = 9 ORDER BY term_order"), "[[2,1],[1,2]]");
}

/// With `SET autocommit = 0` (how WordPress's test case opens its transactions), writes between a
/// ROLLBACK and the next START TRANSACTION are in an implicit transaction the next ROLLBACK undoes;
/// and a string with a backslash before a quote reaches SQLite intact.
#[test]
fn autocommit_off_and_backslashed_quotes() {
    let mut h = host();
    h.query(LIVE, "SET autocommit = 0").unwrap();
    h.query(LIVE, "START TRANSACTION").unwrap();
    h.query(LIVE, "ROLLBACK").unwrap();
    h.query(
        LIVE,
        "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('leak', '1', 'yes')",
    )
    .unwrap();
    h.query(LIVE, "ROLLBACK").unwrap();
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT COUNT(*) FROM wp_options WHERE option_name = 'leak'"
        ),
        "[[0]]"
    );
    h.query(
        LIVE,
        "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('kept', '1', 'yes')",
    )
    .unwrap();
    h.query(LIVE, "COMMIT").unwrap();
    h.query(LIVE, "SET autocommit = 1").unwrap();
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT COUNT(*) FROM wp_options WHERE option_name = 'kept'"
        ),
        "[[1]]"
    );

    h.query(LIVE, r#"INSERT INTO `wp_options` (`option_name`, `option_value`) VALUES ('slashed', 'This \\\'is\\\' an example \n of a \"quoted\" string')"#).unwrap();
    let out = h
        .query(
            LIVE,
            "SELECT option_value FROM wp_options WHERE option_name = 'slashed'",
        )
        .unwrap();
    assert_eq!(
        out.rows[0][0],
        serde_json::json!("This \\'is\\' an example \n of a \"quoted\" string")
    );
}

/// MySQL's REGEXP is case-insensitive under WordPress's collation and case-sensitive with BINARY
/// (`meta_compare_key => REGEXP` with `meta_type_key => BINARY`); `CAST(x AS BINARY)` stays text.
#[test]
fn regexp_and_binary() {
    let mut h = host();
    for (id, key) in [(1, "AAA_FOO_AAA"), (2, "aaa_bar_aaa"), (3, "aaa_foo_bbb")] {
        h.query(LIVE, &format!("INSERT INTO wp_postmeta (meta_id, post_id, meta_key, meta_value) VALUES ({id}, {id}, '{key}', 'abc')")).unwrap();
    }
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT post_id FROM wp_postmeta WHERE meta_key REGEXP 'AAA_foo_.*' ORDER BY post_id"
        ),
        "[[1],[3]]"
    );
    assert_eq!(rows(&mut h, LIVE, "SELECT post_id FROM wp_postmeta WHERE CAST(meta_key AS BINARY) REGEXP BINARY 'AAA_FOO_.*' ORDER BY post_id"), "[[1]]");
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT post_id FROM wp_postmeta WHERE meta_key NOT REGEXP '^aaa_' ORDER BY post_id"
        ),
        "[]"
    );
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT post_id FROM wp_postmeta WHERE CAST(meta_key AS BINARY) = 'aaa_bar_aaa'"
        ),
        "[[2]]"
    );
}

/// An invalid date in a DATETIME column becomes MySQL's zero date (WordPress turns strict mode off
/// and relies on it: `wp_insert_post` with `post_date_gmt => '2020-12-41 …'`).
#[test]
fn invalid_dates_become_the_zero_date() {
    let mut h = host();
    h.query(LIVE, "INSERT INTO wp_posts (ID, post_title, post_date, post_date_gmt, post_content, post_excerpt, to_ping, pinged, post_content_filtered) VALUES (5, 'x', '2024-02-29 10:00:00', '2020-12-41 14:15:27', '', '', '', '', '')").unwrap();
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT post_date, post_date_gmt FROM wp_posts WHERE ID = 5"
        ),
        "[[2024-02-29 10:00:00,0000-00-00 00:00:00]]"
    );
    h.query(LIVE, "UPDATE wp_posts SET post_date = '2023-02-29 00:00:00', post_title = '2023-02-29' WHERE ID = 5").unwrap();
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT post_date, post_title FROM wp_posts WHERE ID = 5"
        ),
        "[[0000-00-00 00:00:00,2023-02-29]]"
    );
}

/// A reader's session (a preview, an export): what WordPress writes while it renders a page is
/// rolled back at the request's end and never committed, on a branch or on live.
#[test]
fn a_read_only_session_commits_nothing() {
    use storage_api::protocol::{self, Platform, Session};
    struct NoPlatform;
    impl Platform for NoPlatform {
        fn put_bytes(&mut self, _: &[u8]) -> Result<String, String> {
            Err("no".into())
        }
        fn get_bytes(&mut self, _: &str) -> Result<Vec<u8>, String> {
            Err("no".into())
        }
        fn mail(&mut self, _: serde_json::Value) -> Result<(), String> {
            Ok(())
        }
        fn http(&mut self, _: serde_json::Value) -> Result<serde_json::Value, String> {
            Err("no".into())
        }
    }
    let mut h = host();
    h.query(LIVE, "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('blogname', 'Cinque Terre', 'yes')").unwrap();
    h.end_request(LIVE, Author::system("install"), "install")
        .unwrap();
    h.finish_import();
    h.repo.create_branch("wi-1", LIVE).unwrap();
    let mut session = Session::default();
    for branch in ["wi-1", LIVE] {
        let head = h.repo.head(branch).cloned();
        protocol::repo(
            &mut h,
            &mut session,
            &serde_json::json!({"op": "session.set", "branch": branch, "user_id": 0, "read_only": true}),
        );
        let q = |h: &mut Host<Native>, s: &Session, sql: &str| {
            protocol::storage(
                h,
                s,
                &mut NoPlatform,
                &serde_json::json!({"op": "query", "rid": "r", "sql": sql}),
            )
        };
        let out = q(&mut h, &session, "INSERT INTO wp_posts (ID, post_title, post_type, post_content, post_excerpt, to_ping, pinged, post_content_filtered) VALUES (77, 'Navigation', 'wp_navigation', '', '', '', '', '')");
        assert!(out.get("error").is_none(), "{out}");
        let end = protocol::storage(
            &mut h,
            &session,
            &mut NoPlatform,
            &serde_json::json!({"op": "end", "rid": "r", "uri": "/", "method": "GET"}),
        );
        assert_eq!(end["commit"], serde_json::Value::Null, "{end}");
        assert_eq!(h.repo.head(branch).cloned(), head, "{branch} did not move");
        assert_eq!(
            rows(
                &mut h,
                branch,
                "SELECT COUNT(*) FROM wp_posts WHERE ID = 77"
            ),
            "[[0]]",
            "{branch}: rolled back"
        );
    }
}

/// A reader keeps what it wrote to scratch (a transient), so WordPress's caches survive between
/// requests; a governed write in the same request rolls the whole request back.
#[test]
fn a_reader_keeps_scratch_but_never_governed_writes() {
    use storage_api::protocol::{self, Session};
    let mut h = host();
    h.query(LIVE, "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('blogname', 'Cinque Terre', 'yes')").unwrap();
    h.end_request(LIVE, Author::system("install"), "install")
        .unwrap();
    h.finish_import();
    let mut session = Session::default();
    protocol::repo(
        &mut h,
        &mut session,
        &serde_json::json!({"op": "session.set", "branch": LIVE, "user_id": 0, "read_only": true}),
    );
    h.begin_read(LIVE).unwrap();
    h.query(LIVE, "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('_transient_cache', 'x', 'off')").unwrap();
    h.end_read(LIVE).unwrap();
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT COUNT(*) FROM wp_options WHERE option_name = '_transient_cache'"
        ),
        "[[1]]",
        "scratch kept"
    );
    h.begin_read(LIVE).unwrap();
    h.query(LIVE, "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('_transient_other', 'y', 'off')").unwrap();
    h.query(
        LIVE,
        "UPDATE wp_options SET option_value = 'Hacked' WHERE option_name = 'blogname'",
    )
    .unwrap();
    h.end_read(LIVE).unwrap();
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT option_value FROM wp_options WHERE option_name = 'blogname'"
        ),
        "[[Cinque Terre]]"
    );
    assert_eq!(
        rows(
            &mut h,
            LIVE,
            "SELECT COUNT(*) FROM wp_options WHERE option_name = '_transient_other'"
        ),
        "[[0]]",
        "the request rolled back whole"
    );
}

/// The object API (Generation 2): options, posts with their meta and terms, WP_Query's main path
/// with its found rows, meta and terms of any object type, and post saves, each in one message.
#[test]
fn the_object_api_answers_in_one_message() {
    use storage_api::object_api;
    let mut h = host();
    for sql in [
        "INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('blogname', 'Cinque Terre', 'on'), ('theme_mods_x', 'a:0:{}', 'off')",
        "INSERT INTO wp_terms (term_id, name, slug) VALUES (3, 'Villages', 'villages'), (4, 'Harbour', 'harbour')",
        "INSERT INTO wp_term_taxonomy (term_taxonomy_id, term_id, taxonomy, description) VALUES (3, 3, 'category', ''), (4, 4, 'post_tag', '')",
    ] {
        h.query(LIVE, sql).unwrap();
    }
    let save =
        |h: &mut Host<Native>, msg: serde_json::Value| object_api::handle(h, LIVE, &msg).unwrap();
    for i in 1..=3 {
        let r = save(
            &mut h,
            serde_json::json!({"op": "post.save", "data": {"post_title": format!("Note {i}"), "post_type": "post", "post_status": "publish", "post_date": format!("2026-10-0{i} 10:00:00"), "post_content": "", "post_excerpt": "", "to_ping": "", "pinged": "", "post_content_filtered": ""}}),
        );
        assert_eq!(r["id"], serde_json::json!(i), "{r}");
        h.query(LIVE, &format!("INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES ({i}, '_mood', 'calm')")).unwrap();
        h.query(LIVE, &format!("INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES ({i}, 3), ({i}, 4)")).unwrap();
    }
    let r = save(
        &mut h,
        serde_json::json!({"op": "post.save", "id": 2, "data": {"post_title": "Note two"}}),
    );
    assert_eq!(r["rows_affected"], serde_json::json!(1));

    let opts = save(&mut h, serde_json::json!({"op": "options.all"}));
    assert_eq!(
        opts["columns"],
        serde_json::json!(["option_name", "option_value", "autoload"])
    );
    assert_eq!(opts["rows"].as_array().unwrap().len(), 2);

    let q = save(
        &mut h,
        serde_json::json!({"op": "posts.query", "sql": "SELECT SQL_CALC_FOUND_ROWS wp_posts.ID FROM wp_posts WHERE 1=1 AND wp_posts.post_type = 'post' ORDER BY wp_posts.post_date DESC LIMIT 0, 2", "meta": true, "taxonomies": ["category", "post_tag"]}),
    );
    assert_eq!(
        (q["ids"].clone(), q["found_rows"].clone()),
        (serde_json::json!([3, 2]), serde_json::json!(3))
    );
    let titles: Vec<String> = q["posts"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            r[q["posts"]["columns"]
                .as_array()
                .unwrap()
                .iter()
                .position(|c| c == "post_title")
                .unwrap()]
            .as_str()
            .unwrap()
            .to_string()
        })
        .collect();
    assert!(titles.contains(&"Note two".to_string()), "{titles:?}");
    assert_eq!(q["meta"]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(
        q["terms"]["rows"].as_array().unwrap().len(),
        4,
        "two terms for each of two posts"
    );

    let m = save(
        &mut h,
        serde_json::json!({"op": "meta.load", "type": "post", "ids": [1]}),
    );
    assert_eq!(
        m["columns"],
        serde_json::json!(["post_id", "meta_key", "meta_value"])
    );
    let t = save(
        &mut h,
        serde_json::json!({"op": "terms.of", "ids": [1], "taxonomies": ["post_tag"]}),
    );
    assert_eq!(t["rows"].as_array().unwrap().len(), 1);
    assert!(
        object_api::handle(&mut h, LIVE, &serde_json::json!({"op": "query"})).is_none(),
        "not an object op"
    );
}
