/**
 * SitemapControls Component
 * Advanced controls for the sitemap editor
 */

import React, { useState } from 'react'

interface SitemapControlsProps {
  onSearch: (query: string) => void
  onFilterStatus: (status: string | null) => void
  onFilterPageType: (pageType: string | null) => void
  onLayoutChange: (layout: 'dagre' | 'circular' | 'force') => void
  onToggleClusters: (show: boolean) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  nodeCount: number
  selectedCount: number
  onAddPage?: (page: NewPageData) => void
  websiteId?: string
}

interface NewPageData {
  title: string
  slug: string
  page_type: string
  parent_id?: string
}

export default function SitemapControls({
  onSearch,
  onFilterStatus,
  onFilterPageType,
  onLayoutChange,
  onToggleClusters,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  nodeCount,
  selectedCount,
  onAddPage,
  websiteId,
}: SitemapControlsProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showClusters, setShowClusters] = useState(true)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [selectedPageType, setSelectedPageType] = useState<string | null>(null)
  const [showNewPageModal, setShowNewPageModal] = useState(false)
  const [newPageTitle, setNewPageTitle] = useState('')
  const [newPageType, setNewPageType] = useState('article')
  const [creating, setCreating] = useState(false)

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    onSearch(query)
  }

  const handleStatusFilter = (status: string | null) => {
    setSelectedStatus(status)
    onFilterStatus(status)
  }

  const handlePageTypeFilter = (pageType: string | null) => {
    setSelectedPageType(pageType)
    onFilterPageType(pageType)
  }

  const handleToggleClusters = () => {
    const newValue = !showClusters
    setShowClusters(newValue)
    onToggleClusters(newValue)
  }

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  const handleCreatePage = async () => {
    if (!newPageTitle || !websiteId) return

    setCreating(true)
    try {
      const slug = generateSlug(newPageTitle)
      const response = await fetch('/api/trpc/sitemap.create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            website_id: websiteId,
            title: newPageTitle,
            slug,
            page_type: newPageType,
            status: 'draft',
          },
        }),
      })

      const data = await response.json()
      if (data.result?.data?.json) {
        const newPage = data.result.data.json
        if (onAddPage) {
          onAddPage({
            title: newPage.title,
            slug: newPage.slug,
            page_type: newPage.page_type,
          })
        }
        // Navigate to page editor
        window.location.href = `/pages/${newPage.id}`
      }
    } catch (error) {
      console.error('Failed to create page:', error)
    } finally {
      setCreating(false)
      setShowNewPageModal(false)
      setNewPageTitle('')
      setNewPageType('article')
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 space-y-4">
      {/* New Page Button */}
      <button
        onClick={() => setShowNewPageModal(true)}
        className="w-full px-4 py-3 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center justify-center gap-2"
      >
        <span>+</span>
        <span>New Page</span>
      </button>

      {/* New Page Modal */}
      {showNewPageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Page</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Page Title
                </label>
                <input
                  type="text"
                  value={newPageTitle}
                  onChange={(e) => setNewPageTitle(e.target.value)}
                  placeholder="Enter page title"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                {newPageTitle && (
                  <p className="text-xs text-gray-500 mt-1">
                    Slug: /{generateSlug(newPageTitle)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Page Type
                </label>
                <select
                  value={newPageType}
                  onChange={(e) => setNewPageType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                >
                  <option value="homepage">Homepage</option>
                  <option value="category">Category</option>
                  <option value="article">Article</option>
                  <option value="landing">Landing</option>
                  <option value="village">Village</option>
                  <option value="overview">Overview</option>
                  <option value="detail">Detail</option>
                  <option value="list">List</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowNewPageModal(false)
                  setNewPageTitle('')
                  setNewPageType('article')
                }}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePage}
                disabled={!newPageTitle || creating}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating...' : 'Create Page'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search pages..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
        {searchQuery && (
          <button
            onClick={() => {
              setSearchQuery('')
              onSearch('')
            }}
            className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-3">
        {/* Status Filter */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select
            value={selectedStatus || ''}
            onChange={(e) => handleStatusFilter(e.target.value || null)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="planned">Planned</option>
            <option value="outdated">Outdated</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </div>

        {/* Page Type Filter */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Page Type</label>
          <select
            value={selectedPageType || ''}
            onChange={(e) => handlePageTypeFilter(e.target.value || null)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All</option>
            <option value="homepage">Homepage</option>
            <option value="category">Category</option>
            <option value="article">Article</option>
            <option value="landing">Landing</option>
          </select>
        </div>
      </div>

      {/* Layout Options */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">Layout</label>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onLayoutChange('dagre')}
            className="px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md transition-colors"
          >
            🌳 Hierarchy
          </button>
          <button
            onClick={() => onLayoutChange('circular')}
            className="px-3 py-2 text-sm bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-md transition-colors"
          >
            ⭕ Circular
          </button>
          <button
            onClick={() => onLayoutChange('force')}
            className="px-3 py-2 text-sm bg-green-50 hover:bg-green-100 text-green-700 rounded-md transition-colors"
          >
            ⚡ Force
          </button>
        </div>
      </div>

      {/* View Options */}
      <div className="pt-3 border-t border-gray-200">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showClusters}
            onChange={handleToggleClusters}
            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Show Topical Clusters</span>
        </label>
      </div>

      {/* Undo/Redo */}
      <div className="flex items-center gap-2 pt-3 border-t border-gray-200">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
            canUndo
              ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              : 'bg-gray-50 text-gray-400 cursor-not-allowed'
          }`}
          title="Undo (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`flex-1 px-3 py-2 text-sm rounded-md transition-colors ${
            canRedo
              ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              : 'bg-gray-50 text-gray-400 cursor-not-allowed'
          }`}
          title="Redo (Ctrl+Y)"
        >
          ↷ Redo
        </button>
      </div>

      {/* Stats */}
      <div className="pt-3 border-t border-gray-200 text-xs text-gray-600 space-y-1">
        <div className="flex justify-between">
          <span>Total Pages:</span>
          <span className="font-medium">{nodeCount}</span>
        </div>
        {selectedCount > 0 && (
          <div className="flex justify-between text-blue-600">
            <span>Selected:</span>
            <span className="font-medium">{selectedCount}</span>
          </div>
        )}
      </div>
    </div>
  )
}
