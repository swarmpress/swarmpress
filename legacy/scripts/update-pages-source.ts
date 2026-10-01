#!/usr/bin/env tsx
import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

async function main() {
  const { db } = await import('../packages/backend/src/db/connection')

  const result = await db.query(
    'SELECT github_access_token, github_owner, github_repo FROM websites WHERE domain = $1',
    ['cinqueterre.travel']
  )

  const { github_access_token, github_owner, github_repo } = result.rows[0]

  const { Octokit } = await import('octokit')
  const octokit = new Octokit({ auth: github_access_token })

  console.log('Current Pages configuration:')
  const { data: currentPages } = await octokit.rest.repos.getPages({
    owner: github_owner,
    repo: github_repo,
  })
  console.log(`  Branch: ${currentPages.source?.branch}, Path: ${currentPages.source?.path}`)

  console.log('\nUpdating Pages source to gh-pages...')

  await octokit.rest.repos.updateInformationAboutPagesSite({
    owner: github_owner,
    repo: github_repo,
    source: {
      branch: 'gh-pages',
      path: '/'
    }
  })

  console.log('Done! Pages source updated.')

  // Verify
  const { data: newPages } = await octokit.rest.repos.getPages({
    owner: github_owner,
    repo: github_repo,
  })
  console.log(`\nNew configuration:`)
  console.log(`  Branch: ${newPages.source?.branch}, Path: ${newPages.source?.path}`)

  await db.close()
}

main().catch(e => { console.error(e); process.exit(1) })
