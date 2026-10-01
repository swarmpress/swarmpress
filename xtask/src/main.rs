//! `cargo xtask <command>` — repo automation that would otherwise live in
//! shell scripts.
//!
//! - `wasm [--release]`: build `client-wasm` for wasm32 and run wasm-bindgen
//!   into `crates/client-wasm/pkg` (consumed by `apps/game`).

use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{bail, Context, Result};

fn main() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("wasm") => wasm(args.iter().any(|a| a == "--release")),
        _ => {
            eprintln!("usage: cargo xtask wasm [--release]");
            std::process::exit(2);
        }
    }
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf()
}

fn run(cmd: &mut Command) -> Result<()> {
    let status = cmd
        .status()
        .with_context(|| format!("failed to spawn {cmd:?}"))?;
    if !status.success() {
        bail!("{cmd:?} exited with {status}");
    }
    Ok(())
}

fn wasm(release: bool) -> Result<()> {
    let root = root();
    let profile = if release { "wasm-release" } else { "dev" };
    run(
        Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
            .current_dir(&root)
            .args([
                "build",
                "-p",
                "client-wasm",
                "--target",
                "wasm32-unknown-unknown",
                "--profile",
                profile,
            ]),
    )?;
    let dir = if release { "wasm-release" } else { "debug" };
    let wasm = root.join(format!(
        "target/wasm32-unknown-unknown/{dir}/client_wasm.wasm"
    ));
    run(Command::new("wasm-bindgen")
        .arg(&wasm)
        .args(["--target", "web", "--out-dir"])
        .arg(root.join("crates/client-wasm/pkg")))
    .context(
        "wasm-bindgen CLI 0.2.100 is required: cargo install wasm-bindgen-cli --version 0.2.100",
    )?;
    println!("wrote crates/client-wasm/pkg");
    Ok(())
}
