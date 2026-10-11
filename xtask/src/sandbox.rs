//! `cargo xtask sandbox-fetch [--node]`: the pinned GPL sandbox release (config/wp-sandbox.toml)
//! into `vendor/wp-sandbox/wp-sandbox-<version>/`, verified against its sha256 (ADR-0079). The
//! release is downloaded with the GitHub CLI (`gh`), so a private release works with the
//! caller's token. `--node` also installs the Node entry's dependencies (`npm install`).
//! Idempotent: a verified unpacked release is left as it is.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{bail, Context, Result};

pub struct Pin {
    pub version: String,
    pub repo: String,
    pub tag: String,
    pub asset: String,
    pub sha256: String,
}

/// Reads the flat `key = "value"` file (no tables, no arrays).
pub fn pin(root: &std::path::Path) -> Result<Pin> {
    let text = std::fs::read_to_string(root.join("config/wp-sandbox.toml"))
        .context("config/wp-sandbox.toml")?;
    let get = |key: &str| -> Result<String> {
        text.lines()
            .filter_map(|l| l.split_once('='))
            .find(|(k, _)| k.trim() == key)
            .map(|(_, v)| v.trim().trim_matches('"').to_string())
            .with_context(|| format!("config/wp-sandbox.toml has no {key}"))
    };
    let p = Pin {
        version: get("version")?,
        repo: get("repo")?,
        tag: get("tag")?,
        asset: get("asset")?,
        sha256: get("sha256")?,
    };
    if p.sha256.len() != 64 || !p.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        bail!("config/wp-sandbox.toml: sha256 is not a SHA-256 digest");
    }
    Ok(p)
}

fn sha256_of(path: &std::path::Path) -> Result<String> {
    let out = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .or_else(|_| Command::new("sha256sum").arg(path).output())
        .context("shasum or sha256sum")?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string())
}

pub fn fetch(root: PathBuf, node: bool) -> Result<()> {
    let p = pin(&root)?;
    let vendor = root.join("vendor/wp-sandbox");
    std::fs::create_dir_all(&vendor)?;
    let archive = vendor.join(&p.asset);
    let unpacked = vendor.join(format!("wp-sandbox-{}", p.version));
    let marker = unpacked.join(".verified");
    if std::fs::read_to_string(&marker).is_ok_and(|s| s.trim() == p.sha256) {
        eprintln!("wp-sandbox {} already in {}", p.version, unpacked.display());
    } else {
        if !archive.exists() || sha256_of(&archive)? != p.sha256 {
            let status = Command::new("gh")
                .args([
                    "release",
                    "download",
                    &p.tag,
                    "-R",
                    &p.repo,
                    "-p",
                    &p.asset,
                    "--clobber",
                    "-D",
                ])
                .arg(&vendor)
                .status()
                .context("gh (the GitHub CLI) downloads the sandbox release")?;
            if !status.success() {
                bail!("gh release download {} -R {} failed", p.tag, p.repo);
            }
        }
        let got = sha256_of(&archive)?;
        if got != p.sha256 {
            bail!(
                "{} has sha256 {got}, config/wp-sandbox.toml pins {}",
                p.asset,
                p.sha256
            );
        }
        let _ = std::fs::remove_dir_all(&unpacked);
        let status = Command::new("tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&vendor)
            .status()?;
        if !status.success() {
            bail!("tar could not unpack {}", archive.display());
        }
        std::fs::write(&marker, &p.sha256)?;
        eprintln!(
            "wp-sandbox {} verified and unpacked into {}",
            p.version,
            unpacked.display()
        );
    }
    if node && !unpacked.join("node_modules/@php-wasm/node").exists() {
        let status = Command::new("npm")
            .args(["install", "--no-audit", "--no-fund", "--omit=dev"])
            .current_dir(&unpacked)
            .status()
            .context("npm")?;
        if !status.success() {
            bail!("npm install failed in {}", unpacked.display());
        }
    }
    Ok(())
}
