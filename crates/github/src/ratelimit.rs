//! Per-installation rate governor.
//!
//! Two layers:
//! 1. A client-side **token bucket** (`permits` per `period`, with a burst
//!    capacity) so we never hammer GitHub, regardless of what it reports.
//!    All arithmetic is integer: one permit is worth `period_ms` units and
//!    every elapsed millisecond refills `permits` units, which is exact.
//! 2. **Server feedback**: `x-ratelimit-remaining`/`x-ratelimit-reset`
//!    (primary limit) and `retry-after` (secondary limit) push a
//!    `blocked_until` horizon that every caller waits out.
//!
//! The governor is pure with respect to time (`*_at(now_ms)` methods);
//! [`Governor::acquire`] adds a [`Clock`] + [`Sleeper`] so tests can drive it
//! with a [`crate::ManualClock`].

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http::HeaderMap;

use crate::clock::{Clock, Sleeper};

/// Rate-limit facts parsed from a GitHub response.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RateLimitInfo {
    pub remaining: Option<u64>,
    /// Unix epoch seconds at which the primary window resets.
    pub reset_epoch_s: Option<u64>,
    /// `retry-after` seconds (secondary limits, 429/403).
    pub retry_after_s: Option<u64>,
}

impl RateLimitInfo {
    pub fn from_headers(h: &HeaderMap) -> Self {
        let num = |name: &str| {
            h.get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.trim().parse::<u64>().ok())
        };
        Self {
            remaining: num("x-ratelimit-remaining"),
            reset_epoch_s: num("x-ratelimit-reset"),
            retry_after_s: num("retry-after"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GovernorConfig {
    /// Permits granted per `period_ms`.
    pub permits: u64,
    pub period_ms: u64,
    /// Bucket size in permits (max burst).
    pub burst: u64,
    /// Base backoff for a secondary limit that came without `retry-after`
    /// (GitHub's docs: wait at least a minute); doubles per attempt.
    pub secondary_base_backoff_ms: u64,
    /// Cap on any single computed wait.
    pub max_wait_ms: u64,
}

impl Default for GovernorConfig {
    /// GitHub App installations get 5000 requests/hour; keep headroom and
    /// allow short bursts.
    fn default() -> Self {
        Self {
            permits: 4500,
            period_ms: 3_600_000,
            burst: 50,
            secondary_base_backoff_ms: 60_000,
            max_wait_ms: 3_600_000,
        }
    }
}

#[derive(Debug)]
struct State {
    /// Scaled units; one permit = `period_ms` units.
    units: u64,
    last_ms: u64,
    blocked_until_ms: u64,
}

#[derive(Debug)]
pub struct Governor {
    cfg: GovernorConfig,
    state: Mutex<State>,
}

impl Governor {
    pub fn new(cfg: GovernorConfig, now_ms: u64) -> Self {
        let cfg = GovernorConfig {
            permits: cfg.permits.max(1),
            period_ms: cfg.period_ms.max(1),
            burst: cfg.burst.max(1),
            ..cfg
        };
        Self {
            state: Mutex::new(State {
                units: cfg.burst.saturating_mul(cfg.period_ms),
                last_ms: now_ms,
                blocked_until_ms: 0,
            }),
            cfg,
        }
    }

    pub fn config(&self) -> GovernorConfig {
        self.cfg
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn refill(&self, s: &mut State, now_ms: u64) {
        if now_ms > s.last_ms {
            let cap = self.cfg.burst.saturating_mul(self.cfg.period_ms);
            let add = (now_ms - s.last_ms).saturating_mul(self.cfg.permits);
            s.units = s.units.saturating_add(add).min(cap);
            s.last_ms = now_ms;
        }
    }

    /// Try to take one permit at `now_ms`. `None` = granted; `Some(wait)` =
    /// not granted, try again after `wait`.
    pub fn try_acquire_at(&self, now_ms: u64) -> Option<Duration> {
        let mut s = self.lock();
        if now_ms < s.blocked_until_ms {
            return Some(Duration::from_millis(s.blocked_until_ms - now_ms));
        }
        self.refill(&mut s, now_ms);
        let one = self.cfg.period_ms;
        if s.units >= one {
            s.units -= one;
            None
        } else {
            let deficit = one - s.units;
            let wait = deficit.div_ceil(self.cfg.permits);
            Some(Duration::from_millis(wait.max(1)))
        }
    }

    /// Feed a response's headers back. Returns the wait now imposed (zero if
    /// none).
    pub fn observe_at(&self, now_ms: u64, info: RateLimitInfo) -> Duration {
        let mut until = 0u64;
        if let Some(ra) = info.retry_after_s {
            until = until.max(now_ms.saturating_add(ra.saturating_mul(1000)));
        }
        if info.remaining == Some(0) {
            if let Some(reset) = info.reset_epoch_s {
                // +1s guards against clock skew landing us just before reset.
                until = until.max(reset.saturating_mul(1000).saturating_add(1000));
            }
        }
        self.block_until(now_ms, until)
    }

    /// Back off for a secondary limit that arrived without `retry-after`.
    /// `attempt` starts at 0.
    pub fn penalize_secondary_at(&self, now_ms: u64, attempt: u32) -> Duration {
        let factor = 1u64.checked_shl(attempt.min(16)).unwrap_or(u64::MAX);
        let wait = self.cfg.secondary_base_backoff_ms.saturating_mul(factor);
        self.block_until(now_ms, now_ms.saturating_add(wait))
    }

    fn block_until(&self, now_ms: u64, until: u64) -> Duration {
        let until = until.min(now_ms.saturating_add(self.cfg.max_wait_ms));
        let mut s = self.lock();
        if until > s.blocked_until_ms {
            s.blocked_until_ms = until;
        }
        Duration::from_millis(s.blocked_until_ms.saturating_sub(now_ms))
    }

    /// Current server-imposed block horizon (epoch ms), 0 if none.
    pub fn blocked_until_ms(&self) -> u64 {
        self.lock().blocked_until_ms
    }

    /// Wait (via `sleeper`) until a permit is granted.
    pub async fn acquire(&self, clock: &dyn Clock, sleeper: &dyn Sleeper) {
        while let Some(wait) = self.try_acquire_at(clock.now_ms()) {
            sleeper.sleep(wait).await;
        }
    }
}

/// One governor per GitHub App installation (limits are per installation).
#[derive(Debug, Default)]
pub struct GovernorPool {
    cfg: GovernorConfig,
    map: Mutex<HashMap<u64, Arc<Governor>>>,
}

impl GovernorPool {
    pub fn new(cfg: GovernorConfig) -> Self {
        Self {
            cfg,
            map: Mutex::new(HashMap::new()),
        }
    }

    pub fn for_installation(&self, installation_id: u64, now_ms: u64) -> Arc<Governor> {
        let mut m = self.map.lock().unwrap_or_else(|p| p.into_inner());
        m.entry(installation_id)
            .or_insert_with(|| Arc::new(Governor::new(self.cfg, now_ms)))
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{ManualClock, RecordingSleeper};

    fn cfg(permits: u64, period_ms: u64, burst: u64) -> GovernorConfig {
        GovernorConfig {
            permits,
            period_ms,
            burst,
            ..GovernorConfig::default()
        }
    }

    #[test]
    fn bucket_allows_burst_then_waits_for_refill() {
        // 10 permits per second, burst 3.
        let g = Governor::new(cfg(10, 1000, 3), 0);
        assert_eq!(g.try_acquire_at(0), None);
        assert_eq!(g.try_acquire_at(0), None);
        assert_eq!(g.try_acquire_at(0), None);
        assert_eq!(g.try_acquire_at(0), Some(Duration::from_millis(100)));
        assert_eq!(g.try_acquire_at(50), Some(Duration::from_millis(50)));
        assert_eq!(g.try_acquire_at(100), None);
    }

    #[test]
    fn bucket_never_exceeds_burst() {
        let g = Governor::new(cfg(10, 1000, 2), 0);
        // A long idle period must not bank more than `burst` permits.
        assert_eq!(g.try_acquire_at(1_000_000), None);
        assert_eq!(g.try_acquire_at(1_000_000), None);
        assert!(g.try_acquire_at(1_000_000).is_some());
    }

    #[test]
    fn fractional_rate_is_exact() {
        // 5000/hour: one permit every 720 ms.
        let g = Governor::new(cfg(5000, 3_600_000, 1), 0);
        assert_eq!(g.try_acquire_at(0), None);
        assert_eq!(g.try_acquire_at(0), Some(Duration::from_millis(720)));
        assert_eq!(g.try_acquire_at(719), Some(Duration::from_millis(1)));
        assert_eq!(g.try_acquire_at(720), None);
    }

    #[test]
    fn primary_limit_exhausted_blocks_until_reset() {
        let now = 1_700_000_000_000;
        let g = Governor::new(GovernorConfig::default(), now);
        let wait = g.observe_at(
            now,
            RateLimitInfo {
                remaining: Some(0),
                reset_epoch_s: Some(1_700_000_030),
                retry_after_s: None,
            },
        );
        assert_eq!(wait, Duration::from_secs(31));
        assert_eq!(
            g.try_acquire_at(now + 10_000),
            Some(Duration::from_secs(21))
        );
        assert_eq!(g.try_acquire_at(now + 31_000), None);
    }

    #[test]
    fn remaining_nonzero_does_not_block() {
        let g = Governor::new(GovernorConfig::default(), 0);
        let w = g.observe_at(
            0,
            RateLimitInfo {
                remaining: Some(17),
                reset_epoch_s: Some(99_999),
                retry_after_s: None,
            },
        );
        assert_eq!(w, Duration::ZERO);
        assert_eq!(g.try_acquire_at(0), None);
    }

    #[test]
    fn retry_after_blocks() {
        let g = Governor::new(GovernorConfig::default(), 5_000);
        let w = g.observe_at(
            5_000,
            RateLimitInfo {
                retry_after_s: Some(7),
                ..Default::default()
            },
        );
        assert_eq!(w, Duration::from_secs(7));
        assert_eq!(g.blocked_until_ms(), 12_000);
    }

    #[test]
    fn later_shorter_block_does_not_shorten_horizon() {
        let g = Governor::new(GovernorConfig::default(), 0);
        g.observe_at(
            0,
            RateLimitInfo {
                retry_after_s: Some(60),
                ..Default::default()
            },
        );
        let w = g.observe_at(
            1_000,
            RateLimitInfo {
                retry_after_s: Some(1),
                ..Default::default()
            },
        );
        assert_eq!(w, Duration::from_secs(59));
    }

    #[test]
    fn secondary_backoff_doubles_and_is_capped() {
        let g = Governor::new(
            GovernorConfig {
                secondary_base_backoff_ms: 1_000,
                max_wait_ms: 5_000,
                ..GovernorConfig::default()
            },
            0,
        );
        assert_eq!(g.penalize_secondary_at(0, 0), Duration::from_secs(1));
        assert_eq!(g.penalize_secondary_at(0, 1), Duration::from_secs(2));
        assert_eq!(g.penalize_secondary_at(0, 2), Duration::from_secs(4));
        assert_eq!(g.penalize_secondary_at(0, 10), Duration::from_secs(5));
    }

    #[test]
    fn headers_parse() {
        let mut h = HeaderMap::new();
        h.insert("x-ratelimit-remaining", "0".parse().unwrap());
        h.insert("x-ratelimit-reset", "1700000030".parse().unwrap());
        h.insert("retry-after", " 12 ".parse().unwrap());
        assert_eq!(
            RateLimitInfo::from_headers(&h),
            RateLimitInfo {
                remaining: Some(0),
                reset_epoch_s: Some(1_700_000_030),
                retry_after_s: Some(12),
            }
        );
    }

    #[tokio::test]
    async fn acquire_sleeps_on_fake_clock() {
        let clock = ManualClock::new(0);
        let sleeper = RecordingSleeper::new(clock.clone());
        let g = Governor::new(cfg(1, 1000, 1), 0);
        g.acquire(clock.as_ref(), sleeper.as_ref()).await;
        g.acquire(clock.as_ref(), sleeper.as_ref()).await;
        g.acquire(clock.as_ref(), sleeper.as_ref()).await;
        assert_eq!(sleeper.total(), Duration::from_secs(2));
        assert_eq!(clock.now_ms(), 2_000);
    }

    #[test]
    fn pool_is_per_installation() {
        let pool = GovernorPool::new(cfg(1, 1000, 1));
        let a = pool.for_installation(1, 0);
        let a2 = pool.for_installation(1, 0);
        let b = pool.for_installation(2, 0);
        assert!(Arc::ptr_eq(&a, &a2));
        assert!(!Arc::ptr_eq(&a, &b));
        assert_eq!(a.try_acquire_at(0), None);
        assert!(a.try_acquire_at(0).is_some());
        assert_eq!(b.try_acquire_at(0), None);
    }
}
