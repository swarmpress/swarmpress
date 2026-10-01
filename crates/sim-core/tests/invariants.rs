//! Property tests: random command sequences against the demo office.
//!
//! Invariants checked after every step and every command:
//! - nothing panics (including decoding arbitrary bytes as commands)
//! - cash is conserved: `opening_cash + Σ ledger totals == cash`, and a
//!   settlement step changes cash by exactly the settlement's `net`
//! - no person on site is ever inside a wall
//! - every command either validates and applies, or is rejected by both
//!   `validate` and `apply` with the same reason, leaving the world untouched
//! - nobody ever fails to find a path (connectivity is validated)

use proptest::prelude::*;
use proptest::sample::select;

use sim_core::building::{Door, RoomKind, Window};
use sim_core::commands::{
    AutonomyPolicy, Command, DemolishTarget, Input, JobDigest, OvertimePolicy, Placement, Policy,
    ServerCommand, SiteSignals,
};
use sim_core::equipment::EquipmentKind;
use sim_core::geom::{PosMm, Side, TileRect};
use sim_core::ids::{CandidateId, EquipId, JobId, MeetingId, RoomId, StaffId};
use sim_core::scenarios::demo_office_with_config;
use sim_core::staff::Spot;
use sim_core::{validate_input, SimConfig, World};

fn side() -> impl Strategy<Value = Side> {
    select(Side::ALL.to_vec())
}

fn rect() -> impl Strategy<Value = TileRect> {
    prop_oneof![
        8 => (-2i32..22, -2i32..14, 1i32..12, 1i32..12)
            .prop_map(|(x, z, w, d)| TileRect::new(x, z, w, d)),
        1 => (any::<i32>(), any::<i32>(), any::<i32>(), any::<i32>())
            .prop_map(|(x, z, w, d)| TileRect::new(x, z, w, d)),
    ]
}

fn pos() -> impl Strategy<Value = PosMm> {
    prop_oneof![
        8 => (-1_000i32..22_000, -1_000i32..12_000).prop_map(|(x, z)| PosMm::new(x, z)),
        1 => (any::<i32>(), any::<i32>()).prop_map(|(x, z)| PosMm::new(x, z)),
    ]
}

fn placement() -> impl Strategy<Value = Placement> {
    prop_oneof![
        (pos(), 0u8..5).prop_map(|(pos, rot)| Placement::Floor { pos, rot }),
        (1u32..40).prop_map(|d| Placement::OnDesk(EquipId(d))),
    ]
}

fn policy() -> impl Strategy<Value = Policy> {
    prop_oneof![
        select(vec![
            OvertimePolicy::Never,
            OvertimePolicy::Allow,
            OvertimePolicy::Crunch
        ])
        .prop_map(Policy::Overtime),
        select(vec![
            AutonomyPolicy::ApproveAll,
            AutonomyPolicy::ApproveMajor,
            AutonomyPolicy::Autonomous
        ])
        .prop_map(Policy::Autonomy),
        (0u8..14).prop_map(Policy::QualityBar),
    ]
}

fn command() -> impl Strategy<Value = Command> {
    prop_oneof![
        1 => (side(), 0u8..10).prop_map(|(side, tiles)| Command::BuyFloorSpace { side, tiles }),
        1 => (
            select(RoomKind::ALL.to_vec()),
            rect(),
            0u8..2,
            prop::collection::vec((side(), -1i32..12).prop_map(|(side, at)| Door { side, at }), 0..4),
            prop::collection::vec(
                (side(), -500i32..8_000, 0i32..4_000)
                    .prop_map(|(side, at_mm, width_mm)| Window { side, at_mm, width_mm }),
                0..3
            ),
        )
            .prop_map(|(kind, rect, floor, doors, windows)| Command::PlaceRoom {
                kind,
                rect,
                floor,
                doors,
                windows
            }),
        1 => (1u32..8).prop_map(|r| Command::Demolish(DemolishTarget::Room(RoomId(r)))),
        1 => (1u32..40).prop_map(|e| Command::Demolish(DemolishTarget::Equipment(EquipId(e)))),
        3 => (select(EquipmentKind::ALL.to_vec()), placement())
            .prop_map(|(kind, placement)| Command::PlaceEquipment { kind, placement }),
        1 => (1u32..20).prop_map(|c| Command::Hire {
            candidate: CandidateId(c)
        }),
        1 => (1u32..10).prop_map(|s| Command::Fire { staff: StaffId(s) }),
        1 => policy().prop_map(Command::SetPolicy),
    ]
}

fn server_command() -> impl Strategy<Value = ServerCommand> {
    prop_oneof![
        (1u32..5, 0u32..4, 1u32..9, 0u32..400).prop_map(|(m, seq, s, chars)| {
            ServerCommand::Utterance {
                meeting: MeetingId(m),
                seq,
                speaker: StaffId(s),
                chars,
            }
        }),
        (0u32..100, 0u8..5).prop_map(|(live_pages, languages)| {
            ServerCommand::SiteSignals(SiteSignals {
                live_pages,
                languages,
                ..SiteSignals::default()
            })
        }),
        (1u32..5).prop_map(|j| ServerCommand::JobCompleted {
            job_id: JobId(j),
            digest: JobDigest {
                ok: true,
                score: 7,
                words: 800,
                qa_defects: 0,
                artifact_sha: [7; 16],
            },
        }),
    ]
}

fn input() -> impl Strategy<Value = Input> {
    prop_oneof![
        6 => command().prop_map(Input::Player),
        1 => server_command().prop_map(Input::Server),
    ]
}

/// A test step: a raw input, or a world-aware recipe that usually produces a
/// valid input (so the accepting paths get exercised, not just rejections).
#[derive(Clone, Debug)]
enum Action {
    Raw(Input),
    /// Room against the lot's east edge with a west door, after buying land.
    Room {
        kind: usize,
        z: i32,
        w: i32,
        d: i32,
        door: i32,
    },
    /// Desk on a newsroom grid point.
    Desk {
        gx: i32,
        gz: i32,
        rot: u8,
    },
    /// Utterance by someone seated in the running meeting.
    Speak {
        pick: usize,
        chars: u32,
    },
}

fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        5 => input().prop_map(Action::Raw),
        2 => (0usize..6, 0i32..10, 3i32..5, 3i32..6, 0i32..5)
            .prop_map(|(kind, z, w, d, door)| Action::Room { kind, z, w, d, door }),
        1 => (0i32..4, 0i32..4, 0u8..4).prop_map(|(gx, gz, rot)| Action::Desk { gx, gz, rot }),
        1 => (0usize..8, 1u32..300).prop_map(|(pick, chars)| Action::Speak { pick, chars }),
    ]
}

fn resolve(w: &World, a: Action) -> Input {
    match a {
        Action::Raw(i) => i,
        Action::Room {
            kind,
            z,
            w: rw,
            d,
            door,
        } => {
            let kinds = [
                RoomKind::Kitchen,
                RoomKind::Archive,
                RoomKind::MeetingRoom,
                RoomKind::CeoOffice,
                RoomKind::EditorOffice,
                RoomKind::Newsroom,
            ];
            let lot = w.building.lot;
            Input::Player(Command::PlaceRoom {
                kind: kinds[kind],
                rect: TileRect::new(lot.x_end() - rw, lot.z + z, rw, d),
                floor: 0,
                doors: vec![Door {
                    side: Side::West,
                    at: door.min(d - 1),
                }],
                windows: vec![Window {
                    side: Side::East,
                    at_mm: 500,
                    width_mm: 1_000,
                }],
            })
        }
        Action::Desk { gx, gz, rot } => Input::Player(Command::PlaceEquipment {
            kind: EquipmentKind::Desk,
            placement: Placement::Floor {
                pos: PosMm::new(1_200 + gx * 2_300, 1_200 + gz * 2_300),
                rot,
            },
        }),
        Action::Speak { pick, chars } => {
            let now = w.clock();
            let Some(m) = w.meetings.values().find(|m| m.is_active(now)) else {
                return Input::Server(ServerCommand::SiteSignals(SiteSignals::default()));
            };
            let seated: Vec<StaffId> = w
                .staff
                .values()
                .filter(|s| {
                    s.path.is_none()
                        && matches!(s.spot, Some(Spot::MeetingSeat { meeting, .. }) if meeting == m.id)
                })
                .map(|s| s.id)
                .collect();
            let speaker = seated
                .get(pick % seated.len().max(1))
                .copied()
                .unwrap_or(StaffId(1));
            Input::Server(ServerCommand::Utterance {
                meeting: m.id,
                seq: m.next_seq,
                speaker,
                chars,
            })
        }
    }
}

fn config() -> impl Strategy<Value = SimConfig> {
    (select(vec![1u64, 2, 20]), 0u64..1440).prop_map(|(day_real_minutes, start_minute)| SimConfig {
        day_real_minutes,
        start_minute,
    })
}

fn check(w: &World) {
    assert_eq!(
        w.ledger.opening_cash + w.ledger.total(),
        w.company.cash,
        "cash conserved"
    );
    for s in w.staff.values().filter(|s| s.is_on_site()) {
        assert!(
            !w.building.point_in_wall(s.pos),
            "{} at {:?} is inside a wall (step {}, {:?})",
            s.id,
            s.pos,
            w.step,
            s.activity
        );
    }
    assert_eq!(w.nav_failures, 0, "everyone can always find a path");
}

fn run_steps(w: &mut World, n: u32) {
    for _ in 0..n {
        let cash = w.company.cash;
        let report = w.step();
        if let Some(s) = report.settlement {
            if report.applied.is_empty() {
                assert_eq!(cash + s.net, w.company.cash, "settlement moves exactly net");
            }
            assert_eq!(s.cash_after, w.company.cash);
        }
        check(w);
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

    #[test]
    fn random_commands_keep_invariants(
        seed in any::<u64>(),
        cfg in config(),
        script in prop::collection::vec((0u32..600, action()), 1..16),
    ) {
        let mut w = demo_office_with_config(seed, cfg);
        check(&w);
        for (wait, action) in script {
            run_steps(&mut w, wait);
            let input = resolve(&w, action);
            let verdict = validate_input(&w, &input);
            let before = w.hash();
            let applied = w.apply_input(input);
            prop_assert_eq!(verdict.is_ok(), applied.is_ok());
            if let Err(e) = applied {
                prop_assert_eq!(Err::<(), _>(e), verdict);
                prop_assert_eq!(before, w.hash(), "rejected input changed the world");
            }
            check(&w);
        }
        run_steps(&mut w, 300);
    }

    #[test]
    fn queued_and_immediate_application_agree(
        seed in any::<u64>(),
        script in prop::collection::vec((1u64..400, command()), 1..10),
    ) {
        // Applying at step s via apply() equals enqueueing for step s.
        let cfg = SimConfig { day_real_minutes: 2, start_minute: 8 * 60 };
        let mut a = demo_office_with_config(seed, cfg.clone());
        let mut b = demo_office_with_config(seed, cfg);
        let mut at = 0u64;
        for (seq, (gap, cmd)) in script.into_iter().enumerate() {
            at += gap;
            b.enqueue(at, u32::try_from(seq).unwrap(), Input::Player(cmd.clone())).unwrap();
            while a.step < at {
                a.step();
            }
            let _ = a.apply(cmd);
        }
        while b.pending_len() > 0 || b.step <= at {
            b.step();
        }
        while a.step < b.step {
            a.step();
        }
        prop_assert_eq!(a.render_state(), b.render_state());
        prop_assert_eq!(a.hash(), b.hash());
    }

    #[test]
    fn decoding_arbitrary_bytes_never_panics(bytes in prop::collection::vec(any::<u8>(), 0..64)) {
        let mut w = demo_office_with_config(1, SimConfig::default());
        if let Ok(cmd) = postcard::from_bytes::<Command>(&bytes) {
            let _ = w.apply(cmd);
        }
        if let Ok(cmd) = postcard::from_bytes::<ServerCommand>(&bytes) {
            let _ = w.apply_server(cmd);
        }
        check(&w);
    }
}
