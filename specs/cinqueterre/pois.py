import anthropic
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

client = anthropic.Anthropic()


class POICategory(Enum):
    BEACH = "Beach"
    VIEWPOINT = "Viewpoint"
    HIKING_TRAIL = "Hiking Trail"
    HISTORIC_SITE = "Historic Site"
    CHURCH = "Church"
    LANDMARK = "Landmark"
    NATURAL_ATTRACTION = "Natural Attraction"
    HARBOR = "Harbor"
    MUSEUM = "Museum"
    ACTIVITY = "Activity"
    SQUARE = "Square"
    STREET = "Street"
    CASTLE = "Castle"
    TOWER = "Tower"
    CLIFF = "Cliff"
    CAVE = "Cave"
    DIVING_SPOT = "Diving Spot"


POI_SEARCH_PROMPT = """
Search for the top 20 most popular Points of Interest (POIs) in Riomaggiore, Cinque Terre, Italy.
Include beaches, viewpoints, hiking trails, historic sites, churches, landmarks, and attractions.
Return results as a valid JSON object with this exact structure:

{
  "metadata": {
    "query_location": "Riomaggiore, Cinque Terre, Italy",
    "generated_at": "<ISO 8601 timestamp>",
    "total_results": 20,
    "sort_order": "descending by popularity_score",
    "search_type": "points_of_interest",
    "categories_included": ["Beach", "Viewpoint", "Hiking Trail", "Historic Site", "Church", "Landmark", "Natural Attraction", "Harbor", "Museum", "Activity"]
  },
  "points_of_interest": [
    {
      "rank": <integer 1-20>,
      "name": "<string>",
      "name_local": "<Italian name or null>",
      "slug": "<lowercase-hyphenated-string>",
      
      "category": {
        "primary": "<Beach|Viewpoint|Hiking Trail|Historic Site|Church|Landmark|Natural Attraction|Harbor|Museum|Activity|Square|Street|Castle|Tower|Cliff|Cave|Diving Spot>",
        "secondary": ["<tag1>", "<tag2>"],
        "tags": ["<tag1>", "<tag2>"]
      },
      
      "popularity": {
        "popularity_score": <float 0-100>,
        "popularity_rank": <integer>,
        "total_reviews": <integer sum of all platform reviews>,
        "monthly_visitors_estimate": <integer or null>,
        "peak_season_crowd_level": "<Very High|High|Moderate|Low>",
        "best_time_to_visit": "<string>",
        "instagram_hashtag_count": <integer or null>,
        "featured_in": ["<publication1>", "<publication2>"]
      },
      
      "location": {
        "address": "<full address or location description>",
        "area": "<Harbor Area|Village Center|Hilltop|Coastal Path|Outskirts>",
        "postal_code": "19017",
        "city": "Riomaggiore",
        "region": "Liguria",
        "country": "Italy",
        "coordinates": {
          "latitude": <float>,
          "longitude": <float>
        },
        "location_description": "<detailed description>",
        "directions": {
          "from_train_station": "<string>",
          "from_harbor": "<string>",
          "from_main_street": "<string>"
        },
        "distance_from_landmarks": {
          "train_station_meters": <integer>,
          "harbor_meters": <integer>,
          "main_square_meters": <integer>
        }
      },
      
      "access": {
        "accessibility_rating": "<Easy|Moderate|Difficult|Very Difficult>",
        "accessibility_details": "<string>",
        "stairs_count": <integer or null>,
        "walking_time_from_station_minutes": <integer>,
        "requires_hiking": <boolean>,
        "hiking_difficulty": "<Easy|Moderate|Difficult|null>",
        "trail_length_km": <float or null>,
        "elevation_gain_meters": <integer or null>,
        "wheelchair_accessible": <boolean>,
        "stroller_friendly": <boolean>,
        "suitable_for_elderly": <boolean>,
        "suitable_for_children": <boolean>,
        "swimming_required": <boolean>,
        "boat_access_available": <boolean>,
        "parking_nearby": <boolean>,
        "public_transport_access": "<string>"
      },
      
      "ratings": {
        "average_rating": <float normalized to 5-point scale>,
        "google": {
          "rating": <float>,
          "review_count": <integer>,
          "url": "<url>"
        },
        "tripadvisor": {
          "rating": <float>,
          "review_count": <integer>,
          "ranking": "<ranking string>",
          "certificate_of_excellence": <boolean>,
          "travelers_choice": <boolean>,
          "url": "<url>"
        },
        "viator": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "url": "<url or null>"
        },
        "get_your_guide": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "url": "<url or null>"
        },
        "yelp": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "url": "<url or null>"
        },
        "foursquare": {
          "rating": <float or null>,
          "url": "<url or null>"
        }
      },
      
      "details": {
        "description_short": "<one-line description>",
        "description_long": "<detailed 2-3 paragraph description>",
        "historical_significance": "<string or null>",
        "year_established": <integer or null>,
        "architectural_style": "<string or null>",
        "unesco_status": "<string or null>",
        "size": {
          "area_sqm": <integer or null>,
          "length_meters": <integer or null>,
          "height_meters": <integer or null>
        },
        "features": ["<feature1>", "<feature2>"],
        "wildlife": ["<species1>", "<species2>"],
        "flora": ["<plant1>", "<plant2>"]
      },
      
      "visiting_info": {
        "entry_fee": {
          "is_free": <boolean>,
          "adult_eur": <float or null>,
          "child_eur": <float or null>,
          "senior_eur": <float or null>,
          "student_eur": <float or null>,
          "family_pass_eur": <float or null>,
          "cinque_terre_card_included": <boolean>,
          "free_days": "<string or null>",
          "notes": "<string or null>"
        },
        "opening_hours": {
          "is_always_open": <boolean>,
          "hours": {
            "monday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
            "tuesday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
            "wednesday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
            "thursday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
            "friday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
            "saturday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
            "sunday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean|}
          },
          "seasonal_variations": "<string or null>",
          "last_entry_before_closing": "<string or null>",
          "notes": "<string or null>"
        },
        "best_visiting_time": {
          "time_of_day": "<Sunrise|Morning|Midday|Afternoon|Sunset|Evening|Night|Any>",
          "best_months": ["<month1>", "<month2>"],
          "avoid_months": ["<month1>"],
          "avoid_times": "<string>",
          "sunset_time_approximate": "<string or null>",
          "golden_hour_recommended": <boolean>
        },
        "duration": {
          "minimum_minutes": <integer>,
          "recommended_minutes": <integer>,
          "maximum_minutes": <integer>
        },
        "guided_tours": {
          "available": <boolean>,
          "languages": ["<lang1>", "<lang2>"],
          "price_range_eur": "<string or null>",
          "booking_url": "<url or null>"
        },
        "audio_guide": {
          "available": <boolean>,
          "languages": ["<lang1>"] or null,
          "price_eur": <float or null>
        }
      },
      
      "facilities": {
        "restrooms": <boolean>,
        "drinking_water": <boolean>,
        "food_nearby": <boolean>,
        "restaurants_nearby": ["<restaurant1>", "<restaurant2>"],
        "shops_nearby": <boolean>,
        "benches_seating": <boolean>,
        "shade_available": <boolean>,
        "lighting_at_night": <boolean>,
        "lifeguard": <boolean>,
        "first_aid": <boolean>,
        "information_board": <boolean>,
        "wifi": <boolean>,
        "charging_stations": <boolean>,
        "lockers": <boolean>,
        "changing_rooms": <boolean>,
        "showers": <boolean>,
        "equipment_rental": {
          "available": <boolean>,
          "types": ["<type1>", "<type2>"] or null,
          "prices": "<string or null>"
        }
      },
      
      "activities": {
        "primary_activities": ["<activity1>", "<activity2>"],
        "secondary_activities": ["<activity1>", "<activity2>"],
        "water_activities": ["<activity1>", "<activity2>"] or null,
        "guided_experiences": [
          {
            "name": "<experience name>",
            "provider": "<provider name>",
            "duration_hours": <float>,
            "price_eur": <float>,
            "url": "<booking url>"
          }
        ],
        "prohibited_activities": ["<activity1>", "<activity2>"],
        "seasonal_activities": {
          "summer": ["<activity1>"],
          "winter": ["<activity1>"],
          "year_round": ["<activity1>"]
        }
      },
      
      "safety": {
        "safety_rating": "<Safe|Caution Advised|Hazardous Conditions>",
        "hazards": ["<hazard1>", "<hazard2>"],
        "warnings": ["<warning1>", "<warning2>"],
        "emergency_contact": "112",
        "nearest_hospital_km": <float>,
        "swimming_safety": {
          "lifeguard_on_duty": <boolean>,
          "currents": "<Calm|Moderate|Strong|null>",
          "water_depth": "<Shallow|Medium|Deep|null>",
          "recommended_swimming_ability": "<string or null>"
        },
        "weather_dependent": <boolean>,
        "closed_in_bad_weather": <boolean>
      },
      
      "practical_tips": {
        "what_to_bring": ["<item1>", "<item2>"],
        "what_to_wear": "<string>",
        "what_not_to_bring": ["<item1>", "<item2>"],
        "insider_tips": ["<tip1>", "<tip2>", "<tip3>"],
        "common_mistakes": ["<mistake1>", "<mistake2>"],
        "photography_tips": ["<tip1>", "<tip2>"],
        "local_secrets": "<string>"
      },
      
      "connectivity": {
        "related_pois": [
          {
            "name": "<POI name>",
            "relationship": "<string>",
            "distance_meters": <integer>
          }
        ],
        "nearby_pois": ["<poi1>", "<poi2>"],
        "suggested_itineraries": [
          {
            "name": "<itinerary name>",
            "pois_included": ["<poi1>", "<poi2>"],
            "duration_hours": <float>
          }
        ],
        "can_combine_with": ["<activity1>", "<activity2>"]
      },
      
      "reviews": [
        {
          "source": "<TripAdvisor|Google|Viator>",
          "author": "<name>",
          "author_country": "<country>",
          "rating": <integer 1-5>,
          "date": "<YYYY-MM-DD>",
          "title": "<title or null>",
          "text": "<full review text>",
          "visit_type": "<Solo|Couple|Family|Friends|Tour Group>",
          "visit_season": "<Summer|Fall|Winter|Spring>",
          "verified": <boolean>,
          "helpful_votes": <integer or null>,
          "photos_posted": <integer>,
          "highlights_mentioned": ["<highlight1>", "<highlight2>"],
          "complaints_mentioned": ["<complaint1>", "<complaint2>"]
        }
      ],
      
      "images": [
        {
          "url": "<direct image url>",
          "source": "<Google|TripAdvisor|Official|Wikipedia|Flickr>",
          "alt_text": "<description>",
          "type": "<panoramic|detail|aerial|historical|activity|sunset|underwater>",
          "photographer_credit": "<name or null>",
          "license": "<CC BY-SA|Public Domain|Rights Reserved|null>"
        }
      ],
      
      "pros_cons": {
        "pros": ["<pro1>", "<pro2>", "<pro3>"],
        "cons": ["<con1>", "<con2>"]
      },
      
      "awards_recognition": [
        {
          "award": "<award name>",
          "year": <integer>,
          "category": "<category>"
        }
      ],
      
      "social_media": {
        "instagram_hashtags": ["<hashtag1>", "<hashtag2>"],
        "tiktok_trending": <boolean>,
        "pinterest_saves_estimate": <integer or null>,
        "featured_influencers": ["<influencer1>"]
      },
      
      "sustainability": {
        "eco_guidelines": ["<guideline1>", "<guideline2>"],
        "conservation_efforts": "<string or null>",
        "crowd_management": "<string or null>",
        "environmental_concerns": ["<concern1>", "<concern2>"]
      },
      
      "contact_info": {
        "official_website": "<url or null>",
        "phone": "<phone or null>",
        "email": "<email or null>",
        "tourist_info_office": "<string>"
      }
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Include exactly 20 POIs with a DIVERSE MIX of categories
3. Include exactly 3 reviews per POI from different sources
4. Find real image URLs from Google Maps, TripAdvisor, Wikipedia Commons, or official sites
5. Calculate popularity_score (0-100) based on: total reviews (40%), ratings (30%), TripAdvisor rank (15%), social presence (10%), guide features (5%)
6. Sort POIs by popularity_score descending (most popular first)
7. Use null for genuinely unavailable data, not empty strings
8. Ensure coordinates are accurate for Riomaggiore area (around 44.099, 9.738)
9. Only include POIs IN or immediately adjacent to Riomaggiore
10. All prices in EUR as numbers
11. Times in 24-hour HH:MM format
12. Include BOTH famous attractions AND hidden gems
13. Provide practical, actionable visiting information
"""


def get_riomaggiore_pois() -> Optional[Dict[str, Any]]:
    """Fetch top 20 Riomaggiore POIs as structured JSON."""
    
    print("Searching for Points of Interest...")
    
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=30000,  # POIs need more tokens due to detailed info
        messages=[
            {"role": "user", "content": POI_SEARCH_PROMPT}
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


def validate_poi_data(data: Dict[str, Any]) -> bool:
    """Validate POI data structure."""
    if not data:
        return False
    
    required_fields = ['metadata', 'points_of_interest']
    for field in required_fields:
        if field not in data:
            print(f"Missing required field: {field}")
            return False
    
    if not isinstance(data['points_of_interest'], list):
        print("'points_of_interest' is not a list")
        return False
    
    if len(data['points_of_interest']) == 0:
        print("No POIs found")
        return False
    
    # Check each POI has minimum required fields
    for i, poi in enumerate(data['points_of_interest']):
        required_poi_fields = ['rank', 'name', 'category', 'location', 'ratings', 'popularity']
        for field in required_poi_fields:
            if field not in poi:
                print(f"POI {i+1} missing field: {field}")
                return False
    
    return True


def calculate_category_distribution(data: Dict[str, Any]) -> Dict[str, int]:
    """Calculate distribution of POI categories."""
    categories = {}
    for poi in data.get('points_of_interest', []):
        cat = poi.get('category', {}).get('primary', 'Unknown')
        categories[cat] = categories.get(cat, 0) + 1
    return dict(sorted(categories.items(), key=lambda x: x[1], reverse=True))


def save_pois_json(data: Dict[str, Any], filename: str = "riomaggiore_pois.json"):
    """Save POI data to JSON file."""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Saved to {filename}")


def print_summary(data: Dict[str, Any]):
    """Print a summary of the POI data."""
    print("\n" + "="*70)
    print("RIOMAGGIORE POINTS OF INTEREST SUMMARY")
    print("="*70)
    print(f"Total results: {data.get('metadata', {}).get('total_results', 'N/A')}")
    print(f"Generated at: {data.get('metadata', {}).get('generated_at', 'N/A')}")
    
    # Category distribution
    categories = calculate_category_distribution(data)
    print("\nCategory Distribution:")
    for cat, count in categories.items():
        print(f"  {cat}: {count}")
    
    print("\n" + "-"*70)
    print("TOP 20 POIs (by Popularity Score):")
    print("-"*70)
    
    for poi in data.get('points_of_interest', []):
        rank = poi.get('rank', '?')
        name = poi.get('name', 'Unknown')
        category = poi.get('category', {}).get('primary', 'Unknown')
        score = poi.get('popularity', {}).get('popularity_score', 'N/A')
        reviews = poi.get('popularity', {}).get('total_reviews', 0)
        rating = poi.get('ratings', {}).get('average_rating', 'N/A')
        
        print(f"#{rank:2}: {name}")
        print(f"     Category: {category} | Score: {score} | Reviews: {reviews} | Rating: {rating}/5")
        print()


def main():
    """Main function to fetch and save POI data."""
    print("="*70)
    print("RIOMAGGIORE POINTS OF INTEREST SEARCH")
    print("="*70)
    
    data = get_riomaggiore_pois()
    
    if data and validate_poi_data(data):
        save_pois_json(data)
        print_summary(data)
        print(f"\n✓ Successfully saved {len(data.get('points_of_interest', []))} POIs")
    else:
        print("\n✗ Failed to fetch or validate POI data")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())