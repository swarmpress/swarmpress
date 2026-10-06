//! The site's structure and tools in the sim (ADR-0072, FEAT-090, FEAT-091,
//! FEAT-095): a commissioned structure item is drafted by its architect,
//! always waits for the CEO's StructureApproval (whatever the autonomy
//! policy, the default never applies), is applied by its Publish and is then
//! Published without a deploy; tools run on demand and on their schedule,
//! by the member of their agent step's role; the blueprint's digest reaches
//! the render state.

use sim_core::clock::SimConfig;
use sim_core::commands::{AutonomyPolicy, Command, JobDigest, Policy, ServerCommand};
use sim_core::ids::{ProjectId, StaffId, WorkItemId};
use sim_core::inbox::{TicketKind, TicketOption};
use sim_core::plan::{Effect, JobKind, WorkItemKind, WorkItemStatus};
use sim_core::projects::ProjectStatus;
use sim_core::roles::Role;
use sim_core::scenarios::demo_office_with_config;
use sim_core::structure::ToolStub;
use sim_core::World;

const UX: StaffId = StaffId(3);
/// The demo office's web developer.
const WEBDEV: StaffId = StaffId(10);

fn world() -> World {
    let mut w = demo_office_with_config(
        7,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    );
    w.staff.get_mut(&UX).unwrap().role = Role::UxDesigner;
    // Even a fully autonomous company asks the CEO about structure.
    w.apply(Command::SetPolicy(Policy::Autonomy(
        AutonomyPolicy::Autonomous,
    )))
    .unwrap();
    w
}

fn project(w: &World) -> ProjectId {
    w.projects
        .values()
        .find(|p| p.status == ProjectStatus::Active)
        .unwrap()
        .id
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

fn until(w: &mut World, kind: JobKind) -> Req {
    for _ in 0..20_000 {
        if let Some(r) = reqs(w).into_iter().find(|r| r.1 == kind) {
            return r;
        }
        w.step();
    }
    panic!("no {kind:?} job");
}

fn done(w: &mut World, job: u64, ok: bool) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id: job,
        digest: JobDigest {
            ok,
            score: 4,
            words: 0,
            qa_defects: 0,
            artifact_sha: [9; 16],
        },
    })
    .unwrap();
}

fn steps_until(w: &mut World, f: impl Fn(&World) -> bool) {
    for _ in 0..40_000 {
        if f(w) {
            return;
        }
        w.step();
        w.drain_effects();
    }
    panic!("condition never held");
}

fn approval(w: &World, item: WorkItemId) -> Option<sim_core::ids::TicketId> {
    w.tickets
        .values()
        .find(|t| {
            t.is_open() && t.kind == TicketKind::StructureApproval && t.work_item == Some(item)
        })
        .map(|t| t.id)
}

#[test]
fn a_structure_item_is_drafted_approved_by_the_ceo_and_applied() {
    let mut w = world();
    let p = project(&w);
    w.apply(Command::Commission {
        project: p,
        kind: WorkItemKind::Structure,
        brief_ref: 41,
    })
    .unwrap();
    let (draft, kind, item, brief, staff) = until(&mut w, JobKind::Architect);
    assert_eq!(kind, JobKind::Architect);
    assert_eq!(brief, Some(41));
    assert_eq!(staff, vec![UX]);
    let item = item.unwrap();
    assert_eq!(w.plan.items[&item].kind, WorkItemKind::Structure);
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::InProgress);

    done(&mut w, draft, true);
    steps_until(&mut w, |w| approval(w, item).is_some());
    let i = &w.plan.items[&item];
    assert_eq!(i.status, WorkItemStatus::Approved);
    assert!(i.awaiting_approval());
    // Not the publish gate's ticket; only the CEO answers it.
    assert!(!w
        .tickets
        .values()
        .any(|t| t.is_open() && t.kind == TicketKind::PublishApproval));
    assert!(TicketKind::StructureApproval.ceo_only());
    assert_eq!(
        TicketKind::StructureApproval.default_option(),
        TicketOption::Defer
    );

    let t = approval(&w, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::Approve,
    })
    .unwrap();
    let (publish, kind, on, _, staff) = until(&mut w, JobKind::Publish);
    assert_eq!((kind, on, staff), (JobKind::Publish, Some(item), vec![UX]));
    done(&mut w, publish, true);
    steps_until(&mut w, |w| {
        w.plan.items[&item].status == WorkItemStatus::Published
    });
    assert!(w.plan.items[&item].published_step.is_some());
}

#[test]
fn deferring_never_applies_and_send_back_restarts_the_draft() {
    let mut w = world();
    let p = project(&w);
    w.apply(Command::Commission {
        project: p,
        kind: WorkItemKind::Tool,
        brief_ref: 7,
    })
    .unwrap();
    let (draft, kind, item, _, staff) = until(&mut w, JobKind::ToolBuild);
    assert_eq!((kind, staff), (JobKind::ToolBuild, vec![WEBDEV]));
    let item = item.unwrap();
    done(&mut w, draft, true);
    steps_until(&mut w, |w| approval(w, item).is_some());
    // Unanswered past its deadline: Defer; the item stays parked, a fresh ticket the next morning.
    let first = approval(&w, item).unwrap();
    steps_until(&mut w, |w| approval(w, item).is_some_and(|t| t != first));
    assert!(w.plan.items[&item].awaiting_approval());
    assert!(!w.plan.jobs.values().any(|j| j.work_item == Some(item)));

    let t = approval(&w, item).unwrap();
    w.apply(Command::AnswerTicket {
        ticket: t,
        option: TicketOption::SendBack,
    })
    .unwrap();
    let (_, kind, on, _, _) = until(&mut w, JobKind::ToolBuild);
    assert_eq!((kind, on), (JobKind::ToolBuild, Some(item)));
    assert_eq!(w.plan.items[&item].revision, 1);
}

#[test]
fn commissions_are_checked() {
    let mut w = world();
    let p = project(&w);
    assert!(w
        .apply(Command::Commission {
            project: p,
            kind: WorkItemKind::Article,
            brief_ref: 1
        })
        .is_err());
    for k in 0..3 {
        w.apply(Command::Commission {
            project: p,
            kind: WorkItemKind::Theme,
            brief_ref: k,
        })
        .unwrap();
    }
    assert!(w
        .apply(Command::Commission {
            project: p,
            kind: WorkItemKind::Structure,
            brief_ref: 9
        })
        .is_err());
    // Nobody to do it: rejected, not stuck.
    let mut w = world();
    for s in w.staff.values_mut() {
        if matches!(
            s.role,
            Role::UxDesigner | Role::Strategist | Role::EditorInChief
        ) {
            s.role = Role::Writer;
        }
    }
    let p = project(&w);
    assert!(w
        .apply(Command::Commission {
            project: p,
            kind: WorkItemKind::Structure,
            brief_ref: 1
        })
        .is_err());
}

#[test]
fn tools_run_on_demand_and_on_schedule_with_their_agent_s_role() {
    let mut w = world();
    let tools = vec![
        ToolStub {
            tool_ref: 0xabc,
            schedule_days: 1,
            role: None,
        },
        ToolStub {
            tool_ref: 0xdef,
            schedule_days: 0,
            role: Some(Role::WebDeveloper),
        },
    ];
    w.apply_server(ServerCommand::ToolsChanged {
        tools: tools.clone(),
    })
    .unwrap();
    assert_eq!(w.plan.structure.tools.len(), 2);
    // Bad lists are refused.
    let twice = vec![tools[0], tools[0]];
    assert!(w
        .apply_server(ServerCommand::ToolsChanged { tools: twice })
        .is_err());
    assert!(w.apply(Command::RunTool { tool_ref: 0x123 }).is_err());
    // A ref is 6 bytes of the tool's hash: a JavaScript number holds it exactly.
    let huge = vec![ToolStub {
        tool_ref: 1 << 48,
        schedule_days: 0,
        role: None,
    }];
    assert!(w
        .apply_server(ServerCommand::ToolsChanged { tools: huge })
        .is_err());

    // On demand: the web developer runs it; a second run waits for the first.
    w.apply(Command::RunTool { tool_ref: 0xdef }).unwrap();
    let (job, kind, item, brief, staff) = until(&mut w, JobKind::ToolRun);
    assert_eq!(
        (kind, item, brief, staff),
        (JobKind::ToolRun, None, Some(0xdef), vec![WEBDEV])
    );
    assert!(w.apply(Command::RunTool { tool_ref: 0xdef }).is_err());
    done(&mut w, job, true);
    let f = w.plan.structure.tools[&0xdef];
    assert_eq!((f.runs, f.failures, f.last_ok), (1, 0, Some(true)));

    // Scheduled: at 06:00, nobody's time.
    let (job, _, _, brief, staff) = until(&mut w, JobKind::ToolRun);
    assert_eq!((brief, staff), (Some(0xabc), vec![]));
    w.apply_server(ServerCommand::JobFailed {
        job_id: job,
        reason: sim_core::commands::JobFailure::Infrastructure,
    })
    .unwrap();
    let f = w.plan.structure.tools[&0xabc];
    assert_eq!((f.runs, f.failures, f.last_ok), (1, 1, Some(false)));
    // Not again the same day; again the next one.
    let day = w.clock().day;
    let (_, _, _, brief, _) = until(&mut w, JobKind::ToolRun);
    assert_eq!(brief, Some(0xabc));
    assert_eq!(w.clock().day, day + 1);

    // Removing a tool drops its pending run; the others keep their counts.
    w.apply_server(ServerCommand::ToolsChanged {
        tools: vec![tools[1]],
    })
    .unwrap();
    assert!(!w.plan.jobs.values().any(|j| j.tool == Some(0xabc)));
    assert_eq!(w.plan.structure.tools[&0xdef].runs, 1);
}

#[test]
fn the_blueprint_s_digest_reaches_the_render_state() {
    let mut w = world();
    assert!(w.render_state().site_model.is_none());
    w.apply_server(ServerCommand::BlueprintChanged {
        hash: [3; 16],
        page_types: 6,
        slots: 18,
        issues: 1,
    })
    .unwrap();
    w.apply_server(ServerCommand::ToolsChanged {
        tools: vec![ToolStub {
            tool_ref: 1,
            schedule_days: 0,
            role: None,
        }],
    })
    .unwrap();
    let m = w.render_state().site_model.unwrap();
    assert_eq!(
        (m.page_types, m.slots, m.issues, m.tools, m.failing_tools),
        (6, 18, 1, 1, 0)
    );
    // A replay of the same log gives the same world.
    let h = w.hash();
    let mut again = world();
    again
        .apply_server(ServerCommand::BlueprintChanged {
            hash: [3; 16],
            page_types: 6,
            slots: 18,
            issues: 1,
        })
        .unwrap();
    again
        .apply_server(ServerCommand::ToolsChanged {
            tools: vec![ToolStub {
                tool_ref: 1,
                schedule_days: 0,
                role: None,
            }],
        })
        .unwrap();
    assert_eq!(again.hash(), h);
}
