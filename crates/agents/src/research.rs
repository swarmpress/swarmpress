//! Web research with cited evidence (ADR-0068): the dossier a draft may rely
//! on besides the site's own knowledge.
//!
//! A research turn answers [`research_schema`] with web search on; the
//! backend also returns every source URL its searches returned
//! ([`crate::llm::Researched`]). [`dossier_from`] keeps the claims whose URL is
//! among those sources (a URL the searches never returned is an invented
//! citation and is dropped), drops repeats of what the dossier already holds,
//! and numbers the new claims after the known ones (`E1`, `E2`, …). The
//! dossier is text: it lives in the item's artifact record, never in the sim.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::llm::normalize_source_url;

/// Most claims one research turn may return.
pub const CLAIMS_PER_TURN: usize = 10;
/// Most claims a dossier keeps (earlier claims first).
pub const MAX_EVIDENCE: usize = 24;

/// One researched claim and the source it rests on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evidence {
    /// `E1`, `E2`, …: how drafts and reviews refer to it.
    pub id: String,
    pub claim: String,
    pub url: String,
    /// The source's title, as the search reported it.
    pub title: String,
}

/// What [`dossier_from`] made of one research answer.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DossierUpdate {
    /// The new claims, numbered after the known ones.
    pub added: Vec<Evidence>,
    /// Claims dropped because their URL was not among the search's sources.
    pub unverified: u32,
    /// Claims dropped as repeats of known or earlier claims.
    pub repeated: u32,
}

/// The research answer's schema: claims, each with the source it rests on.
pub fn research_schema() -> Value {
    json!({
        "type": "object",
        "required": ["claims"],
        "additionalProperties": false,
        "properties": {
            "claims": {
                "type": "array",
                "maxItems": CLAIMS_PER_TURN,
                "items": {
                    "type": "object",
                    "required": ["claim", "url", "title"],
                    "additionalProperties": false,
                    "properties": {
                        "claim": { "type": "string", "minLength": 8, "maxLength": 400 },
                        "url": { "type": "string", "minLength": 8, "maxLength": 600 },
                        "title": { "type": "string", "maxLength": 200 }
                    }
                }
            }
        }
    })
}

#[derive(Debug, Deserialize)]
struct Answer {
    claims: Vec<Claim>,
}

#[derive(Debug, Deserialize)]
struct Claim {
    claim: String,
    url: String,
    #[serde(default)]
    title: String,
}

fn same_claim(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>()
    };
    norm(a) == norm(b)
}

/// Turns a research answer into new evidence: claims whose URL is among
/// `sources` (both normalized), not repeating `known`, numbered after it, up
/// to [`MAX_EVIDENCE`] in all. An answer that does not parse adds nothing.
pub fn dossier_from(answer: &Value, sources: &[String], known: &[Evidence]) -> DossierUpdate {
    let mut out = DossierUpdate::default();
    let Ok(a) = serde_json::from_value::<Answer>(answer.clone()) else {
        return out;
    };
    let sources: Vec<String> = sources.iter().map(|s| normalize_source_url(s)).collect();
    for c in a.claims.into_iter().take(CLAIMS_PER_TURN) {
        let url = normalize_source_url(&c.url);
        let claim = c.claim.trim().to_string();
        if claim.is_empty() || !sources.contains(&url) {
            out.unverified += 1;
            continue;
        }
        if known
            .iter()
            .chain(out.added.iter())
            .any(|e| same_claim(&e.claim, &claim))
        {
            out.repeated += 1;
            continue;
        }
        if known.len() + out.added.len() >= MAX_EVIDENCE {
            break;
        }
        out.added.push(Evidence {
            id: format!("E{}", known.len() + out.added.len() + 1),
            claim,
            url,
            title: c.title.trim().to_string(),
        });
    }
    out
}

/// The dossier as lines for a prompt's facts: `E1: claim (source: title, url)`.
pub fn evidence_lines(evidence: &[Evidence]) -> Vec<String> {
    evidence
        .iter()
        .map(|e| {
            let source = if e.title.is_empty() {
                e.url.clone()
            } else {
                format!("{}, {}", e.title, e.url)
            };
            format!("{}: {} (source: {source})", e.id, e.claim)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(claims: &[(&str, &str)]) -> Value {
        json!({ "claims": claims.iter().map(|(c, u)| json!({"claim": c, "url": u, "title": "T"})).collect::<Vec<_>>() })
    }

    #[test]
    fn keeps_claims_whose_source_the_search_returned_and_numbers_them() {
        let a = answer(&[
            ("Trail 593V takes about 55 minutes uphill.", "https://www.parconazionale5terre.it/Eiti_dettaglio.php?id_iti=3581&utm_source=openai"),
            ("The sanctuary dates from the 14th century.", "https://example.com/never-searched"),
        ]);
        let sources =
            vec!["https://www.parconazionale5terre.it/Eiti_dettaglio.php?id_iti=3581".to_string()];
        let u = dossier_from(&a, &sources, &[]);
        assert_eq!(u.added.len(), 1);
        assert_eq!(u.added[0].id, "E1");
        assert_eq!(
            u.added[0].url,
            "https://www.parconazionale5terre.it/Eiti_dettaglio.php?id_iti=3581"
        );
        assert_eq!(u.unverified, 1);
    }

    #[test]
    fn a_later_turn_continues_the_numbering_and_skips_repeats() {
        let known = vec![Evidence {
            id: "E1".into(),
            claim: "Trail 593V takes about 55 minutes uphill.".into(),
            url: "https://a.it/x".into(),
            title: "A".into(),
        }];
        let a = answer(&[
            ("trail 593V takes about 55 minutes uphill", "https://a.it/x"),
            ("The return takes 30 minutes.", "https://a.it/x"),
        ]);
        let u = dossier_from(&a, &["https://a.it/x/".to_string()], &known);
        assert_eq!(u.repeated, 1);
        assert_eq!(u.added.len(), 1);
        assert_eq!(u.added[0].id, "E2");
        assert_eq!(
            evidence_lines(&u.added),
            vec!["E2: The return takes 30 minutes. (source: T, https://a.it/x)".to_string()]
        );
    }

    #[test]
    fn an_answer_that_does_not_parse_adds_nothing() {
        assert_eq!(
            dossier_from(&json!({"nope": 1}), &[], &[]),
            DossierUpdate::default()
        );
    }
}
