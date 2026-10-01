/**
 * Graph View Component
 * Network diagram visualization of editorial tasks with ReactFlow
 */

import { useState, useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from '@xyflow/react'
import type { Node, Edge } from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import { useEditorialTasks } from '../../hooks/useEditorialTasks'
import { TaskDetailModal } from './TaskDetailModal'
import { TaskNode } from './TaskNode'
import type { EditorialTask, TaskStatus, TaskPriority } from '../../hooks/useEditorialTasks'

interface GraphViewProps {
  websiteId: string
}

// Node types for ReactFlow
const nodeTypes = {
  task: TaskNode,
}

// Status colors
const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: '#9ca3af',     // gray
  ready: '#3b82f6',       // blue
  in_progress: '#f59e0b', // amber
  in_review: '#8b5cf6',   // purple
  blocked: '#ef4444',     // red
  completed: '#10b981',   // green
  cancelled: '#6b7280',   // gray-500
}

// Priority colors (for borders)
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#d1d5db',      // gray-300
  medium: '#60a5fa',   // blue-400
  high: '#f97316',     // orange-500
  urgent: '#dc2626',   // red-600
}

// Dagre layout configuration
const dagreGraph = new dagre.graphlib.Graph()
dagreGraph.setDefaultEdgeLabel(() => ({}))

const nodeWidth = 280
const nodeHeight = 120

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({ rankdir: direction, ranksep: 100, nodesep: 80 })

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight })
  })

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target)
  })

  dagre.layout(dagreGraph)

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

export function GraphView({ websiteId }: GraphViewProps) {
  const {
    tasks,
    isLoading,
    error,
    updateTask,
    deleteTask,
    refresh,
    createGitHubIssue,
    createGitHubPR,
    syncFromGitHubPR,
  } = useEditorialTasks(websiteId)

  const [selectedTask, setSelectedTask] = useState<EditorialTask | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('TB')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [filterAgent, setFilterAgent] = useState<string | 'all'>('all')
  const [showLegend, setShowLegend] = useState(true)

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filterStatus !== 'all' && task.status !== filterStatus) return false
      if (filterAgent !== 'all' && task.assigned_agent_id !== filterAgent) return false
      return true
    })
  }, [tasks, filterStatus, filterAgent])

  // Get unique agents for filter
  const availableAgents = useMemo(() => {
    const agentIds = tasks
      .map((task) => task.assigned_agent_id)
      .filter((id): id is string => !!id)
    return Array.from(new Set(agentIds))
  }, [tasks])

  // Convert tasks to ReactFlow nodes and edges
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = filteredTasks.map((task) => ({
      id: task.id,
      type: 'task',
      data: {
        task,
        statusColor: STATUS_COLORS[task.status],
        priorityColor: PRIORITY_COLORS[task.priority],
      },
      position: { x: 0, y: 0 }, // Will be set by layout algorithm
    }))

    const edges: Edge[] = []
    filteredTasks.forEach((task) => {
      if (task.depends_on && task.depends_on.length > 0) {
        task.depends_on.forEach((depId) => {
          // Only create edge if dependency task is in filtered set
          if (filteredTasks.find((t) => t.id === depId)) {
            edges.push({
              id: `${depId}-${task.id}`,
              source: depId,
              target: task.id,
              type: 'smoothstep',
              animated: task.status === 'in_progress',
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: '#6b7280',
              },
              style: {
                stroke: '#6b7280',
                strokeWidth: 2,
              },
            })
          }
        })
      }
    })

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      layoutDirection
    )

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges }
  }, [filteredTasks, layoutDirection])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Update nodes/edges when data changes
  useMemo(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const task = node.data.task as EditorialTask
      setSelectedTask(task)
      setShowDetailModal(true)
    },
    []
  )

  const handleCloseDetailModal = () => {
    setShowDetailModal(false)
    setSelectedTask(null)
  }

  const handleTaskDelete = async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteTask(taskId)
        setShowDetailModal(false)
      } catch (err) {
        console.error('Failed to delete task:', err)
      }
    }
  }

  const handleTaskEdit = (task: EditorialTask) => {
    // Navigate to Kanban view with edit modal
    window.location.href = `/editorial/kanban?edit=${task.id}`
  }

  const handleLayoutChange = (direction: 'TB' | 'LR') => {
    setLayoutDirection(direction)
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
          <p className="text-gray-600">Loading graph...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">⚠️ {error}</p>
          <button onClick={refresh} className="px-4 py-2 bg-red-100 hover:bg-red-200 rounded">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header Controls */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900">Graph View</h2>

          {/* Layout Direction */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => handleLayoutChange('TB')}
              className={`px-3 py-1 rounded text-sm ${
                layoutDirection === 'TB' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
              }`}
            >
              Top-Bottom
            </button>
            <button
              onClick={() => handleLayoutChange('LR')}
              className={`px-3 py-1 rounded text-sm ${
                layoutDirection === 'LR' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
              }`}
            >
              Left-Right
            </button>
          </div>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as TaskStatus | 'all')}
            className="px-3 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="backlog">Backlog</option>
            <option value="ready">Ready</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="blocked">Blocked</option>
            <option value="completed">Completed</option>
          </select>

          {/* Agent Filter */}
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="all">All Agents</option>
            {availableAgents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>

          {/* Legend Toggle */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            {showLegend ? 'Hide' : 'Show'} Legend
          </button>
        </div>

        <div className="text-sm text-gray-600">
          {filteredTasks.length} of {tasks.length} tasks
        </div>
      </div>

      {/* ReactFlow Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
        >
          <Background />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const task = node.data.task as EditorialTask
              return STATUS_COLORS[task.status]
            }}
            nodeBorderRadius={8}
          />

          {/* Legend Panel */}
          {showLegend && (
            <Panel position="top-right" className="bg-white p-4 rounded-lg shadow-lg border border-gray-200">
              <div className="space-y-4">
                {/* Status Legend */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Status</h3>
                  <div className="space-y-1">
                    {Object.entries(STATUS_COLORS).map(([status, color]) => (
                      <div key={status} className="flex items-center gap-2 text-xs">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: color }}
                        ></div>
                        <span className="text-gray-700 capitalize">
                          {status.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Priority Legend */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Priority (Border)</h3>
                  <div className="space-y-1">
                    {Object.entries(PRIORITY_COLORS).map(([priority, color]) => (
                      <div key={priority} className="flex items-center gap-2 text-xs">
                        <div
                          className="w-4 h-4 rounded border-2"
                          style={{ borderColor: color }}
                        ></div>
                        <span className="text-gray-700 capitalize">{priority}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dependency Info */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Dependencies</h3>
                  <div className="text-xs text-gray-600">
                    <p>Arrows show task dependencies</p>
                    <p className="mt-1">Animated = In Progress</p>
                  </div>
                </div>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Task Detail Modal */}
      {showDetailModal && selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          websiteId={websiteId}
          onClose={handleCloseDetailModal}
          onEdit={() => handleTaskEdit(selectedTask)}
          onDelete={() => handleTaskDelete(selectedTask.id)}
          onCreateGitHubIssue={createGitHubIssue}
          onCreateGitHubPR={createGitHubPR}
          onSyncGitHubPR={syncFromGitHubPR}
        />
      )}
    </div>
  )
}
