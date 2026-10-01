//! ContentRepo semantics and idempotency against FakeGitHub.

use std::sync::Arc;

use github::*;
use serde_json::json;

const PAGE_PATH: &str = "content/pages/blog/last-light.json";

fn setup() -> (Arc<FakeGitHub>, RepoId) {
    let f = Arc::new(FakeGitHub::new());
    let r = RepoId::new("simpress-sites", "cinqueterre-travel");
    f.create_repo(
        &r,
        &[
            (
                "content/pages/en/index.json",
                "{\n  \"id\": \"home\",\n  \"title\": {\"en\": \"Home\"}\n}\n",
            ),
            ("theme/tokens.json", "{}\n"),
        ],
    );
    (f, r)
}

/// Agents write through the policy guard; the orchestrator merges as bot.
fn content_repo(f: &Arc<FakeGitHub>, r: &RepoId, actor: ActorKind) -> ContentRepo {
    ContentRepo::new(
        Arc::new(GuardedRepo::new(f.clone(), actor)),
        r.clone(),
        "main",
    )
}

fn page(title: &str) -> serde_json::Value {
    json!({
        "id": "last-light",
        "slug": { "en": "/en/blog/last-light" },
        "title": { "en": title },
        "page_type": "blog-article",
        "body": [{ "type": "paragraph", "markdown": "Sunset over Manarola." }]
    })
}

#[tokio::test]
async fn read_page_on_base_and_missing() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    let v = c.read_page("content/pages/en/index.json").await.unwrap();
    assert_eq!(v["title"]["en"], "Home");
    assert!(c
        .read_page("content/pages/en/nope.json")
        .await
        .unwrap_err()
        .is_not_found());
    let at = c
        .read_page_at("main", "content/pages/en/index.json")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(at.sha.len(), 40);
}

#[tokio::test]
async fn read_page_rejects_non_json() {
    let (f, r) = setup();
    f.put_file(
        &r,
        &PutFile {
            branch: "main".into(),
            path: "content/bad.json".into(),
            content: b"not json".to_vec(),
            message: "m".into(),
            expected_sha: None,
        },
    )
    .await
    .unwrap();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    assert!(matches!(
        c.read_page("content/bad.json").await,
        Err(GitHubError::Decode(_))
    ));
}

#[tokio::test]
async fn open_draft_creates_branch_commit_and_pr() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    let d = c
        .open_draft(
            "last-light",
            PAGE_PATH,
            &page("Last light"),
            "Last light on Sentiero Azzurro\n\nby Isabella",
        )
        .await
        .unwrap();
    assert_eq!(d.branch, "drafts/content-last-light");
    assert!(d.created_branch && d.created_pr);
    assert_eq!(d.pr.base_ref, "main");
    assert_eq!(d.pr.head_ref, "drafts/content-last-light");
    assert_eq!(d.pr.title, "Last light on Sentiero Azzurro");
    assert_eq!(Some(d.pr.head_sha.clone()), d.commit_sha);

    let text = f.file_text(&r, &d.branch, PAGE_PATH).unwrap();
    assert!(
        text.ends_with("}\n"),
        "canonical pretty JSON with trailing newline"
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap(),
        page("Last light")
    );
    // Draft is not on main until merged.
    assert_eq!(f.file_text(&r, "main", PAGE_PATH), None);
}

#[tokio::test]
async fn open_draft_is_idempotent() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    let first = c
        .open_draft("last-light", PAGE_PATH, &page("Last light"), "Draft")
        .await
        .unwrap();
    let head = f.branch_head(&r, &first.branch).unwrap();
    f.clear_calls();

    let second = c
        .open_draft("last-light", PAGE_PATH, &page("Last light"), "Draft")
        .await
        .unwrap();
    assert!(!second.created_branch && !second.created_pr);
    assert_eq!(second.commit_sha, None, "unchanged content → no commit");
    assert_eq!(second.pr.number, first.pr.number);
    assert_eq!(f.branch_head(&r, &first.branch).unwrap(), head);
    let calls = f.calls();
    assert!(
        !calls
            .iter()
            .any(|c| c == "put_file" || c == "create_pr" || c == "create_branch"),
        "retry must not write: {calls:?}"
    );
    assert_eq!(f.pr_numbers(&r), vec![first.pr.number]);
}

#[tokio::test]
async fn open_draft_revision_commits_on_same_branch_and_pr() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    let first = c
        .open_draft("last-light", PAGE_PATH, &page("v1"), "Draft")
        .await
        .unwrap();
    let rev = c
        .open_draft("last-light", PAGE_PATH, &page("v2"), "Revise per editor")
        .await
        .unwrap();
    assert_eq!(rev.pr.number, first.pr.number);
    assert!(rev.commit_sha.is_some());
    assert_eq!(
        Some(rev.pr.head_sha.clone()),
        rev.commit_sha,
        "PR view refreshed"
    );
    assert_ne!(rev.pr.head_sha, first.pr.head_sha);
    let v = c
        .read_page_at(&rev.branch, PAGE_PATH)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(v.value["title"]["en"], "v2");
}

#[tokio::test]
async fn open_draft_recovers_from_concurrent_write_conflict() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    c.open_draft("x1", "content/pages/blog/x1.json", &page("v1"), "Draft")
        .await
        .unwrap();
    f.fail_next(
        "put_file",
        GitHubError::Conflict("someone else wrote".into()),
    );
    let d = c
        .open_draft("x1", "content/pages/blog/x1.json", &page("v2"), "Draft")
        .await
        .unwrap();
    assert!(d.commit_sha.is_some());
}

#[tokio::test]
async fn open_draft_reuses_branch_after_partial_failure() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    // Crash between commit and PR creation.
    f.fail_next(
        "create_pr",
        GitHubError::Transport("connection reset".into()),
    );
    assert!(c
        .open_draft("x2", "content/pages/blog/x2.json", &page("v1"), "Draft")
        .await
        .is_err());
    let d = c
        .open_draft("x2", "content/pages/blog/x2.json", &page("v1"), "Draft")
        .await
        .unwrap();
    assert!(!d.created_branch);
    assert!(d.created_pr);
    assert_eq!(d.commit_sha, None);
}

#[tokio::test]
async fn open_draft_validates_inputs_and_policy() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::ContentAgent);
    assert!(matches!(
        c.open_draft("../evil", PAGE_PATH, &page("x"), "m").await,
        Err(GitHubError::InvalidArgument(_))
    ));
    assert!(matches!(
        c.open_draft("ok", "theme/a.json", &page("x"), "m").await,
        Err(GitHubError::PolicyDenied { .. })
    ));
    assert!(matches!(
        c.open_draft("ok", ".github/workflows/deploy.yml", &page("x"), "m")
            .await,
        Err(GitHubError::PolicyDenied { .. })
    ));
}

#[tokio::test]
async fn merge_draft_squashes_checks_head_and_is_idempotent() {
    let (f, r) = setup();
    let writer = content_repo(&f, &r, ActorKind::ContentAgent);
    let d = writer
        .open_draft("last-light", PAGE_PATH, &page("Last light"), "Last light")
        .await
        .unwrap();

    // Agents cannot merge.
    assert!(matches!(
        writer.merge_draft(d.pr.number, &d.pr.head_sha).await,
        Err(GitHubError::PolicyDenied { .. })
    ));

    let orchestrator = content_repo(&f, &r, ActorKind::PlatformBot);
    // A revision lands after review → stale sha refused.
    let reviewed = d.pr.head_sha.clone();
    writer
        .open_draft("last-light", PAGE_PATH, &page("Sneaky edit"), "Edit")
        .await
        .unwrap();
    assert!(orchestrator
        .merge_draft(d.pr.number, &reviewed)
        .await
        .unwrap_err()
        .is_conflict());

    let head = f.get_pr(&r, d.pr.number).await.unwrap().head_sha;
    let m = orchestrator.merge_draft(d.pr.number, &head).await.unwrap();
    assert_eq!(f.branch_head(&r, "main").unwrap(), m.sha);
    let commit = f.get_commit(&r, &m.sha).await.unwrap();
    assert_eq!(commit.parents.len(), 1);
    assert_eq!(commit.message, format!("Last light (#{})", d.pr.number));
    assert_eq!(
        orchestrator.read_page(PAGE_PATH).await.unwrap()["title"]["en"],
        "Sneaky edit"
    );

    // Retrying the merge returns the same merge commit.
    let again = orchestrator.merge_draft(d.pr.number, &head).await.unwrap();
    assert_eq!(again, m);
    assert!(orchestrator
        .merge_draft(d.pr.number, &reviewed)
        .await
        .unwrap_err()
        .is_conflict());
}

#[tokio::test]
async fn design_branch_flow_is_idempotent() {
    let (f, r) = setup();
    let c = content_repo(&f, &r, ActorKind::DesignAgent);
    let b1 = c.open_design_branch("spring-refresh").await.unwrap();
    let b2 = c.open_design_branch("spring-refresh").await.unwrap();
    assert_eq!(b1, b2);
    assert_eq!(b1.name, "design/spring-refresh");

    let files = vec![
        (
            "theme/tokens.json".to_string(),
            b"{\"color\":\"#0af\"}\n".to_vec(),
        ),
        ("theme/layouts/Base.astro".to_string(), b"<slot/>".to_vec()),
    ];
    let sha = c
        .commit_design_files("spring-refresh", &files, "Spring palette")
        .await
        .unwrap();
    assert!(sha.is_some());
    assert_eq!(
        c.commit_design_files("spring-refresh", &files, "Spring palette")
            .await
            .unwrap(),
        None
    );
    let pr1 = c
        .open_design_pr("spring-refresh", "Spring refresh", "mood board: ...")
        .await
        .unwrap();
    let pr2 = c
        .open_design_pr("spring-refresh", "Spring refresh", "mood board: ...")
        .await
        .unwrap();
    assert!(pr1.created_pr && !pr2.created_pr);
    assert_eq!(pr1.pr.number, pr2.pr.number);

    // Design agents cannot touch content or platform files.
    let bad = vec![("content/pages/en/index.json".to_string(), b"{}".to_vec())];
    assert!(c
        .commit_design_files("spring-refresh", &bad, "m")
        .await
        .is_err());
    let bad = vec![("theme/package.json".to_string(), b"{}".to_vec())];
    assert!(c
        .commit_design_files("spring-refresh", &bad, "m")
        .await
        .is_err());
}
