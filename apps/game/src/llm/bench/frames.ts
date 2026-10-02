/**
 * Frame intervals of the office scene, sorted by what the model was doing
 * when each frame was drawn (ADR-0057: the model and the renderer share one
 * physical GPU). No Babylon here: scene.ts calls `frame()` once per rendered
 * frame, the runner switches the phase.
 */
import { downsample, stats, type FramePhase, type FrameSummary } from './metrics'

/** Samples kept per phase in a summary. */
const MAX_SAMPLES = 2000

export class FrameRecorder {
  private readonly buckets = new Map<FramePhase, number[]>()
  private last: number | null = null
  private base: FramePhase = 'idle-unloaded'
  private generating = 0
  private hiddenSince: number | null = null
  private hiddenMs = 0

  /** What the model is doing between generations. */
  setBase(phase: Exclude<FramePhase, 'generating'>): void {
    this.base = phase
  }

  /** A generation started or ended; overlapping ones are counted. */
  generation(delta: 1 | -1): void {
    this.generating = Math.max(0, this.generating + delta)
  }

  get phase(): FramePhase {
    return this.generating > 0 ? 'generating' : this.base
  }

  /** The tab was hidden or shown. Frames stop while hidden; that gap is not a frame time. */
  visibility(hidden: boolean, now: number): void {
    if (hidden) {
      this.hiddenSince ??= now
      this.last = null
    } else if (this.hiddenSince !== null) {
      this.hiddenMs += now - this.hiddenSince
      this.hiddenSince = null
      this.last = null
    }
  }

  /** One frame was rendered at `now` (ms). The interval since the previous frame goes to the current phase. */
  frame(now: number): void {
    if (this.hiddenSince !== null) return
    if (this.last !== null) {
      const phase = this.phase
      const list = this.buckets.get(phase) ?? []
      list.push(now - this.last)
      this.buckets.set(phase, list)
    }
    this.last = now
  }

  count(phase: FramePhase): number {
    return this.buckets.get(phase)?.length ?? 0
  }

  summary(renderer: string, quality: string): FrameSummary {
    const phases: FrameSummary['phases'] = {}
    for (const [phase, list] of this.buckets) {
      const s = stats(list)
      if (s) phases[phase] = { ...s, samples: downsample(list, MAX_SAMPLES).map((x) => Math.round(x * 100) / 100) }
    }
    return { renderer, quality, hiddenMs: Math.round(this.hiddenMs), phases }
  }
}
