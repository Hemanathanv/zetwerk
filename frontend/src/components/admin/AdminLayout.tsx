import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import {
  Users, Shield, Building2, GitBranch, ShieldCheck,
  Calculator, Container, Warehouse, PackageSearch,
  ScrollText, Settings, ArrowLeft, ClipboardCheck,
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: React.ElementType;
  href: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const ADMIN_NAV: NavGroup[] = [
  {
    group: 'Access Control',
    items: [
      { label: 'Users',            icon: Users,      href: '/admin/users'            },
      { label: 'Roles & Permissions', icon: Shield,  href: '/admin/roles'            },
      { label: 'Organisations',    icon: Building2,  href: '/admin/organisations'    },
    ],
  },
  {
    group: 'Workflow',
    items: [
      { label: 'Workflow Templates',  icon: GitBranch,   href: '/admin/templates'        },
      { label: 'Validation Rules',    icon: ShieldCheck, href: '/admin/validation-rules' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Accounting Config',   icon: Calculator,  href: '/admin/accounting'       },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { label: 'Tracking & D&D',      icon: Container,     href: '/admin/inventory'        },
      { label: '3PL Configuration',   icon: Warehouse,     href: '/admin/warehouses'       },
      { label: 'Product Master',       icon: PackageSearch, href: '/admin/products'         },
    ],
  },
  {
    group: 'System',
    items: [
      { label: 'Audit Log',            icon: ScrollText,      href: '/admin/audit'       },
      { label: 'Compliance Checks',    icon: ClipboardCheck,  href: '/admin/compliance'  },
    ],
  },
];

const NAV_W  = 240;
const NAV_WC = 40; // collapsed width

function AdminNav({ collapsed }: { collapsed: boolean }) {
  const [location] = useLocation();

  return (
    <nav
      style={{
        width: collapsed ? NAV_WC : NAV_W,
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
        background: 'hsl(var(--card))',
        borderRight: '1px solid hsl(var(--border))',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: collapsed ? '24px 4px' : '24px 12px',
        transition: 'width 0.2s, padding 0.2s',
        display: 'flex',
        flexDirection: 'column',
        scrollbarWidth: 'none',
        boxSizing: 'border-box',
      } as React.CSSProperties}
    >
      {/* Header */}
      {!collapsed && (
        <div style={{ paddingLeft: 12, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Settings size={15} style={{ color: 'hsl(173 58% 39%)' }} />
            <span style={{
              fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em',
              color: 'hsl(var(--foreground))',
            }}>
              Administration
            </span>
          </div>
          <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
            System configuration
          </p>
        </div>
      )}
      {collapsed && <div style={{ height: 52 }} />}

      {/* Back to app */}
      <Link href="/">
        <div
          title={collapsed ? 'Back to app' : undefined}
          style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 8,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '8px 0' : '8px 12px',
            borderRadius: 8, fontSize: 14, fontWeight: 500,
            cursor: 'pointer', marginBottom: 16,
            border: '1px solid hsl(var(--border))',
            color: 'hsl(var(--muted-foreground))',
            background: 'transparent',
            transition: 'background 0.1s, color 0.1s',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = 'hsl(var(--muted) / 0.5)';
            el.style.color = 'hsl(var(--foreground))';
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement;
            el.style.background = 'transparent';
            el.style.color = 'hsl(var(--muted-foreground))';
          }}
        >
          <ArrowLeft size={15} style={{ flexShrink: 0 }} />
          {!collapsed && <span>Back to app</span>}
        </div>
      </Link>

      {/* Groups */}
      {ADMIN_NAV.map((group, gi) => (
        <div key={group.group} style={{ marginTop: gi === 0 ? 0 : 24 }}>
          {!collapsed && (
            <div style={{
              fontSize: 14.5, textTransform: 'uppercase', letterSpacing: '0.08em',
              fontWeight: 600, color: 'hsl(var(--muted-foreground))',
              paddingLeft: 12, marginBottom: 6,
            }}>
              {group.group}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {group.items.map((item) => {
              const isActive = location === item.href || location.startsWith(item.href + '/');
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    title={collapsed ? item.label : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: collapsed ? 0 : 10,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      padding: collapsed ? '9px 0' : '9px 12px',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      position: 'relative',
                      background: isActive ? 'hsla(173,58%,39%,0.08)' : 'transparent',
                      color: isActive ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
                      borderLeft: isActive ? '3px solid hsl(173 58% 39%)' : '3px solid transparent',
                      marginLeft: isActive ? -3 : 0,
                      transition: 'background 0.1s, color 0.1s',
                      userSelect: 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'hsl(var(--muted) / 0.5)';
                        el.style.color = 'hsl(var(--foreground))';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = 'transparent';
                        el.style.color = 'hsl(var(--muted-foreground))';
                      }
                    }}
                  >
                    <Icon size={16} style={{ flexShrink: 0 }} />
                    {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    function onResize() { setWidth(window.innerWidth); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (width < 768) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexDirection: 'column', gap: 12,
        background: 'hsl(var(--background))',
      }}>
        <Settings size={40} style={{ color: 'hsl(var(--muted-foreground))' }} />
        <p style={{ fontSize: 16, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
          Admin panel requires desktop
        </p>
        <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
          Please use a screen wider than 768px to access admin settings.
        </p>
      </div>
    );
  }

  const collapsed = width < 1024;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'hsl(var(--background))' }}>
      <AdminNav collapsed={collapsed} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 32, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
