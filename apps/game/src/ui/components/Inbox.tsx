import { useState } from 'preact/hooks'
import { cmd, roleVariant, type SecretaryTask } from '../commands'
import { countdown, gameTime, sentence } from '../format'
import { humanRole, noSecretaryReason, REQUIRED_ROLES } from '../rules'
import { useStore } from '../store'
import type { Delegation, Priority, TicketJson } from '../types'
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
  const delta = t.deadlineMinute == null ? null : t.deadlineMinute - now
  const title = sentence(t.kind)
  return (
    <article class={`ticket ticket-${t.priority}`} aria-labelledby={`${t.id}-title`}>
      <header class="ticket-head">
        <Badge tone={t.priority}>{sentence(t.priority)}</Badge>
        <h4 id={`${t.id}-title`}>{title}</h4>
        {t.routedViaSecretary && <Badge tone="info">via Secretary</Badge>}
      </header>
      <p class="small muted">
        {t.id} · {store.projectName(t.project)}
        {t.from && <> · from {store.nameOf(t.from)}</>}
        {delta != null && t.status === 'open' && (
          <>
            {' '}
            ·{' '}
            <span class={delta < 120 ? 'bad-text' : ''} title={`Default "${t.defaultOption}" at ${gameTime(t.deadlineMinute!)}`}>
              {countdown(delta)}
            </span>
          </>
        )}
      </p>
      <p class="ticket-summary">{t.summary ?? <em class="muted">Untriaged: no summary (no secretary).</em>}</p>
      {t.status === 'open' ? (
        <div class="options" role="group" aria-label={`Answer ${title}`}>
          {t.options.map((o) => (
            <button
              key={o}
              type="button"
              class={`btn${o === t.proposedOption ? ' is-proposed' : ''}`}
              onClick={() => store.run(cmd.answer(t.id, o), `Answered ${t.id}: ${sentence(o)}`)}
            >
              {sentence(o)}
              {o === t.proposedOption && <span class="small"> (proposed)</span>}
              {o === t.defaultOption && <span class="sr-only"> (default at deadline)</span>}
            </button>
          ))}
        </div>
      ) : (
        <p class="small">
          Answered <strong>{sentence(t.answer ?? '')}</strong> by {t.resolvedBy === 'ceo' ? 'you' : (t.resolvedBy ?? 'default')}.
        </p>
      )}
    </article>
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
                  {t.id} · {sentence(t.kind)}
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
