//! The site standard: versioned data (`standard/v1.json`), the same for every site.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

/// `site-standard v1` as shipped (kept: a report names the version it was judged against).
pub const V1_JSON: &str = include_str!("../standard/v1.json");
/// `site-standard v2`.
pub const V2_JSON: &str = include_str!("../standard/v2.json");
/// `site-standard v3`: the current standard (its `changes` say what moved from v2).
pub const V3_JSON: &str = include_str!("../standard/v3.json");

/// What a rule is about; scores are given per dimension.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Dimension {
    Layout,
    Links,
    Media,
    Accessibility,
    Seo,
    Content,
    Design,
    Performance,
}

impl Dimension {
    pub const ALL: [Dimension; 8] = [
        Dimension::Layout,
        Dimension::Links,
        Dimension::Media,
        Dimension::Accessibility,
        Dimension::Seo,
        Dimension::Content,
        Dimension::Design,
        Dimension::Performance,
    ];

    pub fn slug(self) -> &'static str {
        match self {
            Dimension::Layout => "layout",
            Dimension::Links => "links",
            Dimension::Media => "media",
            Dimension::Accessibility => "accessibility",
            Dimension::Seo => "seo",
            Dimension::Content => "content",
            Dimension::Design => "design",
            Dimension::Performance => "performance",
        }
    }
}

/// Deterministic rules run on the rendered page's facts; judged rules are scored by a model
/// against a fixed rubric (ADR-0094 step 5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Deterministic,
    Judged,
}

/// Who repairs a finding: the class's owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Route {
    /// The web designer's repair loop: templates, parts, the theme's styles and labels.
    WebDesigner,
    /// Pictures and their descriptions (a role from ADR-0094 step 4).
    PhotoEditor,
    /// Copy, labels and the links authored in it.
    Editor,
    /// Meta, titles and internal links (a role from ADR-0094 step 4).
    Seo,
    /// Videos and media gaps (the media desk's researcher, ADR-0094 step 4).
    Researcher,
    /// swarm.press itself (the importer, the export, the engine): a platform defect, never
    /// repaired by a staff member and never excepted.
    Platform,
}

impl Route {
    pub fn slug(self) -> &'static str {
        match self {
            Route::WebDesigner => "web-designer",
            Route::PhotoEditor => "photo-editor",
            Route::Editor => "editor",
            Route::Seo => "seo",
            Route::Researcher => "researcher",
            Route::Platform => "platform",
        }
    }

    /// Content roles: their findings may be listed as content gaps (exceptions with a reason);
    /// the web designer's and the platform's never are.
    pub fn is_content(self) -> bool {
        matches!(
            self,
            Route::PhotoEditor | Route::Editor | Route::Seo | Route::Researcher
        )
    }
}

/// At which of the audit's widths a rule is evaluated.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Applies {
    /// Every width.
    #[default]
    All,
    /// Once per page, at its widest audit (links, head, alt texts: the same at every width).
    Widest,
    /// Phone widths (the rule's `max_viewport_px`).
    Narrow,
    /// Desktop widths (the rule's `min_viewport_px`).
    Wide,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub dimension: Dimension,
    pub kind: Kind,
    /// Who repairs it.
    pub route: Route,
    /// Who repairs it when the finding is in the page's authored content (`post-content`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authored_route: Option<Route>,
    #[serde(default)]
    pub applies: Applies,
    pub summary: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, i64>,
    /// Word lists a rule uses (v3: transliterations per language, exempt classes).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub words: BTreeMap<String, Vec<String>>,
    /// A judged rule's threshold (0–1000), frozen after the owner's calibration; `None` until
    /// then (the rule is not enforced).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_score: Option<u16>,
}

impl Rule {
    /// The route of a finding, in the authored content or not.
    pub fn route_for(&self, authored: bool) -> Route {
        if authored {
            self.authored_route.unwrap_or(self.route)
        } else {
            self.route
        }
    }

    pub fn param(&self, name: &str) -> i64 {
        self.params.get(name).copied().unwrap_or(0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Standard {
    pub id: String,
    pub version: u16,
    pub summary: String,
    /// The audit's widths, widest first.
    pub widths: Vec<u32>,
    pub dimensions: Vec<Dimension>,
    pub rules: Vec<Rule>,
    /// What changed from the version before.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<String>,
}

/// The standard a report was made against.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StandardRef {
    pub id: String,
    pub version: u16,
    /// SHA-256 of the standard's canonical JSON.
    pub digest: String,
}

impl Standard {
    /// The current standard (v3).
    pub fn current() -> Standard {
        Standard::parse_shipped(V3_JSON)
    }

    pub fn v2() -> Standard {
        Standard::parse_shipped(V2_JSON)
    }

    /// `site-standard v1` (checked by the crate's tests: it parses and every rule is known).
    pub fn v1() -> Standard {
        Standard::parse_shipped(V1_JSON)
    }

    fn parse_shipped(json: &str) -> Standard {
        Standard::from_json(json).unwrap_or_else(|e| Standard {
            id: "site-standard".into(),
            version: 0,
            summary: format!("the shipped standard does not parse: {e}"),
            widths: Vec::new(),
            dimensions: Vec::new(),
            rules: Vec::new(),
            changes: Vec::new(),
        })
    }

    pub fn from_json(s: &str) -> Result<Standard, String> {
        let std: Standard = serde_json::from_str(s).map_err(|e| e.to_string())?;
        std.validate()?;
        Ok(std)
    }

    /// Ids are unique, every deterministic rule is one this crate evaluates, every dimension is
    /// listed.
    pub fn validate(&self) -> Result<(), String> {
        let mut seen = std::collections::BTreeSet::new();
        for r in &self.rules {
            if !seen.insert(r.id.as_str()) {
                return Err(format!("rule {} is listed twice", r.id));
            }
            if r.kind == Kind::Deterministic && !crate::rules::EVALUATED.contains(&r.id.as_str()) {
                return Err(format!("rule {} has no evaluation", r.id));
            }
            if !self.dimensions.contains(&r.dimension) {
                return Err(format!(
                    "rule {}'s dimension {} is not listed",
                    r.id,
                    r.dimension.slug()
                ));
            }
        }
        if self.widths.is_empty() {
            return Err("the standard names no widths".into());
        }
        Ok(())
    }

    pub fn rule(&self, id: &str) -> Option<&Rule> {
        self.rules.iter().find(|r| r.id == id)
    }

    pub fn reference(&self) -> StandardRef {
        let canon = serde_json::to_string(self).unwrap_or_default();
        let digest = Sha256::digest(canon.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        StandardRef {
            id: self.id.clone(),
            version: self.version,
            digest,
        }
    }

    /// The standard without `rule` (the mutation tests: a rule's fixture passes without it).
    pub fn without(&self, rule: &str) -> Standard {
        let mut s = self.clone();
        s.rules.retain(|r| r.id != rule);
        s
    }
}
