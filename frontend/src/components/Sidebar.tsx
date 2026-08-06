import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Ship, FileText, Package, Receipt,
  BarChart3, Settings, LogOut, ClipboardList,
  PanelLeftClose, PanelLeftOpen, Wand2, Database, ScanText,
  Boxes, Warehouse, DollarSign, ChevronRight, FolderOpen, Upload, Building2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EwmsScrollArea } from '@/components/ewms/Media';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useLocation as useWouterLocation } from 'wouter';
import { getAuthToken } from '@/lib/api';
import { DOC_GENERATION_ACTIVITY_CODES } from '@/lib/docGenerationAccess';

type ChildNavItem = {
  icon: React.ElementType;
  label: string;
  href: string;
};

type NavItem = {
  icon: React.ElementType;
  label: string;
  href: string;
  module: string | string[];
  requiredAnyActivities?: string[];
  badge?: number;
  badgeKey?: string;
  children?: ChildNavItem[];
};

const NAV_GROUPS: { items: NavItem[] }[] = [
  {
    items: [
      { icon: LayoutDashboard, label: 'Dashboard',         href: '/dashboard',                          module: 'dashboard'   },
      { icon: Ship,            label: 'Shipments',         href: '/shipments',                          module: 'shipments',  requiredAnyActivities: ['shipments.view', 'SHP-001'] },
      { icon: FolderOpen,      label: 'Projects',          href: '/projects',                           module: 'shipments',  requiredAnyActivities: ['shipments.view', 'SHP-001'] },
      { icon: ClipboardList,   label: 'My Tasks',          href: '/tasks',                              module: 'tasks',      requiredAnyActivities: ['tasks.view', 'TSK-001'], badgeKey: 'tasks' },
      { icon: FileText,        label: 'Documents',         href: '/documents',                          module: 'documents',  requiredAnyActivities: ['documents.view', 'documents.view_extracted'] },
      { icon: ScanText,        label: 'Upload & Process',  href: '/documents/upload',                   module: 'documents',  requiredAnyActivities: ['documents.upload', 'documents.edit_extracted', 'documents.approve_draft', 'documents.reprocess_ocr'] },
      { icon: Wand2,           label: 'Doc Generate',      href: '/documents/generate',                 module: 'documents',  requiredAnyActivities: DOC_GENERATION_ACTIVITY_CODES },
      { icon: Boxes,      label: 'Inventory',      href: '/inventory/containers', module: 'inventory', requiredAnyActivities: ['inventory.view_container', 'inventory.view_timeline', 'GATE-001'] },
      { icon: Warehouse,  label: 'Warehouse',      href: '/inventory/warehouse',  module: 'warehouse', requiredAnyActivities: ['inventory.view_warehouse', 'inventory.warehouse_inventory_stock_position'] },
      { icon: DollarSign, label: 'D&D Management', href: '/inventory/dnd',        module: 'dnd',       requiredAnyActivities: ['inventory.acknowledge_dnd', 'inventory.update_milestone'] },
    ],
  },
  {
    items: [
      { icon: Receipt,        label: 'Accounting', href: '/accounting',  module: 'accounting', requiredAnyActivities: ['accounting.view_queue', 'ACC-001'] },
      { icon: BarChart3,      label: 'Finance',    href: '/finance',     module: 'accounting', requiredAnyActivities: ['accounting.view_ap_aging', 'accounting.view_queue'] },
      { icon: BarChart3,      label: 'Reports',    href: '/reports',     module: 'reports',    requiredAnyActivities: ['reports.view_dashboard'] },
      { icon: ClipboardList,  label: 'DSR Report', href: '/reports/dsr', module: 'reports',    requiredAnyActivities: ['reports.generate_dsr'] },
    ],
  },
  {
    items: [
      { icon: Settings,  label: 'Settings',   href: '/settings',    module: ['settings', 'admin'], requiredAnyActivities: ['admin.manage', 'users.manage', 'roles.view'] },
      { icon: Database,  label: 'Schema Ref', href: '/schema',      module: ['settings', 'admin'], requiredAnyActivities: ['admin.configure_doctypes', 'roles.view'] },
    ],
  },
  {
    items: [
      { icon: Upload,     label: 'Upload Documents', href: '/partner',                        module: 'partner', requiredAnyActivities: ['documents.upload'] },
      { icon: FileText,   label: 'My Documents',     href: '/partner/documents',              module: 'partner', requiredAnyActivities: ['documents.view_extracted', 'documents.view'] },
      { icon: Warehouse,  label: 'Warehouse / QC',   href: '/partner/warehouse',              module: 'partner', requiredAnyActivities: ['inventory.view_container', 'inventory.view_timeline'] },
      { icon: Package,    label: 'Stock Position',   href: '/partner/warehouse/stock',        module: 'partner', requiredAnyActivities: ['inventory.view_container'] },
    ],
  },
];

const TEAL_ACTIVE_BG   = 'hsla(173,58%,39%,0.12)';
const TEAL_ACTIVE_TEXT = 'hsl(173 58% 65%)';
const MUTED_TEXT       = 'hsl(220 14% 65%)';
const HOVER_BG         = 'hsla(220,14%,90%,0.08)';
const SEPARATOR_COLOR  = 'hsla(220,14%,90%,0.1)';

function Separator({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      style={{
        height: 1,
        background: SEPARATOR_COLOR,
        margin: collapsed ? '12px 8px' : '12px 12px',
      }}
    />
  );
}

function BrandMark({ collapsed, showOpenIcon = false }: { collapsed: boolean; showOpenIcon?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, hsl(173 58% 39%), hsl(173 58% 45%))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 15, fontWeight: 700,
      }}>
        {showOpenIcon ? <PanelLeftOpen style={{ width: 18, height: 18 }} /> : 'E'}
      </div>
      {!collapsed && (
        <span style={{
          fontSize: 16, fontWeight: 600, letterSpacing: 0,
          color: 'hsl(var(--sidebar-foreground, 220 14% 90%))',
          whiteSpace: 'nowrap',
        }}>
          EWMS
        </span>
      )}
    </div>
  );
}

function SidebarSkeleton({ isOpen }: { isOpen: boolean }) {
  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-40"
      style={{
        width: isOpen ? 240 : 64,
        backgroundColor: 'hsl(var(--sidebar))',
        borderRight: '1px solid hsl(var(--sidebar-border))',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: isOpen ? 'space-between' : 'center',
        padding: isOpen ? '14px 12px 14px 14px' : '14px 0',
        borderBottom: '1px solid hsl(var(--sidebar-border))',
        minHeight: 57, flexShrink: 0,
      }}>
        <BrandMark collapsed={!isOpen} />
      </div>
      <EwmsScrollArea className="min-h-0 overflow-x-hidden" style={{ flex: 1, padding: '16px 8px' }} data-ewms-scrollbar="sidebar">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            height: 36, borderRadius: 8, marginBottom: 4,
            background: 'hsla(220,14%,90%,0.06)',
          }} />
        ))}
      </EwmsScrollArea>
    </aside>
  );
}

type BadgeData = { tasks: number; pendingDocuments: number; pendingTickets: number; unread: number };

function useNavBadges(): BadgeData {
  const query = useQuery({
    queryKey: ['navigation', 'badges'],
    queryFn: async () => {
      const token = getAuthToken();
      if (!token) return { tasks: 0, pendingDocuments: 0, pendingTickets: 0, unread: 0 };
      const res = await fetch('/api/navigation/badges', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load navigation badges');
      return data.data as BadgeData;
    },
    refetchInterval: 60_000,
  });

  return query.data ?? { tasks: 0, pendingDocuments: 0, pendingTickets: 0, unread: 0 };
}

export function Sidebar() {
  const [location] = useLocation();
  const [, navigate] = useWouterLocation();
  const [brandHover, setBrandHover] = useState(false);
  const { isOpen, toggle } = useSidebar();
  const { user, logout } = useAuth();
  const { modules: permittedModules, activities, loaded } = usePermissions();
  const badges = useNavBadges();

  const initials = user?.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  function handleLogout() {
    logout();
    navigate('/');
  }

  if (!loaded) return <SidebarSkeleton isOpen={isOpen} />;

  const isSuperAdmin = (user as any)?.role?.systemCode === 'super_admin';
  const roleCategory = String((user as any)?.role?.category ?? '').toLowerCase();
  const roleCode = String((user as any)?.role?.systemCode ?? '').toLowerCase();
  const isPartnerUser = (
    roleCategory.includes('external') ||
    roleCategory.includes('partner') ||
    roleCode.includes('partner') ||
    roleCode.includes('broker') ||
    roleCode.includes('forwarder') ||
    roleCode.includes('cha') ||
    roleCode.includes('tpl')
  );
  const isCustomerUser = roleCategory.includes('customer') || roleCode.includes('customer');

  const visibleGroups = NAV_GROUPS.map((group) => ({
    items: group.items.filter((item) => {
      const modules = Array.isArray(item.module) ? item.module : [item.module];
      if (modules.includes('partner') && !isPartnerUser) return false;
      if (modules.includes('portal') && !isCustomerUser) return false;
      if (!modules.some((module) => permittedModules.includes(module))) return false;
      if (!item.requiredAnyActivities?.length) return true;
      return item.requiredAnyActivities.some(activity => activities.includes(activity));
    }),
  })).filter((g) => g.items.length > 0);

  // Inject Platform Admin item before Settings for super_admin only
  if (isSuperAdmin) {
    const adminGroupIdx = visibleGroups.findIndex(g => g.items.some(i => i.href === '/settings'));
    if (adminGroupIdx >= 0) {
      visibleGroups[adminGroupIdx].items.unshift({
        icon: Building2, label: 'Platform', href: '/platform', module: 'admin',
      } as any);
    }
  }

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-40"
      style={{
        width: isOpen ? 240 : 64,
        backgroundColor: 'hsl(var(--sidebar))',
        borderRight: '1px solid hsl(var(--sidebar-border))',
        transition: 'width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
      }}
      data-testid="sidebar"
    >
      {/* ── Brand header ── */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: isOpen ? 'space-between' : 'center',
          padding: isOpen ? '14px 12px 14px 14px' : '14px 0',
          borderBottom: '1px solid hsl(var(--sidebar-border))',
          minHeight: 57, flexShrink: 0,
        }}
      >
        {isOpen ? (
          <>
            <BrandMark collapsed={false} />
            <button
          onClick={toggle}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 6, border: 'none',
            background: 'transparent', cursor: 'pointer',
            color: MUTED_TEXT, flexShrink: 0,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = TEAL_ACTIVE_TEXT)}
          onMouseLeave={(e) => (e.currentTarget.style.color = MUTED_TEXT)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              data-testid="button-sidebar-toggle"
            >
              <PanelLeftClose style={{ width: 18, height: 18 }} />
            </button>
          </>
        ) : (
          <button
            onClick={toggle}
            onMouseEnter={() => setBrandHover(true)}
            onMouseLeave={() => setBrandHover(false)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: 'hsl(var(--sidebar-primary-foreground))',
            }}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            data-testid="button-sidebar-toggle"
          >
            <BrandMark collapsed showOpenIcon={brandHover} />
          </button>
        )}
      </div>

      {/* ── Navigation ── */}
      <EwmsScrollArea className="min-h-0 overflow-x-hidden" style={{ flex: 1, padding: '10px 0' }} data-ewms-scrollbar="sidebar">
        {visibleGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <Separator collapsed={!isOpen} />}
            {group.items.map((item) => {
              const hasChildren = !!(item.children?.length);
              const childIsActive = hasChildren && item.children!.some(
                (c) => location === c.href || location.startsWith(c.href + '/')
              );
              const isActive = !hasChildren && (location === item.href || location.startsWith(item.href + '/'));
              const isParentActive = hasChildren && childIsActive;
              const Icon = item.icon;
              const liveCount = item.badgeKey ? (badges[item.badgeKey as keyof BadgeData] ?? 0) : (item.badge ?? 0);

              if (hasChildren) {
                const parentEl = (
                  <div key={item.href}>
                    {/* Parent row — not a link, just shows active state */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: isOpen ? 12 : 0,
                        justifyContent: isOpen ? 'flex-start' : 'center',
                        padding: isOpen ? '10px 12px' : '10px 0',
                        margin: '1px 8px',
                        borderRadius: 8,
                        cursor: 'default',
                        color: isParentActive ? TEAL_ACTIVE_TEXT : MUTED_TEXT,
                        background: isParentActive ? TEAL_ACTIVE_BG : 'transparent',
                      }}
                      data-testid={`nav-${item.label.toLowerCase().replace(/ /g, '-')}`}
                    >
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <Icon style={{ width: 20, height: 20 }} />
                      </div>
                      {isOpen && (
                        <>
                          <span style={{
                            fontSize: 14.5, fontWeight: 500,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            flex: 1,
                          }}>
                            {item.label}
                          </span>
                          <ChevronRight style={{
                            width: 14, height: 14, flexShrink: 0,
                            transform: isParentActive ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.2s',
                            opacity: 0.5,
                          }} />
                        </>
                      )}
                    </div>

                    {/* Child items — always visible (inventory is always expanded) */}
                    {isOpen && (
                      <div style={{ marginLeft: 8, paddingLeft: 28, borderLeft: `1px solid ${SEPARATOR_COLOR}` }}>
                        {item.children!.map((child) => {
                          const childActive = location === child.href || location.startsWith(child.href + '/');
                          const ChildIcon = child.icon;
                          const childEl = (
                            <Link
                              key={child.href}
                              href={child.href}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '7px 10px',
                                margin: '1px 0',
                                borderRadius: 6,
                                textDecoration: 'none',
                                fontSize: 14,
                                fontWeight: childActive ? 500 : 400,
                                color: childActive ? TEAL_ACTIVE_TEXT : MUTED_TEXT,
                                background: childActive ? TEAL_ACTIVE_BG : 'transparent',
                                transition: 'background 0.15s, color 0.15s',
                              } as React.CSSProperties}
                              onMouseEnter={(e) => {
                                if (!childActive) {
                                  (e.currentTarget as HTMLElement).style.background = HOVER_BG;
                                  (e.currentTarget as HTMLElement).style.color = 'hsl(220 14% 80%)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!childActive) {
                                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                                  (e.currentTarget as HTMLElement).style.color = MUTED_TEXT;
                                }
                              }}
                              data-testid={`nav-${child.label.toLowerCase().replace(/ /g, '-').replace(/&/g, '')}`}
                            >
                              <ChildIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {child.label}
                              </span>
                            </Link>
                          );
                          return childEl;
                        })}
                      </div>
                    )}

                    {/* Collapsed sidebar: show tooltip per child */}
                    {!isOpen && (
                      <div>
                        {item.children!.map((child) => {
                          const childActive = location === child.href || location.startsWith(child.href + '/');
                          const ChildIcon = child.icon;
                          return (
                            <Tooltip key={child.href} delayDuration={0}>
                              <TooltipTrigger asChild>
                                <Link
                                  href={child.href}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '8px 0',
                                    margin: '1px 8px',
                                    borderRadius: 8,
                                    textDecoration: 'none',
                                    color: childActive ? TEAL_ACTIVE_TEXT : MUTED_TEXT,
                                    background: childActive ? TEAL_ACTIVE_BG : 'transparent',
                                  } as React.CSSProperties}
                                >
                                  <ChildIcon style={{ width: 16, height: 16 }} />
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-[13px]">{child.label}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
                return parentEl;
              }

              const itemEl = (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: isOpen ? 12 : 0,
                    justifyContent: isOpen ? 'flex-start' : 'center',
                    padding: isOpen ? '10px 12px' : '10px 0',
                    margin: '1px 8px',
                    borderRadius: 8,
                    textDecoration: 'none',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'background 0.2s cubic-bezier(0.4,0,0.2,1), color 0.2s',
                    background: isActive ? TEAL_ACTIVE_BG : 'transparent',
                    color: isActive ? TEAL_ACTIVE_TEXT : MUTED_TEXT,
                  } as React.CSSProperties}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = HOVER_BG;
                      (e.currentTarget as HTMLElement).style.color = 'hsl(220 14% 80%)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.color = MUTED_TEXT;
                    }
                  }}
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, '-')}`}
                >
                  {/* Icon + optional badge */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Icon style={{
                      width: 20, height: 20,
                      color: isActive ? TEAL_ACTIVE_TEXT : 'inherit',
                    }} />
                    {liveCount > 0 && (
                      <span style={{
                        position: 'absolute',
                        top: -5, right: -6,
                        minWidth: 20, height: 20,
                        borderRadius: 999,
                        background: 'hsl(0 84% 60%)',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: 'var(--app-font-sans)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 3px',
                        lineHeight: 1,
                      }}>
                        {liveCount > 99 ? '99+' : liveCount}
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  {isOpen && (
                    <span style={{
                      fontSize: 14.5, fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      flex: 1,
                    }}>
                      {item.label}
                    </span>
                  )}
                </Link>
              );

              if (!isOpen) {
                return (
                  <Tooltip key={item.href} delayDuration={0}>
                    <TooltipTrigger asChild>{itemEl}</TooltipTrigger>
                    <TooltipContent side="right" className="text-[13px]">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }
              return itemEl;
            })}
          </div>
        ))}
      </EwmsScrollArea>

      {/* ── User section ── */}
      <div style={{ flexShrink: 0 }}>
        <Separator collapsed={!isOpen} />

        <div style={{ padding: isOpen ? '4px 8px 12px' : '4px 0 12px' }}>
          {/* Avatar + info */}
          {isOpen ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                transition: 'background 0.15s',
                cursor: 'default',
              }}
              data-testid="user-card"
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'hsla(173,58%,39%,0.2)',
                color: 'hsl(173 58% 65%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14.5, fontWeight: 600,
              }}>
                {initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: 'hsl(var(--sidebar-foreground, 220 14% 90%))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.fullName ?? '—'}
                </p>
                <p style={{ margin: 0, fontSize: 14.5, color: 'hsl(220 14% 55%)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.role?.name ?? '—'}
                </p>
              </div>
            </div>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '8px 0', cursor: 'default',
                  }}
                  data-testid="user-card"
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'hsla(173,58%,39%,0.2)',
                    color: 'hsl(173 58% 65%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14.5, fontWeight: 600,
                  }}>
                    {initials}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-[13px]">
                {user?.fullName ?? '—'} · {user?.role?.name ?? '—'}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Sign out */}
          {isOpen ? (
            <button
              onClick={handleLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 10px', borderRadius: 8,
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: MUTED_TEXT, fontSize: 14.5, transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'hsl(220 14% 80%)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = MUTED_TEXT)}
              data-testid="button-logout"
            >
              <LogOut style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>Sign out</span>
            </button>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '100%', padding: '8px 0', borderRadius: 8,
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: MUTED_TEXT, transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'hsl(220 14% 80%)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = MUTED_TEXT)}
                  data-testid="button-logout"
                >
                  <LogOut style={{ width: 18, height: 18 }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-[13px]">Sign out</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}
