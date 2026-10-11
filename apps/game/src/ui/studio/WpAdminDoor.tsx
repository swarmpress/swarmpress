/**
 * The wp-admin door (ADR-0082 §5: a door, not the road): WordPress's admin on its own branch, for
 * what the Studio does not cover, in a visible frame on the sandbox's origin. The game answers the
 * door's storage messages, so every save in wp-admin is a commit on the door's branch attributed to
 * the CEO; "Build it" merges the branch into live, "Discard" drops it.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import type { GameDataSource } from '../data-source'
import { useStore } from '../store'
import { Badge } from '../components/common'

type Door = Awaited<ReturnType<NonNullable<GameDataSource['openDoor']>>>

export function WpAdminButton() {
  const store = useStore()
  const [door, setDoor] = useState<Door | null>(null)
  const [opening, setOpening] = useState(false)
  if (!store.source.openDoor) return null
  const open = async () => {
    setOpening(true)
    try {
      setDoor(await store.source.openDoor!())
    } catch (e) {
      store.say(`wp-admin could not open: ${String((e as Error)?.message ?? e)}`, 'error')
    } finally {
      setOpening(false)
    }
  }
  return (
    <>
      <button type="button" class="btn" disabled={opening} onClick={() => void open()}>
        {opening ? 'Opening…' : 'Open wp-admin on a branch'}
      </button>
      {door && <WpAdminDoor door={door} onClose={() => setDoor(null)} />}
    </>
  )
}

export function WpAdminDoor({ door, onClose }: { door: Door; onClose: () => void }) {
  const store = useStore()
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<'loading' | 'open' | 'building'>('loading')
  // The frame is rendered once the door's messages are listened for (it announces itself once).
  const [listening, setListening] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    const origin = new URL(door.url).origin
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin) return
      const type = (e.data as { type?: string })?.type
      if (type === 'swarmpress:door-loaded') {
        const { port1, port2 } = new MessageChannel()
        port1.onmessage = (m: MessageEvent<{ type: string; id: number; payload: string }>) => {
          if (m.data.type !== 'storage') return
          void door
            .storage(m.data.payload)
            .catch((err: unknown) => JSON.stringify({ error: `storage: ${String((err as Error)?.message ?? err)}` }))
            .then((reply) => port1.postMessage({ type: 'storage-reply', id: m.data.id, reply }))
        }
        frame.current!.contentWindow!.postMessage({ type: 'swarmpress:connect', config: {} }, origin, [port2])
      } else if (type === 'swarmpress:door-open') setState('open')
      else if (type === 'swarmpress:door-status') setNote(String((e.data as { message?: unknown }).message ?? ''))
    }
    window.addEventListener('message', onMessage)
    setListening(true)
    return () => window.removeEventListener('message', onMessage)
  }, [door])
  const build = async () => {
    setState('building')
    try {
      const head = await door.build()
      store.say(head ? `Built from wp-admin (commit ${head.slice(0, 7)})` : 'Nothing was changed in wp-admin', 'ok')
      onClose()
    } catch (e) {
      store.say(`wp-admin's changes were not built: ${String((e as Error)?.message ?? e)}`, 'error')
      setState('open')
    }
  }
  const discard = async () => {
    await door.discard().catch(() => undefined)
    onClose()
  }
  return (
    <div class="modal-backdrop">
      <div class="modal wp-admin-door" role="dialog" aria-modal="true" aria-label="wp-admin">
        <header class="preview-head">
          <div class="grow">
            <p class="preview-label">
              <Badge tone="warn">wp-admin on the branch {door.branch}</Badge>
            </p>
            <p class="small muted">What you change here is a commit on this branch. Build it to merge it into live, or discard it.</p>
          </div>
          <button type="button" class="btn primary" disabled={state !== 'open'} onClick={() => void build()}>
            {state === 'building' ? 'Building…' : 'Build it'}
          </button>
          <button type="button" class="btn" onClick={() => void discard()}>
            Discard
          </button>
        </header>
        {note && state !== 'open' && (
          <p class="small muted" role="status">
            {note}
          </p>
        )}
        {listening && <iframe ref={frame} class="wp-admin-frame" title="wp-admin" src={door.url} referrerpolicy="no-referrer" />}
      </div>
    </div>
  )
}
