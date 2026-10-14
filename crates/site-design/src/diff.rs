//! Semantic reconciliation (construction-kits concept §5.4): what changed
//! between two interpretations, per template and section, and per token —
//! and [`merge`], which applies a later design of some templates without
//! touching the others.

use serde::{Deserialize, Serialize};

use crate::model::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Change {
    Same,
    Changed,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectionDiff {
    /// The section's id in the newer design (the older one's when removed).
    pub id: String,
    /// What fills it ([`Section::key`]).
    pub key: String,
    pub change: Change,
    /// What changed, in words (`heading: Latest → New stories`, `items 3 → 4`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateDiff {
    pub slug: String,
    pub change: Change,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sections: Vec<SectionDiff>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenChange {
    /// `colour --ct-ink`, `type h1`, `spacing space-4`.
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DesignDiff {
    pub templates: Vec<TemplateDiff>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tokens: Vec<TokenChange>,
    /// Parts, components and rules that changed (`part header`, `component cards`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub other: Vec<TokenChange>,
}

impl DesignDiff {
    /// Nothing changed.
    pub fn is_empty(&self) -> bool {
        self.templates.iter().all(|t| t.change == Change::Same)
            && self.tokens.is_empty()
            && self.other.is_empty()
    }
}

fn notes_between(a: &Section, b: &Section) -> Vec<String> {
    let mut out = Vec::new();
    let keys: std::collections::BTreeSet<&String> = a.props.keys().chain(b.props.keys()).collect();
    for k in keys {
        let (x, y) = (a.props.get(k), b.props.get(k));
        if x != y {
            out.push(format!(
                "{k}: {} → {}",
                x.map_or("—", String::as_str),
                y.map_or("—", String::as_str)
            ));
        }
    }
    let facts = [
        ("images", a.facts.media, b.facts.media),
        ("links", a.facts.links, b.facts.links),
        ("buttons", a.facts.buttons, b.facts.buttons),
        ("paragraphs", a.facts.paragraphs, b.facts.paragraphs),
    ];
    for (name, x, y) in facts {
        if x != y {
            out.push(format!("{name} {x} → {y}"));
        }
    }
    if let (SectionContent::Query { query: q }, SectionContent::Query { query: r }) =
        (&a.content, &b.content)
    {
        if q.items != r.items && !a.props.contains_key("items") {
            out.push(format!("items {} → {}", q.items, r.items));
        }
    }
    out
}

/// Longest common subsequence of section keys: the pairs that stay.
fn align(a: &[Section], b: &[Section]) -> Vec<(Option<usize>, Option<usize>)> {
    let (n, m) = (a.len(), b.len());
    let mut l = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            l[i][j] = if a[i].key() == b[j].key() {
                l[i + 1][j + 1] + 1
            } else {
                l[i + 1][j].max(l[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::new();
    while i < n || j < m {
        if i < n && j < m && a[i].key() == b[j].key() {
            out.push((Some(i), Some(j)));
            i += 1;
            j += 1;
        } else if j < m && (i == n || l[i][j + 1] >= l[i + 1][j]) {
            out.push((None, Some(j)));
            j += 1;
        } else {
            out.push((Some(i), None));
            i += 1;
        }
    }
    out
}

fn template_diff(a: &Template, b: &Template) -> TemplateDiff {
    let mut sections = Vec::new();
    for (x, y) in align(&a.sections, &b.sections) {
        sections.push(match (x, y) {
            (Some(i), Some(j)) => {
                let notes = notes_between(&a.sections[i], &b.sections[j]);
                SectionDiff {
                    id: b.sections[j].id.clone(),
                    key: b.sections[j].key(),
                    change: if notes.is_empty() {
                        Change::Same
                    } else {
                        Change::Changed
                    },
                    notes,
                }
            }
            (None, Some(j)) => SectionDiff {
                id: b.sections[j].id.clone(),
                key: b.sections[j].key(),
                change: Change::Added,
                notes: Vec::new(),
            },
            (Some(i), None) => SectionDiff {
                id: a.sections[i].id.clone(),
                key: a.sections[i].key(),
                change: Change::Removed,
                notes: Vec::new(),
            },
            (None, None) => continue,
        });
    }
    let mut notes = Vec::new();
    if a.title != b.title {
        notes.push(format!("title: {} → {}", a.title, b.title));
    }
    if a.kind != b.kind {
        notes.push(format!("kind: {:?} → {:?}", a.kind, b.kind));
    }
    if a.parts != b.parts {
        notes.push(format!(
            "parts: {} → {}",
            a.parts.join(", "),
            b.parts.join(", ")
        ));
    }
    let change = if notes.is_empty() && sections.iter().all(|s| s.change == Change::Same) {
        Change::Same
    } else {
        Change::Changed
    };
    TemplateDiff {
        slug: b.slug.clone(),
        change,
        notes,
        sections,
    }
}

/// Every token as `(name, value)` for comparison.
fn token_pairs(t: &Tokens) -> Vec<(String, String)> {
    let mut v = Vec::new();
    for c in &t.colours {
        v.push((format!("colour {}", c.name), c.value.clone()));
    }
    for s in &t.schemes {
        for c in &s.colours {
            v.push((format!("colour {}/{}", s.name, c.name), c.value.clone()));
        }
    }
    for f in &t.fonts {
        v.push((format!("font {}", f.name), f.stack.clone()));
    }
    for x in &t.type_scale {
        v.push((
            format!("type {}", x.name),
            format!(
                "{} {} {}",
                x.fluid.as_deref().unwrap_or(&x.size),
                x.family.as_deref().unwrap_or(""),
                x.weight.as_deref().unwrap_or("")
            )
            .trim()
            .to_string(),
        ));
    }
    for (kind, list) in [
        ("spacing", &t.spacing),
        ("radius", &t.radii),
        ("elevation", &t.elevations),
        ("ratio", &t.ratios),
    ] {
        for x in list {
            v.push((format!("{kind} {}", x.name), x.value.clone()));
        }
    }
    for m in &t.motion {
        v.push((format!("motion {}", m.name), m.value.clone()));
    }
    for b in &t.breakpoints {
        v.push((
            format!("breakpoint {}", b.name),
            format!(
                "{}–{}",
                b.min_px,
                b.max_px.map_or(String::new(), |m| m.to_string())
            ),
        ));
    }
    if let Some(g) = &t.grid {
        v.push(("grid".into(), format!("{g:?}")));
    }
    for (k, x) in &t.other {
        v.push((format!("other {k}"), x.clone()));
    }
    v.sort();
    v
}

fn pair_changes(a: Vec<(String, String)>, b: Vec<(String, String)>) -> Vec<TokenChange> {
    let am: std::collections::BTreeMap<String, String> = a.into_iter().collect();
    let bm: std::collections::BTreeMap<String, String> = b.into_iter().collect();
    let keys: std::collections::BTreeSet<&String> = am.keys().chain(bm.keys()).collect();
    keys.into_iter()
        .filter(|k| am.get(*k) != bm.get(*k))
        .map(|k| TokenChange {
            token: k.clone(),
            before: am.get(k).cloned(),
            after: bm.get(k).cloned(),
        })
        .collect()
}

/// What changed from `old` to `new`.
pub fn diff(old: &SiteDesign, new: &SiteDesign) -> DesignDiff {
    let mut templates = Vec::new();
    for b in &new.templates {
        match old.templates.iter().find(|a| a.slug == b.slug) {
            Some(a) => templates.push(template_diff(a, b)),
            None => templates.push(TemplateDiff {
                slug: b.slug.clone(),
                change: Change::Added,
                notes: Vec::new(),
                sections: Vec::new(),
            }),
        }
    }
    for a in &old.templates {
        if !new.templates.iter().any(|b| b.slug == a.slug) {
            templates.push(TemplateDiff {
                slug: a.slug.clone(),
                change: Change::Removed,
                notes: Vec::new(),
                sections: Vec::new(),
            });
        }
    }
    let others = |d: &SiteDesign| {
        let mut v: Vec<(String, String)> = Vec::new();
        for p in &d.parts {
            v.push((format!("part {}", p.slug), crate::dom::collapse(&p.html)));
        }
        for c in &d.components {
            v.push((format!("component {}", c.slug), c.notes.join(" ")));
        }
        for r in &d.rules {
            v.push((format!("rule {}", r.id), r.text.clone()));
        }
        for m in &d.navigation {
            let items: Vec<&str> = m.items.iter().map(|i| i.label.as_str()).collect();
            v.push((format!("menu {}", m.slug), items.join(" · ")));
        }
        v
    };
    DesignDiff {
        templates,
        tokens: pair_changes(token_pairs(&old.tokens), token_pairs(&new.tokens)),
        other: pair_changes(others(old), others(new)),
    }
}

fn merge_by<T: Clone>(base: &[T], newer: &[T], key: impl Fn(&T) -> String) -> Vec<T> {
    let mut out: Vec<T> = base
        .iter()
        .map(|b| newer.iter().find(|n| key(n) == key(b)).unwrap_or(b).clone())
        .collect();
    for n in newer {
        if !base.iter().any(|b| key(b) == key(n)) {
            out.push(n.clone());
        }
    }
    out
}

/// A later design applied to an earlier one: its templates replace those
/// with the same slug and the others stay (the unit is the template); its
/// tokens replace those with the same name; parts, patterns, components,
/// menus and rules it has replace theirs. `bundle` becomes the later one.
pub fn merge(base: &SiteDesign, newer: &SiteDesign) -> SiteDesign {
    let t = &base.tokens;
    let n = &newer.tokens;
    let tokens = Tokens {
        colours: merge_by(&t.colours, &n.colours, |c| c.name.clone()),
        schemes: merge_by(&t.schemes, &n.schemes, |s| s.name.clone()),
        fonts: merge_by(&t.fonts, &n.fonts, |f| f.name.clone()),
        type_scale: merge_by(&t.type_scale, &n.type_scale, |x| x.name.clone()),
        spacing: merge_by(&t.spacing, &n.spacing, |x| x.name.clone()),
        radii: merge_by(&t.radii, &n.radii, |x| x.name.clone()),
        elevations: merge_by(&t.elevations, &n.elevations, |x| x.name.clone()),
        motion: merge_by(&t.motion, &n.motion, |x| x.name.clone()),
        breakpoints: merge_by(&t.breakpoints, &n.breakpoints, |x| x.name.clone()),
        grid: n.grid.clone().or_else(|| t.grid.clone()),
        ratios: merge_by(&t.ratios, &n.ratios, |x| x.name.clone()),
        other: t
            .other
            .iter()
            .chain(n.other.iter())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    };
    let mut languages = base.languages.clone();
    for l in &newer.languages {
        if !languages.contains(l) {
            languages.push(l.clone());
        }
    }
    SiteDesign {
        format: SITE_DESIGN_FORMAT.into(),
        bundle: newer.bundle.clone(),
        title: base.title.clone(),
        languages,
        tokens,
        templates: merge_by(&base.templates, &newer.templates, |x| x.slug.clone()),
        parts: merge_by(&base.parts, &newer.parts, |x| x.slug.clone()),
        patterns: merge_by(&base.patterns, &newer.patterns, |x| x.slug.clone()),
        components: merge_by(&base.components, &newer.components, |x| x.slug.clone()),
        navigation: merge_by(&base.navigation, &newer.navigation, |x| x.slug.clone()),
        rules: merge_by(&base.rules, &newer.rules, |x| format!("{}{}", x.page, x.id)),
        icons: merge_by(&base.icons, &newer.icons, |x| x.id.clone()),
        interactions: merge_by(&base.interactions, &newer.interactions, |x| {
            format!("{}{}", x.page, x.number)
        }),
        pages: merge_by(&base.pages, &newer.pages, |x| x.path.clone()),
        skipped: newer.skipped.clone(),
    }
}
