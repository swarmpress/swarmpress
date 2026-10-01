//! Lockstep WebSocket integration: hello, command ack/reject, periodic hash
//! checks against a client-side replica, desync → resnapshot, reconnect.

mod common;

use std::time::Duration;

use common::{Opts, TestServer};
use simpress_server::sim::{LedgerSim, Simulation};
use simpress_server::wire::{ClientFrame, ServerFrame};
use sqlx::PgPool;
use testkit::ws::WsClient;

fn opts() -> Opts {
    Opts {
        tweak: Box::new(|c| {
            c.actor.hash_every = 5;
            c.actor.snapshot_every = 20;
        }),
        ..Default::default()
    }
}

/// What a browser does: restore the snapshot, then follow the stream.
struct Replica {
    sim: LedgerSim,
    /// Entries before (step, seq) are already in the snapshot.
    skip_before: (u64, u32),
    hashes_checked: usize,
    seen_payloads: Vec<Vec<u8>>,
}

impl Replica {
    fn from_hello(f: &ServerFrame) -> Self {
        match f {
            ServerFrame::Hello {
                step,
                next_seq,
                snapshot,
                ..
            }
            | ServerFrame::Resnapshot {
                step,
                next_seq,
                snapshot,
            } => {
                let sim = LedgerSim::restore(snapshot).unwrap();
                assert_eq!(sim.current_step(), *step);
                Self {
                    sim,
                    skip_before: (*step, *next_seq),
                    hashes_checked: 0,
                    seen_payloads: Vec::new(),
                }
            }
            other => panic!("expected Hello/Resnapshot, got {other:?}"),
        }
    }

    fn on_frame(&mut self, f: &ServerFrame) {
        match f {
            ServerFrame::Commands {
                from_step,
                to_step,
                entries,
            } => {
                assert_eq!(*from_step, self.sim.current_step(), "stream is contiguous");
                for t in *from_step..*to_step {
                    for e in entries.iter().filter(|e| e.step == t) {
                        if (e.step, e.seq) < self.skip_before {
                            continue;
                        }
                        self.sim.apply(&e.payload).unwrap();
                        self.seen_payloads.push(e.payload.clone());
                    }
                    self.sim.step();
                }
            }
            ServerFrame::Hash { step, h } if *step == self.sim.current_step() => {
                assert_eq!(self.sim.hash(), *h, "replica desync at step {step}");
                self.hashes_checked += 1;
            }
            _ => {}
        }
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn ws_requires_session_and_company(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let err = WsClient::connect(&s.ws_url(), None).await.err().unwrap();
    assert!(format!("{err:#}").contains("401"), "{err:#}");
    let cookie = s.login(1, "nocompany").await;
    let err = WsClient::connect(&s.ws_url(), Some(&cookie))
        .await
        .err()
        .unwrap();
    assert!(format!("{err:#}").contains("404"), "{err:#}");
}

#[sqlx::test(migrations = "./migrations")]
async fn hello_ack_reject_and_hash_checks(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let (cookie, company) = s.player(2).await;
    let mut ws = s.ws(&cookie).await;

    let hello: ServerFrame = ws.recv().await.unwrap();
    match &hello {
        ServerFrame::Hello {
            proto_version,
            company_id,
            ..
        } => {
            assert_eq!(*proto_version, protocol::PROTO_VERSION);
            assert_eq!(company_id, &company.to_string());
        }
        other => panic!("{other:?}"),
    }
    let mut replica = Replica::from_hello(&hello);

    ws.send(&ClientFrame::Cmd {
        client_seq: 1,
        payload: b"hire:writer".to_vec(),
    })
    .await
    .unwrap();
    ws.send(&ClientFrame::Cmd {
        client_seq: 2,
        payload: b"!invalid".to_vec(),
    })
    .await
    .unwrap();

    let mut acked = None;
    let mut rejected = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while (replica.hashes_checked < 3 || acked.is_none() || rejected.is_none())
        && tokio::time::Instant::now() < deadline
    {
        let f: ServerFrame = ws.recv().await.unwrap();
        match &f {
            ServerFrame::Ack {
                client_seq,
                step,
                seq,
            } => {
                assert_eq!(*client_seq, 1);
                acked = Some((*step, *seq));
            }
            ServerFrame::Reject { client_seq, reason } => {
                assert_eq!(*client_seq, 2);
                assert!(reason.contains("rejected"));
                rejected = Some(reason.clone());
            }
            _ => replica.on_frame(&f),
        }
    }
    assert!(acked.is_some() && rejected.is_some());
    assert!(
        replica.hashes_checked >= 3,
        "hash checks: {}",
        replica.hashes_checked
    );
    assert_eq!(replica.seen_payloads, vec![b"hire:writer".to_vec()]);

    // Server-side truth agrees with the replica.
    let probe =
        s.st.registry
            .get(company)
            .await
            .unwrap()
            .probe()
            .await
            .unwrap();
    assert!(probe.step >= replica.sim.current_step());
}

#[sqlx::test(migrations = "./migrations")]
async fn desync_report_triggers_resnapshot(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let (cookie, _) = s.player(3).await;
    let mut ws = s.ws(&cookie).await;
    let _hello: ServerFrame = ws.recv().await.unwrap();
    let (step, h) = ws
        .recv_until(Duration::from_secs(5), |f: &ServerFrame| match f {
            ServerFrame::Hash { step, h } => Some((*step, *h)),
            _ => None,
        })
        .await
        .unwrap();

    // Matching report: nothing happens (no Resnapshot within a few frames).
    ws.send(&ClientFrame::HashReport { step, h }).await.unwrap();
    // Wrong report: Resnapshot.
    ws.send(&ClientFrame::HashReport { step, h: h ^ 1 })
        .await
        .unwrap();
    let mut frames_before = 0;
    let resnap = ws
        .recv_until(Duration::from_secs(5), |f: &ServerFrame| match f {
            ServerFrame::Resnapshot { .. } => Some(f.clone()),
            _ => {
                frames_before += 1;
                None
            }
        })
        .await
        .unwrap();
    let mut replica = Replica::from_hello(&resnap);
    // The stream continues seamlessly from the resnapshot.
    while replica.hashes_checked < 1 {
        let f: ServerFrame = ws.recv().await.unwrap();
        replica.on_frame(&f);
    }

    // Explicit request works too.
    ws.send(&ClientFrame::RequestResnapshot).await.unwrap();
    ws.recv_until(Duration::from_secs(5), |f: &ServerFrame| {
        matches!(f, ServerFrame::Resnapshot { .. }).then_some(())
    })
    .await
    .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn reconnect_gets_snapshot_with_prior_commands(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let (cookie, _) = s.player(4).await;
    let mut ws = s.ws(&cookie).await;
    let hello: ServerFrame = ws.recv().await.unwrap();
    let first_step = match hello {
        ServerFrame::Hello { step, .. } => step,
        _ => unreachable!(),
    };
    for i in 0..3u32 {
        ws.send(&ClientFrame::Cmd {
            client_seq: i,
            payload: format!("cmd{i}").into_bytes(),
        })
        .await
        .unwrap();
        ws.recv_until(Duration::from_secs(5), |f: &ServerFrame| {
            matches!(f, ServerFrame::Ack { .. }).then_some(())
        })
        .await
        .unwrap();
    }
    ws.close().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let mut ws = s.ws(&cookie).await;
    let hello: ServerFrame = ws.recv().await.unwrap();
    let replica = Replica::from_hello(&hello);
    assert!(replica.sim.current_step() > first_step);
    assert_eq!(
        replica.sim.applied, 3,
        "snapshot includes the earlier commands"
    );
    let mut replica = replica;
    while replica.hashes_checked < 1 {
        let f: ServerFrame = ws.recv().await.unwrap();
        replica.on_frame(&f);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn reconnect_after_actor_restart_resyncs(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let (cookie, company) = s.player(5).await;
    let mut ws = s.ws(&cookie).await;
    let hello: ServerFrame = ws.recv().await.unwrap();
    let _ = Replica::from_hello(&hello);
    ws.send(&ClientFrame::Cmd {
        client_seq: 1,
        payload: b"before-restart".to_vec(),
    })
    .await
    .unwrap();
    ws.recv_until(Duration::from_secs(5), |f: &ServerFrame| {
        matches!(f, ServerFrame::Ack { .. }).then_some(())
    })
    .await
    .unwrap();

    // Server-side restart of the company actor: the open socket gets a
    // Resnapshot from the reloaded actor and stays in lockstep.
    s.st.registry.unload(company).await.unwrap();
    let resnap = ws
        .recv_until(Duration::from_secs(5), |f: &ServerFrame| {
            matches!(f, ServerFrame::Resnapshot { .. }).then(|| f.clone())
        })
        .await
        .unwrap();
    let mut replica = Replica::from_hello(&resnap);
    assert_eq!(replica.sim.applied, 1);
    while replica.hashes_checked < 2 {
        let f: ServerFrame = ws.recv().await.unwrap();
        replica.on_frame(&f);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn second_tab_sees_first_tabs_commands(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let (cookie, _) = s.player(6).await;
    let mut a = s.ws(&cookie).await;
    let mut b = s.ws(&cookie).await;
    let _: ServerFrame = a.recv().await.unwrap();
    let hb: ServerFrame = b.recv().await.unwrap();
    let mut rb = Replica::from_hello(&hb);
    a.send(&ClientFrame::Cmd {
        client_seq: 9,
        payload: b"from-a".to_vec(),
    })
    .await
    .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while rb.seen_payloads.is_empty() && tokio::time::Instant::now() < deadline {
        let f: ServerFrame = b.recv().await.unwrap();
        rb.on_frame(&f);
    }
    assert_eq!(rb.seen_payloads, vec![b"from-a".to_vec()]);
}

#[sqlx::test(migrations = "./migrations")]
async fn garbage_frames_get_error_not_disconnect(pool: PgPool) {
    let s = TestServer::start_with(pool, opts()).await;
    let (cookie, _) = s.player(7).await;
    let mut ws = s.ws(&cookie).await;
    let _: ServerFrame = ws.recv().await.unwrap();
    ws.send_raw(tokio_tungstenite::tungstenite::Message::Binary(
        vec![0xff, 0xff, 0xff].into(),
    ))
    .await
    .unwrap();
    ws.recv_until(Duration::from_secs(5), |f: &ServerFrame| {
        matches!(f, ServerFrame::Error { .. }).then_some(())
    })
    .await
    .unwrap();
    // Still alive.
    ws.send(&ClientFrame::Cmd {
        client_seq: 1,
        payload: b"ok".to_vec(),
    })
    .await
    .unwrap();
    ws.recv_until(Duration::from_secs(5), |f: &ServerFrame| {
        matches!(f, ServerFrame::Ack { .. }).then_some(())
    })
    .await
    .unwrap();
}
