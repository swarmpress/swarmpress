/**
 * CLI Output Formatters
 * Table and display utilities for CLI output
 */

import Table from 'cli-table3'
import chalk from 'chalk'

/**
 * Format a simple table with headers and rows
 */
export function formatTable(
  headers: string[],
  rows: (string | number | undefined | null)[][],
  options?: { truncate?: number }
): string {
  const table = new Table({
    head: headers.map(h => chalk.cyan(h)),
    style: { head: [], border: [] },
  })

  for (const row of rows) {
    const formattedRow = row.map(cell => {
      const value = cell?.toString() ?? '-'
      if (options?.truncate && value.length > options.truncate) {
        return value.substring(0, options.truncate - 3) + '...'
      }
      return value
    })
    table.push(formattedRow)
  }

  return table.toString()
}

/**
 * Format a key-value object as vertical list
 */
export function formatDetails(data: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(data)) {
    const formattedKey = chalk.cyan(key.padEnd(20))
    const formattedValue = formatValue(value)
    lines.push(`${formattedKey} ${formattedValue}`)
  }
  return lines.join('\n')
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray('-')
  }
  if (typeof value === 'boolean') {
    return value ? chalk.green('Yes') : chalk.red('No')
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

/**
 * Format a status with color coding
 */
export function formatStatus(status: string): string {
  const statusColors: Record<string, (s: string) => string> = {
    // Content states
    idea: chalk.gray,
    planned: chalk.blue,
    brief_created: chalk.blue,
    draft: chalk.yellow,
    in_editorial_review: chalk.yellow,
    needs_changes: chalk.red,
    approved: chalk.green,
    scheduled: chalk.cyan,
    published: chalk.green,
    archived: chalk.gray,
    cancelled: chalk.red,

    // Task states
    pending: chalk.gray,
    in_progress: chalk.yellow,
    completed: chalk.green,
    failed: chalk.red,

    // Agent states
    active: chalk.green,
    inactive: chalk.gray,
    suspended: chalk.red,

    // Generic
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
  }

  const colorFn = statusColors[status] ?? chalk.white
  return colorFn(status)
}

/**
 * Format a UUID for display (shortened)
 */
export function formatId(id: string): string {
  if (id.length > 8) {
    return chalk.gray(id.substring(0, 8) + '...')
  }
  return chalk.gray(id)
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(date: Date | string | null | undefined): string {
  if (!date) return chalk.gray('-')
  const d = new Date(date)
  return d.toLocaleString()
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let unitIndex = 0
  let value = bytes

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Print a section header
 */
export function printHeader(title: string): void {
  console.log()
  console.log(chalk.bold.cyan(`═══ ${title} ═══`))
  console.log()
}

/**
 * Print a success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`))
}

/**
 * Print an error message
 */
export function printError(message: string): void {
  console.log(chalk.red(`✗ ${message}`))
}

/**
 * Print a warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`))
}

/**
 * Print an info message
 */
export function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`))
}
