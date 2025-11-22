import { z } from 'zod'

/**
 * Environment variable schema with validation
 */
const envSchema = z.object({
  // Node Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().url().describe('PostgreSQL connection string'),

  // NATS
  NATS_URL: z.string().url().default('nats://localhost:4222'),

  // Temporal
  TEMPORAL_URL: z.string().default('localhost:7233'),

  // Claude API
  ANTHROPIC_API_KEY: z.string().min(1).describe('Anthropic API key for Claude'),

  // Backend API
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_SECRET: z.string().min(32).describe('Secret key for API authentication'),

  // CEO Authentication
  CEO_EMAIL: z.string().email().default('ceo@agent.press'),
  CEO_PASSWORD: z.string().min(8).describe('CEO password for dashboard access'),
})

export type Env = z.infer<typeof envSchema>

/**
 * Validate and parse environment variables
 * Throws an error if validation fails
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(env)

  if (!result.success) {
    console.error('❌ Environment validation failed:')
    console.error(result.error.format())
    throw new Error('Invalid environment variables')
  }

  return result.data
}

/**
 * Get validated environment configuration
 * Call this once at application startup
 */
export function getEnv(): Env {
  return validateEnv()
}
