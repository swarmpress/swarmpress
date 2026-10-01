//! Browser-facing API. Everything the TypeScript client needs from the
//! simulation goes through this facade.
//!
//! Binary boundary: commands and the render state are postcard bytes
//! (`Uint8Array`) using the `sim-core` / `protocol` types. Until the client has
//! a postcard decoder it reads the JSON views ([`Sim::render_state_json`],
//! [`Sim::layout_json`]), which are in metres, and the organization views
//! ([`Sim::org_json`], [`Sim::finance_json`], [`Sim::inbox_json`]), which are
//! in euros. Commands can also be sent as JSON ([`Sim::apply_command_json`]);
//! the shapes are documented in this crate's README.

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

    /// The cinqueterre.travel starting company (13 people, one project,
    /// a 24×16 m office with a room per department).
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

    /// Org chart, people and projects (organization.md §9).
    pub fn org_json(&self) -> String {
        json::org(&self.world).to_string()
    }

    /// Cash, runway, month-to-date books and CFO alerts (organization.md §9).
    pub fn finance_json(&self) -> String {
        json::finance(&self.world).to_string()
    }

    /// Tickets and the Secretary's queue (organization.md §9).
    pub fn inbox_json(&self) -> String {
        json::inbox(&self.world).to_string()
    }

    /// Parses a JSON [`Command`] (serde's external tagging, see the README)
    /// and applies it now. `Err` carries the reason.
    pub fn apply_command_json(&mut self, json: &str) -> Result<(), String> {
        let cmd = parse_command(json)?;
        self.world.apply(cmd).map(|_| ()).map_err(|r| r.to_string())
    }

    /// `None` when the JSON [`Command`] would apply, otherwise the reason.
    pub fn validate_command_json(&self, json: &str) -> Option<String> {
        match parse_command(json) {
            Err(e) => Some(e),
            Ok(cmd) => sim_core::validate(&self.world, &cmd)
                .err()
                .map(|r| r.to_string()),
        }
    }

    /// Parses a JSON [`ServerCommand`] and applies it now (offline sandbox:
    /// site and analytics signals, utterances).
    pub fn apply_server_command_json(&mut self, json: &str) -> Result<(), String> {
        let cmd: ServerCommand =
            serde_json::from_str(json).map_err(|e| format!("bad server command: {e}"))?;
        self.world
            .apply_server(cmd)
            .map(|_| ())
            .map_err(|r| r.to_string())
    }
}

fn parse_command(json: &str) -> Result<Command, String> {
    serde_json::from_str(json).map_err(|e| format!("bad command: {e}"))
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
        assert_eq!(v["width"], 24.0);
        assert_eq!(v["depth"], 16.0);
        let rooms = v["rooms"].as_array().unwrap();
        assert_eq!(rooms.len(), 11);
        assert_eq!(rooms[0]["kind"], "newsroom");
        assert_eq!(rooms[0]["w"], 8.0);
        assert_eq!(rooms[0]["windows"].as_array().unwrap().len(), 3);
        assert_eq!(rooms[0]["desks"].as_array().unwrap().len(), 6);
        assert_eq!(rooms[0]["desks"][0]["x"], 1.5);
        assert_eq!(rooms[0]["desks"][0]["z"], 1.5);
        assert_eq!(rooms[0]["desks"][0]["rot"], 0.0);
        let kinds: Vec<&str> = rooms.iter().map(|r| r["kind"].as_str().unwrap()).collect();
        for k in [
            "finance-office",
            "strategy-room",
            "ceo-office",
            "server-room",
            "seo-lab",
        ] {
            assert!(kinds.contains(&k), "{k}");
        }
        let server = rooms.iter().find(|r| r["kind"] == "server-room").unwrap();
        assert_eq!(server["windows"].as_array().unwrap().len(), 0);
        let total_desks: usize = rooms
            .iter()
            .map(|r| r["desks"].as_array().unwrap().len())
            .sum();
        assert_eq!(total_desks, 16, "13 people + 3 spare");
    }

    #[test]
    fn render_state_json_tracks_the_day() {
        let mut sim = Sim::demo(1);
        // 07:00 → 10:30
        sim.advance(1_750);
        let v: Value = serde_json::from_str(&sim.render_state_json()).unwrap();
        assert_eq!(v["minute"], 630);
        assert_eq!(v["weekday"], "monday");
        assert_eq!(v["staff"].as_array().unwrap().len(), 13);
        let monitors_on = v["monitors"]
            .as_object()
            .unwrap()
            .values()
            .filter(|b| b.as_bool() == Some(true))
            .count();
        assert_eq!(monitors_on, 13);
        let s = &v["staff"][0];
        assert_eq!(s["persona"], "giulia");
        assert_eq!(s["department"], "editorial");
        assert!(s["name"].is_string());
        assert!(s["color"].as_str().unwrap().starts_with('#'));
        let bytes = sim.render_state();
        let rs: sim_core::RenderState = protocol::decode(&bytes).unwrap();
        assert_eq!(rs.minute, 630);
    }

    #[test]
    fn standup_shows_in_render_state_meetings() {
        let mut sim = Sim::demo(1);
        sim.advance(1_050); // 09:06
        let v: Value = serde_json::from_str(&sim.render_state_json()).unwrap();
        let m = &v["meetings"][0];
        assert_eq!(m["kind"], "standup");
        assert_eq!(m["project"], "project-1");
        assert_eq!(m["active"], true);
        assert!(m["attendees"].as_array().unwrap().len() >= 9);
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

    #[test]
    fn org_json_matches_the_contract() {
        let sim = Sim::demo(1);
        let v: Value = serde_json::from_str(&sim.org_json()).unwrap();
        assert_eq!(v["ceo"]["name"], "You");
        assert_eq!(v["executive"]["cfo"], "staff-7");
        assert_eq!(v["executive"]["secretary"], "staff-8");
        assert_eq!(v["executive"]["delegation"], "low");
        let deps = v["departments"].as_array().unwrap();
        assert_eq!(deps.len(), 7);
        let editorial = deps.iter().find(|d| d["id"] == "editorial").unwrap();
        assert_eq!(editorial["name"], "Editorial");
        assert_eq!(editorial["head"], "staff-4", "the editor-in-chief");
        assert_eq!(editorial["members"].as_array().unwrap().len(), 5);
        let strategy = deps.iter().find(|d| d["id"] == "strategy").unwrap();
        assert_eq!(strategy["head"], "staff-9");
        let staff = v["staff"].as_array().unwrap();
        assert_eq!(staff.len(), 13);
        let giulia = &staff[0];
        assert_eq!(giulia["id"], "staff-1");
        assert_eq!(giulia["persona"], "giulia");
        assert_eq!(giulia["role"], "writer");
        assert_eq!(giulia["department"], "editorial");
        assert_eq!(giulia["seniority"], "senior");
        assert_eq!(giulia["salaryEurMonth"], 4200);
        assert_eq!(giulia["morale"], 0.7);
        assert_eq!(giulia["fatigue"], 0.0);
        assert_eq!(giulia["activity"], "off-site");
        assert_eq!(giulia["projects"][0]["project"], "project-1");
        assert_eq!(giulia["projects"][0]["allocation"], 100);
        assert_eq!(staff[6]["projects"].as_array().unwrap().len(), 0, "CFO");
        assert_eq!(staff[12]["persona"], "matteo");
        assert_eq!(staff[12]["role"], "data-scientist");
        let p = &v["projects"][0];
        assert_eq!(p["id"], "project-1");
        assert_eq!(p["slug"], "cinqueterre-travel");
        assert_eq!(p["name"], "cinqueterre.travel");
        assert_eq!(p["domain"], "cinqueterre.travel");
        assert_eq!(p["status"], "active");
        assert_eq!(p["lead"], "staff-4");
        assert_eq!(p["team"].as_array().unwrap().len(), 9);
        assert_eq!(p["budgetEurMonth"], 80_000.0);
        assert_eq!(p["missingRoles"].as_array().unwrap().len(), 0);
        assert_eq!(p["analytics"]["connected"], false);
        assert_eq!(p["analytics"]["sessions7d"], 0);
        assert_eq!(p["analytics"]["visitors7d"], 0);
        assert_eq!(p["analytics"]["pageviews7d"], 0);
        assert_eq!(p["analytics"]["engagementRate"], 0.0);
    }

    #[test]
    fn json_commands_and_views_round_trip() {
        let mut sim = Sim::demo(1);
        sim.advance(1_000);
        // fire the photographer: a missing-role ticket shows in the inbox
        let fire = r#"{"Fire":{"staff":"staff-6"}}"#;
        assert_eq!(sim.validate_command_json(fire), None);
        sim.apply_command_json(fire).unwrap();
        let org: Value = serde_json::from_str(&sim.org_json()).unwrap();
        assert_eq!(org["projects"][0]["missingRoles"][0], "photographer");
        let inbox: Value = serde_json::from_str(&sim.inbox_json()).unwrap();
        assert_eq!(inbox["delegation"], "low");
        let t = &inbox["tickets"][0];
        assert_eq!(t["id"], "ticket-1");
        assert_eq!(t["kind"], "missing-role");
        assert_eq!(t["priority"], "medium");
        assert_eq!(t["project"], "project-1");
        assert_eq!(t["from"], "staff-4");
        assert_eq!(t["status"], "open");
        assert_eq!(t["routedViaSecretary"], true);
        assert_eq!(t["options"][0], "arrange-hiring");
        assert_eq!(t["defaultOption"], "arrange-hiring");
        assert!(t["deadlineMinute"].as_u64().unwrap() > 2 * 1440);
        // the briefing task is in the Secretary's queue
        let q = inbox["secretaryQueue"].as_array().unwrap();
        assert_eq!(q[0]["kind"], "prepare-briefing");
        // answer it by slug
        sim.apply_command_json(
            r#"{"AnswerTicket":{"ticket":"ticket-1","option":"arrange-hiring"}}"#,
        )
        .unwrap();
        let inbox: Value = serde_json::from_str(&sim.inbox_json()).unwrap();
        assert_eq!(inbox["tickets"][0]["status"], "answered");
        assert_eq!(inbox["tickets"][0]["resolvedBy"], "ceo");
        // rejections carry the reason
        let over =
            r#"{"AssignToProject":{"staff":"staff-1","project":"project-1","allocation_pct":120}}"#;
        let err = sim.validate_command_json(over).unwrap();
        assert!(err.contains("allocation"), "{err}");
        assert!(sim
            .validate_command_json("{nope")
            .unwrap()
            .contains("bad command"));
        assert!(sim
            .apply_command_json(r#"{"Praise":{"staff":"staff-99"}}"#)
            .is_err());
        // delegate, delegation, budgets
        for cmd in [
            r#"{"SetDelegation":{"policy":"low-and-medium"}}"#,
            r#"{"SetProjectBudget":{"project":"project-1","monthly_cents":9000000}}"#,
            r#"{"Delegate":{"task":{"ScheduleMeeting":{"attendees":["staff-1","staff-2"],"project":"project-1"}}}}"#,
            r#"{"Delegate":{"task":"TriageInbox"}}"#,
            r#"{"Praise":{"staff":"staff-2"}}"#,
            r#"{"Promote":{"staff":"staff-12"}}"#,
            r#"{"SetSalary":{"staff":"staff-1","cents_per_day":15000}}"#,
            r#"{"CreateProject":{"slug":"amalfi","name":"Amalfi Dispatch","domain":"amalfi.travel"}}"#,
        ] {
            assert_eq!(sim.apply_command_json(cmd), Ok(()), "{cmd}");
        }
        let org: Value = serde_json::from_str(&sim.org_json()).unwrap();
        assert_eq!(org["executive"]["delegation"], "low-and-medium");
        assert_eq!(org["projects"][1]["status"], "proposed");
        assert_eq!(org["projects"][0]["budgetEurMonth"], 90_000.0);
        // analytics from the sandbox
        let signal = serde_json::json!({
            "AnalyticsSignals": {
                "project": "project-1",
                "day": sim.day(),
                "sessions": 1200,
                "visitors": 900,
                "pageviews": 3000,
                "engagement_pm": 650,
                "top_pages_digest": 7
            }
        });
        sim.apply_server_command_json(&signal.to_string()).unwrap();
        let org: Value = serde_json::from_str(&sim.org_json()).unwrap();
        let a = &org["projects"][0]["analytics"];
        assert_eq!(a["connected"], true);
        assert_eq!(a["visitors7d"], 900);
        assert_eq!(a["engagementRate"], 0.65);
    }

    /// Every JSON example in the README parses as a command.
    #[test]
    fn readme_examples_parse() {
        let readme = include_str!("../README.md");
        let mut examples = Vec::new();
        let mut buf = String::new();
        let mut depth = 0i32;
        for line in readme.lines() {
            let line = line.trim();
            if depth == 0 && !line.starts_with("{\"") {
                continue;
            }
            for c in line.chars() {
                if depth == 0 && !buf.is_empty() {
                    break;
                }
                buf.push(c);
                match c {
                    '{' => depth += 1,
                    '}' => depth -= 1,
                    _ => {}
                }
            }
            if depth == 0 {
                examples.push(std::mem::take(&mut buf));
            }
        }
        assert!(examples.len() >= 30, "{}", examples.len());
        for e in &examples {
            let player = serde_json::from_str::<Command>(e);
            let server = serde_json::from_str::<ServerCommand>(e);
            assert!(player.is_ok() || server.is_ok(), "{e}: {player:?}");
        }
    }

    #[test]
    fn finance_json_matches_the_contract() {
        let mut sim = Sim::demo(1);
        let v: Value = serde_json::from_str(&sim.finance_json()).unwrap();
        assert!(v["cashEur"].as_f64().unwrap() > 100_000.0);
        assert!(v["runwayDays"].as_u64().unwrap() > 30);
        assert!(v["dailyBurnEur"].as_f64().unwrap() > 1_000.0);
        assert_eq!(v["month"], 1);
        assert_eq!(v["booksUnkept"], false);
        assert_eq!(v["revenueStubbed"], true);
        for k in [
            "revenueEur",
            "salariesEur",
            "rentEur",
            "upkeepEur",
            "agencyEur",
        ] {
            assert!(v["company"][k].is_number(), "{k}");
        }
        let p = &v["projects"][0];
        assert_eq!(p["id"], "project-1");
        assert_eq!(p["budgetEurMonth"], 80_000.0);
        assert_eq!(p["spentEurMonth"], 0.0);
        assert_eq!(p["revenueEurMonth"], 0.0);
        assert_eq!(p["overBudget"], false);
        assert_eq!(v["alerts"].as_array().unwrap().len(), 0);
        assert!(v["lastClose"].is_null());
        // one day later the project has spent money
        let per_day = u32::try_from(sim.steps_per_day()).unwrap();
        sim.advance(per_day);
        let v: Value = serde_json::from_str(&sim.finance_json()).unwrap();
        assert!(v["projects"][0]["spentEurMonth"].as_f64().unwrap() > 1_000.0);
        assert!(v["company"]["salariesEur"].as_f64().unwrap() > 1_000.0);
        // without a CFO the books are not kept
        sim.apply_command_json(r#"{"Fire":{"staff":"staff-7"}}"#)
            .unwrap();
        let v: Value = serde_json::from_str(&sim.finance_json()).unwrap();
        assert_eq!(v["booksUnkept"], true);
    }
}
