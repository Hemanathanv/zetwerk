import { useEffect, useMemo, useState } from 'react';
import { Search, Sun, Moon, LogOut, Upload, ChevronRight, Bell } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionContext';

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  shipments: 'Shipments',
  new: 'New Shipment',
  create: 'Create Shipment',
  documents: 'Documents',
  upload: 'Upload & Process',
  generate: 'Generate',
  tasks: 'My Tasks',
  accounting: 'Accounting',
  finance: 'Finance',
  reports: 'Reports',
  dsr: 'DSR Report',
  inventory: 'Inventory',
  containers: 'Containers',
  warehouse: 'Warehouse',
  dnd: 'D&D',
  projects: 'Projects',
  partner: 'Partner Portal',
  portal: 'Customer Portal',
  tracking: 'Tracking',
  notifications: 'Notifications',
  settings: 'Settings',
  schema: 'Schema Reference',
  invoices: 'Invoices',
  admin: 'Admin',
  users: 'Users',
  roles: 'Roles',
  organisations: 'Organisations',
  templates: 'Templates',
  validation: 'Validation Rules',
  escalation: 'Escalation',
  audit: 'Audit Log',
  warehouses: 'Warehouses',
  products: 'Products',
  'outward-grn': 'Outward GRN',
  'outward-pl': 'Outward GRN',
  'us-packing-list': 'Outward GRN',
  boe: 'Draft CBP FORM 7501',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (s: string) => UUID_RE.test(s);

function segmentLabel(s: string): string {
  if (SEGMENT_LABELS[s]) return SEGMENT_LABELS[s];
  if (isUUID(s)) return 'Detail';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

function Breadcrumbs() {
  const [location] = useLocation();
  const parts = location.split('/').filter(Boolean);
  if (parts.length <= 1) return null;

  const crumbs = parts.map((part, i) => ({
    label: segmentLabel(part),
    href: '/' + parts.slice(0, i + 1).join('/'),
  }));

  return (
    <nav
      className="flex items-center gap-0.5 px-4 pb-2 text-[13px] text-muted-foreground"
      aria-label="Breadcrumb"
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-0.5">
          {i > 0 && <ChevronRight className="w-3 h-3 opacity-40 flex-shrink-0" />}
          {i < crumbs.length - 1 ? (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted/50"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium px-1">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function TopHeader() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { modules, activities } = usePermissions();
  const [location, navigate] = useLocation();
  const [searchValue, setSearchValue] = useState('');
  const canUploadDocuments = modules.includes('documents') && activities.includes('documents.upload');

  const moduleSearch = useMemo(() => {
    if (location.startsWith('/documents/upload')) {
      return { scope: 'upload-process', placeholder: 'Search documents...' };
    }
    if (location.startsWith('/documents/generate') || location.startsWith('/documents/boe')) {
      return { scope: 'doc-generation', placeholder: 'Search generated documents...' };
    }
    if (location === '/documents') {
      return { scope: 'documents', placeholder: 'Search shipment gates...' };
    }
    if (location.startsWith('/shipments')) {
      return { scope: 'shipments', placeholder: 'Search shipments...' };
    }
    return null;
  }, [location]);

  useEffect(() => {
    setSearchValue('');
    window.dispatchEvent(new CustomEvent('ewms-module-search', { detail: { scope: 'all', value: '' } }));
  }, [location]);

  function handleModuleSearch(value: string) {
    setSearchValue(value);
    if (!moduleSearch) return;
    window.dispatchEvent(new CustomEvent('ewms-module-search', {
      detail: { scope: moduleSearch.scope, value },
    }));
  }

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header
      className="sticky top-0 z-20 border-b bg-background"
      style={{ borderColor: 'hsl(var(--border))' }}
      data-testid="top-header"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 relative">
          {moduleSearch && (
            <>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder={moduleSearch.placeholder}
                value={searchValue}
                onChange={(e) => handleModuleSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-[14.5px] rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                style={{ borderColor: 'hsl(var(--border))' }}
                data-testid="input-module-search"
              />
            </>
          )}
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-2">

          {/* Upload button */}
          {canUploadDocuments && (
            <Button
              size="sm"
              className="gap-1.5 h-9 text-[13px] font-semibold px-3"
              onClick={() => navigate('/documents/upload')}
              data-testid="global-upload-button"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Upload</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => navigate('/notifications')}
            data-testid="button-notifications"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
          </Button>

          {/* Dark mode toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            data-testid="button-theme-toggle"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          {/* User info + logout */}
          {user && (
            <div className="flex items-center gap-2 pl-2 border-l" style={{ borderColor: 'hsl(var(--border))' }}>
              <div className="text-right hidden sm:block">
                <p className="text-[13px] font-medium text-foreground leading-tight">{user.fullName}</p>
                {user.role && (
                  <Badge variant="secondary" className="text-[12px] px-2 py-0 h-5 mt-0.5">
                    {user.role.name}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={handleLogout}
                data-testid="button-logout-header"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumb trail — only renders when path depth > 1 */}
      <Breadcrumbs />
    </header>
  );
}
