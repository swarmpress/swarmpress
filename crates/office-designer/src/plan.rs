//! The relation schema: a plan is a list of placements by relation, never by
//! coordinates (construction-kit.md §7.1). Every value is from a closed
//! vocabulary, so anything else is a validation error returned to the model.
//!
//! ```json
//! { "placements": [
//!   { "design": "desk", "anchor": "wall:north", "from": "wall:west", "offset": 8,
//!     "count": 3, "spacing": 8 },
//!   { "design": "monitor", "anchor": "placement:0" },
//!   { "design": "ceiling-light", "anchor": "placement:0" }
//! ] }
//! ```

use std::fmt;
use std::str::FromStr;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{json, Value};

use crate::issue::{Issue, IssueCode};
use crate::model::{EquipmentDesign, Room, Side, MAX_COUNT, MAX_PLACEMENTS, MAX_STUDS};

/// What a placement stands against or relative to.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Anchor {
    /// `wall:north` — against the inside of a wall.
    Wall(Side),
    /// `window:0` — against the window's wall, centred on the window.
    Window(usize),
    /// `door:0` — against the door's wall, beside the door.
    Door(usize),
    /// `placement:2` — relative to an earlier placement of this plan.
    Placement(usize),
    /// `equipment:equip-12` — relative to equipment already in the room.
    Equipment(String),
    /// `room-centre` — in the middle of the room.
    RoomCentre,
}

impl fmt::Display for Anchor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Anchor::Wall(s) => write!(f, "wall:{}", s.slug()),
            Anchor::Window(i) => write!(f, "window:{i}"),
            Anchor::Door(i) => write!(f, "door:{i}"),
            Anchor::Placement(i) => write!(f, "placement:{i}"),
            Anchor::Equipment(id) => write!(f, "equipment:{id}"),
            Anchor::RoomCentre => f.write_str("room-centre"),
        }
    }
}

/// The anchor grammar, as the error message shows it to the model.
pub const ANCHOR_GRAMMAR: &str =
    "wall:north|east|south|west, window:N, door:N, placement:N, equipment:ID or room-centre";

impl FromStr for Anchor {
    type Err = String;

    fn from_str(s: &str) -> Result<Anchor, String> {
        let bad = || format!("unknown anchor \"{s}\"; anchors are {ANCHOR_GRAMMAR}");
        if s == "room-centre" {
            return Ok(Anchor::RoomCentre);
        }
        let (kind, rest) = s.split_once(':').ok_or_else(bad)?;
        let index = || -> Result<usize, String> {
            if rest.is_empty() || rest.len() > 3 || !rest.bytes().all(|b| b.is_ascii_digit()) {
                return Err(bad());
            }
            rest.parse::<usize>().map_err(|_| bad())
        };
        match kind {
            "wall" => Side::from_slug(rest).map(Anchor::Wall).ok_or_else(bad),
            "window" => index().map(Anchor::Window),
            "door" => index().map(Anchor::Door),
            "placement" => index().map(Anchor::Placement),
            "equipment"
                if !rest.is_empty()
                    && rest.len() <= 40
                    && rest
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') =>
            {
                Ok(Anchor::Equipment(rest.to_owned()))
            }
            _ => Err(bad()),
        }
    }
}

impl Serialize for Anchor {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Anchor {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Anchor, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(D::Error::custom)
    }
}

/// Which way the item's front points. The front is the side people use: a
/// desk's chair side, a shelf's open side, a whiteboard's board.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Facing {
    /// Away from the anchor (the default): into the room for a wall.
    Away,
    /// Toward the anchor.
    Toward,
    /// Toward the middle of the room.
    RoomCentre,
    North,
    East,
    South,
    West,
}

impl Facing {
    pub const ALL: [Facing; 7] = [
        Facing::Away,
        Facing::Toward,
        Facing::RoomCentre,
        Facing::North,
        Facing::East,
        Facing::South,
        Facing::West,
    ];

    pub fn compass(self) -> Option<Side> {
        match self {
            Facing::North => Some(Side::North),
            Facing::East => Some(Side::East),
            Facing::South => Some(Side::South),
            Facing::West => Some(Side::West),
            _ => None,
        }
    }

    pub fn slug(self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default()
    }
}

fn one() -> u8 {
    1
}

fn is_zero(v: &u16) -> bool {
    *v == 0
}

fn is_one(v: &u8) -> bool {
    *v == 1
}

/// One placement by relation. Distances are studs (16 studs = 1 m).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Placement {
    pub design: EquipmentDesign,
    pub anchor: Anchor,
    /// Where along a wall anchor the row starts: a wall that meets it (the
    /// row starts `offset` studs from that wall), a window (the row is centred
    /// on it), a door or an item (the row starts `offset` studs beside it).
    /// Without it the row is centred on the wall.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Anchor>,
    /// With an item anchor: on which side of that item (default: behind it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<Side>,
    /// Studs between the anchor and the item.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub gap: u16,
    /// Studs between `from` and the first item.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub offset: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facing: Option<Facing>,
    /// Items in a row along the anchor (1–8).
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub count: u8,
    /// Studs between neighbours in the row.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub spacing: u16,
}

impl Placement {
    /// A placement with defaults: one item, no gap, facing away.
    pub fn new(design: EquipmentDesign, anchor: Anchor) -> Placement {
        Placement {
            design,
            anchor,
            from: None,
            side: None,
            gap: 0,
            offset: 0,
            facing: None,
            count: 1,
            spacing: 0,
        }
    }

    /// Checks the limits serde cannot express.
    pub fn limits(&self, index: usize) -> Vec<Issue> {
        let mut out = Vec::new();
        if self.count == 0 || self.count > MAX_COUNT {
            out.push(Issue::new(
                IssueCode::BadPlan,
                Some(index),
                format!("placement {index}: count is 1 to {MAX_COUNT}"),
            ));
        }
        for (name, v) in [
            ("gap", self.gap),
            ("offset", self.offset),
            ("spacing", self.spacing),
        ] {
            if v > MAX_STUDS {
                out.push(Issue::new(
                    IssueCode::BadPlan,
                    Some(index),
                    format!("placement {index}: {name} is at most {MAX_STUDS} studs"),
                ));
            }
        }
        out
    }
}

/// A plan: placements in build order. `placement:N` refers to the N-th (0-based).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub placements: Vec<Placement>,
}

impl Plan {
    /// Parses a plan the model wrote. Every placement is parsed on its own, so
    /// all the bad ones come back at once, each with its index.
    pub fn from_json(text: &str) -> Result<Plan, Vec<Issue>> {
        let v: Value = serde_json::from_str(text).map_err(|e| {
            vec![Issue::new(
                IssueCode::BadPlan,
                None,
                format!("the plan is not valid JSON: {e}"),
            )]
        })?;
        Plan::from_value(&v)
    }

    pub fn from_value(v: &Value) -> Result<Plan, Vec<Issue>> {
        let bad = |m: String| vec![Issue::new(IssueCode::BadPlan, None, m)];
        let obj = v
            .as_object()
            .ok_or_else(|| bad("the plan is an object {\"placements\": [...]}".into()))?;
        if let Some(k) = obj.keys().find(|k| *k != "placements") {
            return Err(bad(format!(
                "unknown field \"{k}\"; the plan has only \"placements\""
            )));
        }
        let list = obj
            .get("placements")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("\"placements\" is a list".into()))?;
        if list.len() > MAX_PLACEMENTS {
            return Err(bad(format!(
                "at most {MAX_PLACEMENTS} placements in a plan; use count for rows"
            )));
        }
        let mut issues = Vec::new();
        let mut placements = Vec::new();
        for (i, p) in list.iter().enumerate() {
            match parse_placement(p, i) {
                Ok(p) => {
                    issues.extend(p.limits(i));
                    placements.push(p);
                }
                Err(issue) => issues.push(issue),
            }
        }
        if issues.is_empty() {
            Ok(Plan { placements })
        } else {
            crate::issue::number(&mut issues);
            Err(issues)
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

pub(crate) fn parse_placement(v: &Value, i: usize) -> Result<Placement, Issue> {
    Placement::deserialize(v).map_err(|e| {
        Issue::new(
            IssueCode::BadPlan,
            Some(i),
            format!("placement {i}: {}", clean_serde(&e.to_string())),
        )
    })
}

/// serde's messages quote with backticks; keep them plain for the model.
fn clean_serde(m: &str) -> String {
    m.replace('`', "\"")
}

// ------------------------------------------------------------------ JSON Schema

fn alternation(items: &[String]) -> String {
    items.join("|")
}

/// The anchor pattern: generic, or closed to one room's windows, doors and
/// equipment ids.
pub fn anchor_pattern(room: Option<&Room>) -> String {
    let mut alts = vec![
        "wall:(north|east|south|west)".to_string(),
        "placement:[0-9]{1,2}".to_string(),
        "room-centre".to_string(),
    ];
    match room {
        None => {
            alts.push("window:[0-9]{1,2}".into());
            alts.push("door:[0-9]{1,2}".into());
            alts.push("equipment:[a-z0-9-]{1,40}".into());
        }
        Some(r) => {
            let ix = |n: usize| (0..n).map(|i| i.to_string()).collect::<Vec<_>>();
            if !r.windows.is_empty() {
                alts.push(format!("window:({})", alternation(&ix(r.windows.len()))));
            }
            if !r.doors.is_empty() {
                alts.push(format!("door:({})", alternation(&ix(r.doors.len()))));
            }
            // the players' floor designs anchor like equipment (`equipment:object-3`)
            let ids: Vec<String> = r
                .equipment
                .iter()
                .map(|e| e.id.clone())
                .chain(
                    r.objects
                        .iter()
                        .filter(|o| o.is_floor())
                        .map(|o| o.id.clone()),
                )
                .collect();
            if !ids.is_empty() {
                alts.push(format!("equipment:({})", alternation(&ids)));
            }
        }
    }
    format!("^({})$", alternation(&alts))
}

fn placement_schema(designs: &[EquipmentDesign], room: Option<&Room>) -> Value {
    let pattern = anchor_pattern(room);
    let studs = json!({ "type": "integer", "minimum": 0, "maximum": MAX_STUDS });
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["design", "anchor"],
        "properties": {
            "design": { "enum": designs.iter().map(|d| d.slug()).collect::<Vec<_>>() },
            "anchor": { "type": "string", "pattern": pattern },
            "from": { "type": "string", "pattern": pattern },
            "side": { "enum": crate::model::Side::ALL.iter().map(|s| s.slug()).collect::<Vec<_>>() },
            "gap": studs,
            "offset": studs,
            "spacing": studs,
            "count": { "type": "integer", "minimum": 1, "maximum": MAX_COUNT },
            "facing": { "enum": Facing::ALL.iter().map(|f| f.slug()).collect::<Vec<_>>() }
        }
    })
}

/// The plan's JSON Schema (draft 2020-12), closed to the given designs and,
/// with a room, to its windows, doors and equipment: what the model's
/// structured output is held to. Generated from the same enums the parser
/// uses (a test keeps both in step).
pub fn plan_schema(designs: &[EquipmentDesign], room: Option<&Room>) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "swarmpress.office-plan.v1",
        "type": "object",
        "additionalProperties": false,
        "required": ["placements"],
        "properties": {
            "placements": {
                "type": "array",
                "maxItems": MAX_PLACEMENTS,
                "items": placement_schema(designs, room)
            }
        }
    })
}

/// The schema of a repair step's answer ([`crate::repair::PlanFix`]).
pub fn fix_schema(designs: &[EquipmentDesign], room: Option<&Room>) -> Value {
    let p = placement_schema(designs, room);
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "swarmpress.office-plan-fix.v1",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "replace": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["index", "placement"],
                    "properties": {
                        "index": { "type": "integer", "minimum": 0, "maximum": MAX_PLACEMENTS },
                        "placement": p
                    }
                }
            },
            "remove": {
                "type": "array",
                "items": { "type": "integer", "minimum": 0, "maximum": MAX_PLACEMENTS }
            },
            "add": { "type": "array", "items": p }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_round_trip() {
        for s in [
            "wall:north",
            "window:0",
            "door:12",
            "placement:3",
            "equipment:equip-12",
            "room-centre",
        ] {
            let a: Anchor = s.parse().unwrap();
            assert_eq!(a.to_string(), s);
        }
        for s in [
            "wall:up",
            "window:",
            "window:x",
            "door:-1",
            "equipment:Equip",
            "centre",
            "",
        ] {
            let e = s.parse::<Anchor>().unwrap_err();
            assert!(e.contains("anchors are"), "{e}");
        }
    }

    #[test]
    fn placements_parse_with_defaults_and_report_each_bad_one() {
        let p =
            Plan::from_json(r#"{"placements":[{"design":"desk","anchor":"wall:north"}]}"#).unwrap();
        assert_eq!(p.placements[0].count, 1);
        assert_eq!(
            p.to_json(),
            r#"{"placements":[{"design":"desk","anchor":"wall:north"}]}"#
        );
        let issues = Plan::from_json(
            r#"{"placements":[
                {"design":"sofa","anchor":"wall:north"},
                {"design":"desk","anchor":"wall:north"},
                {"design":"desk","anchor":"ceiling"},
                {"design":"desk","anchor":"wall:north","count":9},
                {"design":"desk","anchor":"wall:north","colour":"red"}
            ]}"#,
        )
        .unwrap_err();
        let at: Vec<Option<usize>> = issues.iter().map(|i| i.placement).collect();
        assert_eq!(at, vec![Some(0), Some(2), Some(3), Some(4)]);
        assert!(issues[0].message.contains("unknown variant \"sofa\""));
        assert!(issues[0].message.contains("desk"));
        assert!(issues[1].message.contains("anchors are"));
        assert!(issues[3].message.contains("unknown field \"colour\""));
        assert_eq!(issues[0].id, "I1");
    }
}
