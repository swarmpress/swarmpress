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

use serde_json::Value;
use sim_core::commands::{Command, Input, ServerCommand};
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

    /// A world by scenario name (`sim_core::scenarios::scenario`):
    /// `"cinqueterre"` (alias `"demo"`, same as [`Sim::demo`]) or `"empty"`.
    /// Throws on an unknown name.
    pub fn scenario(name: &str, seed: u64) -> Result<Sim, String> {
        sim_core::scenarios::scenario(name, seed)
            .map(|world| Sim { world })
            .ok_or_else(|| {
                format!(
                    "unknown scenario {name:?} (known: {})",
                    sim_core::scenarios::SCENARIOS.join(", ")
                )
            })
    }

    /// The whole world as bytes (`sim_core::snapshot`: a 42-byte header and
    /// the postcard world, FEAT-060). Effects waiting to be drained are not
    /// part of it.
    pub fn snapshot(&self) -> Vec<u8> {
        self.world.snapshot()
    }

    /// Rebuilds a sim from [`Sim::snapshot`] bytes. Throws on anything that
    /// is not a snapshot of this sim build, on damaged bytes, and when the
    /// rebuilt world does not hash to the hash the snapshot was taken at. The
    /// sim has no pending effects: [`Sim::reissue_pending_jobs`] brings the
    /// open job requests back.
    pub fn from_snapshot(bytes: &[u8]) -> Result<Sim, String> {
        sim_core::World::from_snapshot(bytes, None)
            .map(|world| Sim { world })
            .map_err(|e| format!("bad snapshot: {e}"))
    }

    /// Emits the request of every job the sim still waits for again (same job
    /// ids), unless it is already waiting to be drained. For a sim restored
    /// from a snapshot. Never changes the hash. Returns how many were emitted.
    pub fn reissue_pending_jobs(&mut self) -> u32 {
        u32::try_from(self.world.reissue_pending_jobs()).unwrap_or(u32::MAX)
    }

    /// The seed the world was created with.
    pub fn seed(&self) -> u64 {
        self.world.seed
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

    /// Parses a JSON command and applies it now: a player [`Command`] or a
    /// [`ServerCommand`] (orchestrator results `MeetingOutcome`,
    /// `BoardOutcome`, `JobCompleted`, `JobFailed`; deploy notices `DeployLanded`,
    /// `DeployFailed`; signals; utterances), told apart by the variant name. Both go through the shared validation
    /// (`sim_core::validate_input`). `Err` carries the reason. Shapes: README.
    pub fn apply_command_json(&mut self, json: &str) -> Result<(), String> {
        let input = parse_input(json)?;
        self.world
            .apply_input(input)
            .map(|_| ())
            .map_err(|r| r.to_string())
    }

    /// `None` when the JSON command (player or server) would apply,
    /// otherwise the reason.
    pub fn validate_command_json(&self, json: &str) -> Option<String> {
        match parse_input(json) {
            Err(e) => Some(e),
            Ok(input) => sim_core::validate_input(&self.world, &input)
                .err()
                .map(|r| r.to_string()),
        }
    }

    /// Like [`Sim::apply_command_json`], but only accepts a [`ServerCommand`].
    pub fn apply_server_command_json(&mut self, json: &str) -> Result<(), String> {
        let cmd = parse_server_command(json)?;
        self.world
            .apply_server(cmd)
            .map(|_| ())
            .map_err(|r| r.to_string())
    }

    /// Takes the effects emitted since the last drain, as a JSON array of
    /// `RequestJob`s in the orchestrator's `JobRequest` field names (see the
    /// README). Effects are not world state: draining never changes the hash.
    pub fn drain_effects_json(&mut self) -> String {
        let effects = self.world.drain_effects();
        json::effects(&self.world, &effects).to_string()
    }

    /// Effects waiting to be drained.
    pub fn pending_effects(&self) -> u32 {
        u32::try_from(self.world.effects().len()).unwrap_or(u32::MAX)
    }

    /// The publishing plan's skeleton (publishing-plan.md §7), optionally
    /// for one project (`"project-1"`).
    pub fn plan_json(&self, project: Option<String>) -> String {
        json::plan(&self.world, project.as_deref()).to_string()
    }

    /// The earliest step at which a pending job is due (ADR-0060): a
    /// work-item job when its phase's minimum time has passed, a standup 30
    /// game minutes after it was requested. `undefined` with no pending job.
    /// A view for the host's clock: it is not state and never moves the
    /// hash. Per job it is `jobs[].dueStep` in [`Sim::plan_json`].
    pub fn next_due_step(&self) -> Option<u64> {
        self.world.next_due_step()
    }
}

/// `ServerCommand` variant names: a JSON command with one of these tags is a
/// server command, anything else a player command.
const SERVER_VARIANTS: [&str; 12] = [
    "Remark",
    "JobCompleted",
    "MeetingOutcome",
    "BoardOutcome",
    "DeployLanded",
    "Utterance",
    "SiteSignals",
    "AnalyticsSignals",
    "JobFailed",
    "DeployFailed",
    // The site's models as digests (ADR-0072, FEAT-095).
    "BlueprintChanged",
    "ToolsChanged",
];

fn tag(v: &Value) -> Option<&str> {
    match v {
        Value::String(s) => Some(s),
        Value::Object(o) if o.len() == 1 => o.keys().next().map(String::as_str),
        _ => None,
    }
}

/// Parses a player or server command from JSON.
fn parse_input(json: &str) -> Result<Input, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("bad command: {e}"))?;
    if tag(&v).is_some_and(|t| SERVER_VARIANTS.contains(&t)) {
        server_from_value(v).map(Input::Server)
    } else {
        serde_json::from_value(v)
            .map(Input::Player)
            .map_err(|e| format!("bad command: {e}"))
    }
}

fn parse_server_command(json: &str) -> Result<ServerCommand, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("bad server command: {e}"))?;
    server_from_value(v)
}

/// Accepts the orchestrator's `Outcome` JSON as is: a `JobCompleted`
/// digest's `artifact_sha` may be a hex string (first 16 bytes are kept) or
/// `null`/absent (zeros) as well as a 16-byte array.
fn server_from_value(mut v: Value) -> Result<ServerCommand, String> {
    if let Some(d) = v
        .get_mut("JobCompleted")
        .and_then(|j| j.get_mut("digest"))
        .and_then(Value::as_object_mut)
    {
        let sha = match d.get("artifact_sha") {
            None | Some(Value::Null) => Some([0u8; 16]),
            Some(Value::String(hex)) => Some(sha16(hex)?),
            Some(_) => None,
        };
        if let Some(sha) = sha {
            d.insert("artifact_sha".into(), serde_json::json!(sha));
        }
    }
    serde_json::from_value(v).map_err(|e| format!("bad server command: {e}"))
}

/// First 16 bytes of a hex digest (shorter digests are zero-padded).
fn sha16(hex: &str) -> Result<[u8; 16], String> {
    let mut out = [0u8; 16];
    let bytes = hex.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return Err("bad server command: artifact_sha has an odd length".into());
    }
    for (i, pair) in bytes.chunks(2).take(16).enumerate() {
        let s = std::str::from_utf8(pair).map_err(|_| "bad server command: artifact_sha")?;
        out[i] = u8::from_str_radix(s, 16)
            .map_err(|_| format!("bad server command: artifact_sha {hex:?} is not hex"))?;
    }
    Ok(out)
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

    /// FEAT-095: the site's model digests are server commands in the JSON door too.
    #[test]
    fn model_digests_are_server_commands() {
        let mut sim = Sim::demo(1);
        let bp = r#"{"BlueprintChanged":{"hash":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16],"page_types":6,"slots":14,"issues":0}}"#;
        let tools = r#"{"ToolsChanged":{"tools":[{"tool_ref":177789920126454,"schedule_days":1,"role":"web-developer"}]}}"#;
        assert_eq!(sim.validate_command_json(bp), None);
        sim.apply_command_json(bp).unwrap();
        sim.apply_command_json(tools).unwrap();
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        assert_eq!(plan["structure"]["model"]["pageTypes"], 6);
        assert_eq!(
            plan["structure"]["model"]["hash"],
            "0102030405060708090a0b0c0d0e0f10"
        );
        assert_eq!(plan["structure"]["tools"][0]["toolRef"], 177789920126454u64);
        assert_eq!(plan["structure"]["tools"][0]["role"], "web-developer");
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
            let parsed = parse_input(e);
            assert!(parsed.is_ok(), "{e}: {parsed:?}");
        }
    }

    /// The orchestrator loop through the JSON boundary: drain a standup
    /// request, answer with the orchestrator's `Outcome` JSON, follow the
    /// item to Published, and read it back from `plan_json`.
    #[test]
    fn job_contract_through_json() {
        let mut sim = Sim::scenario("cinqueterre", 1).unwrap();
        assert_eq!(sim.hash(), Sim::demo(1).hash());
        assert!(Sim::scenario("atlantis", 1).is_err());
        assert_eq!(
            Sim::scenario("empty", 1).unwrap().hash(),
            Sim::new(1).hash()
        );
        fn drain(sim: &mut Sim) -> Vec<Value> {
            serde_json::from_str::<Value>(&sim.drain_effects_json())
                .unwrap()
                .as_array()
                .unwrap()
                .clone()
        }
        fn run_until(sim: &mut Sim, kind: &str) -> Value {
            for _ in 0..3_000 {
                sim.tick();
                if sim.pending_effects() > 0 {
                    let e = drain(sim).remove(0);
                    assert_eq!(e["kind"], kind);
                    return e;
                }
            }
            panic!("no {kind} job");
        }
        fn done(job: &Value, score: u8, sha: &str) -> String {
            let job = job["job_id"].as_u64().unwrap();
            serde_json::json!({
                "JobCompleted": {
                    "job_id": job,
                    "digest": {
                        "ok": true,
                        "score": score,
                        "words": 900,
                        "qa_defects": 0,
                        "artifact_sha": serde_json::from_str::<Value>(sha).unwrap(),
                    }
                }
            })
            .to_string()
        }
        // run to the 09:00 standup
        let standup = run_until(&mut sim, "standup");
        assert_eq!(sim.minute_of_day(), 540);
        assert_eq!(standup["effect"], "request-job");
        assert_eq!(standup["job_id"], 1);
        assert_eq!(standup["project"], "project-1");
        assert!(standup["work_item"].is_null());
        assert!(standup["brief_ref"].is_null());
        assert_eq!(standup["revision"], 0);
        assert!(standup["meeting"].as_str().unwrap().starts_with("meeting-"));
        let staff = standup["staff"].as_array().unwrap();
        assert_eq!(
            staff[0],
            serde_json::json!({"id": "staff-1", "persona": "giulia", "role": "writer"})
        );
        // the orchestrator's MeetingOutcome (BriefOut has no kind)
        let outcome = r#"{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":42,"writer":"staff-1","editor":"staff-5"}]}}"#;
        assert_eq!(sim.validate_command_json(outcome), None);
        sim.apply_command_json(outcome).unwrap();
        let draft = drain(&mut sim).remove(0);
        assert_eq!(draft["kind"], "draft");
        assert_eq!(draft["work_item"], "work-item-1");
        assert_eq!(draft["brief_ref"], 42);
        assert_eq!(draft["staff"][0]["persona"], "giulia");
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        let item = &plan["items"][0];
        assert_eq!(item["id"], "work-item-1");
        assert_eq!(item["status"], "in-progress");
        assert_eq!(item["owner"], "staff-5");
        assert_eq!(item["phases"][0]["kind"], "draft");
        assert_eq!(item["phases"][0]["assignee"], "staff-1");
        assert_eq!(item["phases"][0]["state"], "working");
        assert_eq!(item["phases"][0]["estimateMinutes"], 120);
        assert_eq!(plan["jobs"][0]["id"], 2);
        // the due step of the pending draft: its phase's minimum (2 game hours)
        let drafted_at = sim.step();
        assert_eq!(plan["jobs"][0]["requestedStep"], drafted_at);
        assert_eq!(plan["jobs"][0]["dueStep"], drafted_at + 1_000);
        assert_eq!(plan["nextDueStep"], drafted_at + 1_000);
        assert_eq!(sim.next_due_step(), Some(drafted_at + 1_000));
        // work in progress: one open item, its writer is not free
        let wip = &plan["wip"][0];
        assert_eq!(wip["project"], "project-1");
        assert_eq!(wip["limit"], 3);
        assert_eq!(wip["open"], 1);
        assert_eq!(wip["room"], 2);
        assert_eq!(wip["awaitingApproval"], 0);
        assert_eq!(wip["inWritingLoop"], 1);
        let free: Vec<&str> = wip["freeWriters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap())
            .collect();
        assert!(!free.contains(&"staff-1"), "{free:?}");
        assert!(free.contains(&"staff-2"), "{free:?}");
        let other: Value = serde_json::from_str(&sim.plan_json(Some("project-9".into()))).unwrap();
        assert!(other["items"].as_array().unwrap().is_empty());
        assert!(other["wip"].as_array().unwrap().is_empty());

        // JobCompleted with the orchestrator's Digest (hex sha or null)
        assert!(sim
            .validate_command_json(&done(&draft, 0, r#""xyz""#))
            .unwrap()
            .contains("artifact_sha"));
        sim.apply_command_json(&done(
            &draft,
            0,
            r#""0123456789abcdef0123456789abcdef01234567""#,
        ))
        .unwrap();
        let review = run_until(&mut sim, "review");
        sim.apply_command_json(&done(&review, 6, "null")).unwrap();
        let redraft = run_until(&mut sim, "draft");
        assert_eq!(redraft["revision"], 1);
        sim.apply_command_json(&done(&redraft, 0, "null")).unwrap();
        let review = run_until(&mut sim, "review");
        sim.apply_command_json(&done(&review, 8, "null")).unwrap();
        // The publish gate (ADR-0059): under the default policy the item is
        // parked and the Inbox asks the CEO. No Publish job is requested.
        sim.advance(600);
        assert_eq!(sim.pending_effects(), 0, "no job before the CEO's yes");
        assert_eq!(sim.next_due_step(), None, "nothing is pending at the gate");
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        assert_eq!(plan["items"][0]["status"], "approved");
        assert_eq!(plan["items"][0]["awaitingApproval"], true);
        assert_eq!(plan["items"][0]["currentPhase"], "publish");
        assert_eq!(plan["items"][0]["phases"][2]["state"], "pending");
        assert!(plan["jobs"].as_array().unwrap().is_empty());
        assert!(plan["nextDueStep"].is_null());
        assert_eq!(plan["wip"][0]["awaitingApproval"], 1);
        let org: Value = serde_json::from_str(&sim.org_json()).unwrap();
        assert_eq!(org["policies"]["autonomy"], "approve-all");
        assert_eq!(org["policies"]["qualityBar"], 7);
        let inbox: Value = serde_json::from_str(&sim.inbox_json()).unwrap();
        let t = inbox["tickets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["kind"] == "publish-approval")
            .expect("the approval ticket");
        assert_eq!(t["status"], "open");
        assert_eq!(t["priority"], "high");
        assert_eq!(t["workItem"], "work-item-1");
        assert_eq!(t["from"], "staff-5");
        assert_eq!(
            t["options"],
            serde_json::json!(["publish", "send-back", "kill", "defer"])
        );
        assert_eq!(t["defaultOption"], "defer");
        assert!(t["failure"].is_null());
        let yes = serde_json::json!({"AnswerTicket": {"ticket": t["id"], "option": "publish"}})
            .to_string();
        assert_eq!(sim.validate_command_json(&yes), None);
        sim.apply_command_json(&yes).unwrap();
        let publish = drain(&mut sim).remove(0);
        assert_eq!(publish["kind"], "publish");
        assert_eq!(publish["staff"][0]["role"], "it-engineer");
        sim.apply_command_json(&done(&publish, 0, "null")).unwrap();
        sim.advance(200);
        let landed = r#"{"DeployLanded":{"work_item":"work-item-1"}}"#;
        assert_eq!(sim.validate_command_json(landed), None);
        sim.apply_command_json(landed).unwrap();
        let plan: Value = serde_json::from_str(&sim.plan_json(Some("project-1".into()))).unwrap();
        assert_eq!(plan["items"][0]["status"], "published");
        assert_eq!(plan["items"][0]["revision"], 1);
        assert_eq!(plan["items"][0]["lastScore"], 8);
        assert_eq!(plan["feed"][0]["kind"], "published");
        // validated: the same deploy again is rejected
        assert!(sim.apply_command_json(landed).is_err());
        assert!(sim.apply_server_command_json(landed).is_err());
        assert!(sim
            .apply_server_command_json(r#"{"Praise":{"staff":"staff-1"}}"#)
            .is_err());
    }

    /// ADR-0059 through the JSON boundary: `JobFailed` and `DeployFailed`
    /// are server commands, their tickets and options show in `inbox_json`,
    /// answers go through `AnswerTicket`, and the due step of a pending
    /// standup is in `plan_json` and `next_due_step`.
    #[test]
    fn failure_commands_and_their_tickets_through_json() {
        fn drain(sim: &mut Sim) -> Vec<Value> {
            serde_json::from_str::<Value>(&sim.drain_effects_json())
                .unwrap()
                .as_array()
                .unwrap()
                .clone()
        }
        fn open_ticket(sim: &Sim, kind: &str) -> Value {
            let inbox: Value = serde_json::from_str(&sim.inbox_json()).unwrap();
            inbox["tickets"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["kind"] == kind && t["status"] == "open")
                .unwrap_or_else(|| panic!("no open {kind} ticket: {inbox}"))
                .clone()
        }
        fn answer(sim: &mut Sim, ticket: &Value, option: &str) {
            let cmd =
                serde_json::json!({"AnswerTicket": {"ticket": ticket["id"], "option": option}})
                    .to_string();
            assert_eq!(sim.validate_command_json(&cmd), None, "{cmd}");
            sim.apply_command_json(&cmd).unwrap();
        }
        let mut sim = Sim::demo(3);
        assert_eq!(sim.next_due_step(), None);
        sim.advance(1_000); // 09:00
        let standup = drain(&mut sim).remove(0);
        assert_eq!(standup["kind"], "standup");
        // a standup is due 30 game minutes (250 steps) after its request
        assert_eq!(sim.next_due_step(), Some(1_250));
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        assert_eq!(plan["jobs"][0]["kind"], "standup");
        assert_eq!(plan["jobs"][0]["dueStep"], 1_250);
        assert_eq!(plan["nextDueStep"], 1_250);

        // JobFailed: by slug or by variant name, only for a pending job
        assert!(sim
            .validate_command_json(r#"{"JobFailed":{"job_id":99,"reason":"model"}}"#)
            .unwrap()
            .contains("no pending job"));
        assert!(sim
            .apply_server_command_json(r#"{"JobFailed":{"job_id":1,"reason":"because"}}"#)
            .unwrap_err()
            .contains("bad server command"));
        let failed = r#"{"JobFailed":{"job_id":1,"reason":"infrastructure"}}"#;
        assert_eq!(sim.validate_command_json(failed), None);
        sim.apply_server_command_json(failed).unwrap();
        assert!(sim.apply_command_json(failed).is_err(), "a job fails once");
        assert_eq!(sim.next_due_step(), None);
        let t = open_ticket(&sim, "standup-failed");
        assert_eq!(t["priority"], "high");
        assert_eq!(t["project"], "project-1");
        assert_eq!(t["failure"], "infrastructure");
        assert_eq!(t["options"], serde_json::json!(["retry", "skip"]));
        assert_eq!(t["defaultOption"], "skip");

        // Retry: the standup is requested again; it commissions an article
        answer(&mut sim, &t, "retry");
        let again = drain(&mut sim).remove(0);
        assert_eq!(again["kind"], "standup");
        assert_eq!(again["job_id"], 2);
        sim.apply_command_json(
            r#"{"MeetingOutcome":{"job_id":2,"briefs":[{"brief_ref":7,"writer":"staff-1","editor":"staff-5"}]}}"#,
        )
        .unwrap();
        let draft = drain(&mut sim).remove(0);
        assert_eq!(draft["job_id"], 3);
        // the draft has no media: blocked, with a needs-media ticket
        sim.apply_command_json(r#"{"JobFailed":{"job_id":3,"reason":"NeedsMedia"}}"#)
            .unwrap();
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        assert_eq!(plan["items"][0]["status"], "blocked");
        assert_eq!(plan["wip"][0]["blocked"], 1);
        let t = open_ticket(&sim, "needs-media");
        assert_eq!(t["workItem"], "work-item-1");
        assert_eq!(t["failure"], "needs-media");
        assert_eq!(t["options"], serde_json::json!(["retry", "kill"]));
        assert_eq!(t["defaultOption"], "kill");
        answer(&mut sim, &t, "retry");
        let draft = drain(&mut sim).remove(0);
        assert_eq!(draft["kind"], "draft");
        assert_eq!(draft["job_id"], 4);
        // a timeout: the item's first escalation, which defaults to retry
        sim.apply_command_json(r#"{"JobFailed":{"job_id":4,"reason":"timeout"}}"#)
            .unwrap();
        let t = open_ticket(&sim, "escalation");
        assert_eq!(t["failure"], "timeout");
        assert_eq!(t["defaultOption"], "retry");
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        assert_eq!(plan["items"][0]["escalations"], 1);
        answer(&mut sim, &t, "retry");
        let draft = drain(&mut sim).remove(0);

        // through the gate under `autonomous` to a merged item, then the
        // deploy fails
        sim.apply_command_json(r#"{"SetPolicy":{"Autonomy":"autonomous"}}"#)
            .unwrap();
        let done = |job: &Value, score: u8| {
            serde_json::json!({"JobCompleted": {"job_id": job["job_id"], "digest":
                {"ok": true, "score": score, "words": 900, "qa_defects": 0, "artifact_sha": null}}})
            .to_string()
        };
        let failed = r#"{"DeployFailed":{"work_item":"work-item-1"}}"#;
        assert!(sim
            .validate_command_json(failed)
            .unwrap()
            .contains("not merged"));
        sim.apply_command_json(&done(&draft, 0)).unwrap();
        sim.advance(1_000);
        let review = drain(&mut sim).remove(0);
        sim.apply_command_json(&done(&review, 8)).unwrap();
        sim.advance(500);
        let publish = drain(&mut sim).remove(0);
        assert_eq!(publish["kind"], "publish");
        sim.apply_command_json(&done(&publish, 0)).unwrap();
        sim.advance(125);
        assert_eq!(sim.validate_command_json(failed), None);
        sim.apply_server_command_json(failed).unwrap();
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        assert_eq!(plan["items"][0]["status"], "blocked");
        let t = open_ticket(&sim, "deploy-failed");
        assert_eq!(t["workItem"], "work-item-1");
        assert_eq!(t["options"], serde_json::json!(["retry", "acknowledge"]));
        assert_eq!(t["defaultOption"], "acknowledge");
        answer(&mut sim, &t, "retry");
        let publish = drain(&mut sim).remove(0);
        assert_eq!(publish["kind"], "publish");
        // player commands are not server commands
        assert!(sim
            .apply_server_command_json(r#"{"AnswerTicket":{"ticket":"ticket-1","option":"skip"}}"#)
            .is_err());
    }

    /// Speech bubbles and who works on what, in `render_state_json`.
    #[test]
    fn render_state_json_carries_bubbles_and_work_items() {
        let mut sim = Sim::demo(1);
        sim.advance(1_090); // 09:10: the standup sits
        let v: Value = serde_json::from_str(&sim.render_state_json()).unwrap();
        assert!(v["bubbles"].as_array().unwrap().is_empty());
        let meeting = v["meetings"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(v["meetings"][0]["job"], 1);
        let speaker = v["staff"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["pose"] == "listen")
            .expect("someone is seated")["id"]
            .as_str()
            .unwrap()
            .to_string();
        let at = sim.step();
        sim.apply_command_json(
            &serde_json::json!({"Utterance": {"meeting": meeting, "seq": 0, "speaker": speaker, "chars": 90}})
                .to_string(),
        )
        .unwrap();
        let v: Value = serde_json::from_str(&sim.render_state_json()).unwrap();
        assert_eq!(
            v["bubbles"],
            serde_json::json!([{
                "meeting": meeting, "seq": 0, "speaker": speaker,
                "startedStep": at, "untilStep": at + 70, "chars": 90,
            }])
        );
        // the outcome puts a writer to work: her work item, and she types
        sim.apply_command_json(
            r#"{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":7,"writer":"staff-1","editor":"staff-5"}]}}"#,
        )
        .unwrap();
        sim.advance(400);
        let v: Value = serde_json::from_str(&sim.render_state_json()).unwrap();
        assert!(
            v["bubbles"].as_array().unwrap().is_empty(),
            "the turn is over"
        );
        let staff = v["staff"].as_array().unwrap();
        let giulia = staff.iter().find(|s| s["id"] == "staff-1").unwrap();
        assert_eq!(giulia["workItem"], "work-item-1");
        assert_eq!(giulia["pose"], "type");
        let marco = staff.iter().find(|s| s["id"] == "staff-5").unwrap();
        assert!(marco["workItem"].is_null());
        assert_ne!(marco["pose"], "type");
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

    /// The editorial board through the JSON boundary (ADR-0069): the policy,
    /// the board's request, the orchestrator's `BoardOutcome` (after
    /// `outcomesForSim`: numeric refs) and the plan's new fields.
    #[test]
    fn the_editorial_board_through_json() {
        let mut sim = Sim::demo(5);
        sim.apply_command_json(r#"{"SetPolicy":{"EditorialBoard":true}}"#)
            .unwrap();
        sim.advance(1_520); // 10:02
        let effects: Value = serde_json::from_str(&sim.drain_effects_json()).unwrap();
        let board = effects
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["kind"] == "board")
            .expect("a board job at 10:00")
            .clone();
        assert!(board["staff"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["role"] == "editor"));
        let outcome = serde_json::json!({"BoardOutcome": {"job_id": board["job_id"],
        "workstreams": [8_361_854_316_634_078_731_u64],
        "items": [
            {"brief_ref": 5_861_808_041_880_732_776_u64, "editor": "staff-5", "priority": "High",
             "workstream": 0, "start_offset": 0, "publish_offset": 2},
            {"brief_ref": 2, "editor": "staff-5", "priority": "Normal",
             "start_offset": 3, "publish_offset": 5, "depends_on": [0]}
        ]}})
        .to_string();
        assert_eq!(sim.validate_command_json(&outcome), None);
        sim.apply_command_json(&outcome).unwrap();
        let effects: Value = serde_json::from_str(&sim.drain_effects_json()).unwrap();
        assert_eq!(effects[0]["kind"], "draft", "the first item starts now");
        let plan: Value = serde_json::from_str(&sim.plan_json(None)).unwrap();
        let items = plan["items"].as_array().unwrap();
        let first = &items[items.len() - 2];
        let second = &items[items.len() - 1];
        assert_eq!(first["status"], "in-progress");
        assert_eq!(first["briefRefText"], "5861808041880732776");
        assert_eq!(first["workstream"], "workstream-1");
        assert_eq!(first["startDay"], 0);
        assert_eq!(first["dueDay"], 1);
        assert_eq!(first["publishDay"], 2);
        assert_eq!(first["unstarted"], false);
        assert_eq!(second["status"], "planned");
        assert_eq!(second["unstarted"], true);
        assert_eq!(second["dependsOn"], serde_json::json!([first["id"]]));
        assert_eq!(second["priority"], "normal");
        assert_eq!(
            plan["workstreams"][0]["textRef"], "8361854316634078731",
            "a u64 crosses as text"
        );
        assert_eq!(plan["goals"][0]["metric"], "monthly-readers");
        let wip = &plan["wip"][0];
        assert_eq!(wip["unstarted"], 1);
        assert_eq!(
            wip["inWritingLoop"], 1,
            "an unstarted item is not in the writing loop"
        );
        assert_eq!(wip["plannedRoom"], 9);
        assert_eq!(wip["editorialBoard"], true);
    }
}
