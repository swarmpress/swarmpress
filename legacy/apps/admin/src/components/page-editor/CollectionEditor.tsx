'use client'

import { useState, useEffect, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import type { CollectionSource } from '@swarm-press/shared'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Switch } from '../ui/switch'
import { AlertCircle, Database, Info } from 'lucide-react'

interface CollectionEditorProps {
  collectionSource?: CollectionSource
  availableCollections: string[]
  onChange: (source: CollectionSource | undefined) => void
}

export function CollectionEditor({
  collectionSource,
  availableCollections,
  onChange,
}: CollectionEditorProps) {
  const [mode, setMode] = useState<'simple' | 'json'>('simple')
  const [jsonValue, setJsonValue] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Local state for simple mode
  const [collection, setCollection] = useState(collectionSource?.collection || '')
  const [limit, setLimit] = useState<number | undefined>(collectionSource?.limit)
  const [sortField, setSortField] = useState(collectionSource?.sort?.field || '')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    collectionSource?.sort?.direction || 'desc'
  )
  const [filterJson, setFilterJson] = useState(
    collectionSource?.filter ? JSON.stringify(collectionSource.filter, null, 2) : ''
  )

  // Sync JSON value when switching modes or props change
  useEffect(() => {
    if (mode === 'json') {
      setJsonValue(collectionSource ? JSON.stringify(collectionSource, null, 2) : '{}')
    }
  }, [mode, collectionSource])

  // Update local state when props change
  useEffect(() => {
    setCollection(collectionSource?.collection || '')
    setLimit(collectionSource?.limit)
    setSortField(collectionSource?.sort?.field || '')
    setSortDirection(collectionSource?.sort?.direction || 'desc')
    setFilterJson(
      collectionSource?.filter ? JSON.stringify(collectionSource.filter, null, 2) : ''
    )
  }, [collectionSource])

  // Build source from simple mode inputs
  const buildSource = (): CollectionSource | undefined => {
    if (!collection) return undefined

    const source: CollectionSource = { collection }

    if (limit !== undefined && limit > 0) {
      source.limit = limit
    }

    if (sortField) {
      source.sort = { field: sortField, direction: sortDirection }
    }

    if (filterJson.trim()) {
      try {
        source.filter = JSON.parse(filterJson)
      } catch {
        // Invalid filter JSON, skip
      }
    }

    return source
  }

  // Handle simple mode changes
  const handleSimpleChange = () => {
    onChange(buildSource())
  }

  // Handle JSON mode changes
  const handleJsonChange = (value: string) => {
    setJsonValue(value)
    try {
      if (value.trim() === '' || value.trim() === '{}') {
        setJsonError(null)
        onChange(undefined)
        return
      }

      const parsed = JSON.parse(value)
      setJsonError(null)

      // Validate structure
      if (parsed.collection && typeof parsed.collection === 'string') {
        onChange(parsed as CollectionSource)
      } else if (Object.keys(parsed).length === 0) {
        onChange(undefined)
      } else {
        setJsonError('Missing required "collection" field')
      }
    } catch (e) {
      setJsonError('Invalid JSON')
    }
  }

  // Clear collection binding
  const handleClear = () => {
    setCollection('')
    setLimit(undefined)
    setSortField('')
    setSortDirection('desc')
    setFilterJson('')
    setJsonValue('{}')
    onChange(undefined)
  }

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Collection Binding</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Simple</span>
          <Switch
            checked={mode === 'json'}
            onCheckedChange={(checked) => setMode(checked ? 'json' : 'simple')}
          />
          <span className="text-xs text-muted-foreground">JSON</span>
        </div>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/50 rounded-lg text-xs text-blue-700 dark:text-blue-300">
        <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Collection sections pull dynamic data</p>
          <p className="mt-1 text-blue-600 dark:text-blue-400">
            Data from the selected collection will be fetched at build time and
            passed to this section for rendering.
          </p>
        </div>
      </div>

      {mode === 'simple' ? (
        <>
          {/* Collection Selection */}
          <div className="space-y-2">
            <Label className="text-xs">Collection Type</Label>
            <Select
              value={collection}
              onValueChange={(value) => {
                setCollection(value)
                setTimeout(handleSimpleChange, 0)
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select collection" />
              </SelectTrigger>
              <SelectContent>
                {availableCollections.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                {/* Common collections not in the list */}
                {!availableCollections.includes('blog') && (
                  <SelectItem value="blog">blog</SelectItem>
                )}
                {!availableCollections.includes('events') && (
                  <SelectItem value="events">events</SelectItem>
                )}
                {!availableCollections.includes('team') && (
                  <SelectItem value="team">team</SelectItem>
                )}
                {!availableCollections.includes('faq') && (
                  <SelectItem value="faq">faq</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Limit */}
          <div className="space-y-2">
            <Label className="text-xs">Limit (optional)</Label>
            <Input
              type="number"
              min={1}
              value={limit || ''}
              onChange={(e) => {
                setLimit(e.target.value ? parseInt(e.target.value) : undefined)
                setTimeout(handleSimpleChange, 0)
              }}
              className="h-8 text-sm"
              placeholder="e.g., 5 (show latest 5 items)"
            />
          </div>

          {/* Sort */}
          <div className="space-y-2">
            <Label className="text-xs">Sort By (optional)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={sortField}
                onChange={(e) => {
                  setSortField(e.target.value)
                  setTimeout(handleSimpleChange, 0)
                }}
                className="h-8 text-sm"
                placeholder="Field (e.g., date)"
              />
              <Select
                value={sortDirection}
                onValueChange={(value: 'asc' | 'desc') => {
                  setSortDirection(value)
                  setTimeout(handleSimpleChange, 0)
                }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Descending</SelectItem>
                  <SelectItem value="asc">Ascending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Filter (JSON) */}
          <div className="space-y-2">
            <Label className="text-xs">Filter (optional JSON)</Label>
            <textarea
              value={filterJson}
              onChange={(e) => {
                setFilterJson(e.target.value)
                setTimeout(handleSimpleChange, 0)
              }}
              className="w-full h-20 px-3 py-2 text-xs font-mono border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder='{ "status": "published" }'
            />
          </div>
        </>
      ) : (
        /* JSON Mode */
        <div className="space-y-2">
          <Label className="text-xs">Collection Source (JSON)</Label>
          <div className="border rounded-md overflow-hidden">
            <CodeMirror
              value={jsonValue}
              height="200px"
              extensions={[json()]}
              onChange={handleJsonChange}
              theme="light"
              className="text-sm"
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: false,
              }}
            />
          </div>
          {jsonError && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              {jsonError}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            <p className="font-medium mb-1">Schema:</p>
            <pre className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-[10px] overflow-x-auto">
{`{
  "collection": "blog",     // Required
  "limit": 5,               // Optional
  "filter": { ... },        // Optional
  "sort": {                 // Optional
    "field": "date",
    "direction": "desc"
  }
}`}
            </pre>
          </div>
        </div>
      )}

      {/* Current Binding Summary */}
      {collectionSource && (
        <div className="p-3 bg-orange-50 dark:bg-orange-950/50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-orange-900 dark:text-orange-100">
                {collectionSource.collection}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-xs text-orange-600 hover:text-orange-700"
            >
              Clear
            </Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {collectionSource.limit && (
              <Badge variant="outline" className="text-[10px]">
                limit: {collectionSource.limit}
              </Badge>
            )}
            {collectionSource.sort && (
              <Badge variant="outline" className="text-[10px]">
                sort: {collectionSource.sort.field} ({collectionSource.sort.direction})
              </Badge>
            )}
            {collectionSource.filter && (
              <Badge variant="outline" className="text-[10px]">
                filtered
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
