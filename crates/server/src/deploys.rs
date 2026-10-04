//! Deploy observation (ADR-0061 decision 7): what became of a merge.
//!
//! A merged gateway pull request is `pending` until a deployment that
//! contains it is seen to succeed (`landed`) or its deployment is seen to
//! fail (`failed`). Three sources report here, and all go through the same
//! two transitions ([`land_through`] and [`fail`]), so each pull request
//! lands or fails once however many sources see it:
//!
//! - the `deployment_status` webhook ([`crate::webhooks`]), `source: "webhook"`;
//! - the poller in this module, `source: "poll"`: a server on localhost
//!   receives no webhooks, so with a real GitHub a background task asks for
//!   the check runs of every merged, unlanded commit;
//! - `SWARMPRESS_SIMULATE_DEPLOY` (fake GitHub only), `source: "simulated"`.
//!
//! **At or before.** The site's deploy workflow runs in one concurrency
//! group, and GitHub drops a queued run when a newer one arrives. A burst of
//! merges therefore produces fewer deployments than merges. A successful
//! deployment of the merge commit S contains every earlier merge, so it
//! lands every unlanded gateway pull request of that repository merged at or
//! before S ([`db::gateway::land`] with `merged_at <= S.merged_at`).
//!
//! **What the check runs mean** ([`verdict`]). The merge commit carries the
//! deploy workflow's jobs as check runs (`build`, `deploy`):
//!
//! | Check runs of the merge commit | Verdict |
//! |---|---|
//! | the deploy check completed with `success` | `Success` |
//! | any check completed with `failure`, `timed_out`, `startup_failure` or `action_required` | `Failed` |
//! | any check not completed yet | `Running` |
//! | none, or only `cancelled`, `skipped`, `neutral`, `stale` ones | `Idle` (not started, or superseded) |
//!
//! A superseded merge (`Idle`) with a later merge whose deployment failed,
//! and nothing still running after it, failed with that deployment
//! ([`plan`]). A merge still `pending` after
//! `SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS` fails as `timed_out`: the poller
//! stops asking, and says so. A failed merge lands later if a later
//! deployment succeeds.
//!
//! The poller never runs with the fake GitHub or with simulated deploys
//! ([`enabled`]); simulated deploys with a real GitHub are a startup error
//! (`Config::validate`).

use std::collections::BTreeMap;

use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use github::{CheckConclusion, CheckRun, CheckStatus, GitHubError};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::task::JoinHandle;

use crate::app::{require_company, AppState};
use crate::auth::CurrentUser;
use crate::companies::require_lease;
use crate::db::gateway::{self as store, GatewayPr, Land, WatchedPr};
use crate::error::{AppError, AppResult};
use crate::events::{self, kinds};
use crate::gateway::{company_repo, gh_error, parse_repo, RepoBackend};

pub const SOURCE_POLL: &str = "poll";
pub const SOURCE_WEBHOOK: &str = "webhook";
pub const SOURCE_SIMULATED: &str = "simulated";

/// What one commit's check runs say about its deployment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The deploy check succeeded: the commit is live.
    Success,
    /// A check failed for good; the text names it.
    Failed(String),
    /// Something is queued or in progress.
    Running,
    /// No decisive check: nothing started yet, or the run was superseded.
    Idle,
}

fn conclusion_name(c: CheckConclusion) -> String {
    serde_json::to_value(c)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "unknown".to_string())
}

/// The verdict of the check runs of one merge commit; `deploy_check` is the
/// name of the check that publishes the site (`SWARMPRESS_DEPLOY_CHECK`).
pub fn verdict(runs: &[CheckRun], deploy_check: &str) -> Verdict {
    let done = |r: &&CheckRun| r.status == CheckStatus::Completed;
    if runs
        .iter()
        .filter(done)
        .any(|r| r.name == deploy_check && r.conclusion == Some(CheckConclusion::Success))
    {
        return Verdict::Success;
    }
    let hard_failure = |c: CheckConclusion| {
        matches!(
            c,
            CheckConclusion::Failure
                | CheckConclusion::TimedOut
                | CheckConclusion::StartupFailure
                | CheckConclusion::ActionRequired
        )
    };
    if let Some((run, why)) = runs
        .iter()
        .filter(done)
        .find_map(|r| r.conclusion.filter(|c| hard_failure(*c)).map(|c| (r, c)))
    {
        return Verdict::Failed(format!(
            "check `{}` concluded {}",
            run.name,
            conclusion_name(why)
        ));
    }
    if runs.iter().any(|r| r.status != CheckStatus::Completed) {
        return Verdict::Running;
    }
    Verdict::Idle
}

/// Why [`plan`] fails a merge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failure {
    /// Its own deployment failed.
    Own(String),
    /// Its run was superseded, and the deployment of the merge at this index
    /// (which contains it) failed.
    SupersededBy(usize),
}

/// What to do with the watched merges of one repository.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    /// Land every merge up to and including this index.
    pub land_through: Option<usize>,
    /// Fail these merges (index, why), oldest first.
    pub fail: Vec<(usize, Failure)>,
}

/// Decide from the verdicts of a repository's merged, unlanded pull
/// requests, **oldest first**.
///
/// - The newest success lands itself and everything before it.
/// - After that point, a failed merge fails; an idle one fails only when a
///   later merge failed and nothing is still running after it (its content
///   went out with that failed deployment); a running one waits.
pub fn plan(verdicts: &[Verdict]) -> Plan {
    let land_through = verdicts.iter().rposition(|v| *v == Verdict::Success);
    let from = land_through.map_or(0, |j| j + 1);
    let mut fail = Vec::new();
    let mut later_failure = None;
    let mut later_running = false;
    for i in (from..verdicts.len()).rev() {
        match &verdicts[i] {
            Verdict::Failed(why) => {
                fail.push((i, Failure::Own(why.clone())));
                later_failure = Some(i);
            }
            Verdict::Idle => {
                if let (Some(k), false) = (later_failure, later_running) {
                    fail.push((i, Failure::SupersededBy(k)));
                }
            }
            Verdict::Running => later_running = true,
            Verdict::Success => {}
        }
    }
    fail.reverse();
    Plan { land_through, fail }
}

/// The payload of a `DeployLanded` / `DeployFailed` event.
///
/// `merged_sha` is the pull request's own squash commit; `deployed_sha` is
/// the commit whose deployment was observed (the same, or a later merge).
pub fn payload(
    pr: Option<&GatewayPr>,
    state: &str,
    source: &str,
    deployed_sha: Option<&str>,
    detail: Option<&str>,
    environment: Option<&str>,
) -> Value {
    json!({
        "content_id": pr.map(|p| p.content_id.clone()),
        "work_item": pr.and_then(|p| p.work_item.clone()),
        "number": pr.map(|p| p.number),
        "merged_sha": pr.and_then(|p| p.merged_sha.clone()).or_else(|| deployed_sha.map(String::from)),
        "deployed_sha": deployed_sha,
        "state": state,
        "detail": detail,
        "environment": environment,
        "source": source,
        // How many redeploys preceded this event: a `DeployFailed` with a
        // higher attempt is a new failure, not a repeated event.
        "attempt": pr.map_or(0, |p| p.deploy_attempt),
    })
}

/// A successful deployment was observed. `scope` says which merges it
/// contains; each one that was not landed yet lands now and gets one
/// `DeployLanded` event. Returns how many landed.
pub async fn land(
    st: &AppState,
    scope: Land<'_>,
    source: &str,
    deployed_sha: Option<&str>,
    environment: Option<&str>,
) -> AppResult<usize> {
    let detail = deployed_sha.map(|sha| format!("deployment of {sha} ({source})"));
    let landed = store::land(
        &st.db,
        scope,
        st.now_ms(),
        detail.as_deref(),
        kinds::DEPLOY_LANDED,
        &|pr| payload(Some(pr), "success", source, deployed_sha, None, environment),
    )
    .await?;
    let n = landed.len();
    for (pr, ev) in landed {
        tracing::info!(company_id = %pr.company_id, number = pr.number, source, "deploy landed");
        events::announce(st, ev);
    }
    Ok(n)
}

/// The deployment of `pr` failed (`state`: `failure`, `error`, `timed_out`).
/// A pending merge becomes `failed` and gets one `DeployFailed` event; a
/// merge that already landed or failed is left alone. Returns whether it
/// changed.
pub async fn fail(
    st: &AppState,
    pr: &GatewayPr,
    state: &str,
    detail: &str,
    source: &str,
    deployed_sha: Option<&str>,
    environment: Option<&str>,
) -> AppResult<bool> {
    let event = store::fail(
        &st.db,
        &pr.company_id,
        pr.number,
        detail,
        deployed_sha,
        st.now_ms(),
        kinds::DEPLOY_FAILED,
        &payload(
            Some(pr),
            state,
            source,
            deployed_sha,
            Some(detail),
            environment,
        ),
    )
    .await?;
    match event {
        Some(ev) => {
            tracing::warn!(company_id = %pr.company_id, number = pr.number, source, detail, "deploy failed");
            events::announce(st, ev);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(Deserialize)]
pub struct StatusQuery {
    #[serde(default)]
    pub number: Option<u64>,
    #[serde(default)]
    pub work_item: Option<String>,
}

/// `GET /api/gateway/deploy-status?number=<n>` (or `?work_item=<id>`: the
/// newest pull request of that work item) → what became of one of the
/// company's gateway pull requests:
///
/// ```json
/// { "number": 12, "content_id": "content-1a2b", "work_item": "work-item-4",
///   "path": "content/pages/blog/x.json",
///   "state": "open | closed | pending | landed | failed | unknown",
///   "merged_sha": null, "merged_at": null, "landed_at": null, "closed_at": null,
///   "detail": null, "checked_at": null, "now": 1790933400250 }
/// ```
///
/// A read for the browser's deploy watchdog: it needs a session, not the
/// lease, and asks GitHub nothing. Instants are unix milliseconds on the
/// server's clock; `now` is that clock, so the caller can compute ages
/// without trusting its own. `checked_at` is when the poller last asked
/// GitHub about the merge; `detail` says why a deployment failed, or which
/// commit's deployment landed the merge. 400 unless exactly one of `number`
/// and `work_item` is given; 404 when the company has no such pull request.
pub async fn status(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    Query(q): Query<StatusQuery>,
) -> AppResult<Json<Value>> {
    let company = require_company(&st, &user.id).await?;
    let pr = match (q.number, q.work_item.as_deref().filter(|w| !w.is_empty())) {
        (Some(n), None) => {
            let number =
                i64::try_from(n).map_err(|_| AppError::BadRequest("number out of range".into()))?;
            store::get_pr(&st.db, &company.id, number).await?
        }
        (None, Some(w)) => store::latest_pr_for_work_item(&st.db, &company.id, w).await?,
        _ => {
            return Err(AppError::BadRequest(
                "give exactly one of `number` and `work_item`".into(),
            ))
        }
    }
    .ok_or_else(|| AppError::NotFound("no such gateway pull request of this company".into()))?;
    Ok(Json(json!({
        "number": pr.number,
        "content_id": pr.content_id,
        "work_item": pr.work_item,
        "path": pr.path,
        "state": pr.state(),
        "merged_sha": pr.merged_sha,
        "merged_at": pr.merged_at,
        "landed_at": pr.landed_at,
        "closed_at": pr.closed_at,
        "detail": pr.deploy_detail,
        "checked_at": pr.deploy_checked_at,
        "now": st.now_ms(),
    })))
}

#[derive(Deserialize)]
pub struct RedeployBody {
    #[serde(default)]
    pub number: Option<u64>,
    #[serde(default)]
    pub work_item: Option<String>,
}

/// A GitHub error of a redeploy, for the HTTP surface: a refusal by GitHub
/// (no permission, a run that cannot be re-run) is a 403 that says what is
/// missing; everything else as [`gh_error`].
fn redeploy_error(e: GitHubError) -> AppError {
    match e {
        GitHubError::Forbidden(m) | GitHubError::Unauthorized(m) => AppError::Forbidden(format!(
            "GitHub refused to re-run the deploy workflow: {m} (the token or GitHub App needs \
             the Actions write permission, and the run must be re-runnable)"
        )),
        e => gh_error(e),
    }
}

/// `POST /api/gateway/redeploy {number}` (or `{work_item}`: the newest pull
/// request of that work item) → deploy a merge whose deployment failed
/// again (FEAT-085, ADR-0059, ADR-0061 decision 7):
///
/// ```json
/// { "number": 12, "work_item": "work-item-4", "state": "pending",
///   "requested": true, "run_id": 30433642, "run_attempt": 1, "attempt": 1,
///   "detail": "re-run of the failed jobs of workflow run 30433642 (attempt 1) requested" }
/// ```
///
/// Lease-fenced like the other gateway writes. The pull request must be
/// `failed`: the server finds the newest run of the deploy workflow
/// (`SWARMPRESS_DEPLOY_WORKFLOW`, default `deploy.yml`) on the commit whose
/// deployment failed (the merge, or the later merge that superseded it) and
/// asks GitHub to re-run its failed jobs: a new attempt of the same run on
/// the same commit, so the poller and the webhook observe it like the first.
/// The merge is `pending` again from now (`attempt` counts the redeploys) and
/// lands, or fails with a new `DeployFailed` whose payload carries the
/// `attempt`.
///
/// - Idempotent per failed run attempt: a merge already `pending` again
///   answers 200 with `requested: false` and asks GitHub nothing.
/// - A run that is still going, or that succeeded after all, is not re-run:
///   the merge is `pending` again and the observation decides.
/// - Refused: 409 for a merge that landed, or a pull request that is not
///   merged (open, closed, merged before deploys were watched); 409 when the
///   commit has no run of the deploy workflow to re-run (nothing ran); 403
///   when GitHub refuses the re-run (the Actions write permission). The merge
///   then stays `failed`.
pub async fn redeploy(
    State(st): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
    Json(body): Json<RedeployBody>,
) -> AppResult<Json<Value>> {
    // Held to the end of the handler: the lease check, the GitHub call and
    // the bookkeeping are one fenced unit (ADR-0045).
    let fenced = require_lease(&st, &headers, &user).await?;
    let company = &fenced.company;
    let pr = match (
        body.number,
        body.work_item.as_deref().filter(|w| !w.is_empty()),
    ) {
        (Some(n), None) => {
            let number =
                i64::try_from(n).map_err(|_| AppError::BadRequest("number out of range".into()))?;
            store::get_pr(&st.db, &company.id, number).await?
        }
        (None, Some(w)) => store::latest_pr_for_work_item(&st.db, &company.id, w).await?,
        _ => {
            return Err(AppError::BadRequest(
                "give exactly one of `number` and `work_item`".into(),
            ))
        }
    }
    .ok_or_else(|| AppError::NotFound("no such gateway pull request of this company".into()))?;
    let number = pr.number;
    let reply = |pr: &GatewayPr, requested: bool, run: Option<(u64, u32)>| {
        Json(json!({
            "number": pr.number,
            "work_item": pr.work_item,
            "state": pr.state(),
            "requested": requested,
            "run_id": run.map(|r| r.0),
            "run_attempt": run.map(|r| r.1),
            "attempt": pr.deploy_attempt,
            "detail": pr.deploy_detail,
        }))
    };
    match pr.state() {
        "failed" => {}
        // Already waiting for a deployment (redeployed before, or never
        // failed): nothing to do.
        "pending" => return Ok(reply(&pr, false, None)),
        "landed" => {
            return Err(AppError::Conflict(format!(
                "PR #{number} has landed: there is nothing to redeploy"
            )))
        }
        other => {
            return Err(AppError::Conflict(format!(
                "PR #{number} is {other}: only a merge whose deployment failed can be redeployed"
            )))
        }
    }
    let now = st.now_ms();
    let marked = |rerun: Option<String>, detail: String| {
        let st = st.clone();
        let company_id = company.id.clone();
        async move {
            store::redeploy(&st.db, &company_id, number, rerun.as_deref(), &detail, now)
                .await?
                .ok_or_else(|| {
                    AppError::Conflict(format!("PR #{number} changed while it was redeployed"))
                })
        }
    };

    let Some(sha) = pr
        .deploy_failed_sha
        .clone()
        .or_else(|| pr.merged_sha.clone())
    else {
        return Err(AppError::Conflict(format!(
            "PR #{number} has no merge commit"
        )));
    };
    let repo = company_repo(&st, company)?;
    let api = st.github.api_for(&repo).await?;
    let workflow = &st.cfg.deploys.workflow;
    let run = api
        .list_workflow_runs(&repo, &sha)
        .await
        .map_err(redeploy_error)?
        .into_iter()
        .filter(|r| r.workflow_file() == workflow)
        .max_by_key(|r| (r.id, r.run_attempt))
        .ok_or_else(|| {
            AppError::Conflict(format!(
                "no run of the deploy workflow `{workflow}` on {sha}: there is nothing to re-run \
                 (start the workflow by hand, or merge again)"
            ))
        })?;
    let attempt_key = format!("{}:{}", run.id, run.run_attempt);
    let (pr, requested) = match (run.status, run.conclusion) {
        (CheckStatus::Completed, Some(CheckConclusion::Success)) => (
            marked(
                None,
                format!(
                    "workflow run {} succeeded (attempt {}); waiting for its deployment to be observed",
                    run.id, run.run_attempt
                ),
            )
            .await?,
            false,
        ),
        (CheckStatus::Completed, _) if pr.deploy_rerun.as_deref() == Some(attempt_key.as_str()) => {
            // This attempt was re-run already: no second request to GitHub.
            (
                marked(
                    None,
                    format!(
                        "workflow run {} (attempt {}) was re-run already",
                        run.id, run.run_attempt
                    ),
                )
                .await?,
                false,
            )
        }
        (CheckStatus::Completed, _) => {
            api.rerun_failed_jobs(&repo, run.id)
                .await
                .map_err(redeploy_error)?;
            (
                marked(
                    Some(attempt_key),
                    format!(
                        "re-run of the failed jobs of workflow run {} (attempt {}) requested",
                        run.id, run.run_attempt
                    ),
                )
                .await?,
                true,
            )
        }
        _ => (
            marked(
                None,
                format!(
                    "workflow run {} (attempt {}) is running",
                    run.id, run.run_attempt
                ),
            )
            .await?,
            false,
        ),
    };
    tracing::info!(company_id = %company.id, number, run_id = run.id, run_attempt = run.run_attempt, requested, "gateway redeploy");
    Ok(reply(&pr, requested, Some((run.id, run.run_attempt))))
}

/// Whether the poller runs: a real GitHub with credentials, and no
/// simulated deploys.
pub fn enabled(st: &AppState) -> bool {
    let real = matches!(*st.github, RepoBackend::Token(_) | RepoBackend::App { .. });
    real && !st.cfg.simulate_deploy
}

/// Start the poller, if it is [`enabled`].
pub fn spawn(st: &AppState) -> Option<JoinHandle<()>> {
    if !enabled(st) {
        return None;
    }
    let st = st.clone();
    let every = st.cfg.deploys.poll_interval;
    tracing::info!(every = ?every, check = %st.cfg.deploys.check_name, "deploy poller started");
    Some(tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            match poll_once(&st).await {
                Ok(r) if r.landed + r.failed + r.errors > 0 => {
                    tracing::info!(?r, "deploy poll");
                }
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "deploy poll failed"),
            }
        }
    }))
}

/// What one round of polling did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PollReport {
    /// Merge commits GitHub was asked about.
    pub checked: usize,
    pub landed: usize,
    pub failed: usize,
    /// Repositories or commits that could not be read this round.
    pub errors: usize,
}

/// Whether a redeploy of `pr` was requested less than one poll interval ago.
/// Until then a failed verdict may still be the failed attempt's: GitHub
/// replaces the check runs only once the new attempt's jobs are queued.
fn redeployed_recently(pr: &GatewayPr, now: i64, cfg: &crate::config::DeployWatchConfig) -> bool {
    let grace = i64::try_from(cfg.poll_interval.as_millis()).unwrap_or(i64::MAX / 4);
    pr.deploy_since
        .is_some_and(|t| now.saturating_sub(t) < grace)
}

/// One round: time out what was pending for too long, then ask GitHub for
/// the check runs of the watched merges of every repository and apply the
/// [`plan`]. Works against whatever backend the state has (tests drive it
/// with the fake); [`spawn`] is what keeps it away from the fake.
pub async fn poll_once(st: &AppState) -> AppResult<PollReport> {
    let cfg = &st.cfg.deploys;
    let now = st.now_ms();
    let max_age_ms = i64::try_from(cfg.max_age.as_millis()).unwrap_or(i64::MAX / 4);
    let since = now.saturating_sub(max_age_ms);
    let mut report = PollReport::default();

    for pr in store::stale_pending(&st.db, since).await? {
        let detail = format!(
            "no deployment was observed within {} s of the merge",
            cfg.max_age.as_secs()
        );
        if fail(st, &pr, "timed_out", &detail, SOURCE_POLL, None, None).await? {
            report.failed += 1;
        }
    }

    // Oldest first within each repository.
    let mut by_repo: BTreeMap<String, Vec<WatchedPr>> = BTreeMap::new();
    for w in store::watched_prs(&st.db, since).await? {
        by_repo
            .entry(w.site_repo.to_ascii_lowercase())
            .or_default()
            .push(w);
    }
    for (repo_name, mut watched) in by_repo {
        // Under a backlog, the newest ones decide the most.
        if watched.len() > cfg.batch {
            watched.drain(..watched.len() - cfg.batch);
        }
        let Some(repo) = parse_repo(&watched[0].site_repo) else {
            report.errors += 1;
            continue;
        };
        let api = match st.github.api_for(&repo).await {
            Ok(api) => api,
            Err(e) => {
                tracing::warn!(repo = %repo_name, error = %e, "deploy poll: no access to the repository");
                report.errors += 1;
                continue;
            }
        };
        let mut verdicts = Vec::with_capacity(watched.len());
        let mut rate_limited = false;
        for w in &watched {
            let sha = w.pr.merged_sha.as_deref().unwrap_or_default();
            let v = match api.list_check_runs(&repo, sha).await {
                Ok(runs) => {
                    report.checked += 1;
                    match verdict(&runs, &cfg.check_name) {
                        // A redeploy was just requested: the failed check runs
                        // may not have been replaced by the new attempt's yet.
                        Verdict::Failed(_) if redeployed_recently(&w.pr, now, cfg) => {
                            Verdict::Running
                        }
                        v => v,
                    }
                }
                Err(e) => {
                    tracing::warn!(repo = %repo_name, sha, error = %e, "deploy poll: check runs unavailable");
                    report.errors += 1;
                    rate_limited |= matches!(e, GitHubError::RateLimited { .. });
                    // Unknown is not a verdict: wait, and stop a later
                    // failure from being read as "this one was superseded".
                    Verdict::Running
                }
            };
            verdicts.push(v);
            if rate_limited {
                break;
            }
        }
        let checked: Vec<(String, i64)> = watched[..verdicts.len()]
            .iter()
            .map(|w| (w.pr.company_id.clone(), w.pr.number))
            .collect();
        store::touch_checked(&st.db, &checked, now).await?;
        if rate_limited {
            // Verdicts are missing for the newest merges: decide next round.
            return Ok(report);
        }

        let plan = plan(&verdicts);
        if let Some(j) = plan.land_through {
            let through = &watched[j].pr;
            report.landed += land(
                st,
                Land::RepoThrough {
                    repo: &watched[j].site_repo,
                    merged_at: through.merged_at.unwrap_or(now),
                },
                SOURCE_POLL,
                through.merged_sha.as_deref(),
                None,
            )
            .await?;
        }
        for (i, why) in plan.fail {
            if redeployed_recently(&watched[i].pr, now, cfg) {
                continue;
            }
            let (detail, deployed) = match why {
                Failure::Own(why) => (why, watched[i].pr.merged_sha.clone()),
                Failure::SupersededBy(k) => (
                    format!(
                        "superseded by the deployment of pull request #{}, which failed",
                        watched[k].pr.number
                    ),
                    watched[k].pr.merged_sha.clone(),
                ),
            };
            if fail(
                st,
                &watched[i].pr,
                "failure",
                &detail,
                SOURCE_POLL,
                deployed.as_deref(),
                None,
            )
            .await?
            {
                report.failed += 1;
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use CheckConclusion as C;
    use CheckStatus as S;

    fn run(name: &str, status: S, conclusion: Option<C>) -> CheckRun {
        CheckRun {
            id: 1,
            name: name.into(),
            head_sha: "s".into(),
            status,
            conclusion,
            details_url: None,
        }
    }

    #[test]
    fn verdicts_of_check_runs() {
        let v = |runs: &[CheckRun]| verdict(runs, "deploy");
        assert_eq!(v(&[]), Verdict::Idle);
        assert_eq!(
            v(&[
                run("build", S::Completed, Some(C::Success)),
                run("deploy", S::Completed, Some(C::Success))
            ]),
            Verdict::Success
        );
        // The build alone is not a deployment.
        assert_eq!(
            v(&[run("build", S::Completed, Some(C::Success))]),
            Verdict::Idle
        );
        assert_eq!(
            v(&[
                run("build", S::Completed, Some(C::Success)),
                run("deploy", S::InProgress, None)
            ]),
            Verdict::Running
        );
        assert_eq!(v(&[run("build", S::Queued, None)]), Verdict::Running);
        assert_eq!(
            v(&[
                run("build", S::Completed, Some(C::Failure)),
                run("deploy", S::Completed, Some(C::Skipped))
            ]),
            Verdict::Failed("check `build` concluded failure".into())
        );
        assert_eq!(
            v(&[run("deploy", S::Completed, Some(C::TimedOut))]),
            Verdict::Failed("check `deploy` concluded timed_out".into())
        );
        // Cancelled, skipped and neutral runs decide nothing: superseded.
        for c in [C::Cancelled, C::Skipped, C::Neutral, C::Stale] {
            assert_eq!(
                v(&[run("deploy", S::Completed, Some(c))]),
                Verdict::Idle,
                "{c:?}"
            );
        }
        // A skipped deploy is not a success, and another check name is not
        // the deploy.
        assert_eq!(
            verdict(&[run("deploy", S::Completed, Some(C::Success))], "pages"),
            Verdict::Idle
        );
        // A re-run that succeeded wins over the failed attempt.
        assert_eq!(
            v(&[
                run("build", S::Completed, Some(C::Failure)),
                run("deploy", S::Completed, Some(C::Success))
            ]),
            Verdict::Success
        );
    }

    #[test]
    fn plans() {
        use Verdict::{Idle, Running, Success};
        let failed = || Verdict::Failed("x".into());
        let own = || Failure::Own("x".into());
        assert_eq!(plan(&[]), Plan::default());
        assert_eq!(
            plan(&[Success]),
            Plan {
                land_through: Some(0),
                fail: vec![]
            }
        );
        // A burst: the first run was superseded, the last one deployed.
        assert_eq!(
            plan(&[Idle, Idle, Success]),
            Plan {
                land_through: Some(2),
                fail: vec![]
            }
        );
        // The newest success decides, whatever came before it.
        assert_eq!(
            plan(&[failed(), Success, Running]),
            Plan {
                land_through: Some(1),
                fail: vec![]
            }
        );
        // Nothing decided yet.
        assert_eq!(plan(&[Idle, Running]), Plan::default());
        assert_eq!(plan(&[Idle, Idle]), Plan::default());
        // A failure fails itself and the superseded merges before it.
        assert_eq!(
            plan(&[Idle, failed()]),
            Plan {
                land_through: None,
                fail: vec![(0, Failure::SupersededBy(1)), (1, own())]
            }
        );
        // ... but not while a later run can still deploy them.
        assert_eq!(
            plan(&[Idle, failed(), Running]),
            Plan {
                land_through: None,
                fail: vec![(1, own())]
            }
        );
        // ... and not a run of its own that is still going.
        assert_eq!(
            plan(&[Running, failed()]),
            Plan {
                land_through: None,
                fail: vec![(1, own())]
            }
        );
        assert_eq!(
            plan(&[Success, Idle, failed(), Idle]),
            Plan {
                land_through: Some(0),
                fail: vec![(1, Failure::SupersededBy(2)), (2, own())]
            }
        );
    }

    #[test]
    fn payloads() {
        let pr = GatewayPr {
            company_id: "co".into(),
            number: 7,
            content_id: "c1".into(),
            work_item: Some("work-item-1".into()),
            path: "content/pages/blog/a.json".into(),
            branch: "drafts/content-c1".into(),
            head_sha: "h".into(),
            merged_sha: Some("m1".into()),
            merged_at: Some(1),
            landed_at: None,
            deploy_state: Some("pending".into()),
            deploy_detail: None,
            deploy_checked_at: None,
            closed_at: None,
            final_head: None,
            deploy_since: None,
            deploy_failed_sha: None,
            deploy_attempt: 0,
            deploy_rerun: None,
        };
        assert_eq!(
            payload(Some(&pr), "success", SOURCE_POLL, Some("m2"), None, None),
            json!({ "content_id": "c1", "work_item": "work-item-1", "number": 7, "merged_sha": "m1",
                    "deployed_sha": "m2", "state": "success", "detail": null, "environment": null,
                    "source": "poll", "attempt": 0 })
        );
        // A deployment the gateway cannot map still names its commit.
        let unmapped = payload(
            None,
            "failure",
            SOURCE_WEBHOOK,
            Some("abc"),
            None,
            Some("github-pages"),
        );
        assert_eq!(unmapped["content_id"], Value::Null);
        assert_eq!(unmapped["merged_sha"], "abc");
        assert_eq!(unmapped["environment"], "github-pages");
    }
}
