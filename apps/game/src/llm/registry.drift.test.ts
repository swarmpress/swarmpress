// The bundled fallback registry must agree with the served one (config/models.toml)
// and with the staff-role vocabulary (config/roles.toml). Both TOML files are
// parsed with a few line regexes: they only need ids and role lists here.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_REGISTRY, STAFF_ROLES } from './registry.default'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (p: string) => readFileSync(root + p, 'utf8')

function rolesToml(): string[] {
  return [...read('config/roles.toml').matchAll(/^\[roles\.([a-z0-9-]+)\]\s*$/gm)].map((m) => m[1])
}

function modelsToml(): Map<string, { roles: string[]; hfRepo: string }> {
  const out = new Map<string, { roles: string[]; hfRepo: string }>()
  for (const block of read('config/models.toml').split(/^\[\[model\]\]\s*$/m).slice(1)) {
    const id = /^id = "([^"]+)"/m.exec(block)?.[1]
    const hfRepo = /^hf_repo = "([^"]+)"/m.exec(block)?.[1]
    const roles = /^roles = \[([^\]]*)\]/m.exec(block)?.[1]
    if (!id || !hfRepo || roles === undefined) throw new Error(`unparsable model block: ${block.slice(0, 80)}`)
    out.set(id, { hfRepo, roles: [...roles.matchAll(/"([^"]+)"/g)].map((m) => m[1]) })
  }
  return out
}

describe('bundled LLM registry vs config/', () => {
  it('STAFF_ROLES is exactly the role vocabulary of config/roles.toml', () => {
    expect([...STAFF_ROLES].sort()).toEqual(rolesToml().sort())
  })

  it('every role in the bundled registry is a staff role or the client-only "chatter"', () => {
    const allowed = new Set<string>([...STAFF_ROLES, 'chatter'])
    for (const m of DEFAULT_REGISTRY.models) {
      for (const r of m.roles) expect(allowed.has(r), `${m.id}: unknown role ${r}`).toBe(true)
    }
  })

  it('models present in both registries agree on repo and staff roles', () => {
    const served = modelsToml()
    let shared = 0
    for (const m of DEFAULT_REGISTRY.models) {
      const s = served.get(m.id)
      if (!s) continue
      shared++
      expect(m.hfRepo, m.id).toBe(s.hfRepo)
      expect(m.roles.filter((r) => r !== 'chatter').sort(), m.id).toEqual([...s.roles].sort())
    }
    expect(shared).toBeGreaterThanOrEqual(3)
  })
})
