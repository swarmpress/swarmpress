//! Every shipped design and room shell compiles within its budget, and the
//! shipped data matches the files under `kit/` and their JSON Schemas.

mod common;

use std::collections::BTreeSet;
use std::path::Path;

use kit::{compile, room_shell, Kit, Limits, Params};

fn kit_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../kit")
}

#[test]
fn every_shipped_design_compiles_within_budget() {
    let kit = Kit::shipped();
    let limits = Limits::default();
    let mut lines = Vec::new();
    for (id, design) in kit.designs() {
        let c = compile(design, &Params::new(), kit)
            .unwrap_or_else(|e| panic!("{id}: {}", common::show(&e)));
        let s = &c.summary;
        assert!(s.parts > 0, "{id} is empty");
        assert!(s.parts <= limits.max_parts, "{id}: {} parts", s.parts);
        assert!(s.height <= c.bounds[2], "{id}: built above its height");
        assert_eq!(c.hash, kit.design_hash(id).unwrap());
        lines.push(format!(
            "{id:16} footprint {:2}x{:<2} parts {:5} studs {:5} height {:3} cost {:6} caps {:?}",
            c.bounds[0], c.bounds[1], s.parts, s.studs, s.height, s.cost, s.capabilities
        ));
    }
    println!("{}", lines.join("\n"));
}

#[test]
fn parameter_ranges_compile_at_both_ends() {
    let kit = Kit::shipped();
    for (id, design) in kit.designs() {
        for (name, def) in &design.params {
            if let kit::design::ParamDef::Int { min, max, .. } = def {
                for v in [*min, *max] {
                    let mut p = Params::new();
                    p.insert(name.clone(), kit::ParamValue::Int(v));
                    compile(design, &p, kit)
                        .unwrap_or_else(|e| panic!("{id} {name}={v}: {}", common::show(&e)));
                }
            }
        }
    }
}

#[test]
fn every_room_kind_has_a_shell_and_the_demo_rooms_compile() {
    let kit = Kit::shipped();
    let kinds: BTreeSet<&str> = sim_core::building::RoomKind::ALL
        .iter()
        .map(|k| k.slug())
        .collect();
    let styled: BTreeSet<&str> = kit.rooms().styles.keys().map(String::as_str).collect();
    assert_eq!(kinds, styled, "one shell style per sim room kind");
    for spec in common::demo_room_specs() {
        let chunks =
            room_shell(&spec, kit).unwrap_or_else(|e| panic!("{}: {}", spec.id, common::show(&e)));
        assert_eq!(chunks.len(), 1, "demo rooms are at most 8 × 8 m");
        let c = compile(&chunks[0].design, &Params::new(), kit)
            .unwrap_or_else(|e| panic!("{}: {}", spec.id, common::show(&e)));
        let s = &c.summary;
        assert_eq!(
            s.doors as usize,
            spec.doors.len(),
            "{}: door leaves",
            spec.id
        );
        assert!(
            s.windows as usize >= 3 * spec.windows.len(),
            "{}: windows",
            spec.id
        );
        println!(
            "{:8} {:16} {:3}×{:3} parts {:5} studs {:5} doors {} windows {}",
            spec.id, spec.kind, c.bounds[0], c.bounds[1], s.parts, s.studs, s.doors, s.windows
        );
    }
}

#[test]
fn a_big_room_is_cut_into_chunks() {
    let kit = Kit::shipped();
    let spec = kit::RoomSpec {
        id: "room-9".into(),
        kind: "newsroom".into(),
        w_mm: 12_000,
        d_mm: 9_000,
        doors: vec![],
        doorways: vec![],
        windows: vec![kit::shell::Opening {
            side: kit::shell::Side::North,
            at_mm: 6_500,
            width_mm: 3_000,
        }],
    };
    let chunks = room_shell(&spec, kit).unwrap();
    assert_eq!(chunks.len(), 4);
    assert_eq!(chunks[1].at, [128, 0]);
    for ch in &chunks {
        compile(&ch.design, &Params::new(), kit)
            .unwrap_or_else(|e| panic!("{}: {}", ch.design.id, common::show(&e)));
    }
}

#[test]
fn the_embedded_designs_are_the_files_in_kit_designs() {
    let mut on_disk: Vec<String> = std::fs::read_dir(kit_dir().join("designs"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| p.file_stem().unwrap().to_string_lossy().into_owned())
        .collect();
    on_disk.sort();
    let embedded: Vec<String> = kit::shipped::DESIGNS
        .iter()
        .map(|(s, _)| s.to_string())
        .collect();
    assert_eq!(on_disk, embedded);
    for (stem, text) in kit::shipped::DESIGNS {
        let d = kit::Design::from_json(text).unwrap();
        assert_eq!(d.id, stem, "file name is the design id");
    }
    let parts: Vec<String> = std::fs::read_dir(kit_dir().join("parts"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(parts.len(), kit::shipped::PARTS.len());
}

fn validate(schema: &str, file: &Path) {
    let schema: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(kit_dir().join("schema").join(schema)).unwrap(),
    )
    .unwrap();
    let v = jsonschema::validator_for(&schema).unwrap();
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    let errors: Vec<String> = v
        .iter_errors(&doc)
        .map(|e| format!("{} at {}", e, e.instance_path))
        .collect();
    assert!(errors.is_empty(), "{}: {errors:#?}", file.display());
}

#[test]
fn the_data_files_match_their_json_schemas() {
    validate("palette.schema.json", &kit_dir().join("palette.json"));
    validate("rooms.schema.json", &kit_dir().join("rooms.json"));
    validate("mapping.schema.json", &kit_dir().join("mapping.json"));
    for e in std::fs::read_dir(kit_dir().join("parts")).unwrap() {
        validate("parts.schema.json", &e.unwrap().path());
    }
    for e in std::fs::read_dir(kit_dir().join("designs")).unwrap() {
        validate("design.schema.json", &e.unwrap().path());
    }
}

#[test]
fn the_schema_and_the_loader_refuse_the_same_bad_parts() {
    use kit::shipped::{DESIGNS, MAPPING, PALETTE, PARTS, ROOMS};
    let schema: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(kit_dir().join("schema/parts.schema.json")).unwrap(),
    )
    .unwrap();
    let v = jsonschema::validator_for(&schema).unwrap();
    let designs: Vec<&str> = DESIGNS.iter().map(|d| d.1).collect();
    let load = |standard: &str| {
        let parts = [standard, PARTS[1]];
        Kit::load(&kit::catalogue::Sources {
            palette: PALETTE,
            parts: &parts,
            designs: &designs,
            rooms: ROOMS,
            mapping: MAPPING,
        })
    };
    let good = r#"{"id": "brick-1x1", "kind": "brick", "size": [1, 1, 3], "geometry": "box", "top": "studs", "bottom": "anti-studs", "colours": ["solid", "metal", "transparent"], "cost": 3}"#;
    assert!(PARTS[0].contains(good));
    assert!(load(PARTS[0]).is_ok());
    let bads = [
        good.replace("\"box\"", "\"sphere\""),
        good.replace("\"cost\": 3", "\"cost\": 3, \"weight\": 1"),
        good.replace("[1, 1, 3]", "[0, 1, 3]"),
        good.replace("\"solid\", ", "\"chrome\", "),
        good.replace("\"brick-1x1\"", "\"Brick 1x1\""),
    ];
    for bad in bads {
        let standard = PARTS[0].replace(good, &bad);
        let doc: serde_json::Value = serde_json::from_str(&standard).unwrap();
        assert!(!v.is_valid(&doc), "the schema accepts {bad}");
        let issues = load(&standard).unwrap_err();
        assert!(
            issues
                .iter()
                .all(|i| i.code == kit::IssueCode::BadCatalogue),
            "{issues:?}"
        );
    }
}
