//! Company actors against real Postgres: command log persistence, snapshots,
//! crash/restart rebuild with identical hashes, wall-clock fast-forward.

use std::sync::Arc;
use std::time::Duration;

use simpress_server::actor::{self, ActorConfig, CommandError, Registry};
use simpress_server::db;
use simpress_server::sim::{LedgerSim, Simulation};
use simpress_server::store::{PgStore, SimStore};
use sqlx::PgPool;
use uuid::Uuid;

fn fast_cfg() -> ActorConfig {
    ActorConfig {
        step_period: Duration::from_millis(10),
        hash_every: 10,
        snapshot_every: 25,
        catchup_budget: 1000,
        idle_unload: None,
        ..ActorConfig::default()
    }
}

async fn company(pool: &PgPool, gh: i64) -> Uuid {
    let u = db::upsert_github_user(pool, gh, "p", None, None)
        .await
        .unwrap();
    db::create_company(pool, u.id, "Co", 99, 60)
        .await
        .unwrap()
        .unwrap()
        .id
}

#[sqlx::test(migrations = "./migrations")]
async fn commands_are_logged_in_order_and_rejections_are_not(pool: PgPool) {
    let id = company(&pool, 1).await;
    let store: Arc<dyn SimStore> = Arc::new(PgStore::new(pool.clone()));
    let reg = Registry::new(
        pool.clone(),
        store,
        actor::spawner::<LedgerSim>(),
        fast_cfg(),
    );
    let h = reg.get(id).await.unwrap();

    let mut acks = Vec::new();
    for i in 0..5u8 {
        acks.push(h.command(None, vec![b'k', i]).await.unwrap());
        assert!(matches!(
            h.command(None, b"!no".to_vec()).await,
            Err(CommandError::Rejected(_))
        ));
        tokio::time::sleep(Duration::from_millis(35)).await;
    }
    let rows: Vec<(i64, i32, Vec<u8>)> = sqlx::query_as(
        "SELECT step, seq, payload FROM sim_commands WHERE company_id = $1 ORDER BY step, seq",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 5, "rejected commands are rolled back");
    for (i, ((step, seq), row)) in acks.iter().zip(&rows).enumerate() {
        assert_eq!((*step as i64, *seq as i32), (row.0, row.1));
        assert_eq!(row.2, vec![b'k', i as u8]);
    }
    assert!(
        acks.windows(2).all(|w| w[0] < w[1]),
        "acks strictly ordered: {acks:?}"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn restart_restores_identical_hash(pool: PgPool) {
    let id = company(&pool, 2).await;
    let store: Arc<dyn SimStore> = Arc::new(PgStore::new(pool.clone()));
    let reg = Registry::new(
        pool.clone(),
        store.clone(),
        actor::spawner::<LedgerSim>(),
        fast_cfg(),
    );
    let h = reg.get(id).await.unwrap();
    for i in 0..10u8 {
        h.command(None, vec![b'r', i]).await.unwrap();
        if i % 3 == 0 {
            h.command(None, vec![b's', i]).await.unwrap();
        }
        tokio::time::sleep(Duration::from_millis(23)).await;
    }
    let before = h.probe().await.unwrap();
    assert!(before.step > 25, "ran past a snapshot point: {before:?}");
    let snaps: (i64,) = sqlx::query_as("SELECT count(*) FROM sim_snapshots WHERE company_id = $1")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(snaps.0 >= 1);

    // "Crash" view: rebuild purely from what Postgres holds, at the same step.
    let (rebuilt, next_seq) =
        actor::rebuild::<LedgerSim>(store.as_ref(), id, 99, 60, Some(before.step))
            .await
            .unwrap();
    assert_eq!(rebuilt.current_step(), before.step);
    assert_eq!(rebuilt.hash(), before.hash);
    assert_eq!(next_seq, before.next_seq);

    // Snapshots alone (no replay) agree too: rebuild from scratch, ignoring them.
    let (from_zero, _) = {
        let log = store.load(id, Some(before.step)).await.unwrap();
        let all: Vec<(i64, i32, Vec<u8>)> = sqlx::query_as(
            "SELECT step, seq, payload FROM sim_commands WHERE company_id = $1 ORDER BY step, seq",
        )
        .bind(id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(log.snapshot.is_some());
        let mut sim = LedgerSim::create(99, 60);
        let mut it = all.iter().peekable();
        loop {
            while let Some(c) = it.peek() {
                if c.0 as u64 != sim.current_step() {
                    break;
                }
                sim.apply(&c.2).unwrap();
                it.next();
            }
            if sim.current_step() == before.step {
                break;
            }
            sim.step();
        }
        (sim, ())
    };
    assert_eq!(from_zero.hash(), before.hash);

    // Clean restart through the registry: final snapshot, reload, same state,
    // then fast-forward continues from there.
    let fin = reg.unload(id).await.unwrap();
    let h2 = reg.get(id).await.unwrap();
    let p = h2.probe().await.unwrap();
    assert!(p.step >= fin.step);
    let (expect, _) = actor::rebuild::<LedgerSim>(store.as_ref(), id, 99, 60, Some(fin.step))
        .await
        .unwrap();
    assert_eq!(expect.hash(), fin.hash);
    // New commands keep working after the restart.
    h2.command(None, b"after".to_vec()).await.unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn reload_fast_forwards_to_wall_clock(pool: PgPool) {
    let id = company(&pool, 3).await;
    // The company was created 30 s ago: 3000 steps at 10 ms.
    sqlx::query("UPDATE companies SET created_at = now() - interval '30 seconds' WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let cfg = ActorConfig {
        catchup_budget: 500,
        ..fast_cfg()
    };
    let store: Arc<dyn SimStore> = Arc::new(PgStore::new(pool.clone()));
    let reg = Registry::new(pool.clone(), store, actor::spawner::<LedgerSim>(), cfg);
    let h = reg.get(id).await.unwrap();
    assert_eq!(
        h.probe().await.unwrap().step,
        0,
        "load itself does not block on catch-up"
    );
    tokio::time::sleep(Duration::from_millis(25)).await;
    let early = h.probe().await.unwrap().step;
    assert!(early <= 1000, "bounded per tick: {early}");
    tokio::time::sleep(Duration::from_millis(400)).await;
    let p = h.probe().await.unwrap().step;
    assert!(p >= 3000, "caught up to wall clock: {p}");
}

#[sqlx::test(migrations = "./migrations")]
async fn registry_loads_once_and_reloads_after_exit(pool: PgPool) {
    let id = company(&pool, 4).await;
    let store: Arc<dyn SimStore> = Arc::new(PgStore::new(pool.clone()));
    let reg = Registry::new(
        pool.clone(),
        store,
        actor::spawner::<LedgerSim>(),
        fast_cfg(),
    );
    let a = reg.get(id).await.unwrap();
    let b = reg.get(id).await.unwrap();
    // Same actor behind both handles.
    let _sub = a.subscribe().await.unwrap();
    assert_eq!(b.probe().await.unwrap().subscribers, 1);
    assert_eq!(reg.loaded().await, 1);
    a.shutdown().await.unwrap();
    assert!(!b.is_alive());
    let c = reg.get(id).await.unwrap();
    assert!(c.is_alive());
    assert!(reg.get(Uuid::new_v4()).await.is_err(), "unknown company");
    reg.shutdown_all().await;
    assert_eq!(reg.loaded().await, 0);
}
