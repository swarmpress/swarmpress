/**
 * Graph with Toast Wrapper
 * Ensures GraphView and ToastProvider share the same React root
 */

import { ToastProvider } from '../Toast'
import { GraphView } from './GraphView'

interface GraphWithToastProps {
  websiteId: string
}

export function GraphWithToast({ websiteId }: GraphWithToastProps) {
  return (
    <ToastProvider>
      <GraphView websiteId={websiteId} />
    </ToastProvider>
  )
}
