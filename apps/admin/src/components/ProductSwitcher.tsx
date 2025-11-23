import { useState, useEffect } from 'react'
import { Globe, ChevronsUpDown, Check } from 'lucide-react'
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

interface Product {
  id: string
  domain: string
  title?: string
  company_id: string
}

export function ProductSwitcher() {
  const [products, setProducts] = useState<Product[]>([])
  const [currentProductId, setCurrentProductId] = useState<string | null>(null)
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null)
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

    if (!tenantId) {
      setIsLoading(false)
      return
    }

    // Fetch products
    fetch('http://localhost:3000/api/trpc/website.list')
      .then((res) => res.json())
      .then((data) => {
        const allProducts = data.result?.data?.json?.items || []
        const tenantProducts = allProducts.filter(
          (p: Product) => p.company_id === tenantId
        )
        setProducts(tenantProducts)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch products:', err)
        setIsLoading(false)
      })
  }, [])

  const currentProduct = products.find((p) => p.id === currentProductId)

  const switchProduct = (productId: string) => {
    document.cookie = `swarmpress_product_id=${productId}; path=/; max-age=31536000`
    window.location.reload()
  }

  if (!currentTenantId) {
    return null
  }

  if (products.length === 0 && !isLoading) {
    return (
      <div className="px-2 py-2">
        <div className="bg-yellow-900/20 border border-yellow-700 rounded px-3 py-2 text-xs text-yellow-400">
          ⚠️ No products found.{' '}
          <a href="/websites/new" className="underline">
            Create one
          </a>
        </div>
      </div>
    )
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
                <Globe className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {currentProduct?.domain || 'Select Product'}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {currentProduct?.title || 'Website'}
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
              Products
            </DropdownMenuLabel>
            {products.map((product) => (
              <DropdownMenuItem
                key={product.id}
                onClick={() => switchProduct(product.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <Globe className="size-4 shrink-0" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="line-clamp-1 font-medium">{product.domain}</div>
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
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/websites/new" className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border border-dashed">
                  <Globe className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Add Website
                </div>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
