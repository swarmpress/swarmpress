'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

export interface CollectionType {
  type: string
  schema_type?: string
  name?: string
  description?: string
  icon?: string
  color?: string
  display?: {
    title_field?: string
    summary_field?: string
    image_field?: string
    list_fields?: string[]
  }
}

export interface CollectionItem {
  slug: string
  data: Record<string, unknown>
  published?: boolean
  featured?: boolean
  village?: string
  sourceFile: string
}

export interface UseCollectionsResult {
  // Collection types
  collectionTypes: CollectionType[]
  isLoadingTypes: boolean
  typesError: Error | null

  // Selected type
  selectedType: string | null
  setSelectedType: (type: string | null) => void
  selectedTypeInfo: CollectionType | null

  // Items for selected type
  items: CollectionItem[]
  isLoadingItems: boolean
  itemsError: Error | null

  // Filters
  villageFilter: string | null
  setVillageFilter: (village: string | null) => void
  searchQuery: string
  setSearchQuery: (query: string) => void

  // Derived data
  filteredItems: CollectionItem[]
  villages: string[]
  totalItems: number

  // Refresh
  refreshTypes: () => void
  refreshItems: () => void
}

/**
 * Fetch helper for tRPC endpoints
 */
async function fetchTRPC<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
  const params = encodeURIComponent(JSON.stringify({ json: input }))
  const response = await fetch(`${API_URL}/api/trpc/${procedure}?input=${params}`, {
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer ceo:admin@swarm.press',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`)
  }

  const data = await response.json()

  // Handle tRPC response format
  if (data.result?.data?.json) {
    return data.result.data.json
  }

  // Handle error response
  if (data.error) {
    throw new Error(data.error.message || 'Unknown error')
  }

  return data
}

/**
 * Hook for browsing collection data from GitHub
 * Uses tRPC endpoints to fetch collection schemas and items
 */
export function useCollections(websiteId: string): UseCollectionsResult {
  // Local state
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [villageFilter, setVillageFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Collection types state
  const [collectionTypes, setCollectionTypes] = useState<CollectionType[]>([])
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  const [typesError, setTypesError] = useState<Error | null>(null)

  // Items state
  const [items, setItems] = useState<CollectionItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [itemsError, setItemsError] = useState<Error | null>(null)

  // Fetch collection types
  const fetchTypes = useCallback(async () => {
    if (!websiteId) return

    setIsLoadingTypes(true)
    setTypesError(null)

    try {
      const data = await fetchTRPC<{ collections: CollectionType[] }>(
        'github.getAllCollectionSchemas',
        { websiteId }
      )
      setCollectionTypes(data.collections || [])
    } catch (error) {
      console.error('Failed to fetch collection types:', error)
      setTypesError(error instanceof Error ? error : new Error('Failed to fetch collection types'))
    } finally {
      setIsLoadingTypes(false)
    }
  }, [websiteId])

  // Fetch items for selected type
  const fetchItems = useCallback(async () => {
    if (!websiteId || !selectedType) {
      setItems([])
      return
    }

    setIsLoadingItems(true)
    setItemsError(null)

    try {
      const data = await fetchTRPC<{ items: CollectionItem[]; total: number }>(
        'github.listCollectionItems',
        { websiteId, collectionType: selectedType }
      )
      setItems(data.items || [])
    } catch (error) {
      console.error('Failed to fetch collection items:', error)
      setItemsError(error instanceof Error ? error : new Error('Failed to fetch collection items'))
    } finally {
      setIsLoadingItems(false)
    }
  }, [websiteId, selectedType])

  // Initial fetch of types
  useEffect(() => {
    fetchTypes()
  }, [fetchTypes])

  // Fetch items when selected type changes
  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // Get info for selected type
  const selectedTypeInfo = useMemo(() => {
    if (!selectedType || !collectionTypes.length) return null
    return collectionTypes.find(t => t.type === selectedType) || null
  }, [selectedType, collectionTypes])

  // Get unique villages from items
  const villages = useMemo(() => {
    const villageSet = new Set<string>()
    items.forEach(item => {
      if (item.village) villageSet.add(item.village)
    })
    return Array.from(villageSet).sort()
  }, [items])

  // Filter items based on village and search query
  const filteredItems = useMemo(() => {
    let filtered = items

    // Filter by village
    if (villageFilter) {
      filtered = filtered.filter(item => item.village === villageFilter)
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(item => {
        // Search in slug
        if (item.slug.toLowerCase().includes(query)) return true

        // Search in common title fields
        const data = item.data
        const titleFields = ['name', 'title', 'label']
        for (const field of titleFields) {
          const value = data[field]
          if (typeof value === 'string' && value.toLowerCase().includes(query)) {
            return true
          }
          // Check localized strings
          if (typeof value === 'object' && value !== null) {
            const localized = value as Record<string, string>
            for (const locale of Object.values(localized)) {
              if (typeof locale === 'string' && locale.toLowerCase().includes(query)) {
                return true
              }
            }
          }
        }

        return false
      })
    }

    return filtered
  }, [items, villageFilter, searchQuery])

  return {
    // Collection types
    collectionTypes,
    isLoadingTypes,
    typesError,

    // Selected type
    selectedType,
    setSelectedType,
    selectedTypeInfo,

    // Items
    items,
    isLoadingItems,
    itemsError,

    // Filters
    villageFilter,
    setVillageFilter,
    searchQuery,
    setSearchQuery,

    // Derived
    filteredItems,
    villages,
    totalItems: items.length,

    // Refresh functions
    refreshTypes: fetchTypes,
    refreshItems: fetchItems,
  }
}

/**
 * Helper to extract a display value from an item
 * Handles localized strings and nested objects
 */
export function getItemDisplayValue(
  item: CollectionItem,
  field: string,
  locale: string = 'en'
): string {
  const value = item.data[field]

  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  // Handle localized strings
  if (typeof value === 'object' && value !== null) {
    const localized = value as Record<string, unknown>
    const localeValue = localized[locale] || localized['en']
    if (typeof localeValue === 'string') return localeValue

    // Try first string value
    for (const v of Object.values(localized)) {
      if (typeof v === 'string') return v
    }
  }

  return ''
}

/**
 * Helper to get the title/name of an item
 */
export function getItemTitle(item: CollectionItem, locale: string = 'en'): string {
  // Try common title fields
  for (const field of ['name', 'title', 'label']) {
    const value = getItemDisplayValue(item, field, locale)
    if (value) return value
  }

  // Fall back to slug
  return item.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Helper to get a summary/description of an item
 */
export function getItemSummary(item: CollectionItem, locale: string = 'en'): string {
  for (const field of ['description', 'summary', 'intro', 'excerpt']) {
    const value = getItemDisplayValue(item, field, locale)
    if (value) return value
  }
  return ''
}

/**
 * Helper to get an image URL from an item
 */
export function getItemImage(item: CollectionItem): string | null {
  for (const field of ['image', 'thumbnail', 'photo', 'cover', 'hero_image']) {
    const value = item.data[field]
    if (typeof value === 'string' && value.startsWith('http')) {
      return value
    }
    // Handle object with url property
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      if (typeof obj.url === 'string') return obj.url
      if (typeof obj.src === 'string') return obj.src
    }
  }
  return null
}
