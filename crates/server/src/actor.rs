//! Company actors: one tokio task per loaded company owns its authoritative
//! [`Simulation`], steps it at a fixed 100 ms rate, logs accepted commands,
//! snapshots periodically and fans the lockstep stream out to WebSockets.
//!
//! ## Step / command / snapshot semantics
//! - Commands are applied when they arrive, at the actor's current step `s`,
//!   and get `(step = s, seq = n)`. Clients apply them before stepping out of `s`.
//! - A command is accepted only if (1) its row is inserted in a transaction,
//!   (2) the simulation accepts it, (3) the transaction commits. If the commit
//!   fails after the sim mutated, the actor exits without snapshotting and is
//!   rebuilt from the log on next use (fail loudly, never diverge).
//! - Periodic snapshots and hashes are taken right after stepping into a step,
//!   before any of that step's commands, so replay = snapshot + for each step
//!   (apply its commands in seq order, then step).
//! - On (re)load the actor rebuilds from the latest snapshot + command log and
//!   then fast-forwards to wall-clock time with at most `catchup_budget` steps
//!   per tick, so a long offline period never blocks the runtime.

use std::collections::{BTreeMap, HashMap};
use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior};
use uuid::Uuid;

use crate::sim::Simulation;
use crate::store::SimStore;
use crate::wire::{CommandEntry, ServerFrame};

#[derive(Clone, Debug)]
pub struct ActorConfig {
    /// Fixed step length (100 ms in production; matches sim-core).
    pub step_period: Duration,
    /// Broadcast a `Hash` frame every N steps.
    pub hash_every: u64,
    /// Persist a snapshot every N steps.
    pub snapshot_every: u64,
    /// Max steps executed per tick while catching up to wall-clock time.
    pub catchup_budget: u64,
    /// Unload after this long with no subscribers (`None` = never).
    pub idle_unload: Option<Duration>,
    /// Persist a snapshot on clean shutdown/unload.
    pub snapshot_on_shutdown: bool,
    /// How many recent hashes to keep for client `HashReport` checks.
    pub hash_history: usize,
    /// Broadcast channel capacity (frames) before slow clients lag.
    pub broadcast_capacity: usize,
}

impl Default for ActorConfig {
    fn default() -> Self {
        Self {
            step_period: Duration::from_millis(100),
            hash_every: 600,
            snapshot_every: 6000,
            catchup_budget: 2000,
            idle_unload: Some(Duration::from_secs(300)),
            snapshot_on_shutdown: true,
            hash_history: 32,
            broadcast_capacity: 1024,
        }
    }
}

/// What the actor needs to know about its company.
#[derive(Clone, Debug)]
pub struct LoadParams {
    pub company_id: Uuid,
    pub seed: u64,
    pub day_real_minutes: u32,
    /// The wall-clock step at load time ((now - created_at) / step_period).
    pub wall_step: u64,
}

/// A subscriber's starting point in the lockstep stream.
pub struct Subscription {
    pub step: u64,
    pub next_seq: u32,
    pub snapshot: Vec<u8>,
    pub rx: broadcast::Receiver<Arc<ServerFrame>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Probe {
    pub step: u64,
    pub hash: u64,
    pub next_seq: u32,
    pub subscribers: usize,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CommandError {
    #[error("rejected: {0}")]
    Rejected(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("company actor is not running")]
    Gone,
}

enum ActorMsg {
    Subscribe(oneshot::Sender<Subscription>),
    Command {
        user: Option<Uuid>,
        payload: Vec<u8>,
        reply: oneshot::Sender<Result<(u64, u32), CommandError>>,
    },
    Probe(oneshot::Sender<Probe>),
    HashAt {
        step: u64,
        reply: oneshot::Sender<Option<u64>>,
    },
    Shutdown(oneshot::Sender<Probe>),
}

/// Cheap, cloneable handle to a running actor.
#[derive(Clone)]
pub struct ActorHandle {
    company_id: Uuid,
    tx: mpsc::Sender<ActorMsg>,
}

#[derive(Debug, thiserror::Error)]
#[error("company actor is not running")]
pub struct ActorGone;

impl ActorHandle {
    pub fn company_id(&self) -> Uuid {
        self.company_id
    }

    pub fn is_alive(&self) -> bool {
        !self.tx.is_closed()
    }

    async fn ask<T>(&self, f: impl FnOnce(oneshot::Sender<T>) -> ActorMsg) -> Result<T, ActorGone> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(f(tx)).await.map_err(|_| ActorGone)?;
        rx.await.map_err(|_| ActorGone)
    }

    pub async fn subscribe(&self) -> Result<Subscription, ActorGone> {
        self.ask(ActorMsg::Subscribe).await
    }

    pub async fn command(
        &self,
        user: Option<Uuid>,
        payload: Vec<u8>,
    ) -> Result<(u64, u32), CommandError> {
        self.ask(|reply| ActorMsg::Command {
            user,
            payload,
            reply,
        })
        .await
        .map_err(|_| CommandError::Gone)?
    }

    pub async fn probe(&self) -> Result<Probe, ActorGone> {
        self.ask(ActorMsg::Probe).await
    }

    /// The authoritative hash at `step`, if it is a recent hash point.
    pub async fn hash_at(&self, step: u64) -> Result<Option<u64>, ActorGone> {
        self.ask(|reply| ActorMsg::HashAt { step, reply }).await
    }

    /// Clean shutdown (final snapshot if configured). Returns the final state.
    pub async fn shutdown(&self) -> Result<Probe, ActorGone> {
        self.ask(ActorMsg::Shutdown).await
    }
}

/// Rebuild a simulation from the store: latest snapshot (at or below `upto`)
/// plus ordered command replay. Without `upto` it stops at the step of the last
/// logged command (or the snapshot). Returns the sim and the next free `seq`
/// at its current step.
pub async fn rebuild<S: Simulation>(
    store: &dyn SimStore,
    company_id: Uuid,
    seed: u64,
    day_real_minutes: u32,
    upto: Option<u64>,
) -> Result<(S, u32)> {
    let log = store.load(company_id, upto).await?;
    let mut sim = match &log.snapshot {
        Some((step, bytes)) => {
            let sim = S::restore(bytes).map_err(|e| anyhow::anyhow!(e))?;
            if sim.current_step() != *step {
                bail!(
                    "snapshot row step {step} != restored step {}",
                    sim.current_step()
                );
            }
            sim
        }
        None => S::create(seed, day_real_minutes),
    };
    let last_cmd_step = log.commands.last().map(|c| c.step).unwrap_or(0);
    let target = upto.unwrap_or_else(|| last_cmd_step.max(sim.current_step()));
    if target < sim.current_step() {
        bail!(
            "cannot rebuild to step {target}: snapshot is at {}",
            sim.current_step()
        );
    }
    let mut cmds = log.commands.iter().peekable();
    let mut next_seq;
    loop {
        let cur = sim.current_step();
        next_seq = 0;
        while let Some(c) = cmds.peek() {
            if c.step < cur {
                bail!("command log out of order at step {} (sim at {cur})", c.step);
            }
            if c.step > cur {
                break;
            }
            if c.seq != next_seq {
                bail!(
                    "command log gap at step {cur}: expected seq {next_seq}, got {}",
                    c.seq
                );
            }
            if let Err(e) = sim.apply(&c.payload) {
                // A logged command was accepted once; rejection on replay means
                // the simulation is not deterministic. Never ignore this.
                tracing::error!(%company_id, step = cur, seq = c.seq, error = %e,
                    "DETERMINISM VIOLATION: logged command rejected on replay");
                bail!("logged command ({cur}, {}) rejected on replay: {e}", c.seq);
            }
            next_seq += 1;
            cmds.next();
        }
        if cur >= target {
            break;
        }
        sim.step();
    }
    Ok((sim, next_seq))
}

/// Load (rebuild) and start an actor. Returns its handle and task.
pub async fn spawn<S: Simulation>(
    store: Arc<dyn SimStore>,
    params: LoadParams,
    cfg: ActorConfig,
) -> Result<(ActorHandle, JoinHandle<()>)> {
    let (sim, next_seq) = rebuild::<S>(
        store.as_ref(),
        params.company_id,
        params.seed,
        params.day_real_minutes,
        None,
    )
    .await
    .with_context(|| format!("rebuild company {}", params.company_id))?;
    tracing::info!(company_id = %params.company_id, step = sim.current_step(),
        wall_step = params.wall_step, "company actor loaded");
    let (tx, rx) = mpsc::channel(256);
    let (btx, _) = broadcast::channel(cfg.broadcast_capacity.max(16));
    let actor = Actor {
        company_id: params.company_id,
        sim,
        next_seq,
        store,
        cfg,
        btx,
        pending_entries: Vec::new(),
        hashes: BTreeMap::new(),
        wall_step: params.wall_step,
        base: Instant::now(),
    };
    let join = tokio::spawn(actor.run(rx));
    Ok((
        ActorHandle {
            company_id: params.company_id,
            tx,
        },
        join,
    ))
}

struct Actor<S> {
    company_id: Uuid,
    sim: S,
    next_seq: u32,
    store: Arc<dyn SimStore>,
    cfg: ActorConfig,
    btx: broadcast::Sender<Arc<ServerFrame>>,
    /// Accepted commands not yet broadcast (all at the current step).
    pending_entries: Vec<CommandEntry>,
    hashes: BTreeMap<u64, u64>,
    wall_step: u64,
    base: Instant,
}

enum Exit {
    Clean,
    /// The sim holds state that is not in the log; do not snapshot.
    Poisoned,
}

impl<S: Simulation> Actor<S> {
    fn probe(&self) -> Probe {
        Probe {
            step: self.sim.current_step(),
            hash: self.sim.hash(),
            next_seq: self.next_seq,
            subscribers: self.btx.receiver_count(),
        }
    }

    fn target_step(&self) -> u64 {
        let period = self.cfg.step_period.as_nanos().max(1);
        let elapsed = self.base.elapsed().as_nanos() / period;
        self.wall_step
            .saturating_add(u64::try_from(elapsed).unwrap_or(u64::MAX))
    }

    async fn run(mut self, mut rx: mpsc::Receiver<ActorMsg>) {
        let period = self.cfg.step_period;
        let mut interval = tokio::time::interval_at(Instant::now() + period, period);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut idle_since: Option<Instant> = None;
        let mut shutdown_reply = None;

        let exit = loop {
            tokio::select! {
                _ = interval.tick() => {
                    self.on_tick().await;
                    if let Some(limit) = self.cfg.idle_unload {
                        if self.btx.receiver_count() == 0 {
                            let since = *idle_since.get_or_insert_with(Instant::now);
                            if since.elapsed() >= limit {
                                tracing::info!(company_id = %self.company_id, "unloading idle company actor");
                                break Exit::Clean;
                            }
                        } else {
                            idle_since = None;
                        }
                    }
                }
                msg = rx.recv() => match msg {
                    None => break Exit::Clean,
                    Some(ActorMsg::Shutdown(reply)) => {
                        shutdown_reply = Some(reply);
                        break Exit::Clean;
                    }
                    Some(msg) => {
                        if let Err(exit) = self.on_msg(msg).await {
                            break exit;
                        }
                    }
                }
            }
        };
        // Stop accepting messages before the final snapshot.
        rx.close();
        if let Exit::Clean = exit {
            self.final_snapshot().await;
        }
        if let Some(reply) = shutdown_reply {
            let _ = reply.send(self.probe());
        }
    }

    async fn final_snapshot(&mut self) {
        if !self.cfg.snapshot_on_shutdown {
            return;
        }
        // A snapshot must not contain commands of its own step (replay would
        // apply them twice), so flush one step if this step has commands.
        if self.next_seq > 0 {
            self.step_once().await;
        }
        let step = self.sim.current_step();
        let hash = self.sim.hash();
        if let Err(e) = self
            .store
            .save_snapshot(self.company_id, step, hash, &self.sim.snapshot())
            .await
        {
            tracing::error!(company_id = %self.company_id, error = %e, "final snapshot failed");
        }
    }

    /// One step plus the per-step bookkeeping. Returns a hash frame if due.
    async fn step_once(&mut self) -> Option<ServerFrame> {
        self.sim.step();
        self.next_seq = 0;
        let step = self.sim.current_step();
        let mut frame = None;
        if step.checked_rem(self.cfg.hash_every) == Some(0) {
            let h = self.sim.hash();
            self.hashes.insert(step, h);
            while self.hashes.len() > self.cfg.hash_history.max(1) {
                self.hashes.pop_first();
            }
            frame = Some(ServerFrame::Hash { step, h });
        }
        if step.checked_rem(self.cfg.snapshot_every) == Some(0) {
            let hash = self.sim.hash();
            if let Err(e) = self
                .store
                .save_snapshot(self.company_id, step, hash, &self.sim.snapshot())
                .await
            {
                tracing::error!(company_id = %self.company_id, step, error = %e, "periodic snapshot failed");
            }
        }
        frame
    }

    async fn on_tick(&mut self) {
        let from = self.sim.current_step();
        let behind = self.target_step().saturating_sub(from);
        let n = behind.min(self.cfg.catchup_budget.max(1));
        if n == 0 {
            return;
        }
        if behind > n {
            tracing::debug!(company_id = %self.company_id, behind, "catching up to wall clock");
        }
        let mut hash_frames = Vec::new();
        for _ in 0..n {
            if let Some(f) = self.step_once().await {
                hash_frames.push(f);
            }
        }
        let entries = std::mem::take(&mut self.pending_entries);
        // Send errors only mean "no subscribers right now".
        let _ = self.btx.send(Arc::new(ServerFrame::Commands {
            from_step: from,
            to_step: self.sim.current_step(),
            entries,
        }));
        for f in hash_frames {
            let _ = self.btx.send(Arc::new(f));
        }
    }

    async fn on_msg(&mut self, msg: ActorMsg) -> Result<(), Exit> {
        match msg {
            ActorMsg::Subscribe(reply) => {
                let sub = Subscription {
                    step: self.sim.current_step(),
                    next_seq: self.next_seq,
                    snapshot: self.sim.snapshot(),
                    rx: self.btx.subscribe(),
                };
                let _ = reply.send(sub);
            }
            ActorMsg::Probe(reply) => {
                let _ = reply.send(self.probe());
            }
            ActorMsg::HashAt { step, reply } => {
                let _ = reply.send(self.hashes.get(&step).copied());
            }
            ActorMsg::Command {
                user,
                payload,
                reply,
            } => {
                let entry = CommandEntry {
                    step: self.sim.current_step(),
                    seq: self.next_seq,
                    payload,
                };
                let pending = match self
                    .store
                    .begin_command(self.company_id, user, &entry)
                    .await
                {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!(company_id = %self.company_id, error = %e, "could not log command");
                        let _ = reply.send(Err(CommandError::Storage(e.to_string())));
                        return Ok(());
                    }
                };
                match self.sim.apply(&entry.payload) {
                    Err(reason) => {
                        if let Err(e) = pending.rollback().await {
                            tracing::warn!(error = %e, "rollback of rejected command failed");
                        }
                        let _ = reply.send(Err(CommandError::Rejected(reason)));
                    }
                    Ok(()) => match pending.commit().await {
                        Ok(()) => {
                            self.next_seq += 1;
                            let at = (entry.step, entry.seq);
                            self.pending_entries.push(entry);
                            let _ = reply.send(Ok(at));
                        }
                        Err(e) => {
                            tracing::error!(company_id = %self.company_id, error = %e,
                                "command applied but commit failed: actor exits and will rebuild from the log");
                            let _ = reply.send(Err(CommandError::Storage(e.to_string())));
                            return Err(Exit::Poisoned);
                        }
                    },
                }
            }
            ActorMsg::Shutdown(_) => unreachable!("handled in run loop"),
        }
        Ok(())
    }
}

/// Starts actors of a concrete simulation type; lets [`Registry`] stay
/// non-generic.
#[async_trait]
pub trait ActorSpawner: Send + Sync + 'static {
    async fn spawn(
        &self,
        store: Arc<dyn SimStore>,
        params: LoadParams,
        cfg: ActorConfig,
    ) -> Result<ActorHandle>;
}

pub struct SimSpawner<S>(PhantomData<fn() -> S>);

impl<S> Default for SimSpawner<S> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[async_trait]
impl<S: Simulation> ActorSpawner for SimSpawner<S> {
    async fn spawn(
        &self,
        store: Arc<dyn SimStore>,
        params: LoadParams,
        cfg: ActorConfig,
    ) -> Result<ActorHandle> {
        Ok(spawn::<S>(store, params, cfg).await?.0)
    }
}

pub fn spawner<S: Simulation>() -> Arc<dyn ActorSpawner> {
    Arc::new(SimSpawner::<S>::default())
}

/// Loads company actors on demand and forgets them when they exit.
pub struct Registry {
    pool: PgPool,
    store: Arc<dyn SimStore>,
    spawner: Arc<dyn ActorSpawner>,
    cfg: ActorConfig,
    actors: Mutex<HashMap<Uuid, ActorHandle>>,
}

impl Registry {
    pub fn new(
        pool: PgPool,
        store: Arc<dyn SimStore>,
        spawner: Arc<dyn ActorSpawner>,
        cfg: ActorConfig,
    ) -> Self {
        Self {
            pool,
            store,
            spawner,
            cfg,
            actors: Mutex::new(HashMap::new()),
        }
    }

    pub fn config(&self) -> &ActorConfig {
        &self.cfg
    }

    /// The running actor for `company_id`, loading it if needed.
    pub async fn get(&self, company_id: Uuid) -> Result<ActorHandle> {
        let mut actors = self.actors.lock().await;
        if let Some(h) = actors.get(&company_id) {
            if h.is_alive() {
                return Ok(h.clone());
            }
            actors.remove(&company_id);
        }
        let company = crate::db::company_load_params(&self.pool, company_id, self.cfg.step_period)
            .await?
            .with_context(|| format!("company {company_id} not found"))?;
        let handle = self
            .spawner
            .spawn(self.store.clone(), company, self.cfg.clone())
            .await?;
        actors.insert(company_id, handle.clone());
        Ok(handle)
    }

    /// Number of currently running actors.
    pub async fn loaded(&self) -> usize {
        let mut actors = self.actors.lock().await;
        actors.retain(|_, h| h.is_alive());
        actors.len()
    }

    /// Cleanly stop one actor (final snapshot). Returns its final state.
    pub async fn unload(&self, company_id: Uuid) -> Option<Probe> {
        let h = self.actors.lock().await.remove(&company_id)?;
        h.shutdown().await.ok()
    }

    pub async fn shutdown_all(&self) {
        let handles: Vec<_> = self.actors.lock().await.drain().map(|(_, h)| h).collect();
        for h in handles {
            let _ = h.shutdown().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::LedgerSim;
    use crate::store::MemoryStore;

    fn params(id: Uuid, wall_step: u64) -> LoadParams {
        LoadParams {
            company_id: id,
            seed: 42,
            day_real_minutes: 60,
            wall_step,
        }
    }

    fn cfg() -> ActorConfig {
        ActorConfig {
            hash_every: 10,
            snapshot_every: 50,
            catchup_budget: 100,
            idle_unload: None,
            ..ActorConfig::default()
        }
    }

    async fn spawn_mem(store: &MemoryStore, id: Uuid, wall: u64, cfg: ActorConfig) -> ActorHandle {
        spawn::<LedgerSim>(Arc::new(store.clone()), params(id, wall), cfg)
            .await
            .unwrap()
            .0
    }

    #[tokio::test(start_paused = true)]
    async fn steps_at_ten_hertz() {
        let store = MemoryStore::new();
        let h = spawn_mem(&store, Uuid::new_v4(), 0, cfg()).await;
        assert_eq!(h.probe().await.unwrap().step, 0);
        tokio::time::sleep(Duration::from_millis(1050)).await;
        assert_eq!(h.probe().await.unwrap().step, 10);
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert_eq!(h.probe().await.unwrap().step, 610);
    }

    #[tokio::test(start_paused = true)]
    async fn catch_up_is_bounded_per_tick() {
        let store = MemoryStore::new();
        let h = spawn_mem(&store, Uuid::new_v4(), 1000, cfg()).await;
        tokio::time::sleep(Duration::from_millis(150)).await;
        // One tick: 1001 steps behind but only `catchup_budget` executed.
        assert_eq!(h.probe().await.unwrap().step, 100);
        tokio::time::sleep(Duration::from_secs(2)).await;
        // 21 ticks * 100 = 2100 >= target 1021: caught up.
        assert_eq!(h.probe().await.unwrap().step, 1021);
    }

    #[tokio::test(start_paused = true)]
    async fn commands_ack_reject_and_stream() {
        let store = MemoryStore::new();
        let id = Uuid::new_v4();
        let h = spawn_mem(&store, id, 0, cfg()).await;
        let mut sub = h.subscribe().await.unwrap();
        assert_eq!((sub.step, sub.next_seq), (0, 0));

        assert_eq!(h.command(None, b"a".to_vec()).await.unwrap(), (0, 0));
        assert_eq!(h.command(None, b"b".to_vec()).await.unwrap(), (0, 1));
        assert!(matches!(
            h.command(None, b"!bad".to_vec()).await,
            Err(CommandError::Rejected(_))
        ));
        assert_eq!(store.command_count(id), 2);

        tokio::time::sleep(Duration::from_millis(1050)).await;
        let f = sub.rx.recv().await.unwrap();
        match &*f {
            ServerFrame::Commands {
                from_step,
                to_step,
                entries,
            } => {
                assert_eq!((*from_step, *to_step), (0, 1));
                assert_eq!(entries.len(), 2);
                assert_eq!(entries[1].payload, b"b");
            }
            other => panic!("unexpected {other:?}"),
        }
        // Hash frame at step 10.
        let mut saw_hash = false;
        while let Ok(f) = sub.rx.try_recv() {
            if let ServerFrame::Hash { step, h: hh } = &*f {
                assert_eq!(*step, 10);
                assert_eq!(h.hash_at(10).await.unwrap(), Some(*hh));
                saw_hash = true;
            }
        }
        assert!(saw_hash);
    }

    #[tokio::test(start_paused = true)]
    async fn lockstep_replica_matches_hash_stream() {
        let store = MemoryStore::new();
        let h = spawn_mem(&store, Uuid::new_v4(), 0, cfg()).await;
        tokio::time::sleep(Duration::from_millis(350)).await;
        h.command(None, b"early".to_vec()).await.unwrap();
        let mut sub = h.subscribe().await.unwrap();
        // Command already in the snapshot: next_seq says so.
        assert_eq!(sub.next_seq, 1);
        let mut replica = LedgerSim::restore(&sub.snapshot).unwrap();
        let mut skip_until = (sub.step, sub.next_seq);
        h.command(None, b"late".to_vec()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(1200)).await;
        h.command(None, b"later".to_vec()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let mut checked = 0;
        while let Ok(f) = sub.rx.try_recv() {
            match &*f {
                ServerFrame::Commands {
                    from_step,
                    to_step,
                    entries,
                } => {
                    assert_eq!(*from_step, replica.current_step());
                    for t in *from_step..*to_step {
                        for e in entries.iter().filter(|e| e.step == t) {
                            if (e.step, e.seq) < skip_until {
                                continue;
                            }
                            replica.apply(&e.payload).unwrap();
                        }
                        replica.step();
                    }
                    skip_until = (0, 0);
                }
                ServerFrame::Hash { step, h } => {
                    assert!(*step <= replica.current_step());
                    if *step == replica.current_step() {
                        assert_eq!(replica.hash(), *h);
                        checked += 1;
                    }
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert!(checked >= 1, "no hash checked");
        assert_eq!(replica.hash(), h.probe().await.unwrap().hash);
    }

    #[tokio::test(start_paused = true)]
    async fn restart_restores_identical_hash() {
        let store = MemoryStore::new();
        let id = Uuid::new_v4();
        let h = spawn_mem(&store, id, 0, cfg()).await;
        for i in 0..12u8 {
            h.command(None, vec![b'c', i]).await.unwrap();
            tokio::time::sleep(Duration::from_millis(730)).await;
        }
        h.command(None, b"tail".to_vec()).await.unwrap();
        let before = h.probe().await.unwrap();
        assert!(store.snapshot_steps(id).contains(&50));

        // Crash (no final snapshot): rebuild from snapshot + log only.
        let (rebuilt, next_seq) = rebuild::<LedgerSim>(&store, id, 42, 60, Some(before.step))
            .await
            .unwrap();
        assert_eq!(rebuilt.hash(), before.hash);
        assert_eq!(next_seq, before.next_seq);

        // Clean restart: final snapshot, reload, same state.
        let fin = h.shutdown().await.unwrap();
        let h2 = spawn_mem(&store, id, 0, cfg()).await;
        let p = h2.probe().await.unwrap();
        assert_eq!((p.step, p.hash), (fin.step, fin.hash));
    }

    #[tokio::test(start_paused = true)]
    async fn storage_failure_rejects_command_without_diverging() {
        let store = MemoryStore::new();
        let id = Uuid::new_v4();
        let h = spawn_mem(&store, id, 0, cfg()).await;
        let before = h.probe().await.unwrap();
        store.fail_next_command();
        assert!(matches!(
            h.command(None, b"x".to_vec()).await,
            Err(CommandError::Storage(_))
        ));
        let after = h.probe().await.unwrap();
        assert_eq!(before.hash, after.hash);
    }

    #[tokio::test(start_paused = true)]
    async fn idle_actor_unloads_with_snapshot() {
        let store = MemoryStore::new();
        let id = Uuid::new_v4();
        let mut c = cfg();
        c.idle_unload = Some(Duration::from_secs(5));
        c.snapshot_every = 0;
        let h = spawn_mem(&store, id, 0, c).await;
        let sub = h.subscribe().await.unwrap();
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert!(h.is_alive());
        drop(sub);
        tokio::time::sleep(Duration::from_secs(6)).await;
        assert!(!h.is_alive());
        assert_eq!(store.snapshot_steps(id).len(), 1);
    }
}
