// The player's tool credentials (ADR-0076, ADR-0054): a request names its
// credential in a header; the runner signs it outside the sandbox and the
// name never leaves; a missing credential fails loudly.
import { describe, expect, it } from 'vitest'
import { browserCredentials, signRequest } from './credentials'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}
const req = (headers: Record<string, string> = { 'X-SwarmPress-Credential': 'crm' }) => ({ url: 'https://api.example.com/x?a=1', method: 'GET', headers, body: null })

describe('tool credentials', () => {
  it('signs as a header, a query parameter, a bearer or basic token, and drops the name', () => {
    const store = browserCredentials(mem())
    store.set('crm', { kind: 'header', name: 'X-Api-Key', value: 's3cret' })
    expect(signRequest(req(), store).headers).toEqual({ 'X-Api-Key': 's3cret' })
    store.set('crm', { kind: 'query', name: 'key', value: 'a b' })
    const q = signRequest(req(), store)
    expect(q.url).toBe('https://api.example.com/x?a=1&key=a%20b')
    expect(q.headers).toEqual({})
    store.set('crm', { kind: 'bearer', value: 'tok' })
    expect(signRequest(req(), store).headers).toEqual({ Authorization: 'Bearer tok' })
    store.set('crm', { kind: 'basic', user: 'ada', value: 'pw' })
    expect(signRequest(req(), store).headers).toEqual({ Authorization: `Basic ${btoa('ada:pw')}` })
    expect(store.names()).toEqual(['crm'])
  })

  it('leaves an unsigned request alone and fails loudly for a credential that is not set up', () => {
    const store = browserCredentials(mem())
    const plain = req({ Accept: 'application/json' })
    expect(signRequest(plain, store)).toBe(plain)
    expect(() => signRequest(req(), store)).toThrow('the credential "crm" is not set up')
  })

  it('keeps credentials in the storage it was given', () => {
    const storage = mem()
    browserCredentials(storage).set('a', { kind: 'bearer', value: 'x' })
    expect(browserCredentials(storage).get('a')).toEqual({ kind: 'bearer', value: 'x' })
    browserCredentials(storage).remove('a')
    expect(browserCredentials(storage).names()).toEqual([])
  })
})
