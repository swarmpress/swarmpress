//! Scenario tests for the organization layer (docs/game-design/organization.md):
//! the cinqueterre.travel starting company, projects and teams, the daily
//! rhythm, the CFO's books, the Inbox and the Secretary.

use std::collections::BTreeSet;

use sim_core::building::RoomKind;
use sim_core::clock::{hm, SimConfig};
use sim_core::commands::{Command, ServerCommand};
use sim_core::equipment::EquipmentKind;
use sim_core::finance::CostBreakdown;
use sim_core::geom::TileRect;
use sim_core::ids::{ProjectId, StaffId};
use sim_core::inbox::{
    DelegationPolicy, Priority, ResolvedBy, SecretaryTaskKind, TaskStatus, TicketKind,
    TicketOption, TicketSpec, TicketStatus,
};
use sim_core::projects::ProjectStatus;
use sim_core::roles::{Department, Role};
use sim_core::scenarios::{demo_office, demo_office_with_config, DEMO_PROJECT};
use sim_core::staff::{persona_slug, Activity, Spot};
use sim_core::world::MeetingKind;
use sim_core::{Reject, World};

/// One game day = 600 steps (1 real minute): fast month-long runs.
fn fast(seed: u64) -> World {
    demo_office_with_config(
        seed,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

fn run_until(w: &mut World, day: u32, minute: u16) {
    while (w.clock().day, w.clock().minute) < (day, minute) {
        w.step();
    }
}

fn run_days(w: &mut World, days: u32) {
    let target = w.clock().day + days;
    let minute = w.clock().minute;
    run_until(w, target, minute);
}

fn tickets_of(w: &World, kind: TicketKind) -> Vec<&sim_core::inbox::Ticket> {
    w.tickets.values().filter(|t| t.kind == kind).collect()
}

#[test]
fn cinqueterre_starting_company() {
    let w = demo_office(1);
    assert_eq!(w.building.lot, TileRect::new(0, 0, 24, 16));
    assert_eq!(w.company.level, 3);
    assert_eq!(w.staff.len(), 13);
    let expected = [
        ("giulia", Role::Writer, 100),
        ("isabella", Role::Writer, 100),
        ("lorenzo", Role::Writer, 100),
        ("sophia", Role::EditorInChief, 100),
        ("marco", Role::Editor, 100),
        ("francesca", Role::Photographer, 100),
        ("elena", Role::Cfo, 0),
        ("paolo", Role::Secretary, 0),
        ("chiara", Role::Strategist, 0),
        ("luca", Role::WebDeveloper, 100),
        ("davide", Role::ItEngineer, 100),
        ("alessia", Role::SeoSpecialist, 100),
        ("matteo", Role::DataScientist, 0),
    ];
    for (i, (slug, role, pct)) in expected.iter().enumerate() {
        let s = &w.staff[&StaffId(u32::try_from(i + 1).unwrap())];
        assert_eq!(persona_slug(s.persona), *slug);
        assert_eq!(s.role, *role, "{slug}");
        assert_eq!(s.allocation(DEMO_PROJECT), *pct, "{slug}");
        assert!(s.home_desk.is_some(), "{slug} has a desk");
    }
    // every department is populated
    for d in Department::ALL {
        assert!(w.staff.values().any(|s| s.department() == d), "{d:?}");
    }
    assert_eq!(w.exec.cfo, Some(StaffId(7)));
    assert_eq!(w.exec.secretary, Some(StaffId(8)));
    assert_eq!(w.exec.delegation, DelegationPolicy::Low);

    let p = &w.projects[&DEMO_PROJECT];
    assert_eq!(p.slug, "cinqueterre-travel");
    assert_eq!(p.domain, "cinqueterre.travel");
    assert_eq!(p.repo, "swarmpress/cinqueterre.travel");
    assert_eq!(p.status, ProjectStatus::Active);
    assert_eq!(p.lead, Some(StaffId(4)));
    assert_eq!(w.projects.len(), 1);
    // every active project is fully staffed
    for p in w
        .projects
        .values()
        .filter(|p| p.status == ProjectStatus::Active)
    {
        assert!(
            w.missing_roles(p.id).is_empty(),
            "{:?}",
            w.missing_roles(p.id)
        );
    }
    assert!(w.tickets.is_empty(), "a clean start");
    // a room for every department, plus the CEO and the kitchen
    for kind in [
        RoomKind::Newsroom,
        RoomKind::EditorOffice,
        RoomKind::MeetingRoom,
        RoomKind::CeoOffice,
        RoomKind::FinanceOffice,
        RoomKind::StrategyRoom,
        RoomKind::PhotoStudio,
        RoomKind::DesignStudio,
        RoomKind::ServerRoom,
        RoomKind::SeoLab,
        RoomKind::Kitchen,
    ] {
        assert!(w.building.first_room_of(kind).is_some(), "{kind:?}");
    }
    assert_eq!(w.building.first_unreachable_room(), None);
    // desks sit in the department's room
    let room_of = |id: u32| {
        let desk = w.staff[&StaffId(id)].home_desk.unwrap();
        w.building.rooms[&w.building.equipment[&desk].room].kind
    };
    assert_eq!(room_of(7), RoomKind::FinanceOffice);
    assert_eq!(room_of(9), RoomKind::StrategyRoom);
    assert_eq!(room_of(13), RoomKind::StrategyRoom);
    assert_eq!(room_of(6), RoomKind::PhotoStudio);
    assert_eq!(room_of(11), RoomKind::ServerRoom);
    assert_eq!(w.free_desks().len(), 3, "spare desks for hires");
    assert_eq!(w.ledger.opening_cash + w.ledger.total(), w.company.cash);
    let runway = w.runway_days().unwrap();
    assert!((45..=90).contains(&runway), "runway {runway}");
}

#[test]
fn office_runs_a_normal_day() {
    let mut w = demo_office(11);
    run_until(&mut w, 0, hm(10, 30));
    let rs = w.render_state();
    assert_eq!(rs.staff.len(), 13);
    assert!(
        rs.staff.iter().all(|s| s.seated_at.is_some()),
        "everyone at a desk"
    );
    run_until(&mut w, 0, hm(23, 0));
    // Marco works late, alone
    let on_site: Vec<_> = w.staff.values().filter(|s| s.is_on_site()).collect();
    assert_eq!(on_site.len(), 1);
    assert_eq!(persona_slug(on_site[0].persona), "marco");
    assert_eq!(w.nav_failures, 0);
}

#[test]
fn nine_oclock_standup_with_the_team() {
    let mut w = demo_office(3);
    run_until(&mut w, 0, hm(9, 12));
    let standups: Vec<_> = w
        .meetings
        .values()
        .filter(|m| m.kind == MeetingKind::Standup)
        .collect();
    assert_eq!(standups.len(), 1, "one standup per active project");
    let m = standups[0];
    assert_eq!(m.project, Some(DEMO_PROJECT));
    assert_eq!(w.building.rooms[&m.room].kind, RoomKind::MeetingRoom);
    let team: BTreeSet<StaffId> = w.project_team(DEMO_PROJECT).into_keys().collect();
    assert_eq!(team.len(), 9);
    assert!(team.is_subset(&m.attendees));
    // the strategist pitches; the CFO and Secretary are not in it
    assert!(m.attendees.contains(&StaffId(9)));
    assert!(!m.attendees.contains(&StaffId(7)));
    assert!(!m.attendees.contains(&StaffId(8)));
    let seated = w
        .staff
        .values()
        .filter(|s| matches!(s.spot, Some(Spot::MeetingSeat { meeting, .. }) if meeting == m.id))
        .count();
    assert!(seated >= 8, "seated {seated}");
    // nobody outside the attendee list walks in
    for s in w.staff.values() {
        if s.activity == Activity::InMeeting {
            assert!(m.attendees.contains(&s.id));
        }
    }
}

#[test]
fn two_projects_hold_two_standups() {
    let mut w = demo_office(3);
    let p2 = w.add_project("amalfi", "Amalfi", "amalfi.travel", ProjectStatus::Active);
    for (staff, pct) in [(2, 40), (12, 30)] {
        w.apply(Command::AssignToProject {
            staff: StaffId(staff),
            project: DEMO_PROJECT,
            allocation_pct: 100 - pct,
        })
        .unwrap();
        w.apply(Command::AssignToProject {
            staff: StaffId(staff),
            project: p2,
            allocation_pct: pct,
        })
        .unwrap();
    }
    run_until(&mut w, 0, hm(9, 5));
    let mut standups: Vec<_> = w
        .meetings
        .values()
        .filter(|m| m.kind == MeetingKind::Standup)
        .collect();
    standups.sort_by_key(|m| m.project);
    assert_eq!(standups.len(), 2);
    assert_ne!(standups[0].room, standups[1].room);
    assert_eq!(
        w.building.rooms[&standups[1].room].kind,
        RoomKind::StrategyRoom
    );
    assert!(standups[1].attendees.contains(&StaffId(2)));
    assert_eq!(
        w.project_members_with_role(p2, Role::Writer),
        vec![StaffId(2)]
    );
    assert_eq!(
        w.missing_roles(p2),
        vec![Role::Editor, Role::Photographer, Role::WebDeveloper]
    );
}

#[test]
fn month_close_after_thirty_days() {
    let mut w = fast(5);
    run_days(&mut w, 30);
    assert_eq!(w.finance.closes.len(), 1);
    assert_eq!(w.finance.month, 2);
    let close = &w.finance.closes[0];
    assert_eq!((close.month, close.first_day, close.last_day), (1, 0, 29));
    assert!(close.books_kept);
    assert_eq!(close.projects.len(), 1);
    let p = &close.projects[0];
    assert_eq!(p.project, DEMO_PROJECT);
    assert_eq!(p.budget_cents, 8_000_000);
    // (the 1-minute test day inflates overtime: walking takes game hours)
    assert!(p.spent_cents > 6_000_000, "{}", p.spent_cents);
    assert_eq!(p.spent_cents, p.breakdown.spent());
    assert_eq!(p.over_budget, p.spent_cents * 1000 > p.budget_cents * 1100);
    assert!(p.breakdown.salaries > 0 && p.breakdown.rent > 0 && p.breakdown.upkeep > 0);
    assert_eq!(p.revenue_cents, 0, "revenue is still the loud stub");
    // company P&L = projects + overhead
    let mut sum = close.overhead;
    sum.add(&p.breakdown);
    assert_eq!(sum, close.company);
    assert!(
        close.overhead.salaries > 0,
        "CFO, Secretary, strategist, data scientist"
    );
    assert!(close.runway_days.is_some());
    // month 2 starts empty
    assert_eq!(
        w.projects[&DEMO_PROJECT].ledger.month,
        CostBreakdown::default()
    );
    run_days(&mut w, 30);
    assert_eq!(w.finance.closes.len(), 2);
    assert_eq!(w.finance.closes[1].first_day, 30);
}

/// Guard for the MVP's first week (docs/design/mvp-pipeline.md section 7,
/// track W): the owner's company earns nothing in the sim yet, so a week of
/// play must not bury the Inbox under CFO alerts. On the real clock, with the
/// starting company untouched: seven game days, no revenue, and no financial
/// ticket of any kind. The design computed about 59 days of runway from the
/// constants; the measured figure is printed and bounded here.
#[test]
fn a_week_without_revenue_raises_no_finance_tickets() {
    let mut w = demo_office(1);
    assert!(w.exec.cfo.is_some(), "the CFO watches (no CFO, no alerts)");
    let at_start = w.runway_days().expect("the company burns cash");
    for day in 1..=7u32 {
        run_days(&mut w, 1);
        let financial: Vec<_> = w
            .tickets
            .values()
            .filter(|t| t.kind.is_financial())
            .map(|t| (t.id, t.kind))
            .collect();
        assert!(financial.is_empty(), "day {day}: {financial:?}");
        assert!(!w.project_over_budget(DEMO_PROJECT), "day {day}");
    }
    assert_eq!(w.clock().day, 7);
    let revenue = w
        .ledger
        .totals
        .get(&sim_core::economy::LedgerKind::Revenue)
        .copied()
        .unwrap_or(0);
    assert_eq!(revenue, 0, "no revenue in the sim yet");
    assert!(w.company.cash > 0);
    assert_eq!(w.company.loan, None);
    let after = w.runway_days().expect("still burning");
    println!(
        "runway: {at_start} days at the start, {after} days after a week; cash {} cents, burn {} cents a day",
        w.company.cash,
        w.daily_burn_cents()
    );
    // well clear of the 30-day alert for the whole week
    assert!(at_start > 40, "{at_start}");
    assert!(after > 40, "{after}");
    // the tickets that did come are the standups nobody answered
    assert!(w
        .tickets
        .values()
        .all(|t| t.kind == TicketKind::StandupFailed));
    assert_eq!(tickets_of(&w, TicketKind::StandupFailed).len(), 7);
}

#[test]
fn firing_the_photographer_opens_a_missing_role_ticket() {
    let mut w = demo_office(2);
    run_until(&mut w, 0, hm(10, 0));
    w.apply(Command::Fire { staff: StaffId(6) }).unwrap();
    assert_eq!(w.missing_roles(DEMO_PROJECT), vec![Role::Photographer]);
    let t = tickets_of(&w, TicketKind::MissingRole);
    assert_eq!(t.len(), 1);
    let t = t[0];
    assert_eq!(t.project, Some(DEMO_PROJECT));
    assert_eq!(t.role, Some(Role::Photographer));
    assert_eq!(t.priority, Priority::Medium);
    assert!(t.routed_via_secretary);
    assert!(t.is_open(), "Low delegation does not cover Medium");
    assert_eq!(t.from, Some(StaffId(4)), "raised by the project lead");
    // the work router now has no photographer for the project
    assert!(w
        .project_members_with_role(DEMO_PROJECT, Role::Photographer)
        .is_empty());
    // no duplicate on the nightly check
    run_days(&mut w, 1);
    assert_eq!(tickets_of(&w, TicketKind::MissingRole).len(), 1);
    // arrange hiring: a photographer appears on the shortlist
    let id = tickets_of(&w, TicketKind::MissingRole)[0].id;
    w.apply(Command::AnswerTicket {
        ticket: id,
        option: TicketOption::ArrangeHiring,
    })
    .unwrap();
    let cand = w
        .candidates
        .values()
        .find(|c| c.role == Role::Photographer)
        .expect("a photographer candidate")
        .id;
    w.apply(Command::Hire { candidate: cand }).unwrap();
    let hired = *w.staff.keys().last().unwrap();
    w.apply(Command::AssignToProject {
        staff: hired,
        project: DEMO_PROJECT,
        allocation_pct: 100,
    })
    .unwrap();
    assert!(w.missing_roles(DEMO_PROJECT).is_empty());
}

#[test]
fn delegation_low_answers_low_tickets_but_never_high() {
    let mut w = demo_office(4);
    assert_eq!(w.exec.delegation, DelegationPolicy::Low);
    // a hire: the CFO's affordability note is Low and below the threshold
    let cand = *w.candidates.keys().next().unwrap();
    w.apply(Command::Hire { candidate: cand }).unwrap();
    let note = tickets_of(&w, TicketKind::HireAffordability)[0].clone();
    assert_eq!(note.priority, Priority::Low);
    assert_eq!(note.status, TicketStatus::Answered);
    assert_eq!(note.resolved_by, Some(ResolvedBy::Secretary));
    assert_eq!(note.answer, Some(note.default_option));
    // a High ticket stays with the CEO under every policy
    let high = w.raise_ticket(TicketSpec {
        kind: TicketKind::Escalation,
        project: Some(DEMO_PROJECT),
        from: Some(StaffId(5)),
        role: None,
        amount_cents: 0,
        work_item: None,
    });
    w.apply(Command::SetDelegation {
        policy: DelegationPolicy::LowAndMedium,
    })
    .unwrap();
    assert!(w.tickets[&high].is_open());
    assert!(w.tickets[&high].routed_via_secretary);
    // financial over the threshold stays too, even when Low
    let big = w.raise_ticket(TicketSpec {
        kind: TicketKind::HireAffordability,
        project: None,
        from: Some(StaffId(7)),
        role: Some(Role::Writer),
        amount_cents: 2_000_000,
        work_item: None,
    });
    assert!(w.tickets[&big].is_open());
    // Off: the CEO answers everything
    w.apply(Command::SetDelegation {
        policy: DelegationPolicy::Off,
    })
    .unwrap();
    let low = w.raise_ticket(TicketSpec {
        kind: TicketKind::HireAffordability,
        project: None,
        from: Some(StaffId(7)),
        role: Some(Role::Writer),
        amount_cents: 100_000,
        work_item: None,
    });
    assert!(w.tickets[&low].is_open());
    w.apply(Command::AnswerTicket {
        ticket: low,
        option: TicketOption::Acknowledge,
    })
    .unwrap();
    assert_eq!(w.tickets[&low].resolved_by, Some(ResolvedBy::Ceo));
    // the High one resolves by default at its deadline
    let deadline = w.tickets[&high].deadline_step;
    while w.step <= deadline {
        w.step();
    }
    let t = &w.tickets[&high];
    assert_eq!(t.status, TicketStatus::Expired);
    assert_eq!(t.resolved_by, Some(ResolvedBy::Default));
    assert_eq!(t.answer, Some(TicketOption::Kill));
}

#[test]
fn without_a_secretary_tickets_are_untriaged_and_delegation_is_off() {
    let mut w = demo_office(4);
    w.apply(Command::Fire { staff: StaffId(8) }).unwrap();
    assert_eq!(w.secretary(), None);
    let cand = *w.candidates.keys().next().unwrap();
    w.apply(Command::Hire { candidate: cand }).unwrap();
    let note = tickets_of(&w, TicketKind::HireAffordability)[0];
    assert!(!note.routed_via_secretary);
    assert_eq!(note.priority, Priority::Low, "priority by rule");
    assert!(note.is_open(), "nobody answers for the CEO");
    assert_eq!(
        w.apply(Command::Delegate {
            task: SecretaryTaskKind::TriageInbox
        }),
        Err(Reject::NoSecretary)
    );
    run_until(&mut w, 0, hm(9, 0));
    assert!(w.secretary_tasks.is_empty(), "no 08:30 briefing");
}

#[test]
fn secretary_prepares_the_briefing_and_runs_delegated_tasks() {
    let mut w = demo_office(4);
    run_until(&mut w, 0, hm(8, 35));
    let brief = w
        .secretary_tasks
        .values()
        .find(|t| t.kind.slug() == "prepare-briefing")
        .expect("08:30 briefing");
    assert_eq!(brief.status, TaskStatus::Working);
    run_until(&mut w, 0, hm(9, 10));
    assert_eq!(w.exec.briefings_prepared, 1);
    w.apply(Command::Delegate {
        task: SecretaryTaskKind::ScheduleMeeting {
            attendees: vec![StaffId(4), StaffId(9), StaffId(13)],
            project: Some(DEMO_PROJECT),
        },
    })
    .unwrap();
    w.apply(Command::Delegate {
        task: SecretaryTaskKind::FollowUp {
            staff: StaffId(3),
            topic: sim_core::inbox::FollowUpTopic::Morale,
        },
    })
    .unwrap();
    run_until(&mut w, 0, hm(10, 15));
    let scheduled: Vec<_> = w
        .meetings
        .values()
        .filter(|m| m.kind == MeetingKind::Scheduled)
        .collect();
    assert_eq!(scheduled.len(), 1);
    assert!(scheduled[0].start >= hm(10, 0));
    assert_eq!(w.pending_tasks(), 0);
    // the meeting happens with exactly its attendees
    let id = scheduled[0].id;
    let start = scheduled[0].start;
    run_until(&mut w, 0, start + 10);
    let present: BTreeSet<StaffId> = w
        .staff
        .values()
        .filter(|s| matches!(s.spot, Some(Spot::MeetingSeat { meeting, .. }) if meeting == id))
        .map(|s| s.id)
        .collect();
    assert!(!present.is_empty());
    assert!(present.is_subset(&[StaffId(4), StaffId(9), StaffId(13)].into_iter().collect()));
}

#[test]
fn no_cfo_means_no_alerts_and_unkept_books() {
    let over_budget = |fire_cfo: bool| {
        let mut w = fast(6);
        if fire_cfo {
            w.apply(Command::Fire { staff: StaffId(7) }).unwrap();
        }
        w.apply(Command::SetProjectBudget {
            project: DEMO_PROJECT,
            monthly_cents: 100_000,
        })
        .unwrap();
        run_days(&mut w, 5);
        w
    };
    let blind = over_budget(true);
    assert!(!blind.books_kept());
    assert!(
        blind.project_over_budget(DEMO_PROJECT),
        "the books still balance"
    );
    assert!(tickets_of(&blind, TicketKind::BudgetOverrun).is_empty());
    assert!(blind.tickets.values().all(|t| !t.kind.is_financial()));
    let kept = over_budget(false);
    assert!(kept.books_kept());
    let alerts = tickets_of(&kept, TicketKind::BudgetOverrun);
    assert_eq!(alerts.len(), 1, "one alert per project per month");
    assert_eq!(alerts[0].priority, Priority::High);
    assert_eq!(alerts[0].from, Some(StaffId(7)));
    assert!(alerts[0].amount_cents > 0);
}

#[test]
fn approving_an_overrun_raises_the_budget() {
    let mut w = fast(6);
    w.apply(Command::SetProjectBudget {
        project: DEMO_PROJECT,
        monthly_cents: 100_000,
    })
    .unwrap();
    run_days(&mut w, 3);
    let t = tickets_of(&w, TicketKind::BudgetOverrun)[0].id;
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::ApproveOverrun,
    })
    .unwrap();
    assert_eq!(w.projects[&DEMO_PROJECT].budget_monthly_cents, 120_000);
}

#[test]
fn runway_and_loans() {
    let mut w = fast(7);
    w.company.cash = 2_000_000; // €20k: about a week
    w.ledger.opening_cash = w.company.cash - w.ledger.total();
    run_days(&mut w, 1);
    assert!(w.runway_days().unwrap() < 30);
    assert_eq!(tickets_of(&w, TicketKind::RunwayLow).len(), 1);
    run_days(&mut w, 8);
    assert!(w.company.cash < 0);
    let offer = tickets_of(&w, TicketKind::LoanOffer)
        .into_iter()
        .find(|t| t.is_open())
        .expect("loan offer")
        .clone();
    assert!(offer.amount_cents >= -w.company.cash);
    let cash = w.company.cash;
    w.apply(Command::AnswerTicket {
        ticket: offer.id,
        option: TicketOption::TakeLoan,
    })
    .unwrap();
    assert_eq!(w.company.cash, cash + offer.amount_cents);
    assert!(w.company.loan.is_some());
    run_days(&mut w, 1);
    assert!(
        w.ledger.history.last().unwrap().loan > 0,
        "instalments at settlement"
    );
    assert_eq!(w.ledger.opening_cash + w.ledger.total(), w.company.cash);
}

#[test]
fn payroll_spike_on_an_expensive_hire() {
    let mut w = demo_office(8);
    let cand = *w.candidates.keys().next().unwrap();
    w.candidates.get_mut(&cand).unwrap().salary = 100_000; // €1 000 a day
    w.apply(Command::Hire { candidate: cand }).unwrap();
    let spike = tickets_of(&w, TicketKind::PayrollSpike);
    assert_eq!(spike.len(), 1);
    assert_eq!(spike[0].amount_cents, 3_000_000);
    // HireAffordability for €30k a month is over the threshold: stays open
    assert!(tickets_of(&w, TicketKind::HireAffordability)[0].is_open());
}

#[test]
fn project_lifecycle() {
    let mut w = demo_office(9);
    w.apply(Command::CreateProject {
        slug: "amalfi-dispatch".into(),
        name: "Amalfi Dispatch".into(),
        domain: "amalfi.travel".into(),
    })
    .unwrap();
    let p2 = ProjectId(2);
    assert_eq!(w.projects[&p2].status, ProjectStatus::Proposed);
    assert_eq!(w.projects[&p2].repo, "swarmpress/amalfi.travel");
    let proposal = tickets_of(&w, TicketKind::ProjectProposal)[0].clone();
    assert_eq!(proposal.project, Some(p2));
    assert_eq!(proposal.from, Some(StaffId(9)), "Strategy proposes");
    // no standup for a proposal
    run_until(&mut w, 0, hm(9, 5));
    assert_eq!(
        w.meetings
            .values()
            .filter(|m| m.kind == MeetingKind::Standup)
            .count(),
        1
    );
    w.apply(Command::AnswerTicket {
        ticket: proposal.id,
        option: TicketOption::Approve,
    })
    .unwrap();
    assert_eq!(w.projects[&p2].status, ProjectStatus::Active);
    // an empty team: every required role is missing, one ticket each
    assert_eq!(tickets_of(&w, TicketKind::MissingRole).len(), 5);
    w.apply(Command::AssignToProject {
        staff: StaffId(1),
        project: DEMO_PROJECT,
        allocation_pct: 50,
    })
    .unwrap();
    w.apply(Command::AssignToProject {
        staff: StaffId(1),
        project: p2,
        allocation_pct: 50,
    })
    .unwrap();
    w.apply(Command::SetProjectLead {
        project: p2,
        staff: StaffId(1),
    })
    .unwrap();
    w.apply(Command::SetProjectStatus {
        project: p2,
        status: ProjectStatus::Paused,
    })
    .unwrap();
    w.apply(Command::SetProjectStatus {
        project: p2,
        status: ProjectStatus::Archived,
    })
    .unwrap();
    assert_eq!(
        w.staff[&StaffId(1)].allocation(p2),
        0,
        "archiving releases the team"
    );
    assert_eq!(w.projects[&p2].lead, None);
    // the slot is free again
    assert_eq!(w.open_projects(), 1);
}

#[test]
fn people_commands() {
    let mut w = demo_office(10);
    let before = w.staff[&StaffId(12)].clone();
    w.apply(Command::Promote { staff: StaffId(12) }).unwrap();
    let after = &w.staff[&StaffId(12)];
    assert_eq!(after.salary, before.salary * 115 / 100);
    assert!(after.morale > before.morale);
    let m = w.staff[&StaffId(1)].morale;
    w.apply(Command::SetSalary {
        staff: StaffId(1),
        cents_per_day: 7_000,
    })
    .unwrap();
    assert!(w.staff[&StaffId(1)].morale < m, "a pay cut hurts");
    for _ in 0..3 {
        w.apply(Command::Praise { staff: StaffId(2) }).unwrap();
    }
    assert!(w.apply(Command::Praise { staff: StaffId(2) }).is_err());
    let day = w.clock().day;
    while w.clock().day == day {
        w.step();
    }
    assert!(
        w.apply(Command::Praise { staff: StaffId(2) }).is_ok(),
        "resets at 00:00"
    );
}

#[test]
fn analytics_signals_move_audience_and_goal_deterministically() {
    let run = || {
        let mut w = demo_office(12);
        run_days(&mut w, 2);
        for day in 0..2 {
            w.apply_server(ServerCommand::AnalyticsSignals {
                project: DEMO_PROJECT,
                day,
                sessions: 2_000,
                visitors: 1_500,
                pageviews: 5_000,
                engagement_pm: 620,
                top_pages_digest: 0xabc,
            })
            .unwrap();
        }
        w
    };
    let w = run();
    let p = &w.projects[&DEMO_PROJECT];
    assert!(p.analytics.connected());
    // 30% of 3 000 weekly visitors (the sim's own estimate is still 0)
    assert_eq!(p.kpis.audience, 900);
    // 3 000 of a 40 000 monthly-reader goal
    assert_eq!(p.kpis.goal_progress_pm, 75);
    // revenue estimate: 10 000 views × €4 CPM, reported, never booked
    assert_eq!(p.ledger.revenue_estimate_month, 4_000);
    assert_eq!(p.ledger.month.revenue, 0);
    assert_eq!(w.hash(), run().hash());
    // a new signal changes the numbers
    let mut w2 = run();
    w2.apply_server(ServerCommand::AnalyticsSignals {
        project: DEMO_PROJECT,
        day: 2,
        sessions: 4_000,
        visitors: 3_000,
        pageviews: 9_000,
        engagement_pm: 700,
        top_pages_digest: 0xdef,
    })
    .unwrap();
    assert_eq!(w2.projects[&DEMO_PROJECT].kpis.audience, 1_800);
    assert_ne!(w2.hash(), w.hash());
}

#[test]
fn kpi_review_needs_a_data_scientist() {
    let mut with = demo_office(13);
    run_until(&mut with, 0, hm(9, 40));
    let kpi: Vec<_> = with
        .meetings
        .values()
        .filter(|m| m.kind == MeetingKind::KpiReview)
        .collect();
    assert_eq!(kpi.len(), 1, "Monday 09:30");
    assert!(kpi[0].attendees.contains(&StaffId(13)));
    assert!(kpi[0].attendees.contains(&StaffId(7)) && kpi[0].attendees.contains(&StaffId(8)));
    // only on Mondays
    run_until(&mut with, 1, hm(9, 40));
    assert!(with
        .meetings
        .values()
        .all(|m| m.kind != MeetingKind::KpiReview));

    let mut without = demo_office(13);
    without.apply(Command::Fire { staff: StaffId(13) }).unwrap();
    run_until(&mut without, 0, hm(9, 40));
    assert!(without
        .meetings
        .values()
        .all(|m| m.kind != MeetingKind::KpiReview));
}

#[test]
fn friday_finance_review_with_the_cfo() {
    let mut w = fast(14);
    run_until(&mut w, 4, hm(16, 10));
    let fin: Vec<_> = w
        .meetings
        .values()
        .filter(|m| m.kind == MeetingKind::FinanceReview)
        .collect();
    assert_eq!(fin.len(), 1);
    assert_eq!(w.building.rooms[&fin[0].room].kind, RoomKind::FinanceOffice);
    assert_eq!(
        fin[0].attendees,
        [StaffId(7), StaffId(8)]
            .into_iter()
            .collect::<BTreeSet<_>>()
    );
    let mut blind = fast(14);
    blind.apply(Command::Fire { staff: StaffId(7) }).unwrap();
    run_until(&mut blind, 4, hm(16, 10));
    assert!(blind
        .meetings
        .values()
        .all(|m| m.kind != MeetingKind::FinanceReview));
}

#[test]
fn hiring_a_cfo_fills_the_slot_once() {
    let mut w = demo_office(15);
    w.apply(Command::Fire { staff: StaffId(7) }).unwrap();
    assert!(!w.books_kept());
    w.add_candidate_for_role(Role::Cfo);
    let cand = w
        .candidates
        .values()
        .find(|c| c.role == Role::Cfo)
        .unwrap()
        .id;
    w.apply(Command::Hire { candidate: cand }).unwrap();
    let cfo = w.cfo().expect("new CFO");
    assert_eq!(w.staff[&cfo].role, Role::Cfo);
    w.add_candidate_for_role(Role::Cfo);
    let second = w
        .candidates
        .values()
        .find(|c| c.role == Role::Cfo)
        .unwrap()
        .id;
    assert!(matches!(
        w.apply(Command::Hire { candidate: second }),
        Err(Reject::Occupied(_))
    ));
    // a desk for the new CFO came from the spares
    assert!(w.staff[&cfo].home_desk.is_some());
    assert!(w
        .building
        .equipment
        .values()
        .any(|e| e.kind == EquipmentKind::Desk));
}
