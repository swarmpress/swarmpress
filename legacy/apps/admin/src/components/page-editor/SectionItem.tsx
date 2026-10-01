'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PageSection } from '@swarm-press/shared'
import {
  getSectionDefinition,
  hasAIConfig,
  hasCollectionBinding,
} from '@swarm-press/shared'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  GripVertical,
  MoreHorizontal,
  Trash2,
  Copy,
  Sparkles,
  Database,
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
  Wand2,
  Loader2,
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

interface SectionItemProps {
  section: PageSection
  isSelected: boolean
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
  onOptimize?: () => void
  isOptimizing?: boolean
}

export function SectionItem({
  section,
  isSelected,
  onClick,
  onDelete,
  onDuplicate,
  onOptimize,
  isOptimizing = false,
}: SectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const definition = getSectionDefinition(section.type)
  const hasAI = hasAIConfig(section)
  const hasCollection = hasCollectionBinding(section)

  // Get icon component
  const IconComponent = definition?.icon
    ? iconMap[definition.icon] || LayoutTemplate
    : LayoutTemplate

  // Get variant label
  const variantLabel =
    definition?.variants.find((v) => v.id === section.variant)?.label ||
    section.variant ||
    'Default'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-start gap-2 p-2 rounded-lg border bg-white dark:bg-slate-950 transition-all cursor-pointer',
        isSelected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-transparent hover:border-slate-200 dark:hover:border-slate-800',
        isDragging && 'opacity-50 shadow-lg'
      )}
      onClick={onClick}
    >
      {/* Drag Handle */}
      <button
        className="flex-shrink-0 p-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <IconComponent className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-medium text-sm truncate">
            {definition?.label || section.type}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground truncate">
            {variantLabel}
          </span>

          {/* Badges */}
          <div className="flex items-center gap-1">
            {hasAI && (
              <span
                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 rounded text-[10px]"
                title="Has AI prompts"
              >
                <Sparkles className="h-2.5 w-2.5" />
              </span>
            )}
            {hasCollection && (
              <span
                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 rounded text-[10px]"
                title="Has collection binding"
              >
                <Database className="h-2.5 w-2.5" />
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions Menu */}
      {isOptimizing ? (
        <div className="flex-shrink-0 p-1">
          <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onOptimize && (
              <>
                <DropdownMenuItem onClick={onOptimize}>
                  <Wand2 className="h-4 w-4 mr-2 text-purple-500" />
                  Optimize with AI
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-4 w-4 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
