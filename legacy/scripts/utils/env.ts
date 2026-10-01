/**
 * Shared environment helpers for swarm.press scripts.
 *
 * These helpers exist so that operational scripts under /scripts do not all
 * duplicate the same `process.env.X || 'fallback'` pattern. The defaults match
 * the values used by the local docker-compose stack so that scripts work out
 * of the box during development.
 */

const DEFAULT_DATABASE_URL =
  'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const DEFAULT_TEMPORAL_URL = 'localhost:7233'
const DEFAULT_NATS_URL = 'nats://localhost:4222'

/**
 * Returns the PostgreSQL connection string from DATABASE_URL, falling back to
 * the local docker-compose default.
 */
export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL
}

/**
 * Returns the Temporal frontend address (host:port). Honors TEMPORAL_URL,
 * with TEMPORAL_ADDRESS as a secondary alias used by some Temporal SDK
 * examples.
 */
export function getTemporalUrl(): string {
  return (
    process.env.TEMPORAL_URL ||
    process.env.TEMPORAL_ADDRESS ||
    DEFAULT_TEMPORAL_URL
  )
}

/**
 * Returns the NATS connection URL.
 */
export function getNatsUrl(): string {
  return process.env.NATS_URL || DEFAULT_NATS_URL
}
