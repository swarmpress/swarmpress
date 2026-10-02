//! `POST /webhooks/github`: the site repos' GitHub App webhook.
//!
//! Verified with `X-Hub-Signature-256` (`GITHUB_WEBHOOK_SECRET`, constant
//! time), parsed and deduped by `X-GitHub-Delivery` (`webhook_deliveries`).
//!
//! Only `deployment_status` is acted on; it is one of the sources of deploy
//! observation ([`crate::deploys`], `source: "webhook"`):
//!
//! - `success` of a commit the gateway merged lands every gateway pull
//!   request of that repository merged **at or before** it (one
//!   `DeployLanded` each, in the inbox of the company that owns it): the
//!   Pages concurrency group can skip the runs of earlier merges, and this
//!   deployment contains them.
//! - `failure` / `error` of a commit the gateway merged fails that pull
//!   request (`DeployFailed`), once, unless it already landed.
//! - A deployment of a commit the gateway did not merge (a push by hand)
//!   cannot be placed among the merges. It lands nothing, and is reported to
//!   every company bound to the repository as an event without a pull
//!   request, as before.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use github::webhooks::{
    Delivery, DeliveryDedupe, DeploymentState, WebhookError, WebhookEvent, WebhookHandler,
};

use crate::app::AppState;
use crate::db::gateway::Land;
use crate::db::{accounts, gateway, Db};
use crate::deploys::{self, SOURCE_WEBHOOK};
use crate::error::{AppError, AppResult};
use crate::events::{self, kinds};

/// Delivery dedupe on SQLite.
pub struct SqliteDedupe {
    db: Db,
    clock: Arc<dyn github::Clock>,
}

#[async_trait]
impl DeliveryDedupe for SqliteDedupe {
    async fn check_and_mark(&self, delivery_id: &str) -> Result<bool, WebhookError> {
        let now = i64::try_from(self.clock.now_ms()).unwrap_or(i64::MAX);
        gateway::mark_delivery(&self.db, delivery_id, "github", now)
            .await
            .map_err(|e| WebhookError::Store(e.to_string()))
    }
}

pub async fn github(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> AppResult<StatusCode> {
    let Some(secret) = st.cfg.webhook_secret.as_deref() else {
        return Err(AppError::Unavailable(
            "GITHUB_WEBHOOK_SECRET is not configured".into(),
        ));
    };
    let handler = WebhookHandler::new(
        secret.as_bytes().to_vec(),
        Arc::new(SqliteDedupe {
            db: st.db.clone(),
            clock: st.clock.clone(),
        }),
    );
    let delivery = match handler.process(&headers, &body).await {
        Ok(d) => d,
        Err(
            e @ (WebhookError::MissingHeader(_)
            | WebhookError::MalformedSignature
            | WebhookError::InvalidSignature),
        ) => {
            tracing::warn!(error = %e, "webhook rejected");
            return Err(AppError::Unauthorized);
        }
        Err(e @ WebhookError::Parse { .. }) => return Err(AppError::BadRequest(e.to_string())),
        Err(e) => return Err(AppError::Internal(anyhow::anyhow!(e))),
    };
    let env = match delivery {
        Delivery::Duplicate { delivery_id } => {
            tracing::debug!(%delivery_id, "duplicate webhook delivery");
            return Ok(StatusCode::OK);
        }
        Delivery::Fresh(env) => env,
    };
    let WebhookEvent::DeploymentStatus(ev) = &env.event else {
        tracing::debug!(event = %env.event_name, "webhook ignored");
        return Ok(StatusCode::ACCEPTED);
    };
    let success = match ev.deployment_status.state {
        DeploymentState::Success => true,
        DeploymentState::Failure | DeploymentState::Error => false,
        _ => return Ok(StatusCode::ACCEPTED),
    };
    let state = format!("{:?}", ev.deployment_status.state).to_ascii_lowercase();
    let sha = ev.deployment.sha.as_str();
    let repo = ev.repository.full_name.as_str();
    let environment = Some(ev.deployment.environment.as_str());
    match gateway::merged_pr_in_repo(&st.db, repo, sha).await? {
        Some(pr) if success => {
            deploys::land(
                &st,
                Land::RepoThrough {
                    repo,
                    merged_at: pr.merged_at.unwrap_or_else(|| st.now_ms()),
                },
                SOURCE_WEBHOOK,
                Some(sha),
                environment,
            )
            .await?;
        }
        Some(pr) => {
            let detail = format!("the deployment of {sha} reported {state}");
            deploys::fail(
                &st,
                &pr,
                &state,
                &detail,
                SOURCE_WEBHOOK,
                Some(sha),
                environment,
            )
            .await?;
        }
        None => {
            let kind = if success {
                kinds::DEPLOY_LANDED
            } else {
                kinds::DEPLOY_FAILED
            };
            for company in accounts::companies_by_repo(&st.db, repo).await? {
                events::publish(
                    &st,
                    &company.id,
                    kind,
                    deploys::payload(None, &state, SOURCE_WEBHOOK, Some(sha), None, environment),
                )
                .await?;
            }
        }
    }
    Ok(StatusCode::ACCEPTED)
}
