//! Money. Cash is integer cents. Every cash movement goes through
//! [`Ledger::post`], so `opening_cash + Σ totals == cash` always holds
//! (checked by the proptest suite).
//!
//! The daily settlement runs when the clock crosses 00:00 and charges
//! salaries (plus 1.5× overtime), rent per lot tile, upkeep per room tile
//! and per piece of equipment, and the instalment of an outstanding bank
//! loan. Per-project attribution of these amounts is in [`crate::finance`].
//!
//! **REVENUE IS A STUB.** [`revenue_stub`] always returns 0 until the
//! publishing pipeline lands (M2: live pages × page value × quality ×
//! freshness × language × reputation, plus audience CPM). Every settlement
//! records `revenue_stubbed: true` so the HUD can say so.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::building::Building;
use crate::commands::{AutonomyPolicy, OvertimePolicy, SiteSignals};
use crate::staff::Staff;

/// Rent per lot tile per day, cents (€1.50, docs/game-design/economy.md).
pub const RENT_PER_TILE: i64 = 150;
/// Bank loan interest over its term, percent.
pub const LOAN_INTEREST_PCT: i64 = 8;
/// Bank loan term, days.
pub const LOAN_DAYS: i64 = 30;
/// Price of one tile of extra land, cents.
pub const LAND_PER_TILE: i64 = 30_000;
/// Severance when firing: days of salary.
pub const SEVERANCE_DAYS: i64 = 3;
/// Settlements kept in [`Ledger::history`].
pub const HISTORY_DAYS: usize = 30;
/// Consecutive negative-cash settlements before receivership (hiring frozen).
pub const RECEIVERSHIP_DAYS: u16 = 7;
/// Normal working minutes per day (overtime pay is computed per minute of this).
pub const WORKDAY_MINUTES: i64 = 480;

/// Always true in M1; see the module docs.
pub const REVENUE_IS_STUB: bool = true;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum LedgerKind {
    Salaries,
    Overtime,
    Rent,
    Upkeep,
    Construction,
    Equipment,
    Land,
    HiringFee,
    Severance,
    Revenue,
    /// In-game Agency invoices (placeholder; jobs arrive in M2).
    Agency,
    /// Loan principal received.
    Loan,
    /// Loan instalments paid (principal + interest).
    LoanRepayment,
}

/// An outstanding bank loan, repaid in daily instalments.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Loan {
    pub principal: i64,
    /// Principal + interest still owed.
    pub remaining: i64,
    pub daily_payment: i64,
}

impl Loan {
    pub fn new(principal: i64) -> Loan {
        let total = principal + principal * LOAN_INTEREST_PCT / 100;
        Loan {
            principal,
            remaining: total,
            daily_payment: (total + LOAN_DAYS - 1) / LOAN_DAYS,
        }
    }
}

/// One day's settlement.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaySettlement {
    /// The day being paid for.
    pub day: u32,
    pub salaries: i64,
    pub overtime: i64,
    pub rent: i64,
    pub upkeep: i64,
    /// Loan instalment paid.
    pub loan: i64,
    pub revenue: i64,
    pub revenue_stubbed: bool,
    pub net: i64,
    pub cash_after: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ledger {
    pub opening_cash: i64,
    /// Cumulative signed amount per kind (costs negative).
    pub totals: BTreeMap<LedgerKind, i64>,
    /// Most recent settlements, oldest first, at most [`HISTORY_DAYS`].
    pub history: Vec<DaySettlement>,
}

impl Ledger {
    pub fn new(opening_cash: i64) -> Ledger {
        Ledger {
            opening_cash,
            totals: BTreeMap::new(),
            history: Vec::new(),
        }
    }

    /// Moves `amount` (signed) into `cash` and books it.
    pub fn post(&mut self, cash: &mut i64, kind: LedgerKind, amount: i64) {
        *cash = cash.saturating_add(amount);
        let t = self.totals.entry(kind).or_insert(0);
        *t = t.saturating_add(amount);
    }

    pub fn total(&self) -> i64 {
        self.totals
            .values()
            .copied()
            .fold(0i64, i64::saturating_add)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Policies {
    pub overtime: OvertimePolicy,
    pub autonomy: AutonomyPolicy,
    /// Editor approval bar (plan: approve at 7 or above).
    pub quality_bar: u8,
    /// The weekly editorial board plans the week (ADR-0069). Off in old
    /// logs; the game turns it on once with `SetPolicy`.
    #[serde(default)]
    pub editorial_board: bool,
}

impl Default for Policies {
    fn default() -> Self {
        Policies {
            overtime: OvertimePolicy::Allow,
            autonomy: AutonomyPolicy::ApproveAll,
            quality_bar: 7,
            editorial_board: false,
        }
    }
}

/// The player's company.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Company {
    /// Cents.
    pub cash: i64,
    /// 0..=1000.
    pub reputation: u16,
    pub audience: u32,
    /// Progression level 1..=5 (unlocks room kinds).
    pub level: u8,
    pub policies: Policies,
    /// Consecutive settlements that ended with negative cash.
    pub negative_days: u16,
    /// Latest nightly site audit, if any.
    pub signals: Option<SiteSignals>,
    /// Outstanding bank loan.
    pub loan: Option<Loan>,
}

impl Company {
    pub fn new(cash: i64, level: u8) -> Company {
        Company {
            cash,
            reputation: 500,
            audience: 0,
            level,
            policies: Policies::default(),
            negative_days: 0,
            signals: None,
            loan: None,
        }
    }

    /// Receivership: hiring frozen.
    pub fn hiring_frozen(&self) -> bool {
        self.negative_days >= RECEIVERSHIP_DAYS
    }
}

/// **STUB — always 0.** Revenue needs published pages, which arrive in M2.
pub fn revenue_stub() -> i64 {
    0
}

/// Overtime pay for `minutes` at 1.5× the per-minute rate of `salary`.
pub fn overtime_pay(salary: i64, minutes: u32) -> i64 {
    salary * i64::from(minutes) * 3 / (WORKDAY_MINUTES * 2)
}

/// Daily upkeep of rooms and equipment, cents.
pub fn upkeep(b: &Building) -> i64 {
    let rooms: i64 = b
        .rooms
        .values()
        .map(|r| r.rect.area() * r.kind.upkeep_per_tile())
        .sum();
    let items: i64 = b.equipment.values().map(|e| e.kind.upkeep()).sum();
    rooms + items
}

/// Computes and books the settlement for `day`. Resets overtime counters.
pub fn settle<'a>(
    day: u32,
    company: &mut Company,
    ledger: &mut Ledger,
    building: &Building,
    staff: impl Iterator<Item = &'a mut Staff>,
) -> DaySettlement {
    let mut salaries = 0i64;
    let mut overtime = 0i64;
    for s in staff {
        salaries += s.salary;
        overtime += overtime_pay(s.salary, s.overtime_minutes);
        s.overtime_minutes = 0;
    }
    let rent = building.lot.area() * RENT_PER_TILE;
    let upkeep = upkeep(building);
    let revenue = revenue_stub();
    let mut loan = 0;
    if let Some(l) = company.loan.as_mut() {
        loan = l.daily_payment.min(l.remaining);
        l.remaining -= loan;
        if l.remaining <= 0 {
            company.loan = None;
        }
    }
    ledger.post(&mut company.cash, LedgerKind::Salaries, -salaries);
    ledger.post(&mut company.cash, LedgerKind::Overtime, -overtime);
    ledger.post(&mut company.cash, LedgerKind::Rent, -rent);
    ledger.post(&mut company.cash, LedgerKind::Upkeep, -upkeep);
    ledger.post(&mut company.cash, LedgerKind::Revenue, revenue);
    if loan != 0 {
        ledger.post(&mut company.cash, LedgerKind::LoanRepayment, -loan);
    }
    if company.cash < 0 {
        company.negative_days = company.negative_days.saturating_add(1);
    } else {
        company.negative_days = 0;
    }
    let s = DaySettlement {
        day,
        salaries,
        overtime,
        rent,
        upkeep,
        loan,
        revenue,
        revenue_stubbed: REVENUE_IS_STUB,
        net: revenue - salaries - overtime - rent - upkeep - loan,
        cash_after: company.cash,
    };
    ledger.history.push(s.clone());
    if ledger.history.len() > HISTORY_DAYS {
        ledger.history.remove(0);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::TileRect;

    #[test]
    fn post_keeps_cash_and_totals_in_sync() {
        let mut cash = 1_000;
        let mut l = Ledger::new(cash);
        l.post(&mut cash, LedgerKind::Rent, -300);
        l.post(&mut cash, LedgerKind::Revenue, 50);
        l.post(&mut cash, LedgerKind::Rent, -100);
        assert_eq!(cash, 650);
        assert_eq!(l.opening_cash + l.total(), cash);
        assert_eq!(l.totals[&LedgerKind::Rent], -400);
    }

    #[test]
    fn overtime_is_time_and_a_half() {
        // 480 overtime minutes = 1.5 days of salary
        assert_eq!(overtime_pay(48_000, 480), 72_000);
        assert_eq!(overtime_pay(48_000, 0), 0);
    }

    #[test]
    fn settlement_charges_rent_and_records_stub() {
        let mut c = Company::new(1_000_000, 1);
        let mut l = Ledger::new(c.cash);
        let b = Building::default_lot();
        let s = settle(0, &mut c, &mut l, &b, std::iter::empty());
        assert_eq!(s.rent, 160 * RENT_PER_TILE);
        assert!(s.revenue_stubbed);
        assert_eq!(s.revenue, 0);
        assert_eq!(c.cash, 1_000_000 - s.rent);
        assert_eq!(l.opening_cash + l.total(), c.cash);
        assert_eq!(l.history.len(), 1);
    }

    #[test]
    fn loans_are_repaid_with_interest() {
        let mut c = Company::new(0, 1);
        let mut l = Ledger::new(0);
        let b = Building::new(
            TileRect::new(0, 0, 0, 0),
            crate::building::Entrance {
                tile: crate::geom::Tile::new(0, 0),
                side: crate::geom::Side::South,
            },
        );
        l.post(&mut c.cash, LedgerKind::Loan, 1_000_000);
        c.loan = Some(Loan::new(1_000_000));
        let mut paid = 0;
        for d in 0..40 {
            paid += settle(d, &mut c, &mut l, &b, std::iter::empty()).loan;
        }
        assert_eq!(paid, 1_080_000);
        assert!(c.loan.is_none());
        assert_eq!(c.cash, -80_000);
        assert_eq!(l.opening_cash + l.total(), c.cash);
    }

    #[test]
    fn negative_days_lead_to_receivership() {
        let mut c = Company::new(0, 1);
        let mut l = Ledger::new(0);
        let b = Building::default_lot();
        for d in 0..7 {
            assert!(!c.hiring_frozen());
            settle(d, &mut c, &mut l, &b, std::iter::empty());
        }
        assert!(c.hiring_frozen());
    }
}
