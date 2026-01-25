/**
 * Image Content Validator
 * Uses vision analysis to verify images match their expected context
 */

import Anthropic from '@anthropic-ai/sdk'

export interface ValidateImageInput {
  imageUrl: string
  expectedContext: string // "Cinque Terre village", "hiking trail in Riomaggiore", etc.
  villageContext?: string // "Riomaggiore", "Manarola", etc.
  categoryContext?: string // "beach", "restaurant", "hiking", etc.
}

export interface ValidateImageOutput {
  isCorrect: boolean
  confidence: number // 0-1
  actualContent: string // Description of what the image actually shows
  locationMatch: boolean // Does the location match?
  categoryMatch: boolean // Does the category match?
  suggestedAction: 'keep' | 'replace' | 'review'
  issues: string[]
  reasoning: string
}

// Known Cinque Terre visual elements for validation
const CINQUE_TERRE_INDICATORS = [
  'colorful houses',
  'pastel buildings',
  'cliffside village',
  'Italian Riviera',
  'Mediterranean coast',
  'terraced vineyard',
  'Ligurian Sea',
  'fishing boats',
  'harbor',
  'coastal trail',
  'steep stairs',
  'narrow streets',
  'pesto',
  'focaccia',
]

const VILLAGE_CHARACTERISTICS: Record<string, string[]> = {
  riomaggiore: ['easternmost', 'colorful tower houses', 'steep cliffs', 'small harbor', 'via dell\'amore'],
  manarola: ['wine production', 'corniglia road', 'presepe', 'nativity scene', 'swimming rocks'],
  corniglia: ['hilltop', 'no direct sea access', 'lardarina stairs', 'vineyard views', '382 steps'],
  vernazza: ['natural harbor', 'doria castle', 'church tower', 'piazza', 'most photogenic'],
  monterosso: ['largest beach', 'giant statue', 'old town', 'new town', 'lemon groves'],
}


/**
 * Validate image content matches expected context using Claude Vision
 */
export async function validateImageContent(
  input: ValidateImageInput,
  client?: Anthropic
): Promise<ValidateImageOutput> {
  const { imageUrl, expectedContext, villageContext, categoryContext } = input

  // If no client provided, return a needs-validation result
  if (!client) {
    return {
      isCorrect: false,
      confidence: 0,
      actualContent: 'Unable to analyze - no vision API client provided',
      locationMatch: false,
      categoryMatch: false,
      suggestedAction: 'review',
      issues: ['Vision analysis not available'],
      reasoning: 'No Anthropic client provided for vision analysis',
    }
  }

  try {
    // Fetch image and convert to base64
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      return {
        isCorrect: false,
        confidence: 1,
        actualContent: 'Image not accessible',
        locationMatch: false,
        categoryMatch: false,
        suggestedAction: 'replace',
        issues: [`Image returned HTTP ${imageResponse.status}`],
        reasoning: 'Cannot validate inaccessible image',
      }
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const base64 = Buffer.from(imageBuffer).toString('base64')
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'

    // Build the analysis prompt
    const villageHints = villageContext
      ? `\n\nExpected village: ${villageContext}. ${
          VILLAGE_CHARACTERISTICS[villageContext.toLowerCase()]?.join(', ') || ''
        }`
      : ''

    const prompt = `Analyze this image and determine if it matches the expected context.

Expected context: ${expectedContext}${villageHints}
Category: ${categoryContext || 'general travel content'}

Please analyze:
1. What does this image actually show? Be specific about location, landmarks, and visual elements.
2. Does this appear to be from Cinque Terre, Italy? Look for: ${CINQUE_TERRE_INDICATORS.slice(0, 5).join(', ')}
3. Could this be from a WRONG location? Watch for: Santorini (blue domes), London, Caribbean, desert, etc.
4. Does the content match the expected category (${categoryContext || 'travel'})?

Respond in JSON format:
{
  "actualContent": "Description of what the image shows",
  "isCinqueTerre": true/false,
  "wrongLocationIndicators": ["any wrong location signs detected"],
  "matchesExpectedContext": true/false,
  "matchesCategory": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of problems"],
  "reasoning": "explanation of your assessment"
}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    })

    // Parse the response
    const textContent = response.content.find((c: { type: string }) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from vision analysis')
    }

    // Extract JSON from response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from vision response')
    }

    const analysis = JSON.parse(jsonMatch[0]) as {
      actualContent: string
      isCinqueTerre: boolean
      wrongLocationIndicators: string[]
      matchesExpectedContext: boolean
      matchesCategory: boolean
      confidence: number
      issues: string[]
      reasoning: string
    }

    const isCorrect =
      analysis.isCinqueTerre &&
      analysis.matchesExpectedContext &&
      analysis.wrongLocationIndicators.length === 0

    return {
      isCorrect,
      confidence: analysis.confidence,
      actualContent: analysis.actualContent,
      locationMatch: analysis.isCinqueTerre,
      categoryMatch: analysis.matchesCategory,
      suggestedAction: isCorrect ? 'keep' : analysis.confidence > 0.8 ? 'replace' : 'review',
      issues: [
        ...analysis.issues,
        ...analysis.wrongLocationIndicators.map((w) => `Wrong location indicator: ${w}`),
      ],
      reasoning: analysis.reasoning,
    }
  } catch (error) {
    return {
      isCorrect: false,
      confidence: 0,
      actualContent: 'Error during analysis',
      locationMatch: false,
      categoryMatch: false,
      suggestedAction: 'review',
      issues: [error instanceof Error ? error.message : 'Unknown error'],
      reasoning: 'Failed to complete vision analysis',
    }
  }
}

/**
 * Quick heuristic check for obviously wrong images
 * (doesn't require API call, useful for pre-filtering)
 */
export function quickImageHeuristics(imageUrl: string, expectedContext: string): {
  likelyCorrect: boolean
  warnings: string[]
} {
  const warnings: string[] = []
  const urlLower = imageUrl.toLowerCase()
  const contextLower = expectedContext.toLowerCase()

  // Check for stock photo sites that might have unrelated content
  if (urlLower.includes('unsplash') || urlLower.includes('pexels')) {
    // Stock photos need extra validation
    warnings.push('Stock photo source - verify content matches context')
  }

  // Check for obviously wrong URLs
  const wrongPatterns = [
    { pattern: 'santorini', message: 'URL contains "santorini" - likely wrong location' },
    { pattern: 'caribbean', message: 'URL contains "caribbean" - wrong region' },
    { pattern: 'london', message: 'URL contains "london" - wrong country' },
    { pattern: 'placeholder', message: 'URL contains "placeholder" - not real content' },
    { pattern: 'lorem', message: 'URL contains "lorem" - placeholder content' },
  ]

  for (const { pattern, message } of wrongPatterns) {
    if (urlLower.includes(pattern)) {
      warnings.push(message)
    }
  }

  // Check if context mentions a village but URL doesn't
  const villages = ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso']
  const contextVillage = villages.find((v) => contextLower.includes(v))
  if (contextVillage && !urlLower.includes(contextVillage) && !urlLower.includes('cinque')) {
    warnings.push(`Context mentions ${contextVillage} but URL doesn't reference it`)
  }

  return {
    likelyCorrect: warnings.length === 0,
    warnings,
  }
}

/**
 * Batch validate multiple images
 */
export async function validateImages(
  images: Array<ValidateImageInput>,
  client: Anthropic,
  options: {
    concurrency?: number
    onProgress?: (completed: number, total: number) => void
  } = {}
): Promise<Map<string, ValidateImageOutput>> {
  const { concurrency = 3, onProgress } = options
  const results = new Map<string, ValidateImageOutput>()
  let completed = 0

  // Process in batches to avoid rate limits
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (input) => {
        const result = await validateImageContent(input, client)
        return { url: input.imageUrl, result }
      })
    )

    for (const { url, result } of batchResults) {
      results.set(url, result)
      completed++
      onProgress?.(completed, images.length)
    }

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < images.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return results
}
