/**
 * CollectionBindings Component
 * Configure which collections are bound to this page
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

interface Collection {
  id: string
  collection_type: string
  display_name: string
  enabled: boolean
  item_count?: number
}

interface CollectionBinding {
  collectionType: string
  displayName: string
  display: 'grid' | 'list' | 'carousel' | 'compact'
  limit?: number
  filter?: Record<string, any>
  sortField?: string
  sortOrder?: 'asc' | 'desc'
}

interface Blueprint {
  id: string
  name: string
  schema?: {
    components?: Array<{
      type: string
      collectionSource?: {
        collection: string
        filter?: Record<string, any>
        limit?: number
      }
    }>
  }
}

interface CollectionBindingsProps {
  pageId?: string
  websiteId: string
  blueprint?: Blueprint | null
}

const DISPLAY_OPTIONS = [
  { value: 'grid', label: 'Grid', icon: '▦' },
  { value: 'list', label: 'List', icon: '☰' },
  { value: 'carousel', label: 'Carousel', icon: '↔' },
  { value: 'compact', label: 'Compact', icon: '▤' },
]

export default function CollectionBindings({
  pageId,
  websiteId,
  blueprint,
}: CollectionBindingsProps) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [bindings, setBindings] = useState<CollectionBinding[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newBinding, setNewBinding] = useState<CollectionBinding>({
    collectionType: '',
    displayName: '',
    display: 'grid',
    limit: 6,
  })

  // Fetch available collections
  const fetchCollections = useCallback(async () => {
    if (!websiteId) return

    try {
      const response = await fetch(
        `/api/trpc/collection.listByWebsite?input=${encodeURIComponent(
          JSON.stringify({ json: { websiteId } })
        )}`
      )
      const data = await response.json()
      if (data.result?.data?.json?.items) {
        setCollections(data.result.data.json.items)
      }
    } catch (err) {
      console.error('Error fetching collections:', err)
    } finally {
      setLoading(false)
    }
  }, [websiteId])

  useEffect(() => {
    fetchCollections()
  }, [fetchCollections])

  // Extract blueprint collection requirements
  const blueprintCollections = blueprint?.schema?.components
    ?.filter((c) => c.type === 'collection' && c.collectionSource)
    .map((c) => ({
      collection: c.collectionSource!.collection,
      filter: c.collectionSource!.filter,
      limit: c.collectionSource!.limit,
    })) || []

  const handleAddBinding = () => {
    if (!newBinding.collectionType) return

    const collection = collections.find((c) => c.collection_type === newBinding.collectionType)
    const binding: CollectionBinding = {
      ...newBinding,
      displayName: collection?.display_name || newBinding.collectionType,
    }

    setBindings((prev) => [...prev, binding])
    setNewBinding({
      collectionType: '',
      displayName: '',
      display: 'grid',
      limit: 6,
    })
    setShowAddForm(false)
  }

  const handleRemoveBinding = (index: number) => {
    setBindings((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpdateBinding = (index: number, updates: Partial<CollectionBinding>) => {
    setBindings((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...updates } : b))
    )
  }

  // Get available collections (not already bound)
  const availableCollections = collections.filter(
    (c) => c.enabled && !bindings.some((b) => b.collectionType === c.collection_type)
  )

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Blueprint Requirements */}
      {blueprintCollections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>📐</span>
              <span>Blueprint Collection Requirements</span>
            </CardTitle>
            <CardDescription>
              The selected blueprint requires these collections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {blueprintCollections.map((req, index) => {
                const collection = collections.find((c) => c.collection_type === req.collection)
                const isBound = bindings.some((b) => b.collectionType === req.collection)

                return (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      isBound ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">📦</span>
                      <div>
                        <div className="font-medium text-gray-900">
                          {collection?.display_name || req.collection}
                        </div>
                        <div className="text-sm text-gray-500">
                          {req.limit && `Limit: ${req.limit} items`}
                        </div>
                      </div>
                    </div>
                    {isBound ? (
                      <Badge className="bg-green-100 text-green-700">Configured</Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setNewBinding({
                            collectionType: req.collection,
                            displayName: collection?.display_name || req.collection,
                            display: 'grid',
                            limit: req.limit || 6,
                          })
                          setShowAddForm(true)
                        }}
                      >
                        Configure
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Bindings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Collection Bindings</CardTitle>
              <CardDescription>
                Configure which collections appear on this page
              </CardDescription>
            </div>
            {!showAddForm && availableCollections.length > 0 && (
              <Button onClick={() => setShowAddForm(true)}>
                + Add Collection
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {bindings.length === 0 && !showAddForm ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">📦</div>
              <p className="text-gray-500 mb-4">No collections bound to this page</p>
              {availableCollections.length > 0 && (
                <Button onClick={() => setShowAddForm(true)}>
                  Add First Collection
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Existing Bindings */}
              {bindings.map((binding, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="font-medium text-gray-900">
                        {binding.displayName}
                      </span>
                      <Badge variant="outline">{binding.collectionType}</Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Display</Label>
                        <Select
                          value={binding.display}
                          onValueChange={(value: any) =>
                            handleUpdateBinding(index, { display: value })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DISPLAY_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.icon} {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Limit</Label>
                        <Input
                          type="number"
                          value={binding.limit || ''}
                          onChange={(e) =>
                            handleUpdateBinding(index, {
                              limit: parseInt(e.target.value) || undefined,
                            })
                          }
                          className="h-8"
                          min={1}
                          max={50}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Sort</Label>
                        <Select
                          value={binding.sortField || 'created_at'}
                          onValueChange={(value) =>
                            handleUpdateBinding(index, { sortField: value })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="created_at">Date Created</SelectItem>
                            <SelectItem value="updated_at">Last Updated</SelectItem>
                            <SelectItem value="name">Name</SelectItem>
                            <SelectItem value="order_index">Manual Order</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => handleRemoveBinding(index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              {/* Add New Binding Form */}
              {showAddForm && (
                <div className="p-4 border-2 border-dashed border-blue-300 rounded-lg bg-blue-50">
                  <h4 className="font-medium text-gray-900 mb-4">Add Collection Binding</h4>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="space-y-1">
                      <Label>Collection</Label>
                      <Select
                        value={newBinding.collectionType}
                        onValueChange={(value) =>
                          setNewBinding((prev) => ({
                            ...prev,
                            collectionType: value,
                            displayName:
                              collections.find((c) => c.collection_type === value)
                                ?.display_name || value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select collection" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableCollections.map((c) => (
                            <SelectItem key={c.id} value={c.collection_type}>
                              {c.display_name} ({c.item_count || 0} items)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label>Display</Label>
                      <Select
                        value={newBinding.display}
                        onValueChange={(value: any) =>
                          setNewBinding((prev) => ({ ...prev, display: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DISPLAY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.icon} {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label>Limit</Label>
                      <Input
                        type="number"
                        value={newBinding.limit || ''}
                        onChange={(e) =>
                          setNewBinding((prev) => ({
                            ...prev,
                            limit: parseInt(e.target.value) || undefined,
                          }))
                        }
                        min={1}
                        max={50}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button onClick={handleAddBinding} disabled={!newBinding.collectionType}>
                      Add Binding
                    </Button>
                    <Button variant="outline" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {collections.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>No collections available for this website.</p>
              <a
                href="/collections"
                className="text-blue-600 hover:text-blue-700 mt-2 inline-block"
              >
                Create collections →
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
