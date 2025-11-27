#!/usr/bin/env python3
"""
Riomaggiore Events Data Fetcher
Fetches events in structured JSON format.
"""

import anthropic
import json
from datetime import datetime, date
from typing import Optional, Dict, Any, List
from enum import Enum

client = anthropic.Anthropic()


class EventCategory(Enum):
    FESTIVAL = "Festival"
    RELIGIOUS = "Religious"
    CULTURAL = "Cultural"
    MARKET = "Market"
    CONCERT = "Concert"
    FOOD_WINE = "Food & Wine"
    SPORTING = "Sporting"
    SEASONAL = "Seasonal"
    TRADITIONAL = "Traditional"
    EXHIBITION = "Exhibition"
    THEATER = "Theater"
    WORKSHOP = "Workshop"
    MUSIC = "Music"
    ART = "Art"
    FAMILY = "Family"


EVENT_SEARCH_PROMPT = """
Search for the top 20 events in Riomaggiore, Cinque Terre, Italy. Include festivals, religious celebrations, 
cultural events, markets, concerts, food & wine events, and local traditions. Cover all seasons and both 
annual recurring events and upcoming one-time events.

Return results as a valid JSON object with this structure:

{
  "metadata": {
    "query_location": "Riomaggiore, Cinque Terre, Italy",
    "generated_at": "<ISO 8601 timestamp>",
    "total_results": 20,
    "sort_order": "chronological by next_occurrence",
    "search_type": "events",
    "date_range_searched": {"from": "2024-01-01", "to": "2025-12-31"},
    "categories_included": ["Festival", "Religious", "Cultural", "Market", "Concert", "Food & Wine", "Sporting", "Seasonal", "Traditional", "Exhibition"]
  },
  "events": [
    {
      "rank": <integer 1-20>,
      "name": "<string>",
      "name_local": "<Italian name>",
      "slug": "<lowercase-hyphenated>",
      
      "category": {
        "primary": "<Festival|Religious|Cultural|Market|Concert|Food & Wine|Sporting|Seasonal|Traditional|Exhibition|Theater|Workshop|Music|Art|Family>",
        "secondary": ["<tag1>", "<tag2>"],
        "tags": ["<tag1>", "<tag2>"]
      },
      
      "schedule": {
        "event_type": "<Annual|Monthly|Weekly|One-Time|Seasonal|Recurring>",
        "recurrence_pattern": "<string or null>",
        "next_occurrence": {
          "start_date": "<YYYY-MM-DD>",
          "end_date": "<YYYY-MM-DD>",
          "start_time": "<HH:MM or null>",
          "end_time": "<HH:MM or null>",
          "all_day": <boolean>,
          "timezone": "Europe/Rome"
        },
        "typical_schedule": {
          "month": "<month name or null>",
          "day_of_month": <integer or null>,
          "day_of_week": "<string or null>",
          "week_of_month": <integer or null>,
          "season": "<Spring|Summer|Fall|Winter|Year-Round>",
          "duration_days": <integer>,
          "duration_hours": <integer or null>
        },
        "historical_dates": [{"year": <int>, "date": "<YYYY-MM-DD>"}],
        "schedule_notes": "<string>",
        "confirmed": <boolean>,
        "cancellation_history": "<string or null>"
      },
      
      "location": {
        "venue_name": "<string>",
        "venue_type": "<Outdoor|Indoor|Mixed>",
        "address": "<string>",
        "area": "<Village Center|Harbor|Hilltop|Throughout Village>",
        "city": "Riomaggiore",
        "region": "Liguria",
        "country": "Italy",
        "coordinates": {"latitude": <float>, "longitude": <float>},
        "venue_capacity": <integer or null>,
        "multiple_locations": <boolean>,
        "meeting_point": "<string or null>"
      },
      
      "details": {
        "description_short": "<one-line description>",
        "description_long": "<detailed 2-3 paragraphs>",
        "history": "<historical background>",
        "significance": "<cultural significance>",
        "year_established": <integer or null>,
        "organizer": {
          "name": "<string>",
          "type": "<Municipality|Non-Profit|Religious|Private|Tourism Board>",
          "website": "<url or null>",
          "contact_email": "<email or null>",
          "contact_phone": "<phone or null>"
        },
        "official_event": <boolean>,
        "tradition_origin": "<Religious|Pagan|Historical|Modern|null>"
      },
      
      "program": {
        "highlights": ["<highlight1>", "<highlight2>"],
        "schedule_of_activities": [
          {"time": "<HH:MM>", "activity": "<string>", "location": "<string>", "duration_minutes": <int>}
        ],
        "main_attractions": ["<attraction1>", "<attraction2>"],
        "performers": [{"name": "<string>", "type": "<string>", "performance_time": "<HH:MM>"}],
        "workshops": [{"name": "<string>", "time": "<HH:MM>", "price_eur": <float or null>}]
      },
      
      "food_and_drink": {
        "food_available": <boolean>,
        "food_stalls": <boolean>,
        "number_of_stalls": <integer or null>,
        "local_specialties_served": ["<dish1>", "<dish2>"],
        "signature_dishes": [{"name": "<string>", "description": "<string>", "typical_price_eur": <float>}],
        "wine_featured": <boolean>,
        "wine_types": ["<wine1>", "<wine2>"],
        "restaurants_participating": ["<restaurant1>", "<restaurant2>"],
        "food_included_in_ticket": <boolean>
      },
      
      "tickets_pricing": {
        "is_free": <boolean>,
        "ticket_required": <boolean>,
        "pricing": {
          "general_admission_eur": <float or null>,
          "adult_eur": <float or null>,
          "child_eur": <float or null>,
          "family_pass_eur": <float or null>
        },
        "booking_required": <boolean>,
        "booking_url": "<url or null>",
        "sells_out": <boolean>,
        "typical_sellout_time": "<string or null>",
        "price_notes": "<string or null>"
      },
      
      "attendance": {
        "expected_attendance": <integer>,
        "typical_attendance_range": {"min": <int>, "max": <int>},
        "crowd_level": "<Very High|High|Moderate|Low>",
        "local_vs_tourist_ratio": "<string>",
        "family_friendly": <boolean>,
        "peak_hours": "<string>",
        "best_arrival_time": "<string>"
      },
      
      "practical_info": {
        "dress_code": "<string or null>",
        "what_to_bring": ["<item1>", "<item2>"],
        "what_to_wear": "<string>",
        "accessibility": {
          "wheelchair_accessible": <boolean>,
          "accessibility_notes": "<string>"
        },
        "parking": {"available": <boolean>, "notes": "<string>"},
        "public_transport": {
          "train_service": "<string>",
          "last_train_to_la_spezia": "<HH:MM>",
          "boat_service": "<string or null>"
        },
        "facilities": {
          "restrooms": <boolean>,
          "first_aid": <boolean>,
          "information_booth": <boolean>
        },
        "rules_regulations": ["<rule1>", "<rule2>"],
        "pet_policy": "<string>",
        "photography_policy": "<string>"
      },
      
      "weather_contingency": {
        "weather_dependent": <boolean>,
        "rain_policy": "<string>",
        "backup_date": "<string or null>",
        "indoor_alternative": <boolean>,
        "cancellation_notification": "<string>",
        "typical_weather": {
          "temperature_high_c": <integer>,
          "temperature_low_c": <integer>,
          "precipitation_chance_percent": <integer>
        }
      },
      
      "ratings_reviews": {
        "average_rating": <float>,
        "total_reviews": <integer>,
        "google": {"rating": <float or null>, "review_count": <int or null>},
        "tripadvisor": {"rating": <float or null>, "review_count": <int or null>, "ranking": "<string or null>"},
        "facebook": {"interested_count": <int or null>, "going_count": <int or null>, "event_url": "<url or null>"}
      },
      
      "reviews": [
        {
          "source": "<TripAdvisor|Google|Facebook|Blog>",
          "author": "<name>",
          "author_country": "<country>",
          "rating": <integer 1-5>,
          "date": "<YYYY-MM-DD>",
          "title": "<title or null>",
          "text": "<review text>",
          "visit_year": <integer>,
          "verified_attendance": <boolean>,
          "helpful_votes": <integer or null>,
          "highlights_mentioned": ["<highlight1>"],
          "complaints_mentioned": ["<complaint1>"]
        }
      ],
      
      "images": [
        {
          "url": "<direct image url>",
          "source": "<Google|TripAdvisor|Official|Local News|Flickr>",
          "alt_text": "<description>",
          "type": "<fireworks|procession|crowd|food|venue|performers|poster|historical>",
          "year_taken": <integer or null>
        }
      ],
      
      "social_media": {
        "official_hashtag": "<string or null>",
        "instagram_hashtag_count": <integer or null>,
        "facebook_event_page": "<url or null>",
        "live_streaming": <boolean>
      },
      
      "safety_security": {
        "security_present": <boolean>,
        "emergency_services": <boolean>,
        "first_aid_stations": <integer>,
        "emergency_contact": "112",
        "prohibited_items": ["<item1>", "<item2>"]
      },
      
      "tips_recommendations": {
        "insider_tips": ["<tip1>", "<tip2>", "<tip3>"],
        "best_viewing_spots": ["<spot1>", "<spot2>"],
        "avoid": ["<thing to avoid1>", "<thing to avoid2>"],
        "local_customs": ["<custom1>", "<custom2>"],
        "combine_with": ["<activity1>", "<activity2>"]
      },
      
      "related_events": [
        {"name": "<event name>", "relationship": "<string>", "date": "<string>"}
      ],
      
      "contact_info": {
        "main_contact": "<string>",
        "phone": "<phone>",
        "email": "<email>",
        "website": "<url>"
      },
      
      "pros_cons": {
        "pros": ["<pro1>", "<pro2>", "<pro3>"],
        "cons": ["<con1>", "<con2>"]
      },
      
      "booking_recommendations": {
        "accommodation_book_ahead_weeks": <integer>,
        "restaurant_reservations_recommended": <boolean>,
        "transport_book_ahead": <boolean>
      }
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Include exactly 20 events covering DIVERSE categories and ALL seasons
3. Include exactly 3 reviews per event when available
4. Sort events chronologically by next_occurrence date
5. Include BOTH annual recurring events AND upcoming one-time events
6. For annual events without confirmed dates, use typical historical dates
7. Use null for genuinely unavailable data, not empty strings
8. All prices in EUR as numbers
9. Times in 24-hour HH:MM format
10. Dates in YYYY-MM-DD format
11. Coordinates accurate for Riomaggiore (around 44.099, 9.738)
12. Include religious festivals, food events, cultural celebrations, markets
13. Cover events from official sources: municipality, tourism board, TripAdvisor, Facebook Events
"""


def get_riomaggiore_events() -> Optional[Dict[str, Any]]:
    """Fetch events data for Riomaggiore."""
    
    print("Searching for events...")
    
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=35000,  # Events need significant tokens
        messages=[
            {"role": "user", "content": EVENT_SEARCH_PROMPT}
        ],
        tools=[{"type": "web_search"}]
    )
    
    # Extract text content from response
    response_text = ""
    for block in message.content:
        if hasattr(block, 'text'):
            response_text += block.text
    
    # Parse JSON from response
    try:
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        if json_start != -1 and json_end > json_start:
            json_str = response_text[json_start:json_end]
            data = json.loads(json_str)
            return data
        else:
            raise ValueError("No JSON object found in response")
    except json.JSONDecodeError as e:
        print(f"JSON parsing error: {e}")
        print(f"Raw response: {response_text[:1000]}...")
        return None


def validate_event_data(data: Dict[str, Any]) -> bool:
    """Validate event data structure."""
    if not data:
        return False
    
    required_fields = ['metadata', 'events']
    for field in required_fields:
        if field not in data:
            print(f"Missing required field: {field}")
            return False
    
    if not isinstance(data['events'], list):
        print("'events' is not a list")
        return False
    
    if len(data['events']) == 0:
        print("No events found")
        return False
    
    # Check each event has minimum required fields
    for i, event in enumerate(data['events']):
        required_event_fields = ['rank', 'name', 'category', 'schedule', 'location', 'details']
        for field in required_event_fields:
            if field not in event:
                print(f"Event {i+1} missing field: {field}")
                return False
    
    return True


def calculate_category_distribution(data: Dict[str, Any]) -> Dict[str, int]:
    """Calculate distribution of event categories."""
    categories = {}
    for event in data.get('events', []):
        cat = event.get('category', {}).get('primary', 'Unknown')
        categories[cat] = categories.get(cat, 0) + 1
    return dict(sorted(categories.items(), key=lambda x: x[1], reverse=True))


def calculate_season_distribution(data: Dict[str, Any]) -> Dict[str, int]:
    """Calculate distribution of events by season."""
    seasons = {}
    for event in data.get('events', []):
        season = event.get('schedule', {}).get('typical_schedule', {}).get('season', 'Unknown')
        seasons[season] = seasons.get(season, 0) + 1
    return dict(sorted(seasons.items(), key=lambda x: x[1], reverse=True))


def get_upcoming_events(data: Dict[str, Any], limit: int = 5) -> List[Dict]:
    """Get upcoming events sorted by date."""
    events = data.get('events', [])
    today = date.today().isoformat()
    
    upcoming = []
    for event in events:
        next_date = event.get('schedule', {}).get('next_occurrence', {}).get('start_date')
        if next_date and next_date >= today:
            upcoming.append({
                'name': event.get('name'),
                'date': next_date,
                'category': event.get('category', {}).get('primary'),
                'is_free': event.get('tickets_pricing', {}).get('is_free')
            })
    
    upcoming.sort(key=lambda x: x['date'])
    return upcoming[:limit]


def save_events_json(data: Dict[str, Any], filename: str = "riomaggiore_events.json"):
    """Save event data to JSON file."""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Saved to {filename}")


def print_summary(data: Dict[str, Any]):
    """Print a summary of the event data."""
    print("\n" + "="*70)
    print("RIOMAGGIORE EVENTS SUMMARY")
    print("="*70)
    print(f"Total results: {data.get('metadata', {}).get('total_results', 'N/A')}")
    print(f"Generated at: {data.get('metadata', {}).get('generated_at', 'N/A')}")
    
    # Category distribution
    categories = calculate_category_distribution(data)
    print("\nCategory Distribution:")
    for cat, count in categories.items():
        print(f"  {cat}: {count}")
    
    # Season distribution
    seasons = calculate_season_distribution(data)
    print("\nSeason Distribution:")
    for season, count in seasons.items():
        print(f"  {season}: {count}")
    
    # Upcoming events
    print("\n" + "-"*70)
    print("NEXT 5 UPCOMING EVENTS:")
    print("-"*70)
    upcoming = get_upcoming_events(data, 5)
    for event in upcoming:
        free_label = "FREE" if event['is_free'] else "TICKETED"
        print(f"  {event['date']}: {event['name']} ({event['category']}) [{free_label}]")
    
    print("\n" + "-"*70)
    print("ALL EVENTS:")
    print("-"*70)
    
    for event in data.get('events', []):
        rank = event.get('rank', '?')
        name = event.get('name', 'Unknown')
        category = event.get('category', {}).get('primary', 'Unknown')
        next_date = event.get('schedule', {}).get('next_occurrence', {}).get('start_date', 'TBD')
        event_type = event.get('schedule', {}).get('event_type', 'Unknown')
        is_free = event.get('tickets_pricing', {}).get('is_free', True)
        attendance = event.get('attendance', {}).get('expected_attendance', 'N/A')
        
        free_label = "Free" if is_free else "Ticketed"
        print(f"#{rank:2}: {name}")
        print(f"     Date: {next_date} | Type: {event_type} | {category}")
        print(f"     {free_label} | Expected: {attendance} attendees")
        print()


def main():
    """Main function to fetch and save event data."""
    print("="*70)
    print("RIOMAGGIORE EVENTS SEARCH")
    print("="*70)
    
    data = get_riomaggiore_events()
    
    if data and validate_event_data(data):
        save_events_json(data)
        print_summary(data)
        print(f"\n✓ Successfully saved {len(data.get('events', []))} events")
    else:
        print("\n✗ Failed to fetch or validate event data")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())