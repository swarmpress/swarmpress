/**
 * `?office=bricks` (FEAT-081 spike): the entry `main.ts` and the bench
 * harness import lazily, so the default bundle carries none of it.
 */
import type { BuildingLayout, RenderState } from '../../state/render-state'
import type { GameScene } from '../scene'
import { loadKit } from './kit'
import { buildBrickOffice, type BrickOffice, type BrickOfficeOptions, type SurfaceSources } from './office'
import { boardCards, type PlanItemLike } from './surfaces'

export type { BrickOffice, BrickOfficeStats, SurfaceSources } from './office'

/**
 * Loads the kit, builds the brick rooms into a running game scene and hooks
 * them to its render-state updates (after the box office's own).
 */
export async function attachBrickOffice(game: GameScene, layout: BuildingLayout, opts: BrickOfficeOptions = {}): Promise<BrickOffice> {
  const t0 = performance.now()
  const kit = await loadKit()
  const kitLoadMs = performance.now() - t0
  const bricks = buildBrickOffice(game.scene, kit, layout, game.office, game.lighting, { ...opts, kitLoadMs })
  const update = game.update
  game.update = (state: RenderState, at?: number) => {
    update(state, at)
    bricks.update(state)
  }
  return bricks
}

/**
 * The parts of the overlay's store the surfaces read (structurally
 * `OverlayStore`; `render/` imports nothing from the UI).
 */
export interface StoreLike {
  plan: { peek(): { items: ReadonlyArray<PlanItemLike & { phases: ReadonlyArray<{ kind: string; state: string }> }> } }
  planText: { peek(): { items: Record<string, { title: string } | undefined> } }
  personaOf(staffId: string): { name: string }
}

/** Surface text from the store (rule 2): names, work item titles and stages, the Plan by phase. */
export function surfaceSourcesFrom(store: StoreLike): SurfaceSources {
  return {
    person: (id) => ({ name: store.personaOf(id).name }),
    job: (id) => {
      const item = store.plan.peek().items.find((i) => i.id === id)
      const title = store.planText.peek().items[id]?.title ?? ''
      if (!item) return title ? { title, stage: '' } : undefined
      const n = item.phases.length
      const at = item.phases.findIndex((p) => p.state === 'working' || p.state === 'blocked')
      const i = at >= 0 ? at : item.phases.findIndex((p) => p.state !== 'done')
      const stage = i >= 0 ? `${item.phases[i].kind} · phase ${i + 1} of ${n}` : n ? 'done' : ''
      return { title, stage }
    },
    board: () => boardCards(store.plan.peek().items, (id) => store.planText.peek().items[id]?.title),
  }
}

/** The part of the overlay's store the model table reads (structurally `OverlayStore.siteModels`). */
export interface ModelStoreLike {
  siteModels: { subscribe(fn: (m: { town: unknown } | null) => void): () => void }
}

/**
 * Keeps the model table on the site's current town (ADR-0072): every time
 * the store's site models change, the town's design goes to the bricks
 * (rebuilt only when it differs). Returns the unsubscribe.
 */
export function watchModel(store: ModelStoreLike, bricks: BrickOffice): () => void {
  return store.siteModels.subscribe((m) => bricks.setModel(m ? JSON.stringify(m.town) : null))
}
