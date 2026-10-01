/**
 * Error Tracking and Reporting
 * Captures and reports errors with context
 */

import { logger, LogContext } from './logger'
import { getCorrelationId } from './correlation'

export interface ErrorReport {
  id: string
  timestamp: string
  error: {
    name: string
    message: string
    stack?: string
  }
  context: LogContext
  severity: 'low' | 'medium' | 'high' | 'critical'
  correlationId?: string
}

export interface ErrorHandlerOptions {
  /**
   * Should error be rethrown after handling
   */
  rethrow?: boolean
  /**
   * Additional context to include
   */
  context?: LogContext
  /**
   * Error severity
   */
  severity?: ErrorReport['severity']
  /**
   * Custom error handler
   */
  onError?: (report: ErrorReport) => void | Promise<void>
}

class ErrorTracker {
  private errors: ErrorReport[] = []
  private handlers: Array<(report: ErrorReport) => void | Promise<void>> = []

  /**
   * Register global error handler
   */
  registerHandler(handler: (report: ErrorReport) => void | Promise<void>): void {
    this.handlers.push(handler)
  }

  /**
   * Track error
   */
  async track(
    error: Error,
    options: ErrorHandlerOptions = {}
  ): Promise<ErrorReport> {
    const report: ErrorReport = {
      id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      context: options.context || {},
      severity: options.severity || this.inferSeverity(error),
      correlationId: getCorrelationId(),
    }

    // Store error
    this.errors.push(report)

    // Log error
    logger.error(error.message, error, report.context)

    // Call handlers
    await this.notifyHandlers(report, options.onError)

    // Rethrow if requested
    if (options.rethrow) {
      throw error
    }

    return report
  }

  /**
   * Notify all error handlers
   */
  private async notifyHandlers(
    report: ErrorReport,
    customHandler?: (report: ErrorReport) => void | Promise<void>
  ): Promise<void> {
    const allHandlers = [
      ...this.handlers,
      ...(customHandler ? [customHandler] : []),
    ]

    await Promise.all(
      allHandlers.map((handler) => {
        try {
          return handler(report)
        } catch (err) {
          logger.error('Error handler failed', err as Error)
        }
      })
    )
  }

  /**
   * Infer error severity from error type
   */
  private inferSeverity(error: Error): ErrorReport['severity'] {
    // Database errors are critical
    if (error.message.includes('database') || error.message.includes('ECONNREFUSED')) {
      return 'critical'
    }

    // API errors are medium
    if (error.message.includes('API') || error.message.includes('request failed')) {
      return 'medium'
    }

    // Validation errors are low
    if (error.name === 'ValidationError' || error.name === 'ZodError') {
      return 'low'
    }

    // Default to high
    return 'high'
  }

  /**
   * Get recent errors
   */
  getRecentErrors(count: number = 100): ErrorReport[] {
    return this.errors.slice(-count)
  }

  /**
   * Get errors by severity
   */
  getErrorsBySeverity(severity: ErrorReport['severity']): ErrorReport[] {
    return this.errors.filter((err) => err.severity === severity)
  }

  /**
   * Get errors by correlation ID
   */
  getErrorsByCorrelation(correlationId: string): ErrorReport[] {
    return this.errors.filter((err) => err.correlationId === correlationId)
  }

  /**
   * Clear error history
   */
  clear(): void {
    this.errors = []
  }
}

/**
 * Global error tracker instance
 */
export const errorTracker = new ErrorTracker()

/**
 * Wrap async function with error tracking
 */
export function withErrorTracking<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options?: ErrorHandlerOptions
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args)
    } catch (error) {
      await errorTracker.track(error as Error, options)
      throw error
    }
  }
}

/**
 * Wrap sync function with error tracking
 */
export function withErrorTrackingSync<T extends any[], R>(
  fn: (...args: T) => R,
  options?: ErrorHandlerOptions
): (...args: T) => R {
  return (...args: T): R => {
    try {
      return fn(...args)
    } catch (error) {
      errorTracker.track(error as Error, options)
      throw error
    }
  }
}

/**
 * Express error middleware
 */
export function errorMiddleware() {
  return async (err: Error, req: any, res: any, _next: any) => {
    const report = await errorTracker.track(err, {
      context: {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      severity: 'high',
    })

    res.status(500).json({
      error: 'Internal Server Error',
      errorId: report.id,
      correlationId: report.correlationId,
    })
  }
}
