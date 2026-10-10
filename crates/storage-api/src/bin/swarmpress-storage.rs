//! The storage API as a native service, for a sandbox outside the browser: the runner, the
//! Node entry of the GPL sandbox, the conformance suite (ADR-0084 §3, ADR-0079).
//!
//! ```text
//! swarmpress-storage --listen 127.0.0.1:18300 --data ./data/storage [--prefix wp_]
//!   POST /storage   the storage channel (what the fork's seams send)
//!   POST /repo      the governed API (sessions, branches, change requests, merges, releases)
//!   GET  /health
//! ```
//!
//! State: the repository as append-only records (`repo.jsonl`), asset bytes by digest
//! (`assets/<sha256>`), mail in `outbox.jsonl`. Outgoing HTTP fails loudly until a fetch proxy
//! is configured (rule 11). One session (one sandbox) per process.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};

use content_repo::{Record, Repo};
use serde_json::{json, Value};
use storage_api::protocol::{self, sha256_hex, Platform, Session};
use storage_api::{Host, Native};

struct Files {
    dir: PathBuf,
}

impl Platform for Files {
    fn put_bytes(&mut self, bytes: &[u8]) -> Result<String, String> {
        let sha = sha256_hex(bytes);
        let path = self.dir.join("assets").join(&sha);
        if !path.exists() {
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        }
        Ok(sha)
    }

    fn get_bytes(&mut self, sha256: &str) -> Result<Vec<u8>, String> {
        if !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("bad digest".into());
        }
        std::fs::read(self.dir.join("assets").join(sha256)).map_err(|e| e.to_string())
    }

    fn mail(&mut self, mail: Value) -> Result<(), String> {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("outbox.jsonl"))
            .map_err(|e| e.to_string())?;
        writeln!(f, "{mail}").map_err(|e| e.to_string())
    }

    fn http(&mut self, request: Value) -> Result<Value, String> {
        Err(format!("outgoing HTTP to {} needs the platform's fetch proxy, which this storage service does not have", request["url"].as_str().unwrap_or("?")))
    }
}

struct State {
    host: Host<Native>,
    session: Session,
    files: Files,
    log: std::fs::File,
}

impl State {
    fn persist(&mut self) {
        for r in self.host.repo.take_records() {
            let _ = writeln!(
                self.log,
                "{}",
                serde_json::to_string(&r).unwrap_or_default()
            );
        }
        let _ = self.log.flush();
    }
}

fn arg(name: &str, default: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

/// A request for the state's thread: the route, the message, where to send the reply.
type Job = (String, Value, Sender<Value>);

fn serve(stream: TcpStream, jobs: Sender<Job>) {
    let _ = stream.set_nodelay(true);
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut stream = stream;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            return;
        }
        let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
        let mut len = 0usize;
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
                break;
            }
            if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; len];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        let msg: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let (tx, rx) = channel();
        if jobs.send((path, msg, tx)).is_err() {
            return;
        }
        let reply = rx
            .recv()
            .unwrap_or_else(|_| json!({"error": "storage service stopped"}));
        let payload = reply.to_string();
        let head = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n", payload.len());
        if stream
            .write_all(head.as_bytes())
            .and_then(|_| stream.write_all(payload.as_bytes()))
            .is_err()
        {
            return;
        }
    }
}

fn main() {
    let listen = arg("--listen", "127.0.0.1:18300");
    let dir = PathBuf::from(arg("--data", "./data/storage"));
    let prefix = arg("--prefix", "wp_");
    std::fs::create_dir_all(dir.join("assets")).expect("data directory");
    let mut repo = Repo::new();
    let log_path = dir.join("repo.jsonl");
    if let Ok(text) = std::fs::read_to_string(&log_path) {
        let records: Vec<Record> = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).expect("a repository record"))
            .collect();
        repo.apply(records)
            .expect("the repository's records verify");
    }
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .expect("repo.jsonl");
    let host = Host::new(repo, &prefix, Box::new(Native::memory));
    let mut st = State {
        host,
        session: Session::default(),
        files: Files { dir: dir.clone() },
        log,
    };
    let listener = TcpListener::bind(&listen).expect("bind");
    eprintln!("swarmpress-storage on {listen}, data in {}", dir.display());
    let (jobs, queue) = channel::<Job>();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let jobs = jobs.clone();
            std::thread::spawn(move || serve(stream, jobs));
        }
    });
    // One thread owns the state: statements run in arrival order, as on one MySQL connection.
    for (path, msg, reply) in queue {
        let r = match path.as_str() {
            "/storage" => protocol::storage(&mut st.host, &st.session, &mut st.files, &msg),
            "/repo" => protocol::repo(&mut st.host, &mut st.session, &msg),
            "/health" => json!({"ok": true, "importing": st.host.importing()}),
            other => json!({"error": format!("no route {other}")}),
        };
        st.persist();
        let _ = reply.send(r);
    }
}
