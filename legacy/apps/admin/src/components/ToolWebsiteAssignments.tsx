import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Switch } from './ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Globe, Plus, Trash2, AlertCircle } from 'lucide-react'

interface Website {
  id: string
  domain: string
  title: string
}

interface Assignment {
  id: string
  website_id: string | null
  tool_config_id: string
  enabled: boolean
  priority: number
}

interface ToolWebsiteAssignmentsProps {
  toolId: string
  toolName: string
  websites: Website[]
}

export default function ToolWebsiteAssignments({ toolId, toolName, websites }: ToolWebsiteAssignmentsProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWebsite, setSelectedWebsite] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Fetch current assignments
  useEffect(() => {
    fetchAssignments()
  }, [toolId])

  async function fetchAssignments() {
    try {
      setLoading(true)
      const response = await fetch(`/api/tools/${toolId}/assignments`)
      if (!response.ok) throw new Error('Failed to fetch assignments')
      const data = await response.json()
      setAssignments(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments')
    } finally {
      setLoading(false)
    }
  }

  async function addAssignment() {
    if (!selectedWebsite) return

    setSaving(true)
    setError(null)

    try {
      const websiteId = selectedWebsite === 'global' ? null : selectedWebsite
      const response = await fetch(`/api/tools/${toolId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_id: websiteId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to add assignment')
      }

      setSelectedWebsite('')
      await fetchAssignments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add assignment')
    } finally {
      setSaving(false)
    }
  }

  async function removeAssignment(websiteId: string | null) {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/tools/${toolId}/assignments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_id: websiteId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to remove assignment')
      }

      await fetchAssignments()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove assignment')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(websiteId: string | null, enabled: boolean) {
    setError(null)

    try {
      const response = await fetch(`/api/tools/${toolId}/assignments/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_id: websiteId, enabled }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to toggle')
      }

      // Update local state
      setAssignments(prev => prev.map(a =>
        a.website_id === websiteId ? { ...a, enabled } : a
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle')
    }
  }

  // Get websites that are not yet assigned
  const assignedWebsiteIds = new Set(assignments.map(a => a.website_id))
  const availableWebsites = websites.filter(w => !assignedWebsiteIds.has(w.id))
  const hasGlobalAssignment = assignments.some(a => a.website_id === null)

  const getWebsiteName = (websiteId: string | null) => {
    if (websiteId === null) return 'Global (All Websites)'
    const website = websites.find(w => w.id === websiteId)
    return website ? `${website.title} (${website.domain})` : 'Unknown Website'
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Website Assignments</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Website Assignments
        </CardTitle>
        <CardDescription>
          Assign "{toolName}" to specific websites or make it globally available
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Add new assignment */}
        <div className="flex gap-2">
          <Select value={selectedWebsite} onValueChange={setSelectedWebsite}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select website to assign..." />
            </SelectTrigger>
            <SelectContent>
              {!hasGlobalAssignment && (
                <SelectItem value="global">Global (All Websites)</SelectItem>
              )}
              {availableWebsites.map(website => (
                <SelectItem key={website.id} value={website.id}>
                  {website.title} ({website.domain})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={addAssignment}
            disabled={!selectedWebsite || saving}
            size="icon"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Current assignments */}
        {assignments.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No website assignments yet</p>
            <p className="text-sm">Add a website above to enable this tool</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map(assignment => (
              <div
                key={assignment.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={assignment.enabled}
                    onCheckedChange={(checked: boolean) => toggleEnabled(assignment.website_id, checked)}
                  />
                  <div>
                    <div className="font-medium">
                      {getWebsiteName(assignment.website_id)}
                    </div>
                    {assignment.website_id === null && (
                      <Badge variant="secondary" className="text-xs">Global</Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAssignment(assignment.website_id)}
                  disabled={saving}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
