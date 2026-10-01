# scripts/

Operational scripts for swarm.press. Run each with `tsx scripts/<name>.ts`
unless noted otherwise. Where a script writes to the database it expects
`DATABASE_URL` to be set (the docker-compose default is fine for local dev).

## Bootstrap, seed, clear

| Script | Purpose | When to use |
| --- | --- | --- |
| `bootstrap.ts` | Bootstrap script — initializes company, departments, roles, agents | First-time setup of a fresh database |
| `seed.ts` | Seed sample content, tasks, and tickets on top of bootstrap | After bootstrap, to get a runnable demo dataset |
| `seed-bootstrap.ts` | Loads env then re-exports bootstrap so seed scripts share env wiring | Used internally by `seed.ts`; rarely run standalone |
| `seed-prompts.ts` | Seed company/website/agent prompt templates (3-level prompt system) | After bootstrap, before running prompt-driven agents |
| `seed-cinque-terre-blueprints.ts` | Seed Cinque Terre page blueprints | When initializing the Cinque Terre reference site |
| `seed-cinqueterre-collections.ts` | Seed Cinque Terre collection items (restaurants, hikes, etc.) | After Cinque Terre bootstrap |
| `clear.ts` | Truncate operational tables (resets state) | When you want a clean slate without dropping the schema |
| `cleanup-workflows.ts` | Cancel/terminate stale Temporal workflow executions | Before re-running a flaky e2e or after a worker crash |

## Tests

| Script | Purpose | When to use |
| --- | --- | --- |
| `test-e2e.ts` | End-to-end integration test against real Postgres + NATS + Temporal | Smoke-test infra after docker compose / migration / worker changes |
| `test-workflow-mock.ts` | Mocked unit-style walk-through of the content workflow (no infra) | Quick sanity check while developing workflow logic |
| `test-direct-agent.ts` | Invokes an agent directly, bypassing Temporal | Debug agent behaviour without workflow plumbing |
| `test-build-from-github.ts` | Test `buildFromGitHub` site-builder entry point | When changing site-builder GitHub integration |
| `test-db-update.ts` | Test direct database update for JSONB columns | Debug JSONB write/serialization issues |
| `test-getters.ts` | Test collection getter functions | When changing the collection getter framework |
| `test-github-pr.ts` | Direct GitHub PR creation test | Debug GitHub API credentials / Octokit wiring |
| `test-github-submit.ts` | Test the GitHub submit flow used by agents | Debug the agent-to-GitHub PR pipeline |
| `test-github-workflow.ts` | End-to-end GitHub integration workflow test | Verify full PR → merge → deploy chain |
| `test-minimal-content.ts` | Minimal smoke test: write a tiny content brief through the pipeline | Quick regression check on content-production |
| `test-single-page.ts` | Generate content for a single page end-to-end | Reproduce a specific page-generation bug |
| `test-weather-api.ts` | Hit the weather provider directly | Debug weather-service credentials / endpoints |

## Generate (content / pages / sites)

| Script | Purpose | When to use |
| --- | --- | --- |
| `generate-cinqueterre.ts` | Build the Cinque Terre website end-to-end | Full regeneration of the reference site |
| `generate-vernazza.ts` | Generate Vernazza-specific content | Targeted village content refresh |
| `generate-content-with-personas.ts` | Run content generation using DB-stored agent personas | Verify persona-aware output |
| `generate-page-content-batch.ts` | Batch page content generation across many pages | Bulk content fill on a new site |
| `generate-website-navigation.ts` | Generate navigation structure from sitemap | After sitemap edits |
| `create-missing-blog-posts.ts` | Backfill blog posts that are referenced but not authored | Recover from partial blog-index runs |

## Batch processing

| Script | Purpose | When to use |
| --- | --- | --- |
| `batch-collection-pipeline.ts` | Batch pipeline for collection extraction | Bulk-build collections from raw inputs |
| `batch-daily-weather.ts` | Generate 365 days of weather data for Cinque Terre | One-off seasonal seed |
| `batch-fix-broken.ts` | Re-run failed collection extractions | After a partial batch failure |
| `batch-generate-website.ts` | Batch content generation across an entire site | Bulk content refresh |
| `check-batch.ts` | Show batch job status with full details | Inspect a running or failed batch |
| `inspect-batch-results.ts` | Inspect raw batch result JSON structure | Debugging extraction format problems |
| `process-batch-results.ts` | Extract validated items from completed batch runs | Promote batch outputs into the DB |
| `process-fix-batches.ts` | Process the dedicated fix-batches for broken collection files | Recovery after broken-extraction batches |
| `import-batch-output.ts` | Import processed batch JSON into the database | Land batch results into operational tables |

## Audit, verify, fix

| Script | Purpose | When to use |
| --- | --- | --- |
| `audit-content-completeness.ts` | Report which pages have incomplete content | Before a publish to find gaps |
| `audit-content-status.ts` | Audit `cinqueterre.travel` content statuses | Editorial sweep before release |
| `audit-generated-content.ts` | Audit AI-generated content for quality issues | Periodic QA |
| `run-content-audit.ts` | Top-level content audit runner | Wraps the audit-* scripts above |
| `check-content.ts` | TBD — uncertain purpose, recommend audit | (no header comment found) |
| `verify-infrastructure.ts` | Verify Postgres / NATS / Temporal connectivity | Pre-flight check before running pipelines |
| `verify-website-infrastructure.ts` | Verify per-website infra (GitHub repo, Pages, etc.) | Before publishing a new site |
| `fix-broken-images.ts` | Replace broken image URLs across content | After a CDN migration or image-rot detection |
| `fix-site-json-titles.ts` | Repair double-nested `LocalizedString` titles in `site.json` | One-off migration fix |

## Sync / export / deploy

| Script | Purpose | When to use |
| --- | --- | --- |
| `sync-sitemap-from-pages.ts` | Rebuild sitemap from current pages table | After bulk page edits |
| `export-to-github.ts` | Export site content to its GitHub repo | Publish content via Git |
| `export-collections-grouped.ts` | Export collections grouped by village | Per-village content export |
| `export-batch-to-github.ts` | Export batch-processed collection data to GitHub | Promote batch outputs to the content repo |
| `deploy-cinqueterre.ts` | Deploy the Cinque Terre site | Trigger a Cinque Terre release |
| `deploy-to-github-pages.ts` | Deploy generic site to GitHub Pages | Publish to GH Pages |
| `deploy-via-git.ts` | Push built artifacts to GitHub Pages branch via Git | When the GitHub Pages REST flow is unavailable |
| `update-pages-source.ts` | TBD — uncertain purpose, recommend audit | (no header comment found) |

## Migrations / data fixes

| Script | Purpose | When to use |
| --- | --- | --- |
| `migrate-editorial-content.ts` | Move legacy editorial content into the collections model | One-off historical migration |
| `migrate-images-to-cdn.ts` | Move image references from local to CDN URLs | When introducing the CDN |
| `migrate-to-i18n.ts` | Convert language-separated pages into the i18n structure | One-off when adding multi-language support |
| `enrich-collection-items.ts` | Enrich collection items with AI-generated detail | After importing raw collections |
| `enrich-pages-with-images.ts` | Add images to pages that lack them | After AI-text-only content runs |

## Other

| Script | Purpose | When to use |
| --- | --- | --- |
| `build-wki.ts` | Build the Website Knowledge Index used by linking/SEO agents | Refresh internal-link suggestions |
| `research-collections.ts` | Run the Collection Research workflow ad-hoc | Manual research run outside the scheduler |
| `setup-schedules.ts` | Register / refresh the Temporal Schedules used for autonomous runs | After scheduling-config changes |
| `start-webhook-proxy.sh` | Local proxy for forwarding GitHub webhooks (shell, not TS) | Local dev when behind NAT |
| `trigger-content-workflow.ts` | Insert a brief and start `contentProductionWorkflow` | Kick off a content run from the CLI |
