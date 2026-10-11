/**
 * The app shell's sections (ADR-0086): the tabs along the top, each a place
 * in the town and a way into the CEO's tools. A section opens its panel (or,
 * for the Town, closes them to show the 3D world) and, for the Studio's
 * sections, the workbench it is about. Text is data: labels only.
 */
import type { PanelId } from './store'

export type StudioTab = 'town' | 'building' | 'factory' | 'paint' | 'data'

export type SectionId = 'town' | 'building' | 'plan' | 'factory' | 'data' | 'staff' | 'projects'

export interface SectionDef {
  id: SectionId
  label: string
  /** The subtitle under the label. */
  sub: string
  icon: string
  /** The panel the section opens; null: the town itself (the 3D world, no panel). */
  panel: PanelId | null
  /** The Studio's workbench, for sections that open the Studio. */
  studioTab?: StudioTab
  /** Panels that belong to the section (the tab is lit while one of them is open). */
  owns: readonly PanelId[]
}

export const SECTIONS: readonly SectionDef[] = [
  { id: 'town', label: 'Town', sub: 'Your studio', icon: 'town', panel: null, owns: ['activity', 'finance'] },
  { id: 'building', label: 'Building', sub: 'Pages & design', icon: 'building', panel: 'blueprint', studioTab: 'building', owns: [] },
  { id: 'plan', label: 'Plan', sub: 'Editorial board', icon: 'plan', panel: 'plan', owns: ['plan', 'inbox'] },
  { id: 'factory', label: 'Factory', sub: 'Tools & automation', icon: 'factory', panel: 'blueprint', studioTab: 'factory', owns: [] },
  { id: 'data', label: 'Data Studio', sub: 'Content models', icon: 'data', panel: 'blueprint', studioTab: 'data', owns: [] },
  { id: 'staff', label: 'Staff', sub: 'People & teams', icon: 'org', panel: 'org', owns: ['org', 'hiring', 'performance'] },
  { id: 'projects', label: 'Projects', sub: 'All sites', icon: 'projects', panel: 'projects', owns: ['projects'] },
]

/** The section lit for what is open: the panel's section, the Studio by its workbench, else the town. */
export function sectionOf(panel: PanelId | null, studioTab: StudioTab): SectionId {
  if (panel === 'blueprint') return studioTab === 'factory' ? 'factory' : studioTab === 'data' ? 'data' : 'building'
  if (!panel) return 'town'
  return SECTIONS.find((s) => s.owns.includes(panel))?.id ?? 'town'
}

/** Whether a section can open with the panels on offer (the Studio needs the site's models). */
export function sectionOffered(s: SectionDef, panels: readonly { id: PanelId }[]): boolean {
  return s.panel === null || panels.some((p) => p.id === s.panel)
}
