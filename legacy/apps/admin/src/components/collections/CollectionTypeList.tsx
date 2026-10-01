'use client'

import { memo } from 'react'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { Skeleton } from '../ui/skeleton'
import {
  UtensilsCrossed,
  Bed,
  Mountain,
  Calendar,
  MapPin,
  Package,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { CollectionType } from '../../hooks/useCollections'

// Map collection type names to icons
const COLLECTION_ICONS: Record<string, LucideIcon> = {
  restaurants: UtensilsCrossed,
  accommodations: Bed,
  hikes: Mountain,
  events: Calendar,
  pois: MapPin,
}

interface CollectionTypeListProps {
  types: CollectionType[]
  selectedType: string | null
  onSelectType: (type: string) => void
  itemCounts?: Record<string, number>
  isLoading?: boolean
}

/**
 * Sidebar component for listing collection types
 * Shows icon, name, color, and item count for each type
 */
export const CollectionTypeList = memo(function CollectionTypeList({
  types,
  selectedType,
  onSelectType,
  itemCounts = {},
  isLoading = false,
}: CollectionTypeListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (types.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No collections found
      </div>
    )
  }

  return (
    <div className="space-y-2 p-2">
      {types.map((type) => {
        const Icon = COLLECTION_ICONS[type.type] || Package
        const isSelected = selectedType === type.type
        const count = itemCounts[type.type] ?? 0

        return (
          <Card
            key={type.type}
            className={cn(
              'cursor-pointer p-3 transition-all',
              'hover:bg-accent hover:shadow-sm',
              isSelected && 'ring-2 ring-primary bg-primary/5'
            )}
            onClick={() => onSelectType(type.type)}
          >
            <div className="flex items-center gap-3">
              {/* Icon with color */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: type.color ? `${type.color}20` : 'var(--muted)',
                  color: type.color || 'currentColor',
                }}
              >
                <Icon className="h-5 w-5" />
              </div>

              {/* Name and count */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">
                  {type.name || formatTypeName(type.type)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {count > 0 ? `${count} items` : 'No items'}
                </div>
              </div>

              {/* Color indicator */}
              {type.color && (
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: type.color }}
                />
              )}
            </div>

            {/* Description if available */}
            {type.description && (
              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                {type.description}
              </p>
            )}
          </Card>
        )
      })}
    </div>
  )
})

/**
 * Format a collection type slug into a display name
 */
function formatTypeName(type: string): string {
  return type
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
