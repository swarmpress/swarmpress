# Admin App Development Status

## ✅ Completed Setup

### 1. Multi-Tenant Architecture Fixed
- ✅ Added `company_id` to `websites` table
- ✅ Proper tenant → websites relationship
- ✅ Documentation created (`MULTI-TENANT-ARCHITECTURE.md`)
- ✅ Migration `003_add_website_company_link.sql`

### 2. Database Seeded
- ✅ **Tenant**: Cinqueterre.travel Media House
- ✅ **Departments**: Editorial, Engineering, Governance (3)
- ✅ **Roles**: Writer, Editor, Engineer, CEO Assistant (4)
- ✅ **Agents**: Alex, Jordan, Morgan, Casey (4) - Claude Sonnet 4.5
- ✅ **Website**: cinqueterre.travel
- ✅ **Content**: 5 article ideas
- ✅ **Tasks**: 2 planned brief creation tasks

### 3. Admin App Infrastructure
- ✅ Package structure at `/apps/admin`
- ✅ Astro + React configuration
- ✅ shadcn/ui dependencies installed
- ✅ Tailwind configured with shadcn theme
- ✅ Base layout with sidebar navigation
- ✅ Dashboard homepage
- ✅ Utility functions (`cn()`)

## 📁 Current File Structure

```
/apps/admin/
├── package.json (✅ shadcn/ui deps)
├── astro.config.mjs (✅ configured)
├── tailwind.config.mjs (✅ shadcn theme)
├── tsconfig.json (✅ React + path aliases)
└── src/
    ├── layouts/
    │   └── Layout.astro (✅ sidebar navigation)
    ├── pages/
    │   ├── index.astro (✅ dashboard)
    │   └── tenants/
    │       └── index.astro (✅ tenants list page)
    └── lib/
        └── utils.ts (✅ cn() utility)
```

## 🚧 Next Steps Required

### Phase 1: shadcn/ui Components (PRIORITY)

Create these shadcn components in `/apps/admin/src/components/ui/`:

1. **Button** - Primary action component
   ```tsx
   // src/components/ui/button.tsx
   import { ButtonHTMLAttributes, forwardRef } from 'react'
   import { cva, VariantProps } from 'class-variance-authority'
   import { cn } from '@/lib/utils'
   ```

2. **Card** - Container for content sections
3. **Table** - Data display for lists
4. **Dialog** - Modals for create/edit forms
5. **Form** - Input fields with validation
6. **Select** - Dropdown selections
7. **Badge** - Status indicators

### Phase 2: API Integration

Create tRPC client utilities:

```typescript
// src/lib/trpc.ts
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@swarm-press/backend'
import SuperJSON from 'superjson'

export const trpc = createTRPCProxyClient<AppRouter>({
  transformer: SuperJSON,
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/api/trpc',
    }),
  ],
})
```

### Phase 3: Tenant Management (CRUD)

Create these components and pages:

1. **`TenantsList.tsx`** - React component
   - Fetch from `trpc.companies.list()`
   - Display in shadcn Table
   - Actions: Edit, Delete, View Details

2. **`/tenants/new`** - Create tenant page
   - Form with fields: name, description
   - Submit to `trpc.companies.create()`

3. **`/tenants/[id]`** - Edit tenant page
   - Load existing tenant data
   - Update form
   - Submit to `trpc.companies.update()`

4. **`/tenants/[id]/agents`** - Tenant's agents
   - Filter agents by tenant
   - Manage org structure

### Phase 4: Agent Management

1. **`/agents/index`** - List all agents
2. **`/agents/new`** - Create agent form
3. **`/agents/[id]`** - Edit agent
4. Features:
   - Tenant selector (filter by media house)
   - Department & Role assignment
   - Capabilities management (JSON editor)
   - Virtual email configuration

### Phase 5: Website Management

1. **`/websites/index`** - List websites
2. **`/websites/new`** - Add website
3. **`/websites/[id]`** - Edit website
4. Features:
   - Link to tenant (company_id)
   - Domain configuration
   - GitHub repo settings
   - Deployment status

### Phase 6: Content Management

1. **`/content/index`** - Browse content
2. **`/content/[id]`** - View/edit content metadata
3. Features:
   - Filter by website, status, author
   - Status workflow visualization
   - JSON block editor
   - GitHub sync status
   - Publish to GitHub action

### Phase 7: Task Management

1. **`/tasks/index`** - Task list
2. **`/tasks/[id]`** - Task details
3. Features:
   - Assign to agents
   - Update status (planned → in_progress → completed)
   - Link to content items
   - Notes/instructions

## 🏗️ Recommended Build Order

### Week 1: Foundation
1. ✅ Admin app structure (DONE)
2. ⏳ Create all shadcn/ui components
3. ⏳ Set up tRPC client
4. ⏳ Create base React hooks for data fetching

### Week 2: Core CRUD
1. ⏳ Tenant management (complete CRUD)
2. ⏳ Agent management (complete CRUD)
3. ⏳ Basic navigation and routing

### Week 3: Content & Workflows
1. ⏳ Website management
2. ⏳ Content browser
3. ⏳ Task management

### Week 4: Integration & Polish
1. ⏳ GitHub integration UI
2. ⏳ Real-time updates
3. ⏳ Error handling & validation
4. ⏳ Deployment preparation

## 🎯 Immediate Next Action

**Create shadcn/ui components**. These are the building blocks for all CRUD interfaces.

Would you like me to:
1. ✅ Create all shadcn/ui components (Button, Card, Table, Dialog, Form, etc.)
2. Build the complete tenant management interface
3. Set up tRPC client and API integration

## 📊 Running Services

- ✅ **Backend API**: http://localhost:3000 (Running)
- ✅ **Dashboard**: http://localhost:3001 (Running)
- ⏳ **Admin App**: Port 3002 (Ready to start)

To start admin app:
```bash
npx pnpm --filter @swarm-press/admin dev
```

## 🗂️ Database Status

```
Cinqueterre.travel (Media House)
├── 4 Agents (Claude Sonnet 4.5)
├── 3 Departments
├── 4 Roles
└── 1 Website (cinqueterre.travel)
    ├── 5 Content Items (idea status)
    └── 2 Tasks (planned)
```

All ready for management through the admin interface!
