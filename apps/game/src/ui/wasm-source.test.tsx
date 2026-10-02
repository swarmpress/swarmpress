// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cmd, toJson } from './commands'
import financeFixture from './fixtures/finance.json'
import inboxFixture from './fixtures/inbox.json'
import orgFixture from './fixtures/org.json'
import planWire from './fixtures/plan-wire.json'
import { MockDataSource } from './mock-source'
import { mountOverlay, selectDataSource } from './mount'
import { PENDING } from './store'
import { flush } from './testing'
import type { InboxJson } from './types'
import { hasOrgApi, toResult, WasmDataSource, type SimOrgApi } from './wasm-source'

/**
 * A stand-in for the wasm `Sim` with the organization API the live source
 * will call (organization.md §9): JSON strings out, JSON commands in.
 * `plan_json` returns the orchestrator's text document.
 */
function fakeSim(opts: { validator?: boolean } = {}) {
  const inbox = structuredClone(inboxFixture) as unknown as InboxJson
  let minute = (inboxFixture as { nowMinute: number }).nowMinute
  const applied: string[] = []
  const sim: SimOrgApi & { tick(): void; applied: string[] } = {
    applied,
    org_json: () => JSON.stringify(orgFixture),
    finance_json: () => JSON.stringify(financeFixture),
    inbox_json: () => JSON.stringify(inbox),
    plan_json: () => JSON.stringify(planWire),
    apply_command_json(json: string) {
      const c = JSON.parse(json) as { AnswerTicket?: { ticket: string; option: string } }
      if (!c.AnswerTicket) throw 'Not supported by the fake sim'
      const t = inbox.tickets.find((x) => x.id === c.AnswerTicket!.ticket)
      if (!t || t.status !== 'open') return JSON.stringify({ ok: false, reason: 'Ticket is not open' })
      t.status = 'answered' as typeof t.status
      applied.push(json)
      return undefined
    },
    day: () => Math.floor(minute / 1440),
    minute_of_day: () => minute % 1440,
    tick: () => void (minute += 1),
  }
  if (opts.validator !== false) sim.validate_command_json = (json: string) => (JSON.parse(json).AnswerTicket ? undefined : 'Not supported by the fake sim')
  return sim
}

let dispose: (() => void) | null = null
afterEach(() => {
  dispose?.()
  dispose = null
  vi.useRealTimers()
})

describe('WasmDataSource', () => {
  it('feature-detects the organization API', () => {
    expect(hasOrgApi(fakeSim())).toBe(true)
    expect(hasOrgApi({ org_json() {} })).toBe(false)
    expect(hasOrgApi(null)).toBe(false)
    const params = new URLSearchParams()
    expect(selectDataSource(fakeSim(), params)).toBeInstanceOf(WasmDataSource)
    expect(selectDataSource({}, params)).toBeInstanceOf(MockDataSource)
    expect(selectDataSource(fakeSim(), new URLSearchParams('ui=mock'))).toBeInstanceOf(MockDataSource)
  })

  it('interprets every apply/validate result convention', () => {
    expect(toResult(undefined)).toEqual({ ok: true })
    expect(toResult('')).toEqual({ ok: true })
    expect(toResult('{"ok":true}')).toEqual({ ok: true })
    expect(toResult('{"ok":false,"reason":"No secretary"}')).toEqual({ ok: false, reason: 'No secretary' })
    expect(toResult('Unknown staff staff-99')).toEqual({ ok: false, reason: 'Unknown staff staff-99' })
    expect(toResult({ ok: false, error: 'x' })).toEqual({ ok: false, reason: 'x' })
    expect(toResult(false)).toEqual({ ok: false, reason: 'Rejected' })
  })

  it('reads the JSON views, the clock and the orchestrator plan text', async () => {
    const s = new WasmDataSource(fakeSim())
    expect((await s.getOrg()).executive.cfo).toBe('staff-7')
    expect((await s.getFinance()).cashEur).toBe(financeFixture.cashEur)
    expect(await s.now()).toBe(inboxFixture.nowMinute)
    expect((await s.getPlan()).items).toEqual([])
    const text = await s.getPlanText()
    expect(text.posts['work-item-21'].map((p) => p.type)).toEqual(['minutes', 'artifact', 'handoff', 'review', 'artifact', 'status'])
    expect((await s.getPersona('giulia'))?.name).toBe('Giulia Rossi')
  })

  it('applies commands through apply_command_json and reports rejections', async () => {
    const sim = fakeSim()
    const s = new WasmDataSource(sim)
    const answer = toJson(cmd.answer('ticket-1', (inboxFixture.tickets[0] as { options: string[] }).options[0]))
    expect(await s.validate(answer)).toEqual({ ok: true })
    expect(await s.apply(answer)).toEqual({ ok: true })
    expect(sim.applied).toEqual([answer])
    expect((await s.getInbox()).tickets.find((t) => t.id === 'ticket-1')!.status).toBe('answered')
    expect(await s.apply(answer)).toEqual({ ok: false, reason: 'Ticket is not open' })
    expect(await s.apply(toJson(cmd.praise('staff-1')))).toEqual({ ok: false, reason: 'Not supported by the fake sim' })
    expect(await s.validate(toJson(cmd.praise('staff-1')))).toEqual({ ok: false, reason: 'Not supported by the fake sim' })
    // Without a validator the sim judges on apply.
    expect(await new WasmDataSource(fakeSim({ validator: false })).validate(toJson(cmd.praise('staff-1')))).toEqual({ ok: true })
  })

  it('keeps CEO comments next to the sim text and notifies subscribers', async () => {
    vi.useFakeTimers()
    const sim = fakeSim()
    const s = new WasmDataSource(sim, { pollMs: 100 })
    const seen: Array<string[] | undefined> = []
    const off = s.subscribe((t) => seen.push(t))
    const post = await s.appendPost('work-item-21', { type: 'comment', author: 'ceo', text: 'Great piece' })
    expect(post).toMatchObject({ type: 'comment', day: Math.floor(inboxFixture.nowMinute / 1440) })
    expect((await s.getPlanText()).posts['work-item-21'].at(-1)!.text).toBe('Great piece')
    sim.tick()
    vi.advanceTimersByTime(100)
    expect(seen).toContainEqual(['plan'])
    expect(seen.at(-1)).toEqual(['clock'])
    off()
  })
})

describe('overlay over the live source', () => {
  it('renders orchestrator threads (minutes, artifact, handoff, review, status) as work items', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountOverlay(el, new WasmDataSource(fakeSim()))
    dispose = () => {
      h.dispose()
      el.remove()
    }
    await h.store.refresh()
    h.store.panel.value = 'plan'
    await flush()
    const plan = screen.getByRole('region', { name: 'Media & publishing plan' })
    fireEvent.click(within(plan).getByRole('button', { name: "Via dell'Amore reopening: what changed" }))
    await flush()
    const thread = screen.getByRole('heading', { name: /^Thread/ }).closest('section')!
    const types = [...thread.querySelectorAll<HTMLElement>('li.post')].map((li) => li.dataset.type)
    expect(types).toEqual(['minutes', 'artifact', 'handoff', 'review', 'artifact', 'status'])
    const t = within(thread)
    expect(t.getByText(/Approved · score 8\/10/)).toBeTruthy()
    expect(t.getByText(/Deployed \(simulated\)/)).toBeTruthy()
    expect(t.getByText('content/pages/en/via-dell-amore.json')).toBeTruthy()
    // staff-5 is persona `marco` in the live catalog.
    expect(thread.querySelector('.handoff-to')?.textContent).toContain(`→ ${h.store.persona('marco')!.name}`)
  })

  it('answers a ticket through the sim and updates the HUD inbox count', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountOverlay(el, new WasmDataSource(fakeSim()))
    dispose = () => {
      h.dispose()
      el.remove()
    }
    await h.store.refresh()
    const before = h.store.inbox.value.tickets.filter((t) => t.status === 'open').length
    const r = await h.store.run(cmd.answer('ticket-1', (inboxFixture.tickets[0] as { options: string[] }).options[0]))
    expect(r.ok).toBe(true)
    expect(h.store.inbox.value.tickets.filter((t) => t.status === 'open')).toHaveLength(before - 1)
  })
})

describe('async validation in the store', () => {
  it('returns PENDING until the source answers, then the verdict, and resets per snapshot', async () => {
    const source = new MockDataSource()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const validate = source.validate.bind(source)
    source.validate = async (json) => {
      await gate
      return validate(json)
    }
    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountOverlay(el, source)
    dispose = () => {
      h.dispose()
      el.remove()
    }
    await h.store.refresh()
    const c = cmd.assign('staff-1', 'project-2', 30)
    expect(h.store.check(c)).toBe(PENDING)
    expect(h.store.check(c)).toBe(PENDING)
    release()
    await flush()
    expect(h.store.check(c)).toEqual({ ok: false, reason: 'Giulia would be at 110% (max 100%)' })
    await h.store.run(cmd.assign('staff-1', 'project-1', 70))
    // New snapshot: the cached verdict is gone and re-asked.
    expect(h.store.check(c)).toBe(PENDING)
    await flush()
    expect(h.store.check(c)).toEqual({ ok: true })
  })
})
