import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'
import {
  RefreshCw,
  Calendar,
  Sun,
  Leaf,
  Snowflake,
  Flower2,
  Loader2,
  AlertCircle,
  Play,
  UtensilsCrossed,
  MapPin,
  Tent,
  PartyPopper,
  Camera,
  Plane,
  Waves,
  FileText,
} from 'lucide-react'

interface SeasonInfo {
  currentDate: string
  currentSeason: 'spring' | 'summer' | 'fall' | 'winter'
  nextSeason: string
  seasonWindow: { start: string; end: string }
}

interface Topic {
  id: string
  title: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  category: string
  season: string
}

interface CalendarData {
  seasonInfo: SeasonInfo
  topics: Topic[]
  totalTopics: number
  filters: {
    season: string
    priority: string
  }
}

interface ContentCalendarViewProps {
  websiteId: string
  websiteName: string
}

export default function ContentCalendarView({ websiteId, websiteName }: ContentCalendarViewProps) {
  const [data, setData] = useState<CalendarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seasonFilter, setSeasonFilter] = useState<string>('current')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')

  const fetchCalendar = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/content-calendar?season=${seasonFilter}&priority=${priorityFilter}`
      )
      if (!response.ok) throw new Error('Failed to fetch content calendar')
      const result = await response.json()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar')
    } finally {
      setLoading(false)
    }
  }, [seasonFilter, priorityFilter])

  useEffect(() => {
    fetchCalendar()
  }, [fetchCalendar])

  async function generateTopic(topicId: string) {
    setGenerating(topicId)
    try {
      const response = await fetch('/api/content-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          topicId,
          dryRun: false,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.message || 'Failed to generate topic')
      }

      // Refresh the calendar
      await fetchCalendar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate topic')
    } finally {
      setGenerating(null)
    }
  }

  const getSeasonIcon = (season: string, size: 'sm' | 'md' = 'md') => {
    const className = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
    switch (season) {
      case 'spring': return <Flower2 className={`${className} text-pink-500`} />
      case 'summer': return <Sun className={`${className} text-yellow-500`} />
      case 'fall': return <Leaf className={`${className} text-orange-500`} />
      case 'winter': return <Snowflake className={`${className} text-blue-400`} />
      default: return <Calendar className={className} />
    }
  }

  const getCategoryIcon = (category: string) => {
    const className = 'h-4 w-4'
    switch (category) {
      case 'food': return <UtensilsCrossed className={`${className} text-orange-500`} />
      case 'nature': return <Leaf className={`${className} text-green-500`} />
      case 'events': return <PartyPopper className={`${className} text-purple-500`} />
      case 'travel': return <Plane className={`${className} text-blue-500`} />
      case 'culture': return <Camera className={`${className} text-rose-500`} />
      case 'beaches': return <Waves className={`${className} text-cyan-500`} />
      case 'entertainment': return <PartyPopper className={`${className} text-pink-500`} />
      case 'transport': return <MapPin className={`${className} text-slate-500`} />
      default: return <FileText className={`${className} text-muted-foreground`} />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
      case 'high': return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800'
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800'
      case 'low': return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  const getSeasonColor = (season: string) => {
    switch (season) {
      case 'spring': return 'bg-pink-50 border-pink-200 dark:bg-pink-900/10 dark:border-pink-800'
      case 'summer': return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800'
      case 'fall': return 'bg-orange-50 border-orange-200 dark:bg-orange-900/10 dark:border-orange-800'
      case 'winter': return 'bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800'
      default: return 'bg-muted'
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading content calendar...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-2 border-emerald-200 dark:border-emerald-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <Calendar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Content Calendar</CardTitle>
              <CardDescription>
                Seasonal content topics for {websiteName}
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={fetchCalendar}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 rounded-lg bg-destructive/10">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Current Season Indicator */}
        {data?.seasonInfo && (
          <div className={`p-4 rounded-lg border ${getSeasonColor(data.seasonInfo.currentSeason)}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getSeasonIcon(data.seasonInfo.currentSeason)}
                <span className="font-medium capitalize">
                  Currently: {data.seasonInfo.currentSeason} Season
                </span>
              </div>
              <Badge variant="outline">
                {data.seasonInfo.seasonWindow.start} - {data.seasonInfo.seasonWindow.end}
              </Badge>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Season</label>
            <Select value={seasonFilter} onValueChange={setSeasonFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">
                  <div className="flex items-center gap-2">
                    {data?.seasonInfo && getSeasonIcon(data.seasonInfo.currentSeason, 'sm')}
                    Current Season
                  </div>
                </SelectItem>
                <SelectItem value="all">All Seasons</SelectItem>
                <SelectItem value="spring">
                  <div className="flex items-center gap-2">
                    <Flower2 className="h-4 w-4 text-pink-500" />
                    Spring
                  </div>
                </SelectItem>
                <SelectItem value="summer">
                  <div className="flex items-center gap-2">
                    <Sun className="h-4 w-4 text-yellow-500" />
                    Summer
                  </div>
                </SelectItem>
                <SelectItem value="fall">
                  <div className="flex items-center gap-2">
                    <Leaf className="h-4 w-4 text-orange-500" />
                    Fall
                  </div>
                </SelectItem>
                <SelectItem value="winter">
                  <div className="flex items-center gap-2">
                    <Snowflake className="h-4 w-4 text-blue-400" />
                    Winter
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Priority</label>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="critical">Critical Only</SelectItem>
                <SelectItem value="high">High & Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Topic Count */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {data?.totalTopics || 0} topics</span>
        </div>

        {/* Topics List */}
        <div className="space-y-3">
          {data?.topics.map((topic) => (
            <div
              key={topic.id}
              className={`p-4 rounded-lg border transition-colors hover:bg-muted/50`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getCategoryIcon(topic.category)}
                    <span className="font-medium truncate">{topic.title}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className={getPriorityColor(topic.priority)}>
                      {topic.priority}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {topic.category}
                    </Badge>
                    {seasonFilter === 'all' && (
                      <Badge variant="outline" className="capitalize flex items-center gap-1">
                        {getSeasonIcon(topic.season, 'sm')}
                        {topic.season}
                      </Badge>
                    )}
                  </div>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={generating === topic.id}
                    >
                      {generating === topic.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Play className="h-3 w-3 mr-1" />
                          Generate
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Generate Content?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will start content generation for:
                        <strong className="block mt-2">{topic.title}</strong>
                        <p className="mt-2">
                          AI agents will research and write content for this topic.
                        </p>
                        <p className="mt-2 text-yellow-600 dark:text-yellow-400">
                          Note: This uses Claude API credits.
                        </p>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => generateTopic(topic.id)}>
                        Generate Content
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}

          {data?.topics.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No topics found for the selected filters.</p>
              <p className="text-sm mt-1">Try adjusting your season or priority filters.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
