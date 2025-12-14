'use client'

import { useState, useCallback, useEffect } from 'react'
import type { PageSection, InlinePrompt, CollectionSource } from '@swarm-press/shared'
import { generateSectionId, reorderSections } from '@swarm-press/shared'
import { SectionList } from './SectionList'
import { SectionPropertiesPanel } from './SectionPropertiesPanel'
import { SectionPalette } from './SectionPalette'
import { LivePreview } from './LivePreview'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  ArrowLeft,
  Save,
  Loader2,
  Check,
  AlertCircle,
  Plus,
  Eye,
  EyeOff,
} from 'lucide-react'

interface PageEditorProps {
  pageId: string
  pageTitle: string
  websiteId: string
  initialSections?: PageSection[]
  onBack: () => void
  onSave?: (sections: PageSection[]) => Promise<void>
}

export function PageEditor({
  pageId,
  pageTitle,
  websiteId,
  initialSections = [],
  onBack,
  onSave,
}: PageEditorProps) {
  const [sections, setSections] = useState<PageSection[]>(initialSections)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)

  // Initialize sections from props
  useEffect(() => {
    setSections(initialSections)
  }, [initialSections])

  // Get currently selected section
  const selectedSection = sections.find((s) => s.id === selectedSectionId) ?? null

  // Handle section selection
  const handleSelectSection = useCallback((id: string) => {
    setSelectedSectionId(id)
  }, [])

  // Handle section reorder (drag and drop)
  const handleReorder = useCallback((fromIndex: number, toIndex: number) => {
    setSections((prev) => {
      const newSections = reorderSections(prev, fromIndex, toIndex)
      setHasUnsavedChanges(true)
      return newSections
    })
  }, [])

  // Add a new section
  const handleAddSection = useCallback((type: string, variant: string) => {
    const existingIds = sections.map((s) => s.id)
    const newId = generateSectionId(type, existingIds)

    const newSection: PageSection = {
      id: newId,
      type,
      variant,
      order: sections.length,
      content: {},
    }

    setSections((prev) => [...prev, newSection])
    setSelectedSectionId(newId)
    setHasUnsavedChanges(true)
    setIsPaletteOpen(false)
  }, [sections])

  // Delete a section
  const handleDeleteSection = useCallback((id: string) => {
    setSections((prev) => {
      const filtered = prev.filter((s) => s.id !== id)
      // Re-index orders
      return filtered.map((s, i) => ({ ...s, order: i }))
    })
    if (selectedSectionId === id) {
      setSelectedSectionId(null)
    }
    setHasUnsavedChanges(true)
  }, [selectedSectionId])

  // Update a section
  const handleUpdateSection = useCallback((id: string, updates: Partial<PageSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    )
    setHasUnsavedChanges(true)
  }, [])

  // Update section prompts
  const handleUpdatePrompts = useCallback((id: string, prompts: InlinePrompt | undefined) => {
    handleUpdateSection(id, { prompts })
  }, [handleUpdateSection])

  // Update section collection binding
  const handleUpdateCollectionSource = useCallback(
    (id: string, collectionSource: CollectionSource | undefined) => {
      handleUpdateSection(id, { collectionSource })
    },
    [handleUpdateSection]
  )

  // Save handler
  const handleSave = useCallback(async () => {
    if (!onSave) return

    setSaveStatus('saving')
    try {
      await onSave(sections)
      setSaveStatus('saved')
      setHasUnsavedChanges(false)
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('Failed to save sections:', error)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [sections, onSave])

  // Duplicate a section
  const handleDuplicateSection = useCallback((id: string) => {
    const sectionToDuplicate = sections.find((s) => s.id === id)
    if (!sectionToDuplicate) return

    const existingIds = sections.map((s) => s.id)
    const newId = generateSectionId(sectionToDuplicate.type, existingIds)
    const sourceIndex = sections.findIndex((s) => s.id === id)

    const newSection: PageSection = {
      ...sectionToDuplicate,
      id: newId,
      order: sourceIndex + 1,
    }

    setSections((prev) => {
      const newSections = [...prev]
      newSections.splice(sourceIndex + 1, 0, newSection)
      // Re-index orders
      return newSections.map((s, i) => ({ ...s, order: i }))
    })

    setSelectedSectionId(newId)
    setHasUnsavedChanges(true)
  }, [sections])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white dark:bg-slate-950">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Sitemap
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-lg font-semibold">{pageTitle}</h1>
            <p className="text-xs text-muted-foreground">{sections.length} sections</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide Preview
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Show Preview
              </>
            )}
          </Button>

          {hasUnsavedChanges && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Unsaved changes
            </Badge>
          )}

          <Button
            size="sm"
            variant={hasUnsavedChanges ? 'default' : 'outline'}
            onClick={handleSave}
            disabled={saveStatus === 'saving' || !hasUnsavedChanges}
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Saved
              </>
            ) : saveStatus === 'error' ? (
              <>
                <AlertCircle className="h-4 w-4 mr-2" />
                Error
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Section List */}
        <div className="w-80 border-r bg-slate-50 dark:bg-slate-900 flex flex-col">
          <div className="p-3 border-b bg-white dark:bg-slate-950">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setIsPaletteOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Section
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <SectionList
              sections={sections}
              selectedId={selectedSectionId}
              onSelect={handleSelectSection}
              onReorder={handleReorder}
              onDelete={handleDeleteSection}
              onDuplicate={handleDuplicateSection}
            />
          </div>
        </div>

        {/* Center: Preview or Properties */}
        <div className="flex-1 flex">
          {showPreview && (
            <div className="flex-1 bg-white dark:bg-slate-950 border-r">
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b bg-slate-50 dark:bg-slate-900">
                  <span className="text-sm font-medium text-muted-foreground">
                    Preview
                  </span>
                </div>
                <div className="flex-1 overflow-hidden">
                  <LivePreview
                    sections={sections}
                    selectedSectionId={selectedSectionId}
                    onSelectSection={handleSelectSection}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Right: Properties Panel */}
          <div className={`${showPreview ? 'w-96' : 'flex-1'} border-l bg-white dark:bg-slate-950`}>
            <SectionPropertiesPanel
              section={selectedSection}
              onUpdateSection={(updates) => {
                if (selectedSectionId) {
                  handleUpdateSection(selectedSectionId, updates)
                }
              }}
              onUpdatePrompts={(prompts) => {
                if (selectedSectionId) {
                  handleUpdatePrompts(selectedSectionId, prompts)
                }
              }}
              onUpdateCollectionSource={(source) => {
                if (selectedSectionId) {
                  handleUpdateCollectionSource(selectedSectionId, source)
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Section Palette Modal */}
      <SectionPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onAddSection={handleAddSection}
      />
    </div>
  )
}
