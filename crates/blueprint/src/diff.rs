//! Semantic diffs between two blueprints, keyed by stable ids (design §5.2,
//! the concept's §5.4). The canvas and the town draw a diff as added bricks
//! outlined, removed ones ghosted and changed ones marked, and an architect's
//! proposal is a diff the CEO approves.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::format::{Blueprint, BlueprintPageType};
use crate::hash::semantic_value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChangeKind {
    Added,
    Removed,
    Changed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Subject {
    PageType,
    Slot,
    Global,
    Collection,
    Relationship,
    Navigation,
    Intent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Change {
    pub kind: ChangeKind,
    pub subject: Subject,
    /// `home`, `home/hero` (a slot), `blog-article>village:about` (a relationship).
    pub id: String,
    /// The fields that differ, for `changed`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<String>,
}

fn fields_of(v: &Value) -> BTreeMap<String, Value> {
    v.as_object()
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

/// The fields of two objects that differ (missing counts as different).
fn changed_fields(a: &Value, b: &Value, skip: &[&str]) -> Vec<String> {
    let (a, b) = (fields_of(a), fields_of(b));
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter()
        .filter(|k| !skip.contains(&k.as_str()) && a.get(*k) != b.get(*k))
        .cloned()
        .collect()
}

fn keyed<T>(items: &[T], key: impl Fn(&T) -> String) -> BTreeMap<String, (usize, &T)> {
    items
        .iter()
        .enumerate()
        .map(|(i, t)| (key(t), (i, t)))
        .collect()
}

fn diff_map<T: Serialize>(
    out: &mut Vec<Change>,
    subject: Subject,
    old: &BTreeMap<String, T>,
    new: &BTreeMap<String, T>,
    skip: &[&str],
) {
    for (id, o) in old {
        match new.get(id) {
            None => out.push(Change {
                kind: ChangeKind::Removed,
                subject,
                id: id.clone(),
                fields: vec![],
            }),
            Some(n) => {
                let (o, n) = (
                    serde_json::to_value(o).unwrap_or_default(),
                    serde_json::to_value(n).unwrap_or_default(),
                );
                let fields = changed_fields(&o, &n, skip);
                if !fields.is_empty() {
                    out.push(Change {
                        kind: ChangeKind::Changed,
                        subject,
                        id: id.clone(),
                        fields,
                    });
                }
            }
        }
    }
    for id in new.keys().filter(|k| !old.contains_key(*k)) {
        out.push(Change {
            kind: ChangeKind::Added,
            subject,
            id: id.clone(),
            fields: vec![],
        });
    }
}

fn slots_of(t: &BlueprintPageType) -> BTreeMap<String, crate::format::Slot> {
    t.slots
        .iter()
        .flatten()
        .map(|s| (format!("{}/{}", t.id, s.id), s.clone()))
        .collect()
}

/// What changed from `old` to `new`, page types first, then their slots,
/// globals, collections, relationships, navigation and intent. Counts are
/// not semantic and never show up.
pub fn diff(old: &Blueprint, new: &Blueprint) -> Vec<Change> {
    let mut out = Vec::new();
    let skip_pt = ["slots", "pages"];
    let ot = keyed(&old.page_types, |t| t.id.clone());
    let nt = keyed(&new.page_types, |t| t.id.clone());
    let ot_v: BTreeMap<String, &BlueprintPageType> =
        ot.iter().map(|(k, (_, t))| (k.clone(), *t)).collect();
    let nt_v: BTreeMap<String, &BlueprintPageType> =
        nt.iter().map(|(k, (_, t))| (k.clone(), *t)).collect();
    diff_map(&mut out, Subject::PageType, &ot_v, &nt_v, &skip_pt);
    // Slot order, and whether a type constrains its body at all.
    for (id, o) in &ot_v {
        if let Some(n) = nt_v.get(id) {
            let order = |t: &BlueprintPageType| {
                t.slots
                    .as_ref()
                    .map(|s| s.iter().map(|s| s.id.clone()).collect::<Vec<_>>())
            };
            if order(o) != order(n) {
                let fields = vec!["slots".to_string()];
                match out
                    .iter_mut()
                    .find(|c| c.subject == Subject::PageType && &c.id == id)
                {
                    Some(c) => c.fields.extend(fields),
                    None => out.push(Change {
                        kind: ChangeKind::Changed,
                        subject: Subject::PageType,
                        id: id.clone(),
                        fields,
                    }),
                }
            }
        }
    }
    let os: BTreeMap<String, _> = old.page_types.iter().flat_map(slots_of).collect();
    let ns: BTreeMap<String, _> = new.page_types.iter().flat_map(slots_of).collect();
    diff_map(&mut out, Subject::Slot, &os, &ns, &[]);
    diff_map(&mut out, Subject::Global, &old.globals, &new.globals, &[]);
    let oc: BTreeMap<String, _> = old
        .collections
        .iter()
        .map(|c| (c.id.clone(), c.clone()))
        .collect();
    let nc: BTreeMap<String, _> = new
        .collections
        .iter()
        .map(|c| (c.id.clone(), c.clone()))
        .collect();
    diff_map(&mut out, Subject::Collection, &oc, &nc, &["items"]);
    let rel = |r: &crate::format::Relationship| format!("{}>{}:{}", r.from, r.to, r.kind);
    let or: BTreeMap<String, _> = old
        .relationships
        .iter()
        .map(|r| (rel(r), r.clone()))
        .collect();
    let nr: BTreeMap<String, _> = new
        .relationships
        .iter()
        .map(|r| (rel(r), r.clone()))
        .collect();
    diff_map(&mut out, Subject::Relationship, &or, &nr, &[]);
    if old.navigation != new.navigation {
        out.push(Change {
            kind: ChangeKind::Changed,
            subject: Subject::Navigation,
            id: "navigation".into(),
            fields: vec![],
        });
    }
    // A page type that comes or goes brings its slots with it.
    let whole: BTreeSet<String> = out
        .iter()
        .filter(|c| c.subject == Subject::PageType && c.kind != ChangeKind::Changed)
        .map(|c| c.id.clone())
        .collect();
    out.retain(|c| {
        c.subject != Subject::Slot
            || c.id
                .split_once('/')
                .is_none_or(|(pt, _)| !whole.contains(pt))
    });
    let (oi, ni) = (
        semantic_value(old)["intent"].clone(),
        semantic_value(new)["intent"].clone(),
    );
    if oi != ni {
        out.push(Change {
            kind: ChangeKind::Changed,
            subject: Subject::Intent,
            id: "intent".into(),
            fields: changed_fields(&oi, &ni, &[]),
        });
    }
    out.sort_by(|a, b| (a.subject, &a.id).cmp(&(b.subject, &b.id)));
    out
}

/// Applies `changes` from `proposal` onto `base`: the subjects a diff names
/// are taken from the proposal, everything else stays as in `base`. With
/// every change of `diff(base, proposal)` the result equals the proposal.
pub fn apply(base: &Blueprint, proposal: &Blueprint, changes: &[Change]) -> Blueprint {
    let mut out = base.clone();
    for c in changes {
        match c.subject {
            Subject::PageType => {
                let theirs = proposal.page_type(&c.id).cloned();
                let at = out.page_types.iter().position(|t| t.id == c.id);
                match (theirs, at) {
                    (Some(t), Some(i)) => {
                        let slots = out.page_types[i].slots.clone();
                        out.page_types[i] = t;
                        if !c.fields.iter().any(|f| f == "slots") {
                            out.page_types[i].slots = slots;
                        }
                    }
                    (Some(t), None) => {
                        let mut t = t;
                        t.slots = proposal.page_type(&c.id).and_then(|p| p.slots.clone());
                        out.page_types.push(t);
                    }
                    (None, Some(i)) => {
                        out.page_types.remove(i);
                    }
                    (None, None) => {}
                }
            }
            Subject::Slot => {
                let Some((pt, slot)) = c.id.split_once('/') else {
                    continue;
                };
                let theirs = proposal
                    .page_type(pt)
                    .and_then(|t| t.slots.as_ref())
                    .and_then(|s| s.iter().find(|s| s.id == slot))
                    .cloned();
                let Some(t) = out.page_types.iter_mut().find(|t| t.id == pt) else {
                    continue;
                };
                let slots = t.slots.get_or_insert_with(Vec::new);
                let at = slots.iter().position(|s| s.id == slot);
                match (theirs, at) {
                    (Some(s), Some(i)) => slots[i] = s,
                    (Some(s), None) => {
                        // Keep the proposal's order: insert after the slot that precedes it there.
                        let order: Vec<String> = proposal
                            .page_type(pt)
                            .and_then(|t| t.slots.as_ref())
                            .map(|s| s.iter().map(|s| s.id.clone()).collect())
                            .unwrap_or_default();
                        let before = order
                            .iter()
                            .position(|id| id == slot)
                            .and_then(|k| k.checked_sub(1))
                            .map(|k| order[k].clone());
                        let i = before
                            .and_then(|b| slots.iter().position(|s| s.id == b))
                            .map_or(0, |i| i + 1);
                        slots.insert(i.min(slots.len()), s);
                    }
                    (None, Some(i)) => {
                        slots.remove(i);
                    }
                    (None, None) => {}
                }
            }
            Subject::Global => match proposal.globals.get(&c.id) {
                Some(g) => {
                    out.globals.insert(c.id.clone(), g.clone());
                }
                None => {
                    out.globals.remove(&c.id);
                }
            },
            Subject::Collection => {
                out.collections.retain(|x| x.id != c.id);
                if let Some(x) = proposal.collections.iter().find(|x| x.id == c.id) {
                    out.collections.push(x.clone());
                }
            }
            Subject::Relationship => {
                let rel =
                    |r: &crate::format::Relationship| format!("{}>{}:{}", r.from, r.to, r.kind);
                out.relationships.retain(|r| rel(r) != c.id);
                if let Some(r) = proposal.relationships.iter().find(|r| rel(r) == c.id) {
                    out.relationships.push(r.clone());
                }
            }
            Subject::Navigation => out.navigation = proposal.navigation.clone(),
            Subject::Intent => out.intent = proposal.intent.clone(),
        }
    }
    // Keep the proposal's order for page types, collections and relationships.
    let pos = |id: &str| {
        proposal
            .page_types
            .iter()
            .position(|t| t.id == id)
            .unwrap_or(usize::MAX)
    };
    out.page_types.sort_by_key(|t| pos(&t.id));
    out
}
