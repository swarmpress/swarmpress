//! The summary contract: every shipped design the renderer maps a sim
//! equipment kind (or seat, or table) to summarises to what the sim assumes
//! of that kind. The same table is in docs/design/construction-kit.md
//! ("Shipped designs") for the owner's review of the capability rules.

use kit::design::Mount;
use kit::{compile, Kit, Params, Summary};
use sim_core::equipment::{DeskSlot, EquipmentKind};

/// What the sim assumes of a kind.
struct Expect {
    /// Equipment kind slug, or `seat` / `table-seat` / `table`.
    what: &'static str,
    mount: Mount,
    capabilities: &'static [&'static str],
    /// Ports the design must have: `(id, accepts)`.
    ports: &'static [(&'static str, &'static str)],
    /// Information surfaces it must carry.
    surfaces: &'static [&'static str],
    min_seats: u32,
}

const fn expect(
    what: &'static str,
    mount: Mount,
    capabilities: &'static [&'static str],
    ports: &'static [(&'static str, &'static str)],
    surfaces: &'static [&'static str],
    min_seats: u32,
) -> Expect {
    Expect {
        what,
        mount,
        capabilities,
        ports,
        surfaces,
        min_seats,
    }
}

/// The contract table (keep in step with construction-kit.md).
const CONTRACT: [Expect; 14] = [
    expect(
        "desk",
        Mount::Floor,
        &["workstation"],
        &[("screen", "screen"), ("lamp", "light"), ("seat", "seat")],
        &[],
        0,
    ),
    expect("monitor", Mount::Surface, &["screen"], &[], &["monitor"], 0),
    expect(
        "color-monitor",
        Mount::Surface,
        &["screen"],
        &[],
        &["monitor"],
        0,
    ),
    expect("desk-lamp", Mount::Surface, &["light"], &[], &[], 0),
    expect("ceiling-light", Mount::Ceiling, &["light"], &[], &[], 0),
    expect("whiteboard", Mount::Floor, &[], &[], &["whiteboard"], 0),
    expect("archive-shelf", Mount::Floor, &["storage"], &[], &[], 0),
    expect("coffee-machine", Mount::Floor, &[], &[], &[], 0),
    expect("plant", Mount::Floor, &[], &[], &[], 0),
    expect("camera-rig", Mount::Floor, &[], &[], &[], 0),
    expect(
        "mood-board-wall",
        Mount::Floor,
        &[],
        &[],
        &["mood-board"],
        0,
    ),
    expect("seat", Mount::Floor, &["seat"], &[], &[], 1),
    expect("table-seat", Mount::Floor, &["seat"], &[], &[], 1),
    expect(
        "table",
        Mount::Floor,
        &[],
        &[
            ("seat-n", "seat"),
            ("seat-s", "seat"),
            ("seat-e", "seat"),
            ("seat-w", "seat"),
        ],
        &[],
        0,
    ),
];

fn design_for(kit: &Kit, what: &str) -> String {
    let m = kit.mapping();
    match what {
        "seat" => m.desk_seat.clone(),
        "table-seat" => m.table_seat.clone(),
        "table" => m.table.clone(),
        kind => m.equipment[kind].clone(),
    }
}

fn summary_of(kit: &Kit, id: &str) -> Summary {
    compile(kit.design(id).unwrap(), &Params::new(), kit)
        .unwrap()
        .summary
}

#[test]
fn every_equipment_kind_is_mapped_and_in_the_contract() {
    let kit = Kit::shipped();
    for k in EquipmentKind::ALL {
        assert!(
            kit.mapping().equipment.contains_key(k.slug()),
            "{} unmapped",
            k.slug()
        );
        assert!(
            CONTRACT.iter().any(|e| e.what == k.slug()),
            "{} not in the contract",
            k.slug()
        );
    }
    assert_eq!(kit.mapping().equipment.len(), EquipmentKind::ALL.len());
}

#[test]
fn shipped_designs_meet_the_summary_contract() {
    let kit = Kit::shipped();
    for e in &CONTRACT {
        let id = design_for(kit, e.what);
        let s = summary_of(kit, &id);
        assert_eq!(s.mount, e.mount, "{}: mount", e.what);
        for cap in e.capabilities {
            assert!(
                s.has_capability(cap),
                "{} ({id}) is not a {cap}: {:?}",
                e.what,
                s.capabilities
            );
        }
        for (port, accepts) in e.ports {
            let p = s.ports.iter().find(|p| p.id == *port);
            assert!(
                p.is_some_and(|p| p.accepts.iter().any(|a| a == accepts)),
                "{} ({id}) has no port {port} accepting {accepts}",
                e.what
            );
        }
        for name in e.surfaces {
            assert!(
                s.surfaces.iter().any(|x| x == name),
                "{} ({id}) lacks surface {name}",
                e.what
            );
        }
        assert!(s.seats >= e.min_seats, "{}: seats {}", e.what, s.seats);
        // Only seats seat people, only desks are workstations.
        if !e.capabilities.contains(&"seat") {
            assert_eq!(s.seats, 0, "{} ({id}) seats someone", e.what);
        }
        if e.what != "desk" {
            assert!(!s.workstation, "{} ({id}) is a workstation", e.what);
        }
    }
}

#[test]
fn desk_attachments_fit_the_desk_ports() {
    let kit = Kit::shipped();
    let desk = summary_of(kit, &kit.mapping().equipment["desk"]);
    for k in EquipmentKind::ALL {
        let Some(slot) = k.desk_slot() else {
            continue;
        };
        let port_id = &kit.mapping().desk_ports[k.slug()];
        let want = match slot {
            DeskSlot::Screen => "screen",
            DeskSlot::Lamp => "lamp",
        };
        assert_eq!(port_id, want, "{} goes on the {want} port", k.slug());
        let port = desk.ports.iter().find(|p| &p.id == port_id).unwrap();
        let item = summary_of(kit, &kit.mapping().equipment[k.slug()]);
        assert_eq!(item.mount, Mount::Surface, "{} sits on the desk", k.slug());
        // The attachment has every capability the port accepts.
        for a in &port.accepts {
            assert!(
                item.has_capability(a),
                "{} lacks {a} for port {port_id}",
                k.slug()
            );
        }
    }
}

#[test]
fn the_desk_seat_port_is_where_the_sim_seats_people() {
    let kit = Kit::shipped();
    let c = compile(kit.design("desk").unwrap(), &Params::new(), kit).unwrap();
    let seat = c.ports.iter().find(|p| p.id == "seat").unwrap();
    // The port is a grid point; the desk's centre is (w / 2, d / 2).
    let (cx, cz) = (
        i64::from(c.bounds[0]) * 1000 / 2,
        i64::from(c.bounds[1]) * 1000 / 2,
    );
    let (px, pz) = (seat.at[0] * 1000, seat.at[1] * 1000);
    // Studs → millimetres: 62.5 mm a stud.
    let to_mm = |thousandths: i64| thousandths * 625 / 10_000;
    assert_eq!(to_mm(px - cx), 0);
    assert_eq!(
        to_mm(pz - cz),
        i64::from(sim_core::equipment::SEAT_OFFSET_MM),
        "seat 750 mm in front of the desk centre at turn 0"
    );
}

#[test]
fn print_the_contract_table() {
    let kit = Kit::shipped();
    println!("| what | design | mount | capabilities | seats | lights | storage | screens | surfaces | ports | parts | footprint (cm) | sim footprint (cm) |");
    for e in &CONTRACT {
        let id = design_for(kit, e.what);
        let s = summary_of(kit, &id);
        let sim = EquipmentKind::ALL
            .iter()
            .find(|k| k.slug() == e.what)
            .map(|k| format!("{0} × {0}", k.footprint_mm() / 5))
            .unwrap_or_else(|| "—".into());
        let ports: Vec<String> = s
            .ports
            .iter()
            .map(|p| format!("{}:{}", p.id, p.accepts.join("+")))
            .collect();
        println!(
            "| {} | {id} | {:?} | {} | {} | {} | {} | {} | {} | {} | {} | {} × {} | {sim} |",
            e.what,
            s.mount,
            s.capabilities.join(", "),
            s.seats,
            s.lights,
            s.storage,
            s.screens,
            s.surfaces.join(", "),
            ports.join(" "),
            s.parts,
            s.footprint[0] * 625 / 100,
            s.footprint[1] * 625 / 100,
        );
    }
}
