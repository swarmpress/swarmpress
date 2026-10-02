use anyhow::Result;
use swarmpress_server::app::{self, AppState};
use swarmpress_server::config::Config;
use swarmpress_server::db::Db;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn")),
        )
        .init();

    let cfg = Config::from_env()?;
    std::fs::create_dir_all(&cfg.data_dir)?;
    let db = Db::connect(&cfg.database_url).await?;
    db.migrate().await?;
    tracing::info!(database = %cfg.database_url, data_dir = %cfg.data_dir.display(), "database ready");

    let listener = tokio::net::TcpListener::bind(cfg.bind).await?;
    let st = AppState::new(cfg, db.clone())?;
    let bg = app::spawn_background(&st);

    app::serve(listener, st, async {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutting down");
    })
    .await?;
    bg.abort();
    db.close().await;
    Ok(())
}
