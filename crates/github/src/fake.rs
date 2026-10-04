//! `FakeGitHub`: a deterministic, in-memory [`RepoApi`].
//!
//! Models enough of GitHub to drive pipelines end to end in tests:
//! repos (incl. templates), a real commit graph with per-commit file trees,
//! git-compatible blob shas, branches, PRs with computed mergeability
//! (three-way conflict detection against the merge base) and required
//! checks, squash/merge commits, check runs, workflow artifacts, labels,
//! comments and Pages config. Ids are counters, so two runs of the same
//! script produce identical shas and numbers.
//!
//! Test controls (`create_repo`, `add_check_run`, `add_workflow_run`, `add_artifact`,
//! `set_required_checks`, `set_mergeable`, `fail_next`, `calls`, ...) are
//! inherent methods; everything production code uses goes through
//! [`RepoApi`].

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::{Mutex, MutexGuard};

use async_trait::async_trait;
use sha1::{Digest, Sha1};

use crate::api::RepoApi;
use crate::error::{GitHubError, Result};
use crate::snapshot::{as_text, clean_prefix, in_prefix, Snapshot};
use crate::types::*;

type Tree = BTreeMap<String, String>; // path -> blob sha

#[derive(Debug, Clone)]
struct FakeCommit {
    message: String,
    parents: Vec<String>,
    tree: Tree,
    /// `None`: the platform identity ([`FakeGitHub::platform_identity`]).
    author: Option<CommitAuthor>,
}

#[derive(Debug, Clone)]
struct FakePr {
    number: u64,
    title: String,
    body: String,
    state: PrState,
    merged: bool,
    head_ref: String,
    /// Head sha frozen at close/merge time; live branch head otherwise.
    frozen_head_sha: Option<String>,
    base_ref: String,
    merge_commit_sha: Option<String>,
    labels: Vec<String>,
    /// Test override of the reported `mergeable` field.
    mergeable_override: Option<Option<bool>>,
}

#[derive(Debug, Clone, Default)]
struct FakeRepo {
    default_branch: String,
    private: bool,
    is_template: bool,
    branches: BTreeMap<String, String>,
    prs: BTreeMap<u64, FakePr>,
    next_number: u64,
    check_runs: Vec<CheckRun>,
    workflow_runs: Vec<WorkflowRun>,
    required_checks: Vec<String>,
    artifacts: BTreeMap<(u64, String), Vec<u8>>,
    comments: Vec<(u64, u64, String)>,
    pages_build_type: Option<String>,
}

#[derive(Debug, Default)]
struct State {
    repos: BTreeMap<RepoId, FakeRepo>,
    blobs: HashMap<String, Vec<u8>>,
    commits: HashMap<String, FakeCommit>,
    commit_counter: u64,
    id_counter: u64,
    calls: Vec<String>,
    failures: VecDeque<(String, GitHubError)>,
}

/// In-memory GitHub. Cheap to construct; share via `Arc`.
#[derive(Debug, Default)]
pub struct FakeGitHub {
    state: Mutex<State>,
}

/// Git's blob id: `sha1("blob {len}\0{content}")`.
pub fn git_blob_sha(content: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", content.len()).as_bytes());
    h.update(content);
    hex::encode(h.finalize())
}

fn nf(what: impl Into<String>) -> GitHubError {
    GitHubError::NotFound(what.into())
}

impl State {
    fn repo(&self, id: &RepoId) -> Result<&FakeRepo> {
        self.repos.get(id).ok_or_else(|| nf(format!("repo {id}")))
    }

    fn repo_mut(&mut self, id: &RepoId) -> Result<&mut FakeRepo> {
        self.repos
            .get_mut(id)
            .ok_or_else(|| nf(format!("repo {id}")))
    }

    fn next_id(&mut self) -> u64 {
        self.id_counter += 1;
        self.id_counter
    }

    fn put_blob(&mut self, content: &[u8]) -> String {
        let sha = git_blob_sha(content);
        self.blobs
            .entry(sha.clone())
            .or_insert_with(|| content.to_vec());
        sha
    }

    fn new_commit(&mut self, message: &str, parents: Vec<String>, tree: Tree) -> String {
        self.new_commit_by(message, parents, tree, None)
    }

    /// A commit with an explicit git author (`None`: the platform identity).
    /// The author is not part of the fake sha, so attributed and plain runs
    /// of the same script produce the same shas.
    fn new_commit_by(
        &mut self,
        message: &str,
        parents: Vec<String>,
        tree: Tree,
        author: Option<CommitAuthor>,
    ) -> String {
        self.commit_counter += 1;
        let mut h = Sha1::new();
        h.update(format!("commit {}\n", self.commit_counter).as_bytes());
        for p in &parents {
            h.update(p.as_bytes());
        }
        h.update(message.as_bytes());
        let sha = hex::encode(h.finalize());
        self.commits.insert(
            sha.clone(),
            FakeCommit {
                message: message.into(),
                parents,
                tree,
                author,
            },
        );
        sha
    }

    /// Resolve a branch name or full commit sha to a commit sha.
    fn resolve(&self, repo: &FakeRepo, git_ref: &str) -> Option<String> {
        let r = git_ref.strip_prefix("refs/heads/").unwrap_or(git_ref);
        if let Some(sha) = repo.branches.get(r) {
            return Some(sha.clone());
        }
        self.commits.contains_key(r).then(|| r.to_string())
    }

    fn tree(&self, sha: &str) -> Tree {
        self.commits
            .get(sha)
            .map(|c| c.tree.clone())
            .unwrap_or_default()
    }

    fn ancestors(&self, sha: &str) -> HashSet<String> {
        let mut seen = HashSet::new();
        let mut q = VecDeque::from([sha.to_string()]);
        while let Some(s) = q.pop_front() {
            if seen.insert(s.clone()) {
                if let Some(c) = self.commits.get(&s) {
                    q.extend(c.parents.iter().cloned());
                }
            }
        }
        seen
    }

    fn merge_base(&self, a: &str, b: &str) -> Option<String> {
        let anc = self.ancestors(a);
        let mut seen = HashSet::new();
        let mut q = VecDeque::from([b.to_string()]);
        while let Some(s) = q.pop_front() {
            if anc.contains(&s) {
                return Some(s);
            }
            if seen.insert(s.clone()) {
                if let Some(c) = self.commits.get(&s) {
                    q.extend(c.parents.iter().cloned());
                }
            }
        }
        None
    }

    /// Changes head made since the merge base: path -> Some(blob) | None (deleted).
    fn changes(&self, base_sha: &str, head_sha: &str) -> (BTreeMap<String, Option<String>>, Tree) {
        let mb = self.merge_base(base_sha, head_sha);
        let mb_tree = mb.as_deref().map(|m| self.tree(m)).unwrap_or_default();
        let head_tree = self.tree(head_sha);
        let mut ch = BTreeMap::new();
        for (p, s) in &head_tree {
            if mb_tree.get(p) != Some(s) {
                ch.insert(p.clone(), Some(s.clone()));
            }
        }
        for p in mb_tree.keys() {
            if !head_tree.contains_key(p) {
                ch.insert(p.clone(), None);
            }
        }
        (ch, mb_tree)
    }

    fn has_conflict(&self, base_sha: &str, head_sha: &str) -> bool {
        let (ch, mb_tree) = self.changes(base_sha, head_sha);
        let base_tree = self.tree(base_sha);
        ch.iter().any(|(p, new)| {
            let at_base = base_tree.get(p);
            at_base != mb_tree.get(p) && at_base != new.as_ref()
        })
    }

    fn pr_view(&self, repo: &FakeRepo, id: &RepoId, pr: &FakePr) -> PullRequest {
        let head_sha = pr
            .frozen_head_sha
            .clone()
            .or_else(|| repo.branches.get(&pr.head_ref).cloned())
            .unwrap_or_default();
        let (mergeable, state) = if pr.merged || pr.state == PrState::Closed {
            (None, "unknown".to_string())
        } else {
            self.mergeability(repo, pr, &head_sha)
        };
        let mergeable = match pr.mergeable_override {
            Some(o) => o,
            None => mergeable,
        };
        PullRequest {
            number: pr.number,
            title: pr.title.clone(),
            body: pr.body.clone(),
            state: pr.state,
            merged: pr.merged,
            head_ref: pr.head_ref.clone(),
            head_sha,
            base_ref: pr.base_ref.clone(),
            mergeable,
            mergeable_state: if pr.mergeable_override == Some(None) {
                "unknown".into()
            } else {
                state
            },
            merge_commit_sha: pr.merge_commit_sha.clone(),
            labels: pr.labels.clone(),
            html_url: format!("https://github.com/{id}/pull/{}", pr.number),
        }
    }

    fn mergeability(&self, repo: &FakeRepo, pr: &FakePr, head_sha: &str) -> (Option<bool>, String) {
        let Some(base_sha) = repo.branches.get(&pr.base_ref) else {
            return (Some(false), "dirty".into());
        };
        if self.has_conflict(base_sha, head_sha) {
            return (Some(false), "dirty".into());
        }
        let runs: Vec<&CheckRun> = repo
            .check_runs
            .iter()
            .filter(|c| c.head_sha == head_sha)
            .collect();
        let required_ok = repo
            .required_checks
            .iter()
            .all(|name| runs.iter().any(|c| &c.name == name && c.is_success()));
        if !required_ok {
            return (Some(true), "blocked".into());
        }
        if runs.iter().any(|c| !c.is_success()) {
            return (Some(true), "unstable".into());
        }
        (Some(true), "clean".into())
    }
}

impl FakeGitHub {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Log the call and pop an injected failure for it, if any.
    fn enter(&self, op: &str) -> Result<MutexGuard<'_, State>> {
        let mut s = self.lock();
        s.calls.push(op.to_string());
        if let Some(pos) = s.failures.iter().position(|(o, _)| o == op) {
            if let Some((_, e)) = s.failures.remove(pos) {
                return Err(e);
            }
        }
        Ok(s)
    }

    /// The identity GitHub would commit as: the token's user or the App. It
    /// is the committer of every fake commit, and the author of every commit
    /// written without an explicit one (squash merges always: the merge API
    /// has no author field).
    pub fn platform_identity() -> CommitAuthor {
        CommitAuthor {
            name: "swarmpress[bot]".into(),
            email: "swarmpress[bot]@users.noreply.github.com".into(),
        }
    }

    // ---- test controls -------------------------------------------------

    /// Create a repo with a `main` branch holding one initial commit of
    /// `files`.
    pub fn create_repo(&self, id: &RepoId, files: &[(&str, &str)]) -> RepoInfo {
        self.create_repo_inner(id, files, false)
    }

    /// Like [`Self::create_repo`] but marked as a template repository.
    pub fn create_template_repo(&self, id: &RepoId, files: &[(&str, &str)]) -> RepoInfo {
        self.create_repo_inner(id, files, true)
    }

    fn create_repo_inner(&self, id: &RepoId, files: &[(&str, &str)], template: bool) -> RepoInfo {
        let mut s = self.lock();
        let mut tree = Tree::new();
        for (p, c) in files {
            let sha = s.put_blob(c.as_bytes());
            tree.insert((*p).to_string(), sha);
        }
        let head = s.new_commit("Initial commit", vec![], tree);
        let repo = FakeRepo {
            default_branch: "main".into(),
            is_template: template,
            branches: BTreeMap::from([("main".to_string(), head)]),
            next_number: 1,
            ..Default::default()
        };
        s.repos.insert(id.clone(), repo);
        RepoInfo {
            id: id.clone(),
            default_branch: "main".into(),
            private: false,
            html_url: format!("https://github.com/{id}"),
        }
    }

    /// Make the next call of `op` (a [`RepoApi`] method name) fail.
    pub fn fail_next(&self, op: &str, err: GitHubError) {
        self.lock().failures.push_back((op.to_string(), err));
    }

    /// Every [`RepoApi`] method called so far, in order.
    pub fn calls(&self) -> Vec<String> {
        self.lock().calls.clone()
    }

    pub fn clear_calls(&self) {
        self.lock().calls.clear();
    }

    pub fn branch_head(&self, id: &RepoId, branch: &str) -> Option<String> {
        self.lock().repos.get(id)?.branches.get(branch).cloned()
    }

    pub fn branches(&self, id: &RepoId) -> Vec<String> {
        self.lock()
            .repos
            .get(id)
            .map(|r| r.branches.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// File text at a ref, bypassing the API (for assertions).
    pub fn file_text(&self, id: &RepoId, git_ref: &str, path: &str) -> Option<String> {
        let s = self.lock();
        let repo = s.repos.get(id)?;
        let sha = s.resolve(repo, git_ref)?;
        let blob = s.commits.get(&sha)?.tree.get(path)?;
        String::from_utf8(s.blobs.get(blob)?.clone()).ok()
    }

    pub fn pr_numbers(&self, id: &RepoId) -> Vec<u64> {
        self.lock()
            .repos
            .get(id)
            .map(|r| r.prs.keys().copied().collect())
            .unwrap_or_default()
    }

    pub fn comments(&self, id: &RepoId, number: u64) -> Vec<String> {
        self.lock()
            .repos
            .get(id)
            .map(|r| {
                r.comments
                    .iter()
                    .filter(|(n, _, _)| *n == number)
                    .map(|(_, _, b)| b.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn pages_build_type(&self, id: &RepoId) -> Option<String> {
        self.lock().repos.get(id)?.pages_build_type.clone()
    }

    pub fn set_required_checks(&self, id: &RepoId, names: &[&str]) {
        if let Some(r) = self.lock().repos.get_mut(id) {
            r.required_checks = names.iter().map(|n| n.to_string()).collect();
        }
    }

    /// Override the reported `mergeable` (use `Some(None)` to simulate
    /// "still computing", `None` to restore computed behaviour).
    pub fn set_mergeable(&self, id: &RepoId, number: u64, value: Option<Option<bool>>) {
        if let Some(pr) = self
            .lock()
            .repos
            .get_mut(id)
            .and_then(|r| r.prs.get_mut(&number))
        {
            pr.mergeable_override = value;
        }
    }

    /// Upsert a check run (keyed by head sha + name). Returns its id.
    pub fn add_check_run(
        &self,
        id: &RepoId,
        head_sha: &str,
        name: &str,
        status: CheckStatus,
        conclusion: Option<CheckConclusion>,
    ) -> u64 {
        let mut s = self.lock();
        let new_id = s.next_id();
        let Some(r) = s.repos.get_mut(id) else {
            return 0;
        };
        if let Some(c) = r
            .check_runs
            .iter_mut()
            .find(|c| c.head_sha == head_sha && c.name == name)
        {
            c.status = status;
            c.conclusion = conclusion;
            return c.id;
        }
        r.check_runs.push(CheckRun {
            id: new_id,
            name: name.into(),
            head_sha: head_sha.into(),
            status,
            conclusion,
            details_url: None,
        });
        new_id
    }

    /// Add a workflow run of the workflow file `path` (e.g.
    /// `.github/workflows/deploy.yml`) on `head_sha`, attempt 1. Returns its id.
    pub fn add_workflow_run(
        &self,
        id: &RepoId,
        head_sha: &str,
        path: &str,
        status: CheckStatus,
        conclusion: Option<CheckConclusion>,
    ) -> u64 {
        let mut s = self.lock();
        let new_id = s.next_id();
        let Some(r) = s.repos.get_mut(id) else {
            return 0;
        };
        r.workflow_runs.push(WorkflowRun {
            id: new_id,
            name: Some(path.rsplit('/').next().unwrap_or(path).to_string()),
            head_sha: head_sha.into(),
            path: path.into(),
            event: "push".into(),
            status,
            conclusion,
            run_attempt: 1,
        });
        new_id
    }

    /// Set the status of a workflow run's current attempt.
    pub fn set_workflow_run(
        &self,
        id: &RepoId,
        run_id: u64,
        status: CheckStatus,
        conclusion: Option<CheckConclusion>,
    ) {
        if let Some(run) = self
            .lock()
            .repos
            .get_mut(id)
            .and_then(|r| r.workflow_runs.iter_mut().find(|w| w.id == run_id))
        {
            run.status = status;
            run.conclusion = conclusion;
        }
    }

    pub fn workflow_run(&self, id: &RepoId, run_id: u64) -> Option<WorkflowRun> {
        self.lock()
            .repos
            .get(id)?
            .workflow_runs
            .iter()
            .find(|w| w.id == run_id)
            .cloned()
    }

    pub fn add_artifact(&self, id: &RepoId, run_id: u64, name: &str, zip: Vec<u8>) {
        if let Some(r) = self.lock().repos.get_mut(id) {
            r.artifacts.insert((run_id, name.to_string()), zip);
        }
    }
}

fn is_dir(tree: &Tree, path: &str) -> bool {
    let prefix = format!("{}/", path.trim_end_matches('/'));
    path.is_empty() || tree.keys().any(|k| k.starts_with(&prefix))
}

#[async_trait]
impl RepoApi for FakeGitHub {
    async fn get_repo(&self, repo: &RepoId) -> Result<RepoInfo> {
        let s = self.enter("get_repo")?;
        let r = s.repo(repo)?;
        Ok(RepoInfo {
            id: repo.clone(),
            default_branch: r.default_branch.clone(),
            private: r.private,
            html_url: format!("https://github.com/{repo}"),
        })
    }

    async fn create_repo_from_template(
        &self,
        template: &RepoId,
        new_repo: &NewRepo,
    ) -> Result<RepoInfo> {
        let mut s = self.enter("create_repo_from_template")?;
        let t = s.repo(template)?;
        if !t.is_template {
            return Err(GitHubError::Validation(format!(
                "{template} is not a template repository"
            )));
        }
        let tree = t
            .branches
            .get(&t.default_branch)
            .map(|h| s.tree(h))
            .unwrap_or_default();
        let id = RepoId::new(&new_repo.owner, &new_repo.name);
        if s.repos.contains_key(&id) {
            return Err(GitHubError::AlreadyExists(format!("repo {id}")));
        }
        let head = s.new_commit("Initial commit", vec![], tree);
        s.repos.insert(
            id.clone(),
            FakeRepo {
                default_branch: "main".into(),
                private: new_repo.private,
                branches: BTreeMap::from([("main".to_string(), head)]),
                next_number: 1,
                ..Default::default()
            },
        );
        Ok(RepoInfo {
            id: id.clone(),
            default_branch: "main".into(),
            private: new_repo.private,
            html_url: format!("https://github.com/{id}"),
        })
    }

    async fn enable_pages_workflow(&self, repo: &RepoId) -> Result<()> {
        let mut s = self.enter("enable_pages_workflow")?;
        s.repo_mut(repo)?.pages_build_type = Some("workflow".into());
        Ok(())
    }

    async fn get_branch(&self, repo: &RepoId, branch: &str) -> Result<Option<BranchInfo>> {
        let s = self.enter("get_branch")?;
        Ok(s.repo(repo)?.branches.get(branch).map(|sha| BranchInfo {
            name: branch.into(),
            sha: sha.clone(),
        }))
    }

    async fn create_branch(&self, repo: &RepoId, branch: &str, from: &str) -> Result<BranchInfo> {
        let mut s = self.enter("create_branch")?;
        crate::policy::validate_branch_name(branch)?;
        let r = s.repo(repo)?;
        if r.branches.contains_key(branch) {
            return Err(GitHubError::AlreadyExists(format!("branch {branch}")));
        }
        let sha = s
            .resolve(r, from)
            .ok_or_else(|| nf(format!("ref {from}")))?;
        s.repo_mut(repo)?
            .branches
            .insert(branch.into(), sha.clone());
        Ok(BranchInfo {
            name: branch.into(),
            sha,
        })
    }

    async fn get_commit(&self, repo: &RepoId, sha: &str) -> Result<CommitInfo> {
        let s = self.enter("get_commit")?;
        let r = s.repo(repo)?;
        let full = s
            .resolve(r, sha)
            .ok_or_else(|| nf(format!("commit {sha}")))?;
        let c = s
            .commits
            .get(&full)
            .ok_or_else(|| nf(format!("commit {sha}")))?;
        let parent_tree = c.parents.first().map(|p| s.tree(p)).unwrap_or_default();
        let mut files = Vec::new();
        for (p, b) in &c.tree {
            match parent_tree.get(p) {
                None => files.push((p.clone(), FileStatus::Added)),
                Some(pb) if pb != b => files.push((p.clone(), FileStatus::Modified)),
                _ => {}
            }
        }
        for p in parent_tree.keys() {
            if !c.tree.contains_key(p) {
                files.push((p.clone(), FileStatus::Removed));
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        let platform = FakeGitHub::platform_identity();
        Ok(CommitInfo {
            sha: full,
            message: c.message.clone(),
            author: Some(c.author.clone().unwrap_or_else(|| platform.clone())),
            committer: Some(platform),
            parents: c.parents.clone(),
            files: files
                .into_iter()
                .map(|(path, status)| ChangedFile {
                    path,
                    status,
                    previous_path: None,
                })
                .collect(),
        })
    }

    async fn get_file(
        &self,
        repo: &RepoId,
        git_ref: &str,
        path: &str,
    ) -> Result<Option<FileContent>> {
        let s = self.enter("get_file")?;
        let r = s.repo(repo)?;
        let Some(sha) = s.resolve(r, git_ref) else {
            return Ok(None);
        };
        let tree = s.tree(&sha);
        let path = path.trim_matches('/');
        match tree.get(path) {
            Some(blob) => Ok(Some(FileContent {
                path: path.into(),
                content: s.blobs.get(blob).cloned().unwrap_or_default(),
                sha: blob.clone(),
            })),
            None if is_dir(&tree, path) => Err(GitHubError::InvalidArgument(format!(
                "{path} is a directory"
            ))),
            None => Ok(None),
        }
    }

    async fn list_dir(&self, repo: &RepoId, git_ref: &str, path: &str) -> Result<Vec<DirEntry>> {
        let s = self.enter("list_dir")?;
        let r = s.repo(repo)?;
        let Some(sha) = s.resolve(r, git_ref) else {
            return Ok(Vec::new());
        };
        let tree = s.tree(&sha);
        let dir = path.trim_matches('/');
        if tree.contains_key(dir) {
            return Err(GitHubError::InvalidArgument(format!(
                "{dir} is not a directory"
            )));
        }
        let prefix = if dir.is_empty() {
            String::new()
        } else {
            format!("{dir}/")
        };
        let mut out: BTreeMap<String, DirEntry> = BTreeMap::new();
        let mut dir_hashers: BTreeMap<String, Sha1> = BTreeMap::new();
        for (p, blob) in &tree {
            let Some(rest) = p.strip_prefix(&prefix) else {
                continue;
            };
            match rest.split_once('/') {
                None => {
                    out.insert(
                        rest.to_string(),
                        DirEntry {
                            name: rest.into(),
                            path: p.clone(),
                            sha: blob.clone(),
                            kind: EntryKind::File,
                        },
                    );
                }
                Some((child, _)) => {
                    let h = dir_hashers.entry(child.to_string()).or_default();
                    h.update(p.as_bytes());
                    h.update(blob.as_bytes());
                }
            }
        }
        for (child, h) in dir_hashers {
            out.insert(
                child.clone(),
                DirEntry {
                    name: child.clone(),
                    path: format!("{prefix}{child}"),
                    sha: hex::encode(h.finalize()),
                    kind: EntryKind::Dir,
                },
            );
        }
        let mut v: Vec<DirEntry> = out.into_values().collect();
        v.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(v)
    }

    async fn snapshot(&self, repo: &RepoId, git_ref: &str, prefix: &str) -> Result<Snapshot> {
        let s = self.enter("snapshot")?;
        let r = s.repo(repo)?;
        let sha = s
            .resolve(r, git_ref)
            .ok_or_else(|| nf(format!("ref {git_ref}")))?;
        let prefix = clean_prefix(prefix);
        let mut files = BTreeMap::new();
        let mut skipped = Vec::new();
        for (path, blob) in s.tree(&sha) {
            if !in_prefix(&path, &prefix) {
                continue;
            }
            match as_text(s.blobs.get(&blob).cloned().unwrap_or_default()) {
                Some(text) => {
                    files.insert(path, text);
                }
                None => skipped.push(path),
            }
        }
        Ok(Snapshot {
            repo: repo.clone(),
            sha,
            prefix,
            files,
            skipped,
        })
    }

    async fn put_file(&self, repo: &RepoId, req: &PutFile) -> Result<WriteResult> {
        let mut s = self.enter("put_file")?;
        let r = s.repo(repo)?;
        let head = r
            .branches
            .get(&req.branch)
            .cloned()
            .ok_or_else(|| nf(format!("branch {}", req.branch)))?;
        let path = req.path.trim_matches('/').to_string();
        let mut tree = s.tree(&head);
        let current = tree.get(&path).cloned();
        match (&req.expected_sha, &current) {
            (None, Some(_)) => {
                return Err(GitHubError::Conflict(format!(
                    "{path} already exists and no sha was supplied"
                )))
            }
            (Some(want), cur) if cur.as_ref() != Some(want) => {
                return Err(GitHubError::Conflict(format!(
                    "{path} is at {} not {want}",
                    cur.as_deref().unwrap_or("<absent>")
                )))
            }
            _ => {}
        }
        if is_dir(&tree, &path) {
            return Err(GitHubError::Validation(format!("{path} is a directory")));
        }
        let blob = s.put_blob(&req.content);
        tree.insert(path, blob.clone());
        let commit = s.new_commit_by(&req.message, vec![head], tree, req.author.clone());
        s.repo_mut(repo)?
            .branches
            .insert(req.branch.clone(), commit.clone());
        Ok(WriteResult {
            content_sha: Some(blob),
            commit_sha: commit,
        })
    }

    async fn delete_file(&self, repo: &RepoId, req: &DeleteFile) -> Result<WriteResult> {
        let mut s = self.enter("delete_file")?;
        let r = s.repo(repo)?;
        let head = r
            .branches
            .get(&req.branch)
            .cloned()
            .ok_or_else(|| nf(format!("branch {}", req.branch)))?;
        let path = req.path.trim_matches('/').to_string();
        let mut tree = s.tree(&head);
        match tree.get(&path) {
            None => return Err(nf(format!("file {path}"))),
            Some(cur) if *cur != req.expected_sha => {
                return Err(GitHubError::Conflict(format!(
                    "{path} is at {cur} not {}",
                    req.expected_sha
                )))
            }
            _ => {}
        }
        tree.remove(&path);
        let commit = s.new_commit(&req.message, vec![head], tree);
        s.repo_mut(repo)?
            .branches
            .insert(req.branch.clone(), commit.clone());
        Ok(WriteResult {
            content_sha: None,
            commit_sha: commit,
        })
    }

    async fn create_pr(&self, repo: &RepoId, pr: &NewPullRequest) -> Result<PullRequest> {
        let mut s = self.enter("create_pr")?;
        let r = s.repo(repo)?;
        let head =
            r.branches.get(&pr.head).cloned().ok_or_else(|| {
                GitHubError::Validation(format!("head {} does not exist", pr.head))
            })?;
        let base =
            r.branches.get(&pr.base).cloned().ok_or_else(|| {
                GitHubError::Validation(format!("base {} does not exist", pr.base))
            })?;
        if r.prs
            .values()
            .any(|p| p.state == PrState::Open && p.head_ref == pr.head && p.base_ref == pr.base)
        {
            return Err(GitHubError::AlreadyExists(format!(
                "pull request for {}",
                pr.head
            )));
        }
        if s.ancestors(&base).contains(&head) {
            return Err(GitHubError::Validation(format!(
                "No commits between {} and {}",
                pr.base, pr.head
            )));
        }
        let r = s.repo_mut(repo)?;
        let number = r.next_number;
        r.next_number += 1;
        let fake = FakePr {
            number,
            title: pr.title.clone(),
            body: pr.body.clone(),
            state: PrState::Open,
            merged: false,
            head_ref: pr.head.clone(),
            frozen_head_sha: None,
            base_ref: pr.base.clone(),
            merge_commit_sha: None,
            labels: Vec::new(),
            mergeable_override: None,
        };
        r.prs.insert(number, fake.clone());
        let r = s.repo(repo)?;
        Ok(s.pr_view(r, repo, &fake))
    }

    async fn update_pr(
        &self,
        repo: &RepoId,
        number: u64,
        update: &PullRequestUpdate,
    ) -> Result<PullRequest> {
        let mut s = self.enter("update_pr")?;
        let head_sha = {
            let r = s.repo(repo)?;
            let pr = r
                .prs
                .get(&number)
                .ok_or_else(|| nf(format!("PR #{number}")))?;
            r.branches.get(&pr.head_ref).cloned()
        };
        let r = s.repo_mut(repo)?;
        if let Some(base) = &update.base {
            if !r.branches.contains_key(base) {
                return Err(GitHubError::Validation(format!(
                    "base {base} does not exist"
                )));
            }
        }
        let pr = r
            .prs
            .get_mut(&number)
            .ok_or_else(|| nf(format!("PR #{number}")))?;
        if pr.merged && update.state.is_some() {
            return Err(GitHubError::Validation("PR is already merged".into()));
        }
        if let Some(t) = &update.title {
            pr.title = t.clone();
        }
        if let Some(b) = &update.body {
            pr.body = b.clone();
        }
        if let Some(b) = &update.base {
            pr.base_ref = b.clone();
        }
        match update.state {
            Some(PrState::Closed) if pr.state == PrState::Open => {
                pr.state = PrState::Closed;
                pr.frozen_head_sha = head_sha;
            }
            Some(PrState::Open) if pr.state == PrState::Closed => {
                pr.state = PrState::Open;
                pr.frozen_head_sha = None;
            }
            _ => {}
        }
        let pr = pr.clone();
        let r = s.repo(repo)?;
        Ok(s.pr_view(r, repo, &pr))
    }

    async fn get_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest> {
        let s = self.enter("get_pr")?;
        let r = s.repo(repo)?;
        let pr = r
            .prs
            .get(&number)
            .ok_or_else(|| nf(format!("PR #{number}")))?;
        Ok(s.pr_view(r, repo, pr))
    }

    async fn find_open_pr(&self, repo: &RepoId, head_branch: &str) -> Result<Option<PullRequest>> {
        let s = self.enter("find_open_pr")?;
        let r = s.repo(repo)?;
        Ok(r.prs
            .values()
            .find(|p| p.state == PrState::Open && p.head_ref == head_branch)
            .map(|p| s.pr_view(r, repo, p)))
    }

    async fn comment(&self, repo: &RepoId, number: u64, body: &str) -> Result<u64> {
        let mut s = self.enter("comment")?;
        if !s.repo(repo)?.prs.contains_key(&number) {
            return Err(nf(format!("PR #{number}")));
        }
        let id = s.next_id();
        s.repo_mut(repo)?
            .comments
            .push((number, id, body.to_string()));
        Ok(id)
    }

    async fn add_labels(&self, repo: &RepoId, number: u64, labels: &[String]) -> Result<()> {
        let mut s = self.enter("add_labels")?;
        let pr = s
            .repo_mut(repo)?
            .prs
            .get_mut(&number)
            .ok_or_else(|| nf(format!("PR #{number}")))?;
        let mut seen: BTreeSet<String> = pr.labels.iter().cloned().collect();
        for l in labels {
            if seen.insert(l.clone()) {
                pr.labels.push(l.clone());
            }
        }
        Ok(())
    }

    async fn merge_pr(
        &self,
        repo: &RepoId,
        number: u64,
        opts: &MergeOptions,
    ) -> Result<MergeResult> {
        let mut s = self.enter("merge_pr")?;
        let r = s.repo(repo)?;
        let pr = r
            .prs
            .get(&number)
            .cloned()
            .ok_or_else(|| nf(format!("PR #{number}")))?;
        if pr.merged {
            return Err(GitHubError::NotMergeable(
                "Pull Request is already merged".into(),
            ));
        }
        if pr.state == PrState::Closed {
            return Err(GitHubError::NotMergeable("Pull Request is closed".into()));
        }
        let head_sha = r
            .branches
            .get(&pr.head_ref)
            .cloned()
            .ok_or_else(|| GitHubError::NotMergeable("head branch was deleted".into()))?;
        let base_sha = r
            .branches
            .get(&pr.base_ref)
            .cloned()
            .ok_or_else(|| GitHubError::NotMergeable("base branch was deleted".into()))?;
        if let Some(want) = &opts.expected_head_sha {
            if *want != head_sha {
                return Err(GitHubError::Conflict(format!(
                    "Head branch was modified. Review and try the merge again. (head is {head_sha}, expected {want})"
                )));
            }
        }
        if pr.mergeable_override == Some(Some(false)) {
            return Err(GitHubError::NotMergeable(
                "Pull Request is not mergeable".into(),
            ));
        }
        let (mergeable, state) = s.mergeability(r, &pr, &head_sha);
        if mergeable != Some(true) || state == "blocked" {
            return Err(GitHubError::NotMergeable(format!(
                "Pull Request is not mergeable ({state})"
            )));
        }
        let (changes, _) = s.changes(&base_sha, &head_sha);
        let mut tree = s.tree(&base_sha);
        for (p, b) in changes {
            match b {
                Some(b) => tree.insert(p, b),
                None => tree.remove(&p),
            };
        }
        let title = opts
            .commit_title
            .clone()
            .unwrap_or_else(|| format!("{} (#{number})", pr.title));
        let message = match &opts.commit_message {
            Some(m) if !m.is_empty() => format!("{title}\n\n{m}"),
            _ => title,
        };
        let parents = match opts.method {
            MergeMethod::Merge => vec![base_sha, head_sha.clone()],
            MergeMethod::Squash | MergeMethod::Rebase => vec![base_sha],
        };
        let sha = s.new_commit(&message, parents, tree);
        let r = s.repo_mut(repo)?;
        r.branches.insert(pr.base_ref.clone(), sha.clone());
        if let Some(p) = r.prs.get_mut(&number) {
            p.merged = true;
            p.state = PrState::Closed;
            p.merge_commit_sha = Some(sha.clone());
            p.frozen_head_sha = Some(head_sha);
        }
        Ok(MergeResult { sha })
    }

    async fn close_pr(&self, repo: &RepoId, number: u64) -> Result<PullRequest> {
        {
            let mut s = self.lock();
            s.calls.push("close_pr".into());
        }
        // Delegate (logs update_pr too; harmless, and keeps one code path).
        self.update_pr(
            repo,
            number,
            &PullRequestUpdate {
                state: Some(PrState::Closed),
                ..Default::default()
            },
        )
        .await
    }

    async fn list_check_runs(&self, repo: &RepoId, head_sha: &str) -> Result<Vec<CheckRun>> {
        let s = self.enter("list_check_runs")?;
        Ok(s.repo(repo)?
            .check_runs
            .iter()
            .filter(|c| c.head_sha == head_sha)
            .cloned()
            .collect())
    }

    async fn download_artifact(&self, repo: &RepoId, run_id: u64, name: &str) -> Result<Vec<u8>> {
        let s = self.enter("download_artifact")?;
        s.repo(repo)?
            .artifacts
            .get(&(run_id, name.to_string()))
            .cloned()
            .ok_or_else(|| nf(format!("artifact {name} in run {run_id}")))
    }

    async fn list_workflow_runs(&self, repo: &RepoId, head_sha: &str) -> Result<Vec<WorkflowRun>> {
        let s = self.enter("list_workflow_runs")?;
        let mut runs: Vec<WorkflowRun> = s
            .repo(repo)?
            .workflow_runs
            .iter()
            .filter(|w| w.head_sha == head_sha)
            .cloned()
            .collect();
        runs.sort_by_key(|r| std::cmp::Reverse(r.id));
        Ok(runs)
    }

    /// A new attempt of a completed, unsuccessful run: queued again, and the
    /// commit's check runs that did not succeed are queued with it (the
    /// failed jobs and the jobs that depend on them).
    async fn rerun_failed_jobs(&self, repo: &RepoId, run_id: u64) -> Result<()> {
        let mut s = self.enter("rerun_failed_jobs")?;
        let r = s.repo_mut(repo)?;
        let run = r
            .workflow_runs
            .iter_mut()
            .find(|w| w.id == run_id)
            .ok_or_else(|| nf(format!("workflow run {run_id}")))?;
        if run.status != CheckStatus::Completed {
            return Err(GitHubError::Forbidden(format!(
                "workflow run {run_id} is not completed"
            )));
        }
        if run.conclusion == Some(CheckConclusion::Success) {
            return Err(GitHubError::Forbidden(format!(
                "workflow run {run_id} has no failed jobs"
            )));
        }
        run.run_attempt += 1;
        run.status = CheckStatus::Queued;
        run.conclusion = None;
        let sha = run.head_sha.clone();
        for c in r.check_runs.iter_mut().filter(|c| c.head_sha == sha) {
            if c.conclusion != Some(CheckConclusion::Success) {
                c.status = CheckStatus::Queued;
                c.conclusion = None;
            }
        }
        Ok(())
    }

    // ---- gateway additions (ADR-0061) ----------------------------------

    async fn delete_branch(&self, repo: &RepoId, branch: &str) -> Result<bool> {
        let mut s = self.enter("delete_branch")?;
        let r = s.repo_mut(repo)?;
        if branch == r.default_branch {
            return Err(GitHubError::Validation(format!(
                "cannot delete the default branch {branch}"
            )));
        }
        let Some(head) = r.branches.remove(branch) else {
            return Ok(false);
        };
        // GitHub closes the open pull requests of a deleted head branch.
        for pr in r.prs.values_mut() {
            if pr.state == PrState::Open && pr.head_ref == branch {
                pr.state = PrState::Closed;
                pr.frozen_head_sha = Some(head.clone());
            }
        }
        Ok(true)
    }

    async fn merge_branch(
        &self,
        repo: &RepoId,
        base: &str,
        head: &str,
        message: &str,
    ) -> Result<Option<String>> {
        let mut s = self.enter("merge_branch")?;
        let r = s.repo(repo)?;
        let base_sha = r
            .branches
            .get(base)
            .cloned()
            .ok_or_else(|| nf(format!("base branch {base}")))?;
        let head_sha = s
            .resolve(r, head)
            .ok_or_else(|| nf(format!("head {head}")))?;
        if s.ancestors(&base_sha).contains(&head_sha) {
            return Ok(None);
        }
        // Three-way: what `head` changed since the merge base, onto `base`.
        if s.has_conflict(&base_sha, &head_sha) {
            return Err(GitHubError::Conflict(format!(
                "Merge conflict merging {head} into {base}"
            )));
        }
        let (changes, _) = s.changes(&base_sha, &head_sha);
        let mut tree = s.tree(&base_sha);
        for (p, b) in changes {
            match b {
                Some(b) => tree.insert(p, b),
                None => tree.remove(&p),
            };
        }
        let sha = s.new_commit(message, vec![base_sha, head_sha], tree);
        s.repo_mut(repo)?.branches.insert(base.into(), sha.clone());
        Ok(Some(sha))
    }
}
