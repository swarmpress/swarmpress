#!/usr/bin/env tsx
/**
 * Smoke test for RepoClient (repo-canonical migration verification).
 *
 * Picks the first website in the database that has GitHub credentials,
 * constructs a RepoClient via `getRepoClient(websiteId)`, and exercises a
 * minimal read surface against the live repo: list pages, read
 * `content/site.json`, list collections.
 *
 * Exit codes:
 *   0  — everything worked
 *   1  — no website with GitHub credentials in DB
 *   2  — RepoClient threw (network / auth / schema)
 *
 * Usage:
 *   tsx scripts/smoke-repo-client.ts [--website-id <uuid>]
 */

import { db } from '../packages/backend/src/db/connection'
import { getRepoClient } from '../packages/github-integration/src'

async function main() {
  const args = process.argv.slice(2)
  const flagIdx = args.indexOf('--website-id')
  const websiteIdArg = flagIdx !== -1 ? args[flagIdx + 1] : null

  let websiteId = websiteIdArg
  if (!websiteId) {
    const result = await db.query<{ id: string; title: string }>(
      `SELECT id, title FROM websites
        WHERE github_owner IS NOT NULL
          AND github_repo IS NOT NULL
          AND github_access_token IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`
    )
    if (!result.rows[0]) {
      console.error('[smoke] No website with GitHub credentials in DB. Pass --website-id explicitly.')
      process.exit(1)
    }
    websiteId = result.rows[0].id
    console.log(`[smoke] Picked website ${websiteId} (${result.rows[0].title})`)
  }

  try {
    console.log('[smoke] getRepoClient...')
    const repo = await getRepoClient(websiteId)

    console.log('[smoke] getConfig (content/config.json)...')
    const config = await repo.getConfig()
    console.log(`  config: ${config ? 'present' : 'missing'}`)

    console.log('[smoke] getSiteDefinition (content/site.json)...')
    const siteDef = await repo.getSiteDefinition()
    console.log(`  site definition: ${siteDef ? 'present' : 'missing'}`)

    console.log('[smoke] listPages...')
    const pages = await repo.listPages()
    console.log(`  pages: ${pages.length}`)

    console.log('[smoke] listCollectionTypes...')
    const types = await repo.listCollectionTypes()
    console.log(`  collection types: ${types.length} (${types.join(', ') || 'none'})`)

    console.log('\n[smoke] ✅ RepoClient is wired correctly')
    process.exit(0)
  } catch (err) {
    console.error('\n[smoke] ❌ RepoClient threw:')
    console.error(err)
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('[smoke] unexpected error:', err)
  process.exit(2)
})
