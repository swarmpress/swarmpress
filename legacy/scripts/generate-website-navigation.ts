#!/usr/bin/env tsx
/**
 * Navigation Generation Script
 * Generates site.json (Black Tomato dark theme) and navigation.json
 * from the existing sitemap.json
 */

import dotenv from 'dotenv'
import { resolve, join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') })

const CONTENT_DIR = resolve(__dirname, '../cinqueterre.travel/content')
const CONFIG_DIR = join(CONTENT_DIR, 'config')

// =============================================================================
// BLACK TOMATO DARK LUXURY THEME
// =============================================================================

const siteConfig = {
  $schema: '../../../packages/site-builder/src/schemas/site-config.json',
  version: '1.0.0',
  site: {
    name: 'Cinqueterre.travel',
    title: 'Cinqueterre.travel - Your Complete Guide to the Italian Riviera',
    tagline: 'Discover the magic of Italy\'s most beautiful coastal villages',
    logo: '/logo.svg',
    favicon: '/favicon.ico',
    base_url: 'https://cinqueterre.travel',
    default_language: 'en',
    languages: ['en'],
  },
  theme: {
    name: 'black-tomato-dark',
    mode: 'dark' as const,
    colors: {
      primary: {
        '50': '#fff7ed',
        '100': '#ffedd5',
        '200': '#fed7aa',
        '300': '#fdba74',
        '400': '#fb923c',
        '500': '#f97316',  // Orange accent - Black Tomato signature
        '600': '#ea580c',
        '700': '#c2410c',
        '800': '#9a3412',
        '900': '#7c2d12',
      },
      secondary: {
        '50': '#fafafa',
        '100': '#f5f5f5',
        '200': '#e5e5e5',
        '300': '#d4d4d4',
        '400': '#a3a3a3',
        '500': '#737373',
        '600': '#525252',
        '700': '#404040',
        '800': '#262626',
        '900': '#171717',
      },
    },
    fonts: {
      sans: 'Inter, system-ui, sans-serif',
      serif: 'Playfair Display, Georgia, serif',
      display: 'Playfair Display, Georgia, serif',
    },
    borderRadius: '0.375rem',
    shadows: 'default' as const,
    semanticColors: {
      background: '#0a0a0a',        // Near black background
      backgroundAlt: '#141414',     // Slightly lighter for cards
      surface: '#1a1a1a',           // Card/panel surface
      foreground: '#fafafa',        // White text
      foregroundMuted: '#a3a3a3',   // Muted text
      border: '#262626',            // Subtle borders
      brand: '#f97316',             // Orange brand color
      brandForeground: '#ffffff',   // White text on brand
      accent: '#f97316',            // Orange accent
      accentForeground: '#ffffff',  // White on accent
    },
    gradients: {
      hero: 'linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0%, rgba(10, 10, 10, 0.95) 50%)',
      card: 'linear-gradient(180deg, rgba(26, 26, 26, 0.8) 0%, rgba(10, 10, 10, 0.95) 100%)',
      overlay: 'linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 60%)',
    },
    overlays: {
      dark: 'rgba(10, 10, 10, 0.7)',
      medium: 'rgba(10, 10, 10, 0.5)',
      light: 'rgba(10, 10, 10, 0.3)',
    },
  },
  layout: {
    header: {
      variant: 'simple',
      sticky: true,
      transparent_on_hero: true,
      show_cta_button: true,
    },
    footer: {
      variant: 'four-column',
      show_social: true,
      show_newsletter: false,
    },
    container: {
      max_width: '7xl' as const,
      padding: '6',
    },
  },
  seo: {
    default_og_image: '/og-image.jpg',
    structured_data: {
      organization: {
        '@type': 'Organization' as const,
        name: 'Cinqueterre.travel',
        url: 'https://cinqueterre.travel',
        logo: 'https://cinqueterre.travel/logo.svg',
        sameAs: [
          'https://www.instagram.com/cinqueterretravel',
          'https://www.facebook.com/cinqueterretravel',
        ],
      },
    },
  },
  analytics: {},
  features: {
    dark_mode: false,  // Always dark, no toggle needed
    search: true,
    breadcrumbs: true,
    reading_time: false,
    share_buttons: true,
    table_of_contents: false,
    comments: false,
  },
}

// =============================================================================
// NAVIGATION GENERATION
// =============================================================================

interface SitemapPage {
  slug: string
  title: string
  titles?: Record<string, string>
  page_file: string
  in_nav?: boolean
  nav_order?: number
  children?: SitemapPage[]
  collection?: string
}

interface SitemapData {
  site: {
    name: string
    title: string
    tagline: string
    base_url: string
    default_language: string
    languages: string[]
  }
  pages: SitemapPage[]
  footer_nav: Array<{
    title: string
    titles?: Record<string, string>
    links: Array<{ title: string; url: string }>
  }>
}

function generateNavigationConfig(sitemap: SitemapData) {
  // Build main navigation from pages with in_nav: true
  const mainNav = sitemap.pages
    .filter(page => page.in_nav)
    .sort((a, b) => (a.nav_order || 0) - (b.nav_order || 0))
    .map(page => {
      // Villages get a dropdown with children
      const isVillage = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'].includes(page.slug)

      if (isVillage && page.children && page.children.length > 0) {
        return {
          title: page.titles?.en || page.title,
          url: `/${page.slug}/`,
          children: [
            { title: 'Overview', url: `/${page.slug}/` },
            { title: 'Restaurants', url: `/${page.slug}/restaurants/` },
            { title: 'Hotels', url: `/${page.slug}/hotels/` },
            { title: 'Things to Do', url: `/${page.slug}/things-to-do/` },
            { title: 'Hiking', url: `/${page.slug}/hiking/` },
          ],
        }
      }

      return {
        title: page.titles?.en || page.title,
        url: `/${page.slug}/`,
      }
    })

  // Add a Villages dropdown that groups all 5 villages
  const villagesNav = {
    title: 'Villages',
    description: 'Explore the five villages of Cinque Terre',
    children: [
      { title: 'Monterosso al Mare', description: 'Sandy beaches and lively nightlife', url: '/monterosso/' },
      { title: 'Vernazza', description: 'Picturesque harbor and colorful houses', url: '/vernazza/' },
      { title: 'Corniglia', description: 'Hilltop village with panoramic views', url: '/corniglia/' },
      { title: 'Manarola', description: 'Famous sunset views and wine terraces', url: '/manarola/' },
      { title: 'Riomaggiore', description: 'Historic main street and scenic harbor', url: '/riomaggiore/' },
    ],
  }

  // Simplified main nav structure for luxury travel site
  const simplifiedMainNav = [
    { title: 'Home', url: '/' },
    villagesNav,
    { title: 'Hiking', url: '/cinque-terre/hiking/' },
    { title: 'Restaurants', url: '/restaurants/' },
    { title: 'Hotels', url: '/cinque-terre/hotels/' },
    { title: 'Getting Here', url: '/transport/' },
  ]

  // Footer navigation from sitemap
  const footerNav = [
    {
      title: 'Villages',
      links: [
        { title: 'Monterosso al Mare', url: '/monterosso/' },
        { title: 'Vernazza', url: '/vernazza/' },
        { title: 'Corniglia', url: '/corniglia/' },
        { title: 'Manarola', url: '/manarola/' },
        { title: 'Riomaggiore', url: '/riomaggiore/' },
      ],
    },
    {
      title: 'Plan Your Trip',
      links: [
        { title: 'Getting Here', url: '/transport/' },
        { title: 'Hotels & Accommodations', url: '/cinque-terre/hotels/' },
        { title: 'Best Restaurants', url: '/restaurants/' },
        { title: 'Weather & Best Time', url: '/cinque-terre/weather/' },
        { title: 'Hiking Trails', url: '/cinque-terre/hiking/' },
      ],
    },
    {
      title: 'Explore',
      links: [
        { title: 'Beaches', url: '/cinque-terre/beaches/' },
        { title: 'Boat Tours', url: '/cinque-terre/boat-tours/' },
        { title: 'Events & Festivals', url: '/cinque-terre/events/' },
        { title: 'Local Cuisine', url: '/cinque-terre/insights/' },
        { title: 'Photo Spots', url: '/cinque-terre/sights/' },
      ],
    },
    {
      title: 'Resources',
      links: [
        { title: 'Travel Guide', url: '/cinque-terre/overview/' },
        { title: 'FAQ', url: '/cinque-terre/faq/' },
        { title: 'Maps', url: '/cinque-terre/maps/' },
        { title: 'Blog', url: '/cinque-terre/blog/' },
      ],
    },
  ]

  // Social links
  const socialLinks = [
    { platform: 'instagram' as const, url: 'https://www.instagram.com/cinqueterretravel', label: 'Follow us on Instagram' },
    { platform: 'facebook' as const, url: 'https://www.facebook.com/cinqueterretravel', label: 'Like us on Facebook' },
  ]

  // CTA button for header
  const ctaButton = {
    text: 'Plan Your Trip',
    url: '/cinque-terre/overview/',
    variant: 'primary' as const,
  }

  // Legal links
  const legalLinks = [
    { title: 'Privacy Policy', url: '/privacy/' },
    { title: 'Terms of Service', url: '/terms/' },
    { title: 'Cookie Policy', url: '/cookies/' },
  ]

  return {
    $schema: '../../../packages/site-builder/src/schemas/navigation-config.json',
    main_nav: simplifiedMainNav,
    footer_nav: footerNav,
    social_links: socialLinks,
    cta_button: ctaButton,
    legal_links: legalLinks,
  }
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main() {
  console.log('\n' + '═'.repeat(60))
  console.log('  cinqueterre.travel Navigation & Theme Generation')
  console.log('═'.repeat(60))

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    console.log(`\n📁 Creating config directory: ${CONFIG_DIR}`)
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  // Load sitemap
  const sitemapPath = join(CONTENT_DIR, 'sitemap.json')
  console.log(`\n📖 Loading sitemap from: ${sitemapPath}`)

  if (!existsSync(sitemapPath)) {
    console.error('❌ sitemap.json not found!')
    process.exit(1)
  }

  const sitemap: SitemapData = JSON.parse(readFileSync(sitemapPath, 'utf-8'))
  console.log(`   Found ${sitemap.pages.length} top-level pages`)

  // Generate navigation config
  console.log('\n🧭 Generating navigation configuration...')
  const navigationConfig = generateNavigationConfig(sitemap)

  // Write site.json
  const siteJsonPath = join(CONFIG_DIR, 'site.json')
  console.log(`\n💾 Writing site.json (Black Tomato Dark Theme)`)
  writeFileSync(siteJsonPath, JSON.stringify(siteConfig, null, 2))
  console.log(`   ✓ ${siteJsonPath}`)

  // Write navigation.json
  const navJsonPath = join(CONFIG_DIR, 'navigation.json')
  console.log(`\n💾 Writing navigation.json`)
  writeFileSync(navJsonPath, JSON.stringify(navigationConfig, null, 2))
  console.log(`   ✓ ${navJsonPath}`)

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('✨ Generation complete!')
  console.log('')
  console.log('Generated files:')
  console.log(`  • ${siteJsonPath}`)
  console.log(`  • ${navJsonPath}`)
  console.log('')
  console.log('Theme: Black Tomato Dark Luxury')
  console.log('  • Background: #0a0a0a (near black)')
  console.log('  • Brand color: #f97316 (orange)')
  console.log('  • Font: Playfair Display (display), Inter (body)')
  console.log('')
  console.log('Navigation:')
  console.log(`  • Main nav: ${navigationConfig.main_nav.length} items`)
  console.log(`  • Footer nav: ${navigationConfig.footer_nav.length} sections`)
  console.log(`  • Social links: ${navigationConfig.social_links.length}`)
  console.log('')
  console.log('Next step: tsx scripts/batch-generate-website.ts')
  console.log('')
}

main().catch(err => {
  console.error('Generation failed:', err)
  process.exit(1)
})
