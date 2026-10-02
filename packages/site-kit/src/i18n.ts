/**
 * i18n helpers. Every localized value is read through `localize()`, never
 * `value[lang] || value.en`; UI strings go through `t()`.
 */
import { FALLBACK_LANG } from '@swarm-press/content-schema'

export type LocalizedValue<T = string> = T | { [lang: string]: T | undefined }

function isLangMap(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const keys = Object.keys(v)
  return keys.length > 0 && keys.every((k) => /^[a-z]{2}(-[A-Za-z0-9]{2,4})?$/.test(k))
}

/** True for `{ en: ..., de: ... }` shaped values. */
export function isLocalized(v: unknown): v is Record<string, unknown> {
  return isLangMap(v)
}

/**
 * Value of `value` in `lang`. Plain values answer every language. Localized
 * objects fall back along `fallbacks` (default: `en`), then to any value.
 * Empty strings count as missing.
 */
export function localizeAny<T = unknown>(
  value: LocalizedValue<T> | null | undefined,
  lang: string,
  fallbacks: readonly string[] = [FALLBACK_LANG],
): T | undefined {
  if (value === null || value === undefined) return undefined
  if (!isLangMap(value)) return value as T
  const present = (x: unknown) => x !== undefined && x !== null && x !== ''
  for (const l of [lang, ...fallbacks, FALLBACK_LANG]) {
    if (present(value[l])) return value[l] as T
  }
  return Object.values(value).find(present) as T | undefined
}

/** Localized text as a string ('' when absent). Arrays of text are joined with blank lines. */
export function localize(
  value: unknown,
  lang: string,
  fallbacks: readonly string[] = [FALLBACK_LANG],
): string {
  const v = localizeAny(value as LocalizedValue<unknown>, lang, fallbacks)
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.map((x) => localize(x, lang, fallbacks)).filter(Boolean).join('\n\n')
  if (typeof v === 'object') return ''
  return String(v)
}

/** Localized list of strings (a list per language, or a list of localized items). */
export function localizeList(value: unknown, lang: string, fallbacks: readonly string[] = [FALLBACK_LANG]): string[] {
  const v = localizeAny(value as LocalizedValue<unknown>, lang, fallbacks)
  if (v === undefined || v === null || v === '') return []
  if (Array.isArray(v)) return v.map((x) => localize(x, lang, fallbacks)).filter(Boolean)
  return [localize(v, lang, fallbacks)].filter(Boolean)
}

/** Languages a localized value is authored in (plain values: all of `all`). */
export function languagesOf(value: unknown, all: readonly string[]): string[] {
  if (!isLangMap(value)) return [...all]
  return all.filter((l) => value[l] !== undefined && value[l] !== '')
}

export type UiStrings = Record<string, Record<string, string>>

/** Kit UI strings. Themes may add or override keys per language (`theme/i18n/<lang>.json`). */
export const KIT_STRINGS: UiStrings = {
  en: {
    'nav.home': 'Home',
    'nav.skip': 'Skip to content',
    'nav.menu': 'Menu',
    'nav.languages': 'Language',
    'nav.regions': 'Explore',
    'nav.breadcrumb': 'Breadcrumb',
    'blog.title': 'Stories',
    'blog.readMore': 'Read more',
    'blog.by': 'By {author}',
    'blog.minutes': '{n} min read',
    'collection.viewAll': 'View all',
    'collection.empty': 'Nothing here yet.',
    'collection.in': '{collection} in {region}',
    'faq.title': 'Frequently asked questions',
    'notFound.title': 'Page not found',
    'notFound.body': 'The page you are looking for does not exist or has moved.',
    'notFound.back': 'Back to the home page',
    'footer.rights': '© {year} {name}',
    'footer.privacy': 'Privacy: this site uses cookieless, aggregate-only analytics.',
    'region.sections': 'In {region}',
    'region.more': 'More about {region}',
  },
  de: {
    'nav.home': 'Startseite',
    'nav.skip': 'Zum Inhalt springen',
    'nav.menu': 'Menü',
    'nav.languages': 'Sprache',
    'nav.regions': 'Entdecken',
    'nav.breadcrumb': 'Brotkrümelnavigation',
    'blog.title': 'Geschichten',
    'blog.readMore': 'Weiterlesen',
    'blog.by': 'Von {author}',
    'blog.minutes': '{n} Min. Lesezeit',
    'collection.viewAll': 'Alle ansehen',
    'collection.empty': 'Hier gibt es noch nichts.',
    'collection.in': '{collection} in {region}',
    'faq.title': 'Häufige Fragen',
    'notFound.title': 'Seite nicht gefunden',
    'notFound.body': 'Die gesuchte Seite existiert nicht oder wurde verschoben.',
    'notFound.back': 'Zur Startseite',
    'footer.rights': '© {year} {name}',
    'footer.privacy': 'Datenschutz: Diese Website nutzt cookielose, rein aggregierte Statistiken.',
    'region.sections': 'In {region}',
    'region.more': 'Mehr über {region}',
  },
  fr: {
    'nav.home': 'Accueil',
    'nav.skip': 'Aller au contenu',
    'nav.menu': 'Menu',
    'nav.languages': 'Langue',
    'nav.regions': 'Explorer',
    'nav.breadcrumb': "Fil d'Ariane",
    'blog.title': 'Récits',
    'blog.readMore': 'Lire la suite',
    'blog.by': 'Par {author}',
    'blog.minutes': '{n} min de lecture',
    'collection.viewAll': 'Tout voir',
    'collection.empty': 'Rien pour le moment.',
    'collection.in': '{collection} à {region}',
    'faq.title': 'Questions fréquentes',
    'notFound.title': 'Page introuvable',
    'notFound.body': "La page que vous cherchez n'existe pas ou a été déplacée.",
    'notFound.back': "Retour à l'accueil",
    'footer.rights': '© {year} {name}',
    'footer.privacy': 'Confidentialité : ce site utilise des statistiques agrégées, sans cookies.',
    'region.sections': 'À {region}',
    'region.more': 'En savoir plus sur {region}',
  },
  it: {
    'nav.home': 'Home',
    'nav.skip': 'Vai al contenuto',
    'nav.menu': 'Menu',
    'nav.languages': 'Lingua',
    'nav.regions': 'Esplora',
    'nav.breadcrumb': 'Percorso',
    'blog.title': 'Storie',
    'blog.readMore': 'Leggi di più',
    'blog.by': 'Di {author}',
    'blog.minutes': '{n} min di lettura',
    'collection.viewAll': 'Vedi tutto',
    'collection.empty': 'Ancora niente qui.',
    'collection.in': '{collection} a {region}',
    'faq.title': 'Domande frequenti',
    'notFound.title': 'Pagina non trovata',
    'notFound.body': 'La pagina che cerchi non esiste o è stata spostata.',
    'notFound.back': 'Torna alla home',
    'footer.rights': '© {year} {name}',
    'footer.privacy': 'Privacy: questo sito usa statistiche aggregate, senza cookie.',
    'region.sections': 'A {region}',
    'region.more': 'Scopri {region}',
  },
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))
}

/**
 * Creates `t(key, vars)` for one language: theme strings, then kit strings,
 * then the fallback chain, then the key itself.
 */
export function createT(
  lang: string,
  themeStrings: UiStrings = {},
  fallbacks: readonly string[] = [FALLBACK_LANG],
): (key: string, vars?: Record<string, string | number>) => string {
  const chain = [lang, ...fallbacks, FALLBACK_LANG]
  return (key, vars) => {
    for (const l of chain) {
      const v = themeStrings[l]?.[key] ?? KIT_STRINGS[l]?.[key]
      if (v !== undefined) return interpolate(v, vars)
    }
    return key
  }
}

/** Native display name of a language (computed, never hardcoded). */
export function languageName(lang: string): string {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'language' }).of(lang)
    if (name) return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1)
  } catch {
    /* fall through */
  }
  return lang
}

/** Text direction for a language. */
export function textDirection(lang: string): 'ltr' | 'rtl' {
  return /^(ar|he|fa|ur|ps|sd|ug|yi|dv)(-|$)/.test(lang) ? 'rtl' : 'ltr'
}
