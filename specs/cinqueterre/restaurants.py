import anthropic
import json
from datetime import datetime

client = anthropic.Anthropic()

RESTAURANT_SEARCH_PROMPT = """
Search for the top 10 best restaurants in Riomaggiore, Cinque Terre, Italy. 
Return results as a valid JSON object with this exact structure:

{
  "metadata": {
    "query_location": "Riomaggiore, Cinque Terre, Italy",
    "generated_at": "<ISO 8601 timestamp>",
    "total_results": 10,
    "sort_order": "descending by average_rating"
  },
  "restaurants": [
    {
      "rank": <integer>,
      "name": "<string>",
      "slug": "<lowercase-hyphenated-string>",
      
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
        "location_description": "<e.g., Harborside, hilltop near church>"
      },
      
      "contact": {
        "phone": "<phone number or null>",
        "email": "<email or null>",
        "website": "<url or null>",
        "reservations_url": "<url or null>"
      },
      
      "ratings": {
        "average_rating": <float calculated from all sources>,
        "google": {
          "rating": <float>,
          "review_count": <integer>,
          "url": "<google maps url>"
        },
        "tripadvisor": {
          "rating": <float>,
          "review_count": <integer>,
          "ranking": "<ranking string>",
          "url": "<tripadvisor url>"
        },
        "yelp": {
          "rating": <float or null>,
          "review_count": <integer or null>,
          "url": "<yelp url or null>"
        },
        "foursquare": {
          "rating": <float or null>,
          "url": "<foursquare url or null>"
        },
        "michelin": {
          "status": "<Selected|Star|Bib Gourmand|null>",
          "description": "<string or null>",
          "url": "<michelin url or null>"
        }
      },
      
      "details": {
        "cuisine_type": ["<cuisine1>", "<cuisine2>"],
        "price_range": {
          "level": "<€|€€|€€€|€€€€>",
          "min_price_eur": <integer>,
          "max_price_eur": <integer>,
          "average_meal_eur": <integer>
        },
        "features": ["<feature1>", "<feature2>"],
        "dietary_options": ["<option1>", "<option2>"],
        "best_for": ["<use case1>", "<use case2>"],
        "atmosphere": "<description>",
        "dress_code": "<Casual|Smart Casual|Formal>",
        "reservation_required": <boolean>,
        "credit_cards_accepted": <boolean>,
        "wheelchair_accessible": <boolean or null>
      },
      
      "opening_hours": {
        "timezone": "Europe/Rome",
        "hours": {
          "monday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
          "tuesday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
          "wednesday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
          "thursday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
          "friday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
          "saturday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>},
          "sunday": {"open": "<HH:MM or null>", "close": "<HH:MM or null>", "closed": <boolean>}
        },
        "lunch_hours": "<HH:MM-HH:MM or null>",
        "dinner_hours": "<HH:MM-HH:MM or null>",
        "seasonal_closure": "<description or null>",
        "notes": "<additional notes or null>"
      },
      
      "menu": {
        "signature_dishes": [
          {
            "name": "<dish name>",
            "description": "<brief description>",
            "price_eur": <float or null>,
            "dietary_info": ["<info>"]
          }
        ],
        "must_try": ["<dish1>", "<dish2>", "<dish3>"],
        "specialties": ["<specialty1>", "<specialty2>"]
      },
      
      "reviews": [
        {
          "source": "<Google|TripAdvisor|Yelp>",
          "author": "<name>",
          "rating": <integer 1-5>,
          "date": "<YYYY-MM-DD>",
          "title": "<title or null>",
          "text": "<full review text>",
          "language": "en",
          "helpful_votes": <integer or null>
        }
      ],
      
      "images": [
        {
          "url": "<direct image url>",
          "source": "<Google|TripAdvisor|Official>",
          "alt_text": "<description>",
          "type": "<exterior|interior|food|view>"
        }
      ],
      
      "pros_cons": {
        "pros": ["<pro1>", "<pro2>", "<pro3>"],
        "cons": ["<con1>", "<con2>"]
      },
      
      "tips": ["<tip1>", "<tip2>", "<tip3>"]
    }
  ]
}

CRITICAL INSTRUCTIONS:
1. Return ONLY valid JSON - no markdown, no code blocks, no explanatory text
2. Include exactly 3 reviews per restaurant from different sources
3. Find real image URLs from Google Maps, TripAdvisor photos, or official sites
4. Calculate average_rating as mean of all available ratings (normalize Foursquare /10 to /5)
5. Sort restaurants array by average_rating descending
6. Use null for genuinely unavailable data, not empty strings
7. Ensure coordinates are accurate for Riomaggiore (around 44.099, 9.738)
8. Only include restaurants IN Riomaggiore village
9. All prices in EUR as numbers
10. Times in 24-hour HH:MM format
"""

def get_riomaggiore_restaurants():
    """Fetch top 10 Riomaggiore restaurants as structured JSON."""
    
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=16000,
        messages=[
            {"role": "user", "content": RESTAURANT_SEARCH_PROMPT}
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
        # Try to find JSON in the response
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
        print(f"Raw response: {response_text[:500]}...")
        return None

def save_restaurants_json(data, filename="riomaggiore_restaurants.json"):
    """Save restaurant data to JSON file."""
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Saved to {filename}")

def main():
    print("Fetching Riomaggiore restaurant data...")
    data = get_riomaggiore_restaurants()
    
    if data:
        save_restaurants_json(data)
        print(f"\nFound {data.get('metadata', {}).get('total_results', 0)} restaurants")
        
        # Print summary
        for restaurant in data.get('restaurants', []):
            print(f"#{restaurant['rank']}: {restaurant['name']} - {restaurant['ratings']['average_rating']}/5")
    else:
        print("Failed to fetch restaurant data")

if __name__ == "__main__":
    main()