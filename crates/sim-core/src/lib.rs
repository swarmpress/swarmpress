//! Deterministic simulation core for SimPress.
//!
//! Rules (see `specs/game.md` §Simulation):
//! - integer / fixed-point math only, no floats
//! - ordered collections only (`Vec`, `BTreeMap`), never iterate a `HashMap`
//! - all randomness comes from the seeded PCG stored in the [`World`]
//! - the same seed + the same ordered command log yields the same
//!   [`World::hash`] natively and in wasm

use rand_pcg::Pcg32;
use serde::{Deserialize, Serialize};

/// Simulation steps per real second. One step = 100 ms.
pub const STEPS_PER_SECOND: u64 = 10;

/// Minutes in an in-game day.
pub const MINUTES_PER_DAY: u64 = 24 * 60;

/// Tunables that are fixed for the lifetime of a world.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimConfig {
    /// Real minutes per in-game day.
    pub day_real_minutes: u64,
    /// In-game minute-of-day at step 0 (default 07:00, before the office opens).
    pub start_minute: u64,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            day_real_minutes: 20,
            start_minute: 7 * 60,
        }
    }
}

impl SimConfig {
    pub fn steps_per_day(&self) -> u64 {
        self.day_real_minutes * 60 * STEPS_PER_SECOND
    }
}

/// In-game time derived from the step counter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Clock {
    pub day: u64,
    /// Minute of day, 0..1440.
    pub minute: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct World {
    pub step: u64,
    pub seed: u64,
    pub config: SimConfig,
    rng: Pcg32,
}

impl World {
    pub fn new(seed: u64) -> Self {
        Self::with_config(seed, SimConfig::default())
    }

    pub fn with_config(seed: u64, config: SimConfig) -> Self {
        Self {
            step: 0,
            seed,
            config,
            rng: Pcg32::new(seed, 0xa02b_dbf7_bb3c_0a7),
        }
    }

    /// In-game clock. Integer math: minute = start + step * 1440 / steps_per_day.
    pub fn clock(&self) -> Clock {
        let total =
            self.config.start_minute + self.step * MINUTES_PER_DAY / self.config.steps_per_day();
        Clock {
            day: total / MINUTES_PER_DAY,
            minute: total % MINUTES_PER_DAY,
        }
    }

    /// Advances the simulation by one fixed step.
    pub fn tick(&mut self) {
        self.step += 1;
    }

    /// Stable hash of the whole world state, used for lockstep desync checks.
    pub fn hash(&self) -> u64 {
        let bytes = postcard::to_allocvec(self).expect("world serializes");
        xxhash_rust::xxh3::xxh3_64(&bytes)
    }

    pub fn rng(&mut self) -> &mut Pcg32 {
        &mut self.rng
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_hash() {
        let mut a = World::new(42);
        let mut b = World::new(42);
        for _ in 0..1000 {
            a.tick();
            b.tick();
        }
        assert_eq!(a.hash(), b.hash());
    }

    #[test]
    fn clock_advances_one_day_per_configured_period() {
        let mut w = World::new(1);
        assert_eq!(
            w.clock(),
            Clock {
                day: 0,
                minute: 7 * 60
            }
        );
        for _ in 0..w.config.steps_per_day() {
            w.tick();
        }
        assert_eq!(
            w.clock(),
            Clock {
                day: 1,
                minute: 7 * 60
            }
        );
    }

    #[test]
    fn clock_wraps_at_midnight() {
        let mut w = World::with_config(
            1,
            SimConfig {
                day_real_minutes: 144,
                start_minute: 23 * 60 + 59,
            },
        );
        let per_minute = w.config.steps_per_day() / MINUTES_PER_DAY;
        assert!(per_minute > 0);
        for _ in 0..per_minute {
            w.tick();
        }
        assert_eq!(w.clock(), Clock { day: 1, minute: 0 });
    }

    #[test]
    fn different_seed_different_hash() {
        assert_ne!(World::new(1).hash(), World::new(2).hash());
    }
}
