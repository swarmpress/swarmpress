/**
 * Logging and Error Tracking
 * Exports all logging utilities
 */

export { logger, createLogger } from './logger'
export type { LogLevel, LogContext, LogEntry } from './logger'

export {
  generateCorrelationId,
  getCorrelationId,
  getParentCorrelationId,
  getCorrelationMetadata,
  runWithCorrelation,
  runWithNewCorrelation,
  correlationMiddleware,
  getCloudEventsExtension,
} from './correlation'

export {
  errorTracker,
  withErrorTracking,
  withErrorTrackingSync,
  errorMiddleware,
} from './error-tracker'
export type { ErrorReport, ErrorHandlerOptions } from './error-tracker'
