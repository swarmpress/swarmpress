/**
 * Correlation ID Management
 * Tracks requests across services and workflows
 */

import { v4 as uuidv4 } from 'uuid'
import { AsyncLocalStorage } from 'async_hooks'

interface CorrelationContext {
  correlationId: string
  parentId?: string
  metadata?: Record<string, unknown>
}

/**
 * Async context for correlation IDs
 */
const asyncStorage = new AsyncLocalStorage<CorrelationContext>()

/**
 * Generate new correlation ID
 */
export function generateCorrelationId(): string {
  return uuidv4()
}

/**
 * Get current correlation ID from context
 */
export function getCorrelationId(): string | undefined {
  const context = asyncStorage.getStore()
  return context?.correlationId
}

/**
 * Get parent correlation ID
 */
export function getParentCorrelationId(): string | undefined {
  const context = asyncStorage.getStore()
  return context?.parentId
}

/**
 * Get correlation metadata
 */
export function getCorrelationMetadata(): Record<string, unknown> | undefined {
  const context = asyncStorage.getStore()
  return context?.metadata
}

/**
 * Run function with correlation context
 */
export function runWithCorrelation<T>(
  correlationId: string,
  fn: () => T,
  parentId?: string,
  metadata?: Record<string, unknown>
): T {
  const context: CorrelationContext = {
    correlationId,
    parentId,
    metadata,
  }

  return asyncStorage.run(context, fn)
}

/**
 * Run function with new correlation ID
 */
export function runWithNewCorrelation<T>(
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const correlationId = generateCorrelationId()
  return runWithCorrelation(correlationId, fn, undefined, metadata)
}

/**
 * Express middleware for correlation IDs
 */
export function correlationMiddleware() {
  return (req: any, res: any, next: any) => {
    const correlationId =
      (req.headers['x-correlation-id'] as string) || generateCorrelationId()

    // Set response header
    res.setHeader('X-Correlation-ID', correlationId)

    // Run request handler with correlation context
    runWithCorrelation(
      correlationId,
      () => {
        next()
      },
      undefined,
      {
        method: req.method,
        path: req.path,
        ip: req.ip,
      }
    )
  }
}

/**
 * Get CloudEvents extension with correlation data
 */
export function getCloudEventsExtension(): Record<string, string> {
  const correlationId = getCorrelationId()
  const parentId = getParentCorrelationId()

  const extension: Record<string, string> = {}

  if (correlationId) {
    extension.correlationid = correlationId
  }

  if (parentId) {
    extension.parentcorrelationid = parentId
  }

  return extension
}
