/**
 * The Paint shop (FEAT-104, ADR-0077; ADR-0082 §4): the site's palette as swatches the CEO repaints.
 * On WordPress the palette is the theme's (`theme.json`) with the user's global styles over it; the
 * CEO's build writes the user's global styles on a branch and merges it into live. The rest of the
 * Studio's grammar holds: nothing changes until "Build it".
 */
import { useMemo, useState } from 'preact/hooks'
import { useStore } from '../store'
import { Badge, Notice } from '../components/common'

export interface PaletteColor {
  slug: string
  name: string
  color: string
}

const HEX = /^#[0-9a-f]{6}$/i

export function PaintShop({ palette }: { palette: PaletteColor[] }) {
  const store = useStore()
  const [draft, setDraft] = useState<PaletteColor[]>(palette)
  const [saving, setSaving] = useState(false)
  const changed = useMemo(() => draft.filter((c, i) => c.color.toLowerCase() !== palette[i]?.color.toLowerCase()), [draft, palette])
  const bad = draft.filter((c) => !HEX.test(c.color))
  const canSave = !!store.source.savePalette
  if (!palette.length) return <p class="muted">The theme has no palette to paint.</p>
  const build = async () => {
    if (!store.source.savePalette) return
    setSaving(true)
    try {
      const head = await store.source.savePalette(draft)
      store.say(`Painted: ${changed.length} ${changed.length === 1 ? 'colour' : 'colours'} (commit ${head.slice(0, 7)})`, 'ok')
    } catch (e) {
      store.say(`The palette was not saved: ${String((e as Error)?.message ?? e)}`, 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div class="paint-shop">
      <p class="small muted">The theme's colours. Repaint a swatch, then build: the change is a commit on a branch, merged into live.</p>
      <ul class="swatches" aria-label="Palette">
        {draft.map((c, i) => (
          <li key={c.slug} class="swatch" data-changed={c.color.toLowerCase() !== palette[i]?.color.toLowerCase() ? 'true' : undefined}>
            <span class="swatch-chip" style={{ background: HEX.test(c.color) ? c.color : 'transparent' }} aria-hidden="true" />
            <label>
              <span class="swatch-name">{c.name}</span>
              <input
                type="color"
                value={HEX.test(c.color) ? c.color : '#000000'}
                disabled={!canSave}
                aria-label={`${c.name} colour`}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value
                  setDraft(draft.map((d, j) => (j === i ? { ...d, color: v } : d)))
                }}
              />
              <code class="small">{c.color}</code>
            </label>
          </li>
        ))}
      </ul>
      {bad.length > 0 && <Notice tone="warn" title="Some colours are not plain hex">They are kept as the theme has them.</Notice>}
      <div class="bar">
        {changed.length > 0 && <Badge tone="warn">{`${changed.length} repainted`}</Badge>}
        <button type="button" class="btn primary" disabled={!canSave || saving || changed.length === 0} onClick={() => void build()}>
          {saving ? 'Building…' : 'Build it'}
        </button>
        <button type="button" class="btn" disabled={changed.length === 0} onClick={() => setDraft(palette)}>
          Start over
        </button>
      </div>
    </div>
  )
}

/** Plugins as sets (ADR-0082 §4): a set outside the governed types is shown as such. */
export function PluginSets({ plugins }: { plugins: { plugin: string; name: string; status: string; governed: boolean }[] }) {
  if (!plugins.length) return <p class="small muted">No plugin sets: the site runs WordPress's own parts only.</p>
  return (
    <ul class="plugin-sets" aria-label="Plugin sets">
      {plugins.map((p) => (
        <li key={p.plugin}>
          <strong>{p.name}</strong> <span class="small muted">{p.status}</span> {p.governed ? <Badge tone="good">Governed</Badge> : <Badge tone="warn">Not governed</Badge>}
        </li>
      ))}
    </ul>
  )
}
