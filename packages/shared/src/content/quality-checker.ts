/**
 * Content Quality Checker
 *
 * Automated quality checks for generated content to ensure
 * completeness, correctness, and translation quality.
 */

export type SupportedLanguage = 'en' | 'de' | 'fr' | 'it'

// Use local types to avoid conflicts with blocks.ts exports
interface QCLocalizedString {
  en?: string
  de?: string
  fr?: string
  it?: string
  [key: string]: string | undefined
}

interface QCContentBlock {
  type: string
  [key: string]: unknown
}

export interface PageContent {
  id?: string
  title?: QCLocalizedString | string
  slug?: QCLocalizedString | string
  page_type?: string
  seo?: {
    title?: QCLocalizedString | string
    description?: QCLocalizedString | string
    keywords?: QCLocalizedString | string | { [lang: string]: string[] }
  }
  body?: QCContentBlock[]
  metadata?: Record<string, unknown>
}

export interface QualityIssue {
  severity: 'error' | 'warning' | 'info'
  type: 'missing' | 'empty' | 'short' | 'placeholder' | 'format' | 'language'
  field: string
  language?: SupportedLanguage
  message: string
  suggestion?: string
}

export interface QualityCheckResult {
  pass: boolean
  score: number // 0-100
  issues: QualityIssue[]
  summary: {
    errors: number
    warnings: number
    info: number
  }
  languageScores: Record<SupportedLanguage, number>
}

// Minimum content lengths by block type
const MIN_CONTENT_LENGTH: Record<string, number> = {
  'hero-section': 50,
  'content-section': 100,
  'feature-section': 80,
  'faq-section': 100,
  'paragraph': 50,
  'heading': 5,
  'default': 20,
}

// Placeholder text patterns
const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /placeholder/i,
  /TODO/,
  /FIXME/,
  /\[.*\]/,  // [placeholder text]
  /{{.*}}/,  // {{template}}
  /xxx+/i,
  /sample text/i,
  /insert .* here/i,
]

// Language-specific validation patterns
const LANGUAGE_VALIDATORS: Record<SupportedLanguage, {
  patterns: RegExp[]
  requiredChars?: RegExp
  name: string
}> = {
  en: {
    patterns: [],
    name: 'English',
  },
  de: {
    patterns: [
      /[äöüß]/i, // German umlauts and ß
    ],
    requiredChars: /[äöüß]/i, // At least one German character expected
    name: 'German',
  },
  fr: {
    patterns: [
      /[éèêëàâäùûüôöîïç]/i, // French accented characters
    ],
    requiredChars: /[éèêëàâç]/i,
    name: 'French',
  },
  it: {
    patterns: [
      /[àèéìòù]/i, // Italian accented characters
    ],
    requiredChars: /[àèéìòù]/i,
    name: 'Italian',
  },
}

/**
 * Extract text content from a value (handles localized strings)
 */
function extractText(value: unknown, lang: SupportedLanguage): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const localized = value as QCLocalizedString
    return localized[lang] || ''
  }
  return ''
}

/**
 * Check if text contains placeholder content
 */
function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Calculate text quality score for a language
 */
function calculateTextScore(text: string, lang: SupportedLanguage, minLength: number): number {
  if (!text) return 0

  let score = 0
  const length = text.trim().length

  // Length score (0-40 points)
  if (length >= minLength) {
    score += 40
  } else if (length > 0) {
    score += Math.floor((length / minLength) * 40)
  }

  // Not placeholder score (0-30 points)
  if (!isPlaceholder(text)) {
    score += 30
  }

  // Language-specific characters (0-20 points) - only for non-English
  if (lang !== 'en') {
    const validator = LANGUAGE_VALIDATORS[lang]
    // For German/French/Italian, if text is > 200 chars, expect some special chars
    if (length > 200 && validator.requiredChars) {
      if (validator.requiredChars.test(text)) {
        score += 20
      } else {
        score += 10 // Partial credit if text looks okay but missing accents
      }
    } else {
      score += 20 // Short text gets benefit of doubt
    }
  } else {
    score += 20
  }

  // Well-formed score (0-10 points)
  // Check for proper punctuation at end
  if (/[.!?]$/.test(text.trim())) {
    score += 5
  }
  // Check for proper capitalization
  if (/^[A-ZÄÖÜÀÈÉÌÒÙ]/.test(text.trim())) {
    score += 5
  }

  return Math.min(100, score)
}

/**
 * Check a content block for quality issues
 */
function checkBlock(
  block: QCContentBlock,
  lang: SupportedLanguage,
  blockIndex: number
): { issues: QualityIssue[]; score: number } {
  const issues: QualityIssue[] = []
  let totalScore = 0
  let fieldCount = 0

  const minLength = MIN_CONTENT_LENGTH[block.type] ?? MIN_CONTENT_LENGTH['default'] ?? 20
  const blockPath = `body[${blockIndex}]`

  // Check common text fields
  const textFields = ['title', 'subtitle', 'description', 'eyebrow', 'content', 'text']

  for (const field of textFields) {
    const value = block[field]
    if (value !== undefined) {
      const text = extractText(value, lang)
      fieldCount++

      if (!text) {
        issues.push({
          severity: 'warning',
          type: 'empty',
          field: `${blockPath}.${field}`,
          language: lang,
          message: `Empty ${field} for ${lang.toUpperCase()}`,
        })
      } else if (text.length < minLength / 2) {
        issues.push({
          severity: 'info',
          type: 'short',
          field: `${blockPath}.${field}`,
          language: lang,
          message: `Short ${field} (${text.length} chars) for ${lang.toUpperCase()}`,
        })
        totalScore += calculateTextScore(text, lang, minLength)
      } else if (isPlaceholder(text)) {
        issues.push({
          severity: 'error',
          type: 'placeholder',
          field: `${blockPath}.${field}`,
          language: lang,
          message: `Placeholder text detected in ${field}`,
        })
      } else {
        totalScore += calculateTextScore(text, lang, minLength)
      }
    }
  }

  // Check features array
  if (Array.isArray(block.features)) {
    for (let i = 0; i < block.features.length; i++) {
      const feature = block.features[i] as { title?: unknown; description?: unknown }
      const featurePath = `${blockPath}.features[${i}]`

      for (const field of ['title', 'description']) {
        const value = feature[field as keyof typeof feature]
        if (value !== undefined) {
          const text = extractText(value, lang)
          fieldCount++

          if (!text) {
            issues.push({
              severity: 'warning',
              type: 'empty',
              field: `${featurePath}.${field}`,
              language: lang,
              message: `Empty feature ${field} for ${lang.toUpperCase()}`,
            })
          } else {
            totalScore += calculateTextScore(text, lang, 20)
          }
        }
      }
    }
  }

  // Check FAQ items
  if (Array.isArray(block.items)) {
    for (let i = 0; i < block.items.length; i++) {
      const item = block.items[i] as { question?: unknown; answer?: unknown }
      const itemPath = `${blockPath}.items[${i}]`

      for (const field of ['question', 'answer']) {
        const value = item[field as keyof typeof item]
        if (value !== undefined) {
          const text = extractText(value, lang)
          fieldCount++

          if (!text) {
            issues.push({
              severity: 'warning',
              type: 'empty',
              field: `${itemPath}.${field}`,
              language: lang,
              message: `Empty FAQ ${field} for ${lang.toUpperCase()}`,
            })
          } else {
            totalScore += calculateTextScore(text, lang, 30)
          }
        }
      }
    }
  }

  return {
    issues,
    score: fieldCount > 0 ? totalScore / fieldCount : 0,
  }
}

/**
 * Check content quality for a specific language
 */
export function checkContentQuality(
  page: PageContent,
  lang: SupportedLanguage
): QualityCheckResult {
  const issues: QualityIssue[] = []
  let totalScore = 0
  let checkCount = 0

  // Check title
  if (page.title) {
    const titleText = extractText(page.title, lang)
    if (!titleText) {
      issues.push({
        severity: 'error',
        type: 'missing',
        field: 'title',
        language: lang,
        message: `Missing page title for ${lang.toUpperCase()}`,
      })
    } else {
      totalScore += calculateTextScore(titleText, lang, 10)
      checkCount++
    }
  } else {
    issues.push({
      severity: 'error',
      type: 'missing',
      field: 'title',
      message: 'Page title is missing',
    })
  }

  // Check SEO
  if (page.seo) {
    // SEO Title
    if (page.seo.title) {
      const seoTitle = extractText(page.seo.title, lang)
      if (!seoTitle) {
        issues.push({
          severity: 'warning',
          type: 'missing',
          field: 'seo.title',
          language: lang,
          message: `Missing SEO title for ${lang.toUpperCase()}`,
        })
      } else {
        totalScore += calculateTextScore(seoTitle, lang, 30)
        checkCount++

        // Check SEO title length (50-60 chars ideal)
        if (seoTitle.length > 70) {
          issues.push({
            severity: 'info',
            type: 'format',
            field: 'seo.title',
            language: lang,
            message: `SEO title too long (${seoTitle.length} chars, ideal: 50-60)`,
          })
        }
      }
    }

    // SEO Description
    if (page.seo.description) {
      const seoDesc = extractText(page.seo.description, lang)
      if (!seoDesc) {
        issues.push({
          severity: 'warning',
          type: 'missing',
          field: 'seo.description',
          language: lang,
          message: `Missing SEO description for ${lang.toUpperCase()}`,
        })
      } else {
        totalScore += calculateTextScore(seoDesc, lang, 100)
        checkCount++

        // Check SEO description length (150-160 chars ideal)
        if (seoDesc.length > 170) {
          issues.push({
            severity: 'info',
            type: 'format',
            field: 'seo.description',
            language: lang,
            message: `SEO description too long (${seoDesc.length} chars, ideal: 150-160)`,
          })
        } else if (seoDesc.length < 100) {
          issues.push({
            severity: 'info',
            type: 'short',
            field: 'seo.description',
            language: lang,
            message: `SEO description too short (${seoDesc.length} chars, ideal: 150-160)`,
          })
        }
      }
    }
  } else {
    issues.push({
      severity: 'warning',
      type: 'missing',
      field: 'seo',
      message: 'SEO metadata is missing',
    })
  }

  // Check body blocks
  if (Array.isArray(page.body) && page.body.length > 0) {
    for (let i = 0; i < page.body.length; i++) {
      const block = page.body[i]
      if (!block) continue
      const blockResult = checkBlock(block, lang, i)
      issues.push(...blockResult.issues)
      if (blockResult.score > 0) {
        totalScore += blockResult.score
        checkCount++
      }
    }
  } else {
    issues.push({
      severity: 'error',
      type: 'empty',
      field: 'body',
      message: 'Page has no content blocks',
    })
  }

  // Calculate final score
  const score = checkCount > 0 ? Math.round(totalScore / checkCount) : 0

  // Count issue severities
  const summary = {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  }

  return {
    pass: summary.errors === 0 && score >= 50,
    score,
    issues,
    summary,
    languageScores: { en: 0, de: 0, fr: 0, it: 0, [lang]: score },
  }
}

/**
 * Check content quality across all languages
 */
export function checkAllLanguages(page: PageContent): QualityCheckResult {
  const allIssues: QualityIssue[] = []
  const languageScores: Record<SupportedLanguage, number> = {
    en: 0,
    de: 0,
    fr: 0,
    it: 0,
  }

  for (const lang of ['en', 'de', 'fr', 'it'] as SupportedLanguage[]) {
    const result = checkContentQuality(page, lang)
    allIssues.push(...result.issues)
    languageScores[lang] = result.score
  }

  const avgScore = Math.round(
    Object.values(languageScores).reduce((a, b) => a + b, 0) / 4
  )

  const summary = {
    errors: allIssues.filter(i => i.severity === 'error').length,
    warnings: allIssues.filter(i => i.severity === 'warning').length,
    info: allIssues.filter(i => i.severity === 'info').length,
  }

  return {
    pass: summary.errors === 0 && avgScore >= 50,
    score: avgScore,
    issues: allIssues,
    summary,
    languageScores,
  }
}

/**
 * Get a summary report for a page
 */
export function getQualityReport(page: PageContent): string {
  const result = checkAllLanguages(page)

  const lines = [
    `Quality Score: ${result.score}/100 (${result.pass ? 'PASS' : 'FAIL'})`,
    '',
    'Language Scores:',
    ...Object.entries(result.languageScores).map(
      ([lang, score]) => `  ${lang.toUpperCase()}: ${score}/100`
    ),
    '',
    `Issues: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.info} info`,
  ]

  if (result.issues.length > 0) {
    lines.push('', 'Top Issues:')
    const topIssues = result.issues
      .filter(i => i.severity !== 'info')
      .slice(0, 10)

    for (const issue of topIssues) {
      const langTag = issue.language ? ` [${issue.language.toUpperCase()}]` : ''
      lines.push(`  [${issue.severity.toUpperCase()}]${langTag} ${issue.field}: ${issue.message}`)
    }
  }

  return lines.join('\n')
}
