/**
 * No inference over the network (ADR-0057 decision 1): every model backend
 * runs in this browser. The only network traffic a backend may cause is
 * fetching its own static files from this origin (the engine module,
 * onnxruntime-web) and downloading model weights from the Hugging Face Hub.
 * There is no inference API, no native model server (a local llama server
 * included) and no cloud fallback.
 *
 * `localOnlyFetch` enforces that at run time: the worker hands it to every
 * adapter as its `fetch`, and a request to any other host is refused before
 * it leaves the page. `local-only.test.ts` checks the backend modules'
 * sources for inference endpoints as well.
 */

/** Hosts that serve model weights: the Hugging Face Hub and its CDNs (`*.huggingface.co`, `*.hf.co`). */
export const WEIGHT_HOSTS = ['huggingface.co', 'hf.co'] as const

/** Hugging Face's own hosted inference (the serverless API, the providers' router) is inference over the network. */
const HUB_INFERENCE_HOST = /^(api-inference|router|inference)\./i

export class NetworkInferenceBlockedError extends Error {
  readonly url: string
  constructor(url: string, why = 'a model backend may only fetch this site’s own files and download model weights from the Hugging Face Hub') {
    super(`refused to fetch ${url}: ${why} (ADR-0057: no inference over the network)`)
    this.name = 'NetworkInferenceBlockedError'
    this.url = url
  }
}

export function isWeightHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (HUB_INFERENCE_HOST.test(h)) return false
  return WEIGHT_HOSTS.some((w) => h === w || h.endsWith(`.${w}`))
}

const sameOrigin = (u: URL, origin: string) => !!origin && origin !== 'null' && u.origin === new URL(origin).origin

/** May a model backend fetch `url`? Same origin, `blob:`/`data:`, or HTTPS to a weight host. */
export function allowedModelUrl(url: string, origin: string): boolean {
  let u: URL
  try {
    u = new URL(url, origin)
  } catch {
    return false
  }
  if (u.protocol === 'blob:' || u.protocol === 'data:') return true
  if (sameOrigin(u, origin)) return true
  return u.protocol === 'https:' && isWeightHost(u.hostname)
}

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
const methodOf = (input: RequestInfo | URL, init?: RequestInit): string =>
  (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()

/**
 * `inner`, refusing every request a model backend has no business making: any
 * host but this origin and the weight hosts, and anything but a GET or HEAD
 * to a weight host (a download never sends a body; an inference request does).
 */
export function localOnlyFetch(inner: typeof fetch, origin: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (!allowedModelUrl(url, origin)) return Promise.reject(new NetworkInferenceBlockedError(url))
    const u = new URL(url, origin)
    const method = methodOf(input, init)
    if (u.protocol === 'https:' && !sameOrigin(u, origin) && method !== 'GET' && method !== 'HEAD') {
      return Promise.reject(new NetworkInferenceBlockedError(url, `a weight download is a GET or HEAD, not a ${method}`))
    }
    return inner(input, init)
  }) as typeof fetch
}
