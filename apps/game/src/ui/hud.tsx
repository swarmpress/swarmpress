import { render } from 'preact'
import { signal } from '@preact/signals'
import { SPEEDS, type ClockStatus } from '../session/clock-driver'
import { elapsed, eurCompact } from './format'
import { repoUrl } from './links'
import { siteBindingText, type SiteBindingView } from './site-binding'
import './hud.css'

export interface HudState {
  clock: string
  day: number
  renderer: string
  version: string
  fps: number
}

/** Company numbers the CEO overlay feeds into the HUD (organization.md §6–7). */
export interface HudBusiness {
  cashEur: number
  runwayDays: number | null
  /** false without a CFO: "books not kept". */
  booksKept: boolean
  openTickets: number
  highTickets: number
}

/**
 * The game clock as the player sees and sets it (ADR-0060 decision 8,
 * FEAT-080): the status chip, pause and speed, and the day-done card. Null on
 * frozen screenshot pages (`?t=`), whose HUD stays as it was.
 */
export interface HudClock {
  status: ClockStatus
  paused: boolean
  /** Sim steps per 100 ms of clock. */
  speed: number
  /** Days that still start by themselves; null where the rest rule does not apply (the offline demo). */
  unattendedDays: number | null
  /** The day is done: the card is up until the next day is started. */
  resting: boolean
}

/** What the HUD's buttons do; the session's clock driver, or the offline demo's. */
export interface HudControls {
  pause(): void
  resume(): void
  setSpeed(speed: number): void
  setUnattendedDays(days: number): void
  startNextDay(): void
}

export interface HudToast {
  id: number
  text: string
}

const state = signal<HudState>({ clock: '--:--', day: 0, renderer: '', version: '', fps: 0 })
export const hudBusiness = signal<HudBusiness | null>(null)
export const hudClock = signal<HudClock | null>(null)
/** Loop errors shown as toasts (newest last); each leaves after `TOAST_MS`. */
export const hudToasts = signal<HudToast[]>([])
/** The last loop error, kept on the chip until the player dismisses it. */
export const hudAlert = signal<string | null>(null)
/** The repository the company writes to (G2); the session sets it, null on the offline page. */
export const hudSite = signal<SiteBindingView | null>(null)

/**
 * What runs now (FEAT-078, increment U4): the job in flight from the
 * orchestrator's progress events, which the CEO overlay sets (mount.tsx).
 * Null when nothing runs.
 */
export interface HudNow {
  jobId: number
  /** First name ("Giulia"); null when the job names nobody. */
  who: string | null
  /** The job kind as the chip says it ("draft"). */
  kind: string
  /** The stage in counts ("section 3 of 5"); null before the first stage. */
  stage: string | null
  elapsedMs: number
  /** Opens the Activity panel on this job. */
  open(): void
}
export const hudNow = signal<HudNow | null>(null)

/** "Giulia · draft · section 3 of 5" (the chip's words, ADR-0058 decision 8). */
export const nowText = (n: Pick<HudNow, 'who' | 'kind' | 'stage'>) => [n.who, n.kind, n.stage].filter(Boolean).join(' · ')

export const TOAST_MS = 10_000
const MAX_TOASTS = 3
let toastSeq = 0

/**
 * Surfaces an error of the orchestration loop (a failed or timed-out job, a
 * rejected outcome, a failed checkpoint): a toast now, and a mark on the chip
 * until it is dismissed. Works before the HUD is mounted.
 */
export function hudNotify(text: string) {
  const toast = { id: ++toastSeq, text }
  hudToasts.value = [...hudToasts.value, toast].slice(-MAX_TOASTS)
  hudAlert.value = text
  setTimeout(() => {
    hudToasts.value = hudToasts.value.filter((t) => t.id !== toast.id)
  }, TOAST_MS)
}

export function HudBusinessStats({ b }: { b: HudBusiness }) {
  return (
    <span class="hud-business">
      <span class="hud-stat" title="Cash">
        <span class="hud-label">Cash</span> {eurCompact(b.cashEur)}
      </span>
      {b.booksKept ? (
        <span class={`hud-stat${b.runwayDays != null && b.runwayDays < 30 ? ' is-warn' : ''}`} title="Runway">
          <span class="hud-label">Runway</span> {b.runwayDays == null ? '—' : `${b.runwayDays} d`}
        </span>
      ) : (
        <span class="hud-stat is-warn">Books not kept</span>
      )}
      <span class={`hud-stat${b.highTickets > 0 ? ' is-alert' : ''}`} title="Open tickets">
        <span class="hud-label">Inbox</span> {b.openTickets}
        {b.highTickets > 0 && <span class="hud-high"> · {b.highTickets} high</span>}
      </span>
    </span>
  )
}

/**
 * The status chip: exactly one of Running / Held / Resting / Model loading /
 * Lease lost / Halted / Paused, with who and what or the reason. A loop error
 * adds a mark the player can dismiss.
 *
 * With `now` (the clock is held for the job in flight, so the chip already
 * says "Giulia · draft · section 3 of 5") the chip is the way into the
 * Activity panel on that job, with the job's elapsed time, instead of a
 * second "Now" line saying the same.
 */
export function StatusChip({ status, alert, onDismissAlert, now }: { status: ClockStatus; alert?: string | null; onDismissAlert?: () => void; now?: HudNow | null }) {
  const text = status.detail ? `${status.label}: ${status.detail}` : status.label
  const inner = (
    <>
      <span class="hud-chip-dot" aria-hidden="true" />
      <span class="hud-chip-label">{status.label}</span>
      {status.detail && <span class="hud-chip-detail">{status.detail}</span>}
      {now && <span class="hud-chip-time">{elapsed(now.elapsedMs)}</span>}
    </>
  )
  return (
    <span class="hud-chip-wrap">
      {now ? (
        <button
          type="button"
          class={`hud-chip is-${status.state} is-link`}
          data-state={status.state}
          data-job={now.jobId}
          title={`${text} (open in Activity)`}
          aria-label={`${text}, ${elapsed(now.elapsedMs)}. Open in Activity`}
          onClick={() => now.open()}
        >
          {inner}
        </button>
      ) : (
        <span class={`hud-chip is-${status.state}`} data-state={status.state} title={text}>
          {inner}
        </span>
      )}
      {alert && (
        <button type="button" class="hud-chip-alert" title={`${alert} (click to dismiss)`} aria-label={`Error: ${alert}. Dismiss`} onClick={onDismissAlert}>
          !
        </button>
      )}
    </span>
  )
}

/**
 * The "Now" strip (U4): one line on what runs now ("Giulia · draft · section
 * 3 of 5 · 1:42"); a click opens the Activity panel on that job.
 */
export function NowStrip({ now }: { now: HudNow }) {
  const text = nowText(now)
  const time = elapsed(now.elapsedMs)
  return (
    <button
      type="button"
      class="hud-now"
      data-job={now.jobId}
      title="Open in Activity"
      aria-label={`Now: ${text}, ${time}. Open in Activity`}
      onClick={() => now.open()}
    >
      <span class="hud-label">Now</span>
      <span class="hud-now-text">{text}</span>
      <span class="hud-now-time">{time}</span>
    </button>
  )
}

/**
 * The company's site binding (G2): the repository and base branch the gateway
 * writes to, read only, linked to the repository. Marked when the server's
 * default for new companies has moved elsewhere since.
 */
export function SiteChip({ site }: { site: SiteBindingView }) {
  const url = repoUrl({ repo: site.repo, publicBaseUrl: null })
  const label = `${site.repo} · ${site.baseBranch}`
  return (
    <span class={`hud-site${site.serverDefault ? ' is-warn' : ''}`} title={siteBindingText(site)} data-repo={site.repo}>
      <span class="hud-label">Writes to</span>{' '}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
      {site.serverDefault && <span class="sr-only"> (the server's default is now {site.serverDefault.repo})</span>}
    </span>
  )
}

/** Pause and speed. The current speed is listed even when the URL set one the buttons do not offer. */
export function ClockControls({ clock, controls }: { clock: HudClock; controls: HudControls }) {
  const offered: readonly number[] = SPEEDS
  const speeds = offered.includes(clock.speed) ? [...offered] : [...offered, clock.speed].sort((a, b) => a - b)
  return (
    <span class="hud-controls" role="group" aria-label="Game clock">
      <button
        type="button"
        class="hud-btn hud-pause"
        aria-pressed={clock.paused}
        aria-label={clock.paused ? 'Resume the clock' : 'Pause the clock'}
        title={clock.paused ? 'Resume' : 'Pause'}
        onClick={() => (clock.paused ? controls.resume() : controls.pause())}
      >
        {clock.paused ? '▶' : '❚❚'}
      </button>
      {speeds.map((n) => (
        <button key={n} type="button" class="hud-btn hud-speed" aria-pressed={clock.speed === n} aria-label={`Speed ${n}×`} title={`${n}× speed`} onClick={() => controls.setSpeed(n)}>
          {n}×
        </button>
      ))}
    </span>
  )
}

function UnattendedDays({ days, controls, label }: { days: number; controls: HudControls; label: string }) {
  return (
    <label class="hud-unattended">
      <span class="hud-label">{label}</span>
      <input
        type="number"
        min={0}
        max={365}
        step={1}
        value={days}
        onChange={(e) => controls.setUnattendedDays(Number((e.currentTarget as HTMLInputElement).value))}
      />
    </label>
  )
}

/** The day-done card: the clock rests until the player starts the next day (or the unattended counter does). */
export function DayDoneCard({ day, clock, controls }: { day: number; clock: HudClock; controls: HudControls }) {
  return (
    <div class="hud-card day-done" role="dialog" aria-label="Day done">
      <h2 class="hud-card-title">Day done</h2>
      <p class="hud-card-text">Day {day + 1}: nothing is in flight, and the office rests. Deadlines wait with it.</p>
      <button type="button" class="hud-card-primary" onClick={() => controls.startNextDay()}>
        Start the next day
      </button>
      {clock.unattendedDays != null && <UnattendedDays days={clock.unattendedDays} controls={controls} label="Days to run unattended after it" />}
    </div>
  )
}

export function HudToasts({ toasts }: { toasts: HudToast[] }) {
  return (
    <div class="hud-toasts" role="alert" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} class="hud-toast">
          {t.text}
        </div>
      ))}
    </div>
  )
}

function Hud({ controls }: { controls: HudControls | null }) {
  const s = state.value
  const b = hudBusiness.value
  const c = hudClock.value
  const toasts = hudToasts.value
  const site = hudSite.value
  // What runs now, on live pages only (frozen `?t=` pages have no clock HUD, so no strip either).
  const now = c ? hudNow.value : null
  // A held clock waits for the job in flight, and the chip already says so: the chip opens it.
  const chipIsNow = !!now && c?.status.state === 'held'
  return (
    <>
      <div class={c ? 'hud has-clock' : 'hud'} role="status" aria-live="off">
        <span class="hud-clock">
          Day {s.day + 1} · {s.clock}
        </span>
        {c && <StatusChip status={c.status} alert={hudAlert.value} onDismissAlert={() => (hudAlert.value = null)} now={chipIsNow ? now : null} />}
        {now && !chipIsNow && <NowStrip now={now} />}
        {c && controls && <ClockControls clock={c} controls={controls} />}
        {c && controls && c.unattendedDays != null && <UnattendedDays days={c.unattendedDays} controls={controls} label="Unattended days" />}
        {b && <HudBusinessStats b={b} />}
        {site && <SiteChip site={site} />}
        <span class="hud-meta">
          {s.renderer} · {s.fps} fps · {s.version}
        </span>
      </div>
      {c?.resting && controls && <DayDoneCard day={s.day} clock={c} controls={controls} />}
      {toasts.length > 0 && <HudToasts toasts={toasts} />}
    </>
  )
}

const sameClock = (a: HudClock | null, b: HudClock | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.status.state === b.status.state &&
    a.status.detail === b.status.detail &&
    a.paused === b.paused &&
    a.speed === b.speed &&
    a.unattendedDays === b.unattendedDays &&
    a.resting === b.resting)

/**
 * Heads-up display: clock and renderer, the clock's status chip and controls
 * (ADR-0060), plus company numbers and what runs now once the CEO overlay is
 * mounted (ADR-0018, U4).
 */
export function mountHud(el: HTMLElement, controls: HudControls | null = null) {
  render(<Hud controls={controls} />, el)
  return {
    set(next: HudState) {
      const prev = state.peek()
      if (prev.clock !== next.clock || prev.day !== next.day || prev.fps !== next.fps || prev.renderer !== next.renderer) state.value = next
    },
    /** The clock's status and settings; called every frame, re-renders only on a change. */
    setClock(next: HudClock | null) {
      if (!sameClock(hudClock.peek(), next)) hudClock.value = next
    },
    dispose() {
      hudClock.value = null
      render(null, el)
    },
  }
}
