import { useState, useEffect } from 'react'
import { Building2, ChevronsUpDown, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

interface Tenant {
  id: string
  name: string
  description?: string
}

export function TenantSwitcher() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Get current tenant from cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = value
      return acc
    }, {} as Record<string, string>)

    setCurrentTenantId(
      cookies['swarmpress_tenant_id'] || cookies['tenant_id'] || null
    )

    // Fetch tenants
    fetch('http://localhost:3000/api/trpc/company.list')
      .then((res) => res.json())
      .then((data) => {
        const items = data.result?.data?.json?.items || []
        setTenants(items)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch tenants:', err)
        setIsLoading(false)
      })
  }, [])

  const currentTenant = tenants.find((t) => t.id === currentTenantId)

  const switchTenant = (tenantId: string) => {
    document.cookie = `swarmpress_tenant_id=${tenantId}; path=/; max-age=31536000`
    document.cookie = `swarmpress_product_id=; path=/; max-age=0`
    window.location.href = '/'
  }

  if (!currentTenant && !isLoading) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {currentTenant?.name || 'Select Media House'}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  Media House
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Media Houses
            </DropdownMenuLabel>
            {tenants.map((tenant) => (
              <DropdownMenuItem
                key={tenant.id}
                onClick={() => switchTenant(tenant.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <Building2 className="size-4 shrink-0" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="line-clamp-1 font-medium">{tenant.name}</div>
                  {tenant.description && (
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                      {tenant.description}
                    </div>
                  )}
                </div>
                {tenant.id === currentTenantId && (
                  <Check className="size-4 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/tenants/new" className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border border-dashed">
                  <Building2 className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Add Media House
                </div>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
