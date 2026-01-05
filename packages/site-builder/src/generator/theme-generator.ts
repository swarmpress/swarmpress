/**
 * Theme Generator
 * Generates Tailwind CSS configuration and CSS variables from theme config
 */

import { mkdir, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import type { ThemeConfig, ThemeColors, ColorScale, SemanticColors } from '../schemas'

// =============================================================================
// TYPES
// =============================================================================

export interface ThemeGeneratorOptions {
  /**
   * Output directory for generated files
   */
  outputDir: string
  /**
   * Whether to include Tailwind plugins
   */
  includePlugins?: boolean
}

export interface GeneratedTheme {
  tailwindConfigPath: string
  cssVariablesPath: string
}

// =============================================================================
// COLOR UTILITIES
// =============================================================================

/**
 * Generate complete color scale from partial scale
 * Uses the 500 value as base and generates missing shades
 */
function completeColorScale(partial: ColorScale): Record<string, string> {
  const base = partial['500']
  if (!base) {
    throw new Error('Color scale must have a 500 value')
  }

  // For now, just return what we have - in production you'd want
  // to generate missing shades using color manipulation
  const complete: Record<string, string> = {}

  const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const

  for (const shade of shades) {
    if (partial[shade as keyof ColorScale]) {
      complete[shade] = partial[shade as keyof ColorScale]!
    }
  }

  return complete
}

/**
 * Convert theme colors to Tailwind format
 */
function colorsToTailwind(colors: ThemeColors): Record<string, Record<string, string> | string> {
  const result: Record<string, Record<string, string> | string> = {}

  // Process primary color
  if (colors.primary) {
    result.primary = completeColorScale(colors.primary)
  }

  // Process secondary color
  if (colors.secondary) {
    result.secondary = completeColorScale(colors.secondary)
  }

  // Process accent as single color
  if (colors.accent) {
    result.accent = colors.accent
  }

  // Process any additional custom colors
  for (const [key, value] of Object.entries(colors)) {
    if (['primary', 'secondary', 'accent'].includes(key)) continue

    if (typeof value === 'string') {
      result[key] = value
    } else if (typeof value === 'object' && value !== null) {
      result[key] = completeColorScale(value as ColorScale)
    }
  }

  return result
}

// =============================================================================
// TAILWIND CONFIG GENERATOR
// =============================================================================

/**
 * Generate Tailwind CSS configuration file content
 */
export function generateTailwindConfigContent(
  theme: ThemeConfig,
  options: { includePlugins?: boolean } = {}
): string {
  const colors = colorsToTailwind(theme.colors)
  const fonts = theme.fonts

  const fontFamilies: Record<string, string[]> = {}
  if (fonts?.sans) fontFamilies.sans = fonts.sans.split(',').map((f: string) => f.trim())
  if (fonts?.serif) fontFamilies.serif = fonts.serif.split(',').map((f: string) => f.trim())
  if (fonts?.mono) fontFamilies.mono = fonts.mono.split(',').map((f: string) => f.trim())
  if (fonts?.display) fontFamilies.display = fonts.display.split(',').map((f: string) => f.trim())

  const plugins = options.includePlugins !== false
    ? `
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio'),
  ],`
    : ''

  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}',
    './dist/**/*.html',
  ],
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 6).replace(/"/g, "'").split('\n').map((line, i) => i === 0 ? line : '      ' + line).join('\n')},
      fontFamily: ${JSON.stringify(fontFamilies, null, 6).replace(/"/g, "'").split('\n').map((line, i) => i === 0 ? line : '      ' + line).join('\n')},
      borderRadius: {
        DEFAULT: '${theme.borderRadius}',
      },
    },
  },${plugins}
}
`
}

/**
 * Generate Tailwind config and write to file
 */
export async function generateTailwindConfig(
  theme: ThemeConfig,
  outputDir: string,
  options: { includePlugins?: boolean } = {}
): Promise<string> {
  const content = generateTailwindConfigContent(theme, options)
  const outputPath = join(outputDir, 'tailwind.config.cjs')

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content)

  console.log(`[ThemeGenerator] Generated tailwind.config.cjs`)
  return outputPath
}

// =============================================================================
// CSS VARIABLES GENERATOR
// =============================================================================

/**
 * Generate CSS custom properties from theme
 */
export function generateCSSVariablesContent(theme: ThemeConfig): string {
  const lines: string[] = []

  lines.push(':root {')

  // Colors
  if (theme.colors.primary) {
    for (const [shade, value] of Object.entries(theme.colors.primary)) {
      if (value) lines.push(`  --color-primary-${shade}: ${value};`)
    }
  }

  if (theme.colors.secondary) {
    for (const [shade, value] of Object.entries(theme.colors.secondary)) {
      if (value) lines.push(`  --color-secondary-${shade}: ${value};`)
    }
  }

  if (theme.colors.accent) {
    lines.push(`  --color-accent: ${theme.colors.accent};`)
  }

  // Fonts
  const fonts = theme.fonts
  if (fonts?.sans) lines.push(`  --font-sans: ${fonts.sans};`)
  if (fonts?.serif) lines.push(`  --font-serif: ${fonts.serif};`)
  if (fonts?.mono) lines.push(`  --font-mono: ${fonts.mono};`)
  if (fonts?.display) lines.push(`  --font-display: ${fonts.display};`)

  // Other theme values
  lines.push(`  --border-radius: ${theme.borderRadius};`)

  lines.push('}')

  return lines.join('\n')
}

/**
 * Generate CSS variables file
 */
export async function generateCSSVariables(
  theme: ThemeConfig,
  outputDir: string
): Promise<string> {
  const content = generateCSSVariablesContent(theme)
  const stylesDir = join(outputDir, 'src', 'styles')
  const outputPath = join(stylesDir, 'theme.css')

  await mkdir(stylesDir, { recursive: true })
  await writeFile(outputPath, content)

  console.log(`[ThemeGenerator] Generated theme.css`)
  return outputPath
}

// =============================================================================
// MAIN GENERATOR FUNCTION
// =============================================================================

/**
 * Generate all theme files (Tailwind config + CSS variables)
 */
export async function generateThemeFiles(
  theme: ThemeConfig,
  options: ThemeGeneratorOptions
): Promise<GeneratedTheme> {
  console.log(`[ThemeGenerator] Generating theme files to ${options.outputDir}`)

  const [tailwindConfigPath, cssVariablesPath] = await Promise.all([
    generateTailwindConfig(theme, options.outputDir, {
      includePlugins: options.includePlugins,
    }),
    generateCSSVariables(theme, options.outputDir),
  ])

  return {
    tailwindConfigPath,
    cssVariablesPath,
  }
}

// =============================================================================
// THEME PRESETS
// =============================================================================

/**
 * Built-in theme presets
 */
export const THEME_PRESETS: Record<string, ThemeConfig> = {
  default: {
    colors: {
      primary: {
        '50': '#eff6ff',
        '100': '#dbeafe',
        '200': '#bfdbfe',
        '300': '#93c5fd',
        '400': '#60a5fa',
        '500': '#3b82f6',
        '600': '#2563eb',
        '700': '#1d4ed8',
        '800': '#1e40af',
        '900': '#1e3a8a',
      },
      secondary: {
        '50': '#f5f3ff',
        '500': '#8b5cf6',
        '600': '#7c3aed',
      },
    },
    fonts: {
      sans: 'Inter, system-ui, sans-serif',
    },
    borderRadius: '0.5rem',
    shadows: 'default',
  },

  ocean: {
    colors: {
      primary: {
        '50': '#f0fdfa',
        '100': '#ccfbf1',
        '200': '#99f6e4',
        '300': '#5eead4',
        '400': '#2dd4bf',
        '500': '#14b8a6',
        '600': '#0d9488',
        '700': '#0f766e',
        '800': '#115e59',
        '900': '#134e4a',
      },
      secondary: {
        '50': '#fdf4f3',
        '500': '#e4664c',
        '600': '#d14a2e',
      },
      accent: '#14b8a6',
    },
    fonts: {
      sans: 'Inter, system-ui, sans-serif',
    },
    borderRadius: '0.5rem',
    shadows: 'default',
  },

  minimal: {
    colors: {
      primary: {
        '50': '#fafafa',
        '500': '#18181b',
        '600': '#09090b',
      },
    },
    fonts: {
      sans: 'system-ui, sans-serif',
    },
    borderRadius: '0.25rem',
    shadows: 'sm',
  },

  /**
   * Dark Luxury Theme - Black Tomato inspired
   * Elegant dark theme for premium travel/lifestyle websites
   */
  'dark-luxury': {
    name: 'dark-luxury',
    mode: 'dark' as const,
    colors: {
      primary: {
        '50': '#fef2f2',
        '100': '#fee2e2',
        '200': '#fecaca',
        '300': '#fca5a5',
        '400': '#f87171',
        '500': '#f97316',  // Orange brand color
        '600': '#ea580c',
        '700': '#c2410c',
        '800': '#9a3412',
        '900': '#7c2d12',
      },
      secondary: {
        '50': '#f0fdfa',
        '100': '#ccfbf1',
        '500': '#14b8a6',  // Teal accent
        '600': '#0d9488',
      },
      accent: '#14b8a6',
      background: '#0a0a0a',
      foreground: '#fafafa',
    },
    fonts: {
      display: 'Playfair Display, Georgia, serif',
      sans: 'Inter, system-ui, sans-serif',
    },
    borderRadius: '0.5rem',
    shadows: 'lg',
    // Semantic colors for dark luxury theme
    semanticColors: {
      background: '#0a0a0a',
      backgroundAlt: '#171717',
      surface: '#1c1c1c',
      foreground: '#fafafa',
      foregroundMuted: '#a3a3a3',
      border: '#2e2e2e',
      brand: '#f97316',
      brandForeground: '#ffffff',
      accent: '#14b8a6',
      accentForeground: '#ffffff',
    },
    // Gradient definitions
    gradients: {
      hero: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 100%)',
      card: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)',
      overlay: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.6) 100%)',
    },
    // Overlay definitions for image treatments
    overlays: {
      dark: 'rgba(0,0,0,0.5)',
      light: 'rgba(255,255,255,0.1)',
      brand: 'rgba(249,115,22,0.15)',
    },
  },
}

/**
 * Get theme preset, optionally merged with overrides
 */
export function getThemePreset(
  presetName: string,
  overrides?: Partial<ThemeConfig>
): ThemeConfig {
  const preset = THEME_PRESETS[presetName] ?? THEME_PRESETS.default
  if (!preset) {
    throw new Error(`Theme preset "${presetName}" not found`)
  }

  if (!overrides) {
    return preset as ThemeConfig
  }

  // Deep merge overrides
  return {
    ...preset,
    ...overrides,
    colors: {
      ...preset.colors,
      ...overrides.colors,
    },
    fonts: {
      ...(preset.fonts ?? {}),
      ...(overrides.fonts ?? {}),
    },
  } as ThemeConfig
}

// =============================================================================
// SEMANTIC TOKENS CSS GENERATOR
// =============================================================================

/**
 * Convert hex color to RGB values for CSS custom properties
 * Returns format like "10 10 10" for use with rgb(var(--color))
 */
function hexToRgbValues(hex: string): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '')

  // Parse RGB values
  const r = parseInt(cleanHex.slice(0, 2), 16)
  const g = parseInt(cleanHex.slice(2, 4), 16)
  const b = parseInt(cleanHex.slice(4, 6), 16)

  return `${r} ${g} ${b}`
}

/**
 * Generate semantic CSS custom properties from theme config
 * These tokens use RGB values for flexibility with opacity
 */
export function generateSemanticTokensCSS(theme: ThemeConfig): string {
  const lines: string[] = []

  // Default light mode tokens (from semanticColors or fallbacks)
  const lightColors = theme.semanticColors ?? {
    background: theme.colors.background ?? '#ffffff',
    backgroundAlt: '#f5f5f5',
    surface: theme.colors.surface ?? '#ffffff',
    foreground: theme.colors.foreground ?? '#171717',
    foregroundMuted: theme.colors.muted ?? '#737373',
    border: '#e5e5e5',
    brand: theme.colors.primary?.['500'] ?? '#3b82f6',
    brandForeground: '#ffffff',
    accent: theme.colors.accent ?? theme.colors.secondary?.['500'] ?? '#8b5cf6',
    accentForeground: '#ffffff',
  }

  // Dark mode tokens (from darkMode overrides or inverted defaults)
  const darkColors = theme.mode === 'dark'
    ? lightColors  // If theme is already dark, use semanticColors directly
    : theme.darkMode
      ? { ...lightColors, ...theme.darkMode }
      : {
          background: '#0a0a0a',
          backgroundAlt: '#171717',
          surface: '#1c1c1c',
          foreground: '#fafafa',
          foregroundMuted: '#a3a3a3',
          border: '#2e2e2e',
          brand: lightColors.brand,
          brandForeground: '#ffffff',
          accent: lightColors.accent,
          accentForeground: '#ffffff',
        }

  lines.push('/* Semantic Theme Tokens - Generated by swarm.press */')
  lines.push('@layer base {')
  lines.push('  :root {')

  // Light mode CSS custom properties (RGB values for opacity support)
  if (lightColors.background) lines.push(`    --background: ${hexToRgbValues(lightColors.background)};`)
  if (lightColors.backgroundAlt) lines.push(`    --background-alt: ${hexToRgbValues(lightColors.backgroundAlt)};`)
  if (lightColors.surface) lines.push(`    --surface: ${hexToRgbValues(lightColors.surface)};`)
  if (lightColors.foreground) lines.push(`    --foreground: ${hexToRgbValues(lightColors.foreground)};`)
  if (lightColors.foregroundMuted) lines.push(`    --foreground-muted: ${hexToRgbValues(lightColors.foregroundMuted)};`)
  if (lightColors.border) lines.push(`    --border: ${hexToRgbValues(lightColors.border)};`)
  if (lightColors.brand) lines.push(`    --brand: ${hexToRgbValues(lightColors.brand)};`)
  if (lightColors.brandForeground) lines.push(`    --brand-foreground: ${hexToRgbValues(lightColors.brandForeground)};`)
  if (lightColors.accent) lines.push(`    --accent: ${hexToRgbValues(lightColors.accent)};`)
  if (lightColors.accentForeground) lines.push(`    --accent-foreground: ${hexToRgbValues(lightColors.accentForeground)};`)

  // Gradients
  if (theme.gradients) {
    for (const [name, value] of Object.entries(theme.gradients)) {
      lines.push(`    --gradient-${name}: ${value};`)
    }
  }

  // Overlays
  if (theme.overlays) {
    for (const [name, value] of Object.entries(theme.overlays)) {
      lines.push(`    --overlay-${name}: ${value};`)
    }
  }

  lines.push('  }')
  lines.push('')

  // Dark mode overrides
  lines.push('  .dark {')
  if (darkColors.background) lines.push(`    --background: ${hexToRgbValues(darkColors.background)};`)
  if (darkColors.backgroundAlt) lines.push(`    --background-alt: ${hexToRgbValues(darkColors.backgroundAlt)};`)
  if (darkColors.surface) lines.push(`    --surface: ${hexToRgbValues(darkColors.surface)};`)
  if (darkColors.foreground) lines.push(`    --foreground: ${hexToRgbValues(darkColors.foreground)};`)
  if (darkColors.foregroundMuted) lines.push(`    --foreground-muted: ${hexToRgbValues(darkColors.foregroundMuted)};`)
  if (darkColors.border) lines.push(`    --border: ${hexToRgbValues(darkColors.border)};`)
  if (darkColors.brand) lines.push(`    --brand: ${hexToRgbValues(darkColors.brand)};`)
  if (darkColors.brandForeground) lines.push(`    --brand-foreground: ${hexToRgbValues(darkColors.brandForeground)};`)
  if (darkColors.accent) lines.push(`    --accent: ${hexToRgbValues(darkColors.accent)};`)
  if (darkColors.accentForeground) lines.push(`    --accent-foreground: ${hexToRgbValues(darkColors.accentForeground)};`)
  lines.push('  }')
  lines.push('}')
  lines.push('')

  // Utility classes for semantic colors
  lines.push('/* Utility Classes */')
  lines.push('.bg-background { background-color: rgb(var(--background)); }')
  lines.push('.bg-background-alt { background-color: rgb(var(--background-alt)); }')
  lines.push('.bg-surface { background-color: rgb(var(--surface)); }')
  lines.push('.bg-brand { background-color: rgb(var(--brand)); }')
  lines.push('.bg-accent { background-color: rgb(var(--accent)); }')
  lines.push('.text-foreground { color: rgb(var(--foreground)); }')
  lines.push('.text-foreground-muted { color: rgb(var(--foreground-muted)); }')
  lines.push('.text-brand { color: rgb(var(--brand)); }')
  lines.push('.text-brand-foreground { color: rgb(var(--brand-foreground)); }')
  lines.push('.text-accent { color: rgb(var(--accent)); }')
  lines.push('.border-border { border-color: rgb(var(--border)); }')

  return lines.join('\n')
}

/**
 * Generate semantic tokens CSS file
 */
export async function generateSemanticTokensFile(
  theme: ThemeConfig,
  outputDir: string
): Promise<string> {
  const content = generateSemanticTokensCSS(theme)
  const stylesDir = join(outputDir, 'src', 'styles')
  const outputPath = join(stylesDir, 'semantic-tokens.css')

  await mkdir(stylesDir, { recursive: true })
  await writeFile(outputPath, content)

  console.log(`[ThemeGenerator] Generated semantic-tokens.css`)
  return outputPath
}
