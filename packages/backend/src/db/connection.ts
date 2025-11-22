import { Pool, PoolClient, QueryResult } from 'pg'
import { getEnv } from '@agent-press/shared'

/**
 * PostgreSQL connection pool
 * Singleton pattern to ensure only one pool instance
 */
class Database {
  private static instance: Database
  private pool: Pool

  private constructor() {
    const env = getEnv()

    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20, // Maximum pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err)
      process.exit(-1)
    })

    // Log successful connection
    this.pool.on('connect', () => {
      console.log('Connected to PostgreSQL database')
    })
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database()
    }
    return Database.instance
  }

  /**
   * Get the connection pool
   */
  public getPool(): Pool {
    return this.pool
  }

  /**
   * Execute a query
   */
  public async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now()
    const result = await this.pool.query<T>(text, params)
    const duration = Date.now() - start

    // Log slow queries (> 1 second)
    if (duration > 1000) {
      console.warn(`Slow query (${duration}ms):`, text.substring(0, 100))
    }

    return result
  }

  /**
   * Get a client from the pool for transactions
   */
  public async getClient(): Promise<PoolClient> {
    return await this.pool.connect()
  }

  /**
   * Execute a transaction
   */
  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient()

    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Close the pool (for graceful shutdown)
   */
  public async close(): Promise<void> {
    await this.pool.end()
  }

  /**
   * Check database connectivity
   */
  public async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }
}

// Export singleton instance
export const db = Database.getInstance()

// Export types
export type { PoolClient, QueryResult } from 'pg'
