// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import brief from '../../../../crates/agents/tests/fixtures/article/brief.json'
import golden from '../../../../crates/agents/tests/fixtures/article/page.golden.json'
import styleGuide from '../../../../crates/agents/tests/fixtures/style-guide.json'
import { mvpScript } from '../llm/mvp-script'
import { PREVIEW_LABEL } from './components/ArticlePreview'
import { SEND_BACK_NOTE_MAX } from './components/Inbox'
import { artifactRecordJson, fakeCompanyStore, LIVE_ITEM, LIVE_TICKET, liveSim, liveTicket, setupLive, type LiveSim } from './live-testing'
import type { PlanTextWire } from './plan-wire'
import { flush, setup } from './testing'
import { companyStoreOptions } from './wasm-source'

/**
 * The publish gate in the Inbox (increment U1, ADR-0059): the CEO judges an
 * article inside its `publish-approval` ticket. The sim's views are the
 * captured live ones (fixtures/live); the article is what the orchestrator
 * writes to the CompanyStore (an `ArtifactRecord` and its `BriefRecord`).
 */
const REPO = 'swarmpress/cinqueterre.travel'
const TITLE = 'Harvest week in Manarola'
const HERO_TITLE = 'Crates, Ladders & Sweet Wine: Harvest Week in Manarola'
const BRIEF_REF = '6712345678901234567'
const GATE = 'ticket-90'
const HEAD = '9f2c1aa7b3e4d5f60718293a4b5c6d7e8f901234'

const planText = (): PlanTextWire => ({
  items: { [LIVE_ITEM]: { title: TITLE, brief: brief.angle } },
  posts: {
    [LIVE_ITEM]: [
      { type: 'artifact', author: 'system', text: 'PR #12 on drafts/content-5d2c8e1f0a7b3c49 (314 words)', payload: { pr: 12, branch: 'drafts/content-5d2c8e1f0a7b3c49', path: 'content/pages/blog/harvest-week-in-manarola.json', sha: HEAD, revision: 1 } },
      { type: 'review', author: 'staff-5', text: 'Now it has people in it.', payload: { verdict: 'approve', score: 8 } },
    ],
  },
})

const artifact = (over: Record<string, unknown> = {}) =>
  artifactRecordJson(BRIEF_REF, {
    page: golden,
    review: { decision: 'approve', score: 8, notes: 'Now it has people in it.', issues: ['Name one grower in the trenino paragraph.', 'The callout could say where the path starts.'], high_risk: [] },
    revision: 1,
    path: 'content/pages/blog/harvest-week-in-manarola.json',
    branch: 'drafts/content-5d2c8e1f0a7b3c49',
    pr_number: 12,
    head_sha: HEAD,
    merged_sha: null,
    ...over,
  })

const companyStore = (art: string | null = artifact()) =>
  fakeCompanyStore(planText(), {
    artifacts: art ? { [LIVE_ITEM]: art } : {},
    briefs: { [BRIEF_REF]: JSON.stringify({ job_id: 1, brief, writer: 'staff-1', editor: 'staff-5', minutes: [], work_item: LIVE_ITEM, staff: [] }) },
  })

/** The captured sim with the gate's ticket, as the sim raises it after an approving review. */
const gatedSim = () => {
  const sim = liveSim()
  sim.state.inbox.tickets.push(liveTicket({ id: GATE, kind: 'publish-approval', priority: 'high', routedViaSecretary: false, options: ['publish', 'send-back', 'kill', 'defer'], defaultOption: 'defer', workItem: LIVE_ITEM }))
  sim.state.plan.items[0].status = 'approved'
  return sim
}

let ctx: ReturnType<typeof setupLive> | ReturnType<typeof setup> | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
})

async function openInbox(sim: LiveSim, store = companyStore(), site: { style_guide?: unknown } = { style_guide: styleGuide }) {
  const c = setupLive(sim, companyStoreOptions(store, { id: 'c1', site_repo: REPO }, site))
  ctx = c
  await c.store.refresh()
  c.store.panel.value = 'inbox'
  await flush()
  // The article is read on the first render; the second shows it.
  await flush()
  return { c, store }
}

const inbox = () => within(screen.getByRole('region', { name: /Inbox/ }))
const gate = () => inbox().getByRole('article', { name: 'Publish approval' })
/** Name and value of every measured check, as the ticket shows them. */
const rows = (group: HTMLElement) =>
  [...group.querySelectorAll<HTMLElement>('.check-row')].map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent, r.dataset.status])

describe('the publish-approval ticket on live data', () => {
  it('names the article: title, dek, writer, editor, revisions', async () => {
    const { c } = await openInbox(gatedSim())
    const t = within(gate())
    // The work item title from the plan text stays the link to the plan.
    expect(t.getByRole('button', { name: TITLE })).toBeTruthy()
    const article = t.getByRole('group', { name: 'Article' })
    expect(article.querySelector('.approval-title')!.textContent).toBe(HERO_TITLE)
    expect(article.querySelector('.approval-dek')!.textContent).toBe(golden.body[0].subtitle)
    expect(article.querySelector('.approval-byline')!.textContent).toBe(`Written by ${c.store.nameOf('staff-1')} · edited by ${c.store.nameOf('staff-5')} · 1 revision`)
    expect(c.store.nameOf('staff-1')).toMatch(/^Giulia /)
    expect(c.store.nameOf('staff-5')).toMatch(/^Marco /)
  })

  it('keeps the measured checks apart from the editor’s opinion, with the right numbers', async () => {
    await openInbox(gatedSim())
    const t = within(gate())
    const measured = t.getByRole('group', { name: 'Measured checks' })
    const opinion = t.getByRole('group', { name: 'Editor’s opinion' })
    expect(measured.contains(opinion) || opinion.contains(measured)).toBe(false)

    expect(rows(measured)).toEqual([
      // 314 words of body text against the brief's 400.
      ['Words', '314 of 400 target (79%), within ±25% OK', 'pass'],
      ['Blocks', '15', 'info'],
      ['Title', 'one hero block, first OK', 'pass'],
      ['Closing note', 'present, last OK', 'pass'],
      ['Links', '2', 'info'],
      ['Media', '2', 'info'],
      ['Banned phrases', 'none OK', 'pass'],
    ])
    // The editor's judgement: score, notes, issues; none of it is in the measured group.
    expect(within(opinion).getByText('Score 8/10')).toBeTruthy()
    expect(opinion.textContent).toContain('Approve')
    expect(within(opinion).getByText('Now it has people in it.')).toBeTruthy()
    expect(within(opinion).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Name one grower in the trenino paragraph.', 'The callout could say where the path starts.'])
    expect(opinion.textContent).toMatch(/judgement, not a measurement/)
    expect(measured.textContent).not.toMatch(/Score|trenino/)
    expect(opinion.textContent).not.toMatch(/314|Banned/)
  })

  it('flags what the measurements find: words off target, banned phrases, a missing hero and closing note', async () => {
    const page = structuredClone(mvpScript().find((r) => 'json' in r && typeof r.json === 'object' && r.json !== null && 'body' in r.json)!) as { json: { body: Array<Record<string, unknown>> } }
    page.json.body[1].markdown = 'A stunning hidden gem, truly stunning.'
    const store = companyStore(artifact({ page: page.json, review: { decision: 'approve', score: 7, notes: 'Fine.', issues: [], high_risk: ['Quotes a pending court case.'] } }))
    await openInbox(gatedSim(), store)
    const t = within(gate())
    expect(rows(t.getByRole('group', { name: 'Measured checks' }))).toEqual([
      ['Words', '16 of 400 target (4%), outside ±25% Check', 'fail'],
      ['Blocks', '3', 'info'],
      ['Title', 'no hero block: the page has no visible title Check', 'fail'],
      ['Closing note', 'missing Check', 'fail'],
      ['Links', '0', 'info'],
      ['Media', '0', 'info'],
      ['Banned phrases', '“hidden gem” ×1, “stunning” ×2 Check', 'fail'],
    ])
    const opinion = t.getByRole('group', { name: 'Editor’s opinion' })
    expect(within(opinion).getByText('Score 7/10')).toBeTruthy()
    expect(within(opinion).getByText('Flagged as high risk')).toBeTruthy()
    expect(opinion.textContent).toContain('Quotes a pending court case.')
  })

  it('says so when the session has no style guide, instead of claiming no banned phrases', async () => {
    await openInbox(gatedSim(), companyStore(), {})
    const measured = within(gate()).getByRole('group', { name: 'Measured checks' })
    expect(rows(measured).map((r) => r[0])).not.toContain('Banned phrases')
    expect(measured.textContent).toContain('Banned phrases are not checked: this session has no style guide.')
  })

  it('links the pull request in the company’s repository and names the head it would merge', async () => {
    await openInbox(gatedSim())
    const t = within(gate())
    const pr = t.getByRole('link', { name: 'Pull request #12' }) as HTMLAnchorElement
    expect(pr.getAttribute('href')).toBe(`https://github.com/${REPO}/pull/12`)
    expect(pr.target).toBe('_blank')
    expect(pr.rel).toBe('noopener noreferrer')
    expect(gate().querySelector('.approval-actions code')!.textContent).toBe('9f2c1aa')
  })

  it('shows no article block, and says why, when the store has no article (a device restored without plan text)', async () => {
    const { c } = await openInbox(gatedSim(), companyStore(null))
    const t = within(gate())
    expect(t.queryByRole('group', { name: 'Article' })).toBeNull()
    expect(t.queryByRole('button', { name: 'Read article' })).toBeNull()
    expect(gate().textContent).toContain('The article text is not in this device’s store')
    // The options are all still there.
    expect(within(t.getByRole('group', { name: 'Answer Publish approval' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Publish', 'Send back', 'Kill', 'Defer (default at deadline)'])
    expect(c.store.articleOf(LIVE_ITEM)).toBeNull()
  })

  it('shows the article on an escalation about a work item too, where the store has one', async () => {
    await openInbox(liveSim())
    const escalation = within(inbox().getByRole('article', { name: 'Escalation' }))
    expect(escalation.getByRole('group', { name: 'Measured checks' })).toBeTruthy()
    expect(escalation.getByRole('button', { name: 'Read article' })).toBeTruthy()
    // An escalation without an article says nothing about missing text.
    ctx!.cleanup()
    ctx = null
    await openInbox(liveSim(), companyStore(null))
    const bare = inbox().getByRole('article', { name: 'Escalation' })
    expect(within(bare).queryByRole('group', { name: 'Measured checks' })).toBeNull()
    expect(bare.textContent).not.toContain('not in this device')
  })

  it('Publish answers at once, with the option id as the sim named it', async () => {
    const sim = gatedSim()
    const { store } = await openInbox(sim)
    fireEvent.click(within(within(gate()).getByRole('group', { name: 'Answer Publish approval' })).getByRole('button', { name: 'Publish' }))
    await flush()
    expect(sim.applied).toEqual([`{"AnswerTicket":{"ticket":"${GATE}","option":"publish"}}`])
    expect(store.rows.filter((r) => r.post.author === 'ceo')).toEqual([])
  })
})

describe('Send back with a note', () => {
  const sendBack = () => within(within(gate()).getByRole('group', { name: 'Answer Publish approval' })).getByRole('button', { name: 'Send back' })

  it('stores the note as a plan post first, then sends the answer', async () => {
    const sim = gatedSim()
    const store = companyStore()
    const order: string[] = []
    const append = store.appendPost
    store.appendPost = async (company, item, json) => {
      order.push(`post ${JSON.parse(json).payload.ui_type}`)
      // Slow store: the answer must still wait for the post.
      await new Promise((r) => setTimeout(r, 20))
      return append(company, item, json)
    }
    const apply = sim.apply_command_json
    sim.apply_command_json = (json) => {
      order.push(`command ${JSON.parse(json).AnswerTicket.option}`)
      return apply(json)
    }
    await openInbox(sim, store)

    // Send back opens the note form; nothing is sent yet.
    fireEvent.click(sendBack())
    await flush()
    expect(sendBack().getAttribute('aria-expanded')).toBe('true')
    expect(sim.applied).toEqual([])
    const form = within(within(gate()).getByRole('form', { name: 'Send back with a note' }))
    const field = form.getByRole('textbox', { name: 'What should change? (optional)' }) as HTMLTextAreaElement
    expect(field.maxLength).toBe(SEND_BACK_NOTE_MAX)
    expect(document.activeElement).toBe(field)
    fireEvent.input(field, { target: { value: '  Name the grower in the trenino paragraph.  ' } })
    await flush()
    fireEvent.click(form.getByRole('button', { name: 'Send back with this note' }))
    await new Promise((r) => setTimeout(r, 60))
    await flush()

    expect(order).toEqual(['post send-back-note', 'command send-back'])
    expect(sim.applied).toEqual([`{"AnswerTicket":{"ticket":"${GATE}","option":"send-back"}}`])
    // In the store as the post API takes it: a `status` post carrying its real type.
    const row = store.rows.at(-1)!
    expect(row).toMatchObject({ company: 'c1', item: LIVE_ITEM, post: { type: 'status', author: 'ceo', text: 'Name the grower in the trenino paragraph.', payload: { ui_type: 'send-back-note', ticket: GATE } } })
    expect(row.post.day).toBe(0)
    // The ticket is answered and the note is in the work item's thread under its own type.
    expect(gate().textContent).toContain('Answered Send back by you.')
    ctx!.store.panel.value = 'plan'
    ctx!.store.selectedItem.value = LIVE_ITEM
    await flush()
    const note = screen.getByRole('region', { name: /Media & publishing plan/ }).querySelector<HTMLElement>('li.post[data-type="send-back-note"]')!
    expect(note.textContent).toContain('Sent back')
    expect(note.textContent).toContain('Name the grower in the trenino paragraph.')
  })

  it('sends back without a post when the note is empty', async () => {
    const sim = gatedSim()
    const { store } = await openInbox(sim)
    const before = store.rows.length
    fireEvent.click(sendBack())
    await flush()
    fireEvent.click(within(gate()).getByRole('button', { name: 'Send back without a note' }))
    await flush()
    await flush()
    expect(sim.applied).toEqual([`{"AnswerTicket":{"ticket":"${GATE}","option":"send-back"}}`])
    expect(store.rows).toHaveLength(before)
  })

  it('sends nothing when the note cannot be stored, and says so', async () => {
    const sim = gatedSim()
    const store = companyStore()
    store.appendPost = async () => {
      throw new Error('store is read-only')
    }
    await openInbox(sim, store)
    fireEvent.click(sendBack())
    await flush()
    fireEvent.input(within(gate()).getByRole('textbox'), { target: { value: 'Fix the dates.' } })
    await flush()
    fireEvent.click(within(gate()).getByRole('button', { name: 'Send back with this note' }))
    await flush()
    await flush()
    expect(sim.applied).toEqual([])
    expect(within(gate()).getByRole('alert').textContent).toBe('The note could not be saved, so the article was not sent back. store is read-only')
    // Cancel closes the form; the ticket is still open with all its options.
    fireEvent.click(within(gate()).getByRole('button', { name: 'Cancel' }))
    await flush()
    expect(within(gate()).queryByRole('form')).toBeNull()
    expect(sim.state.inbox.tickets.find((t) => t.id === GATE)!.status).toBe('open')
  })

  it('posts the note once when the answer is rejected and the CEO tries again', async () => {
    const sim = gatedSim()
    const { store } = await openInbox(sim)
    const apply = sim.apply_command_json
    let reject = true
    sim.apply_command_json = (json) => {
      if (reject) {
        reject = false
        throw 'ticket is busy'
      }
      return apply(json)
    }
    fireEvent.click(sendBack())
    await flush()
    fireEvent.input(within(gate()).getByRole('textbox'), { target: { value: 'Fix the dates.' } })
    await flush()
    const submit = () => fireEvent.click(within(gate()).getByRole('button', { name: /^Send back with/ }))
    submit()
    await flush()
    await flush()
    expect(sim.state.inbox.tickets.find((t) => t.id === GATE)!.status).toBe('open')
    submit()
    await flush()
    await flush()
    expect(sim.state.inbox.tickets.find((t) => t.id === GATE)).toMatchObject({ status: 'answered', answer: 'send-back' })
    expect(store.rows.filter((r) => (r.post.payload as { ui_type?: string } | undefined)?.ui_type === 'send-back-note')).toHaveLength(1)
  })

  it('a Send back on a ticket without a work item answers at once', async () => {
    const sim = gatedSim()
    sim.state.inbox.tickets.push(liveTicket({ id: 'ticket-91', kind: 'quantum-audit', options: ['send-back', 'drop'], priority: 'low' }))
    await openInbox(sim)
    fireEvent.click(within(inbox().getByRole('article', { name: 'Quantum audit' })).getByRole('button', { name: 'Send back (default at deadline)' }))
    await flush()
    expect(sim.applied).toEqual(['{"AnswerTicket":{"ticket":"ticket-91","option":"send-back"}}'])
  })
})

describe('the article preview', () => {
  const frame = () => screen.getByRole('dialog').querySelector('iframe')!

  it('opens from the ticket in a dialog: a sandboxed srcdoc frame labelled as an approximation', async () => {
    const { c } = await openInbox(gatedSim())
    const read = within(gate()).getByRole('button', { name: 'Read article' })
    read.focus()
    fireEvent.click(read)
    await flush()
    const dialog = screen.getByRole('dialog', { name: HERO_TITLE })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByText(PREVIEW_LABEL)).toBeTruthy()
    expect(PREVIEW_LABEL).toBe('Preview (approximation of the live theme)')
    expect(within(dialog).getByRole('link', { name: 'Pull request #12' }).getAttribute('href')).toBe(`https://github.com/${REPO}/pull/12`)

    const f = frame()
    // No scripts, no same origin, nothing else allowed.
    expect(f.getAttribute('sandbox')).toBe('')
    expect(f.getAttribute('src')).toBeNull()
    expect(f.getAttribute('title')).toBe(`Article preview: ${HERO_TITLE}`)
    const doc = new DOMParser().parseFromString(f.getAttribute('srcdoc')!, 'text/html')
    expect([...doc.querySelectorAll('h1')].map((h) => h.textContent)).toEqual([HERO_TITLE])
    expect(doc.querySelectorAll('script')).toHaveLength(0)

    // Escape closes it and gives focus back to the button that opened it.
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await flush()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(c.store.article.value).toBeNull()
    expect(document.activeElement).toBe(within(gate()).getByRole('button', { name: 'Read article' }))
  })

  it('opens from the artifact post of the work item’s thread', async () => {
    const { c } = await openInbox(gatedSim())
    c.store.panel.value = 'plan'
    c.store.selectedItem.value = LIVE_ITEM
    await flush()
    const post = screen.getByRole('region', { name: /Media & publishing plan/ }).querySelector<HTMLElement>('li.post[data-type="artifact"]')!
    fireEvent.click(within(post).getByRole('button', { name: 'Read article' }))
    await flush()
    expect(screen.getByRole('dialog', { name: HERO_TITLE })).toBeTruthy()
    expect(frame().getAttribute('sandbox')).toBe('')
    // The global shortcut closes the dialog first, the work item after.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(c.store.selectedItem.value).toBe(LIVE_ITEM)
  })

  it('escapes a hostile page in the frame document and shows the new revision after a redraft', async () => {
    const hostile = { title: { en: '<script>alert(1)</script>' }, body: [{ type: 'paragraph', markdown: '<img src=x onerror=alert(1)>' }, { type: 'image', src: 'javascript:alert(1)', alt: 'x' }] }
    const store = companyStore(artifact({ page: hostile }))
    const { c } = await openInbox(gatedSim(), store)
    c.store.openArticle(LIVE_ITEM)
    await flush()
    const doc = new DOMParser().parseFromString(frame().getAttribute('srcdoc')!, 'text/html')
    expect(doc.querySelectorAll('script, img')).toHaveLength(0)
    expect(doc.querySelector('h1')!.textContent).toBe('<script>alert(1)</script>')
    expect(frame().getAttribute('srcdoc')).not.toMatch(/javascript:/i)

    // The writer revises: the next snapshot reads the new record.
    store.artifacts[LIVE_ITEM] = artifact({ revision: 2 })
    await c.store.refresh()
    await flush()
    await flush()
    expect(screen.getByRole('dialog', { name: HERO_TITLE })).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain('Revision 2')
  })
})

describe('the mock company', () => {
  it('has an approval ticket with the golden article, and the preview opens from it', async () => {
    const c = setup()
    ctx = c
    c.store.panel.value = 'inbox'
    await flush()
    await flush()
    const t = within(gate())
    expect(t.getByRole('button', { name: TITLE })).toBeTruthy()
    expect(rows(t.getByRole('group', { name: 'Measured checks' }))[0]).toEqual(['Words', '314 of 400 target (79%), within ±25% OK', 'pass'])
    expect(within(t.getByRole('group', { name: 'Editor’s opinion' })).getByText('Score 8/10')).toBeTruthy()
    fireEvent.click(t.getByRole('button', { name: 'Read article' }))
    await flush()
    expect(screen.getByRole('dialog', { name: HERO_TITLE })).toBeTruthy()
  })
})
