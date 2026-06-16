import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard, Ship, FileText, Package, Receipt,
  BarChart3, LogOut, ClipboardList, Bell,
  PanelLeftClose, PanelLeftOpen, Wand2, ScanText,
  HardDrive, ShieldCheck, Settings2, Users,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/contexts/SidebarContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation as useWouterLocation } from 'wouter';

type NavItem = {
  icon: React.ElementType;
  label: string;
  href: string;
  module: string;
  badge?: number;
};

const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { icon: LayoutDashboard, label: 'Dashboard',  href: '/dashboard',   module: 'reports'     },
      { icon: Ship,            label: 'Shipments',  href: '/shipments',   module: 'shipments'   },
      { icon: ClipboardList,   label: 'My Tasks',   href: '/tasks',       module: 'shipments', badge: 2 },
      { icon: FileText,        label: 'Documents',  href: '/documents',                    module: 'documents' },
      { icon: ScanText,        label: 'Upload & Process', href: '/documents/upload',         module: 'documents' },
      { icon: Wand2,           label: 'Doc Generate', href: '/documents/generate/packing-list', module: 'documents' },
      { icon: Package,         label: 'Inventory',  href: '/inventory',   module: 'inventory'   },
    ],
  },
  {
    items: [
      { icon: Receipt,   label: 'Accounting', href: '/accounting',  module: 'accounting' },
      { icon: Receipt,   label: 'Invoices',   href: '/invoices',    module: 'accounting' },
      { icon: BarChart3, label: 'Reports',    href: '/reports',     module: 'reports'    },
      { icon: Bell,      label: 'Notifications', href: '/notifications', module: 'reports' },
      { icon: Settings2, label: 'Profile Settings', href: '/settings', module: 'settings' },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { icon: Users,       label: 'User Management', href: '/admin/users',       module: 'admin' },
      { icon: HardDrive,   label: 'Storage',         href: '/admin/storage',     module: 'admin' },
      { icon: ShieldCheck, label: 'User Permissions', href: '/admin/permissions', module: 'admin' },
    ],
  },
];

const TEAL_ACTIVE_BG   = 'hsla(173,58%,39%,0.12)';
const TEAL_ACTIVE_TEXT = 'hsl(173 58% 65%)';
const MUTED_TEXT       = 'hsl(220 14% 65%)';
const HOVER_BG         = 'hsla(220,14%,90%,0.08)';
const SEPARATOR_COLOR  = 'hsla(220,14%,90%,0.1)';

type SidebarProps = {
  isOpen?: boolean;
  onToggle?: () => void;
};

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

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, hsl(173 58% 39%), hsl(173 58% 45%))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 15, fontWeight: 700,
      }}>
        E
      </div>
      {!collapsed && (
        <span style={{
          fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em',
          color: 'hsl(var(--sidebar-foreground, 220 14% 90%))',
          whiteSpace: 'nowrap',
        }}>
          EWMS
        </span>
      )}
    </div>
  );
}

export function Sidebar({ isOpen: controlledOpen, onToggle }: SidebarProps = {}) {
  const [location] = useLocation();
  const [, navigate] = useWouterLocation();
  const sidebar = useSidebar();
  const { user, logout, hasModuleAccess } = useAuth();
  const isOpen = controlledOpen ?? sidebar.isOpen;
  const toggle = onToggle ?? sidebar.toggle;
  const [brandHovered, setBrandHovered] = useState(false);

  const initials = user?.fullName
    ? user.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const visibleGroups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => {
      if (item.module === 'reports' && item.label === 'Dashboard') return true;
      if (item.module === 'settings') return true;
      return hasModuleAccess(item.module);
    }),
  })).filter((g) => g.items.length > 0);

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
        onMouseEnter={() => setBrandHovered(true)}
        onMouseLeave={() => setBrandHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: isOpen ? 'space-between' : 'center',
          padding: isOpen ? '14px 12px 14px 14px' : '14px 0',
          borderBottom: '1px solid hsl(var(--sidebar-border))',
          minHeight: 57, flexShrink: 0,
          position: 'relative',
        }}
      >
        <BrandMark collapsed={!isOpen} />
        <button
          onClick={toggle}
          aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 6, border: 'none',
            background: isOpen ? 'transparent' : 'hsl(var(--sidebar))', cursor: 'pointer',
            color: MUTED_TEXT, flexShrink: 0,
            transition: 'color 0.15s, opacity 0.15s ease, background 0.15s ease',
            ...(isOpen
              ? {}
              : {
                  position: 'absolute',
                  left: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: brandHovered ? 1 : 0,
                  pointerEvents: brandHovered ? 'auto' : 'none',
                }),
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = TEAL_ACTIVE_TEXT)}
          onMouseLeave={(e) => (e.currentTarget.style.color = MUTED_TEXT)}
          data-testid="button-sidebar-toggle"
        >
          {isOpen
            ? <PanelLeftClose style={{ width: 18, height: 18 }} />
            : <PanelLeftOpen  style={{ width: 18, height: 18 }} />
          }
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 0' }}>
        {visibleGroups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <Separator collapsed={!isOpen} />}
            {group.label && isOpen && (
              <div
                style={{
                  padding: '4px 20px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'hsl(220 14% 48%)',
                  textTransform: 'uppercase',
                }}
              >
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + '/');
              const Icon = item.icon;

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
                    {(item.badge ?? 0) > 0 && (
                      <span style={{
                        position: 'absolute',
                        top: -5, right: -6,
                        minWidth: 16, height: 16,
                        borderRadius: 999,
                        background: 'hsl(0 84% 60%)',
                        color: '#fff',
                        fontSize: 9,
                        fontWeight: 700,
                        fontFamily: 'var(--app-font-mono, monospace)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 3px',
                        lineHeight: 1,
                      }}>
                        {item.badge}
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  {isOpen && (
                    <span style={{
                      fontSize: 13.5, fontWeight: 500,
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
                    <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }
              return itemEl;
            })}
          </div>
        ))}
      </nav>

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
                fontSize: 13, fontWeight: 600,
              }}>
                {initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'hsl(var(--sidebar-foreground, 220 14% 90%))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.fullName ?? '—'}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: 'hsl(220 14% 55%)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    fontSize: 13, fontWeight: 600,
                  }}>
                    {initials}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
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
                color: MUTED_TEXT, fontSize: 13, transition: 'color 0.15s',
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
              <TooltipContent side="right" className="text-xs">Sign out</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}
