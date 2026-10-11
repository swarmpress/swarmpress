/**
 * Build mode's small parts: the sim's verdict on a pending action (its price and, when refused,
 * its reason), an action button that the sim's verdict enables, and a catalogue tile (a 2 × 2
 * brick in the kit design's colour, the name, the price).
 */
import type { ComponentChildren } from 'preact'
import { hexOf } from '../../blueprint/colours'
import type { Command, CommandResult } from '../commands'
import { PENDING, useStore } from '../store'
import { BrickIcon } from '../studio/bricks'
import { priceText, type BuildCommand } from './types'

/** The build commands go through the store like every command (the sim agent adds them to `Command`). */
export const asCommand = (c: BuildCommand) => c as unknown as Command

/** The sim's verdict and price of a command, for rendering. */
export function useVerdict(c: BuildCommand | null): { r: CommandResult; price: number | null | undefined } {
  const store = useStore()
  if (!c) return { r: { ok: false, reason: 'Nothing to place yet' }, price: null }
  return { r: store.check(asCommand(c)), price: store.price(asCommand(c)) }
}

/** What the sim says about the pending action: its price when accepted, its reason when refused. */
export function Verdict({ r, price, what, id }: { r: CommandResult; price: number | null | undefined; what: string; id?: string }) {
  const p = priceText(price)
  const pending = r === PENDING
  return (
    <p id={id} class={`build-verdict${pending ? ' is-pending' : r.ok ? ' is-ok' : ' is-bad'}`} role="status">
      {pending ? (
        'Checking with the sim…'
      ) : r.ok ? (
        <>
          <span class="build-verdict-dot" aria-hidden="true" />
          {what}: the sim accepts{p ? ` · ${p}` : ''}
        </>
      ) : (
        <>
          <span class="build-verdict-dot" aria-hidden="true" />
          {what}: refused, {r.reason ?? 'the sim refuses'}
        </>
      )}
    </p>
  )
}

/**
 * A button for one command: enabled only when the sim accepts it; the reason (or the price) is
 * shown under it and read with it. `onDone` follows a successful run.
 */
export function CommandButton({
  cmd,
  label,
  success,
  tone,
  onDone,
  idBase,
}: {
  cmd: BuildCommand
  label: string
  success: string
  tone?: 'danger'
  onDone?: () => void
  idBase: string
}) {
  const store = useStore()
  const { r, price } = useVerdict(cmd)
  const note = `${idBase}-note`
  const p = priceText(price)
  return (
    <div class="build-action">
      <button
        type="button"
        class={`btn${tone === 'danger' ? ' btn-danger-quiet' : ''}`}
        disabled={!r.ok}
        aria-describedby={note}
        onClick={async () => {
          if (!r.ok) return
          const out = await store.run(asCommand(cmd), success)
          if (out.ok) onDone?.()
        }}
      >
        {label}
      </button>
      <span id={note} class={`build-action-note${r.ok ? '' : ' is-bad'}`}>
        {r === PENDING ? 'Checking…' : r.ok ? (p ?? '') : r.reason}
      </span>
    </div>
  )
}

/** A catalogue tile: the 2 × 2 brick, the name, the price. */
export function BrickTile({
  colour,
  name,
  price,
  pressed,
  onClick,
  note,
}: {
  colour: string
  name: string
  price: number | null | undefined
  pressed: boolean
  onClick: () => void
  note?: ComponentChildren
}) {
  const p = priceText(price)
  return (
    <button type="button" class={`build-tile${pressed ? ' is-active' : ''}`} aria-pressed={pressed} onClick={onClick}>
      <BrickIcon colour={hexOf(colour)} size={44} />
      <span class="build-tile-name">{name}</span>
      {p && <span class="build-tile-price"> {p}</span>}
      {note && <span class="build-tile-note"> {note}</span>}
    </button>
  )
}
