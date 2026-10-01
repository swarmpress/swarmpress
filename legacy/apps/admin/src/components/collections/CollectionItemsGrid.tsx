'use client'

import { memo } from 'react'
import { Skeleton } from '../ui/skeleton'
import { CollectionItemCard } from './CollectionItemCard'
import type { CollectionItem, CollectionType } from '../../hooks/useCollections'
import { Package } from 'lucide-react'

interface CollectionItemsGridProps {
  items: CollectionItem[]
  collectionType: CollectionType | null
  onItemClick?: (item: CollectionItem) => void
  isLoading?: boolean
  locale?: string
}

/**
 * Grid component for displaying collection items
 * Responsive layout with 1-4 columns based on viewport
 */
export const CollectionItemsGrid = memo(function CollectionItemsGrid({
  items,
  collectionType,
  onItemClick,
  isLoading = false,
  locale = 'en',
}: CollectionItemsGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No items found</p>
        <p className="text-sm">
          {collectionType
            ? `No items in this collection match your filters`
            : 'Select a collection type to view items'}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
      {items.map((item) => (
        <CollectionItemCard
          key={`${item.sourceFile}-${item.slug}`}
          item={item}
          collectionType={collectionType}
          onClick={() => onItemClick?.(item)}
          locale={locale}
        />
      ))}
    </div>
  )
})
