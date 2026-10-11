/**
 * What the CEO approves at a `BuildApproval` ticket (FEAT-084, ADR-0087 decision 6; construction-kit
 * §7.2): the office designer's room plan from the store (text, rule 2): the room, the summary, the
 * cost, the items by name and count, the warnings, and a preview that shows the whole plan as
 * green ghosts in the room. The answer is the ticket's own options (Build, Defer, Decline), sent
 * by the Inbox like every other answer; nothing here builds (rule 3).
 */
import { useEffect, useState } from 'preact/hooks'
import { buildBridge } from '../../build-bridge'
import { eur } from '../format'
import { useStore } from '../store'
import { itemCounts, planGhosts } from '../build/interior'
import { Badge } from './common'

export function BuildApprovalPlan({ item, room: ticketRoom, open }: { item: string; room?: string | null; open: boolean }) {
  const store = useStore()
  const bridge = buildBridge.value
  const [previewing, setPreviewing] = useState(false)
  const plan = store.roomPlanOf(item)
  const roomId = plan?.room ?? ticketRoom ?? null
  const room = roomId ? store.layout.value?.rooms.find((r) => r.id === roomId) : undefined

  // The preview goes when the ticket closes or the view goes (on whichever bridge the scene has then).
  useEffect(() => {
    if (!open && previewing) setPreviewing(false)
  }, [open, previewing])
  useEffect(() => {
    if (!previewing) return
    return () => buildBridge.peek()?.ghostPlan(null)
  }, [previewing])

  if (!store.hasRoomPlans) {
    return <p class="small warn-text">This game cannot show the office designer’s plan yet, so its rooms and items cannot be shown here.</p>
  }
  if (plan === undefined) {
    return (
      <p class="small muted" role="status">
        Reading the office designer’s plan…
      </p>
    )
  }
  if (plan === null) {
    return <p class="small warn-text">The plan is not in this device’s store (plan text is not synced between devices yet), so its items cannot be shown here.</p>
  }

  const counts = itemCounts(plan)
  const errors = plan.issues.filter((i) => i.severity === 'error')
  const warnings = plan.issues.filter((i) => i.severity === 'warning')
  const roomName = room ? `${room.label} (${room.w} × ${room.d} m)` : (roomId ?? 'an unknown room')
  const toggle = () => {
    const b = buildBridge.peek()
    if (!b) return
    if (previewing) {
      b.ghostPlan(null)
      setPreviewing(false)
      return
    }
    if (roomId) b.focus({ room: roomId })
    b.ghostPlan(planGhosts(plan))
    setPreviewing(true)
  }
  return (
    <section class="build-approval" aria-label="The office designer’s plan">
      <p class="build-approval-room">
        For <strong>{roomName}</strong>
      </p>
      {plan.summary && <p class="ticket-summary">{plan.summary}</p>}
      <p class="small build-approval-facts">
        <strong>{eur(plan.cost_cents / 100)}</strong> · {plan.items.length} {plan.items.length === 1 ? 'item' : 'items'} · {plan.parts} {plan.parts === 1 ? 'part' : 'parts'}
      </p>
      <ul class="build-approval-items" aria-label="Items in the plan">
        {counts.map((c) => (
          <li key={c.design}>
            <span class="build-approval-count">{c.count} ×</span> {c.name}
          </li>
        ))}
      </ul>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul class="build-approval-issues" aria-label="What the check found">
          {[...errors, ...warnings].map((i) => (
            <li key={i.id}>
              <Badge tone={i.severity === 'error' ? 'bad' : 'warn'}>{i.severity === 'error' ? 'Error' : 'Warning'}</Badge> {i.message}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div class="build-row">
          <button type="button" class="btn" aria-pressed={previewing} disabled={!bridge} onClick={toggle}>
            {previewing ? 'Hide the preview' : 'Preview in the room'}
          </button>
          {!bridge && <span class="small muted">The scene is not up, so there is nothing to preview in.</span>}
        </div>
      )}
    </section>
  )
}
