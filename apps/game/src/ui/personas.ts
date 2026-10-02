import { parse } from 'smol-toml'
import type { Seniority } from './types'

/**
 * The persona catalog (organization.md §3, ADR-0030): every person, staff or
 * hiring candidate, is a TOML file in crates/agents/personas/<slug>.toml.
 * The sim stores only the id and numbers; everything human comes from here.
 */
export interface CvEducation {
  years: string
  what: string
  where: string
}
export interface CvExperience {
  years: string
  role: string
  org: string
  highlights: string[]
}

export interface Persona {
  slug: string
  id: number
  name: string
  pronouns: string
  age: number | null
  hometown: string
  department: string
  role: string
  title: string
  seniority: Seniority
  salaryEurMonth: number
  languages: string[]
  pitch: string
  bio: string
  cv: { education: CvEducation[]; experience: CvExperience[]; skills: string[]; awards: string[] }
  life: {
    hobbies: string[]
    interests: string[]
    quirks: string[]
    likes: string[]
    dislikes: string[]
    workStyle: string
  }
  traits: Record<string, number>
  relationships: { friends: string[]; friction: string[] }
  appearance: { palette: string; description: string }
  /** Hiring-pool personas have ids ≥ 100 (the cinqueterre team is 1–12). */
  candidate: boolean
}

export const CANDIDATE_MIN_ID = 100
const SENIORITY: Seniority[] = ['junior', 'mid', 'senior', 'star']
const REQUIRED_STRINGS = ['slug', 'name', 'pronouns', 'department', 'role', 'title', 'seniority'] as const

export class PersonaError extends Error {}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const strs = (v: unknown, field: string): string[] => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new PersonaError(`${field} must be an array of strings`)
  return v as string[]
}
const table = (v: unknown, field: string): Obj => {
  if (v === undefined) return {}
  if (!isObj(v)) throw new PersonaError(`[${field}] must be a table`)
  return v
}

/** Parse and validate one persona TOML (schema §3). Throws `PersonaError` with the reason. */
export function parsePersona(source: string, file = '<persona>'): Persona {
  let raw: Obj
  try {
    raw = parse(source) as Obj
  } catch (e) {
    throw new PersonaError(`${file}: invalid TOML: ${(e as Error).message.split('\n')[0]}`)
  }
  try {
    for (const k of REQUIRED_STRINGS) {
      if (typeof raw[k] !== 'string' || !(raw[k] as string).trim()) throw new PersonaError(`missing required field "${k}"`)
    }
    const slug = raw.slug as string
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new PersonaError(`slug "${slug}" must be lowercase kebab-case`)
    const id = raw.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 65535)
      throw new PersonaError('id must be an integer 0..65535 (PersonaId u16)')
    if (!SENIORITY.includes(raw.seniority as Seniority))
      throw new PersonaError(`seniority must be one of ${SENIORITY.join(' | ')}`)
    const salary = raw.salary_eur_month
    if (typeof salary !== 'number' || salary <= 0) throw new PersonaError('salary_eur_month must be a positive number')

    const cv = table(raw.cv, 'cv')
    const education = (Array.isArray(cv.education) ? cv.education : []).map((e, i) => {
      if (!isObj(e)) throw new PersonaError(`cv.education[${i}] must be a table`)
      return { years: str(e.years), what: str(e.what), where: str(e.where) }
    })
    const experience = (Array.isArray(cv.experience) ? cv.experience : []).map((e, i) => {
      if (!isObj(e)) throw new PersonaError(`cv.experience[${i}] must be a table`)
      return {
        years: str(e.years),
        role: str(e.role),
        org: str(e.org),
        highlights: strs(e.highlights, `cv.experience[${i}].highlights`),
      }
    })
    const life = table(raw.life, 'life')
    const traitsRaw = table(raw.traits, 'traits')
    const traits: Record<string, number> = {}
    for (const [k, v] of Object.entries(traitsRaw)) {
      if (typeof v !== 'number' || v < 0 || v > 100) throw new PersonaError(`traits.${k} must be 0..100`)
      traits[k] = v
    }
    const rel = table(raw.relationships, 'relationships')
    const look = table(raw.appearance, 'appearance')
    const palette = str(look.palette, '#6b7a99')
    if (!/^#[0-9a-fA-F]{6}$/.test(palette)) throw new PersonaError(`appearance.palette "${palette}" must be #rrggbb`)

    return {
      slug,
      id,
      name: raw.name as string,
      pronouns: raw.pronouns as string,
      age: typeof raw.age === 'number' ? raw.age : null,
      hometown: str(raw.hometown),
      department: raw.department as string,
      role: raw.role as string,
      title: raw.title as string,
      seniority: raw.seniority as Seniority,
      salaryEurMonth: salary,
      languages: strs(raw.languages, 'languages'),
      pitch: str(raw.pitch),
      bio: str(raw.bio).trim(),
      cv: { education, experience, skills: strs(cv.skills, 'cv.skills'), awards: strs(cv.awards, 'cv.awards') },
      life: {
        hobbies: strs(life.hobbies, 'life.hobbies'),
        interests: strs(life.interests, 'life.interests'),
        quirks: strs(life.quirks, 'life.quirks'),
        likes: strs(life.likes, 'life.likes'),
        dislikes: strs(life.dislikes, 'life.dislikes'),
        workStyle: str(life.work_style),
      },
      traits,
      relationships: { friends: strs(rel.friends, 'relationships.friends'), friction: strs(rel.friction, 'relationships.friction') },
      appearance: { palette, description: str(look.description) },
      candidate: id >= CANDIDATE_MIN_ID,
    }
  } catch (e) {
    if (e instanceof PersonaError) throw new PersonaError(`${file}: ${e.message}`)
    throw e
  }
}

export interface CatalogResult {
  personas: Persona[]
  /** Files that failed validation, with the reason. */
  errors: string[]
  source: 'catalog' | 'fixtures'
}

/**
 * Build a catalog from `{ path: tomlText }`. Invalid files are skipped and
 * reported; duplicate slugs or ids are errors (the later file is dropped).
 */
export function buildCatalog(files: Record<string, string>): { personas: Persona[]; errors: string[] } {
  const personas: Persona[] = []
  const errors: string[] = []
  const slugs = new Set<string>()
  const ids = new Set<number>()
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.split('/').pop() ?? path
    try {
      const p = parsePersona(text, file)
      if (file.endsWith('.toml') && file !== `${p.slug}.toml`) throw new PersonaError(`${file}: slug "${p.slug}" must match the file name`)
      if (slugs.has(p.slug) || ids.has(p.id)) throw new PersonaError(`${file}: duplicate slug or id (${p.slug}, ${p.id})`)
      slugs.add(p.slug)
      ids.add(p.id)
      personas.push(p)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  personas.sort((a, b) => a.id - b.id)
  return { personas, errors }
}

/**
 * Pick the real catalog when it has valid personas, otherwise the fixtures.
 * Exported separately from the globs so it is testable.
 */
export function selectCatalog(catalogFiles: Record<string, string>, fixtureFiles: Record<string, string>): CatalogResult {
  const real = buildCatalog(catalogFiles)
  if (real.personas.length > 0) return { ...real, source: 'catalog' }
  const fixtures = buildCatalog(fixtureFiles)
  return { personas: fixtures.personas, errors: [...real.errors, ...fixtures.errors], source: 'fixtures' }
}

let cached: CatalogResult | null = null

/** The catalog bundled at build time (organization.md §9), falling back to UI fixtures. */
export function loadPersonaCatalog(): CatalogResult {
  if (cached) return cached
  const catalog = import.meta.glob('../../../../crates/agents/personas/*.toml', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const fixtures = import.meta.glob('./fixtures/personas/*.toml', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >
  cached = selectCatalog(catalog, fixtures)
  return cached
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** A stand-in when a staff member's persona is missing from the catalog. */
export function placeholderPersona(slug: string, role = '', department = ''): Persona {
  const name = slug.charAt(0).toUpperCase() + slug.slice(1)
  return {
    slug,
    id: -1,
    name,
    pronouns: '',
    age: null,
    hometown: '',
    department,
    role,
    title: role.replace(/[_-]/g, ' '),
    seniority: 'mid',
    salaryEurMonth: 0,
    languages: [],
    pitch: '',
    bio: '',
    cv: { education: [], experience: [], skills: [], awards: [] },
    life: { hobbies: [], interests: [], quirks: [], likes: [], dislikes: [], workStyle: '' },
    traits: {},
    relationships: { friends: [], friction: [] },
    appearance: { palette: '#6b7a99', description: '' },
    candidate: false,
  }
}
