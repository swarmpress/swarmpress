'use client'

import { Spinner } from '../ui/spinner'
import { Progress } from '../ui/progress'
import { Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

export type AIProgressStatus = 'idle' | 'generating' | 'optimizing' | 'optimizing-all' | 'complete' | 'error'

export interface AIProgressState {
  status: AIProgressStatus
  message: string
  progress: number // 0-100
  totalItems?: number
  completedItems?: number
  currentItem?: string
  error?: string
}

interface AIProgressOverlayProps {
  state: AIProgressState
  onClose?: () => void
}

export function AIProgressOverlay({ state, onClose }: AIProgressOverlayProps) {
  if (state.status === 'idle') return null

  const isActive = ['generating', 'optimizing', 'optimizing-all'].includes(state.status)
  const isComplete = state.status === 'complete'
  const isError = state.status === 'error'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 border border-slate-200 dark:border-slate-700">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {isActive && (
            <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900/50">
              <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
          )}
          {isComplete && (
            <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/50">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
          )}
          {isError && (
            <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/50">
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {state.status === 'generating' && 'Generating Sections'}
              {state.status === 'optimizing' && 'Optimizing Section'}
              {state.status === 'optimizing-all' && 'Optimizing All Sections'}
              {state.status === 'complete' && 'Complete'}
              {state.status === 'error' && 'Error'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {state.message}
            </p>
          </div>
        </div>

        {/* Progress Section */}
        {isActive && (
          <div className="space-y-4">
            {/* Spinner with current item */}
            <div className="flex items-center justify-center py-4">
              <Spinner variant="circle-filled" size={48} className="text-purple-600 dark:text-purple-400" />
            </div>

            {/* Progress bar - show indeterminate or actual progress */}
            <div className="space-y-2">
              {state.progress < 0 ? (
                // Indeterminate progress - animated gradient bar
                <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full w-1/3 bg-gradient-to-r from-purple-500 to-purple-600 rounded-full animate-indeterminate" />
                </div>
              ) : (
                <Progress value={state.progress} className="h-2" />
              )}
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {state.totalItems !== undefined && state.completedItems !== undefined
                    ? `${state.completedItems} of ${state.totalItems} sections`
                    : 'Processing...'}
                </span>
                {state.progress >= 0 && <span>{Math.round(state.progress)}%</span>}
              </div>
            </div>

            {/* Current item indicator */}
            {state.currentItem && (
              <div className="text-center">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Currently processing:{' '}
                </span>
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                  {state.currentItem}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Complete State */}
        {isComplete && (
          <div className="space-y-4">
            <div className="flex items-center justify-center py-4">
              <div className="p-4 rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
              </div>
            </div>
            {state.totalItems !== undefined && state.completedItems !== undefined && (
              <p className="text-center text-sm text-slate-600 dark:text-slate-300">
                Successfully processed {state.completedItems} of {state.totalItems} sections
              </p>
            )}
            <button
              onClick={onClose}
              className={cn(
                'w-full py-2 px-4 rounded-lg font-medium transition-colors',
                'bg-green-600 text-white hover:bg-green-700',
                'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2'
              )}
            >
              Done
            </button>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="space-y-4">
            <div className="flex items-center justify-center py-4">
              <div className="p-4 rounded-full bg-red-100 dark:bg-red-900/30">
                <XCircle className="h-12 w-12 text-red-600 dark:text-red-400" />
              </div>
            </div>
            {state.error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-300 font-mono">
                  {state.error}
                </p>
              </div>
            )}
            <button
              onClick={onClose}
              className={cn(
                'w-full py-2 px-4 rounded-lg font-medium transition-colors',
                'bg-slate-200 text-slate-700 hover:bg-slate-300',
                'dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600',
                'focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2'
              )}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
