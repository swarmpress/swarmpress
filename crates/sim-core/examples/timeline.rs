//! Prints who does what when during the golden run (debugging aid).
//! `cargo run -p sim-core --example timeline [steps]`

use std::collections::BTreeMap;

use sim_core::scenarios::{demo_office, golden_script, GOLDEN_SEED};
use sim_core::staff::persona_slug;

fn main() {
    let steps: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(30_000);
    let mut w = demo_office(GOLDEN_SEED);
    for (step, input) in golden_script() {
        w.enqueue(step, 0, input).expect("ordered script");
    }
    let mut last: BTreeMap<u32, String> = BTreeMap::new();
    for _ in 0..steps {
        let r = w.step();
        for (seq, res) in r.applied {
            println!("step {} seq {seq}: {res:?}", w.step - 1);
        }
        if let Some(s) = r.settlement {
            println!("settlement {s:?}");
        }
        let c = w.clock();
        for s in w.staff.values() {
            let a = format!("{:?}", s.activity);
            if last.get(&s.id.0) != Some(&a) {
                println!(
                    "day {} {:02}:{:02} {:10} {a}",
                    c.day,
                    c.minute / 60,
                    c.minute % 60,
                    persona_slug(s.persona)
                );
                last.insert(s.id.0, a);
            }
        }
    }
    println!("cash {} nav_failures {}", w.company.cash, w.nav_failures);
}
