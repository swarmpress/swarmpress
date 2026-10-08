//! Tools as machines (design §4.3): the factory district east of the town.
//!
//! Each tool stands on its own plot. Its nodes are 4×4 machines laid out in
//! layers left to right: a node's layer is its longest path from a source
//! (an input or a node nothing feeds), and within a layer nodes stand in id
//! order (the canvas draws the same layout). The kind decides the machine:
//!
//! | node | machine |
//! |---|---|
//! | input | a yellow hopper |
//! | connector | a blue body with a dish on top |
//! | op | a dark gearbox |
//! | condition | an orange switch, low |
//! | agent | a sand workstation with a plum figure |
//! | skill | a cork crate (sealed steps too) |
//! | output | a green chute |
//! | n8n | the machine of what it does: a request a dish, IF/Filter/Switch a switch, a model a workstation, Code a sage bench, other item steps a gearbox, a type that does not run a crate |
//!
//! Edges are flat tubes on the plot, coloured by the type their source
//! produces ([`type_colour`]). A node with a checker issue wears a red brick.

use std::collections::{BTreeMap, BTreeSet};

use kit::design::Op;

use crate::tools::{Node, ToolGraph};
use crate::types::TypeExpr;

/// A machine's footprint, studs.
pub const NODE: i64 = 4;
/// Studs between machines (tubes run here).
pub const NODE_GAP: i64 = 3;
/// Plot margin, studs.
pub const PLOT_MARGIN: i64 = 2;

/// A tool and the ids of its nodes with checker issues.
#[derive(Clone, Debug)]
pub struct MachineInput {
    pub graph: ToolGraph,
    pub broken: BTreeSet<String>,
}

/// The machine an n8n node type stands as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum N8nMachine {
    /// A request: a blue body with a dish.
    Dish,
    /// IF, Filter, Switch: an orange switch.
    Switch,
    /// A model call: a workstation with a figure.
    Workstation,
    /// Code, Function, Date & Time: a sage bench with a screen.
    Bench,
    /// A type that does not run here: a cork crate.
    Crate,
    /// Everything that reshapes items: a gearbox.
    Gearbox,
}

pub fn n8n_machine(ty: &str) -> N8nMachine {
    match crate::tools::n8n_type(ty) {
        None => N8nMachine::Crate,
        Some(t) if t.web || t.tool => N8nMachine::Dish,
        Some(t) if t.llm => N8nMachine::Workstation,
        Some(_) => match ty {
            "n8n-nodes-base.if" | "n8n-nodes-base.filter" | "n8n-nodes-base.switch" => {
                N8nMachine::Switch
            }
            "n8n-nodes-base.code"
            | "n8n-nodes-base.function"
            | "n8n-nodes-base.functionItem"
            | "n8n-nodes-base.dateTime" => N8nMachine::Bench,
            _ => N8nMachine::Gearbox,
        },
    }
}

/// The colour of a type's tubes: built-in types fixed, others by a stable hash.
pub fn type_colour(expr: &str) -> &'static str {
    let name = TypeExpr::parse(expr).map(|t| t.name).unwrap_or_default();
    match name.as_str() {
        "string" => "white",
        "integer" | "number" => "yellow",
        "boolean" => "black",
        "LocalizedString" => "sand",
        "Page" | "Article" => "blue",
        "Media" => "green",
        "FeedItem" => "orange",
        "SearchResult" => "navy",
        "Village" | "Trail" | "Transport" | "Category" => "forest",
        "" => "grey-light",
        other => {
            const REST: [&str; 8] = [
                "leaf",
                "sage",
                "denim",
                "olive",
                "plum",
                "terracotta",
                "caramel",
                "honey",
            ];
            let h = other
                .bytes()
                .fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(u32::from(b)));
            REST[(h % REST.len() as u32) as usize]
        }
    }
}

/// The type a node declares for what it produces, if it declares one.
fn produced(g: &ToolGraph, n: &Node) -> Option<String> {
    match n {
        Node::Input { port, .. } => g.inputs.get(port).cloned(),
        Node::Connector { returns, .. } | Node::Skill { returns, .. } => Some(returns.clone()),
        Node::Op { returns, .. } => returns.clone(),
        Node::Agent { output, .. } => Some(output.clone()),
        Node::N8n { returns, .. } => Some(returns.clone().unwrap_or_else(|| "Json[]".into())),
        _ => None,
    }
}

/// `(layer, row)` of every node: longest path from a source, then id order.
pub fn layout(g: &ToolGraph) -> BTreeMap<String, (i64, i64)> {
    let ends = |e: &[String; 2]| -> Option<(String, String)> {
        Some((
            e[0].split_once('.')?.0.to_string(),
            e[1].split_once('.')?.0.to_string(),
        ))
    };
    let edges: Vec<(String, String)> = g.edges.iter().filter_map(ends).collect();
    let mut layer: BTreeMap<String, i64> =
        g.nodes.iter().map(|n| (n.id().to_string(), 0)).collect();
    // Bellman-Ford style relaxation, bounded by the node count (cycles stay put).
    for _ in 0..g.nodes.len() {
        let mut moved = false;
        for (f, t) in &edges {
            let (Some(&lf), Some(&lt)) = (layer.get(f), layer.get(t)) else {
                continue;
            };
            if lt < lf + 1 {
                layer.insert(t.clone(), lf + 1);
                moved = true;
            }
        }
        if !moved {
            break;
        }
    }
    let mut rows: BTreeMap<i64, i64> = BTreeMap::new();
    let mut out = BTreeMap::new();
    for (id, l) in &layer {
        let r = rows.entry(*l).or_default();
        out.insert(id.clone(), (*l, *r));
        *r += 1;
    }
    out
}

/// The plot of a tool: `(width, depth)` in studs.
pub fn plot_size(g: &ToolGraph) -> (i64, i64) {
    let l = layout(g);
    let layers = l.values().map(|(a, _)| a + 1).max().unwrap_or(1);
    let rows = l.values().map(|(_, r)| r + 1).max().unwrap_or(1);
    (
        PLOT_MARGIN * 2 + layers * NODE + (layers - 1) * NODE_GAP,
        PLOT_MARGIN * 2 + rows * NODE + (rows - 1) * NODE_GAP,
    )
}

/// The ops of one machine plot with its min corner at `(x, z)` on the
/// baseplate (`y = 1`); returns its height in plates.
pub fn machine_ops(
    m: &MachineInput,
    x: i64,
    z: i64,
    region: impl Fn([i64; 3], [i64; 3], &str, &str) -> Op,
    ops: &mut Vec<Op>,
) -> i64 {
    let g = &m.graph;
    let (w, d) = plot_size(g);
    ops.push(region([x, z, 1], [w, d, 1], "plate", "grey-light"));
    let l = layout(g);
    let at = |id: &str| {
        l.get(id).map(|(layer, row)| {
            (
                x + PLOT_MARGIN + layer * (NODE + NODE_GAP),
                z + PLOT_MARGIN + row * (NODE + NODE_GAP),
            )
        })
    };
    // Tubes first: the machines stand over their ends.
    for e in &g.edges {
        let (Some((f, _)), Some((t, _))) = (e[0].split_once('.'), e[1].split_once('.')) else {
            continue;
        };
        let (Some((fx, fz)), Some((tx, tz))) = (at(f), at(t)) else {
            continue;
        };
        let colour = g
            .node(f)
            .and_then(|n| produced(g, n))
            .map_or("grey-light", |t| type_colour(&t));
        let (sx, sz) = (fx + NODE, fz + NODE / 2);
        let (ex, ez) = (tx, tz + NODE / 2);
        let mid = if ex > sx { ex - 1 } else { sx };
        // east from the source, then north or south, then east into the target
        ops.push(region(
            [sx.min(mid), sz, 2],
            [(mid - sx).abs() + 1, 1, 1],
            "tile",
            colour,
        ));
        ops.push(region(
            [mid, sz.min(ez), 2],
            [1, (ez - sz).abs() + 1, 1],
            "tile",
            colour,
        ));
        if ex > mid {
            ops.push(region([mid, ez, 2], [ex - mid, 1, 1], "tile", colour));
        }
    }
    let mut height = 2;
    for n in &g.nodes {
        let Some((nx, nz)) = at(n.id()) else { continue };
        // (body height and colour, then what stands on it)
        let (body, colour) = match n {
            Node::Input { .. } => (6, "yellow"),
            Node::Connector { .. } => (3, "blue"),
            Node::Op { .. } => (6, "grey-dark"),
            Node::Condition { .. } => (3, "orange"),
            Node::Agent { .. } => (3, "sand"),
            Node::Skill { .. } => (4, "cork"),
            Node::Output { .. } => (3, "green"),
            // An n8n node is the machine of what it does (ADR-0076).
            Node::N8n { r#type, .. } => match n8n_machine(r#type) {
                N8nMachine::Dish => (3, "blue"),
                N8nMachine::Switch => (3, "orange"),
                N8nMachine::Workstation => (3, "sand"),
                N8nMachine::Bench => (4, "sage"),
                N8nMachine::Crate => (4, "cork"),
                N8nMachine::Gearbox => (6, "grey-dark"),
            },
        };
        ops.push(region([nx, nz, 2], [NODE, NODE, body], "brick", colour));
        let base = 2 + body;
        let mut top = base;
        let machine = match n {
            Node::N8n { r#type, .. } => Some(n8n_machine(r#type)),
            _ => None,
        };
        match n {
            Node::Connector { .. } | Node::N8n { .. } if !matches!(machine, Some(m) if m != N8nMachine::Dish) =>
            {
                ops.push(region(
                    [nx + 1, nz + 1, base],
                    [2, 2, 1],
                    "plate",
                    "grey-light",
                ));
                top = base + 1;
            }
            Node::Agent { .. } | Node::N8n { .. }
                if matches!(machine, None | Some(N8nMachine::Workstation)) =>
            {
                ops.push(region([nx + 1, nz + 1, base], [1, 1, 6], "brick", "plum"));
                top = base + 6;
            }
            Node::N8n { .. } if machine == Some(N8nMachine::Bench) => {
                // a code bench: a screen on top
                ops.push(region(
                    [nx, nz + 1, base],
                    [1, 2, 3],
                    "brick",
                    "screen-blue",
                ));
                top = base + 3;
            }
            _ => {}
        }
        // A red brick on the body's corner marks a node with an issue.
        if m.broken.contains(n.id()) {
            ops.push(region(
                [nx + NODE - 1, nz + NODE - 1, base],
                [1, 1, 3],
                "brick",
                "red",
            ));
            top = top.max(base + 3);
        }
        height = height.max(top);
    }
    height
}
