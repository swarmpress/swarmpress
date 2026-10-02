//! `cargo xtask site-pack <site-dir> [--out <file>] [--commit <sha>]`
//!
//! Builds the knowledge pack (ADR-0061) of a local clone of a site repo, the
//! same document the central server serves at `GET /api/gateway/knowledge`.
//! The eval harness feeds it to the orchestrator without a server.
//!
//! The pack is written to `--out`, or to stdout. The commit is the clone's
//! `HEAD`; pass `--commit` for a directory that is not the root of a git
//! work tree.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use knowledge::pack::{self, Pack};
use knowledge::DirSource;

pub const USAGE: &str = "cargo xtask site-pack <site-dir> [--out <file>] [--commit <sha>]";

struct Args {
    site: PathBuf,
    out: Option<PathBuf>,
    commit: Option<String>,
}

fn parse(args: &[String]) -> Result<Args> {
    let (mut site, mut out, mut commit) = (None, None, None);
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--out" => out = Some(PathBuf::from(it.next().context("--out needs a file")?)),
            "--commit" => commit = Some(it.next().context("--commit needs a sha")?.clone()),
            flag if flag.starts_with("--") => bail!("unknown option {flag}\nusage: {USAGE}"),
            dir if site.is_none() => site = Some(PathBuf::from(dir)),
            extra => bail!("unexpected argument {extra}\nusage: {USAGE}"),
        }
    }
    Ok(Args {
        site: site.with_context(|| format!("usage: {USAGE}"))?,
        out,
        commit,
    })
}

fn git(site: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(site).args(args).output();
    let out = out.ok().filter(|o| o.status.success())?;
    String::from_utf8(out.stdout).ok()
}

/// `HEAD` of the clone at `site`. A directory inside some other repository
/// (a test fixture, say) has no commit of its own.
fn head_commit(site: &Path) -> Result<String> {
    let inside = git(site, &["rev-parse", "--show-prefix"]);
    let head = git(site, &["rev-parse", "HEAD"]);
    match (inside.as_deref().map(str::trim), head) {
        (Some(""), Some(head)) => Ok(head.trim().to_string()),
        _ => bail!(
            "{} is not the root of a git work tree: pass --commit <sha>",
            site.display()
        ),
    }
}

fn build(args: &Args) -> Result<Pack> {
    if !args.site.join("content").is_dir() {
        bail!("{} has no content/ directory", args.site.display());
    }
    let commit = match &args.commit {
        Some(c) => c.clone(),
        None => {
            let head = head_commit(&args.site)?;
            let dirty = git(&args.site, &["status", "--porcelain", "--", "content"]);
            if dirty.is_some_and(|d| !d.trim().is_empty()) {
                eprintln!("site-pack: warning: content/ has uncommitted changes; the pack is labelled {head} but is built from the work tree");
            }
            head
        }
    };
    pack::build(&DirSource::new(&args.site), &commit)
        .with_context(|| format!("building the pack of {}", args.site.display()))
}

pub fn run(args: &[String]) -> Result<()> {
    let args = parse(args)?;
    let pack = build(&args)?;
    let json = pack.to_json()?;
    let media = pack::load(&pack)?.media.len();
    let summary = format!(
        "site-pack: commit {} · {} files ({} bytes of text) · {} pages · {} media · {} bytes",
        pack.commit,
        pack.files.len(),
        pack.files.values().map(String::len).sum::<usize>(),
        pack.pages.len(),
        media,
        json.len()
    );
    match &args.out {
        Some(out) => {
            std::fs::write(out, &json).with_context(|| format!("writing {}", out.display()))?;
            println!("{summary} → {}", out.display());
        }
        None => {
            println!("{json}");
            eprintln!("{summary}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../crates/knowledge/tests/fixtures/cinqueterre-mini")
    }

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn writes_the_pack_of_a_site_directory() {
        let site = fixture();
        let out = std::env::temp_dir().join(format!("xtask-site-pack-{}.json", std::process::id()));
        run(&strings(&[
            site.to_str().unwrap(),
            "--commit",
            "c0ffee",
            "--out",
            out.to_str().unwrap(),
        ]))
        .unwrap();
        let written = std::fs::read_to_string(&out).unwrap();
        std::fs::remove_file(&out).unwrap();

        let pack = Pack::from_json(&written).unwrap();
        assert_eq!(pack.commit, "c0ffee");
        assert_eq!(pack.pages.len(), 9);
        assert_eq!(pack.files.len(), 4);
        let kb = pack::load(&pack).unwrap();
        assert_eq!(kb.media.len(), 20);
        assert_eq!(
            written,
            pack::build(&DirSource::new(&site), "c0ffee")
                .unwrap()
                .to_json()
                .unwrap(),
            "the file is the pack, byte for byte"
        );
    }

    #[test]
    fn refuses_what_it_cannot_label_or_read() {
        // The fixture lives inside this repository: it has no commit of its own.
        let e = run(&strings(&[fixture().to_str().unwrap()])).unwrap_err();
        assert!(e.to_string().contains("--commit"), "{e}");
        let e = run(&strings(&["/nonexistent/site", "--commit", "c"])).unwrap_err();
        assert!(e.to_string().contains("content/"), "{e}");
        assert!(run(&[]).unwrap_err().to_string().contains("usage"));
        assert!(run(&strings(&["a", "b"])).is_err());
        assert!(run(&strings(&["a", "--frobnicate"])).is_err());
        assert!(run(&strings(&["a", "--out"])).is_err());
    }
}
