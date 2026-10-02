//! Repository snapshots: the text files under a path prefix at one commit
//! ([`crate::RepoApi::snapshot`]).
//!
//! The knowledge pack (ADR-0061) is built from all of `content/` at the base
//! head. Reading some 250 files one by one through the contents API would
//! cost that many requests per commit, so [`crate::HttpGitHub`] reads the
//! repository tarball instead: one request, decoded as it streams, keeping
//! only the files under the prefix. [`crate::FakeGitHub`] enumerates its
//! tree and returns the same shape.
//!
//! [`Snapshot`] implements [`knowledge::SiteSource`], so the indexes and the
//! pack build from it exactly as from a checkout.

use std::collections::BTreeMap;
use std::io::{self, Write};

use flate2::write::GzDecoder;
use knowledge::{KnowledgeError, SiteSource};

use crate::error::{GitHubError, Result};
use crate::types::RepoId;

/// The text files under a prefix at one commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub repo: RepoId,
    /// Full sha of the commit the ref pointed at when the snapshot was taken.
    pub sha: String,
    /// The prefix asked for, without leading or trailing `/`. Empty: the whole repo.
    pub prefix: String,
    /// Repo path → text, for every UTF-8 file under the prefix.
    pub files: BTreeMap<String, String>,
    /// Files under the prefix that were left out because they are not text.
    pub skipped: Vec<String>,
}

impl Snapshot {
    /// Bytes of text held.
    pub fn text_bytes(&self) -> u64 {
        self.files.values().map(|t| t.len() as u64).sum()
    }

    /// Decodes a repository tarball (`.tar.gz`, as GitHub's tarball route and
    /// `git archive --prefix=<dir>/` produce it) given in pieces of any size.
    /// This is what [`crate::HttpGitHub`] runs on the response body; it is
    /// public for tarballs obtained another way. `git_ref` is the ref the
    /// tarball was taken at: the commit comes from the archive, and a full
    /// sha must match it.
    pub fn from_tarball<I>(
        chunks: I,
        repo: &RepoId,
        git_ref: &str,
        prefix: &str,
        limits: SnapshotLimits,
    ) -> Result<Snapshot>
    where
        I: IntoIterator,
        I::Item: AsRef<[u8]>,
    {
        let mut reader = TarballReader::new(prefix, limits);
        for chunk in chunks {
            reader.feed(chunk.as_ref())?;
        }
        reader.finish(repo, git_ref)
    }
}

/// A [`Snapshot`] is a read-only tree. Paths outside its prefix read as
/// absent, so take the snapshot at a prefix that covers what the reader needs
/// (`content` for the knowledge indexes and the pack).
impl SiteSource for Snapshot {
    fn read(&self, path: &str) -> std::result::Result<Option<Vec<u8>>, KnowledgeError> {
        Ok(self.files.get(path).map(|t| t.clone().into_bytes()))
    }

    fn list(&self, dir: &str) -> std::result::Result<Vec<String>, KnowledgeError> {
        let dir = clean_prefix(dir);
        Ok(self
            .files
            .keys()
            .filter(|p| dir.is_empty() || (p.len() > dir.len() && in_prefix(p, &dir)))
            .cloned()
            .collect())
    }

    fn label(&self) -> String {
        format!("{}@{}", self.repo, self.sha)
    }
}

/// Size caps for [`crate::HttpGitHub`] snapshots. Exceeding one fails the
/// snapshot with [`GitHubError::TooLarge`]: a partial tree would be a wrong
/// closed world, so nothing is returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnapshotLimits {
    /// Most bytes of unpacked archive read. The whole repository at the ref
    /// streams through, whatever the prefix.
    pub max_archive_bytes: u64,
    /// Most bytes of text kept: the files under the prefix.
    pub max_text_bytes: u64,
}

impl Default for SnapshotLimits {
    fn default() -> Self {
        Self {
            max_archive_bytes: 256 * 1024 * 1024,
            max_text_bytes: 32 * 1024 * 1024,
        }
    }
}

pub(crate) fn clean_prefix(prefix: &str) -> String {
    prefix.trim_matches('/').to_string()
}

/// Whether `path` is `prefix` itself or lies below it (`prefix` cleaned).
pub(crate) fn in_prefix(path: &str, prefix: &str) -> bool {
    prefix.is_empty()
        || path
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// The bytes as text, unless they are not UTF-8 or hold a NUL.
pub(crate) fn as_text(bytes: Vec<u8>) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub(crate) fn is_full_sha(s: &str) -> bool {
    s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())
}

// ---- tarball ---------------------------------------------------------------

const BLOCK: usize = 512;
/// pax headers and GNU long names are a few hundred bytes; refuse absurd ones.
const MAX_META_BYTES: u64 = 1024 * 1024;

enum Entry {
    /// Not a regular file under the prefix: read past it.
    Skip,
    /// A regular file under the prefix. `text` is `None` once a NUL showed
    /// that it is not text, so the rest is read past, not buffered.
    File { path: String, text: Option<Vec<u8>> },
    /// A pax global header (`g`), a pax header for the next entry (`x`) or a
    /// GNU long name (`L`).
    Meta { kind: u8, data: Vec<u8> },
}

enum State {
    Header,
    Body {
        entry: Entry,
        remaining: u64,
        padding: u64,
    },
    /// The end-of-archive block was read; what follows is padding.
    Done,
}

/// Incremental tar reader: tar bytes go in through [`Write`] in chunks of any
/// size; the files under the prefix come out.
struct Untar {
    prefix: String,
    limits: SnapshotLimits,
    state: State,
    /// The header block being collected.
    block: Vec<u8>,
    /// Path and size for the next entry, from a pax or GNU header.
    next_path: Option<String>,
    next_size: Option<u64>,
    unpacked: u64,
    kept: u64,
    sha: Option<String>,
    files: BTreeMap<String, String>,
    skipped: Vec<String>,
    /// The typed error behind an `io::Error` returned from `write`.
    error: Option<GitHubError>,
}

fn decode(what: impl std::fmt::Display) -> GitHubError {
    GitHubError::Decode(format!("tarball: {what}"))
}

/// A NUL- or space-terminated octal field; base-256 when the top bit is set.
fn tar_number(field: &[u8]) -> Option<u64> {
    if field.first().is_some_and(|b| b & 0x80 != 0) {
        return field.iter().enumerate().try_fold(0u64, |acc, (i, &b)| {
            let b = if i == 0 { b & 0x7f } else { b };
            acc.checked_mul(256)?.checked_add(u64::from(b))
        });
    }
    let digits: Vec<u8> = field
        .iter()
        .copied()
        .skip_while(|b| *b == b' ')
        .take_while(|b| *b != 0 && *b != b' ')
        .collect();
    digits.iter().try_fold(0u64, |acc, &d| {
        if !(b'0'..=b'7').contains(&d) {
            return None;
        }
        acc.checked_mul(8)?.checked_add(u64::from(d - b'0'))
    })
}

fn tar_str(field: &[u8]) -> String {
    let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

/// Value of `key` in pax records (`"<len> <key>=<value>\n"`, `len` counting
/// the whole record).
fn pax_value(data: &[u8], key: &str) -> Option<String> {
    let mut rest = data;
    while !rest.is_empty() {
        let space = rest.iter().position(|b| *b == b' ')?;
        let len: usize = std::str::from_utf8(&rest[..space]).ok()?.parse().ok()?;
        if len <= space + 1 || len > rest.len() {
            return None;
        }
        let record = &rest[space + 1..len];
        let record = record.strip_suffix(b"\n").unwrap_or(record);
        if let Some(eq) = record.iter().position(|b| *b == b'=') {
            if &record[..eq] == key.as_bytes() {
                return Some(String::from_utf8_lossy(&record[eq + 1..]).into_owned());
            }
        }
        rest = &rest[len..];
    }
    None
}

impl Untar {
    fn new(prefix: &str, limits: SnapshotLimits) -> Self {
        Self {
            prefix: clean_prefix(prefix),
            limits,
            state: State::Header,
            block: Vec::with_capacity(BLOCK),
            next_path: None,
            next_size: None,
            unpacked: 0,
            kept: 0,
            sha: None,
            files: BTreeMap::new(),
            skipped: Vec::new(),
            error: None,
        }
    }

    fn push(&mut self, mut input: &[u8]) -> Result<()> {
        self.unpacked += input.len() as u64;
        if self.unpacked > self.limits.max_archive_bytes {
            return Err(GitHubError::TooLarge(format!(
                "the repository archive is over {} bytes unpacked",
                self.limits.max_archive_bytes
            )));
        }
        while !input.is_empty() {
            match std::mem::replace(&mut self.state, State::Header) {
                State::Done => {
                    self.state = State::Done;
                    return Ok(());
                }
                State::Header => {
                    let take = (BLOCK - self.block.len()).min(input.len());
                    self.block.extend_from_slice(&input[..take]);
                    input = &input[take..];
                    if self.block.len() == BLOCK {
                        let block = std::mem::replace(&mut self.block, Vec::with_capacity(BLOCK));
                        self.state = self.header(&block)?;
                    }
                }
                State::Body {
                    mut entry,
                    mut remaining,
                    mut padding,
                } => {
                    let take = usize::try_from(remaining)
                        .unwrap_or(usize::MAX)
                        .min(input.len());
                    self.absorb(&mut entry, &input[..take])?;
                    remaining -= take as u64;
                    input = &input[take..];
                    if remaining == 0 {
                        let skip = usize::try_from(padding)
                            .unwrap_or(usize::MAX)
                            .min(input.len());
                        padding -= skip as u64;
                        input = &input[skip..];
                    }
                    if remaining == 0 && padding == 0 {
                        self.finish_entry(entry);
                    } else {
                        self.state = State::Body {
                            entry,
                            remaining,
                            padding,
                        };
                    }
                }
            }
        }
        Ok(())
    }

    fn header(&mut self, b: &[u8]) -> Result<State> {
        if b.iter().all(|x| *x == 0) {
            return Ok(State::Done);
        }
        let sum: u64 = b
            .iter()
            .enumerate()
            .map(|(i, x)| u64::from(if (148..156).contains(&i) { b' ' } else { *x }))
            .sum();
        if tar_number(&b[148..156]) != Some(sum) {
            return Err(decode("bad header checksum (not a tar archive?)"));
        }
        let field_size = tar_number(&b[124..136]).ok_or_else(|| decode("bad size field"))?;
        let kind = b[156];
        let (entry, size) = if matches!(kind, b'g' | b'x' | b'L') {
            if field_size > MAX_META_BYTES {
                return Err(decode(format!("{field_size}-byte extended header")));
            }
            (
                Entry::Meta {
                    kind,
                    data: Vec::new(),
                },
                field_size,
            )
        } else {
            let size = self.next_size.take().unwrap_or(field_size);
            let path = self.next_path.take().unwrap_or_else(|| {
                let name = tar_str(&b[..100]);
                let dir = tar_str(&b[345..500]);
                if &b[257..262] == b"ustar" && !dir.is_empty() {
                    format!("{dir}/{name}")
                } else {
                    name
                }
            });
            // The archive wraps the tree in one directory (`owner-repo-sha/`).
            let rel = path.split_once('/').map(|(_, rel)| rel).unwrap_or("");
            let regular = matches!(kind, b'0' | 0 | b'7');
            let wanted = regular && !rel.is_empty() && in_prefix(rel, &self.prefix);
            let entry = if wanted {
                Entry::File {
                    path: rel.to_string(),
                    text: Some(Vec::new()),
                }
            } else {
                Entry::Skip
            };
            (entry, size)
        };
        if size == 0 {
            self.finish_entry(entry);
            return Ok(State::Header);
        }
        let block = BLOCK as u64;
        Ok(State::Body {
            entry,
            remaining: size,
            padding: (block - size % block) % block,
        })
    }

    fn absorb(&mut self, entry: &mut Entry, chunk: &[u8]) -> Result<()> {
        match entry {
            Entry::Skip => {}
            Entry::Meta { data, .. } => data.extend_from_slice(chunk),
            Entry::File { text, .. } => {
                let Some(buf) = text else {
                    return Ok(());
                };
                if chunk.contains(&0) {
                    *text = None;
                    return Ok(());
                }
                let held = self.kept + buf.len() as u64 + chunk.len() as u64;
                if held > self.limits.max_text_bytes {
                    return Err(GitHubError::TooLarge(format!(
                        "the files under `{}` are over {} bytes",
                        self.prefix, self.limits.max_text_bytes
                    )));
                }
                buf.extend_from_slice(chunk);
            }
        }
        Ok(())
    }

    fn finish_entry(&mut self, entry: Entry) {
        match entry {
            Entry::Skip => {}
            Entry::File { path, text } => match text.and_then(|b| String::from_utf8(b).ok()) {
                Some(text) => {
                    self.kept += text.len() as u64;
                    self.files.insert(path, text);
                }
                None => self.skipped.push(path),
            },
            // `git archive` records the commit as a global pax comment.
            Entry::Meta { kind: b'g', data } => {
                if let Some(sha) = pax_value(&data, "comment") {
                    self.sha = Some(sha);
                }
            }
            Entry::Meta { kind: b'x', data } => {
                self.next_path = pax_value(&data, "path");
                self.next_size = pax_value(&data, "size").and_then(|s| s.parse().ok());
            }
            Entry::Meta { data, .. } => self.next_path = Some(tar_str(&data)),
        }
    }
}

impl Write for Untar {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self.push(buf) {
            Ok(()) => Ok(buf.len()),
            Err(e) => {
                let io = io::Error::other(e.to_string());
                self.error = Some(e);
                Err(io)
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Decodes a `.tar.gz` of a repository as it arrives: feed the response body
/// chunk by chunk, then [`Self::finish`]. Memory held is the text under the
/// prefix (capped) plus one decompression window.
pub(crate) struct TarballReader {
    gz: GzDecoder<Untar>,
}

impl TarballReader {
    pub(crate) fn new(prefix: &str, limits: SnapshotLimits) -> Self {
        Self {
            gz: GzDecoder::new(Untar::new(prefix, limits)),
        }
    }

    fn error(&mut self, e: io::Error) -> GitHubError {
        self.gz.get_mut().error.take().unwrap_or_else(|| decode(e))
    }

    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Result<()> {
        self.gz.write_all(chunk).map_err(|e| self.error(e))
    }

    /// `git_ref` is what was asked for. The commit comes from the archive; a
    /// full sha asked for must match it.
    pub(crate) fn finish(mut self, repo: &RepoId, git_ref: &str) -> Result<Snapshot> {
        if let Err(e) = self.gz.try_finish() {
            return Err(self.error(e));
        }
        let tar = self.gz.get_mut();
        if !matches!(tar.state, State::Done) {
            return Err(decode("ended before the end-of-archive block"));
        }
        let sha = match tar.sha.take() {
            Some(sha) if is_full_sha(git_ref) && !sha.eq_ignore_ascii_case(git_ref) => {
                return Err(decode(format!("is of commit {sha}, not {git_ref}")));
            }
            Some(sha) => sha,
            None if is_full_sha(git_ref) => git_ref.to_string(),
            None => return Err(decode("carries no commit id")),
        };
        let mut skipped = std::mem::take(&mut tar.skipped);
        skipped.sort();
        Ok(Snapshot {
            repo: repo.clone(),
            sha,
            prefix: tar.prefix.clone(),
            files: std::mem::take(&mut tar.files),
            skipped,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_matching_is_by_path_segment() {
        assert!(in_prefix("content/pages/a.json", "content"));
        assert!(in_prefix("content", "content"));
        assert!(!in_prefix("contentx/a.json", "content"));
        assert!(!in_prefix("theme/content/a.json", "content"));
        assert!(in_prefix("anything", ""));
        assert_eq!(clean_prefix("/content/pages/"), "content/pages");
    }

    #[test]
    fn tar_fields() {
        assert_eq!(tar_number(b"0000644\0"), Some(0o644));
        assert_eq!(tar_number(b"     17 \0"), Some(0o17));
        assert_eq!(tar_number(b"\0\0\0\0"), Some(0));
        assert_eq!(tar_number(b"12x4"), None);
        assert_eq!(tar_number(&[0x80, 0, 0, 1, 0]), Some(256));
        assert_eq!(tar_str(b"abc\0\0"), "abc");
        let pax = b"30 mtime=1700000000.123456789\n19 path=a/b/c.json\n";
        assert_eq!(pax_value(pax, "path").as_deref(), Some("a/b/c.json"));
        assert_eq!(pax_value(pax, "size"), None);
        assert_eq!(pax_value(b"999 path=x\n", "path"), None);
        assert_eq!(pax_value(b"garbage", "path"), None);
    }

    #[test]
    fn text_is_utf8_without_nul() {
        assert_eq!(as_text("héllo\n".into()).as_deref(), Some("héllo\n"));
        assert_eq!(as_text(vec![0x89, b'P', b'N', b'G']), None);
        assert_eq!(as_text(b"a\0b".to_vec()), None);
    }
}
