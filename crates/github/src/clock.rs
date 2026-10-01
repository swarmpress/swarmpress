//! Injectable time so token caching and rate limiting are testable without
//! real waiting.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;

/// Wall-clock time in Unix epoch milliseconds.
pub trait Clock: Send + Sync + std::fmt::Debug {
    fn now_ms(&self) -> u64;

    fn now_secs(&self) -> u64 {
        self.now_ms() / 1000
    }
}

/// The real system clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or(0)
    }
}

/// A manually advanced clock for tests.
#[derive(Debug, Default)]
pub struct ManualClock {
    ms: AtomicU64,
}

impl ManualClock {
    pub fn new(start_ms: u64) -> Arc<Self> {
        Arc::new(Self {
            ms: AtomicU64::new(start_ms),
        })
    }

    pub fn advance(&self, d: Duration) {
        let add = u64::try_from(d.as_millis()).unwrap_or(u64::MAX);
        self.ms.fetch_add(add, Ordering::SeqCst);
    }

    pub fn set_ms(&self, ms: u64) {
        self.ms.store(ms, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.ms.load(Ordering::SeqCst)
    }
}

/// How the client waits. Production uses tokio; tests use [`RecordingSleeper`].
#[async_trait]
pub trait Sleeper: Send + Sync + std::fmt::Debug {
    async fn sleep(&self, d: Duration);
}

#[derive(Debug, Default, Clone, Copy)]
pub struct TokioSleeper;

#[async_trait]
impl Sleeper for TokioSleeper {
    async fn sleep(&self, d: Duration) {
        tokio::time::sleep(d).await;
    }
}

/// Records every requested sleep and advances a [`ManualClock`] instead of
/// actually waiting.
#[derive(Debug)]
pub struct RecordingSleeper {
    clock: Arc<ManualClock>,
    slept: Mutex<Vec<Duration>>,
}

impl RecordingSleeper {
    pub fn new(clock: Arc<ManualClock>) -> Arc<Self> {
        Arc::new(Self {
            clock,
            slept: Mutex::new(Vec::new()),
        })
    }

    pub fn sleeps(&self) -> Vec<Duration> {
        self.slept.lock().map(|v| v.clone()).unwrap_or_default()
    }

    pub fn total(&self) -> Duration {
        self.sleeps().iter().sum()
    }
}

#[async_trait]
impl Sleeper for RecordingSleeper {
    async fn sleep(&self, d: Duration) {
        if let Ok(mut v) = self.slept.lock() {
            v.push(d);
        }
        self.clock.advance(d);
    }
}
