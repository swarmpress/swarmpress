//! `RepoApi::snapshot`: wiremock contract tests for the tarball route of
//! `HttpGitHub`, behavioural tests for `FakeGitHub`, and the snapshot as a
//! `knowledge::SiteSource` (the knowledge pack is built from it, ADR-0061).

use std::io::Write as _;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use flate2::write::GzEncoder;
use flate2::Compression;
use github::*;
use knowledge::{pack, DirSource, KnowledgeBase, SiteSource};
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const T0_MS: u64 = 1_780_000_000_000;
const SHA: &str = "3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b";
/// The directory `git archive` wraps a GitHub tarball in.
const TOP: &str = "acme-site-3f2a9c1";

fn repo() -> RepoId {
    RepoId::new("acme", "site")
}

struct Harness {
    server: MockServer,
    gh: HttpGitHub,
    sleeper: Arc<RecordingSleeper>,
}

async fn harness() -> Harness {
    let server = MockServer::start().await;
    let clock = ManualClock::new(T0_MS);
    let sleeper = RecordingSleeper::new(clock.clone());
    let gh = HttpGitHub::new(server.uri(), Arc::new(StaticToken("tok-dev".into())))
        .unwrap()
        .with_time(clock, sleeper.clone())
        .with_governor(Arc::new(Governor::new(GovernorConfig::default(), T0_MS)));
    Harness {
        server,
        gh,
        sleeper,
    }
}

// ---- a tar writer, shaped like `git archive` output -------------------------

#[derive(Default)]
struct Tar(Vec<u8>);

fn pax_record(key: &str, value: &str) -> String {
    let body = format!(" {key}={value}\n");
    let mut len = body.len() + 1;
    while (len.to_string().len() + body.len()) != len {
        len = len.to_string().len() + body.len();
    }
    format!("{len}{body}")
}

impl Tar {
    /// One entry: a ustar header, the data, zero padding to a 512-byte block.
    fn entry(&mut self, name: &str, kind: u8, data: &[u8]) -> &mut Self {
        let mut h = [0u8; 512];
        // Names over 100 bytes go into the ustar prefix field, as tar does.
        let (dir, base) = if name.len() > 100 {
            let cut = name[..name.len().min(156)].rfind('/').unwrap();
            (&name[..cut], &name[cut + 1..])
        } else {
            ("", name)
        };
        assert!(base.len() <= 100 && dir.len() <= 155, "{name}");
        h[..base.len()].copy_from_slice(base.as_bytes());
        h[100..108].copy_from_slice(b"0000644\0");
        h[108..116].copy_from_slice(b"0000000\0");
        h[116..124].copy_from_slice(b"0000000\0");
        h[124..136].copy_from_slice(format!("{:011o}\0", data.len()).as_bytes());
        h[136..148].copy_from_slice(b"14700000000\0");
        h[148..156].copy_from_slice(b"        ");
        h[156] = kind;
        h[257..263].copy_from_slice(b"ustar\0");
        h[263..265].copy_from_slice(b"00");
        h[345..345 + dir.len()].copy_from_slice(dir.as_bytes());
        let sum: u32 = h.iter().map(|b| u32::from(*b)).sum();
        h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        self.0.extend_from_slice(&h);
        self.0.extend_from_slice(data);
        self.0.resize(self.0.len().div_ceil(512) * 512, 0);
        self
    }

    /// The global pax header `git archive` writes first: the commit id.
    fn commit(&mut self, sha: &str) -> &mut Self {
        self.entry(
            "pax_global_header",
            b'g',
            pax_record("comment", sha).as_bytes(),
        )
    }

    fn dir(&mut self, path: &str) -> &mut Self {
        self.entry(&format!("{TOP}/{path}/"), b'5', b"")
    }

    fn file(&mut self, path: &str, data: impl AsRef<[u8]>) -> &mut Self {
        self.entry(&format!("{TOP}/{path}"), b'0', data.as_ref())
    }

    /// A file whose real path travels in a pax header (paths tar cannot split).
    fn pax_file(&mut self, path: &str, data: &str) -> &mut Self {
        let record = pax_record("path", &format!("{TOP}/{path}"));
        self.entry(&format!("{TOP}/PaxHeader"), b'x', record.as_bytes());
        self.entry(&format!("{TOP}/truncated"), b'0', data.as_bytes())
    }

    fn tar(&self) -> Vec<u8> {
        let mut out = self.0.clone();
        out.resize(out.len() + 1024, 0); // end of archive: two zero blocks
        out.resize(out.len().div_ceil(10240) * 10240, 0); // tar's record padding
        out
    }

    fn gz(&self) -> Vec<u8> {
        gzip(&self.tar())
    }
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(bytes).unwrap();
    enc.finish().unwrap()
}

async fn serve(h: &Harness, git_ref: &str, body: Vec<u8>) {
    Mock::given(method("GET"))
        .and(path(format!("/repos/acme/site/tarball/{git_ref}")))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
        .mount(&h.server)
        .await;
}

fn keys(s: &Snapshot) -> Vec<&str> {
    s.files.keys().map(String::as_str).collect()
}

// ---- HttpGitHub: the tarball route -------------------------------------------

#[tokio::test]
async fn tarball_snapshot_keeps_text_files_under_the_prefix() {
    let h = harness().await;
    let long = format!("content/pages/{}/deep.json", "nested-directory/".repeat(8));
    let pax = format!("content/{}.json", "x".repeat(140));
    let mut tar = Tar::default();
    tar.commit(SHA)
        .dir("content")
        .file("README.md", "# site\n")
        .file("content/site.json", "{\"name\": \"Site\"}\n")
        .dir("content/pages")
        .file("content/pages/index.json", "{\"id\": \"home\"}\n")
        .file("content/pages/empty.json", "")
        .file(&long, "{\"id\": \"deep\"}")
        .pax_file(&pax, "{\"id\": \"pax\"}")
        .file("content/pages/caffè.json", "{\"title\": \"Caffè\"}")
        // Not text: a NUL (PNG), and bytes that are not UTF-8 (Latin-1).
        .file("content/media/logo.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR")
        .file("content/notes-latin1.txt", b"caf\xe9")
        // A symlink is not a file.
        .entry(&format!("{TOP}/content/link.json"), b'2', b"")
        // Same leading characters, another directory.
        .file("contentx/other.json", "{}")
        .file("theme/content/tokens.json", "{}");
    // The API redirects to a signed download URL; the token must be sent to the API.
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/tarball/main"))
        .and(header("authorization", "Bearer tok-dev"))
        .and(header("x-github-api-version", "2022-11-28"))
        .respond_with(ResponseTemplate::new(302).insert_header(
            "location",
            format!(
                "{}/codeload/acme/site/legacy.tar.gz/main?token=t",
                h.server.uri()
            ),
        ))
        .mount(&h.server)
        .await;
    Mock::given(method("GET"))
        .and(path("/codeload/acme/site/legacy.tar.gz/main"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/x-gzip")
                .set_body_bytes(tar.gz()),
        )
        .mount(&h.server)
        .await;

    let snap = h.gh.snapshot(&repo(), "main", "/content/").await.unwrap();
    assert_eq!(snap.repo, repo());
    assert_eq!(snap.sha, SHA, "the commit comes from the archive");
    assert_eq!(snap.prefix, "content");
    let mut want = vec![
        "content/pages/caffè.json".to_string(),
        "content/pages/empty.json".into(),
        "content/pages/index.json".into(),
        long.clone(),
        "content/site.json".into(),
        pax.clone(),
    ];
    want.sort();
    assert_eq!(keys(&snap), want);
    assert_eq!(snap.files["content/site.json"], "{\"name\": \"Site\"}\n");
    assert_eq!(snap.files["content/pages/empty.json"], "");
    assert_eq!(snap.files[&long], "{\"id\": \"deep\"}");
    assert_eq!(snap.files[&pax], "{\"id\": \"pax\"}");
    assert_eq!(
        snap.files["content/pages/caffè.json"],
        "{\"title\": \"Caffè\"}"
    );
    assert_eq!(
        snap.skipped,
        vec!["content/media/logo.png", "content/notes-latin1.txt"]
    );
    assert_eq!(
        snap.text_bytes(),
        snap.files.values().map(|t| t.len() as u64).sum::<u64>()
    );

    // A narrower prefix, a single file, and the whole repository.
    let pages =
        h.gh.snapshot(&repo(), "main", "content/pages")
            .await
            .unwrap();
    assert_eq!(pages.files.len(), 4);
    assert!(pages.skipped.is_empty());
    let one =
        h.gh.snapshot(&repo(), "main", "content/site.json")
            .await
            .unwrap();
    assert_eq!(keys(&one), vec!["content/site.json"]);
    let all = h.gh.snapshot(&repo(), "main", "").await.unwrap();
    assert_eq!(all.files.len(), 9);
    assert_eq!(all.files["README.md"], "# site\n");
    assert_eq!(all.skipped.len(), 2);
}

#[tokio::test]
async fn tarball_snapshot_refs_and_commit_ids() {
    let h = harness().await;
    let mut tar = Tar::default();
    tar.commit(SHA).file("content/a.json", "{}");
    // A branch with slashes is sent as path segments, not percent-encoded.
    serve(&h, "drafts/content-x", tar.gz()).await;
    let snap =
        h.gh.snapshot(&repo(), "drafts/content-x", "content")
            .await
            .unwrap();
    assert_eq!(snap.sha, SHA);

    // A full sha is checked against the archive's commit.
    serve(&h, SHA, tar.gz()).await;
    assert_eq!(
        h.gh.snapshot(&repo(), SHA, "content").await.unwrap().sha,
        SHA
    );
    let other = "a".repeat(40);
    serve(&h, &other, tar.gz()).await;
    let e = h.gh.snapshot(&repo(), &other, "content").await.unwrap_err();
    assert!(matches!(e, GitHubError::Decode(_)), "{e}");

    // An archive without the commit comment: fine for a sha, not for a branch.
    let mut bare = Tar::default();
    bare.file("content/a.json", "{}");
    let sha2 = "b".repeat(40);
    serve(&h, &sha2, bare.gz()).await;
    assert_eq!(
        h.gh.snapshot(&repo(), &sha2, "content").await.unwrap().sha,
        sha2
    );
    serve(&h, "nocommit", bare.gz()).await;
    let e =
        h.gh.snapshot(&repo(), "nocommit", "content")
            .await
            .unwrap_err();
    assert!(matches!(e, GitHubError::Decode(_)), "{e}");

    let e = h.gh.snapshot(&repo(), "", "content").await.unwrap_err();
    assert!(matches!(e, GitHubError::InvalidArgument(_)), "{e}");
}

#[tokio::test]
async fn tarball_snapshot_size_caps() {
    let h = harness().await;
    let mut tar = Tar::default();
    tar.commit(SHA)
        .file("content/a.json", "a".repeat(600))
        .file("content/b.json", "b".repeat(600))
        // Binary files under the prefix are read past, not counted as text.
        .file("content/big.bin", vec![0u8; 20_000])
        .file("dist/bundle.js", "x".repeat(30_000));
    serve(&h, "main", tar.gz()).await;
    let limits = |text, archive| SnapshotLimits {
        max_text_bytes: text,
        max_archive_bytes: archive,
    };

    // Exactly at the text cap passes; files outside the prefix do not count.
    let gh = h.gh.with_snapshot_limits(limits(1200, 1_000_000));
    let snap = gh.snapshot(&repo(), "main", "content").await.unwrap();
    assert_eq!(snap.text_bytes(), 1200);
    assert_eq!(snap.skipped, vec!["content/big.bin"]);

    // One byte under: nothing partial is returned.
    let gh = gh.with_snapshot_limits(limits(1199, 1_000_000));
    let e = gh.snapshot(&repo(), "main", "content").await.unwrap_err();
    assert!(matches!(e, GitHubError::TooLarge(_)), "{e}");
    assert!(e.to_string().contains("1199"), "{e}");
    // With the whole repo as the prefix the bundle counts too.
    let gh = gh.with_snapshot_limits(limits(30_000, 1_000_000));
    let e = gh.snapshot(&repo(), "main", "").await.unwrap_err();
    assert!(matches!(e, GitHubError::TooLarge(_)), "{e}");

    // The unpacked archive is capped whatever the prefix.
    let gh = gh.with_snapshot_limits(limits(1200, 40_000));
    let e = gh.snapshot(&repo(), "main", "content").await.unwrap_err();
    assert!(matches!(e, GitHubError::TooLarge(_)), "{e}");
    assert!(e.to_string().contains("40000"), "{e}");

    let d = SnapshotLimits::default();
    assert!(d.max_text_bytes < d.max_archive_bytes);
}

#[tokio::test]
async fn tarball_snapshot_rejects_damaged_archives() {
    let h = harness().await;
    let mut tar = Tar::default();
    tar.commit(SHA)
        .file("content/a.json", "{\"a\": 1}")
        .file("content/b.json", "b".repeat(5000));
    let whole = tar.gz();

    // Cut off mid-stream: never a partial tree.
    serve(&h, "cut-gzip", whole[..whole.len() / 2].to_vec()).await;
    let e =
        h.gh.snapshot(&repo(), "cut-gzip", "content")
            .await
            .unwrap_err();
    assert!(matches!(e, GitHubError::Decode(_)), "{e}");
    // A complete gzip stream of a tar that stops inside a file.
    serve(&h, "cut-tar", gzip(&tar.tar()[..2048])).await;
    let e =
        h.gh.snapshot(&repo(), "cut-tar", "content")
            .await
            .unwrap_err();
    assert!(matches!(e, GitHubError::Decode(_)), "{e}");
    assert!(e.to_string().contains("end-of-archive"), "{e}");
    // Not gzip at all (an HTML error page, say).
    serve(&h, "html", b"<html>Bad gateway</html>".to_vec()).await;
    let e = h.gh.snapshot(&repo(), "html", "content").await.unwrap_err();
    assert!(matches!(e, GitHubError::Decode(_)), "{e}");
    // gzip of something that is not a tar.
    serve(&h, "not-tar", gzip(&[b'x'; 2048])).await;
    let e =
        h.gh.snapshot(&repo(), "not-tar", "content")
            .await
            .unwrap_err();
    assert!(e.to_string().contains("checksum"), "{e}");
}

/// The response body arrives in chunks of any size: headers, pax records and
/// file bodies may be split anywhere.
#[test]
fn tarball_decoding_does_not_depend_on_chunk_boundaries() {
    let pax = format!("content/{}.json", "x".repeat(140));
    let mut tar = Tar::default();
    tar.commit(SHA)
        .dir("content")
        .file("content/a.json", "a".repeat(511))
        .file("content/b.json", "b".repeat(512))
        .file("content/c.json", "c".repeat(513))
        .file("content/empty.json", "")
        .pax_file(&pax, "{\"id\": \"pax\"}")
        .file("content/logo.png", b"\x89PNG\0\0")
        .file("README.md", "r".repeat(3000));
    let gz = tar.gz();
    let decode = |bytes: &[u8], size: usize, git_ref: &str| {
        Snapshot::from_tarball(
            bytes.chunks(size),
            &repo(),
            git_ref,
            "content",
            SnapshotLimits::default(),
        )
        .unwrap()
    };
    let whole = decode(&gz, gz.len(), "main");
    assert_eq!(whole.sha, SHA);
    assert_eq!(whole.files.len(), 5);
    assert_eq!(whole.files["content/b.json"].len(), 512);
    assert_eq!(whole.files[&pax], "{\"id\": \"pax\"}");
    assert_eq!(whole.skipped, vec!["content/logo.png"]);
    for size in [1, 2, 7, 100, 511, 512, 513, 4096] {
        assert_eq!(decode(&gz, size, "main"), whole, "chunks of {size}");
    }
    // Stored (uncompressed) gzip hands the tar reader the input chunks as
    // they are, so the tar blocks themselves are split at every offset.
    let mut enc = GzEncoder::new(Vec::new(), Compression::none());
    enc.write_all(&tar.tar()).unwrap();
    let stored = enc.finish().unwrap();
    for size in [1, 3, 500, 512, 1000] {
        assert_eq!(
            decode(&stored, size, SHA),
            whole,
            "stored, chunks of {size}"
        );
    }
}

#[tokio::test]
async fn tarball_snapshot_maps_statuses_and_retries_rate_limits() {
    let h = harness().await;
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/tarball/gone"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "message": "Not Found" })))
        .mount(&h.server)
        .await;
    let e = h.gh.snapshot(&repo(), "gone", "content").await.unwrap_err();
    assert!(e.is_not_found(), "{e}");

    let mut tar = Tar::default();
    tar.commit(SHA).file("content/a.json", "{}");
    Mock::given(method("GET"))
        .and(path("/repos/acme/site/tarball/main"))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "7")
                .set_body_json(json!({ "message": "You have exceeded a secondary rate limit" })),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&h.server)
        .await;
    serve(&h, "main", tar.gz()).await;
    let snap = h.gh.snapshot(&repo(), "main", "content").await.unwrap();
    assert_eq!(keys(&snap), vec!["content/a.json"]);
    assert_eq!(h.sleeper.sleeps(), vec![Duration::from_secs(7)]);
}

/// A tarball downloaded from GitHub, against a clone at the same commit.
/// Ignored by default (needs both on disk):
///
/// ```sh
/// curl -sSL -o site.tar.gz https://api.github.com/repos/swarmpress/cinqueterre.travel/tarball/main
/// SNAPSHOT_TARBALL=site.tar.gz CINQUETERRE_REPO=<clone> \
///   cargo test -p github --test snapshot -- --ignored --nocapture
/// ```
#[test]
#[ignore = "needs SNAPSHOT_TARBALL (a GitHub tarball) and CINQUETERRE_REPO (a clone at that commit)"]
fn real_tarball_gives_the_pack_of_the_clone() {
    let tarball = std::env::var("SNAPSHOT_TARBALL").expect("SNAPSHOT_TARBALL");
    let clone = std::env::var("CINQUETERRE_REPO").expect("CINQUETERRE_REPO");
    let bytes = std::fs::read(&tarball).unwrap();
    let site = RepoId::new("swarmpress", "cinqueterre.travel");
    let snap = Snapshot::from_tarball(
        bytes.chunks(16 * 1024),
        &site,
        "main",
        "content",
        SnapshotLimits::default(),
    )
    .unwrap();
    println!(
        "{}: {} text files, {} bytes, skipped {:?}",
        snap.label(),
        snap.files.len(),
        snap.text_bytes(),
        snap.skipped
    );
    assert_eq!(snap.sha.len(), 40);
    let from_snapshot = pack::build(&snap, &snap.sha).unwrap();
    assert_eq!(from_snapshot.pages.len(), 157);
    assert_eq!(pack::load(&from_snapshot).unwrap().media.len(), 338);
    let from_clone = pack::build(&DirSource::new(clone), &snap.sha).unwrap();
    assert_eq!(
        from_snapshot.to_json().unwrap(),
        from_clone.to_json().unwrap()
    );
}

// ---- FakeGitHub ------------------------------------------------------------------

fn fake() -> FakeGitHub {
    let f = FakeGitHub::new();
    f.create_repo(
        &repo(),
        &[
            ("content/pages/en/index.json", "{\"id\":\"home\"}\n"),
            ("content/site.json", "{}\n"),
            ("contentx/other.json", "{}\n"),
            ("theme/tokens.json", "{}\n"),
            ("README.md", "hi\n"),
        ],
    );
    f
}

#[tokio::test]
async fn fake_snapshot_enumerates_the_tree_at_a_ref() {
    let f = fake();
    let main = f.branch_head(&repo(), "main").unwrap();
    let snap = f.snapshot(&repo(), "main", "content/").await.unwrap();
    assert_eq!(snap.sha, main);
    assert_eq!(snap.prefix, "content");
    assert_eq!(
        keys(&snap),
        vec!["content/pages/en/index.json", "content/site.json"]
    );
    assert_eq!(snap.files["content/site.json"], "{}\n");
    assert!(snap.skipped.is_empty());
    assert_eq!(
        f.snapshot(&repo(), "main", "").await.unwrap().files.len(),
        5
    );

    // A draft branch: its own files, a binary one skipped; main is unchanged.
    f.create_branch(&repo(), "drafts/content-x", "main")
        .await
        .unwrap();
    for (path, content) in [
        ("content/pages/blog/new.json", b"{\"id\":\"new\"}".to_vec()),
        (
            "content/media/photo.jpg",
            vec![0xff, 0xd8, 0xff, 0xe0, 0, 16],
        ),
    ] {
        f.put_file(
            &repo(),
            &PutFile {
                branch: "drafts/content-x".into(),
                path: path.into(),
                content,
                message: format!("write {path}"),
                expected_sha: None,
                author: None,
            },
        )
        .await
        .unwrap();
    }
    let draft = f
        .snapshot(&repo(), "drafts/content-x", "content")
        .await
        .unwrap();
    assert_eq!(
        draft.sha,
        f.branch_head(&repo(), "drafts/content-x").unwrap()
    );
    assert_eq!(draft.files.len(), 3);
    assert_eq!(draft.skipped, vec!["content/media/photo.jpg"]);
    // By commit sha: the tree as it was, whatever the branches did since.
    let at_main = f.snapshot(&repo(), &main, "content").await.unwrap();
    assert_eq!(at_main, snap);

    assert!(f
        .snapshot(&repo(), "nope", "content")
        .await
        .unwrap_err()
        .is_not_found());
    assert!(f
        .snapshot(&RepoId::new("acme", "nope"), "main", "content")
        .await
        .unwrap_err()
        .is_not_found());
    f.fail_next("snapshot", GitHubError::TooLarge("content".into()));
    assert!(matches!(
        f.snapshot(&repo(), "main", "content").await,
        Err(GitHubError::TooLarge(_))
    ));
    assert_eq!(
        f.calls().iter().filter(|c| *c == "snapshot").count(),
        7,
        "{:?}",
        f.calls()
    );
}

#[tokio::test]
async fn guarded_repo_lets_every_actor_snapshot() {
    let inner: Arc<dyn RepoApi> = Arc::new(fake());
    for actor in [
        ActorKind::ContentAgent,
        ActorKind::DesignAgent,
        ActorKind::PlatformBot,
    ] {
        let guarded = GuardedRepo::new(inner.clone(), actor);
        let snap = guarded.snapshot(&repo(), "main", "theme").await.unwrap();
        assert_eq!(keys(&snap), vec!["theme/tokens.json"]);
    }
}

// ---- the snapshot as a site source -------------------------------------------------

fn fixture() -> DirSource {
    DirSource::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../knowledge/tests/fixtures/cinqueterre-mini"),
    )
}

fn fixture_files() -> Vec<(String, String)> {
    let dir = fixture();
    dir.list("")
        .unwrap()
        .into_iter()
        .map(|p| {
            let text = String::from_utf8(dir.read(&p).unwrap().unwrap()).unwrap();
            (p, text)
        })
        .collect()
}

#[tokio::test]
async fn snapshot_reads_like_a_checkout() {
    let f = fake();
    let snap = f.snapshot(&repo(), "main", "content").await.unwrap();
    assert_eq!(snap.label(), format!("acme/site@{}", snap.sha));
    assert_eq!(
        snap.read("content/site.json").unwrap().as_deref(),
        Some(b"{}\n".as_slice())
    );
    assert_eq!(
        snap.read_json("content/pages/en/index.json").unwrap(),
        Some(json!({"id": "home"}))
    );
    assert_eq!(snap.read("content/nope.json").unwrap(), None);
    assert_eq!(
        snap.list("content/pages").unwrap(),
        vec!["content/pages/en/index.json"]
    );
    assert_eq!(snap.list("content/").unwrap().len(), 2);
    assert_eq!(snap.list_json("").unwrap().len(), 2);
    assert!(snap.list("content/site.json").unwrap().is_empty());
    // Outside the prefix the snapshot holds nothing.
    assert_eq!(snap.read("README.md").unwrap(), None);
    assert!(snap.list("theme").unwrap().is_empty());
}

/// The server builds the pack from a snapshot of `content/`; `cargo xtask
/// site-pack` builds it from a clone. Same commit, same bytes.
#[tokio::test]
async fn pack_from_a_snapshot_equals_pack_from_a_checkout() {
    let files = fixture_files();
    assert!(files.len() > 20 && files.iter().any(|(p, _)| p.starts_with("theme/")));
    let from_checkout = |commit: &str| pack::build(&fixture(), commit).unwrap().to_json().unwrap();

    // FakeGitHub.
    let f = FakeGitHub::new();
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    f.create_repo(&repo(), &refs);
    let snap = f.snapshot(&repo(), "main", "content").await.unwrap();
    assert!(snap.files.keys().all(|p| p.starts_with("content/")));
    let from_fake = pack::build(&snap, &snap.sha).unwrap();
    assert_eq!(from_fake.commit, snap.sha);
    assert_eq!(from_fake.to_json().unwrap(), from_checkout(&snap.sha));

    // HttpGitHub, through the tarball.
    let h = harness().await;
    let mut tar = Tar::default();
    tar.commit(SHA);
    for (p, t) in &files {
        tar.file(p, t);
    }
    serve(&h, "main", tar.gz()).await;
    let snap = h.gh.snapshot(&repo(), "main", "content").await.unwrap();
    let from_http = pack::build(&snap, &snap.sha).unwrap();
    assert_eq!(from_http.to_json().unwrap(), from_checkout(SHA));

    // And the indexes build from it as from the checkout.
    let kb = KnowledgeBase::build(&snap).unwrap();
    assert_eq!((kb.pages.len(), kb.media.len()), (9, 20));
    assert_eq!(kb.label, format!("acme/site@{SHA}"));
    assert_eq!(
        kb.collections
            .file("restaurants", "riomaggiore")
            .unwrap()
            .items
            .len(),
        20
    );
}
