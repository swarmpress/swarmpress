'use client'

import { useState, useCallback, useEffect } from 'react'
import type { PageSection, InlinePrompt, CollectionSource, SiteDefinition, SitemapNode } from '@swarm-press/shared'
import { generateSectionId, reorderSections, getResolvedAgentAssignments, createVersion, addVersionToSection } from '@swarm-press/shared'
import { SectionList } from './SectionList'
import { SectionPropertiesPanel } from './SectionPropertiesPanel'
import { SectionPalette } from './SectionPalette'
import { LivePreview } from './LivePreview'
import { GenerateSectionsDialog, type GenerateQuestionnaire } from './GenerateSectionsDialog'
import { AIProgressOverlay, type AIProgressState } from './AIProgressOverlay'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { AssignedAgentInfo } from './PromptsEditor'
import {
  ArrowLeft,
  Save,
  Loader2,
  Check,
  AlertCircle,
  Plus,
  Eye,
  EyeOff,
  Sparkles,
  Wand2,
  ChevronDown,
  LayoutTemplate,
  Monitor,
  RefreshCw,
  ExternalLink,
  Sun,
  Moon,
} from 'lucide-react'

type PreviewMode = 'wireframe' | 'rendered'
type PreviewTheme = 'dark' | 'light'

interface PageEditorProps {
  pageId: string
  pageTitle: string
  pagePath: string
  websiteId: string
  initialSections?: PageSection[]
  onBack: () => void
  onSave?: (sections: PageSection[]) => Promise<void>
  /** Site definition for resolving agent assignments */
  siteDefinition?: SiteDefinition
  /** Current page node for agent assignments */
  pageNode?: SitemapNode
  /** All agents with their info */
  agents?: Array<{ id: string; name: string; departmentId: string; avatarUrl?: string }>
  /** All departments */
  departments?: Array<{ id: string; name: string }>
}

export function PageEditor({
  pageId,
  pageTitle,
  pagePath,
  websiteId,
  initialSections = [],
  onBack,
  onSave,
  siteDefinition,
  pageNode,
  agents = [],
  departments = [],
}: PageEditorProps) {
  const [sections, setSections] = useState<PageSection[]>(initialSections)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('wireframe')
  const [previewKey, setPreviewKey] = useState(0)
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>(() => {
    // Default to dark for luxury theme, persist in localStorage
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('preview-theme') as PreviewTheme) || 'dark'
    }
    return 'dark'
  })
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizingSectionId, setOptimizingSectionId] = useState<string | null>(null)
  const [aiProgress, setAiProgress] = useState<AIProgressState>({
    status: 'idle',
    message: '',
    progress: 0,
  })

  // Initialize sections from props
  useEffect(() => {
    setSections(initialSections)
  }, [initialSections])

  // Handle theme toggle and persist to localStorage
  const handleThemeToggle = useCallback(() => {
    setPreviewTheme((prev) => {
      const newTheme = prev === 'dark' ? 'light' : 'dark'
      if (typeof window !== 'undefined') {
        localStorage.setItem('preview-theme', newTheme)
      }
      // Force refresh the preview iframe
      setPreviewKey((k) => k + 1)
      return newTheme
    })
  }, [])

  // Compute assigned agents for this page
  const assignedAgents: AssignedAgentInfo[] = (() => {
    if (!pageNode || !siteDefinition || departments.length === 0) {
      return []
    }

    const getNodeById = (nodeId: string) =>
      siteDefinition.sitemap.nodes.find((n) => n.id === nodeId)

    const resolved = getResolvedAgentAssignments(
      pageNode,
      departments.map((d) => ({ id: d.id, name: d.name })),
      agents.map((a) => ({ id: a.id, name: a.name, departmentId: a.departmentId })),
      getNodeById,
      siteDefinition.sitemap.edges || []
    )

    return resolved.map((r) => {
      const agent = agents.find((a) => a.id === r.agentId)
      return {
        departmentName: r.departmentName,
        agentId: r.agentId,
        agentName: r.agentName,
        agentAvatarUrl: agent?.avatarUrl,
        inherited: r.inherited,
        fromNodeTitle: r.fromNodeTitle,
      }
    })
  })()

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

  // Generate sections based on questionnaire
  const handleGenerateSections = useCallback(async (questionnaire: GenerateQuestionnaire) => {
    setIsGenerating(true)
    setIsGenerateDialogOpen(false)
    setAiProgress({
      status: 'generating',
      message: `Generating ${questionnaire.keySections.length} sections...`,
      progress: 10,
      totalItems: questionnaire.keySections.length,
      completedItems: 0,
    })

    try {
      // Simulate progress during API call
      const progressInterval = setInterval(() => {
        setAiProgress((prev) => ({
          ...prev,
          progress: Math.min(prev.progress + 15, 85),
        }))
      }, 500)

      // Call API endpoint to generate sections
      const response = await fetch('/api/sections/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageContext: {
            pageId,
            pageTitle,
            websiteId,
          },
          questionnaire,
        }),
      })

      clearInterval(progressInterval)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to generate sections')
      }

      const result = await response.json()

      if (result.success && result.sections) {
        // Transform API sections to PageSection format
        const existingIds = sections.map((s) => s.id)
        const newSections: PageSection[] = result.sections.map(
          (apiSection: { id: string; type: string; variant?: string; order: number; content?: Record<string, unknown>; ai_hints?: Record<string, unknown> }, index: number) => {
            const id = generateSectionId(
              apiSection.type,
              [...existingIds, ...result.sections.slice(0, index).map((s: { type: string }) => s.type)]
            )
            return {
              id,
              type: apiSection.type,
              variant: apiSection.variant,
              order: sections.length + index,
              content: apiSection.content || {},
              ai_hints: apiSection.ai_hints || {
                tone: questionnaire.tone,
                purpose: questionnaire.purpose,
                audience: questionnaire.audience,
              },
            }
          }
        )

        setSections((prev) => [...prev, ...newSections])
        setHasUnsavedChanges(true)

        // Select the first generated section
        if (newSections.length > 0 && newSections[0]) {
          setSelectedSectionId(newSections[0].id)
        }

        // Show complete state
        setAiProgress({
          status: 'complete',
          message: 'Sections generated successfully!',
          progress: 100,
          totalItems: newSections.length,
          completedItems: newSections.length,
        })
      }
    } catch (error) {
      console.error('Failed to generate sections:', error)
      setAiProgress({
        status: 'error',
        message: 'Failed to generate sections',
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setIsGenerating(false)
    }
  }, [sections, pageId, pageTitle])

  // Optimize a single section
  const handleOptimizeSection = useCallback(async (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return

    setOptimizingSectionId(sectionId)
    setAiProgress({
      status: 'optimizing',
      message: 'Generating content with AI...',
      progress: -1, // Indeterminate - we can't track server-side AI progress
      totalItems: 1,
      completedItems: 0,
      currentItem: section.type,
    })

    try {
      // Create a version before updating (to preserve original content)
      let sectionToOptimize = section
      if (section.content && Object.keys(section.content).length > 0) {
        const version = createVersion(section.content, 'human', {
          message: 'Before AI optimization',
        })
        sectionToOptimize = addVersionToSection(section, version)
        setSections((prev) =>
          prev.map((s) => (s.id === sectionId ? sectionToOptimize : s))
        )
      }

      // Call API endpoint to optimize section
      const response = await fetch('/api/sections/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: {
            id: section.id,
            type: section.type,
            variant: section.variant,
            content: section.content,
            prompts: section.prompts,
            ai_hints: section.ai_hints,
          },
          pageContext: {
            pageId,
            pageTitle,
            websiteId,
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to optimize section')
      }

      const result = await response.json()

      if (result.success && result.content) {
        // Create AI version and update section content
        const aiVersion = createVersion(result.content, 'ai', {
          agentId: result.agentId,
          agentName: result.agentName,
          message: 'AI-optimized content',
        })

        setSections((prev) =>
          prev.map((s) => {
            if (s.id === sectionId) {
              const withVersion = addVersionToSection(s, aiVersion)
              return {
                ...withVersion,
                content: result.content,
                // Also update ai_hints and prompts if provided
                ai_hints: result.ai_hints || withVersion.ai_hints,
                prompts: result.prompts || withVersion.prompts,
              }
            }
            return s
          })
        )
        setHasUnsavedChanges(true)

        // Show complete state
        setAiProgress({
          status: 'complete',
          message: `Section optimized by ${result.agentName || 'AI'}`,
          progress: 100,
          totalItems: 1,
          completedItems: 1,
        })
      }
    } catch (error) {
      console.error('Failed to optimize section:', error)
      setAiProgress({
        status: 'error',
        message: 'Failed to optimize section',
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setOptimizingSectionId(null)
    }
  }, [sections, pageId, pageTitle, websiteId])

  // Optimize all sections - processes one at a time for accurate progress
  const handleOptimizeAll = useCallback(async () => {
    if (sections.length === 0) return

    setIsOptimizing(true)
    const totalSections = sections.length
    let completedCount = 0
    let lastAgentName = 'AI'

    setAiProgress({
      status: 'optimizing-all',
      message: `Starting optimization of ${totalSections} sections...`,
      progress: 0,
      totalItems: totalSections,
      completedItems: 0,
    })

    try {
      // Create versions for all sections with content (before optimization)
      const sectionsWithVersions = sections.map((section) => {
        if (section.content && Object.keys(section.content).length > 0) {
          const version = createVersion(section.content, 'human', {
            message: 'Before AI optimization',
          })
          return addVersionToSection(section, version)
        }
        return section
      })
      setSections(sectionsWithVersions)

      // Process each section one at a time for real progress tracking
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i]
        if (!section) continue

        // Update progress with current section
        setAiProgress({
          status: 'optimizing-all',
          message: `Optimizing section ${i + 1} of ${totalSections}...`,
          progress: Math.round((completedCount / totalSections) * 100),
          totalItems: totalSections,
          completedItems: completedCount,
          currentItem: section.type,
        })

        // Call API endpoint to optimize this section
        const response = await fetch('/api/sections/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section: {
              id: section.id,
              type: section.type,
              variant: section.variant,
              content: section.content,
              prompts: section.prompts,
              ai_hints: section.ai_hints,
            },
            pageContext: {
              pageId,
              pageTitle,
              websiteId,
            },
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          console.error(`Failed to optimize section ${section.id}:`, errorData)
          // Continue with other sections even if one fails
          completedCount++
          continue
        }

        const result = await response.json()

        if (result.success && result.content) {
          lastAgentName = result.agentName || 'AI'

          // Update this section with AI-generated content
          setSections((prev) =>
            prev.map((s) => {
              if (s.id === section.id) {
                const aiVersion = createVersion(result.content, 'ai', {
                  agentId: result.agentId,
                  agentName: result.agentName,
                  message: 'AI-optimized content',
                })
                const withVersion = addVersionToSection(s, aiVersion)
                return {
                  ...withVersion,
                  content: result.content,
                  ai_hints: result.ai_hints || withVersion.ai_hints,
                  prompts: result.prompts || withVersion.prompts,
                }
              }
              return s
            })
          )
        }

        completedCount++
      }

      setHasUnsavedChanges(true)

      // Show complete state
      setAiProgress({
        status: 'complete',
        message: `All ${completedCount} sections optimized by ${lastAgentName}`,
        progress: 100,
        totalItems: totalSections,
        completedItems: completedCount,
      })
    } catch (error) {
      console.error('Failed to optimize all sections:', error)
      setAiProgress({
        status: 'error',
        message: 'Failed to optimize sections',
        progress: Math.round((completedCount / totalSections) * 100),
        totalItems: totalSections,
        completedItems: completedCount,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setIsOptimizing(false)
    }
  }, [sections, pageId, pageTitle, websiteId])

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
          {/* AI Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 dark:bg-purple-950 dark:border-purple-800 dark:text-purple-300"
                disabled={isOptimizing || isGenerating}
              >
                {isOptimizing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                AI Actions
                <ChevronDown className="h-3 w-3 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsGenerateDialogOpen(true)}>
                <Wand2 className="h-4 w-4 mr-2" />
                Generate Sections...
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleOptimizeAll}
                disabled={sections.length === 0 || isOptimizing}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Optimize All Sections
                {sections.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    ({sections.length})
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-6 w-px bg-border" />

          {/* Preview Controls */}
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={previewMode === 'wireframe' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setPreviewMode('wireframe')}
              className="h-7 px-2"
              title="Wireframe view"
            >
              <LayoutTemplate className="h-4 w-4" />
            </Button>
            <Button
              variant={previewMode === 'rendered' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setPreviewMode('rendered')}
              className="h-7 px-2"
              title="Rendered preview"
            >
              <Monitor className="h-4 w-4" />
            </Button>
          </div>

          {previewMode === 'rendered' && (
            <>
              {/* Theme Toggle */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleThemeToggle}
                title={`Switch to ${previewTheme === 'dark' ? 'light' : 'dark'} theme`}
                className="h-8 w-8 p-0"
              >
                {previewTheme === 'dark' ? (
                  <Sun className="h-4 w-4 text-amber-500" />
                ) : (
                  <Moon className="h-4 w-4 text-slate-600" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewKey(k => k + 1)}
                title="Refresh preview"
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(`/api/preview/${pagePath}?theme=${previewTheme}`, '_blank')}
                title="Open preview in new tab"
                className="h-8 w-8 p-0"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </>
          )}

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
              onOptimize={handleOptimizeSection}
              optimizingId={optimizingSectionId}
            />
          </div>
        </div>

        {/* Center: Preview or Properties */}
        <div className="flex-1 flex">
          {showPreview && (
            <div className="flex-1 bg-white dark:bg-slate-950 border-r">
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    {previewMode === 'wireframe' ? 'Wireframe Preview' : 'Rendered Preview'}
                  </span>
                  {previewMode === 'rendered' && hasUnsavedChanges && (
                    <span className="text-xs text-amber-600">
                      Save to update preview
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  {previewMode === 'wireframe' ? (
                    <LivePreview
                      sections={sections}
                      selectedSectionId={selectedSectionId}
                      onSelectSection={handleSelectSection}
                    />
                  ) : (
                    <div className="h-full bg-slate-100 dark:bg-slate-900">
                      <iframe
                        key={previewKey}
                        src={`/api/preview/${pagePath}?theme=${previewTheme}`}
                        className="w-full h-full border-0 bg-white"
                        title={`Preview: ${pageTitle}`}
                        sandbox="allow-scripts allow-same-origin"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Right: Section Editor Panel */}
          <div className={`${showPreview ? 'w-[420px] min-w-[380px]' : 'flex-1'} border-l bg-white dark:bg-slate-950 flex flex-col`}>
            <div className="px-4 py-2 border-b bg-slate-50 dark:bg-slate-900">
              <span className="text-sm font-medium text-muted-foreground">
                Section Editor
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
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
              assignedAgents={assignedAgents}
              inheritedPerspective="third_person"
              websiteId={websiteId}
            />
            </div>
          </div>
        </div>
      </div>

      {/* Section Palette Modal */}
      <SectionPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onAddSection={handleAddSection}
      />

      {/* Generate Sections Dialog */}
      <GenerateSectionsDialog
        isOpen={isGenerateDialogOpen}
        onClose={() => setIsGenerateDialogOpen(false)}
        onGenerate={handleGenerateSections}
        pageTitle={pageTitle}
        isGenerating={isGenerating}
      />

      {/* AI Progress Overlay */}
      <AIProgressOverlay
        state={aiProgress}
        onClose={() => setAiProgress({ status: 'idle', message: '', progress: 0 })}
      />
    </div>
  )
}
