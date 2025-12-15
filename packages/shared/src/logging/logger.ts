/**
 * Structured Logging System
 * Provides consistent logging across all packages with correlation IDs
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  correlationId?: string
  agentId?: string
  contentId?: string
  taskId?: string
  workflowId?: string
  runId?: string
  [key: string]: unknown
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

class Logger {
  private level: LogLevel
  private context: LogContext

  constructor(level: LogLevel = 'info', context: LogContext = {}) {
    this.level = level
    this.context = context
  }

  /**
   * Create child logger with additional context
   */
  child(context: LogContext): Logger {
    return new Logger(this.level, { ...this.context, ...context })
  }

  /**
   * Set correlation ID for request tracing
   */
  withCorrelationId(correlationId: string): Logger {
    return this.child({ correlationId })
  }

  /**
   * Check if log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    const currentLevelIndex = levels.indexOf(this.level)
    const messageLevelIndex = levels.indexOf(level)
    return messageLevelIndex >= currentLevelIndex
  }

  /**
   * Format log entry
   */
  private formatLog(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context, ...context },
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    return entry
  }

  /**
   * Write log entry
   */
  private write(entry: LogEntry): void {
    const output = JSON.stringify(entry)

    switch (entry.level) {
      case 'debug':
      case 'info':
        console.log(output)
        break
      case 'warn':
        console.warn(output)
        break
      case 'error':
        console.error(output)
        break
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return
    const entry = this.formatLog('debug', message, context)
    this.write(entry)
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return
    const entry = this.formatLog('info', message, context)
    this.write(entry)
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return
    const entry = this.formatLog('warn', message, context)
    this.write(entry)
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog('error')) return
    const entry = this.formatLog('error', message, context, error)
    this.write(entry)
  }

  /**
   * Log with custom level
   */
  log(level: LogLevel, message: string, context?: LogContext): void {
    switch (level) {
      case 'debug':
        this.debug(message, context)
        break
      case 'info':
        this.info(message, context)
        break
      case 'warn':
        this.warn(message, context)
        break
      case 'error':
        this.error(message, undefined, context)
        break
    }
  }
}

/**
 * Create default logger instance
 */
export function createLogger(
  level?: LogLevel,
  context?: LogContext
): Logger {
  const logLevel = (level || (typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined) || 'info') as LogLevel
  return new Logger(logLevel, context)
}

/**
 * Default logger instance
 */
export const logger = createLogger()
