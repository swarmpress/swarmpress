//! Behavioural tests for `FakeGitHub`: every `RepoApi` operation.

use github::*;

fn repo() -> RepoId {
    RepoId::new("acme", "site")
}

fn fake() -> FakeGitHub {
    let f = FakeGitHub::new();
    f.create_repo(
        &repo(),
        &[
            ("content/pages/en/index.json", "{\"id\":\"home\"}\n"),
            ("theme/tokens.json", "{}\n"),
            ("README.md", "hi\n"),
        ],
    );
    f
}

fn put(branch: &str, path: &str, content: &str, sha: Option<&str>) -> PutFile {
    PutFile {
        branch: branch.into(),
        path: path.into(),
        content: content.as_bytes().to_vec(),
        message: format!("write {path}"),
        expected_sha: sha.map(String::from),
        author: None,
    }
}

fn new_pr(head: &str) -> NewPullRequest {
    NewPullRequest {
        title: format!("PR from {head}"),
        head: head.into(),
        base: "main".into(),
        body: "body".into(),
        draft: false,
    }
}

#[tokio::test]
async fn get_repo_and_missing_repo() {
    let f = fake();
    let info = f.get_repo(&repo()).await.unwrap();
    assert_eq!(info.default_branch, "main");
    assert_eq!(info.html_url, "https://github.com/acme/site");
    assert!(f
        .get_repo(&RepoId::new("acme", "nope"))
        .await
        .unwrap_err()
        .is_not_found());
}

#[tokio::test]
async fn get_file_returns_content_and_git_blob_sha() {
    let f = fake();
    let file = f
        .get_file(&repo(), "main", "README.md")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(file.content, b"hi\n");
    // Same id real git computes for "hi\n".
    assert_eq!(file.sha, "45b983be36b73c0788dc9cbcb76cbb80fc7bb057");
    assert_eq!(file.sha, git_blob_sha(b"hi\n"));
    assert_eq!(
        f.get_file(&repo(), "main", "missing.json").await.unwrap(),
        None
    );
    assert_eq!(
        f.get_file(&repo(), "no-such-ref", "README.md")
            .await
            .unwrap(),
        None
    );
    assert!(matches!(
        f.get_file(&repo(), "main", "content/pages").await,
        Err(GitHubError::InvalidArgument(_))
    ));
}

#[tokio::test]
async fn list_dir_shows_files_and_subdirs_sorted() {
    let f = fake();
    let root = f.list_dir(&repo(), "main", "").await.unwrap();
    let names: Vec<_> = root.iter().map(|e| (e.name.as_str(), e.kind)).collect();
    assert_eq!(
        names,
        vec![
            ("README.md", EntryKind::File),
            ("content", EntryKind::Dir),
            ("theme", EntryKind::Dir)
        ]
    );
    let pages = f
        .list_dir(&repo(), "main", "content/pages/en")
        .await
        .unwrap();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].path, "content/pages/en/index.json");
    assert!(f
        .list_dir(&repo(), "main", "nope")
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn branches_create_get_and_duplicate() {
    let f = fake();
    assert_eq!(f.get_branch(&repo(), "drafts/x").await.unwrap(), None);
    let main = f.get_branch(&repo(), "main").await.unwrap().unwrap();
    let b = f.create_branch(&repo(), "drafts/x", "main").await.unwrap();
    assert_eq!(b.sha, main.sha);
    assert!(matches!(
        f.create_branch(&repo(), "drafts/x", "main").await,
        Err(GitHubError::AlreadyExists(_))
    ));
    // From a sha works too.
    f.create_branch(&repo(), "from-sha", &main.sha)
        .await
        .unwrap();
    assert!(f
        .create_branch(&repo(), "y", "no-such")
        .await
        .unwrap_err()
        .is_not_found());
    assert!(matches!(
        f.create_branch(&repo(), "bad..name", "main").await,
        Err(GitHubError::InvalidArgument(_))
    ));
}

#[tokio::test]
async fn put_file_create_update_and_optimistic_concurrency() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();

    // Create-only.
    let w = f
        .put_file(&repo(), &put("drafts/a", "content/new.json", "1", None))
        .await
        .unwrap();
    let sha1 = w.content_sha.clone().unwrap();
    assert_eq!(f.branch_head(&repo(), "drafts/a").unwrap(), w.commit_sha);

    // Create-only again: conflict.
    let e = f
        .put_file(&repo(), &put("drafts/a", "content/new.json", "2", None))
        .await
        .unwrap_err();
    assert!(e.is_conflict(), "{e}");

    // Stale sha: conflict.
    let e = f
        .put_file(
            &repo(),
            &put(
                "drafts/a",
                "content/new.json",
                "2",
                Some(&git_blob_sha(b"0")),
            ),
        )
        .await
        .unwrap_err();
    assert!(e.is_conflict());

    // Correct sha: ok.
    f.put_file(
        &repo(),
        &put("drafts/a", "content/new.json", "2", Some(&sha1)),
    )
    .await
    .unwrap();
    assert_eq!(
        f.file_text(&repo(), "drafts/a", "content/new.json")
            .as_deref(),
        Some("2")
    );
    // main untouched.
    assert_eq!(f.file_text(&repo(), "main", "content/new.json"), None);

    // Missing branch.
    assert!(f
        .put_file(&repo(), &put("nope", "content/x.json", "1", None))
        .await
        .unwrap_err()
        .is_not_found());
}

#[tokio::test]
async fn delete_file_checks_sha() {
    let f = fake();
    let cur = f
        .get_file(&repo(), "main", "README.md")
        .await
        .unwrap()
        .unwrap();
    let bad = DeleteFile {
        branch: "main".into(),
        path: "README.md".into(),
        message: "rm".into(),
        expected_sha: git_blob_sha(b"other"),
    };
    assert!(f
        .delete_file(&repo(), &bad)
        .await
        .unwrap_err()
        .is_conflict());
    let good = DeleteFile {
        expected_sha: cur.sha,
        ..bad.clone()
    };
    let w = f.delete_file(&repo(), &good).await.unwrap();
    assert_eq!(w.content_sha, None);
    assert_eq!(
        f.get_file(&repo(), "main", "README.md").await.unwrap(),
        None
    );
    assert!(f
        .delete_file(&repo(), &good)
        .await
        .unwrap_err()
        .is_not_found());
}

#[tokio::test]
async fn get_commit_lists_changed_files() {
    let f = fake();
    let main = f.branch_head(&repo(), "main").unwrap();
    let root = f.get_commit(&repo(), &main).await.unwrap();
    assert!(root.parents.is_empty());
    assert_eq!(root.files.len(), 3);
    assert!(root.files.iter().all(|c| c.status == FileStatus::Added));

    let readme = f
        .get_file(&repo(), "main", "README.md")
        .await
        .unwrap()
        .unwrap();
    let w = f
        .put_file(
            &repo(),
            &put("main", "README.md", "hello\n", Some(&readme.sha)),
        )
        .await
        .unwrap();
    let c = f.get_commit(&repo(), &w.commit_sha).await.unwrap();
    assert_eq!(c.parents, vec![main]);
    assert_eq!(c.message, "write README.md");
    assert_eq!(
        c.files,
        vec![ChangedFile {
            path: "README.md".into(),
            status: FileStatus::Modified,
            previous_path: None
        }]
    );
}

#[tokio::test]
async fn pr_lifecycle_create_find_update_comment_label_close() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();

    // No commits yet → GitHub refuses.
    assert!(matches!(
        f.create_pr(&repo(), &new_pr("drafts/a")).await,
        Err(GitHubError::Validation(_))
    ));

    let w = f
        .put_file(&repo(), &put("drafts/a", "content/a.json", "{}", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    assert_eq!(pr.number, 1);
    assert_eq!(pr.state, PrState::Open);
    assert_eq!(pr.head_sha, w.commit_sha);
    assert_eq!(pr.mergeable, Some(true));
    assert_eq!(pr.mergeable_state, "clean");
    assert_eq!(pr.html_url, "https://github.com/acme/site/pull/1");

    // Duplicate open PR for the same head.
    assert!(matches!(
        f.create_pr(&repo(), &new_pr("drafts/a")).await,
        Err(GitHubError::AlreadyExists(_))
    ));

    let found = f.find_open_pr(&repo(), "drafts/a").await.unwrap().unwrap();
    assert_eq!(found.number, 1);
    assert_eq!(f.find_open_pr(&repo(), "drafts/b").await.unwrap(), None);

    let upd = f
        .update_pr(
            &repo(),
            1,
            &PullRequestUpdate {
                title: Some("New title".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(upd.title, "New title");

    let c1 = f.comment(&repo(), 1, "looks good").await.unwrap();
    let c2 = f.comment(&repo(), 1, "ship it").await.unwrap();
    assert!(c2 > c1);
    assert_eq!(f.comments(&repo(), 1), vec!["looks good", "ship it"]);
    assert!(f
        .comment(&repo(), 99, "x")
        .await
        .unwrap_err()
        .is_not_found());

    f.add_labels(&repo(), 1, &["content".into(), "seo".into()])
        .await
        .unwrap();
    f.add_labels(&repo(), 1, &["content".into()]).await.unwrap();
    assert_eq!(
        f.get_pr(&repo(), 1).await.unwrap().labels,
        vec!["content", "seo"]
    );

    let closed = f.close_pr(&repo(), 1).await.unwrap();
    assert_eq!(closed.state, PrState::Closed);
    assert!(!closed.merged);
    assert_eq!(f.find_open_pr(&repo(), "drafts/a").await.unwrap(), None);
    assert!(matches!(
        f.merge_pr(&repo(), 1, &MergeOptions::default()).await,
        Err(GitHubError::NotMergeable(_))
    ));
    assert!(f.get_pr(&repo(), 42).await.unwrap_err().is_not_found());
}

#[tokio::test]
async fn squash_merge_applies_changes_onto_moved_base() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    f.put_file(&repo(), &put("drafts/a", "content/a.json", "A", None))
        .await
        .unwrap();
    f.put_file(&repo(), &put("drafts/a", "content/b.json", "B", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();

    // main moves independently (different file) — still mergeable.
    f.put_file(&repo(), &put("main", "content/other.json", "O", None))
        .await
        .unwrap();
    let main_before = f.branch_head(&repo(), "main").unwrap();
    let pr = f.get_pr(&repo(), pr.number).await.unwrap();
    assert_eq!(pr.mergeable, Some(true));

    // Wrong expected head sha → conflict, nothing merged.
    let e = f
        .merge_pr(
            &repo(),
            pr.number,
            &MergeOptions {
                expected_head_sha: Some(main_before.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(e.is_conflict());

    let m = f
        .merge_pr(
            &repo(),
            pr.number,
            &MergeOptions {
                expected_head_sha: Some(pr.head_sha.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(f.branch_head(&repo(), "main").unwrap(), m.sha);
    let c = f.get_commit(&repo(), &m.sha).await.unwrap();
    assert_eq!(c.parents, vec![main_before], "squash = single parent");
    assert_eq!(c.message, format!("{} (#1)", pr.title));
    let changed: Vec<_> = c.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(changed, vec!["content/a.json", "content/b.json"]);
    assert_eq!(
        f.file_text(&repo(), "main", "content/other.json")
            .as_deref(),
        Some("O")
    );
    assert_eq!(
        f.file_text(&repo(), "main", "content/a.json").as_deref(),
        Some("A")
    );

    let merged = f.get_pr(&repo(), pr.number).await.unwrap();
    assert!(merged.merged);
    assert_eq!(merged.state, PrState::Closed);
    assert_eq!(merged.merge_commit_sha, Some(m.sha));
    // Merging twice fails.
    assert!(matches!(
        f.merge_pr(&repo(), pr.number, &MergeOptions::default())
            .await,
        Err(GitHubError::NotMergeable(_))
    ));
}

#[tokio::test]
async fn conflicting_change_on_base_makes_pr_dirty() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    let readme = f
        .get_file(&repo(), "main", "README.md")
        .await
        .unwrap()
        .unwrap();
    f.put_file(
        &repo(),
        &put("drafts/a", "README.md", "branch\n", Some(&readme.sha)),
    )
    .await
    .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    f.put_file(
        &repo(),
        &put("main", "README.md", "main\n", Some(&readme.sha)),
    )
    .await
    .unwrap();
    let pr = f.get_pr(&repo(), pr.number).await.unwrap();
    assert_eq!(pr.mergeable, Some(false));
    assert_eq!(pr.mergeable_state, "dirty");
    assert!(matches!(
        f.merge_pr(&repo(), pr.number, &MergeOptions::default())
            .await,
        Err(GitHubError::NotMergeable(_))
    ));
}

#[tokio::test]
async fn required_checks_gate_merge_and_check_runs_are_listed() {
    let f = fake();
    f.set_required_checks(&repo(), &["site-ci"]);
    f.create_branch(&repo(), "design/x", "main").await.unwrap();
    f.put_file(&repo(), &put("design/x", "theme/a.css", "a{}", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("design/x")).await.unwrap();
    assert_eq!(pr.mergeable_state, "blocked");
    assert!(matches!(
        f.merge_pr(&repo(), pr.number, &MergeOptions::default())
            .await,
        Err(GitHubError::NotMergeable(_))
    ));

    let id = f.add_check_run(
        &repo(),
        &pr.head_sha,
        "site-ci",
        CheckStatus::InProgress,
        None,
    );
    f.add_check_run(
        &repo(),
        &pr.head_sha,
        "lighthouse",
        CheckStatus::Completed,
        Some(CheckConclusion::Failure),
    );
    let runs = f.list_check_runs(&repo(), &pr.head_sha).await.unwrap();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].id, id);
    assert!(f.list_check_runs(&repo(), "0000").await.unwrap().is_empty());

    // Upsert completes the same run.
    let same = f.add_check_run(
        &repo(),
        &pr.head_sha,
        "site-ci",
        CheckStatus::Completed,
        Some(CheckConclusion::Success),
    );
    assert_eq!(same, id);
    let pr2 = f.get_pr(&repo(), pr.number).await.unwrap();
    // Required check passes; a non-required one failed → unstable but mergeable.
    assert_eq!(pr2.mergeable_state, "unstable");
    f.merge_pr(&repo(), pr.number, &MergeOptions::default())
        .await
        .unwrap();
}

#[tokio::test]
async fn mergeable_override_simulates_computing_and_blocked() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    f.put_file(&repo(), &put("drafts/a", "content/a.json", "A", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    f.set_mergeable(&repo(), pr.number, Some(None));
    let v = f.get_pr(&repo(), pr.number).await.unwrap();
    assert_eq!(v.mergeable, None);
    assert_eq!(v.mergeable_state, "unknown");
    f.set_mergeable(&repo(), pr.number, Some(Some(false)));
    assert!(matches!(
        f.merge_pr(&repo(), pr.number, &MergeOptions::default())
            .await,
        Err(GitHubError::NotMergeable(_))
    ));
    f.set_mergeable(&repo(), pr.number, None);
    f.merge_pr(&repo(), pr.number, &MergeOptions::default())
        .await
        .unwrap();
}

#[tokio::test]
async fn merge_commit_method_has_two_parents() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    let w = f
        .put_file(&repo(), &put("drafts/a", "content/a.json", "A", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    let m = f
        .merge_pr(
            &repo(),
            pr.number,
            &MergeOptions {
                method: MergeMethod::Merge,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let c = f.get_commit(&repo(), &m.sha).await.unwrap();
    assert_eq!(c.parents.len(), 2);
    assert_eq!(c.parents[1], w.commit_sha);
}

#[tokio::test]
async fn revert_helper_opens_pr_that_undoes_squash() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    let readme = f
        .get_file(&repo(), "main", "README.md")
        .await
        .unwrap()
        .unwrap();
    f.put_file(&repo(), &put("drafts/a", "content/new.json", "N", None))
        .await
        .unwrap();
    f.put_file(
        &repo(),
        &put("drafts/a", "README.md", "changed\n", Some(&readme.sha)),
    )
    .await
    .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    let m = f
        .merge_pr(&repo(), pr.number, &MergeOptions::default())
        .await
        .unwrap();

    let rpr = open_revert_pr(&f, &repo(), &m.sha, "main").await.unwrap();
    assert_eq!(rpr.head_ref, github::revert::revert_branch_name(&m.sha));
    assert!(rpr.title.starts_with("Revert \""));
    // Idempotent: same PR comes back.
    let again = open_revert_pr(&f, &repo(), &m.sha, "main").await.unwrap();
    assert_eq!(again.number, rpr.number);

    f.merge_pr(&repo(), rpr.number, &MergeOptions::default())
        .await
        .unwrap();
    assert_eq!(
        f.file_text(&repo(), "main", "README.md").as_deref(),
        Some("hi\n")
    );
    assert_eq!(f.file_text(&repo(), "main", "content/new.json"), None);
}

#[tokio::test]
async fn revert_refuses_when_base_changed_since() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    f.put_file(&repo(), &put("drafts/a", "content/new.json", "N", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    let m = f
        .merge_pr(&repo(), pr.number, &MergeOptions::default())
        .await
        .unwrap();
    let cur = f
        .get_file(&repo(), "main", "content/new.json")
        .await
        .unwrap()
        .unwrap();
    f.put_file(
        &repo(),
        &put("main", "content/new.json", "later", Some(&cur.sha)),
    )
    .await
    .unwrap();
    assert!(open_revert_pr(&f, &repo(), &m.sha, "main")
        .await
        .unwrap_err()
        .is_conflict());
}

#[tokio::test]
async fn artifacts_download() {
    let f = fake();
    f.add_artifact(&repo(), 9001, "screenshots", b"PK\x03\x04zip".to_vec());
    assert_eq!(
        f.download_artifact(&repo(), 9001, "screenshots")
            .await
            .unwrap(),
        b"PK\x03\x04zip"
    );
    assert!(f
        .download_artifact(&repo(), 9001, "dist")
        .await
        .unwrap_err()
        .is_not_found());
}

#[tokio::test]
async fn template_and_pages() {
    let f = FakeGitHub::new();
    let tpl = RepoId::new("swarmpress", "starter");
    f.create_template_repo(
        &tpl,
        &[
            ("theme/index.astro", "<html/>"),
            ("content/site.json", "{}"),
        ],
    );
    let not_tpl = RepoId::new("swarmpress", "plain");
    f.create_repo(&not_tpl, &[]);

    let nr = NewRepo {
        owner: "players".into(),
        name: "acme-news".into(),
        private: true,
        description: Some("Acme".into()),
    };
    let info = f.create_repo_from_template(&tpl, &nr).await.unwrap();
    assert_eq!(info.id, RepoId::new("players", "acme-news"));
    assert!(info.private);
    assert_eq!(
        f.file_text(&info.id, "main", "theme/index.astro")
            .as_deref(),
        Some("<html/>")
    );
    assert!(matches!(
        f.create_repo_from_template(&tpl, &nr).await,
        Err(GitHubError::AlreadyExists(_))
    ));
    assert!(matches!(
        f.create_repo_from_template(
            &not_tpl,
            &NewRepo {
                name: "x".into(),
                ..nr.clone()
            }
        )
        .await,
        Err(GitHubError::Validation(_))
    ));

    assert_eq!(f.pages_build_type(&info.id), None);
    f.enable_pages_workflow(&info.id).await.unwrap();
    f.enable_pages_workflow(&info.id).await.unwrap();
    assert_eq!(f.pages_build_type(&info.id).as_deref(), Some("workflow"));
}

#[tokio::test]
async fn deterministic_ids_across_instances() {
    async fn script() -> (String, u64) {
        let f = fake();
        f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
        let w = f
            .put_file(&repo(), &put("drafts/a", "content/a.json", "A", None))
            .await
            .unwrap();
        let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
        (w.commit_sha, pr.number)
    }
    assert_eq!(script().await, script().await);
}

#[tokio::test]
async fn injected_failures_and_call_log() {
    let f = fake();
    f.fail_next("get_repo", GitHubError::Transport("boom".into()));
    assert!(matches!(
        f.get_repo(&repo()).await,
        Err(GitHubError::Transport(_))
    ));
    f.get_repo(&repo()).await.unwrap();
    assert_eq!(f.calls(), vec!["get_repo", "get_repo"]);
}

// ---- gateway additions (ADR-0056 decision 8, ADR-0061) ----------------------

fn giulia() -> CommitAuthor {
    CommitAuthor {
        name: "Giulia Rossi".into(),
        email: "staff-1@staff.swarm.press".into(),
    }
}

#[tokio::test]
async fn commits_record_the_author_and_the_platform_commits() {
    let f = fake();
    let platform = FakeGitHub::platform_identity();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    let attributed = f
        .put_file(
            &repo(),
            &PutFile {
                author: Some(giulia()),
                ..put("drafts/a", "content/a.json", "A", None)
            },
        )
        .await
        .unwrap();
    let c = f.get_commit(&repo(), &attributed.commit_sha).await.unwrap();
    assert_eq!(c.author, Some(giulia()));
    assert_eq!(c.committer, Some(platform.clone()));

    // Without an author the platform is both.
    let plain = f
        .put_file(&repo(), &put("drafts/a", "content/b.json", "B", None))
        .await
        .unwrap();
    let c = f.get_commit(&repo(), &plain.commit_sha).await.unwrap();
    assert_eq!(c.author, Some(platform.clone()));
    assert_eq!(c.committer, Some(platform.clone()));

    // A squash merge has no author of its own: the merge API takes none.
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();
    let trailer = "Co-authored-by: Giulia Rossi <staff-1@staff.swarm.press>";
    let merged = f
        .merge_pr(
            &repo(),
            pr.number,
            &MergeOptions {
                commit_message: Some(trailer.into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let c = f.get_commit(&repo(), &merged.sha).await.unwrap();
    assert_eq!(c.author, Some(platform));
    assert!(
        c.message.ends_with(&format!("\n\n{trailer}")),
        "{}",
        c.message
    );
}

#[tokio::test]
async fn the_author_is_not_part_of_the_fake_sha() {
    async fn script(author: Option<CommitAuthor>) -> String {
        let f = fake();
        f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
        f.put_file(
            &repo(),
            &PutFile {
                author,
                ..put("drafts/a", "content/a.json", "A", None)
            },
        )
        .await
        .unwrap()
        .commit_sha
    }
    assert_eq!(script(None).await, script(Some(giulia())).await);
}

#[tokio::test]
async fn delete_branch_closes_its_open_pull_request() {
    let f = fake();
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
    let w = f
        .put_file(&repo(), &put("drafts/a", "content/a.json", "A", None))
        .await
        .unwrap();
    let pr = f.create_pr(&repo(), &new_pr("drafts/a")).await.unwrap();

    assert!(f.delete_branch(&repo(), "drafts/a").await.unwrap());
    assert!(f.get_branch(&repo(), "drafts/a").await.unwrap().is_none());
    let closed = f.get_pr(&repo(), pr.number).await.unwrap();
    assert_eq!((closed.state, closed.merged), (PrState::Closed, false));
    assert_eq!(closed.head_sha, w.commit_sha, "the head is frozen");
    assert!(f.find_open_pr(&repo(), "drafts/a").await.unwrap().is_none());

    // Deleting it again, or a branch that never existed, is not an error.
    assert!(!f.delete_branch(&repo(), "drafts/a").await.unwrap());
    assert!(!f.delete_branch(&repo(), "drafts/never").await.unwrap());
    // The default branch stays.
    assert!(matches!(
        f.delete_branch(&repo(), "main").await,
        Err(GitHubError::Validation(_))
    ));
    assert!(f.get_branch(&repo(), "main").await.unwrap().is_some());
    // The name can be used again.
    f.create_branch(&repo(), "drafts/a", "main").await.unwrap();
}
