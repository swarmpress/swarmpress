import type { Blueprint, BlueprintChange, PutBlueprintBody, PutBlueprintResult, PutToolsBody, SiteModels } from '../blueprint/types'
import type { CommandResult } from './commands'
import type { Persona } from './personas'
import type { PlanJson, PlanPost, PlanText } from './plan-types'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson } from './types'

/**
 * What changed, so a subscriber can re-read only that (a hint; `undefined` =
 * anything). `clock` and `activity` need no snapshot: game time, and the
 * activity record or the jobs in flight; nor does `site`, the site's models.
 */
export type DataTopic = 'org' | 'finance' | 'inbox' | 'plan' | 'performance' | 'clock' | 'activity' | 'site'

/** A post the CEO adds to a work item's thread (the source assigns `id`, and game time if missing). */
export type NewPlanPost = Omit<PlanPost, 'id'>

/**
 * Where the company's pull requests and published pages live. Session or
 * company data, never a constant in the UI: a field that is `null` means
 * "not known", and the panels then render plain text instead of a link.
 */
export interface SiteLinks {
  /** `owner/name` of the site repository on GitHub (the session's `company.site_repo`). */
  repo: string | null
  /**
   * Public base URL of the published site (`https://cinqueterre.travel`).
   * HOOK: no source sets it yet. The company row has the repository and its
   * base branch only; the public address belongs to the site configuration.
   * Until a source provides it, no "published page" link is rendered.
   */
  publicBaseUrl: string | null
  /** Language segment of the site's routes (the site binding's `language`); `en` when unset. */
  language?: string | null
}

export const NO_SITE_LINKS: SiteLinks = Object.freeze({ repo: null, publicBaseUrl: null })

/**
 * The editor's latest review of an article, as the orchestrator stored it
 * (`agents::EditorReview`). It is the editor's judgement, never a measurement.
 */
export interface ArticleReview {
  /** `approve`, `needs_changes` or `reject`, as the editor decided. */
  decision: string
  /** 1 to 10. */
  score: number
  notes: string
  issues: string[]
  /** Risks the editor flagged for the CEO. */
  highRisk: string[]
}

/** The brief an article was commissioned with (`agents::Brief`). */
export interface ArticleBrief {
  title: string
  angle: string
  slug: string | null
  keywords: string[]
  /** Target length in words; null when the brief names none. */
  targetWords: number | null
}

/**
 * What the company's store holds about a work item's article: the
 * orchestrator's latest artifact record (`orchestrator::ArtifactRecord`: page,
 * review, pull request) joined with its brief record
 * (`orchestrator::BriefRecord`). Text only; none of it is in the sim.
 *
 * `page` is model output. Treat it as untrusted: read it through
 * article-preview.ts and article-checks.ts, never as markup.
 */
/** One researched claim of an article's dossier (ADR-0068): untrusted text, rendered as text. */
export interface ArticleEvidence {
  /** `E1`, `E2`, …: how drafts and reviews refer to it. */
  id: string
  claim: string
  /** An http(s) address (anything else is dropped when the record is read). */
  url: string
  title: string
}

export interface ArticleRecord {
  /** The latest page JSON, as committed to the draft branch; null before the first draft. */
  page: unknown | null
  review: ArticleReview | null
  /** 0 for the first draft; each revision adds one. */
  revision: number
  /** Path of the page in the site repository. */
  path: string | null
  branch: string | null
  /** Number of the pull request in the site repository. */
  pr: number | null
  /** Head commit of the draft branch: what a Publish merges. */
  headSha: string | null
  /** Set once the pull request is merged. */
  mergedSha: string | null
  brief: ArticleBrief | null
  /** Staff ids. */
  writer: string | null
  editor: string | null
  /** The research the article rests on (ADR-0068), oldest first; empty when none was done. */
  evidence: ArticleEvidence[]
  /**
   * A structural work item's proposal (FEAT-095): the whole proposed
   * blueprint and its changes, for the instruction booklet (FEAT-101). Absent
   * for articles and tools. Model output: render it as data only.
   */
  structure?: StructureRecord | null
}

export interface StructureRecord {
  kind: string
  summary: string
  /** The blueprint hash the proposal was made on. */
  baseHash: string
  proposal: Blueprint
  changes: BlueprintChange[]
}

/**
 * One row of the activity record (ADR-0058 decision 9, FEAT-078) as the
 * company's store keeps it: a stage attempt (`stage` = the stage, `attempt`
 * from 1) or the job (`stage: 'job'`). Written by the host from the
 * orchestrator's progress events; never part of the sim (CLAUDE.md rule 2).
 * `detail` may hold text a model or a service wrote (an error): render it as
 * text, never as markup.
 */
export interface ActivityRowJson {
  job_id: number
  stage: string
  idx: number
  attempt: number
  kind: string
  revision: number
  work_item: string | null
  staff: string | null
  role: string | null
  persona: string | null
  model: string | null
  tokens_in: number
  tokens_out: number
  wall_ms: number
  game_step: number | null
  day: number | null
  minute: number | null
  /** `done`, `failed`, `repaired` (an attempt a later one replaced) or `reused` (from the stage store). */
  result: string
  /** Errors, repairs, words, score, pull request, branch and sha. */
  detail: Record<string, unknown>
  /** Wall time the row was written, unix ms (a job row's: when the job ended). */
  created_at?: number | null
}

/** A window of the activity record: the newest `limit` jobs, or those older than job `before`. */
export interface ActivityQuery {
  limit: number
  before?: number | null
}

export interface ActivityPage {
  /** Every row of the jobs in the window: newest job first, each job's rows in the order they were written. */
  rows: ActivityRowJson[]
  /** Older jobs exist beyond the window. */
  more: boolean
}

/**
 * A job in flight, from the orchestrator's progress events (ADR-0058
 * decision 8: counts, never a percentage). Jobs run one at a time, so there
 * is at most one.
 */
export interface LiveJob {
  jobId: number
  kind: string
  revision: number
  workItem: string | null
  staff: string | null
  persona: string | null
  role: string | null
  /** The stage running now (`section`); null before the first stage. */
  stage: string | null
  index: number
  total: number
  /** The stage in words ("section 3 of 5"); null before the first stage. */
  label: string | null
  /** The model of the job's latest call, once it made one. */
  model: string | null
  /** Wall time since the job started. */
  elapsedMs: number
}

/** What a data source can do. Fixed for the lifetime of the source. */
export interface SourceCapabilities {
  /**
   * The command variants the source applies (`Hire`, `AnswerTicket`, …; see
   * commands.ts). The store never sends a command that is not listed, and
   * the panels disable its control.
   */
  commands: ReadonlySet<string>
  /** KPIs exist (tracker + KpiReport). False leaves the Performance panel out of the navigation. */
  performance: boolean
  /** The source has an activity record (the company's store). False or absent leaves the Activity panel out. */
  activity?: boolean
  site: SiteLinks
  /**
   * The phrases the site's house style bans (the style guide's
   * `vocabulary.avoid`), for the measured checks of an article. Absent or
   * null when the source has no style guide: the check is then not shown.
   */
  bannedPhrases?: readonly string[] | null
}

/**
 * Where the overlay reads the company from and sends CEO commands to
 * (ADR-0018: the overlay never mutates the sim directly).
 *
 * Every read is async so the live implementation can sit on the browser's
 * authoritative wasm sim plus its Turso store (or a server) without changing
 * the panels. The shapes are the JSON contracts of
 * docs/game-design/organization.md §9 (`org_json`, `finance_json`,
 * `inbox_json`) and docs/game-design/publishing-plan.md §7 (`plan_json`),
 * with plan text in the orchestrator's `plan_json` shape
 * (`{items:{id:{title,brief}}, posts:{id:[{type,author,to?,text,payload}]}}`,
 * normalized by plan-wire.ts).
 *
 * Implementations: `MockDataSource` (fixtures, in-memory rules) and
 * `WasmDataSource` (feature-detected `Sim.*_json` + `apply_command_json`).
 */
export interface GameDataSource {
  /** Which commands, panels and links this source has. */
  capabilities(): SourceCapabilities
  /** `Sim.org_json()` (organization.md §9). */
  getOrg(): Promise<OrgJson>
  /** `Sim.finance_json()` (organization.md §9). */
  getFinance(): Promise<FinanceJson>
  /** `Sim.inbox_json()` (organization.md §9). */
  getInbox(): Promise<InboxJson>
  /** Plan skeleton (publishing-plan.md §7); empty `items` when the sim exports none yet. */
  getPlan(): Promise<PlanJson>
  /** Plan text: titles, briefs, todo text and work-item threads, keyed by the skeleton's ids. */
  getPlanText(): Promise<PlanText>
  /**
   * The article of a work item from the company's store: page JSON, pull
   * request, latest review and brief. `null` when the store has none (no
   * draft yet, or a device that restored the sim without its text).
   */
  getArticle(item: string): Promise<ArticleRecord | null>
  /** KPIs from the first-party tracker + the latest KpiReport (organization.md §6a). */
  getPerformance(): Promise<PerformanceJson>
  /**
   * A window of the activity record (FEAT-078) from the company's store:
   * bounded by `limit` jobs, never the whole record. Empty without one.
   */
  getActivity(q: ActivityQuery): Promise<ActivityPage>
  /** The jobs in flight with the stage each runs now; empty when nothing runs. */
  getLiveJobs(): Promise<LiveJob[]>
  /**
   * A cheap value that changes whenever the activity record may have
   * changed; a reader compares it on every refresh and reads rows again only
   * when it moved.
   */
  activityVersion(): unknown
  getPersona(slug: string): Promise<Persona | undefined>
  listPersonas(): Promise<Persona[]>
  /** Absolute game minute (day * 1440 + minute of day), for ticket deadlines. */
  now(): Promise<number>
  /** Apply a CEO command (JSON, serde external tagging; see commands.ts). */
  apply(commandJson: string): Promise<CommandResult>
  /** Would the command apply? Never mutates. */
  validate(commandJson: string): Promise<CommandResult>
  /**
   * Append a CEO post to a work item's thread: a comment, or the note that
   * goes with a Send back (`send-back-note`). Text only, never enters the sim.
   */
  appendPost(item: string, post: NewPlanPost): Promise<PlanPost>
  /**
   * Called whenever data may have changed (after `apply`, sim ticks, store
   * writes). `topics` is a hint. Returns an unsubscribe function.
   */
  subscribe(onChange: (topics?: DataTopic[]) => void): () => void
  /**
   * The site's blueprint, tools and town (ADR-0072), as last read from the
   * central server; `null` until read, or for a source without a site. A
   * change is announced with the `site` topic.
   */
  getSiteModels?(): Promise<SiteModels | null>
  /**
   * The CEO's edit of the blueprint, or of tools (an imported n8n workflow,
   * ADR-0076) (`PUT /api/site/blueprint`, ADR-0072).
   * Rejects with an error carrying `status` (422: `body.issues`, 409: a
   * stale `base_hash`) and `body`. Absent: the source cannot save.
   */
  saveBlueprint?(body: PutBlueprintBody | PutToolsBody): Promise<PutBlueprintResult>
  /** Read the site's models again (after a save, or a 409); announced with the `site` topic. */
  reloadSiteModels?(): Promise<void>
  /**
   * Ask the architects (FEAT-095): the request goes to the store as the
   * item's brief and `Command::Commission{kind, brief_ref}` is logged; the
   * sim staffs the Draft with the UX designer (a blueprint change) or the
   * Web Developer (a tool). Absent: the source cannot commission.
   */
  commission?(kind: 'structure' | 'tool', request: string): Promise<CommandResult>
}

/** Everything the overlay renders from, read in one go. */
export interface GameSnapshot {
  org: OrgJson
  finance: FinanceJson
  inbox: InboxJson
  plan: PlanJson
  planText: PlanText
  performance: PerformanceJson
  personas: Persona[]
  now: number
}

export async function readSnapshot(source: GameDataSource): Promise<GameSnapshot> {
  const [org, finance, inbox, plan, planText, performance, personas, now] = await Promise.all([
    source.getOrg(),
    source.getFinance(),
    source.getInbox(),
    source.getPlan(),
    source.getPlanText(),
    source.getPerformance(),
    source.listPersonas(),
    source.now(),
  ])
  return { org, finance, inbox, plan, planText, performance, personas, now }
}
