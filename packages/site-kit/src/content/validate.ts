/**
 * Schema-v2 validation (TypeScript twin of `content_model::validate_page_v2`).
 *
 * Core block schemas come from `@swarm-press/content-schema` (v1 Zod export →
 * mechanical v2 derivation, identical to the Rust registry); custom blocks are
 * `theme/blocks/<name>/schema.json`, registered as `x:<name>`.
 */
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import {
  CORE_BLOCK_TYPES,
  CUSTOM_BLOCK_PREFIX,
  LINK_KEYS,
  MEDIA_KEYS,
  coreBlockSchemasV2,
  isCoreBlock,
  isValidCustomBlockName,
  pageSchemaV2,
  type JsonSchema,
} from '@swarm-press/content-schema'
import type { Finding } from '../findings'

export interface BlockSchemaEntry {
  type: string
  origin: 'core' | 'custom'
  schema: JsonSchema
  validate: ValidateFunction
  description?: string
}

export interface ValidationIssue {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
}

function newAjv(): Ajv {
  // Draft-07 with format validation, like the Rust validator.
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true, verbose: true })
  ;(addFormats as unknown as (a: Ajv) => void)(ajv)
  return ajv
}

export class SchemaRegistry {
  private readonly ajv = newAjv()
  private readonly blocks = new Map<string, BlockSchemaEntry>()
  private readonly pageValidator: ValidateFunction

  constructor() {
    this.pageValidator = this.ajv.compile(pageSchemaV2())
    for (const [t, schema] of coreBlockSchemasV2()) {
      this.blocks.set(t, { type: t, origin: 'core', schema, validate: this.ajv.compile(schema) })
    }
  }

  static core(): SchemaRegistry {
    return new SchemaRegistry()
  }

  /**
   * Registers a site custom block (`name` with or without `x:`). Mirrors
   * `SchemaRegistry::register_custom` in crates/content-model. Throws with a
   * readable message on invalid definitions.
   */
  registerCustom(nameIn: string, schemaIn: unknown): string {
    const name = nameIn.startsWith(CUSTOM_BLOCK_PREFIX) ? nameIn.slice(CUSTOM_BLOCK_PREFIX.length) : nameIn
    if (!isValidCustomBlockName(name)) {
      throw new Error(`invalid custom block name "${name}" (expected lowercase kebab-case, e.g. \`wine-map\`)`)
    }
    if (isCoreBlock(name)) throw new Error(`custom block \`${name}\` would shadow the core block of the same name`)
    const type = `${CUSTOM_BLOCK_PREFIX}${name}`
    if (this.blocks.has(type)) throw new Error(`custom block \`${type}\` is already registered`)
    if (!schemaIn || typeof schemaIn !== 'object' || Array.isArray(schemaIn)) {
      throw new Error(`custom block \`${type}\` schema must describe an object (type: object with properties)`)
    }
    const schema = JSON.parse(JSON.stringify(schemaIn)) as JsonSchema & { properties?: Record<string, any>; required?: string[] }
    if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
      throw new Error(`custom block \`${type}\` schema must describe an object (type: object with properties)`)
    }
    const declared = schema.properties.type?.const
    if (typeof declared === 'string' && declared !== type) {
      throw new Error(`custom block \`${type}\` declares type "${declared}"; it must be "${type}"`)
    }
    delete schema['x-block-meta']
    delete schema.$schema
    schema.properties.type = { type: 'string', const: type }
    const required = Array.isArray(schema.required) ? schema.required : []
    if (!required.includes('type')) required.unshift('type')
    schema.required = required
    let validate: ValidateFunction
    try {
      validate = this.ajv.compile(schema)
    } catch (e) {
      throw new Error(`custom block \`${type}\` schema does not compile: ${(e as Error).message}`)
    }
    this.blocks.set(type, {
      type,
      origin: 'custom',
      schema,
      validate,
      description: typeof schema.description === 'string' ? schema.description : undefined,
    })
    return type
  }

  get(type: string): BlockSchemaEntry | undefined {
    return this.blocks.get(type)
  }

  has(type: string): boolean {
    return this.blocks.has(type)
  }

  /** Core blocks in catalog order, then custom blocks alphabetically. */
  list(): BlockSchemaEntry[] {
    const core = CORE_BLOCK_TYPES.map((t) => this.blocks.get(t)!).filter(Boolean)
    const custom = [...this.blocks.values()].filter((b) => b.origin === 'custom').sort((a, b) => a.type.localeCompare(b.type))
    return [...core, ...custom]
  }

  customTypes(): string[] {
    return this.list()
      .filter((b) => b.origin === 'custom')
      .map((b) => b.type)
  }

  validatePageEnvelope(page: unknown): ErrorObject[] {
    this.pageValidator(page)
    return [...(this.pageValidator.errors ?? [])]
  }
}

const MEDIA_HINT = 'is not a media reference (expected `media:<id>`, an http(s) URL or a /path)'

function describe(e: ErrorObject): string {
  const p = e.params as Record<string, any>
  switch (e.keyword) {
    case 'additionalProperties':
      return `unexpected property "${p.additionalProperty}"`
    case 'required':
      return `missing required property "${p.missingProperty}"`
    case 'enum':
      return `must be one of: ${(p.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`
    case 'const':
      return `must be ${JSON.stringify(p.allowedValue)}`
    case 'minLength':
      return p.limit === 1 ? 'must not be empty' : `must be at least ${p.limit} characters`
    case 'minItems':
      return p.limit === 1 ? 'must not be an empty list' : `must have at least ${p.limit} items`
    case 'pattern':
      if (String(p.pattern).startsWith('^(media:')) return MEDIA_HINT
      if (String(p.pattern).startsWith('^[a-z]{2}')) return 'has a key that is not a language code'
      return `must match ${p.pattern}`
    case 'propertyNames':
      return `has an invalid key "${p.propertyName}"`
    case 'format':
      return `must be a valid ${p.format}`
    case 'type':
      return `must be ${p.type}`
    default:
      return e.message ?? e.keyword
  }
}

/**
 * Turns raw Ajv errors into one readable message per failing location.
 * `anyOf` failures (localized fields, media refs) are summarized instead of
 * listing every branch.
 */
export function summarizeErrors(errors: ErrorObject[]): { path: string; message: string }[] {
  const anyOfs = errors.filter((e) => e.keyword === 'anyOf' || e.keyword === 'oneOf')
  // Keep only the outermost anyOf per branch tree.
  const outer = anyOfs.filter(
    (a) => !anyOfs.some((b) => b !== a && a.schemaPath.startsWith(b.schemaPath + '/')),
  )
  const inBranch = (e: ErrorObject) =>
    outer.some((a) => e !== a && e.schemaPath.startsWith(a.schemaPath + '/'))
  const out: { path: string; message: string }[] = []
  const seen = new Set<string>()
  const push = (path: string, message: string) => {
    const k = path + '\u0000' + message
    if (!seen.has(k)) {
      seen.add(k)
      out.push({ path, message })
    }
  }
  for (const e of errors) {
    if (inBranch(e)) continue
    if (outer.includes(e)) {
      const branches = errors.filter((b) => b !== e && b.schemaPath.startsWith(e.schemaPath + '/'))
      // The localized-object branch is the interesting one if the value is an object.
      const msgs = [
        ...new Set(
          branches
            .filter((b) => b.keyword !== 'anyOf' && b.keyword !== 'oneOf')
            .map((b) => {
              const rel = b.instancePath.slice(e.instancePath.length)
              return (rel ? rel + ' ' : '') + describe(b)
            }),
        ),
      ]
      const isMedia = msgs.some((m) => m.endsWith(MEDIA_HINT))
      if (isMedia) {
        push(e.instancePath, MEDIA_HINT)
      } else {
        push(e.instancePath, `must be text or a localized object { "en": … } — ${anyOfDetail((e as ErrorObject & { data?: unknown }).data, msgs)}`)
      }
      continue
    }
    push(e.instancePath, describe(e))
  }
  return out
}

const LANG_KEY = /^[a-z]{2}(-[A-Za-z0-9]{2,4})?$/

/** Explains why a value matched neither the plain nor the localized shape. */
function anyOfDetail(data: unknown, branchMsgs: string[]): string {
  const inner = branchMsgs.filter((m) => m.startsWith('/'))
  if (Array.isArray(data)) return inner.length ? inner.slice(0, 3).join('; ') : 'got a list'
  if (data && typeof data === 'object') {
    const keys = Object.keys(data)
    if (keys.length && keys.every((k) => LANG_KEY.test(k))) {
      if (!keys.includes('en')) return `localized object is missing "en" (has ${keys.join(', ')})`
      return inner.length ? inner.slice(0, 3).join('; ') : 'a translation has the wrong type'
    }
    return `got an object with keys ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''}`
  }
  if (data === '') return 'must not be empty'
  if (data === null) return 'got null'
  return branchMsgs.slice(0, 2).join('; ') || `got ${typeof data}`
}

function countMedia(value: unknown, key: string | undefined, acc: { raw: number }): void {
  if (Array.isArray(value)) {
    for (const v of value) countMedia(v, key, acc)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) countMedia(v, k, acc)
  } else if (typeof value === 'string' && key && MEDIA_KEYS.includes(key)) {
    if (!value.startsWith('media:') && /^(https?:\/\/|\/[^/])/.test(value)) acc.raw++
  }
}

/** Validates one page document. Paths are JSON pointers into the page. */
export function validatePage(page: unknown, registry: SchemaRegistry): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const s of summarizeErrors(registry.validatePageEnvelope(page))) {
    issues.push({ path: s.path || '/', code: 'schema', message: s.message, severity: 'error' })
  }
  const body = (page as { body?: unknown })?.body
  if (!Array.isArray(body)) return issues
  const acc = { raw: 0 }
  body.forEach((block, i) => {
    const base = `/body/${i}`
    const t = (block as { type?: unknown })?.type
    if (typeof t !== 'string') return
    const entry = registry.get(t)
    if (!entry) {
      if (t.startsWith(CUSTOM_BLOCK_PREFIX)) {
        issues.push({
          path: `${base}/type`,
          code: 'unregistered_custom_block',
          message: `custom block \`${t}\` is not defined in theme/blocks/${t.slice(2)}/schema.json`,
          severity: 'error',
        })
      } else {
        issues.push({ path: `${base}/type`, code: 'unknown_block', message: `unknown block type \`${t}\``, severity: 'error' })
      }
      return
    }
    if (!entry.validate(block)) {
      for (const s of summarizeErrors(entry.validate.errors ?? [])) {
        issues.push({ path: `${base}${s.path}`, code: 'schema', message: `${t}: ${s.message}`, severity: 'error' })
      }
    }
    countMedia(block, undefined, acc)
  })
  if (acc.raw > 0) {
    issues.push({
      path: '/body',
      code: 'raw_media_url',
      message: `${acc.raw} media field(s) use raw URLs/paths; prefer closed-world \`media:<id>\` references`,
      severity: 'warning',
    })
  }
  return issues
}

export function toFindings(file: string, issues: ValidationIssue[]): Finding[] {
  return issues.map((i) => ({ severity: i.severity, code: i.code, file, path: i.path, message: i.message }))
}

export { LINK_KEYS, MEDIA_KEYS }
