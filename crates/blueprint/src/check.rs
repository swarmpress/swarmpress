//! The blueprint checker: closed ids, the page-type rules and type fits.
//!
//! Everything a blueprint names must exist: blocks in the catalogue (core or
//! the site's `x:` blocks), globals, page types, collections, manifest
//! sections, types and tools. Each problem is an [`Issue`] with a closed code
//! and a path, which is what the architects' repair turn works with.

use std::collections::{BTreeMap, BTreeSet};

use content_model::PageTypes;

use crate::format::{Blueprint, BlueprintPageType, Source, BLUEPRINT_FORMAT};
use crate::issue::{valid_id, Issue, IssueCode};
use crate::types::{TypeExpr, TypeRegistry};

/// Most page types in one blueprint, and most slots in one type.
pub const MAX_PAGE_TYPES: usize = 64;
pub const MAX_SLOTS: usize = 32;

/// The typed ports of a tool, as a binding sees them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToolSig {
    pub inputs: BTreeMap<String, TypeExpr>,
    pub outputs: BTreeMap<String, TypeExpr>,
}

/// What the blueprint may refer to beyond itself.
#[derive(Clone, Debug, Default)]
pub struct CheckContext {
    pub types: TypeRegistry,
    /// The site's custom block types (`x:<name>`).
    pub custom_blocks: BTreeSet<String>,
    pub tools: BTreeMap<String, ToolSig>,
    /// Manifest section slugs.
    pub sections: BTreeSet<String>,
    /// Manifest collection ids.
    pub manifest_collections: BTreeSet<String>,
}

/// The closed context paths a binding's inputs may read.
pub const CONTEXT_ROOTS: [&str; 3] = ["page.", "item.", "site."];

impl CheckContext {
    fn block_known(&self, t: &str) -> bool {
        content_model::is_core_block(t) || self.custom_blocks.contains(t)
    }
}

struct Checker<'a> {
    ctx: &'a CheckContext,
    bp: &'a Blueprint,
    issues: Vec<Issue>,
    page_types: BTreeSet<&'a str>,
}

impl<'a> Checker<'a> {
    fn push(&mut self, code: IssueCode, path: impl Into<String>, msg: impl Into<String>) {
        self.issues.push(Issue::new(code, path, msg));
    }

    fn block(&mut self, t: &str, path: &str) {
        if !self.ctx.block_known(t) {
            self.push(
                IssueCode::UnknownBlock,
                path,
                format!("{t:?} is not a block of the catalogue or the site"),
            );
        }
    }

    fn type_expr(&mut self, s: &str, path: &str) -> Option<TypeExpr> {
        match TypeExpr::parse(s) {
            Err(m) => {
                self.push(IssueCode::UnknownType, path, m);
                None
            }
            Ok(t) if !self.ctx.types.knows(&t) => {
                self.push(
                    IssueCode::UnknownType,
                    path,
                    format!("{} is not a type", t.name),
                );
                None
            }
            Ok(t) => Some(t),
        }
    }

    fn page_type_ref(&mut self, id: &str, path: &str) {
        if !self.page_types.contains(id) {
            self.push(
                IssueCode::UnknownRef,
                path,
                format!("{id:?} is not a page type of the blueprint"),
            );
        }
    }

    fn run(mut self) -> Vec<Issue> {
        let bp = self.bp;
        if bp.format != BLUEPRINT_FORMAT {
            self.push(
                IssueCode::BadFormat,
                "/format",
                format!("format must be {BLUEPRINT_FORMAT:?}"),
            );
        }
        if bp.page_types.len() > MAX_PAGE_TYPES {
            self.push(
                IssueCode::OverBudget,
                "/page_types",
                format!("at most {MAX_PAGE_TYPES} page types"),
            );
        }

        // Ids first: everything else refers to them.
        let mut names = BTreeSet::new();
        for (i, t) in bp.page_types.iter().enumerate() {
            for name in std::iter::once(&t.id).chain(&t.aliases) {
                if !valid_id(name) {
                    self.push(
                        IssueCode::BadId,
                        format!("/page_types/{i}"),
                        format!("{name:?} is not a kebab-case id"),
                    );
                } else if !names.insert(name.as_str()) {
                    self.push(
                        IssueCode::BadId,
                        format!("/page_types/{i}"),
                        format!("page type {name} is declared twice"),
                    );
                }
            }
        }
        self.page_types = bp.page_types.iter().map(|t| t.id.as_str()).collect();

        for (id, g) in &bp.globals {
            let path = format!("/globals/{id}");
            if !valid_id(id) {
                self.push(
                    IssueCode::BadId,
                    &path,
                    format!("{id:?} is not a kebab-case id"),
                );
            }
            self.block(&g.block, &format!("{path}/block"));
        }

        let collection_ids: BTreeSet<&str> = bp.collections.iter().map(|c| c.id.as_str()).collect();
        for (i, t) in bp.page_types.iter().enumerate() {
            self.page_type(i, t, &collection_ids);
        }

        let mut seen = BTreeSet::new();
        for (i, c) in bp.collections.iter().enumerate() {
            let path = format!("/collections/{i}");
            if !valid_id(&c.id) || !seen.insert(c.id.as_str()) {
                self.push(
                    IssueCode::BadId,
                    &path,
                    format!("collection id {:?} is invalid or declared twice", c.id),
                );
            }
            if let Some(t) = self.type_expr(&c.item_type, &format!("{path}/type")) {
                if t.list || t.optional {
                    self.push(
                        IssueCode::UnknownType,
                        format!("{path}/type"),
                        "a collection names its item type, not a list",
                    );
                }
            }
            match c.from.split_once(':') {
                Some(("page_type", id)) => self.page_type_ref(id, &format!("{path}/from")),
                Some(("collection", id)) if self.ctx.manifest_collections.contains(id) => {}
                _ => self.push(
                    IssueCode::UnknownRef,
                    format!("{path}/from"),
                    format!(
                        "{:?} is neither page_type:<id> nor collection:<manifest collection>",
                        c.from
                    ),
                ),
            }
        }

        for (i, r) in bp.relationships.iter().enumerate() {
            let path = format!("/relationships/{i}");
            self.page_type_ref(&r.from, &format!("{path}/from"));
            self.page_type_ref(&r.to, &format!("{path}/to"));
            if !valid_id(&r.kind) {
                self.push(
                    IssueCode::BadId,
                    format!("{path}/kind"),
                    format!("{:?} is not a kebab-case kind", r.kind),
                );
            }
        }

        for (i, n) in bp.navigation.iter().enumerate() {
            let path = format!("/navigation/{i}");
            match (&n.page_type, &n.section) {
                (Some(t), None) => self.page_type_ref(t, &path),
                (None, Some(s)) if self.ctx.sections.contains(s) => {}
                (None, Some(s)) => self.push(
                    IssueCode::UnknownRef,
                    &path,
                    format!("{s:?} is not a section of the site"),
                ),
                _ => self.push(
                    IssueCode::BadFormat,
                    &path,
                    "a navigation entry names a page_type or a section",
                ),
            }
        }
        self.issues
    }

    fn page_type(&mut self, i: usize, t: &'a BlueprintPageType, collections: &BTreeSet<&str>) {
        let path = format!("/page_types/{i}");
        if !t.label.contains_key("en") {
            self.push(
                IssueCode::BadFormat,
                format!("{path}/label"),
                "a label has an `en` text",
            );
        }
        if let Some(route) = &t.route {
            let placeholders_ok = route.split('{').skip(1).all(|p| {
                ["lang}", "slug}", "region}"]
                    .iter()
                    .any(|ok| p.starts_with(ok))
            });
            if !route.starts_with('/') || !placeholders_ok {
                self.push(
                    IssueCode::BadRoute,
                    format!("{path}/route"),
                    format!("{route:?} must start with / and use only {{lang}}, {{slug}} and {{region}}"),
                );
            }
        }
        if let Source::CollectionItem { collection } = &t.source {
            if !self.ctx.manifest_collections.contains(collection)
                && !collections.contains(collection.as_str())
            {
                self.push(
                    IssueCode::UnknownRef,
                    format!("{path}/source"),
                    format!("{collection:?} is not a collection"),
                );
            }
        }
        for (u, g) in t.uses.iter().enumerate() {
            if !self.bp.globals.contains_key(g) {
                self.push(
                    IssueCode::UnknownRef,
                    format!("{path}/uses/{u}"),
                    format!("{g:?} is not a global"),
                );
            }
        }
        for (k, target) in t.linking.iter().flat_map(|l| l.targets.iter()).enumerate() {
            self.page_type_ref(target, &format!("{path}/linking/targets/{k}"));
        }
        for (k, r) in t.require.iter().enumerate() {
            self.block(&r.block, &format!("{path}/require/{k}"));
        }
        for (k, h) in t.html_fields.iter().enumerate() {
            self.block(&h.block, &format!("{path}/html_fields/{k}"));
        }

        let Some(slots) = &t.slots else { return };
        if slots.len() > MAX_SLOTS {
            self.push(
                IssueCode::OverBudget,
                format!("{path}/slots"),
                format!("at most {MAX_SLOTS} slots"),
            );
        }
        let mut slot_ids = BTreeSet::new();
        let mut slot_of: BTreeMap<&str, &str> = BTreeMap::new();
        for (s, slot) in slots.iter().enumerate() {
            let sp = format!("{path}/slots/{s}");
            if !valid_id(&slot.id) || !slot_ids.insert(slot.id.as_str()) {
                self.push(
                    IssueCode::BadId,
                    &sp,
                    format!("slot id {:?} is invalid or declared twice", slot.id),
                );
            }
            if slot.blocks.is_empty() {
                self.push(IssueCode::BadSlot, &sp, "a slot names at least one block");
            }
            if slot.max.is_some_and(|m| m == 0 || slot.min > m) {
                self.push(
                    IssueCode::BadSlot,
                    &sp,
                    "max is at least 1 and not below min",
                );
            }
            for (b, block) in slot.blocks.iter().enumerate() {
                self.block(block, &format!("{sp}/blocks/{b}"));
                if let Some(other) = slot_of.insert(block, &slot.id) {
                    self.push(
                        IssueCode::BadSlot,
                        &sp,
                        format!(
                            "block {block} is in slots {other} and {}: a block belongs to one slot",
                            slot.id
                        ),
                    );
                }
            }
            if let Some(binding) = &slot.source {
                self.binding(binding, &format!("{sp}/source"));
            }
        }

        // A core type keeps the platform's rules (the gateway enforces them).
        if let Some(core) = PageTypes::core().get(&t.id) {
            let ours: Vec<(&str, &[String], u32, Option<u32>)> = slots
                .iter()
                .map(|s| (s.id.as_str(), s.blocks.as_slice(), s.min, s.max))
                .collect();
            let theirs: Vec<(&str, &[String], u32, Option<u32>)> = core
                .slots
                .iter()
                .flatten()
                .map(|s| (s.id.as_str(), s.blocks.as_slice(), s.min, s.max))
                .collect();
            if ours != theirs {
                self.push(
                    IssueCode::BadSlot,
                    format!("{path}/slots"),
                    format!(
                        "{} is a core page type: its slots are the platform's and cannot change",
                        t.id
                    ),
                );
            }
        }
    }

    fn binding(&mut self, b: &crate::format::Binding, path: &str) {
        let accepts = self.type_expr(&b.accepts, &format!("{path}/accepts"));
        let Some(sig) = self.ctx.tools.get(&b.tool) else {
            self.push(
                IssueCode::UnknownTool,
                format!("{path}/tool"),
                format!("{:?} is not a tool of the site", b.tool),
            );
            return;
        };
        let output = match &b.output {
            Some(o) => sig.outputs.get(o).map(|t| (o.clone(), t.clone())),
            None if sig.outputs.len() == 1 => sig
                .outputs
                .iter()
                .next()
                .map(|(k, v)| (k.clone(), v.clone())),
            None => None,
        };
        match (output, accepts) {
            (None, _) => self.push(
                IssueCode::UnknownPort,
                format!("{path}/output"),
                format!(
                    "name one of the tool's outputs: {}",
                    sig.outputs.keys().cloned().collect::<Vec<_>>().join(", ")
                ),
            ),
            (Some((port, out)), Some(acc)) => {
                if let Err(why) = self.ctx.types.fits(&out, &acc) {
                    self.push(
                        IssueCode::TypeMismatch,
                        path,
                        format!(
                            "{}.{port} ({out}) does not fit {acc}: {}",
                            b.tool,
                            why.join("; ")
                        ),
                    );
                }
            }
            (Some(_), None) => {}
        }
        for (name, ctx_path) in &b.inputs {
            if !sig.inputs.contains_key(name) {
                self.push(
                    IssueCode::UnknownPort,
                    format!("{path}/inputs/{name}"),
                    format!("{} has no input {name}", b.tool),
                );
            }
            if !CONTEXT_ROOTS
                .iter()
                .any(|r| ctx_path.starts_with(r) && ctx_path.len() > r.len())
            {
                self.push(
                    IssueCode::BadContextPath,
                    format!("{path}/inputs/{name}"),
                    format!("{ctx_path:?} must read page.*, item.* or site.*"),
                );
            }
        }
        for (name, t) in &sig.inputs {
            if !t.optional && !b.inputs.contains_key(name) {
                self.push(
                    IssueCode::UnknownPort,
                    format!("{path}/inputs"),
                    format!("{}'s input {name} is not given", b.tool),
                );
            }
        }
    }
}

/// Every problem of the blueprint in its context. Empty: it is sound.
pub fn check(bp: &Blueprint, ctx: &CheckContext) -> Vec<Issue> {
    Checker {
        ctx,
        bp,
        issues: Vec::new(),
        page_types: BTreeSet::new(),
    }
    .run()
}
