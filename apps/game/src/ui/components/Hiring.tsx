import { cmd } from '../commands'
import { eur, sentence, titleCase } from '../format'
import type { Persona } from '../personas'
import { useStore } from '../store'
import type { CandidateJson } from '../types'
import { Avatar, Badge, Notice, Panel } from './common'

export interface CandidateView {
  candidate: CandidateJson
  persona: Persona
}

/** The pool from org_json when the sim provides it, otherwise catalog personas with ids ≥ 100 not yet employed. */
export function useCandidates(): CandidateView[] {
  const store = useStore()
  const org = store.org.value
  const employed = new Set(org.staff.map((s) => s.persona))
  const fromOrg = org.candidates
  const list: CandidateJson[] =
    fromOrg ??
    store.source
      .listPersonas()
      .filter((p) => p.candidate && !employed.has(p.slug))
      .map((p) => ({ id: `candidate-${p.id}`, persona: p.slug, askingEurMonth: p.salaryEurMonth, affordability: null }))
  return list.flatMap((c) => {
    const persona = store.source.getPersona(c.persona)
    return persona ? [{ candidate: c, persona }] : []
  })
}

export function Hiring() {
  const store = useStore()
  const candidates = useCandidates()
  const hasCfo = !!store.org.value.executive.cfo
  return (
    <Panel id="hiring" title="Hiring">
      {!hasCfo && <Notice tone="warn" title="No CFO: hires are not checked for affordability" />}
      {candidates.length === 0 ? (
        <p class="muted">The pool is empty. Ask the secretary to arrange hiring for a role.</p>
      ) : (
        <ul class="card-grid" aria-label="Candidates">
          {candidates.map(({ candidate: c, persona: p }) => {
            const v = store.check(cmd.hire(c.id))
            return (
              <li key={c.id} class="card candidate">
                <div class="card-row">
                  <Avatar persona={p} size={44} />
                  <div class="grow">
                    <h3>{p.name}</h3>
                    <p class="small muted">
                      {p.title} · {titleCase(p.department)}
                    </p>
                  </div>
                </div>
                <p class="small">{p.pitch}</p>
                <p class="profile-tags">
                  <Badge tone="info">{sentence(p.seniority)}</Badge>
                  <Badge>asks {eur(c.askingEurMonth)}/month</Badge>
                </p>
                {p.cv.skills.length > 0 && (
                  <ul class="chips" aria-label={`${p.name}'s skills`}>
                    {p.cv.skills.slice(0, 4).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
                {hasCfo && c.affordability && <p class="small cfo-note">CFO: {c.affordability}</p>}
                <div class="actions-row">
                  <button type="button" class="btn btn-quiet" onClick={(e) => store.openProfile({ persona: p.slug }, e.currentTarget)}>
                    Profile<span class="sr-only"> of {p.name}</span>
                  </button>
                  <button type="button" class="btn" disabled={!v.ok} title={v.reason} onClick={() => store.run(cmd.hire(c.id), `${p.name} hired`)}>
                    Hire<span class="sr-only"> {p.name}</span>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
