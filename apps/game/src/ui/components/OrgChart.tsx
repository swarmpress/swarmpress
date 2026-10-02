import { useSignal } from '@preact/signals'
import { useStore } from '../store'
import { humanRole } from '../rules'
import { Badge, Panel, PersonButton } from './common'

/** CEO → Executive Office (CFO, Secretary) → departments with members (organization.md §1). */
export function OrgChart() {
  const store = useStore()
  const org = store.org.value
  const filter = useSignal<string>('all')
  const onProject = (staffId: string) => {
    if (filter.value === 'all') return true
    const s = store.staff(staffId)
    return !!s?.projects.some((a) => a.project === filter.value && a.allocation > 0)
  }
  const allocText = (staffId: string) => {
    const s = store.staff(staffId)
    if (!s) return ''
    const total = s.projects.reduce((n, a) => n + a.allocation, 0)
    return `${humanRole(s.role)} · ${total ? `${total}% on projects` : 'company-wide'}`
  }
  const { cfo, secretary } = org.executive
  const depts = org.departments.filter((d) => d.id !== 'executive' && d.id !== 'executive-office')

  return (
    <Panel id="org" title="Org chart" wide>
      <div class="toolbar-row">
        <label class="field-inline">
          <span>Project</span>
          <select value={filter.value} onChange={(e) => (filter.value = e.currentTarget.value)}>
            <option value="all">All people</option>
            {org.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span class="muted">{org.staff.length} people</span>
      </div>

      <div class="org">
        <div class="org-ceo">
          <span class="org-node is-ceo">
            <strong>CEO</strong> <span class="muted">{org.ceo.name}</span>
          </span>
        </div>
        <section class="org-exec" aria-labelledby="org-exec-title">
          <h3 id="org-exec-title">Executive Office</h3>
          <ul class="org-members">
            <li>
              <span class="org-slot">CFO</span>
              {cfo ? <PersonButton staff={cfo} detail="Finance" /> : <Badge tone="warn">Vacant: books not kept</Badge>}
            </li>
            <li>
              <span class="org-slot">Secretary</span>
              {secretary ? <PersonButton staff={secretary} detail="Triage & delegation" /> : <Badge tone="warn">Vacant: no triage</Badge>}
            </li>
          </ul>
        </section>
        <div class="org-depts">
          {depts.map((d) => {
            const members = d.members.filter(onProject)
            return (
              <section key={d.id} class="org-dept" aria-labelledby={`dept-${d.id}`}>
                <h3 id={`dept-${d.id}`}>
                  {d.name} <span class="muted">({members.length})</span>
                </h3>
                {members.length === 0 ? (
                  <p class="muted small">{d.members.length ? 'Nobody on this project' : 'No one yet'}</p>
                ) : (
                  <ul class="org-members">
                    {members.map((m) => (
                      <li key={m}>
                        <PersonButton
                          staff={m}
                          detail={
                            <>
                              {allocText(m)}
                              {d.head === m && <> · head</>}
                            </>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
