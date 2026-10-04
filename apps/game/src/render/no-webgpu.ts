import type { NoWebGpuReason } from './engine'

/**
 * The page a browser without usable WebGPU gets (ADR-0064 decision 2): it
 * says what is missing, names the browsers that work, and links to the
 * requirements. The game never degrades silently to another renderer.
 */

export const REQUIREMENTS_URL = 'https://github.com/gpuweb/gpuweb/wiki/Implementation-Status'

const WHAT: Record<NoWebGpuReason, string> = {
  'no-api': 'This browser does not offer WebGPU: it is too old, or WebGPU is turned off in it.',
  'no-adapter': 'This browser has WebGPU, but it offered no graphics adapter: the GPU or its driver is blocklisted, or hardware acceleration is turned off.',
  'device-failed': 'This browser has WebGPU, but the graphics device would not start.',
  'device-lost': 'The graphics device was lost and could not be started again.',
}

export const SUPPORTED_BROWSERS = [
  'Chrome or Edge 113 or newer on Windows, macOS and ChromeOS',
  'Chrome 121 or newer on Android',
  'Safari 26 or newer on macOS, iOS and iPadOS',
  'Firefox 141 or newer on Windows',
]

export function noWebGpuMessage(reason: NoWebGpuReason): string {
  return WHAT[reason]
}

export function mountNoWebGpu(parent: HTMLElement, reason: NoWebGpuReason, detail: string): HTMLElement {
  const doc = parent.ownerDocument
  const el = doc.createElement('section')
  el.id = 'no-webgpu'
  el.setAttribute('role', 'alert')
  el.dataset.reason = reason
  el.style.cssText =
    'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;' +
    'background:#14161a;color:#e8e6e1;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:auto'
  const card = doc.createElement('div')
  card.style.cssText = 'max-width:560px;width:100%'
  const h = doc.createElement('h1')
  h.textContent = 'swarm.press needs WebGPU'
  h.style.cssText = 'font-size:22px;margin:0 0 12px'
  const what = doc.createElement('p')
  what.className = 'no-webgpu-what'
  what.textContent = WHAT[reason]
  const why = doc.createElement('p')
  why.textContent = 'The office is drawn with WebGPU, and your staff’s language model runs on it in this browser. There is no fallback.'
  const listHead = doc.createElement('p')
  listHead.textContent = 'These browsers work, on a device with a supported GPU:'
  listHead.style.margin = '16px 0 4px'
  const list = doc.createElement('ul')
  list.style.cssText = 'margin:0 0 16px;padding-left:20px'
  for (const b of SUPPORTED_BROWSERS) {
    const li = doc.createElement('li')
    li.textContent = b
    list.append(li)
  }
  const more = doc.createElement('p')
  const link = doc.createElement('a')
  link.href = REQUIREMENTS_URL
  link.target = '_blank'
  link.rel = 'noopener'
  link.textContent = 'WebGPU support by browser and platform'
  link.style.color = '#8fb8ff'
  more.append('Details: ', link, '. On Linux, most browsers still keep WebGPU behind a flag.')
  const tech = doc.createElement('p')
  tech.className = 'no-webgpu-detail'
  tech.textContent = `Reason: ${reason} (${detail})`
  tech.style.cssText = 'font:12px/1.4 ui-monospace,monospace;opacity:0.7;margin-top:16px;overflow-wrap:anywhere'
  card.append(h, what, why, listHead, list, more, tech)
  el.append(card)
  parent.append(el)
  return el
}
