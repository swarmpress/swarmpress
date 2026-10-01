#!/usr/bin/env tsx
/**
 * Content Audit Script
 * Runs comprehensive content integrity audit on a content directory
 *
 * Usage:
 *   tsx scripts/run-content-audit.ts [content-path] [options]
 *
 * Examples:
 *   tsx scripts/run-content-audit.ts cinqueterre.travel/content
 *   tsx scripts/run-content-audit.ts cinqueterre.travel/content --validate-images
 *   tsx scripts/run-content-audit.ts cinqueterre.travel/content --fix --media-agent-id abc123
 */

import { join } from 'path'
import { existsSync, writeFileSync, readFileSync } from 'fs'

// Parse command line arguments
const args = process.argv.slice(2)
const contentPath = args[0] || 'cinqueterre.travel/content'
const options = {
  validateImages: args.includes('--validate-images') || args.includes('-v'),
  fix: args.includes('--fix') || args.includes('-f'),
  outputJson: args.includes('--json') || args.includes('-j'),
  outputMarkdown: args.includes('--markdown') || args.includes('-m'),
  mediaAgentId: args.find((a) => a.startsWith('--media-agent-id='))?.split('=')[1],
  writerAgentId: args.find((a) => a.startsWith('--writer-agent-id='))?.split('=')[1],
  help: args.includes('--help') || args.includes('-h'),
}

if (options.help) {
  console.log(`
Content Audit Script
====================

Runs comprehensive content integrity audit on a content directory.

Usage:
  tsx scripts/run-content-audit.ts [content-path] [options]

Options:
  -v, --validate-images    Use vision API to validate image content (slower, more accurate)
  -f, --fix                Attempt to auto-fix issues (requires agent IDs)
  -j, --json               Output results as JSON file
  -m, --markdown           Output results as Markdown file
  --media-agent-id=ID      Agent ID for fixing image issues
  --writer-agent-id=ID     Agent ID for fixing translation issues
  -h, --help               Show this help message

Examples:
  tsx scripts/run-content-audit.ts cinqueterre.travel/content
  tsx scripts/run-content-audit.ts cinqueterre.travel/content --validate-images --json
  tsx scripts/run-content-audit.ts cinqueterre.travel/content --fix --media-agent-id=abc123
`)
  process.exit(0)
}

async function main() {
  console.log('\n🔍 Content Integrity Audit')
  console.log('==========================\n')

  // Resolve content path
  const resolvedPath = contentPath.startsWith('/')
    ? contentPath
    : join(process.cwd(), contentPath)

  if (!existsSync(resolvedPath)) {
    console.error(`❌ Content path not found: ${resolvedPath}`)
    process.exit(1)
  }

  console.log(`📁 Content path: ${resolvedPath}`)
  console.log(`🔬 Validate images: ${options.validateImages}`)
  console.log(`🔧 Auto-fix: ${options.fix}`)
  console.log('')

  // Load required languages from site config
  let requiredLanguages: string[] = ['en']
  try {
    const siteConfigPaths = [
      join(resolvedPath, 'site.json'),
      join(resolvedPath, 'config.json'),
      join(resolvedPath, 'config', 'site.json'),
    ]

    for (const configPath of siteConfigPaths) {
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        if (config.locales && Array.isArray(config.locales)) {
          requiredLanguages = config.locales
          console.log(`📝 Languages from config: ${requiredLanguages.join(', ')}`)
          break
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ Could not load site config, using default languages`)
  }

  // Import and run audit
  console.log('\n🏃 Running audit...\n')

  const { runContentAudit, formatAuditReportAsMarkdown } = await import('../packages/shared/src/content/validators/audit')

  // Get Anthropic client if validating images
  let anthropicClient
  if (options.validateImages) {
    console.log('🤖 Initializing vision API for image validation...')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    anthropicClient = new Anthropic()
  }

  const startTime = Date.now()

  const result = await runContentAudit({
    contentPath: resolvedPath,
    checks: ['all'],
    anthropicClient,
    requiredLanguages,
    options: {
      validateImageContent: options.validateImages,
      concurrency: 10,
      timeout: 5000,
    },
  })

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  // Display summary
  console.log('\n📊 Audit Summary')
  console.log('================\n')
  console.log(`⏱️  Duration: ${duration}s`)
  console.log(`📄 Files scanned: ${result.summary.totalFilesScanned}`)
  console.log(`🔗 URLs checked: ${result.summary.totalUrlsChecked}`)
  console.log('')
  console.log(`📋 Total issues: ${result.summary.totalIssues}`)
  console.log(`   🔴 Critical: ${result.summary.criticalIssues}`)
  console.log(`   🟠 High: ${result.summary.highIssues}`)
  console.log(`   🟡 Medium: ${result.summary.mediumIssues}`)
  console.log(`   🟢 Low: ${result.summary.lowIssues}`)
  console.log('')

  // Display by category
  console.log('📁 By Category:')
  for (const [category, count] of Object.entries(result.summary.byCategory)) {
    console.log(`   - ${category}: ${count}`)
  }

  // Display top issues
  if (result.issues.length > 0) {
    console.log('\n⚠️  Top Issues (first 10):')
    console.log('==========================\n')

    const topIssues = result.issues.slice(0, 10)
    for (const issue of topIssues) {
      const severityEmoji =
        issue.severity === 'critical'
          ? '🔴'
          : issue.severity === 'high'
            ? '🟠'
            : issue.severity === 'medium'
              ? '🟡'
              : '🟢'

      console.log(`${severityEmoji} [${issue.category}] ${issue.description}`)
      console.log(`   File: ${issue.relativePath}`)
      console.log(`   Path: ${issue.jsonPath}`)
      if (issue.url) {
        console.log(`   URL: ${issue.url.substring(0, 80)}${issue.url.length > 80 ? '...' : ''}`)
      }
      console.log(`   Fix: ${issue.suggestedFix}`)
      console.log(`   Auto-fixable: ${issue.autoFixable ? 'Yes' : 'No'}`)
      console.log('')
    }

    if (result.issues.length > 10) {
      console.log(`... and ${result.issues.length - 10} more issues\n`)
    }
  } else {
    console.log('\n✅ No issues found! Content looks good.\n')
  }

  // Output files
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (options.outputJson || result.issues.length > 0) {
    const jsonPath = join(resolvedPath, `audit-report-${timestamp}.json`)
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          ...result,
          urlCheckResults: undefined, // Remove Map for JSON
          imageValidationResults: undefined,
        },
        null,
        2
      )
    )
    console.log(`📄 JSON report saved: ${jsonPath}`)
  }

  if (options.outputMarkdown) {
    const mdPath = join(resolvedPath, `audit-report-${timestamp}.md`)
    writeFileSync(mdPath, formatAuditReportAsMarkdown(result))
    console.log(`📝 Markdown report saved: ${mdPath}`)
  }

  // Auto-fix if requested
  if (options.fix && result.issues.length > 0) {
    console.log('\n🔧 Auto-fix mode')
    console.log('================\n')

    const autoFixable = result.issues.filter((i) => i.autoFixable)
    console.log(`Found ${autoFixable.length} auto-fixable issues`)

    if (!options.mediaAgentId && !options.writerAgentId) {
      console.log('⚠️ No agent IDs provided. Use --media-agent-id and --writer-agent-id to enable auto-fixing.')
      console.log('   Auto-fix requires running agents via the Temporal workflow.')
      console.log('')
      console.log('To fix issues via workflow, run:')
      console.log('   tsx scripts/run-content-integrity-workflow.ts <website-id> <content-path>')
    } else {
      console.log('ℹ️ Auto-fixing is handled by the content-integrity workflow.')
      console.log('   Run the workflow to fix issues with agent assistance.')
    }
  }

  // Exit code based on critical issues
  if (result.summary.criticalIssues > 0) {
    console.log('\n❌ Audit failed: Critical issues found')
    process.exit(1)
  }

  console.log('\n✅ Audit complete')
  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Audit failed:', error)
  process.exit(1)
})
