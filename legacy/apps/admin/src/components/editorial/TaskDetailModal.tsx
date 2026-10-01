/**
 * Task Detail Modal Component
 * Comprehensive view of task information with phase breakdown and history
 */

import { useState } from 'react'
import { GitHubActions } from './GitHubActions'

type TaskType = 'article' | 'page' | 'update' | 'fix' | 'optimize' | 'research'
type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'completed' | 'cancelled'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
type TaskPhase = 'research' | 'outline' | 'draft' | 'edit' | 'review' | 'publish' | 'optimize'

interface Task {
  id: string
  title: string
  description?: string
  task_type: TaskType
  status: TaskStatus
  priority: TaskPriority
  assigned_agent_id?: string
  assigned_human?: string
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
  due_date?: string
  estimated_hours?: number
  actual_hours?: number
  depends_on?: string[]
  blocks?: string[]
  sitemap_targets?: string[]
  seo_primary_keyword?: string
  seo_secondary_keywords?: string[]
  seo_target_volume?: number
  seo_estimated_difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard'
  internal_links_required_inbound?: string[]
  internal_links_required_outbound?: string[]
  internal_links_min_count?: number
  internal_links_max_count?: number
  word_count_target?: number
  word_count_actual?: number
  content_type?: string
  tags?: string[]
  labels?: string[]
  notes?: string
  current_phase?: TaskPhase
  phases_completed?: string[]
  github_branch?: string
  github_pr_url?: string
  github_issue_url?: string
}

interface TaskDetailModalProps {
  task: Task
  websiteId: string
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
  onCreateGitHubIssue?: (taskId: string, websiteId: string) => Promise<any>
  onCreateGitHubPR?: (taskId: string, websiteId: string) => Promise<any>
  onSyncGitHubPR?: (taskId: string, websiteId: string) => Promise<any>
}

const priorityColors: Record<TaskPriority, string> = {
  low: 'bg-gray-100 text-gray-700 border-gray-300',
  medium: 'bg-blue-100 text-blue-700 border-blue-300',
  high: 'bg-orange-100 text-orange-700 border-orange-300',
  urgent: 'bg-red-100 text-red-700 border-red-300',
}

const statusColors: Record<TaskStatus, string> = {
  backlog: 'bg-gray-100 text-gray-700',
  ready: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  in_review: 'bg-purple-100 text-purple-700',
  blocked: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export function TaskDetailModal({ task, websiteId, onClose, onEdit, onDelete, onCreateGitHubIssue, onCreateGitHubPR, onSyncGitHubPR }: TaskDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'phases' | 'seo' | 'links' | 'github'>('overview')

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900">{task.title}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-1 rounded text-xs font-semibold border ${priorityColors[task.priority]}`}>
                {task.priority}
              </span>
              <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColors[task.status]}`}>
                {task.status.replace('_', ' ')}
              </span>
              <span className="px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-700">
                {task.task_type}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={onEdit}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                ✏️ Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                🗑️ Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 bg-white">
          <div className="flex">
            <TabButton
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
            >
              📋 Overview
            </TabButton>
            <TabButton
              active={activeTab === 'phases'}
              onClick={() => setActiveTab('phases')}
            >
              🔄 Phases
            </TabButton>
            <TabButton
              active={activeTab === 'seo'}
              onClick={() => setActiveTab('seo')}
            >
              🎯 SEO
            </TabButton>
            <TabButton
              active={activeTab === 'links'}
              onClick={() => setActiveTab('links')}
            >
              🔗 Links
            </TabButton>
            <TabButton
              active={activeTab === 'github'}
              onClick={() => setActiveTab('github')}
            >
              🐙 GitHub
            </TabButton>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && <OverviewTab task={task} />}
          {activeTab === 'phases' && <PhasesTab task={task} />}
          {activeTab === 'seo' && <SEOTab task={task} />}
          {activeTab === 'links' && <LinksTab task={task} />}
          {activeTab === 'github' && (
            <GitHubTab
              task={task}
              websiteId={websiteId}
              onCreateGitHubIssue={onCreateGitHubIssue}
              onCreateGitHubPR={onCreateGitHubPR}
              onSyncGitHubPR={onSyncGitHubPR}
            />
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Created {new Date(task.created_at).toLocaleDateString()} •
            Updated {new Date(task.updated_at).toLocaleDateString()}
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3 font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function OverviewTab({ task }: { task: Task }) {
  return (
    <div className="space-y-6">
      {/* Description */}
      {task.description && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Description</h3>
          <p className="text-gray-600">{task.description}</p>
        </div>
      )}

      {/* Assignment */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Assignment</h3>
          <div className="space-y-2">
            {task.assigned_agent_id && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Agent:</span>
                <span className="font-medium">{task.assigned_agent_id}</span>
              </div>
            )}
            {task.assigned_human && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Human:</span>
                <span className="font-medium">{task.assigned_human}</span>
              </div>
            )}
            {!task.assigned_agent_id && !task.assigned_human && (
              <span className="text-gray-400 italic">Unassigned</span>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Timeline</h3>
          <div className="space-y-2">
            {task.due_date && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Due:</span>
                <span className="font-medium">{new Date(task.due_date).toLocaleDateString()}</span>
              </div>
            )}
            {task.estimated_hours && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Estimated:</span>
                <span className="font-medium">{task.estimated_hours}h</span>
              </div>
            )}
            {task.actual_hours && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Actual:</span>
                <span className="font-medium">{task.actual_hours}h</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tags & Labels */}
      {(task.tags || task.labels) && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Tags & Labels</h3>
          <div className="flex flex-wrap gap-2">
            {task.tags?.map((tag) => (
              <span key={tag} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                {tag}
              </span>
            ))}
            {task.labels?.map((label) => (
              <span key={label} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {task.notes && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-gray-700">{task.notes}</p>
          </div>
        </div>
      )}

      {/* Sitemap Targets */}
      {task.sitemap_targets && task.sitemap_targets.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Sitemap Targets</h3>
          <div className="space-y-1">
            {task.sitemap_targets.map((target) => (
              <div key={target} className="flex items-center gap-2">
                <span className="text-blue-600">→</span>
                <span className="text-gray-700">{target}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Requirements */}
      {(task.word_count_target || task.content_type) && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Content Requirements</h3>
          <div className="grid grid-cols-2 gap-4">
            {task.word_count_target && (
              <div>
                <span className="text-gray-500">Target Word Count:</span>
                <span className="ml-2 font-medium">{task.word_count_target}</span>
              </div>
            )}
            {task.word_count_actual && (
              <div>
                <span className="text-gray-500">Actual Word Count:</span>
                <span className="ml-2 font-medium">{task.word_count_actual}</span>
              </div>
            )}
            {task.content_type && (
              <div>
                <span className="text-gray-500">Content Type:</span>
                <span className="ml-2 font-medium">{task.content_type}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PhasesTab({ task }: { task: Task }) {
  const allPhases: TaskPhase[] = ['research', 'outline', 'draft', 'edit', 'review', 'publish', 'optimize']
  const completedPhases = task.phases_completed || []
  const currentPhase = task.current_phase

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Phase Progress</h3>
        {allPhases.map((phase, index) => {
          const isCompleted = completedPhases.includes(phase)
          const isCurrent = currentPhase === phase
          const isPending = !isCompleted && !isCurrent

          return (
            <div key={phase} className="flex items-center gap-4 mb-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                isCompleted ? 'bg-green-500 text-white' :
                isCurrent ? 'bg-blue-500 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>
                {isCompleted ? '✓' : index + 1}
              </div>
              <div className="flex-1">
                <div className="font-medium capitalize">{phase}</div>
                {isCurrent && (
                  <div className="text-xs text-blue-600">Currently active</div>
                )}
              </div>
              {isCompleted && (
                <span className="text-xs text-green-600">Completed</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SEOTab({ task }: { task: Task }) {
  return (
    <div className="space-y-6">
      {task.seo_primary_keyword && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Primary Keyword</h3>
          <div className="text-lg font-medium text-blue-600">{task.seo_primary_keyword}</div>
        </div>
      )}

      {task.seo_secondary_keywords && task.seo_secondary_keywords.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Secondary Keywords</h3>
          <div className="flex flex-wrap gap-2">
            {task.seo_secondary_keywords.map((keyword) => (
              <span key={keyword} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-sm">
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}

      {(task.seo_target_volume || task.seo_estimated_difficulty) && (
        <div className="grid grid-cols-2 gap-6">
          {task.seo_target_volume && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Target Search Volume</h3>
              <div className="text-2xl font-bold text-gray-900">{task.seo_target_volume.toLocaleString()}</div>
              <div className="text-xs text-gray-500">searches/month</div>
            </div>
          )}
          {task.seo_estimated_difficulty && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Estimated Difficulty</h3>
              <div className={`inline-block px-3 py-1 rounded-lg font-semibold ${
                task.seo_estimated_difficulty === 'easy' ? 'bg-green-100 text-green-700' :
                task.seo_estimated_difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                task.seo_estimated_difficulty === 'hard' ? 'bg-orange-100 text-orange-700' :
                'bg-red-100 text-red-700'
              }`}>
                {task.seo_estimated_difficulty}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LinksTab({ task }: { task: Task }) {
  return (
    <div className="space-y-6">
      {task.internal_links_required_inbound && task.internal_links_required_inbound.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Required Inbound Links</h3>
          <div className="space-y-1">
            {task.internal_links_required_inbound.map((link) => (
              <div key={link} className="flex items-center gap-2 text-sm">
                <span className="text-green-600">←</span>
                <span className="text-gray-700">{link}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {task.internal_links_required_outbound && task.internal_links_required_outbound.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Required Outbound Links</h3>
          <div className="space-y-1">
            {task.internal_links_required_outbound.map((link) => (
              <div key={link} className="flex items-center gap-2 text-sm">
                <span className="text-blue-600">→</span>
                <span className="text-gray-700">{link}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(task.internal_links_min_count || task.internal_links_max_count) && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Link Count Requirements</h3>
          <div className="flex gap-6">
            {task.internal_links_min_count && (
              <div>
                <span className="text-gray-500">Minimum:</span>
                <span className="ml-2 font-medium">{task.internal_links_min_count}</span>
              </div>
            )}
            {task.internal_links_max_count && (
              <div>
                <span className="text-gray-500">Maximum:</span>
                <span className="ml-2 font-medium">{task.internal_links_max_count}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function GitHubTab({
  task,
  websiteId,
  onCreateGitHubIssue,
  onCreateGitHubPR,
  onSyncGitHubPR
}: {
  task: Task
  websiteId: string
  onCreateGitHubIssue?: (taskId: string, websiteId: string) => Promise<any>
  onCreateGitHubPR?: (taskId: string, websiteId: string) => Promise<any>
  onSyncGitHubPR?: (taskId: string, websiteId: string) => Promise<any>
}) {
  // Default no-op handlers if not provided
  const handleCreateIssue = onCreateGitHubIssue || (async () => ({ issueNumber: 0, issueUrl: '' }))
  const handleCreatePR = onCreateGitHubPR || (async () => ({ prNumber: 0, prUrl: '', branch: '' }))
  const handleSyncPR = onSyncGitHubPR || (async () => ({ updated: false, prState: '', taskStatus: '' }))

  return (
    <GitHubActions
      taskId={task.id}
      websiteId={websiteId}
      githubIssueUrl={task.github_issue_url}
      githubPrUrl={task.github_pr_url}
      githubBranch={task.github_branch}
      onCreateIssue={handleCreateIssue}
      onCreatePR={handleCreatePR}
      onSyncPR={handleSyncPR}
    />
  )
}
