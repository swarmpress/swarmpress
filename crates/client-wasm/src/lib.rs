//! Browser-facing API. Everything the TypeScript client needs from the
//! simulation goes through this facade.

use wasm_bindgen::prelude::*;

/// Crate version plus protocol version, shown in the client HUD.
#[wasm_bindgen]
pub fn version() -> String {
    format!(
        "sim-core {} / proto v{}",
        env!("CARGO_PKG_VERSION"),
        protocol::PROTO_VERSION
    )
}

/// A locally running simulation (offline sandbox, and the lockstep replica
/// when connected to a server).
#[wasm_bindgen]
pub struct Sim {
    world: sim_core::World,
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64) -> Sim {
        Sim {
            world: sim_core::World::new(seed),
        }
    }

    pub fn tick(&mut self) {
        self.world.tick();
    }

    pub fn step(&self) -> u64 {
        self.world.step
    }

    pub fn hash(&self) -> u64 {
        self.world.hash()
    }

    /// In-game minute of day (0..1440); drives sun, sky and interior lighting.
    pub fn minute_of_day(&self) -> u32 {
        self.world.clock().minute as u32
    }

    pub fn day(&self) -> u32 {
        self.world.clock().day as u32
    }

    /// Debug/preview only: jump the clock forward by whole steps.
    pub fn advance(&mut self, steps: u32) {
        for _ in 0..steps {
            self.world.tick();
        }
    }

    pub fn steps_per_day(&self) -> u64 {
        self.world.config.steps_per_day()
    }
}
