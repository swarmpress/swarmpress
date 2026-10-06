//! Remarks (FEAT-099, ADR-0074): a line a person says outside a meeting is a
//! bubble and a pose, nothing else; in order, only for people on site and not
//! in a meeting.

use sim_core::clock::SimConfig;
use sim_core::commands::ServerCommand;
use sim_core::ids::StaffId;
use sim_core::scenarios::demo_office_with_config;
use sim_core::staff::Pose;
use sim_core::world::utterance_steps;
use sim_core::World;

fn fast() -> World {
    demo_office_with_config(
        3,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

fn remark(speaker: u32, listener: Option<u32>, seq: u32, chars: u32) -> ServerCommand {
    ServerCommand::Remark {
        speaker: StaffId(speaker),
        listener: listener.map(StaffId),
        seq,
        chars,
    }
}

#[test]
fn a_remark_is_a_bubble_and_a_pose_and_nothing_else() {
    let mut w = fast();
    // 11:00 on day 0: people at their desks, no meeting
    for _ in 0..100 {
        w.step();
    }
    let at = w.clock();
    assert!((660..700).contains(&at.minute), "{at:?}");
    // two people seated at their desks (walking shows as walking, whatever they say)
    let seated: Vec<u32> = w
        .render_state()
        .staff
        .iter()
        .filter(|s| matches!(s.pose, Pose::Sit | Pose::Type))
        .map(|s| s.id.0)
        .collect();
    let (a, b) = (seated[0], seated[1]);
    let before = w.hash();
    assert!(
        w.apply_server(remark(a, Some(b), 1, 60)).is_err(),
        "out of order"
    );
    assert!(
        w.apply_server(remark(a, Some(a), 0, 60)).is_err(),
        "talking to oneself"
    );
    assert!(w.apply_server(remark(a, Some(b), 0, 0)).is_err(), "empty");
    assert!(
        w.apply_server(remark(a, Some(b), 0, 601)).is_err(),
        "too long"
    );
    assert_eq!(w.hash(), before, "refusals change nothing");
    w.apply_server(remark(a, Some(b), 0, 60)).unwrap();
    let rs = w.render_state();
    assert_eq!(rs.remarks.len(), 1);
    let r = rs.remarks[0];
    assert_eq!(
        (r.seq, r.speaker, r.listener, r.chars),
        (0, StaffId(a), Some(StaffId(b)), 60)
    );
    assert_eq!(r.until_step, r.started_step + utterance_steps(60));
    let pose = |w: &World, id: u32| {
        w.render_state()
            .staff
            .iter()
            .find(|s| s.id == StaffId(id))
            .map(|s| s.pose)
    };
    assert_eq!(pose(&w, a), Some(Pose::Talk));
    assert_eq!(pose(&w, b), Some(Pose::Listen));
    // no plan, job or ticket changed
    assert!(w.plan.jobs.is_empty() || w.drain_effects().is_empty());
    for _ in 0..utterance_steps(60) {
        w.step();
    }
    assert!(w.render_state().remarks.is_empty(), "the bubble is gone");
    w.apply_server(remark(b, None, 1, 20)).unwrap();
    assert_eq!(w.next_remark, 2);
}

#[test]
fn nobody_remarks_from_a_meeting_or_from_home() {
    let mut w = fast();
    // 07:00: before anyone arrives
    assert!(w.apply_server(remark(1, None, 0, 40)).is_err());
    // the 09:00 standup: its attendees are in a meeting
    for _ in 0..90 {
        w.step();
    }
    let in_meeting: Vec<StaffId> = w
        .meetings
        .values()
        .filter(|m| m.is_active(w.clock()))
        .flat_map(|m| m.attendees.iter().copied())
        .collect();
    if let Some(s) = in_meeting.first() {
        assert!(w.apply_server(remark(s.0, None, 0, 40)).is_err());
    }
}
