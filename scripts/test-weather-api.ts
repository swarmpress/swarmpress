#!/usr/bin/env tsx
/**
 * Weather API Test Script
 *
 * Tests the weather API endpoints and the WeatherWidget data format.
 *
 * Usage:
 *   tsx scripts/test-weather-api.ts
 *   tsx scripts/test-weather-api.ts --direct  # Test Open-Meteo directly
 */

const API_URL = process.env.API_URL || 'http://localhost:3000'

interface TestResult {
  name: string
  passed: boolean
  details?: string
  error?: string
}

const results: TestResult[] = []

function log(result: TestResult) {
  const icon = result.passed ? '✅' : '❌'
  console.log(`${icon} ${result.name}`)
  if (result.details) {
    console.log(`   ${result.details}`)
  }
  if (result.error) {
    console.log(`   Error: ${result.error}`)
  }
  results.push(result)
}

async function testOpenMeteoDirect(): Promise<void> {
  console.log('\n🌍 Testing Open-Meteo API directly...\n')

  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', '44.1448')
  url.searchParams.set('longitude', '9.6526')
  url.searchParams.set('current', 'temperature_2m,weather_code')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max')
  url.searchParams.set('timezone', 'Europe/Rome')
  url.searchParams.set('forecast_days', '4')

  try {
    const response = await fetch(url.toString())

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()

    log({
      name: 'Open-Meteo API Connection',
      passed: true,
      details: `Current temp: ${data.current.temperature_2m}°C, Weather code: ${data.current.weather_code}`,
    })

    if (data.daily && data.daily.time && data.daily.time.length > 0) {
      log({
        name: 'Open-Meteo Forecast Data',
        passed: true,
        details: `${data.daily.time.length} day forecast available`,
      })
    } else {
      log({
        name: 'Open-Meteo Forecast Data',
        passed: false,
        error: 'Missing forecast data',
      })
    }
  } catch (error) {
    log({
      name: 'Open-Meteo API Connection',
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

async function testTRPCWeatherEndpoints(): Promise<void> {
  console.log('\n🌐 Testing tRPC Weather Endpoints...\n')

  // Test weather.current
  try {
    const response = await fetch(`${API_URL}/api/trpc/weather.current`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const current = data.result?.data?.current

    if (current && typeof current.temperature_c === 'number') {
      log({
        name: 'weather.current endpoint',
        passed: true,
        details: `${current.temperature_c}°C, ${current.weather_description}`,
      })
    } else {
      log({
        name: 'weather.current endpoint',
        passed: false,
        error: 'Unexpected response format',
      })
    }

    // Check cache info
    const cached = data.result?.data?.cached
    log({
      name: 'weather.current caching',
      passed: true,
      details: cached ? 'Served from cache' : 'Fresh data fetched',
    })
  } catch (error) {
    log({
      name: 'weather.current endpoint',
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  // Test weather.forecast
  try {
    const response = await fetch(`${API_URL}/api/trpc/weather.forecast`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const forecast = data.result?.data?.forecast

    if (forecast && Array.isArray(forecast) && forecast.length > 0) {
      log({
        name: 'weather.forecast endpoint',
        passed: true,
        details: `${forecast.length} day forecast`,
      })
    } else {
      log({
        name: 'weather.forecast endpoint',
        passed: false,
        error: 'Missing or invalid forecast data',
      })
    }
  } catch (error) {
    log({
      name: 'weather.forecast endpoint',
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  // Test weather.display (widget format)
  try {
    const response = await fetch(`${API_URL}/api/trpc/weather.display`, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const display = data.result?.data

    if (display?.today && display?.forecast) {
      log({
        name: 'weather.display endpoint',
        passed: true,
        details: `Today: ${display.today.conditions}, Forecast: ${display.forecast.length} days`,
      })
    } else {
      log({
        name: 'weather.display endpoint',
        passed: false,
        error: 'Missing display data',
      })
    }
  } catch (error) {
    log({
      name: 'weather.display endpoint',
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  // Test weather.cacheStatus
  try {
    const response = await fetch(`${API_URL}/api/trpc/weather.cacheStatus`, {
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const status = data.result?.data

    if (status && typeof status.cache_ttl_ms === 'number') {
      log({
        name: 'weather.cacheStatus endpoint',
        passed: true,
        details: `TTL: ${status.cache_ttl_ms / 1000}s, Cached entries: ${status.total_cached}`,
      })
    } else {
      log({
        name: 'weather.cacheStatus endpoint',
        passed: false,
        error: 'Invalid cache status response',
      })
    }
  } catch (error) {
    log({
      name: 'weather.cacheStatus endpoint',
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

async function testWeatherWidgetFormat(): Promise<void> {
  console.log('\n🧩 Testing WeatherWidget data format...\n')

  // Simulate what the WeatherWidget fetches
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', '44.1448')
  url.searchParams.set('longitude', '9.6526')
  url.searchParams.set('current', 'temperature_2m,weather_code')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max')
  url.searchParams.set('timezone', 'Europe/Rome')
  url.searchParams.set('forecast_days', '4')

  try {
    const response = await fetch(url.toString())
    const data = await response.json()

    // Validate the structure matches what WeatherWidget expects
    const hasCurrentTemp = typeof data.current?.temperature_2m === 'number'
    const hasCurrentCode = typeof data.current?.weather_code === 'number'
    const hasDailyTime = Array.isArray(data.daily?.time) && data.daily.time.length >= 3
    const hasDailyMax = Array.isArray(data.daily?.temperature_2m_max) && data.daily.temperature_2m_max.length >= 3
    const hasDailyCode = Array.isArray(data.daily?.weather_code) && data.daily.weather_code.length >= 3

    const allValid = hasCurrentTemp && hasCurrentCode && hasDailyTime && hasDailyMax && hasDailyCode

    if (allValid) {
      log({
        name: 'WeatherWidget data format',
        passed: true,
        details: `Current: ${data.current.temperature_2m}°C, 3-day forecast available`,
      })
    } else {
      const missing = []
      if (!hasCurrentTemp) missing.push('current.temperature_2m')
      if (!hasCurrentCode) missing.push('current.weather_code')
      if (!hasDailyTime) missing.push('daily.time')
      if (!hasDailyMax) missing.push('daily.temperature_2m_max')
      if (!hasDailyCode) missing.push('daily.weather_code')

      log({
        name: 'WeatherWidget data format',
        passed: false,
        error: `Missing fields: ${missing.join(', ')}`,
      })
    }
  } catch (error) {
    log({
      name: 'WeatherWidget data format',
      passed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function printSummary(): void {
  console.log('\n' + '='.repeat(50))
  console.log('📊 Summary')
  console.log('='.repeat(50))

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  console.log(`\n  ✅ Passed: ${passed}`)
  console.log(`  ❌ Failed: ${failed}`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    results
      .filter(r => !r.passed)
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`))
    process.exit(1)
  } else {
    console.log('\n✅ All weather API tests passed!')
  }
}

async function main() {
  console.log('🌤️  Weather API Test Suite')
  console.log('='.repeat(50))

  const directOnly = process.argv.includes('--direct')

  // Always test Open-Meteo directly
  await testOpenMeteoDirect()

  // Test widget format
  await testWeatherWidgetFormat()

  // Test tRPC endpoints if not --direct mode
  if (!directOnly) {
    await testTRPCWeatherEndpoints()
  }

  printSummary()
}

main().catch(error => {
  console.error('\n💥 Test failed:', error)
  process.exit(1)
})
