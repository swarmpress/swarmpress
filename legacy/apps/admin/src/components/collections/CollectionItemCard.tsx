'use client'

import { memo } from 'react'
import { Card, CardContent } from '../ui/card'
import { Badge } from '../ui/badge'
import { Star, MapPin, Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { CollectionItem, CollectionType } from '../../hooks/useCollections'
import { getItemTitle, getItemSummary, getItemImage, getItemDisplayValue } from '../../hooks/useCollections'

interface CollectionItemCardProps {
  item: CollectionItem
  collectionType: CollectionType | null
  onClick?: () => void
  locale?: string
}

/**
 * Card component for displaying a single collection item
 * Dynamically displays fields based on collection schema
 */
export const CollectionItemCard = memo(function CollectionItemCard({
  item,
  collectionType,
  onClick,
  locale = 'en',
}: CollectionItemCardProps) {
  const title = getItemTitle(item, locale)
  const summary = getItemSummary(item, locale)
  const imageUrl = getItemImage(item)

  // Get rating if present
  const rating = item.data.rating as number | undefined
  const ratingText = item.data.rating_text as string | undefined

  // Get price range if present
  const priceRange = item.data.price_range as string | undefined

  return (
    <Card
      className={cn(
        'group cursor-pointer overflow-hidden transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20',
        !item.published && 'opacity-60'
      )}
      onClick={onClick}
    >
      {/* Image */}
      {imageUrl && (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        </div>
      )}

      <CardContent className={cn('p-3', !imageUrl && 'pt-3')}>
        {/* Header with title and status */}
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="font-medium text-sm leading-tight line-clamp-2">
            {title}
          </h3>
          {!item.published && (
            <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </div>

        {/* Summary */}
        {summary && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {summary}
          </p>
        )}

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {/* Village badge */}
          {item.village && (
            <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0">
              <MapPin className="h-2.5 w-2.5" />
              {item.village}
            </Badge>
          )}

          {/* Featured badge */}
          {item.featured && (
            <Badge variant="secondary" className="text-[10px] gap-0.5 px-1.5 py-0 bg-amber-100 text-amber-700">
              <Star className="h-2.5 w-2.5" />
              Featured
            </Badge>
          )}

          {/* Rating */}
          {rating && (
            <span className="flex items-center gap-0.5 text-amber-600">
              <Star className="h-3 w-3 fill-current" />
              {rating.toFixed(1)}
              {ratingText && <span className="text-muted-foreground">({ratingText})</span>}
            </span>
          )}

          {/* Price range */}
          {priceRange && (
            <span className="text-muted-foreground">{priceRange}</span>
          )}
        </div>

        {/* Collection type indicator */}
        {collectionType?.color && (
          <div
            className="absolute top-0 left-0 w-1 h-full"
            style={{ backgroundColor: collectionType.color }}
          />
        )}
      </CardContent>
    </Card>
  )
})
