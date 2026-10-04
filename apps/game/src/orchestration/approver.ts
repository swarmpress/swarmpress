/**
 * Who approved a publish (G6, ADR-0059): the `Approved-by` of the squash
 * commit. The sim knows only that the CEO answered the `PublishApproval`
 * ticket of a work item with `Publish` (`resolvedBy: 'ceo'`); it carries no
 * names (CLAUDE.md rule 2). The host knows who the CEO is: the signed-in
 * player. At job time the publish job's request gets `approved_by` from both;
 * nothing enters the sim or its command log.
 */
import type { OrchestratorLike } from '../orchestrator/bridge'

/** The part of `Sim.inbox_json()` read here. */
interface InboxTicket {
  kind: string
  workItem: string | null
  answer: string | null
  resolvedBy: string | null
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[_-]/g, '')

/**
 * `"<name> (CEO)"` when the newest `PublishApproval` ticket of `workItem`
 * was answered `Publish` by the CEO; null otherwise (an autonomous policy
 * published without asking, or the ticket is gone).
 */
export function approverOf(inboxJson: string, workItem: string, ceoName: string): string | null {
  const tickets = (JSON.parse(inboxJson) as { tickets?: InboxTicket[] }).tickets ?? []
  const approved = tickets.filter(
    (t) => norm(t.kind) === 'publishapproval' && t.workItem === workItem && norm(t.answer) === 'publish' && t.resolvedBy === 'ceo',
  )
  if (!approved.length) return null
  return `${personName(ceoName)} (CEO)`
}

/** One line, no `<`/`>` (they delimit a git identity), at most 90 characters: what the gateway accepts. */
export function personName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (clean || 'the CEO').slice(0, 90)
}

/** The orchestrator with `approved_by` added to every publish job's request at run time. */
export function withApprover<T extends OrchestratorLike>(inner: T, o: { inboxJson: () => string; ceoName: () => string }): OrchestratorLike {
  return {
    async run(jobJson: string) {
      // `brief_ref` crosses as a string, so the parse is exact.
      const job = JSON.parse(jobJson) as { kind?: string; work_item?: string | null; approved_by?: string | null }
      if (job.kind === 'publish' && job.work_item && !job.approved_by) {
        const by = approverOf(o.inboxJson(), job.work_item, o.ceoName())
        if (by) return inner.run(JSON.stringify({ ...job, approved_by: by }))
      }
      return inner.run(jobJson)
    },
    cancel: (reason) => inner.cancel?.(reason),
  }
}
