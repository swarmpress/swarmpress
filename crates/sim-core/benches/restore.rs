//! Restore cost (FEAT-060, ADR-0046): rebuilding a company's world from a
//! snapshot against replaying it from the seed.
//!
//! A replay steps through the company's whole history, so its cost grows with
//! the company's age. A snapshot restore decodes a few kilobytes and checks
//! their hash twice; it does not depend on how long the company has run. The
//! commands logged after the snapshot are replayed on top in both cases.
//!
//! `cargo bench -p sim-core --bench restore`

use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use sim_core::scenarios::demo_office;
use sim_core::World;

/// The demo company after `days` game days (12,000 steps each).
fn aged(days: u64) -> World {
    let mut w = demo_office(42);
    for _ in 0..days * w.config.steps_per_day() {
        w.step();
    }
    w
}

fn bench_restore(c: &mut Criterion) {
    for days in [1u64, 4] {
        let world = aged(days);
        let bytes = world.snapshot();
        let steps = world.step;
        c.bench_function(&format!("restore/from_snapshot/{days}_day"), |b| {
            b.iter(|| {
                let w = World::from_snapshot(black_box(&bytes), None).expect("restores");
                black_box(w.step)
            })
        });
        let mut group = c.benchmark_group("restore/replay_from_seed");
        // One iteration is tens of thousands of steps: a handful of samples is enough.
        group.sample_size(10);
        group.bench_function(format!("{days}_day"), |b| {
            b.iter_batched(
                || demo_office(42),
                |mut w| {
                    for _ in 0..steps {
                        w.step();
                    }
                    black_box(w.hash())
                },
                BatchSize::SmallInput,
            )
        });
        group.finish();
    }
    let world = aged(1);
    c.bench_function("restore/snapshot_encode/1_day", |b| {
        b.iter(|| black_box(world.snapshot()))
    });
}

criterion_group!(benches, bench_restore);
criterion_main!(benches);
