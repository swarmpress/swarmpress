//! The brick splitter: a committed fixture for a known shape, and properties
//! (no gaps, no overlaps, standard sizes only, never across colours,
//! materials or objects, studs exactly on visible top faces).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use kit::grid::{Cell, Grid, Mat};
use kit::split::{split, Candidates};
use kit::{compile, Compiled, Design, Kit, Params};
use proptest::prelude::*;
use serde_json::{json, Value};

fn design(footprint: [i64; 2], height: i64, ops: Value) -> Design {
    Design::from_json(
        &json!({
            "format": "swarmpress.design.v1",
            "id": "splitter-probe",
            "name": "Splitter probe",
            "footprint": footprint,
            "height": height,
            "ops": ops,
            "provenance": { "kind": "kit" }
        })
        .to_string(),
    )
    .unwrap()
}

/// The fixture shape: a wall with a window opening, a stepped pyramid of
/// bricks, plates and a smooth top, and a patch of floor tiles.
fn fixture_design() -> Design {
    design(
        [16, 6],
        12,
        json!([
            { "op": "box", "at": [0, 0, 0], "size": [16, 1, 12], "part": "brick", "colour": "white" },
            { "op": "box", "at": [5, 0, 3], "size": [6, 1, 6], "part": "empty" },
            { "op": "box", "at": [0, 2, 0], "size": [8, 4, 3], "part": "brick", "colour": "red" },
            { "op": "box", "at": [1, 2, 3], "size": [6, 4, 3], "part": "plate", "colour": "navy" },
            { "op": "box", "at": [2, 3, 6], "size": [4, 2, 3], "part": "brick", "colour": "sand" },
            { "op": "box", "at": [3, 3, 9], "size": [2, 2, 1], "part": "tile", "colour": "sand" },
            { "op": "box", "at": [10, 2, 0], "size": [6, 4, 1], "part": "tile", "colour": "navy" }
        ]),
    )
}

fn render(c: &Compiled) -> String {
    let mut out = String::new();
    for (colour, b) in c.bricks() {
        out.push_str(&format!(
            "{:4} {:7} {:12} at {:?} turn {}\n",
            b.seq, colour, b.part, b.at, b.turn
        ));
    }
    for g in &c.groups {
        out.push_str(&format!("studs {} {:?}\n", g.colour, g.studs));
    }
    out
}

#[test]
fn a_known_shape_matches_the_committed_fixture() {
    let kit = Kit::shipped();
    let c = compile(&fixture_design(), &Params::new(), kit)
        .unwrap_or_else(|e| panic!("{}", common::show(&e)));
    let got = render(&c);
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/splitter-wall.txt");
    if std::env::var_os("KIT_BLESS").is_some() {
        std::fs::write(&path, &got).unwrap();
    }
    let want = std::fs::read_to_string(&path).expect("run with KIT_BLESS=1 to write the fixture");
    assert_eq!(
        got, want,
        "splitter output changed (KIT_BLESS=1 rewrites the fixture)"
    );
}

/// Cells of a placed standard part: `(x, y, z)`.
fn cells_of(kit: &Kit, part: &str, at: [u32; 3], turn: u8) -> Vec<(u32, u32, u32)> {
    let def = kit.part(kit.part_index(part).unwrap());
    let [w, d, h] = def.size;
    let (fx, fz) = if turn.is_multiple_of(2) {
        (w, d)
    } else {
        (d, w)
    };
    let mut out = Vec::new();
    for y in at[2]..at[2] + h {
        for z in at[1]..at[1] + fz {
            for x in at[0]..at[0] + fx {
                out.push((x, y, z));
            }
        }
    }
    out
}

/// A random column of brick material: `(x, z, w, d, h, material, colour)`.
fn column() -> impl Strategy<Value = (i64, i64, i64, i64, i64, usize, usize)> {
    (
        0i64..10,
        0i64..8,
        1i64..6,
        1i64..5,
        1i64..13,
        0usize..3,
        0usize..3,
    )
        .prop_map(|(x, z, w, d, h, m, c)| (x, z, w.min(10 - x), d.min(8 - z), h, m, c))
}

const MATS: [&str; 3] = ["brick", "plate", "tile"];
const COLOURS: [&str; 3] = ["red", "navy", "sand"];

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn bricks_tile_the_shape_exactly_and_studs_sit_on_visible_tops(cols in prop::collection::vec(column(), 1..10)) {
        let kit = Kit::shipped();
        let ops: Vec<Value> = cols
            .iter()
            .map(|&(x, z, w, d, h, m, c)| json!({
                "op": "box", "at": [x, z, 0], "size": [w, d, h], "part": MATS[m], "colour": COLOURS[c]
            }))
            .collect();
        // What the boxes leave, replayed independently: (x, y, z) → (material, colour).
        let mut want: BTreeMap<(u32, u32, u32), (usize, usize)> = BTreeMap::new();
        for &(x, z, w, d, h, m, c) in &cols {
            for y in 0..h {
                for zz in z..z + d {
                    for xx in x..x + w {
                        want.insert((xx as u32, y as u32, zz as u32), (m, c));
                    }
                }
            }
        }
        let c = compile(&design([10, 8], 12, Value::Array(ops)), &Params::new(), kit)
            .unwrap_or_else(|e| panic!("{}", common::show(&e)));
        let mut covered = BTreeSet::new();
        let mut studded_tops = BTreeSet::new();
        for (colour, b) in c.bricks() {
            let kind = b.part.split('-').next().unwrap();
            for cell in cells_of(kit, &b.part, b.at, b.turn) {
                prop_assert!(covered.insert(cell), "overlap at {cell:?}");
                let (m, col) = want.get(&cell).copied().expect("a brick outside the shape");
                prop_assert_eq!(COLOURS[col], colour);
                let ok = match MATS[m] {
                    "brick" => kind == "brick" || kind == "plate",
                    "plate" => kind == "plate",
                    _ => kind == "tile",
                };
                prop_assert!(ok, "{} cell covered by {}", MATS[m], b.part);
            }
            if kind != "tile" {
                let def = kit.part(kit.part_index(&b.part).unwrap());
                let top = b.at[2] + def.size[2];
                for (x, _, z) in cells_of(kit, &b.part, b.at, b.turn).into_iter().filter(|c| c.1 == b.at[2]) {
                    studded_tops.insert((x, top, z));
                }
            }
        }
        let want_cells: BTreeSet<_> = want.keys().copied().collect();
        prop_assert_eq!(&covered, &want_cells, "gaps in the brick cover");
        let visible: BTreeSet<[u32; 3]> = studded_tops
            .into_iter()
            .filter(|&(x, top, z)| top >= c.bounds[2] || !want.contains_key(&(x, top, z)))
            .map(|(x, top, z)| [2 * x + 1, 2 * z + 1, top])
            .collect();
        let studs: BTreeSet<[u32; 3]> = c.groups.iter().flat_map(|g| g.studs.iter().copied()).collect();
        prop_assert_eq!(studs, visible);
    }

    #[test]
    fn the_splitter_never_merges_across_colour_material_or_object(
        cells in prop::collection::vec((0u8..6, 0u16..2), 6 * 5 * 7)
    ) {
        let mut g = Grid::new(6, 5, 7);
        for (i, &(k, object)) in cells.iter().enumerate() {
            g.cells[i] = match k {
                0 | 1 => Cell::default(),
                2 => Cell { mat: Mat::Brick, colour: 1, object, owner: 0 },
                3 => Cell { mat: Mat::Brick, colour: 2, object, owner: 0 },
                4 => Cell { mat: Mat::Plate, colour: 1, object, owner: 0 },
                _ => Cell { mat: Mat::Tile, colour: 1, object, owner: 0 },
            };
        }
        let cands = Candidates::new();
        let pieces = split(&g, &cands);
        prop_assert_eq!(&pieces, &split(&g, &cands), "deterministic");
        let mut seen = vec![false; g.cells.len()];
        for p in &pieces {
            let list = match p.mat {
                Mat::Brick => &cands.studded,
                Mat::Plate => &cands.plates,
                _ => &cands.tiles,
            };
            prop_assert!(list.contains(&(p.fx, p.fz, p.h)), "non-standard size {:?}", p);
            for y in p.y..p.y + p.h {
                for z in p.z..p.z + p.fz {
                    for x in p.x..p.x + p.fx {
                        let i = g.idx(x, y, z);
                        prop_assert!(!seen[i], "overlap");
                        seen[i] = true;
                        let c = g.cells[i];
                        prop_assert_eq!((c.mat, c.colour, c.object), (p.mat, p.colour, p.object));
                    }
                }
            }
        }
        for (i, c) in g.cells.iter().enumerate() {
            prop_assert_eq!(seen[i], !c.is_empty(), "gap at {}", i);
        }
    }
}
