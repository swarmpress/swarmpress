import * as React from 'react'
import {
  Building2,
  Users,
  UserCog,
  Bot,
  Globe,
  LayoutDashboard,
  Kanban,
  BarChart3,
  Network,
  Map,
  Layers,
  FileText,
  CheckSquare,
  ChevronRight,
  Command,
  Wrench,
  MessageSquareText,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TeamSwitcher } from './TeamSwitcher'
import { UserNav } from './UserNav'

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  tenantId: string | null
  productId: string | null
  user?: {
    github_login: string
    display_name: string | null
    email: string | null
    avatar_url: string | null
    role: string
  }
}

export function AppSidebar({ tenantId, productId, user, ...props }: AppSidebarProps) {
  const organizationItems = [
    {
      title: 'Media Houses',
      url: '/tenants',
      icon: Building2,
    },
    {
      title: 'Departments',
      url: '/departments',
      icon: Users,
    },
    {
      title: 'Roles',
      url: '/roles',
      icon: UserCog,
    },
    {
      title: 'AI Agents',
      url: '/agents',
      icon: Bot,
    },
  ]

  const productItems = [
    {
      title: 'Websites',
      url: '/websites',
      icon: Globe,
    },
    {
      title: 'Tools',
      url: '/tools',
      icon: Wrench,
    },
    {
      title: 'Prompts',
      url: '/prompts',
      icon: MessageSquareText,
    },
  ]

  const editorialItems = [
    {
      title: 'Kanban',
      url: '/editorial/kanban',
      icon: Kanban,
    },
    {
      title: 'Gantt',
      url: '/editorial/gantt',
      icon: BarChart3,
    },
    {
      title: 'Graph',
      url: '/editorial/graph',
      icon: Network,
    },
    {
      title: 'Sitemap',
      url: '/sitemap',
      icon: Map,
    },
    {
      title: 'Blueprints',
      url: '/blueprints',
      icon: Layers,
    },
    {
      title: 'Content',
      url: '/content',
      icon: FileText,
    },
    {
      title: 'Tasks',
      url: '/tasks',
      icon: CheckSquare,
    },
  ]

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">swarm.press</span>
                  <span className="truncate text-xs">Admin Panel</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Team Switcher - Combined Tenant & Product */}
        <TeamSwitcher />
      </SidebarHeader>

      <SidebarContent>
        {/* Dashboard */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Dashboard">
                <a href="/">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* Organization Section */}
        {tenantId && (
          <SidebarGroup>
            <SidebarGroupLabel>Organization</SidebarGroupLabel>
            <SidebarMenu>
              {organizationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* Products Section */}
        {tenantId && (
          <SidebarGroup>
            <SidebarGroupLabel>Products</SidebarGroupLabel>
            <SidebarMenu>
              {productItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* Editorial Section - Only shown when product is selected */}
        {tenantId && productId ? (
          <SidebarGroup>
            <SidebarGroupLabel>Editorial</SidebarGroupLabel>
            <SidebarMenu>
              {editorialItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : tenantId ? (
          <SidebarGroup>
            <SidebarGroupLabel>Editorial</SidebarGroupLabel>
            <div className="px-2 py-1 text-xs text-sidebar-foreground/50 italic">
              Select a product to access editorial tools
            </div>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <UserNav user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
