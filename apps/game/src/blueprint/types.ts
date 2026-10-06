/**
 * The site's semantic models as the browser reads them (ADR-0072): the
 * blueprint (`swarmpress.blueprint.v1`), its tools (`swarmpress.tool.v1`)
 * and the brick town they compile to. The source of truth for the formats
 * is the Rust crate `crates/blueprint`; these types mirror its serde shapes.
 */

export type Intent = 'showcase' | 'inform' | 'navigate' | 'convert' | 'compare' | 'orient' | 'engage'

export interface Binding {
  tool: string
  output?: string
  inputs?: Record<string, string>
  accepts: string
}

export interface BlueprintSlot {
  id: string
  blocks: string[]
  min?: number
  max?: number
  source?: Binding
}

export interface BlueprintPageType {
  id: string
  label: Record<string, string>
  aliases?: string[]
  route?: string
  source: { kind: 'page' } | { kind: 'collection-item'; collection: string }
  slots?: BlueprintSlot[]
  require?: { block: string; min: number }[]
  html_fields?: { block: string; field: string }[]
  linking?: { min_links?: number; targets?: string[] }
  uses?: string[]
  pages?: number
}

export interface Blueprint {
  format: 'swarmpress.blueprint.v1'
  globals?: Record<string, { block: string }>
  page_types: BlueprintPageType[]
  collections?: { id: string; type: string; from: string; order?: string; limit?: number; items?: number }[]
  relationships?: { from: string; to: string; kind: string; cardinality: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'; via?: string }[]
  navigation?: { page_type?: string; section?: string }[]
  intent?: { keywords?: string[]; tokens?: string }
}

export interface ModelIssue {
  code: string
  path: string
  message: string
}

export interface ToolNode {
  id: string
  kind: 'input' | 'output' | 'connector' | 'op' | 'condition' | 'agent' | 'skill'
  [field: string]: unknown
}

export interface ToolGraph {
  format: 'swarmpress.tool.v1'
  id: string
  name: Record<string, string>
  description?: string
  inputs?: Record<string, string>
  outputs: Record<string, string>
  nodes: ToolNode[]
  edges: [string, string][]
  triggers?: ({ kind: 'on-demand' } | { kind: 'build' } | { kind: 'schedule'; every_game_days: number })[]
  failure?: { retries?: number; on_error?: 'fail' | 'keep-last' }
  limits?: { llm_calls_per_run?: number; fetches_per_run?: number }
}

export interface SiteTool {
  id: string
  hash: string
  graph: ToolGraph
  issues: ModelIssue[]
  manifest: Record<string, unknown>
}

/** `GET /api/site/blueprint`: the models at the base head. */
export interface SiteModels {
  commit: string
  /** `repo`: `blueprint/site.json`; `imported`: read from the pages (read-only). */
  source: 'repo' | 'imported'
  hash: string
  blueprint: Blueprint
  types: Record<string, unknown>
  issues: ModelIssue[]
  tools: SiteTool[]
  tool_errors: { path: string; error: string }[]
  /** The site facts of the checker's context (`blueprint-wasm` checks edits with them). */
  context: { custom_blocks: string[]; sections: string[]; collections: string[] }
  /** The brick town (`swarmpress.design.v1`, provenance `view`). */
  town: Record<string, unknown>
}
