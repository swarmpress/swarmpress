/**
 * The 1 Hz timer that drives the game clock while the tab is hidden
 * (ADR-0060 decision 6, FEAT-080). The render loop stops with
 * `requestAnimationFrame` on a hidden page and main-thread timers are
 * throttled there; a dedicated worker's timer is not.
 *
 * `onTick` is called about once a second, hidden or not. The clock driver
 * decides whether a tick counts (`ClockDriver.idleTickAt`: only when no frame
 * ticked the clock for a while), so the timer and the render loop never add up.
 */
export const HIDDEN_TICK_MS = 1000

export function startTickTimer(onTick: () => void, periodMs = HIDDEN_TICK_MS): () => void {
  try {
    const worker = new Worker(new URL('./tick-worker.ts', import.meta.url), { type: 'module', name: 'swarmpress-tick' })
    worker.onmessage = () => onTick()
    worker.postMessage({ periodMs })
    return () => worker.terminate()
  } catch (e) {
    // No worker (a locked-down page): a main-thread timer still ticks, only slower while hidden.
    console.warn(`[clock] no tick worker (${String(e)}); using a page timer, which is throttled while hidden`)
    const timer = setInterval(onTick, periodMs)
    return () => clearInterval(timer)
  }
}
