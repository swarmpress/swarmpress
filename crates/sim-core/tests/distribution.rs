//! Translations and distribution in the sim (FEAT-098, ADR-0073): a
//! translation item goes to a free translator first; a page that goes live
//! gets one promotion job for the social media manager when the
//! `distribution` policy is on (never for a translation or a fix).

use sim_core::clock::SimConfig;
use sim_core::commands::{AutonomyPolicy, Command, JobDigest, Policy, ServerCommand};
use sim_core::ids::{StaffId, WorkItemId};
use sim_core::plan::{Effect, JobKind, PlannedStub, WorkItemKind, WorkItemStatus, WorkPriority};
use sim_core::roles::Role;
use sim_core::scenarios::demo_office_with_config;
use sim_core::World;

const MARCO: StaffId = StaffId(5);
const TRANSLATOR: StaffId = StaffId(3);
const SOCIAL: StaffId = StaffId(12);

fn world(seed: u64) -> World {
    let mut w = demo_office_with_config(
        seed,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    );
    w.staff.get_mut(&TRANSLATOR).unwrap().role = Role::Translator;
    w.staff.get_mut(&SOCIAL).unwrap().role = Role::SocialMediaManager;
    w.apply(Command::SetPolicy(Policy::EditorialBoard(true)))
        .unwrap();
    w.apply(Command::SetPolicy(Policy::Autonomy(
        AutonomyPolicy::Autonomous,
    )))
    .unwrap();
    w
}

fn reqs(w: &mut World) -> Vec<(u64, JobKind, Option<WorkItemId>, Vec<StaffId>)> {
    w.drain_effects()
        .into_iter()
        .map(|e| match e {
            Effect::RequestJob {
                job_id,
                kind,
                work_item,
                staff,
                ..
            } => (job_id, kind, work_item, staff),
        })
        .collect()
}

fn until(w: &mut World, kind: JobKind) -> (u64, JobKind, Option<WorkItemId>, Vec<StaffId>) {
    for _ in 0..2_000 {
        w.step();
        if let Some(r) = reqs(w).into_iter().find(|r| r.1 == kind) {
            return r;
        }
    }
    panic!("no {kind:?} job");
}

fn done(w: &mut World, job: u64, score: u8) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id: job,
        digest: JobDigest {
            ok: true,
            score,
            words: 900,
            qa_defects: 0,
            artifact_sha: [2; 16],
        },
    })
    .unwrap();
}

fn stub(brief_ref: u64, kind: WorkItemKind) -> PlannedStub {
    PlannedStub {
        kind,
        brief_ref,
        editor: MARCO,
        priority: WorkPriority::Normal,
        workstream: None,
        start_offset: 0,
        publish_offset: 2,
        depends_on: vec![],
    }
}

/// Draft, review, publish and the deploy of `item` (its draft job given).
fn publish(w: &mut World, item: WorkItemId, draft: u64) {
    done(w, draft, 0);
    let review = until(w, JobKind::Review);
    assert_eq!(review.2, Some(item));
    done(w, review.0, 8);
    let p = until(w, JobKind::Publish);
    done(w, p.0, 0);
    for _ in 0..20 {
        w.step();
    }
    reqs(w);
    w.apply_server(ServerCommand::DeployLanded { work_item: item })
        .unwrap();
    assert_eq!(w.plan.items[&item].status, WorkItemStatus::Published);
}

#[test]
fn a_translation_goes_to_the_translator_and_a_live_article_gets_promotion_copy() {
    let mut w = world(1);
    w.apply(Command::SetPolicy(Policy::Distribution(true)))
        .unwrap();
    let board = until(&mut w, JobKind::Board);
    w.apply_server(ServerCommand::BoardOutcome {
        job_id: board.0,
        workstreams: vec![],
        items: vec![
            stub(900, WorkItemKind::Article),
            stub(901, WorkItemKind::Translation),
        ],
    })
    .unwrap();
    let drafts = reqs(&mut w);
    let (article_draft, translation_draft) = (&drafts[0], &drafts[1]);
    assert_eq!(
        article_draft.3,
        vec![StaffId(1)],
        "the lowest-id free writer"
    );
    assert_eq!(
        translation_draft.3,
        vec![TRANSLATOR],
        "the translator, not writer 2"
    );
    let article = article_draft.2.unwrap();
    let translation = translation_draft.2.unwrap();
    assert_eq!(w.plan.items[&translation].kind, WorkItemKind::Translation);

    publish(&mut w, article, article_draft.0);
    let promo = reqs(&mut w);
    assert_eq!(promo.len(), 1, "{promo:?}");
    assert_eq!(promo[0].1, JobKind::Promotion);
    assert_eq!(promo[0].2, Some(article));
    assert_eq!(promo[0].3, vec![SOCIAL]);
    done(&mut w, promo[0].0, 0);
    assert!(!w.plan.jobs.contains_key(&promo[0].0));

    // a translation going live gets none
    publish(&mut w, translation, translation_draft.0);
    assert!(reqs(&mut w).iter().all(|r| r.1 != JobKind::Promotion));
}

#[test]
fn no_promotion_without_the_policy() {
    let mut w = world(2);
    let board = until(&mut w, JobKind::Board);
    w.apply_server(ServerCommand::BoardOutcome {
        job_id: board.0,
        workstreams: vec![],
        items: vec![stub(910, WorkItemKind::Article)],
    })
    .unwrap();
    let d = reqs(&mut w).remove(0);
    publish(&mut w, d.2.unwrap(), d.0);
    assert!(reqs(&mut w).iter().all(|r| r.1 != JobKind::Promotion));
}
