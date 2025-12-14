/**
 * Weather API Service
 *
 * Fetches real-time weather data using Open-Meteo API (free, no API key required)
 * Provides current conditions + 7-day forecast for Cinque Terre
 */

// Cinque Terre coordinates (Monterosso al Mare as center point)
const CINQUE_TERRE_COORDS = {
  latitude: 44.1448,
  longitude: 9.6526
}

export interface CurrentWeather {
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

export interface DailyForecast {
  date: string
  day_of_week: string
  temperature_max_c: number
  temperature_max_f: number
  temperature_min_c: number
  temperature_min_f: number
  weather_code: number
  weather_description: string
  icon: string
  precipitation_probability_percent: number
  precipitation_mm: number
  uv_index_max: number
  sunrise: string
  sunset: string
  wind_speed_max_kmh: number
}

export interface WeatherResponse {
  location: {
    name: string
    region: string
    country: string
    latitude: number
    longitude: number
    timezone: string
  }
  current: CurrentWeather
  forecast: DailyForecast[]
  generated_at: string
  data_source: string
}

// Weather code to description mapping (WMO codes)
const WEATHER_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: 'Clear sky', icon: 'sunny' },
  1: { description: 'Mainly clear', icon: 'sunny' },
  2: { description: 'Partly cloudy', icon: 'partly-cloudy' },
  3: { description: 'Overcast', icon: 'cloudy' },
  45: { description: 'Fog', icon: 'foggy' },
  48: { description: 'Depositing rime fog', icon: 'foggy' },
  51: { description: 'Light drizzle', icon: 'rainy' },
  53: { description: 'Moderate drizzle', icon: 'rainy' },
  55: { description: 'Dense drizzle', icon: 'rainy' },
  56: { description: 'Light freezing drizzle', icon: 'rainy' },
  57: { description: 'Dense freezing drizzle', icon: 'rainy' },
  61: { description: 'Slight rain', icon: 'rainy' },
  63: { description: 'Moderate rain', icon: 'rainy' },
  65: { description: 'Heavy rain', icon: 'rainy' },
  66: { description: 'Light freezing rain', icon: 'rainy' },
  67: { description: 'Heavy freezing rain', icon: 'rainy' },
  71: { description: 'Slight snow fall', icon: 'snowy' },
  73: { description: 'Moderate snow fall', icon: 'snowy' },
  75: { description: 'Heavy snow fall', icon: 'snowy' },
  77: { description: 'Snow grains', icon: 'snowy' },
  80: { description: 'Slight rain showers', icon: 'rainy' },
  81: { description: 'Moderate rain showers', icon: 'rainy' },
  82: { description: 'Violent rain showers', icon: 'stormy' },
  85: { description: 'Slight snow showers', icon: 'snowy' },
  86: { description: 'Heavy snow showers', icon: 'snowy' },
  95: { description: 'Thunderstorm', icon: 'stormy' },
  96: { description: 'Thunderstorm with slight hail', icon: 'stormy' },
  99: { description: 'Thunderstorm with heavy hail', icon: 'stormy' },
}

function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(degrees / 22.5) % 16
  return directions[index]
}

function getDayOfWeek(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[new Date(dateStr).getDay()]
}

function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9/5 + 32) * 10) / 10
}

export async function getCurrentWeatherAndForecast(): Promise<WeatherResponse> {
  const { latitude, longitude } = CINQUE_TERRE_COORDS

  // Open-Meteo API - free, no API key required
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', latitude.toString())
  url.searchParams.set('longitude', longitude.toString())
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset,wind_speed_10m_max')
  url.searchParams.set('timezone', 'Europe/Rome')
  url.searchParams.set('forecast_days', '8') // Today + 7 days

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as {
    current: {
      temperature_2m: number
      relative_humidity_2m: number
      apparent_temperature: number
      is_day: number
      weather_code: number
      wind_speed_10m: number
      wind_direction_10m: number
    }
    daily: {
      time: string[]
      weather_code: number[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
      precipitation_sum: number[]
      precipitation_probability_max: number[]
      uv_index_max: number[]
      sunrise: string[]
      sunset: string[]
      wind_speed_10m_max: number[]
    }
  }

  // Parse current weather
  const currentCode = data.current.weather_code
  const currentWeatherInfo = WEATHER_CODES[currentCode] || { description: 'Unknown', icon: 'unknown' }

  const current: CurrentWeather = {
    temperature_c: Math.round(data.current.temperature_2m * 10) / 10,
    temperature_f: celsiusToFahrenheit(data.current.temperature_2m),
    feels_like_c: Math.round(data.current.apparent_temperature * 10) / 10,
    feels_like_f: celsiusToFahrenheit(data.current.apparent_temperature),
    humidity_percent: data.current.relative_humidity_2m,
    wind_speed_kmh: Math.round(data.current.wind_speed_10m * 10) / 10,
    wind_direction: getWindDirection(data.current.wind_direction_10m),
    weather_code: currentCode,
    weather_description: currentWeatherInfo.description,
    icon: currentWeatherInfo.icon,
    is_day: data.current.is_day === 1
  }

  // Parse daily forecast (7 days)
  const forecast: DailyForecast[] = data.daily.time.slice(0, 8).map((date: string, i: number) => {
    const code = data.daily.weather_code[i]!
    const weatherInfo = WEATHER_CODES[code] || { description: 'Unknown', icon: 'unknown' }

    return {
      date,
      day_of_week: getDayOfWeek(date),
      temperature_max_c: Math.round(data.daily.temperature_2m_max[i]! * 10) / 10,
      temperature_max_f: celsiusToFahrenheit(data.daily.temperature_2m_max[i]!),
      temperature_min_c: Math.round(data.daily.temperature_2m_min[i]! * 10) / 10,
      temperature_min_f: celsiusToFahrenheit(data.daily.temperature_2m_min[i]!),
      weather_code: code,
      weather_description: weatherInfo.description,
      icon: weatherInfo.icon,
      precipitation_probability_percent: data.daily.precipitation_probability_max[i] ?? 0,
      precipitation_mm: Math.round(data.daily.precipitation_sum[i]! * 10) / 10,
      uv_index_max: data.daily.uv_index_max[i]!,
      sunrise: data.daily.sunrise[i]!.split('T')[1],
      sunset: data.daily.sunset[i]!.split('T')[1],
      wind_speed_max_kmh: Math.round(data.daily.wind_speed_10m_max[i]! * 10) / 10
    }
  })

  return {
    location: {
      name: 'Cinque Terre',
      region: 'Liguria',
      country: 'Italy',
      latitude,
      longitude,
      timezone: 'Europe/Rome'
    },
    current,
    forecast,
    generated_at: new Date().toISOString(),
    data_source: 'Open-Meteo'
  }
}

/**
 * Get weather formatted for travel website display
 */
export async function getWeatherForDisplay(): Promise<{
  today: {
    summary: string
    temperature: string
    conditions: string
    icon: string
  }
  forecast: Array<{
    day: string
    date: string
    high: string
    low: string
    conditions: string
    icon: string
    rain_chance: string
  }>
}> {
  const weather = await getCurrentWeatherAndForecast()

  return {
    today: {
      summary: `${weather.current.weather_description}. ${weather.current.temperature_c}°C (feels like ${weather.current.feels_like_c}°C)`,
      temperature: `${weather.current.temperature_c}°C / ${weather.current.temperature_f}°F`,
      conditions: weather.current.weather_description,
      icon: weather.current.icon
    },
    forecast: weather.forecast.map((day, i) => ({
      day: i === 0 ? 'Today' : day.day_of_week,
      date: day.date,
      high: `${day.temperature_max_c}°C`,
      low: `${day.temperature_min_c}°C`,
      conditions: day.weather_description,
      icon: day.icon,
      rain_chance: `${day.precipitation_probability_percent}%`
    }))
  }
}
