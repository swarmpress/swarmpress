/**
 * usePageSections Hook
 * React hook for loading and saving page sections via tRPC
 */

import { useState, useCallback } from 'react'
import type { PageSection } from '@swarm-press/shared'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

/**
 * Helper to make tRPC API calls
 * Uses direct fetch to avoid type resolution issues with AppRouter
 */
async function trpcCall<T>(
  procedure: string,
  type: 'query' | 'mutation',
  input: Record<string, unknown>
): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ceo:admin@swarm.press',
  }

  if (type === 'query') {
    const params = encodeURIComponent(JSON.stringify({ json: input }))
    const response = await fetch(`${API_URL}/api/trpc/${procedure}?input=${params}`, {
      method: 'GET',
      headers,
    })
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return data.result?.data?.json ?? data.result?.data
  } else {
    const response = await fetch(`${API_URL}/api/trpc/${procedure}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ json: input }),
    })
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return data.result?.data?.json ?? data.result?.data
  }
}

interface GetPageSectionsResult {
  sections: PageSection[]
  pageContent?: Record<string, unknown>
}

export interface UsePageSectionsResult {
  sections: PageSection[]
  isLoading: boolean
  error: string | null
  loadSections: (pagePath: string) => Promise<PageSection[]>
  saveSections: (pagePath: string, sections: PageSection[], message?: string) => Promise<void>
}

export function usePageSections(websiteId: string): UsePageSectionsResult {
  const [sections, setSections] = useState<PageSection[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load sections for a page
  const loadSections = useCallback(async (pagePath: string): Promise<PageSection[]> => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await trpcCall<GetPageSectionsResult>(
        'github.getPageSections',
        'query',
        { websiteId, pagePath }
      )

      const loadedSections = result?.sections || []
      setSections(loadedSections)
      return loadedSections
    } catch (err) {
      console.error('Failed to load page sections:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to load sections'
      setError(errorMessage)
      // Return empty array on error (page may not exist yet)
      setSections([])
      return []
    } finally {
      setIsLoading(false)
    }
  }, [websiteId])

  // Save sections for a page
  const saveSections = useCallback(async (
    pagePath: string,
    newSections: PageSection[],
    message?: string
  ): Promise<void> => {
    try {
      setIsLoading(true)
      setError(null)

      await trpcCall<{ success: boolean }>(
        'github.savePageSections',
        'mutation',
        { websiteId, pagePath, sections: newSections, message }
      )

      setSections(newSections)
    } catch (err) {
      console.error('Failed to save page sections:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to save sections'
      setError(errorMessage)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [websiteId])

  return {
    sections,
    isLoading,
    error,
    loadSections,
    saveSections,
  }
}
