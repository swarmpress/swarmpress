//! `cargo xtask <command>` — repo automation that would otherwise live in
//! shell scripts.
//!
//! - `wasm [--release]`: build the wasm crates for wasm32 and run wasm-bindgen
//!   on each into its `pkg/` (consumed by `apps/game`, Bun tests and the runner):
//!   `client-wasm` (the sim) → `crates/client-wasm/pkg`, `orchestrator-wasm`
//!   (the orchestrator bridge) → `crates/orchestrator-wasm/pkg`. They are
//!   separate modules with separate size budgets. `--only <crate>` builds one.
//! - `site-pack <site-dir> [--out <file>] [--commit <sha>]`: build the
//!   knowledge pack of a local site clone (see [`site_pack`]).

mod site_pack;

use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{bail, Context, Result};

fn main() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("wasm") => {
            let only = args
                .iter()
                .position(|a| a == "--only")
                .and_then(|i| args.get(i + 1))
                .map(String::as_str);
            wasm(args.iter().any(|a| a == "--release"), only)
        }
        Some("site-pack") => site_pack::run(&args[1..]),
        _ => {
            eprintln!("usage: cargo xtask wasm [--release] [--only client-wasm|orchestrator-wasm]");
            eprintln!("       {}", site_pack::USAGE);
            std::process::exit(2);
        }
    }
}

/// The workspace root, resolved at run time from the current directory (the
/// first ancestor whose `Cargo.toml` has a `[workspace]` table). Not
/// `CARGO_MANIFEST_DIR`: with a shared `CARGO_TARGET_DIR`, one checkout's
/// cached xtask binary would otherwise build another checkout's sources.
fn root() -> Result<PathBuf> {
    let cwd = env::current_dir().context("current directory")?;
    workspace_root(&cwd).with_context(|| format!("no Cargo workspace above {}", cwd.display()))
}

fn workspace_root(from: &Path) -> Option<PathBuf> {
    from.ancestors()
        .find(|d| {
            std::fs::read_to_string(d.join("Cargo.toml"))
                .is_ok_and(|t| t.lines().any(|l| l.trim() == "[workspace]"))
        })
        .map(Path::to_path_buf)
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

/// The wasm-bindgen crates: (package, artifact stem).
const WASM_CRATES: &[(&str, &str)] = &[
    ("client-wasm", "client_wasm"),
    ("orchestrator-wasm", "orchestrator_wasm"),
];

fn wasm(release: bool, only: Option<&str>) -> Result<()> {
    let root = root()?;
    let profile = if release { "wasm-release" } else { "dev" };
    let crates: Vec<_> = WASM_CRATES
        .iter()
        .filter(|(p, _)| only.is_none_or(|o| o == *p))
        .collect();
    if crates.is_empty() {
        bail!(
            "--only must be one of {:?}",
            WASM_CRATES.iter().map(|c| c.0).collect::<Vec<_>>()
        );
    }
    let mut build = Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    build
        .current_dir(&root)
        .arg("build")
        .arg("--manifest-path")
        .arg(root.join("Cargo.toml"));
    for (pkg, _) in &crates {
        build.args(["-p", pkg]);
    }
    build.args(["--target", "wasm32-unknown-unknown", "--profile", profile]);
    run(&mut build)?;
    let dir = if release { "wasm-release" } else { "debug" };
    // Honour a shared CARGO_TARGET_DIR (relative paths are relative to the workspace root).
    let target = env::var_os("CARGO_TARGET_DIR")
        .map(|t| root.join(t))
        .unwrap_or_else(|| root.join("target"));
    for (pkg, stem) in &crates {
        let wasm = target.join(format!("wasm32-unknown-unknown/{dir}/{stem}.wasm"));
        let out = root.join(format!("crates/{pkg}/pkg"));
        run(Command::new("wasm-bindgen")
            .arg(&wasm)
            .args(["--target", "web", "--out-dir"])
            .arg(&out))
        .context(
            "wasm-bindgen CLI 0.2.100 is required: cargo install wasm-bindgen-cli --version 0.2.100",
        )?;
        println!("wrote crates/{pkg}/pkg");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_workspace_root_from_a_subdirectory() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = workspace_root(&here.join("src")).expect("workspace root");
        assert_eq!(root, here.parent().unwrap());
        assert!(root.join("crates/orchestrator-wasm/Cargo.toml").exists());
    }
}
