# Multi-Tenant Architecture for swarm.press

## Overview

swarm.press is a **multi-tenant platform** where each tenant is a **virtual media house** that manages multiple **media properties (websites)**.

## Architecture Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│ TENANT (Media House / Company)                              │
│ - Organizational entity                                     │
│ - Has CEO and employees (agents)                            │
│ - Manages multiple websites                                 │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ORGANIZATION STRUCTURE                                  │ │
│ │                                                         │ │
│ │ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│ │ │ Departments  │  │    Roles     │  │   Agents     │  │ │
│ │ │              │  │              │  │              │  │ │
│ │ │ • Editorial  │  │ • Writer     │  │ • Alex       │  │ │
│ │ │ • Engineering│  │ • Editor     │  │ • Jordan     │  │ │
│ │ │ • Governance │  │ • Engineer   │  │ • Morgan     │  │ │
│ │ │              │  │ • CEO Asst   │  │ • Casey      │  │ │
│ │ └──────────────┘  └──────────────┘  └──────────────┘  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ MEDIA PROPERTIES (Websites)                             │ │
│ │                                                         │ │
│ │ ┌──────────────────┐  ┌──────────────────┐             │ │
│ │ │ cinqueterre.travel│  │  future-site.com │             │ │
│ │ │                  │  │                  │             │ │
│ │ │ • Content Items  │  │ • Content Items  │             │ │
│ │ │ • Web Pages      │  │ • Web Pages      │             │ │
│ │ │ • Tasks          │  │ • Tasks          │             │ │
│ │ └──────────────────┘  └──────────────────┘             │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### Core Entities

```sql
-- TENANT LEVEL
companies (tenants/media houses)
  ├── departments (organizational units within tenant)
  │   └── roles (job roles within departments)
  │       └── agents (AI employees with specific roles)
  └── websites (media properties owned by tenant)
      ├── web_pages (individual pages)
      └── content_items (content within pages)
          ├── tasks (work assignments)
          ├── reviews (editorial reviews)
          └── question_tickets (questions/decisions)
```

### Key Relationships

```sql
companies (id)
  ↓
  ├─→ departments (company_id)
  │     ↓
  │     └─→ roles (department_id)
  │           ↓
  │           └─→ agents (role_id, department_id)
  │
  └─→ websites (company_id) ← NEW RELATIONSHIP
        ↓
        └─→ content_items (website_id)
              ├─→ tasks (website_id, content_id)
              ├─→ reviews (content_id)
              └─→ question_tickets (website_id)
```

## Example: Cinque Terre Media House

### Tenant Configuration

**Company**: Cinqueterre.travel (Tenant ID: `00000000-0000-0000-0000-000000000001`)

**Departments**:
- Editorial - Content creation and oversight
- Engineering - Technical operations
- Governance - Strategic leadership

**Agents** (4):
- **Alex** (Writer, Editorial) - Travel content specialist
- **Jordan** (Editor, Editorial) - Quality & storytelling
- **Morgan** (Engineer, Engineering) - Technical expert
- **Casey** (CEO Assistant, Governance) - Strategy & coordination

**Media Properties** (Websites):
1. **cinqueterre.travel** - Italian Riviera travel guide
   - 5 content items (articles)
   - 2 planned tasks

2. *(Future)* - Additional properties can be added

## Multi-Tenancy Benefits

### Data Isolation
- Each media house operates independently
- Agents belong to ONE media house
- Content is scoped to specific websites within a media house

### Scalability
- Add new media houses without affecting existing ones
- Each media house can manage unlimited websites
- Agents can work across all websites within their media house

### Organization
- Clear hierarchy: Tenant → Departments → Roles → Agents
- Websites clearly owned by specific media houses
- Content linked to both website AND authoring agent

## Usage Patterns

### Creating a New Media House

```typescript
// 1. Create the company (tenant)
const mediaHouse = await createCompany({
  name: "New Media House",
  description: "Description"
})

// 2. Create departments
const editorial = await createDepartment({
  company_id: mediaHouse.id,
  name: "Editorial"
})

// 3. Create roles
const writerRole = await createRole({
  department_id: editorial.id,
  name: "Writer"
})

// 4. Create agents
const writer = await createAgent({
  role_id: writerRole.id,
  department_id: editorial.id,
  name: "Alex",
  ...
})

// 5. Create website(s)
const website = await createWebsite({
  company_id: mediaHouse.id,  // Links to media house!
  domain: "example.com",
  title: "Example Site"
})
```

### Querying Data (Tenant-Scoped)

```sql
-- Get all websites for a media house
SELECT * FROM websites WHERE company_id = :tenant_id;

-- Get all agents in a media house
SELECT a.*
FROM agents a
JOIN departments d ON a.department_id = d.id
WHERE d.company_id = :tenant_id;

-- Get all content for a media house
SELECT ci.*
FROM content_items ci
JOIN websites w ON ci.website_id = w.id
WHERE w.company_id = :tenant_id;
```

## API Design (Multi-Tenant)

All API endpoints should be scoped to a tenant:

```
/api/v1/tenants/:tenantId/websites
/api/v1/tenants/:tenantId/agents
/api/v1/tenants/:tenantId/content
/api/v1/tenants/:tenantId/tasks
```

Or use tenant context from authentication:

```typescript
// Middleware extracts tenant from auth token
app.use(async (req, res, next) => {
  const tenantId = await getTenantFromAuth(req)
  req.tenant = tenantId
  next()
})

// Routes automatically scoped
app.get('/api/websites', (req, res) => {
  const websites = await getWebsites(req.tenant)
  res.json(websites)
})
```

## Future Considerations

### Additional Tenants

The platform can support multiple media houses:

- **Cinqueterre.travel** - Italian Riviera guide
- **Paris Tourism Co** - Paris travel guides
- **Tech Blog Network** - Technology blogs
- etc.

Each tenant:
- Has its own agents (employees)
- Manages its own websites
- Operates independently
- Uses Claude Sonnet 4.5 agents

### Cross-Tenant Features (Future)

- Marketplace for content templates
- Shared agent capabilities (opt-in)
- Platform-wide analytics (aggregated)
- Multi-tenant admin dashboard

## Summary

✅ **Correct**: `companies` table = Tenants (Media Houses)
✅ **Correct**: Each tenant has departments → roles → agents
✅ **Correct**: Each tenant owns multiple websites
✅ **Correct**: Agents work on any website within their tenant
✅ **Fixed**: `websites.company_id` now links websites to tenants

This architecture enables swarm.press to serve multiple virtual media houses, each autonomous and independently managed by AI agents.
