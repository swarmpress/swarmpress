//! Edit operations: what an architect returns (FEAT-095, design §5.2, §5.3).
//!
//! A model never writes a whole blueprint. It returns a short list of
//! [`Edit`]s, a closed, tagged set of operations keyed by stable ids ("add a
//! page type `author`", "add the slot `team` to `about`"), which
//! [`apply_edits`] applies to the current blueprint. A target that does not
//! exist (a page type, a slot, a relationship) is an [`Issue`] whose path
//! points into the edit list (`/edits/2/page_type`), so a repair turn can name
//! the edit to fix; the result is then checked with [`crate::check`] like any
//! other blueprint.
//!
//! [`proposal_schema`] is the JSON Schema the model answers with: one flat
//! edit shape (no `anyOf`, only the keywords the browser's subset validator
//! knows, `apps/game/src/llm/structured.ts`) whose `op` and block ids are
//! closed enums: the catalogue's core blocks and the site's custom ones.
//! Fields an operation does not use may be left out or `null`.
//!
//! A tool is small enough to be returned whole: [`tool_proposal_schema`] is
//! the answer of the `ToolBuild` job, a `swarmpress.tool.v1` graph checked
//! with [`crate::tools::check_tool`].

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::check::CheckContext;
use crate::format::{
    Blueprint, BlueprintPageType, Cardinality, IntentKeyword, NavItem, Relationship, Slot, Source,
};
use crate::issue::{Issue, IssueCode};

/// Most edits in one proposal.
pub const MAX_EDITS: usize = 24;

/// A slot as an edit names it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotSpec {
    pub id: String,
    pub blocks: Vec<String>,
    #[serde(default)]
    pub min: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<u32>,
}

impl SlotSpec {
    fn slot(&self) -> Slot {
        Slot {
            id: self.id.clone(),
            blocks: self.blocks.clone(),
            min: self.min,
            max: self.max,
            source: None,
        }
    }
}

/// One change to a blueprint, keyed by stable ids.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Edit {
    /// A new page type; its pages come from `content/pages/**`, or from a
    /// collection when `collection` is given.
    AddPageType {
        id: String,
        /// The English label.
        label: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        route: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        collection: Option<String>,
        #[serde(default)]
        slots: Vec<SlotSpec>,
    },
    /// Removes a page type, and the relationships, navigation entries and
    /// linking targets that name it.
    RemovePageType {
        id: String,
    },
    /// A new slot in a page type, after the slot `after` (first without it).
    AddSlot {
        page_type: String,
        slot: String,
        blocks: Vec<String>,
        #[serde(default)]
        min: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<String>,
    },
    RemoveSlot {
        page_type: String,
        slot: String,
    },
    /// Replaces a slot's blocks and counts (its binding, if any, is kept).
    SetSlot {
        page_type: String,
        slot: String,
        blocks: Vec<String>,
        #[serde(default)]
        min: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<u32>,
    },
    AddRelationship {
        from: String,
        to: String,
        kind: String,
        cardinality: Cardinality,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        via: Option<String>,
    },
    RemoveRelationship {
        from: String,
        to: String,
        kind: String,
    },
    /// Replaces the navigation.
    SetNavigation {
        items: Vec<NavItem>,
    },
    /// Replaces the design intent's keywords (the tokens pointer is kept).
    SetIntent {
        keywords: Vec<IntentKeyword>,
    },
}

impl Edit {
    /// The operation's name (`add-page-type`).
    pub fn op(&self) -> &'static str {
        match self {
            Edit::AddPageType { .. } => "add-page-type",
            Edit::RemovePageType { .. } => "remove-page-type",
            Edit::AddSlot { .. } => "add-slot",
            Edit::RemoveSlot { .. } => "remove-slot",
            Edit::SetSlot { .. } => "set-slot",
            Edit::AddRelationship { .. } => "add-relationship",
            Edit::RemoveRelationship { .. } => "remove-relationship",
            Edit::SetNavigation { .. } => "set-navigation",
            Edit::SetIntent { .. } => "set-intent",
        }
    }
}

/// The operation names, in schema order.
pub const OPS: [&str; 9] = [
    "add-page-type",
    "remove-page-type",
    "add-slot",
    "remove-slot",
    "set-slot",
    "add-relationship",
    "remove-relationship",
    "set-navigation",
    "set-intent",
];

/// `null` members removed, recursively: a flat answer leaves the fields an
/// operation does not use `null`.
fn without_nulls(v: &Value) -> Value {
    match v {
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(_, x)| !x.is_null())
                .map(|(k, x)| (k.clone(), without_nulls(x)))
                .collect::<Map<_, _>>(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(without_nulls).collect()),
        other => other.clone(),
    }
}

/// The edits of a model's answer (`{edits: [...]}` or the bare list). Every
/// edit that does not parse is an issue at `/edits/<i>`.
pub fn parse_edits(v: &Value) -> Result<Vec<Edit>, Vec<Issue>> {
    let list = match v {
        Value::Array(a) => a,
        Value::Object(o) => match o.get("edits") {
            Some(Value::Array(a)) => a,
            _ => {
                return Err(vec![Issue::new(
                    IssueCode::BadFormat,
                    "/edits",
                    "the answer has no edits list",
                )])
            }
        },
        _ => {
            return Err(vec![Issue::new(
                IssueCode::BadFormat,
                "/edits",
                "the answer is not an object with edits",
            )])
        }
    };
    if list.len() > MAX_EDITS {
        return Err(vec![Issue::new(
            IssueCode::OverBudget,
            "/edits",
            format!("at most {MAX_EDITS} edits in one proposal"),
        )]);
    }
    let mut out = Vec::new();
    let mut issues = Vec::new();
    for (i, e) in list.iter().enumerate() {
        match serde_json::from_value::<Edit>(without_nulls(e)) {
            Ok(edit) => out.push(edit),
            Err(err) => issues.push(Issue::new(
                IssueCode::BadFormat,
                format!("/edits/{i}"),
                format!("not an edit: {err}"),
            )),
        }
    }
    if issues.is_empty() {
        Ok(out)
    } else {
        Err(issues)
    }
}

struct Applier {
    bp: Blueprint,
    issues: Vec<Issue>,
}

impl Applier {
    fn push(&mut self, code: IssueCode, path: String, msg: String) {
        self.issues.push(Issue::new(code, path, msg));
    }

    fn type_index(&mut self, id: &str, path: String) -> Option<usize> {
        let at = self.bp.page_types.iter().position(|t| t.id == id);
        if at.is_none() {
            self.push(
                IssueCode::UnknownRef,
                path,
                format!("{id:?} is not a page type of the blueprint"),
            );
        }
        at
    }

    fn slot_index(&mut self, t: usize, slot: &str, path: String) -> Option<usize> {
        let pt = &self.bp.page_types[t];
        let at = pt
            .slots
            .as_ref()
            .and_then(|s| s.iter().position(|s| s.id == slot));
        if at.is_none() {
            let id = pt.id.clone();
            self.push(
                IssueCode::UnknownRef,
                path,
                format!("{slot:?} is not a slot of page type {id}"),
            );
        }
        at
    }

    fn apply(&mut self, i: usize, e: &Edit) {
        let p = |field: &str| format!("/edits/{i}/{field}");
        match e {
            Edit::AddPageType {
                id,
                label,
                route,
                collection,
                slots,
            } => {
                if self.bp.page_type(id).is_some()
                    || self.bp.page_types.iter().any(|t| t.aliases.contains(id))
                {
                    self.push(
                        IssueCode::BadId,
                        p("id"),
                        format!("page type {id} exists already: change it with add-slot, set-slot or remove-slot"),
                    );
                    return;
                }
                self.bp.page_types.push(BlueprintPageType {
                    id: id.clone(),
                    label: [("en".to_string(), label.clone())].into_iter().collect(),
                    aliases: Vec::new(),
                    route: route.clone(),
                    source: match collection {
                        Some(c) => Source::CollectionItem {
                            collection: c.clone(),
                        },
                        None => Source::Page,
                    },
                    slots: Some(slots.iter().map(SlotSpec::slot).collect()),
                    require: Vec::new(),
                    html_fields: Vec::new(),
                    linking: None,
                    uses: Vec::new(),
                    pages: None,
                });
            }
            Edit::RemovePageType { id } => {
                let Some(t) = self.type_index(id, p("id")) else {
                    return;
                };
                self.bp.page_types.remove(t);
                self.bp
                    .relationships
                    .retain(|r| r.from != *id && r.to != *id);
                self.bp
                    .navigation
                    .retain(|n| n.page_type.as_deref() != Some(id.as_str()));
                for t in &mut self.bp.page_types {
                    if let Some(l) = t.linking.as_mut() {
                        l.targets.retain(|x| x != id);
                    }
                }
            }
            Edit::AddSlot {
                page_type,
                slot,
                blocks,
                min,
                max,
                after,
            } => {
                let Some(t) = self.type_index(page_type, p("page_type")) else {
                    return;
                };
                let exists = self.bp.page_types[t]
                    .slots
                    .as_ref()
                    .is_some_and(|s| s.iter().any(|s| s.id == *slot));
                if exists {
                    self.push(
                        IssueCode::BadId,
                        p("slot"),
                        format!("{page_type} has a slot {slot} already: use set-slot"),
                    );
                    return;
                }
                let at = match after {
                    Some(a) => match self.slot_index(t, a, p("after")) {
                        Some(k) => k + 1,
                        None => return,
                    },
                    None => 0,
                };
                let spec = SlotSpec {
                    id: slot.clone(),
                    blocks: blocks.clone(),
                    min: *min,
                    max: *max,
                };
                let slots = self.bp.page_types[t].slots.get_or_insert_with(Vec::new);
                slots.insert(at.min(slots.len()), spec.slot());
            }
            Edit::RemoveSlot { page_type, slot } => {
                let Some(t) = self.type_index(page_type, p("page_type")) else {
                    return;
                };
                let Some(k) = self.slot_index(t, slot, p("slot")) else {
                    return;
                };
                if let Some(s) = self.bp.page_types[t].slots.as_mut() {
                    s.remove(k);
                }
            }
            Edit::SetSlot {
                page_type,
                slot,
                blocks,
                min,
                max,
            } => {
                let Some(t) = self.type_index(page_type, p("page_type")) else {
                    return;
                };
                let Some(k) = self.slot_index(t, slot, p("slot")) else {
                    return;
                };
                if let Some(s) = self.bp.page_types[t]
                    .slots
                    .as_mut()
                    .and_then(|s| s.get_mut(k))
                {
                    s.blocks = blocks.clone();
                    s.min = *min;
                    s.max = *max;
                }
            }
            Edit::AddRelationship {
                from,
                to,
                kind,
                cardinality,
                via,
            } => {
                let known_from = self.type_index(from, p("from")).is_some();
                let known_to = self.type_index(to, p("to")).is_some();
                if !(known_from && known_to) {
                    return;
                }
                if self
                    .bp
                    .relationships
                    .iter()
                    .any(|r| r.from == *from && r.to == *to && r.kind == *kind)
                {
                    self.push(
                        IssueCode::BadId,
                        p("kind"),
                        format!("the relationship {from}>{to}:{kind} exists already"),
                    );
                    return;
                }
                self.bp.relationships.push(Relationship {
                    from: from.clone(),
                    to: to.clone(),
                    kind: kind.clone(),
                    cardinality: *cardinality,
                    via: via.clone(),
                });
            }
            Edit::RemoveRelationship { from, to, kind } => {
                let at = self
                    .bp
                    .relationships
                    .iter()
                    .position(|r| r.from == *from && r.to == *to && r.kind == *kind);
                match at {
                    Some(k) => {
                        self.bp.relationships.remove(k);
                    }
                    None => self.push(
                        IssueCode::UnknownRef,
                        format!("/edits/{i}"),
                        format!("there is no relationship {from}>{to}:{kind}"),
                    ),
                }
            }
            Edit::SetNavigation { items } => self.bp.navigation = items.clone(),
            Edit::SetIntent { keywords } => {
                let mut k = keywords.clone();
                k.sort();
                k.dedup();
                self.bp.intent.keywords = k;
            }
        }
    }
}

/// `base` with `edits` applied in order. Every edit whose target does not
/// exist (or that would declare an id twice) is an issue at its path in the
/// edit list; with any issue nothing is returned. The result is not checked:
/// run [`crate::check`] on it.
pub fn apply_edits(base: &Blueprint, edits: &[Edit]) -> Result<Blueprint, Vec<Issue>> {
    let mut a = Applier {
        bp: base.clone(),
        issues: Vec::new(),
    };
    for (i, e) in edits.iter().enumerate() {
        a.apply(i, e);
    }
    if a.issues.is_empty() {
        Ok(a.bp)
    } else {
        Err(a.issues)
    }
}

/// The block ids a proposal may name: every core block and the site's
/// custom ones, sorted.
pub fn block_ids(ctx: &CheckContext) -> Vec<String> {
    let mut out: BTreeSet<String> = content_model::CORE_BLOCK_TYPES
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    out.extend(ctx.custom_blocks.iter().cloned());
    out.into_iter().collect()
}

fn string_enum<S: AsRef<str>>(values: &[S]) -> Value {
    json!({"type": "string", "enum": values.iter().map(AsRef::as_ref).collect::<Vec<_>>()})
}

/// The schema of an architect's answer: `{summary, edits}` with one flat edit
/// shape; `blocks` is the closed block enum ([`block_ids`]).
pub fn proposal_schema(blocks: &[String]) -> Value {
    let block = string_enum(blocks);
    let id = json!({"type": "string", "minLength": 1, "maxLength": 64});
    let slot = json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "blocks"],
        "properties": {
            "id": id,
            "blocks": {"type": "array", "minItems": 1, "maxItems": 12, "items": block},
            "min": {"type": "integer", "minimum": 0, "maximum": 32},
            "max": {"type": ["integer", "null"], "minimum": 1, "maximum": 32}
        }
    });
    let opt_id = json!({"type": ["string", "null"], "maxLength": 64});
    let cardinalities = ["one-to-one", "one-to-many", "many-to-one", "many-to-many"];
    let keywords = [
        "editorial",
        "dense",
        "minimal",
        "cinematic",
        "card-based",
        "newspaper",
        "image-heavy",
    ];
    let cardinality = {
        let mut values: Vec<Value> = cardinalities.iter().map(|c| json!(c)).collect();
        values.push(Value::Null);
        json!({"type": ["string", "null"], "enum": values})
    };
    let nav_item = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {"page_type": opt_id, "section": opt_id}
    });
    let mut props = Map::new();
    for (k, v) in [
        ("op", string_enum(&OPS)),
        ("id", opt_id.clone()),
        (
            "label",
            json!({"type": ["string", "null"], "maxLength": 80}),
        ),
        (
            "route",
            json!({"type": ["string", "null"], "maxLength": 120}),
        ),
        ("collection", opt_id.clone()),
        (
            "slots",
            json!({"type": ["array", "null"], "maxItems": 16, "items": slot}),
        ),
        ("page_type", opt_id.clone()),
        ("slot", opt_id.clone()),
        (
            "blocks",
            json!({"type": ["array", "null"], "maxItems": 12, "items": block}),
        ),
        (
            "min",
            json!({"type": ["integer", "null"], "minimum": 0, "maximum": 32}),
        ),
        (
            "max",
            json!({"type": ["integer", "null"], "minimum": 1, "maximum": 32}),
        ),
        ("after", opt_id.clone()),
        ("from", opt_id.clone()),
        ("to", opt_id.clone()),
        ("kind", opt_id),
        ("cardinality", cardinality),
        ("via", json!({"type": ["string", "null"], "maxLength": 80})),
        (
            "items",
            json!({"type": ["array", "null"], "maxItems": 12, "items": nav_item}),
        ),
        (
            "keywords",
            json!({"type": ["array", "null"], "maxItems": 7, "items": string_enum(&keywords)}),
        ),
    ] {
        props.insert(k.to_string(), v);
    }
    let edit = json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["op"],
        "properties": props
    });
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["summary", "edits"],
        "properties": {
            "summary": {"type": "string", "minLength": 10, "maxLength": 600},
            "edits": {"type": "array", "minItems": 1, "maxItems": MAX_EDITS, "items": edit}
        }
    })
}

/// The schema of a tool builder's answer: `{summary, graph}`, the graph a
/// `swarmpress.tool.v1` (its node kinds closed; the checker does the rest).
pub fn tool_proposal_schema() -> Value {
    let kinds = [
        "input",
        "output",
        "connector",
        "op",
        "condition",
        "agent",
        "skill",
    ];
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["summary", "graph"],
        "properties": {
            "summary": {"type": "string", "minLength": 10, "maxLength": 600},
            "graph": {
                "type": "object",
                "required": ["format", "id", "name", "outputs", "nodes", "edges"],
                "properties": {
                    "format": {"type": "string", "enum": [crate::tools::TOOL_FORMAT]},
                    "id": {"type": "string", "minLength": 1, "maxLength": 64},
                    "name": {"type": "object", "required": ["en"], "properties": {"en": {"type": "string", "minLength": 1, "maxLength": 80}}},
                    "description": {"type": "string", "maxLength": 500},
                    "inputs": {"type": "object"},
                    "outputs": {"type": "object"},
                    "nodes": {"type": "array", "minItems": 2, "maxItems": crate::tools::MAX_NODES, "items": {
                        "type": "object",
                        "required": ["id", "kind"],
                        "properties": {
                            "id": {"type": "string", "minLength": 1, "maxLength": 64},
                            "kind": string_enum(&kinds)
                        }
                    }},
                    "edges": {"type": "array", "maxItems": 32, "items": {
                        "type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "string"}
                    }},
                    "triggers": {"type": "array", "maxItems": 4, "items": {"type": "object", "required": ["kind"]}},
                    "failure": {"type": "object"},
                    "limits": {"type": "object"}
                }
            }
        }
    })
}
