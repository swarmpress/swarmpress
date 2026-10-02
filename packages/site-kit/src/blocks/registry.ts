/**
 * Block registry + dispatcher logic (replaces the legacy giant `switch`).
 *
 * Lookup order for a block `type`:
 *   1. theme override for a core block (`theme/blocks/<type>.astro` or `blocks` in defineTheme)
 *   2. custom block `x:<name>` (`theme/blocks/<name>/Component.astro` or `customBlocks`)
 *   3. kit neutral fallback for core blocks
 *   4. nothing ("missing": an unknown type, reported by validation)
 */
import { CORE_BLOCK_TYPES, isCoreBlock } from '@swarm-press/content-schema'

export type BlockSource = 'theme' | 'custom' | 'fallback' | 'missing'

export interface BlockSources<C> {
  theme: Record<string, C>
  custom: Record<string, C>
  fallback: Record<string, C>
}

export interface ResolvedBlock<C> {
  component?: C
  source: BlockSource
}

export function createBlockResolver<C>(src: BlockSources<C>): (type: string) => ResolvedBlock<C> {
  return (type) => {
    if (isCoreBlock(type) && src.theme[type]) return { component: src.theme[type], source: 'theme' }
    if (type.startsWith('x:') && src.custom[type]) return { component: src.custom[type], source: 'custom' }
    if (src.fallback[type]) return { component: src.fallback[type], source: 'fallback' }
    return { source: 'missing' }
  }
}

/** Which renderer each block type used in content gets. */
export function coverage<C>(
  usedTypes: Iterable<string>,
  src: { theme: Iterable<string>; custom: Iterable<string>; fallback: Iterable<string> },
): Map<string, BlockSource> {
  const theme = new Set(src.theme)
  const custom = new Set(src.custom)
  const fallback = new Set(src.fallback)
  const out = new Map<string, BlockSource>()
  for (const t of [...new Set(usedTypes)].sort()) {
    if (isCoreBlock(t) && theme.has(t)) out.set(t, 'theme')
    else if (t.startsWith('x:') && custom.has(t)) out.set(t, 'custom')
    else if (fallback.has(t)) out.set(t, 'fallback')
    else out.set(t, 'missing')
  }
  return out
}

/** Every core block type has a kit fallback renderer. */
export const FALLBACK_TYPES: readonly string[] = CORE_BLOCK_TYPES
