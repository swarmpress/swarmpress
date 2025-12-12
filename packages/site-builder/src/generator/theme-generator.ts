/**
 * Theme Generator
 * Generates Tailwind CSS configuration and CSS variables from theme config
 */

import { mkdir, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import type { ThemeConfig, ThemeColors, ColorScale } from '../schemas'

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
