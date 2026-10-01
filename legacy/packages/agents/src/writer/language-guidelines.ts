/**
 * Language-Specific Writing Guidelines for Content Generation
 *
 * These guidelines help AI writers produce culturally-appropriate,
 * audience-specific content for each supported language.
 */

export type SupportedLanguage = 'en' | 'de' | 'fr' | 'it'

export interface LanguageGuidelines {
  language: SupportedLanguage
  languageName: string
  audienceDescription: string
  toneGuidelines: string
  culturalNotes: string[]
  writingTips: string[]
  seoKeywords: string[]
  avoidPatterns: string[]
}

export const languageGuidelines: Record<SupportedLanguage, LanguageGuidelines> = {
  en: {
    language: 'en',
    languageName: 'English',
    audienceDescription: 'International travelers, primarily from the US, UK, Canada, and Australia',
    toneGuidelines: `
- Write in conversational, accessible American/British English
- Use an enthusiastic but not over-the-top tone
- Balance inspiration with practical information
- Include insider tips that make readers feel like experts`,
    culturalNotes: [
      'Readers appreciate practical, actionable advice',
      'Mention booking tips, best times, and hidden gems',
      'Compare to familiar experiences when possible',
      'Emphasize value for money and unique experiences',
    ],
    writingTips: [
      'Lead with the most important information',
      'Use active voice and short sentences',
      'Include specific numbers (costs, distances, times)',
      'Add personal anecdotes or local stories',
    ],
    seoKeywords: [
      'Cinque Terre', 'Italian Riviera', 'UNESCO World Heritage',
      'hiking trails', 'best time to visit', 'travel guide', 'day trip',
    ],
    avoidPatterns: [
      'Overly formal or academic language',
      'Clichés like "hidden gem" or "off the beaten path" overuse',
      'Vague descriptions without specifics',
    ],
  },

  de: {
    language: 'de',
    languageName: 'German (Deutsch)',
    audienceDescription: 'German, Austrian, and Swiss travelers who value thoroughness and quality',
    toneGuidelines: `
- Write in formal German using "Sie" for addressing readers
- Be thorough and detailed - German travelers plan meticulously
- Prioritize factual accuracy over flowery descriptions
- Emphasize quality, authenticity, and value`,
    culturalNotes: [
      'German travelers often book well in advance',
      'They appreciate detailed practical information',
      'Quality ratings and reviews are very important',
      'Off-season travel is popular (avoiding crowds)',
      'Environmental sustainability matters',
    ],
    writingTips: [
      'Include precise times, prices (in EUR), and distances',
      'Mention accessibility and transport connections',
      'Note which places accept reservations',
      'Highlight authentic local experiences over touristy spots',
      'Use proper German compound nouns and grammar',
    ],
    seoKeywords: [
      'Cinque Terre Reiseführer', 'Wandern Cinque Terre',
      'Unterkunft', 'beste Reisezeit', 'Geheimtipps',
      'Ligurien Urlaub', 'Italien Küste',
    ],
    avoidPatterns: [
      'Casual "du" form (use "Sie")',
      'Anglicisms when German words exist',
      'Vague price ranges (be specific)',
      'Overly emotional or sales-y language',
    ],
  },

  fr: {
    language: 'fr',
    languageName: 'French (Français)',
    audienceDescription: 'French, Belgian, and Swiss Francophone travelers who appreciate culture and gastronomy',
    toneGuidelines: `
- Write in elegant, evocative French
- Emphasize sensory experiences and aesthetics
- Focus on gastronomy, wine, and cultural heritage
- Balance poetic descriptions with practical info`,
    culturalNotes: [
      'French travelers highly value food and wine experiences',
      'Art, architecture, and history resonate strongly',
      'August is peak French vacation month',
      'Quality of accommodations and restaurants matters greatly',
      'Appreciate comparing to similar French coastal regions',
    ],
    writingTips: [
      'Use rich, sensory language for food and scenery',
      'Mention wine pairings and local specialties',
      'Include historical and cultural context',
      'Note opening hours and reservation requirements',
      'Proper French punctuation and accents are essential',
    ],
    seoKeywords: [
      'Cinque Terre guide', 'Italie voyage', 'Ligurie',
      'randonnée', 'villages colorés', 'gastronomie italienne',
      'séjour Cinque Terre', 'mer Méditerranée',
    ],
    avoidPatterns: [
      'Poor grammar or missing accents (é, è, ê, ç, etc.)',
      'Overly casual tone',
      'Ignoring food and wine aspects',
      'Generic descriptions without cultural depth',
    ],
  },

  it: {
    language: 'it',
    languageName: 'Italian (Italiano)',
    audienceDescription: 'Domestic Italian travelers from other regions discovering their own country',
    toneGuidelines: `
- Write in warm, conversational Italian
- Take a local perspective - they know Italian culture
- Focus on regional Ligurian specialties vs generic Italian
- Can be more informal and friendly`,
    culturalNotes: [
      'Italian domestic tourists know the culture, show them local secrets',
      'Emphasize Ligurian regional differences from their home regions',
      'Ferragosto (August 15) closures are important to note',
      'They appreciate authentic, non-touristy recommendations',
      'Price consciousness varies - focus on value experiences',
    ],
    writingTips: [
      'Highlight regional Ligurian cuisine and traditions',
      'Compare to other Italian coastal destinations',
      'Mention local transport options (treni regionali, etc.)',
      'Note which places are open during Ferragosto',
      'Use local Ligurian terms when appropriate',
    ],
    seoKeywords: [
      'Cinque Terre guida', 'Liguria vacanze', 'cosa vedere',
      'sentieri', 'spiagge Monterosso', 'ristoranti tipici',
      'weekend Cinque Terre', 'trekking Italia',
    ],
    avoidPatterns: [
      'Explaining basic Italian culture (they know it)',
      'Overly formal or stiff language',
      'Generic "Italian" descriptions vs specific Ligurian focus',
      'Ignoring practical info like parking and train schedules',
    ],
  },
}

/**
 * Get formatted guidelines for a specific language
 */
export function getLanguageGuidelines(lang: SupportedLanguage): string {
  const guidelines = languageGuidelines[lang]

  return `
## Language-Specific Guidelines: ${guidelines.languageName}

**Target Audience:** ${guidelines.audienceDescription}

**Tone & Style:**
${guidelines.toneGuidelines}

**Cultural Notes:**
${guidelines.culturalNotes.map(note => `- ${note}`).join('\n')}

**Writing Tips:**
${guidelines.writingTips.map(tip => `- ${tip}`).join('\n')}

**SEO Keywords to Include:**
${guidelines.seoKeywords.join(', ')}

**Avoid:**
${guidelines.avoidPatterns.map(pattern => `- ${pattern}`).join('\n')}
`
}

/**
 * Get a compact version of guidelines for prompt injection
 */
export function getCompactGuidelines(lang: SupportedLanguage): string {
  const g = languageGuidelines[lang]

  return `[${g.languageName}] Audience: ${g.audienceDescription}. Key: ${g.culturalNotes.slice(0, 2).join('; ')}. Tone: ${g.toneGuidelines.split('\n')[1]?.trim() || 'Professional and engaging'}.`
}

/**
 * Check if a language is supported
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return ['en', 'de', 'fr', 'it'].includes(lang)
}
