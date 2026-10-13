// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeCompanyStore, LIVE_ITEM, liveSim, liveTicket, setupLive } from './live-testing'
import { flush } from './testing'
import { companyStoreOptions } from './wasm-source'

/**
 * The web designer's theme at the CEO's gate (FEAT-115, ADR-0093): the Inbox shows a
 * `theme-approval` ticket with its design version and branch, answered Approve or Reject
 * (the default: the current theme stays).
 */
const GATE = 'ticket-91'

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

async function openInbox() {
  const sim = liveSim()
  sim.state.inbox.tickets.push(
    liveTicket({ id: GATE, kind: 'theme-approval', priority: 'high', routedViaSecretary: false, options: ['approve', 'reject'], defaultOption: 'reject', workItem: LIVE_ITEM, designVersion: 3 }),
  )
  const c = setupLive(sim, companyStoreOptions(fakeCompanyStore({}), { id: 'c1', site_repo: 'swarmpress/site' }))
  cleanup = () => c.cleanup()
  await c.store.refresh()
  c.store.panel.value = 'inbox'
  await flush()
  await flush()
  return sim
}

const ticket = () => within(within(screen.getByRole('region', { name: /Inbox/ })).getByRole('article', { name: 'Theme approval' }))

describe('the theme-approval ticket', () => {
  it('names the design version and its branch, with Approve and Reject (the default)', async () => {
    await openInbox()
    const t = ticket()
    expect(t.getByText(/Design v3/).textContent).toContain('design-v3')
    expect(t.getByText(/Reject, also the default, keeps the current theme/)).toBeTruthy()
    const options = within(t.getByRole('group', { name: 'Answer Theme approval' }))
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/\s*\(default at deadline\)/, '').trim())
    expect(options).toEqual(['Approve', 'Reject'])
    expect(t.getByText(/if unanswered:/).textContent).toContain('Reject')
  })

  it("Approve answers the ticket with the sim's option id", async () => {
    const sim = await openInbox()
    fireEvent.click(within(ticket().getByRole('group', { name: 'Answer Theme approval' })).getByRole('button', { name: /^Approve/ }))
    await flush()
    expect(sim.applied).toEqual([`{"AnswerTicket":{"ticket":"${GATE}","option":"approve"}}`])
  })
})
