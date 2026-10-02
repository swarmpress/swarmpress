/**
 * W3C Design Tokens (https://design-tokens.github.io/community-group/format/)
 * → CSS custom properties, emitted both as a Tailwind 4 `@theme` block (so
 * utilities like `bg-surface`, `font-serif`, `rounded-card` exist) and as a
 * plain `:root` block (so the kit's neutral renderers work without Tailwind).
 */

export interface TokenGroup {
  [key: string]: TokenGroup | Token | string | undefined
}

export interface Token {
  $value: unknown
  $type?: string
  $description?: string
}

export type DesignTokens = TokenGroup

/** Tailwind 4 theme namespace per top-level token group. */
const NAMESPACE: Record<string, string> = {
  color: 'color',
  colors: 'color',
  font: 'font',
  fonts: 'font',
  fontFamily: 'font',
  fontWeight: 'font-weight',
  text: 'text',
  fontSize: 'text',
  leading: 'leading',
  lineHeight: 'leading',
  tracking: 'tracking',
  letterSpacing: 'tracking',
  spacing: 'spacing',
  space: 'spacing',
  radius: 'radius',
  borderRadius: 'radius',
  shadow: 'shadow',
  shadows: 'shadow',
  breakpoint: 'breakpoint',
  breakpoints: 'breakpoint',
  container: 'container',
  ease: 'ease',
  animate: 'animate',
}

/** Namespace from `$type` when the group name is not a known namespace. */
const TYPE_NAMESPACE: Record<string, string> = {
  color: 'color',
  fontFamily: 'font',
  fontWeight: 'font-weight',
  shadow: 'shadow',
  duration: 'duration',
  cubicBezier: 'ease',
}

export interface TokenVar {
  /** Token path (`color.brand.500`). */
  path: string
  /** CSS custom property (`--color-brand-500`). */
  name: string
  value: string
  type?: string
}

function isToken(v: unknown): v is Token {
  return !!v && typeof v === 'object' && '$value' in (v as object)
}

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .toLowerCase()

function cssValue(value: unknown, type: string | undefined, resolveAlias: (p: string) => string): string {
  if (typeof value === 'string') {
    const alias = value.match(/^\{([^}]+)\}$/)
    if (alias) return resolveAlias(alias[1])
    return value.replace(/\{([^}]+)\}/g, (_, p) => resolveAlias(p))
  }
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (type === 'fontFamily') return value.map((f) => (/[\s,]/.test(String(f)) && !/^["']/.test(String(f)) ? `"${f}"` : String(f))).join(', ')
    if (type === 'cubicBezier') return `cubic-bezier(${value.join(', ')})`
    if (type === 'shadow') return value.map((v) => cssValue(v, type, resolveAlias)).join(', ')
    return value.map(String).join(' ')
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (type === 'shadow' || ('offsetX' in v && 'blur' in v)) {
      const parts = [v.inset ? 'inset' : '', v.offsetX, v.offsetY, v.blur, v.spread, v.color]
        .filter((x) => x !== undefined && x !== '')
        .map((x) => cssValue(x, undefined, resolveAlias))
      return parts.join(' ')
    }
    if ('value' in v && 'unit' in v) return `${v.value}${v.unit}`
  }
  return String(value)
}

/** Flattens tokens into CSS variables. Aliases (`{color.brand.500}`) become `var(--…)`. */
export function flattenTokens(tokens: DesignTokens): TokenVar[] {
  const raw: { path: string[]; token: Token; type?: string }[] = []
  const visit = (group: TokenGroup, path: string[], inheritedType?: string) => {
    const groupType = typeof group.$type === 'string' ? group.$type : inheritedType
    for (const [k, v] of Object.entries(group)) {
      if (k.startsWith('$') || v === undefined) continue
      if (isToken(v)) raw.push({ path: [...path, k], token: v, type: v.$type ?? groupType })
      else if (v && typeof v === 'object') visit(v as TokenGroup, [...path, k], groupType)
    }
  }
  visit(tokens, [])
  const nameOf = (path: string[], type?: string): string => {
    const [head, ...rest] = path
    const ns = NAMESPACE[head] ?? (type ? TYPE_NAMESPACE[type] : undefined)
    const tail = ns && NAMESPACE[head] ? rest : path
    const name = [ns ?? '', ...tail.map(kebab)].filter(Boolean).join('-')
    return `--${name.replace(/-DEFAULT$/i, '')}`
  }
  const names = new Map(raw.map((r) => [r.path.join('.'), nameOf(r.path, r.type)]))
  const resolveAlias = (p: string) => {
    const n = names.get(p)
    if (!n) throw new Error(`design token alias {${p}} does not resolve`)
    return `var(${n})`
  }
  return raw.map((r) => ({
    path: r.path.join('.'),
    name: names.get(r.path.join('.'))!,
    value: cssValue(r.token.$value, r.type, resolveAlias),
    type: r.type,
  }))
}

export interface TokenCss {
  /** `@theme { … }` for Tailwind 4. */
  theme: string
  /** `:root { … }` for plain CSS consumers. */
  root: string
  vars: TokenVar[]
}

export function tokensToCss(tokens: DesignTokens): TokenCss {
  const vars = flattenTokens(tokens)
  const body = vars.map((v) => `  ${v.name}: ${v.value};`).join('\n')
  return {
    theme: `@theme {\n${body}\n}\n`,
    root: `:root {\n${body}\n}\n`,
    vars,
  }
}

/**
 * The neutral token set the kit's fallback renderers rely on. Themes override
 * any of these names; unknown names are simply added.
 */
export const DEFAULT_TOKENS: DesignTokens = {
  color: {
    $type: 'color',
    bg: { $value: '#ffffff' },
    surface: { $value: '#f6f5f2' },
    fg: { $value: '#1c1b19' },
    muted: { $value: '#5f5b55' },
    border: { $value: '#e3e0da' },
    accent: { $value: '#1f5f8b' },
    'accent-fg': { $value: '#ffffff' },
  },
  font: {
    $type: 'fontFamily',
    sans: { $value: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    serif: { $value: ['Georgia', 'Cambria', 'Times New Roman', 'serif'] },
  },
  radius: { $type: 'dimension', card: { $value: '0.5rem' } },
  spacing: { $type: 'dimension', gutter: { $value: '1.25rem' } },
  container: { $type: 'dimension', prose: { $value: '42rem' }, page: { $value: '72rem' } },
}

/** Deep-merges theme tokens over the defaults. */
export function mergeTokens(base: DesignTokens, over: DesignTokens | undefined): DesignTokens {
  if (!over) return base
  const out: DesignTokens = { ...base }
  for (const [k, v] of Object.entries(over)) {
    const b = out[k]
    if (v && typeof v === 'object' && !isToken(v) && b && typeof b === 'object' && !isToken(b)) {
      out[k] = mergeTokens(b as DesignTokens, v as DesignTokens)
    } else {
      out[k] = v
    }
  }
  return out
}
