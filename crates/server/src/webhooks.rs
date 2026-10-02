//! `POST /webhooks/github`: the site repos' GitHub App webhook.
//!
//! Verified with `X-Hub-Signature-256` (`GITHUB_WEBHOOK_SECRET`, constant
//! time), parsed and deduped by `X-GitHub-Delivery` (`webhook_deliveries`).
//! A `deployment_status` of `success` becomes a `DeployLanded` event, and
//! `failure`/`error` a `DeployFailed` event, in the inbox of every company
//! bound to the repo; the deployed sha is mapped back to the gateway PR
//! (content id, work item) when the gateway merged it.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use github::webhooks::{
    Delivery, DeliveryDedupe, DeploymentState, WebhookError, WebhookEvent, WebhookHandler,
};
use serde_json::json;

use crate::app::AppState;
use crate::db::{accounts, gateway, Db};
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
    if let WebhookEvent::DeploymentStatus(ev) = &env.event {
        let kind = match ev.deployment_status.state {
            DeploymentState::Success => Some(kinds::DEPLOY_LANDED),
            DeploymentState::Failure | DeploymentState::Error => Some(kinds::DEPLOY_FAILED),
            _ => None,
        };
        if let Some(kind) = kind {
            let sha = &ev.deployment.sha;
            for company in accounts::companies_by_repo(&st.db, &ev.repository.full_name).await? {
                let pr = gateway::pr_by_merged_sha(&st.db, &company.id, sha).await?;
                events::publish(
                    &st,
                    &company.id,
                    kind,
                    json!({
                        "content_id": pr.as_ref().map(|p| p.content_id.clone()),
                        "work_item": pr.as_ref().and_then(|p| p.work_item.clone()),
                        "number": pr.as_ref().map(|p| p.number),
                        "merged_sha": sha,
                        "state": format!("{:?}", ev.deployment_status.state).to_ascii_lowercase(),
                        "environment": ev.deployment.environment,
                        "source": "webhook",
                    }),
                )
                .await?;
            }
        }
    } else {
        tracing::debug!(event = %env.event_name, "webhook ignored");
    }
    Ok(StatusCode::ACCEPTED)
}
