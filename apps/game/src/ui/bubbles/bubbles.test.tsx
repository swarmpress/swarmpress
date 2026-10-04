// @vitest-environment jsdom
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { BubbleLayer, bubblesOf, type BubbleSource, type BubbleView } from './BubbleLayer'
import { BUBBLE_GAP, BUBBLE_MARGIN, overlaps, placeBubble, typed, typedLength, type Rect } from './layout'

const VIEW = { w: 1280, h: 800 }
const SIZE = { w: 200, h: 48 }
const label = (x: number, y: number, w = 90, h = 16): Rect => ({ left: x - w / 2, top: y - h, right: x + w / 2, bottom: y })

describe('bubble placement (FEAT-025)', () => {
  it('hangs above the speaker’s label, centred, touching nothing', () => {
    const own = label(640, 400)
    const r = placeBubble({ x: 640, y: 404, label: own }, SIZE, [own], VIEW)!
    expect(r).toEqual({ left: 540, top: 400 - 16 - BUBBLE_GAP - 48, right: 740, bottom: 400 - 16 - BUBBLE_GAP })
    expect(overlaps(r, own)).toBe(false)
  })

  it('rises over a label in the way, and stays clear of the HUD and the edges', () => {
    const own = label(640, 400)
    const other = label(660, 370)
    const hud: Rect = { left: 0, top: 0, right: 700, bottom: 60 }
    const r = placeBubble({ x: 640, y: 404, label: own }, SIZE, [own, other, hud], VIEW)!
    for (const o of [own, other, hud]) expect(overlaps(r, o, BUBBLE_GAP - 0.01)).toBe(false)
    expect(r.bottom).toBeLessThanOrEqual(other.top - BUBBLE_GAP)
    // At the left edge it is pushed in.
    const edge = placeBubble({ x: 10, y: 404, label: null }, SIZE, [], VIEW)!
    expect(edge.left).toBe(BUBBLE_MARGIN)
  })

  it('goes below the speaker when the HUD covers the space above, and is not shown when nothing is free', () => {
    const own = label(640, 120)
    const hud: Rect = { left: 0, top: 0, right: 1280, bottom: 90 }
    const r = placeBubble({ x: 640, y: 124, label: own }, SIZE, [own, hud], VIEW)!
    expect(r.top).toBeGreaterThanOrEqual(own.bottom + BUBBLE_GAP)
    expect(overlaps(r, hud)).toBe(false)
    const wall: Rect = { left: 0, top: 0, right: 1280, bottom: 800 }
    expect(placeBubble({ x: 640, y: 124, label: own }, SIZE, [wall], VIEW)).toBeNull()
  })

  it('never overlaps for eight speakers at once', () => {
    const placed: Rect[] = []
    const labels = Array.from({ length: 8 }, (_, i) => label(300 + i * 60, 500 + (i % 2) * 10))
    for (let i = 0; i < 8; i++) {
      const r = placeBubble({ x: 300 + i * 60, y: 504, label: labels[i] }, SIZE, [...labels, ...placed], VIEW)
      expect(r).not.toBeNull()
      placed.push(r!)
    }
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) expect(overlaps(placed[a], placed[b])).toBe(false)
    for (const r of placed) for (const l of labels) expect(overlaps(r, l)).toBe(false)
  })

  it('types the line over three quarters of the turn, by code point', () => {
    expect(typedLength(90, 0, 6000)).toBe(1)
    expect(typedLength(90, 2250, 6000)).toBe(45)
    expect(typedLength(90, 4500, 6000)).toBe(90)
    expect(typedLength(90, 9000, 6000)).toBe(90)
    expect(typed('Sciacchetrà «sì»', 100_000, 1000)).toBe('Sciacchetrà «sì»')
    expect(typed('àé', 1, 1000)).toBe('à')
  })

  it('shows only turns of meetings in session, with their job', () => {
    const state = {
      bubbles: [
        { meeting: 'meeting-1', seq: 2, speaker: 'staff-1', startedStep: 1, untilStep: 9, chars: 40 },
        { meeting: 'meeting-2', seq: 0, speaker: 'staff-3', startedStep: 1, untilStep: 9, chars: 40 },
      ],
      meetings: [
        { id: 'meeting-1', active: true, job: 7 },
        { id: 'meeting-2', active: false, job: null },
      ],
    } as unknown as Parameters<typeof bubblesOf>[0]
    expect(bubblesOf(state)).toEqual([{ meeting: 'meeting-1', seq: 2, speaker: 'staff-1', job: 7, chars: 40 }])
    expect(bubblesOf(null)).toEqual([])
  })
})

describe('BubbleLayer (FEAT-025)', () => {
  let root: HTMLElement | null = null
  afterEach(() => {
    if (root) render(null, root)
    root?.remove()
  })

  function harness(texts: Record<string, string>) {
    let now = 0
    let frame: (() => void) | null = null
    const s = { current: [] as BubbleView[] }
    const source: BubbleSource = {
      current: () => s.current,
      text: async (b) => texts[`${b.meeting}:${b.seq}`] ?? null,
      name: (id) => ({ 'staff-1': 'Giulia' })[id],
      // A fake projection: everyone's head at (400, 300), the label just above it.
      anchor: () => ({ x: 400, y: 300, label: { left: 355, top: 280, right: 445, bottom: 296 } }),
      obstacles: () => [{ left: 355, top: 280, right: 445, bottom: 296 }],
      view: () => VIEW,
      durationMs: () => 4000,
      now: () => now,
      measure: () => ({ w: 200, h: 40 }),
      schedule: (f) => {
        frame = f
        return () => (frame = null)
      },
    }
    root = document.createElement('div')
    document.body.append(root)
    act(() => render(<BubbleLayer source={source} />, root!))
    const step = async (ms: number) => {
      now += ms
      await act(async () => {
        await Promise.resolve()
        frame?.()
      })
    }
    return { s, step, el: () => root!.querySelector<HTMLElement>('.speech-bubble') }
  }

  it('shows the speaker’s words above their label, typed over the turn, and removes them when the turn ends', async () => {
    const h = harness({ 'meeting-1:1': 'The Sciacchetrà harvest starts Monday; I want to be on the terraces.' })
    h.s.current = [{ meeting: 'meeting-1', seq: 1, speaker: 'staff-1', job: 3, chars: 69 }]
    await h.step(0)
    await h.step(0)
    const el = h.el()!
    expect(el.dataset.speaker).toBe('staff-1')
    expect(el.querySelector('.speech-bubble-name')!.textContent).toBe('Giulia')
    expect(el.querySelector('.speech-bubble-full')!.textContent).toBe('The Sciacchetrà harvest starts Monday; I want to be on the terraces.')
    // Placed above the label: 280 - gap - 40.
    expect(el.style.transform).toBe(`translate(300px, ${280 - BUBBLE_GAP - 40}px)`)
    expect(el.style.visibility).toBe('visible')
    const typedText = () => el.querySelector('.speech-bubble-typed')!.textContent!
    expect(typedText().length).toBeLessThan(5)
    await h.step(1500)
    const line = [...'The Sciacchetrà harvest starts Monday; I want to be on the terraces.']
    expect([...typedText()].length).toBe(Math.ceil((line.length * 1500) / 3000))
    await h.step(1500)
    expect(typedText()).toBe('The Sciacchetrà harvest starts Monday; I want to be on the terraces.')
    // The meeting ends: the bubble goes.
    h.s.current = []
    await h.step(16)
    expect(h.el()).toBeNull()
  })

  it('renders model output as text, never as markup', async () => {
    const h = harness({ 'meeting-1:0': '<img src=x onerror="alert(1)"><b>bold</b> & co' })
    h.s.current = [{ meeting: 'meeting-1', seq: 0, speaker: 'staff-4', job: 3, chars: 46 }]
    await h.step(0)
    await h.step(0)
    await h.step(10_000)
    const el = h.el()!
    expect(el.querySelector('img, b')).toBeNull()
    expect(el.querySelector('.speech-bubble-typed')!.textContent).toBe('<img src=x onerror="alert(1)"><b>bold</b> & co')
  })

  it('shows nothing for a turn without words in the store', async () => {
    const h = harness({})
    h.s.current = [{ meeting: 'meeting-1', seq: 5, speaker: 'staff-1', job: 3, chars: 10 }]
    await h.step(0)
    await h.step(0)
    expect(h.el()).toBeNull()
  })
})
