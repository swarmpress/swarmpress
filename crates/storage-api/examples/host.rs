//! The M0 boundary host: the projection behind loopback HTTP/1.1 with keep-alive, as the forked
//! `wpdb` will reach the storage API from a sandbox (ADR-0084 §3). Each request's body is one
//! MySQL statement; the answer is JSON `{columns, rows, rows_affected, insert_id}` or `{error}`.
//! Spike only: one connection at a time, no auth.
//!
//! cargo run -p storage-api --release --example host -- 127.0.0.1:18300

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

use storage_api::Projection;

const SCHEMA: &str = include_str!("../schema/wordpress.sql");

fn main() {
    let addr = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:18300".into());
    let listener = TcpListener::bind(&addr).expect("bind");
    eprintln!("storage-api host on {addr}");
    let mut p = Projection::open(SCHEMA).expect("schema");
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let _ = stream.set_nodelay(true);
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
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
                break;
            }
            let sql = String::from_utf8_lossy(&body);
            let json = match p.query(&sql) {
                Ok((_, out)) => {
                    serde_json::json!({"columns": out.columns, "rows": out.rows, "rows_affected": out.rows_affected, "insert_id": out.insert_id})
                }
                Err(e) => serde_json::json!({"error": e.to_string()}),
            };
            let payload = json.to_string();
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n", payload.len());
            if stream
                .write_all(head.as_bytes())
                .and_then(|_| stream.write_all(payload.as_bytes()))
                .is_err()
            {
                break;
            }
        }
    }
}
