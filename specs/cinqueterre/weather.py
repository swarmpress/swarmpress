#!/usr/bin/env python3
"""
Riomaggiore Weather & Activity Recommendations Fetcher
=======================================================

Fetches comprehensive weather data, forecasts, and activity recommendations
for Riomaggiore, Cinque Terre, Italy.

Usage:
    python riomaggiore_weather_fetcher.py
    python riomaggiore_weather_fetcher.py --output-dir ./data
    python riomaggiore_weather_fetcher.py --model claude-opus-4-20250514

Requirements:
    pip install anthropic
"""

import anthropic
import json
import os
import sys
from datetime import datetime
from typing import Optional, Dict, Any
import argparse


# =============================================================================
# CONFIGURATION
# =============================================================================

DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_LOCATION = "Riomaggiore, Cinque Terre, Italy"
MAX_TOKENS = 35000
OUTPUT_FILENAME = "riomaggiore_weather.json"


# =============================================================================
# PROMPT
# =============================================================================

WEATHER_SEARCH_PROMPT = """
Search for comprehensive current weather conditions, extended forecast, and activity recommendations for Riomaggiore, Cinque Terre, Italy.
Include current conditions, hourly forecast, 7-day forecast, marine conditions, and personalized activity recommendations based on weather.
Return results as a valid JSON object.

## Required JSON Structure:

{
  "metadata": {
    "query_location": "Riomaggiore, Cinque Terre, Italy",
    "generated_at": "<ISO 8601 timestamp>",
    "search_type": "weather_and_recommendations",
    "data_sources": ["<source1>", "<source2>"],
    "timezone": "Europe/Rome",
    "coordinates": {
      "latitude": 44.0993,
      "longitude": 9.7380
    },
    "elevation_m": 35,
    "climate_zone": "Mediterranean"
  },
  
  "current_conditions": {
    "observation_time": "<ISO 8601 timestamp>",
    "weather_station": "<station name>",
    "summary": "<brief description e.g. 'Partly cloudy with light breeze'>",
    "icon": "<clear|partly-cloudy|cloudy|overcast|fog|drizzle|rain|heavy-rain|thunderstorm|snow|sleet|hail|windy>",
    
    "temperature": {
      "current_c": <float>,
      "current_f": <float>,
      "feels_like_c": <float>,
      "feels_like_f": <float>,
      "min_today_c": <float>,
      "max_today_c": <float>
    },
    
    "precipitation": {
      "is_precipitating": <boolean>,
      "type": "<none|drizzle|rain|heavy-rain|thunderstorm|snow|sleet|hail|null>",
      "intensity": "<none|light|moderate|heavy|null>",
      "probability_percent": <integer>,
      "amount_last_hour_mm": <float or null>,
      "amount_today_mm": <float>
    },
    
    "humidity": {
      "relative_percent": <integer>,
      "dew_point_c": <float>,
      "comfort_level": "<comfortable|slightly-humid|humid|very-humid|dry>"
    },
    
    "wind": {
      "speed_kmh": <float>,
      "speed_mph": <float>,
      "speed_knots": <float>,
      "gust_kmh": <float or null>,
      "direction_degrees": <integer>,
      "direction_cardinal": "<N|NE|E|SE|S|SW|W|NW>",
      "beaufort_scale": <integer 0-12>,
      "description": "<calm|light-breeze|gentle-breeze|moderate-breeze|fresh-breeze|strong-breeze|near-gale|gale|strong-gale|storm>"
    },
    
    "pressure": {
      "hpa": <float>,
      "inhg": <float>,
      "trend": "<rising|falling|steady>",
      "trend_description": "<string>"
    },
    
    "visibility": {
      "km": <float>,
      "miles": <float>,
      "description": "<excellent|good|moderate|poor|very-poor>"
    },
    
    "uv_index": {
      "value": <integer 0-11+>,
      "level": "<low|moderate|high|very-high|extreme>",
      "protection_required": <boolean>,
      "recommendation": "<string>"
    },
    
    "air_quality": {
      "aqi": <integer or null>,
      "level": "<good|moderate|unhealthy-sensitive|unhealthy|very-unhealthy|hazardous|null>",
      "dominant_pollutant": "<string or null>",
      "recommendation": "<string or null>"
    },
    
    "sun_moon": {
      "sunrise": "<HH:MM>",
      "sunset": "<HH:MM>",
      "daylight_hours": <float>,
      "golden_hour_morning": {"start": "<HH:MM>", "end": "<HH:MM>"},
      "golden_hour_evening": {"start": "<HH:MM>", "end": "<HH:MM>"},
      "blue_hour_morning": {"start": "<HH:MM>", "end": "<HH:MM>"},
      "blue_hour_evening": {"start": "<HH:MM>", "end": "<HH:MM>"},
      "moon_phase": "<new|waxing-crescent|first-quarter|waxing-gibbous|full|waning-gibbous|last-quarter|waning-crescent>",
      "moon_illumination_percent": <integer>,
      "moonrise": "<HH:MM or null>",
      "moonset": "<HH:MM or null>"
    },
    
    "comfort_indices": {
      "heat_index_c": <float or null>,
      "wind_chill_c": <float or null>,
      "outdoor_comfort": "<excellent|good|fair|poor|uncomfortable>",
      "outdoor_comfort_score": <integer 1-10>
    }
  },
  
  "hourly_forecast": {
    "generated_at": "<ISO 8601 timestamp>",
    "hours": [
      {
        "time": "<ISO 8601 timestamp>",
        "hour": "<HH:MM>",
        "is_daylight": <boolean>,
        "summary": "<brief description>",
        "icon": "<icon code>",
        "temperature_c": <float>,
        "feels_like_c": <float>,
        "precipitation": {
          "probability_percent": <integer>,
          "type": "<none|rain|snow|sleet|null>",
          "intensity": "<none|light|moderate|heavy|null>",
          "amount_mm": <float>
        },
        "humidity_percent": <integer>,
        "wind": {
          "speed_kmh": <float>,
          "gust_kmh": <float or null>,
          "direction_cardinal": "<string>"
        },
        "cloud_cover_percent": <integer>,
        "visibility_km": <float>,
        "uv_index": <integer>,
        "activity_suitability": {
          "hiking": "<excellent|good|fair|poor|not-recommended>",
          "swimming": "<excellent|good|fair|poor|not-recommended>",
          "photography": "<excellent|good|fair|poor>",
          "dining_outdoors": "<excellent|good|fair|poor|not-recommended>"
        }
      }
    ]
  },
  
  "daily_forecast": {
    "generated_at": "<ISO 8601 timestamp>",
    "days": [
      {
        "date": "<YYYY-MM-DD>",
        "day_of_week": "<Monday|Tuesday|...>",
        "is_today": <boolean>,
        "summary": "<brief description of the day>",
        "detailed_description": "<longer description including any notable weather events>",
        "icon": "<icon code>",
        
        "temperature": {
          "high_c": <float>,
          "high_f": <float>,
          "low_c": <float>,
          "low_f": <float>,
          "feels_like_high_c": <float>,
          "feels_like_low_c": <float>
        },
        
        "precipitation": {
          "probability_percent": <integer>,
          "type": "<none|rain|snow|mixed|null>",
          "total_mm": <float>,
          "hours_of_precipitation": <integer>,
          "thunderstorm_risk": <boolean>,
          "timing": "<morning|afternoon|evening|night|all-day|intermittent|null>"
        },
        
        "humidity": {
          "average_percent": <integer>,
          "morning_percent": <integer>,
          "afternoon_percent": <integer>
        },
        
        "wind": {
          "avg_speed_kmh": <float>,
          "max_gust_kmh": <float>,
          "direction_cardinal": "<string>",
          "description": "<string>"
        },
        
        "sun": {
          "sunrise": "<HH:MM>",
          "sunset": "<HH:MM>",
          "daylight_hours": <float>,
          "uv_index_max": <integer>,
          "uv_level": "<low|moderate|high|very-high|extreme>"
        },
        
        "comfort": {
          "overall_rating": "<excellent|good|fair|poor|uncomfortable>",
          "morning_comfort": "<string>",
          "afternoon_comfort": "<string>",
          "evening_comfort": "<string>"
        },
        
        "activity_ratings": {
          "hiking": {
            "rating": "<excellent|good|fair|poor|not-recommended>",
            "score": <integer 1-10>,
            "best_time": "<morning|midday|afternoon|evening|avoid>",
            "notes": "<string>"
          },
          "swimming_beach": {
            "rating": "<excellent|good|fair|poor|not-recommended>",
            "score": <integer 1-10>,
            "best_time": "<string>",
            "notes": "<string>"
          },
          "boat_tour": {
            "rating": "<excellent|good|fair|poor|not-recommended>",
            "score": <integer 1-10>,
            "sea_conditions": "<calm|slight|moderate|rough>",
            "notes": "<string>"
          },
          "photography": {
            "rating": "<excellent|good|fair|poor>",
            "score": <integer 1-10>,
            "best_time": "<string>",
            "lighting_conditions": "<string>",
            "notes": "<string>"
          },
          "village_exploration": {
            "rating": "<excellent|good|fair|poor>",
            "score": <integer 1-10>,
            "best_time": "<string>",
            "notes": "<string>"
          },
          "outdoor_dining": {
            "rating": "<excellent|good|fair|poor|not-recommended>",
            "score": <integer 1-10>,
            "best_time": "<lunch|dinner|both|avoid>",
            "notes": "<string>"
          },
          "wine_tasting": {
            "rating": "<excellent|good|fair|poor>",
            "score": <integer 1-10>,
            "notes": "<string>"
          },
          "train_travel": {
            "rating": "<excellent|good|fair|poor>",
            "score": <integer 1-10>,
            "notes": "<string>"
          },
          "ferry_travel": {
            "rating": "<excellent|good|fair|poor|not-recommended|cancelled>",
            "score": <integer 1-10>,
            "sea_conditions": "<string>",
            "notes": "<string>"
          }
        },
        
        "alerts": [
          {
            "type": "<heat|cold|wind|rain|thunderstorm|fog|uv|air-quality|sea-conditions>",
            "severity": "<advisory|watch|warning>",
            "message": "<string>",
            "recommendation": "<string>"
          }
        ],
        
        "clothing_recommendation": {
          "morning": ["<item1>", "<item2>"],
          "afternoon": ["<item1>", "<item2>"],
          "evening": ["<item1>", "<item2>"],
          "essentials": ["<item1>", "<item2>"]
        },
        
        "packing_suggestions": ["<suggestion1>", "<suggestion2>"]
      }
    ]
  },
  
  "marine_conditions": {
    "observation_time": "<ISO 8601 timestamp>",
    "data_source": "<string>",
    
    "sea_state": {
      "description": "<calm|smooth|slight|moderate|rough|very-rough|high|very-high|phenomenal>",
      "beaufort_sea_scale": <integer 0-9>,
      "wave_height_m": <float>,
      "wave_period_seconds": <float>,
      "wave_direction": "<string>",
      "swell_height_m": <float or null>,
      "swell_direction": "<string or null>"
    },
    
    "water_temperature": {
      "surface_c": <float>,
      "surface_f": <float>,
      "swimming_comfort": "<cold|cool|refreshing|comfortable|warm>",
      "wetsuit_recommendation": "<not-needed|optional|recommended|required>"
    },
    
    "tides": {
      "tidal_range": "<micro|meso|macro>",
      "next_high_tide": {"time": "<HH:MM>", "height_m": <float>},
      "next_low_tide": {"time": "<HH:MM>", "height_m": <float>},
      "current_tide_status": "<rising|falling|high|low>",
      "tide_table_today": [
        {"type": "<high|low>", "time": "<HH:MM>", "height_m": <float>}
      ]
    },
    
    "currents": {
      "strength": "<weak|moderate|strong>",
      "direction": "<string>",
      "swimming_advisory": "<safe|caution|dangerous>"
    },
    
    "visibility_underwater": {
      "estimated_m": <float or null>,
      "conditions": "<excellent|good|moderate|poor|null>",
      "snorkeling_rating": "<excellent|good|fair|poor|not-recommended>"
    },
    
    "ferry_boat_conditions": {
      "overall_status": "<excellent|good|fair|poor|service-at-risk|cancelled>",
      "seasickness_risk": "<low|moderate|high|very-high>",
      "recommendation": "<string>"
    },
    
    "beach_conditions": {
      "swimming_safety": "<safe|caution|not-recommended|dangerous>",
      "jellyfish_risk": "<low|moderate|high|null>",
      "water_quality": "<excellent|good|moderate|poor|null>",
      "best_beaches_today": ["<beach1>", "<beach2>"]
    },
    
    "water_activities": {
      "swimming": {
        "recommended": <boolean>,
        "rating": "<excellent|good|fair|poor|not-recommended>",
        "notes": "<string>"
      },
      "snorkeling": {
        "recommended": <boolean>,
        "rating": "<excellent|good|fair|poor|not-recommended>",
        "notes": "<string>"
      },
      "diving": {
        "recommended": <boolean>,
        "rating": "<excellent|good|fair|poor|not-recommended>",
        "notes": "<string>"
      },
      "kayaking": {
        "recommended": <boolean>,
        "rating": "<excellent|good|fair|poor|not-recommended>",
        "notes": "<string>"
      },
      "sup": {
        "recommended": <boolean>,
        "rating": "<excellent|good|fair|poor|not-recommended>",
        "notes": "<string>"
      },
      "boat_rental": {
        "recommended": <boolean>,
        "rating": "<excellent|good|fair|poor|not-recommended>",
        "notes": "<string>"
      }
    }
  },
  
  "weather_alerts": {
    "active_alerts": [
      {
        "id": "<string>",
        "type": "<thunderstorm|heavy-rain|flooding|high-wind|heat|cold|fog|air-quality|uv|marine|wildfire>",
        "severity": "<minor|moderate|severe|extreme>",
        "urgency": "<immediate|expected|future>",
        "certainty": "<observed|likely|possible>",
        "headline": "<string>",
        "description": "<string>",
        "instruction": "<string>",
        "issued_at": "<ISO 8601 timestamp>",
        "expires_at": "<ISO 8601 timestamp>",
        "affected_areas": ["<area1>", "<area2>"],
        "source": "<string>"
      }
    ],
    "no_alerts": <boolean>,
    "last_checked": "<ISO 8601 timestamp>"
  },
  
  "activity_recommendations": {
    "generated_for_date": "<YYYY-MM-DD>",
    
    "todays_top_recommendations": [
      {
        "rank": <integer 1-5>,
        "activity": "<string>",
        "category": "<outdoor|water|cultural|culinary|relaxation|adventure>",
        "weather_suitability_score": <integer 1-10>,
        "best_time_window": {"start": "<HH:MM>", "end": "<HH:MM>"},
        "reason": "<string explaining why this is recommended today>",
        "weather_considerations": "<string>",
        "what_to_bring": ["<item1>", "<item2>"],
        "alternatives_if_weather_changes": ["<alternative1>", "<alternative2>"],
        "booking_required": <boolean>,
        "estimated_duration_hours": <float>,
        "physical_intensity": "<low|moderate|high>"
      }
    ],
    
    "activities_by_time_of_day": {
      "early_morning": {
        "time_window": "06:00-09:00",
        "weather_summary": "<string>",
        "recommended_activities": [
          {
            "activity": "<string>",
            "suitability": "<excellent|good|fair>",
            "notes": "<string>"
          }
        ],
        "not_recommended": ["<activity1>", "<activity2>"]
      },
      "morning": {
        "time_window": "09:00-12:00",
        "weather_summary": "<string>",
        "recommended_activities": [
          {"activity": "<string>", "suitability": "<string>", "notes": "<string>"}
        ],
        "not_recommended": ["<activity1>"]
      },
      "afternoon": {
        "time_window": "12:00-17:00",
        "weather_summary": "<string>",
        "recommended_activities": [
          {"activity": "<string>", "suitability": "<string>", "notes": "<string>"}
        ],
        "not_recommended": ["<activity1>"]
      },
      "evening": {
        "time_window": "17:00-21:00",
        "weather_summary": "<string>",
        "recommended_activities": [
          {"activity": "<string>", "suitability": "<string>", "notes": "<string>"}
        ],
        "not_recommended": ["<activity1>"]
      },
      "night": {
        "time_window": "21:00-00:00",
        "weather_summary": "<string>",
        "recommended_activities": [
          {"activity": "<string>", "suitability": "<string>", "notes": "<string>"}
        ]
      }
    },
    
    "hiking_recommendations": {
      "overall_hiking_conditions": "<excellent|good|fair|poor|not-recommended>",
      "trail_conditions": {
        "via_dell_amore": {
          "status": "<open|partially-open|closed>",
          "weather_suitability": "<excellent|good|fair|poor|dangerous>",
          "recommended_today": <boolean>,
          "best_time": "<string>",
          "hazards": ["<hazard1>", "<hazard2>"],
          "notes": "<string>"
        },
        "sentiero_azzurro": {
          "status": "<open|partially-open|closed>",
          "weather_suitability": "<excellent|good|fair|poor|dangerous>",
          "recommended_today": <boolean>,
          "best_time": "<string>",
          "difficulty_increase_due_to_weather": <boolean>,
          "specific_section_recommendations": [
            {"section": "<Riomaggiore to Manarola>", "rating": "<string>", "notes": "<string>"},
            {"section": "<Manarola to Corniglia>", "rating": "<string>", "notes": "<string>"},
            {"section": "<Corniglia to Vernazza>", "rating": "<string>", "notes": "<string>"},
            {"section": "<Vernazza to Monterosso>", "rating": "<string>", "notes": "<string>"}
          ]
        },
        "sanctuary_trails": {
          "weather_suitability": "<excellent|good|fair|poor|dangerous>",
          "recommended_today": <boolean>,
          "notes": "<string>"
        }
      },
      "hiking_gear_recommendations": {
        "footwear": "<string>",
        "clothing_layers": ["<layer1>", "<layer2>"],
        "essential_items": ["<item1>", "<item2>", "<item3>"],
        "hydration_recommendation": "<string>",
        "sun_protection": "<string>"
      },
      "safety_considerations": ["<consideration1>", "<consideration2>"]
    },
    
    "photography_recommendations": {
      "overall_conditions": "<excellent|good|fair|poor>",
      "lighting_quality": "<harsh|bright|soft|dramatic|flat|golden>",
      "best_times": [
        {
          "time_window": "<HH:MM - HH:MM>",
          "type": "<golden-hour|blue-hour|midday|sunset|night>",
          "quality_rating": "<excellent|good|fair>",
          "recommended_subjects": ["<subject1>", "<subject2>"],
          "recommended_locations": ["<location1>", "<location2>"]
        }
      ],
      "weather_impact_on_photos": "<string>",
      "gear_recommendations": ["<recommendation1>", "<recommendation2>"],
      "tips": ["<tip1>", "<tip2>"]
    },
    
    "indoor_alternatives": {
      "recommended_when": "<string describing weather conditions>",
      "activities": [
        {
          "name": "<string>",
          "type": "<museum|restaurant|wine-tasting|cooking-class|spa|shopping>",
          "location": "<string>",
          "why_recommended": "<string>",
          "duration_hours": <float>,
          "booking_required": <boolean>
        }
      ]
    },
    
    "weather_dependent_warnings": [
      {
        "activity": "<string>",
        "current_status": "<go|caution|no-go>",
        "reason": "<string>",
        "expected_change": "<string or null>",
        "alternative": "<string>"
      }
    ]
  },
  
  "packing_and_preparation": {
    "for_date_range": "<YYYY-MM-DD to YYYY-MM-DD>",
    
    "essential_items": {
      "always_bring": ["<item1>", "<item2>", "<item3>"],
      "weather_specific": ["<item1>", "<item2>"],
      "activity_specific": {
        "hiking": ["<item1>", "<item2>"],
        "beach": ["<item1>", "<item2>"],
        "photography": ["<item1>", "<item2>"]
      }
    },
    
    "clothing_guide": {
      "daytime": {
        "temperature_range": "<X°C - Y°C>",
        "recommendations": ["<item1>", "<item2>", "<item3>"],
        "layering_advice": "<string>"
      },
      "evening": {
        "temperature_range": "<X°C - Y°C>",
        "recommendations": ["<item1>", "<item2>"],
        "notes": "<string>"
      },
      "rain_gear": {
        "needed": <boolean>,
        "probability": "<low|medium|high>",
        "recommendations": ["<item1>", "<item2>"]
      },
      "sun_protection": {
        "needed": <boolean>,
        "uv_level": "<string>",
        "recommendations": ["<item1>", "<item2>"]
      },
      "footwear": {
        "primary": "<string>",
        "alternatives": ["<string1>", "<string2>"],
        "notes": "<string>"
      }
    },
    
    "health_and_safety": {
      "hydration": {
        "recommendation": "<string>",
        "water_intake_liters": <float>
      },
      "sun_exposure": {
        "risk_level": "<low|moderate|high|very-high>",
        "peak_hours_to_avoid": "<HH:MM - HH:MM>",
        "spf_recommendation": <integer>
      },
      "heat_safety": {
        "concern_level": "<none|low|moderate|high>",
        "recommendations": ["<recommendation1>", "<recommendation2>"]
      }
    }
  },
  
  "seasonal_context": {
    "current_season": "<spring|summer|fall|winter>",
    "season_description": "<string describing typical weather for this time of year>",
    "is_typical_weather": <boolean>,
    "comparison_to_average": {
      "temperature": "<above-average|average|below-average>",
      "precipitation": "<above-average|average|below-average>",
      "notes": "<string>"
    },
    "tourist_season": "<low|shoulder|high|peak>",
    "crowd_expectations": "<string>",
    "seasonal_events": [
      {"name": "<string>", "date": "<string>", "weather_dependent": <boolean>}
    ],
    "seasonal_activities": {
      "best_activities_this_season": ["<activity1>", "<activity2>"],
      "activities_to_avoid": ["<activity1>"],
      "seasonal_highlights": ["<highlight1>", "<highlight2>"]
    }
  },
  
  "historical_context": {
    "climate_averages": {
      "month": "<current month>",
      "avg_high_c": <float>,
      "avg_low_c": <float>,
      "avg_precipitation_mm": <float>,
      "avg_rainy_days": <integer>,
      "avg_sunshine_hours": <float>,
      "sea_temperature_avg_c": <float>
    },
    "records": {
      "record_high_c": <float>,
      "record_low_c": <float>,
      "record_rainfall_mm": <float>
    }
  },
  
  "forecast_confidence": {
    "today": {"confidence": "<high|medium|low>", "notes": "<string>"},
    "tomorrow": {"confidence": "<high|medium|low>", "notes": "<string>"},
    "days_3_5": {"confidence": "<high|medium|low>", "notes": "<string>"},
    "days_6_7": {"confidence": "<high|medium|low>", "notes": "<string>"},
    "last_updated": "<ISO 8601 timestamp>",
    "next_update": "<ISO 8601 timestamp>"
  },
  
  "useful_links": {
    "official_weather": "https://www.meteo.it",
    "marine_forecast": "https://www.mareografico.it",
    "trail_conditions": "https://www.parconazionale5terre.it",
    "ferry_status": "https://www.navigazionegolfodeipoeti.it",
    "emergency_services": "112"
  }
}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Search for CURRENT, REAL-TIME weather data from reliable sources (weather.com, accuweather, meteo.it, etc.)
3. Include at least 24 hours of hourly forecast
4. Include 7 days of daily forecast
5. Provide SPECIFIC activity recommendations based on actual weather conditions
6. Include marine/sea conditions (important for ferries, swimming, boat tours)
7. Rate activities with scores 1-10 and clear recommendations
8. Include practical packing and clothing suggestions
9. Note any weather alerts or warnings
10. Provide hiking trail recommendations considering weather impact
11. Include photography timing recommendations (golden hour, blue hour)
12. All temperatures in both Celsius and Fahrenheit
13. All times in 24-hour HH:MM format in Europe/Rome timezone
14. Use null for unavailable data, not empty strings
15. Consider the impact of weather on ferry services (they cancel in rough seas)
16. Include UV index and sun protection recommendations
17. Provide indoor alternatives for bad weather days
"""


# =============================================================================
# CORE FUNCTIONS
# =============================================================================

def create_client() -> anthropic.Anthropic:
    """Create and return an Anthropic client."""
    return anthropic.Anthropic()


def fetch_weather_data(
    client: anthropic.Anthropic,
    model: str = DEFAULT_MODEL,
    verbose: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Fetch weather data using the Anthropic API.
    
    Args:
        client: Anthropic client instance
        model: Model to use for the API call
        verbose: Whether to print progress messages
        
    Returns:
        Parsed JSON data or None if failed
    """
    if verbose:
        print(f"\n{'='*60}")
        print("Fetching Weather & Activity Recommendations...")
        print(f"{'='*60}")
        print(f"Location: {DEFAULT_LOCATION}")
        print(f"Model: {model}")
    
    try:
        message = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": WEATHER_SEARCH_PROMPT}],
            tools=[{"type": "web_search"}]
        )
        
        # Extract text content from response
        response_text = ""
        for block in message.content:
            if hasattr(block, 'text'):
                response_text += block.text
        
        # Parse JSON from response
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        
        if json_start != -1 and json_end > json_start:
            json_str = response_text[json_start:json_end]
            data = json.loads(json_str)
            
            if verbose:
                print("✓ Successfully parsed weather data")
            
            return data
        else:
            if verbose:
                print("✗ No JSON object found in response")
            return None
            
    except json.JSONDecodeError as e:
        if verbose:
            print(f"✗ JSON parsing error: {e}")
        return None
    except anthropic.APIError as e:
        if verbose:
            print(f"✗ API error: {e}")
        return None
    except Exception as e:
        if verbose:
            print(f"✗ Unexpected error: {e}")
        return None


def validate_data(data: Dict[str, Any]) -> bool:
    """
    Validate the structure of fetched data.
    
    Args:
        data: The data to validate
        
    Returns:
        True if valid, False otherwise
    """
    if not data:
        return False
    
    required_fields = ['metadata', 'current_conditions']
    for field in required_fields:
        if field not in data:
            print(f"  Warning: Missing '{field}' field")
            return False
    
    return True


def save_data(
    data: Dict[str, Any],
    output_dir: str,
    verbose: bool = True
) -> Optional[str]:
    """
    Save data to a JSON file.
    
    Args:
        data: The data to save
        output_dir: Directory to save the file
        verbose: Whether to print progress messages
        
    Returns:
        Path to saved file or None if failed
    """
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, OUTPUT_FILENAME)
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        if verbose:
            print(f"✓ Saved to {filepath}")
        
        return filepath
    except IOError as e:
        if verbose:
            print(f"✗ Error saving file: {e}")
        return None


def print_summary(data: Dict[str, Any]):
    """Print a summary of the fetched weather data."""
    print(f"\n{'='*60}")
    print("WEATHER & ACTIVITY RECOMMENDATIONS SUMMARY")
    print(f"{'='*60}")
    
    # Metadata
    metadata = data.get('metadata', {})
    print(f"Generated at: {metadata.get('generated_at', 'N/A')}")
    print(f"Location: {metadata.get('query_location', 'N/A')}")
    
    # Current conditions
    current = data.get('current_conditions', {})
    if current:
        print(f"\n{'-'*50}")
        print("CURRENT CONDITIONS:")
        print(f"{'-'*50}")
        print(f"  Summary: {current.get('summary', 'N/A')}")
        
        temp = current.get('temperature', {})
        print(f"  Temperature: {temp.get('current_c', 'N/A')}°C ({temp.get('current_f', 'N/A')}°F)")
        print(f"  Feels like: {temp.get('feels_like_c', 'N/A')}°C")
        
        wind = current.get('wind', {})
        print(f"  Wind: {wind.get('speed_kmh', 'N/A')} km/h {wind.get('direction_cardinal', '')}")
        
        humidity = current.get('humidity', {})
        print(f"  Humidity: {humidity.get('relative_percent', 'N/A')}%")
        
        uv = current.get('uv_index', {})
        print(f"  UV Index: {uv.get('value', 'N/A')} ({uv.get('level', 'N/A')})")
        
        sun = current.get('sun_moon', {})
        print(f"  Sunrise/Sunset: {sun.get('sunrise', 'N/A')} / {sun.get('sunset', 'N/A')}")
    
    # Daily forecast summary
    daily = data.get('daily_forecast', {}).get('days', [])
    if daily:
        print(f"\n{'-'*50}")
        print("7-DAY FORECAST:")
        print(f"{'-'*50}")
        for day in daily[:7]:
            date = day.get('date', 'N/A')
            dow = day.get('day_of_week', '')[:3]
            summary = day.get('summary', 'N/A')[:40]
            high = day.get('temperature', {}).get('high_c', 'N/A')
            low = day.get('temperature', {}).get('low_c', 'N/A')
            precip = day.get('precipitation', {}).get('probability_percent', 0)
            today = " (TODAY)" if day.get('is_today') else ""
            print(f"  {dow} {date}{today}: {low}°-{high}°C, {precip}% rain - {summary}")
    
    # Marine conditions
    marine = data.get('marine_conditions', {})
    if marine:
        print(f"\n{'-'*50}")
        print("MARINE CONDITIONS:")
        print(f"{'-'*50}")
        sea = marine.get('sea_state', {})
        print(f"  Sea State: {sea.get('description', 'N/A')}")
        print(f"  Wave Height: {sea.get('wave_height_m', 'N/A')}m")
        
        water_temp = marine.get('water_temperature', {})
        print(f"  Water Temp: {water_temp.get('surface_c', 'N/A')}°C ({water_temp.get('swimming_comfort', 'N/A')})")
        
        ferry = marine.get('ferry_boat_conditions', {})
        print(f"  Ferry Status: {ferry.get('overall_status', 'N/A')}")
    
    # Today's top recommendations
    recommendations = data.get('activity_recommendations', {})
    top_recs = recommendations.get('todays_top_recommendations', [])
    if top_recs:
        print(f"\n{'-'*50}")
        print("TODAY'S TOP ACTIVITY RECOMMENDATIONS:")
        print(f"{'-'*50}")
        for rec in top_recs[:5]:
            rank = rec.get('rank', '?')
            activity = rec.get('activity', 'Unknown')
            score = rec.get('weather_suitability_score', 'N/A')
            best_time = rec.get('best_time_window', {})
            time_str = f"{best_time.get('start', '')} - {best_time.get('end', '')}" if best_time else "N/A"
            print(f"  #{rank}: {activity}")
            print(f"       Score: {score}/10 | Best Time: {time_str}")
            reason = rec.get('reason', '')
            if reason:
                print(f"       {reason[:70]}...")
    
    # Hiking conditions
    hiking = recommendations.get('hiking_recommendations', {})
    if hiking:
        print(f"\n{'-'*50}")
        print("HIKING CONDITIONS:")
        print(f"{'-'*50}")
        print(f"  Overall: {hiking.get('overall_hiking_conditions', 'N/A')}")
        trails = hiking.get('trail_conditions', {})
        via_amore = trails.get('via_dell_amore', {})
        if via_amore:
            print(f"  Via dell'Amore: {via_amore.get('status', 'N/A')} - {via_amore.get('weather_suitability', 'N/A')}")
        azzurro = trails.get('sentiero_azzurro', {})
        if azzurro:
            print(f"  Sentiero Azzurro: {azzurro.get('status', 'N/A')} - {azzurro.get('weather_suitability', 'N/A')}")
    
    # Weather alerts
    alerts = data.get('weather_alerts', {})
    active = alerts.get('active_alerts', [])
    if active:
        print(f"\n{'-'*50}")
        print("⚠️  WEATHER ALERTS:")
        print(f"{'-'*50}")
        for alert in active:
            print(f"  [{alert.get('severity', 'N/A').upper()}] {alert.get('headline', 'N/A')}")
    elif alerts.get('no_alerts'):
        print(f"\n  ✓ No active weather alerts")
    
    # Packing essentials
    packing = data.get('packing_and_preparation', {})
    essentials = packing.get('essential_items', {}).get('always_bring', [])
    if essentials:
        print(f"\n{'-'*50}")
        print("PACKING ESSENTIALS:")
        print(f"{'-'*50}")
        print(f"  {', '.join(essentials[:6])}")
    
    # Clothing
    clothing = packing.get('clothing_guide', {})
    daytime = clothing.get('daytime', {}).get('recommendations', [])
    if daytime:
        print(f"\n  Daytime Clothing: {', '.join(daytime[:4])}")


# =============================================================================
# CLI
# =============================================================================

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Fetch weather and activity recommendations for Riomaggiore, Cinque Terre",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python riomaggiore_weather_fetcher.py
    python riomaggiore_weather_fetcher.py --output-dir ./weather_data
    python riomaggiore_weather_fetcher.py --quiet

Output:
    Creates riomaggiore_weather.json with:
    - Current weather conditions
    - 24-hour hourly forecast
    - 7-day daily forecast
    - Marine/sea conditions
    - Activity recommendations based on weather
    - Hiking trail conditions
    - Photography timing recommendations
    - Packing and clothing suggestions
    - Weather alerts and warnings
        """
    )
    
    parser.add_argument(
        "--output-dir", "-o",
        default="./riomaggiore_data",
        help="Output directory for JSON file (default: ./riomaggiore_data)"
    )
    
    parser.add_argument(
        "--model", "-m",
        default=DEFAULT_MODEL,
        help=f"Anthropic model to use (default: {DEFAULT_MODEL})"
    )
    
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress progress messages"
    )
    
    parser.add_argument(
        "--version", "-v",
        action="version",
        version="%(prog)s 1.0.0"
    )
    
    return parser.parse_args()


def main():
    """Main entry point."""
    args = parse_args()
    verbose = not args.quiet
    
    # Create client
    try:
        client = create_client()
    except Exception as e:
        print(f"Error: Failed to create Anthropic client: {e}")
        print("Make sure ANTHROPIC_API_KEY environment variable is set.")
        sys.exit(1)
    
    # Fetch data
    data = fetch_weather_data(client, args.model, verbose)
    
    if data and validate_data(data):
        # Save data
        filepath = save_data(data, args.output_dir, verbose)
        
        if filepath and verbose:
            print_summary(data)
            
            # Final summary
            print(f"\n{'='*60}")
            print(f"✓ Weather data saved successfully")
            print(f"  File: {filepath}")
            print(f"{'='*60}")
        
        sys.exit(0)
    else:
        print("\n✗ Failed to fetch or validate weather data")
        sys.exit(1)


if __name__ == "__main__":
    main()