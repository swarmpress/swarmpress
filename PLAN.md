# Plan: Cinque Terre Data Tools for swarm.press Agents

## Overview

Convert the Python data-fetching scripts in `specs/cinqueterre/` into TypeScript tools that existing swarm.press agents can use on-demand to fetch real-time data via Claude's web search capability.

## Architecture Decision

**Key Insight:** Claude with `tools=[{"type": "web_search"}]` eliminates the need for traditional APIs (Google Places, Weather APIs, etc.). The agent itself performs intelligent web research and returns structured data.

### Pattern
```
Agent Tool Call → Claude API with web_search → Structured JSON → Validate with Zod → Store in Collections
```

---

## Implementation Steps

### Phase 1: Collection Schemas (Zod)

Create TypeScript/Zod schemas for each content type in `packages/shared/src/content/collections/`:

1. **`cinqueterre-poi.ts`** - Points of Interest
   - Fields: name, village, category, coordinates, description, hours, contact, ratings (multiple sources), accessibility, photos

2. **`cinqueterre-restaurant.ts`** - Restaurants
   - Fields: name, village, cuisine, price_range, ratings (Google, TripAdvisor, Yelp, Michelin), hours, menu highlights, reservations, reviews

3. **`cinqueterre-accommodation.ts`** - Hotels & Lodging
   - Fields: name, village, type (hotel/B&B/apartment), star_rating, amenities, pricing, booking_links, reviews

4. **`cinqueterre-weather.ts`** - Weather Data
   - Fields: current_conditions, hourly_forecast, daily_forecast, marine_conditions, alerts, activity_recommendations

5. **`cinqueterre-event.ts`** - Events & Festivals
   - Fields: name, type, dates, village, schedule, tickets, attendance, weather_contingency

6. **`cinqueterre-transportation.ts`** - Transport Info
   - Fields: trains, ferries, buses, parking, walking_paths, cinque_terre_card

7. **`cinqueterre-hike.ts`** - Hiking Trails
   - Fields: name, route, difficulty, distance, elevation, duration, waypoints, current_status, fees, reviews

**Files to create:**
- `packages/shared/src/content/collections/cinqueterre-poi.ts`
- `packages/shared/src/content/collections/cinqueterre-restaurant.ts`
- `packages/shared/src/content/collections/cinqueterre-accommodation.ts`
- `packages/shared/src/content/collections/cinqueterre-weather.ts`
- `packages/shared/src/content/collections/cinqueterre-event.ts`
- `packages/shared/src/content/collections/cinqueterre-transportation.ts`
- `packages/shared/src/content/collections/cinqueterre-hike.ts`
- Update `packages/shared/src/content/collections/registry.ts`
- Update `packages/shared/src/content/collections/index.ts`

---

### Phase 2: Research Tools Infrastructure

Create a base tool infrastructure for Claude web search tools in `packages/agents/src/tools/`:

1. **`research-tool.ts`** - Base class/factory for research tools
   - Handles Claude API call with `tools=[{"type": "web_search"}]`
   - Parses and validates response with Zod schema
   - Returns structured data

2. **Tool implementations** (one per content type):
   - `cinqueterre-poi-tool.ts`
   - `cinqueterre-restaurant-tool.ts`
   - `cinqueterre-accommodation-tool.ts`
   - `cinqueterre-weather-tool.ts`
   - `cinqueterre-event-tool.ts`
   - `cinqueterre-transportation-tool.ts`
   - `cinqueterre-hike-tool.ts`

**Files to create:**
- `packages/agents/src/tools/research/base.ts`
- `packages/agents/src/tools/research/cinqueterre-poi.ts`
- `packages/agents/src/tools/research/cinqueterre-restaurant.ts`
- `packages/agents/src/tools/research/cinqueterre-accommodation.ts`
- `packages/agents/src/tools/research/cinqueterre-weather.ts`
- `packages/agents/src/tools/research/cinqueterre-event.ts`
- `packages/agents/src/tools/research/cinqueterre-transportation.ts`
- `packages/agents/src/tools/research/cinqueterre-hike.ts`
- `packages/agents/src/tools/research/index.ts`

---

### Phase 3: Agent Integration

Add research tools to WriterAgent's capabilities:

1. **Update WriterAgent** (`packages/agents/src/writer/writer-agent.ts`)
   - Import research tools
   - Register tools in agent's tool list
   - Tools available: `research_pois`, `research_restaurants`, `research_weather`, etc.

2. **Tool Definitions for Agent SDK**
   ```typescript
   {
     name: "research_restaurants",
     description: "Search for restaurant information in Cinque Terre villages",
     input_schema: {
       type: "object",
       properties: {
         village: { type: "string", enum: ["Monterosso", "Vernazza", "Corniglia", "Manarola", "Riomaggiore"] },
         cuisine_type: { type: "string" },
         price_range: { type: "string" }
       }
     }
   }
   ```

**Files to modify:**
- `packages/agents/src/writer/writer-agent.ts`
- `packages/agents/src/writer/tools.ts` (create if needed)

---

### Phase 4: Collection Storage Integration

Enable storing fetched data in collections:

1. **Collection Repository Updates** (`packages/backend/src/db/repositories/`)
   - Ensure `collection_items` table supports new content types
   - Add helper methods for upserting research data

2. **Service Layer** (`packages/backend/src/services/`)
   - Create `research-data.service.ts` for managing fetched data
   - Handle deduplication, freshness checks, cache invalidation

**Files to create/modify:**
- `packages/backend/src/services/research-data.service.ts`
- `packages/backend/src/db/repositories/collection.repository.ts` (verify/update)

---

### Phase 5: API Endpoints (Optional)

Add tRPC endpoints for manual data fetching:

1. **Research Router** (`packages/backend/src/api/routers/research.router.ts`)
   - `research.fetchPOIs` - Trigger POI research
   - `research.fetchRestaurants` - Trigger restaurant research
   - `research.fetchWeather` - Trigger weather research
   - etc.

**Files to create:**
- `packages/backend/src/api/routers/research.router.ts`
- Update `packages/backend/src/api/routers/index.ts`

---

## File Summary

### New Files (19)
```
packages/shared/src/content/collections/
├── cinqueterre-poi.ts
├── cinqueterre-restaurant.ts
├── cinqueterre-accommodation.ts
├── cinqueterre-weather.ts
├── cinqueterre-event.ts
├── cinqueterre-transportation.ts
└── cinqueterre-hike.ts

packages/agents/src/tools/research/
├── base.ts
├── cinqueterre-poi.ts
├── cinqueterre-restaurant.ts
├── cinqueterre-accommodation.ts
├── cinqueterre-weather.ts
├── cinqueterre-event.ts
├── cinqueterre-transportation.ts
├── cinqueterre-hike.ts
└── index.ts

packages/backend/src/
├── services/research-data.service.ts
└── api/routers/research.router.ts
```

### Modified Files (5)
```
packages/shared/src/content/collections/registry.ts
packages/shared/src/content/collections/index.ts
packages/agents/src/writer/writer-agent.ts
packages/backend/src/api/routers/index.ts
packages/backend/src/db/repositories/collection.repository.ts
```

---

## Implementation Order

1. **Phase 1** - Collection Schemas (foundation for everything)
2. **Phase 2** - Research Tools (core functionality)
3. **Phase 3** - Agent Integration (enable agent usage)
4. **Phase 4** - Storage Integration (persist data)
5. **Phase 5** - API Endpoints (optional, for admin UI)

---

## Example Tool Implementation

```typescript
// packages/agents/src/tools/research/cinqueterre-restaurant.ts

import Anthropic from "@anthropic-ai/sdk";
import { CinqueTerreRestaurantSchema } from "@swarm-press/shared";

const RESTAURANT_SEARCH_PROMPT = `
Search for restaurants in {village}, Cinque Terre, Italy.
Return data as JSON matching this exact schema:
{
  "restaurants": [{
    "name": "string",
    "village": "string",
    "cuisine_type": ["string"],
    "price_range": "€" | "€€" | "€€€" | "€€€€",
    "ratings": {
      "google": { "score": number, "review_count": number },
      "tripadvisor": { "score": number, "review_count": number }
    },
    ...
  }]
}
`;

export async function researchRestaurants(
  client: Anthropic,
  params: { village: string; cuisine_type?: string }
) {
  const prompt = RESTAURANT_SEARCH_PROMPT.replace("{village}", params.village);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search" }]
  });

  // Extract JSON from response
  const jsonContent = extractJSON(response);

  // Validate with Zod
  const validated = CinqueTerreRestaurantSchema.parse(jsonContent);

  return validated;
}
```

---

## Notes

- **On-demand fetching**: Data is fetched fresh each time, no caching layer needed initially
- **Web search capability**: Relies on Claude's `web_search` tool for real-time data
- **Structured output**: Each tool returns Zod-validated data matching collection schemas
- **Agent autonomy**: WriterAgent decides when to call research tools based on content needs
