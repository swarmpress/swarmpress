import { useState } from 'preact/hooks'
import { sentence } from '../format'
import { availableViews, currentPhase, filterItems, itemProgress, workload, WORK_MINUTES_PER_WEEK, type BoardFilter, type PlanView } from '../plan-logic'
import { STATUS_ORDER, type WorkItemJson } from '../plan-types'
import { useStore } from '../store'
import { Badge, Meter, Panel, PersonButton, priorityTone, TabPanel, Tabs } from './common'
import { WorkItemDetail } from './WorkItem'

type View = PlanView
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'board', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'workload', label: 'Workload' },
  { id: 'goals', label: 'Goals' },
]

/** The media & publishing plan: the CEO's main instrument (publishing-plan.md §5, ADR-0031). */
export function Plan() {
  const store = useStore()
  const [chosen, setView] = useState<View>('board')
  const [filter, setFilter] = useState<BoardFilter>({ project: null, workstream: null, person: null })
  const selected = store.plan.value.items.find((i) => i.id === store.selectedItem.value)
  // Only the views the plan has data for (the live sim exports no schedule or goals yet).
  const available = availableViews(store.plan.value)
  const tabs = VIEWS.filter((v) => available.includes(v.id))
  const view = available.includes(chosen) ? chosen : 'board'

  return (
    <Panel id="plan" title="Media & publishing plan" wide>
      {selected ? (
        <WorkItemDetail item={selected} />
      ) : (
        <>
          <Filters filter={filter} onChange={setFilter} />
          {tabs.length > 1 ? (
            <>
              <Tabs label="Plan views" idPrefix="plan" tabs={tabs} value={view} onChange={setView} />
              <TabPanel idPrefix="plan" value={view}>
                {view === 'board' && <Board filter={filter} />}
                {view === 'calendar' && <Calendar filter={filter} />}
                {view === 'timeline' && <Timeline filter={filter} />}
                {view === 'workload' && <Workload />}
                {view === 'goals' && <Goals />}
              </TabPanel>
            </>
          ) : (
            // The board is the only view with data: no tab row for a single tab.
            <Board filter={filter} />
          )}
        </>
      )}
    </Panel>
  )
}

function Filters({ filter, onChange }: { filter: BoardFilter; onChange: (f: BoardFilter) => void }) {
  const store = useStore()
  const org = store.org.value
  const plan = store.plan.value
  const wsText = store.planText.value.workstreams
  const set = (k: keyof BoardFilter) => (e: Event) => onChange({ ...filter, [k]: (e.currentTarget as HTMLSelectElement).value || null })
  return (
    <div class="toolbar-row filters" role="group" aria-label="Filter the plan">
      <label class="field-inline">
        <span>Project</span>
        <select value={filter.project ?? ''} onChange={set('project')}>
          <option value="">All</option>
          {org.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label class="field-inline">
        <span>Workstream</span>
        <select value={filter.workstream ?? ''} onChange={set('workstream')}>
          <option value="">All</option>
          {plan.workstreams
            .filter((w) => !filter.project || w.project === filter.project)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {wsText[w.id]?.title ?? w.id}
              </option>
            ))}
        </select>
      </label>
      <label class="field-inline">
        <span>Person</span>
        <select value={filter.person ?? ''} onChange={set('person')}>
          <option value="">Anyone</option>
          {org.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {store.nameOf(s.id)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function ItemCard({ item }: { item: WorkItemJson }) {
  const store = useStore()
  const title = store.planText.value.items[item.id]?.title ?? item.id
  const phase = currentPhase(item)
  return (
    <article class={`item-card prio-${item.priority}`} aria-labelledby={`${item.id}-t`}>
      <h4 id={`${item.id}-t`}>
        <button type="button" class="link-btn" onClick={() => (store.selectedItem.value = item.id)}>
          {title}
        </button>
      </h4>
      <p class="item-meta">
        <Badge>{sentence(item.kind)}</Badge>
        {item.priority !== 'normal' && <Badge tone={priorityTone(item.priority)}>{sentence(item.priority)}</Badge>}
        {item.publishDay != null && <span class="small muted">Pub. day {item.publishDay + 1}</span>}
      </p>
      {phase && (
        <p class="item-phase small">
          {phase.agency ? <Badge tone="info">Agency</Badge> : phase.assignee ? <PersonButton staff={phase.assignee} compact /> : <Badge tone="warn">Unassigned</Badge>}
          <span>
            {sentence(phase.kind)} · {Math.round(phase.progress * 100)}%
          </span>
        </p>
      )}
    </article>
  )
}

function Board({ filter }: { filter: BoardFilter }) {
  const store = useStore()
  const items = filterItems(store.plan.value.items, filter)
  return (
    <div class="board" aria-label="Kanban board by status">
      {STATUS_ORDER.map((s) => {
        const col = items.filter((i) => i.status === s)
        return (
          <section key={s} class={`board-col col-${s}`} aria-labelledby={`col-${s}`}>
            <h3 id={`col-${s}`}>
              {sentence(s)} <span class="muted">{col.length}</span>
            </h3>
            <ul>
              {col.map((i) => (
                <li key={i.id}>
                  <ItemCard item={i} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Calendar({ filter }: { filter: BoardFilter }) {
  const store = useStore()
  const today = Math.floor(store.now.value / 1440)
  const days = Array.from({ length: 14 }, (_, i) => today + i)
  const items = filterItems(store.plan.value.items, filter).filter((i) => i.publishDay != null && i.status !== 'cancelled')
  const rows = new Map<string, { project: string; lang: string }>()
  for (const it of items) for (const lang of it.languages?.length ? it.languages : ['en']) rows.set(`${it.project}/${lang}`, { project: it.project, lang })
  const titles = store.planText.value.items
  const earlier = items.filter((i) => i.publishDay! < today)
  return (
    <div class="scroll-x">
      <table class="table calendar">
        <caption>Publish dates, next 14 days, by project and language</caption>
        <thead>
          <tr>
            <th scope="col">Project · language</th>
            {days.map((d) => (
              <th key={d} scope="col" class={d === today ? 'is-today' : ''}>
                Day {d + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([key, r]) => (
            <tr key={key}>
              <th scope="row">
                {store.projectName(r.project)} · {r.lang.toUpperCase()}
              </th>
              {days.map((d) => (
                <td key={d} class={d === today ? 'is-today' : ''}>
                  {items
                    .filter((i) => i.project === r.project && i.publishDay === d && (i.languages?.length ? i.languages : ['en']).includes(r.lang))
                    .map((i) => (
                      <button key={i.id} type="button" class={`cal-chip st-${i.status}`} onClick={() => (store.selectedItem.value = i.id)}>
                        {titles[i.id]?.title ?? i.id}
                      </button>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {earlier.length > 0 && <p class="small muted">{earlier.length} item(s) published earlier.</p>}
    </div>
  )
}

function Timeline({ filter }: { filter: BoardFilter }) {
  const store = useStore()
  const items = filterItems(store.plan.value.items, filter).filter((i) => i.startDay != null && (i.dueDay ?? i.publishDay) != null)
  const titles = store.planText.value.items
  const today = Math.floor(store.now.value / 1440)
  if (items.length === 0) return <p class="muted">Nothing scheduled.</p>
  const lo = Math.min(...items.map((i) => i.startDay!), today)
  const hi = Math.max(...items.map((i) => (i.publishDay ?? i.dueDay)!), today) + 1
  const span = hi - lo
  const x = (d: number) => `${((d - lo) / span) * 100}%`
  return (
    <ol class="timeline-chart" aria-label={`Timeline from day ${lo + 1} to day ${hi}`}>
      {items.map((i) => {
        const end = (i.publishDay ?? i.dueDay)! + 1
        const deps = i.dependsOn.map((d) => titles[d]?.title ?? d)
        return (
          <li key={i.id}>
            <button type="button" class="link-btn tl-label" onClick={() => (store.selectedItem.value = i.id)}>
              {titles[i.id]?.title ?? i.id}
            </button>
            <span class="tl-track" role="img" aria-label={`Day ${i.startDay! + 1} to day ${end}, ${Math.round(itemProgress(i) * 100)}% done${deps.length ? `, depends on ${deps.join(', ')}` : ''}`}>
              <span class="tl-today" style={{ left: x(today) }} />
              <span class={`tl-bar st-${i.status}`} style={{ left: x(i.startDay!), width: `calc(${x(end)} - ${x(i.startDay!)})` }}>
                <span class="tl-fill" style={{ width: `${itemProgress(i) * 100}%` }} />
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Workload() {
  const store = useStore()
  const today = Math.floor(store.now.value / 1440)
  const rows = workload(store.plan.value, store.org.value, today)
  const h = (m: number) => `${Math.round(m / 60)}h`
  return (
    <table class="table workload">
      <caption>Assigned work by week against each person's allocation ({h(WORK_MINUTES_PER_WEEK)} = 100%)</caption>
      <thead>
        <tr>
          <th scope="col">Person</th>
          <th scope="col">This week</th>
          <th scope="col">Next week</th>
          <th scope="col">Later</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.staff}>
            <th scope="row">
              <PersonButton staff={r.staff} />
            </th>
            {r.load.map((m, i) => (
              <td key={i}>
                <Meter
                  label={`${store.nameOf(r.staff)}, ${['this week', 'next week', 'later'][i]}`}
                  value={m}
                  max={r.capacity}
                  tone={m > r.capacity ? 'bad' : m > r.capacity * 0.8 ? 'warn' : 'good'}
                  text={`${h(m)} / ${h(r.capacity)}${m > r.capacity ? ' overloaded' : ''}`}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Goals() {
  const store = useStore()
  const plan = store.plan.value
  const text = store.planText.value
  return (
    <ul class="card-list">
      {plan.goals.map((g) => {
        const items = plan.items.filter((i) => i.goal === g.id)
        const done = items.filter((i) => i.status === 'published').length
        return (
          <li key={g.id} class="card">
            <h3>{text.goals[g.id]?.title ?? g.metric}</h3>
            <Meter label={sentence(g.metric)} value={g.current} max={g.target} tone={g.current >= g.target ? 'good' : 'info'} text={`${g.current} / ${g.target}`} />
            <p class="small muted">
              {items.length} work items · {done} published
            </p>
          </li>
        )
      })}
    </ul>
  )
}
