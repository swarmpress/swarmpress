#!/usr/bin/env tsx
/**
 * Inspect batch results structure and test JSON extraction
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
dotenv.config({ path: resolve(__dirname, '../.env') })

import Anthropic from '@anthropic-ai/sdk'

const batchId = process.argv[2] || 'msgbatch_016417GjdTM1iEsDpr8J6f5j'

function extractJsonFromText(text: string): string | null {
  // Try to find JSON object in the text
  const jsonStart = text.indexOf('{')
  if (jsonStart === -1) return null

  // Find matching closing brace
  let depth = 0
  let jsonEnd = -1
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        jsonEnd = i + 1
        break
      }
    }
  }

  if (jsonEnd === -1) return null
  return text.substring(jsonStart, jsonEnd)
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  console.log(`Fetching results for batch: ${batchId}`)
  console.log('')

  const batch = await client.beta.messages.batches.retrieve(batchId)

  if (!batch.results_url) {
    console.log('No results URL available')
    return
  }

  console.log(`Fetching from: ${batch.results_url}`)

  const response = await fetch(batch.results_url, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
  })

  const text = await response.text()
  const lines = text.split('\n').filter(Boolean)

  console.log(`Found ${lines.length} results\n`)

  // Ensure output dir exists
  const outputDir = resolve(__dirname, '../.batch-output')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  for (const line of lines) {
    const result = JSON.parse(line)
    console.log(`\n=== ${result.custom_id} ===`)
    console.log(`Type: ${result.result.type}`)

    if (result.result.message) {
      console.log(`Content blocks: ${result.result.message.content.length}`)

      // Find all text blocks
      const textBlocks = result.result.message.content.filter((b: any) => b.type === 'text')
      console.log(`Text blocks: ${textBlocks.length}`)

      // Concatenate all text
      const fullText = textBlocks.map((b: any) => b.text).join('')
      console.log(`Full text length: ${fullText.length} chars`)

      // Try to extract JSON
      const json = extractJsonFromText(fullText)
      if (json) {
        console.log(`Extracted JSON length: ${json.length} chars`)

        // Try parsing
        try {
          const parsed = JSON.parse(json)
          console.log(`✓ Valid JSON! Items: ${parsed.items?.length || 'N/A'}`)

          // Save to file
          const filename = `${result.custom_id.replace('cinqueterre_events-', '')}-events.json`
          writeFileSync(resolve(outputDir, filename), JSON.stringify(parsed, null, 2))
          console.log(`  Saved to: .batch-output/${filename}`)
        } catch (e) {
          console.log(`✗ Invalid JSON: ${e}`)
        }
      } else {
        console.log(`✗ No JSON found`)
        // Show first 200 chars to debug
        console.log(`  First 200 chars: ${fullText.substring(0, 200)}...`)
      }
    }
  }
}

main().catch(console.error)
