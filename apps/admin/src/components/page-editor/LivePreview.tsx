'use client'

import { useMemo } from 'react'
import type { PageSection } from '@swarm-press/shared'
import { getSectionDefinition } from '@swarm-press/shared'
import { cn } from '../../lib/utils'
import {
  LayoutTemplate,
  FileText,
  Users,
  MessageSquareQuote,
  Building2,
  Pointer,
  Mail,
  Phone,
  HelpCircle,
  CreditCard,
  Newspaper,
  LayoutGrid,
  BarChart3,
  Heading,
  SquareBottomDashedScissors,
  Sparkles,
  Database,
  Image,
  Type,
} from 'lucide-react'

// Map icon names to Lucide components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'layout-template': LayoutTemplate,
  'heading': Heading,
  'square-bottom-dashed-scissors': SquareBottomDashedScissors,
  'file-text': FileText,
  'sparkles': Sparkles,
  'bar-chart-3': BarChart3,
  'message-square-quote': MessageSquareQuote,
  'building-2': Building2,
  'users': Users,
  'pointer': Pointer,
  'mail': Mail,
  'phone': Phone,
  'help-circle': HelpCircle,
  'credit-card': CreditCard,
  'newspaper': Newspaper,
  'layout-grid': LayoutGrid,
}

// Section height hints based on type
const sectionHeights: Record<string, string> = {
  'hero-section': 'h-48',
  'header-section': 'h-24',
  'footer-section': 'h-32',
  'feature-section': 'h-40',
  'stats-section': 'h-28',
  'testimonial-section': 'h-36',
  'cta-section': 'h-28',
  'pricing-section': 'h-48',
  'faq-section': 'h-40',
  'blog-section': 'h-44',
  'team-section': 'h-40',
  'contact-section': 'h-36',
  'newsletter-section': 'h-24',
  'logo-cloud-section': 'h-20',
  'content-section': 'h-36',
  'bento-grid-section': 'h-44',
}

// Section background colors based on category
const categoryColors: Record<string, string> = {
  layout: 'bg-blue-50 border-blue-200',
  content: 'bg-green-50 border-green-200',
  'social-proof': 'bg-purple-50 border-purple-200',
  engagement: 'bg-orange-50 border-orange-200',
  information: 'bg-cyan-50 border-cyan-200',
  visual: 'bg-pink-50 border-pink-200',
}

interface LivePreviewProps {
  sections: PageSection[]
  selectedSectionId?: string | null
  onSelectSection?: (id: string) => void
}

export function LivePreview({
  sections,
  selectedSectionId,
  onSelectSection,
}: LivePreviewProps) {
  // Sort sections by order
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order),
    [sections]
  )

  if (sections.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-slate-50 dark:bg-slate-900">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <LayoutTemplate className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="font-medium text-slate-600 dark:text-slate-300">
          No sections yet
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
          Add sections to see a preview of your page structure
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-white dark:bg-slate-950">
      {/* Preview Container - simulates a webpage */}
      <div className="min-h-full">
        {/* Browser Chrome */}
        <div className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b px-3 py-2 flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-yellow-400" />
            <div className="w-3 h-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 mx-4">
            <div className="bg-white dark:bg-slate-700 rounded px-3 py-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
              preview.local/page
            </div>
          </div>
        </div>

        {/* Page Sections Preview */}
        <div className="p-4 space-y-2">
          {sortedSections.map((section) => (
            <SectionPreviewBlock
              key={section.id}
              section={section}
              isSelected={section.id === selectedSectionId}
              onClick={() => onSelectSection?.(section.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface SectionPreviewBlockProps {
  section: PageSection
  isSelected: boolean
  onClick: () => void
}

function SectionPreviewBlock({
  section,
  isSelected,
  onClick,
}: SectionPreviewBlockProps) {
  const definition = getSectionDefinition(section.type)
  const IconComponent = definition?.icon
    ? iconMap[definition.icon] || LayoutTemplate
    : LayoutTemplate

  const height = sectionHeights[section.type] || 'h-32'
  const bgColor = definition?.category
    ? categoryColors[definition.category]
    : 'bg-slate-50 border-slate-200'

  const hasAI = section.prompts || section.ai_hints
  const hasCollection = section.collectionSource

  // Get content preview (if available)
  const contentPreview = getContentPreview(section)

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border-2 transition-all overflow-hidden',
        bgColor,
        height,
        isSelected
          ? 'ring-2 ring-primary ring-offset-2 border-primary'
          : 'hover:border-slate-300 dark:hover:border-slate-600'
      )}
    >
      <div className="h-full p-4 flex flex-col">
        {/* Section Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <IconComponent className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {definition?.label || section.type}
            </span>
            <span className="text-xs text-slate-500">
              {section.variant || 'default'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {hasAI && (
              <span className="p-1 rounded bg-purple-100 dark:bg-purple-900/50">
                <Sparkles className="h-3 w-3 text-purple-600 dark:text-purple-400" />
              </span>
            )}
            {hasCollection && (
              <span className="p-1 rounded bg-orange-100 dark:bg-orange-900/50">
                <Database className="h-3 w-3 text-orange-600 dark:text-orange-400" />
              </span>
            )}
          </div>
        </div>

        {/* Content Preview */}
        <div className="flex-1 flex items-center justify-center">
          {contentPreview ? (
            <div className="text-center">
              {contentPreview.hasImage && (
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Image className="h-4 w-4 text-slate-400" />
                  <span className="text-xs text-slate-500">Image</span>
                </div>
              )}
              {contentPreview.title && (
                <div className="flex items-center justify-center gap-1">
                  <Type className="h-3 w-3 text-slate-400" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 truncate max-w-[200px]">
                    {contentPreview.title}
                  </span>
                </div>
              )}
              {contentPreview.itemCount && (
                <span className="text-xs text-slate-500 mt-1 block">
                  {contentPreview.itemCount} items
                </span>
              )}
            </div>
          ) : (
            <div className="text-center">
              <div className="w-full max-w-[200px] space-y-1">
                {/* Skeleton lines to represent content */}
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mx-auto" />
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mx-auto" />
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded w-2/3 mx-auto" />
              </div>
            </div>
          )}
        </div>

        {/* Collection Badge */}
        {hasCollection && (
          <div className="mt-2 text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
            <Database className="h-3 w-3" />
            <span>
              {section.collectionSource?.collection}
              {section.collectionSource?.limit &&
                ` (${section.collectionSource.limit})`}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}

// Helper to extract preview info from section content
function getContentPreview(section: PageSection): {
  title?: string
  hasImage?: boolean
  itemCount?: number
} | null {
  const content = section.content
  if (!content || Object.keys(content).length === 0) {
    return null
  }

  const result: { title?: string; hasImage?: boolean; itemCount?: number } = {}

  // Look for common title fields
  const titleFields = ['title', 'heading', 'headline', 'name']
  for (const field of titleFields) {
    if (content[field]) {
      const value = content[field]
      if (typeof value === 'string') {
        result.title = value
      } else if (typeof value === 'object' && value !== null) {
        // Localized string - get first value
        const firstValue = Object.values(value)[0]
        if (typeof firstValue === 'string') {
          result.title = firstValue
        }
      }
      break
    }
  }

  // Check for images
  const imageFields = ['image', 'backgroundImage', 'src', 'photo', 'avatar']
  for (const field of imageFields) {
    if (content[field]) {
      result.hasImage = true
      break
    }
  }

  // Check for arrays (features, items, etc.)
  const arrayFields = ['features', 'items', 'stats', 'testimonials', 'team', 'faqs', 'posts']
  for (const field of arrayFields) {
    if (Array.isArray(content[field])) {
      result.itemCount = content[field].length
      break
    }
  }

  return Object.keys(result).length > 0 ? result : null
}
