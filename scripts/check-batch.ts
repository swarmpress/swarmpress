#!/usr/bin/env tsx
/**
 * Quick script to check batch status with full details
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import Anthropic from '@anthropic-ai/sdk'

const batchId = process.argv[2] || 'msgbatch_016417GjdTM1iEsDpr8J6f5j'

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  console.log(`Checking batch: ${batchId}`)
  console.log('')

  const batch = await client.beta.messages.batches.retrieve(batchId)

  console.log('Full batch response:')
  console.log(JSON.stringify(batch, null, 2))
}

main().catch(console.error)
