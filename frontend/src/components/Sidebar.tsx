import type { ComponentType } from "react";
import type { AppRoute } from "@/pages/MainPage";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  HardDrive,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoutButton } from "@/components/user/Logout";
import { useAuth } from "@/auth/AuthContext";

type RouteEntry = {
  id: AppRoute;
  label: string;
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const coreRoutes: RouteEntry[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Status overview",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "document-ocr",
    label: "Document OCR",
    description: "Upload and review",
    href: "/document-ocr",
    icon: FileText,
  },
  {
    id: "settings",
    label: "Profile Settings",
    description: "Account and security",
    href: "/settings",
    icon: Settings,
  },
];

const adminRoutes: RouteEntry[] = [
  {
    id: "admin-users",
    label: "User Management",
    description: "Users and roles",
    href: "/admin/users",
    icon: Users,
  },
  {
    id: "admin-storage",
    label: "Storage",
    description: "Buckets and files",
    href: "/admin/storage",
    icon: HardDrive,
  },
  {
    id: "admin-permissions",
    label: "User Permissions",
    description: "Access controls",
    href: "/admin/permissions",
    icon: ShieldCheck,
  },
];

function ZetwerkLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <rect width="32" height="32" rx="7" fill="hsl(18 87% 55%)" />
      <path
        d="M8 9h16l-9 14h9"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default function Sidebar({
  activeRoute,
  onSelectRoute,
  isOpen,
  onToggle,
  isAdmin,
}: {
  activeRoute: AppRoute;
  onSelectRoute: (path: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  isAdmin: boolean;
}) {
  const { user } = useAuth();

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar",
        "transition-[width] duration-300 ease-in-out"
      )}
      style={{ width: isOpen ? 288 : 72 }}
    >
      <div className={cn("border-b border-sidebar-border", isOpen ? "p-4" : "p-3")}>
        {isOpen ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ZetwerkLogo size={32} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-bold uppercase tracking-wider text-sidebar-foreground">
                EWMS
              </h1>
              <p className="truncate text-xs text-muted-foreground">Export workflow management system</p>
            </div>
            <button
              onClick={onToggle}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-muted-foreground hover:bg-sidebar-accent"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="relative flex justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ZetwerkLogo size={32} />
            </div>
            <button
              onClick={onToggle}
              className="absolute -right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-muted-foreground hover:bg-sidebar-accent"
              title="Expand sidebar"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <NavSection
          title="Workspace"
          routes={coreRoutes}
          activeRoute={activeRoute}
          onSelectRoute={onSelectRoute}
          isOpen={isOpen}
        />
        {isAdmin && (
          <NavSection
            title="Admin"
            routes={adminRoutes}
            activeRoute={activeRoute}
            onSelectRoute={onSelectRoute}
            isOpen={isOpen}
          />
        )}
      </nav>

      <div className={cn("border-t border-sidebar-border", isOpen ? "p-3" : "p-2")}>
        <div className={cn("rounded-lg border border-sidebar-border bg-sidebar-accent/40", isOpen ? "p-2" : "px-1 py-2")}>
          {isOpen ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-foreground">{user?.name || "User"}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email || "Account"}</p>
              </div>
              <LogoutButton />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                <User className="h-4 w-4 text-primary" />
              </div>
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function NavSection({
  title,
  routes,
  activeRoute,
  onSelectRoute,
  isOpen,
}: {
  title: string;
  routes: RouteEntry[];
  activeRoute: AppRoute;
  onSelectRoute: (path: string) => void;
  isOpen: boolean;
}) {
  return (
    <div className="mb-4">
      {isOpen && <p className="px-2 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>}
      <div className="space-y-1">
        {routes.map((route) => {
          const Icon = route.icon;
          const isActive = activeRoute === route.id;

          return (
            <button
              key={route.id}
              onClick={() => onSelectRoute(route.href)}
              title={!isOpen ? route.label : undefined}
              className={cn(
                "w-full rounded-lg border text-left transition-all",
                isOpen ? "flex items-center gap-3 px-3 py-3" : "flex justify-center px-0 py-3",
                isActive ? "border-sidebar-border bg-sidebar-accent" : "border-transparent hover:bg-sidebar-accent/50"
              )}
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", isActive ? "bg-primary/15" : "bg-sidebar-border/40")}>
                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
              </div>
              {isOpen && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-sidebar-foreground">{route.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{route.description}</p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
