//! Work routing by topic affinity (organization.md §10): within a project
//! team, a page type or topic goes to the person whose `affinities` match,
//! following the legacy `agent-page-mapping.ts` (exact or partial match,
//! fallbacks, Isabella as the most versatile default).

use crate::personas::{Catalog, Persona};

/// Legacy `fallbackAgentName` per primary writer.
pub const LEGACY_FALLBACKS: [(&str, &str); 6] = [
    ("giulia", "isabella"),
    ("isabella", "giulia"),
    ("lorenzo", "sophia"),
    ("sophia", "isabella"),
    ("marco", "sophia"),
    ("francesca", "isabella"),
];

/// Legacy default when nothing matches: "Isabella is the most versatile
/// travel writer".
pub const LEGACY_DEFAULT: &str = "isabella";

fn normalize(s: &str) -> String {
    s.trim().to_lowercase().replace([' ', '_'], "-")
}

/// Match strength of `topic` against a persona's affinities: 2 = exact,
/// 1 = partial (one contains the other, as in legacy), 0 = none.
fn strength(p: &Persona, topic: &str) -> u8 {
    p.affinities
        .iter()
        .map(|a| {
            if *a == topic {
                2
            } else if topic.contains(a.as_str()) || a.contains(topic) {
                1
            } else {
                0
            }
        })
        .max()
        .unwrap_or(0)
}

/// Picks the team member (persona slug) who should write a page of
/// `page_type_or_topic`:
///
/// 1. the page-writing team member (writers, editors, photo staff) whose
///    affinities match best: exact before partial, then writers before
///    other roles, then the lowest persona id;
/// 2. otherwise, if the catalog's specialist for the topic is not on the
///    team, their legacy fallback chain, as far as it reaches someone on
///    the team;
/// 3. otherwise the legacy default (Isabella) if on the team, else the
///    team's first writer by id.
///
/// `None` when the team has nobody who writes pages (the job is blocked
/// with a "no writer" ticket).
pub fn best_writer_for(page_type_or_topic: &str, team: &[&Persona]) -> Option<String> {
    let topic = normalize(page_type_or_topic);
    let writers: Vec<&Persona> = team
        .iter()
        .copied()
        .filter(|p| p.role.writes_pages())
        .collect();
    if writers.is_empty() {
        return None;
    }
    let on_team = |slug: &str| writers.iter().any(|p| p.slug == slug);

    if !topic.is_empty() {
        let best = writers
            .iter()
            .map(|p| (strength(p, &topic), p))
            .filter(|(s, _)| *s > 0)
            .max_by_key(|(s, p)| (*s, p.role == crate::Role::Writer, std::cmp::Reverse(p.id)));
        if let Some((_, p)) = best {
            return Some(p.slug.clone());
        }

        // The catalog's specialist is not on this team: follow the legacy
        // fallback chain.
        let specialist = Catalog::builtin()
            .all()
            .iter()
            .filter(|p| p.role.writes_pages() && !p.in_pool())
            .map(|p| (strength(p, &topic), p))
            .filter(|(s, _)| *s > 0)
            .max_by_key(|(s, p)| (*s, std::cmp::Reverse(p.id)))
            .map(|(_, p)| p.slug.as_str());
        let mut cur = specialist;
        for _ in 0..LEGACY_FALLBACKS.len() {
            let Some(slug) = cur else { break };
            let next = LEGACY_FALLBACKS
                .iter()
                .find(|(from, _)| *from == slug)
                .map(|(_, to)| *to);
            if let Some(n) = next {
                if on_team(n) {
                    return Some(n.to_owned());
                }
            }
            cur = next;
        }
    }

    if on_team(LEGACY_DEFAULT) {
        return Some(LEGACY_DEFAULT.to_owned());
    }
    writers
        .iter()
        .filter(|p| p.role == crate::Role::Writer)
        .min_by_key(|p| p.id)
        .or_else(|| writers.iter().min_by_key(|p| p.id))
        .map(|p| p.slug.clone())
}
