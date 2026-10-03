//! Compile time of the construction kit, against construction-kit.md §3's
//! targets: a desk-sized design under 5 ms (in wasm; native is measured
//! here), a whole room under 200 ms.
//!
//! The room is the demo office's newsroom (`Sim.demo`'s layout from
//! sim-core): its shell plus every design the renderer will place in it
//! (desks, chairs, monitors, lamps, ceiling lights), with instance buffers.
//! "cached" compiles each distinct design and parameter set once, as the
//! renderer will (geometry is cached by design hash); "uncached" compiles
//! every placement.
//!
//! `cargo bench -p kit --bench compile`

#[path = "../tests/common/mod.rs"]
mod common;

use std::collections::BTreeMap;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use kit::{buffers, compile, room_shell, Kit, Params, RoomSpec};
use sim_core::building::RoomKind;

fn build_room(kit: &Kit, spec: &RoomSpec, placements: &[common::Placement], cached: bool) -> usize {
    let mut parts = 0;
    for chunk in room_shell(spec, kit).unwrap() {
        let c = compile(&chunk.design, &Params::new(), kit).unwrap();
        parts += c.summary.parts as usize;
        black_box(buffers(&c, kit));
    }
    let mut done: BTreeMap<(String, String), usize> = BTreeMap::new();
    for p in placements {
        let key = (p.design.clone(), serde_json::to_string(&p.params).unwrap());
        if cached {
            if let Some(n) = done.get(&key) {
                parts += n;
                continue;
            }
        }
        let c = compile(kit.design(&p.design).unwrap(), &p.params, kit).unwrap();
        let n = c.summary.parts as usize;
        black_box(buffers(&c, kit));
        done.insert(key, n);
        parts += n;
    }
    parts
}

fn bench(c: &mut Criterion) {
    let kit = Kit::shipped();
    let none = Params::new();
    let mut designs = c.benchmark_group("kit-design");
    for id in ["desk", "chair", "archive-shelf"] {
        let d = kit.design(id).unwrap();
        designs.bench_function(id, |b| {
            b.iter(|| compile(black_box(d), &none, kit).unwrap())
        });
    }
    let desk = kit.design("desk").unwrap();
    designs.bench_function("desk+buffers", |b| {
        b.iter(|| buffers(&compile(black_box(desk), &none, kit).unwrap(), kit))
    });
    designs.finish();

    let world = common::demo();
    let specs = common::demo_room_specs();
    let newsroom = world.building.first_room_of(RoomKind::Newsroom).unwrap().id;
    let spec = specs
        .iter()
        .find(|s| s.id == newsroom.to_string())
        .unwrap()
        .clone();
    let placements = common::demo_placements(&world, newsroom);
    let parts = build_room(kit, &spec, &placements, false);
    eprintln!(
        "newsroom: {} placements, {parts} parts (shell and furniture)",
        placements.len()
    );

    let mut rooms = c.benchmark_group("kit-room");
    rooms.sample_size(20);
    rooms.bench_function("newsroom/shell", |b| {
        b.iter(|| {
            for ch in room_shell(black_box(&spec), kit).unwrap() {
                black_box(compile(&ch.design, &none, kit).unwrap());
            }
        })
    });
    rooms.bench_function("newsroom/cached", |b| {
        b.iter(|| build_room(kit, black_box(&spec), &placements, true))
    });
    rooms.bench_function("newsroom/uncached", |b| {
        b.iter(|| build_room(kit, black_box(&spec), &placements, false))
    });
    let all: Vec<(RoomSpec, Vec<common::Placement>)> = world
        .building
        .rooms
        .values()
        .map(|r| {
            let s = specs
                .iter()
                .find(|s| s.id == r.id.to_string())
                .unwrap()
                .clone();
            (s, common::demo_placements(&world, r.id))
        })
        .collect();
    rooms.bench_function("demo-office/uncached", |b| {
        b.iter(|| {
            all.iter()
                .map(|(s, p)| build_room(kit, s, p, false))
                .sum::<usize>()
        })
    });
    rooms.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
