/**
 * Meeting speech in the host (ADR-0062 decision 8, FEAT-025; design §2
 * "Bubbles"): the standup's turns, reported by the orchestrator as `turn`
 * progress events (`TurnFinished{job_id, seq, speaker, chars}`) after each
 * transcript row, become `Utterance{meeting, seq, speaker, chars}` commands
 * that the loop applies one at a time at step boundaries. The words stay in
 * the store (CLAUDE.md rule 2): the sim only learns who talks for how long.
 *
 * And the standup's context (design §2 "Context pack"): what the host adds to
 * the job request from the sim's plan view, the plan store and the activity
 * record, with the wall-clock date.
 */

/** Characters a reader takes in per second (`sim-core::world::utterance_steps`). */
export const READ_CHARS_PER_SECOND = 15
export const MIN_UTTERANCE_MS = 3_000
export const MAX_UTTERANCE_MS = 12_000

/**
 * How long a turn stays the newest before the next one is applied:
 * `clamp(chars / 15, 3, 12)` seconds of wall time, divided by the clock's
 * speed (`speed=10` plays a meeting ten times as fast, as it plays the day).
 */
export function utteranceMs(chars: number, speed = 1): number {
  const ms = Math.min(MAX_UTTERANCE_MS, Math.max(MIN_UTTERANCE_MS, (chars / READ_CHARS_PER_SECOND) * 1000))
  return ms / Math.max(1, speed)
}

/** One turn waiting to be spoken. `seq` is the transcript's; the sim numbers its own utterances. */
export interface Turn {
  job: number
  meeting: string
  seq: number
  speaker: string
  chars: number
}

/** A `turn` progress event as the orchestrator reports it, else null. */
export function turnOf(ev: { job_id: number; stage: string; detail?: Record<string, unknown> | null }, meeting: string | null): Turn | null {
  if (ev.stage !== 'turn') return null
  const d = ev.detail ?? {}
  const m = typeof d.meeting === 'string' ? d.meeting : meeting
  const seq = Number(d.seq)
  const chars = Number(d.chars)
  if (!m || typeof d.speaker !== 'string' || !Number.isInteger(seq) || !(chars > 0)) return null
  return { job: ev.job_id, meeting: m, seq, speaker: d.speaker, chars }
}

/** The sim's expected seq, from a rejection's text (`out of order: expected seq 3, got 1`). */
export function expectedSeq(reason: string | undefined): number | null {
  const m = reason ? /expected seq (\d+)/.exec(reason) : null
  return m ? Number(m[1]) : null
}

/** Rejected because the speaker is still walking to the table: worth waiting for. */
export const notSeatedYet = (reason: string | undefined) => !!reason && /not seated/.test(reason)

// ---------------------------------------------------------------- the standup's context

/** `orchestrator::StandupContext`. */
export interface StandupContextJson {
  today: string
  wip?: { limit: number; open: number; room: number; awaiting_approval: number; free_writers: string[] }
  in_flight: { id: string; status: string; title: string | null }[]
  minutes_per_article: number | null
  model_minutes_per_day?: number
}

interface PlanWip {
  project: string
  limit: number
  open: number
  room: number
  awaitingApproval: number
  freeWriters: string[]
}

/** The local date `YYYY-MM-DD` (seasons follow wall time, ADR-0048). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Model minutes one article took (its draft and review jobs), averaged over
 * the activity record's finished job rows; null until one was measured.
 */
export function minutesPerArticle(rows: { stage: string; kind: string; result: string; wall_ms: number }[]): number | null {
  const mean = (kind: string) => {
    const ws = rows.filter((r) => r.stage === 'job' && r.kind === kind && r.result === 'done').map((r) => r.wall_ms)
    return ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null
  }
  const draft = mean('draft')
  if (draft == null) return null
  return (draft + (mean('review') ?? 0)) / 60_000
}

/**
 * The context of a standup for `project`: work in progress and items in
 * flight from the sim's `plan_json()`, titles from the plan store.
 */
export function standupContext(
  planJson: string,
  project: string,
  opts: { now: Date; titles?: Record<string, string | undefined>; minutesPerArticle?: number | null; modelMinutesPerDay?: number },
): StandupContextJson {
  const plan = JSON.parse(planJson) as { items: { id: string; project: string; status: string }[]; wip?: PlanWip[] }
  const wip = plan.wip?.find((w) => w.project === project)
  const closed = new Set(['published', 'cancelled'])
  return {
    today: localDate(opts.now),
    ...(wip
      ? { wip: { limit: wip.limit, open: wip.open, room: wip.room, awaiting_approval: wip.awaitingApproval, free_writers: wip.freeWriters } }
      : {}),
    in_flight: plan.items
      .filter((i) => i.project === project && !closed.has(i.status))
      .map((i) => ({ id: i.id, status: i.status, title: opts.titles?.[i.id] || null })),
    minutes_per_article: opts.minutesPerArticle ?? null,
    ...(opts.modelMinutesPerDay ? { model_minutes_per_day: opts.modelMinutesPerDay } : {}),
  }
}
