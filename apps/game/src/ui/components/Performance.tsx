import { useState } from 'preact/hooks'
import { num, pct, sentence } from '../format'
import { useStore } from '../store'
import type { KpiWindow } from '../types'
import { Meter, Notice, Panel, PersonButton, Tabs } from './common'

/** Minimal inline-SVG sparkline (no chart library). */
export function Sparkline({ values, label, width = 120, height = 32 }: { values: number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
  const last = pts[pts.length - 1].split(',')
  return (
    <svg class="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill="currentColor" />
    </svg>
  )
}

const METRICS: Array<{ key: keyof KpiWindow; label: string; rate?: boolean; series?: 'sessions' | 'visitors' | 'pageviews' | 'engagementRate' }> = [
  { key: 'sessions', label: 'Sessions', series: 'sessions' },
  { key: 'visitors', label: 'Visitors', series: 'visitors' },
  { key: 'pageviews', label: 'Pageviews', series: 'pageviews' },
  { key: 'engagementRate', label: 'Engagement rate', rate: true, series: 'engagementRate' },
  { key: 'scrollDepth', label: 'Scroll depth', rate: true },
  { key: 'outboundClicks', label: 'Outbound clicks' },
]

const GOAL_UNITS: Record<string, (n: number) => string> = {
  monthly_readers: (n) => num(n),
  quality_avg: (n) => n.toFixed(1),
  healthy_links_pct: (n) => `${n}%`,
}

/** KPIs from the project's own first-party tracker and the data scientist's report (organization.md §6a). */
export function Performance() {
  const store = useStore()
  const org = store.org.value
  const perf = store.performance.value
  const projects = org.projects
  const [project, setProject] = useState(projects[0]?.id ?? '')
  const [range, setRange] = useState<'7' | '30'>('7')
  const scientist = org.staff.find((s) => s.role === 'data-scientist')
  const pp = perf.projects.find((p) => p.project === project)
  const orgAnalytics = projects.find((p) => p.id === project)?.analytics
  const connected = (orgAnalytics?.connected ?? pp?.connected ?? false) && !!pp?.connected && !!pp.last7
  const win = range === '7' ? pp?.last7 : pp?.last30
  const n = range === '7' ? 7 : 30
  const goals = store.plan.value.goals
  const goalText = store.planText.value.goals
  const report = scientist ? perf.report : null

  return (
    <Panel id="performance" title="Performance" wide>
      <div class="toolbar-row">
        <label class="field-inline">
          <span>Project</span>
          <select value={project} onChange={(e) => setProject(e.currentTarget.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Tabs
          label="Range"
          idPrefix="perf-range"
          tabs={[
            { id: '7', label: 'Last 7 days' },
            { id: '30', label: 'Last 30 days' },
          ]}
          value={range}
          onChange={setRange}
        />
        {scientist && <PersonButton staff={scientist.id} detail="Data Scientist" />}
      </div>

      <div role="tabpanel" id="perf-range-tabpanel" aria-labelledby={`perf-range-tab-${range}`}>
        {!scientist && (
          <Notice tone="warn" title="No data scientist — KPIs not reported">
            Raw tracker numbers only: no weekly KPI report, no follow-ups on published items, goals tied to analytics are not measured.
          </Notice>
        )}

        {!connected ? (
          <Notice tone="info" title="Tracker: no data yet">
            The site's own tracker hasn't reported any visits for {store.projectName(project)}. Numbers appear after the first nightly sync.
          </Notice>
        ) : (
          win &&
          pp && (
            <>
              <ul class="kpi-tiles" aria-label={`Key metrics, last ${n} days`}>
                {METRICS.map((m) => {
                  const v = win[m.key]
                  const prev = range === '7' ? pp.prev7?.[m.key] : undefined
                  const delta = prev ? (v - prev) / prev : null
                  const series = m.series && pp.daily ? pp.daily[m.series].slice(-n) : null
                  return (
                    <li key={m.key} class="kpi-tile">
                      <span class="kpi-label">{m.label}</span>
                      <span class="kpi-value">{m.rate ? pct(v) : num(v)}</span>
                      {delta != null && (
                        <span class={`kpi-delta ${delta >= 0 ? 'good-text' : 'bad-text'}`}>
                          {delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))} vs prior week
                        </span>
                      )}
                      {series && <Sparkline values={series} label={`${m.label}, daily, last ${n} days: from ${num(series[0] * (m.rate ? 100 : 1))} to ${num(series[series.length - 1] * (m.rate ? 100 : 1))}${m.rate ? '%' : ''}`} />}
                    </li>
                  )
                })}
              </ul>

              <div class="two-col">
                <section aria-labelledby="top-pages">
                  <h3 id="top-pages">Top pages</h3>
                  <PageTable pages={pp.topPages ?? []} caption="Top pages by views" />
                </section>
                <section aria-labelledby="bottom-pages">
                  <h3 id="bottom-pages">Bottom pages</h3>
                  <PageTable pages={pp.bottomPages ?? []} caption="Bottom pages by views" />
                </section>
                <section aria-labelledby="langs">
                  <h3 id="langs">Languages</h3>
                  {(pp.languages ?? []).map((l) => (
                    <Meter key={l.lang} label={l.lang.toUpperCase()} value={l.share} text={pct(l.share)} />
                  ))}
                </section>
                <section aria-labelledby="sources">
                  <h3 id="sources">Traffic sources</h3>
                  {(pp.sources ?? []).map((s) => (
                    <Meter key={s.source} label={s.source} value={s.share} text={pct(s.share)} />
                  ))}
                </section>
              </div>
            </>
          )
        )}

        {goals.length > 0 && (
          <section aria-labelledby="goals-title">
            <h3 id="goals-title">Goals</h3>
            {goals.map((g) => {
              const fmt = GOAL_UNITS[g.metric] ?? ((x: number) => num(x))
              const measured = g.metric !== 'monthly_readers' || (scientist && connected)
              return (
                <Meter
                  key={g.id}
                  label={goalText[g.id]?.title ?? sentence(g.metric)}
                  value={measured ? g.current : 0}
                  max={g.target}
                  tone={g.current >= g.target ? 'good' : 'info'}
                  text={measured ? `${fmt(g.current)} / ${fmt(g.target)}` : 'Not measured'}
                />
              )
            })}
          </section>
        )}

        {report && (
          <section aria-labelledby="kpi-report" class="report">
            <h3 id="kpi-report">
              KPI report · week {report.week} <span class="muted small">by {store.nameOf(report.author)}</span>
            </h3>
            <p class="report-headline">{report.headline}</p>
            <h4>Observations</h4>
            <ul>
              {report.observations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <h4>Recommendations</h4>
            <ol>
              {report.recommendations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </Panel>
  )
}

function PageTable({ pages, caption }: { pages: Array<{ path: string; views: number; engagementRate: number }>; caption: string }) {
  return (
    <table class="table">
      <caption class="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Page</th>
          <th scope="col" class="num">
            Views
          </th>
          <th scope="col" class="num">
            Engaged
          </th>
        </tr>
      </thead>
      <tbody>
        {pages.map((p) => (
          <tr key={p.path}>
            <td class="path">{p.path}</td>
            <td class="num">{num(p.views)}</td>
            <td class="num">{pct(p.engagementRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
