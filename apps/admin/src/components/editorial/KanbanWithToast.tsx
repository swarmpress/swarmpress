/**
 * Kanban with Toast Wrapper
 * Ensures KanbanView and ToastProvider share the same React root
 */

import { ToastProvider } from '../Toast'
import { ShadcnKanbanView } from './ShadcnKanbanView'

interface KanbanWithToastProps {
  websiteId: string
}

export function KanbanWithToast({ websiteId }: KanbanWithToastProps) {
  return (
    <ToastProvider>
      <ShadcnKanbanView websiteId={websiteId} />
    </ToastProvider>
  )
}
