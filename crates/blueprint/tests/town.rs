//! The brick town: a deterministic view of the blueprint that the kit
//! compiles without issues (FEAT-090, design §4).

use std::collections::BTreeSet;
use std::path::PathBuf;

use blueprint::import::import;
use blueprint::town::{town, TownInput};
use knowledge::DirSource;

fn mini() -> blueprint::Blueprint {
    let src = DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../knowledge/tests/fixtures/cinqueterre-mini"),
    );
    import(&src).unwrap().blueprint
}

#[test]
fn the_fixture_town_compiles_and_is_stable() {
    let bp = mini();
    let design = town(&bp, &TownInput::default());
    let kit = kit::Kit::shipped();
    let built =
        kit::compile(&design, &kit::Params::new(), kit).unwrap_or_else(|e| panic!("{e:#?}"));
    assert!(built.summary.parts > 0);
    // Same blueprint, same bricks.
    let again = town(&mini(), &TownInput::default());
    assert_eq!(design.hash().unwrap(), again.hash().unwrap());
    // The view names the blueprint it shows.
    match &design.provenance {
        kit::design::Provenance::View { source, hash } => {
            assert_eq!(source, "blueprint");
            assert_eq!(hash, &blueprint::hash(&bp));
        }
        other => panic!("{other:?}"),
    }
}

/// The fixture town as JSON: the renderer's tests build it (`apps/game`).
#[test]
fn the_fixture_town_is_golden() {
    let design = town(&mini(), &TownInput::default());
    let text = serde_json::to_string_pretty(&design).unwrap() + "\n";
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cinqueterre-mini.town.json");
    if std::env::var_os("BLESS").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(
        text,
        std::fs::read_to_string(&path).expect("golden (BLESS=1)")
    );
}

#[test]
fn problems_and_changes_show_in_the_bricks() {
    let bp = mini();
    let plain = town(&bp, &TownInput::default());
    let flagged = town(
        &bp,
        &TownInput {
            issues: BTreeSet::from(["city/lead".to_string()]),
            ..TownInput::default()
        },
    );
    assert_ne!(plain.hash().unwrap(), flagged.hash().unwrap());
    kit::compile(&flagged, &kit::Params::new(), kit::Kit::shipped()).unwrap();
    let mut fewer = bp.clone();
    fewer.page_types.pop();
    let smaller = town(&fewer, &TownInput::default());
    assert!(smaller.footprint[0] != plain.footprint[0]);
}

/// The fixture tools as machines in the factory district (design §4.3).
#[test]
fn tools_stand_as_machines_east_of_the_town() {
    use blueprint::machines::{layout, type_colour, MachineInput};
    use blueprint::tools::ToolGraph;
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/site/blueprint/tools");
    let tool = |id: &str| {
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{id}.tool.json"))).unwrap(),
        )
        .unwrap();
        ToolGraph::from_value(&v).unwrap()
    };
    // Layers: longest path from a source, then id order.
    let ferry = tool("ferry-times");
    let l = layout(&ferry);
    assert_eq!(l["fetch"], (0, 0));
    assert_eq!(l["in"], (0, 1));
    assert_eq!(l["rows"], (1, 0));
    assert_eq!(l["here"], (2, 0));
    assert_eq!(l["out"], (5, 0));
    assert_eq!(type_colour("FerryRow[]"), type_colour("FerryRow"));
    assert_eq!(type_colour("Article"), "blue");

    let bp = mini();
    let plain = town(&bp, &TownInput::default());
    let tools = vec![
        MachineInput {
            graph: ferry,
            broken: Default::default(),
        },
        MachineInput {
            graph: tool("story-teaser"),
            broken: ["write".to_string()].into(),
        },
    ];
    let with = town(
        &bp,
        &TownInput {
            tools,
            ..TownInput::default()
        },
    );
    assert!(with.footprint[0] != plain.footprint[0]);
    let built = kit::compile(&with, &kit::Params::new(), kit::Kit::shipped())
        .unwrap_or_else(|e| panic!("{e:#?}"));
    let base = kit::compile(&plain, &kit::Params::new(), kit::Kit::shipped()).unwrap();
    assert!(built.summary.parts > base.summary.parts);
}
