/**
 * Gantt with Toast Wrapper
 * Ensures GanttView and ToastProvider share the same React root
 */

import { ToastProvider } from '../Toast'
import { GanttView } from './GanttView'

interface GanttWithToastProps {
  websiteId: string
}

export function GanttWithToast({ websiteId }: GanttWithToastProps) {
  return (
    <ToastProvider>
      <GanttView websiteId={websiteId} />
    </ToastProvider>
  )
}
