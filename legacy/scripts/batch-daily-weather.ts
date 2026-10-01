#!/usr/bin/env tsx
/**
 * Generate daily weather data for Cinque Terre (365 days)
 *
 * Creates historical climate averages for each day of the year
 * Useful for "what to expect when visiting on date X" content
 *
 * Usage:
 *   npx tsx scripts/batch-daily-weather.ts --submit   # Submit batch
 *   npx tsx scripts/batch-daily-weather.ts --status   # Check status
 *   npx tsx scripts/batch-daily-weather.ts --process  # Process results
 *   npx tsx scripts/batch-daily-weather.ts --dry-run  # Show what would be submitted
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
dotenv.config({ path: resolve(__dirname, '../.env') })

import Anthropic from '@anthropic-ai/sdk'

const BATCH_OUTPUT_DIR = resolve(__dirname, '../.batch-output/daily-weather')
const BATCH_ID_FILE = resolve(BATCH_OUTPUT_DIR, 'batch-id.txt')

// Generate all days of the year
function generateDays(): Array<{ month: number; day: number; monthName: string; dateStr: string }> {
  const days: Array<{ month: number; day: number; monthName: string; dateStr: string }> = []
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December']
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // Include Feb 29 for leap years

  for (let month = 0; month < 12; month++) {
    for (let day = 1; day <= daysInMonth[month]; day++) {
      days.push({
        month: month + 1,
        day,
        monthName: monthNames[month],
        dateStr: `${monthNames[month]} ${day}`
      })
    }
  }
  return days
}

const DAILY_WEATHER_SCHEMA = {
  type: "object",
  properties: {
    date: {
      type: "object",
      properties: {
        month: { type: "number" },
        day: { type: "number" },
        month_name: { type: "string" },
        season: { type: "string", enum: ["winter", "spring", "summer", "autumn"] },
        day_of_year: { type: "number" }
      },
      required: ["month", "day", "month_name", "season", "day_of_year"]
    },
    typical_weather: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentence weather summary" },
        icon: { type: "string", enum: ["sunny", "partly-cloudy", "cloudy", "rainy", "stormy", "foggy"] },
        temperature: {
          type: "object",
          properties: {
            avg_high_c: { type: "number" },
            avg_low_c: { type: "number" },
            avg_high_f: { type: "number" },
            avg_low_f: { type: "number" },
            feels_like_range: { type: "string" }
          }
        },
        precipitation: {
          type: "object",
          properties: {
            chance_percent: { type: "number" },
            avg_mm: { type: "number" },
            rainy_days_in_month: { type: "number" },
            type: { type: "string" }
          }
        },
        sunshine: {
          type: "object",
          properties: {
            hours: { type: "number" },
            uv_index: { type: "number" },
            sunrise_approx: { type: "string" },
            sunset_approx: { type: "string" }
          }
        },
        sea: {
          type: "object",
          properties: {
            temperature_c: { type: "number" },
            swimming_comfort: { type: "string", enum: ["too_cold", "refreshing", "pleasant", "warm", "ideal"] }
          }
        },
        wind: {
          type: "object",
          properties: {
            avg_speed_kmh: { type: "number" },
            direction: { type: "string" },
            description: { type: "string" }
          }
        }
      }
    },
    visitor_guidance: {
      type: "object",
      properties: {
        overall_rating: { type: "number", description: "1-10 rating for visiting" },
        crowd_level: { type: "string", enum: ["very_low", "low", "moderate", "high", "very_high"] },
        what_to_pack: { type: "array", items: { type: "string" } },
        best_activities: { type: "array", items: { type: "string" } },
        activities_to_avoid: { type: "array", items: { type: "string" } },
        tips: { type: "array", items: { type: "string" } }
      }
    },
    special_considerations: {
      type: "object",
      properties: {
        local_events: { type: "array", items: { type: "string" }, description: "Events typically occurring around this date" },
        trail_conditions: { type: "string" },
        ferry_reliability: { type: "string", enum: ["excellent", "good", "variable", "limited", "suspended"] },
        restaurant_availability: { type: "string" }
      }
    },
    translations: {
      type: "object",
      properties: {
        en: { type: "object", properties: { summary: { type: "string" } } },
        de: { type: "object", properties: { summary: { type: "string" } } },
        it: { type: "object", properties: { summary: { type: "string" } } },
        fr: { type: "object", properties: { summary: { type: "string" } } }
      }
    }
  },
  required: ["date", "typical_weather", "visitor_guidance", "special_considerations", "translations"]
}

function createBatchRequests(): any[] {
  const days = generateDays()

  return days.map((day, index) => {
    const season = day.month >= 3 && day.month <= 5 ? 'spring'
                 : day.month >= 6 && day.month <= 8 ? 'summer'
                 : day.month >= 9 && day.month <= 11 ? 'autumn'
                 : 'winter'

    const prompt = `Generate detailed daily weather and visitor guidance for Cinque Terre, Italy on ${day.dateStr}.

This is for a travel website - provide TYPICAL/HISTORICAL weather patterns for this date, NOT real-time forecasts.
Base your data on historical Mediterranean climate data for the Italian Riviera.

Key requirements:
1. Temperature and precipitation should reflect historical averages for this exact date
2. Include sea temperature (based on typical Mediterranean seasonal patterns)
3. Provide practical visitor guidance (what to pack, best activities)
4. Consider local events/festivals that typically occur around this date
5. Rate overall visiting conditions (1-10)
6. Translate summary to EN, DE, IT, FR

Season: ${season}
Day of year: ${index + 1}

Output a single JSON object matching this exact schema.`

    const prefill = `{
  "date": {
    "month": ${day.month},
    "day": ${day.day},
    "month_name": "${day.monthName}",
    "season": "${season}",
    "day_of_year": ${index + 1}
  },
  "typical_weather": {`

    return {
      custom_id: `daily-weather-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`,
      params: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: prefill }
        ]
      }
    }
  })
}

async function submitBatch(dryRun: boolean): Promise<void> {
  const requests = createBatchRequests()

  console.log(`\n=== Daily Weather Batch ===\n`)
  console.log(`Total days: ${requests.length}`)

  if (dryRun) {
    console.log('\n[DRY RUN] Sample request:')
    console.log(JSON.stringify(requests[0], null, 2))
    console.log(JSON.stringify(requests[182], null, 2)) // July 1
    return
  }

  // Ensure output directory exists
  if (!existsSync(BATCH_OUTPUT_DIR)) {
    mkdirSync(BATCH_OUTPUT_DIR, { recursive: true })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  console.log('\nSubmitting batch...')
  const batch = await client.beta.messages.batches.create({ requests })

  console.log(`\nBatch submitted!`)
  console.log(`  ID: ${batch.id}`)
  console.log(`  Status: ${batch.processing_status}`)

  // Save batch ID for later
  writeFileSync(BATCH_ID_FILE, batch.id)
  console.log(`\nBatch ID saved to: ${BATCH_ID_FILE}`)
}

async function checkStatus(): Promise<void> {
  if (!existsSync(BATCH_ID_FILE)) {
    console.log('No batch ID found. Run with --submit first.')
    return
  }

  const batchId = readFileSync(BATCH_ID_FILE, 'utf-8').trim()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const batch = await client.beta.messages.batches.retrieve(batchId)

  console.log(`\n=== Batch Status ===`)
  console.log(`  ID: ${batch.id}`)
  console.log(`  Status: ${batch.processing_status}`)
  console.log(`  Created: ${batch.created_at}`)

  if (batch.request_counts) {
    console.log(`  Processing: ${batch.request_counts.processing}`)
    console.log(`  Succeeded: ${batch.request_counts.succeeded}`)
    console.log(`  Errored: ${batch.request_counts.errored}`)
  }

  if (batch.results_url) {
    console.log(`  Results URL: ${batch.results_url}`)
  }
}

async function processResults(): Promise<void> {
  if (!existsSync(BATCH_ID_FILE)) {
    console.log('No batch ID found. Run with --submit first.')
    return
  }

  const batchId = readFileSync(BATCH_ID_FILE, 'utf-8').trim()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const batch = await client.beta.messages.batches.retrieve(batchId)

  if (batch.processing_status !== 'ended') {
    console.log(`Batch not complete yet. Status: ${batch.processing_status}`)
    return
  }

  if (!batch.results_url) {
    console.log('No results URL available')
    return
  }

  console.log(`\n=== Processing Results ===\n`)

  const response = await fetch(batch.results_url, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01'
    }
  })

  const text = await response.text()
  const lines = text.split('\n').filter(Boolean)

  console.log(`Found ${lines.length} results`)

  // Group by month
  const byMonth: Record<string, any[]> = {}
  let successCount = 0
  let errorCount = 0

  for (const line of lines) {
    const result = JSON.parse(line)
    const customId = result.custom_id // daily-weather-MM-DD
    const [, , month, day] = customId.split('-')

    if (result.result.type !== 'succeeded') {
      console.log(`  ✗ ${customId}: ${result.result.error?.message || 'Unknown error'}`)
      errorCount++
      continue
    }

    const message = result.result.message
    const textContent = message.content.find((c: any) => c.type === 'text')?.text || ''

    // Complete the prefill and parse
    const prefillStart = `{
  "date": {
    "month": ${parseInt(month)},
    "day": ${parseInt(day)},
    "month_name": "${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][parseInt(month)]}",
    "season": "${getSeason(parseInt(month))}",
    "day_of_year": ${getDayOfYear(parseInt(month), parseInt(day))}
  },
  "typical_weather": {`

    const fullJson = prefillStart + textContent

    try {
      const parsed = JSON.parse(fullJson)

      if (!byMonth[month]) byMonth[month] = []
      byMonth[month].push(parsed)
      successCount++
    } catch (e) {
      console.log(`  ✗ ${customId}: JSON parse error`)
      errorCount++
    }
  }

  // Save each month as a separate file
  for (const [month, days] of Object.entries(byMonth)) {
    const monthName = ['', 'january', 'february', 'march', 'april', 'may', 'june',
                       'july', 'august', 'september', 'october', 'november', 'december'][parseInt(month)]
    const filename = `${monthName}.json`
    const filePath = resolve(BATCH_OUTPUT_DIR, filename)

    // Sort by day
    days.sort((a, b) => a.date.day - b.date.day)

    const monthData = {
      collection_type: 'cinqueterre_daily_weather',
      month: parseInt(month),
      month_name: monthName,
      generated_at: new Date().toISOString(),
      item_count: days.length,
      items: days
    }

    writeFileSync(filePath, JSON.stringify(monthData, null, 2))
    console.log(`  ✓ Saved: ${filename} (${days.length} days)`)
  }

  console.log(`\n=== Summary ===`)
  console.log(`  Successful: ${successCount}`)
  console.log(`  Errors: ${errorCount}`)
}

function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

function getDayOfYear(month: number, day: number): number {
  const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let total = 0
  for (let m = 1; m < month; m++) {
    total += daysInMonth[m]
  }
  return total + day
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Daily Weather Batch Generator

Usage:
  npx tsx scripts/batch-daily-weather.ts --submit    Submit batch to Anthropic
  npx tsx scripts/batch-daily-weather.ts --status    Check batch status
  npx tsx scripts/batch-daily-weather.ts --process   Process completed results
  npx tsx scripts/batch-daily-weather.ts --dry-run   Show what would be submitted
`)
    process.exit(0)
  }

  if (args.includes('--submit')) {
    await submitBatch(false)
  } else if (args.includes('--dry-run')) {
    await submitBatch(true)
  } else if (args.includes('--status')) {
    await checkStatus()
  } else if (args.includes('--process')) {
    await processResults()
  } else {
    console.log('Specify --submit, --status, --process, or --dry-run')
    console.log('Use --help for more info')
  }
}

main().catch(console.error)
