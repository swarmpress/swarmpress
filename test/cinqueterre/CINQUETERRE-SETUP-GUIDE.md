# Cinqueterre.travel Media House - Complete Setup Guide

**Date:** 2025-11-23
**Purpose:** Testing Environment for Swarm.press Platform
**Status:** ✅ Ready for Use

---

## Overview

This setup creates a complete, production-like virtual media house for **Cinqueterre.travel**, a comprehensive travel guide website about the Cinque Terre region in Italy. It includes:

- **1 Media Company** with full organizational structure
- **6 Departments** representing different functional areas
- **9 Roles** with specific responsibilities
- **8 AI Agents** with distinct personalities and capabilities
- **1 Website** with complete sitemap structure
- **11 Pages** covering key content areas
- **3 Content Blueprints** for different page types
- **12 Editorial Tasks** in various workflow stages
- **72+ Task Phases** tracking detailed progress
- **5 Agent Activities** showing recent work
- **5 Content Suggestions** from AI agents

---

## Installation

### Prerequisites

1. PostgreSQL database running (via Docker or local)
2. All migrations applied (001-012)
3. Backend server accessible

### Run the Setup

```bash
# If using Docker
docker exec -i swarmpress-postgres psql -U swarmpress -d swarmpress < setup-cinqueterre-complete.sql

# If using local PostgreSQL
psql -U swarmpress -d swarmpress < setup-cinqueterre-complete.sql
```

### Verification

The script includes verification queries at the end that will display:

```
Entity              | Count
--------------------|-------
Companies           | 1
Departments         | 6
Roles               | 9
Agents              | 8
Websites            | 1
Pages               | 11
Blueprints          | 3
Editorial Tasks     | 12
Task Phases         | 72+
Agent Activities    | 5
Suggestions         | 5
```

---

## Organizational Structure

### Company: Cinqueterre.travel

**ID:** `ct-company-001`
**Mission:** To be the definitive guide for travelers exploring the Italian Riviera
**Languages:** English, Italian, German, French

### Departments (6)

| Department | ID | Purpose |
|------------|-----|---------|
| **Editorial** | `ct-dept-editorial` | Content strategy, planning, and quality |
| **Writers Room** | `ct-dept-writers` | Content creation and articles |
| **SEO & Analytics** | `ct-dept-seo` | Search optimization and performance |
| **Media Production** | `ct-dept-media` | Visual content and multimedia |
| **Engineering** | `ct-dept-engineering` | Technical infrastructure |
| **Governance** | `ct-dept-governance` | Strategic oversight |

### Roles (9)

| Role | Department | Responsibilities |
|------|------------|------------------|
| **Editor-in-Chief** | Editorial | Content strategy and oversight |
| **Senior Editor** | Editorial | Content review and approval |
| **Travel Writer** | Writers Room | Destination guides and narratives |
| **Culture Writer** | Writers Room | Culture, history, traditions |
| **Food & Dining Writer** | Writers Room | Restaurants and cuisine |
| **SEO Specialist** | SEO & Analytics | Optimization and tracking |
| **Media Coordinator** | Media Production | Visual assets |
| **Site Engineer** | Engineering | Technical operations |
| **CEO** | Governance | Final approvals and strategy |

---

## AI Agents Team

### 1. Sophia - Editor-in-Chief
**ID:** `ct-agent-sophia`
**Email:** sophia@cinqueterre.travel
**Persona:** Strategic and detail-oriented editorial leader with deep knowledge of travel content
**Capabilities:**
- Editorial strategy
- Content planning
- Quality assurance
- Team coordination
- Workflow management

### 2. Marco - Senior Editor
**ID:** `ct-agent-marco`
**Email:** marco@cinqueterre.travel
**Persona:** Meticulous editor with keen eye for detail and authentic Italian perspective
**Capabilities:**
- Content review
- Fact checking
- Style editing
- Grammar polish
- Cultural accuracy

### 3. Isabella - Travel Writer
**ID:** `ct-agent-isabella`
**Email:** isabella@cinqueterre.travel
**Persona:** Adventurous travel writer who has extensively explored the Italian Riviera
**Capabilities:**
- Destination guides
- Travel tips
- Hiking routes
- Transportation guides
- Itinerary planning

### 4. Lorenzo - Culture Writer
**ID:** `ct-agent-lorenzo`
**Email:** lorenzo@cinqueterre.travel
**Persona:** Cultural historian passionate about Italian heritage and traditions
**Capabilities:**
- Cultural history
- Local traditions
- Architectural insights
- Festival coverage
- Storytelling

### 5. Giulia - Food & Dining Writer
**ID:** `ct-agent-giulia`
**Email:** giulia@cinqueterre.travel
**Persona:** Food enthusiast and culinary expert specializing in Ligurian cuisine
**Capabilities:**
- Restaurant reviews
- Recipe sharing
- Wine coverage
- Food culture
- Culinary tours

### 6. Alex - SEO Specialist
**ID:** `ct-agent-alex`
**Email:** alex@cinqueterre.travel
**Persona:** Data-driven SEO strategist focused on organic growth
**Capabilities:**
- Keyword research
- On-page SEO
- Technical SEO
- Analytics
- Performance tracking

### 7. Francesca - Media Coordinator
**ID:** `ct-agent-francesca`
**Email:** francesca@cinqueterre.travel
**Persona:** Visual storyteller with eye for capturing Cinque Terre's beauty
**Capabilities:**
- Image sourcing
- Photo editing
- Map creation
- Video coordination
- Visual storytelling

### 8. Matteo - Site Engineer
**ID:** `ct-agent-matteo`
**Email:** matteo@cinqueterre.travel
**Persona:** Technical expert ensuring website performance and reliability
**Capabilities:**
- Site building
- Performance optimization
- Deployment
- Troubleshooting
- Infrastructure

### 9. Elena - CEO
**ID:** `ct-agent-elena`
**Email:** elena@cinqueterre.travel
**Persona:** Visionary leader guiding strategic direction
**Capabilities:**
- Strategic planning
- Final approvals
- Partnership development
- Brand vision
- Decision making

---

## Website Structure

### Site: Cinqueterre.travel
**ID:** `ct-website-001`
**Domain:** cinqueterre.travel
**Status:** Active
**Primary Language:** English
**Additional Languages:** Italian, German, French

### Sitemap (11 Pages)

```
/ (Homepage)
├── /villages (The Five Villages)
│   ├── /villages/monterosso (Monterosso al Mare)
│   ├── /villages/vernazza (Vernazza)
│   ├── /villages/corniglia (Corniglia)
│   ├── /villages/manarola (Manarola)
│   └── /villages/riomaggiore (Riomaggiore)
├── /hiking (Hiking Trails & Routes)
├── /food-dining (Food & Dining)
├── /accommodation (Where to Stay)
└── /plan-your-trip (Plan Your Trip)
```

### Page Details

| Page | Type | Focus | SEO Target |
|------|------|-------|------------|
| **Homepage** | Homepage | Overview | "Cinque Terre Travel Guide 2025" |
| **Villages** | Section | All 5 villages | "5 Villages of Cinque Terre" |
| **Monterosso** | Village Detail | Beaches, hotels | "Monterosso al Mare Guide" |
| **Vernazza** | Village Detail | Harbor, castle | "Vernazza Cinque Terre" |
| **Corniglia** | Village Detail | Hilltop, views | "Corniglia Guide" |
| **Manarola** | Village Detail | Photography, wine | "Manarola Cinque Terre" |
| **Riomaggiore** | Village Detail | Main street, marina | "Riomaggiore Guide" |
| **Hiking** | Section | All trails | "Cinque Terre Hiking Trails" |
| **Food & Dining** | Section | Restaurants, cuisine | "Cinque Terre Restaurants" |
| **Accommodation** | Section | Hotels, B&Bs | "Cinque Terre Hotels" |
| **Plan Your Trip** | Section | Practical info | "Plan Cinque Terre Trip" |

---

## Content Blueprints (3)

### 1. Village Detail Page
**ID:** `ct-blueprint-village`
**Purpose:** Template for individual village guides

**Components:**
1. Hero image (full-width, large)
2. Breadcrumb navigation
3. Introduction (2-column layout)
4. Highlights (6-item grid)
5. Sections (history, attractions, dining, accommodation, getting-there)
6. Photo gallery (masonry layout)
7. Practical info (sidebar)
8. Related content (max 4)
9. Call-to-action (plan-trip)

### 2. Hiking Trail Page
**ID:** `ct-blueprint-trail`
**Purpose:** Template for hiking trail guides

**Components:**
1. Hero (image overlay)
2. Trail stats (distance, duration, difficulty, elevation)
3. Trail description
4. Interactive trail map
5. Numbered waypoints
6. Tips and warnings (callout)
7. Photo gallery
8. Related trails (max 3)

### 3. Restaurant/Dining Page
**ID:** `ct-blueprint-restaurant`
**Purpose:** Template for restaurant pages

**Components:**
1. Hero (image header)
2. Restaurant info (cuisine, price, hours, contact)
3. Description
4. Menu highlights (card layout)
5. Photo gallery
6. Practical details (sidebar)
7. Location map (zoom 16)
8. Similar restaurants (max 3)

---

## Editorial Tasks (12)

### Task Status Distribution

- **Backlog:** 5 tasks
- **Ready:** 3 tasks
- **In Progress:** 2 tasks
- **In Review:** 1 task
- **Blocked:** 1 task
- **Completed:** 0 tasks

### Priority Distribution

- **Urgent:** 1 task
- **High:** 5 tasks
- **Medium:** 5 tasks
- **Low:** 1 task

### Task List

#### 1. Complete Guide to Monterosso al Mare
**ID:** `ct-task-001`
**Status:** In Progress (Draft phase, 60% complete)
**Priority:** High
**Assigned:** Isabella (Travel Writer)
**Due:** 7 days from now
**Target:** 2,500 words
**Keyword:** "Monterosso al Mare"
**Progress:** Research ✅ | Outline ✅ | Draft 60% | Edit ⏸ | Review ⏸ | Publish ⏸

#### 2. Complete Guide to Vernazza
**ID:** `ct-task-002`
**Status:** Ready (Research phase)
**Priority:** High
**Assigned:** Isabella
**Due:** 10 days
**Target:** 2,500 words
**Keyword:** "Vernazza Cinque Terre"

#### 3. Corniglia: The Hilltop Village Guide
**ID:** `ct-task-003`
**Status:** Backlog
**Priority:** High
**Assigned:** Isabella
**Due:** 14 days
**Target:** 2,200 words
**Keyword:** "Corniglia Cinque Terre"

#### 4. Sentiero Azzurro Trail Guide
**ID:** `ct-task-004`
**Status:** In Review (30% complete)
**Priority:** Urgent
**Assigned:** Isabella
**Due:** 3 days
**Target:** 3,000 words
**Keyword:** "Sentiero Azzurro"
**Progress:** Research ✅ | Outline ✅ | Draft ✅ | Edit ✅ | Review 30% | Publish ⏸

#### 5. Via dell'Amore Trail Guide
**ID:** `ct-task-005`
**Status:** Blocked
**Priority:** Medium
**Assigned:** Isabella
**Due:** 20 days
**Target:** 1,800 words
**Keyword:** "Via dell Amore"
**Note:** Blocked - awaiting trail reopening confirmation

#### 6. Top 15 Restaurants in Cinque Terre
**ID:** `ct-task-006`
**Status:** Ready
**Priority:** High
**Assigned:** Giulia (Food Writer)
**Due:** 12 days
**Target:** 2,800 words
**Keyword:** "Cinque Terre restaurants"
**Dependencies:** Tasks 001, 002 (village guides)

#### 7. Ligurian Cuisine: What to Eat
**ID:** `ct-task-007`
**Status:** In Progress (Outline phase, 40% complete)
**Priority:** Medium
**Assigned:** Giulia
**Due:** 15 days
**Target:** 2,200 words
**Keyword:** "Ligurian cuisine"
**Progress:** Research ✅ | Outline 40% | Draft ⏸ | Edit ⏸ | Review ⏸ | Publish ⏸

#### 8. How to Get to Cinque Terre
**ID:** `ct-task-008`
**Status:** Backlog
**Priority:** High
**Assigned:** Isabella
**Due:** 18 days
**Target:** 2,000 words
**Keyword:** "how to get to Cinque Terre"

#### 9. Best Time to Visit Cinque Terre
**ID:** `ct-task-009`
**Status:** Ready
**Priority:** High
**Assigned:** Isabella
**Due:** 8 days
**Target:** 1,800 words
**Keyword:** "best time to visit Cinque Terre"

#### 10. Cinque Terre 3-Day Itinerary
**ID:** `ct-task-010`
**Status:** Backlog
**Priority:** Medium
**Assigned:** Isabella
**Due:** 25 days
**Target:** 2,500 words
**Keyword:** "Cinque Terre 3 day itinerary"

#### 11. History and Culture of Cinque Terre
**ID:** `ct-task-011`
**Status:** Backlog
**Priority:** Medium
**Assigned:** Lorenzo (Culture Writer)
**Due:** 30 days
**Target:** 2,300 words
**Keyword:** "Cinque Terre history"

#### 12. Local Festivals and Events
**ID:** `ct-task-012`
**Status:** Backlog
**Priority:** Low
**Assigned:** Lorenzo
**Due:** 35 days
**Target:** 1,500 words
**Keyword:** "Cinque Terre festivals"

---

## Task Dependencies

```
Task 001 (Monterosso Guide) ────┐
                                 ├──> Task 006 (Top 15 Restaurants)
Task 002 (Vernazza Guide) ──────┘          │
                                            └──> Task 007 (Ligurian Cuisine)
```

---

## Agent Activities (5 Recent)

1. **Isabella** started Task 001 (Monterosso Guide)
   - Researching beaches and accommodation
   - Estimated completion: 2025-11-30

2. **Giulia** started Task 007 (Ligurian Cuisine)
   - Outlining pesto, focaccia, seafood, and wine sections

3. **Marco** reviewing Task 004 (Sentiero Azzurro)
   - Checking trail conditions, practical info, and safety

4. **Alex** optimizing Monterosso page
   - Added 5 keywords, updated meta descriptions

5. **Sophia** quarterly planning
   - Q1 2026 content strategy review
   - Priority topics: seasonal guides, hidden gems, sustainability

---

## AI Suggestions (5 Pending)

### 1. Create "Cinque Terre on a Budget" Guide
**From:** Alex (SEO Specialist)
**Type:** New Content
**Priority:** High
**Rationale:** High search volume (2,400/mo) with low competition

### 2. Add FAQ Section to Hiking Page
**From:** Alex
**Type:** SEO Optimization
**Priority:** Medium
**Rationale:** Featured snippet opportunity, improves user experience

### 3. Update Restaurant Listings (2025 Data)
**From:** Giulia (Food Writer)
**Type:** Content Update
**Priority:** High
**Status:** Approved
**Rationale:** Content accuracy crucial for trust

### 4. Add Interactive Trail Map
**From:** Francesca (Media Coordinator)
**Type:** New Feature
**Priority:** Medium
**Rationale:** Enhances UX, differentiates from competitors

### 5. Monthly Photo Contest
**From:** Lorenzo (Culture Writer)
**Type:** New Content
**Priority:** Low
**Rationale:** Community building, UGC, social engagement

---

## Testing Scenarios

### 1. Kanban Board Testing
**URL:** `/editorial/kanban`

**Test:**
- View 12 tasks across 6 columns
- Drag Task 002 from "Ready" to "In Progress"
- Filter by agent (Isabella should show 7 tasks)
- Filter by priority (High should show 5 tasks)
- Search for "restaurant" (should find Task 006)

### 2. Gantt Timeline Testing
**URL:** `/editorial/gantt`

**Test:**
- View all 12 tasks on timeline
- See Task 001 with 60% draft phase progress
- See Task 004 with review phase highlighted
- See dependency arrows: 001→006 and 002→006
- Filter by "In Progress" (should show 2 tasks)

### 3. Graph View Testing
**URL:** `/editorial/graph`

**Test:**
- View task network diagram
- See 12 nodes in hierarchical layout
- See dependency edges connecting tasks
- Click Task 001 to open detail modal
- Filter by "Giulia" agent (should show 2 tasks)

### 4. Task Detail Modal Testing

**Test:**
- Click any task card
- Navigate through 5 tabs (Overview, Phases, SEO, Links, GitHub)
- View phase checklist with completion status
- See SEO metadata (keywords, word count)
- Test GitHub integration (create Issue/PR)

### 5. Sitemap Editor Testing
**URL:** `/sitemap`

**Test:**
- View 11 pages in tree structure
- Expand "Villages" section (5 children)
- See page metadata and status
- Create new page under "Food & Dining"
- Drag pages to reorder

### 6. Agent List Testing
**URL:** `/agents`

**Test:**
- View all 8 agents
- Filter by department (Writers Room should show 3)
- View agent capabilities
- See recent activities per agent

---

## Data Metrics

### Content Coverage

| Topic Area | Pages | Tasks | Completion |
|------------|-------|-------|------------|
| **Villages** | 6 | 3 | 33% (1/3 in progress) |
| **Hiking** | 1 | 2 | 50% (1 in review) |
| **Food & Dining** | 1 | 2 | 50% (1 in progress) |
| **Planning** | 1 | 3 | 0% (all backlog/ready) |
| **Culture** | 0 | 2 | 0% (all backlog) |

### Workload Distribution

| Agent | Assigned Tasks | In Progress | Priority |
|-------|----------------|-------------|----------|
| **Isabella** | 7 | 1 | Travel content |
| **Giulia** | 2 | 1 | Food content |
| **Lorenzo** | 2 | 0 | Culture content |
| **Others** | 0 | 0 | Support roles |

### Timeline Overview

- **Next 7 days:** 1 urgent task due (Sentiero Azzurro)
- **Next 14 days:** 5 high-priority tasks due
- **Next 30 days:** 9 tasks due total
- **Beyond 30 days:** 3 cultural content tasks

---

## Expansion Opportunities

### Phase 2 Content (Future)

1. **Accommodation Guides**
   - Hotel reviews per village
   - B&B recommendations
   - Vacation rental guide

2. **Practical Guides**
   - Cinque Terre Card guide
   - Photography tips
   - Family travel guide
   - Accessibility information

3. **Seasonal Content**
   - Summer in Cinque Terre
   - Off-season advantages
   - Christmas and New Year

4. **Activity Guides**
   - Kayaking and boat tours
   - Wine tasting experiences
   - Cooking classes
   - Scuba diving

5. **Day Trips**
   - Portovenere guide
   - La Spezia city guide
   - Portofino day trip
   - Genoa attractions

### Additional Features

1. **Interactive Elements**
   - Real-time weather widget
   - Train schedule integration
   - Restaurant booking links
   - Hotel availability search

2. **User-Generated Content**
   - Visitor reviews
   - Photo sharing
   - Travel tips forum
   - Q&A section

3. **Multimedia**
   - Video tours of villages
   - 360° panoramas
   - Audio guides
   - Drone footage

---

## Maintenance Tasks

### Weekly
- Update restaurant hours/prices
- Check trail conditions
- Verify hotel availability
- Monitor search rankings

### Monthly
- Review and update all guides
- Add new restaurant openings
- Update seasonal information
- Analyze traffic and optimize

### Quarterly
- Major content refreshes
- SEO audit and optimization
- User feedback review
- Competition analysis

---

## Success Metrics

### Content Metrics
- **Total Pages:** 11 (growing to 30+)
- **Total Words:** ~25,000 target across all tasks
- **Update Frequency:** Weekly for key pages
- **Content Freshness:** <3 months old

### SEO Metrics
- **Target Keywords:** 50+ primary keywords
- **Search Visibility:** Track top 10 rankings
- **Organic Traffic:** Month-over-month growth
- **Featured Snippets:** Target 5+ FAQs

### Engagement Metrics
- **Time on Site:** >3 minutes average
- **Pages per Session:** >2.5 average
- **Bounce Rate:** <60%
- **Return Visitors:** >20%

---

## Troubleshooting

### If tasks don't show up:
```sql
SELECT * FROM editorial_tasks WHERE website_id = 'ct-website-001';
```

### If phases are missing:
```sql
SELECT COUNT(*) FROM task_phases WHERE task_id LIKE 'ct-task-%';
-- Should return 72+ rows
```

### If agents don't appear:
```sql
SELECT name, status FROM agents WHERE id LIKE 'ct-agent-%';
-- Should return 8 agents, all 'active'
```

### Reset and re-run:
```sql
-- Delete all Cinqueterre data
BEGIN;
DELETE FROM agent_activities WHERE agent_id LIKE 'ct-%';
DELETE FROM suggestions WHERE website_id LIKE 'ct-%';
DELETE FROM task_phases WHERE task_id LIKE 'ct-%';
DELETE FROM editorial_tasks WHERE id LIKE 'ct-%';
DELETE FROM blueprints WHERE id LIKE 'ct-%';
DELETE FROM pages WHERE id LIKE 'ct-%';
DELETE FROM websites WHERE id LIKE 'ct-%';
DELETE FROM agents WHERE id LIKE 'ct-%';
DELETE FROM roles WHERE id LIKE 'ct-%';
DELETE FROM departments WHERE id LIKE 'ct-%';
DELETE FROM companies WHERE id LIKE 'ct-%';
COMMIT;

-- Then re-run setup script
```

---

## Next Steps

1. **Run the setup script** to populate the database
2. **Start the backend server** (`npm run dev` in packages/backend)
3. **Start the admin app** (`npm run dev` in apps/admin)
4. **Navigate to** `http://localhost:3002/editorial/kanban`
5. **Explore all three views** (Kanban, Gantt, Graph)
6. **Test task management** (create, update, drag-drop)
7. **Try sitemap editor** at `/sitemap`
8. **View agents** at `/agents`

---

## Summary

This setup provides a **complete, realistic testing environment** for the swarm.press platform featuring:

✅ **Organizational Structure** - Full company hierarchy
✅ **AI Agents** - 8 specialized agents with personalities
✅ **Content Strategy** - 12 tasks covering real travel topics
✅ **Workflow States** - Tasks in all stages for testing
✅ **Dependencies** - Task relationships for graph testing
✅ **Phase Tracking** - 72+ phases with varied progress
✅ **SEO Data** - Keywords and targets for optimization
✅ **Sitemap** - 11 pages in logical hierarchy
✅ **Blueprints** - 3 reusable templates
✅ **Activities** - Recent agent work
✅ **Suggestions** - AI-generated ideas

**Perfect for demonstrating and testing all platform features!**

---

**Created:** 2025-11-23
**Version:** 1.0
**Status:** Production-Ready Test Data
