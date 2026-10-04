//! The finance guard of the week-long run (docs/mvp.md track W,
//! docs/design/mvp-pipeline.md §7 "Economy"): the cinqueterre.travel company
//! runs seven game days with no revenue at all (no article is ever
//! published: every job request is left unanswered) and raises no finance
//! ticket. Starting cash and the daily burn give a runway of about 59 game
//! days, well above the 30-day `RunwayLow` alert, and project spend stays
//! under its budget. FEAT-085.

use sim_core::inbox::TicketKind;
use sim_core::scenarios::scenario;

const SEED: u64 = 7;
const DAYS: u64 = 7;

#[test]
fn seven_days_without_revenue_raise_no_finance_ticket() {
    let mut w = scenario("cinqueterre", SEED).expect("the cinqueterre scenario");
    let start_cash = w.company.cash;
    let steps = w.config.steps_per_day() * DAYS;
    for _ in 0..steps {
        w.step();
        // Nobody runs the jobs: the effects are dropped, so no outcome (and no revenue) ever comes back.
        let _ = w.drain_effects();
    }
    assert!(w.clock().day >= DAYS as u32, "seven days ran (day {})", w.clock().day);

    let finance: Vec<_> = w
        .tickets
        .values()
        .filter(|t| t.kind.is_financial() || t.kind == TicketKind::BudgetOverrun)
        .map(|t| t.kind)
        .collect();
    assert!(finance.is_empty(), "finance tickets in week one: {finance:?}");

    // Money only went out, and the runway is far from the alert.
    assert!(w.company.cash < start_cash, "the company burned cash");
    let runway = w.runway_days().expect("the company burns cash");
    assert!(
        (45..=75).contains(&runway),
        "runway after a week is about 59 game days, got {runway}"
    );
}
