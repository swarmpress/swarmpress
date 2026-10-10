//! The governed content repository (ADR-0080): the truth about a company's site.
//!
//! - **Objects** are WordPress content as JSON, keyed `kind:id` (`post:12`, `term:3`,
//!   `option:blogname`, `user:1`, `comment:4`, `link:2`). A post's content is a parsed block tree
//!   ([`blocks`]). The repository does not interpret objects beyond merging them; their shape is
//!   the storage API's projection mapping (ADR-0084).
//! - **Commits** are digest-chained (domain-separated SHA-256, `swarmpress:content:v1`) and
//!   attributed: author, job and model.
//! - **Branches**: `live` plus one per work item. Heads move by compare-and-swap, and `live`
//!   moves only by merging a change request, by a rollback, or by an import.
//! - **Change requests** carry a semantic diff ([`diff`]) and merge three-way ([`merge`]); a
//!   conflict is typed, never a silent choice.
//! - **Releases** tag states of `live`; a rollback is a new commit.
//!
//! Pure and deterministic: no clocks, no I/O. A commit's `seq` is the repository's own counter.
//! Persistence and sync take [`Record`]s.

pub mod blocks;
pub mod merge;

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

pub use merge::Conflict;

/// A hex SHA-256 digest.
pub type Digest = String;
/// An object key: `kind:id`.
pub type Key = String;
/// A commit's content: every object key and its object's digest.
pub type Tree = BTreeMap<Key, Digest>;

pub const LIVE: &str = "live";

fn hash(domain: &str, bytes: &[u8]) -> Digest {
    let mut h = Sha256::new();
    h.update(b"swarmpress:content:v1:");
    h.update(domain.as_bytes());
    h.update([0]);
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The digest of an object: its canonical JSON (serde_json orders keys).
pub fn object_digest(v: &Value) -> Digest {
    hash(
        "object",
        serde_json::to_string(v).unwrap_or_default().as_bytes(),
    )
}

/// Who made a commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Author {
    /// `agent`, `human` or `system`.
    pub kind: String,
    /// A staff id, a user id, or the system's part (`import`, `rollback`).
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub job: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model: Option<String>,
}

impl Author {
    pub fn system(id: &str) -> Author {
        Author {
            kind: "system".into(),
            id: id.into(),
            job: None,
            model: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Commit {
    pub id: Digest,
    pub parents: Vec<Digest>,
    pub tree: Tree,
    pub author: Author,
    pub message: String,
    pub seq: u64,
}

impl Commit {
    fn digest(parents: &[Digest], tree: &Tree, author: &Author, message: &str, seq: u64) -> Digest {
        let body = serde_json::json!({"parents": parents, "tree": tree, "author": author, "message": message, "seq": seq});
        hash(
            "commit",
            serde_json::to_string(&body).unwrap_or_default().as_bytes(),
        )
    }

    /// The id recomputed from the content: a commit whose id differs was tampered with.
    pub fn verify(&self) -> bool {
        Commit::digest(
            &self.parents,
            &self.tree,
            &self.author,
            &self.message,
            self.seq,
        ) == self.id
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CrStatus {
    Open,
    Merged,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangeRequest {
    pub id: u64,
    pub title: String,
    pub source: String,
    pub target: String,
    pub author: Author,
    pub status: CrStatus,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub merged: Option<Digest>,
    /// The work item it belongs to, if any (the sim's id).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub work_item: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Release {
    pub id: u64,
    pub name: String,
    pub commit: Digest,
}

/// How one field changed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldChange {
    pub path: String,
    pub before: Value,
    pub after: Value,
}

/// How one object changed between two trees.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Change {
    pub key: Key,
    /// `added`, `removed` or `modified`.
    pub kind: String,
    pub fields: Vec<FieldChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RepoError {
    UnknownBranch(String),
    BranchExists(String),
    /// The branch moved since the caller read it.
    Stale {
        branch: String,
        expected: Option<Digest>,
        actual: Option<Digest>,
    },
    /// `live` moves only by merges, rollbacks and imports.
    LiveIsProtected,
    UnknownChangeRequest(u64),
    NotOpen(u64),
    Conflicts(Vec<Conflict>),
    UnknownRelease(u64),
    UnknownCommit(Digest),
    Tampered(Digest),
}

impl std::fmt::Display for RepoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

/// What persistence and sync carry: append-only facts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "r", rename_all = "snake_case")]
pub enum Record {
    Object { digest: Digest, value: Value },
    Commit(Commit),
    Ref { name: String, head: Option<Digest> },
    ChangeRequest(ChangeRequest),
    Release(Release),
    HighWater { table: String, id: i64 },
}

/// The repository.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Repo {
    objects: BTreeMap<Digest, Value>,
    commits: BTreeMap<Digest, Commit>,
    refs: BTreeMap<String, Digest>,
    change_requests: BTreeMap<u64, ChangeRequest>,
    releases: BTreeMap<u64, Release>,
    /// The highest id each table has used on any branch, so branches never reuse one.
    high_water: BTreeMap<String, i64>,
    seq: u64,
    /// Records since the last [`Repo::take_records`].
    #[serde(skip)]
    pending: Vec<Record>,
}

impl Repo {
    pub fn new() -> Repo {
        Repo::default()
    }

    // ---- reading

    pub fn head(&self, branch: &str) -> Option<&Digest> {
        self.refs.get(branch)
    }

    pub fn branches(&self) -> impl Iterator<Item = (&String, &Digest)> {
        self.refs.iter()
    }

    pub fn commit(&self, id: &str) -> Option<&Commit> {
        self.commits.get(id)
    }

    pub fn object(&self, digest: &str) -> Option<&Value> {
        self.objects.get(digest)
    }

    pub fn tree(&self, branch: &str) -> Tree {
        self.head(branch)
            .and_then(|h| self.commits.get(h))
            .map(|c| c.tree.clone())
            .unwrap_or_default()
    }

    /// The object `key` on `branch`.
    pub fn get(&self, branch: &str, key: &str) -> Option<&Value> {
        let h = self.head(branch)?;
        let d = self.commits.get(h)?.tree.get(key)?;
        self.objects.get(d)
    }

    /// Every object on `branch`, by key.
    pub fn materialize(&self, branch: &str) -> BTreeMap<Key, Value> {
        self.materialize_tree(&self.tree(branch))
    }

    pub fn materialize_tree(&self, tree: &Tree) -> BTreeMap<Key, Value> {
        tree.iter()
            .filter_map(|(k, d)| self.objects.get(d).map(|v| (k.clone(), v.clone())))
            .collect()
    }

    /// The commits on `branch`, newest first.
    pub fn log(&self, branch: &str) -> Vec<&Commit> {
        let mut out = Vec::new();
        let mut seen = BTreeSet::new();
        let mut queue: VecDeque<Digest> = self.head(branch).cloned().into_iter().collect();
        while let Some(id) = queue.pop_front() {
            if !seen.insert(id.clone()) {
                continue;
            }
            if let Some(c) = self.commits.get(&id) {
                out.push(c);
                queue.extend(c.parents.iter().cloned());
            }
        }
        out.sort_by_key(|c| std::cmp::Reverse(c.seq));
        out
    }

    pub fn change_request(&self, id: u64) -> Option<&ChangeRequest> {
        self.change_requests.get(&id)
    }

    pub fn change_requests(&self) -> impl Iterator<Item = &ChangeRequest> {
        self.change_requests.values()
    }

    pub fn releases(&self) -> impl Iterator<Item = &Release> {
        self.releases.values()
    }

    pub fn high_water(&self, table: &str) -> i64 {
        self.high_water.get(table).copied().unwrap_or(0)
    }

    // ---- writing

    fn put_object(&mut self, v: Value) -> Digest {
        let d = object_digest(&v);
        if !self.objects.contains_key(&d) {
            self.pending.push(Record::Object {
                digest: d.clone(),
                value: v.clone(),
            });
            self.objects.insert(d.clone(), v);
        }
        d
    }

    fn set_ref(&mut self, name: &str, head: Digest) {
        self.refs.insert(name.to_string(), head.clone());
        self.pending.push(Record::Ref {
            name: name.to_string(),
            head: Some(head),
        });
    }

    fn new_commit(
        &mut self,
        parents: Vec<Digest>,
        tree: Tree,
        author: Author,
        message: &str,
    ) -> Digest {
        self.seq += 1;
        let id = Commit::digest(&parents, &tree, &author, message, self.seq);
        let c = Commit {
            id: id.clone(),
            parents,
            tree,
            author,
            message: message.to_string(),
            seq: self.seq,
        };
        self.pending.push(Record::Commit(c.clone()));
        self.commits.insert(id.clone(), c);
        id
    }

    /// Notes an id a table used, so no branch reuses it.
    pub fn note_id(&mut self, table: &str, id: i64) {
        if id > self.high_water(table) {
            self.high_water.insert(table.to_string(), id);
            self.pending.push(Record::HighWater {
                table: table.to_string(),
                id,
            });
        }
    }

    /// A new branch at `from`'s head.
    pub fn create_branch(&mut self, name: &str, from: &str) -> Result<Digest, RepoError> {
        if self.refs.contains_key(name) {
            return Err(RepoError::BranchExists(name.into()));
        }
        let head = self
            .head(from)
            .cloned()
            .ok_or_else(|| RepoError::UnknownBranch(from.into()))?;
        self.set_ref(name, head.clone());
        Ok(head)
    }

    /// Deletes a branch (not `live`).
    pub fn delete_branch(&mut self, name: &str) -> Result<(), RepoError> {
        if name == LIVE {
            return Err(RepoError::LiveIsProtected);
        }
        self.refs
            .remove(name)
            .ok_or_else(|| RepoError::UnknownBranch(name.into()))?;
        self.pending.push(Record::Ref {
            name: name.into(),
            head: None,
        });
        Ok(())
    }

    fn commit_changes(
        &mut self,
        branch: &str,
        expected: Option<&Digest>,
        changes: Vec<(Key, Option<Value>)>,
        author: Author,
        message: &str,
    ) -> Result<Option<Digest>, RepoError> {
        let actual = self.head(branch).cloned();
        if actual.as_ref() != expected {
            return Err(RepoError::Stale {
                branch: branch.into(),
                expected: expected.cloned(),
                actual,
            });
        }
        let mut tree = self.tree(branch);
        let before = tree.clone();
        for (k, v) in changes {
            match v {
                Some(v) => {
                    let d = self.put_object(v);
                    tree.insert(k, d);
                }
                None => {
                    tree.remove(&k);
                }
            }
        }
        if tree == before && actual.is_some() {
            return Ok(None);
        }
        let id = self.new_commit(actual.into_iter().collect(), tree, author, message);
        self.set_ref(branch, id.clone());
        Ok(Some(id))
    }

    /// Commits `changes` (a key and its new object, or `None` to remove it) on a work branch,
    /// if its head is still `expected`. Returns the new head, or `None` when nothing changed.
    pub fn commit_to(
        &mut self,
        branch: &str,
        expected: Option<&Digest>,
        changes: Vec<(Key, Option<Value>)>,
        author: Author,
        message: &str,
    ) -> Result<Option<Digest>, RepoError> {
        if branch == LIVE {
            return Err(RepoError::LiveIsProtected);
        }
        self.commit_changes(branch, expected, changes, author, message)
    }

    /// Imports content onto `live` (the first commit of a company, or a migration).
    pub fn import(
        &mut self,
        changes: Vec<(Key, Option<Value>)>,
        author: Author,
        message: &str,
    ) -> Result<Option<Digest>, RepoError> {
        let expected = self.head(LIVE).cloned();
        self.commit_changes(LIVE, expected.as_ref(), changes, author, message)
    }

    /// The nearest common ancestor of two commits.
    pub fn merge_base(&self, a: &str, b: &str) -> Option<Digest> {
        let ancestors = |start: &str| {
            let mut seen = BTreeSet::new();
            let mut q: VecDeque<Digest> = VecDeque::from([start.to_string()]);
            while let Some(id) = q.pop_front() {
                if seen.insert(id.clone()) {
                    if let Some(c) = self.commits.get(&id) {
                        q.extend(c.parents.iter().cloned());
                    }
                }
            }
            seen
        };
        let (aa, ab) = (ancestors(a), ancestors(b));
        aa.intersection(&ab)
            .filter_map(|id| self.commits.get(id))
            .max_by_key(|c| c.seq)
            .map(|c| c.id.clone())
    }

    /// The semantic diff between two trees: objects added, removed and modified, and for each
    /// modified object the fields (and blocks) that changed.
    pub fn diff_trees(&self, from: &Tree, to: &Tree) -> Vec<Change> {
        let mut keys: Vec<&Key> = from.keys().chain(to.keys()).collect();
        keys.sort();
        keys.dedup();
        let null = Value::Null;
        let mut out = Vec::new();
        for k in keys {
            let (a, b) = (from.get(k), to.get(k));
            if a == b {
                continue;
            }
            let av = a.and_then(|d| self.objects.get(d)).unwrap_or(&null);
            let bv = b.and_then(|d| self.objects.get(d)).unwrap_or(&null);
            let kind = match (a, b) {
                (None, Some(_)) => "added",
                (Some(_), None) => "removed",
                _ => "modified",
            };
            let mut fields = Vec::new();
            diff_value("", av, bv, &mut fields);
            out.push(Change {
                key: k.clone(),
                kind: kind.into(),
                fields,
            });
        }
        out
    }

    // ---- change requests

    /// Opens a change request from a work branch into `target`.
    pub fn open_change_request(
        &mut self,
        source: &str,
        target: &str,
        title: &str,
        author: Author,
        work_item: Option<u64>,
    ) -> Result<u64, RepoError> {
        for b in [source, target] {
            if !self.refs.contains_key(b) {
                return Err(RepoError::UnknownBranch(b.into()));
            }
        }
        let id = self
            .change_requests
            .keys()
            .next_back()
            .copied()
            .unwrap_or(0)
            + 1;
        let cr = ChangeRequest {
            id,
            title: title.into(),
            source: source.into(),
            target: target.into(),
            author,
            status: CrStatus::Open,
            merged: None,
            work_item,
        };
        self.pending.push(Record::ChangeRequest(cr.clone()));
        self.change_requests.insert(id, cr);
        Ok(id)
    }

    /// What merging the change request would change on its target.
    pub fn change_request_diff(&self, id: u64) -> Result<Vec<Change>, RepoError> {
        let cr = self
            .change_requests
            .get(&id)
            .ok_or(RepoError::UnknownChangeRequest(id))?;
        let source = self
            .head(&cr.source)
            .ok_or_else(|| RepoError::UnknownBranch(cr.source.clone()))?;
        let target = self
            .head(&cr.target)
            .ok_or_else(|| RepoError::UnknownBranch(cr.target.clone()))?;
        let base = self.merge_base(source, target).unwrap_or_default();
        let base_tree = self
            .commits
            .get(&base)
            .map(|c| c.tree.clone())
            .unwrap_or_default();
        Ok(self.diff_trees(&base_tree, &self.commits[source].tree))
    }

    /// The three-way merge of `source` into `target` without committing: the merged tree's
    /// objects, or the conflicts.
    pub fn preview_merge(
        &self,
        source: &str,
        target: &str,
    ) -> Result<BTreeMap<Key, Value>, RepoError> {
        let s = self
            .head(source)
            .ok_or_else(|| RepoError::UnknownBranch(source.into()))?
            .clone();
        let t = self
            .head(target)
            .ok_or_else(|| RepoError::UnknownBranch(target.into()))?
            .clone();
        let base = self.merge_base(&s, &t);
        let tree_of = |id: &Option<Digest>| {
            id.as_ref()
                .and_then(|i| self.commits.get(i))
                .map(|c| self.materialize_tree(&c.tree))
                .unwrap_or_default()
        };
        let (bm, om, tm) = (
            tree_of(&base),
            tree_of(&Some(t.clone())),
            tree_of(&Some(s.clone())),
        );
        let mut keys: Vec<&Key> = bm.keys().chain(om.keys()).chain(tm.keys()).collect();
        keys.sort();
        keys.dedup();
        let null = Value::Null;
        let mut conflicts = Vec::new();
        let mut out = BTreeMap::new();
        for k in keys {
            let (b, o, th) = (
                bm.get(k).unwrap_or(&null),
                om.get(k).unwrap_or(&null),
                tm.get(k).unwrap_or(&null),
            );
            let v = merge::merge_value(k, "", b, o, th, &mut conflicts);
            if !v.is_null() {
                out.insert(k.clone(), v);
            }
        }
        if conflicts.is_empty() {
            Ok(out)
        } else {
            Err(RepoError::Conflicts(conflicts))
        }
    }

    /// Merges an open change request into its target if the target is still at `expected`.
    /// `fixup` may correct derived values in the merged objects (counts) before the commit.
    pub fn merge_change_request(
        &mut self,
        id: u64,
        expected_target: Option<&Digest>,
        author: Author,
        fixup: &dyn Fn(&mut BTreeMap<Key, Value>),
    ) -> Result<Digest, RepoError> {
        let cr = self
            .change_requests
            .get(&id)
            .cloned()
            .ok_or(RepoError::UnknownChangeRequest(id))?;
        if cr.status != CrStatus::Open {
            return Err(RepoError::NotOpen(id));
        }
        let actual = self.head(&cr.target).cloned();
        if actual.as_ref() != expected_target {
            return Err(RepoError::Stale {
                branch: cr.target.clone(),
                expected: expected_target.cloned(),
                actual,
            });
        }
        let source = self
            .head(&cr.source)
            .cloned()
            .ok_or_else(|| RepoError::UnknownBranch(cr.source.clone()))?;
        let target = actual.ok_or_else(|| RepoError::UnknownBranch(cr.target.clone()))?;
        let mut merged = self.preview_merge(&cr.source, &cr.target)?;
        fixup(&mut merged);
        let tree: Tree = merged
            .into_iter()
            .map(|(k, v)| (k, self.put_object(v)))
            .collect();
        let msg = format!("Merge change request #{id}: {}", cr.title);
        let head = self.new_commit(vec![target, source], tree, author, &msg);
        self.set_ref(&cr.target, head.clone());
        let mut cr = cr;
        cr.status = CrStatus::Merged;
        cr.merged = Some(head.clone());
        self.pending.push(Record::ChangeRequest(cr.clone()));
        self.change_requests.insert(id, cr);
        Ok(head)
    }

    pub fn close_change_request(&mut self, id: u64) -> Result<(), RepoError> {
        let cr = self
            .change_requests
            .get_mut(&id)
            .ok_or(RepoError::UnknownChangeRequest(id))?;
        if cr.status != CrStatus::Open {
            return Err(RepoError::NotOpen(id));
        }
        cr.status = CrStatus::Closed;
        let cr = cr.clone();
        self.pending.push(Record::ChangeRequest(cr));
        Ok(())
    }

    // ---- releases

    /// Tags `live`'s head as a release.
    pub fn release(&mut self, name: &str) -> Result<Release, RepoError> {
        let commit = self
            .head(LIVE)
            .cloned()
            .ok_or_else(|| RepoError::UnknownBranch(LIVE.into()))?;
        let id = self.releases.keys().next_back().copied().unwrap_or(0) + 1;
        let r = Release {
            id,
            name: name.into(),
            commit,
        };
        self.pending.push(Record::Release(r.clone()));
        self.releases.insert(id, r.clone());
        Ok(r)
    }

    /// A new commit on `live` whose content is the release's.
    pub fn rollback(&mut self, release: u64, author: Author) -> Result<Digest, RepoError> {
        let r = self
            .releases
            .get(&release)
            .cloned()
            .ok_or(RepoError::UnknownRelease(release))?;
        let tree = self
            .commits
            .get(&r.commit)
            .map(|c| c.tree.clone())
            .ok_or_else(|| RepoError::UnknownCommit(r.commit.clone()))?;
        let parent = self
            .head(LIVE)
            .cloned()
            .ok_or_else(|| RepoError::UnknownBranch(LIVE.into()))?;
        let id = self.new_commit(
            vec![parent],
            tree,
            author,
            &format!("Roll back to release {} ({})", r.id, r.name),
        );
        self.set_ref(LIVE, id.clone());
        Ok(id)
    }

    // ---- persistence and sync

    /// The records written since the last call, for the store and the sync segments.
    pub fn take_records(&mut self) -> Vec<Record> {
        std::mem::take(&mut self.pending)
    }

    /// Every record, for a full export or a snapshot.
    pub fn all_records(&self) -> Vec<Record> {
        let mut out: Vec<Record> = self
            .objects
            .iter()
            .map(|(d, v)| Record::Object {
                digest: d.clone(),
                value: v.clone(),
            })
            .collect();
        let mut commits: Vec<&Commit> = self.commits.values().collect();
        commits.sort_by_key(|c| c.seq);
        out.extend(commits.into_iter().cloned().map(Record::Commit));
        out.extend(self.high_water.iter().map(|(t, id)| Record::HighWater {
            table: t.clone(),
            id: *id,
        }));
        out.extend(
            self.change_requests
                .values()
                .cloned()
                .map(Record::ChangeRequest),
        );
        out.extend(self.releases.values().cloned().map(Record::Release));
        out.extend(self.refs.iter().map(|(n, h)| Record::Ref {
            name: n.clone(),
            head: Some(h.clone()),
        }));
        out
    }

    /// Applies records (a restore, or another executor's sealed segment). Commits and objects
    /// are verified against their digests.
    pub fn apply(&mut self, records: impl IntoIterator<Item = Record>) -> Result<(), RepoError> {
        for r in records {
            match r {
                Record::Object { digest, value } => {
                    if object_digest(&value) != digest {
                        return Err(RepoError::Tampered(digest));
                    }
                    self.objects.insert(digest, value);
                }
                Record::Commit(c) => {
                    if !c.verify() {
                        return Err(RepoError::Tampered(c.id));
                    }
                    self.seq = self.seq.max(c.seq);
                    self.commits.insert(c.id.clone(), c);
                }
                Record::Ref {
                    name,
                    head: Some(h),
                } => {
                    self.refs.insert(name, h);
                }
                Record::Ref { name, head: None } => {
                    self.refs.remove(&name);
                }
                Record::ChangeRequest(cr) => {
                    self.change_requests.insert(cr.id, cr);
                }
                Record::Release(r) => {
                    self.releases.insert(r.id, r);
                }
                Record::HighWater { table, id } => {
                    let e = self.high_water.entry(table).or_insert(0);
                    *e = (*e).max(id);
                }
            }
        }
        Ok(())
    }
}

/// Field-level differences; block lists are compared block by block (LCS), so an inserted
/// block reads as one added block, not as every later block changed.
fn diff_value(path: &str, a: &Value, b: &Value, out: &mut Vec<FieldChange>) {
    if a == b {
        return;
    }
    let field = path.rsplit(['.', ']']).next().unwrap_or(path);
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            let null = Value::Null;
            for k in keys {
                if k == "attrs_raw" {
                    continue;
                }
                let p = if path.is_empty() {
                    k.clone()
                } else {
                    format!("{path}.{k}")
                };
                diff_value(
                    &p,
                    x.get(k).unwrap_or(&null),
                    y.get(k).unwrap_or(&null),
                    out,
                );
            }
        }
        (Value::Array(x), Value::Array(y)) if field == "blocks" || field == "inner" => {
            let pairs = merge::lcs(x, y);
            let (mut i, mut j) = (0, 0);
            let emit =
                |i_end: usize, j_end: usize, i: usize, j: usize, out: &mut Vec<FieldChange>| {
                    let (dx, dy) = (&x[i..i_end], &y[j..j_end]);
                    // Same count on both sides: changed in place, compared deeper.
                    if dx.len() == dy.len() {
                        for (n, (p, q)) in dx.iter().zip(dy).enumerate() {
                            diff_value(&format!("{path}[{}]", j + n), p, q, out);
                        }
                    } else {
                        for (n, p) in dx.iter().enumerate() {
                            out.push(FieldChange {
                                path: format!("{path}[{}]", i + n),
                                before: p.clone(),
                                after: Value::Null,
                            });
                        }
                        for (n, q) in dy.iter().enumerate() {
                            out.push(FieldChange {
                                path: format!("{path}[{}]", j + n),
                                before: Value::Null,
                                after: q.clone(),
                            });
                        }
                    }
                };
            for (pi, pj) in pairs {
                emit(pi, pj, i, j, out);
                (i, j) = (pi + 1, pj + 1);
            }
            emit(x.len(), y.len(), i, j, out);
        }
        _ => out.push(FieldChange {
            path: path.into(),
            before: a.clone(),
            after: b.clone(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn agent(job: &str) -> Author {
        Author {
            kind: "agent".into(),
            id: "writer-1".into(),
            job: Some(job.into()),
            model: Some("gpt-6-luna".into()),
        }
    }

    fn post(title: &str, text: &str) -> Value {
        json!({"row": {"post_title": title, "post_status": "draft"}, "blocks": blocks::parse(&format!("<!-- wp:paragraph --><p>{text}</p><!-- /wp:paragraph -->"))})
    }

    fn repo() -> Repo {
        let mut r = Repo::new();
        r.import(
            vec![
                ("post:1".into(), Some(post("Hello", "first"))),
                ("option:blogname".into(), Some(json!({"value": "Spike"}))),
            ],
            Author::system("import"),
            "Import",
        )
        .unwrap();
        r
    }

    #[test]
    fn commits_are_digest_chained_attributed_and_deterministic() {
        let (mut a, mut b) = (repo(), repo());
        for r in [&mut a, &mut b] {
            r.create_branch("wi-7", LIVE).unwrap();
            let head = r.head("wi-7").cloned();
            r.commit_to(
                "wi-7",
                head.as_ref(),
                vec![("post:2".into(), Some(post("Harvest", "grapes")))],
                agent("job-3"),
                "Draft",
            )
            .unwrap();
        }
        assert_eq!(a.head("wi-7"), b.head("wi-7"), "same history, same digest");
        let c = a.commit(a.head("wi-7").unwrap()).unwrap();
        assert!(c.verify());
        assert_eq!(c.author.job.as_deref(), Some("job-3"));
        assert_eq!(c.parents, vec![a.head(LIVE).unwrap().clone()]);
        let mut tampered = c.clone();
        tampered.message = "Something else".into();
        assert!(!tampered.verify());
    }

    #[test]
    fn heads_move_by_compare_and_swap_and_live_is_protected() {
        let mut r = repo();
        r.create_branch("wi-1", LIVE).unwrap();
        let old = r.head("wi-1").cloned();
        r.commit_to(
            "wi-1",
            old.as_ref(),
            vec![("post:2".into(), Some(post("A", "a")))],
            agent("j1"),
            "a",
        )
        .unwrap();
        let stale = r.commit_to(
            "wi-1",
            old.as_ref(),
            vec![("post:3".into(), Some(post("B", "b")))],
            agent("j2"),
            "b",
        );
        assert!(matches!(stale, Err(RepoError::Stale { .. })));
        let live = r.head(LIVE).cloned();
        assert_eq!(
            r.commit_to(LIVE, live.as_ref(), vec![], agent("j"), "x"),
            Err(RepoError::LiveIsProtected)
        );
    }

    #[test]
    fn a_change_request_diffs_by_block_and_merges_into_live() {
        let mut r = repo();
        r.create_branch("wi-1", LIVE).unwrap();
        let h = r.head("wi-1").cloned();
        let mut p = post("Hello", "first");
        let extra = blocks::parse("<!-- wp:paragraph --><p>second</p><!-- /wp:paragraph -->");
        p["blocks"]
            .as_array_mut()
            .unwrap()
            .extend(extra.into_iter().map(|n| serde_json::to_value(n).unwrap()));
        r.commit_to(
            "wi-1",
            h.as_ref(),
            vec![("post:1".into(), Some(p))],
            agent("j1"),
            "Add a paragraph",
        )
        .unwrap();
        let cr = r
            .open_change_request("wi-1", LIVE, "Add a paragraph", agent("j1"), Some(1))
            .unwrap();
        let diff = r.change_request_diff(cr).unwrap();
        assert_eq!(diff.len(), 1);
        assert_eq!(diff[0].kind, "modified");
        assert_eq!(diff[0].fields.len(), 1, "{:?}", diff[0].fields);
        assert_eq!(diff[0].fields[0].path, "blocks[1]");
        let live = r.head(LIVE).cloned();
        let merged = r
            .merge_change_request(cr, live.as_ref(), Author::system("merge-queue"), &|_| {})
            .unwrap();
        assert_eq!(r.head(LIVE), Some(&merged));
        assert_eq!(r.commit(&merged).unwrap().parents.len(), 2);
        assert_eq!(r.change_request(cr).unwrap().status, CrStatus::Merged);
        let text = blocks::serialize(
            &serde_json::from_value::<Vec<blocks::Node>>(
                r.get(LIVE, "post:1").unwrap()["blocks"].clone(),
            )
            .unwrap(),
        );
        assert!(text.contains("second"));
    }

    #[test]
    fn two_branches_merge_three_way_and_a_real_conflict_is_typed() {
        let mut r = repo();
        for b in ["wi-1", "wi-2", "wi-3"] {
            r.create_branch(b, LIVE).unwrap();
        }
        let edit = |r: &mut Repo, b: &str, k: &str, v: Value| {
            let h = r.head(b).cloned();
            r.commit_to(b, h.as_ref(), vec![(k.into(), Some(v))], agent(b), b)
                .unwrap();
        };
        edit(&mut r, "wi-1", "post:1", post("Hello, Manarola", "first"));
        edit(
            &mut r,
            "wi-2",
            "option:blogname",
            json!({"value": "Cinque Terre"}),
        );
        edit(&mut r, "wi-3", "post:1", post("Hello, Vernazza", "first"));
        for b in ["wi-1", "wi-2"] {
            let cr = r.open_change_request(b, LIVE, b, agent(b), None).unwrap();
            let live = r.head(LIVE).cloned();
            r.merge_change_request(cr, live.as_ref(), Author::system("merge-queue"), &|_| {})
                .unwrap();
        }
        assert_eq!(
            r.get(LIVE, "post:1").unwrap()["row"]["post_title"],
            "Hello, Manarola"
        );
        assert_eq!(
            r.get(LIVE, "option:blogname").unwrap()["value"],
            "Cinque Terre"
        );
        let cr = r
            .open_change_request("wi-3", LIVE, "wi-3", agent("wi-3"), None)
            .unwrap();
        let live = r.head(LIVE).cloned();
        match r.merge_change_request(cr, live.as_ref(), Author::system("merge-queue"), &|_| {}) {
            Err(RepoError::Conflicts(c)) => {
                assert_eq!(c.len(), 1);
                assert_eq!(
                    (c[0].key.as_str(), c[0].path.as_str()),
                    ("post:1", "row.post_title")
                );
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(r.change_request(cr).unwrap().status, CrStatus::Open);
    }

    #[test]
    fn a_rollback_is_a_new_commit_with_the_release_s_content() {
        let mut r = repo();
        let v1 = r.release("v1").unwrap();
        r.create_branch("wi-1", LIVE).unwrap();
        let h = r.head("wi-1").cloned();
        r.commit_to(
            "wi-1",
            h.as_ref(),
            vec![("post:1".into(), None)],
            agent("j"),
            "Remove",
        )
        .unwrap();
        let cr = r
            .open_change_request("wi-1", LIVE, "Remove", agent("j"), None)
            .unwrap();
        let live = r.head(LIVE).cloned();
        r.merge_change_request(cr, live.as_ref(), Author::system("merge-queue"), &|_| {})
            .unwrap();
        assert!(r.get(LIVE, "post:1").is_none());
        let before = r.head(LIVE).cloned().unwrap();
        let rb = r.rollback(v1.id, Author::system("rollback")).unwrap();
        assert_eq!(
            r.commit(&rb).unwrap().tree,
            r.commit(&v1.commit).unwrap().tree
        );
        assert_eq!(r.commit(&rb).unwrap().parents, vec![before]);
    }

    #[test]
    fn records_restore_the_same_repository_and_reject_tampering() {
        let mut r = repo();
        r.create_branch("wi-1", LIVE).unwrap();
        let mut copy = Repo::new();
        copy.apply(r.all_records()).unwrap();
        assert_eq!(copy.head(LIVE), r.head(LIVE));
        assert_eq!(copy.materialize("wi-1"), r.materialize("wi-1"));
        let mut bad = r.all_records();
        if let Some(Record::Commit(c)) = bad.iter_mut().find(|x| matches!(x, Record::Commit(_))) {
            c.message = "forged".into();
        }
        assert!(matches!(
            Repo::new().apply(bad),
            Err(RepoError::Tampered(_))
        ));
        // incremental records equal the full export's facts
        let mut inc = Repo::new();
        let mut src = Repo::new();
        src.import(
            vec![("post:9".into(), Some(post("x", "y")))],
            Author::system("import"),
            "i",
        )
        .unwrap();
        inc.apply(src.take_records()).unwrap();
        assert_eq!(inc.head(LIVE), src.head(LIVE));
    }
}
