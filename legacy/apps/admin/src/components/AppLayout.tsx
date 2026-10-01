import * as React from 'react'
import { AppSidebar } from './AppSidebar'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from './ui/sidebar'
import { Separator } from './ui/separator'

interface AppLayoutProps {
  title: string
  tenantId: string | null
  productId: string | null
  user?: {
    github_login: string
    display_name: string | null
    email: string | null
    avatar_url: string | null
    role: string
  }
  children: React.ReactNode
}

export function AppLayout({ title, tenantId, productId, user, children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <AppSidebar tenantId={tenantId} productId={productId} user={user} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4 data-[orientation=vertical]:h-4" />
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
