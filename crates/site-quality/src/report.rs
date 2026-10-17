//! The QA report: findings with their listed exceptions, clustered by rule and page type,
//! scores per dimension, the gate's decision and the digest (numbers only, rule 2).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::facts::{PageFacts, SiteFacts};
use crate::rules::{evaluate, Finding};
use crate::standard::{Dimension, Kind, Route, Standard, StandardRef};

/// `QaReport.format`.
pub const REPORT_FORMAT: &str = "site-qa-report/1";

/// Examples a class carries as its evidence.
pub const EXAMPLES: usize = 6;

/// A listed content gap: a finding the gate lets pass, with its reason. Only findings routed to
/// a content role may be excepted, and the reason says what is missing in the content.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Exception {
    pub rule: String,
    /// A page path, or a prefix ending in `*`.
    pub page: String,
    /// Starts with `content gap:`.
    pub why: String,
    /// Optional: only findings whose detail contains this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Exception {
    fn matches(&self, f: &Finding) -> bool {
        let page = match self.page.strip_suffix('*') {
            Some(prefix) => f.page.starts_with(prefix),
            None => f.page == self.page,
        };
        page && self.rule == f.rule && self.detail.as_deref().is_none_or(|d| f.detail.contains(d))
    }
}

/// Checks a list of exceptions against the standard: a reason that is not a content gap, or a
/// rule that only a designer or the platform can fix, is refused (never a silent pass).
pub fn check_exceptions(std: &Standard, list: &[Exception]) -> Vec<String> {
    let mut errors = Vec::new();
    for (i, e) in list.iter().enumerate() {
        let Some(rule) = std.rule(&e.rule) else {
            errors.push(format!("exception {i}: no rule {}", e.rule));
            continue;
        };
        if !e
            .why
            .trim_start()
            .to_ascii_lowercase()
            .starts_with("content gap:")
            || e.why.trim().len() <= "content gap:".len()
        {
            errors.push(format!(
                "exception {i} ({} on {}): its reason must name a content gap (\"content gap: …\")",
                e.rule, e.page
            ));
        }
        if !rule.route.is_content() && !rule.authored_route.is_some_and(Route::is_content) {
            errors.push(format!(
                "exception {i} ({} on {}): {} findings are the {}'s to fix, never a content gap",
                e.rule,
                e.page,
                e.rule,
                rule.route.slug()
            ));
        }
    }
    errors
}

/// A class: one rule broken on one page type, owned by one role. Pages come from templates,
/// so one repair per class repairs every page of the type.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cluster {
    pub rule: String,
    pub page_type: String,
    pub route: Route,
    pub dimension: Dimension,
    pub findings: u32,
    pub pages: u32,
    /// The first findings (page, width, detail).
    pub examples: Vec<Finding>,
}

impl Cluster {
    /// The class as its owner reads it: the rule, the page type and the evidence.
    pub fn evidence(&self, std: &Standard) -> String {
        let summary = std.rule(&self.rule).map_or("", |r| r.summary.as_str());
        let mut s = format!(
            "[{}] on {} ({} findings on {} pages): {summary}\n",
            self.rule, self.page_type, self.findings, self.pages
        );
        for e in &self.examples {
            s.push_str(&format!("- {} at {} px: {}\n", e.page, e.width, e.detail));
        }
        s
    }
}

/// Per dimension: the share of audits (page × width) with no open finding in it, ‰.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scores {
    pub layout: u16,
    pub links: u16,
    pub media: u16,
    pub accessibility: u16,
    pub seo: u16,
    pub content: u16,
    pub design: u16,
    pub performance: u16,
}

impl Scores {
    pub fn get(&self, d: Dimension) -> u16 {
        match d {
            Dimension::Layout => self.layout,
            Dimension::Links => self.links,
            Dimension::Media => self.media,
            Dimension::Accessibility => self.accessibility,
            Dimension::Seo => self.seo,
            Dimension::Content => self.content,
            Dimension::Design => self.design,
            Dimension::Performance => self.performance,
        }
    }

    fn set(&mut self, d: Dimension, v: u16) {
        match d {
            Dimension::Layout => self.layout = v,
            Dimension::Links => self.links = v,
            Dimension::Media => self.media = v,
            Dimension::Accessibility => self.accessibility = v,
            Dimension::Seo => self.seo = v,
            Dimension::Content => self.content = v,
            Dimension::Design => self.design = v,
            Dimension::Performance => self.performance = v,
        }
    }

    pub fn min(&self) -> u16 {
        Dimension::ALL
            .iter()
            .map(|d| self.get(*d))
            .min()
            .unwrap_or(0)
    }
}

/// What was audited.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subject {
    /// The site (`cinqueterre-travel`).
    pub site: String,
    /// The branch the release was exported from (`live`, `design-v1`, `import-site`).
    pub branch: String,
    /// The branch's head when it was exported: the commit the report is about.
    pub commit: String,
    /// The release's tag, when it is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release: Option<u64>,
}

/// The gate's decision (ADR-0094): deterministic findings outside listed content gaps, pages
/// that did not render, or a judged score below its threshold block the release.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gate {
    pub passed: bool,
    /// Why it is blocked, one line each.
    pub blocking: Vec<String>,
    /// What is not measured yet (judged rules before calibration), stated, never assumed.
    pub not_judged: Vec<String>,
}

/// The digest: numbers only, what the sim and the CEO's view get.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct QaDigest {
    pub standard: u16,
    pub pages: u32,
    pub audits: u32,
    /// Open deterministic findings (outside listed content gaps).
    pub findings: u32,
    /// Findings excepted as listed content gaps.
    pub exceptions: u32,
    /// Open classes (rule × page type × owner).
    pub classes: u16,
    pub passed: bool,
    pub scores: Scores,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct QaReport {
    /// [`REPORT_FORMAT`].
    pub format: String,
    pub standard: StandardRef,
    pub subject: Subject,
    pub pages: u32,
    pub audits: u32,
    pub widths: Vec<u32>,
    /// Pages per page type.
    pub page_types: BTreeMap<String, u32>,
    /// Open findings, sorted.
    pub findings: Vec<Finding>,
    /// Findings excepted as listed content gaps, with their reason.
    pub excepted: Vec<Finding>,
    /// Exceptions that matched nothing (listed, so a stale list is seen).
    pub unused_exceptions: Vec<Exception>,
    /// Open classes, largest first.
    pub clusters: Vec<Cluster>,
    pub scores: Scores,
    pub gate: Gate,
    pub digest: QaDigest,
}

/// The report of `pages` (one entry per page and width) against `std`.
pub fn build(
    std: &Standard,
    subject: Subject,
    site: &SiteFacts,
    pages: &[PageFacts],
    exceptions: &[Exception],
) -> Result<QaReport, Vec<String>> {
    let errors = check_exceptions(std, exceptions);
    if !errors.is_empty() {
        return Err(errors);
    }
    let all = evaluate(std, site, pages);
    let mut used = BTreeSet::new();
    let mut findings = Vec::new();
    let mut excepted = Vec::new();
    for mut f in all {
        let hit = exceptions
            .iter()
            .enumerate()
            .find(|(_, e)| f.route.is_content() && e.matches(&f));
        match hit {
            Some((i, e)) => {
                used.insert(i);
                f.exception = Some(e.why.clone());
                excepted.push(f);
            }
            None => findings.push(f),
        }
    }
    let unused_exceptions: Vec<Exception> = exceptions
        .iter()
        .enumerate()
        .filter(|(i, _)| !used.contains(i))
        .map(|(_, e)| e.clone())
        .collect();

    // Clusters: rule × page type × owner.
    let mut by: BTreeMap<(String, String, Route), Vec<&Finding>> = BTreeMap::new();
    for f in &findings {
        by.entry((f.rule.clone(), f.page_type.clone(), f.route))
            .or_default()
            .push(f);
    }
    let mut clusters: Vec<Cluster> = by
        .into_iter()
        .map(|((rule, page_type, route), fs)| Cluster {
            dimension: fs[0].dimension,
            findings: u32::try_from(fs.len()).unwrap_or(u32::MAX),
            pages: u32::try_from(fs.iter().map(|f| &f.page).collect::<BTreeSet<_>>().len())
                .unwrap_or(u32::MAX),
            examples: fs.iter().take(EXAMPLES).map(|f| (*f).clone()).collect(),
            rule,
            page_type,
            route,
        })
        .collect();
    clusters.sort_by(|a, b| {
        b.findings
            .cmp(&a.findings)
            .then_with(|| (&a.rule, &a.page_type, a.route).cmp(&(&b.rule, &b.page_type, b.route)))
    });

    // Scores.
    let audits: BTreeSet<(&str, u32)> = pages.iter().map(|p| (p.path.as_str(), p.width)).collect();
    let n = audits.len().max(1);
    let mut scores = Scores::default();
    for d in Dimension::ALL {
        let bad: BTreeSet<(&str, u32)> = findings
            .iter()
            .filter(|f| f.dimension == d)
            .map(|f| (f.page.as_str(), f.width))
            .collect();
        let clean = n.saturating_sub(bad.len());
        scores.set(d, u16::try_from(clean * 1000 / n).unwrap_or(1000));
    }

    let mut page_types: BTreeMap<String, u32> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for p in pages {
        if seen.insert(p.path.as_str()) {
            *page_types.entry(p.page_type.clone()).or_default() += 1;
        }
    }
    let mut widths: Vec<u32> = pages
        .iter()
        .map(|p| p.width)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    widths.reverse();

    let mut gate = Gate::default();
    if pages.is_empty() {
        gate.blocking.push("nothing was audited".into());
    }
    if !findings.is_empty() {
        gate.blocking.push(format!(
            "{} deterministic findings in {} classes outside listed content gaps",
            findings.len(),
            clusters.len()
        ));
    }
    let wanted: BTreeSet<u32> = std.widths.iter().copied().collect();
    let got: BTreeSet<u32> = widths.iter().copied().collect();
    if !pages.is_empty() && got != wanted {
        gate.blocking.push(format!(
            "audited at {got:?} px, the standard asks for {wanted:?}"
        ));
    }
    for r in std.rules.iter().filter(|r| r.kind == Kind::Judged) {
        match r.min_score {
            // A calibrated judged rule needs its score; none is measured before step 5.
            Some(min) => gate
                .blocking
                .push(format!("{} is not judged yet (threshold {min})", r.id)),
            None => gate.not_judged.push(format!(
                "{}: not judged yet (no calibrated threshold)",
                r.id
            )),
        }
    }
    gate.passed = gate.blocking.is_empty();
    let page_count = u32::try_from(seen.len()).unwrap_or(u32::MAX);
    let digest = QaDigest {
        standard: std.version,
        pages: page_count,
        audits: u32::try_from(audits.len()).unwrap_or(u32::MAX),
        findings: u32::try_from(findings.len()).unwrap_or(u32::MAX),
        exceptions: u32::try_from(excepted.len()).unwrap_or(u32::MAX),
        classes: u16::try_from(clusters.len()).unwrap_or(u16::MAX),
        passed: gate.passed,
        scores,
    };
    Ok(QaReport {
        format: REPORT_FORMAT.into(),
        standard: std.reference(),
        subject,
        pages: page_count,
        audits: digest.audits,
        widths,
        page_types,
        findings,
        excepted,
        unused_exceptions,
        clusters,
        scores,
        gate,
        digest,
    })
}

impl QaReport {
    /// Open classes owned by `route`.
    pub fn classes_of(&self, route: Route) -> impl Iterator<Item = &Cluster> {
        self.clusters.iter().filter(move |c| c.route == route)
    }

    /// The table per rule × page type (open findings), for people.
    pub fn table(&self) -> BTreeMap<String, BTreeMap<String, u32>> {
        let mut t: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();
        for f in &self.findings {
            *t.entry(f.rule.clone())
                .or_default()
                .entry(f.page_type.clone())
                .or_default() += 1;
        }
        t
    }

    /// One line for the CEO.
    pub fn line(&self) -> String {
        let s = &self.scores;
        format!(
            "{} {}: {} pages at {:?} px, {} findings in {} classes, {} listed content gaps; {} (layout {}‰, links {}‰, media {}‰, accessibility {}‰, SEO {}‰, content {}‰, design {}‰, performance {}‰)",
            self.standard.id,
            self.standard.version,
            self.pages,
            self.widths,
            self.findings.len(),
            self.clusters.len(),
            self.excepted.len(),
            if self.gate.passed { "passes" } else { "blocked" },
            s.layout,
            s.links,
            s.media,
            s.accessibility,
            s.seo,
            s.content,
            s.design,
            s.performance
        )
    }
}
