//! Step throughput. Budget: 1000 steps of the demo office (100 s of real
//! time at 10 Hz) must stay far below 100 ms so a server can host hundreds of
//! companies per core and the browser replica costs nothing per frame.
//!
//! `cargo bench -p sim-core --bench step`

use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use sim_core::scenarios::demo_office;

fn bench_step(c: &mut Criterion) {
    // Mid-morning: everyone seated, the cheap steady state.
    let mut morning = demo_office(42);
    // 07:00 → 10:00 at 12,000 steps per day
    for _ in 0..1_500 {
        morning.step();
    }
    c.bench_function("demo_office/1000_steps/from_07:00", |b| {
        b.iter_batched(
            || demo_office(42),
            |mut w| {
                for _ in 0..1_000 {
                    black_box(w.step());
                }
                w
            },
            BatchSize::SmallInput,
        )
    });
    c.bench_function("demo_office/1000_steps/from_10:00", |b| {
        b.iter_batched(
            || morning.clone(),
            |mut w| {
                for _ in 0..1_000 {
                    black_box(w.step());
                }
                w
            },
            BatchSize::SmallInput,
        )
    });
    c.bench_function("demo_office/render_state", |b| {
        b.iter(|| black_box(morning.render_state()))
    });
    c.bench_function("demo_office/hash", |b| b.iter(|| black_box(morning.hash())));
}

criterion_group!(benches, bench_step);
criterion_main!(benches);
