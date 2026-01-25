import React, { useEffect, useState } from 'react';
import { CloudSun, Sun, CloudRain, Cloud, Snowflake, CloudLightning, Loader2, AlertCircle } from 'lucide-react';

// Cinque Terre coordinates (Monterosso al Mare as center point)
const CINQUE_TERRE_COORDS = {
  latitude: 44.1448,
  longitude: 9.6526
};

// Weather code to icon mapping (WMO codes)
const WEATHER_ICONS: Record<number, React.ComponentType<{ className?: string }>> = {
  0: Sun,        // Clear sky
  1: Sun,        // Mainly clear
  2: CloudSun,   // Partly cloudy
  3: Cloud,      // Overcast
  45: Cloud,     // Fog
  48: Cloud,     // Depositing rime fog
  51: CloudRain, // Light drizzle
  53: CloudRain, // Moderate drizzle
  55: CloudRain, // Dense drizzle
  61: CloudRain, // Slight rain
  63: CloudRain, // Moderate rain
  65: CloudRain, // Heavy rain
  71: Snowflake, // Slight snow
  73: Snowflake, // Moderate snow
  75: Snowflake, // Heavy snow
  80: CloudRain, // Slight rain showers
  81: CloudRain, // Moderate rain showers
  82: CloudRain, // Violent rain showers
  95: CloudLightning, // Thunderstorm
  96: CloudLightning, // Thunderstorm with slight hail
  99: CloudLightning, // Thunderstorm with heavy hail
};

interface WeatherData {
  current: {
    temperature: number;
    weatherCode: number;
  };
  forecast: Array<{
    date: string;
    dayName: string;
    maxTemp: number;
    weatherCode: number;
  }>;
}

function getDayName(dateStr: string, index: number): string {
  if (index === 0) return 'Today';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[new Date(dateStr).getDay()];
}

function getWeatherIcon(code: number): React.ComponentType<{ className?: string }> {
  return WEATHER_ICONS[code] || CloudSun;
}

export default function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWeather() {
      try {
        setLoading(true);
        setError(null);

        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', CINQUE_TERRE_COORDS.latitude.toString());
        url.searchParams.set('longitude', CINQUE_TERRE_COORDS.longitude.toString());
        url.searchParams.set('current', 'temperature_2m,weather_code');
        url.searchParams.set('daily', 'weather_code,temperature_2m_max');
        url.searchParams.set('timezone', 'Europe/Rome');
        url.searchParams.set('forecast_days', '4');

        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error('Failed to fetch weather data');
        }

        const data = await response.json();

        setWeather({
          current: {
            temperature: Math.round(data.current.temperature_2m),
            weatherCode: data.current.weather_code,
          },
          forecast: data.daily.time.slice(0, 3).map((date: string, i: number) => ({
            date,
            dayName: getDayName(date, i),
            maxTemp: Math.round(data.daily.temperature_2m_max[i]),
            weatherCode: data.daily.weather_code[i],
          })),
        });
      } catch (err) {
        console.error('Weather fetch error:', err);
        setError('Unable to load weather');
      } finally {
        setLoading(false);
      }
    }

    fetchWeather();

    // Refresh every 15 minutes
    const interval = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-8 md:bottom-8 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 shadow-lg text-white max-w-[200px] w-full hidden md:block">
        <div className="flex items-center justify-center gap-2 py-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm opacity-80">Loading...</span>
        </div>
      </div>
    );
  }

  // Error state - show fallback static data
  if (error || !weather) {
    return (
      <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-8 md:bottom-8 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 shadow-lg text-white max-w-[200px] w-full hidden md:block">
        <div className="flex items-center gap-2 text-amber-200">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs">Weather unavailable</span>
        </div>
      </div>
    );
  }

  const CurrentIcon = getWeatherIcon(weather.current.weatherCode);

  return (
    <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-8 md:bottom-8 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 shadow-lg text-white max-w-[200px] w-full hidden md:block">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CurrentIcon className="h-6 w-6" />
          <span className="text-lg font-semibold">{weather.current.temperature}°C</span>
        </div>
        <span className="text-xs opacity-80">Monterosso</span>
      </div>
      <div className="flex justify-between text-sm opacity-90 border-t border-white/10 pt-2">
        {weather.forecast.map((day, i) => {
          const DayIcon = getWeatherIcon(day.weatherCode);
          return (
            <div key={day.date} className="flex flex-col items-center">
              <span className="text-[10px] mb-1">{day.dayName}</span>
              <DayIcon className="h-3 w-3 mb-1" />
              <span className="text-xs">{day.maxTemp}°</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
