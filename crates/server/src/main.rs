use std::sync::Arc;

use anyhow::Result;
use simpress_server::actor;
use simpress_server::app::{self, AppState};
use simpress_server::config::Config;
use simpress_server::db;
use simpress_server::jobs::{JobNotifier, PermissiveValidator, UnconfiguredClaude};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn")),
        )
        .init();

    let cfg = Config::from_env()?;
    let pool = db::connect(&cfg.database_url).await?;
    db::migrate(&pool).await?;

    let (notifier, notifier_task) = JobNotifier::start(&pool).await?;
    let listener = tokio::net::TcpListener::bind(cfg.bind).await?;
    let st = AppState::new(
        cfg,
        pool,
        actor::spawner::<sim_core::World>(),
        notifier,
        Arc::new(PermissiveValidator),
    );
    let bg = app::spawn_background(&st, Arc::new(UnconfiguredClaude), Some(notifier_task));

    app::serve(listener, st, async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutting down");
    })
    .await?;
    bg.abort();
    Ok(())
}
