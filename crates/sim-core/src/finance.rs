//! The CFO's books (organization.md §6). Bookkeeping is deterministic sim
//! code and runs whether or not a CFO is employed; the CFO only adds alerts
//! (tickets) and, later, LLM-written reports. Without a CFO the books still
//! balance but the HUD shows "books not kept" and no alert is raised.
//!
//! Daily attribution (at the 00:00 settlement, before overtime counters are
//! reset):
//! - salaries and overtime are charged to projects by allocation; the
//!   unallocated share is overhead;
//! - rent and upkeep are shared by allocation-weighted headcount (FTE: a
//!   person 100% on a project counts as one head there); the rest is overhead;
//! - agency fees: placeholder, 0 until jobs exist (M2);
//! - revenue: [`crate::economy::revenue_stub`] (0, loud) goes to overhead;
//!   each project carries a *revenue estimate* from its analytics
//!   (page views × CPM) that is reported but never booked.
//!
//! Invariant (proptest): for salaries, overtime, rent, upkeep and revenue,
//! `Σ project totals + overhead == company ledger totals`.
//!
//! Month close every [`MONTH_DAYS`] game days: a P&L per project and for the
//! company, budget vs actual, runway = cash ÷ average daily burn.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::economy::{overtime_pay, DaySettlement, LedgerKind, Loan, HISTORY_DAYS};
use crate::ids::{ProjectId, StaffId};
use crate::inbox::{TicketKind, TicketSpec};
use crate::projects::{Project, ProjectStatus, CPM_CENTS, MONTH_DAYS};
use crate::staff::Staff;
use crate::world::World;

/// A project more than this over its (prorated) budget is over budget, permille.
pub const OVER_BUDGET_PM: i64 = 1_100;
/// Budget alerts wait for this many settled days in the month, so one
/// expensive first day does not trip them.
pub const MIN_DAYS_FOR_BUDGET_ALERT: u32 = 3;
/// Runway below this many days raises a `runway-low` alert.
pub const RUNWAY_ALERT_DAYS: u32 = 30;
/// A single hire raising payroll by more than this percentage is a spike.
pub const PAYROLL_SPIKE_PCT: i64 = 15;
/// Month closes kept.
pub const CLOSES_KEPT: usize = 12;
/// Loan offers are rounded up to this, cents (€1 000).
pub const LOAN_ROUNDING: i64 = 100_000;
/// Smallest loan offered, cents (€10 000).
pub const MIN_LOAN: i64 = 1_000_000;

/// Amounts for one period, cents. Costs are positive numbers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostBreakdown {
    pub revenue: i64,
    pub salaries: i64,
    pub overtime: i64,
    pub rent: i64,
    pub upkeep: i64,
    /// In-game Agency invoices. Placeholder: always 0 until jobs exist (M2).
    pub agency: i64,
}

impl CostBreakdown {
    /// Total costs.
    pub fn spent(&self) -> i64 {
        self.salaries + self.overtime + self.rent + self.upkeep + self.agency
    }

    pub fn net(&self) -> i64 {
        self.revenue - self.spent()
    }

    pub fn add(&mut self, o: &CostBreakdown) {
        self.revenue += o.revenue;
        self.salaries += o.salaries;
        self.overtime += o.overtime;
        self.rent += o.rent;
        self.upkeep += o.upkeep;
        self.agency += o.agency;
    }
}

/// A project's books.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectLedger {
    /// Month to date.
    pub month: CostBreakdown,
    /// Since the project started.
    pub total: CostBreakdown,
    /// Revenue attributed from the project's analytics this month
    /// (page views × CPM). Reported, never booked: revenue is still a stub.
    pub revenue_estimate_month: i64,
}

/// One day's split of the settlement.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DayAttribution {
    pub projects: BTreeMap<ProjectId, CostBreakdown>,
    pub overhead: CostBreakdown,
}

/// Splits one day's company costs between projects and overhead. Must be
/// called before the settlement resets overtime counters. Allocations on
/// projects unknown to `projects` count as overhead.
pub fn attribute_day(
    staff: &BTreeMap<StaffId, Staff>,
    projects: &BTreeMap<ProjectId, Project>,
    rent: i64,
    upkeep: i64,
    revenue: i64,
) -> DayAttribution {
    let mut out = DayAttribution::default();
    let mut fte: BTreeMap<ProjectId, i64> = BTreeMap::new();
    for s in staff.values() {
        let pay = s.salary;
        let ot = overtime_pay(s.salary, s.overtime_minutes);
        let (mut pay_left, mut ot_left) = (pay, ot);
        for (pid, pct) in &s.projects {
            if !projects.contains_key(pid) {
                continue;
            }
            let pct = i64::from(*pct);
            let e = out.projects.entry(*pid).or_default();
            let (sp, so) = (pay * pct / 100, ot * pct / 100);
            e.salaries += sp;
            e.overtime += so;
            pay_left -= sp;
            ot_left -= so;
            *fte.entry(*pid).or_insert(0) += pct;
        }
        out.overhead.salaries += pay_left;
        out.overhead.overtime += ot_left;
    }
    let heads = i64::try_from(staff.len())
        .unwrap_or(i64::MAX)
        .saturating_mul(100);
    let (mut rent_left, mut upkeep_left) = (rent, upkeep);
    if heads > 0 {
        for (pid, f) in &fte {
            let e = out.projects.entry(*pid).or_default();
            e.rent = rent * f / heads;
            e.upkeep = upkeep * f / heads;
            rent_left -= e.rent;
            upkeep_left -= e.upkeep;
        }
    }
    out.overhead.rent += rent_left;
    out.overhead.upkeep += upkeep_left;
    out.overhead.revenue += revenue;
    out
}

/// Month-close line for one project.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectClose {
    pub project: ProjectId,
    pub budget_cents: i64,
    pub breakdown: CostBreakdown,
    pub spent_cents: i64,
    pub revenue_cents: i64,
    pub revenue_estimate_cents: i64,
    pub over_budget: bool,
}

/// The month-end P&L.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonthClose {
    /// 1-based month number.
    pub month: u32,
    pub first_day: u32,
    pub last_day: u32,
    /// Company operating P&L from the ledger.
    pub company: CostBreakdown,
    /// One-off costs this month: construction, equipment, land, hiring
    /// fees, severance (positive = spent).
    pub other_cents: i64,
    /// Loan principal received minus repayments.
    pub loan_net_cents: i64,
    pub overhead: CostBreakdown,
    pub projects: Vec<ProjectClose>,
    pub cash_end: i64,
    pub runway_days: Option<u32>,
    /// A CFO was employed at the close.
    pub books_kept: bool,
}

/// Finance state on the [`World`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finance {
    /// Current month, 1-based.
    pub month: u32,
    pub month_start_day: u32,
    /// Settlements booked this month.
    pub days_in_month: u32,
    pub company_month: CostBreakdown,
    pub overhead_month: CostBreakdown,
    pub overhead_total: CostBreakdown,
    /// Company ledger totals at the start of the month.
    pub month_open_totals: BTreeMap<LedgerKind, i64>,
    /// Most recent closes, oldest first, at most [`CLOSES_KEPT`].
    pub closes: Vec<MonthClose>,
    /// Projects already alerted as over budget this month.
    pub budget_alerted: BTreeSet<ProjectId>,
}

impl Default for Finance {
    fn default() -> Self {
        Finance {
            month: 1,
            month_start_day: 0,
            days_in_month: 0,
            company_month: CostBreakdown::default(),
            overhead_month: CostBreakdown::default(),
            overhead_total: CostBreakdown::default(),
            month_open_totals: BTreeMap::new(),
            closes: Vec::new(),
            budget_alerted: BTreeSet::new(),
        }
    }
}

/// Budget to date for a month with `days` settled days.
pub fn prorated_budget(monthly: i64, days: u32) -> i64 {
    monthly * i64::from(days.clamp(1, MONTH_DAYS)) / i64::from(MONTH_DAYS)
}

/// Over budget: more than 10% above the prorated budget. No budget, no alarm.
pub fn is_over_budget(monthly: i64, spent: i64, days: u32) -> bool {
    monthly > 0 && spent * 1000 > prorated_budget(monthly, days) * OVER_BUDGET_PM
}

fn delta(now: &BTreeMap<LedgerKind, i64>, then: &BTreeMap<LedgerKind, i64>, k: LedgerKind) -> i64 {
    now.get(&k).copied().unwrap_or(0) - then.get(&k).copied().unwrap_or(0)
}

impl World {
    /// The CFO, if one is employed.
    pub fn cfo(&self) -> Option<StaffId> {
        self.exec.cfo
    }

    /// False when no CFO is employed: the HUD shows "books not kept".
    pub fn books_kept(&self) -> bool {
        self.exec.cfo.is_some()
    }

    /// Average daily burn, cents: costs minus revenue over the recent
    /// settlements, or the projected payroll + rent + upkeep before the first.
    pub fn daily_burn_cents(&self) -> i64 {
        let h = &self.ledger.history;
        if h.is_empty() {
            let payroll: i64 = self.staff.values().map(|s| s.salary).sum();
            let rent = self.building.lot.area() * crate::economy::RENT_PER_TILE;
            return payroll + rent + crate::economy::upkeep(&self.building);
        }
        let n = i64::try_from(h.len().min(HISTORY_DAYS)).unwrap_or(1).max(1);
        let total: i64 = h.iter().map(|s| -s.net).sum();
        total / n
    }

    /// Days of cash left at the average burn; `None` when not burning.
    pub fn runway_days(&self) -> Option<u32> {
        let burn = self.daily_burn_cents();
        if burn <= 0 {
            return None;
        }
        let days = self.company.cash.max(0) / burn;
        Some(u32::try_from(days).unwrap_or(u32::MAX))
    }

    /// Month-to-date budget check of one project.
    pub fn project_over_budget(&self, project: ProjectId) -> bool {
        self.projects.get(&project).is_some_and(|p| {
            is_over_budget(
                p.budget_monthly_cents,
                p.ledger.month.spent(),
                self.finance.days_in_month,
            )
        })
    }

    /// The loan the bank offers when cash goes negative: the overdraft plus
    /// 30 days of burn, rounded up to €1 000, at least €10 000.
    pub fn loan_offer_cents(&self) -> i64 {
        let need = (-self.company.cash).max(0) + self.daily_burn_cents().max(0) * 30;
        let rounded = (need + LOAN_ROUNDING - 1) / LOAN_ROUNDING * LOAN_ROUNDING;
        rounded.max(MIN_LOAN)
    }

    /// Books one settled day into the project ledgers and overhead.
    pub(crate) fn book_day(&mut self, settlement: &DaySettlement, a: DayAttribution) {
        for (pid, c) in &a.projects {
            if let Some(p) = self.projects.get_mut(pid) {
                p.ledger.month.add(c);
                p.ledger.total.add(c);
            }
        }
        self.finance.overhead_month.add(&a.overhead);
        self.finance.overhead_total.add(&a.overhead);
        self.finance.company_month.add(&CostBreakdown {
            revenue: settlement.revenue,
            salaries: settlement.salaries,
            overtime: settlement.overtime,
            rent: settlement.rent,
            upkeep: settlement.upkeep,
            agency: 0,
        });
        self.finance.days_in_month += 1;
    }

    /// CFO alerts after a settlement. Only with a CFO employed.
    pub(crate) fn finance_alerts(&mut self) {
        let Some(cfo) = self.exec.cfo else {
            return;
        };
        let over: Vec<(ProjectId, i64)> = self
            .projects
            .values()
            .filter(|p| p.status == ProjectStatus::Active)
            .filter(|_| self.finance.days_in_month >= MIN_DAYS_FOR_BUDGET_ALERT)
            .filter(|p| !self.finance.budget_alerted.contains(&p.id))
            .filter(|p| self.project_over_budget(p.id))
            .map(|p| {
                let budget = prorated_budget(p.budget_monthly_cents, self.finance.days_in_month);
                (p.id, p.ledger.month.spent() - budget)
            })
            .collect();
        for (pid, amount) in over {
            self.finance.budget_alerted.insert(pid);
            self.raise_ticket(TicketSpec {
                kind: TicketKind::BudgetOverrun,
                project: Some(pid),
                from: Some(cfo),
                role: None,
                amount_cents: amount,
                work_item: None,
            });
        }
        if self
            .runway_days()
            .is_some_and(|days| days < RUNWAY_ALERT_DAYS)
            && !self.has_open_ticket(TicketKind::RunwayLow)
        {
            self.raise_ticket(TicketSpec {
                kind: TicketKind::RunwayLow,
                project: None,
                from: Some(cfo),
                role: None,
                amount_cents: self.company.cash,
                work_item: None,
            });
        }
        if self.company.cash < 0
            && self.company.loan.is_none()
            && !self.has_open_ticket(TicketKind::LoanOffer)
        {
            let amount = self.loan_offer_cents();
            self.raise_ticket(TicketSpec {
                kind: TicketKind::LoanOffer,
                project: None,
                from: Some(cfo),
                role: None,
                amount_cents: amount,
                work_item: None,
            });
        }
    }

    /// Closes the month that ended with settled day `last_day`.
    pub(crate) fn month_close(&mut self, last_day: u32) {
        let totals = self.ledger.totals.clone();
        let then = &self.finance.month_open_totals;
        let d = |k| delta(&totals, then, k);
        let company = CostBreakdown {
            revenue: d(LedgerKind::Revenue),
            salaries: -d(LedgerKind::Salaries),
            overtime: -d(LedgerKind::Overtime),
            rent: -d(LedgerKind::Rent),
            upkeep: -d(LedgerKind::Upkeep),
            agency: -d(LedgerKind::Agency),
        };
        let other = -(d(LedgerKind::Construction)
            + d(LedgerKind::Equipment)
            + d(LedgerKind::Land)
            + d(LedgerKind::HiringFee)
            + d(LedgerKind::Severance));
        let loan_net = d(LedgerKind::Loan) + d(LedgerKind::LoanRepayment);
        let days = self.finance.days_in_month;
        let projects = self
            .projects
            .values()
            .filter(|p| p.status != ProjectStatus::Archived || p.ledger.month.spent() != 0)
            .map(|p| ProjectClose {
                project: p.id,
                budget_cents: p.budget_monthly_cents,
                breakdown: p.ledger.month,
                spent_cents: p.ledger.month.spent(),
                revenue_cents: p.ledger.month.revenue,
                revenue_estimate_cents: p.ledger.revenue_estimate_month,
                over_budget: is_over_budget(p.budget_monthly_cents, p.ledger.month.spent(), days),
            })
            .collect();
        let close = MonthClose {
            month: self.finance.month,
            first_day: self.finance.month_start_day,
            last_day,
            company,
            other_cents: other,
            loan_net_cents: loan_net,
            overhead: self.finance.overhead_month,
            projects,
            cash_end: self.company.cash,
            runway_days: self.runway_days(),
            books_kept: self.books_kept(),
        };
        self.finance.closes.push(close);
        if self.finance.closes.len() > CLOSES_KEPT {
            self.finance.closes.remove(0);
        }
        // open the next month
        self.finance.month += 1;
        self.finance.month_start_day = last_day + 1;
        self.finance.days_in_month = 0;
        self.finance.company_month = CostBreakdown::default();
        self.finance.overhead_month = CostBreakdown::default();
        self.finance.month_open_totals = totals;
        self.finance.budget_alerted.clear();
        let start = self.finance.month_start_day;
        for p in self.projects.values_mut() {
            p.ledger.month = CostBreakdown::default();
            p.ledger.revenue_estimate_month =
                i64::try_from(p.analytics.pageviews_since(start)).unwrap_or(i64::MAX) * CPM_CENTS
                    / 1000;
        }
    }

    /// Recomputes a project's revenue estimate for the current month.
    pub(crate) fn refresh_revenue_estimate(&mut self, project: ProjectId) {
        let start = self.finance.month_start_day;
        if let Some(p) = self.projects.get_mut(&project) {
            let views = i64::try_from(p.analytics.pageviews_since(start)).unwrap_or(i64::MAX);
            p.ledger.revenue_estimate_month = views.saturating_mul(CPM_CENTS) / 1000;
        }
    }

    /// Takes the bank loan of `amount` cents: principal now, 8% interest,
    /// repaid in equal daily instalments over 30 days at settlement.
    pub(crate) fn take_loan(&mut self, amount: i64) {
        self.ledger
            .post(&mut self.company.cash, LedgerKind::Loan, amount);
        self.company.loan = Some(Loan::new(amount));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::PersonaId;
    use crate::roles::Role;
    use crate::scenarios::demo_office;
    use crate::staff::Seniority;

    fn person(id: u32, salary: i64, projects: &[(u32, u8)]) -> Staff {
        let w = demo_office(1);
        let mut s = w.staff.values().next().unwrap().clone();
        s.id = StaffId(id);
        s.persona = PersonaId(1);
        s.role = Role::Writer;
        s.seniority = Seniority::Mid;
        s.salary = salary;
        s.overtime_minutes = 0;
        s.projects = projects
            .iter()
            .map(|(p, pct)| (ProjectId(*p), *pct))
            .collect();
        s
    }

    #[test]
    fn attribution_sums_to_the_company_day() {
        let mut staff = BTreeMap::new();
        staff.insert(StaffId(1), person(1, 10_001, &[(1, 100)]));
        staff.insert(StaffId(2), person(2, 20_003, &[(1, 30), (2, 33)]));
        staff.insert(StaffId(3), person(3, 7_777, &[]));
        let mut s4 = person(4, 9_999, &[(2, 50)]);
        s4.overtime_minutes = 77;
        staff.insert(StaffId(4), s4);
        let mut projects = BTreeMap::new();
        for id in [1, 2] {
            projects.insert(
                ProjectId(id),
                Project::new(
                    ProjectId(id),
                    "p",
                    "p",
                    "p.travel",
                    ProjectStatus::Active,
                    0,
                ),
            );
        }
        let a = attribute_day(&staff, &projects, 12_345, 6_789, 0);
        let mut sum = a.overhead;
        for c in a.projects.values() {
            sum.add(c);
        }
        let payroll: i64 = staff.values().map(|s| s.salary).sum();
        let ot: i64 = staff
            .values()
            .map(|s| overtime_pay(s.salary, s.overtime_minutes))
            .sum();
        assert_eq!(sum.salaries, payroll);
        assert_eq!(sum.overtime, ot);
        assert_eq!(sum.rent, 12_345);
        assert_eq!(sum.upkeep, 6_789);
        // project 1: one full head + 0.3 of another
        assert_eq!(a.projects[&ProjectId(1)].salaries, 10_001 + 6_000);
        assert_eq!(a.projects[&ProjectId(1)].rent, 12_345 * 130 / 400);
        // nobody staffed: everything is overhead
        let mut idle = BTreeMap::new();
        idle.insert(StaffId(3), person(3, 7_777, &[]));
        let a = attribute_day(&idle, &projects, 100, 50, 0);
        assert!(a.projects.is_empty());
        assert_eq!(a.overhead.spent(), 7_777 + 150);
    }

    #[test]
    fn budget_rules() {
        // €60k a month, 15 days in: €30k budget to date, alarm above €33k
        assert_eq!(prorated_budget(6_000_000, 15), 3_000_000);
        assert!(!is_over_budget(6_000_000, 3_300_000, 15));
        assert!(is_over_budget(6_000_000, 3_300_001, 15));
        assert!(!is_over_budget(0, 99_999_999, 15));
    }
}
