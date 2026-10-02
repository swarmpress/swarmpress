/**
 * Schema v2 (cutover step 5), derived mechanically from the v1 Zod export.
 *
 * This is a line-by-line port of `crates/content-model/src/registry.rs`
 * (`to_v2`, `page_v2_schema`) so the TypeScript validator in
 * `@swarm-press/site-kit` and the Rust validator agree on every document:
 *
 * - text fields accept `string | { <lang>: string }` (localized objects need `en`);
 * - lists of text may also be localized as a whole (`{ en: [...], de: [...] }`);
 * - link fields (`href`, `url`, …) accept per-language values;
 * - media fields (`image`, `src`, …) accept a `MediaRef`
 *   (`media:<id>`, an absolute http(s) URL or a root-relative path);
 * - structural fields (`slug`, `village`, `icon`, …) stay as in v1.
 *
 * Nothing here changes `page.schema.json` (v1); it only adds exports.
 */
import { zodToJsonSchema } from 'zod-to-json-schema'
import { PageSchema } from './page'

export type JsonSchema = { [k: string]: unknown }

/** The fallback language every localized object must carry. */
export const FALLBACK_LANG = 'en'

/** Prefix of site custom block types (`x:<name>`). */
export const CUSTOM_BLOCK_PREFIX = 'x:'

/** JSON Schema pattern for language keys of localized objects. */
export const LANG_KEY_PATTERN = '^[a-z]{2}(-[A-Za-z0-9]{2,4})?$'

/** Pattern accepted by v2 media fields (mirrors `content_model::media::MEDIA_REF_PATTERN`). */
export const MEDIA_REF_PATTERN = '^(media:[A-Za-z0-9][A-Za-z0-9._-]*|https?://\\S+|/([^/\\s]\\S*)?)$'

/** String fields that hold a media reference. */
export const MEDIA_KEYS: readonly string[] = [
  'image',
  'images',
  'src',
  'backgroundImage',
  'heroImage',
  'authorImage',
  'avatar',
  'screenshot',
  'screenshotDark',
  'og_image',
]

/** String fields that hold an internal or external link (may be per-language). */
export const LINK_KEYS: readonly string[] = ['href', 'url', 'eyebrowUrl', 'viewAllUrl']

/** String fields that are identifiers / machine values, never localized. */
export const STRUCTURAL_KEYS: readonly string[] = [
  'type',
  'id',
  'slug',
  'slugs',
  'icon',
  'backgroundIcon',
  'color',
  'code',
  'collectionType',
  'collectionTypes',
  'village',
  'lang',
  'time',
  'height',
  'contactEmail',
  'status',
  'canonical',
]

/** The exported v1 page schema (`definitions.Page` of `page.schema.json`). */
export function pageSchemaV1(): JsonSchema {
  const root = zodToJsonSchema(PageSchema, {
    name: 'Page',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as { definitions: { Page: JsonSchema } }
  return root.definitions.Page
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** The v1 (exported Zod) schema of every core block, keyed by type, in schema order. */
export function coreBlockSchemasV1(): Map<string, JsonSchema> {
  const page = pageSchemaV1() as any
  const variants: JsonSchema[] = page.properties.body.items.anyOf
  const out = new Map<string, JsonSchema>()
  for (const s of variants) {
    const t = (s as any).properties.type.const as string
    out.set(t, clone(s))
  }
  return out
}

/** Every core block type, in schema order. */
export const CORE_BLOCK_TYPES: readonly string[] = [...coreBlockSchemasV1().keys()]

export function isCoreBlock(t: string): boolean {
  return CORE_BLOCK_TYPES.includes(t)
}

/** `{ "<lang>": of, ... }` with `en` required. */
function langObject(of: unknown): JsonSchema {
  return {
    type: 'object',
    required: ['en'],
    minProperties: 1,
    propertyNames: { pattern: LANG_KEY_PATTERN },
    additionalProperties: of,
  }
}

/** `original | { "<lang>": original }`. */
function localized(original: unknown): JsonSchema {
  return { anyOf: [clone(original), langObject(clone(original))] }
}

function mediaRef(): JsonSchema {
  return { type: 'string', pattern: MEDIA_REF_PATTERN }
}

/** A plain string field that v2 treats as localizable text. */
function isTextString(schema: unknown, key: string): boolean {
  if (!schema || typeof schema !== 'object') return false
  const s = schema as JsonSchema
  return (
    s.type === 'string' &&
    !['const', 'enum', 'format', 'pattern'].some((k) => k in s) &&
    !MEDIA_KEYS.includes(key) &&
    !LINK_KEYS.includes(key) &&
    !STRUCTURAL_KEYS.includes(key)
  )
}

/**
 * Derives the v2 form of a v1 (sub)schema. `key` is the property name the
 * schema sits under (array items inherit their array's key).
 */
export function toV2(schema: unknown, key?: string): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return clone(schema)
  const obj = schema as JsonSchema
  if (obj.type === 'array' && key !== undefined && obj.items !== undefined) {
    if (isTextString(obj.items, key)) {
      const perItem = { ...clone(obj), items: toV2(obj.items, key) }
      return { anyOf: [perItem, langObject(clone(obj))] }
    }
  }
  if (obj.type === 'string') {
    if (key === undefined) return clone(obj)
    if ('const' in obj || 'enum' in obj) return clone(obj)
    if (MEDIA_KEYS.includes(key)) return mediaRef()
    if ('format' in obj || 'pattern' in obj) return clone(obj)
    if (STRUCTURAL_KEYS.includes(key)) return clone(obj)
    return localized(obj)
  }
  const out: JsonSchema = {}
  for (const [k, v] of Object.entries(obj)) {
    let nv: unknown
    switch (k) {
      case 'properties':
        nv =
          v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v as JsonSchema).map(([pk, pv]) => [pk, toV2(pv, pk)]))
            : clone(v)
        break
      case 'items':
      case 'additionalProperties':
        nv = toV2(v, key)
        break
      case 'anyOf':
      case 'oneOf':
      case 'allOf':
        nv = Array.isArray(v) ? v.map((s) => toV2(s, key)) : clone(v)
        break
      default:
        nv = clone(v)
    }
    out[k] = nv
  }
  return out
}

/** v2 schema of every core block, keyed by type. */
export function coreBlockSchemasV2(): Map<string, JsonSchema> {
  const out = new Map<string, JsonSchema>()
  for (const [t, v1] of coreBlockSchemasV1()) out.set(t, toV2(v1) as JsonSchema)
  return out
}

/**
 * The v2 page envelope. Body items are only checked for a `type`; each block
 * is then validated against its own (core or custom) schema.
 */
export function pageSchemaV2(): JsonSchema {
  const page = clone(pageSchemaV1()) as any
  const props = page.properties
  props.body = {
    type: 'array',
    items: {
      type: 'object',
      required: ['type'],
      properties: { type: { type: 'string', minLength: 1 } },
    },
  }
  props.title = { anyOf: [{ type: 'string', minLength: 1 }, props.title] }
  props.template = { type: 'string' }
  const seoProps = props.seo.properties
  for (const k of ['title', 'description']) seoProps[k] = toV2(seoProps[k], k)
  seoProps.og_image = mediaRef()
  return page
}

/** True for `xx` or `xx-YY` / `xx-Yyyy` language keys. */
export function isLangCode(key: string): boolean {
  return new RegExp(LANG_KEY_PATTERN).test(key) && !/-$/.test(key)
}

/** Custom block names: lowercase kebab-case (`wine-map`). */
export function isValidCustomBlockName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && !name.endsWith('-') && !name.includes('--')
}
