'use client'

import { useState, useEffect, useMemo } from 'react'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import { ScrollArea } from '../ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { GripVertical, Search, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react'

interface CollectionItem {
  slug: string
  data: Record<string, unknown>
  village?: string
}

interface SlugPickerProps {
  collectionType: string
  selectedSlugs: string[]
  village?: string
  availableCollectionTypes: string[]
  websiteId: string
  onCollectionTypeChange: (type: string) => void
  onVillageChange: (village: string | undefined) => void
  onSlugsChange: (slugs: string[]) => void
}

// Helper to get localized string value
function getLocalizedValue(value: unknown, locale = 'en'): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    return String(obj[locale] || obj['en'] || Object.values(obj)[0] || '')
  }
  return String(value)
}

// Helper to get item display name
function getItemName(item: CollectionItem): string {
  const data = item.data
  return (
    getLocalizedValue(data.name) ||
    getLocalizedValue(data.title) ||
    getLocalizedValue(data.label) ||
    item.slug
  )
}

// Helper to get item village
function getItemVillage(item: CollectionItem): string {
  return (
    item.village ||
    getLocalizedValue(item.data.village) ||
    ''
  )
}

export function SlugPicker({
  collectionType,
  selectedSlugs,
  village,
  availableCollectionTypes,
  websiteId,
  onCollectionTypeChange,
  onVillageChange,
  onSlugsChange,
}: SlugPickerProps) {
  const [items, setItems] = useState<CollectionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch items when collection type changes
  useEffect(() => {
    if (!collectionType || !websiteId) {
      setItems([])
      return
    }

    const fetchItems = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/trpc/github.listCollectionItems?input=${encodeURIComponent(
            JSON.stringify({ websiteId, collectionType })
          )}`,
          {
            headers: {
              authorization: 'Bearer ceo:admin@swarm.press',
            },
          }
        )
        const json = await response.json()
        if (json.result?.data?.items) {
          setItems(json.result.data.items)
        } else {
          setItems([])
        }
      } catch (e) {
        console.error('Failed to fetch collection items:', e)
        setError('Failed to load items')
        setItems([])
      } finally {
        setLoading(false)
      }
    }

    fetchItems()
  }, [collectionType, websiteId])

  // Get unique villages from items
  const villages = useMemo(() => {
    const villageSet = new Set<string>()
    items.forEach((item) => {
      const v = getItemVillage(item)
      if (v) villageSet.add(v)
    })
    return Array.from(villageSet).sort()
  }, [items])

  // Filter items by search query and village
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Filter by village if set
      if (village && getItemVillage(item).toLowerCase() !== village.toLowerCase()) {
        return false
      }
      // Filter by search query
      if (searchQuery) {
        const name = getItemName(item).toLowerCase()
        const slug = item.slug.toLowerCase()
        const query = searchQuery.toLowerCase()
        return name.includes(query) || slug.includes(query)
      }
      return true
    })
  }, [items, village, searchQuery])

  // Selected items in order
  const selectedItems = useMemo(() => {
    return selectedSlugs
      .map((slug) => items.find((item) => item.slug === slug))
      .filter(Boolean) as CollectionItem[]
  }, [selectedSlugs, items])

  // Toggle item selection
  const toggleItem = (slug: string) => {
    if (selectedSlugs.includes(slug)) {
      onSlugsChange(selectedSlugs.filter((s) => s !== slug))
    } else {
      onSlugsChange([...selectedSlugs, slug])
    }
  }

  // Move item up in order
  const moveUp = (index: number) => {
    if (index === 0) return
    const newSlugs = [...selectedSlugs]
    ;[newSlugs[index - 1], newSlugs[index]] = [newSlugs[index], newSlugs[index - 1]]
    onSlugsChange(newSlugs)
  }

  // Move item down in order
  const moveDown = (index: number) => {
    if (index === selectedSlugs.length - 1) return
    const newSlugs = [...selectedSlugs]
    ;[newSlugs[index], newSlugs[index + 1]] = [newSlugs[index + 1], newSlugs[index]]
    onSlugsChange(newSlugs)
  }

  // Remove item from selection
  const removeItem = (slug: string) => {
    onSlugsChange(selectedSlugs.filter((s) => s !== slug))
  }

  return (
    <div className="space-y-4">
      {/* Collection Type Selection */}
      <div className="space-y-2">
        <Label className="text-xs">Collection Type</Label>
        <Select value={collectionType} onValueChange={onCollectionTypeChange}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select collection type" />
          </SelectTrigger>
          <SelectContent>
            {availableCollectionTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Village Filter */}
      {villages.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Filter by Village (optional)</Label>
          <Select
            value={village || ''}
            onValueChange={(v) => onVillageChange(v || undefined)}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="All villages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All villages</SelectItem>
              {villages.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Selected Items (with reordering) */}
      {selectedItems.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">
            Selected Items ({selectedItems.length})
          </Label>
          <div className="border rounded-md p-2 space-y-1 bg-muted/30">
            {selectedItems.map((item, index) => (
              <div
                key={item.slug}
                className="flex items-center gap-2 p-2 bg-background rounded border text-sm"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 truncate">{getItemName(item)}</span>
                {getItemVillage(item) && (
                  <Badge variant="outline" className="text-[10px] flex-shrink-0">
                    {getItemVillage(item)}
                  </Badge>
                )}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => moveDown(index)}
                    disabled={index === selectedItems.length - 1}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={() => removeItem(item.slug)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Items */}
      {collectionType && (
        <div className="space-y-2">
          <Label className="text-xs">Available Items</Label>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items..."
              className="h-8 text-sm pl-8"
            />
          </div>

          {/* Items List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-sm text-destructive p-4 text-center">{error}</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No items found
            </div>
          ) : (
            <ScrollArea className="h-[200px] border rounded-md">
              <div className="p-2 space-y-1">
                {filteredItems.map((item) => (
                  <div
                    key={item.slug}
                    className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer"
                    onClick={() => toggleItem(item.slug)}
                  >
                    <Checkbox
                      checked={selectedSlugs.includes(item.slug)}
                      onCheckedChange={() => toggleItem(item.slug)}
                    />
                    <span className="flex-1 text-sm truncate">
                      {getItemName(item)}
                    </span>
                    {getItemVillage(item) && (
                      <Badge variant="outline" className="text-[10px]">
                        {getItemVillage(item)}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}
