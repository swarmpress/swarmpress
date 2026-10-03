//! The gateway's content path against a real repository (increment G2).
//!
//! One scenario, the calls the server's gateway makes, in its order:
//!
//! 1. a scratch base branch from the default branch (so the default branch,
//!    and with it any deploy, never moves);
//! 2. a draft as a content agent (`GuardedRepo` + `PathPolicy`): the draft
//!    branch, a page file with the staff persona as git author and the job
//!    trailers in the message, the pull request; the same draft again
//!    commits nothing;
//! 3. the base moves and the Merges API brings it into the draft branch
//!    (201), then has nothing to do (204); two branches that add one path
//!    differently do not merge (409);
//! 4. the squash merge at the exact head with the provenance trailers and
//!    `Co-authored-by`; the commit's author and message are read back;
//! 5. the draft branch is deleted;
//! 6. a second draft is opened and closed without a merge, its branch
//!    deleted;
//! 7. clean-up, whatever happened: every branch of the run is deleted
//!    (which closes any pull request still open on it), and the default
//!    branch is where it was.
//!
//! Merged and closed pull requests stay in the repository's list (GitHub
//! cannot delete a pull request); nothing else of the run remains.
//!
//! `the_live_scenario_against_the_fake` runs it against `FakeGitHub` on every
//! test run, so the scenario itself cannot rot. `live_content_path_on_a_
//! sandbox_repository` runs it against GitHub, only when asked for
//! (`#[ignore]`) and only with `SWARMPRESS_LIVE_REPO=owner/name` and
//! `GITHUB_TOKEN` set; it refuses the live site's repository. See
//! `crates/github/README.md` for how to run it.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use github::provenance::{with_trailers, DEFAULT_EMAIL_DOMAIN};
use github::*;
use serde_json::{json, Value};

/// The live site's repository: never a sandbox, whatever the environment says.
const LIVE_SITE: &str = "swarmpress/cinqueterre.travel";

struct Sandbox {
    api: Arc<dyn RepoApi>,
    repo: RepoId,
    /// Unique per run; every branch and path of the run carries it.
    run: String,
    /// Wait between retries of a call GitHub answers before it caught up
    /// (zero against the fake).
    pause: Duration,
}

impl Sandbox {
    fn base(&self) -> String {
        format!("live-test/base-{}", self.run)
    }

    fn content_id(&self, n: u8) -> String {
        format!("live{n}-{}", self.run)
    }

    fn draft_branch(&self, n: u8) -> String {
        ContentRepo::draft_branch(&self.content_id(n)).expect("a valid content id")
    }

    fn conflict_branches(&self) -> (String, String) {
        (
            format!("live-test/conflict-a-{}", self.run),
            format!("live-test/conflict-b-{}", self.run),
        )
    }

    /// Every branch the run may create; drafts first (deleting a pull
    /// request's head closes it), the base last.
    fn branches(&self) -> Vec<String> {
        let (a, b) = self.conflict_branches();
        vec![
            self.draft_branch(1),
            self.draft_branch(2),
            a,
            b,
            self.base(),
        ]
    }

    fn page_path(&self, what: &str) -> String {
        format!("content/pages/live-test/{}-{what}.json", self.run)
    }
}

fn page(run: &str, title: &str) -> Value {
    json!({
        "id": format!("live-{run}"),
        "title": { "en": title },
        "page_type": "live-test",
        "body": [{ "type": "paragraph", "markdown": "Written by crates/github/tests/live_repo.rs." }],
        "status": "draft"
    })
}

/// The staff member behind the commits, as the gateway's `attribution`.
fn giulia(run: &str) -> Provenance {
    Provenance {
        staff_id: "staff-1".into(),
        name: "Giulia Rossi".into(),
        persona: Some("giulia".into()),
        role: Some("writer".into()),
        job_id: Some("1".into()),
        job_kind: Some("draft".into()),
        revision: Some(0),
        work_item: Some("work-item-1".into()),
        model: Some("live-test".into()),
        executor: Some(format!("live test {run}")),
        reviewed_by: Some("Marco Bianchi".into()),
        approved_by: Some("ceo".into()),
    }
}

async fn scenario(sb: Arc<Sandbox>) {
    let (api, repo, run) = (&sb.api, &sb.repo, sb.run.as_str());
    let default = api
        .get_repo(repo)
        .await
        .expect("the sandbox repository, readable with the token")
        .default_branch;

    // 1. A scratch base: the default branch never moves.
    let base = sb.base();
    api.create_branch(repo, &base, &default)
        .await
        .expect("create the scratch base (Contents: write)");

    // 2. The draft, as the gateway writes it: a content agent, the persona
    //    as git author, the job trailers in the message.
    let who = giulia(run);
    let author = who.author("live-test", DEFAULT_EMAIL_DOMAIN);
    let drafts = ContentRepo::new(
        Arc::new(GuardedRepo::new(api.clone(), ActorKind::ContentAgent)),
        repo.clone(),
        base.clone(),
    );
    let title = format!("Draft: Live test {run}");
    let message = with_trailers(&title, &who.draft_trailers());
    let path = sb.page_path("merged");
    let dr = drafts
        .open_draft_as(
            &sb.content_id(1),
            &path,
            &page(run, "Live test"),
            &message,
            Some(&author),
        )
        .await
        .expect("open the draft (Contents and Pull requests: write)");
    assert_eq!(dr.branch, sb.draft_branch(1));
    assert!(dr.created_branch && dr.created_pr, "{dr:?}");
    assert_eq!(
        (dr.pr.base_ref.as_str(), dr.pr.title.as_str()),
        (base.as_str(), title.as_str())
    );
    let draft_commit = api
        .get_commit(repo, dr.commit_sha.as_deref().expect("a commit"))
        .await
        .unwrap();
    assert_eq!(
        draft_commit.author.as_ref(),
        Some(&author),
        "the persona is the git author of the draft commit"
    );
    let committer = draft_commit.committer.clone().expect("a committer");
    assert_ne!(
        committer.email, author.email,
        "the token's identity commits, not the persona: {committer:?}"
    );
    assert_eq!(
        draft_commit.message.trim_end(),
        format!(
            "{title}\n\nJob: 1\nJob-Kind: draft\nWork-Item: work-item-1\nModel: live-test\nExecutor: live test {run}"
        )
    );
    // The same draft again commits nothing and reuses the pull request.
    let again = drafts
        .open_draft_as(
            &sb.content_id(1),
            &path,
            &page(run, "Live test"),
            &message,
            Some(&author),
        )
        .await
        .unwrap();
    assert_eq!(
        (
            again.pr.number,
            again.commit_sha.as_deref(),
            again.created_pr
        ),
        (dr.pr.number, None, false)
    );

    // 3. The base moves; the Merges API brings it in (201), then has nothing
    //    left to do (204).
    api.put_file(
        repo,
        &PutFile {
            branch: base.clone(),
            path: format!("content/live-test/{run}-base.txt"),
            content: b"the base moved\n".to_vec(),
            message: format!("Live test {run}: the base moves"),
            expected_sha: None,
            author: None,
        },
    )
    .await
    .unwrap();
    let merge_message = format!("Merge {base} into {}", dr.branch);
    let merged_in = api
        .merge_branch(repo, &dr.branch, &base, &merge_message)
        .await
        .expect("the Merges API");
    assert!(merged_in.is_some(), "201 with the merge commit");
    assert_eq!(
        api.merge_branch(repo, &dr.branch, &base, &merge_message)
            .await
            .expect("the Merges API again"),
        None,
        "204: the base is already in"
    );
    let (a, b) = sb.conflict_branches();
    for (branch, text) in [(&a, "a\n"), (&b, "b\n")] {
        api.create_branch(repo, branch, &base).await.unwrap();
        api.put_file(
            repo,
            &PutFile {
                branch: branch.clone(),
                path: format!("content/live-test/{run}-conflict.txt"),
                content: text.as_bytes().to_vec(),
                message: format!("Live test {run}: {branch}"),
                expected_sha: None,
                author: None,
            },
        )
        .await
        .unwrap();
    }
    match api.merge_branch(repo, &a, &b, "conflict").await {
        Err(GitHubError::Conflict(_)) => {}
        other => panic!("two different additions of one path must conflict (409): {other:?}"),
    }

    // 4. The squash merge at the exact head, with the trailers.
    let head = api
        .get_branch(repo, &dr.branch)
        .await
        .unwrap()
        .expect("the draft branch")
        .sha;
    assert_eq!(Some(&head), merged_in.as_ref());
    let platform = ContentRepo::new(api.clone(), repo.clone(), base.clone());
    let trailers = who.squash_trailers(&author);
    let mut attempt = 0;
    let merged = loop {
        match platform
            .merge_draft_with(dr.pr.number, &head, Some(&trailers))
            .await
        {
            Ok(m) => break m,
            // GitHub may still be catching up with the pushed head or
            // computing mergeability.
            Err(e @ (GitHubError::NotMergeable(_) | GitHubError::Conflict(_))) if attempt < 5 => {
                attempt += 1;
                eprintln!("squash merge not ready ({e}); retry {attempt}");
                tokio::time::sleep(sb.pause).await;
            }
            Err(e) => panic!("squash merge: {e}"),
        }
    };
    let squash = api.get_commit(repo, &merged.sha).await.unwrap();
    assert_eq!(squash.parents.len(), 1, "a squash commit has one parent");
    let first_line = squash.message.lines().next().unwrap_or_default();
    assert_eq!(first_line, format!("{title} (#{})", dr.pr.number));
    for t in [
        "Job: 1".to_string(),
        "Job-Kind: draft".into(),
        "Work-Item: work-item-1".into(),
        "Reviewed-by: Marco Bianchi".into(),
        "Approved-by: ceo".into(),
        format!("Co-authored-by: Giulia Rossi <{}>", author.email),
    ] {
        assert!(
            squash.message.lines().any(|l| l == t),
            "trailer {t:?} in {:?}",
            squash.message
        );
    }
    assert_ne!(
        squash.author.as_ref().map(|a| a.email.as_str()),
        Some(author.email.as_str()),
        "the merge API has no author: the squash commit is the token's"
    );
    assert_eq!(
        api.get_branch(repo, &base).await.unwrap().unwrap().sha,
        merged.sha
    );
    assert!(api.get_file(repo, &base, &path).await.unwrap().is_some());
    assert!(api.get_pr(repo, dr.pr.number).await.unwrap().merged);
    // Asking again answers the same merge.
    assert_eq!(
        platform
            .merge_draft_with(dr.pr.number, &head, Some(&trailers))
            .await
            .unwrap()
            .sha,
        merged.sha
    );

    // 5. The draft branch goes (it may be gone already, if the repository
    //    deletes merged branches).
    api.delete_branch(repo, &dr.branch).await.unwrap();
    assert!(api.get_branch(repo, &dr.branch).await.unwrap().is_none());

    // 6. A second draft, closed without a merge.
    let closed_path = sb.page_path("closed");
    let second = drafts
        .open_draft_as(
            &sb.content_id(2),
            &closed_path,
            &page(run, "Live test, closed"),
            &format!("Draft: Live test {run}, closed"),
            Some(&author),
        )
        .await
        .unwrap();
    let closed = api.close_pr(repo, second.pr.number).await.unwrap();
    assert_eq!((closed.state, closed.merged), (PrState::Closed, false));
    assert!(api
        .find_open_pr(repo, &second.branch)
        .await
        .unwrap()
        .is_none());
    assert!(
        api.delete_branch(repo, &second.branch).await.unwrap(),
        "the closed draft's branch existed"
    );
    assert!(api
        .get_file(repo, &base, &closed_path)
        .await
        .unwrap()
        .is_none());
}

/// Delete every branch of the run (closing what is still open on it).
/// Returns what could not be cleaned up.
async fn cleanup(sb: &Sandbox) -> Vec<String> {
    let mut left = Vec::new();
    for branch in sb.branches() {
        match sb.api.find_open_pr(&sb.repo, &branch).await {
            Ok(Some(pr)) => {
                if let Err(e) = sb.api.close_pr(&sb.repo, pr.number).await {
                    left.push(format!("close #{}: {e}", pr.number));
                }
            }
            Ok(None) => {}
            Err(e) => left.push(format!("find the open PR of {branch}: {e}")),
        }
        if let Err(e) = sb.api.delete_branch(&sb.repo, &branch).await {
            left.push(format!("delete {branch}: {e}"));
        }
    }
    left
}

/// The scenario, then the clean-up whatever happened, then the checks that
/// the repository is as it was.
async fn run(sb: Sandbox) {
    let sb = Arc::new(sb);
    let default = sb.api.get_repo(&sb.repo).await.unwrap().default_branch;
    let before = sb
        .api
        .get_branch(&sb.repo, &default)
        .await
        .unwrap()
        .expect("the default branch")
        .sha;
    // A panic inside the scenario must not skip the clean-up.
    let outcome = tokio::spawn(scenario(sb.clone())).await;
    let left = cleanup(&sb).await;
    if let Err(e) = outcome {
        if e.is_panic() {
            std::panic::resume_unwind(e.into_panic());
        }
        panic!("the scenario did not finish: {e}");
    }
    assert!(left.is_empty(), "not cleaned up: {left:?}");
    for branch in sb.branches() {
        assert!(
            sb.api
                .get_branch(&sb.repo, &branch)
                .await
                .unwrap()
                .is_none(),
            "{branch} is left over"
        );
    }
    let after = sb
        .api
        .get_branch(&sb.repo, &default)
        .await
        .unwrap()
        .unwrap()
        .sha;
    assert_eq!(before, after, "the default branch never moves");
}

#[tokio::test]
async fn the_live_scenario_against_the_fake() {
    let fake = Arc::new(FakeGitHub::new());
    let repo = RepoId::new("sandbox", "live-test");
    fake.create_repo(&repo, &[("README.md", "# sandbox\n")]);
    run(Sandbox {
        api: fake.clone(),
        repo: repo.clone(),
        run: "fake".into(),
        pause: Duration::ZERO,
    })
    .await;
    assert_eq!(fake.branches(&repo), ["main"]);
}

/// The sandbox the environment names (`SWARMPRESS_LIVE_REPO`, `GITHUB_TOKEN`),
/// or why the live test cannot run against it. Pure, so the refusals are
/// tested without the environment and without GitHub.
fn sandbox_target(repo: Option<&str>, token: Option<&str>) -> Result<(RepoId, String), String> {
    fn set(v: Option<&str>) -> Option<&str> {
        v.map(str::trim).filter(|v| !v.is_empty())
    }
    let full = set(repo)
        .ok_or("set SWARMPRESS_LIVE_REPO=owner/name (a sandbox repository you created)")?;
    let token = set(token).ok_or("set GITHUB_TOKEN (a token for that repository)")?;
    if full.eq_ignore_ascii_case(LIVE_SITE) {
        return Err(format!(
            "SWARMPRESS_LIVE_REPO={full} is the live site: use a sandbox repository"
        ));
    }
    let (owner, name) = full
        .split_once('/')
        .filter(|(o, n)| !o.is_empty() && !n.is_empty() && !n.contains('/'))
        .ok_or_else(|| format!("SWARMPRESS_LIVE_REPO={full:?} is not owner/name"))?;
    Ok((RepoId::new(owner, name), token.to_string()))
}

#[test]
fn the_live_test_refuses_the_live_site_and_needs_both_settings() {
    for live in [
        "swarmpress/cinqueterre.travel",
        " Swarmpress/CinqueTerre.Travel ",
    ] {
        let e = sandbox_target(Some(live), Some("t")).unwrap_err();
        assert!(e.contains("is the live site"), "{live}: {e}");
    }
    assert!(sandbox_target(None, Some("t"))
        .unwrap_err()
        .contains("SWARMPRESS_LIVE_REPO"));
    assert!(sandbox_target(Some("a/b"), Some("  "))
        .unwrap_err()
        .contains("GITHUB_TOKEN"));
    for bad in ["noslash", "a/b/c", "/b", "a/"] {
        assert!(sandbox_target(Some(bad), Some("t")).is_err(), "{bad}");
    }
    assert_eq!(
        sandbox_target(Some("drietsch/swarmpress-sandbox"), Some(" t ")),
        Ok((
            RepoId::new("drietsch", "swarmpress-sandbox"),
            "t".to_string()
        ))
    );
}

/// The live test's sandbox from the environment.
fn sandbox_from_env() -> Result<Sandbox, String> {
    let var = |k: &str| std::env::var(k).ok();
    let (repo, token) = sandbox_target(
        var("SWARMPRESS_LIVE_REPO").as_deref(),
        var("GITHUB_TOKEN").as_deref(),
    )?;
    let api_base = var("GITHUB_API_URL")
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_API_BASE.into());
    let api = HttpGitHub::new(api_base, Arc::new(StaticToken(token))).map_err(|e| e.to_string())?;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(Sandbox {
        api: Arc::new(api),
        repo,
        run: format!("{ms:x}-{}", std::process::id()),
        pause: Duration::from_secs(2),
    })
}

#[tokio::test]
#[ignore = "live GitHub: needs SWARMPRESS_LIVE_REPO=owner/name and GITHUB_TOKEN (crates/github/README.md)"]
async fn live_content_path_on_a_sandbox_repository() {
    // Asked for explicitly: a missing or unsafe setting fails loudly.
    let sb = sandbox_from_env().unwrap_or_else(|why| panic!("{why}"));
    eprintln!("live test {} against {}", sb.run, sb.repo);
    run(sb).await;
}
