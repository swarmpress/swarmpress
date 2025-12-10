/**
 * Test direct database update for JSONB
 */

import { db } from '../packages/backend/src/db/connection'

async function main() {
  console.log('Testing direct database update...\n')

  const contentId = 'f1306648-23f7-4b75-a93e-d4f089ccab2e'

  const body = [
    { type: 'heading', level: 1, text: 'Beaches in Cinque Terre' },
    { type: 'paragraph', text: 'Brief intro paragraph here.' }
  ]

  console.log('Body to insert:', JSON.stringify(body, null, 2))
  console.log('Body type:', typeof body)
  console.log('Is array:', Array.isArray(body))

  try {
    // Test 1: Direct with JSON.stringify
    console.log('\n--- Test 1: Using JSON.stringify ---')
    const result1 = await db.query(
      `UPDATE content_items SET body = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, title, body`,
      [JSON.stringify(body), contentId]
    )
    console.log('✅ Test 1 SUCCESS')
    console.log('Result:', JSON.stringify(result1.rows[0], null, 2))
  } catch (e: any) {
    console.error('❌ Test 1 FAILED:', e.message)
  }

  try {
    // Test 2: Direct with object (let pg driver handle it)
    console.log('\n--- Test 2: Using object directly ---')
    const result2 = await db.query(
      `UPDATE content_items SET body = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, body`,
      [body, contentId]
    )
    console.log('✅ Test 2 SUCCESS')
    console.log('Result:', JSON.stringify(result2.rows[0], null, 2))
  } catch (e: any) {
    console.error('❌ Test 2 FAILED:', e.message)
  }

  try {
    // Test 3: Using to_jsonb function
    console.log('\n--- Test 3: Using to_jsonb($1::text) ---')
    const result3 = await db.query(
      `UPDATE content_items SET body = to_jsonb($1::text)::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, title, body`,
      [JSON.stringify(body), contentId]
    )
    console.log('✅ Test 3 SUCCESS')
    console.log('Result:', JSON.stringify(result3.rows[0], null, 2))
  } catch (e: any) {
    console.error('❌ Test 3 FAILED:', e.message)
  }

  // Check current state
  console.log('\n--- Final state ---')
  const current = await db.query('SELECT id, title, status, body FROM content_items WHERE id = $1', [contentId])
  console.log('Content:', JSON.stringify(current.rows[0], null, 2))

  await db.end()
}

main()
