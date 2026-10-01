'use client'

import { useState, useEffect, useMemo } from 'react'
import type {
  SiteDefinition,
  SitemapNode,
  AgentAssignment,
  ResolvedAgentAssignment,
} from '@swarm-press/shared'
import { getResolvedAgentAssignments, getLocalizedValue } from '@swarm-press/shared'
import { Label } from '../../ui/label'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select'
import {
  Users,
  Link2,
  X,
  Loader2,
} from 'lucide-react'
import { cn } from '../../../lib/utils'

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000'

// Types for API responses
interface Department {
  id: string
  name: string
  company_id: string
  description?: string
}

interface Agent {
  id: string
  name: string
  department_id: string
  role_id: string
  avatar_url?: string
  virtual_email: string
  status: string
}

/**
 * Helper to make tRPC API calls
 */
async function trpcCall<T>(
  procedure: string,
  type: 'query' | 'mutation',
  input: Record<string, unknown>
): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ceo:admin@swarm.press',
  }

  if (type === 'query') {
    const params = encodeURIComponent(JSON.stringify({ json: input }))
    const response = await fetch(`${API_URL}/api/trpc/${procedure}?input=${params}`, {
      method: 'GET',
      headers,
    })
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return data.result?.data?.json ?? data.result?.data
  } else {
    const response = await fetch(`${API_URL}/api/trpc/${procedure}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ json: input }),
    })
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    return data.result?.data?.json ?? data.result?.data
  }
}

interface AgentAssignmentsPanelProps {
  node: SitemapNode
  siteDefinition: SiteDefinition
  onUpdate: (agentAssignments: AgentAssignment[]) => void
}

export function AgentAssignmentsPanel({
  node,
  siteDefinition,
  onUpdate,
}: AgentAssignmentsPanelProps) {
  const [departments, setDepartments] = useState<Department[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load departments and agents on mount
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true)
        setError(null)

        // Fetch departments and agents in parallel
        const [deptResult, agentResult] = await Promise.all([
          trpcCall<{ items: Department[] }>('department.list', 'query', {}),
          trpcCall<{ items: Agent[] }>('agent.list', 'query', {}),
        ])

        setDepartments(deptResult.items || [])
        setAgents((agentResult.items || []).filter(a => a.status === 'active'))
      } catch (err) {
        console.error('Failed to load departments/agents:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  // Create a node lookup function for inheritance resolution
  const getNodeById = useMemo(() => {
    const nodeMap = new Map<string, SitemapNode>()
    for (const n of siteDefinition.sitemap.nodes) {
      nodeMap.set(n.id, n)
    }
    return (nodeId: string) => nodeMap.get(nodeId)
  }, [siteDefinition.sitemap.nodes])

  // Get resolved assignments with inheritance info
  const resolvedAssignments = useMemo(() => {
    if (departments.length === 0) return []

    return getResolvedAgentAssignments(
      node,
      departments.map(d => ({ id: d.id, name: d.name })),
      agents.map(a => ({ id: a.id, name: a.name, departmentId: a.department_id })),
      getNodeById,
      siteDefinition.sitemap.edges || []
    )
  }, [node, departments, agents, getNodeById, siteDefinition.sitemap.edges])

  // Get agents for a specific department
  const getAgentsForDepartment = (departmentId: string) => {
    return agents.filter(a => a.department_id === departmentId)
  }

  // Handle agent selection change
  const handleAgentChange = (departmentId: string, agentId: string | null) => {
    const currentAssignments = node.data?.agentAssignments || []

    // Find existing assignment for this department
    const existingIndex = currentAssignments.findIndex(
      (a: AgentAssignment) => a.departmentId === departmentId
    )

    let newAssignments: AgentAssignment[]

    if (agentId === 'inherited') {
      // Remove the assignment to use inheritance
      newAssignments = currentAssignments.filter(
        (a: AgentAssignment) => a.departmentId !== departmentId
      )
    } else {
      const newAssignment: AgentAssignment = {
        departmentId,
        agentId: agentId,
      }

      if (existingIndex >= 0) {
        // Update existing
        newAssignments = currentAssignments.map((a: AgentAssignment, i: number) =>
          i === existingIndex ? newAssignment : a
        )
      } else {
        // Add new
        newAssignments = [...currentAssignments, newAssignment]
      }
    }

    onUpdate(newAssignments)
  }

  // Clear all overrides
  const clearAllOverrides = () => {
    onUpdate([])
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading agents...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (departments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No departments configured</p>
        <p className="text-xs mt-1">Add departments to assign agents to pages</p>
      </div>
    )
  }

  const hasOverrides = (node.data?.agentAssignments?.length || 0) > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Agent Assignments
        </Label>
        {hasOverrides && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground"
            onClick={clearAllOverrides}
          >
            <X className="h-3 w-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Assign agents per department. Settings inherit down the sitemap tree.
      </p>

      <div className="space-y-3">
        {resolvedAssignments.map((assignment) => (
          <DepartmentAssignment
            key={assignment.departmentId}
            assignment={assignment}
            agents={getAgentsForDepartment(assignment.departmentId)}
            allAgents={agents}
            onChange={(agentId) => handleAgentChange(assignment.departmentId, agentId)}
          />
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Department Assignment Row
// ============================================================================

interface DepartmentAssignmentProps {
  assignment: ResolvedAgentAssignment
  agents: Agent[]
  allAgents: Agent[]
  onChange: (agentId: string | null) => void
}

function DepartmentAssignment({
  assignment,
  agents,
  allAgents,
  onChange,
}: DepartmentAssignmentProps) {
  const selectedAgent = assignment.agentId
    ? allAgents.find(a => a.id === assignment.agentId)
    : null

  // Determine the select value
  const selectValue = assignment.inherited ? 'inherited' : (assignment.agentId || 'none')

  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">
        {assignment.departmentName}
      </Label>

      <Select
        value={selectValue}
        onValueChange={(value) => {
          if (value === 'inherited') {
            onChange(null)
          } else if (value === 'none') {
            // Explicitly set to no agent (not inherited)
            onChange(null)
          } else {
            onChange(value)
          }
        }}
      >
        <SelectTrigger className={cn(
          'h-9',
          assignment.inherited && 'border-dashed'
        )}>
          <SelectValue>
            {assignment.inherited ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Link2 className="h-3 w-3" />
                {selectedAgent ? (
                  <>Inherited: {selectedAgent.name}</>
                ) : (
                  <>Inherited (none)</>
                )}
              </span>
            ) : selectedAgent ? (
              <span className="flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={selectedAgent.avatar_url} />
                  <AvatarFallback className="text-[10px]">
                    {selectedAgent.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {selectedAgent.name}
              </span>
            ) : (
              <span className="text-muted-foreground">Not assigned</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherited">
            <span className="flex items-center gap-2">
              <Link2 className="h-3 w-3 text-muted-foreground" />
              <span>Inherited</span>
              {assignment.fromNodeTitle && (
                <span className="text-xs text-muted-foreground ml-1">
                  from {assignment.fromNodeTitle}
                </span>
              )}
            </span>
          </SelectItem>

          {agents.length > 0 ? (
            agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <span className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={agent.avatar_url} />
                    <AvatarFallback className="text-[10px]">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {agent.name}
                </span>
              </SelectItem>
            ))
          ) : (
            <SelectItem value="none" disabled>
              <span className="text-muted-foreground">No agents in this department</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {/* Show inheritance source */}
      {assignment.inherited && assignment.fromNodeTitle && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 pl-1">
          <Link2 className="h-2.5 w-2.5" />
          Inherited from: {assignment.fromNodeTitle}
        </p>
      )}
    </div>
  )
}
