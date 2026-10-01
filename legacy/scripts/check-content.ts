import { db } from '../packages/backend/src/db/connection'

async function main() {
  const result = await db.query(`
    SELECT id, title, status, body, jsonb_typeof(body) as body_type
    FROM content_items
    WHERE id = 'f1306648-23f7-4b75-a93e-d4f089ccab2e'
  `)

  const content = result.rows[0]
  console.log('Content:', JSON.stringify(content, null, 2))
  console.log('\nBody is array:', Array.isArray(content.body))
  console.log('Body length:', content.body?.length || 0)
  console.log('First block:', JSON.stringify(content.body?.[0], null, 2))

  await db.end()
}

main()
