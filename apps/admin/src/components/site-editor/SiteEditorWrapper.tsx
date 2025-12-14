'use client'

import { useEffect, useState } from 'react'
import type { SiteDefinition } from '@swarm-press/shared'
import { SiteEditor } from './SiteEditor'
import { Loader2, AlertCircle } from 'lucide-react'

interface SiteEditorWrapperProps {
  websiteId?: string
}

export function SiteEditorWrapper({ websiteId: propWebsiteId }: SiteEditorWrapperProps) {
  const [websiteId, setWebsiteId] = useState<string | null>(propWebsiteId || null)
  const [siteDefinition, setSiteDefinition] = useState<(SiteDefinition & { sha?: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Listen for website selection events
  useEffect(() => {
    const handleWebsiteSelected = (event: CustomEvent<{ websiteId: string }>) => {
      setWebsiteId(event.detail.websiteId)
    }

    window.addEventListener('website-selected', handleWebsiteSelected as EventListener)

    // Try to get websiteId from hidden input on mount
    if (!websiteId) {
      const input = document.getElementById('selected-website-id') as HTMLInputElement
      if (input?.value) {
        setWebsiteId(input.value)
      }
    }

    return () => {
      window.removeEventListener('website-selected', handleWebsiteSelected as EventListener)
    }
  }, [websiteId])

  // Fetch site definition when websiteId changes
  useEffect(() => {
    if (!websiteId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    fetch(`/api/trpc/github.getSiteDefinition?input=${encodeURIComponent(JSON.stringify({ json: { websiteId } }))}`)
      .then((res) => res.json())
      .then((result) => {
        const definition = result.result?.data?.json as (SiteDefinition & { sha?: string }) | null
        setSiteDefinition(definition)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch site definition:', err)
        setError(err instanceof Error ? err.message : 'Failed to load site definition')
        setLoading(false)
      })
  }, [websiteId])

  // Handle save
  const handleSave = async (updatedDefinition: SiteDefinition) => {
    if (!websiteId) return

    const response = await fetch('/api/trpc/github.saveSiteDefinition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        json: {
          websiteId,
          siteDefinition: updatedDefinition,
          message: 'Update site definition via Site Editor',
        },
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to save site definition')
    }

    const saveResult = await response.json()
    return saveResult.result?.data?.json
  }

  // No website selected
  if (!websiteId) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center py-12 px-6 max-w-md">
          <div className="text-6xl mb-4">🗺️</div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No Website Selected</h3>
          <p className="text-gray-600 mb-6">
            Please select a product (website) from the sidebar to view and edit its site structure.
          </p>
          <p className="text-sm text-gray-500">
            Use the team switcher in the sidebar header to select your media house and product.
          </p>
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-600" />
          <p className="text-gray-600">Loading site editor...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to Load</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <SiteEditor
      websiteId={websiteId}
      initialSiteDefinition={siteDefinition || undefined}
      onSave={handleSave}
    />
  )
}

export default SiteEditorWrapper
