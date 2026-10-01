//! PathPolicy rules and GuardedRepo enforcement.

use std::sync::Arc;

use github::policy::{is_protected, normalize_path};
use github::*;

const CONTENT: ActorKind = ActorKind::ContentAgent;
const DESIGN: ActorKind = ActorKind::DesignAgent;
const BOT: ActorKind = ActorKind::PlatformBot;

fn allowed(actor: ActorKind, path: &str) -> bool {
    PathPolicy::default().check_write(actor, path).is_ok()
}

#[test]
fn content_agents_write_only_content() {
    assert!(allowed(CONTENT, "content/pages/en/riomaggiore.json"));
    assert!(allowed(CONTENT, "content/collections/hikes/manarola.json"));
    assert!(!allowed(CONTENT, "theme/tokens.json"));
    assert!(!allowed(CONTENT, "README.md"));
    assert!(
        !allowed(CONTENT, "content"),
        "the root itself is not a file under it"
    );
    assert!(
        !allowed(CONTENT, "contentx/a.json"),
        "prefix match must be on a segment"
    );
}

#[test]
fn design_agents_write_only_theme() {
    assert!(allowed(DESIGN, "theme/blocks/x-map/Component.astro"));
    assert!(allowed(DESIGN, "theme/tokens.json"));
    assert!(!allowed(DESIGN, "content/pages/en/index.json"));
    assert!(!allowed(DESIGN, "themes/a.css"));
}

#[test]
fn protected_files_are_bot_only_at_any_depth() {
    for p in [
        ".github/workflows/deploy.yml",
        ".github/workflows/site-ci.yml",
        "package.json",
        "pnpm-lock.yaml",
        "site.manifest.json",
        "theme/package.json",
        "theme/pnpm-lock.yaml",
        "theme/.github/x.yml",
        "content/site.manifest.json",
        ".GitHub/workflows/deploy.yml",
        "theme/Package.JSON",
    ] {
        assert!(is_protected(p), "{p} should be protected");
        assert!(!allowed(CONTENT, p), "content agent wrote {p}");
        assert!(!allowed(DESIGN, p), "design agent wrote {p}");
        assert!(allowed(BOT, p), "bot must be able to write {p}");
    }
    assert!(!is_protected("theme/package.json.bak"));
    assert!(!is_protected("content/pages/github.json"));
}

#[test]
fn traversal_and_malformed_paths_rejected() {
    for p in [
        "content/../.github/workflows/deploy.yml",
        "content/./a.json",
        "/content/a.json",
        "content//a.json",
        "content\\a.json",
        "",
        "content/a\0.json",
    ] {
        assert!(normalize_path(p).is_err(), "{p:?} should be rejected");
        assert!(!allowed(CONTENT, p));
        assert!(!allowed(BOT, p), "even the bot cannot use {p:?}");
    }
    assert_eq!(normalize_path("content/a/").unwrap(), "content/a");
}

#[test]
fn branch_prefixes_per_actor() {
    let p = PathPolicy::default();
    assert!(p.check_branch(CONTENT, "drafts/content-42").is_ok());
    assert!(p.check_branch(CONTENT, "main").is_err());
    assert!(p.check_branch(CONTENT, "design/x").is_err());
    assert!(p.check_branch(CONTENT, "drafts/").is_err());
    assert!(p.check_branch(DESIGN, "design/spring").is_ok());
    assert!(p.check_branch(DESIGN, "drafts/content-1").is_err());
    assert!(p.check_branch(BOT, "main").is_ok());
    assert!(p.check_branch(BOT, "bad..ref").is_err());
}

#[test]
fn custom_policy_roots() {
    let p = PathPolicy {
        content_roots: vec!["content".into(), "data".into()],
        ..PathPolicy::default()
    };
    assert!(p.check_write(CONTENT, "data/x.json").is_ok());
}

fn setup() -> (Arc<FakeGitHub>, RepoId) {
    let f = Arc::new(FakeGitHub::new());
    let r = RepoId::new("acme", "site");
    f.create_repo(&r, &[("content/a.json", "{}"), ("package.json", "{}")]);
    (f, r)
}

fn put(branch: &str, path: &str) -> PutFile {
    PutFile {
        branch: branch.into(),
        path: path.into(),
        content: b"x".to_vec(),
        message: "m".into(),
        expected_sha: None,
    }
}

#[tokio::test]
async fn guarded_repo_blocks_before_reaching_github() {
    let (f, r) = setup();
    let g = GuardedRepo::new(f.clone(), CONTENT);
    f.clear_calls();

    for (branch, path) in [
        ("drafts/content-1", ".github/workflows/deploy.yml"),
        ("drafts/content-1", "theme/x.css"),
        ("main", "content/b.json"),
        ("drafts/content-1", "content/../package.json"),
    ] {
        let e = g.put_file(&r, &put(branch, path)).await.unwrap_err();
        assert!(
            matches!(
                e,
                GitHubError::PolicyDenied { .. } | GitHubError::InvalidArgument(_)
            ),
            "{branch} {path}: {e}"
        );
    }
    assert!(matches!(
        g.create_branch(&r, "main2", "main").await,
        Err(GitHubError::PolicyDenied { .. })
    ));
    assert!(matches!(
        g.merge_pr(&r, 1, &MergeOptions::default()).await,
        Err(GitHubError::PolicyDenied { .. })
    ));
    assert!(matches!(
        g.close_pr(&r, 1).await,
        Err(GitHubError::PolicyDenied { .. })
    ));
    assert!(matches!(
        g.enable_pages_workflow(&r).await,
        Err(GitHubError::PolicyDenied { .. })
    ));
    let del = DeleteFile {
        branch: "drafts/content-1".into(),
        path: "package.json".into(),
        message: "m".into(),
        expected_sha: "x".into(),
    };
    assert!(matches!(
        g.delete_file(&r, &del).await,
        Err(GitHubError::PolicyDenied { .. })
    ));
    assert!(
        f.calls().is_empty(),
        "denied calls must not reach the inner API: {:?}",
        f.calls()
    );
}

#[tokio::test]
async fn guarded_repo_allows_in_policy_writes_and_reads() {
    let (f, r) = setup();
    let g = GuardedRepo::new(f.clone(), CONTENT);
    g.create_branch(&r, "drafts/content-1", "main")
        .await
        .unwrap();
    g.put_file(&r, &put("drafts/content-1", "content/b.json"))
        .await
        .unwrap();
    // Reads are unrestricted.
    assert!(g
        .get_file(&r, "main", "package.json")
        .await
        .unwrap()
        .is_some());
    let pr = g
        .create_pr(
            &r,
            &NewPullRequest {
                title: "t".into(),
                head: "drafts/content-1".into(),
                base: "main".into(),
                body: String::new(),
                draft: false,
            },
        )
        .await
        .unwrap();
    g.comment(&r, pr.number, "hi").await.unwrap();

    // The bot may merge.
    let bot = GuardedRepo::new(f.clone(), BOT);
    bot.merge_pr(&r, pr.number, &MergeOptions::default())
        .await
        .unwrap();
    assert_eq!(
        f.file_text(&r, "main", "content/b.json").as_deref(),
        Some("x")
    );

    // Design agent on its own branch.
    let d = GuardedRepo::new(f.clone(), DESIGN);
    d.create_branch(&r, "design/spring", "main").await.unwrap();
    d.put_file(&r, &put("design/spring", "theme/a.css"))
        .await
        .unwrap();
    assert!(d
        .put_file(&r, &put("design/spring", "theme/package.json"))
        .await
        .is_err());
}

#[tokio::test]
async fn guarded_update_pr_cannot_change_state_or_base() {
    let (f, r) = setup();
    let g = GuardedRepo::new(f, CONTENT);
    let e = g
        .update_pr(
            &r,
            1,
            &PullRequestUpdate {
                state: Some(PrState::Closed),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(e, GitHubError::PolicyDenied { .. }));
}
