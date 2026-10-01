/**
 * GPU sharing between Babylon and the LLM worker (plan D, "GPU sharing").
 *
 *   idle ──begin──▶ generating ──end(last)──▶ cooldown ──restoreDelay──▶ idle
 *                       ▲                         │
 *                       └──────────begin──────────┘
 *
 * Entering `generating` asks the renderer to drop one quality tier and cap
 * the frame rate; returning to `idle` (after a short cooldown so back-to-back
 * jobs don't make the scene flicker between tiers) restores both. While
 * generating, sustained frame times above budget drop one more tier
 * (at most `maxDrop`).
 *
 * Hidden tab + `pauseWhenHidden`: the scheduler reports `paused`, and
 * `waitUntilRunnable()` blocks the job runner from starting new generations
 * until the tab is visible again. An in-flight generation is not interrupted
 * (Transformers.js cannot suspend mid-decode); it simply finishes.
 *
 * Pure: timers are injected (vitest fake timers patch the globals anyway),
 * the renderer is reached only through `RendererHooks`.
 */

export interface RendererHooks {
  /** 0 = configured quality, 1 = one tier lower, ... */
  setQualityDrop(levels: number): void
  /** null = uncapped. */
  setFpsCap(fps: number | null): void
}

export interface GpuSchedulerSettings {
  fpsCap: number
  restoreDelayMs: number
  pauseWhenHidden: boolean
  maxDrop: number
  /** Frames over budget (EMA) before the extra drop. */
  slowFramesBeforeExtraDrop: number
}

export const DEFAULT_SCHEDULER_SETTINGS: GpuSchedulerSettings = {
  fpsCap: 30,
  restoreDelayMs: 1500,
  pauseWhenHidden: true,
  maxDrop: 2,
  slowFramesBeforeExtraDrop: 60,
}

export type SchedulerState = 'idle' | 'generating' | 'cooldown'

export interface SchedulerSnapshot {
  state: SchedulerState
  qualityDrop: number
  fpsCap: number | null
  paused: boolean
  hidden: boolean
  active: number
}

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
}

const globalTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export class GpuScheduler {
  private _state: SchedulerState = 'idle'
  private active = new Set<string>()
  private hidden = false
  private drop = 0
  private cap: number | null = null
  private timer: unknown = null
  private ema = 0
  private slowFrames = 0
  private listeners = new Set<(s: SchedulerSnapshot) => void>()
  private waiters: Array<() => void> = []
  settings: GpuSchedulerSettings

  constructor(
    private hooks: RendererHooks,
    settings: Partial<GpuSchedulerSettings> = {},
    private timers: Timers = globalTimers,
  ) {
    this.settings = { ...DEFAULT_SCHEDULER_SETTINGS, ...settings }
  }

  get state(): SchedulerState {
    return this._state
  }

  get paused(): boolean {
    return this.hidden && this.settings.pauseWhenHidden
  }

  snapshot(): SchedulerSnapshot {
    return { state: this._state, qualityDrop: this.drop, fpsCap: this.cap, paused: this.paused, hidden: this.hidden, active: this.active.size }
  }

  onChange(fn: (s: SchedulerSnapshot) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** A generation started (idempotent per id). */
  begin(id: string) {
    this.active.add(id)
    if (this._state === 'cooldown') this.cancelTimer()
    if (this._state !== 'generating') {
      this._state = 'generating'
      if (this.drop === 0) this.applyDrop(1)
      this.applyCap(this.settings.fpsCap)
    }
    this.emit()
  }

  /** A generation ended (idempotent per id). */
  end(id: string) {
    if (!this.active.delete(id)) return
    if (this.active.size === 0 && this._state === 'generating') {
      this._state = 'cooldown'
      this.timer = this.timers.setTimeout(() => this.restore(), this.settings.restoreDelayMs)
    }
    this.emit()
  }

  /** Feed per-frame times (ms) from the render loop. */
  reportFrameTime(ms: number) {
    this.ema = this.ema === 0 ? ms : this.ema * 0.9 + ms * 0.1
    if (this._state !== 'generating') {
      this.slowFrames = 0
      return
    }
    const budget = (1000 / this.settings.fpsCap) * 1.25
    this.slowFrames = this.ema > budget ? this.slowFrames + 1 : 0
    if (this.slowFrames >= this.settings.slowFramesBeforeExtraDrop && this.drop < this.settings.maxDrop) {
      this.applyDrop(this.drop + 1)
      this.slowFrames = 0
      this.emit()
    }
  }

  setHidden(hidden: boolean) {
    if (hidden === this.hidden) return
    this.hidden = hidden
    if (!this.paused) this.flushWaiters()
    this.emit()
  }

  updateSettings(patch: Partial<GpuSchedulerSettings>) {
    this.settings = { ...this.settings, ...patch }
    if (this._state === 'generating') this.applyCap(this.settings.fpsCap)
    if (!this.paused) this.flushWaiters()
    this.emit()
  }

  /** Resolves when new generations may start (immediately unless paused). */
  waitUntilRunnable(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((r) => this.waiters.push(r))
  }

  /** Wire document visibility. Returns an unsubscribe function. */
  attachVisibility(doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document): () => void {
    const onChange = () => this.setHidden(doc.hidden)
    doc.addEventListener('visibilitychange', onChange)
    onChange()
    return () => doc.removeEventListener('visibilitychange', onChange)
  }

  dispose() {
    this.cancelTimer()
    if (this.drop !== 0) this.applyDrop(0)
    if (this.cap !== null) this.applyCap(null)
    this._state = 'idle'
    this.active.clear()
    this.flushWaiters()
    this.listeners.clear()
  }

  private restore() {
    this.timer = null
    if (this._state !== 'cooldown') return
    this._state = 'idle'
    this.applyDrop(0)
    this.applyCap(null)
    this.slowFrames = 0
    this.emit()
  }

  private applyDrop(levels: number) {
    if (levels === this.drop) return
    this.drop = levels
    this.hooks.setQualityDrop(levels)
  }

  private applyCap(fps: number | null) {
    if (fps === this.cap) return
    this.cap = fps
    this.hooks.setFpsCap(fps)
  }

  private cancelTimer() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  private flushWaiters() {
    const w = this.waiters
    this.waiters = []
    for (const r of w) r()
  }

  private emit() {
    const s = this.snapshot()
    for (const l of this.listeners) l(s)
  }
}
