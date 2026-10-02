import { useEffect, useRef, useState } from 'preact/hooks'
import { cmd } from '../commands'
import { eur, sentence, titleCase } from '../format'
import type { Persona } from '../personas'
import { allocationTotal, humanRole, MAX_ALLOCATION, maxAllocationFor } from '../rules'
import { useStore } from '../store'
import type { StaffJson } from '../types'
import { Avatar, Badge, Icon, Meter, PersonButton } from './common'
import { useCandidates } from './Hiring'

/** Tab focus stays inside an open modal dialog. */
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return
  const f = Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href], [tabindex="0"]'),
  )
  if (f.length === 0) return
  const first = f[0]
  const last = f[f.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

export function ProfileCard() {
  const store = useStore()
  const target = store.profile.value
  const ref = useRef<HTMLDivElement>(null)
  const pool = useCandidates()
  useEffect(() => {
    if (target) ref.current?.focus()
  }, [target && ('staff' in target ? target.staff : target.persona)])
  if (!target) return null

  const staff = 'staff' in target ? store.staff(target.staff) : undefined
  const persona: Persona | undefined = staff ? store.personaOf(staff.id) : 'persona' in target ? store.persona(target.persona) : undefined
  if (!persona) return null
  const candidate = !staff ? pool.find((c) => c.persona.slug === persona.slug)?.candidate : undefined

  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && store.closeProfile()}>
      <div
        ref={ref}
        class="modal profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-name"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            store.closeProfile()
          }
          trapTab(e, ref.current)
        }}
      >
        <header class="profile-head">
          <Avatar persona={persona} size={64} />
          <div class="profile-id">
            <h2 id="profile-name">{persona.name}</h2>
            <p class="muted">
              {persona.pronouns && <>{persona.pronouns} · </>}
              {persona.title}
            </p>
            <p class="profile-tags">
              <Badge>{titleCase(staff?.department ?? persona.department)}</Badge>
              <Badge tone="info">{sentence(staff?.seniority ?? persona.seniority)}</Badge>
              {staff ? <Badge>{eur(staff.salaryEurMonth)}/month</Badge> : <Badge tone="warn">Candidate · asks {eur(candidate?.askingEurMonth ?? persona.salaryEurMonth)}/month</Badge>}
            </p>
          </div>
          <button type="button" class="icon-btn" onClick={() => store.closeProfile()} aria-label="Close profile">
            <Icon name="close" />
          </button>
        </header>

        <div class="profile-body">
          <div class="profile-main">
            {persona.pitch && <p class="pitch">{persona.pitch}</p>}
            {persona.bio && <p class="bio">{persona.bio}</p>}

            {staff && <Mood staff={staff} />}
            {staff && <ProjectsBlock staff={staff} />}

            {(persona.cv.education.length > 0 || persona.cv.experience.length > 0) && (
              <section aria-labelledby="cv-title">
                <h3 id="cv-title">CV</h3>
                <ol class="timeline">
                  {persona.cv.experience
                    .slice()
                    .reverse()
                    .map((x, i) => (
                      <li key={`x${i}`}>
                        <span class="tl-years">{x.years}</span>
                        <span class="tl-what">
                          <strong>{x.role}</strong>, {x.org}
                          {x.highlights.length > 0 && (
                            <ul class="tl-hl">
                              {x.highlights.map((h) => (
                                <li key={h}>{h}</li>
                              ))}
                            </ul>
                          )}
                        </span>
                      </li>
                    ))}
                  {persona.cv.education.map((x, i) => (
                    <li key={`e${i}`}>
                      <span class="tl-years">{x.years}</span>
                      <span class="tl-what">
                        <strong>{x.what}</strong>, {x.where}
                      </span>
                    </li>
                  ))}
                </ol>
                {persona.cv.awards.length > 0 && <p class="small">Awards: {persona.cv.awards.join(' · ')}</p>}
              </section>
            )}
          </div>

          <aside class="profile-side" aria-label="About">
            <Facts title="Skills" items={persona.cv.skills} />
            <Facts title="Languages" items={persona.languages} />
            <Facts title="Hobbies" items={persona.life.hobbies} />
            <Facts title="Interests" items={persona.life.interests} />
            <Facts title="Quirks" items={persona.life.quirks} />
            <Facts title="Likes" items={persona.life.likes} />
            <Facts title="Dislikes" items={persona.life.dislikes} />
            {persona.life.workStyle && (
              <div class="facts">
                <h3>Work style</h3>
                <p class="small">{persona.life.workStyle}</p>
              </div>
            )}
            <Relationships persona={persona} />
          </aside>
        </div>

        <footer class="profile-actions">
          {staff ? <StaffActions staff={staff} name={persona.name.split(' ')[0]} /> : candidate ? <HireAction candidateId={candidate.id} name={persona.name} note={store.org.value.executive.cfo ? candidate.affordability : null} /> : null}
        </footer>
      </div>
    </div>
  )
}

function Facts({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div class="facts">
      <h3>{title}</h3>
      <ul class="chips">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

function Relationships({ persona }: { persona: Persona }) {
  const store = useStore()
  const { friends, friction } = persona.relationships
  if (friends.length + friction.length === 0) return null
  const who = (slug: string) => {
    const s = store.org.value.staff.find((x) => x.persona === slug)
    return s ? <PersonButton staff={s.id} compact /> : <span class="chip">{store.persona(slug)?.name ?? slug}</span>
  }
  return (
    <div class="facts">
      <h3>Relationships</h3>
      {friends.length > 0 && (
        <p class="rel">
          <span class="muted small">Friends</span> {friends.map((f) => <span key={f}>{who(f)}</span>)}
        </p>
      )}
      {friction.length > 0 && (
        <p class="rel">
          <span class="muted small">Friction</span> {friction.map((f) => <span key={f}>{who(f)}</span>)}
        </p>
      )}
    </div>
  )
}

function Mood({ staff }: { staff: StaffJson }) {
  return (
    <section aria-labelledby="mood-title" class="mood">
      <h3 id="mood-title">
        Mood <span class="muted small">· {staff.activity}</span>
      </h3>
      <Meter label="Morale" value={staff.morale} tone={staff.morale < 0.4 ? 'bad' : staff.morale < 0.6 ? 'warn' : 'good'} text={`${Math.round(staff.morale * 100)}%`} />
      <Meter label="Fatigue" value={staff.fatigue} tone={staff.fatigue > 0.7 ? 'bad' : staff.fatigue > 0.45 ? 'warn' : 'good'} text={`${Math.round(staff.fatigue * 100)}%`} />
    </section>
  )
}

function ProjectsBlock({ staff }: { staff: StaffJson }) {
  const store = useStore()
  const total = allocationTotal(staff)
  return (
    <section aria-labelledby="alloc-title">
      <h3 id="alloc-title">
        Projects <span class="muted small">· {total}% of {MAX_ALLOCATION}% allocated</span>
      </h3>
      {staff.projects.length === 0 ? (
        <p class="muted small">Company-wide (no project allocation).</p>
      ) : (
        <ul class="alloc-list">
          {staff.projects.map((a) => (
            <li key={a.project}>
              <span>{store.projectName(a.project)}</span>
              <Meter label={`${store.projectName(a.project)} allocation`} value={a.allocation} max={100} text={`${a.allocation}%`} />
              <button
                type="button"
                class="btn btn-quiet"
                onClick={() => store.run(cmd.remove(staff.id, a.project), `Removed from ${store.projectName(a.project)}`)}
              >
                Remove<span class="sr-only"> from {store.projectName(a.project)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AllocationEditor staff={staff} />
    </section>
  )
}

/** Assign to a project with an allocation slider that respects the 100% rule (validated via validate()). */
export function AllocationEditor({ staff }: { staff: StaffJson }) {
  const store = useStore()
  const projects = store.org.value.projects.filter((p) => p.status !== 'archived')
  const [project, setProject] = useState(projects.find((p) => !staff.projects.some((a) => a.project === p.id))?.id ?? projects[0]?.id ?? '')
  const max = maxAllocationFor(staff, project)
  const current = staff.projects.find((a) => a.project === project)?.allocation
  // The slider value belongs to the selected project; switching resets it to the current allocation.
  const [edit, setEdit] = useState<{ key: string; pct: number } | null>(null)
  const key = `${staff.id}/${project}`
  const pct = edit?.key === key ? edit.pct : (current ?? Math.min(max, 50))
  const setPct = (n: number) => setEdit({ key, pct: n })
  const value = Math.min(pct, max)
  // store.check() is cached per snapshot and re-renders when the source answers.
  const verdict =
    value < 1
      ? { ok: false, reason: max === 0 ? `Fully allocated elsewhere (${allocationTotal(staff, project)}%)` : 'Pick at least 1%' }
      : store.check(cmd.assign(staff.id, project, value))
  if (projects.length === 0) return null
  return (
    <form
      class="alloc-editor"
      aria-labelledby="assign-title"
      onSubmit={(e) => {
        e.preventDefault()
        if (verdict.ok) void store.run(cmd.assign(staff.id, project, value), `Assigned ${value}% to ${store.projectName(project)}`)
      }}
    >
      <h4 id="assign-title">Assign to project</h4>
      <label class="field">
        <span>Project</span>
        <select value={project} onChange={(e) => setProject(e.currentTarget.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span>
          Allocation: <output>{value}%</output> <span class="muted small">(max {max}%)</span>
        </span>
        <input
          type="range"
          min={0}
          max={max}
          step={5}
          value={value}
          disabled={max === 0}
          aria-valuetext={`${value}%, ${allocationTotal(staff, project) + value}% of 100% total`}
          onInput={(e) => setPct(Number(e.currentTarget.value))}
        />
      </label>
      <p class="small muted">
        Total after: {allocationTotal(staff, project) + value}% of {MAX_ALLOCATION}%
      </p>
      <p class={`small${verdict.ok ? '' : ' error-text'}`} role="status" aria-live="polite">
        {verdict.ok ? '' : verdict.reason}
      </p>
      <button type="submit" class="btn" disabled={!verdict.ok}>
        {current ? 'Update allocation' : 'Assign'}
      </button>
    </form>
  )
}

function StaffActions({ staff, name }: { staff: StaffJson; name: string }) {
  const store = useStore()
  const [salary, setSalary] = useState(staff.salaryEurMonth)
  const [confirmFire, setConfirmFire] = useState(false)
  useEffect(() => setSalary(staff.salaryEurMonth), [staff.id, staff.salaryEurMonth])
  const praise = store.check(cmd.praise(staff.id))
  const promote = store.check(cmd.promote(staff.id))
  const salaryCheck = store.check(cmd.setSalaryEurMonth(staff.id, salary))

  if (confirmFire)
    return (
      <div class="confirm" role="alertdialog" aria-labelledby="fire-q" aria-describedby="fire-d">
        <p id="fire-q">
          <strong>Fire {name}?</strong>
        </p>
        <p id="fire-d" class="small muted">
          {humanRole(staff.role)}. Severance is paid; they leave their projects{staff.role === 'cfo' ? ' and the books stop being kept' : ''}
          {staff.role === 'secretary' ? ' and delegation stops' : ''}.
        </p>
        <button
          type="button"
          class="btn btn-danger"
          onClick={() => {
            void store.run(cmd.fire(staff.id), `${name} has left the company`).then((r) => r.ok && store.closeProfile())
          }}
        >
          Confirm: fire {name}
        </button>
        <button type="button" class="btn btn-quiet" onClick={() => setConfirmFire(false)} autoFocus>
          Cancel
        </button>
      </div>
    )

  return (
    <div class="actions-row">
      <button type="button" class="btn" disabled={!praise.ok} title={praise.reason} onClick={() => store.run(cmd.praise(staff.id), `You praised ${name}`)}>
        Praise
      </button>
      <button type="button" class="btn" disabled={!promote.ok} title={promote.reason} onClick={() => store.run(cmd.promote(staff.id), `${name} promoted`)}>
        Promote
      </button>
      <form
        class="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          store.run(cmd.setSalaryEurMonth(staff.id, salary), `${name}'s salary set to ${eur(salary)}/month`)
        }}
      >
        <label class="field-inline">
          <span>Salary €/month</span>
          <input type="number" min={0} step={100} value={salary} onInput={(e) => setSalary(Number(e.currentTarget.value))} />
        </label>
        <button type="submit" class="btn" disabled={!salaryCheck.ok || salary === staff.salaryEurMonth} title={salaryCheck.reason}>
          Set salary
        </button>
      </form>
      <button type="button" class="btn btn-danger-quiet" onClick={() => setConfirmFire(true)}>
        Fire…
      </button>
    </div>
  )
}

export function HireAction({ candidateId, name, note }: { candidateId: string; name: string; note?: string | null }) {
  const store = useStore()
  const v = store.check(cmd.hire(candidateId))
  return (
    <div class="actions-row">
      {note && <p class="small cfo-note">CFO: {note}</p>}
      <button type="button" class="btn" disabled={!v.ok} title={v.reason} onClick={() => store.run(cmd.hire(candidateId), `${name} hired`)}>
        Hire {name.split(' ')[0]}
      </button>
    </div>
  )
}
