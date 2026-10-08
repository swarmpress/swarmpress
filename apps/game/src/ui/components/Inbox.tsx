import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { BlueprintChange } from '../../blueprint/types'
import { applyChanges, loadBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { cmd, kebab, roleVariant, type SecretaryTask } from '../commands'
import { countdown, eur, gameTime, sentence } from '../format'
import { humanRole, noSecretaryReason, REQUIRED_ROLES } from '../rules'
import { useStore } from '../store'
import type { Delegation, Priority, TicketJson } from '../types'
import type { StructureRecord } from '../data-source'
import { Booklet } from '../studio/Booklet'
import { ArticleJudgement } from './ArticleJudgement'
import { Badge, Notice, Panel, PersonButton } from './common'

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** Open tickets first, then by priority (High → Low), then by nearest deadline. */
export function sortTickets(tickets: TicketJson[]): TicketJson[] {
  return tickets.slice().sort((a, b) => {
    const open = Number(a.status !== 'open') - Number(b.status !== 'open')
    if (open) return open
    const pr = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
    if (pr) return pr
    return (a.deadlineMinute ?? Infinity) - (b.deadlineMinute ?? Infinity)
  })
}

/**
 * What the Inbox knows about a ticket kind. The table only adds words: a
 * kind or an option that is not listed renders from its id and is answered
 * like any other (`AnswerTicket` sends the option id back as the sim gave it).
 */
interface KindInfo {
  label: string
  /** One neutral line on what the ticket means, shown when the Secretary wrote no summary. */
  about?: string
  /** How the ticket's amount reads (`€3,600 over budget`); the bare amount otherwise. */
  amount?: (eurText: string) => string
}

const TICKET_KINDS: Record<string, KindInfo> = {
  // crates/sim-core/src/inbox.rs `TicketKind`; amounts as crates/sim-core/src/finance.rs and world.rs raise them.
  escalation: { label: 'Escalation', about: 'Work on this item is blocked until you decide.' },
  'budget-overrun': { label: 'Budget overrun', about: 'The project spent more than its budget for the month so far.', amount: (a) => `${a} over budget` },
  'runway-low': { label: 'Runway low', about: 'Cash covers less than 30 days at the current burn.', amount: (a) => `${a} cash` },
  'payroll-spike': { label: 'Payroll spike', about: 'One hire raised payroll by more than 15%.', amount: (a) => `${a} a month` },
  'loan-offer': { label: 'Loan offer', about: 'Cash is below zero and the bank offers a loan.', amount: (a) => `${a} loan` },
  'missing-role': { label: 'Missing role', about: 'A project team lacks a role it needs.' },
  'hire-affordability': { label: 'Hire affordability', about: 'The CFO looked at whether the company can afford a hire.', amount: (a) => `${a} a month` },
  'project-proposal': { label: 'Project proposal', about: 'A new publication is proposed.' },
  // The publish gate and failure tickets (ADR-0059, ADR-0062).
  'publish-approval': { label: 'Publish approval', about: 'This article passed its review and waits for your approval. Publish merges it into the live site. Defer asks again at 08:30.' },
  'standup-failed': { label: 'Standup failed', about: 'The standup produced no briefs. Retry holds it again now. Skip lets the day pass.' },
  'deploy-failed': { label: 'Deploy failed', about: 'The article is merged, but its deploy failed. Retry publishes it again. Acknowledge waits for the next deploy.' },
  'needs-media': { label: 'Media needed', about: 'The site has no media that fits this article. Retry once media is added, or kill the article.' },
  'needs-page': { label: 'Page needed', about: 'The article needs a page the site does not have. Retry once the page exists, or kill the article.' },
  // ADR-0072, FEAT-095: a staff proposal for the site's structure or tools; only you answer it.
  'structure-approval': {
    label: 'Structure approval',
    about: 'A proposed change to the site’s structure or tools. Approve applies it to the site. Send back asks for a new proposal; Kill drops it. Defer asks again at 08:30 and never applies it.',
  },
}

const OPTION_LABELS: Record<string, string> = {
  publish: 'Publish',
  approve: 'Approve',
  'send-back': 'Send back',
  kill: 'Kill',
  defer: 'Defer',
  retry: 'Retry',
  skip: 'Skip',
  acknowledge: 'Acknowledge',
}

/** `PublishApproval`, `publish_approval` and `publish-approval` are the same id. */
const slug = (id: string) => kebab(id).replace(/[_\s]+/g, '-')

const kindInfo = (kind: string): KindInfo | undefined => TICKET_KINDS[slug(kind)]
export const ticketTitle = (kind: string) => kindInfo(kind)?.label ?? sentence(slug(kind))
export const optionLabel = (option: string) => OPTION_LABELS[slug(option)] ?? sentence(slug(option))

/** Ticket kinds about an article the CEO judges before answering: the ticket shows it (title, checks, review, preview). */
const ARTICLE_KINDS = new Set(['publish-approval', 'escalation'])
/** The option that restarts the draft. With a work item, the CEO can say what to change first. */
const isSendBack = (option: string) => slug(option) === 'send-back'
/** A send-back note is short: one issue for the revision, not a second brief. */
export const SEND_BACK_NOTE_MAX = 600

const DELEGATION: Array<{ id: Delegation; label: string; hint: string }> = [
  { id: 'off', label: 'Off', hint: 'You answer everything' },
  { id: 'low', label: 'Low', hint: 'Secretary answers Low tickets' },
  { id: 'low-and-medium', label: 'Low + Medium', hint: 'Secretary also answers Medium' },
]

export function Inbox() {
  const store = useStore()
  const inbox = store.inbox.value
  const secretary = store.org.value.executive.secretary
  const sorted = sortTickets(inbox.tickets)
  const open = sorted.filter((t) => t.status === 'open')
  const resolved = sorted.filter((t) => t.status !== 'open')

  return (
    <Panel id="inbox" title="Inbox">
      <div class="cfo-line">
        {secretary ? <PersonButton staff={secretary} detail="Executive Secretary · triages your inbox" /> : <span class="muted">No secretary</span>}
      </div>
      {!secretary && (
        <Notice tone="warn" title="No secretary: tickets arrive untriaged">
          {noSecretaryReason}
        </Notice>
      )}

      <DelegationPolicy value={secretary ? inbox.delegation : 'off'} disabled={!secretary} />

      <section aria-labelledby="tickets-title">
        <h3 id="tickets-title">
          Open tickets <span class="muted">({open.length})</span>
        </h3>
        {open.length === 0 ? (
          <p class="muted">Inbox zero.</p>
        ) : (
          <ul class="ticket-list">
            {open.map((t) => (
              <li key={t.id}>
                <Ticket t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.length > 0 && (
        <details class="resolved">
          <summary>Resolved ({resolved.length})</summary>
          <ul class="ticket-list">
            {resolved.map((t) => (
              <li key={t.id}>
                <Ticket t={t} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="queue-title">
        <h3 id="queue-title">Secretary queue</h3>
        {inbox.secretaryQueue.length === 0 ? (
          <p class="muted small">{secretary ? 'Nothing delegated.' : 'Unavailable without a secretary.'}</p>
        ) : (
          <ul class="queue">
            {inbox.secretaryQueue.map((q) => (
              <li key={q.id}>
                <Badge tone={q.status === 'done' ? 'good' : q.status === 'working' ? 'info' : 'neutral'}>{sentence(q.status)}</Badge> {q.detail ?? sentence(q.kind)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <DelegateMenu disabledReason={secretary ? null : noSecretaryReason} />
    </Panel>
  )
}

function DelegationPolicy({ value, disabled }: { value: Delegation; disabled: boolean }) {
  const store = useStore()
  return (
    <fieldset class="segmented" disabled={disabled} aria-describedby={disabled ? 'delegation-why' : undefined}>
      <legend>Delegation policy</legend>
      {DELEGATION.map((d) => (
        <label key={d.id} class={value === d.id ? 'is-on' : ''} title={d.hint}>
          <input
            type="radio"
            name="delegation"
            value={d.id}
            checked={value === d.id}
            onChange={() => store.run(cmd.setDelegation(d.id), `Delegation: ${d.label}`)}
          />
          {d.label}
        </label>
      ))}
      <p class="small muted" id="delegation-why">
        {disabled ? 'Needs a secretary.' : 'High-priority and large financial tickets always reach you.'}
      </p>
    </fieldset>
  )
}

function Ticket({ t }: { t: TicketJson }) {
  const store = useStore()
  const now = store.now.value
  const open = t.status === 'open'
  const delta = t.deadlineMinute == null ? null : t.deadlineMinute - now
  const info = kindInfo(t.kind)
  const title = ticketTitle(t.kind)
  const kind = slug(t.kind)
  /** The Send back option whose note form is open. */
  const [sendBack, setSendBack] = useState<string | null>(null)
  // What the ticket is about: the work item by its title in the plan text, the money and the role.
  const itemTitle = t.workItem ? store.planText.value.items[t.workItem]?.title || t.workItem : null
  const amount = t.amountEur ? (info?.amount ?? ((a: string) => a))(eur(t.amountEur)) : null
  const subject = itemTitle != null || amount != null || !!t.role
  return (
    <article class={`ticket ticket-${t.priority}`} aria-labelledby={`${t.id}-title`} data-kind={t.kind}>
      <header class="ticket-head">
        <Badge tone={t.priority}>{sentence(t.priority)}</Badge>
        <h4 id={`${t.id}-title`}>{title}</h4>
        {t.routedViaSecretary && <Badge tone="info">via Secretary</Badge>}
      </header>
      {subject && (
        <p class="ticket-subject">
          {itemTitle != null && (
            <button
              type="button"
              class="link-btn"
              title="Open the work item in the plan"
              onClick={() => {
                store.selectedItem.value = t.workItem!
                store.panel.value = 'plan'
              }}
            >
              {itemTitle}
            </button>
          )}
          {t.role && (
            <>
              {itemTitle != null && ' · '}
              Role: {humanRole(t.role)}
            </>
          )}
          {amount != null && (
            <>
              {(itemTitle != null || t.role) && ' · '}
              <strong>{amount}</strong>
            </>
          )}
        </p>
      )}
      <p class="small muted">
        {t.id} · {store.projectName(t.project)}
        {t.from && <> · from {store.nameOf(t.from)}</>}
        {t.failure && <> · failed: {sentence(slug(t.failure)).toLowerCase()}</>}
      </p>
      {t.summary ? <p class="ticket-summary">{t.summary}</p> : info?.about && <p class="ticket-summary small">{info.about}</p>}
      {open && t.workItem && ARTICLE_KINDS.has(kind) && <ArticleJudgement item={t.workItem} id={t.id} missing={kind === 'publish-approval'} />}
      {t.workItem && kind === 'structure-approval' && (
        <StructureProposal
          item={t.workItem}
          ticket={
            open
              ? {
                  id: t.id,
                  options: t.options,
                  onSendBack: () => setSendBack(t.options.find(isSendBack) ?? null),
                }
              : null
          }
        />
      )}
      {open ? (
        <>
          {delta != null && (
            <p class="small ticket-deadline">
              Due {gameTime(t.deadlineMinute!)} · <span class={delta < 120 ? 'bad-text' : ''}>{countdown(delta)}</span>
              {t.defaultOption && (
                <>
                  {' '}
                  · if unanswered: <strong>{optionLabel(t.defaultOption)}</strong>
                </>
              )}
            </p>
          )}
          <div class="options" role="group" aria-label={`Answer ${title}`}>
            {t.options.map((o) => {
              // Send back on a work item asks for a note first; every other option answers at once.
              const noted = isSendBack(o) && !!t.workItem
              return (
                <button
                  key={o}
                  type="button"
                  class={`btn${o === t.proposedOption ? ' is-proposed' : ''}`}
                  aria-expanded={noted ? sendBack === o : undefined}
                  onClick={() => (noted ? setSendBack(sendBack === o ? null : o) : void store.run(cmd.answer(t.id, o), `Answered ${t.id}: ${optionLabel(o)}`))}
                >
                  {optionLabel(o)}
                  {o === t.proposedOption && <span class="small"> (proposed)</span>}
                  {o === t.defaultOption && <span class="sr-only"> (default at deadline)</span>}
                </button>
              )
            })}
          </div>
          {sendBack && t.workItem && <SendBackNote ticket={t.id} item={t.workItem} option={sendBack} onCancel={() => setSendBack(null)} />}
        </>
      ) : (
        <p class="small">
          {t.status === 'expired' || t.resolvedBy === 'default' ? (
            <>
              Not answered by the deadline: <strong>{optionLabel(t.answer ?? t.defaultOption ?? '')}</strong> applied.
            </>
          ) : (
            <>
              Answered <strong>{optionLabel(t.answer ?? '')}</strong> by {t.resolvedBy === 'ceo' ? 'you' : t.resolvedBy === 'secretary' ? 'the Secretary' : (t.resolvedBy ?? 'default')}.
            </>
          )}
        </p>
      )}
    </article>
  )
}

/** A change of a proposal, as `blueprint::Change` (or `{kind, subject: 'tool', id}`). */
interface ProposedChange {
  kind: string
  subject: string
  id: string
  fields?: string[]
}

/**
 * What the CEO approves at a `StructureApproval` (FEAT-095): the architect's
 * summary and the semantic change list of its proposal, as the Draft job
 * posted them to the item's thread from its artifact. Text from the store,
 * never from the sim.
 */
export function StructureProposal({ item, ticket = null }: { item: string; ticket?: { id: string; options: string[]; onSendBack: () => void } | null }) {
  const store = useStore()
  const [record, setRecord] = useState<StructureRecord | null>(null)
  const [api, setApi] = useState<BlueprintApi | null>(null)
  const [reading, setReading] = useState(false)
  // The whole proposal for the booklet (FEAT-101): the artifact in this device's store, and the checker to apply its steps.
  useEffect(() => {
    let live = true
    void store.source
      .getArticle(item)
      .then((a) => live && setRecord(a?.structure ?? null))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [store.source, item])
  const openBooklet = () => {
    setReading(true)
    loadBlueprintWasm().then(setApi, () => setApi(null))
  }
  const posts = store.planText.value.posts[item] ?? []
  const post = [...posts].reverse().find((p) => {
    const st = p.payload?.structure as { changes?: unknown } | undefined
    return p.type === 'artifact' && Array.isArray(st?.changes)
  })
  const st = post?.payload?.structure as { kind?: string; summary?: string; changes: ProposedChange[]; revision?: number } | undefined
  if (!post || !st) {
    return (
      <p class="small warn-text">
        The proposal is not in this device’s store (plan text is not synced between devices yet), so its changes cannot be shown here.
      </p>
    )
  }
  const tone = (k: string): 'good' | 'neutral' | 'warn' => (k === 'added' ? 'good' : k === 'removed' ? 'neutral' : 'warn')
  return (
    <section class="structure-proposal" aria-label="Proposed changes">
      {st.summary && <p class="ticket-summary">{st.summary}</p>}
      <p class="small muted">
        {st.kind === 'tool' ? 'Tool' : 'Blueprint'} · {st.changes.length} {st.changes.length === 1 ? 'change' : 'changes'}
        {st.revision ? ` · revision ${st.revision}` : ''} · proposed by {store.nameOf(post.author)}
      </p>
      <ul class="bp-changes">
        {st.changes.map((c) => (
          <li key={`${c.kind}:${c.subject}:${c.id}`} class={`bp-change is-${c.kind}`}>
            <Badge tone={tone(c.kind)}>{c.kind}</Badge> {c.subject} <strong>{c.id}</strong>
            {c.fields && c.fields.length > 0 && <span class="muted"> ({c.fields.join(', ')})</span>}
          </li>
        ))}
      </ul>
      {record && st.kind !== 'tool' && (
        <button type="button" class="btn" onClick={openBooklet}>
          Open the booklet
        </button>
      )}
      {reading && record && (
        <ProposalBooklet
          record={record}
          api={api}
          summary={st.summary}
          ticket={ticket}
          onClose={() => setReading(false)}
          onSendBack={() => {
            setReading(false)
            ticket?.onSendBack()
          }}
        />
      )}
    </section>
  )
}

/**
 * A staff proposal as an instruction booklet (FEAT-101): from the site's
 * current blueprint to the proposed one, step by step; its buttons answer the
 * StructureApproval ticket like the Inbox's own ("Build it" approves). The
 * proposal was made on a blueprint hash: if the site changed since, the
 * booklet says so (Approve then fails on the stale hash, ADR-0072).
 */
function ProposalBooklet({
  record,
  api,
  summary,
  ticket,
  onClose,
  onSendBack,
}: {
  record: StructureRecord
  api: BlueprintApi | null
  summary?: string
  ticket: { id: string; options: string[] } | null
  onClose: () => void
  onSendBack: () => void
}) {
  const store = useStore()
  const models = store.siteModels.value
  const base = models?.blueprint
  const apply = useCallback((cs: BlueprintChange[]) => (api && base ? applyChanges(api, base, record.proposal, cs) : null), [api, base, record.proposal])
  if (!base) return null
  const stale = !!models && !!record.baseHash && record.baseHash !== models.hash
  const answer = (option: string) => {
    onClose()
    void store.run(cmd.answer(ticket!.id, option), `Answered ${ticket!.id}: ${optionLabel(option)}`)
  }
  const find = (id: string) => ticket?.options.find((o) => slug(o) === id)
  const approve = find('approve')
  const actions = ticket
    ? [
        ...(find('defer') ? [{ label: 'Defer', onClick: () => answer(find('defer')!) }] : []),
        ...(find('kill') ? [{ label: 'Kill', onClick: () => answer(find('kill')!) }] : []),
        ...(find('send-back') ? [{ label: 'Send back…', onClick: onSendBack }] : []),
        ...(approve ? [{ label: 'Build it', primary: true, onClick: () => answer(approve) }] : []),
      ]
    : [{ label: 'Close', onClick: onClose }]
  return (
    <Booklet
      title="The architect's building instructions"
      summary={`${summary ?? ''}${stale ? (summary ? ' ' : '') + 'The site changed since this proposal was made: approving it will fail; send it back for a new one.' : ''}`}
      base={base}
      proposal={record.proposal}
      changes={record.changes}
      apply={apply}
      actions={actions}
      onClose={onClose}
    />
  )
}

/**
 * Send back with a note (ADR-0059; docs/design/mvp-pipeline.md §5). The note
 * is text, so it goes to the work item's thread in the store (a
 * `send-back-note` post), never into the sim. It is stored before the answer
 * is sent: the answer restarts the draft, and the revision reads the note as
 * an issue. If the note cannot be stored, nothing is sent.
 */
function SendBackNote({ ticket, item, option, onCancel }: { ticket: string; item: string; option: string; onCancel: () => void }) {
  const store = useStore()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The note is in the thread already (a retry after a rejected answer must not post it twice). */
  const posted = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus(), [])
  const text = note.trim()
  const submit = async () => {
    setBusy(true)
    setError(null)
    if (text && !posted.current) {
      try {
        await store.post(item, 'send-back-note', text, { ticket })
        posted.current = true
      } catch (e) {
        setError(`The note could not be saved, so the article was not sent back. ${e instanceof Error ? e.message : String(e)}`)
        setBusy(false)
        return
      }
    }
    const r = await store.run(cmd.answer(ticket, option), `Answered ${ticket}: ${optionLabel(option)}`)
    // Answered: the ticket closes and takes this form with it.
    if (!r.ok) setBusy(false)
  }
  return (
    <form
      class="send-back"
      aria-label="Send back with a note"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) void submit()
      }}
    >
      <label class="field">
        <span>What should change? (optional)</span>
        <textarea
          ref={field}
          rows={3}
          maxLength={SEND_BACK_NOTE_MAX}
          value={note}
          disabled={busy || posted.current}
          onInput={(e) => setNote(e.currentTarget.value)}
          placeholder="Name the grower in the trenino paragraph."
        />
      </label>
      <p class="small muted">The note is posted to the article’s thread; the writer revises against it.</p>
      <div class="actions-row">
        <button type="submit" class="btn" disabled={busy}>
          {text ? 'Send back with this note' : 'Send back without a note'}
        </button>
        <button type="button" class="btn btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p class="small error-text" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

type TaskKind = 'prepare-briefing' | 'schedule-meeting' | 'draft-reply' | 'arrange-hiring' | 'follow-up'
const TASKS: Array<{ id: TaskKind; label: string }> = [
  { id: 'prepare-briefing', label: 'Prepare briefing' },
  { id: 'schedule-meeting', label: 'Schedule meeting' },
  { id: 'draft-reply', label: 'Draft reply' },
  { id: 'arrange-hiring', label: 'Arrange hiring' },
  { id: 'follow-up', label: 'Follow up' },
]

export function DelegateMenu({ disabledReason }: { disabledReason: string | null }) {
  const store = useStore()
  const org = store.org.value
  const openTickets = store.inbox.value.tickets.filter((t) => t.status === 'open')
  const [kind, setKind] = useState<TaskKind>('prepare-briefing')
  const [project, setProject] = useState<string>('')
  const [attendees, setAttendees] = useState<string[]>([])
  const [agenda, setAgenda] = useState('')
  const [ticket, setTicket] = useState(openTickets[0]?.id ?? '')
  const [role, setRole] = useState('translator')
  const [staff, setStaff] = useState(org.staff[0]?.id ?? '')
  const [topic, setTopic] = useState('')
  const proj = project || null

  const task = (): SecretaryTask => {
    switch (kind) {
      case 'prepare-briefing':
        return { PrepareBriefing: { project: proj } }
      case 'schedule-meeting':
        return { ScheduleMeeting: { attendees, agenda, project: proj } }
      case 'draft-reply':
        return { DraftReply: { ticket } }
      case 'arrange-hiring':
        return { ArrangeHiring: { role: roleVariant(role), project: proj } }
      case 'follow-up':
        return { FollowUp: { staff, topic } }
    }
  }
  const v = disabledReason ? { ok: false, reason: disabledReason } : store.check(cmd.delegate(task()))
  const label = TASKS.find((t) => t.id === kind)!.label

  return (
    <form
      class="card delegate"
      aria-labelledby="delegate-title"
      onSubmit={(e) => {
        e.preventDefault()
        if (!v.ok) return
        void store.run(cmd.delegate(task()), `Delegated: ${label}`).then((r) => {
          if (!r.ok) return
          setAgenda('')
          setTopic('')
          setAttendees([])
        })
      }}
    >
      <h3 id="delegate-title">Delegate to the secretary</h3>
      {disabledReason && (
        <p class="small warn-text" id="delegate-why">
          {disabledReason}
        </p>
      )}
      <fieldset disabled={!!disabledReason} aria-describedby={disabledReason ? 'delegate-why' : undefined}>
        <legend class="sr-only">Task</legend>
        <label class="field">
          <span>Task</span>
          <select value={kind} onChange={(e) => setKind(e.currentTarget.value as TaskKind)}>
            {TASKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {(kind === 'prepare-briefing' || kind === 'schedule-meeting' || kind === 'arrange-hiring') && (
          <label class="field">
            <span>Project</span>
            <select value={project} onChange={(e) => setProject(e.currentTarget.value)}>
              <option value="">Company-wide</option>
              {org.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'schedule-meeting' && (
          <>
            <fieldset class="attendees">
              <legend>Attendees</legend>
              {org.staff.map((s) => (
                <label key={s.id} class="check">
                  <input
                    type="checkbox"
                    checked={attendees.includes(s.id)}
                    onChange={(e) =>
                      setAttendees(e.currentTarget.checked ? [...attendees, s.id] : attendees.filter((a) => a !== s.id))
                    }
                  />
                  {store.nameOf(s.id)}
                </label>
              ))}
            </fieldset>
            <label class="field">
              <span>Agenda</span>
              <input value={agenda} onInput={(e) => setAgenda(e.currentTarget.value)} placeholder="Budget review" />
            </label>
          </>
        )}
        {kind === 'draft-reply' && (
          <label class="field">
            <span>Ticket</span>
            <select value={ticket} onChange={(e) => setTicket(e.currentTarget.value)}>
              {openTickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {ticketTitle(t.kind)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'arrange-hiring' && (
          <label class="field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.currentTarget.value)}>
              {[...REQUIRED_ROLES.map((r) => r.role), 'cfo', 'secretary', 'strategist', 'data-scientist', 'editor-in-chief'].map((r) => (
                <option key={r} value={r}>
                  {sentence(humanRole(r))}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'follow-up' && (
          <>
            <label class="field">
              <span>Person</span>
              <select value={staff} onChange={(e) => setStaff(e.currentTarget.value)}>
                {org.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {store.nameOf(s.id)}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>Topic</span>
              <input value={topic} onInput={(e) => setTopic(e.currentTarget.value)} placeholder="Harvest photos" />
            </label>
          </>
        )}
      </fieldset>
      <button type="submit" class="btn" disabled={!v.ok}>
        Delegate: {label}
      </button>
      {!disabledReason && !v.ok && (
        <p class="small muted" role="status">
          {v.reason}
        </p>
      )}
    </form>
  )
}
