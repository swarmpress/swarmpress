import { useState } from 'preact/hooks'
import { cmd } from '../commands'
import { pad2, sentence } from '../format'
import { PRIORITY_ORDER, type PlanPost, type WorkItemJson } from '../plan-types'
import { useStore } from '../store'
import { Avatar, Badge, Meter, PersonButton, priorityTone } from './common'

/** Work item: brief, phases, todos, artifacts, tickets and the live thread (publishing-plan.md §1–2, §5). */
export function WorkItemDetail({ item }: { item: WorkItemJson }) {
  const store = useStore()
  const text = store.planText.value
  const t = text.items[item.id]
  const posts = text.posts[item.id] ?? []
  const artifacts = posts.filter((p) => p.type === 'artifact' && p.artifact)
  const ws = item.workstream ? text.workstreams[item.workstream]?.title : null
  const [priority, setPriority] = useState(item.priority)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const approve = store.check(cmd.setItemStatus(item.id, 'approved'))
  const cancel = store.check(cmd.setItemStatus(item.id, 'cancelled'))

  return (
    <div class="detail work-item">
      <button type="button" class="btn btn-quiet back" onClick={() => (store.selectedItem.value = null)}>
        ← Back to the plan
      </button>
      <div class="card-row">
        <h3 class="detail-title">{t?.title ?? item.id}</h3>
        <Badge tone={item.status === 'blocked' ? 'bad' : item.status === 'published' ? 'good' : 'info'}>{sentence(item.status)}</Badge>
        <Badge tone={priorityTone(item.priority)}>{sentence(item.priority)}</Badge>
        {item.textOnly && <Badge tone="neutral">Status from the thread</Badge>}
      </div>
      <p class="small muted">
        {sentence(item.kind)} · {store.projectName(item.project)}
        {ws && <> · {ws}</>}
        {item.dueDay != null && <> · due day {item.dueDay + 1}</>}
        {item.publishDay != null && <> · publishes day {item.publishDay + 1}</>}
      </p>
      <p class="small">Owner: {item.owner ? <PersonButton staff={item.owner} /> : <span class="muted">none</span>}</p>
      {t?.brief && (
        <section aria-labelledby="brief-title" class="brief">
          <h4 id="brief-title">Brief</h4>
          <p>{t.brief}</p>
        </section>
      )}

      <div class="actions-row ceo-actions" role="group" aria-label="CEO actions">
        <label class="field-inline">
          <span>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.currentTarget.value as WorkItemJson['priority'])}>
            {PRIORITY_ORDER.map((p) => (
              <option key={p} value={p}>
                {sentence(p)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="btn" disabled={priority === item.priority} onClick={() => store.run(cmd.setPriority(item.id, priority), `Priority: ${priority}`)}>
          Re-prioritize
        </button>
        <button type="button" class="btn" disabled={!approve.ok} title={approve.reason} onClick={() => store.run(cmd.setItemStatus(item.id, 'approved'), 'Approved')}>
          Approve
        </button>
        {confirmCancel ? (
          <span class="confirm-inline" role="group" aria-label="Confirm cancel">
            <button type="button" class="btn btn-danger" onClick={() => {
                store.run(cmd.setItemStatus(item.id, 'cancelled'), 'Cancelled')
                setConfirmCancel(false)
              }}>
              Confirm cancel
            </button>
            <button type="button" class="btn btn-quiet" onClick={() => setConfirmCancel(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" class="btn btn-danger-quiet" disabled={!cancel.ok} title={cancel.reason} onClick={() => setConfirmCancel(true)}>
            Cancel item…
          </button>
        )}
      </div>

      <section aria-labelledby="phases-title">
        <h4 id="phases-title">Phases</h4>
        <ol class="phases">
          {item.phases.map((p, i) => (
            <PhaseRow key={i} item={item} index={i} />
          ))}
        </ol>
      </section>

      {item.todos.length > 0 && (
        <section aria-labelledby="todos-title">
          <h4 id="todos-title">Todos</h4>
          <ul class="todos">
            {item.todos.map((td) => (
              <li key={td.id}>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={td.done}
                    disabled={td.done}
                    onChange={() => store.run(cmd.completeTodo(item.id, td.id), 'Todo done')}
                  />
                  <span class={td.done ? 'done' : ''}>{text.todos[td.id] ?? td.id}</span>
                </label>
                {td.assignee && <PersonButton staff={td.assignee} compact />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(artifacts.length > 0 || item.tickets.length > 0 || item.dependsOn.length > 0) && (
        <section aria-labelledby="links-title" class="links">
          <h4 id="links-title">Artifacts &amp; links</h4>
          <ul>
            {artifacts.map((a) => (
              <li key={a.id}>
                <ArtifactLink a={a.artifact!} />
              </li>
            ))}
            {item.tickets.map((tk) => (
              <li key={tk}>
                Ticket{' '}
                <button type="button" class="link-btn" onClick={() => (store.panel.value = 'inbox')}>
                  {tk}
                </button>
              </li>
            ))}
            {item.dependsOn.map((d) => (
              <li key={d}>
                Depends on{' '}
                <button type="button" class="link-btn" onClick={() => (store.selectedItem.value = d)}>
                  {text.items[d]?.title ?? d}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Thread item={item} posts={posts} />
    </div>
  )
}

function PhaseRow({ item, index }: { item: WorkItemJson; index: number }) {
  const store = useStore()
  const p = item.phases[index]
  const team = store.org.value.projects.find((x) => x.id === item.project)?.team ?? []
  const everyone = store.org.value.staff
  const [who, setWho] = useState('')
  const verdict = who ? store.check(cmd.assignPhase(item.id, index, who)) : null
  const agency = store.check(cmd.sendToAgency(item.id, index))
  const done = p.state === 'done'
  const id = `${item.id}-ph-${index}`
  return (
    <li class={`phase st-${p.state}`}>
      <div class="phase-head">
        <strong>{sentence(p.kind)}</strong>
        <Badge tone={p.state === 'done' ? 'good' : p.state === 'blocked' ? 'bad' : p.state === 'working' ? 'info' : 'neutral'}>{sentence(p.state)}</Badge>
        {p.agency ? <Badge tone="info">Agency (Claude)</Badge> : p.assignee ? <PersonButton staff={p.assignee} /> : <Badge tone="warn">Unassigned</Badge>}
        <span class="small muted">{Math.round(p.estimateMinutes / 60)}h est.</span>
      </div>
      <Meter label={`${sentence(p.kind)} progress`} value={p.state === 'done' ? 1 : p.progress} text={`${Math.round((p.state === 'done' ? 1 : p.progress) * 100)}%`} />
      {!done && (
        <div class="phase-actions">
          <label class="field-inline">
            <span>Reassign</span>
            <select id={id} value={who} onChange={(e) => setWho(e.currentTarget.value)}>
              <option value="">Choose…</option>
              <optgroup label="Project team">
                {team.map((m) => (
                  <option key={m.staff} value={m.staff}>
                    {store.nameOf(m.staff)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Others">
                {everyone
                  .filter((s) => !team.some((m) => m.staff === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {store.nameOf(s.id)}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          <button
            type="button"
            class="btn"
            disabled={!verdict?.ok}
            onClick={() => {
              void store.run(cmd.assignPhase(item.id, index, who), `${sentence(p.kind)} → ${store.nameOf(who)}`).then((r) => r.ok && setWho(''))
            }}
          >
            Reassign
          </button>
          <button type="button" class="btn btn-quiet" disabled={!agency.ok} title={agency.reason} onClick={() => store.run(cmd.sendToAgency(item.id, index), 'Sent to the Agency')}>
            Send to Agency
          </button>
          {verdict && !verdict.ok && (
            <p class="small error-text" role="status">
              {verdict.reason}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function ArtifactLink({ a }: { a: NonNullable<PlanPost['artifact']> }) {
  return a.url ? (
    <a href={a.url} target="_blank" rel="noopener noreferrer">
      {a.label}
    </a>
  ) : (
    <span>
      {a.label}
      {a.path && <code class="small"> {a.path}</code>}
    </span>
  )
}

const POST_LABEL: Record<string, string> = {
  comment: 'Comment',
  handoff: 'Handoff',
  'todo-add': 'Todo added',
  'todo-done': 'Todo done',
  review: 'Review',
  question: 'Question',
  decision: 'Decision',
  status: 'Status',
  minutes: 'Minutes',
  proposal: 'Proposal',
  artifact: 'Artifact',
  performance: 'Content performance',
}

/** `@slug` mentions highlighted. */
function Mentions({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9-]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('@') ? (
          <span key={i} class="mention">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

export function Thread({ item, posts }: { item: WorkItemJson; posts: PlanPost[] }) {
  const store = useStore()
  const [draft, setDraft] = useState('')
  return (
    <section aria-labelledby="thread-title" class="thread">
      <h4 id="thread-title">
        Thread <span class="muted small">({posts.length})</span>
      </h4>
      <ol class="posts" aria-live="polite">
        {posts.map((p) => (
          <ThreadPost key={p.id} item={item} post={p} />
        ))}
      </ol>
      <form
        class="comment-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          const text = draft.trim()
          setDraft('')
          void store.comment(item.id, text)
        }}
      >
        <label class="field">
          <span>Comment as CEO</span>
          <textarea rows={2} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} placeholder="@giulia can we add the festival dates?" />
        </label>
        <button type="submit" class="btn" disabled={!draft.trim()}>
          Post comment
        </button>
      </form>
    </section>
  )
}

export function ThreadPost({ item, post: p }: { item: WorkItemJson; post: PlanPost }) {
  const store = useStore()
  const isStaff = p.author.startsWith('staff-')
  const when = p.day != null ? `Day ${p.day + 1} · ${pad2(Math.floor((p.minute ?? 0) / 60))}:${pad2((p.minute ?? 0) % 60)}` : ''
  const accept = p.type === 'proposal' && !p.accepted ? store.check(cmd.acceptProposal(item.id, p.id)) : null
  return (
    <li class={`post post-${p.type}`} data-type={p.type}>
      <span class="post-avatar">
        {isStaff ? (
          <Avatar persona={store.personaOf(p.author)} size={28} />
        ) : (
          <span class={`avatar avatar-${p.author}`} aria-hidden="true">
            {p.author === 'ceo' ? 'CEO' : 'SYS'}
          </span>
        )}
      </span>
      <div class="post-body">
        <p class="post-head">
          <strong>{store.nameOf(p.author)}</strong> <span class={`post-type type-${p.type}`}>{POST_LABEL[p.type] ?? p.type}</span>
          {p.type === 'handoff' && p.to && <span class="handoff-to"> → {store.nameOf(p.to)}</span>}
          {p.type === 'review' && (
            <span class={`review-verdict v-${p.verdict}`}>
              {' '}
              {p.verdict === 'approve' ? 'Approved' : p.verdict === 'reject' ? 'Rejected' : 'Changes requested'} · score {p.score}/10
            </span>
          )}
          <span class="post-time muted small"> {when}</span>
        </p>

        {p.type === 'status' ? (
          <p class="small">
            {p.from && p.toStatus ? (
              <>
                {sentence(p.from)} → <strong>{sentence(p.toStatus)}</strong>
                {!p.text.startsWith('Status:') && <> · {p.text}</>}
              </>
            ) : (
              p.text
            )}
          </p>
        ) : p.type === 'minutes' ? (
          <div class="minutes">
            <p class="small muted">
              {p.meeting ?? 'Meeting'}
              {p.attendees && p.attendees.length > 0 && <> · {p.attendees.map((a) => store.nameOf(a).split(' ')[0]).join(', ')}</>}
            </p>
            <p>{p.text}</p>
          </div>
        ) : p.type === 'performance' && p.metrics ? (
          <div class="perf-post">
            <dl class="mini-metrics" aria-label={`Performance ${p.metrics.window}`}>
              <div>
                <dt>Views</dt>
                <dd>{p.metrics.views.toLocaleString('en')}</dd>
              </div>
              <div>
                <dt>Engaged</dt>
                <dd>{p.metrics.engagedPct}%</dd>
              </div>
              {p.metrics.scrollDepthPct != null && (
                <div>
                  <dt>Scroll</dt>
                  <dd>{p.metrics.scrollDepthPct}%</dd>
                </div>
              )}
              {p.metrics.outboundClicks != null && (
                <div>
                  <dt>Outbound</dt>
                  <dd>{p.metrics.outboundClicks}</dd>
                </div>
              )}
              {p.metrics.vsMedianPct != null && (
                <div>
                  <dt>vs median</dt>
                  <dd class={p.metrics.vsMedianPct >= 0 ? 'good-text' : 'bad-text'}>
                    {p.metrics.vsMedianPct >= 0 ? '+' : ''}
                    {p.metrics.vsMedianPct}%
                  </dd>
                </div>
              )}
            </dl>
            <p class="small">
              <strong>{p.metrics.window}:</strong> {p.text}
            </p>
          </div>
        ) : p.type === 'artifact' && p.artifact ? (
          <p class="small">
            {p.text}: <ArtifactLink a={p.artifact} />
          </p>
        ) : p.type === 'todo-add' || p.type === 'todo-done' ? (
          <p class="small">{p.todo ? (store.planText.value.todos[p.todo] ?? p.text) : p.text}</p>
        ) : p.type === 'proposal' ? (
          <div class="proposal">
            {p.proposal && (
              <p>
                <strong>{p.proposal.title}</strong> <Badge>{sentence(p.proposal.kind)}</Badge>
              </p>
            )}
            <p>
              <Mentions text={p.text} />
            </p>
            {p.accepted ? (
              <Badge tone="good">Accepted</Badge>
            ) : (
              <button
                type="button"
                class="btn"
                disabled={!accept?.ok}
                title={accept?.reason}
                onClick={() => store.run(cmd.acceptProposal(item.id, p.id), `Accepted: ${p.proposal?.title ?? 'proposal'}`)}
              >
                Accept proposal
              </button>
            )}
          </div>
        ) : p.type === 'question' ? (
          <div class="question">
            <p>
              <Mentions text={p.text} />
            </p>
            <p class="small muted">
              {p.answeredBy ? <>Answered by {store.nameOf(p.answeredBy)}</> : p.ticket ? <>Escalated to the Inbox as {p.ticket}</> : 'Open question'}
            </p>
          </div>
        ) : p.type === 'decision' ? (
          <p class="decision-text">
            <Mentions text={p.text} />
          </p>
        ) : (
          <p>
            <Mentions text={p.text} />
          </p>
        )}
      </div>
    </li>
  )
}

