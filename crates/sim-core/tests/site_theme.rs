//! The site's theme from its design in the sim (ADR-0093, FEAT-115): a design version
//! (`DesignReceived`, a number only) makes a `SiteTheme` item the web designer drafts (or
//! that waits for one, with a MissingRole ticket); its result is a digest; the theme always
//! waits for the CEO's `ThemeApproval` (the Secretary never answers it; its default,
//! Reject, keeps the current theme); Approve starts the Publish job that merges it, and the
//! version becomes the live theme; a newer design supersedes an older one in the works; the
//! same inputs give the same world.

use sim_core::clock::SimConfig;
use sim_core::commands::{Command, JobDigest, JobFailure, ServerCommand};
use sim_core::ids::{StaffId, TicketId, WorkItemId};
use sim_core::inbox::{
    DelegationPolicy, Priority, ResolvedBy, TicketKind, TicketOption, TicketStatus,
};
use sim_core::plan::{Effect, JobKind, WorkItemKind, WorkItemStatus};
use sim_core::roles::Role;
use sim_core::scenarios::{demo_office_with_config, hire_web_designer};
use sim_core::{Reject, World};

fn world(designer: bool) -> World {
    let mut w = demo_office_with_config(
        11,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    );
    if designer {
        hire_web_designer(&mut w);
    }
    w.drain_effects();
    w
}

type Req = (u64, JobKind, Option<WorkItemId>, Option<u64>, Vec<StaffId>);

fn reqs(w: &mut World) -> Vec<Req> {
    w.drain_effects()
        .into_iter()
        .map(|e| match e {
            Effect::RequestJob {
                job_id,
                kind,
                work_item,
                brief_ref,
                staff,
                ..
            } => (job_id, kind, work_item, brief_ref, staff),
        })
        .collect()
}

fn until(w: &mut World, kind: JobKind, item: WorkItemId) -> Req {
    for _ in 0..20_000 {
        if let Some(r) = reqs(w)
            .into_iter()
            .find(|r| r.1 == kind && r.2 == Some(item))
        {
            return r;
        }
        w.step();
    }
    panic!("no {kind:?} job for {item}");
}

fn digest(ok: bool) -> JobDigest {
    JobDigest {
        ok,
        score: 9,
        words: 12,
        qa_defects: 1,
        artifact_sha: [7; 16],
    }
}

fn steps_until(w: &mut World, f: impl Fn(&World) -> bool) {
    for _ in 0..40_000 {
        if f(w) {
            return;
        }
        w.step();
    }
    panic!("condition never held");
}

fn open_ticket(w: &World, kind: TicketKind, item: WorkItemId) -> Option<TicketId> {
    w.tickets
        .values()
        .find(|t| t.is_open() && t.kind == kind && t.work_item == Some(item))
        .map(|t| t.id)
}

fn theme_item(w: &World) -> WorkItemId {
    w.open_site_theme().expect("a theme in the works")
}

/// A design version received and its theme drafted; returns the item.
fn drafted(w: &mut World, version: u32) -> WorkItemId {
    w.apply_server(ServerCommand::DesignReceived { version })
        .unwrap();
    let item = theme_item(w);
    let (job, kind, on, brief, staff) = until(w, JobKind::SiteTheme, item);
    assert_eq!((kind, on), (JobKind::SiteTheme, Some(item)));
    assert_eq!(
        brief,
        Some(u64::from(version)),
        "the job names the design version"
    );
    assert_eq!(staff, vec![w.web_designer().unwrap()]);
    w.apply_server(ServerCommand::JobCompleted {
        job_id: job,
        digest: digest(true),
    })
    .unwrap();
    item
}

#[test]
fn a_design_is_drafted_approved_and_merged() {
    let mut w = world(true);
    let item = drafted(&mut w, 1);
    assert_eq!(w.plan.items[&item].kind, WorkItemKind::SiteTheme);
    assert_eq!(w.plan.designs.latest, 1);
    // The gate: always the CEO's ticket, whatever the autonomy policy.
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::ThemeApproval, item).is_some()
    });
    let t = &w.tickets[&open_ticket(&w, TicketKind::ThemeApproval, item).unwrap()];
    assert_eq!(t.options, vec![TicketOption::Approve, TicketOption::Reject]);
    assert_eq!(t.default_option, TicketOption::Reject);
    assert_eq!(t.priority, Priority::High);
    assert!(TicketKind::ThemeApproval.ceo_only());
    assert!(!w.secretary_may_answer(t));
    assert_eq!(
        t.deadline_step - t.created_step,
        3 * w.config.steps_per_day()
    );
    assert!(w.plan.items[&item].awaiting_approval());
    assert_eq!(w.plan.items[&item].last_score, None);
    assert_eq!(w.plan.items[&item].phases[0].result.unwrap().qa_defects, 1);
    // A theme does not take an article's place in the WIP limit.
    let project = w.plan.items[&item].project;
    assert!(w.open_items(project) <= sim_core::plan::WIP_LIMIT);

    // Approve: the Publish job merges the branch; then the version is live.
    let ticket = open_ticket(&w, TicketKind::ThemeApproval, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket,
        option: TicketOption::Approve,
    })
    .unwrap();
    let (publish, _, _, brief, staff) = until(&mut w, JobKind::Publish, item);
    assert_eq!(brief, Some(1));
    assert_eq!(staff, vec![w.web_designer().unwrap()]);
    w.apply_server(ServerCommand::JobCompleted {
        job_id: publish,
        digest: digest(true),
    })
    .unwrap();
    steps_until(&mut w, |w| w.plan.items[&item].status.is_closed());
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
    assert_eq!(w.plan.designs.live, 1);
}

#[test]
fn reject_and_the_default_keep_the_current_theme() {
    let mut w = world(true);
    let item = drafted(&mut w, 1);
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::ThemeApproval, item).is_some()
    });
    let ticket = open_ticket(&w, TicketKind::ThemeApproval, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket,
        option: TicketOption::Reject,
    })
    .unwrap();
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Cancelled);
    assert!(w.plan.jobs.values().all(|j| j.work_item != Some(item)));
    assert_eq!(w.plan.designs.live, 0);

    // The next version, unanswered: the default (Reject) at the deadline.
    let item = drafted(&mut w, 2);
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::ThemeApproval, item).is_some()
    });
    let ticket = open_ticket(&w, TicketKind::ThemeApproval, item).unwrap();
    steps_until(&mut w, |w| !w.tickets[&ticket].is_open());
    let t = &w.tickets[&ticket];
    assert_eq!(t.status, TicketStatus::Expired);
    assert_eq!(t.resolved_by, Some(ResolvedBy::Default));
    assert_eq!(t.answer, Some(TicketOption::Reject));
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Cancelled);
    assert_eq!(w.plan.designs.live, 0);
    assert_eq!(w.plan.designs.latest, 2);
}

#[test]
fn the_secretary_never_answers_it() {
    let mut w = world(true);
    w.apply(Command::SetDelegation {
        policy: DelegationPolicy::LowAndMedium,
    })
    .unwrap();
    let item = drafted(&mut w, 1);
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::ThemeApproval, item).is_some()
    });
    let ticket = open_ticket(&w, TicketKind::ThemeApproval, item).unwrap();
    for _ in 0..200 {
        w.step();
    }
    assert!(w.tickets[&ticket].is_open());
    assert_ne!(w.tickets[&ticket].resolved_by, Some(ResolvedBy::Secretary));
}

#[test]
fn without_a_web_designer_the_theme_waits_and_the_ceo_is_asked_to_hire() {
    let mut w = world(false);
    w.apply_server(ServerCommand::DesignReceived { version: 1 })
        .unwrap();
    let item = theme_item(&w);
    assert!(w.plan.items[&item].is_unstarted());
    assert!(w.plan.jobs.values().all(|j| j.work_item != Some(item)));
    assert!(w.tickets.values().any(|t| t.is_open()
        && t.kind == TicketKind::MissingRole
        && t.role == Some(Role::WebDesigner)));
    w.step();
    hire_web_designer(&mut w);
    let (_, kind, ..) = until(&mut w, JobKind::SiteTheme, item);
    assert_eq!(kind, JobKind::SiteTheme);
    assert_eq!(w.plan.items[&item].owner, w.web_designer());
}

#[test]
fn a_newer_design_supersedes_the_theme_in_the_works() {
    let mut w = world(true);
    let first = drafted(&mut w, 1);
    steps_until(&mut w, |w| {
        open_ticket(w, TicketKind::ThemeApproval, first).is_some()
    });
    let ticket = open_ticket(&w, TicketKind::ThemeApproval, first).unwrap();
    w.apply_server(ServerCommand::DesignReceived { version: 3 })
        .unwrap();
    assert_eq!(w.plan.items[&first].status, WorkItemStatus::Cancelled);
    assert!(
        !w.tickets[&ticket].is_open(),
        "the old theme's question goes with it"
    );
    let second = theme_item(&w);
    assert_ne!(second, first);
    assert_eq!(w.design_version_of(second), Some(3));
}

#[test]
fn versions_only_go_forward() {
    let mut w = world(true);
    let refused = |w: &mut World, v: u32| {
        matches!(
            w.apply_server(ServerCommand::DesignReceived { version: v }),
            Err(Reject::Invalid(_))
        )
    };
    assert!(refused(&mut w, 0));
    w.apply_server(ServerCommand::DesignReceived { version: 4 })
        .unwrap();
    assert!(refused(&mut w, 4));
    assert!(refused(&mut w, 2));
    assert!(refused(&mut w, sim_core::site_theme::MAX_DESIGN_VERSION));
}

#[test]
fn a_failed_theme_is_blocked_with_an_escalation() {
    let mut w = world(true);
    w.apply_server(ServerCommand::DesignReceived { version: 1 })
        .unwrap();
    let item = theme_item(&w);
    let (job, ..) = until(&mut w, JobKind::SiteTheme, item);
    w.apply_server(ServerCommand::JobFailed {
        job_id: job,
        reason: JobFailure::InvalidOutput,
    })
    .unwrap();
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Blocked);
    let t = open_ticket(&w, TicketKind::Escalation, item).unwrap();
    assert_eq!(w.tickets[&t].default_option, TicketOption::Retry);
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::Retry,
    })
    .unwrap();
    let (again, kind, ..) = until(&mut w, JobKind::SiteTheme, item);
    assert_eq!(kind, JobKind::SiteTheme);
    assert_ne!(again, job);
}

#[test]
fn the_same_inputs_give_the_same_world() {
    let run = || {
        let mut w = world(true);
        let item = drafted(&mut w, 1);
        steps_until(&mut w, |w| {
            open_ticket(w, TicketKind::ThemeApproval, item).is_some()
        });
        let ticket = open_ticket(&w, TicketKind::ThemeApproval, item).unwrap();
        w.apply(Command::AnswerTicket {
            ticket,
            option: TicketOption::Approve,
        })
        .unwrap();
        for _ in 0..500 {
            w.step();
        }
        w.hash()
    };
    assert_eq!(run(), run());
}
