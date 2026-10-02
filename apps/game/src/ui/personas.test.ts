import { describe, expect, it } from 'vitest'
import { contrastRatio, textOn } from './format'
import { buildCatalog, loadFixturePersonas, loadPersonaCatalog, parsePersona, PersonaError, selectCatalog } from './personas'

const VALID = `
slug = "giulia"
id = 1
name = "Giulia Rossi"
pronouns = "she/her"
age = 38
hometown = "La Spezia, Italy"
department = "editorial"
role = "writer"
title = "Food & Culture Writer"
seniority = "senior"
salary_eur_month = 4200
languages = ["it (native)", "en (C2)"]
pitch = "One line."
bio = '''First-person paragraph.'''

[cv]
education = [ { years = "2005–2008", what = "BSc Gastronomic Sciences", where = "Pollenzo" } ]
experience = [ { years = "2018–2025", role = "Contributor", org = "Gambero Rosso", highlights = ["40 reviews"] } ]
skills = ["Ligurian cuisine"]
awards = []

[life]
hobbies = ["making pesto by hand"]
interests = ["Slow Food"]
quirks = ["Brings focaccia"]
likes = ["early markets"]
dislikes = ["tourist menus"]
work_style = "Fast mornings."

[traits]
rigor = 65
speed = 60

[relationships]
friends = ["isabella"]
friction = ["lorenzo"]

[appearance]
palette = "#c0504d"
description = "Short dark hair."
`

describe('parsePersona (organization.md §3)', () => {
  it('parses a complete persona into the typed shape', () => {
    const p = parsePersona(VALID, 'giulia.toml')
    expect(p).toMatchObject({
      slug: 'giulia',
      id: 1,
      name: 'Giulia Rossi',
      pronouns: 'she/her',
      seniority: 'senior',
      salaryEurMonth: 4200,
      candidate: false,
      appearance: { palette: '#c0504d' },
      relationships: { friends: ['isabella'], friction: ['lorenzo'] },
    })
    expect(p.cv.experience[0]).toEqual({ years: '2018–2025', role: 'Contributor', org: 'Gambero Rosso', highlights: ['40 reviews'] })
    expect(p.life.workStyle).toBe('Fast mornings.')
    expect(p.traits).toEqual({ rigor: 65, speed: 60 })
  })

  it('marks ids ≥ 100 as hiring-pool candidates', () => {
    expect(parsePersona(VALID.replace('id = 1', 'id = 101')).candidate).toBe(true)
  })

  it('rejects invalid TOML with the file name', () => {
    expect(() => parsePersona('slug = "x', 'broken.toml')).toThrow(/broken\.toml: invalid TOML/)
  })

  it.each([
    ['missing pronouns', VALID.replace('pronouns = "she/her"\n', ''), /pronouns/],
    ['bad seniority', VALID.replace('seniority = "senior"', 'seniority = "guru"'), /seniority/],
    ['non-integer id', VALID.replace('id = 1', 'id = "one"'), /id must be an integer/],
    ['bad palette', VALID.replace('#c0504d', 'red'), /palette/],
    ['trait out of range', VALID.replace('rigor = 65', 'rigor = 140'), /traits\.rigor/],
    ['non-string hobbies', VALID.replace('hobbies = ["making pesto by hand"]', 'hobbies = [1, 2]'), /life\.hobbies/],
    ['bad slug', VALID.replace('slug = "giulia"', 'slug = "Giulia R"'), /kebab-case/],
  ])('rejects %s', (_, src, msg) => {
    expect(() => parsePersona(src, 'x.toml')).toThrow(PersonaError)
    expect(() => parsePersona(src, 'x.toml')).toThrow(msg)
  })

  it('rejects the legacy persona format (no slug/id/pronouns)', () => {
    const legacy = 'name = "Giulia"\ndisplay_role = "Culinary Expert"\nrole = "writer"\nseniority = "senior"\n'
    expect(() => parsePersona(legacy, 'giulia.toml')).toThrow(/missing required field "slug"/)
  })
})

describe('catalog loading', () => {
  it('skips invalid files, reports them and enforces slug = file name', () => {
    const { personas, errors } = buildCatalog({
      'a/giulia.toml': VALID,
      'a/wrong-name.toml': VALID.replace('id = 1', 'id = 2'),
      'a/broken.toml': 'nope = ',
    })
    expect(personas.map((p) => p.slug)).toEqual(['giulia'])
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).toMatch(/must match the file name/)
  })

  it('rejects duplicate ids', () => {
    const { personas, errors } = buildCatalog({
      'giulia.toml': VALID,
      'marco.toml': VALID.replace('slug = "giulia"', 'slug = "marco"'),
    })
    expect(personas).toHaveLength(1)
    expect(errors[0]).toMatch(/duplicate/)
  })

  it('falls back to fixtures when the real catalog has no valid personas', () => {
    const r = selectCatalog({ 'legacy/giulia.toml': 'name = "Giulia"' }, { 'f/giulia.toml': VALID })
    expect(r.source).toBe('fixtures')
    expect(r.personas.map((p) => p.slug)).toEqual(['giulia'])
    expect(r.errors[0]).toMatch(/missing required field/)
  })

  it('prefers the real catalog when it has valid personas', () => {
    const r = selectCatalog({ 'c/giulia.toml': VALID }, { 'f/giulia.toml': VALID.replace('Giulia Rossi', 'Fixture') })
    expect(r.source).toBe('catalog')
    expect(r.personas[0].name).toBe('Giulia Rossi')
  })

  it('bundles the real catalog (crates/agents/personas) without errors: the team (1–13) and a hiring pool (≥ 100)', () => {
    const r = loadPersonaCatalog()
    expect(r.source).toBe('catalog')
    expect(r.errors).toEqual([])
    const ids = r.personas.map((p) => p.id)
    expect(ids.filter((i) => i < 100)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(r.personas.filter((p) => p.candidate).length).toBeGreaterThanOrEqual(3)
    expect(r.personas.find((p) => p.slug === 'matteo')?.role).toBe('data-scientist')
  })

  it('bundles the UI fixtures: the cinqueterre team (1–13) and a hiring pool (≥ 100)', () => {
    const { personas } = loadFixturePersonas()
    const ids = personas.map((p) => p.id)
    expect(ids.filter((i) => i < 100)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(personas.filter((p) => p.candidate).length).toBeGreaterThanOrEqual(3)
    expect(personas.find((p) => p.slug === 'elena')?.role).toBe('cfo')
    expect(personas.find((p) => p.slug === 'matteo')?.role).toBe('data-scientist')
  })
})

describe('avatar colours', () => {
  it('every catalog palette gets initials with at least 4.5:1 contrast', () => {
    for (const p of [...loadPersonaCatalog().personas, ...loadFixturePersonas().personas]) {
      const bg = p.appearance.palette
      expect(contrastRatio(bg, textOn(bg)), `${p.slug} ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
