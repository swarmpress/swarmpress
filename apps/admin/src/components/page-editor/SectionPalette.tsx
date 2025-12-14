'use client'

import { useState } from 'react'
import {
  SECTION_REGISTRY,
  getAllCategories,
  getCategoryLabel,
  type SectionCategory,
  type SectionTypeDefinition,
} from '@swarm-press/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'
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
  ChevronRight,
  ArrowLeft,
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

// Category icons
const categoryIcons: Record<SectionCategory, React.ComponentType<{ className?: string }>> = {
  layout: LayoutTemplate,
  content: FileText,
  'social-proof': MessageSquareQuote,
  engagement: Pointer,
  information: HelpCircle,
  visual: LayoutGrid,
}

interface SectionPaletteProps {
  isOpen: boolean
  onClose: () => void
  onAddSection: (type: string, variant: string) => void
}

export function SectionPalette({
  isOpen,
  onClose,
  onAddSection,
}: SectionPaletteProps) {
  const [selectedSection, setSelectedSection] = useState<SectionTypeDefinition | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<SectionCategory | null>(null)

  const categories = getAllCategories()

  // Get sections for the selected category
  const sectionsInCategory = selectedCategory
    ? SECTION_REGISTRY.filter((s) => s.category === selectedCategory)
    : SECTION_REGISTRY

  const handleSelectVariant = (variant: string) => {
    if (selectedSection) {
      onAddSection(selectedSection.type, variant)
      setSelectedSection(null)
      setSelectedCategory(null)
    }
  }

  const handleBack = () => {
    if (selectedSection) {
      setSelectedSection(null)
    } else if (selectedCategory) {
      setSelectedCategory(null)
    }
  }

  const handleClose = () => {
    setSelectedSection(null)
    setSelectedCategory(null)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {(selectedSection || selectedCategory) && (
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {selectedSection
              ? `Select ${selectedSection.label} Variant`
              : selectedCategory
              ? getCategoryLabel(selectedCategory)
              : 'Add Section'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {/* Category Selection */}
          {!selectedSection && !selectedCategory && (
            <div className="grid grid-cols-3 gap-3 py-4">
              {categories.map((category) => {
                const CategoryIcon = categoryIcons[category]
                const sectionCount = SECTION_REGISTRY.filter(
                  (s) => s.category === category
                ).length

                return (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={cn(
                      'flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-transparent',
                      'bg-slate-50 dark:bg-slate-900 hover:border-primary/50 transition-all'
                    )}
                  >
                    <CategoryIcon className="h-8 w-8 text-muted-foreground" />
                    <span className="font-medium text-sm">
                      {getCategoryLabel(category)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {sectionCount} sections
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Section Selection */}
          {!selectedSection && selectedCategory && (
            <div className="grid grid-cols-2 gap-3 py-4">
              {sectionsInCategory.map((section) => {
                const IconComponent = iconMap[section.icon] || LayoutTemplate

                return (
                  <button
                    key={section.type}
                    onClick={() => setSelectedSection(section)}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-lg border text-left',
                      'bg-white dark:bg-slate-950 hover:border-primary/50 transition-all'
                    )}
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <IconComponent className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {section.label}
                        </span>
                        {section.supportsCollections && (
                          <Database className="h-3 w-3 text-orange-500" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {section.description}
                      </p>
                      <div className="flex items-center gap-1 mt-2">
                        <Badge variant="outline" className="text-[10px]">
                          {section.variants.length} variants
                        </Badge>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </button>
                )
              })}
            </div>
          )}

          {/* Variant Selection */}
          {selectedSection && (
            <div className="grid grid-cols-2 gap-3 py-4">
              {selectedSection.variants.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => handleSelectVariant(variant.id)}
                  className={cn(
                    'flex flex-col items-start p-4 rounded-lg border text-left',
                    'bg-white dark:bg-slate-950 hover:border-primary/50 transition-all',
                    variant.id === selectedSection.defaultVariant &&
                      'ring-1 ring-primary/30'
                  )}
                >
                  {/* Placeholder for preview image */}
                  <div className="w-full h-24 rounded bg-slate-100 dark:bg-slate-800 mb-3 flex items-center justify-center">
                    <LayoutTemplate className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                  <span className="font-medium text-sm">{variant.label}</span>
                  {variant.id === selectedSection.defaultVariant && (
                    <Badge variant="secondary" className="mt-2 text-[10px]">
                      Default
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
