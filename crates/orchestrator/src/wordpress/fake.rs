//! An in-memory [`SiteEngine`] for tests: branches of posts, change requests, merges into
//! `live`, and the attribution of every commit, without WordPress.

use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;

use super::{ChangeRequestRef, PostRef, SiteEngine, WpPost, WpPostFile, LIVE};
use crate::gateway::{Attribution, DeployState, GatewayError, Redeploy};

#[derive(Debug, Clone, Default)]
struct Branch {
    posts: BTreeMap<u64, (WpPost, u64)>,
    head: u64,
    /// The theme as data (ADR-0093), as JSON.
    theme: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FakeCr {
    pub branch: String,
    pub title: String,
    pub merged: Option<String>,
}

#[derive(Default)]
struct State {
    branches: BTreeMap<String, Branch>,
    crs: BTreeMap<u64, FakeCr>,
    next_post: u64,
    next_commit: u64,
    commits: BTreeMap<String, Attribution>,
    merges: u32,
    deploy: BTreeMap<u64, DeployState>,
    models: Option<serde_json::Value>,
    designs: BTreeMap<u32, serde_json::Value>,
}

/// The fake: `live` starts empty; [`FakeSiteEngine::put_live`] seeds it.
pub struct FakeSiteEngine(Mutex<State>);

impl Default for FakeSiteEngine {
    fn default() -> Self {
        let mut s = State {
            next_post: 100,
            ..State::default()
        };
        s.branches.insert(LIVE.into(), Branch::default());
        Self(Mutex::new(s))
    }
}

fn sha(n: u64) -> String {
    format!("{n:040x}")
}

impl FakeSiteEngine {
    pub fn new() -> Self {
        Self::default()
    }

    fn st(&self) -> std::sync::MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// A post on `live` (a site that existed before the company).
    pub fn put_live(&self, post: WpPost) -> u64 {
        let mut s = self.st();
        s.next_post += 1;
        let id = s.next_post;
        s.next_commit += 1;
        let c = s.next_commit;
        let live = s.branches.get_mut(LIVE).expect("live exists");
        live.posts.insert(id, (post, c));
        live.head = c;
        id
    }

    pub fn post(&self, branch: &str, slug: &str) -> Option<WpPost> {
        self.st()
            .branches
            .get(branch)?
            .posts
            .values()
            .find(|(p, _)| p.slug == slug)
            .map(|(p, _)| p.clone())
    }

    pub fn head(&self, branch: &str) -> Option<String> {
        self.st().branches.get(branch).map(|b| sha(b.head))
    }

    pub fn attribution(&self, commit: &str) -> Option<Attribution> {
        self.st().commits.get(commit).cloned()
    }

    pub fn merge_count(&self) -> u32 {
        self.st().merges
    }

    pub fn change_requests(&self) -> Vec<FakeCr> {
        self.st().crs.values().cloned().collect()
    }

    /// The site's structural models (as `site_models` answers them).
    pub fn set_models(&self, models: serde_json::Value) {
        self.st().models = Some(models);
    }

    pub fn models(&self) -> Option<serde_json::Value> {
        self.st().models.clone()
    }

    pub fn set_deploy_state(&self, cr: u64, state: DeployState) {
        self.st().deploy.insert(cr, state);
    }

    /// A design version of the site as the design store answers it.
    pub fn put_design(&self, version: u32, answer: serde_json::Value) {
        self.st().designs.insert(version, answer);
    }

    /// The theme data on `branch` (JSON), if any.
    pub fn theme(&self, branch: &str) -> Option<String> {
        self.st().branches.get(branch)?.theme.clone()
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl SiteEngine for FakeSiteEngine {
    async fn branch_for(&self, name: &str) -> Result<String, GatewayError> {
        let mut s = self.st();
        if !s.branches.contains_key(name) {
            let live = s.branches[LIVE].clone();
            s.branches.insert(name.to_string(), live);
        }
        Ok(name.to_string())
    }

    async fn find_post(
        &self,
        branch: &str,
        post_type: &str,
        slug: &str,
    ) -> Result<Option<WpPostFile>, GatewayError> {
        let s = self.st();
        let b = s
            .branches
            .get(branch)
            .ok_or_else(|| GatewayError(format!("no branch {branch}")))?;
        Ok(b.posts
            .iter()
            .find(|(_, (p, _))| p.slug == slug && p.post_type == post_type)
            .map(|(id, (p, v))| WpPostFile {
                id: *id,
                post: p.clone(),
                version: format!("v{v}"),
                featured_url: p
                    .featured_media
                    .map(|m| format!("https://media.example/{m}.jpg")),
            }))
    }

    async fn save_post(
        &self,
        branch: &str,
        id: Option<u64>,
        post: &WpPost,
        author: &Attribution,
    ) -> Result<PostRef, GatewayError> {
        if branch == LIVE {
            return Err(GatewayError("live refuses governed writes".into()));
        }
        let mut s = self.st();
        let id = match id {
            Some(i) => i,
            None => {
                s.next_post += 1;
                s.next_post
            }
        };
        s.next_commit += 1;
        let c = s.next_commit;
        s.commits.insert(sha(c), author.clone());
        let b = s
            .branches
            .get_mut(branch)
            .ok_or_else(|| GatewayError(format!("no branch {branch}")))?;
        b.posts.insert(id, (post.clone(), c));
        b.head = c;
        Ok(PostRef {
            id,
            link: format!("https://site.example/{}/", post.slug),
        })
    }

    async fn open_change_request(
        &self,
        branch: &str,
        title: &str,
        _author: &Attribution,
    ) -> Result<ChangeRequestRef, GatewayError> {
        let mut s = self.st();
        let head = sha(s
            .branches
            .get(branch)
            .ok_or_else(|| GatewayError(format!("no branch {branch}")))?
            .head);
        let open = s
            .crs
            .iter()
            .find(|(_, c)| c.branch == branch && c.merged.is_none())
            .map(|(id, _)| *id);
        let id = match open {
            Some(id) => id,
            None => {
                let id = s.crs.keys().next_back().copied().unwrap_or(0) + 1;
                s.crs.insert(
                    id,
                    FakeCr {
                        branch: branch.to_string(),
                        title: title.to_string(),
                        merged: None,
                    },
                );
                id
            }
        };
        Ok(ChangeRequestRef {
            id,
            branch: branch.to_string(),
            head,
        })
    }

    async fn merge(
        &self,
        id: u64,
        head: &str,
        author: &Attribution,
    ) -> Result<String, GatewayError> {
        let mut s = self.st();
        let cr = s
            .crs
            .get(&id)
            .cloned()
            .ok_or_else(|| GatewayError(format!("no change request {id}")))?;
        if let Some(m) = cr.merged {
            return Ok(m);
        }
        let src = s.branches[&cr.branch].clone();
        if sha(src.head) != head {
            return Err(GatewayError(format!(
                "change request {id} moved since {head}"
            )));
        }
        s.next_commit += 1;
        let c = s.next_commit;
        s.commits.insert(sha(c), author.clone());
        let live = s.branches.get_mut(LIVE).expect("live exists");
        for (pid, (p, _)) in src.posts {
            live.posts.insert(pid, (p, c));
        }
        if src.theme.is_some() {
            live.theme = src.theme;
        }
        live.head = c;
        s.merges += 1;
        s.crs.get_mut(&id).expect("exists").merged = Some(sha(c));
        Ok(sha(c))
    }

    async fn put_theme_data(
        &self,
        branch: &str,
        data: &site_design::ThemeData,
        author: &Attribution,
    ) -> Result<String, GatewayError> {
        if branch == LIVE {
            return Err(GatewayError("live refuses governed writes".into()));
        }
        let text = serde_json::to_string(data).map_err(|e| GatewayError(e.to_string()))?;
        let mut s = self.st();
        let same = s
            .branches
            .get(branch)
            .ok_or_else(|| GatewayError(format!("no branch {branch}")))?
            .theme
            .as_deref()
            == Some(text.as_str());
        if !same {
            s.next_commit += 1;
            let c = s.next_commit;
            s.commits.insert(sha(c), author.clone());
            let b = s.branches.get_mut(branch).expect("checked");
            b.theme = Some(text);
            b.head = c;
        }
        Ok(sha(s.branches[branch].head))
    }

    async fn site_design(&self, version: u32) -> Result<serde_json::Value, GatewayError> {
        self.st()
            .designs
            .get(&version)
            .cloned()
            .ok_or_else(|| GatewayError(format!("no design version {version}")))
    }

    async fn release_status(&self, id: u64) -> Result<Option<DeployState>, GatewayError> {
        Ok(self.st().deploy.get(&id).copied())
    }

    async fn redeploy(&self, id: u64) -> Result<Redeploy, GatewayError> {
        self.st().deploy.insert(id, DeployState::Pending);
        Ok(Redeploy {
            state: DeployState::Pending,
            requested: true,
            run_id: None,
            attempt: 1,
            detail: None,
        })
    }
    async fn site_models(&self) -> Result<serde_json::Value, GatewayError> {
        self.st()
            .models
            .clone()
            .ok_or_else(|| GatewayError("no models in the fake".into()))
    }

    async fn put_blueprint(
        &self,
        body: &serde_json::Value,
    ) -> Result<crate::gateway::ModelsPut, GatewayError> {
        let mut s = self.st();
        let models = s
            .models
            .as_mut()
            .ok_or_else(|| GatewayError("no models in the fake".into()))?;
        if body["base_hash"] != models["hash"] {
            return Ok(crate::gateway::ModelsPut::Stale {
                error: "the site's structure changed".into(),
            });
        }
        models["blueprint"] = body["blueprint"].clone();
        models["hash"] = serde_json::json!(format!("{}+", models["hash"].as_str().unwrap_or("")));
        s.next_commit += 1;
        let c = sha(s.next_commit);
        Ok(crate::gateway::ModelsPut::Landed {
            commit: c,
            hash: String::new(),
            changes: vec![],
            tools: vec![],
        })
    }
}
