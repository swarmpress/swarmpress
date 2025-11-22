/**
 * Site Builder
 * Generates static sites from database content
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { contentRepository, websiteRepository } from '@swarm-press/backend/db/repositories'
import type { ContentItem, Website } from '@swarm-press/shared'

const execAsync = promisify(exec)

export interface BuildOptions {
  websiteId: string
  outputDir?: string
  siteUrl?: string
}

export interface BuildResult {
  success: boolean
  outputDir?: string
  url?: string
  error?: string
  buildTime?: number
}

/**
 * Build a static site for a website
 */
export async function buildSite(options: BuildOptions): Promise<BuildResult> {
  const startTime = Date.now()

  try {
    console.log(`[SiteBuilder] Starting build for website ${options.websiteId}`)

    // Fetch website configuration
    const website = await websiteRepository.findById(options.websiteId)
    if (!website) {
      return {
        success: false,
        error: `Website ${options.websiteId} not found`,
      }
    }

    // Fetch all published content for this website
    const content = await contentRepository.findAll({
      website_id: options.websiteId,
      status: 'published',
    })

    console.log(`[SiteBuilder] Found ${content.length} published content items`)

    if (content.length === 0) {
      return {
        success: false,
        error: 'No published content found for this website',
      }
    }

    // Create temporary build directory
    const buildDir = options.outputDir || join(process.cwd(), 'build', options.websiteId)
    await mkdir(buildDir, { recursive: true })

    // Generate Astro pages
    await generatePages(website, content, buildDir)

    // Run Astro build
    const siteUrl = options.siteUrl || website.domain || 'https://example.com'
    await runAstroBuild(buildDir, siteUrl)

    const buildTime = Date.now() - startTime

    console.log(`[SiteBuilder] Build completed in ${buildTime}ms`)

    return {
      success: true,
      outputDir: join(buildDir, 'dist'),
      url: siteUrl,
      buildTime,
    }
  } catch (error) {
    console.error('[SiteBuilder] Build failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Generate Astro page files from content items
 */
async function generatePages(
  website: Website,
  content: ContentItem[],
  buildDir: string
): Promise<void> {
  const pagesDir = join(buildDir, 'src', 'pages')
  await mkdir(pagesDir, { recursive: true })

  // Generate index page (list all content)
  const indexContent = generateIndexPage(website, content)
  await writeFile(join(pagesDir, 'index.astro'), indexContent)

  // Generate individual content pages
  for (const item of content) {
    const slug = item.slug || `content-${item.id}`
    const pageContent = generateContentPage(website, item)
    await writeFile(join(pagesDir, `${slug}.astro`), pageContent)
  }

  console.log(`[SiteBuilder] Generated ${content.length + 1} pages`)
}

/**
 * Generate index page listing all content
 */
function generateIndexPage(website: Website, content: ContentItem[]): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro'

const title = '${website.name}'
const description = '${website.description || ''}'
const contentItems = ${JSON.stringify(content.map(c => ({
  id: c.id,
  title: c.title,
  slug: c.slug || `content-${c.id}`,
  brief: c.brief,
})))}
---

<BaseLayout title={title} description={description}>
  <h1>{title}</h1>
  ${website.description ? `<p class="site-description">${website.description}</p>` : ''}

  <div class="content-list">
    {contentItems.map((item) => (
      <article class="content-item">
        <h2>
          <a href={\`/\${item.slug}\`}>{item.title}</a>
        </h2>
        <p>{item.brief}</p>
      </article>
    ))}
  </div>
</BaseLayout>

<style>
  .site-description {
    font-size: 1.25rem;
    color: var(--color-text-light);
    margin-bottom: 3rem;
  }

  .content-list {
    display: grid;
    gap: 2rem;
  }

  .content-item {
    padding: 1.5rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    transition: box-shadow 0.2s;
  }

  .content-item:hover {
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .content-item h2 {
    margin-top: 0;
    margin-bottom: 0.5rem;
  }

  .content-item a {
    color: var(--color-text);
  }

  .content-item p {
    color: var(--color-text-light);
    margin: 0;
  }
</style>
`
}

/**
 * Generate content page
 */
function generateContentPage(website: Website, content: ContentItem): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro'
import ContentRenderer from '../components/ContentRenderer.astro'

const title = '${content.title.replace(/'/g, "\\'")}'
const description = '${(content.brief || '').replace(/'/g, "\\'")}'
const blocks = ${JSON.stringify(content.body, null, 2)}
---

<BaseLayout title={title} description={description}>
  <article class="content-page">
    <header class="content-header">
      <h1>{title}</h1>
      ${content.brief ? `<p class="content-brief">{description}</p>` : ''}
    </header>

    <ContentRenderer blocks={blocks} />
  </article>

  <nav class="content-nav">
    <a href="/">← Back to Home</a>
  </nav>
</BaseLayout>

<style>
  .content-page {
    max-width: 800px;
    margin: 0 auto;
  }

  .content-header {
    margin-bottom: 3rem;
    padding-bottom: 2rem;
    border-bottom: 2px solid var(--color-border);
  }

  .content-header h1 {
    margin-bottom: 1rem;
  }

  .content-brief {
    font-size: 1.25rem;
    color: var(--color-text-light);
    line-height: 1.6;
  }

  .content-nav {
    margin-top: 4rem;
    padding-top: 2rem;
    border-top: 1px solid var(--color-border);
  }

  .content-nav a {
    color: var(--color-primary);
    text-decoration: none;
    font-weight: 600;
  }

  .content-nav a:hover {
    text-decoration: underline;
  }
</style>
`
}

/**
 * Run Astro build command
 */
async function runAstroBuild(buildDir: string, siteUrl: string): Promise<void> {
  console.log(`[SiteBuilder] Running Astro build in ${buildDir}`)

  // Copy Astro config and source files
  const siteBuilderDir = join(process.cwd(), 'packages', 'site-builder')

  // Copy astro.config.mjs
  await execAsync(`cp ${join(siteBuilderDir, 'astro.config.mjs')} ${buildDir}/`)

  // Copy layouts and components
  await execAsync(`cp -r ${join(siteBuilderDir, 'src', 'layouts')} ${join(buildDir, 'src')}/`)
  await execAsync(`cp -r ${join(siteBuilderDir, 'src', 'components')} ${join(buildDir, 'src')}/`)

  // Create package.json for build
  const packageJson = {
    name: 'site-build',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: `astro build --site ${siteUrl}`,
    },
    dependencies: {
      astro: '^4.3.0',
      '@astrojs/node': '^8.2.0',
      sharp: '^0.33.0',
    },
  }

  await writeFile(
    join(buildDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  )

  // Install dependencies and build
  await execAsync('pnpm install', { cwd: buildDir })
  await execAsync('pnpm build', { cwd: buildDir })

  console.log(`[SiteBuilder] Astro build complete`)
}

/**
 * Clean build directory
 */
export async function cleanBuildDir(websiteId: string): Promise<void> {
  const buildDir = join(process.cwd(), 'build', websiteId)
  await rm(buildDir, { recursive: true, force: true })
  console.log(`[SiteBuilder] Cleaned build directory: ${buildDir}`)
}

/**
 * Validate content structure before build
 */
export function validateContent(content: ContentItem[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const item of content) {
    if (!item.title) {
      errors.push(`Content ${item.id}: Missing title`)
    }

    if (!item.body || !Array.isArray(item.body)) {
      errors.push(`Content ${item.id}: Invalid body (must be array of blocks)`)
      continue
    }

    for (let i = 0; i < item.body.length; i++) {
      const block = item.body[i]

      if (!block.type) {
        errors.push(`Content ${item.id}, Block ${i}: Missing type`)
      }

      // Validate block-specific fields
      switch (block.type) {
        case 'image':
          if (!block.url) errors.push(`Content ${item.id}, Block ${i}: Image missing url`)
          if (!block.alt) errors.push(`Content ${item.id}, Block ${i}: Image missing alt text`)
          break

        case 'heading':
          if (!block.level || block.level < 1 || block.level > 6) {
            errors.push(`Content ${item.id}, Block ${i}: Invalid heading level`)
          }
          if (!block.text) {
            errors.push(`Content ${item.id}, Block ${i}: Heading missing text`)
          }
          break

        case 'paragraph':
          if (!block.text) {
            errors.push(`Content ${item.id}, Block ${i}: Paragraph missing text`)
          }
          break
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
