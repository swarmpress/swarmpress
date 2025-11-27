import anthropic
import json
from datetime import datetime
from typing import Optional, Dict, Any

client = anthropic.Anthropic()

ACCOMMODATION_SEARCH_PROMPT = """
Search for the top 10 best accommodations (hotels, B&Bs, apartments, guesthouses) in Riomaggiore, Cinque Terre, Italy.
Return results as a valid JSON object with this exact structure:

{
  "metadata": {
    "query_location": "Riomaggiore, Cinque Terre, Italy",
    "generated_at": "<ISO 8601 timestamp>",
    "total_results": 10,
    "sort_order": "descending by average_rating",
    "search_type": "accommodations"
  },
  "accommodations": [
    {
      "rank": <integer>,
      "name": "<string>",
      "slug": "<lowercase-hyphenated-string>",
      
      "type": {
        "category": "<Hotel|B&B|Apartment|Guesthouse|Hostel|Villa|Room Rental>",
        "star_rating": <integer 1-5 or null>,
        "property_class": "<Luxury|Boutique|Mid-Range|Budget|Vacation Rental>"
      },
      
      "location": {
        "address": "<full address>",
        "street": "<street and number>",
        "postal_code": "19017",
        "city": "Riomaggiore",
        "region": "Liguria",
        "country": "Italy",
        "coordinates": {
          "latitude": <float>,
          "longitude": <float>
        },
        "location_description": "<description>",
        "distance_to_landmarks": {
          "train_station_meters": <integer>,
          "harbor_meters": <integer>,
          "main_street_meters": <integer>,
          "nearest_beach_meters": <integer or null>
        },
        "accessibility_notes": "<string>"
      },
      
      "contact": {
        "phone": "<phone or null>",
        "email": "<email or null>",
        "website": "<url or null>",
        "booking_urls": {
          "direct": "<url or null>",
          "booking_com": "<url or null>",
          "expedia": "<url or null>",
          "airbnb": "<url or null>"
        }
      },
      
      "ratings": {
        "average_rating": <float normalized to 5-point scale>,
        "google": {
          "rating": <float>,
          "review_count": <integer>,
          "url": "<url>"
        },
        "booking_com": {
          "rating": <float out of 10>,
          "review_count": <integer>,
          "url": "<url>"
        },
        "tripadvisor": {
          "rating": <float>,
          "review_count": <integer>,
          "ranking": "<ranking string>",
          "certificate_of_excellence": <boolean>,
          "url": "<url>"
        },
        "expedia": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "url": "<url or null>"
        },
        "airbnb": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "superhost": <boolean or null>,
          "url": "<url or null>"
        },
        "hotels_com": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "url": "<url or null>"
        }
      },
      
      "pricing": {
        "currency": "EUR",
        "price_level": "<€|€€|€€€|€€€€>",
        "price_range": {
          "low_season": {
            "min_per_night": <integer>,
            "max_per_night": <integer>
          },
          "high_season": {
            "min_per_night": <integer>,
            "max_per_night": <integer>
          },
          "peak_season": {
            "min_per_night": <integer>,
            "max_per_night": <integer>
          }
        },
        "average_nightly_rate": <integer>,
        "cleaning_fee": <integer or null>,
        "service_fee_percent": <integer or null>,
        "taxes_included": <boolean>,
        "cancellation_policy": "<string>",
        "payment_methods": ["<method1>", "<method2>"],
        "deposit_required": <boolean>,
        "deposit_amount_eur": <integer or null>
      },
      
      "rooms_units": {
        "total_rooms": <integer>,
        "room_types": [
          {
            "name": "<room type name>",
            "description": "<description>",
            "max_occupancy": <integer>,
            "bed_configuration": "<string>",
            "size_sqm": <integer or null>,
            "has_private_bathroom": <boolean>,
            "has_view": <boolean>,
            "view_type": "<Sea View|Village View|Garden View|null>",
            "price_per_night_eur": <integer>,
            "amenities": ["<amenity1>", "<amenity2>"]
          }
        ]
      },
      
      "amenities": {
        "general": ["<amenity1>", "<amenity2>"],
        "room_amenities": ["<amenity1>", "<amenity2>"],
        "kitchen": ["<amenity1>", "<amenity2>"],
        "outdoor": ["<amenity1>", "<amenity2>"],
        "services": ["<service1>", "<service2>"],
        "accessibility": ["<feature1>", "<feature2>"],
        "parking": {
          "available": <boolean>,
          "type": "<On-site|Nearby|Street|null>",
          "price_per_day_eur": <integer or null>,
          "notes": "<string or null>"
        },
        "breakfast": {
          "included": <boolean>,
          "type": "<Continental|Italian|Buffet|À la carte|null>",
          "price_if_extra_eur": <integer or null>,
          "hours": "<HH:MM-HH:MM or null>",
          "notes": "<string or null>"
        },
        "pets": {
          "allowed": <boolean>,
          "fee_per_night_eur": <integer or null>,
          "restrictions": "<string or null>"
        }
      },
      
      "policies": {
        "check_in": {
          "from": "<HH:MM>",
          "to": "<HH:MM>",
          "flexible": <boolean>,
          "self_check_in": <boolean>,
          "notes": "<string or null>"
        },
        "check_out": {
          "by": "<HH:MM>",
          "late_checkout_available": <boolean>,
          "late_checkout_fee_eur": <integer or null>
        },
        "minimum_stay": {
          "low_season": <integer>,
          "high_season": <integer>,
          "peak_season": <integer>
        },
        "age_restriction": "<string or null>",
        "smoking": "<Non-smoking|Designated areas|Allowed>",
        "parties_events": "<Not allowed|Allowed|Upon request>",
        "quiet_hours": "<HH:MM-HH:MM or null>"
      },
      
      "host_info": {
        "host_name": "<string or null>",
        "host_type": "<Individual|Professional|Property Management>",
        "languages_spoken": ["<language1>", "<language2>"],
        "response_rate_percent": <integer or null>,
        "response_time": "<string or null>",
        "superhost_status": <boolean or null>,
        "years_hosting": <integer or null>,
        "local_tips_provided": <boolean>
      },
      
      "reviews": [
        {
          "source": "<Booking.com|TripAdvisor|Google|Airbnb>",
          "author": "<name>",
          "author_country": "<country>",
          "rating": <integer 1-5 or 1-10 for Booking.com>,
          "date": "<YYYY-MM-DD>",
          "title": "<title or null>",
          "text": "<full review text>",
          "stayed_in": "<room type or null>",
          "trip_type": "<Couple|Family|Solo|Business|Friends>",
          "verified_stay": <boolean>,
          "helpful_votes": <integer or null>,
          "pros_mentioned": ["<pro1>", "<pro2>"],
          "cons_mentioned": ["<con1>", "<con2>"]
        }
      ],
      
      "images": [
        {
          "url": "<direct image url>",
          "source": "<Official|Booking.com|TripAdvisor|Google|Airbnb>",
          "alt_text": "<description>",
          "type": "<exterior|interior|room|bathroom|view|breakfast|common_area>"
        }
      ],
      
      "pros_cons": {
        "pros": ["<pro1>", "<pro2>", "<pro3>"],
        "cons": ["<con1>", "<con2>"]
      },
      
      "tips": ["<tip1>", "<tip2>", "<tip3>"],
      
      "nearby": {
        "restaurants": ["<restaurant1>", "<restaurant2>"],
        "attractions": ["<attraction1>", "<attraction2>"],
        "transport": ["<transport1>", "<transport2>"]
      },
      
      "sustainability": {
        "eco_certified": <boolean>,
        "practices": ["<practice1>", "<practice2>"]
      }
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Include a MIX of accommodation types (hotels, B&Bs, apartments, guesthouses)
3. Include exactly 3 reviews per accommodation from different sources
4. Find real image URLs from Booking.com, TripAdvisor, official sites, or Google
5. Calculate average_rating by normalizing to 5-point scale (Booking.com rating / 2)
6. Sort accommodations array by average_rating descending
7. Use null for genuinely unavailable data, not empty strings
8. Ensure coordinates are accurate for Riomaggiore (around 44.099, 9.738)
9. Only include accommodations IN Riomaggiore village
10. All prices in EUR as integers
11. Times in 24-hour HH:MM format
12. Note accessibility challenges (many stairs are common in Cinque Terre)
13. Include realistic Cinque Terre pricing (typically €100-300/night in high season)
"""


def get_riomaggiore_accommodations() -> Optional[Dict[str, Any]]:
    """Fetch top 10 Riomaggiore accommodations as structured JSON."""
    
    print("Searching for accommodations...")
    
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=20000,
        messages=[
            {"role": "user", "content": ACCOMMODATION_SEARCH_PROMPT}
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


def validate_accommodation_data(data: Dict[str, Any]) -> bool:
    """Basic validation of accommodation data structure."""
    if not data:
        return False
    
    required_fields = ['metadata', 'accommodations']
    for field in required_fields:
        if field not in data:
            print(f"Missing required field: {field}")
            return False
    
    if not isinstance(data['accommodations'], list):
        print("'accommodations' is not a list")
        return False
    
    if len(data['accommodations']) == 0:
        print("No accommodations found")
        return False
    
    # Check each accommodation has minimum required fields
    for i, acc in enumerate(data['accommodations']):
        required_acc_fields = ['rank', 'name', 'location', 'ratings']
        for field in required_acc_fields:
            if field not in acc:
                print(f"Accommodation {i+1} missing field: {field}")
                return False
    
    return True


def save_accommodations_json(data: Dict[str, Any], filename: str = "riomaggiore_accommodations.json"):
    """Save accommodation data to JSON file."""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Saved to {filename}")


def print_summary(data: Dict[str, Any]):
    """Print a summary of the accommodation data."""
    print("\n" + "="*60)
    print("RIOMAGGIORE ACCOMMODATIONS SUMMARY")
    print("="*60)
    print(f"Total results: {data.get('metadata', {}).get('total_results', 'N/A')}")
    print(f"Generated at: {data.get('metadata', {}).get('generated_at', 'N/A')}")
    print("-"*60)
    
    for acc in data.get('accommodations', []):
        rank = acc.get('rank', '?')
        name = acc.get('name', 'Unknown')
        acc_type = acc.get('type', {}).get('category', 'Unknown')
        rating = acc.get('ratings', {}).get('average_rating', 'N/A')
        price = acc.get('pricing', {}).get('average_nightly_rate', 'N/A')
        
        print(f"#{rank}: {name}")
        print(f"    Type: {acc_type} | Rating: {rating}/5 | Avg Price: €{price}/night")
        print()


def main():
    """Main function to fetch and save accommodation data."""
    print("="*60)
    print("RIOMAGGIORE ACCOMMODATION SEARCH")
    print("="*60)
    
    data = get_riomaggiore_accommodations()
    
    if data and validate_accommodation_data(data):
        save_accommodations_json(data)
        print_summary(data)
        print(f"\n✓ Successfully saved {len(data.get('accommodations', []))} accommodations")
    else:
        print("\n✗ Failed to fetch or validate accommodation data")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())