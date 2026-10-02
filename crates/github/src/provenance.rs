//! Provenance of the commits swarm.press makes in a site repository
//! (ADR-0056 decision 8, as narrowed by ADR-0058 decision 10).
//!
//! - A **draft-branch commit** carries the staff persona as git author. The
//!   committer is left to GitHub, which uses the authenticated identity (the
//!   token's user or the App): that is the swarm.press identity.
//! - The **squash commit** of a merge keeps that identity as author, because
//!   the merge API has no author field. The persona is named in a
//!   `Co-authored-by` trailer instead, next to the provenance trailers `Job`,
//!   `Job-Kind`, `Work-Item`, `Model`, `Executor`, `Reviewed-by` and
//!   `Approved-by`.
//!
//! A [`Provenance`] comes from an untrusted client (the browser's
//! orchestrator). [`Provenance::from_json`] refuses anything that could break
//! a commit header or forge a trailer: every value is one line, capped in
//! length, and identifiers are limited to a safe alphabet. The author's email
//! is never taken from the client: [`staff_email`] synthesises it.

use serde_json::Value;

use crate::types::CommitAuthor;

/// Mail domain of synthesised staff addresses when none is configured.
pub const DEFAULT_EMAIL_DOMAIN: &str = "staff.swarm.press";

const MAX_ID: usize = 64;
const MAX_NAME: usize = 100;
const MAX_WORK_ITEM: usize = 100;
const MAX_TEXT: usize = 120;
const MAX_REVISION: u64 = 1000;

const FIELDS: &[&str] = &[
    "staff_id",
    "persona",
    "name",
    "role",
    "job_id",
    "job_kind",
    "revision",
    "work_item",
    "model",
    "executor",
    "reviewed_by",
    "approved_by",
];

/// Who did the work behind a commit, and in which job.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Provenance {
    /// The sim's staff id, e.g. `staff-1`.
    pub staff_id: String,
    /// The persona's display name, e.g. `Giulia Rossi`: the git author name.
    pub name: String,
    /// Persona catalog slug, e.g. `giulia`.
    pub persona: Option<String>,
    /// Kebab-case role, e.g. `writer`.
    pub role: Option<String>,
    pub job_id: Option<String>,
    /// `draft`, `review`, `publish`, ...
    pub job_kind: Option<String>,
    pub revision: Option<u32>,
    pub work_item: Option<String>,
    /// The model that wrote the text, e.g. `ternary-bonsai-2-27b`.
    pub model: Option<String>,
    /// The executor that ran the job (ADR-0045), e.g. `browser laptop epoch 3`.
    pub executor: Option<String>,
    /// Who reviewed the article (the editor's name).
    pub reviewed_by: Option<String>,
    /// Who approved the publish (the CEO, ADR-0059).
    pub approved_by: Option<String>,
}

fn is_single_line(s: &str) -> bool {
    !s.chars()
        .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}' | '\u{85}'))
}

/// An identifier: `[A-Za-z0-9._:-]`, 1 to `max` bytes.
fn ident(field: &str, s: &str, max: usize) -> Result<String, String> {
    let ok = !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b':' | b'-'));
    if ok {
        Ok(s.to_string())
    } else {
        Err(format!(
            "attribution.{field} must be 1-{max} of [A-Za-z0-9._:-]"
        ))
    }
}

/// Free text on one line, 1 to `max` characters after trimming.
fn line(field: &str, s: &str, max: usize) -> Result<String, String> {
    let t = s.trim();
    if t.is_empty() || t.chars().count() > max {
        return Err(format!("attribution.{field} must be 1-{max} characters"));
    }
    if !is_single_line(t) {
        return Err(format!("attribution.{field} must be a single line"));
    }
    Ok(t.to_string())
}

/// A person's name: one line, and no `<` or `>` (they delimit the email in
/// a git identity and in a `Co-authored-by` trailer).
fn person(field: &str, s: &str) -> Result<String, String> {
    let t = line(field, s, MAX_NAME)?;
    if t.contains(['<', '>']) {
        return Err(format!("attribution.{field} must not contain < or >"));
    }
    Ok(t)
}

fn text_of<'a>(field: &str, v: &'a Value) -> Result<&'a str, String> {
    v.as_str()
        .ok_or_else(|| format!("attribution.{field} must be a string"))
}

impl Provenance {
    /// Parse and validate the `attribution` object of a gateway request:
    /// `{staff_id, name, persona?, role?, job_id?, job_kind?, revision?,
    /// work_item?, model?, executor?, reviewed_by?, approved_by?}`.
    /// `staff_id` and `name` are required; `null` counts as absent; an
    /// unknown field is an error. `job_id` may be a string or a non-negative
    /// integer.
    pub fn from_json(v: &Value) -> Result<Self, String> {
        let obj = v
            .as_object()
            .ok_or_else(|| "attribution must be an object".to_string())?;
        if let Some(unknown) = obj.keys().find(|k| !FIELDS.contains(&k.as_str())) {
            return Err(format!("attribution.{unknown} is not a known field"));
        }
        let get = |field: &str| obj.get(field).filter(|v| !v.is_null());
        let required =
            |field: &str| get(field).ok_or_else(|| format!("attribution.{field} is required"));
        let opt_ident = |field: &str, max: usize| -> Result<Option<String>, String> {
            get(field)
                .map(|v| ident(field, text_of(field, v)?, max))
                .transpose()
        };
        let opt_line = |field: &str| -> Result<Option<String>, String> {
            get(field)
                .map(|v| line(field, text_of(field, v)?, MAX_TEXT))
                .transpose()
        };
        let opt_person = |field: &str| -> Result<Option<String>, String> {
            get(field)
                .map(|v| person(field, text_of(field, v)?))
                .transpose()
        };

        let staff_id = ident(
            "staff_id",
            text_of("staff_id", required("staff_id")?)?,
            MAX_ID,
        )?;
        let name = person("name", text_of("name", required("name")?)?)?;
        let job_id = match get("job_id") {
            None => None,
            Some(Value::Number(n)) => Some(
                n.as_u64()
                    .ok_or_else(|| "attribution.job_id must not be negative".to_string())?
                    .to_string(),
            ),
            Some(v) => Some(ident("job_id", text_of("job_id", v)?, MAX_ID)?),
        };
        let revision = match get("revision") {
            None => None,
            Some(v) => Some(
                v.as_u64()
                    .filter(|n| *n <= MAX_REVISION)
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or_else(|| {
                        format!("attribution.revision must be an integer from 0 to {MAX_REVISION}")
                    })?,
            ),
        };
        Ok(Self {
            staff_id,
            name,
            persona: opt_ident("persona", MAX_ID)?,
            role: opt_ident("role", MAX_ID)?,
            job_id,
            job_kind: opt_ident("job_kind", MAX_ID)?,
            revision,
            work_item: opt_ident("work_item", MAX_WORK_ITEM)?,
            model: opt_line("model")?,
            executor: opt_line("executor")?,
            reviewed_by: opt_person("reviewed_by")?,
            approved_by: opt_person("approved_by")?,
        })
    }

    /// The git author of this staff member's commits. `scope` separates
    /// companies (the company id); `domain` is the mail domain.
    pub fn author(&self, scope: &str, domain: &str) -> CommitAuthor {
        CommitAuthor {
            name: self.name.clone(),
            email: staff_email(&self.staff_id, scope, domain),
        }
    }

    fn job_trailers(&self) -> Vec<(&'static str, String)> {
        let mut out = Vec::new();
        let mut push = |key: &'static str, value: &Option<String>| {
            if let Some(v) = value {
                out.push((key, v.clone()));
            }
        };
        push("Job", &self.job_id);
        push("Job-Kind", &self.job_kind);
        push("Work-Item", &self.work_item);
        push("Model", &self.model);
        push("Executor", &self.executor);
        out
    }

    /// Trailer block of a draft-branch commit, whose author is the persona:
    /// `Job`, `Job-Kind`, `Work-Item`, `Model`, `Executor`. Empty when none
    /// of them is known.
    pub fn draft_trailers(&self) -> String {
        render(&self.job_trailers())
    }

    /// Trailer block of the squash commit: the job trailers, `Reviewed-by`,
    /// `Approved-by`, and `Co-authored-by` for the persona (`author` is
    /// [`Provenance::author`]).
    pub fn squash_trailers(&self, author: &CommitAuthor) -> String {
        let mut t = self.job_trailers();
        if let Some(v) = &self.reviewed_by {
            t.push(("Reviewed-by", v.clone()));
        }
        if let Some(v) = &self.approved_by {
            t.push(("Approved-by", v.clone()));
        }
        t.push((
            "Co-authored-by",
            format!("{} <{}>", author.name, author.email),
        ));
        render(&t)
    }
}

fn render(trailers: &[(&'static str, String)]) -> String {
    trailers
        .iter()
        .map(|(k, v)| format!("{k}: {v}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `message`, a blank line, then the trailer block. `message` alone when
/// there are no trailers.
pub fn with_trailers(message: &str, trailers: &str) -> String {
    if trailers.is_empty() {
        message.to_string()
    } else {
        format!("{}\n\n{trailers}", message.trim_end())
    }
}

fn mail_safe(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    cleaned.trim_matches(['.', '-']).to_string()
}

/// The synthesised address of a staff member: `<staff>+<scope>@<domain>`
/// (`<staff>@<domain>` without a scope). Nothing in it comes from the client
/// except the staff id, reduced to `[a-z0-9.-]`.
pub fn staff_email(staff_id: &str, scope: &str, domain: &str) -> String {
    let staff = match mail_safe(staff_id) {
        s if s.is_empty() => "staff".to_string(),
        s => s,
    };
    let scope = mail_safe(scope);
    if scope.is_empty() {
        format!("{staff}@{domain}")
    } else {
        format!("{staff}+{scope}@{domain}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn full() -> Value {
        json!({
            "staff_id": "staff-1", "persona": "giulia", "name": "Giulia Rossi", "role": "writer",
            "job_id": 42, "job_kind": "draft", "revision": 1, "work_item": "work-item-4",
            "model": "ternary-bonsai-2-27b", "executor": "browser laptop epoch 3",
            "reviewed_by": "Marco Bianchi", "approved_by": "The CEO"
        })
    }

    #[test]
    fn parses_the_full_shape_and_the_minimal_one() {
        let p = Provenance::from_json(&full()).unwrap();
        assert_eq!(p.staff_id, "staff-1");
        assert_eq!(p.name, "Giulia Rossi");
        assert_eq!(p.job_id.as_deref(), Some("42"));
        assert_eq!(p.revision, Some(1));
        let min =
            Provenance::from_json(&json!({ "staff_id": "s", "name": " Ada ", "model": null }))
                .unwrap();
        assert_eq!(
            min,
            Provenance {
                staff_id: "s".into(),
                name: "Ada".into(),
                ..Default::default()
            }
        );
        // A string job id is fine too.
        let mut v = full();
        v["job_id"] = json!("job-7");
        assert_eq!(
            Provenance::from_json(&v).unwrap().job_id.as_deref(),
            Some("job-7")
        );
    }

    #[test]
    fn refuses_malformed_values() {
        let cases: Vec<(&str, Value, &str)> = vec![
            ("not an object", json!("giulia"), "must be an object"),
            (
                "no staff id",
                json!({ "name": "G" }),
                "staff_id is required",
            ),
            ("no name", json!({ "staff_id": "s" }), "name is required"),
            (
                "unknown field",
                json!({ "staff_id": "s", "name": "G", "email": "x@y" }),
                "email is not a known field",
            ),
            (
                "newline in the name",
                json!({ "staff_id": "s", "name": "G\nApproved-by: nobody" }),
                "single line",
            ),
            (
                "carriage return",
                json!({ "staff_id": "s", "name": "G", "model": "m\rJob: 1" }),
                "single line",
            ),
            (
                "line separator",
                json!({ "staff_id": "s", "name": "G", "executor": "a\u{2028}b" }),
                "single line",
            ),
            (
                "angle brackets in the name",
                json!({ "staff_id": "s", "name": "G <root@x>" }),
                "< or >",
            ),
            (
                "angle brackets in a reviewer",
                json!({ "staff_id": "s", "name": "G", "reviewed_by": "M <m@x>" }),
                "< or >",
            ),
            (
                "empty name",
                json!({ "staff_id": "s", "name": "  " }),
                "1-100",
            ),
            (
                "long name",
                json!({ "staff_id": "s", "name": "x".repeat(101) }),
                "1-100",
            ),
            (
                "long model",
                json!({ "staff_id": "s", "name": "G", "model": "m".repeat(121) }),
                "1-120",
            ),
            (
                "staff id alphabet",
                json!({ "staff_id": "s 1", "name": "G" }),
                "staff_id must be",
            ),
            (
                "staff id length",
                json!({ "staff_id": "s".repeat(65), "name": "G" }),
                "staff_id must be",
            ),
            (
                "work item alphabet",
                json!({ "staff_id": "s", "name": "G", "work_item": "a b" }),
                "work_item must be",
            ),
            (
                "typed wrong",
                json!({ "staff_id": 1, "name": "G" }),
                "must be a string",
            ),
            (
                "negative job",
                json!({ "staff_id": "s", "name": "G", "job_id": -1 }),
                "job_id",
            ),
            (
                "fractional revision",
                json!({ "staff_id": "s", "name": "G", "revision": 1.5 }),
                "revision",
            ),
            (
                "huge revision",
                json!({ "staff_id": "s", "name": "G", "revision": 100_000 }),
                "revision",
            ),
        ];
        for (what, v, needle) in cases {
            let e = Provenance::from_json(&v).unwrap_err();
            assert!(e.contains(needle), "{what}: {e}");
        }
    }

    #[test]
    fn the_email_is_synthesised() {
        assert_eq!(
            staff_email("staff-1", "3F2A-11", DEFAULT_EMAIL_DOMAIN),
            "staff-1+3f2a-11@staff.swarm.press"
        );
        assert_eq!(
            staff_email("Staff_1", "", "example.org"),
            "staff-1@example.org"
        );
        assert_eq!(
            staff_email("--", "a/b", "example.org"),
            "staff+a-b@example.org"
        );
        let p = Provenance::from_json(&full()).unwrap();
        assert_eq!(
            p.author("co-9", DEFAULT_EMAIL_DOMAIN),
            CommitAuthor {
                name: "Giulia Rossi".into(),
                email: "staff-1+co-9@staff.swarm.press".into()
            }
        );
    }

    #[test]
    fn trailers() {
        let p = Provenance::from_json(&full()).unwrap();
        assert_eq!(
            p.draft_trailers(),
            "Job: 42\nJob-Kind: draft\nWork-Item: work-item-4\nModel: ternary-bonsai-2-27b\nExecutor: browser laptop epoch 3"
        );
        let author = p.author("co-9", DEFAULT_EMAIL_DOMAIN);
        assert_eq!(
            p.squash_trailers(&author),
            "Job: 42\nJob-Kind: draft\nWork-Item: work-item-4\nModel: ternary-bonsai-2-27b\n\
             Executor: browser laptop epoch 3\nReviewed-by: Marco Bianchi\nApproved-by: The CEO\n\
             Co-authored-by: Giulia Rossi <staff-1+co-9@staff.swarm.press>"
        );
        let min = Provenance {
            staff_id: "s".into(),
            name: "Ada".into(),
            ..Default::default()
        };
        assert_eq!(min.draft_trailers(), "");
        assert_eq!(
            min.squash_trailers(&min.author("", "example.org")),
            "Co-authored-by: Ada <s@example.org>"
        );
        assert_eq!(with_trailers("Draft: x\n", ""), "Draft: x\n");
        assert_eq!(with_trailers("Draft: x\n", "Job: 1"), "Draft: x\n\nJob: 1");
    }
}
