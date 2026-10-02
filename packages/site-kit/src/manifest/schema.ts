/**
 * `site.manifest.json` — the data contract between a site repo and the kit.
 *
 * Everything a theme would otherwise hardcode (languages, regions, sections,
 * collections, brand, analytics) lives here, so themes stay niche-agnostic
 * and agents can't break routing by editing presentation.
 */
import { z } from 'zod'
import { LANG_KEY_PATTERN, MEDIA_REF_PATTERN } from '@swarm-press/content-schema'

export const MANIFEST_SCHEMA_VERSION = 1
export const MANIFEST_FILE = 'site.manifest.json'

const langCode = z.string().regex(new RegExp(LANG_KEY_PATTERN), 'language code like "en" or "pt-BR"')
const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase slug (a-z, 0-9, -)')

/** v2 localized text: a plain string, or `{ <lang>: string }` with `en` required. */
export const LocalizedSchema = z.union([
  z.string(),
  z
    .record(langCode, z.string())
    .refine((v) => typeof v.en === 'string', { message: 'localized objects need an `en` value' }),
])

/** `media:<id>` (closed media index), an absolute http(s) URL, or a root-relative path. */
export const MediaRefSchema = z.string().regex(new RegExp(MEDIA_REF_PATTERN), 'media:<id>, http(s) URL or /path')

export const BrandSchema = z
  .object({
    name: z.string().min(1),
    tagline: LocalizedSchema.optional(),
    logo: MediaRefSchema.optional(),
    favicon: MediaRefSchema.optional(),
    /** Reference to the house-style / voice document (e.g. `content/config/style-guide.json`). */
    voiceRef: z.string().optional(),
  })
  .strict()

export const RegionSchema = z
  .object({
    slug,
    name: LocalizedSchema,
    order: z.number().int().nonnegative(),
    color: z.string().optional(),
    geo: z.object({ lat: z.number(), lng: z.number() }).strict().optional(),
    /** Entity id in `content/config/entity-index.json`. */
    entityRef: z.string().optional(),
  })
  .strict()

export const RegionsSchema = z
  .object({
    /** What a region is called on this site ("Villages", "Neighbourhoods", "Islands"). */
    label: LocalizedSchema,
    items: z.array(RegionSchema),
  })
  .strict()

export const SectionSchema = z
  .object({
    slug,
    label: LocalizedSchema,
    /** Collection type rendered by this section (`restaurants`). */
    collection: z.string().optional(),
    /** Exists under every region: `/{lang}/{region}/{section}/`. Otherwise `/{lang}/{section}/`. */
    perRegion: z.boolean().default(false),
    /** Page id (or route key) of a hub page for the section. */
    hubPage: z.string().optional(),
  })
  .strict()

export const CollectionSchema = z
  .object({
    /** Collection type, also its URL segment (`restaurants`). */
    type: slug,
    /** Directory relative to the repo root (`content/collections/restaurants`). */
    dir: z.string().min(1),
    label: LocalizedSchema.optional(),
    /** Optional JSON Schema file (repo-relative) every item is validated against. */
    schema: z.string().optional(),
    /** Generate `/{lang}/{type}/{item}/` detail pages. */
    detailRoute: z.boolean().default(false),
    /** Item field used as the URL key. Falls back to `id`. */
    itemKey: z.string().default('slug'),
    /** Item field holding the region slug; files are also named after regions. */
    regionField: z.string().optional(),
  })
  .strict()

export const RoutesSchema = z
  .object({
    /** Page id of the home page. Defaults to the page whose slug is `/{lang}`. */
    home: z.string().optional(),
    /** URL segment of the blog (`blog` → `/{lang}/blog/{slug}/`). */
    blogIndex: z.string().optional(),
  })
  .strict()

export const AnalyticsSchema = z
  .object({
    /** Tracker endpoint origin, e.g. `https://play.swarm.press`. */
    endpoint: z.string().url(),
    /** Project tracker key. */
    projectKey: z.string().min(1),
  })
  .strict()

export const SiteManifestSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    siteId: z.string().min(1),
    /** Origin used for canonical URLs, e.g. `https://cinqueterre.travel`. */
    baseUrl: z.string().url(),
    /** Path prefix the site is served under (GitHub project pages, previews). */
    base: z.string().regex(/^\//, 'must start with /').default('/'),
    domain: z.string().optional(),
    languages: z.array(langCode).min(1),
    defaultLanguage: langCode,
    brand: BrandSchema,
    regions: RegionsSchema.optional(),
    sections: z.array(SectionSchema).default([]),
    collections: z.array(CollectionSchema).default([]),
    routes: RoutesSchema.default({}),
    analytics: AnalyticsSchema.optional(),
    /** Language-neutral paths (`/`, `/riomaggiore/`) screenshotted per language by `kit screenshots`. */
    screenshotPages: z.array(z.string().regex(/^\//)).default(['/']),
    /** Theme directory, repo-relative. */
    themeDir: z.string().default('theme'),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (!m.languages.includes(m.defaultLanguage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultLanguage'],
        message: `defaultLanguage "${m.defaultLanguage}" is not in languages [${m.languages.join(', ')}]`,
      })
    }
    if (new Set(m.languages).size !== m.languages.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languages'], message: 'duplicate language' })
    }
    const regionSlugs = new Set<string>()
    m.regions?.items.forEach((r, i) => {
      if (regionSlugs.has(r.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['regions', 'items', i, 'slug'], message: `duplicate region "${r.slug}"` })
      }
      regionSlugs.add(r.slug)
      if (m.languages.includes(r.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['regions', 'items', i, 'slug'], message: `region slug "${r.slug}" collides with a language code` })
      }
    })
    const collectionTypes = new Set(m.collections.map((c) => c.type))
    m.sections.forEach((s, i) => {
      if (s.collection && !collectionTypes.has(s.collection)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections', i, 'collection'],
          message: `section "${s.slug}" references unknown collection "${s.collection}"`,
        })
      }
      if (!s.perRegion && regionSlugs.has(s.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'slug'], message: `section "${s.slug}" collides with a region slug` })
      }
    })
  })

export type Localized = z.infer<typeof LocalizedSchema>
export type SiteManifest = z.infer<typeof SiteManifestSchema>
export type SiteManifestInput = z.input<typeof SiteManifestSchema>
export type Region = z.infer<typeof RegionSchema>
export type Section = z.infer<typeof SectionSchema>
export type CollectionDef = z.infer<typeof CollectionSchema>

export interface ManifestIssue {
  path: string
  message: string
}

export function parseManifest(
  value: unknown,
): { ok: true; manifest: SiteManifest } | { ok: false; issues: ManifestIssue[] } {
  const r = SiteManifestSchema.safeParse(value)
  if (r.success) return { ok: true, manifest: r.data }
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: '/' + i.path.join('/'), message: i.message })),
  }
}

/** Throws a readable error for an invalid manifest. */
export function assertManifest(value: unknown, source = MANIFEST_FILE): SiteManifest {
  const r = parseManifest(value)
  if (r.ok) return r.manifest
  throw new Error(`${source} is invalid:\n` + r.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n'))
}
