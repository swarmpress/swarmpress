import type { ToolSecret, SetToolSecretInput } from '@swarm-press/shared'
import { db } from '../connection'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

/**
 * Database row type for tool_secrets
 */
interface ToolSecretRow {
  id: string
  website_id: string
  tool_config_id: string
  secret_key: string
  encrypted_value: string
  created_at: Date
  updated_at: Date
}

// Encryption settings
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Get encryption key from environment or generate a default for development
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.TOOL_SECRET_KEY || process.env.DATABASE_URL || 'development-secret-key'
  // Use scrypt to derive a proper key from the secret
  return scryptSync(secret, 'swarmpress-tool-secrets', 32)
}

/**
 * Encrypt a value
 */
function encrypt(value: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(value, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Return iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt a value
 */
function decrypt(encryptedValue: string): string {
  const key = getEncryptionKey()
  const [ivHex, authTagHex, encrypted] = encryptedValue.split(':')

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted value format')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * Convert database row to ToolSecret (without encrypted value)
 */
function rowToToolSecret(row: ToolSecretRow): ToolSecret {
  return {
    id: row.id,
    website_id: row.website_id,
    tool_config_id: row.tool_config_id,
    secret_key: row.secret_key,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

/**
 * Repository for tool_secrets table
 */
export class ToolSecretRepository {
  /**
   * Get all secrets for a tool on a website (decrypted)
   */
  async getSecretsForTool(websiteId: string, toolConfigId: string): Promise<Record<string, string>> {
    const result = await db.query<ToolSecretRow>(
      `SELECT * FROM tool_secrets WHERE website_id = $1 AND tool_config_id = $2`,
      [websiteId, toolConfigId]
    )

    const secrets: Record<string, string> = {}
    for (const row of result.rows) {
      try {
        secrets[row.secret_key] = decrypt(row.encrypted_value)
      } catch (error) {
        console.error(`[ToolSecretRepository] Failed to decrypt secret ${row.secret_key}:`, error)
        // Skip invalid secrets
      }
    }
    return secrets
  }

  /**
   * Get all secret keys for a tool (without values)
   */
  async getSecretKeysForTool(websiteId: string, toolConfigId: string): Promise<ToolSecret[]> {
    const result = await db.query<ToolSecretRow>(
      `SELECT * FROM tool_secrets WHERE website_id = $1 AND tool_config_id = $2 ORDER BY secret_key`,
      [websiteId, toolConfigId]
    )
    return result.rows.map(rowToToolSecret)
  }

  /**
   * Get all secrets for a website (without values)
   */
  async getSecretsForWebsite(websiteId: string): Promise<ToolSecret[]> {
    const result = await db.query<ToolSecretRow>(
      `SELECT * FROM tool_secrets WHERE website_id = $1 ORDER BY tool_config_id, secret_key`,
      [websiteId]
    )
    return result.rows.map(rowToToolSecret)
  }

  /**
   * Set a secret (create or update)
   */
  async setSecret(input: SetToolSecretInput): Promise<ToolSecret> {
    const encryptedValue = encrypt(input.value)

    const result = await db.query<ToolSecretRow>(
      `INSERT INTO tool_secrets (website_id, tool_config_id, secret_key, encrypted_value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (website_id, tool_config_id, secret_key)
       DO UPDATE SET encrypted_value = $4, updated_at = NOW()
       RETURNING *`,
      [input.website_id, input.tool_config_id, input.secret_key, encryptedValue]
    )

    return rowToToolSecret(result.rows[0]!)
  }

  /**
   * Delete a specific secret
   */
  async deleteSecret(websiteId: string, toolConfigId: string, secretKey: string): Promise<boolean> {
    const result = await db.query(
      `DELETE FROM tool_secrets WHERE website_id = $1 AND tool_config_id = $2 AND secret_key = $3`,
      [websiteId, toolConfigId, secretKey]
    )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Delete all secrets for a tool on a website
   */
  async deleteAllForTool(websiteId: string, toolConfigId: string): Promise<number> {
    const result = await db.query(
      `DELETE FROM tool_secrets WHERE website_id = $1 AND tool_config_id = $2`,
      [websiteId, toolConfigId]
    )
    return result.rowCount ?? 0
  }

  /**
   * Delete all secrets for a website
   */
  async deleteAllForWebsite(websiteId: string): Promise<number> {
    const result = await db.query(
      `DELETE FROM tool_secrets WHERE website_id = $1`,
      [websiteId]
    )
    return result.rowCount ?? 0
  }

  /**
   * Check if a secret exists
   */
  async secretExists(websiteId: string, toolConfigId: string, secretKey: string): Promise<boolean> {
    const result = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM tool_secrets
        WHERE website_id = $1 AND tool_config_id = $2 AND secret_key = $3
      ) as exists`,
      [websiteId, toolConfigId, secretKey]
    )
    return result.rows[0]!.exists
  }

  /**
   * Get a single decrypted secret value
   */
  async getSecretValue(websiteId: string, toolConfigId: string, secretKey: string): Promise<string | null> {
    const result = await db.query<ToolSecretRow>(
      `SELECT * FROM tool_secrets WHERE website_id = $1 AND tool_config_id = $2 AND secret_key = $3`,
      [websiteId, toolConfigId, secretKey]
    )

    if (result.rows.length === 0) {
      return null
    }

    try {
      return decrypt(result.rows[0]!.encrypted_value)
    } catch (error) {
      console.error(`[ToolSecretRepository] Failed to decrypt secret ${secretKey}:`, error)
      return null
    }
  }
}

/**
 * Singleton instance
 */
export const toolSecretRepository = new ToolSecretRepository()
