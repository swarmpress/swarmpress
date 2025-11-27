#!/usr/bin/env python3
"""
Riomaggiore Transportation Data Fetcher
========================================

Fetches comprehensive transportation data for Riomaggiore, Cinque Terre, Italy.
Includes trains, ferries, buses, taxis, parking, walking paths, and rentals.

Usage:
    python riomaggiore_transportation_fetcher.py
    python riomaggiore_transportation_fetcher.py --output-dir ./data
    python riomaggiore_transportation_fetcher.py --model claude-opus-4-20250514

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
MAX_TOKENS = 40000
OUTPUT_FILENAME = "riomaggiore_transportation.json"


# =============================================================================
# PROMPT
# =============================================================================

TRANSPORTATION_SEARCH_PROMPT = """
Search for all transportation options to, from, and within Riomaggiore, Cinque Terre, Italy.
Include trains, ferries/boats, buses, taxis, car services, parking, rentals, and walking paths.
Return results as a valid JSON object.

## Required JSON Structure:

{
  "metadata": {
    "query_location": "Riomaggiore, Cinque Terre, Italy",
    "generated_at": "<ISO 8601 timestamp>",
    "total_results": <integer>,
    "search_type": "transportation",
    "last_schedule_update": "<YYYY-MM-DD>",
    "currency": "EUR",
    "categories_included": ["Train", "Ferry", "Bus", "Taxi", "Car Service", "Parking", "Bike Rental", "Boat Rental", "Walking Path", "Water Taxi"]
  },
  
  "hub_information": {
    "primary_hub": {
      "name": "<station/terminal name>",
      "name_local": "<Italian name>",
      "type": "<Train Station|Ferry Terminal>",
      "address": "<full address>",
      "coordinates": {"latitude": <float>, "longitude": <float>},
      "facilities": {
        "ticket_office": <boolean>,
        "ticket_machines": <boolean>,
        "waiting_room": <boolean>,
        "restrooms": <boolean>,
        "luggage_storage": <boolean>,
        "wifi": <boolean>,
        "atm": <boolean>,
        "accessibility": {
          "wheelchair_accessible": <boolean>,
          "elevator": <boolean>,
          "ramps": <boolean>,
          "accessibility_notes": "<string>"
        }
      },
      "operating_hours": {
        "ticket_office": {
          "monday": {"open": "<HH:MM>", "close": "<HH:MM>"},
          "tuesday": {"open": "<HH:MM>", "close": "<HH:MM>"},
          "wednesday": {"open": "<HH:MM>", "close": "<HH:MM>"},
          "thursday": {"open": "<HH:MM>", "close": "<HH:MM>"},
          "friday": {"open": "<HH:MM>", "close": "<HH:MM>"},
          "saturday": {"open": "<HH:MM>", "close": "<HH:MM>"},
          "sunday": {"open": "<HH:MM>", "close": "<HH:MM>"}
        },
        "station_access": "<24/7 or hours>"
      },
      "contact": {"phone": "<phone>", "website": "<url>"}
    },
    "secondary_hubs": [
      {"name": "<string>", "type": "<string>", "distance_km": <float>, "travel_time_minutes": <int>, "connection_type": "<string>", "notes": "<string>"}
    ]
  },
  
  "transportation_options": [
    {
      "id": "<unique-id>",
      "rank": <integer>,
      "name": "<string>",
      "name_local": "<Italian name>",
      "slug": "<lowercase-hyphenated>",
      
      "category": {
        "primary": "<Train|Ferry|Bus|Taxi|Car Service|Walking Path|Water Taxi|Boat Rental|Bike Rental>",
        "secondary": "<sub-category>",
        "tags": ["<tag1>", "<tag2>"]
      },
      
      "operator": {
        "name": "<operator name>",
        "name_local": "<Italian name or null>",
        "type": "<National Rail Operator|Ferry Company|Private|Municipal>",
        "website": "<url>",
        "app": {"name": "<string>", "ios_url": "<url>", "android_url": "<url>"},
        "customer_service": {"phone": "<phone>", "email": "<email or null>", "hours": "<string>"},
        "social_media": {"twitter": "<handle or null>", "facebook": "<handle or null>"}
      },
      
      "routes": [
        {
          "route_id": "<string>",
          "route_name": "<string>",
          "route_name_local": "<Italian name or null>",
          "line_number": "<string or null>",
          "route_type": "<Regional|Express|Local>",
          "origin": "<string>",
          "destination": "<string>",
          "via_stops": ["<stop1>", "<stop2>"],
          "direction": "<Both|One-way>",
          "total_stops": <integer>,
          "total_distance_km": <float>,
          "total_duration_minutes": <integer>,
          "scenic_rating": <integer 1-5 or null>,
          "scenic_highlights": ["<highlight1>", "<highlight2>"]
        }
      ],
      
      "stops_serving_riomaggiore": [
        {
          "stop_name": "<string>",
          "stop_type": "<Station|Dock|Stop>",
          "platform_count": <integer or null>,
          "coordinates": {"latitude": <float>, "longitude": <float>},
          "zone": "<string>",
          "staffed": <boolean>,
          "announcements": <boolean>,
          "display_boards": <boolean>
        }
      ],
      
      "schedule": {
        "frequency": {
          "peak_hours": {"trains_per_hour": <int>, "interval_minutes": <int>},
          "off_peak": {"trains_per_hour": <int>, "interval_minutes": <int>},
          "weekend": {"trains_per_hour": <int>, "interval_minutes": <int>}
        },
        "service_hours": {
          "first_train_from_la_spezia": "<HH:MM>",
          "last_train_from_la_spezia": "<HH:MM>",
          "first_train_to_la_spezia": "<HH:MM>",
          "last_train_to_la_spezia": "<HH:MM>",
          "first_train_to_monterosso": "<HH:MM>",
          "last_train_to_monterosso": "<HH:MM>"
        },
        "seasonal_variations": {
          "summer": {"period": "<string>", "frequency_increase": <boolean>, "extended_hours": <boolean>, "notes": "<string>"},
          "winter": {"period": "<string>", "frequency_decrease": <boolean>, "notes": "<string>"}
        },
        "holiday_schedule": "<string>",
        "real_time_info": {"available": <boolean>, "app": "<string>", "website": "<url>", "station_displays": <boolean>},
        "timetable_url": "<url>"
      },
      
      "journey_times": {
        "from_riomaggiore": [
          {"destination": "<string>", "duration_minutes": <int>, "distance_km": <float>, "requires_change": <boolean>, "change_at": "<string or null>"}
        ]
      },
      
      "pricing": {
        "currency": "EUR",
        "fare_type": "<Zone-based|Flat|Distance-based>",
        "single_tickets": {
          "riomaggiore_to_la_spezia": <float>,
          "riomaggiore_to_manarola": <float>,
          "riomaggiore_to_monterosso": <float>,
          "between_any_cinque_terre": <float>
        },
        "passes": [
          {
            "name": "<pass name>",
            "name_local": "<Italian name>",
            "description": "<string>",
            "validity_options": [
              {"duration": "<string>", "adult_eur": <float>, "child_eur": <float>, "family_eur": <float or null>}
            ],
            "includes": ["<benefit1>", "<benefit2>"],
            "purchase_locations": ["<location1>", "<location2>"],
            "purchase_url": "<url>",
            "recommended": <boolean>,
            "value_assessment": "<string>"
          }
        ],
        "discounts": {
          "children": {"age_range": "<string>", "discount_percent": <int>, "notes": "<string>"},
          "seniors": {"age_range": "<string>", "discount_percent": <int>, "notes": "<string>"},
          "groups": {"minimum_size": <int>, "discount_percent": <int>}
        },
        "payment_methods": ["<method1>", "<method2>"],
        "ticket_purchase": {
          "in_advance": <boolean>,
          "on_train": <boolean>,
          "at_station": <boolean>,
          "online": <boolean>,
          "app": <boolean>,
          "validation_required": <boolean>,
          "validation_notes": "<string>"
        },
        "price_notes": "<string>"
      },
      
      "vehicles": {
        "train_type": "<string>",
        "capacity": {"seats": <int>, "standing": <int>},
        "amenities": {
          "air_conditioning": <boolean>,
          "wifi": <boolean>,
          "power_outlets": <boolean>,
          "restrooms": <boolean>,
          "luggage_space": "<string>",
          "bike_storage": "<string>",
          "food_service": <boolean>,
          "quiet_car": <boolean>
        },
        "accessibility": {
          "wheelchair_accessible": "<boolean or string>",
          "wheelchair_spaces": <int>,
          "accessibility_notes": "<string>",
          "assistance_available": <boolean>,
          "assistance_booking": "<string>"
        }
      },
      
      "practical_info": {
        "booking_required": <boolean>,
        "reservation_available": <boolean>,
        "check_in_required": <boolean>,
        "arrive_before_minutes": <int>,
        "boarding_process": "<string>",
        "luggage_policy": {
          "carry_on": "<string>",
          "large_luggage": "<string>",
          "bikes": "<string>",
          "pets": "<string>"
        },
        "tips": ["<tip1>", "<tip2>", "<tip3>"],
        "common_issues": ["<issue1>", "<issue2>"]
      },
      
      "ratings_reviews": {
        "average_rating": <float>,
        "total_reviews": <int>,
        "google": {"rating": <float>, "review_count": <int>},
        "tripadvisor": {"rating": <float>, "review_count": <int>},
        "rome2rio": {"rating": <float or null>, "review_count": <int or null>}
      },
      
      "reviews": [
        {
          "source": "<TripAdvisor|Google|Rome2Rio>",
          "author": "<name>",
          "author_country": "<country>",
          "rating": <int 1-5>,
          "date": "<YYYY-MM-DD>",
          "title": "<title or null>",
          "text": "<review text>",
          "helpful_votes": <int or null>,
          "highlights_mentioned": ["<highlight1>"],
          "complaints_mentioned": ["<complaint1>"]
        }
      ],
      
      "images": [
        {"url": "<url>", "alt_text": "<description>", "type": "<station|vehicle|route|ticket>"}
      ],
      
      "sustainability": {
        "carbon_footprint": "<Low|Medium|High>",
        "eco_rating": "<A|B|C|D|E or null>",
        "electric_powered": <boolean>,
        "emissions_comparison": "<string>"
      },
      
      "pros_cons": {
        "pros": ["<pro1>", "<pro2>", "<pro3>"],
        "cons": ["<con1>", "<con2>"]
      },
      
      "alternatives": ["<alternative1>", "<alternative2>"],
      "best_for": ["<use case 1>", "<use case 2>"],
      "not_recommended_for": ["<use case 1>", "<use case 2>"]
    }
  ],
  
  "parking_options": [
    {
      "id": "<unique-id>",
      "name": "<string>",
      "name_local": "<Italian name or null>",
      "slug": "<lowercase-hyphenated>",
      "category": {"primary": "Parking", "secondary": "<Public Parking Lot|Park and Ride|Private>", "tags": ["<tag1>"]},
      "location": {
        "address": "<string>",
        "area": "<string>",
        "coordinates": {"latitude": <float>, "longitude": <float>},
        "distance_to_village_center_meters": <int>,
        "access_to_village": "<string>"
      },
      "capacity": {
        "total_spaces": <int>,
        "accessible_spaces": <int>,
        "motorcycle_spaces": <int or null>,
        "ev_charging": <boolean>
      },
      "pricing": {
        "currency": "EUR",
        "rates": {"per_hour": <float>, "per_day_max": <float>, "overnight": <float or null>, "weekly": <float or null>},
        "payment_methods": ["<method1>", "<method2>"],
        "payment_notes": "<string>"
      },
      "operating_hours": {
        "open_24_hours": <boolean>,
        "staffed_hours": "<string or null>"
      },
      "availability": {
        "typical_availability": "<Very Limited|Limited|Good|Excellent>",
        "fills_up_by": "<time>",
        "best_arrival_time": "<string>",
        "reservation_possible": <boolean>,
        "real_time_availability": <boolean>
      },
      "restrictions": {
        "vehicle_height_limit_m": <float or null>,
        "vehicle_length_limit_m": <float or null>,
        "overnight_allowed": <boolean>,
        "campers_allowed": <boolean>,
        "time_limit_hours": <int or null>
      },
      "facilities": {
        "covered": <boolean>,
        "security": "<string>",
        "lighting": <boolean>,
        "restrooms": <boolean>,
        "ev_charging": <boolean>
      },
      "practical_info": {
        "tips": ["<tip1>", "<tip2>"],
        "warnings": ["<warning1>", "<warning2>"]
      },
      "ratings_reviews": {
        "average_rating": <float>,
        "total_reviews": <int>
      },
      "pros_cons": {
        "pros": ["<pro1>", "<pro2>"],
        "cons": ["<con1>", "<con2>"]
      },
      "recommended": <boolean>,
      "alternatives_recommended": <boolean>,
      "alternative_suggestion": "<string>"
    }
  ],
  
  "walking_paths": [
    {
      "id": "<unique-id>",
      "name": "<string>",
      "name_local": "<Italian name>",
      "slug": "<lowercase-hyphenated>",
      "category": {"primary": "Walking Path", "secondary": "<Scenic Footpath|Hiking Trail>", "tags": ["<tag1>", "<tag2>"]},
      "route": {
        "start_point": "<string>",
        "end_point": "<string>",
        "distance_km": <float>,
        "duration_minutes": <int>,
        "difficulty": "<Easy|Moderate|Difficult|Very Difficult>",
        "terrain": "<string>",
        "elevation_gain_m": <int>,
        "direction": "<Both ways|One-way recommended>"
      },
      "segments": [
        {
          "name": "<segment name>",
          "distance_km": <float>,
          "duration_minutes": <int>,
          "difficulty": "<Easy|Moderate|Difficult>"
        }
      ],
      "current_status": {
        "open": <boolean>,
        "partial_opening": <boolean>,
        "reopened_date": "<YYYY-MM-DD or null>",
        "status_notes": "<string>",
        "closures_due_to_weather": <boolean>,
        "status_check_url": "<url>"
      },
      "access": {
        "entry_points": [
          {"location": "<string>", "coordinates": {"latitude": <float>, "longitude": <float>}}
        ],
        "ticket_required": <boolean>,
        "included_in_cinque_terre_card": <boolean>,
        "standalone_ticket_eur": <float>
      },
      "highlights": ["<highlight1>", "<highlight2>"],
      "practical_info": {
        "best_time": "<string>",
        "crowd_level": "<string>",
        "tips": ["<tip1>", "<tip2>"]
      }
    }
  ],
  
  "taxi_car_services": [
    {
      "id": "<unique-id>",
      "name": "<string>",
      "category": {"primary": "<Taxi|Car Service|Water Taxi>", "secondary": "<Private Transfer|Shared Shuttle>"},
      "services": ["<service1>", "<service2>"],
      "coverage": {
        "airports": ["<airport1> (<code>)", "<airport2> (<code>)"],
        "cities": ["<city1>", "<city2>"],
        "ports": ["<port1>", "<port2>"]
      },
      "pricing": {
        "currency": "EUR",
        "example_fares": {
          "pisa_airport_to_riomaggiore": <float>,
          "genoa_airport_to_riomaggiore": <float>,
          "la_spezia_to_riomaggiore": <float>,
          "florence_to_riomaggiore": <float or null>
        },
        "pricing_notes": "<string>",
        "payment_methods": ["<method1>", "<method2>"]
      },
      "vehicle_types": ["<type1>", "<type2>"],
      "booking": {
        "advance_booking_required": <boolean>,
        "booking_methods": ["<method1>", "<method2>"],
        "cancellation_policy": "<string>"
      },
      "contact": {
        "phone": "<phone>",
        "email": "<email or null>",
        "website": "<url>",
        "booking_url": "<url or null>"
      },
      "reviews": {
        "average_rating": <float>,
        "review_count": <int>
      },
      "pros_cons": {
        "pros": ["<pro1>"],
        "cons": ["<con1>"]
      }
    }
  ],
  
  "rental_options": [
    {
      "id": "<unique-id>",
      "name": "<string>",
      "category": {"primary": "<Boat Rental|Bike Rental|Scooter Rental|Kayak Rental>", "secondary": "<Self-Drive|Guided>"},
      "location": "<string>",
      "coordinates": {"latitude": <float>, "longitude": <float>},
      "rental_types": [
        {
          "type": "<string>",
          "description": "<string>",
          "capacity": <int>,
          "price_per_hour_eur": <float>,
          "price_half_day_eur": <float>,
          "price_full_day_eur": <float>,
          "fuel": "<Included|Extra|Electric>"
        }
      ],
      "operators": [
        {"name": "<string>", "phone": "<phone>", "website": "<url or null>"}
      ],
      "requirements": {
        "license_required": <boolean>,
        "license_type": "<string or null>",
        "minimum_age": <int>,
        "deposit_eur": <float>,
        "id_required": <boolean>
      },
      "availability": {
        "seasonal": <boolean>,
        "season": "<string or null>",
        "booking_recommended": <boolean>
      },
      "practical_info": {
        "notes": "<string>",
        "tips": ["<tip1>"]
      }
    }
  ],
  
  "accessibility_summary": {
    "overall_rating": "<Challenging|Moderate|Good|Excellent>",
    "summary": "<string>",
    "train_accessibility": "<string>",
    "ferry_accessibility": "<string>",
    "village_accessibility": "<string>",
    "accessible_alternatives": ["<alternative1>", "<alternative2>"],
    "resources": {
      "accessibility_info_url": "<url>",
      "assistance_request": "<string>"
    }
  },
  
  "recommended_itineraries": [
    {
      "name": "<string>",
      "description": "<string>",
      "target_audience": "<string>",
      "transportation_sequence": [
        {"step": <int>, "mode": "<string>", "action": "<string>", "duration_minutes": <int or null>, "cost_eur": <float or null>}
      ],
      "total_cost_estimate_eur": <float>,
      "time_required_hours": <float>,
      "notes": "<string or null>"
    }
  ],
  
  "tips_and_recommendations": {
    "general_tips": ["<tip1>", "<tip2>", "<tip3>"],
    "seasonal_tips": {
      "summer": "<string>",
      "spring_fall": "<string>",
      "winter": "<string>"
    },
    "money_saving_tips": ["<tip1>", "<tip2>", "<tip3>"],
    "first_time_visitor_tips": ["<tip1>", "<tip2>"]
  },
  
  "emergency_contacts": {
    "general_emergency": "112",
    "police": "113",
    "medical": "118",
    "coast_guard": "1530",
    "tourist_police": "<phone or null>",
    "nearest_hospital": {"name": "<string>", "address": "<string>", "distance_km": <float>}
  }
}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Include ALL transportation modes: trains, ferries, buses, taxis, parking, walking paths, rentals
3. Include exactly 3 reviews per major transportation option when available
4. Provide accurate schedules, prices, and journey times from official sources
5. Include Cinque Terre Card details and pricing (very important for visitors)
6. Use null for genuinely unavailable data, not empty strings
7. All prices in EUR as numbers
8. Times in 24-hour HH:MM format
9. Coordinates accurate for Riomaggiore area (around 44.099, 9.738)
10. Include practical tips especially about train validation, parking limitations, ferry weather dependency
11. Rank transportation options by practicality/recommendation (train should be #1)
12. Include accessibility information (very important - Cinque Terre is challenging)
13. Note seasonal variations (ferries seasonal, winter reduced service)
14. Include park-and-ride alternatives to village parking
15. Include Via dell'Amore and Sentiero Azzurro trail status information
"""


# =============================================================================
# CORE FUNCTIONS
# =============================================================================

def create_client() -> anthropic.Anthropic:
    """Create and return an Anthropic client."""
    return anthropic.Anthropic()


def fetch_transportation_data(
    client: anthropic.Anthropic,
    model: str = DEFAULT_MODEL,
    verbose: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Fetch transportation data using the Anthropic API.
    
    Args:
        client: Anthropic client instance
        model: Model to use for the API call
        verbose: Whether to print progress messages
        
    Returns:
        Parsed JSON data or None if failed
    """
    if verbose:
        print(f"\n{'='*60}")
        print("Fetching Transportation Data...")
        print(f"{'='*60}")
        print(f"Location: {DEFAULT_LOCATION}")
        print(f"Model: {model}")
    
    try:
        message = client.messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": TRANSPORTATION_SEARCH_PROMPT}],
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
                print("✓ Successfully parsed transportation data")
            
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
    
    # Check for metadata
    if 'metadata' not in data:
        print("  Warning: Missing 'metadata' field")
        return False
    
    # Check for transportation_options
    if 'transportation_options' not in data:
        print("  Warning: Missing 'transportation_options' field")
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
    # Ensure output directory exists
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


def get_item_counts(data: Dict[str, Any]) -> Dict[str, int]:
    """Get counts of items in each category."""
    return {
        "transportation_options": len(data.get('transportation_options', [])),
        "parking_options": len(data.get('parking_options', [])),
        "walking_paths": len(data.get('walking_paths', [])),
        "taxi_car_services": len(data.get('taxi_car_services', [])),
        "rental_options": len(data.get('rental_options', [])),
        "recommended_itineraries": len(data.get('recommended_itineraries', []))
    }


def print_summary(data: Dict[str, Any]):
    """Print a summary of the fetched data."""
    print(f"\n{'='*60}")
    print("TRANSPORTATION DATA SUMMARY")
    print(f"{'='*60}")
    
    # Metadata
    metadata = data.get('metadata', {})
    print(f"Generated at: {metadata.get('generated_at', 'N/A')}")
    print(f"Currency: {metadata.get('currency', 'EUR')}")
    
    # Item counts
    counts = get_item_counts(data)
    print(f"\nData Retrieved:")
    for key, count in counts.items():
        if count > 0:
            print(f"  {key.replace('_', ' ').title()}: {count}")
    
    # Hub information
    hub = data.get('hub_information', {}).get('primary_hub', {})
    if hub:
        print(f"\nPrimary Hub:")
        print(f"  Name: {hub.get('name', 'N/A')}")
        print(f"  Type: {hub.get('type', 'N/A')}")
    
    # Transportation options
    options = data.get('transportation_options', [])
    if options:
        print(f"\n{'-'*50}")
        print("TRANSPORTATION OPTIONS:")
        print(f"{'-'*50}")
        for opt in options:
            rank = opt.get('rank', '?')
            name = opt.get('name', 'Unknown')
            cat = opt.get('category', {}).get('primary', 'N/A')
            rating = opt.get('ratings_reviews', {}).get('average_rating', 'N/A')
            print(f"  #{rank}: {name} ({cat})")
            if rating != 'N/A':
                print(f"       Rating: {rating}/5")
            best_for = opt.get('best_for', [])
            if best_for:
                print(f"       Best for: {', '.join(best_for[:3])}")
    
    # Cinque Terre Card info
    for opt in options:
        for pass_info in opt.get('pricing', {}).get('passes', []):
            if 'Cinque Terre' in pass_info.get('name', ''):
                print(f"\n{'-'*50}")
                print("CINQUE TERRE CARD:")
                print(f"{'-'*50}")
                print(f"  Name: {pass_info.get('name')}")
                for validity in pass_info.get('validity_options', []):
                    print(f"  {validity.get('duration')}: €{validity.get('adult_eur')} adult, €{validity.get('child_eur')} child")
                print(f"  Includes: {', '.join(pass_info.get('includes', [])[:4])}...")
                break
    
    # Parking options
    parking = data.get('parking_options', [])
    if parking:
        print(f"\n{'-'*50}")
        print("PARKING OPTIONS:")
        print(f"{'-'*50}")
        for p in parking:
            name = p.get('name', 'Unknown')
            spaces = p.get('capacity', {}).get('total_spaces', 'N/A')
            daily = p.get('pricing', {}).get('rates', {}).get('per_day_max', 'N/A')
            rec = " ★ RECOMMENDED" if p.get('recommended') else ""
            print(f"  {name}: {spaces} spaces, €{daily}/day{rec}")
    
    # Walking paths
    paths = data.get('walking_paths', [])
    if paths:
        print(f"\n{'-'*50}")
        print("WALKING PATHS:")
        print(f"{'-'*50}")
        for path in paths:
            name = path.get('name', 'Unknown')
            dist = path.get('route', {}).get('distance_km', 'N/A')
            dur = path.get('route', {}).get('duration_minutes', 'N/A')
            diff = path.get('route', {}).get('difficulty', 'N/A')
            status = "OPEN" if path.get('current_status', {}).get('open') else "CHECK STATUS"
            print(f"  {name}")
            print(f"       {dist}km, {dur}min, {diff} [{status}]")
    
    # Accessibility
    accessibility = data.get('accessibility_summary', {})
    if accessibility:
        print(f"\n{'-'*50}")
        print("ACCESSIBILITY:")
        print(f"{'-'*50}")
        print(f"  Overall Rating: {accessibility.get('overall_rating', 'N/A')}")
        summary = accessibility.get('summary', '')
        if summary:
            print(f"  {summary[:100]}...")
    
    # Tips
    tips = data.get('tips_and_recommendations', {}).get('general_tips', [])
    if tips:
        print(f"\n{'-'*50}")
        print("TOP TIPS:")
        print(f"{'-'*50}")
        for tip in tips[:5]:
            print(f"  • {tip}")


# =============================================================================
# CLI
# =============================================================================

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Fetch transportation data for Riomaggiore, Cinque Terre",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python riomaggiore_transportation_fetcher.py
    python riomaggiore_transportation_fetcher.py --output-dir ./travel_data
    python riomaggiore_transportation_fetcher.py --model claude-opus-4-20250514 --quiet

Output:
    Creates riomaggiore_transportation.json with:
    - Train schedules and pricing (including Cinque Terre Card)
    - Ferry/boat services
    - Parking options
    - Walking paths (Via dell'Amore, Sentiero Azzurro)
    - Taxi and car services
    - Rental options (boats, bikes, kayaks)
    - Accessibility information
    - Recommended itineraries
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
    data = fetch_transportation_data(client, args.model, verbose)
    
    if data and validate_data(data):
        # Save data
        filepath = save_data(data, args.output_dir, verbose)
        
        if filepath and verbose:
            print_summary(data)
            
            # Final summary
            counts = get_item_counts(data)
            total = sum(counts.values())
            print(f"\n{'='*60}")
            print(f"✓ Successfully saved {total} transportation items")
            print(f"  File: {filepath}")
            print(f"{'='*60}")
        
        sys.exit(0)
    else:
        print("\n✗ Failed to fetch or validate transportation data")
        sys.exit(1)


if __name__ == "__main__":
    main()