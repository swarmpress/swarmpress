// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import miniJson from '../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.blueprint.json'
import type { Blueprint, SiteModels } from '../blueprint/types'
import { setBlueprintWasm, type BlueprintApi } from '../blueprint/wasm'
import type { CommandResult } from './commands'
import { fakeCompanyStore, LIVE_ITEM, liveSim, liveTicket, setupLive } from './live-testing'
import { MockDataSource } from './mock-source'
import { mountOverlay } from './mount'
import type { PlanTextWire } from './plan-wire'
import { flush } from './testing'
import { companyStoreOptions } from './wasm-source'

/**
 * The architects in the overlay (FEAT-095): the Blueprint panel's "Ask the
 * architect" and "Ask for a tool" boxes hand the request to the source
 * (which stores it as a brief and logs `Commission`), and the Inbox shows a
 * `structure-approval` ticket with the proposal's summary and change list
 * from the item's thread, answered Approve / Send back / Kill / Defer.
 */
const mini = miniJson as unknown as { blueprint: Blueprint; types: Record<string, unknown> }

const models = (): SiteModels => ({
  commit: 'c0ffee1234567',
  source: 'repo',
  hash: 'hash-base',
  blueprint: mini.blueprint,
  types: mini.types,
  issues: [],
  tools: [],
  tool_errors: [],
  context: { custom_blocks: [], sections: [], collections: [] },
  town: {},
})

const FAKE: BlueprintApi = {
  checkBlueprint: () => '[]',
  diffBlueprints: () => '[]',
  hashBlueprint: () => 'h',
  checkTool: () => '[]',
  toolManifest: () => '{"capabilities":[]}',
}

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

async function openPanel(commission?: (kind: 'structure' | 'tool', text: string) => Promise<CommandResult>) {
  const source = new MockDataSource()
  const s = source as unknown as Record<string, unknown>
  s.getSiteModels = () => Promise.resolve(models())
  if (commission) s.commission = commission
  const el = document.createElement('div')
  document.body.appendChild(el)
  const handle = mountOverlay(el, source)
  cleanup = () => {
    handle.dispose()
    el.remove()
  }
  await flush()
  await flush()
  handle.store.panel.value = 'blueprint'
  await flush()
  await flush()
  return handle.store
}

const panel = () => within(screen.getByRole('region', { name: /Site blueprint/ }))

describe('asking the architects from the Blueprint panel', () => {
  beforeAll(() => setBlueprintWasm(FAKE))

  it('sends the request as a structure commission and says where the proposal comes', async () => {
    const commission = vi.fn(async () => ({ ok: true }))
    const store = await openPanel(commission)
    const form = within(panel().getByRole('form', { name: 'Ask the architect' }))
    const button = form.getByRole('button', { name: 'Ask the architect' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.input(form.getByRole('textbox'), { target: { value: 'Add an author page type and link articles to it.' } })
    await flush()
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await flush()
    await flush()
    expect(commission).toHaveBeenCalledWith('structure', 'Add an author page type and link articles to it.')
    expect(store.toast.value).toMatchObject({ tone: 'ok' })
    expect(String(store.toast.value?.text)).toContain('Inbox')
    expect((form.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('asks the Web Developer for a tool on the Factory workbench', async () => {
    const commission = vi.fn(async () => ({ ok: true }))
    await openPanel(commission)
    fireEvent.click(panel().getByRole('tab', { name: 'Factory' }))
    await flush()
    const form = within(panel().getByRole('form', { name: 'Ask for a tool' }))
    fireEvent.input(form.getByRole('textbox'), { target: { value: 'Show the next ferries from each village.' } })
    await flush()
    fireEvent.click(form.getByRole('button', { name: 'Ask for a tool' }))
    await flush()
    expect(commission).toHaveBeenCalledWith('tool', 'Show the next ferries from each village.')
  })

  it("shows the sim's refusal and keeps the text", async () => {
    const commission = vi.fn(async () => ({ ok: false, reason: 'nobody on the staff can do this work: hire for it' }))
    await openPanel(commission)
    const form = within(panel().getByRole('form', { name: 'Ask the architect' }))
    fireEvent.input(form.getByRole('textbox'), { target: { value: 'Add authors' } })
    await flush()
    fireEvent.click(form.getByRole('button', { name: 'Ask the architect' }))
    await flush()
    await flush()
    expect(form.getByRole('alert').textContent).toContain('hire for it')
    expect((form.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Add authors')
  })

  it('is disabled for a source that cannot commission', async () => {
    await openPanel()
    const form = within(panel().getByRole('form', { name: 'Ask the architect' }))
    expect((form.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect(form.getByText(/cannot commission/)).toBeTruthy()
  })
})

const GATE = 'ticket-95'
const CHANGES = [
  { kind: 'added', subject: 'page-type', id: 'author' },
  { kind: 'added', subject: 'relationship', id: 'blog-article>author:written-by' },
  { kind: 'changed', subject: 'page-type', id: 'city', fields: ['route'] },
]

const planText = (withProposal: boolean): PlanTextWire => ({
  items: { [LIVE_ITEM]: { title: 'Structure: Add an author page type', brief: 'Add an author page type and link articles to it.' } },
  posts: withProposal
    ? {
        [LIVE_ITEM]: [
          {
            type: 'artifact',
            author: 'staff-3',
            text: 'Adds an author page type.\n\nChanges:\n- added page-type author',
            payload: { structure: { kind: 'structure', summary: 'Adds an author page type (author) with a profile slot, and links every blog-article page to its author.', changes: CHANGES, base_hash: 'h', hash: 'h2', revision: 0 } },
          },
        ],
      }
    : {},
})

async function openInbox(withProposal = true) {
  const sim = liveSim()
  sim.state.inbox.tickets.push(
    liveTicket({ id: GATE, kind: 'structure-approval', priority: 'high', routedViaSecretary: false, options: ['approve', 'send-back', 'kill', 'defer'], defaultOption: 'defer', workItem: LIVE_ITEM }),
  )
  const c = setupLive(sim, companyStoreOptions(fakeCompanyStore(planText(withProposal)), { id: 'c1', site_repo: 'swarmpress/site' }))
  cleanup = () => c.cleanup()
  await c.store.refresh()
  c.store.panel.value = 'inbox'
  await flush()
  await flush()
  return sim
}

const ticket = () => within(within(screen.getByRole('region', { name: /Inbox/ })).getByRole('article', { name: 'Structure approval' }))

describe('the structure-approval ticket', () => {
  it("shows the architect's summary and the change list, with the gate's options", async () => {
    await openInbox()
    const t = ticket()
    expect(t.getByText(/links every blog-article page to its author/)).toBeTruthy()
    const list = within(t.getByRole('region', { name: 'Proposed changes' }))
    const items = list.getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim())
    expect(items).toEqual(['added page-type author', 'added relationship blog-article>author:written-by', 'changed page-type city (route)'])
    expect(list.getByText(/Blueprint · 3 changes/)).toBeTruthy()
    const options = within(t.getByRole('group', { name: 'Answer Structure approval' }))
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/\s*\(default at deadline\)/, '').trim())
    expect(options).toEqual(['Approve', 'Send back', 'Kill', 'Defer'])
    expect(t.getByText(/if unanswered:/).textContent).toContain('Defer')
  })

  it('Approve answers the ticket with the sim\'s option id', async () => {
    const sim = await openInbox()
    fireEvent.click(within(ticket().getByRole('group', { name: 'Answer Structure approval' })).getByRole('button', { name: /^Approve/ }))
    await flush()
    expect(sim.applied).toEqual([`{"AnswerTicket":{"ticket":"${GATE}","option":"approve"}}`])
  })

  it('says so when the proposal is not in this device’s store', async () => {
    await openInbox(false)
    expect(ticket().getByText(/proposal is not in this device’s store/)).toBeTruthy()
  })
})
