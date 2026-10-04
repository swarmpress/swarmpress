import { describe, expect, it } from 'vitest'
import { approverOf, personName, withApprover } from './approver'

const ticket = (o: Partial<{ kind: string; workItem: string | null; answer: string | null; resolvedBy: string | null }>) => ({
  kind: 'publish-approval',
  workItem: 'work-item-1',
  answer: 'publish',
  resolvedBy: 'ceo',
  ...o,
})
const inbox = (...tickets: unknown[]) => JSON.stringify({ tickets })

describe('the approver of a publish (G6)', () => {
  it('is the CEO who answered the item’s PublishApproval ticket with Publish', () => {
    expect(approverOf(inbox(ticket({})), 'work-item-1', 'Daniel')).toBe('Daniel (CEO)')
    // the sim's other spellings of the kind
    expect(approverOf(inbox(ticket({ kind: 'PublishApproval' })), 'work-item-1', 'Daniel')).toBe('Daniel (CEO)')
    // not answered, sent back, another item, another kind, not the CEO: nobody approved
    for (const t of [
      ticket({ answer: null, resolvedBy: null }),
      ticket({ answer: 'send-back' }),
      ticket({ workItem: 'work-item-2' }),
      ticket({ kind: 'escalation', answer: 'retry' }),
      ticket({ resolvedBy: 'default' }),
    ]) {
      expect(approverOf(inbox(t), 'work-item-1', 'Daniel')).toBeNull()
    }
    expect(approverOf(inbox(), 'work-item-1', 'Daniel')).toBeNull()
  })

  it('is a name the gateway accepts', () => {
    expect(personName('Ada <ada@x>\nApproved-by: nobody')).toBe('Ada ada@x Approved-by: nobody')
    expect(personName('  ')).toBe('the CEO')
    expect(personName('x'.repeat(200))).toHaveLength(90)
  })

  it('goes into the publish job’s request at run time, and only there', async () => {
    const seen: string[] = []
    const cancels: unknown[] = []
    const inner = {
      run: async (j: string) => (seen.push(j), '[]'),
      cancel: (r?: string) => cancels.push(r),
    }
    let tickets = inbox()
    const orch = withApprover(inner, { inboxJson: () => tickets, ceoName: () => 'mvp-ceo' })
    const publish = { company_id: 'c', job_id: 9, kind: 'publish', work_item: 'work-item-1', brief_ref: '18446744073709551615', revision: 1, staff: [] }
    await orch.run(JSON.stringify(publish))
    tickets = inbox(ticket({}))
    await orch.run(JSON.stringify(publish))
    await orch.run(JSON.stringify({ ...publish, kind: 'draft' }))
    expect(JSON.parse(seen[0]).approved_by).toBeUndefined()
    expect(JSON.parse(seen[1])).toEqual({ ...publish, approved_by: 'mvp-ceo (CEO)' })
    expect(JSON.parse(seen[1]).brief_ref).toBe('18446744073709551615')
    expect(JSON.parse(seen[2]).approved_by).toBeUndefined()
    orch.cancel?.('timeout')
    expect(cancels).toEqual(['timeout'])
  })
})
