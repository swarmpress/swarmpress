/**
 * Correlation ID Management
 * Tracks requests across services and workflows
 * Browser-compatible with fallback for environments without AsyncLocalStorage
 */

import { v4 as uuidv4 } from 'uuid'

interface CorrelationContext {
  correlationId: string
  parentId?: string
  metadata?: Record<string, unknown>
}

interface AsyncStorageInterface {
  getStore: () => CorrelationContext | undefined
  run: <T>(context: CorrelationContext, fn: () => T) => T
}

// Check if running in browser
const isBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined'

// Simple synchronous context storage for browser environments
let currentContext: CorrelationContext | undefined

const browserStorage: AsyncStorageInterface = {
  getStore: () => currentContext,
  run: <T>(context: CorrelationContext, fn: () => T): T => {
    const prevContext = currentContext
    currentContext = context
    try {
      return fn()
    } finally {
      currentContext = prevContext
    }
  },
}

// Use browser storage by default, Node.js storage will be set up lazily
let asyncStorage: AsyncStorageInterface = browserStorage
let nodeStorageInitialized = false

function getAsyncStorage(): AsyncStorageInterface {
  // In browser, always use browser storage
  if (isBrowser) {
    return browserStorage
  }

  // In Node.js, lazily initialize AsyncLocalStorage
  if (!nodeStorageInitialized) {
    nodeStorageInitialized = true
    try {
      // Use eval to hide require from bundlers
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const dynamicRequire = new Function('moduleName', 'return require(moduleName)')
      const asyncHooks = dynamicRequire('async_hooks')
      if (asyncHooks?.AsyncLocalStorage) {
        const storage = new asyncHooks.AsyncLocalStorage()
        asyncStorage = storage as AsyncStorageInterface
      }
    } catch {
      // Keep using browser storage as fallback
    }
  }

  return asyncStorage
}

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
  const context = getAsyncStorage().getStore()
  return context?.correlationId
}

/**
 * Get parent correlation ID
 */
export function getParentCorrelationId(): string | undefined {
  const context = getAsyncStorage().getStore()
  return context?.parentId
}

/**
 * Get correlation metadata
 */
export function getCorrelationMetadata(): Record<string, unknown> | undefined {
  const context = getAsyncStorage().getStore()
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

  return getAsyncStorage().run(context, fn)
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
