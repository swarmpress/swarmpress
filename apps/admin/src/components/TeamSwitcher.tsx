import { useState, useEffect } from 'react'
import { Building2, Globe, ChevronsUpDown, Check, Plus, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

interface Tenant {
  id: string
  name: string
  description?: string
}

interface Product {
  id: string
  domain: string
  title?: string
  company_id: string
}

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null)
  const [currentProductId, setCurrentProductId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Get current tenant and product from cookies
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = value
      return acc
    }, {} as Record<string, string>)

    const tenantId =
      cookies['swarmpress_tenant_id'] || cookies['tenant_id'] || null
    const productId =
      cookies['swarmpress_product_id'] || cookies['product_id'] || null

    setCurrentTenantId(tenantId)
    setCurrentProductId(productId)

    // Fetch tenants
    fetch('http://localhost:3000/api/trpc/company.list?input={}')
      .then((res) => res.json())
      .then((data) => {
        const items = data.result?.data?.json?.items || []
        setTenants(items)

        // If tenant is selected, fetch products
        if (tenantId) {
          return fetch('http://localhost:3000/api/trpc/website.list?input={}')
            .then((res) => res.json())
            .then((data) => {
              const allProducts = data.result?.data?.json?.items || []
              console.log('All products:', allProducts)
              console.log('Current tenantId:', tenantId)
              console.log('Products with company_id:', allProducts.map((p: Product) => ({ id: p.id, domain: p.domain, company_id: p.company_id })))

              const tenantProducts = allProducts.filter(
                (p: Product) => p.company_id === tenantId
              )
              console.log('Filtered tenant products:', tenantProducts)
              setProducts(tenantProducts)
              setIsLoading(false)
            })
        } else {
          setIsLoading(false)
        }
      })
      .catch((err) => {
        console.error('Failed to fetch data:', err)
        setIsLoading(false)
      })
  }, [])

  const currentTenant = tenants.find((t) => t.id === currentTenantId)
  const currentProduct = products.find((p) => p.id === currentProductId)

  const switchTenant = (tenantId: string) => {
    document.cookie = `swarmpress_tenant_id=${tenantId}; path=/; max-age=31536000`
    document.cookie = `swarmpress_product_id=; path=/; max-age=0`
    window.location.href = '/'
  }

  const switchProduct = (productId: string) => {
    document.cookie = `swarmpress_product_id=${productId}; path=/; max-age=31536000`
    window.location.reload()
  }

  const clearProduct = () => {
    document.cookie = `swarmpress_product_id=; path=/; max-age=0`
    window.location.reload()
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
              type="button"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {currentProduct ? (
                  <Globe className="size-4" />
                ) : (
                  <Building2 className="size-4" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {currentProduct?.domain || currentTenant?.name || 'Select...'}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {currentProduct
                    ? currentProduct.title || 'Website'
                    : currentTenant
                      ? 'Media House'
                      : ''}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            {/* Current Selection */}
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {currentProduct ? (
                    <Globe className="size-4" />
                  ) : (
                    <Building2 className="size-4" />
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {currentProduct?.domain || currentTenant?.name || 'Select...'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {currentProduct
                      ? currentProduct.title || 'Website'
                      : currentTenant
                        ? 'Media House'
                        : ''}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            {/* Products Section - Show when tenant is selected */}
            {currentTenantId && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Products
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {/* Option to clear product selection */}
                  {currentProductId && (
                    <DropdownMenuItem
                      onClick={clearProduct}
                      className="gap-2"
                    >
                      <X className="size-4" />
                      <div className="flex-1 overflow-hidden">
                        <div className="line-clamp-1 text-sm">All Products</div>
                        <div className="line-clamp-1 text-xs text-muted-foreground">
                          View tenant-level dashboard
                        </div>
                      </div>
                    </DropdownMenuItem>
                  )}

                  {/* List of products */}
                  {products.length > 0 ? (
                    products.map((product) => (
                      <DropdownMenuItem
                        key={product.id}
                        onClick={() => switchProduct(product.id)}
                        className="gap-2"
                      >
                        <Globe className="size-4" />
                        <div className="flex-1 overflow-hidden">
                          <div className="line-clamp-1 text-sm">{product.domain}</div>
                          {product.title && (
                            <div className="line-clamp-1 text-xs text-muted-foreground">
                              {product.title}
                            </div>
                          )}
                        </div>
                        {product.id === currentProductId && (
                          <Check className="size-4 shrink-0" />
                        )}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground italic">
                      No products yet
                    </div>
                  )}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem asChild>
                  <a href="/websites/new" className="gap-2">
                    <Plus className="size-4" />
                    <span>Add Product</span>
                  </a>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
              </>
            )}

            {/* Tenants Section */}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Media Houses
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {tenants.map((tenant) => (
                <DropdownMenuItem
                  key={tenant.id}
                  onClick={() => switchTenant(tenant.id)}
                  className="gap-2"
                >
                  <Building2 className="size-4" />
                  <div className="flex-1 overflow-hidden">
                    <div className="line-clamp-1 text-sm">{tenant.name}</div>
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
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <a href="/tenants/new" className="gap-2">
                <Plus className="size-4" />
                <span>Add Media House</span>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
