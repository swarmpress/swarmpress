//! World snapshots (FEAT-060, ADR-0046): a world restored from a snapshot is
//! the world, a restored world gets its open job requests back, and anything
//! that is not this build's snapshot is refused.
//!
//! `crates/client-wasm/tests/snapshot_wasm.rs` runs the same golden under
//! wasm32, `packages/runner/test/snapshot.test.ts` under Bun.

use sim_core::clock::SimConfig;
use sim_core::commands::{JobDigest, ServerCommand};
use sim_core::ids::StaffId;
use sim_core::plan::{BriefStub, Effect, JobKind, WorkItemKind, WorkItemStatus};
use sim_core::scenarios::{
    demo_office, demo_office_with_config, golden_script, run_golden, GOLDEN_SEED, GOLDEN_STEPS,
};
use sim_core::snapshot::{
    SnapshotError, SnapshotHeader, HEADER_LEN, SNAPSHOT_FORMAT, SNAPSHOT_MAGIC, WORLD_FORMAT,
};
use sim_core::World;

/// Every world format so far, with the golden hash (`tests/golden.rs`) of the
/// world it names. The last row is the current one. A world format is never
/// reused: a sim change that moves the golden hash gets a new row and a bumped
/// [`WORLD_FORMAT`] (see `world_format_names_the_current_world`).
const WORLD_FORMATS: &[(u32, u64)] = &[(1, 0x591f_2064_16aa_2764)];

/// The golden hash of the current world format.
const GOLDEN_HASH: u64 = WORLD_FORMATS[WORLD_FORMATS.len() - 1].1;

const GIULIA: StaffId = StaffId(1); // writer
const MARCO: StaffId = StaffId(5); // editor

/// One game day = 600 steps.
fn fast(seed: u64) -> World {
    demo_office_with_config(
        seed,
        SimConfig {
            day_real_minutes: 1,
            ..SimConfig::default()
        },
    )
}

fn restored(w: &World) -> World {
    World::from_snapshot(&w.snapshot(), None).expect("a fresh snapshot restores")
}

/// The golden run, with the world thrown away and rebuilt from its snapshot
/// every `every` steps.
fn golden_through_snapshots(every: u64) -> (World, usize) {
    let mut w = demo_office(GOLDEN_SEED);
    for (step, input) in golden_script() {
        w.enqueue(step, 0, input).expect("script is ordered");
    }
    let mut restores = 0;
    for _ in 0..GOLDEN_STEPS {
        if w.step > 0 && w.step % every == 0 {
            w = restored(&w);
            restores += 1;
        }
        let report = w.step();
        assert!(report.applied.iter().all(|(_, r)| r.is_ok()));
    }
    (w, restores)
}

#[test]
fn golden_run_through_snapshots_matches_the_uninterrupted_run() {
    // 7,919 is prime: the restores land at arbitrary times of day, between
    // scripted commands, with inputs still queued and jobs pending.
    let (w, restores) = golden_through_snapshots(7_919);
    assert_eq!(restores, 6);
    assert_eq!(w.hash(), GOLDEN_HASH, "got {:#018x}", w.hash());
    assert_eq!(w.plan.items.len(), 2);
    assert_eq!(
        w.plan.items.values().next().map(|i| i.status),
        Some(WorkItemStatus::Published)
    );
}

/// The guard that keeps old snapshots from being decoded by a changed sim.
/// postcard is not self-describing, so a snapshot is only safe to load into
/// the build that wrote it; `WORLD_FORMAT` is how a snapshot says which build
/// that was.
#[test]
fn world_format_names_the_current_world() {
    let (w, _) = run_golden(GOLDEN_STEPS);
    let golden = w.hash();
    let (format, pinned) = WORLD_FORMATS[WORLD_FORMATS.len() - 1];
    assert!(
        golden == pinned && format == WORLD_FORMAT,
        "\nThe world's encoding or rules changed: the golden hash is now {golden:#018x}, \
         world format {format} was pinned at {pinned:#018x}, and WORLD_FORMAT is {WORLD_FORMAT}.\n\
         Snapshots written before this change must be refused, so:\n\
         1. bump `WORLD_FORMAT` in crates/sim-core/src/snapshot.rs to {next} (the one line to change in src);\n\
         2. append `({next}, {golden:#018x})` to `WORLD_FORMATS` in crates/sim-core/tests/snapshot.rs;\n\
         3. update the golden hash as usual: `GOLDEN_HASH` in crates/sim-core/tests/golden.rs, \
         crates/client-wasm/tests/golden_wasm.rs and crates/client-wasm/tests/snapshot_wasm.rs, \
         and packages/runner/test/fixtures/golden.json.\n",
        next = format + 1,
    );
    // formats only ever go up, and no two formats name the same world
    for pair in WORLD_FORMATS.windows(2) {
        assert!(
            pair[0].0 < pair[1].0,
            "world formats must increase: {pair:?}"
        );
        assert_ne!(
            pair[0].1, pair[1].1,
            "a new world format needs a new world: {pair:?}"
        );
    }
}

#[test]
fn a_snapshot_describes_itself_and_round_trips() {
    let mut w = demo_office(7);
    for _ in 0..3_333 {
        w.step();
    }
    let bytes = w.snapshot();
    assert_eq!(&bytes[..4], &SNAPSHOT_MAGIC);
    let h = SnapshotHeader::parse(&bytes).unwrap();
    assert_eq!(
        h,
        SnapshotHeader {
            format: SNAPSHOT_FORMAT,
            world_format: WORLD_FORMAT,
            config: SimConfig::default(),
            step: 3_333,
            hash: w.hash(),
        }
    );
    let back = World::from_snapshot(&bytes, Some(&SimConfig::default())).unwrap();
    assert_eq!(back.hash(), w.hash());
    assert_eq!(back.step, w.step);
    assert_eq!(back.seed, 7);
    assert_eq!(
        back.snapshot(),
        bytes,
        "a restored world writes the same bytes"
    );
    // … and keeps being the same world.
    let mut a = w;
    let mut b = back;
    for _ in 0..2_000 {
        a.step();
        b.step();
    }
    assert_eq!(a.hash(), b.hash());
    println!(
        "snapshot of the 13-person company at step 3,333: {} bytes",
        bytes.len()
    );
}

fn effects(w: &World) -> Vec<Effect> {
    w.effects().to_vec()
}

fn job_id(e: &Effect) -> u64 {
    let Effect::RequestJob { job_id, .. } = e;
    *job_id
}

/// Steps until the world emits an effect; returns it (still queued).
fn step_until_effect(w: &mut World, max: u32) -> Effect {
    for _ in 0..max {
        w.step();
        if let Some(e) = w.effects().first() {
            assert_eq!(w.effects().len(), 1);
            return e.clone();
        }
    }
    panic!("no effect within {max} steps");
}

/// At a point where the world waits for exactly `original`: a restored world
/// has no effects, and re-issuing gives back that request, field for field.
fn assert_reissues(w: &mut World, original: &Effect) {
    let hash = w.hash();
    let mut back = restored(w);
    assert!(back.effects().is_empty(), "effects are not in a snapshot");
    assert_eq!(back.reissue_pending_jobs(), 1);
    assert_eq!(effects(&back), vec![original.clone()]);
    assert_eq!(back.hash(), hash, "re-issuing is not a state change");
    // again: the request is still queued, nothing is emitted twice
    assert_eq!(back.reissue_pending_jobs(), 0);
    assert_eq!(back.effects().len(), 1);
    // The live world, once its outbox was drained, re-issues the same.
    let drained = w.drain_effects();
    assert!(drained.is_empty() || drained == vec![original.clone()]);
    assert_eq!(w.reissue_pending_jobs(), 1);
    assert_eq!(w.drain_effects(), vec![original.clone()]);
    assert_eq!(w.hash(), hash);
}

fn complete(w: &mut World, job: u64, score: u8) {
    w.apply_server(ServerCommand::JobCompleted {
        job_id: job,
        digest: JobDigest {
            ok: true,
            score,
            words: 950,
            qa_defects: 0,
            artifact_sha: [0xab; 16],
        },
    })
    .expect("job result accepted");
}

#[test]
fn a_restored_world_reissues_exactly_the_pending_job() {
    let mut w = fast(1);
    assert_eq!(w.reissue_pending_jobs(), 0, "nothing pending yet");

    // the standup: the team, no work item
    let standup = step_until_effect(&mut w, 400);
    let Effect::RequestJob {
        kind,
        meeting,
        staff,
        ..
    } = &standup;
    assert_eq!(*kind, JobKind::Standup);
    assert!(meeting.is_some());
    assert!(staff.len() > 3, "{staff:?}");
    assert_reissues(&mut w, &standup);

    // the draft: brief ref (a u64 beyond 2^53), revision 0, the writer
    let brief_ref = u64::MAX - 5;
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: job_id(&standup),
        briefs: vec![BriefStub {
            kind: WorkItemKind::Article,
            writer: GIULIA,
            editor: MARCO,
            brief_ref,
        }],
    })
    .unwrap();
    let draft = effects(&w).remove(0);
    assert!(matches!(
        &draft,
        Effect::RequestJob { kind: JobKind::Draft, brief_ref: Some(r), revision: 0, staff, .. }
            if *r == brief_ref && staff == &vec![GIULIA]
    ));
    assert_reissues(&mut w, &draft);

    // review of revision 0, by the editor
    complete(&mut w, job_id(&draft), 0);
    let review = step_until_effect(&mut w, 400);
    assert!(matches!(
        &review,
        Effect::RequestJob { kind: JobKind::Review, revision: 0, staff, .. } if staff == &vec![MARCO]
    ));
    assert_reissues(&mut w, &review);

    // score 6: the revision's draft carries revision 1
    complete(&mut w, job_id(&review), 6);
    let revise = step_until_effect(&mut w, 400);
    assert!(matches!(
        &revise,
        Effect::RequestJob {
            kind: JobKind::Draft,
            revision: 1,
            ..
        }
    ));
    assert_reissues(&mut w, &revise);

    complete(&mut w, job_id(&revise), 0);
    let review2 = step_until_effect(&mut w, 400);
    assert!(matches!(
        &review2,
        Effect::RequestJob {
            kind: JobKind::Review,
            revision: 1,
            ..
        }
    ));
    assert_reissues(&mut w, &review2);

    // score 8: publish
    complete(&mut w, job_id(&review2), 8);
    let publish = step_until_effect(&mut w, 400);
    assert!(matches!(
        &publish,
        Effect::RequestJob {
            kind: JobKind::Publish,
            ..
        }
    ));
    assert_reissues(&mut w, &publish);

    // answered: nothing is pending, nothing is re-issued
    complete(&mut w, job_id(&publish), 0);
    assert_eq!(w.reissue_pending_jobs(), 0);
    assert_eq!(restored(&w).reissue_pending_jobs(), 0);
    assert_eq!(
        (1..=6).collect::<Vec<u64>>(),
        [&standup, &draft, &review, &revise, &review2, &publish]
            .map(job_id)
            .to_vec(),
        "job ids are sequential and survive a restore"
    );
}

#[test]
fn several_pending_jobs_come_back_in_job_id_order() {
    let mut w = fast(3);
    let standup = step_until_effect(&mut w, 400);
    let brief = |brief_ref| BriefStub {
        kind: WorkItemKind::Article,
        writer: GIULIA,
        editor: MARCO,
        brief_ref,
    };
    w.apply_server(ServerCommand::MeetingOutcome {
        job_id: job_id(&standup),
        briefs: vec![brief(11), brief(12), brief(13)],
    })
    .unwrap();
    let originals: Vec<Effect> = w
        .drain_effects()
        .into_iter()
        .filter(|e| job_id(e) != job_id(&standup))
        .collect();
    assert_eq!(originals.len(), 3);
    let mut back = restored(&w);
    assert_eq!(back.reissue_pending_jobs(), 3);
    assert_eq!(effects(&back), originals);
}

fn snapshot_at(steps: u32) -> (World, Vec<u8>) {
    let mut w = demo_office(42);
    for _ in 0..steps {
        w.step();
    }
    let bytes = w.snapshot();
    (w, bytes)
}

#[test]
fn foreign_and_damaged_snapshots_are_refused() {
    let (w, good) = snapshot_at(2_500);
    assert!(World::from_snapshot(&good, None).is_ok());

    assert_eq!(
        World::from_snapshot(&good[..HEADER_LEN - 1], None).unwrap_err(),
        SnapshotError::Truncated(HEADER_LEN - 1)
    );
    assert_eq!(
        World::from_snapshot(&[], None).unwrap_err(),
        SnapshotError::Truncated(0)
    );

    let mut bad = good.clone();
    bad[0] = b'X';
    assert_eq!(
        World::from_snapshot(&bad, None).unwrap_err(),
        SnapshotError::BadMagic
    );
    // a JSON checkpoint of the old kind is not a snapshot
    assert_eq!(
        World::from_snapshot(
            br#"{"format":"swarmpress.checkpoint.v1","scenario":"cinqueterre","seed":"1","step":0,"hash":"0","lastSeq":0}"#,
            None
        )
        .unwrap_err(),
        SnapshotError::BadMagic
    );

    let mut bad = good.clone();
    bad[4..6].copy_from_slice(&(SNAPSHOT_FORMAT + 1).to_le_bytes());
    assert_eq!(
        World::from_snapshot(&bad, None).unwrap_err(),
        SnapshotError::Format {
            found: SNAPSHOT_FORMAT + 1
        }
    );

    // another sim build: refused before a single body byte is read
    let mut bad = good.clone();
    bad[6..10].copy_from_slice(&(WORLD_FORMAT + 1).to_le_bytes());
    assert_eq!(
        World::from_snapshot(&bad, None).unwrap_err(),
        SnapshotError::Build {
            found: WORLD_FORMAT + 1,
            expected: WORLD_FORMAT
        }
    );

    // a config other than the expected one
    let live = SimConfig {
        day_real_minutes: 60,
        ..SimConfig::default()
    };
    assert_eq!(
        World::from_snapshot(&good, Some(&live)).unwrap_err(),
        SnapshotError::Config {
            found: SimConfig::default(),
            expected: live.clone()
        }
    );
    // … and a header whose config is not the world's
    let mut bad = good.clone();
    bad[10..18].copy_from_slice(&60u64.to_le_bytes());
    assert_eq!(
        World::from_snapshot(&bad, Some(&live)).unwrap_err(),
        SnapshotError::Inconsistent("config")
    );
    let mut bad = good.clone();
    bad[26..34].copy_from_slice(&(w.step + 1).to_le_bytes());
    assert_eq!(
        World::from_snapshot(&bad, None).unwrap_err(),
        SnapshotError::Inconsistent("step")
    );

    // a wrong hash in the header
    let mut bad = good.clone();
    bad[34] ^= 0x01;
    assert!(matches!(
        World::from_snapshot(&bad, None).unwrap_err(),
        SnapshotError::Hash { expected, found } if found == w.hash() && expected != found
    ));
    // every single flipped body byte is caught (sampled across the body)
    for at in (HEADER_LEN..good.len()).step_by(97) {
        let mut bad = good.clone();
        bad[at] ^= 0x40;
        assert!(
            matches!(
                World::from_snapshot(&bad, None).unwrap_err(),
                SnapshotError::Hash { .. }
            ),
            "byte {at}"
        );
    }
    // a truncated or extended body
    assert!(matches!(
        World::from_snapshot(&good[..good.len() - 1], None).unwrap_err(),
        SnapshotError::Hash { .. }
    ));
    let mut bad = good.clone();
    bad.push(0);
    assert!(matches!(
        World::from_snapshot(&bad, None).unwrap_err(),
        SnapshotError::Hash { .. }
    ));
    // a body that hashes right but is not a world, or has bytes after it
    let forge = |body: &[u8]| {
        let mut out = good[..34].to_vec();
        out.extend_from_slice(&xxhash_rust::xxh3::xxh3_64(body).to_le_bytes());
        out.extend_from_slice(body);
        out
    };
    assert!(matches!(
        World::from_snapshot(&forge(&[0xff; 64]), None).unwrap_err(),
        SnapshotError::Decode(_)
    ));
    let mut longer = good[HEADER_LEN..].to_vec();
    longer.push(0);
    assert!(matches!(
        World::from_snapshot(&forge(&longer), None).unwrap_err(),
        SnapshotError::Decode(_)
    ));
}

#[test]
fn snapshot_size_does_not_grow_with_idle_history() {
    // The world holds state, not history: a week of days without work is
    // about as large as the first day. (Restore cost is then the snapshot's
    // size plus the commands logged after it; benches/restore.rs measures it.)
    let mut w = demo_office(42);
    let per_day = w.config.steps_per_day();
    for _ in 0..per_day {
        w.step();
    }
    let one = w.snapshot().len();
    for _ in 0..6 * per_day {
        w.step();
    }
    let seven = w.snapshot().len();
    println!("snapshot bytes after 1 day: {one}, after 7 days: {seven}");
    assert!(seven < one * 2, "1 day {one} bytes, 7 days {seven} bytes");
}
