import { useEffect, useState } from 'preact/hooks'
import { cmd } from '../commands'
import { eur, sentence } from '../format'
import { humanRole, projectLockReason } from '../rules'
import { useStore } from '../store'
import type { ProjectJson } from '../types'
import { Badge, Meter, Notice, Panel, PersonButton } from './common'

const STATUSES = ['proposed', 'active', 'paused', 'archived'] as const

export function Projects() {
  const store = useStore()
  const org = store.org.value
  const selected = org.projects.find((p) => p.id === store.selectedProject.value) ?? null
  return (
    <Panel id="projects" title="Projects">
      {selected ? (
        <ProjectDetail project={selected} />
      ) : (
        <>
          <ul class="card-list" aria-label="Projects">
            {org.projects.map((p) => {
              const spent = store.finance.value.projects.find((f) => f.id === p.id)?.spentEurMonth ?? 0
              return (
                <li key={p.id} class="card">
                  <div class="card-row">
                    <h3>
                      <button type="button" class="link-btn" onClick={() => (store.selectedProject.value = p.id)}>
                        {p.name}
                      </button>
                    </h3>
                    <Badge tone={p.status === 'active' ? 'good' : p.status === 'proposed' ? 'info' : 'neutral'}>{sentence(p.status)}</Badge>
                  </div>
                  <p class="small muted">
                    {p.team.length} people · lead {p.lead ? store.nameOf(p.lead) : 'none'} · {eur(spent)} of {eur(p.budgetEurMonth)} this month
                  </p>
                  {p.missingRoles.length > 0 && (
                    <p class="small warn-text">Missing: {p.missingRoles.map(humanRole).join(', ')}</p>
                  )}
                </li>
              )
            })}
          </ul>
          <CreateProject />
        </>
      )}
    </Panel>
  )
}

function ProjectDetail({ project: p }: { project: ProjectJson }) {
  const store = useStore()
  const fin = store.finance.value.projects.find((f) => f.id === p.id)
  const [budget, setBudget] = useState(p.budgetEurMonth)
  const [lead, setLead] = useState(p.lead ?? '')
  const [status, setStatus] = useState<string>(p.status)
  useEffect(() => {
    setBudget(p.budgetEurMonth)
    setLead(p.lead ?? '')
    setStatus(p.status)
  }, [p.id, p.budgetEurMonth, p.lead, p.status])
  const leadCheck = lead ? store.check(cmd.setLead(p.id, lead)) : { ok: false, reason: 'Pick a team member' }
  const statusCheck = store.check(cmd.setStatus(p.id, status))
  const spent = fin?.spentEurMonth ?? 0
  return (
    <div class="detail">
      <button type="button" class="btn btn-quiet back" onClick={() => (store.selectedProject.value = null)}>
        ← All projects
      </button>
      <div class="card-row">
        <h3 class="detail-title">{p.name}</h3>
        <Badge tone={p.status === 'active' ? 'good' : 'info'}>{sentence(p.status)}</Badge>
      </div>
      <p class="small">
        <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer">
          {p.domain}
        </a>{' '}
        · lead {p.lead ? <PersonButton staff={p.lead} compact /> : <span class="muted">none</span>}
      </p>

      {p.missingRoles.length > 0 && (
        <Notice tone="warn" title="Missing roles">
          Work needing a {p.missingRoles.map(humanRole).join(', ')} is blocked on this project.
        </Notice>
      )}

      <section aria-labelledby="budget-title">
        <h4 id="budget-title">Budget</h4>
        <Meter
          label="Spent this month"
          value={spent}
          max={Math.max(p.budgetEurMonth, 1)}
          tone={fin?.overBudget ? 'bad' : spent > p.budgetEurMonth * 0.85 ? 'warn' : 'good'}
          text={`${eur(spent)} of ${eur(p.budgetEurMonth)}`}
        />
        <form
          class="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            store.run(cmd.setBudgetEurMonth(p.id, budget), `Budget set to ${eur(budget)}/month`)
          }}
        >
          <label class="field-inline">
            <span>Monthly budget (€)</span>
            <input type="number" min={0} step={500} value={budget} onInput={(e) => setBudget(Number(e.currentTarget.value))} />
          </label>
          <button type="submit" class="btn" disabled={budget === p.budgetEurMonth}>
            Set budget
          </button>
        </form>
      </section>

      <section aria-labelledby="team-title">
        <h4 id="team-title">Team ({p.team.length})</h4>
        {p.team.length === 0 ? (
          <p class="muted small">Nobody is staffed yet. Assign people from their profile card.</p>
        ) : (
          <table class="table">
            <caption class="sr-only">Team of {p.name} with allocations</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col" class="num">
                  Allocation
                </th>
              </tr>
            </thead>
            <tbody>
              {p.team.map((m) => (
                <tr key={m.staff}>
                  <td>
                    <PersonButton staff={m.staff} />
                  </td>
                  <td>{humanRole(store.staff(m.staff)?.role ?? '')}</td>
                  <td class="num">{m.allocation}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          class="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (leadCheck.ok) store.run(cmd.setLead(p.id, lead), `${store.nameOf(lead)} now leads ${p.name}`)
          }}
        >
          <label class="field-inline">
            <span>Lead</span>
            <select value={lead} onChange={(e) => setLead(e.currentTarget.value)}>
              <option value="">Choose…</option>
              {p.team.map((m) => (
                <option key={m.staff} value={m.staff}>
                  {store.nameOf(m.staff)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" class="btn" disabled={!leadCheck.ok || lead === p.lead} title={leadCheck.reason}>
            Set lead
          </button>
        </form>
      </section>

      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          store.run(cmd.setStatus(p.id, status), `${p.name} is now ${status}`)
        }}
      >
        <label class="field-inline">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {sentence(s)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" class="btn" disabled={!statusCheck.ok || status === p.status}>
          Set status
        </button>
        {!statusCheck.ok && status !== p.status && (
          <span class="small error-text" role="status">
            {statusCheck.reason}
          </span>
        )}
      </form>
    </div>
  )
}

export function CreateProject() {
  const store = useStore()
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [budget, setBudget] = useState(20000)
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const lock = projectLockReason(store.org.value)
  const v = lock ? { ok: false, reason: `Locked: ${lock}` } : name.trim() ? store.check(cmd.createProject({ name, slug, domain, budgetEurMonth: budget })) : { ok: false, reason: 'Name the publication' }
  return (
    <form
      class="card create-project"
      aria-labelledby="create-title"
      aria-describedby={lock ? 'create-lock' : undefined}
      onSubmit={(e) => {
        e.preventDefault()
        if (v.ok && store.run(cmd.createProject({ name, slug, domain, budgetEurMonth: budget }), `${name} created`).ok) {
          setName('')
          setDomain('')
        }
      }}
    >
      <h3 id="create-title">Create project</h3>
      {lock && (
        <p id="create-lock" class="small warn-text">
          Locked. {lock}
        </p>
      )}
      <fieldset disabled={!!lock}>
        <legend class="sr-only">New publication</legend>
        <label class="field">
          <span>Name</span>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Portofino Weekly" />
        </label>
        <label class="field">
          <span>Domain</span>
          <input value={domain} onInput={(e) => setDomain(e.currentTarget.value)} placeholder="portofino.travel" />
        </label>
        <label class="field">
          <span>Monthly budget (€)</span>
          <input type="number" min={0} step={500} value={budget} onInput={(e) => setBudget(Number(e.currentTarget.value))} />
        </label>
      </fieldset>
      <button type="submit" class="btn" disabled={!v.ok} title={v.reason}>
        Create project
      </button>
      {!lock && !v.ok && name.trim() && (
        <p class="small error-text" role="status">
          {v.reason}
        </p>
      )}
    </form>
  )
}
