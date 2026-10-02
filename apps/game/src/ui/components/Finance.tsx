import { eur, sentence } from '../format'
import { noCfoReason } from '../rules'
import { useStore } from '../store'
import { Meter, Notice, Panel, PersonButton } from './common'

const ALERT_TEXT: Record<string, string> = {
  'runway-low': 'Runway under 30 days',
  'budget-overrun': 'Over budget by more than 10%',
  'payroll-jump': 'Payroll up more than 15% from a single hire',
  'cash-negative': 'Cash below zero: loan offer pending',
}

/** The CFO's books (organization.md §6). Without a CFO: an explicit "books not reviewed" state. */
export function Finance() {
  const store = useStore()
  const f = store.finance.value
  const org = store.org.value
  const cfo = org.executive.cfo
  const booksKept = !!cfo && f.booksKept !== false
  const c = f.company
  const costs = c.salariesEur + c.rentEur + c.upkeepEur + c.agencyEur
  const net = c.revenueEur - costs

  return (
    <Panel id="finance" title="Finance">
      <div class="cfo-line">
        {cfo ? <PersonButton staff={cfo} detail="Chief Financial Officer" /> : <span class="muted">No CFO employed</span>}
      </div>
      {!booksKept && (
        <Notice tone="bad" title="No CFO — books not reviewed">
          {noCfoReason} The numbers below are the raw ledger; nobody is watching budgets or runway. Hire a CFO from the Hiring panel.
        </Notice>
      )}

      <dl class="kpis">
        <div>
          <dt>Cash</dt>
          <dd class={f.cashEur < 0 ? 'bad-text' : ''}>{eur(f.cashEur)}</dd>
        </div>
        <div>
          <dt>Runway</dt>
          <dd class={booksKept && f.runwayDays != null && f.runwayDays < 30 ? 'bad-text' : ''}>
            {booksKept ? (f.runwayDays == null ? '—' : `${f.runwayDays} days`) : 'Not reviewed'}
          </dd>
        </div>
        <div>
          <dt>Daily burn</dt>
          <dd>{eur(f.dailyBurnEur)}</dd>
        </div>
        <div>
          <dt>Month</dt>
          <dd>{f.month}</dd>
        </div>
      </dl>

      {booksKept && f.alerts.length > 0 && (
        <section aria-labelledby="alerts-title">
          <h3 id="alerts-title">Alerts</h3>
          <ul class="alert-list">
            {f.alerts.map((a, i) => (
              <li key={i} class="alert-item">
                <strong>{ALERT_TEXT[a.kind] ?? sentence(a.kind)}</strong>
                {a.project && <> · {store.projectName(a.project)}</>}
                {a.ticket && (
                  <button type="button" class="link-btn" onClick={() => (store.panel.value = 'inbox')}>
                    {' '}
                    Open {a.ticket} in the Inbox
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="pnl-title">
        <h3 id="pnl-title">Month {f.month} P&amp;L (company)</h3>
        <table class="table">
          <caption class="sr-only">Company profit and loss for month {f.month}</caption>
          <tbody>
            <tr>
              <th scope="row">Revenue</th>
              <td class="num">{eur(c.revenueEur)}</td>
            </tr>
            <tr>
              <th scope="row">Salaries</th>
              <td class="num">−{eur(c.salariesEur)}</td>
            </tr>
            <tr>
              <th scope="row">Rent</th>
              <td class="num">−{eur(c.rentEur)}</td>
            </tr>
            <tr>
              <th scope="row">Upkeep</th>
              <td class="num">−{eur(c.upkeepEur)}</td>
            </tr>
            <tr>
              <th scope="row">Agency fees</th>
              <td class="num">−{eur(c.agencyEur)}</td>
            </tr>
            <tr class="total">
              <th scope="row">Net</th>
              <td class={`num ${net < 0 ? 'bad-text' : 'good-text'}`}>{eur(net)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="proj-fin-title">
        <h3 id="proj-fin-title">Projects</h3>
        <table class="table">
          <caption class="sr-only">Budget, spend and revenue per project this month</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col" class="num">
                Budget
              </th>
              <th scope="col" class="num">
                Spent
              </th>
              <th scope="col" class="num">
                Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {f.projects.map((p) => (
              <tr key={p.id}>
                <th scope="row">{store.projectName(p.id)}</th>
                <td class="num">{eur(p.budgetEurMonth)}</td>
                <td class={`num${p.overBudget ? ' bad-text' : ''}`}>{eur(p.spentEurMonth)}</td>
                <td class="num">{eur(p.revenueEurMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="budget-bars">
          {f.projects.map((p) => (
            <Meter
              key={p.id}
              label={store.projectName(p.id)}
              value={p.spentEurMonth}
              max={Math.max(p.budgetEurMonth, 1)}
              tone={p.overBudget ? 'bad' : p.spentEurMonth > p.budgetEurMonth * 0.85 ? 'warn' : 'good'}
              text={`${p.budgetEurMonth ? Math.round((p.spentEurMonth / p.budgetEurMonth) * 100) : 0}% of budget`}
            />
          ))}
        </div>
      </section>

      {booksKept && f.report && (
        <section aria-labelledby="cfo-report-title" class="report">
          <h3 id="cfo-report-title">CFO report</h3>
          <blockquote>{f.report}</blockquote>
        </section>
      )}
    </Panel>
  )
}
