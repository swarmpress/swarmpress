//! Browser-facing API. Everything the TypeScript client needs from the
//! simulation goes through this facade.
//!
//! Binary boundary: commands and the render state are postcard bytes
//! (`Uint8Array`) using the `sim-core` / `protocol` types. Until the client has
//! a postcard decoder it reads the JSON views ([`Sim::render_state_json`],
//! [`Sim::layout_json`]), which are in metres.

pub mod json;

use sim_core::commands::{Command, ServerCommand};
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
    /// An empty company on the default lot.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64) -> Sim {
        Sim {
            world: sim_core::World::new(seed),
        }
    }

    /// The demo office (newsroom, editor's office, meeting room, five staff).
    pub fn demo(seed: u64) -> Sim {
        Sim {
            world: sim_core::scenarios::demo_office(seed),
        }
    }

    /// Advances one fixed step (100 ms).
    pub fn tick(&mut self) {
        self.world.step();
    }

    pub fn step(&self) -> u64 {
        self.world.step
    }

    pub fn hash(&self) -> u64 {
        self.world.hash()
    }

    /// In-game minute of day (0..1440); drives sun, sky and interior lighting.
    pub fn minute_of_day(&self) -> u32 {
        u32::from(self.world.clock().minute)
    }

    pub fn day(&self) -> u32 {
        self.world.clock().day
    }

    /// Advances `steps` fixed steps (catch-up, previews, tests).
    pub fn advance(&mut self, steps: u32) {
        for _ in 0..steps {
            self.world.step();
        }
    }

    pub fn steps_per_day(&self) -> u64 {
        self.world.config.steps_per_day()
    }

    pub fn cash_cents(&self) -> i64 {
        self.world.company.cash
    }

    /// Decodes a postcard [`Command`] and applies it now. `Err` carries the
    /// player-facing reason (decode error or rejection).
    pub fn apply_command(&mut self, bytes: &[u8]) -> Result<(), String> {
        let cmd: Command = protocol::decode(bytes).map_err(|e| format!("bad command: {e}"))?;
        self.world.apply(cmd).map(|_| ()).map_err(|r| r.to_string())
    }

    /// Decodes a postcard [`ServerCommand`] and applies it now (offline
    /// sandbox; online, server commands arrive as stamped frames).
    pub fn apply_server_command(&mut self, bytes: &[u8]) -> Result<(), String> {
        let cmd: ServerCommand =
            protocol::decode(bytes).map_err(|e| format!("bad server command: {e}"))?;
        self.world
            .apply_server(cmd)
            .map(|_| ())
            .map_err(|r| r.to_string())
    }

    /// `None` when the postcard [`Command`] would apply, otherwise the reason.
    /// Used for placement previews.
    pub fn validate_command(&self, bytes: &[u8]) -> Option<String> {
        match protocol::decode::<Command>(bytes) {
            Err(e) => Some(format!("bad command: {e}")),
            Ok(cmd) => sim_core::validate(&self.world, &cmd)
                .err()
                .map(|r| r.to_string()),
        }
    }

    /// Postcard-encoded [`sim_core::RenderState`].
    pub fn render_state(&self) -> Vec<u8> {
        protocol::encode(&self.world.render_state()).unwrap_or_default()
    }

    /// The render state as JSON (metres), shaped like the TS `RenderState`.
    pub fn render_state_json(&self) -> String {
        json::render_state(&self.world, &self.world.render_state()).to_string()
    }

    /// The building layout as JSON (metres), shaped like the TS `BuildingLayout`.
    pub fn layout_json(&self) -> String {
        json::layout(&self.world.building).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use sim_core::commands::Policy;

    #[test]
    fn demo_layout_matches_ts_shape() {
        let sim = Sim::demo(1);
        let v: Value = serde_json::from_str(&sim.layout_json()).unwrap();
        assert_eq!(v["width"], 16.0);
        assert_eq!(v["depth"], 10.0);
        let rooms = v["rooms"].as_array().unwrap();
        assert_eq!(rooms.len(), 3);
        assert_eq!(rooms[0]["kind"], "newsroom");
        assert_eq!(rooms[0]["w"], 10.0);
        assert_eq!(rooms[0]["windows"].as_array().unwrap().len(), 4);
        assert_eq!(rooms[0]["desks"].as_array().unwrap().len(), 4);
        assert_eq!(rooms[0]["desks"][0]["x"], 2.5);
        assert_eq!(rooms[0]["desks"][0]["z"], 3.0);
        assert_eq!(rooms[0]["ceilingLights"].as_array().unwrap().len(), 4);
        assert_eq!(rooms[1]["kind"], "editor-office");
        assert_eq!(rooms[1]["desks"][0]["rot"], std::f64::consts::PI);
        assert_eq!(rooms[2]["windows"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn render_state_json_tracks_the_day() {
        let mut sim = Sim::demo(1);
        // 07:00 → 10:30
        sim.advance(1_750);
        let v: Value = serde_json::from_str(&sim.render_state_json()).unwrap();
        assert_eq!(v["minute"], 630);
        assert_eq!(v["staff"].as_array().unwrap().len(), 5);
        let monitors_on = v["monitors"]
            .as_object()
            .unwrap()
            .values()
            .filter(|b| b.as_bool() == Some(true))
            .count();
        assert_eq!(monitors_on, 5);
        let s = &v["staff"][0];
        assert!(s["name"].is_string());
        assert!(s["color"].as_str().unwrap().starts_with('#'));
        let bytes = sim.render_state();
        let rs: sim_core::RenderState = protocol::decode(&bytes).unwrap();
        assert_eq!(rs.minute, 630);
    }

    #[test]
    fn commands_through_bytes() {
        let mut sim = Sim::demo(1);
        let ok = protocol::encode(&Command::SetPolicy(Policy::QualityBar(9))).unwrap();
        let bad = protocol::encode(&Command::SetPolicy(Policy::QualityBar(99))).unwrap();
        assert_eq!(sim.validate_command(&ok), None);
        assert!(sim.validate_command(&bad).unwrap().contains("quality bar"));
        assert!(sim.validate_command(&[0xff, 0xff]).is_some());
        assert_eq!(sim.apply_command(&ok), Ok(()));
        assert!(sim.apply_command(&bad).is_err());
    }
}
