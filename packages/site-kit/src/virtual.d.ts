declare module 'virtual:site-kit/config' {
  import type { SiteManifest } from './manifest/schema'
  const config: {
    root: string
    contentDir: string
    themeDir: string
    manifest: SiteManifest
    dev: boolean
    buildYear: number
  }
  export default config
}

declare module 'virtual:site-kit/theme' {
  import type { ThemeDefinition, AstroComponent } from './theme'
  import type { UiStrings } from './i18n'
  const theme: ThemeDefinition | undefined
  export const discovered: {
    layouts: Record<string, AstroComponent>
    chrome: Record<string, AstroComponent>
    blocks: Record<string, AstroComponent>
    custom: Record<string, AstroComponent>
    strings: UiStrings
  }
  export default theme
}

declare module 'virtual:site-kit/styles' {}

declare module '*.astro' {
  const Component: any
  export default Component
}
