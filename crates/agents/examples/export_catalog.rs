//! Writes the persona catalog (staff + hiring pool) as JSON with camelCase
//! keys, for tools and the UI.
//!
//! ```sh
//! cargo run -p agents --example export_catalog -- personas.json
//! ```
//!
//! Without an argument the JSON goes to stdout.

use std::process::ExitCode;

fn main() -> ExitCode {
    let json = serde_json::to_string_pretty(&agents::catalog_json()).expect("catalog serializes");
    match std::env::args().nth(1) {
        Some(path) => match std::fs::write(&path, json + "\n") {
            Ok(()) => {
                let c = agents::Catalog::builtin();
                eprintln!(
                    "wrote {path}: {} staff, {} candidates",
                    c.staff().count(),
                    c.pool().count()
                );
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("cannot write {path}: {e}");
                ExitCode::FAILURE
            }
        },
        None => {
            println!("{json}");
            ExitCode::SUCCESS
        }
    }
}
