//! wiremock contract tests for `HttpGitHub` and `AppAuth`: the exact REST
//! shapes GitHub documents, and our mapping of its statuses.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use github::auth::AppClaims;
use github::*;
use serde_json::json;
use wiremock::matchers::{body_partial_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const T0_MS: u64 = 1_780_000_000_000; // fixed "now" for the fake clock

fn key_pem() -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/test-only-app-key.pem",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn pub_pem() -> Vec<u8> {
    std::fs::read(format!(
        "{}/tests/fixtures/test-only-app-key.pub.pem",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn repo() -> RepoId {
    RepoId::new("acme", "site")
}

struct Harness {
    server: MockServer,
    gh: HttpGitHub,
    clock: Arc<ManualClock>,
    sleeper: Arc<RecordingSleeper>,
}

async fn harness() -> Harness {
    let server = MockServer::start().await;
    let clock = ManualClock::new(T0_MS);
    let sleeper = RecordingSleeper::new(clock.clone());
    let gh = HttpGitHub::new(server.uri(), Arc::new(StaticToken("tok-dev".into())))
        .unwrap()
        .with_time(clock.clone(), sleeper.clone())
        .with_governor(Arc::new(Governor::new(GovernorConfig::default(), T0_MS)));
    Harness {
        server,
        gh,
        clock,
        sleeper,
    }
}

fn b64(s: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(s)
}

fn pr_json(number: u64, head_sha: &str) -> serde_json::Value {
    json!({
        "number": number,
        "title": "Last light",
        "body": null,
        "state": "open",
        "merged": false,
        "mergeable": true,
        "mergeable_state": "clean",
        "merge_commit_sha": null,
        "html_url": format!("https://github.com/acme/site/pull/{number}"),
        "head": { "ref": "drafts/content-x", "sha": head_sha },
        "base": { "ref": "main", "sha": "b".repeat(40) },
        "labels": [{ "name": "content" }]
    })
}

// ---- auth -----------------------------------------------------------------

#[tokio::test]
async fn installation_token_exchange_signs_jwt_caches_and_refreshes() {
    let server = MockServer::start().await;
    // GHES-style base with a path prefix.
    let base = format!("{}/api/v3", server.uri());
    let clock = ManualClock::new(T0_MS);
    let expires =
        chrono::DateTime::from_timestamp_millis(i64::try_from(T0_MS).unwrap() + 3_600_000)
            .unwrap()
            .to_rfc3339();
    Mock::given(method("POST"))
        .and(path("/api/v3/app/installations/4242/access_tokens"))
        .and(header("accept", "application/vnd.github+json"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(json!({ "token": "ghs_inst", "expires_at": expires })),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v3/repos/acme/site"))
        .and(header("authorization", "Bearer ghs_inst"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "site", "owner": { "login": "acme" }, "default_branch": "main",
            "private": true, "html_url": "https://github.com/acme/site"
        })))
        .mount(&server)
        .await;

    let app = Arc::new(
        AppAuth::new("123456", &key_pem(), base.clone())
            .unwrap()
            .with_clock(clock.clone()),
    );
    let gh = HttpGitHub::new(base, Arc::new(app.installation(4242))).unwrap();
    let info = gh.get_repo(&repo()).await.unwrap();
    assert!(info.private);
    gh.get_repo(&repo()).await.unwrap();

    let exchanges = |reqs: &[Request]| {
        reqs.iter()
            .filter(|r| r.url.path().ends_with("/access_tokens"))
            .count()
    };
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(exchanges(&reqs), 1, "token is cached");

    // The JWT is RS256, verifiable with the public key, iss = app id,
    // iat backdated 60 s, exp 9 min ahead.
    let jwt_req = reqs
        .iter()
        .find(|r| r.url.path().ends_with("/access_tokens"))
        .unwrap();
    let auth = jwt_req
        .headers
        .get("authorization")
        .unwrap()
        .to_str()
        .unwrap();
    let jwt = auth.strip_prefix("Bearer ").unwrap();
    let mut v = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    v.validate_exp = false;
    v.required_spec_claims.clear();
    let data = jsonwebtoken::decode::<AppClaims>(
        jwt,
        &jsonwebtoken::DecodingKey::from_rsa_pem(&pub_pem()).unwrap(),
        &v,
    )
    .unwrap();
    assert_eq!(data.claims.iss, "123456");
    assert_eq!(data.claims.iat, T0_MS / 1000 - 60);
    assert_eq!(data.claims.exp, T0_MS / 1000 + 540);

    // 54 min later: still > 5 min of validity → cached.
    clock.advance(Duration::from_secs(54 * 60));
    app.installation_token(4242).await.unwrap();
    assert_eq!(exchanges(&server.received_requests().await.unwrap()), 1);
    // 56 min: inside the 5-minute refresh margin → exchanged again.
    clock.advance(Duration::from_secs(2 * 60));
    app.installation_token(4242).await.unwrap();
    assert_eq!(exchanges(&server.received_requests().await.unwrap()), 2);
}

#[tokio::test]
async fn token_exchange_refusal_and_bad_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app/installations/1/access_tokens"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({ "message": "A JSON web token could not be decoded" })),
        )
        .mount(&server)
        .await;
    let app = AppAuth::new("1", &key_pem(), server.uri()).unwrap();
    assert!(matches!(
        app.installation_token(1).await,
        Err(GitHubError::Auth(_))
    ));
    assert!(matches!(
        AppAuth::new("1", b"not a pem", server.uri()),
        Err(GitHubError::Auth(_))
    ));
}

#[tokio::test]
async fn installation_lookup_for_repo() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/installation"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "id": 777, "account": { "login": "acme" } })),
        )
        .mount(&server)
        .await;
    let app = AppAuth::new("1", &key_pem(), server.uri()).unwrap();
    assert_eq!(app.installation_for_repo(&repo()).await.unwrap(), 777);
}

// ---- contents -------------------------------------------------------------

#[tokio::test]
async fn get_file_decodes_wrapped_base64_and_sha() {
    let h = harness().await;
    let content = b"{\n  \"id\": \"home\"\n}\n";
    // GitHub wraps base64 at 60 columns with \n.
    let encoded = b64(content);
    let wrapped = format!("{}\n{}\n", &encoded[..10], &encoded[10..]);
    Mock::given(method("GET"))
        .and(path(
            "/repos/acme/site/contents/content/pages/en/index.json",
        ))
        .and(query_param("ref", "drafts/content-x"))
        .and(header("authorization", "Bearer tok-dev"))
        .and(header("x-github-api-version", "2022-11-28"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "file", "encoding": "base64", "size": content.len(),
            "name": "index.json", "path": "content/pages/en/index.json",
            "content": wrapped, "sha": "3d21ec53a331a6f037a91c368710b99387d012c1"
        })))
        .mount(&h.server)
        .await;
    let f =
        h.gh.get_file(&repo(), "drafts/content-x", "content/pages/en/index.json")
            .await
            .unwrap()
            .unwrap();
    assert_eq!(f.content, content);
    assert_eq!(f.sha, "3d21ec53a331a6f037a91c368710b99387d012c1");
}

#[tokio::test]
async fn get_file_404_is_none_and_paths_are_percent_encoded() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path(
            "/repos/acme/site/contents/content/pages/en/a%20b.json",
        ))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "message": "Not Found" })))
        .mount(&h.server)
        .await;
    assert_eq!(
        h.gh.get_file(&repo(), "main", "content/pages/en/a b.json")
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn get_large_file_falls_back_to_blob_api() {
    let h = harness().await;
    let sha = "a".repeat(40);
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/contents/media/big.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "type": "file", "encoding": "none", "content": "", "sha": sha
        })))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/repos/acme/site/git/blobs/{sha}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sha": sha, "encoding": "base64", "content": b64(b"big!")
        })))
        .mount(&h.server)
        .await;
    let f =
        h.gh.get_file(&repo(), "main", "media/big.json")
            .await
            .unwrap()
            .unwrap();
    assert_eq!(f.content, b"big!");
}

#[tokio::test]
async fn list_dir_maps_entries() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/contents/content/pages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            { "type": "file", "name": "z.json", "path": "content/pages/z.json", "sha": "1" },
            { "type": "dir", "name": "en", "path": "content/pages/en", "sha": "2" }
        ])))
        .mount(&h.server)
        .await;
    let v =
        h.gh.list_dir(&repo(), "main", "content/pages")
            .await
            .unwrap();
    assert_eq!(v[0].kind, EntryKind::Dir);
    assert_eq!(v[1].name, "z.json");
}

#[tokio::test]
async fn put_file_sends_base64_branch_and_sha() {
    let h = harness().await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/contents/content/pages/blog/x.json"))
        .and(body_partial_json(json!({
            "message": "Draft x",
            "content": b64(b"{}\n"),
            "branch": "drafts/content-x",
            "sha": "old-sha"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "content": { "sha": "new-blob", "path": "content/pages/blog/x.json" },
            "commit": { "sha": "new-commit", "message": "Draft x" }
        })))
        .expect(1)
        .mount(&h.server)
        .await;
    let w =
        h.gh.put_file(
            &repo(),
            &PutFile {
                branch: "drafts/content-x".into(),
                path: "content/pages/blog/x.json".into(),
                content: b"{}\n".to_vec(),
                message: "Draft x".into(),
                expected_sha: Some("old-sha".into()),
                author: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(w.content_sha.as_deref(), Some("new-blob"));
    assert_eq!(w.commit_sha, "new-commit");
}

#[tokio::test]
async fn put_file_conflicts_map_to_conflict() {
    let h = harness().await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/contents/content/a.json"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "message": "content/a.json does not match 0123"
        })))
        .mount(&h.server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/contents/content/b.json"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "message": "Invalid request.\n\n\"sha\" wasn't supplied."
        })))
        .mount(&h.server)
        .await;
    for p in ["content/a.json", "content/b.json"] {
        let e =
            h.gh.put_file(
                &repo(),
                &PutFile {
                    branch: "main".into(),
                    path: p.into(),
                    content: vec![],
                    message: "m".into(),
                    expected_sha: None,
                    author: None,
                },
            )
            .await
            .unwrap_err();
        assert!(e.is_conflict(), "{p}: {e}");
    }
}

#[tokio::test]
async fn delete_file_sends_sha() {
    let h = harness().await;
    Mock::given(method("DELETE"))
        .and(path("/repos/acme/site/contents/content/a.json"))
        .and(body_partial_json(
            json!({ "sha": "s1", "branch": "drafts/content-x", "message": "rm" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "content": null, "commit": { "sha": "c9" }
        })))
        .mount(&h.server)
        .await;
    let w =
        h.gh.delete_file(
            &repo(),
            &DeleteFile {
                branch: "drafts/content-x".into(),
                path: "content/a.json".into(),
                message: "rm".into(),
                expected_sha: "s1".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(w.commit_sha, "c9");
    assert_eq!(w.content_sha, None);
}

// ---- refs -----------------------------------------------------------------

#[tokio::test]
async fn branches_get_create_and_exists() {
    let h = harness().await;
    let main_sha = "c".repeat(40);
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/git/ref/heads/main"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "ref": "refs/heads/main", "object": { "sha": main_sha, "type": "commit" }
        })))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/git/ref/heads/drafts/content-x"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "message": "Not Found" })))
        .mount(&h.server)
        .await;
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/git/refs"))
        .and(body_partial_json(
            json!({ "ref": "refs/heads/drafts/content-x", "sha": main_sha }),
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "ref": "refs/heads/drafts/content-x", "object": { "sha": main_sha }
        })))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&h.server)
        .await;
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/git/refs"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({ "message": "Reference already exists" })),
        )
        .mount(&h.server)
        .await;

    assert_eq!(
        h.gh.get_branch(&repo(), "drafts/content-x").await.unwrap(),
        None
    );
    let b =
        h.gh.create_branch(&repo(), "drafts/content-x", "main")
            .await
            .unwrap();
    assert_eq!(b.sha, main_sha);
    assert!(matches!(
        h.gh.create_branch(&repo(), "drafts/content-x", "main")
            .await,
        Err(GitHubError::AlreadyExists(_))
    ));
}

#[tokio::test]
async fn get_commit_maps_files() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/commits/abc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sha": "abc",
            "commit": { "message": "Last light (#6)" },
            "parents": [{ "sha": "p1" }],
            "files": [
                { "filename": "content/a.json", "status": "added" },
                { "filename": "content/c.json", "status": "renamed", "previous_filename": "content/b.json" }
            ]
        })))
        .mount(&h.server)
        .await;
    let c = h.gh.get_commit(&repo(), "abc").await.unwrap();
    assert_eq!(c.parents, vec!["p1"]);
    assert_eq!(c.files[1].status, FileStatus::Renamed);
    assert_eq!(c.files[1].previous_path.as_deref(), Some("content/b.json"));
}

// ---- pull requests --------------------------------------------------------

#[tokio::test]
async fn pr_create_find_get_comment_label_and_squash_merge() {
    let h = harness().await;
    let head = "d".repeat(40);
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/pulls"))
        .and(body_partial_json(json!({
            "title": "Last light", "head": "drafts/content-x", "base": "main", "draft": false
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(pr_json(5, &head)))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/pulls"))
        .and(query_param("state", "open"))
        .and(query_param("head", "acme:drafts/content-x"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([pr_json(5, &head)])))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/pulls/5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pr_json(5, &head)))
        .mount(&h.server)
        .await;
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/issues/5/comments"))
        .and(body_partial_json(json!({ "body": "Score 8/10" })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "id": 99 })))
        .mount(&h.server)
        .await;
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/issues/5/labels"))
        .and(body_partial_json(json!({ "labels": ["content"] })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([{ "name": "content" }])))
        .mount(&h.server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/pulls/5/merge"))
        .and(body_partial_json(
            json!({ "merge_method": "squash", "sha": head }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sha": "e".repeat(40), "merged": true, "message": "Pull Request successfully merged"
        })))
        .mount(&h.server)
        .await;

    let pr =
        h.gh.create_pr(
            &repo(),
            &NewPullRequest {
                title: "Last light".into(),
                head: "drafts/content-x".into(),
                base: "main".into(),
                body: String::new(),
                draft: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(pr.number, 5);
    assert_eq!(pr.body, "", "null body → empty");
    assert_eq!(pr.mergeable, Some(true));
    assert_eq!(pr.labels, vec!["content"]);
    let found =
        h.gh.find_open_pr(&repo(), "drafts/content-x")
            .await
            .unwrap()
            .unwrap();
    assert_eq!(found.number, 5);
    assert_eq!(h.gh.get_pr(&repo(), 5).await.unwrap().head_sha, head);
    assert_eq!(h.gh.comment(&repo(), 5, "Score 8/10").await.unwrap(), 99);
    h.gh.add_labels(&repo(), 5, &["content".into()])
        .await
        .unwrap();
    let m =
        h.gh.merge_pr(
            &repo(),
            5,
            &MergeOptions {
                expected_head_sha: Some(head.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(m.sha, "e".repeat(40));
}

#[tokio::test]
async fn merge_error_statuses() {
    let h = harness().await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/pulls/7/merge"))
        .respond_with(
            ResponseTemplate::new(405)
                .set_body_json(json!({ "message": "Pull Request is not mergeable" })),
        )
        .mount(&h.server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/pulls/8/merge"))
        .respond_with(ResponseTemplate::new(409).set_body_json(
            json!({ "message": "Head branch was modified. Review and try the merge again." }),
        ))
        .mount(&h.server)
        .await;
    assert!(matches!(
        h.gh.merge_pr(&repo(), 7, &MergeOptions::default()).await,
        Err(GitHubError::NotMergeable(_))
    ));
    assert!(h
        .gh
        .merge_pr(&repo(), 8, &MergeOptions::default())
        .await
        .unwrap_err()
        .is_conflict());
}

#[tokio::test]
async fn close_pr_patches_state() {
    let h = harness().await;
    let mut closed = pr_json(5, &"d".repeat(40));
    closed["state"] = json!("closed");
    Mock::given(method("PATCH"))
        .and(path("/repos/acme/site/pulls/5"))
        .and(body_partial_json(json!({ "state": "closed" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(closed))
        .mount(&h.server)
        .await;
    assert_eq!(
        h.gh.close_pr(&repo(), 5).await.unwrap().state,
        PrState::Closed
    );
}

// ---- checks / actions -----------------------------------------------------

#[tokio::test]
async fn check_runs_listed() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/commits/abc/check-runs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "total_count": 2,
            "check_runs": [
                { "id": 1, "name": "site-ci", "head_sha": "abc", "status": "completed", "conclusion": "success" },
                { "id": 2, "name": "lighthouse", "head_sha": "abc", "status": "in_progress", "conclusion": null }
            ]
        })))
        .mount(&h.server)
        .await;
    let runs = h.gh.list_check_runs(&repo(), "abc").await.unwrap();
    assert!(runs[0].is_success());
    assert_eq!(runs[1].status, CheckStatus::InProgress);
    assert!(!runs[1].is_success());
}

#[tokio::test]
async fn artifact_download_follows_redirect() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/actions/runs/9001/artifacts"))
        .and(query_param("name", "screenshots"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "total_count": 2,
            "artifacts": [
                { "id": 76, "name": "screenshots", "expired": true },
                { "id": 77, "name": "screenshots", "expired": false }
            ]
        })))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/actions/artifacts/77/zip"))
        .respond_with(ResponseTemplate::new(302).insert_header(
            "location",
            format!("{}/blobstore/art-77.zip?sig=abc", h.server.uri()),
        ))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/blobstore/art-77.zip"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"PK\x03\x04zipbytes".to_vec()))
        .mount(&h.server)
        .await;
    let bytes =
        h.gh.download_artifact(&repo(), 9001, "screenshots")
            .await
            .unwrap();
    assert_eq!(bytes, b"PK\x03\x04zipbytes");
}

// ---- repos / pages --------------------------------------------------------

#[tokio::test]
async fn create_repo_from_template_posts_generate() {
    let h = harness().await;
    Mock::given(method("POST"))
        .and(path("/repos/swarmpress/starter/generate"))
        .and(body_partial_json(json!({
            "owner": "players", "name": "acme-news", "private": true, "include_all_branches": false
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "name": "acme-news", "owner": { "login": "players" },
            "default_branch": "main", "private": true,
            "html_url": "https://github.com/players/acme-news"
        })))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&h.server)
        .await;
    Mock::given(method("POST"))
        .and(path("/repos/swarmpress/starter/generate"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "message": "Could not clone: Name already exists on this account"
        })))
        .mount(&h.server)
        .await;
    let nr = NewRepo {
        owner: "players".into(),
        name: "acme-news".into(),
        private: true,
        description: None,
    };
    let info =
        h.gh.create_repo_from_template(&RepoId::new("swarmpress", "starter"), &nr)
            .await
            .unwrap();
    assert_eq!(info.id, RepoId::new("players", "acme-news"));
    assert!(matches!(
        h.gh.create_repo_from_template(&RepoId::new("swarmpress", "starter"), &nr)
            .await,
        Err(GitHubError::AlreadyExists(_))
    ));
}

#[tokio::test]
async fn pages_enable_posts_workflow() {
    let h = harness().await;
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/pages"))
        .and(body_partial_json(json!({ "build_type": "workflow" })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "build_type": "workflow" })))
        .expect(1)
        .mount(&h.server)
        .await;
    h.gh.enable_pages_workflow(&repo()).await.unwrap();
}

#[tokio::test]
async fn pages_enable_409_falls_back_to_put() {
    let h = harness().await;
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/pages"))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "message": "GitHub Pages is already enabled."
        })))
        .expect(1)
        .mount(&h.server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/pages"))
        .and(body_partial_json(json!({ "build_type": "workflow" })))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&h.server)
        .await;
    h.gh.enable_pages_workflow(&repo()).await.unwrap();
}

// ---- rate limits ----------------------------------------------------------

#[tokio::test]
async fn primary_rate_limit_waits_until_reset_then_retries() {
    let h = harness().await;
    let reset_s = T0_MS / 1000 + 30;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", reset_s.to_string().as_str())
                .set_body_json(json!({ "message": "API rate limit exceeded" })),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-ratelimit-remaining", "4999")
                .set_body_json(json!({ "name": "site", "owner": { "login": "acme" }, "default_branch": "main" })),
        )
        .mount(&h.server)
        .await;
    h.gh.get_repo(&repo()).await.unwrap();
    assert_eq!(h.sleeper.sleeps(), vec![Duration::from_secs(31)]);
    assert_eq!(h.clock.now_ms(), T0_MS + 31_000);
    assert_eq!(h.server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn secondary_rate_limit_respects_retry_after() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "7")
                .set_body_json(json!({ "message": "You have exceeded a secondary rate limit" })),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({ "name": "site", "owner": { "login": "acme" }, "default_branch": "main" }),
        ))
        .mount(&h.server)
        .await;
    h.gh.get_repo(&repo()).await.unwrap();
    assert_eq!(h.sleeper.sleeps(), vec![Duration::from_secs(7)]);
}

#[tokio::test]
async fn secondary_limit_without_retry_after_backs_off_exponentially_then_gives_up() {
    let h = harness().await;
    let gh = h.gh.with_max_retries(2);
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "message": "You have exceeded a secondary rate limit. Please wait a few minutes before you try again."
        })))
        .mount(&h.server)
        .await;
    let e = gh.get_repo(&repo()).await.unwrap_err();
    assert!(matches!(e, GitHubError::RateLimited { .. }), "{e}");
    assert_eq!(
        h.sleeper.sleeps(),
        vec![Duration::from_secs(60), Duration::from_secs(120)]
    );
    assert_eq!(h.server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn plain_403_is_forbidden_not_rate_limit() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("x-ratelimit-remaining", "4000")
                .set_body_json(json!({ "message": "Resource not accessible by integration" })),
        )
        .mount(&h.server)
        .await;
    assert!(matches!(
        h.gh.get_repo(&repo()).await,
        Err(GitHubError::Forbidden(_))
    ));
    assert!(h.sleeper.sleeps().is_empty());
}

#[tokio::test]
async fn exhausted_remaining_on_success_blocks_next_call() {
    let h = harness().await;
    let reset_s = T0_MS / 1000 + 10;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("x-ratelimit-remaining", "0")
                .insert_header("x-ratelimit-reset", reset_s.to_string().as_str())
                .set_body_json(json!({ "name": "site", "owner": { "login": "acme" }, "default_branch": "main" })),
        )
        .mount(&h.server)
        .await;
    h.gh.get_repo(&repo()).await.unwrap();
    assert!(h.sleeper.sleeps().is_empty());
    h.gh.get_repo(&repo()).await.unwrap();
    assert_eq!(h.sleeper.sleeps(), vec![Duration::from_secs(11)]);
}

// ---- gateway additions (ADR-0056 decision 8, ADR-0061) ----------------------

fn body_of(req: &Request) -> serde_json::Value {
    serde_json::from_slice(&req.body).unwrap_or(serde_json::Value::Null)
}

#[tokio::test]
async fn put_file_sends_the_author_and_leaves_the_committer_to_the_token() {
    let h = harness().await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/contents/content/pages/blog/x.json"))
        .and(body_partial_json(json!({
            "message": "Draft x\n\nJob: 12",
            "branch": "drafts/content-x",
            "author": { "name": "Giulia Rossi", "email": "staff-1+co-9@staff.swarm.press" }
        })))
        .and(|req: &Request| body_of(req).get("committer").is_none())
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "content": { "sha": "new-blob" },
            "commit": { "sha": "new-commit" }
        })))
        .expect(1)
        .mount(&h.server)
        .await;
    let w =
        h.gh.put_file(
            &repo(),
            &PutFile {
                branch: "drafts/content-x".into(),
                path: "content/pages/blog/x.json".into(),
                content: b"{}\n".to_vec(),
                message: "Draft x\n\nJob: 12".into(),
                expected_sha: None,
                author: Some(CommitAuthor {
                    name: "Giulia Rossi".into(),
                    email: "staff-1+co-9@staff.swarm.press".into(),
                }),
            },
        )
        .await
        .unwrap();
    assert_eq!(w.commit_sha, "new-commit");
}

#[tokio::test]
async fn put_file_without_an_author_sends_neither_identity() {
    let h = harness().await;
    Mock::given(method("PUT"))
        .and(path("/repos/acme/site/contents/content/a.json"))
        .and(|req: &Request| {
            let b = body_of(req);
            b.get("author").is_none() && b.get("committer").is_none()
        })
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "content": { "sha": "b" },
            "commit": { "sha": "c" }
        })))
        .expect(1)
        .mount(&h.server)
        .await;
    h.gh.put_file(
        &repo(),
        &PutFile {
            branch: "drafts/content-x".into(),
            path: "content/a.json".into(),
            content: vec![],
            message: "m".into(),
            expected_sha: None,
            author: None,
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn get_commit_maps_author_and_committer() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/commits/abc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sha": "abc",
            "commit": {
                "message": "Draft x",
                "author": { "name": "Giulia Rossi", "email": "staff-1+co-9@staff.swarm.press", "date": "2026-10-02T09:30:00Z" },
                "committer": { "name": "swarmpress[bot]", "email": "bot@users.noreply.github.com", "date": "2026-10-02T09:30:00Z" }
            },
            "parents": []
        })))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/commits/bare"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sha": "bare",
            "commit": { "message": "m", "author": { "name": null, "email": null } }
        })))
        .mount(&h.server)
        .await;
    let c = h.gh.get_commit(&repo(), "abc").await.unwrap();
    assert_eq!(
        c.author,
        Some(CommitAuthor {
            name: "Giulia Rossi".into(),
            email: "staff-1+co-9@staff.swarm.press".into()
        })
    );
    assert_eq!(c.committer.unwrap().name, "swarmpress[bot]");
    let bare = h.gh.get_commit(&repo(), "bare").await.unwrap();
    assert_eq!((bare.author, bare.committer), (None, None));
}

#[tokio::test]
async fn delete_branch_deletes_the_ref_and_tolerates_a_missing_one() {
    let h = harness().await;
    Mock::given(method("DELETE"))
        .and(path("/repos/acme/site/git/refs/heads/drafts/content-x"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&h.server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/repos/acme/site/git/refs/heads/drafts/gone"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({ "message": "Reference does not exist" })),
        )
        .mount(&h.server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/repos/acme/site/git/refs/heads/drafts/never"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "message": "Not Found" })))
        .mount(&h.server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/repos/acme/site/git/refs/heads/main"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({ "message": "Cannot delete protected branch 'main'" })),
        )
        .mount(&h.server)
        .await;
    assert!(h
        .gh
        .delete_branch(&repo(), "drafts/content-x")
        .await
        .unwrap());
    assert!(!h.gh.delete_branch(&repo(), "drafts/gone").await.unwrap());
    assert!(!h.gh.delete_branch(&repo(), "drafts/never").await.unwrap());
    assert!(matches!(
        h.gh.delete_branch(&repo(), "main").await,
        Err(GitHubError::Validation(_))
    ));
}

#[tokio::test]
async fn merge_branch_posts_to_the_merges_api() {
    let h = harness().await;
    let merge_sha = "a".repeat(40);
    // 201: a merge commit was created on the base.
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/merges"))
        .and(body_partial_json(json!({
            "base": "drafts/content-x",
            "head": "main",
            "commit_message": "Merge main into drafts/content-x"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "sha": merge_sha,
            "commit": { "message": "Merge main into drafts/content-x" },
            "parents": [{ "sha": "p1" }, { "sha": "p2" }]
        })))
        .expect(1)
        .mount(&h.server)
        .await;
    // 204: the base already contains the head.
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/merges"))
        .and(body_partial_json(json!({ "base": "drafts/up-to-date" })))
        .respond_with(ResponseTemplate::new(204))
        .mount(&h.server)
        .await;
    // 409: merge conflict.
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/merges"))
        .and(body_partial_json(json!({ "base": "drafts/conflicting" })))
        .respond_with(
            ResponseTemplate::new(409).set_body_json(json!({ "message": "Merge conflict" })),
        )
        .mount(&h.server)
        .await;
    // 404: the base (or the head) does not exist.
    Mock::given(method("POST"))
        .and(path("/repos/acme/site/merges"))
        .and(body_partial_json(json!({ "base": "drafts/gone" })))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "message": "Base does not exist" })),
        )
        .mount(&h.server)
        .await;

    let site = repo();
    let merge = |base: &'static str| h.gh.merge_branch(&site, base, "main", "m");
    assert_eq!(
        h.gh.merge_branch(
            &repo(),
            "drafts/content-x",
            "main",
            "Merge main into drafts/content-x"
        )
        .await
        .unwrap(),
        Some(merge_sha)
    );
    assert_eq!(merge("drafts/up-to-date").await.unwrap(), None);
    let e = merge("drafts/conflicting").await.unwrap_err();
    assert!(e.is_conflict(), "{e}");
    assert!(e.to_string().contains("Merge conflict"), "{e}");
    assert!(merge("drafts/gone").await.unwrap_err().is_not_found());
}
