import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  RefreshCw,
  CloudSun,
  Thermometer,
  Droplets,
  Wind,
  Sun,
  Sunrise,
  Sunset,
  Loader2,
  AlertCircle,
  Clock,
  CloudRain,
  Cloud,
  Snowflake,
  CloudFog,
  CloudLightning,
} from 'lucide-react'

interface CurrentWeather {
  temperature_c: number
  temperature_f: number
  feels_like_c: number
  feels_like_f: number
  humidity_percent: number
  wind_speed_kmh: number
  wind_direction: string
  weather_code: number
  weather_description: string
  icon: string
  is_day: boolean
}

interface DailyForecast {
  date: string
  day_of_week: string
  temperature_max_c: number
  temperature_min_c: number
  weather_code: number
  weather_description: string
  icon: string
  precipitation_probability_percent: number
  uv_index_max: number
  sunrise: string
  sunset: string
}

interface WeatherData {
  current: CurrentWeather
  forecast: DailyForecast[]
  location: { name: string; country: string; coordinates: { lat: number; lon: number } }
  generated_at: string
  cached: boolean
  cache_ttl_remaining_ms?: number
}

interface CacheStatus {
  cache_ttl_ms: number
  entries: Array<{ key: string; age_ms: number; expires_in_ms: number }>
  total_cached: number
}

interface WeatherDashboardProps {
  compact?: boolean
}

export default function WeatherDashboard({ compact = false }: WeatherDashboardProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWeather = useCallback(async () => {
    try {
      const [weatherRes, cacheRes] = await Promise.all([
        fetch('/api/weather?type=full'),
        fetch('/api/weather?type=cache-status'),
      ])

      if (!weatherRes.ok) throw new Error('Failed to fetch weather')

      const weatherData = await weatherRes.json()
      const cacheData = await cacheRes.json()

      setWeather(weatherData)
      setCacheStatus(cacheData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load weather')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWeather()
  }, [fetchWeather])

  async function refreshWeather() {
    setRefreshing(true)
    try {
      const response = await fetch('/api/weather', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to refresh weather')
      await fetchWeather()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }

  const getWeatherIcon = (code: number, isDay: boolean = true) => {
    // Simplified weather code mapping
    if (code === 0) return isDay ? <Sun className="h-8 w-8 text-yellow-500" /> : <Sun className="h-8 w-8 text-slate-400" />
    if (code <= 3) return <CloudSun className="h-8 w-8 text-slate-500" />
    if (code <= 48) return <CloudFog className="h-8 w-8 text-slate-400" />
    if (code <= 67) return <CloudRain className="h-8 w-8 text-blue-500" />
    if (code <= 77) return <Snowflake className="h-8 w-8 text-blue-300" />
    if (code <= 82) return <CloudRain className="h-8 w-8 text-blue-600" />
    if (code <= 86) return <Snowflake className="h-8 w-8 text-blue-400" />
    if (code <= 99) return <CloudLightning className="h-8 w-8 text-yellow-600" />
    return <Cloud className="h-8 w-8 text-slate-400" />
  }

  const getSmallWeatherIcon = (code: number) => {
    if (code === 0) return <Sun className="h-5 w-5 text-yellow-500" />
    if (code <= 3) return <CloudSun className="h-5 w-5 text-slate-500" />
    if (code <= 48) return <CloudFog className="h-5 w-5 text-slate-400" />
    if (code <= 67) return <CloudRain className="h-5 w-5 text-blue-500" />
    if (code <= 77) return <Snowflake className="h-5 w-5 text-blue-300" />
    if (code <= 82) return <CloudRain className="h-5 w-5 text-blue-600" />
    if (code <= 86) return <Snowflake className="h-5 w-5 text-blue-400" />
    if (code <= 99) return <CloudLightning className="h-5 w-5 text-yellow-600" />
    return <Cloud className="h-5 w-5 text-slate-400" />
  }

  const formatCacheAge = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading weather data...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
          <Button variant="outline" size="sm" className="mt-4" onClick={fetchWeather}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!weather) return null

  // Compact version for sidebar
  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Cinque Terre Weather</CardTitle>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refreshWeather} disabled={refreshing}>
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-3">
            {getWeatherIcon(weather.current.weather_code, weather.current.is_day)}
            <div>
              <div className="text-2xl font-bold">{Math.round(weather.current.temperature_c)}°C</div>
              <div className="text-xs text-muted-foreground">{weather.current.weather_description}</div>
            </div>
          </div>
          {weather.cached && (
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Cached
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Full dashboard version
  return (
    <Card className="border-2 border-sky-200 dark:border-sky-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
              <CloudSun className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Weather Dashboard</CardTitle>
              <CardDescription>
                {weather.location.name}, {weather.location.country}
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refreshWeather} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Cache Status */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {weather.cached ? (
            <span className="text-muted-foreground">
              Cached • Expires in {formatCacheAge(weather.cache_ttl_remaining_ms || 0)}
            </span>
          ) : (
            <span className="text-green-600">Fresh data</span>
          )}
        </div>

        {/* Current Weather */}
        <div className="p-4 rounded-lg bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {getWeatherIcon(weather.current.weather_code, weather.current.is_day)}
              <div>
                <div className="text-4xl font-bold">{Math.round(weather.current.temperature_c)}°C</div>
                <div className="text-sm text-muted-foreground">
                  Feels like {Math.round(weather.current.feels_like_c)}°C
                </div>
                <div className="font-medium mt-1">{weather.current.weather_description}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Droplets className="h-4 w-4 text-blue-500" />
                <span>{weather.current.humidity_percent}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Wind className="h-4 w-4 text-slate-500" />
                <span>{Math.round(weather.current.wind_speed_kmh)} km/h</span>
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <span className="text-muted-foreground">Wind:</span>
                <span>{weather.current.wind_direction}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 7-Day Forecast */}
        <div>
          <h4 className="text-sm font-medium mb-3">7-Day Forecast</h4>
          <div className="grid grid-cols-7 gap-2">
            {weather.forecast.slice(0, 7).map((day, index) => (
              <div
                key={day.date}
                className={`p-2 rounded-lg text-center ${
                  index === 0 ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50'
                }`}
              >
                <div className="text-xs font-medium">
                  {index === 0 ? 'Today' : day.day_of_week.slice(0, 3)}
                </div>
                <div className="my-2 flex justify-center">
                  {getSmallWeatherIcon(day.weather_code)}
                </div>
                <div className="text-sm font-semibold">{Math.round(day.temperature_max_c)}°</div>
                <div className="text-xs text-muted-foreground">{Math.round(day.temperature_min_c)}°</div>
                {day.precipitation_probability_percent > 0 && (
                  <div className="text-xs text-blue-500 mt-1 flex items-center justify-center gap-1">
                    <Droplets className="h-3 w-3" />
                    {day.precipitation_probability_percent}%
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Today's Details */}
        {weather.forecast[0] && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Sunrise className="h-4 w-4 text-orange-500" />
                Sunrise
              </div>
              <div className="font-medium">{weather.forecast[0].sunrise}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Sunset className="h-4 w-4 text-purple-500" />
                Sunset
              </div>
              <div className="font-medium">{weather.forecast[0].sunset}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Sun className="h-4 w-4 text-yellow-500" />
                UV Index
              </div>
              <div className="font-medium">{weather.forecast[0].uv_index_max}</div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Thermometer className="h-4 w-4 text-red-500" />
                High / Low
              </div>
              <div className="font-medium">
                {Math.round(weather.forecast[0].temperature_max_c)}° / {Math.round(weather.forecast[0].temperature_min_c)}°
              </div>
            </div>
          </div>
        )}

        {/* Last Updated */}
        <div className="text-xs text-muted-foreground text-center">
          Last updated: {new Date(weather.generated_at).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  )
}
