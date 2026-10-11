//! The fake office designer (`?llm=fake`, tests): a deterministic plan from
//! the brief and the room doc of an `office layout` prompt, and a fix that
//! moves each named placement to the next wall. It is not a solver: it
//! writes what a careful junior would, and the checks and the repair loop
//! judge it like any model's answer. The browser's twin is
//! `apps/game/src/llm/mvp-script.ts` (`officeLayout`, `officeFix`).

use serde_json::{json, Map, Value};

const SIDES: [&str; 4] = ["north", "east", "south", "west"];

fn neighbours(side: &str) -> [&'static str; 2] {
    match side {
        "north" | "south" => ["west", "east"],
        _ => ["north", "south"],
    }
}

/// What the layout prompt says about the brief and the room.
#[derive(Debug, Default)]
struct Seen {
    wants: Map<String, Value>,
    doors: Vec<String>,
    /// `(side, window index)`, first window per side.
    windows: Vec<(String, usize)>,
    /// Existing designs, by slug.
    existing: Vec<String>,
}

fn count_of(line: &str, key: &str) -> Option<u64> {
    line.strip_prefix(&format!("- {key}: "))?
        .trim()
        .parse()
        .ok()
}

fn read(prompt: &str) -> Seen {
    let mut s = Seen::default();
    for line in prompt.lines() {
        for (key, words) in crate::build::BRIEF_FIELDS {
            if let Some(n) = count_of(line, words) {
                s.wants.insert(key.to_string(), json!(n));
            }
        }
        if let Some(rest) = line.strip_prefix("- wall:") {
            let side = rest.split_whitespace().next().unwrap_or("").to_string();
            if rest.contains("door:") {
                s.doors.push(side.clone());
            }
            if let Some(i) = rest.find("window:") {
                let n: String = rest[i + 7..]
                    .chars()
                    .take_while(char::is_ascii_digit)
                    .collect();
                if let Ok(n) = n.parse() {
                    s.windows.push((side, n));
                }
            }
        }
        if let Some(rest) = line.strip_prefix("- equipment:") {
            if let Some(design) = rest.split(": ").nth(1).and_then(|d| d.split(' ').next()) {
                s.existing.push(design.to_string());
            }
        }
    }
    s
}

impl Seen {
    fn want(&self, key: &str) -> u64 {
        self.wants.get(key).and_then(Value::as_u64).unwrap_or(0)
    }

    fn have(&self, designs: &[&str]) -> u64 {
        self.existing
            .iter()
            .filter(|d| designs.contains(&d.as_str()))
            .count() as u64
    }

    fn need(&self, key: &str, designs: &[&str]) -> u64 {
        self.want(key).saturating_sub(self.have(designs))
    }
}

fn row(design: &str, anchor: String, n: u64, spacing: u64) -> Value {
    let mut p = json!({"design": design, "anchor": anchor});
    if n > 1 {
        p["count"] = json!(n.min(8));
        p["spacing"] = json!(spacing);
    }
    p
}

/// The fake's `office layout` answer.
pub fn layout(prompt: &str) -> Value {
    let s = read(prompt);
    let free: Vec<&str> = {
        let f: Vec<&str> = SIDES
            .iter()
            .copied()
            .filter(|side| !s.doors.iter().any(|d| d == side))
            .collect();
        if f.is_empty() {
            SIDES.to_vec()
        } else {
            f
        }
    };
    let mut used: Vec<&str> = Vec::new();
    let next_wall = |used: &mut Vec<&str>| -> &str {
        let side = free
            .iter()
            .copied()
            .find(|f| !used.contains(f))
            .unwrap_or(free[used.len() % free.len()]);
        used.push(side);
        side
    };
    let mut placements: Vec<Value> = Vec::new();
    let desks = s.need("workstations", &["monitor", "color-monitor"]);
    if desks > 0 {
        let by_window = s
            .windows
            .iter()
            .find(|(side, _)| free.contains(&side.as_str()));
        let anchor = match by_window {
            Some((side, i)) => {
                used.push(free.iter().copied().find(|f| f == side).unwrap_or("north"));
                format!("window:{i}")
            }
            None => format!("wall:{}", next_wall(&mut used)),
        };
        let at = placements.len();
        placements.push(row("desk", anchor, desks, 4));
        placements.push(json!({"design": "monitor", "anchor": format!("placement:{at}")}));
    }
    let shelves = s.need("storage", &["archive-shelf"]);
    if shelves > 0 {
        let wall = next_wall(&mut used);
        placements.push(row("archive-shelf", format!("wall:{wall}"), shelves, 2));
    }
    let boards = s.need("writing_surfaces", &["whiteboard", "mood-board-wall"]);
    if boards > 0 {
        let wall = next_wall(&mut used);
        placements.push(row("whiteboard", format!("wall:{wall}"), boards, 4));
    }
    // Coffee and plants go in corners: the walls used least first.
    let mut corners: Vec<(&str, &str)> = Vec::new();
    for pass in [false, true] {
        for side in &free {
            if used.contains(side) != pass {
                continue;
            }
            for n in neighbours(side) {
                corners.push((side, n));
            }
        }
    }
    let mut corner = corners.into_iter();
    for _ in 0..s.need("coffee", &["coffee-machine"]) {
        if let Some((side, from)) = corner.next() {
            placements.push(json!({"design": "coffee-machine", "anchor": format!("wall:{side}"), "from": format!("wall:{from}")}));
        }
    }
    for _ in 0..s.need("plants", &["plant"]) {
        if let Some((side, from)) = corner.next() {
            placements.push(json!({"design": "plant", "anchor": format!("wall:{side}"), "from": format!("wall:{from}")}));
        }
    }
    json!({ "placements": placements })
}

/// The fake's `office layout fix` answer: each placement named for repair
/// moves to the next wall (north, east, south, west), its row kept.
pub fn fix(prompt: &str) -> Value {
    let mut replace = Vec::new();
    let mut fixing = false;
    for line in prompt.lines() {
        if line.starts_with("Placements to fix") {
            fixing = true;
            continue;
        }
        if !fixing {
            continue;
        }
        let Some((ix, rest)) = line.split_once(": ") else {
            if line.trim().is_empty() {
                continue;
            }
            break;
        };
        let (Ok(index), Ok(mut p)) = (
            ix.trim().parse::<u64>(),
            serde_json::from_str::<Value>(rest),
        ) else {
            break;
        };
        let at = p["anchor"]
            .as_str()
            .and_then(|a| a.strip_prefix("wall:"))
            .and_then(|s| SIDES.iter().position(|x| *x == s));
        let next = SIDES[at.map_or(0, |i| (i + 1) % 4)];
        if let Some(o) = p.as_object_mut() {
            for k in ["from", "side", "gap", "offset", "facing"] {
                o.remove(k);
            }
            // An attachment stays on its desk; only floor items move.
            let on_item = o["anchor"]
                .as_str()
                .is_some_and(|a| a.starts_with("placement:") || a.starts_with("equipment:"));
            if !on_item {
                o.insert("anchor".into(), json!(format!("wall:{next}")));
            }
        }
        replace.push(json!({"index": index, "placement": p}));
    }
    json!({ "replace": replace })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOM: &str = "## Task: office layout\n\nThe brief (counts include what the room already has):\n- workstations: 3\n- meeting seats: 0\n- storage: 0\n- writing surfaces: 0\n- coffee: 0\n- plants: 1\n- budget: none given\n\nThe room:\nNewsroom, 6 m × 6 m.\n- wall:north is 6 m long: door:0 from 1 m to 2 m from the west end (keep 1 m in front clear).\n- wall:east is 6 m long: window:0 from 1 m to 5 m from the north end.\n- wall:south is 6 m long.\n- wall:west is 6 m long.\n- equipment:equip-74: ceiling-light at 3 m from the west wall, 3 m from the north wall, facing south.";

    #[test]
    fn a_plan_from_the_brief_and_the_room() {
        let v = layout(ROOM);
        assert_eq!(
            v,
            json!({"placements": [
                {"design": "desk", "anchor": "window:0", "count": 3, "spacing": 4},
                {"design": "monitor", "anchor": "placement:0"},
                {"design": "plant", "anchor": "wall:south", "from": "wall:west"}
            ]})
        );
        let f = fix("x\nPlacements to fix (change only these):\n2: {\"design\":\"plant\",\"anchor\":\"wall:south\",\"from\":\"wall:west\"}\n\nAnswer");
        assert_eq!(
            f,
            json!({"replace": [{"index": 2, "placement": {"design": "plant", "anchor": "wall:west"}}]})
        );
    }
}
