# swarm.press - Complete Setup Guide

## 🎉 What Has Been Built

### 1. Multi-Tenant Architecture ✅

**Fixed Critical Schema Issue**:
- Added `company_id` to `websites` table
- Proper tenant isolation
- Migration: `003_add_website_company_link.sql`

**Correct Hierarchy**:
```
Tenant (Media House/Company)
├── Departments
│   └── Roles
│       └── Agents (AI Employees)
└── Websites (Media Properties)
    ├── Content Items
    ├── Tasks
    └── Web Pages
```

### 2. Database Seeded ✅

**Cinqueterre.travel Media House**:
- ID: `00000000-0000-0000-0000-000000000001`
- 3 Departments: Editorial, Engineering, Governance
- 4 Roles: Writer, Editor, Engineer, CEO Assistant
- 4 AI Agents (Claude Sonnet 4.5):
  - Alex (Writer) - `30000000-0000-0000-0000-000000000001`
  - Jordan (Editor) - `30000000-0000-0000-0000-000000000002`
  - Morgan (Engineer) - `30000000-0000-0000-0000-000000000003`
  - Casey (CEO Assistant) - `30000000-0000-0000-0000-000000000004`
- 1 Website: cinqueterre.travel
- 5 Content Items (idea status)
- 2 Tasks (planned status)

### 3. Running Services ✅

```
Backend API:    http://localhost:3000  ✅ Running
Dashboard:      http://localhost:3001  ✅ Running
Admin App:      http://localhost:3002  ⏳ Ready
```

### 4. Admin App Foundation ✅

**Structure**:
```
/apps/admin/
├── package.json          ✅ shadcn/ui deps
├── astro.config.mjs      ✅ Astro + React
├── tailwind.config.mjs   ✅ shadcn theme
├── tsconfig.json         ✅ TypeScript
└── src/
    ├── layouts/
    │   └── Layout.astro  ✅ Sidebar navigation
    ├── pages/
    │   ├── index.astro   ✅ Dashboard
    │   └── tenants/
    │       └── index.astro ✅ Tenant list
    ├── components/ui/
    │   ├── button.tsx    ✅ shadcn Button
    │   ├── card.tsx      ✅ shadcn Card
    │   └── table.tsx     ✅ shadcn Table
    └── lib/
        └── utils.ts      ✅ cn() utility
```

## 🚀 How to Run Everything

### Start All Services

```bash
# Terminal 1: Backend API
npx pnpm --filter @swarm-press/backend dev
# → http://localhost:3000

# Terminal 2: Monitoring Dashboard
npx pnpm --filter @swarm-press/dashboard dev
# → http://localhost:3001

# Terminal 3: Admin App
npx pnpm --filter @swarm-press/admin dev
# → http://localhost:3002
```

### Verify Services

```bash
# Check backend health
curl http://localhost:3000/health

# Expected output:
# {
#   "status": "healthy",
#   "services": {
#     "database": "connected",
#     "eventBus": "connected"
#   }
# }
```

## 📝 Next Development Steps

### Phase 1: Complete shadcn/ui Components

Create remaining components in `/apps/admin/src/components/ui/`:

**1. Badge** (`badge.tsx`):
```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

**2. Label** (`label.tsx`):
```tsx
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className
    )}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
```

**3. Input** (`input.tsx`):
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
```

**4. Textarea** (`textarea.tsx`):
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
```

### Phase 2: Add CSS Variables

Add to `/apps/admin/src/layouts/Layout.astro` in the `<style>` section:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }
}
```

### Phase 3: Create tRPC Client

**File**: `/apps/admin/src/lib/trpc.ts`

```typescript
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../packages/backend/src/api/routers'
import SuperJSON from 'superjson'

export const trpc = createTRPCProxyClient<AppRouter>({
  transformer: SuperJSON,
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/api/trpc',
    }),
  ],
})

// React Query wrapper (for client components)
export async function fetchTenants() {
  const companies = await fetch('http://localhost:3000/api/companies')
    .then(res => res.json())
  return companies
}
```

### Phase 4: Build Tenant Management

**File**: `/apps/admin/src/components/TenantsList.tsx`

```tsx
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Badge } from './ui/badge'

interface Tenant {
  id: string
  name: string
  description?: string
  created_at: string
}

export default function TenantsList({ apiUrl }: { apiUrl: string }) {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTenants()
  }, [])

  async function fetchTenants() {
    try {
      // For now, use direct SQL query result
      // TODO: Replace with tRPC call
      const mockData: Tenant[] = [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Cinqueterre.travel',
          description: 'Virtual media house for the Cinque Terre travel portal',
          created_at: new Date().toISOString(),
        },
      ]
      setTenants(mockData)
    } catch (error) {
      console.error('Failed to fetch tenants:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Media Houses</CardTitle>
        <CardDescription>
          Manage virtual media houses and their properties
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">{tenant.name}</TableCell>
                <TableCell>{tenant.description}</TableCell>
                <TableCell>
                  {new Date(tenant.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Badge>Active</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm">
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
```

## 📚 Documentation Files

- `MULTI-TENANT-ARCHITECTURE.md` - Architecture guide
- `ADMIN-APP-STATUS.md` - Development roadmap
- `SETUP-COMPLETE-GUIDE.md` - This file

## 🎯 Summary

You now have:
- ✅ Proper multi-tenant database schema
- ✅ Cinqueterre.travel media house fully set up
- ✅ Backend API running with tRPC
- ✅ Monitoring dashboard
- ✅ Admin app foundation with shadcn/ui
- ✅ Essential UI components (Button, Card, Table)
- ⏳ Ready to build complete CRUD interfaces

Next session: Complete remaining UI components and build full tenant management interface!
