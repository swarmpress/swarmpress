/**
 * URL Accessibility Checker
 * Verifies if URLs (images, links) are accessible
 */

export interface CheckUrlInput {
  url: string
  timeout?: number // default 5000ms
}

export interface CheckUrlOutput {
  accessible: boolean
  statusCode: number
  redirectUrl?: string
  contentType?: string
  contentLength?: number
  error?: string
  responseTimeMs?: number
}

/**
 * Check if a URL is accessible via HTTP HEAD request
 * Falls back to GET if HEAD is not supported
 */
export async function checkUrl(input: CheckUrlInput): Promise<CheckUrlOutput> {
  const { url, timeout = 5000 } = input
  const startTime = Date.now()

  try {
    // Validate URL format
    new URL(url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      // Try HEAD first (faster, less bandwidth)
      let response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'SwarmPress-ContentAudit/1.0',
        },
      })

      // Some servers don't support HEAD, fallback to GET
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'SwarmPress-ContentAudit/1.0',
            Range: 'bytes=0-0', // Only request first byte to minimize data
          },
        })
      }

      clearTimeout(timeoutId)
      const responseTimeMs = Date.now() - startTime

      const contentType = response.headers.get('content-type') || undefined
      const contentLength = response.headers.get('content-length')
        ? parseInt(response.headers.get('content-length')!, 10)
        : undefined

      // Check if we were redirected to a different URL
      const redirectUrl = response.url !== url ? response.url : undefined

      return {
        accessible: response.ok,
        statusCode: response.status,
        redirectUrl,
        contentType,
        contentLength,
        responseTimeMs,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    const responseTimeMs = Date.now() - startTime

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          accessible: false,
          statusCode: 0,
          error: `Request timed out after ${timeout}ms`,
          responseTimeMs,
        }
      }
      return {
        accessible: false,
        statusCode: 0,
        error: error.message,
        responseTimeMs,
      }
    }

    return {
      accessible: false,
      statusCode: 0,
      error: 'Unknown error',
      responseTimeMs,
    }
  }
}

/**
 * Check multiple URLs in parallel with concurrency control
 */
export async function checkUrls(
  urls: string[],
  options: {
    timeout?: number
    concurrency?: number
    onProgress?: (completed: number, total: number) => void
  } = {}
): Promise<Map<string, CheckUrlOutput>> {
  const { timeout = 5000, concurrency = 10, onProgress } = options
  const results = new Map<string, CheckUrlOutput>()
  let completed = 0

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const result = await checkUrl({ url, timeout })
        return { url, result }
      })
    )

    for (const { url, result } of batchResults) {
      results.set(url, result)
      completed++
      onProgress?.(completed, urls.length)
    }
  }

  return results
}

/**
 * Categorize a URL check result
 */
export function categorizeUrlStatus(result: CheckUrlOutput):
  | 'ok'
  | 'redirect'
  | 'client_error'  // 4xx
  | 'server_error'  // 5xx
  | 'timeout'
  | 'network_error' {
  if (result.error?.includes('timed out')) return 'timeout'
  if (result.statusCode === 0) return 'network_error'
  if (result.statusCode >= 200 && result.statusCode < 300) {
    return result.redirectUrl ? 'redirect' : 'ok'
  }
  if (result.statusCode >= 300 && result.statusCode < 400) return 'redirect'
  if (result.statusCode >= 400 && result.statusCode < 500) return 'client_error'
  if (result.statusCode >= 500) return 'server_error'
  return 'network_error'
}

/**
 * Check if URL points to an image based on content type
 */
export function isImageContentType(contentType?: string): boolean {
  if (!contentType) return false
  return contentType.startsWith('image/')
}
