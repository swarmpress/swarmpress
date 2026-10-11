/**
 * Build gestures on the 3D canvas (ADR-0087): the pointer over the scene, through the renderer's
 * bridge (`build-bridge.ts`). While a gesture is active the bridge captures the pointer (a drag
 * places or moves instead of panning); a click selects; keys (R, Delete, Escape, arrows, Enter)
 * act only while focus is in the Build panel or on the canvas, never while typing.
 */
import { useEffect, useRef } from 'preact/hooks'
import { buildBridge, type BuildBridge } from '../../build-bridge'

export type Pick = NonNullable<ReturnType<BuildBridge['pick']>>

export interface CanvasHandlers {
  /** A gesture owns the pointer: hover is tracked and drags do not pan. */
  active: boolean
  onHover?(p: Pick | null): void
  /** A click (no drag) on the scene. */
  onClick?(p: Pick): void
  /** A press on the scene; true takes the drag (it ends in `onDragEnd`). */
  onPress?(p: Pick): boolean
  onDragEnd?(p: Pick | null): void
  /** A key on the canvas; true when handled. */
  onKey?(e: KeyboardEvent): boolean
}

/** Moves smaller than this many pixels between press and release are a click. */
const CLICK_PX = 5

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** The bridge, once the renderer has published it (null on pages without a scene, and in tests until set). */
export function useBridge(): BuildBridge | null {
  return buildBridge.value
}

/** Wire `h` to the bridge's canvas while mounted; capture follows `h.active`; cleans up the ghost, highlight and capture. */
export function useCanvas(bridge: BuildBridge | null, h: CanvasHandlers) {
  const ref = useRef(h)
  ref.current = h
  useEffect(() => {
    if (!bridge) return
    const canvas = bridge.canvas()
    let press: { x: number; y: number; drag: boolean } | null = null
    const pick = (e: PointerEvent) => bridge.pick(e.clientX, e.clientY)
    const move = (e: PointerEvent) => {
      if (!ref.current.active && !press?.drag) return
      ref.current.onHover?.(pick(e))
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const p = pick(e)
      const drag = !!p && !!ref.current.onPress?.(p)
      press = { x: e.clientX, y: e.clientY, drag }
    }
    const up = (e: PointerEvent) => {
      const was = press
      press = null
      if (!was) return
      const p = pick(e)
      if (was.drag) {
        ref.current.onDragEnd?.(p)
        return
      }
      if (p && Math.hypot(e.clientX - was.x, e.clientY - was.y) < CLICK_PX) ref.current.onClick?.(p)
    }
    const key = (e: KeyboardEvent) => {
      if (ref.current.onKey?.(e)) e.preventDefault()
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('keydown', key)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('keydown', key)
      bridge.ghost(null)
      bridge.highlight(null)
      bridge.setCapture(false)
    }
  }, [bridge])
  useEffect(() => {
    if (!bridge) return
    bridge.setCapture(h.active)
  }, [bridge, h.active])
}

/** A keydown in the panel goes to `onKey` unless it is typing, or Enter/Space on a control. */
export function panelKey(e: KeyboardEvent, onKey: (e: KeyboardEvent) => boolean) {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
  const t = e.target as HTMLElement | null
  if ((e.key === 'Enter' || e.key === ' ') && t && ['BUTTON', 'A'].includes(t.tagName)) return
  if (onKey(e)) {
    e.preventDefault()
    e.stopPropagation()
  }
}
