//! The narrow seam between the server and the deterministic simulation.
//!
//! Company actors only need to step, hash, apply opaque command payloads,
//! snapshot and restore. Keeping that behind [`Simulation`] means the server
//! does not depend on sim-core's evolving command/render API.

use serde::{Deserialize, Serialize};
use sim_core::{SimConfig, World};

/// What a company actor needs from a simulation.
///
/// Invariant: given the same `create` arguments (or the same `restore` bytes)
/// and the same ordered sequence of `apply`/`step` calls, `hash` is identical.
pub trait Simulation: Send + 'static {
    /// A fresh world at step 0.
    fn create(seed: u64, day_real_minutes: u32) -> Self
    where
        Self: Sized;
    /// The number of steps executed so far.
    fn current_step(&self) -> u64;
    /// Advance one fixed 100 ms step.
    fn step(&mut self);
    /// Stable state hash for lockstep desync checks.
    fn hash(&self) -> u64;
    /// Apply one opaque, encoded player command at the current step.
    /// `Err` means the command is rejected and must leave the world untouched.
    fn apply(&mut self, cmd: &[u8]) -> Result<(), String>;
    /// Full state, restorable with [`Simulation::restore`].
    fn snapshot(&self) -> Vec<u8>;
    fn restore(bytes: &[u8]) -> Result<Self, String>
    where
        Self: Sized;
}

impl Simulation for World {
    fn create(seed: u64, day_real_minutes: u32) -> Self {
        World::with_config(
            seed,
            SimConfig {
                day_real_minutes: u64::from(day_real_minutes),
                ..SimConfig::default()
            },
        )
    }

    fn current_step(&self) -> u64 {
        self.step
    }

    fn step(&mut self) {
        self.tick();
    }

    fn hash(&self) -> u64 {
        World::hash(self)
    }

    fn apply(&mut self, cmd: &[u8]) -> Result<(), String> {
        // Clients may only send player commands; server-issued commands
        // (job results, utterances, site signals) never come off the socket.
        let command: sim_core::Command =
            postcard::from_bytes(cmd).map_err(|e| format!("undecodable command: {e}"))?;
        World::apply(self, command)
            .map(|_| ())
            .map_err(|reject| format!("{reject:?}"))
    }

    fn snapshot(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("World serializes")
    }

    fn restore(bytes: &[u8]) -> Result<Self, String> {
        postcard::from_bytes(bytes).map_err(|e| format!("bad World snapshot: {e}"))
    }
}

/// Deterministic test double: a real [`World`] plus a running digest of every
/// applied command, so command order and content show up in the hash.
///
/// Payloads that are empty or start with `!` are rejected, which lets tests
/// exercise the reject path. Used by integration tests and local dev until
/// sim-core grows real commands.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LedgerSim {
    pub world: World,
    pub digest: u64,
    pub applied: u64,
}

impl Simulation for LedgerSim {
    fn create(seed: u64, day_real_minutes: u32) -> Self {
        Self {
            world: <World as Simulation>::create(seed, day_real_minutes),
            digest: 0,
            applied: 0,
        }
    }

    fn current_step(&self) -> u64 {
        self.world.step
    }

    fn step(&mut self) {
        self.world.tick();
    }

    fn hash(&self) -> u64 {
        let mut buf = Vec::with_capacity(24);
        buf.extend_from_slice(&self.world.hash().to_le_bytes());
        buf.extend_from_slice(&self.digest.to_le_bytes());
        buf.extend_from_slice(&self.applied.to_le_bytes());
        xxhash_rust::xxh3::xxh3_64(&buf)
    }

    fn apply(&mut self, cmd: &[u8]) -> Result<(), String> {
        if cmd.is_empty() || cmd[0] == b'!' {
            return Err("rejected by LedgerSim".into());
        }
        let mut buf = Vec::with_capacity(16 + cmd.len());
        buf.extend_from_slice(&self.digest.to_le_bytes());
        buf.extend_from_slice(&self.world.step.to_le_bytes());
        buf.extend_from_slice(cmd);
        self.digest = xxhash_rust::xxh3::xxh3_64(&buf);
        self.applied += 1;
        Ok(())
    }

    fn snapshot(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("LedgerSim serializes")
    }

    fn restore(bytes: &[u8]) -> Result<Self, String> {
        postcard::from_bytes(bytes).map_err(|e| format!("bad LedgerSim snapshot: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_snapshot_round_trips() {
        let mut w = <World as Simulation>::create(7, 60);
        for _ in 0..123 {
            Simulation::step(&mut w);
        }
        let r = <World as Simulation>::restore(&w.snapshot()).unwrap();
        assert_eq!(Simulation::hash(&r), Simulation::hash(&w));
        assert_eq!(r.current_step(), 123);
        assert_eq!(r.config.day_real_minutes, 60);
    }

    #[test]
    fn world_rejects_undecodable_commands_without_changing_state() {
        let mut w = <World as Simulation>::create(7, 60);
        let before = Simulation::hash(&w);
        let err = Simulation::apply(&mut w, b"\xff\xff\xff").unwrap_err();
        assert!(err.contains("undecodable"), "{err}");
        assert_eq!(Simulation::hash(&w), before);
    }

    #[test]
    fn world_applies_postcard_player_commands() {
        let mut w = sim_core::scenarios::demo_office(42);
        let before = Simulation::hash(&w);
        let cmd = sim_core::Command::SetPolicy(sim_core::commands::Policy::Overtime(
            sim_core::commands::OvertimePolicy::Crunch,
        ));
        let bytes = postcard::to_allocvec(&cmd).unwrap();
        Simulation::apply(&mut w, &bytes).unwrap();
        assert_ne!(Simulation::hash(&w), before);
    }

    #[test]
    fn ledger_hash_depends_on_command_order_and_step() {
        let run = |cmds: &[(u64, &[u8])]| {
            let mut s = LedgerSim::create(1, 20);
            for t in 0..10u64 {
                for (step, c) in cmds {
                    if *step == t {
                        s.apply(c).unwrap();
                    }
                }
                s.step();
            }
            s.hash()
        };
        let a = run(&[(1, b"a"), (1, b"b")]);
        assert_eq!(a, run(&[(1, b"a"), (1, b"b")]));
        assert_ne!(a, run(&[(1, b"b"), (1, b"a")]));
        assert_ne!(a, run(&[(2, b"a"), (2, b"b")]));
    }

    #[test]
    fn ledger_rejects_bang_and_stays_untouched() {
        let mut s = LedgerSim::create(1, 20);
        let h = s.hash();
        assert!(s.apply(b"!nope").is_err());
        assert!(s.apply(b"").is_err());
        assert_eq!(s.hash(), h);
        let r = LedgerSim::restore(&s.snapshot()).unwrap();
        assert_eq!(r.hash(), h);
    }
}
