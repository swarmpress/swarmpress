/**
 * The php-wasm backend's channel (FEAT-105) against a fake sandbox on the other end of the
 * MessagePort: readiness, requests correlated by id, storage messages answered by the game's
 * handler, and a sandbox that fails to boot.
 */
import { describe, expect, it } from 'vitest'
import { PhpWasmSandbox, type SandboxConnector } from './sandbox-host'
import { isPhpUnavailable } from './types'

/** A sandbox that answers every request by asking storage for the query in its URL. */
const fakeSandbox: SandboxConnector = (port) => {
  const replies = new Map<number, (reply: string) => void>()
  let next = 1000
  port.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; id: number; request?: { url: string }; reply?: string }
    if (m.type === 'storage-reply') {
      replies.get(m.id)?.(m.reply!)
      replies.delete(m.id)
    } else if (m.type === 'request') {
      const sid = next++
      replies.set(sid, (text) => {
        const body = new TextEncoder().encode(`<p>${text}</p>`).buffer
        port.postMessage({ type: 'response', id: m.id, response: { status: 200, headers: { 'content-type': ['text/html'] }, body } }, [body])
      })
      port.postMessage({ type: 'storage', id: sid, payload: JSON.stringify({ op: 'query', sql: m.request!.url }) })
    }
  }
  port.postMessage({ type: 'ready', php: '8.4', files: 3, ms: 1 })
  return { dispose: () => port.close() }
}

describe('PhpWasmSandbox', () => {
  it('boots, sends requests and answers the storage messages they cause', async () => {
    const seen: string[] = []
    const php = new PhpWasmSandbox(fakeSandbox, async (payload) => {
      seen.push(JSON.parse(payload).sql)
      return '{"rows":[["Cinque Terre"]]}'
    })
    expect(await php.boot()).toEqual({ php: '8.4', files: 3, ms: 1 })
    const [a, b] = await Promise.all([php.request({ url: '/a' }), php.request({ url: '/b' })])
    expect([a.status, a.text(), b.text()]).toEqual([200, '<p>{"rows":[["Cinque Terre"]]}</p>', '<p>{"rows":[["Cinque Terre"]]}</p>'])
    expect(seen.sort()).toEqual(['/a', '/b'])
    php.stop()
  })

  it('a sandbox that cannot start fails boot with PhpUnavailableError', async () => {
    const php = new PhpWasmSandbox(
      (port) => {
        port.postMessage({ type: 'failed', message: 'wordpress.tar.gz: 404' })
        return { dispose() {} }
      },
      async () => '{}',
    )
    const err = await php.boot().catch((e: unknown) => e)
    expect(isPhpUnavailable(err)).toBe(true)
    expect(String((err as Error).message)).toContain('404')
  })
})
