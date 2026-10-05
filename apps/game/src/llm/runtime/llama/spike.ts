// The ADR-0066 runtime spike page (llama-spike.html). It drives the Worker and
// watches the main thread's frames: a gap of more than STOP_GAP_MS while the
// model generates stops the turn, so a starved compositor is measured instead
// of taking the session down.
const STOP_GAP_MS = 2000

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const log = (t: string) => {
  const el = $('log')
  el.textContent += `${new Date().toISOString().slice(11, 19)} ${t}\n`
  el.scrollTop = el.scrollHeight
}

const worker = new Worker(new URL('./spike.worker.ts', import.meta.url), { type: 'module' })
let generating = false
let started = 0
let pieces = 0
let worstGap = 0
let gaps: number[] = []

// Frame watcher.
let lastFrame = performance.now()
const frame = (now: number) => {
  const gap = now - lastFrame
  lastFrame = now
  if (generating) {
    gaps.push(gap)
    worstGap = Math.max(worstGap, gap)
    if (gap > STOP_GAP_MS) {
      log(`frame gap ${gap.toFixed(0)} ms: stopping the turn`)
      worker.postMessage({ type: 'stop' })
    }
  }
  $('frames').textContent = generating ? `worst frame gap ${worstGap.toFixed(0)} ms` : ''
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

worker.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'log') log(m.text)
  else if (m.type === 'progress') $('progress').textContent = `${m.file}: ${(m.loaded / 1e9).toFixed(2)} of ${(m.total / 1e9).toFixed(2)} GB`
  else if (m.type === 'downloaded') log('download complete')
  else if (m.type === 'loaded') log(`loaded in ${(m.ms / 1000).toFixed(1)} s: ${JSON.stringify(m.status)}`)
  else if (m.type === 'piece') {
    pieces++
    $('out').textContent += m.text
    const s = (performance.now() - started) / 1000
    $('rate').textContent = `${pieces} tokens shown, ${(pieces / s).toFixed(1)} tok/s overall`
  } else if (m.type === 'done') {
    generating = false
    const s = m.stats
    const sorted = [...gaps].sort((a, b) => a - b)
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0
    const decodeTps = s.decodeMs > 0 ? ((s.tokens - 1) / (s.decodeMs / 1000)).toFixed(1) : '–'
    const accept = s.drafted > 0 ? `${((100 * s.accepted) / s.drafted).toFixed(0)}% of ${s.drafted} drafted` : 'no drafts'
    log(
      `${s.ok ? '' : `error: ${s.error} `}prompt ${s.promptTokens} tok, ${s.tokens} tok in ${s.targetSteps} target steps, ` +
        `TTFT ${(s.ttftMs / 1000).toFixed(2)} s, decode ${decodeTps} tok/s, accepted ${accept}, ` +
        `frames p95 ${p95.toFixed(0)} ms, worst ${worstGap.toFixed(0)} ms${s.stopped ? ', stopped' : ''}`,
    )
  } else if (m.type === 'error') {
    generating = false
    log(`error: ${m.text}`)
  }
}

$('download').onclick = () => worker.postMessage({ type: 'download' })
$('load').onclick = () =>
  worker.postMessage({ type: 'load', withDraft: $<HTMLInputElement>('draft').checked, nCtx: Number($<HTMLInputElement>('ctx').value), nDraftMax: Number($<HTMLInputElement>('nmax').value) })
const generate = (mtp: boolean) => {
  $('out').textContent = ''
  pieces = 0
  worstGap = 0
  gaps = []
  started = performance.now()
  generating = true
  worker.postMessage({
    type: 'generate',
    prompt: $<HTMLTextAreaElement>('prompt').value,
    nPredict: Number($<HTMLInputElement>('npredict').value),
    mtp,
    thinking: $<HTMLInputElement>('thinking').checked,
  })
}
$('gen-mtp').onclick = () => generate(true)
$('gen-plain').onclick = () => generate(false)
$('stop').onclick = () => worker.postMessage({ type: 'stop' })
log(`cross-origin isolated: ${crossOriginIsolated}; WebGPU: ${'gpu' in navigator}`)
