//! Tool graphs (`swarmpress.tool.v1`, FEAT-091, design §3.4 and §7).
//!
//! A tool is a small typed graph over a closed node catalogue: `input`,
//! `output`, `connector`, `op`, `condition`, `agent`, `skill` and `n8n`. An
//! `n8n` node (ADR-0076) is one node of an imported n8n workflow, kept as it
//! is and run with n8n's semantics; only the types in [`N8N_TYPES`] run, and
//! its JavaScript (Code nodes, expressions) runs in a sandbox without
//! capabilities. Other code lives in a reviewed SDK skill, which a `skill`
//! node calls. A graph installs as an SDK `skill` extension whose manifest
//! ([`manifest`]) grants exactly what its connectors and agents need, and one
//! shared interpreter (`packages/toolgraph`) runs it in the sandbox.
//!
//! Ports. Every node but `output` has an `out` port (a condition has one per
//! outlet); every node but `input` reads `in`. A `filter` may also read
//! `param`, a `merge` reads `b`, a connector may read `params` (placeholders
//! in its URL or query). [`check_tool`] infers each port's type along the
//! edges and checks every typed step: paths a `pick` or `map` reads exist in
//! the incoming type, and what reaches an `output` fits its declared type.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::check::ToolSig;
use crate::issue::{valid_id, Issue, IssueCode};
use crate::types::{Ty, TypeExpr, TypeRegistry};

pub const TOOL_FORMAT: &str = "swarmpress.tool.v1";
pub const TOOL_DOMAIN: &str = "swarmpress:tool:v1";
/// Most nodes in one graph (12 in ADR-0072; 40 since n8n workflows import node for node, ADR-0076).
pub const MAX_NODES: usize = 40;
/// Most inputs of one n8n node (a Merge).
pub const MAX_N8N_INPUTS: u32 = 10;
/// Most outputs of one n8n node (a Switch).
pub const MAX_N8N_OUTPUTS: u32 = 32;
const IN_PORTS: [&str; MAX_N8N_INPUTS as usize] = [
    "in", "in1", "in2", "in3", "in4", "in5", "in6", "in7", "in8", "in9",
];

/// What an n8n node type reaches beyond its items (`packages/toolgraph/src/n8n/catalogue.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct N8nType {
    pub web: bool,
    pub llm: bool,
    pub tool: bool,
}

const fn t(web: bool, llm: bool, tool: bool) -> N8nType {
    N8nType { web, llm, tool }
}

/// The n8n node types a tool runs (ADR-0076). The TypeScript catalogue lists the same.
pub const N8N_TYPES: [(&str, N8nType); 26] = [
    ("n8n-nodes-base.httpRequest", t(true, false, false)),
    ("n8n-nodes-base.rssFeedRead", t(true, false, false)),
    ("n8n-nodes-base.set", t(false, false, false)),
    ("n8n-nodes-base.if", t(false, false, false)),
    ("n8n-nodes-base.filter", t(false, false, false)),
    ("n8n-nodes-base.switch", t(false, false, false)),
    ("n8n-nodes-base.merge", t(false, false, false)),
    ("n8n-nodes-base.limit", t(false, false, false)),
    ("n8n-nodes-base.sort", t(false, false, false)),
    ("n8n-nodes-base.removeDuplicates", t(false, false, false)),
    ("n8n-nodes-base.splitOut", t(false, false, false)),
    ("n8n-nodes-base.aggregate", t(false, false, false)),
    ("n8n-nodes-base.summarize", t(false, false, false)),
    ("n8n-nodes-base.itemLists", t(false, false, false)),
    ("n8n-nodes-base.renameKeys", t(false, false, false)),
    ("n8n-nodes-base.dateTime", t(false, false, false)),
    ("n8n-nodes-base.code", t(false, false, false)),
    ("n8n-nodes-base.function", t(false, false, false)),
    ("n8n-nodes-base.functionItem", t(false, false, false)),
    ("n8n-nodes-base.noOp", t(false, false, false)),
    ("n8n-nodes-base.wait", t(false, false, false)),
    ("n8n-nodes-base.stopAndError", t(false, false, false)),
    ("n8n-nodes-base.respondToWebhook", t(false, false, false)),
    ("n8n-nodes-base.executeWorkflow", t(false, false, true)),
    ("@n8n/n8n-nodes-langchain.chainLlm", t(false, true, false)),
    ("@n8n/n8n-nodes-langchain.openAi", t(false, true, false)),
];

pub fn n8n_type(name: &str) -> Option<N8nType> {
    N8N_TYPES.iter().find(|(n, _)| *n == name).map(|(_, t)| *t)
}

/// Why a node of a supported n8n type cannot run as configured (the TypeScript
/// `unsupportedReason` refuses the same shapes), or `None`.
pub fn n8n_unsupported(ty: &str, version: Option<f64>, p: &Value) -> Option<&'static str> {
    let v = version.unwrap_or(1.0);
    let opts = &p["options"];
    let s = |k: &str| p[k].as_str();
    match ty {
        "n8n-nodes-base.code" => (s("language").unwrap_or("javaScript") != "javaScript")
            .then_some("only JavaScript code runs"),
        "n8n-nodes-base.dateTime" => {
            (v < 2.0).then_some("Date & Time v1 uses Moment formats: use v2")
        }
        "n8n-nodes-base.httpRequest" => {
            if opts
                .get("pagination")
                .is_some_and(|x| !x.is_null() && x != &Value::Bool(false))
            {
                Some("pagination")
            } else if matches!(s("contentType"), Some("multipart-form-data" | "binaryData")) {
                Some("binary request bodies")
            } else if opts["response"]["response"]["responseFormat"] == "file"
                || (v < 3.0 && s("responseFormat") == Some("file"))
            {
                Some("file responses")
            } else {
                None
            }
        }
        "n8n-nodes-base.wait" => matches!(s("resume"), Some("webhook" | "form"))
            .then_some("a wait for a webhook or form: a tool runs to its end"),
        "n8n-nodes-base.removeDuplicates" => s("operation")
            .is_some_and(|o| o != "removeDuplicateInputItems")
            .then_some("remembering items between runs"),
        "n8n-nodes-base.merge" => (s("mode") == Some("combineBySql")).then_some("merging by SQL"),
        "@n8n/n8n-nodes-langchain.openAi" => (s("resource").unwrap_or("text") != "text"
            || s("operation").unwrap_or("message") != "message")
            .then_some("only the OpenAI node's \"Message a model\""),
        "n8n-nodes-base.executeWorkflow" => (s("source").unwrap_or("database") != "database")
            .then_some("a sub-workflow given inline or from a file or URL"),
        _ => None,
    }
}

/// Where an n8n URL parameter may go (the TypeScript `urlOrigin`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UrlOrigin {
    /// A literal `scheme://host[:port]`.
    Literal(String),
    /// A host computed by an expression: any public website.
    Any,
}

pub fn n8n_url_origin(raw: &Value) -> Option<UrlOrigin> {
    let raw = raw.as_str()?;
    let expr = raw.starts_with('=');
    let s = if expr { &raw[1..] } else { raw }.trim();
    if expr && s.starts_with("{{") {
        return Some(UrlOrigin::Any);
    }
    let (scheme, rest) = s
        .strip_prefix("https://")
        .map(|r| ("https", r))
        .or_else(|| s.strip_prefix("http://").map(|r| ("http", r)))?;
    let host = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
    if host.contains("{{") {
        return expr.then_some(UrlOrigin::Any);
    }
    let (name, port) = host.split_once(':').unwrap_or((host, ""));
    let ok = !name.is_empty()
        && name.contains('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        && port.bytes().all(|b| b.is_ascii_digit());
    ok.then(|| UrlOrigin::Literal(format!("{scheme}://{}", host.to_ascii_lowercase())))
}

fn one() -> u32 {
    1
}
fn is_one(n: &u32) -> bool {
    *n == 1
}
fn empty_object() -> Value {
    json!({})
}

/// What an n8n node does when a request or step fails for an item.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum N8nOnError {
    Stop,
    /// The item becomes `{ error }` on the main output.
    Continue,
}
/// The SDK range a derived manifest asks for.
pub const SDK_RANGE: &str = "^0.1.0";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectorKind {
    HttpGet,
    Rss,
    WebSearch,
    Knowledge,
    StoreRead,
    Tool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OpKind {
    Pick,
    Map,
    Filter,
    Sort,
    Limit,
    Merge,
    Split,
    Format,
    Validate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Test {
    Compare,
    Exists,
    Switch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Tier {
    Low,
    Mid,
    High,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cmp {
    Eq,
    Ne,
    Gt,
    Lt,
    Contains,
}

/// A comparison: the value at `path` against `value` (a literal, or
/// `$param.<path>` read from the `param` port).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Where {
    pub path: String,
    pub cmp: Cmp,
    pub value: Value,
}

/// One node; the fields a kind does not use stay empty.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Node {
    Input {
        id: String,
        /// The tool input this node reads.
        port: String,
    },
    Output {
        id: String,
        /// The tool output this node writes.
        port: String,
    },
    Connector {
        id: String,
        connector: ConnectorKind,
        /// `http-get`, `rss`: an `https://` URL; `{name}` placeholders in its
        /// path or query are filled from the `params` port.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        /// `web-search`: the query template; `knowledge`: `pages`, `media` or `entities`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        /// `store-read`: the table.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        table: Option<String>,
        /// `tool`: another tool of the site.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool: Option<String>,
        /// A credential name the credential proxy resolves (never a value).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        credential: Option<String>,
        returns: String,
    },
    Op {
        id: String,
        op: OpKind,
        /// `pick`, `split`, `sort`: the path read.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// `map`: target field → path in each item.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        fields: BTreeMap<String, String>,
        /// `filter`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        r#where: Option<Where>,
        /// `sort`.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        desc: bool,
        /// `limit`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<u32>,
        /// `split`: the separator.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        separator: Option<String>,
        /// `format`: a template with `{path}` placeholders.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        template: Option<String>,
        /// `pick`, `map`, `validate`: the type produced.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        returns: Option<String>,
    },
    Condition {
        id: String,
        test: Test,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cmp: Option<Cmp>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
        /// `switch`: one outlet per case, then `else`.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        cases: Vec<String>,
    },
    Agent {
        id: String,
        /// The staff role whose member does the step.
        role: String,
        tier: Tier,
        instruction: String,
        output: String,
    },
    Skill {
        id: String,
        /// The installed extension's id and its tool.
        extension: String,
        tool: String,
        returns: String,
    },
    /// One node of an imported n8n workflow (ADR-0076).
    N8n {
        id: String,
        /// The node's name in the workflow (`$('Name')` refers to it).
        name: String,
        r#type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        version: Option<serde_json::Number>,
        /// The n8n parameters, unchanged.
        #[serde(default = "empty_object")]
        parameters: Value,
        #[serde(default = "one", skip_serializing_if = "is_one")]
        inputs: u32,
        #[serde(default = "one", skip_serializing_if = "is_one")]
        outputs: u32,
        /// The credential a request signs in with, by name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        credential: Option<String>,
        /// Execute Workflow: the site tool it calls.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_error: Option<N8nOnError>,
        /// The items' type, when a binding needs one (otherwise `Json[]`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        returns: Option<String>,
    },
}

impl Node {
    pub fn id(&self) -> &str {
        match self {
            Node::Input { id, .. }
            | Node::Output { id, .. }
            | Node::Connector { id, .. }
            | Node::Op { id, .. }
            | Node::Condition { id, .. }
            | Node::Agent { id, .. }
            | Node::Skill { id, .. }
            | Node::N8n { id, .. } => id,
        }
    }

    /// The ports the node reads, and whether each must be connected.
    pub fn in_ports(&self) -> Vec<(&'static str, bool)> {
        match self {
            Node::Input { .. } => vec![],
            Node::Output { .. }
            | Node::Agent { .. }
            | Node::Skill { .. }
            | Node::Condition { .. } => {
                vec![("in", true)]
            }
            Node::Connector { .. } => vec![("params", false)],
            Node::Op {
                op: OpKind::Filter, ..
            } => vec![("in", true), ("param", false)],
            Node::Op {
                op: OpKind::Merge, ..
            } => vec![("in", true), ("b", true)],
            Node::Op { .. } => vec![("in", true)],
            Node::N8n { inputs, .. } => IN_PORTS
                .iter()
                .take((*inputs).clamp(1, MAX_N8N_INPUTS) as usize)
                .map(|p| (*p, false))
                .collect(),
        }
    }

    /// The ports the node writes.
    pub fn out_ports(&self) -> Vec<String> {
        match self {
            Node::Output { .. } => vec![],
            Node::Condition {
                test: Test::Switch,
                cases,
                ..
            } => cases
                .iter()
                .cloned()
                .chain(std::iter::once("else".to_string()))
                .collect(),
            Node::Condition { .. } => vec!["yes".into(), "no".into()],
            Node::N8n { outputs, .. } => (0..(*outputs).clamp(1, MAX_N8N_OUTPUTS))
                .map(|k| {
                    if k == 0 {
                        "out".into()
                    } else {
                        format!("out{k}")
                    }
                })
                .collect(),
            _ => vec!["out".into()],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Trigger {
    /// When a person, an agent or another tool calls it.
    OnDemand,
    /// When a page bound to it is drafted or refreshed.
    Build,
    /// Every n game days.
    Schedule { every_game_days: u32 },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnError {
    /// The run fails; nothing is written.
    #[default]
    Fail,
    /// The run fails, and bound blocks keep the last good output.
    KeepLast,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Failure {
    #[serde(default)]
    pub retries: u32,
    #[serde(default)]
    pub on_error: OnError,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolLimits {
    #[serde(default)]
    pub llm_calls_per_run: u32,
    #[serde(default)]
    pub fetches_per_run: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolGraph {
    pub format: String,
    pub id: String,
    pub name: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
    pub outputs: BTreeMap<String, String>,
    pub nodes: Vec<Node>,
    /// `["from.port", "to.port"]`.
    pub edges: Vec<[String; 2]>,
    #[serde(default)]
    pub triggers: Vec<Trigger>,
    #[serde(default)]
    pub failure: Failure,
    #[serde(default)]
    pub limits: ToolLimits,
}

impl ToolGraph {
    pub fn from_value(v: &Value) -> Result<ToolGraph, String> {
        serde_json::from_value(v.clone()).map_err(|e| e.to_string())
    }

    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.iter().find(|n| n.id() == id)
    }

    /// The tool's typed ports, as bindings and other tools see them.
    pub fn sig(&self) -> ToolSig {
        let parse = |m: &BTreeMap<String, String>| {
            m.iter()
                .filter_map(|(k, v)| TypeExpr::parse(v).ok().map(|t| (k.clone(), t)))
                .collect()
        };
        ToolSig {
            inputs: parse(&self.inputs),
            outputs: parse(&self.outputs),
        }
    }

    /// The semantic hash (`sha256("swarmpress:tool:v1" ‖ canonical JSON)`).
    pub fn hash(&self) -> String {
        let mut out = String::new();
        kit::design::write_canonical(
            &serde_json::to_value(self).expect("a tool serializes"),
            &mut out,
        );
        kit::design::domain_hash(TOOL_DOMAIN, out.as_bytes())
    }
}

/// What a tool may refer to beyond itself.
#[derive(Clone, Debug, Default)]
pub struct ToolContext {
    pub types: TypeRegistry,
    /// The site's other tools, by id.
    pub tools: BTreeMap<String, ToolSig>,
    /// Installed skills: extension id → its tool names.
    pub skills: BTreeMap<String, BTreeSet<String>>,
    /// Store tables a tool may read.
    pub tables: BTreeSet<String>,
}

/// The `scheme://host[:port]` of an `https://` URL whose host is literal.
pub fn origin_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    let ok = !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b':')
        && host.contains('.');
    ok.then(|| format!("https://{host}"))
}

/// `{name}` placeholders in a template.
fn placeholders(t: &str) -> Vec<&str> {
    t.split('{')
        .skip(1)
        .filter_map(|p| p.split_once('}').map(|(n, _)| n))
        .collect()
}

/// The roles an agent step may name (`agents::Role::staff()`, kebab-case).
pub const ROLES: [&str; 21] = [
    "cfo",
    "secretary",
    "strategist",
    "analyst",
    "data-scientist",
    "editor-in-chief",
    "editor",
    "writer",
    "translator",
    "fact-checker",
    "photo-editor",
    "photographer",
    "video-producer",
    "art-director",
    "web-developer",
    "ux-designer",
    "it-engineer",
    "dev-ops",
    "seo-specialist",
    "marketing-manager",
    "social-media-manager",
];

struct ToolChecker<'a> {
    g: &'a ToolGraph,
    ctx: &'a ToolContext,
    issues: Vec<Issue>,
}

impl ToolChecker<'_> {
    fn push(&mut self, code: IssueCode, path: impl Into<String>, msg: impl Into<String>) {
        self.issues.push(Issue::new(code, path, msg));
    }

    fn texpr(&mut self, s: &str, path: &str) -> Option<TypeExpr> {
        match TypeExpr::parse(s) {
            Ok(t) if self.ctx.types.knows(&t) => Some(t),
            Ok(t) => {
                self.push(
                    IssueCode::UnknownType,
                    path,
                    format!("{} is not a type", t.name),
                );
                None
            }
            Err(m) => {
                self.push(IssueCode::UnknownType, path, m);
                None
            }
        }
    }

    fn run(mut self) -> Vec<Issue> {
        let g = self.g;
        if g.format != TOOL_FORMAT {
            self.push(
                IssueCode::BadFormat,
                "/format",
                format!("format must be {TOOL_FORMAT:?}"),
            );
        }
        if !valid_id(&g.id) {
            self.push(
                IssueCode::BadId,
                "/id",
                format!("{:?} is not a kebab-case id", g.id),
            );
        }
        if !g.name.contains_key("en") {
            self.push(IssueCode::BadFormat, "/name", "a name has an `en` text");
        }
        if g.nodes.len() > MAX_NODES {
            self.push(
                IssueCode::OverBudget,
                "/nodes",
                format!("at most {MAX_NODES} nodes"),
            );
        }
        if g.failure.retries > 3 {
            self.push(
                IssueCode::OverBudget,
                "/failure/retries",
                "at most 3 retries",
            );
        }
        for (k, t) in g.triggers.iter().enumerate() {
            if let Trigger::Schedule { every_game_days } = t {
                if !(1..=28).contains(every_game_days) {
                    self.push(
                        IssueCode::BadNode,
                        format!("/triggers/{k}"),
                        "a schedule runs every 1 to 28 game days",
                    );
                }
            }
        }
        let inputs: BTreeMap<&str, Option<TypeExpr>> = g
            .inputs
            .iter()
            .map(|(k, v)| (k.as_str(), self.texpr(v, &format!("/inputs/{k}"))))
            .collect();
        let outputs: BTreeMap<&str, Option<TypeExpr>> = g
            .outputs
            .iter()
            .map(|(k, v)| (k.as_str(), self.texpr(v, &format!("/outputs/{k}"))))
            .collect();
        if g.outputs.is_empty() {
            self.push(
                IssueCode::BadGraph,
                "/outputs",
                "a tool has at least one output",
            );
        }

        // Node ids and configuration.
        let mut ids = BTreeSet::new();
        for (i, n) in g.nodes.iter().enumerate() {
            let path = format!("/nodes/{i}");
            if !valid_id(n.id()) || !ids.insert(n.id()) {
                self.push(
                    IssueCode::BadId,
                    &path,
                    format!("node id {:?} is invalid or used twice", n.id()),
                );
            }
            self.node(n, &path, &inputs, &outputs);
        }
        for port in g.inputs.keys() {
            if !g
                .nodes
                .iter()
                .any(|n| matches!(n, Node::Input { port: p, .. } if p == port))
            {
                self.push(
                    IssueCode::BadGraph,
                    format!("/inputs/{port}"),
                    format!("no input node reads {port}"),
                );
            }
        }
        for port in g.outputs.keys() {
            let writers = g
                .nodes
                .iter()
                .filter(|n| matches!(n, Node::Output { port: p, .. } if p == port))
                .count();
            if writers != 1 {
                self.push(
                    IssueCode::BadGraph,
                    format!("/outputs/{port}"),
                    format!("exactly one output node writes {port}, found {writers}"),
                );
            }
        }

        // Edges: ends exist, each input port fed once.
        let mut fed: BTreeMap<(&str, &str), usize> = BTreeMap::new();
        let mut parsed: Vec<(usize, &str, &str, &str, &str)> = Vec::new();
        for (e, [from, to]) in g.edges.iter().enumerate() {
            let path = format!("/edges/{e}");
            let (Some((fnode, fport)), Some((tnode, tport))) =
                (from.split_once('.'), to.split_once('.'))
            else {
                self.push(
                    IssueCode::BadGraph,
                    &path,
                    "an edge joins `node.port` to `node.port`",
                );
                continue;
            };
            match g.node(fnode) {
                None => self.push(IssueCode::BadGraph, &path, format!("no node {fnode}")),
                Some(n) if !n.out_ports().iter().any(|p| p == fport) => self.push(
                    IssueCode::UnknownPort,
                    &path,
                    format!("{fnode} has no outlet {fport}"),
                ),
                Some(_) => {}
            }
            match g.node(tnode) {
                None => self.push(IssueCode::BadGraph, &path, format!("no node {tnode}")),
                Some(n) if !n.in_ports().iter().any(|(p, _)| *p == tport) => self.push(
                    IssueCode::UnknownPort,
                    &path,
                    format!("{tnode} has no inlet {tport}"),
                ),
                Some(_) => {}
            }
            *fed.entry((tnode, tport)).or_default() += 1;
            parsed.push((e, fnode, fport, tnode, tport));
        }
        for n in &g.nodes {
            for (port, required) in n.in_ports() {
                let count = fed.get(&(n.id(), port)).copied().unwrap_or(0);
                if count > 1 {
                    self.push(
                        IssueCode::BadGraph,
                        format!("/nodes/{}", n.id()),
                        format!("{}.{port} is fed {count} times", n.id()),
                    );
                } else if required && count == 0 {
                    self.push(
                        IssueCode::BadGraph,
                        format!("/nodes/{}", n.id()),
                        format!("{}.{port} is not connected", n.id()),
                    );
                }
            }
        }

        // A connector whose URL or query has placeholders reads them from `params`.
        for n in &g.nodes {
            if let Node::Connector { id, url, query, .. } = n {
                let templ = url.as_deref().or(query.as_deref()).unwrap_or_default();
                if !placeholders(templ).is_empty() && !fed.contains_key(&(id.as_str(), "params")) {
                    self.push(
                        IssueCode::BadGraph,
                        format!("/nodes/{id}"),
                        format!(
                            "{id} fills {{{}}} from params, which is not connected",
                            placeholders(templ).join("}, {")
                        ),
                    );
                }
            }
        }

        // Order and types.
        let Some(order) = topo(g, &parsed) else {
            self.push(IssueCode::BadGraph, "/edges", "the graph has a cycle");
            return self.issues;
        };
        let mut out_ty: BTreeMap<(String, String), Ty> = BTreeMap::new();
        for id in order {
            let Some(n) = g.node(id) else { continue };
            let feed = |port: &str| {
                parsed
                    .iter()
                    .find(|(_, _, _, t, p)| *t == id && *p == port)
                    .and_then(|(_, f, fp, _, _)| {
                        out_ty.get(&(f.to_string(), fp.to_string())).cloned()
                    })
            };
            let incoming = feed("in");
            let produced = self.infer(n, incoming.clone(), &inputs, &outputs);
            for p in n.out_ports() {
                if let Some(t) = &produced {
                    out_ty.insert((id.to_string(), p), t.clone());
                }
            }
        }
        self.issues
    }

    fn node(
        &mut self,
        n: &Node,
        path: &str,
        inputs: &BTreeMap<&str, Option<TypeExpr>>,
        outputs: &BTreeMap<&str, Option<TypeExpr>>,
    ) {
        match n {
            Node::Input { port, .. } if !inputs.contains_key(port.as_str()) => self.push(
                IssueCode::UnknownPort,
                path,
                format!("the tool has no input {port}"),
            ),
            Node::Output { port, .. } if !outputs.contains_key(port.as_str()) => self.push(
                IssueCode::UnknownPort,
                path,
                format!("the tool has no output {port}"),
            ),
            Node::Connector {
                connector,
                url,
                query,
                table,
                tool,
                returns,
                ..
            } => {
                self.texpr(returns, &format!("{path}/returns"));
                match connector {
                    ConnectorKind::HttpGet | ConnectorKind::Rss => match url {
                        None => self.push(IssueCode::BadNode, path, "the connector needs a url"),
                        Some(u) if origin_of(u).is_none() => self.push(
                            IssueCode::BadOrigin,
                            format!("{path}/url"),
                            format!("{u:?} must be https:// with a literal host"),
                        ),
                        Some(_) => {}
                    },
                    ConnectorKind::WebSearch if query.is_none() => {
                        self.push(IssueCode::BadNode, path, "web-search needs a query")
                    }
                    ConnectorKind::Knowledge
                        if !matches!(query.as_deref(), Some("pages" | "media" | "entities")) =>
                    {
                        self.push(
                            IssueCode::BadNode,
                            path,
                            "knowledge reads pages, media or entities",
                        )
                    }
                    ConnectorKind::StoreRead => match table {
                        Some(t) if self.ctx.tables.contains(t) => {}
                        _ => self.push(
                            IssueCode::UnknownRef,
                            path,
                            format!("{table:?} is not a store table"),
                        ),
                    },
                    ConnectorKind::Tool => match tool.as_deref() {
                        Some(t) if t == self.g.id => {
                            self.push(IssueCode::BadGraph, path, "a tool cannot call itself")
                        }
                        Some(t) if self.ctx.tools.contains_key(t) => {}
                        _ => self.push(
                            IssueCode::UnknownTool,
                            path,
                            format!("{tool:?} is not a tool of the site"),
                        ),
                    },
                    _ => {}
                }
            }
            Node::Op {
                op,
                path: p,
                fields,
                r#where,
                count,
                template,
                returns,
                separator,
                ..
            } => {
                let need = |c: bool, m: &str, me: &mut Self| {
                    if !c {
                        me.push(IssueCode::BadNode, path, m.to_string());
                    }
                };
                match op {
                    OpKind::Pick => need(
                        p.is_some() && returns.is_some(),
                        "pick needs path and returns",
                        self,
                    ),
                    OpKind::Map => need(
                        !fields.is_empty() && returns.is_some(),
                        "map needs fields and returns",
                        self,
                    ),
                    OpKind::Filter => need(r#where.is_some(), "filter needs where", self),
                    OpKind::Sort => need(p.is_some(), "sort needs path", self),
                    OpKind::Limit => need(
                        count.is_some_and(|c| c > 0),
                        "limit needs a count above 0",
                        self,
                    ),
                    OpKind::Split => need(
                        separator.as_deref().is_some_and(|s| !s.is_empty()),
                        "split needs a separator",
                        self,
                    ),
                    OpKind::Format => need(template.is_some(), "format needs a template", self),
                    OpKind::Validate => need(returns.is_some(), "validate needs returns", self),
                    OpKind::Merge => {}
                }
                if let Some(r) = returns {
                    self.texpr(r, &format!("{path}/returns"));
                }
            }
            Node::Condition {
                test,
                cmp,
                value,
                cases,
                ..
            } => match test {
                Test::Compare if cmp.is_none() || value.is_none() => {
                    self.push(IssueCode::BadNode, path, "compare needs cmp and value")
                }
                Test::Switch => {
                    let distinct: BTreeSet<&String> = cases.iter().collect();
                    if cases.is_empty()
                        || distinct.len() != cases.len()
                        || cases.iter().any(|c| !valid_id(c) || c == "else")
                    {
                        self.push(
                            IssueCode::BadNode,
                            path,
                            "switch needs distinct kebab-case cases (not `else`)",
                        );
                    }
                }
                _ => {}
            },
            Node::Agent {
                role,
                instruction,
                output,
                ..
            } => {
                if !ROLES.contains(&role.as_str()) {
                    self.push(
                        IssueCode::UnknownRef,
                        format!("{path}/role"),
                        format!("{role:?} is not a staff role"),
                    );
                }
                if instruction.trim().is_empty() || instruction.len() > 2000 {
                    self.push(
                        IssueCode::BadNode,
                        format!("{path}/instruction"),
                        "an instruction is 1 to 2000 bytes",
                    );
                }
                self.texpr(output, &format!("{path}/output"));
            }
            Node::Skill {
                extension,
                tool,
                returns,
                ..
            } => {
                if !self
                    .ctx
                    .skills
                    .get(extension)
                    .is_some_and(|t| t.contains(tool))
                {
                    self.push(
                        IssueCode::UnknownTool,
                        path,
                        format!("{extension}/{tool} is not an installed skill tool"),
                    );
                }
                self.texpr(returns, &format!("{path}/returns"));
            }
            Node::N8n {
                name,
                r#type,
                version,
                parameters,
                inputs,
                outputs,
                tool,
                returns,
                ..
            } => {
                if name.trim().is_empty() {
                    self.push(
                        IssueCode::BadNode,
                        path,
                        "an n8n node has its workflow name",
                    );
                }
                if self
                    .g
                    .nodes
                    .iter()
                    .filter(|n| matches!(n, Node::N8n { name: m, .. } if m == name))
                    .count()
                    > 1
                {
                    self.push(
                        IssueCode::BadId,
                        format!("{path}/name"),
                        format!("two n8n nodes are named {name:?}"),
                    );
                }
                if !(1..=MAX_N8N_INPUTS).contains(inputs)
                    || !(1..=MAX_N8N_OUTPUTS).contains(outputs)
                {
                    self.push(
                        IssueCode::BadNode,
                        path,
                        format!("1 to {MAX_N8N_INPUTS} inputs and 1 to {MAX_N8N_OUTPUTS} outputs"),
                    );
                }
                if !parameters.is_object() {
                    self.push(
                        IssueCode::BadNode,
                        format!("{path}/parameters"),
                        "parameters are an object",
                    );
                }
                let Some(info) = n8n_type(r#type) else {
                    self.push(
                        IssueCode::UnknownTool,
                        format!("{path}/type"),
                        format!("the n8n node type {type} has no swarm.press equivalent: replace this step", type = r#type),
                    );
                    return;
                };
                if let Some(why) = n8n_unsupported(
                    r#type,
                    version.as_ref().and_then(|v| v.as_f64()),
                    parameters,
                ) {
                    self.push(IssueCode::BadNode, path, format!("{}: {why}", r#type));
                }
                if info.web && n8n_url_origin(&parameters["url"]).is_none() {
                    self.push(
                        IssueCode::BadOrigin,
                        format!("{path}/parameters/url"),
                        "the URL must be http(s):// with a host",
                    );
                }
                if info.tool {
                    match tool.as_deref() {
                        Some(t) if t == self.g.id => {
                            self.push(IssueCode::BadGraph, path, "a tool cannot call itself")
                        }
                        Some(t) if self.ctx.tools.contains_key(t) => {}
                        _ => self.push(
                            IssueCode::UnknownTool,
                            path,
                            format!("{tool:?} is not a tool of the site: choose the tool the sub-workflow became"),
                        ),
                    }
                }
                if let Some(r) = returns {
                    self.texpr(r, &format!("{path}/returns"));
                }
            }
            _ => {}
        }
    }

    /// The type a node produces from what flows in, checking what it reads.
    fn infer(
        &mut self,
        n: &Node,
        incoming: Option<Ty>,
        inputs: &BTreeMap<&str, Option<TypeExpr>>,
        outputs: &BTreeMap<&str, Option<TypeExpr>>,
    ) -> Option<Ty> {
        let reg = &self.ctx.types;
        let path = format!("/nodes/{}", n.id());
        let parse = |s: &str| {
            TypeExpr::parse(s)
                .ok()
                .filter(|t| reg.knows(t))
                .map(|t| reg.ty_of(&t))
        };
        match n {
            Node::Input { port, .. } => inputs
                .get(port.as_str())
                .cloned()
                .flatten()
                .map(|t| reg.ty_of(&t)),
            Node::Output { port, .. } => {
                if let (Some(Some(want)), Some(got)) = (outputs.get(port.as_str()), incoming) {
                    if let Err(why) = reg.fits_shape(&got, &reg.ty_of(want)) {
                        self.push(
                            IssueCode::TypeMismatch,
                            path,
                            format!(
                                "what reaches output {port} does not fit {want}: {}",
                                why.join("; ")
                            ),
                        );
                    }
                }
                None
            }
            Node::Connector { returns, .. } | Node::Skill { returns, .. } => parse(returns),
            Node::N8n { returns, .. } => match returns {
                Some(r) => parse(r),
                None => Some(Ty::Array(Box::new(Ty::Json))),
            },
            Node::Agent { output, .. } => parse(output),
            Node::Condition { path: p, .. } => {
                if let Some(t) = &incoming {
                    if reg.type_at(t, p).is_none() {
                        self.push(
                            IssueCode::TypeMismatch,
                            &path,
                            format!("{p} is not a field of what flows in"),
                        );
                    }
                }
                incoming
            }
            Node::Op {
                op,
                path: p,
                fields,
                r#where,
                returns,
                ..
            } => {
                let item = incoming.as_ref().map(|t| match t {
                    Ty::Array(i) => (**i).clone(),
                    other => other.clone(),
                });
                match op {
                    OpKind::Pick => {
                        let want = returns.as_deref().and_then(parse);
                        if let (Some(t), Some(p), Some(w)) = (&incoming, p, &want) {
                            match reg.type_at(t, p) {
                                None => self.push(
                                    IssueCode::TypeMismatch,
                                    &path,
                                    format!("{p} is not a field of what flows in"),
                                ),
                                Some(found) => {
                                    if let Err(why) = reg.fits_shape(&found, w) {
                                        self.push(
                                            IssueCode::TypeMismatch,
                                            &path,
                                            format!(
                                                "{p} does not fit the declared type: {}",
                                                why.join("; ")
                                            ),
                                        );
                                    }
                                }
                            }
                        }
                        want
                    }
                    OpKind::Map => {
                        let want = returns.as_deref().and_then(parse);
                        if let (Some(item), Some(Ty::Array(w_item))) = (&item, &want) {
                            let target = reg.resolve_owned(w_item);
                            for (field, src) in fields {
                                let Some(found) = reg.type_at(item, src) else {
                                    self.push(
                                        IssueCode::TypeMismatch,
                                        &path,
                                        format!("{src} is not a field of each item"),
                                    );
                                    continue;
                                };
                                match target.as_ref() {
                                    Some(Ty::Object(f)) => match f.get(field) {
                                        None => self.push(
                                            IssueCode::TypeMismatch,
                                            &path,
                                            format!("the result has no field {field}"),
                                        ),
                                        Some((ft, _)) => {
                                            if let Err(why) = reg.fits_shape(&found, ft) {
                                                self.push(
                                                    IssueCode::TypeMismatch,
                                                    &path,
                                                    format!("{field}: {}", why.join("; ")),
                                                );
                                            }
                                        }
                                    },
                                    _ => self.push(
                                        IssueCode::TypeMismatch,
                                        &path,
                                        "map returns a list of objects",
                                    ),
                                }
                            }
                        } else if want.is_some() && !matches!(want, Some(Ty::Array(_))) {
                            self.push(
                                IssueCode::TypeMismatch,
                                &path,
                                "map returns a list (Name[])",
                            );
                        }
                        want
                    }
                    OpKind::Filter => {
                        if let (Some(item), Some(w)) = (&item, r#where) {
                            if reg.type_at(item, &w.path).is_none() {
                                self.push(
                                    IssueCode::TypeMismatch,
                                    &path,
                                    format!("{} is not a field of each item", w.path),
                                );
                            }
                        }
                        incoming
                    }
                    OpKind::Sort => {
                        if let (Some(item), Some(p)) = (&item, p) {
                            if reg.type_at(item, p).is_none() {
                                self.push(
                                    IssueCode::TypeMismatch,
                                    &path,
                                    format!("{p} is not a field of each item"),
                                );
                            }
                        }
                        incoming
                    }
                    OpKind::Limit | OpKind::Merge => incoming,
                    OpKind::Split => Some(Ty::Array(Box::new(Ty::String))),
                    OpKind::Format => Some(Ty::String),
                    OpKind::Validate => returns.as_deref().and_then(parse),
                }
            }
        }
    }
}

/// Node ids in an order where every edge points forward, or `None` on a cycle.
fn topo<'a>(
    g: &'a ToolGraph,
    edges: &[(usize, &'a str, &'a str, &'a str, &'a str)],
) -> Option<Vec<&'a str>> {
    let mut indeg: BTreeMap<&str, usize> = g.nodes.iter().map(|n| (n.id(), 0)).collect();
    for (_, f, _, t, _) in edges {
        if indeg.contains_key(f) {
            if let Some(d) = indeg.get_mut(t) {
                *d += 1;
            }
        }
    }
    let mut ready: Vec<&str> = g
        .nodes
        .iter()
        .map(Node::id)
        .filter(|id| indeg.get(id) == Some(&0))
        .collect();
    let mut out = Vec::new();
    while let Some(id) = ready.first().copied() {
        ready.remove(0);
        out.push(id);
        for (_, _, _, t, _) in edges.iter().filter(|e| e.1 == id) {
            if let Some(d) = indeg.get_mut(t) {
                *d -= 1;
                if *d == 0 {
                    ready.push(t);
                }
            }
        }
    }
    (out.len() == indeg.len()).then_some(out)
}

/// Every problem of a tool in its context. Empty: it can be installed.
pub fn check_tool(g: &ToolGraph, ctx: &ToolContext) -> Vec<Issue> {
    ToolChecker {
        g,
        ctx,
        issues: Vec::new(),
    }
    .run()
}

/// What a tool needs from the host: SDK capabilities and the fetch allowlist.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Needs {
    pub capabilities: BTreeSet<String>,
    pub origins: BTreeSet<String>,
    /// An n8n request's host is computed: `web` reaches any public website
    /// (still through the central proxy's guard), and the manifest lists no origins.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub any_origin: bool,
}

pub fn needs(g: &ToolGraph) -> Needs {
    let mut n = Needs::default();
    let mut tier: Option<Tier> = None;
    for node in &g.nodes {
        match node {
            Node::Connector {
                connector: ConnectorKind::HttpGet | ConnectorKind::Rss,
                url: Some(u),
                ..
            } => {
                n.capabilities.insert("web".into());
                if let Some(o) = origin_of(u) {
                    n.origins.insert(o);
                }
            }
            Node::Connector {
                connector: ConnectorKind::WebSearch,
                ..
            } => {
                n.capabilities.insert("web".into());
            }
            Node::Connector {
                connector: ConnectorKind::StoreRead,
                table: Some(t),
                ..
            } => {
                n.capabilities.insert(format!("store:{t}"));
            }
            Node::Agent { tier: t, .. } => tier = tier.max(Some(*t)),
            Node::N8n {
                r#type, parameters, ..
            } => {
                n.capabilities.insert("code".into());
                let info = n8n_type(r#type).unwrap_or_default();
                if info.web {
                    n.capabilities.insert("web".into());
                    match n8n_url_origin(&parameters["url"]) {
                        Some(UrlOrigin::Literal(o)) => {
                            n.origins.insert(o);
                        }
                        Some(UrlOrigin::Any) => n.any_origin = true,
                        None => {}
                    }
                }
                if info.llm {
                    tier = tier.max(Some(Tier::Mid));
                }
            }
            _ => {}
        }
    }
    if let Some(t) = tier {
        let name = match t {
            Tier::Low => "low",
            Tier::Mid => "mid",
            Tier::High => "high",
        };
        n.capabilities.insert(format!("llm:{name}"));
    }
    n
}

/// The extension id a tool installs as.
pub fn extension_id(tool: &str) -> String {
    format!("press.swarm.tool.{tool}")
}

/// The SDK manifest the tool installs with (`swarmpress.ext.json`): a
/// `skill` with one tool, granting exactly [`needs`]. The version is taken
/// from the graph's hash, so a changed graph is a new version.
pub fn manifest(g: &ToolGraph) -> Value {
    let needs = needs(g);
    let h = g.hash();
    let version = format!("0.0.{}", u32::from_str_radix(&h[..6], 16).unwrap_or(0));
    let mut m = json!({
        "id": extension_id(&g.id),
        "name": g.name.get("en").cloned().unwrap_or_else(|| g.id.clone()),
        "version": version,
        "sdk": SDK_RANGE,
        "kinds": ["skill"],
        "capabilities": needs.capabilities,
        "entry": { "bundle": "tool.js" }
    });
    if !g.description.is_empty() {
        m["description"] = json!(g.description.chars().take(500).collect::<String>());
    }
    if !needs.origins.is_empty() && !needs.any_origin {
        m["origins"] = json!(needs.origins);
    }
    m
}

impl TypeRegistry {
    /// [`Ty`] with references resolved one level deep, owned.
    pub fn resolve_owned(&self, t: &Ty) -> Option<Ty> {
        let mut cur = t.clone();
        for _ in 0..16 {
            match cur {
                Ty::Ref(name) => cur = self.get(&name)?.clone(),
                other => return Some(other),
            }
        }
        None
    }
}
