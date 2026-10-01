'use client'

import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { PageSection } from '@swarm-press/shared'
import { SectionItem } from './SectionItem'

interface SectionListProps {
  sections: PageSection[]
  selectedId: string | null
  onSelect: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onOptimize?: (id: string) => void
  optimizingId?: string | null
}

export function SectionList({
  sections,
  selectedId,
  onSelect,
  onReorder,
  onDelete,
  onDuplicate,
  onOptimize,
  optimizingId,
}: SectionListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        const oldIndex = sections.findIndex((s) => s.id === active.id)
        const newIndex = sections.findIndex((s) => s.id === over.id)
        onReorder(oldIndex, newIndex)
      }
    },
    [sections, onReorder]
  )

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center p-4">
        <div className="text-4xl mb-2">📑</div>
        <p className="text-sm text-muted-foreground">No sections yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Click "Add Section" to get started
        </p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sections.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1">
          {sections.map((section) => (
            <SectionItem
              key={section.id}
              section={section}
              isSelected={section.id === selectedId}
              onClick={() => onSelect(section.id)}
              onDelete={() => onDelete(section.id)}
              onDuplicate={() => onDuplicate(section.id)}
              onOptimize={onOptimize ? () => onOptimize(section.id) : undefined}
              isOptimizing={optimizingId === section.id}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
