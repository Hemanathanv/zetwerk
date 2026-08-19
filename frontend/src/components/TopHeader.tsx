import { Sun, Moon, Upload, ChevronRight } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePermissions } from '@/contexts/PermissionContext';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { NotificationCenter } from '@/components/NotificationCenter';

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
  'draft-boe': 'Draft CBP FORM 7501',
  'packing-list': 'Packing List',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (s: string) => UUID_RE.test(s);

function segmentLabel(s: string): string {
  if (SEGMENT_LABELS[s]) return SEGMENT_LABELS[s];
  if (isUUID(s)) return 'Detail';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

type Crumb = { label: string; href: string };

function getCrumbs(location: string): Crumb[] {
  const parts = location.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  return parts.map((part, i) => ({
    label: segmentLabel(part),
    href: '/' + parts.slice(0, i + 1).join('/'),
  }));
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null;

  return (
    <nav
      className="flex items-center gap-0.5 text-[13px] text-muted-foreground"
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

const badgeIntent: Record<'teal' | 'gold', 'active' | 'warning'> = {
  teal: 'active',
  gold: 'warning',
};

export function TopHeader() {
  const { theme, setTheme } = useTheme();
  const { modules, activities } = usePermissions();
  const { pageMeta } = usePageMeta();
  const [location, navigate] = useLocation();
  const canUploadDocuments = modules.includes('documents') && activities.includes('documents.upload');
  const crumbs = getCrumbs(location);
  const hasBreadcrumb = crumbs.length > 0;

  const rightCluster = (
    <div className="flex items-center gap-2 ml-auto">
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

      <NotificationCenter />

      {/* Dark mode toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-md border border-border text-muted-foreground hover:text-foreground"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        data-testid="button-theme-toggle"
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </Button>
    </div>
  );

  const titleBlock = pageMeta && (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1
          className="leading-tight"
          style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0 }}
        >
          {pageMeta.title}
        </h1>
        {pageMeta.badge && (
          <Badge intent={badgeIntent[pageMeta.badge.variant]} size="sm" hasDot>
            {pageMeta.badge.label}
          </Badge>
        )}
      </div>
      {pageMeta.subtitle && (
        <div style={{ fontSize: 'var(--text-subtitle-size)', color: 'hsl(var(--muted-foreground))' }}>
          {pageMeta.subtitle}
        </div>
      )}
    </div>
  );

  return (
    <header
      className="sticky top-0 z-20 bg-background"
      data-testid="top-header"
    >
      {hasBreadcrumb ? (
        <>
          <div className="flex items-center gap-2 px-6 pt-2 pb-2">
            <Breadcrumbs crumbs={crumbs} />
            {rightCluster}
          </div>

          {pageMeta && (
            <div className="px-6 pb-2 pt-1 flex items-start justify-between gap-3">
              {titleBlock}
              {pageMeta.actions && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {pageMeta.actions}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 px-6 py-2">
          {titleBlock}
          {pageMeta?.actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {pageMeta.actions}
            </div>
          )}
          {rightCluster}
        </div>
      )}
    </header>
  );
}
