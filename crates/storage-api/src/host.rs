//! The storage API's host (ADR-0084 §3): the governed side of the fork's seams for one company.
//!
//! It keeps the repository and one projection per branch. WordPress's statements run on the
//! branch's projection; when a request ends, the objects it touched are read back and their
//! governed changes become one attributed commit on that branch. Scratch changes stay in the
//! projection and are never committed.
//!
//! - `live` is read-only for WordPress: work happens on branches and reaches `live` by a merged
//!   change request. The one exception is a new company's import: until [`Host::finish_import`],
//!   WordPress's installer runs on `live` and each request's result is imported.
//! - A projection follows its branch: when the head moved (a merge, another executor's segment),
//!   the changed objects are rewritten before the next statement.
//! - Ids never collide across branches: each projection's AUTOINCREMENT counters start at the
//!   repository's high-water marks, and every commit raises them.

use std::collections::BTreeMap;

use content_repo::{Author, Digest, Repo, RepoError, LIVE};

use crate::classify::{classify, Class};
use crate::objects;
use crate::projection::{Exec, Outcome, Projection, ProjectionError, WORDPRESS_SCHEMA};
use crate::translate::{translate, Translated};

#[derive(Debug)]
pub enum HostError {
    Projection(ProjectionError),
    Repo(RepoError),
    Exec(String),
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HostError::Projection(e) => write!(f, "{e}"),
            HostError::Repo(e) => write!(f, "{e}"),
            HostError::Exec(e) => write!(f, "{e}"),
        }
    }
}

impl From<ProjectionError> for HostError {
    fn from(e: ProjectionError) -> Self {
        HostError::Projection(e)
    }
}
impl From<RepoError> for HostError {
    fn from(e: RepoError) -> Self {
        HostError::Repo(e)
    }
}
impl From<String> for HostError {
    fn from(e: String) -> Self {
        HostError::Exec(e)
    }
}

struct Branch<E: Exec> {
    p: Projection<E>,
    built_from: Option<Digest>,
    /// Asset sidecars written during the current request (`asset:<path>` objects).
    assets: Vec<(String, serde_json::Value)>,
}

/// Opens an empty SQLite for a new projection.
pub type Opener<E> = Box<dyn FnMut() -> Result<E, String>>;

pub struct Host<E: Exec> {
    pub repo: Repo,
    prefix: String,
    open: Opener<E>,
    branches: BTreeMap<String, Branch<E>>,
    importing: bool,
}

impl<E: Exec> Host<E> {
    /// A host over `repo`. A repository without `live` starts in its import phase.
    pub fn new(repo: Repo, prefix: &str, open: Opener<E>) -> Host<E> {
        let importing = repo.head(LIVE).is_none();
        Host {
            repo,
            prefix: prefix.into(),
            open,
            branches: BTreeMap::new(),
            importing,
        }
    }

    /// Ends the import phase: from now on `live` changes only by merges.
    pub fn finish_import(&mut self) {
        self.importing = false;
    }

    pub fn importing(&self) -> bool {
        self.importing
    }

    /// The branch's projection, built or brought up to its head.
    fn ensure(&mut self, branch: &str) -> Result<&mut Branch<E>, HostError> {
        let head = self.repo.head(branch).cloned();
        if head.is_none() && !(branch == LIVE && self.importing) {
            return Err(RepoError::UnknownBranch(branch.into()).into());
        }
        let prefix = self.prefix.clone();
        if !self.branches.contains_key(branch) {
            // A new company's live starts without tables: WordPress's installer creates them
            // (from the governed definitions), as it would on an empty MySQL database.
            let ddl = if head.is_none() { "" } else { WORDPRESS_SCHEMA };
            let mut p = Projection::with((self.open)()?, ddl)?;
            for (k, v) in self.repo.materialize(branch) {
                objects::write_object(p.exec(), &prefix, &k, &v)?;
            }
            objects::install_capture(p.exec(), &prefix)?;
            self.branches.insert(
                branch.into(),
                Branch {
                    p,
                    built_from: head.clone(),
                    assets: Vec::new(),
                },
            );
        }
        let marks: BTreeMap<String, i64> = objects::ID_TABLES
            .iter()
            .map(|t| (t.to_string(), self.repo.high_water(t)))
            .collect();
        let from_tree = self.branches[branch]
            .built_from
            .as_ref()
            .and_then(|h| self.repo.commit(h))
            .map(|c| c.tree.clone())
            .unwrap_or_default();
        let behind = self.branches[branch].built_from != head;
        let changes = if behind {
            self.repo.diff_trees(&from_tree, &self.repo.tree(branch))
        } else {
            Vec::new()
        };
        let objects_now: Vec<(String, Option<serde_json::Value>)> = changes
            .iter()
            .map(|c| (c.key.clone(), self.repo.get(branch, &c.key).cloned()))
            .collect();
        let b = self.branches.get_mut(branch).expect("built above");
        for (k, v) in objects_now {
            objects::delete_object(b.p.exec(), &prefix, &k)?;
            if let Some(v) = v {
                objects::write_object(b.p.exec(), &prefix, &k, &v)?;
            }
        }
        objects::raise_sequences(b.p.exec(), &prefix, &marks)?;
        if behind {
            // The rewrite is the repository's own change, not the next request's.
            objects::take_changes(b.p.exec())?;
            b.built_from = head;
        }
        Ok(b)
    }

    /// Runs one statement from WordPress on `branch`.
    pub fn query(&mut self, branch: &str, sql: &str) -> Result<Outcome, HostError> {
        let read_only_live = branch == LIVE && !self.importing;
        let b = self.ensure(branch)?;
        let t = translate(sql, b.p.schema()).map_err(ProjectionError::Translate)?;
        if read_only_live {
            let tables: Vec<&String> = match &t {
                Translated::Sql {
                    write: Some(table), ..
                } => vec![table],
                Translated::MultiDelete { tables, .. } => tables.iter().collect(),
                _ => vec![],
            };
            if let Some(table) = tables
                .into_iter()
                .find(|table| classify(table, sql) == Class::Governed)
            {
                return Err(ProjectionError::LiveIsReadOnly(table.clone()).into());
            }
        }
        let out = b.p.run(&t)?;
        if matches!(t, Translated::Ddl(_)) {
            let prefix = self.prefix.clone();
            objects::install_capture(
                self.branches.get_mut(branch).expect("ensured").p.exec(),
                &prefix,
            )?;
        }
        Ok(out)
    }

    /// Ends a request on `branch`: its governed changes become one commit by `author`.
    /// Returns the new head, or `None` when the request changed only scratch state.
    pub fn end_request(
        &mut self,
        branch: &str,
        author: Author,
        message: &str,
    ) -> Result<Option<Digest>, HostError> {
        let prefix = self.prefix.clone();
        let b = self.ensure(branch)?;
        let keys = objects::take_changes(b.p.exec())?;
        let mut read = Vec::new();
        for k in keys {
            read.push((k.clone(), objects::read_object(b.p.exec(), &prefix, &k)?));
        }
        for (k, v) in std::mem::take(&mut b.assets) {
            read.push((k, Some(v)));
        }
        let marks = objects::sequences(b.p.exec(), &prefix)?;
        let changes: Vec<(String, Option<serde_json::Value>)> = read
            .into_iter()
            .filter(|(k, v)| self.repo.get(branch, k) != v.as_ref())
            .collect();
        for (t, id) in marks {
            self.repo.note_id(&t, id);
        }
        if changes.is_empty() {
            return Ok(None);
        }
        let head = if branch == LIVE {
            if !self.importing {
                // A governed change the classifier let through: undo it by rebuilding.
                self.branches.remove(LIVE);
                return Err(ProjectionError::LiveIsReadOnly(changes[0].0.clone()).into());
            }
            self.repo.import(changes, author, message)?
        } else {
            let expected = self.repo.head(branch).cloned();
            self.repo
                .commit_to(branch, expected.as_ref(), changes, author, message)?
        };
        if let Some(b) = self.branches.get_mut(branch) {
            b.built_from = head.clone();
        }
        Ok(head)
    }

    /// Creates every core table on `branch` from the governed definitions: for an import from a
    /// database whose installer did not send its own CREATE TABLE statements.
    pub fn create_core_tables(&mut self, branch: &str) -> Result<(), HostError> {
        let prefix = self.prefix.clone();
        let b = self.ensure(branch)?;
        for (table, stmts) in crate::translate::Schema::ddl_by_table(WORDPRESS_SCHEMA) {
            if b.p.schema().columns.contains_key(&table) {
                continue;
            }
            let unique = crate::translate::Schema::from_sqlite_ddl(&stmts.join(";\n"))
                .unique
                .remove(&table)
                .unwrap_or_default();
            b.p.run(&Translated::Ddl(crate::ddl::Ddl {
                table,
                stmts,
                unique,
            }))?;
        }
        objects::install_capture(b.p.exec(), &prefix)?;
        Ok(())
    }

    /// Records a file WordPress wrote under its uploads directory: the bytes are in object
    /// storage under `sha256`; the sidecar (`asset:<path>`) joins the request's commit.
    pub fn put_asset(
        &mut self,
        branch: &str,
        path: &str,
        sha256: &str,
        mime: &str,
        size: u64,
    ) -> Result<(), HostError> {
        let b = self.ensure(branch)?;
        let key = format!("asset:{path}");
        b.assets.retain(|(k, _)| *k != key);
        b.assets.push((
            key,
            serde_json::json!({"sha256": sha256, "mime": mime, "size": size}),
        ));
        Ok(())
    }

    /// The object-storage digest of an uploaded file on `branch` (this request's, or committed).
    pub fn asset(&self, branch: &str, path: &str) -> Option<String> {
        let key = format!("asset:{path}");
        let pending = self.branches.get(branch).and_then(|b| {
            b.assets
                .iter()
                .rev()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.clone())
        });
        pending
            .or_else(|| self.repo.get(branch, &key).cloned())
            .and_then(|v| v.get("sha256").and_then(|s| s.as_str()).map(str::to_string))
    }

    /// Forgets a branch's projection (its scratch state goes with it).
    pub fn drop_projection(&mut self, branch: &str) {
        self.branches.remove(branch);
    }

    /// The branch's projection, for reading (tests, the export).
    pub fn projection(&mut self, branch: &str) -> Result<&mut Projection<E>, HostError> {
        Ok(&mut self.ensure(branch)?.p)
    }
}
