/**
 * Weather Router
 * API endpoints for real-time weather data with caching
 * Uses Open-Meteo API via weather-api.service.ts
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import {
  getCurrentWeatherAndForecast,
  getWeatherForDisplay,
  type WeatherResponse,
} from '../../services/weather-api.service'

// Simple in-memory cache with TTL
interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null

  const isExpired = Date.now() - entry.timestamp > CACHE_TTL_MS
  if (isExpired) {
    cache.delete(key)
    return null
  }

  return entry.data
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  })
}

export const weatherRouter = router({
  // ============================================================================
  // Current Weather
  // ============================================================================

  /**
   * Get current weather conditions for Cinque Terre
   * Includes temperature, humidity, wind, and conditions
   * Cached for 15 minutes to reduce API calls
   */
  current: publicProcedure.query(async () => {
    const cacheKey = 'weather:current'
    const cached = getCached<WeatherResponse>(cacheKey)

    if (cached) {
      return {
        ...cached,
        cached: true,
        cache_ttl_remaining_ms: CACHE_TTL_MS - (Date.now() - (cache.get(cacheKey)?.timestamp || 0)),
      }
    }

    const weather = await getCurrentWeatherAndForecast()
    setCache(cacheKey, weather)

    return {
      ...weather,
      cached: false,
      cache_ttl_remaining_ms: CACHE_TTL_MS,
    }
  }),

  /**
   * Get 7-day forecast for Cinque Terre
   * Includes daily high/low temps, precipitation, UV index
   * Cached for 15 minutes
   */
  forecast: publicProcedure.query(async () => {
    const cacheKey = 'weather:forecast'
    const cached = getCached<WeatherResponse>(cacheKey)

    if (cached) {
      return {
        forecast: cached.forecast,
        location: cached.location,
        generated_at: cached.generated_at,
        cached: true,
        cache_ttl_remaining_ms: CACHE_TTL_MS - (Date.now() - (cache.get(cacheKey)?.timestamp || 0)),
      }
    }

    const weather = await getCurrentWeatherAndForecast()
    setCache(cacheKey, weather)

    return {
      forecast: weather.forecast,
      location: weather.location,
      generated_at: weather.generated_at,
      cached: false,
      cache_ttl_remaining_ms: CACHE_TTL_MS,
    }
  }),

  /**
   * Get weather formatted for website display
   * Simplified format for widget and display components
   */
  display: publicProcedure.query(async () => {
    const cacheKey = 'weather:display'
    type DisplayWeather = Awaited<ReturnType<typeof getWeatherForDisplay>>
    const cached = getCached<DisplayWeather>(cacheKey)

    if (cached) {
      return {
        ...cached,
        cached: true,
      }
    }

    const display = await getWeatherForDisplay()
    setCache(cacheKey, display)

    return {
      ...display,
      cached: false,
    }
  }),

  /**
   * Get full weather data (current + forecast)
   * Single call for pages that need everything
   */
  full: publicProcedure.query(async () => {
    const cacheKey = 'weather:full'
    const cached = getCached<WeatherResponse>(cacheKey)

    if (cached) {
      return {
        ...cached,
        cached: true,
      }
    }

    const weather = await getCurrentWeatherAndForecast()
    setCache(cacheKey, weather)

    return {
      ...weather,
      cached: false,
    }
  }),

  /**
   * Force refresh weather data (bypasses cache)
   * Useful for admin/debugging
   */
  refresh: publicProcedure.mutation(async () => {
    // Clear all weather cache entries
    const keysToDelete = Array.from(cache.keys()).filter(key => key.startsWith('weather:'))
    for (const key of keysToDelete) {
      cache.delete(key)
    }

    // Fetch fresh data
    const weather = await getCurrentWeatherAndForecast()
    setCache('weather:full', weather)
    setCache('weather:current', weather)
    setCache('weather:forecast', weather)

    return {
      success: true,
      weather,
      message: 'Weather cache cleared and refreshed',
    }
  }),

  /**
   * Get cache status for monitoring
   */
  cacheStatus: publicProcedure.query(() => {
    const entries: Array<{ key: string; age_ms: number; expires_in_ms: number }> = []

    Array.from(cache.entries()).forEach(([key, entry]) => {
      if (key.startsWith('weather:')) {
        const age = Date.now() - entry.timestamp
        entries.push({
          key,
          age_ms: age,
          expires_in_ms: Math.max(0, CACHE_TTL_MS - age),
        })
      }
    })

    return {
      cache_ttl_ms: CACHE_TTL_MS,
      entries,
      total_cached: entries.length,
    }
  }),
})
