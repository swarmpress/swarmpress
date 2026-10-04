//! `cargo xtask site-pack <site-dir> [--out <file>] [--commit <sha>] [--articles]`
//!
//! Builds the knowledge pack (ADR-0061) of a local clone of a site repo, the
//! same document the central server serves at `GET /api/gateway/knowledge`.
//! The eval harness feeds it to the orchestrator without a server.
//!
//! The pack is written to `--out`, or to stdout. The commit is the clone's
//! `HEAD`; pass `--commit` for a directory that is not the root of a git
//! work tree.
//!
//! `--articles` adds the site's existing articles for the eval harness
//! (FEAT-036, `apps/game/eval.html`): one more top-level key, `articles`,
//! maps each `content/pages/blog/*.json` path to its text, verbatim. The
//! other keys are the pack, unchanged: the harness hands them to the
//! orchestrator as the knowledge pack, and the articles become the editor's
//! positive controls. The central server never serves articles.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use knowledge::pack::{self, Pack};
use knowledge::{DirSource, SiteSource};

pub const USAGE: &str =
    "cargo xtask site-pack <site-dir> [--out <file>] [--commit <sha>] [--articles]";

/// Where the site keeps its articles (`content/pages/blog/<slug>.json`).
const BLOG_DIR: &str = "content/pages/blog";

struct Args {
    site: PathBuf,
    out: Option<PathBuf>,
    commit: Option<String>,
    articles: bool,
}

fn parse(args: &[String]) -> Result<Args> {
    let (mut site, mut out, mut commit, mut articles) = (None, None, None, false);
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--out" => out = Some(PathBuf::from(it.next().context("--out needs a file")?)),
            "--commit" => commit = Some(it.next().context("--commit needs a sha")?.clone()),
            "--articles" => articles = true,
            flag if flag.starts_with("--") => bail!("unknown option {flag}\nusage: {USAGE}"),
            dir if site.is_none() => site = Some(PathBuf::from(dir)),
            extra => bail!("unexpected argument {extra}\nusage: {USAGE}"),
        }
    }
    Ok(Args {
        site: site.with_context(|| format!("usage: {USAGE}"))?,
        out,
        commit,
        articles,
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

/// The site's articles, path → text, in path order (`--articles`).
fn articles(site: &Path) -> Result<BTreeMap<String, String>> {
    let src = DirSource::new(site);
    let mut out = BTreeMap::new();
    for path in src.list(BLOG_DIR)? {
        let direct = path
            .strip_prefix(BLOG_DIR)
            .and_then(|rest| rest.strip_prefix('/'))
            .is_some_and(|rest| !rest.contains('/'));
        if !direct || !path.ends_with(".json") {
            continue;
        }
        let bytes = src
            .read(&path)?
            .with_context(|| format!("{path} disappeared"))?;
        let text = String::from_utf8(bytes).with_context(|| format!("{path} is not UTF-8"))?;
        out.insert(path, text);
    }
    Ok(out)
}

/// The pack JSON, with the site's articles when asked for, and how many.
fn document(args: &Args, pack: &Pack) -> Result<(String, usize)> {
    if !args.articles {
        return Ok((pack.to_json()?, 0));
    }
    let found = articles(&args.site)?;
    let mut doc = serde_json::to_value(pack)?;
    doc["articles"] = serde_json::to_value(&found)?;
    Ok((doc.to_string(), found.len()))
}

pub fn run(args: &[String]) -> Result<()> {
    let args = parse(args)?;
    let pack = build(&args)?;
    let (json, article_count) = document(&args, &pack)?;
    let media = pack::load(&pack)?.media.len();
    let with_articles = if args.articles {
        format!(" · {article_count} articles")
    } else {
        String::new()
    };
    let summary = format!(
        "site-pack: commit {} · {} files ({} bytes of text) · {} pages · {} media{with_articles} · {} bytes",
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

    /// The eval harness's committed fixture (apps/game/eval.html, its vitest and
    /// e2e/eval.spec.ts) is the tree's. Regenerate with
    /// `cargo xtask site-pack crates/knowledge/tests/fixtures/cinqueterre-mini --commit 3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b --articles --out apps/game/src/harness/fixtures/cinqueterre-mini.eval.json`.
    #[test]
    fn the_eval_fixture_of_the_harness_is_the_trees() {
        let args = parse(&strings(&[
            fixture().to_str().unwrap(),
            "--commit",
            "3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b",
            "--articles",
        ]))
        .unwrap();
        let (built, articles) = document(&args, &build(&args).unwrap()).unwrap();
        assert_eq!(articles, 3);
        let committed = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../apps/game/src/harness/fixtures/cinqueterre-mini.eval.json"),
        )
        .unwrap();
        let parse = |t: &str| serde_json::from_str::<serde_json::Value>(t).unwrap();
        assert_eq!(
            parse(&committed),
            parse(&built),
            "regenerate the fixture (see this test's doc)"
        );
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
        assert_eq!(pack.files.len(), 7);
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
    fn adds_the_articles_for_the_eval_harness() {
        let site = fixture();
        let out = std::env::temp_dir().join(format!(
            "xtask-site-pack-articles-{}.json",
            std::process::id()
        ));
        run(&strings(&[
            site.to_str().unwrap(),
            "--commit",
            "c0ffee",
            "--articles",
            "--out",
            out.to_str().unwrap(),
        ]))
        .unwrap();
        let written = std::fs::read_to_string(&out).unwrap();
        std::fs::remove_file(&out).unwrap();

        let mut doc: serde_json::Value = serde_json::from_str(&written).unwrap();
        let articles = doc.as_object_mut().unwrap().remove("articles").unwrap();
        let paths: Vec<&String> = articles.as_object().unwrap().keys().collect();
        assert_eq!(
            paths,
            [
                "content/pages/blog/5-hidden-gelaterias-you-need-to-try.json",
                "content/pages/blog/day-trip-to-portovenere.json",
                "content/pages/blog/last-light-on-sentiero-azzurro.json",
            ]
        );
        assert_eq!(
            articles["content/pages/blog/day-trip-to-portovenere.json"],
            std::fs::read_to_string(site.join("content/pages/blog/day-trip-to-portovenere.json"))
                .unwrap()
        );
        // Without the articles the document is the pack.
        let pack = Pack::from_json(&doc.to_string()).unwrap();
        assert_eq!(pack, pack::build(&DirSource::new(&site), "c0ffee").unwrap());
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
