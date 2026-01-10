'use client'

import { useState, useMemo } from 'react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Separator } from '../ui/separator'
import { Badge } from '../ui/badge'
import { Search, X, Database, RefreshCw } from 'lucide-react'
import { useCollections, type CollectionItem } from '../../hooks/useCollections'
import { CollectionTypeList } from './CollectionTypeList'
import { CollectionItemsGrid } from './CollectionItemsGrid'
import { CollectionItemDetail } from './CollectionItemDetail'
import { cn } from '../../lib/utils'

interface CollectionBrowserProps {
  websiteId: string
  compact?: boolean
}

/**
 * Main Collection Browser component
 * Provides a complete UI for browsing collection data stored in GitHub
 */
export function CollectionBrowser({ websiteId, compact = false }: CollectionBrowserProps) {
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const {
    collectionTypes,
    isLoadingTypes,
    typesError,
    selectedType,
    setSelectedType,
    selectedTypeInfo,
    items,
    isLoadingItems,
    itemsError,
    villageFilter,
    setVillageFilter,
    searchQuery,
    setSearchQuery,
    filteredItems,
    villages,
    totalItems,
  } = useCollections(websiteId)

  // Calculate item counts per type
  const itemCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    // For now, we only have the count for the selected type
    if (selectedType) {
      counts[selectedType] = totalItems
    }
    return counts
  }, [selectedType, totalItems])

  const handleItemClick = (item: CollectionItem) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }

  const handleClearFilters = () => {
    setVillageFilter(null)
    setSearchQuery('')
  }

  const hasActiveFilters = villageFilter || searchQuery

  // Error states
  if (typesError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-medium mb-2">Failed to load collections</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {typesError.message}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full', compact && 'flex-col')}>
      {/* Sidebar - Collection Types */}
      <div
        className={cn(
          'border-r bg-muted/30',
          compact ? 'border-b border-r-0 h-auto' : 'w-64 shrink-0 overflow-y-auto'
        )}
      >
        {compact ? (
          // Compact mode: horizontal scrollable list
          <div className="flex gap-2 p-2 overflow-x-auto">
            {collectionTypes.map((type) => (
              <Button
                key={type.type}
                variant={selectedType === type.type ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedType(type.type)}
                className="shrink-0"
              >
                {type.name || type.type}
                {itemCounts[type.type] !== undefined && (
                  <Badge variant="secondary" className="ml-1.5 text-[10px]">
                    {itemCounts[type.type]}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        ) : (
          // Full mode: vertical list
          <CollectionTypeList
            types={collectionTypes}
            selectedType={selectedType}
            onSelectType={setSelectedType}
            itemCounts={itemCounts}
            isLoading={isLoadingTypes}
          />
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header with filters */}
        <div className="border-b p-4 bg-background">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">
                {selectedTypeInfo?.name || selectedType || 'Collections'}
              </h2>
              {selectedType && (
                <Badge variant="outline" className="text-xs">
                  {filteredItems.length} of {totalItems} items
                </Badge>
              )}
            </div>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Filter controls */}
          {selectedType && (
            <div className="flex gap-3">
              {/* Search */}
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Village filter */}
              {villages.length > 0 && (
                <Select
                  value={villageFilter || 'all'}
                  onValueChange={(v) => setVillageFilter(v === 'all' ? null : v)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All villages" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All villages</SelectItem>
                    {villages.map((village) => (
                      <SelectItem key={village} value={village}>
                        {village.charAt(0).toUpperCase() + village.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Items Grid */}
        <div className="flex-1 overflow-y-auto">
          {!selectedType ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a collection type to browse items</p>
              </div>
            </div>
          ) : itemsError ? (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center">
                <p className="text-sm text-destructive mb-4">
                  Failed to load items: {itemsError.message}
                </p>
                <Button
                  variant="outline"
                  onClick={() => setSelectedType(selectedType)}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <CollectionItemsGrid
              items={filteredItems}
              collectionType={selectedTypeInfo}
              onItemClick={handleItemClick}
              isLoading={isLoadingItems}
            />
          )}
        </div>
      </div>

      {/* Item Detail Modal */}
      <CollectionItemDetail
        item={selectedItem}
        collectionType={selectedTypeInfo}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
