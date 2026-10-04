//! Shared by the orchestrator's integration tests: the site binding over the
//! knowledge crate's `cinqueterre-mini` fixture (as the central server packs
//! a site repository) and the MVP team.

#![allow(dead_code)]

use std::path::PathBuf;

use knowledge::{pack, DirSource};
use orchestrator::{SiteBinding, StaffRef};
use serde_json::{json, Value};

pub const COMPANY: &str = "company-1";
pub const COMMIT: &str = "3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b";

pub fn mini() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../knowledge/tests/fixtures/cinqueterre-mini"),
    )
}

/// The pack JSON text of the `cinqueterre-mini` fixture.
pub fn mini_pack_json() -> String {
    pack::build(&mini(), COMMIT).unwrap().to_json().unwrap()
}

/// The binding JSON over a pack; `extra` overrides fields.
pub fn binding_json(pack: &str, extra: Value) -> Value {
    let mut v = json!({
        "site_id": "cinqueterre.travel",
        "brand_name": "Cinque Terre Dispatch",
        "language": "en",
        "quality_bar": 7,
        "simulate_deploy": true,
        "standup_max_turns": 4,
        "seo_suffix": "The Dispatch",
        "llm_profile": "local",
        "knowledge_pack": pack,
    });
    for (k, x) in extra.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

/// The binding over the `cinqueterre-mini` pack.
pub fn site() -> SiteBinding {
    SiteBinding::from_json(&binding_json(&mini_pack_json(), json!({}))).unwrap()
}

/// The binding over the `cinqueterre-mini` pack without its content calendar: the standup's
/// pitch tests are about the round itself, with the scripted writers' own topics.
pub fn site_without_calendar() -> SiteBinding {
    let mut pack: Value = serde_json::from_str(&mini_pack_json()).unwrap();
    pack["files"]
        .as_object_mut()
        .unwrap()
        .remove("content/config/content-calendar.json");
    SiteBinding::from_json(&binding_json(&pack.to_string(), json!({}))).unwrap()
}

pub fn team() -> Vec<StaffRef> {
    [
        ("staff-4", "sophia", "editor-in-chief"),
        ("staff-5", "marco", "editor"),
        ("staff-1", "giulia", "writer"),
        ("staff-2", "isabella", "writer"),
    ]
    .into_iter()
    .map(|(id, persona, role)| StaffRef {
        id: id.into(),
        persona: persona.into(),
        role: role.into(),
    })
    .collect()
}
