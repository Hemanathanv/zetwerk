import { DOC_GENERATION_ACTIVITY_CODES } from './docGenerationAccess';

type PermissionLike = {
  modules?: string[] | null;
  activities?: string[] | null;
  rbacPermissions?: {
    modules?: string[] | null;
    activities?: string[] | null;
  } | null;
};

const LANDING_ROUTES = [
  { module: 'dashboard', path: '/dashboard' },
  { module: 'partner', path: '/partner', activities: ['documents.upload'] },
  { module: 'partner', path: '/partner/documents', activities: ['documents.view', 'documents.view_extracted'] },
  { module: 'partner', path: '/partner/warehouse', activities: ['inventory.view_container', 'inventory.view_timeline'] },
  { module: 'partner', path: '/partner/warehouse/stock', activities: ['inventory.view_container'] },
  { module: 'tasks', path: '/tasks', activities: ['tasks.view', 'TSK-001'] },
  { module: 'shipments', path: '/shipments', activities: ['shipments.view', 'SHP-001'] },
  { module: 'documents', path: '/documents/upload', activities: ['documents.upload', 'documents.edit_extracted', 'documents.approve_draft', 'documents.reject_extraction', 'documents.override_approved_fields', 'documents.reprocess_ocr'] },
  { module: 'documents', path: '/documents/generate', activities: DOC_GENERATION_ACTIVITY_CODES },
  { module: 'documents', path: '/documents', activities: ['documents.view', 'documents.view_extracted'] },
  { module: 'inventory', path: '/inventory/containers', activities: ['inventory.view_container', 'inventory.view_timeline', 'GATE-001'] },
  { module: 'warehouse', path: '/inventory/warehouse', activities: ['inventory.view_warehouse', 'inventory.warehouse_inventory_stock_position'] },
  { module: 'dnd', path: '/inventory/dnd', activities: ['inventory.view_dnd_charges', 'dnd.tariff.view', 'dnd.holiday_calendar.upload'] },
  { module: 'accounting', path: '/accounting', activities: ['accounting.view_queue', 'ACC-001'] },
  { module: 'accounting', path: '/finance', activities: ['accounting.view_ap_aging'] },
  { module: 'reports', path: '/reports', activities: ['reports.view_dashboard'] },
  { module: 'reports', path: '/reports/dsr', activities: ['reports.generate_dsr'] },
  { module: ['settings', 'admin'], path: '/schema', activities: ['admin.configure_doctypes'] },
  { module: ['settings', 'admin'], path: '/settings', activities: ['admin.manage', 'users.manage', 'roles.view'] },
] as const;

export function firstAllowedLandingPath(modules: string[] = [], activities: string[] = []): string {
  return LANDING_ROUTES.find((route) => {
    const routeModules = Array.isArray(route.module) ? route.module : [route.module];
    if (!routeModules.some((module) => modules.includes(module))) return false;
    if (!('activities' in route) || !route.activities.length) return true;
    return route.activities.some((activity) => activities.includes(activity));
  })?.path ?? '/unauthorized';
}

export function firstAllowedLandingPathForUser(user: PermissionLike | null | undefined): string {
  const permissions = user?.rbacPermissions;
  const modules = permissions?.modules ?? user?.modules ?? [];
  const activities = permissions?.activities ?? user?.activities ?? [];
  return firstAllowedLandingPath(modules, activities);
}
