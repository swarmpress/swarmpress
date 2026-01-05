/**
 * Preview API endpoint
 * Renders page sections with exact Black Tomato styling
 *
 * Design System:
 * - Fonts: Cormorant Garamond (serif/display), Inter (sans)
 * - Colors: Teal accent (#0d9488), Navy footer (#0a1628), White backgrounds
 * - Style: Clean, luxury travel aesthetic
 */

import type { APIRoute } from 'astro'
import * as fs from 'fs'
import * as path from 'path'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'
const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6' // Cinqueterre.travel

// Local content path for development
const LOCAL_CONTENT_PATH = '/Users/drietsch/agentpress/cinqueterre.travel/content/pages'

interface Section {
  id: string
  type: string
  variant?: string
  order: number
  content: Record<string, unknown>
}

// =============================================================================
// BLACK TOMATO DESIGN TOKENS
// =============================================================================

const BT = {
  // Colors
  teal: '#0d9488',
  tealHover: '#0f766e',
  navy: '#0a1628',
  navyLight: '#0f1d32',
  charcoal: '#1a1a2e',
  grayDark: '#374151',
  grayMid: '#6b7280',
  grayLight: '#9ca3af',
  grayLighter: '#e5e7eb',
  cream: '#fafaf9',
  white: '#ffffff',

  // Typography
  fontSerif: "'Cormorant Garamond', Georgia, serif",
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",

  // Gradients
  heroGradient: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 100%)',
  cardGradient: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)',
}

// =============================================================================
// LOCAL FILE FUNCTIONS (Development Mode)
// =============================================================================

function loadPageFromLocalFile(pagePath: string): Section[] {
  // Normalize path - handle 'index', 'en/index', etc.
  let normalizedPath = pagePath
  if (!normalizedPath.endsWith('.json')) {
    normalizedPath = normalizedPath + '.json'
  }
  if (!normalizedPath.includes('/')) {
    normalizedPath = normalizedPath // index.json at root
  }

  const filePath = path.join(LOCAL_CONTENT_PATH, normalizedPath)

  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[Preview] File not found: ${filePath}`)
      return []
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const pageData = JSON.parse(content)

    // Convert body array to sections with order
    const body = pageData.body || []
    return body.map((section: Record<string, unknown>, index: number) => ({
      id: section.id as string || `section-${index}`,
      type: section.type as string || 'unknown',
      variant: section.variant as string | undefined,
      order: index,
      content: section, // The entire section object IS the content
    }))
  } catch (error) {
    console.error(`[Preview] Error loading page: ${filePath}`, error)
    return []
  }
}

async function fetchPageSections(pagePath: string): Promise<Section[]> {
  // In development, try local files first
  const localSections = loadPageFromLocalFile(pagePath)
  if (localSections.length > 0) {
    console.log(`[Preview] Loaded ${localSections.length} sections from local file`)
    return localSections
  }

  // Fall back to API
  const params = encodeURIComponent(JSON.stringify({
    json: { websiteId: WEBSITE_ID, pagePath }
  }))

  const response = await fetch(
    `${API_URL}/api/trpc/github.getPageSections?input=${params}`,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ceo:admin@swarm.press',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch sections: ${response.status}`)
  }

  const data = await response.json()
  return data.result?.data?.json?.sections || []
}

function getLocalizedValue(value: unknown, locale = 'en'): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && locale in value) {
    return (value as Record<string, string>)[locale]
  }
  if (value && typeof value === 'object') {
    const firstValue = Object.values(value)[0]
    return typeof firstValue === 'string' ? firstValue : ''
  }
  return ''
}

// =============================================================================
// BLACK TOMATO SECTION RENDERERS
// =============================================================================

function renderHeroSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const subtitle = getLocalizedValue(content.subtitle)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const cta = content.cta as { text?: unknown; url?: string } | undefined
  const image = content.image || content.backgroundImage

  return `
    <section class="bt-hero">
      ${image ? `
        <div class="bt-hero-bg">
          <img src="${image}" alt="" />
          <div class="bt-hero-overlay"></div>
        </div>
      ` : `
        <div class="bt-hero-bg bt-hero-bg-fallback"></div>
      `}
      <div class="bt-hero-content">
        ${eyebrow ? `<p class="bt-eyebrow">${eyebrow}</p>` : ''}
        <h1 class="bt-hero-title">${title || 'Discover Your Journey'}</h1>
        ${subtitle ? `<p class="bt-hero-subtitle">${subtitle}</p>` : ''}
        ${cta ? `<a href="${cta.url || '#'}" class="bt-btn bt-btn-primary">${getLocalizedValue(cta.text) || 'Explore'}</a>` : ''}
      </div>
    </section>
  `
}

function renderFeatureSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const subtitle = getLocalizedValue(content.subtitle)
  const features = (content.features || []) as Array<{
    icon?: string
    title?: unknown
    description?: unknown
    image?: string
    link?: string
  }>

  return `
    <section class="bt-section bt-section-white">
      <div class="bt-container">
        <div class="bt-section-header">
          ${eyebrow ? `<p class="bt-eyebrow bt-eyebrow-dark">${eyebrow}</p>` : ''}
          ${title ? `<h2 class="bt-section-title">${title}</h2>` : ''}
          ${subtitle ? `<p class="bt-section-subtitle">${subtitle}</p>` : ''}
        </div>
        <div class="bt-card-grid">
          ${features.map(feature => `
            <a href="${feature.link || '#'}" class="bt-card">
              <div class="bt-card-image">
                ${feature.image
                  ? `<img src="${feature.image}" alt="${getLocalizedValue(feature.title)}" />`
                  : `<div class="bt-card-placeholder"></div>`
                }
                <div class="bt-card-overlay"></div>
              </div>
              <div class="bt-card-content">
                <h3 class="bt-card-title">${getLocalizedValue(feature.title)}</h3>
                ${feature.description ? `<p class="bt-card-desc">${getLocalizedValue(feature.description)}</p>` : ''}
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderStatsSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const stats = (content.stats || []) as Array<{ value?: unknown; label?: unknown }>

  return `
    <section class="bt-section bt-section-cream">
      <div class="bt-container">
        ${eyebrow ? `<p class="bt-eyebrow bt-eyebrow-dark bt-text-center">${eyebrow}</p>` : ''}
        ${title ? `<h2 class="bt-section-title bt-text-center">${title}</h2>` : ''}
        <div class="bt-stats-grid">
          ${stats.map(stat => `
            <div class="bt-stat">
              <div class="bt-stat-value">${getLocalizedValue(stat.value)}</div>
              <div class="bt-stat-label">${getLocalizedValue(stat.label)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderContentSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const bodyContent = getLocalizedValue(content.content)
  const image = content.image as string | undefined
  const reverse = section.variant === 'reverse' || content.reverse

  return `
    <section class="bt-section bt-section-white">
      <div class="bt-container">
        <div class="bt-split ${reverse ? 'bt-split-reverse' : ''}">
          <div class="bt-split-text">
            ${eyebrow ? `<p class="bt-eyebrow bt-eyebrow-dark">${eyebrow}</p>` : ''}
            ${title ? `<h2 class="bt-content-title">${title}</h2>` : ''}
            <div class="bt-prose">
              ${bodyContent ? bodyContent.split('\n\n').map(p =>
                `<p>${p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`
              ).join('') : ''}
            </div>
          </div>
          ${image ? `
            <div class="bt-split-image">
              <img src="${image}" alt="${title || ''}" />
            </div>
          ` : ''}
        </div>
      </div>
    </section>
  `
}

function renderTestimonialSection(section: Section): string {
  const content = section.content || {}
  const quote = getLocalizedValue(content.quote)
  const author = getLocalizedValue(content.author)
  const role = getLocalizedValue(content.role)
  const image = content.image as string | undefined

  return `
    <section class="bt-testimonial">
      ${image ? `
        <div class="bt-testimonial-bg">
          <img src="${image}" alt="" />
          <div class="bt-testimonial-overlay"></div>
        </div>
      ` : ''}
      <div class="bt-testimonial-content">
        <svg class="bt-quote-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
        </svg>
        <blockquote class="bt-quote">${quote || 'Your testimonial here'}</blockquote>
        <div class="bt-quote-author">
          <span class="bt-quote-name">${author || 'Guest Name'}</span>
          ${role ? `<span class="bt-quote-role">${role}</span>` : ''}
        </div>
      </div>
    </section>
  `
}

function renderCTASection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const subtitle = getLocalizedValue(content.subtitle)
  const buttons = (content.buttons || []) as Array<{ text?: unknown; url?: string; variant?: string }>
  const image = content.image as string | undefined

  return `
    <section class="bt-cta">
      ${image ? `
        <div class="bt-cta-bg">
          <img src="${image}" alt="" />
          <div class="bt-cta-overlay"></div>
        </div>
      ` : ''}
      <div class="bt-cta-content">
        <h2 class="bt-cta-title">${title || 'Start Your Journey'}</h2>
        ${subtitle ? `<p class="bt-cta-subtitle">${subtitle}</p>` : ''}
        <div class="bt-cta-buttons">
          ${buttons.map(btn => `
            <a href="${btn.url || '#'}" class="bt-btn ${btn.variant === 'secondary' ? 'bt-btn-outline' : 'bt-btn-primary'}">
              ${getLocalizedValue(btn.text) || 'Learn More'}
            </a>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderFAQSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const faqs = (content.faqs || content.items || []) as Array<{ question?: unknown; answer?: unknown; q?: unknown; a?: unknown }>

  return `
    <section class="bt-section bt-section-cream">
      <div class="bt-container bt-container-narrow">
        ${eyebrow ? `<p class="bt-eyebrow bt-eyebrow-dark bt-text-center">${eyebrow}</p>` : ''}
        ${title ? `<h2 class="bt-section-title bt-text-center">${title}</h2>` : ''}
        <div class="bt-faq-list">
          ${faqs.map((faq, i) => `
            <details class="bt-faq-item" ${i === 0 ? 'open' : ''}>
              <summary class="bt-faq-question">
                <span>${getLocalizedValue(faq.question || faq.q)}</span>
                <svg class="bt-faq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </summary>
              <div class="bt-faq-answer">
                ${getLocalizedValue(faq.answer || faq.a)}
              </div>
            </details>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderGallerySection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const images = (content.images || []) as Array<{ src?: string; alt?: string; caption?: string }>

  return `
    <section class="bt-section bt-section-white">
      <div class="bt-container">
        ${eyebrow ? `<p class="bt-eyebrow bt-eyebrow-dark bt-text-center">${eyebrow}</p>` : ''}
        ${title ? `<h2 class="bt-section-title bt-text-center">${title}</h2>` : ''}
        <div class="bt-gallery-grid">
          ${images.map(img => `
            <div class="bt-gallery-item">
              <img src="${img.src || 'https://via.placeholder.com/600x400'}" alt="${img.alt || ''}" />
              ${img.caption ? `<p class="bt-gallery-caption">${img.caption}</p>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

// =============================================================================
// NEW BLACK TOMATO SECTION RENDERERS
// =============================================================================

function renderDestinationsRow(section: Section): string {
  const content = section.content || {}
  const destinations = (content.destinations || []) as Array<{
    title?: unknown
    image?: string
    url?: string
  }>

  return `
    <section class="bt-destinations-row">
      <div class="bt-destinations-grid">
        ${destinations.map(dest => `
          <a href="${dest.url || '#'}" class="bt-dest-card">
            <div class="bt-dest-image">
              ${dest.image
                ? `<img src="${dest.image}" alt="${getLocalizedValue(dest.title)}" />`
                : `<div class="bt-dest-placeholder"></div>`
              }
              <div class="bt-dest-overlay"></div>
            </div>
            <div class="bt-dest-title">${getLocalizedValue(dest.title)}</div>
          </a>
        `).join('')}
      </div>
    </section>
  `
}

function renderTextBlock(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const bodyContent = getLocalizedValue(content.content)

  return `
    <section class="bt-text-block">
      <div class="bt-container bt-container-narrow">
        ${title ? `<h2 class="bt-text-block-title">${title}</h2>` : ''}
        ${bodyContent ? `<p class="bt-text-block-content">${bodyContent}</p>` : ''}
      </div>
    </section>
  `
}

function renderIconFeatures(section: Section): string {
  const content = section.content || {}
  const features = (content.features || []) as Array<{
    icon?: string
    title?: unknown
    description?: unknown
  }>

  const iconMap: Record<string, string> = {
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="1,6 1,22 8,18 16,22 23,18 23,2 16,6 8,2"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67,10.94,4.61a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06a5.5,5.5,0,0,0,0-7.78Z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>',
  }

  return `
    <section class="bt-icon-features">
      <div class="bt-container">
        <div class="bt-icon-grid">
          ${features.map(feature => `
            <div class="bt-icon-feature">
              <div class="bt-icon-wrapper">
                ${iconMap[feature.icon || 'star'] || iconMap.star}
              </div>
              <h3 class="bt-icon-title">${getLocalizedValue(feature.title)}</h3>
              <p class="bt-icon-desc">${getLocalizedValue(feature.description)}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderQuoteSection(section: Section): string {
  const content = section.content || {}
  const quote = getLocalizedValue(content.quote)
  const attribution = getLocalizedValue(content.attribution)
  const image = content.backgroundImage as string | undefined
  const cta = content.cta as { text?: unknown; url?: string } | undefined

  return `
    <section class="bt-quote-cta">
      ${image ? `
        <div class="bt-quote-cta-bg">
          <img src="${image}" alt="" />
          <div class="bt-quote-cta-overlay"></div>
        </div>
      ` : ''}
      <div class="bt-quote-cta-content">
        <h2 class="bt-quote-cta-title">${quote || 'We Travel to Pursue'}</h2>
        ${attribution ? `<p class="bt-quote-cta-attribution">${attribution}</p>` : ''}
        ${cta ? `<a href="${cta.url || '#'}" class="bt-btn bt-btn-outline">${getLocalizedValue(cta.text) || 'Learn More'}</a>` : ''}
      </div>
    </section>
  `
}

function renderHeroSectionWithVariant(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const subtitle = getLocalizedValue(content.subtitle)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const cta = content.cta as { text?: unknown; url?: string } | undefined
  const image = content.image || content.backgroundImage
  const variant = section.variant || 'fullscreen'

  const isDarkMedium = variant === 'dark-medium'

  return `
    <section class="bt-hero ${isDarkMedium ? 'bt-hero-medium' : ''}">
      ${image ? `
        <div class="bt-hero-bg">
          <img src="${image}" alt="" />
          <div class="bt-hero-overlay ${isDarkMedium ? 'bt-hero-overlay-dark' : ''}"></div>
        </div>
      ` : `
        <div class="bt-hero-bg bt-hero-bg-fallback"></div>
      `}
      <div class="bt-hero-content">
        ${eyebrow ? `<p class="bt-eyebrow">${eyebrow}</p>` : ''}
        <h1 class="bt-hero-title">${title || 'Discover Your Journey'}</h1>
        ${subtitle ? `<p class="bt-hero-subtitle">${subtitle}</p>` : ''}
        ${cta ? `<a href="${cta.url || '#'}" class="bt-btn bt-btn-primary">${getLocalizedValue(cta.text) || 'Explore'}</a>` : ''}
      </div>
    </section>
  `
}

function renderContentSectionWithVariant(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const subtitle = getLocalizedValue(content.subtitle)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const bodyContent = getLocalizedValue(content.content)
  const image = content.image as string | undefined
  const appImage = content.appImage as string | undefined
  const cta = content.cta as { text?: unknown; url?: string } | undefined
  const variant = section.variant || 'split'

  const isAppVariant = variant === 'split-with-app'
  const displayImage = isAppVariant ? appImage : image

  return `
    <section class="bt-section bt-section-white">
      <div class="bt-container">
        <div class="bt-split ${isAppVariant ? 'bt-split-app' : ''}">
          ${displayImage ? `
            <div class="bt-split-image ${isAppVariant ? 'bt-app-mockup' : ''}">
              <img src="${displayImage}" alt="${title || ''}" />
            </div>
          ` : ''}
          <div class="bt-split-text">
            ${eyebrow ? `<p class="bt-eyebrow bt-eyebrow-dark">${eyebrow}</p>` : ''}
            ${subtitle ? `<p class="bt-content-subtitle">${subtitle}</p>` : ''}
            ${title ? `<h2 class="bt-content-title">${title}</h2>` : ''}
            <div class="bt-prose">
              ${bodyContent ? bodyContent.split('\n\n').map((p: string) =>
                `<p>${p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`
              ).join('') : ''}
            </div>
            ${cta ? `<a href="${cta.url || '#'}" class="bt-btn bt-btn-primary bt-btn-mt">${getLocalizedValue(cta.text) || 'Learn More'}</a>` : ''}
          </div>
        </div>
      </div>
    </section>
  `
}

function renderSection(section: Section): string {
  const type = section.type?.toLowerCase() || ''
  const variant = section.variant || ''

  // New Black Tomato specific sections
  if (type === 'destinations-row') return renderDestinationsRow(section)
  if (type === 'text-block') return renderTextBlock(section)
  if (type === 'icon-features') return renderIconFeatures(section)
  if (type === 'quote-section') return renderQuoteSection(section)

  // Enhanced existing sections with variant support
  if (type.includes('hero')) {
    if (variant === 'dark-medium') return renderHeroSectionWithVariant(section)
    return renderHeroSection(section)
  }
  if (type.includes('content')) {
    if (variant === 'split-with-app') return renderContentSectionWithVariant(section)
    return renderContentSection(section)
  }
  if (type.includes('feature')) return renderFeatureSection(section)
  if (type.includes('stats')) return renderStatsSection(section)
  if (type.includes('testimonial')) return renderTestimonialSection(section)
  if (type.includes('cta')) return renderCTASection(section)
  if (type.includes('faq')) return renderFAQSection(section)
  if (type.includes('gallery')) return renderGallerySection(section)

  // Default: show section type for unknown sections
  return `
    <section class="bt-section bt-section-cream">
      <div class="bt-container">
        <div class="bt-unknown-section">
          <p class="bt-unknown-type">${section.type} (${section.variant || 'default'})</p>
          <pre class="bt-unknown-content">${JSON.stringify(section.content, null, 2)}</pre>
        </div>
      </div>
    </section>
  `
}

// =============================================================================
// BLACK TOMATO CSS STYLES
// =============================================================================

const BLACK_TOMATO_CSS = `
/* ==========================================================================
   BLACK TOMATO DESIGN SYSTEM
   Luxury travel aesthetic - clean, sophisticated, timeless
   ========================================================================== */

/* Fonts */
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap');

/* Reset & Base */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: ${BT.fontSans};
  color: ${BT.charcoal};
  background: ${BT.white};
  line-height: 1.6;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
}

a {
  text-decoration: none;
  color: inherit;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  font-family: ${BT.fontSerif};
  font-weight: 500;
  line-height: 1.2;
  color: ${BT.charcoal};
}

/* Layout */
.bt-container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
}

.bt-container-narrow {
  max-width: 800px;
}

.bt-text-center {
  text-align: center;
}

/* Sections */
.bt-section {
  padding: 80px 0;
}

@media (min-width: 768px) {
  .bt-section {
    padding: 120px 0;
  }
}

.bt-section-white {
  background: ${BT.white};
}

.bt-section-cream {
  background: ${BT.cream};
}

.bt-section-header {
  max-width: 700px;
  margin: 0 auto 60px;
  text-align: center;
}

.bt-section-title {
  font-size: 2.5rem;
  font-weight: 500;
  color: ${BT.charcoal};
  margin-bottom: 16px;
}

@media (min-width: 768px) {
  .bt-section-title {
    font-size: 3rem;
  }
}

.bt-section-subtitle {
  font-size: 1.125rem;
  color: ${BT.grayMid};
  line-height: 1.7;
}

/* Eyebrow */
.bt-eyebrow {
  font-family: ${BT.fontSans};
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: ${BT.white};
  margin-bottom: 16px;
}

.bt-eyebrow-dark {
  color: ${BT.teal};
}

/* Buttons */
.bt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ${BT.fontSans};
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 16px 32px;
  border-radius: 4px;
  transition: all 0.3s ease;
  cursor: pointer;
  border: none;
}

.bt-btn-primary {
  background: ${BT.teal};
  color: ${BT.white};
}

.bt-btn-primary:hover {
  background: ${BT.tealHover};
}

.bt-btn-outline {
  background: transparent;
  color: ${BT.white};
  border: 2px solid ${BT.white};
}

.bt-btn-outline:hover {
  background: ${BT.white};
  color: ${BT.charcoal};
}

/* ==========================================================================
   HERO SECTION
   ========================================================================== */

.bt-hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.bt-hero-bg {
  position: absolute;
  inset: 0;
}

.bt-hero-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bt-hero-bg-fallback {
  background: linear-gradient(135deg, ${BT.navy} 0%, ${BT.navyLight} 100%);
}

.bt-hero-overlay {
  position: absolute;
  inset: 0;
  background: ${BT.heroGradient};
}

.bt-hero-content {
  position: relative;
  z-index: 10;
  text-align: center;
  padding: 40px 24px;
  max-width: 900px;
}

.bt-hero-title {
  font-family: ${BT.fontSerif};
  font-size: 3rem;
  font-weight: 500;
  color: ${BT.white};
  line-height: 1.1;
  margin-bottom: 24px;
}

@media (min-width: 768px) {
  .bt-hero-title {
    font-size: 4.5rem;
  }
}

@media (min-width: 1024px) {
  .bt-hero-title {
    font-size: 5.5rem;
  }
}

.bt-hero-subtitle {
  font-size: 1.25rem;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 40px;
  line-height: 1.6;
  max-width: 600px;
  margin-left: auto;
  margin-right: auto;
}

/* ==========================================================================
   CARD GRID (Destinations/Features)
   ========================================================================== */

.bt-card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

@media (min-width: 640px) {
  .bt-card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .bt-card-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }
}

.bt-card {
  display: block;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: ${BT.white};
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.bt-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
}

.bt-card-image {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
}

.bt-card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.bt-card:hover .bt-card-image img {
  transform: scale(1.05);
}

.bt-card-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, ${BT.grayLighter} 0%, ${BT.cream} 100%);
}

.bt-card-overlay {
  position: absolute;
  inset: 0;
  background: ${BT.cardGradient};
  opacity: 0.6;
  transition: opacity 0.3s ease;
}

.bt-card:hover .bt-card-overlay {
  opacity: 0.8;
}

.bt-card-content {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 24px;
  color: ${BT.white};
}

.bt-card-title {
  font-family: ${BT.fontSerif};
  font-size: 1.5rem;
  font-weight: 500;
  margin-bottom: 8px;
  color: ${BT.white};
}

.bt-card-desc {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.5;
}

/* ==========================================================================
   STATS SECTION
   ========================================================================== */

.bt-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 40px;
  margin-top: 60px;
}

@media (min-width: 768px) {
  .bt-stats-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.bt-stat {
  text-align: center;
}

.bt-stat-value {
  font-family: ${BT.fontSerif};
  font-size: 3rem;
  font-weight: 600;
  color: ${BT.teal};
  line-height: 1;
  margin-bottom: 12px;
}

@media (min-width: 768px) {
  .bt-stat-value {
    font-size: 3.5rem;
  }
}

.bt-stat-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: ${BT.grayMid};
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ==========================================================================
   CONTENT / SPLIT SECTION
   ========================================================================== */

.bt-split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 48px;
  align-items: center;
}

@media (min-width: 768px) {
  .bt-split {
    grid-template-columns: 1fr 1fr;
    gap: 80px;
  }
}

.bt-split-reverse {
  direction: rtl;
}

.bt-split-reverse > * {
  direction: ltr;
}

.bt-split-text {
  max-width: 540px;
}

.bt-content-title {
  font-size: 2rem;
  font-weight: 500;
  margin-bottom: 24px;
}

@media (min-width: 768px) {
  .bt-content-title {
    font-size: 2.5rem;
  }
}

.bt-prose {
  color: ${BT.grayDark};
}

.bt-prose p {
  margin-bottom: 16px;
  line-height: 1.7;
}

.bt-prose strong {
  font-weight: 600;
  color: ${BT.charcoal};
}

.bt-split-image {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.bt-split-image img {
  width: 100%;
  height: auto;
}

/* ==========================================================================
   TESTIMONIAL SECTION
   ========================================================================== */

.bt-testimonial {
  position: relative;
  padding: 120px 24px;
  min-height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${BT.navy};
}

.bt-testimonial-bg {
  position: absolute;
  inset: 0;
}

.bt-testimonial-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bt-testimonial-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 22, 40, 0.85);
}

.bt-testimonial-content {
  position: relative;
  z-index: 10;
  max-width: 800px;
  text-align: center;
}

.bt-quote-icon {
  width: 48px;
  height: 48px;
  color: ${BT.teal};
  margin: 0 auto 32px;
  opacity: 0.6;
}

.bt-quote {
  font-family: ${BT.fontSerif};
  font-size: 1.5rem;
  font-weight: 400;
  font-style: italic;
  color: ${BT.white};
  line-height: 1.6;
  margin-bottom: 32px;
}

@media (min-width: 768px) {
  .bt-quote {
    font-size: 2rem;
  }
}

.bt-quote-author {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bt-quote-name {
  font-family: ${BT.fontSans};
  font-size: 1rem;
  font-weight: 600;
  color: ${BT.white};
}

.bt-quote-role {
  font-size: 0.875rem;
  color: ${BT.teal};
}

/* ==========================================================================
   CTA SECTION
   ========================================================================== */

.bt-cta {
  position: relative;
  padding: 100px 24px;
  text-align: center;
  background: ${BT.teal};
}

.bt-cta-bg {
  position: absolute;
  inset: 0;
}

.bt-cta-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bt-cta-overlay {
  position: absolute;
  inset: 0;
  background: rgba(13, 148, 136, 0.9);
}

.bt-cta-content {
  position: relative;
  z-index: 10;
  max-width: 700px;
  margin: 0 auto;
}

.bt-cta-title {
  font-size: 2.5rem;
  font-weight: 500;
  color: ${BT.white};
  margin-bottom: 16px;
}

@media (min-width: 768px) {
  .bt-cta-title {
    font-size: 3rem;
  }
}

.bt-cta-subtitle {
  font-size: 1.125rem;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 32px;
  line-height: 1.6;
}

.bt-cta-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}

/* ==========================================================================
   FAQ SECTION
   ========================================================================== */

.bt-faq-list {
  margin-top: 48px;
}

.bt-faq-item {
  border-bottom: 1px solid ${BT.grayLighter};
}

.bt-faq-item:first-child {
  border-top: 1px solid ${BT.grayLighter};
}

.bt-faq-question {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 0;
  cursor: pointer;
  font-family: ${BT.fontSerif};
  font-size: 1.25rem;
  font-weight: 500;
  color: ${BT.charcoal};
  list-style: none;
}

.bt-faq-question::-webkit-details-marker {
  display: none;
}

.bt-faq-icon {
  width: 24px;
  height: 24px;
  color: ${BT.teal};
  flex-shrink: 0;
  margin-left: 16px;
  transition: transform 0.3s ease;
}

.bt-faq-item[open] .bt-faq-icon {
  transform: rotate(45deg);
}

.bt-faq-answer {
  padding: 0 0 24px;
  color: ${BT.grayDark};
  line-height: 1.7;
}

/* ==========================================================================
   GALLERY SECTION
   ========================================================================== */

.bt-gallery-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 48px;
}

@media (min-width: 768px) {
  .bt-gallery-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }
}

@media (min-width: 1024px) {
  .bt-gallery-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.bt-gallery-item {
  border-radius: 8px;
  overflow: hidden;
}

.bt-gallery-item img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.bt-gallery-item:hover img {
  transform: scale(1.05);
}

.bt-gallery-caption {
  padding: 12px;
  font-size: 0.875rem;
  color: ${BT.grayMid};
  text-align: center;
}

/* ==========================================================================
   DESTINATIONS ROW (5-column grid like Black Tomato)
   ========================================================================== */

.bt-destinations-row {
  padding: 0;
}

.bt-destinations-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

@media (min-width: 768px) {
  .bt-destinations-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

.bt-dest-card {
  display: block;
  position: relative;
  overflow: hidden;
}

.bt-dest-image {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
}

.bt-dest-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s ease;
}

.bt-dest-card:hover .bt-dest-image img {
  transform: scale(1.08);
}

.bt-dest-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, ${BT.grayLighter} 0%, ${BT.cream} 100%);
}

.bt-dest-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 50%, transparent 100%);
}

.bt-dest-title {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 24px 16px;
  font-family: ${BT.fontSerif};
  font-size: 1.25rem;
  font-weight: 500;
  color: ${BT.white};
  text-align: center;
}

/* ==========================================================================
   TEXT BLOCK (Centered heading + paragraph)
   ========================================================================== */

.bt-text-block {
  padding: 80px 24px;
  text-align: center;
  background: ${BT.white};
}

@media (min-width: 768px) {
  .bt-text-block {
    padding: 100px 24px;
  }
}

.bt-text-block-title {
  font-family: ${BT.fontSerif};
  font-size: 2rem;
  font-weight: 500;
  color: ${BT.charcoal};
  margin-bottom: 24px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

@media (min-width: 768px) {
  .bt-text-block-title {
    font-size: 2.5rem;
  }
}

.bt-text-block-content {
  font-size: 1rem;
  color: ${BT.grayMid};
  line-height: 1.8;
  max-width: 700px;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .bt-text-block-content {
    font-size: 1.125rem;
  }
}

/* ==========================================================================
   ICON FEATURES (3-column with icons)
   ========================================================================== */

.bt-icon-features {
  padding: 80px 24px;
  background: ${BT.cream};
}

@media (min-width: 768px) {
  .bt-icon-features {
    padding: 100px 24px;
  }
}

.bt-icon-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 48px;
}

@media (min-width: 768px) {
  .bt-icon-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 60px;
  }
}

.bt-icon-feature {
  text-align: center;
}

.bt-icon-wrapper {
  width: 64px;
  height: 64px;
  margin: 0 auto 24px;
  color: ${BT.teal};
}

.bt-icon-wrapper svg {
  width: 100%;
  height: 100%;
}

.bt-icon-title {
  font-family: ${BT.fontSerif};
  font-size: 1.5rem;
  font-weight: 500;
  color: ${BT.charcoal};
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.bt-icon-desc {
  font-size: 0.9375rem;
  color: ${BT.grayMid};
  line-height: 1.7;
}

/* ==========================================================================
   QUOTE CTA SECTION (Dark with background)
   ========================================================================== */

.bt-quote-cta {
  position: relative;
  padding: 120px 24px;
  min-height: 450px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${BT.navy};
}

.bt-quote-cta-bg {
  position: absolute;
  inset: 0;
}

.bt-quote-cta-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bt-quote-cta-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 22, 40, 0.75);
}

.bt-quote-cta-content {
  position: relative;
  z-index: 10;
  text-align: center;
  max-width: 800px;
}

.bt-quote-cta-title {
  font-family: ${BT.fontSerif};
  font-size: 2.5rem;
  font-weight: 500;
  color: ${BT.white};
  margin-bottom: 24px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

@media (min-width: 768px) {
  .bt-quote-cta-title {
    font-size: 3.5rem;
  }
}

.bt-quote-cta-attribution {
  font-size: 1.125rem;
  color: rgba(255, 255, 255, 0.8);
  font-style: italic;
  margin-bottom: 40px;
  line-height: 1.6;
}

/* ==========================================================================
   HERO MEDIUM VARIANT (Shorter hero with darker overlay)
   ========================================================================== */

.bt-hero-medium {
  min-height: 60vh;
}

.bt-hero-overlay-dark {
  background: linear-gradient(to bottom, rgba(10,22,40,0.6) 0%, rgba(10,22,40,0.8) 100%);
}

/* ==========================================================================
   SPLIT WITH APP MOCKUP
   ========================================================================== */

.bt-split-app {
  gap: 60px;
}

@media (min-width: 768px) {
  .bt-split-app {
    gap: 100px;
  }
}

.bt-app-mockup {
  max-width: 300px;
  margin: 0 auto;
  border-radius: 24px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.2);
}

.bt-app-mockup img {
  border-radius: 24px;
}

.bt-content-subtitle {
  font-family: ${BT.fontSans};
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: ${BT.teal};
  margin-bottom: 12px;
}

.bt-btn-mt {
  margin-top: 32px;
}

/* ==========================================================================
   UNKNOWN SECTION (Dev)
   ========================================================================== */

.bt-unknown-section {
  padding: 32px;
  background: ${BT.white};
  border-radius: 8px;
  border-left: 4px solid ${BT.teal};
}

.bt-unknown-type {
  font-family: monospace;
  font-size: 0.875rem;
  color: ${BT.grayMid};
  margin-bottom: 16px;
}

.bt-unknown-content {
  font-family: monospace;
  font-size: 0.75rem;
  background: ${BT.cream};
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  color: ${BT.grayDark};
}

/* ==========================================================================
   FOOTER
   ========================================================================== */

.bt-footer {
  background: ${BT.navy};
  color: ${BT.white};
  padding: 80px 24px 40px;
}

.bt-footer-content {
  max-width: 1280px;
  margin: 0 auto;
}

.bt-footer-main {
  display: grid;
  grid-template-columns: 1fr;
  gap: 48px;
  margin-bottom: 60px;
}

@media (min-width: 768px) {
  .bt-footer-main {
    grid-template-columns: 2fr 1fr 1fr 1fr;
  }
}

.bt-footer-brand {
  max-width: 300px;
}

.bt-footer-logo {
  font-family: ${BT.fontSerif};
  font-size: 1.5rem;
  font-weight: 600;
  color: ${BT.white};
  margin-bottom: 16px;
}

.bt-footer-tagline {
  color: ${BT.grayLight};
  font-size: 0.875rem;
  line-height: 1.6;
}

.bt-footer-nav h4 {
  font-family: ${BT.fontSans};
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${BT.white};
  margin-bottom: 20px;
}

.bt-footer-nav ul {
  list-style: none;
}

.bt-footer-nav li {
  margin-bottom: 12px;
}

.bt-footer-nav a {
  color: ${BT.grayLight};
  font-size: 0.875rem;
  transition: color 0.2s ease;
}

.bt-footer-nav a:hover {
  color: ${BT.white};
}

.bt-footer-bottom {
  padding-top: 40px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  text-align: center;
}

@media (min-width: 768px) {
  .bt-footer-bottom {
    flex-direction: row;
    justify-content: space-between;
    text-align: left;
  }
}

.bt-footer-copyright {
  color: ${BT.grayMid};
  font-size: 0.875rem;
}

.bt-footer-legal {
  display: flex;
  gap: 24px;
}

.bt-footer-legal a {
  color: ${BT.grayMid};
  font-size: 0.875rem;
  transition: color 0.2s ease;
}

.bt-footer-legal a:hover {
  color: ${BT.white};
}

/* ==========================================================================
   PREVIEW BANNER (Development Only)
   ========================================================================== */

.bt-preview-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: ${BT.navy};
  color: ${BT.white};
  padding: 10px 24px;
  font-size: 0.75rem;
  text-align: center;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.bt-preview-banner a {
  color: ${BT.teal};
  text-decoration: underline;
}

.bt-preview-banner a:hover {
  color: ${BT.white};
}
`

// =============================================================================
// PAGE RENDERER
// =============================================================================

function renderPage(sections: Section[], pagePath: string): string {
  const sortedSections = [...sections].sort((a, b) => a.order - b.order)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cinque Terre Travel | ${pagePath}</title>
  <style>
    ${BLACK_TOMATO_CSS}
  </style>
</head>
<body>
  <!-- Preview Banner (Development) -->
  <div class="bt-preview-banner">
    <span>Preview Mode</span>
    <span>•</span>
    <span>${pagePath}</span>
    <span>•</span>
    <span>${sections.length} sections</span>
    <a href="/websites/42b7e20d-7f6c-48aa-9e16-f610a84b79a6/site-editor">← Back to Editor</a>
  </div>

  <main style="padding-top: 40px;">
    ${sortedSections.map(s => renderSection(s)).join('\n')}
  </main>

  <footer class="bt-footer">
    <div class="bt-footer-content">
      <div class="bt-footer-main">
        <div class="bt-footer-brand">
          <div class="bt-footer-logo">Cinque Terre Travel</div>
          <p class="bt-footer-tagline">Discover the authentic beauty of Italy's most enchanting coastline. Expertly curated experiences for discerning travelers.</p>
        </div>
        <nav class="bt-footer-nav">
          <h4>Destinations</h4>
          <ul>
            <li><a href="#">Monterosso</a></li>
            <li><a href="#">Vernazza</a></li>
            <li><a href="#">Corniglia</a></li>
            <li><a href="#">Manarola</a></li>
            <li><a href="#">Riomaggiore</a></li>
          </ul>
        </nav>
        <nav class="bt-footer-nav">
          <h4>Experiences</h4>
          <ul>
            <li><a href="#">Hiking Trails</a></li>
            <li><a href="#">Boat Tours</a></li>
            <li><a href="#">Wine Tasting</a></li>
            <li><a href="#">Cooking Classes</a></li>
          </ul>
        </nav>
        <nav class="bt-footer-nav">
          <h4>About</h4>
          <ul>
            <li><a href="#">Our Story</a></li>
            <li><a href="#">Travel Guide</a></li>
            <li><a href="#">Contact</a></li>
            <li><a href="#">FAQ</a></li>
          </ul>
        </nav>
      </div>
      <div class="bt-footer-bottom">
        <p class="bt-footer-copyright">&copy; ${new Date().getFullYear()} Cinque Terre Travel. All rights reserved.</p>
        <div class="bt-footer-legal">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
      </div>
    </div>
  </footer>
</body>
</html>
  `
}

// =============================================================================
// API ROUTE
// =============================================================================

export const GET: APIRoute = async ({ params }) => {
  const path = params.path || 'index'

  try {
    const sections = await fetchPageSections(path)
    const html = renderPage(sections, path)

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Preview Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              background: ${BT.navy};
              color: ${BT.white};
              padding: 60px 24px;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .error {
              max-width: 500px;
              text-align: center;
            }
            h1 {
              font-family: 'Cormorant Garamond', Georgia, serif;
              font-size: 2rem;
              color: ${BT.teal};
              margin-bottom: 16px;
            }
            p {
              color: ${BT.grayLight};
              margin-bottom: 24px;
            }
            pre {
              background: rgba(255,255,255,0.1);
              padding: 16px;
              border-radius: 8px;
              text-align: left;
              font-size: 0.75rem;
              overflow-x: auto;
            }
            a {
              color: ${BT.teal};
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>Preview Error</h1>
            <p>Failed to load page: ${path}</p>
            <pre>${message}</pre>
            <a href="/websites/42b7e20d-7f6c-48aa-9e16-f610a84b79a6/site-editor">← Back to Editor</a>
          </div>
        </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
