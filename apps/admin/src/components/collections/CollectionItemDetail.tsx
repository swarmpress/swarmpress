'use client'

import { memo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'
import { Badge } from '../ui/badge'
import { Separator } from '../ui/separator'
import { ScrollArea } from '../ui/scroll-area'
import {
  Star,
  MapPin,
  Eye,
  EyeOff,
  ExternalLink,
  FileJson,
  Globe,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { CollectionItem, CollectionType } from '../../hooks/useCollections'
import { getItemTitle, getItemSummary, getItemImage } from '../../hooks/useCollections'

interface CollectionItemDetailProps {
  item: CollectionItem | null
  collectionType: CollectionType | null
  open: boolean
  onOpenChange: (open: boolean) => void
  locale?: string
}

/**
 * Modal dialog for viewing full collection item details
 * Shows all fields organized by section
 */
export const CollectionItemDetail = memo(function CollectionItemDetail({
  item,
  collectionType,
  open,
  onOpenChange,
  locale = 'en',
}: CollectionItemDetailProps) {
  if (!item) return null

  const title = getItemTitle(item, locale)
  const summary = getItemSummary(item, locale)
  const imageUrl = getItemImage(item)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden">
        {/* Header with image */}
        {imageUrl && (
          <div className="relative h-48 w-full overflow-hidden bg-muted">
            <img
              src={imageUrl}
              alt={title}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4">
              <h2 className="text-xl font-semibold text-white">{title}</h2>
              {item.village && (
                <div className="flex items-center gap-1 text-white/80 text-sm mt-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {item.village}
                </div>
              )}
            </div>
          </div>
        )}

        {!imageUrl && (
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{title}</DialogTitle>
            {item.village && (
              <DialogDescription className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {item.village}
              </DialogDescription>
            )}
          </DialogHeader>
        )}

        <ScrollArea className="max-h-[calc(85vh-12rem)]">
          <div className="px-6 pb-6 space-y-4">
            {/* Status badges */}
            <div className="flex flex-wrap gap-2">
              {!item.published && (
                <Badge variant="outline" className="gap-1">
                  <EyeOff className="h-3 w-3" />
                  Unpublished
                </Badge>
              )}
              {item.published && (
                <Badge variant="outline" className="gap-1 text-green-600 border-green-200">
                  <Eye className="h-3 w-3" />
                  Published
                </Badge>
              )}
              {item.featured && (
                <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-700">
                  <Star className="h-3 w-3" />
                  Featured
                </Badge>
              )}
              {collectionType && (
                <Badge
                  variant="outline"
                  style={{
                    borderColor: collectionType.color,
                    color: collectionType.color,
                  }}
                >
                  {collectionType.name || collectionType.type}
                </Badge>
              )}
            </div>

            {/* Summary */}
            {summary && (
              <p className="text-sm text-muted-foreground">{summary}</p>
            )}

            <Separator />

            {/* All fields */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <FileJson className="h-4 w-4" />
                All Fields
              </h4>
              <div className="space-y-3">
                {Object.entries(item.data).map(([key, value]) => (
                  <FieldDisplay key={key} fieldKey={key} value={value} locale={locale} />
                ))}
              </div>
            </div>

            <Separator />

            {/* Source file info */}
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <FileJson className="h-3.5 w-3.5" />
              Source: {item.sourceFile}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
})

/**
 * Component for displaying a single field value
 * Handles different value types including localized strings
 */
const FieldDisplay = memo(function FieldDisplay({
  fieldKey,
  value,
  locale,
}: {
  fieldKey: string
  value: unknown
  locale: string
}) {
  // Format field name
  const displayKey = fieldKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  // Handle null/undefined
  if (value === null || value === undefined) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
        <span className="text-sm text-muted-foreground italic">Not set</span>
      </div>
    )
  }

  // Handle boolean
  if (typeof value === 'boolean') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
        <span className="text-sm">{value ? 'Yes' : 'No'}</span>
      </div>
    )
  }

  // Handle number
  if (typeof value === 'number') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
        <span className="text-sm">{value}</span>
      </div>
    )
  }

  // Handle string
  if (typeof value === 'string') {
    // Check if it's a URL
    if (value.startsWith('http')) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            {value.length > 50 ? value.substring(0, 50) + '...' : value}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
        <span className="text-sm">{value}</span>
      </div>
    )
  }

  // Handle array
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
        <div className="flex flex-wrap gap-1">
          {value.map((item, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {typeof item === 'string' ? item : JSON.stringify(item)}
            </Badge>
          ))}
        </div>
      </div>
    )
  }

  // Handle object (likely localized string)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>

    // Check if it looks like a localized string
    const locales = ['en', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'ru', 'zh', 'ja', 'ko']
    const isLocalized = Object.keys(obj).some((k) => locales.includes(k))

    if (isLocalized) {
      return (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {displayKey}
          </span>
          <div className="space-y-1 pl-4 border-l-2 border-muted">
            {Object.entries(obj).map(([lang, text]) => (
              <div key={lang} className="flex gap-2">
                <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                  {lang.toUpperCase()}
                </Badge>
                <span className="text-sm">
                  {typeof text === 'string' ? text : JSON.stringify(text)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    // Generic object display
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
        <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    )
  }

  // Fallback
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
      <span className="text-sm">{String(value)}</span>
    </div>
  )
})
