/**
 * Preview API endpoint
 * Renders page sections as HTML for preview
 */

import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'
const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6' // Cinqueterre.travel

interface Section {
  id: string
  type: string
  variant?: string
  order: number
  content: Record<string, unknown>
}

async function fetchPageSections(pagePath: string): Promise<Section[]> {
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

function renderHeroSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const subtitle = getLocalizedValue(content.subtitle)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const cta = content.cta as { text?: unknown; url?: string } | undefined
  const image = content.image || content.backgroundImage

  return `
    <section class="relative py-24 px-6 bg-gradient-to-br from-sky-50 to-blue-100 overflow-hidden">
      ${image ? `<div class="absolute inset-0 bg-cover bg-center opacity-20" style="background-image: url('${image}')"></div>` : ''}
      <div class="relative max-w-4xl mx-auto text-center">
        ${eyebrow ? `<p class="text-sky-600 font-medium mb-4 uppercase tracking-wide text-sm">${eyebrow}</p>` : ''}
        <h1 class="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-900 mb-6 leading-tight">${title || 'Hero Title'}</h1>
        ${subtitle ? `<p class="text-xl text-slate-600 mb-8 max-w-2xl mx-auto leading-relaxed">${subtitle}</p>` : ''}
        ${cta ? `<a href="${cta.url || '#'}" class="inline-block bg-sky-600 hover:bg-sky-700 text-white font-semibold px-8 py-3 rounded-lg transition-colors">${getLocalizedValue(cta.text) || 'Learn More'}</a>` : ''}
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
    <section class="py-16 px-6 bg-white">
      <div class="max-w-6xl mx-auto">
        ${eyebrow ? `<p class="text-sky-600 font-medium mb-2 uppercase tracking-wide text-sm text-center">${eyebrow}</p>` : ''}
        ${title ? `<h2 class="text-3xl font-bold text-slate-900 mb-12 text-center">${title}</h2>` : ''}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
          ${stats.map(stat => `
            <div class="text-center">
              <div class="text-4xl font-bold text-sky-600 mb-2">${getLocalizedValue(stat.value)}</div>
              <div class="text-slate-600">${getLocalizedValue(stat.label)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderFeatureSection(section: Section): string {
  const content = section.content || {}
  const title = getLocalizedValue(content.title)
  const eyebrow = getLocalizedValue(content.eyebrow)
  const features = (content.features || []) as Array<{ icon?: string; title?: unknown; description?: unknown }>

  return `
    <section class="py-16 px-6 bg-slate-50">
      <div class="max-w-6xl mx-auto">
        ${eyebrow ? `<p class="text-sky-600 font-medium mb-2 uppercase tracking-wide text-sm text-center">${eyebrow}</p>` : ''}
        ${title ? `<h2 class="text-3xl font-bold text-slate-900 mb-12 text-center">${title}</h2>` : ''}
        <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          ${features.map(feature => `
            <div class="bg-white p-6 rounded-xl shadow-sm">
              ${feature.icon ? `<div class="w-12 h-12 bg-sky-100 rounded-lg flex items-center justify-center mb-4 text-sky-600">📍</div>` : ''}
              <h3 class="text-xl font-semibold text-slate-900 mb-2">${getLocalizedValue(feature.title)}</h3>
              <p class="text-slate-600">${getLocalizedValue(feature.description)}</p>
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

  return `
    <section class="py-16 px-6 bg-white">
      <div class="max-w-6xl mx-auto">
        <div class="grid md:grid-cols-2 gap-12 items-center">
          <div>
            ${eyebrow ? `<p class="text-sky-600 font-medium mb-2 uppercase tracking-wide text-sm">${eyebrow}</p>` : ''}
            ${title ? `<h2 class="text-3xl font-bold text-slate-900 mb-6">${title}</h2>` : ''}
            <div class="prose prose-slate max-w-none">${bodyContent ? bodyContent.replace(/\n\n/g, '</p><p class="mb-4">').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') : ''}</div>
          </div>
          ${image ? `<div><img src="${image}" alt="" class="rounded-xl shadow-lg" /></div>` : ''}
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

  return `
    <section class="py-16 px-6 bg-sky-600 text-white">
      <div class="max-w-4xl mx-auto text-center">
        <svg class="w-12 h-12 mx-auto mb-6 opacity-50" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
        </svg>
        <blockquote class="text-2xl font-medium mb-8 leading-relaxed">${quote || 'Quote text here'}</blockquote>
        <div>
          <div class="font-semibold">${author || 'Author Name'}</div>
          ${role ? `<div class="text-sky-200">${role}</div>` : ''}
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

  return `
    <section class="py-16 px-6 bg-gradient-to-br from-sky-600 to-blue-700 text-white">
      <div class="max-w-4xl mx-auto text-center">
        <h2 class="text-3xl font-bold mb-4">${title || 'Call to Action'}</h2>
        ${subtitle ? `<p class="text-xl text-sky-100 mb-8">${subtitle}</p>` : ''}
        <div class="flex flex-wrap justify-center gap-4">
          ${buttons.map(btn => `
            <a href="${btn.url || '#'}" class="${btn.variant === 'secondary' ? 'bg-white text-sky-600 hover:bg-sky-50' : 'bg-sky-500 hover:bg-sky-400 text-white'} font-semibold px-8 py-3 rounded-lg transition-colors">
              ${getLocalizedValue(btn.text) || 'Button'}
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
  const faqs = (content.faqs || content.items || []) as Array<{ question?: unknown; answer?: unknown; q?: unknown; a?: unknown }>

  return `
    <section class="py-16 px-6 bg-white">
      <div class="max-w-3xl mx-auto">
        ${title ? `<h2 class="text-3xl font-bold text-slate-900 mb-12 text-center">${title}</h2>` : ''}
        <div class="space-y-4">
          ${faqs.map(faq => `
            <details class="group bg-slate-50 rounded-lg">
              <summary class="flex justify-between items-center p-4 cursor-pointer font-medium text-slate-900">
                ${getLocalizedValue(faq.question || faq.q)}
                <span class="text-sky-600">+</span>
              </summary>
              <div class="p-4 pt-0 text-slate-600">${getLocalizedValue(faq.answer || faq.a)}</div>
            </details>
          `).join('')}
        </div>
      </div>
    </section>
  `
}

function renderSection(section: Section): string {
  const type = section.type?.toLowerCase() || ''

  if (type.includes('hero')) return renderHeroSection(section)
  if (type.includes('stats')) return renderStatsSection(section)
  if (type.includes('feature')) return renderFeatureSection(section)
  if (type.includes('content')) return renderContentSection(section)
  if (type.includes('testimonial')) return renderTestimonialSection(section)
  if (type.includes('cta')) return renderCTASection(section)
  if (type.includes('faq')) return renderFAQSection(section)

  // Default: show section type and content as JSON
  return `
    <section class="py-8 px-6 bg-slate-100 border-l-4 border-sky-500">
      <div class="max-w-6xl mx-auto">
        <div class="text-sm font-mono text-slate-500 mb-2">${section.type} (${section.variant || 'default'})</div>
        <pre class="text-xs bg-white p-4 rounded overflow-x-auto">${JSON.stringify(section.content, null, 2)}</pre>
      </div>
    </section>
  `
}

function renderPage(sections: Section[], pagePath: string): string {
  const sortedSections = [...sections].sort((a, b) => a.order - b.order)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview: ${pagePath}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
    body { font-family: 'Inter', system-ui, sans-serif; }
    h1, h2, h3 { font-family: 'Playfair Display', Georgia, serif; }
  </style>
</head>
<body class="bg-white">
  <!-- Preview Banner -->
  <div class="fixed top-0 left-0 right-0 bg-amber-500 text-amber-900 text-center py-2 px-4 z-50 text-sm font-medium">
    🔍 Preview Mode - ${pagePath} - ${sections.length} sections
    <a href="/websites/42b7e20d-7f6c-48aa-9e16-f610a84b79a6/site-editor" class="ml-4 underline hover:no-underline">← Back to Editor</a>
  </div>

  <main class="pt-10">
    ${sortedSections.map(renderSection).join('\n')}
  </main>

  <footer class="py-8 px-6 bg-slate-900 text-slate-400 text-center text-sm">
    Preview generated at ${new Date().toISOString()}
  </footer>
</body>
</html>
  `
}

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
        <head><title>Preview Error</title></head>
        <body style="font-family: system-ui; padding: 2rem;">
          <h1>Preview Error</h1>
          <p>Failed to load page: ${path}</p>
          <pre style="background: #f5f5f5; padding: 1rem; border-radius: 0.5rem;">${message}</pre>
          <a href="/websites/42b7e20d-7f6c-48aa-9e16-f610a84b79a6/site-editor">← Back to Editor</a>
        </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}
