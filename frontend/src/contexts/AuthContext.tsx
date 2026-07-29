import { AuthProvider as ConnectedAuthProvider, useAuth as useConnectedAuth } from '@/auth/AuthContext';
import { SESSION_TOKEN_KEY } from '@/auth/api';
import type { RbacPermissions } from '@/contexts/PermissionContext';
import type { ReactNode } from 'react';

export type Permission = {
  module: string;
  activity: string;
  dataScope: string;
  conditions: Record<string, unknown> | null;
};

const ADMIN_MODULES = ['dashboard', 'reports', 'shipments', 'tasks', 'documents', 'inventory', 'warehouse', 'dnd', 'accounting', 'admin', 'settings'];
const ADMIN_ACTIVITIES = [
  'shipments.view',
  'shipments.create',
  'tasks.view',
  'documents.view',
  'documents.view_extracted',
  'documents.upload',
  'documents.edit_extracted',
  'documents.approve_draft',
  'documents.reprocess_ocr',
  'documents.generate_draft',
  'inventory.view_container',
  'inventory.view_timeline',
  'inventory.view_warehouse',
  'inventory.warehouse_inventory_stock_position',
  'inventory.acknowledge_dnd',
  'inventory.update_milestone',
  'accounting.view_queue',
  'accounting.view_ap_aging',
  'reports.view_dashboard',
  'reports.generate_dsr',
  'admin.manage',
  'users.manage',
  'roles.view',
  'roles.manage',
  'admin.manage_users',
  'admin.configure_roles',
  'admin.edit_workflows',
  'admin.configure_doctypes',
  'admin.edit_account_mappings',
  'admin.manage_partners',
  'admin.view_audit_log',
  'admin.security_settings',
  'DOC-003',
  'SHP-001',
  'TSK-001',
  'ACC-001',
  'GATE-001',
];

function permissionsForModules(modules: string[], isAdmin: boolean): Permission[] {
  const basePermissions = modules.map((module) => ({
    module,
    activity: isAdmin ? 'manage' : 'read',
    dataScope: isAdmin ? 'organization' : 'own',
    conditions: null,
  }));

  if (!isAdmin) return basePermissions;

  return [
    ...basePermissions,
    { module: 'admin', activity: 'user_management', dataScope: 'organization', conditions: null },
    { module: 'admin', activity: 'storage', dataScope: 'organization', conditions: null },
    { module: 'admin', activity: 'permissions', dataScope: 'organization', conditions: null },
  ];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <ConnectedAuthProvider>{children}</ConnectedAuthProvider>;
}

function getAuthErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'data' in error.response
  ) {
    const data = error.response.data as { detail?: unknown; message?: unknown };
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.message === 'string') return data.message;
  }
  return error instanceof Error ? error.message : 'Invalid credentials';
}

export function useAuth() {
  const auth = useConnectedAuth();
  const keycloakPermissions = (auth.user as any)?.rbacPermissions as RbacPermissions | undefined;
  const isKnownAdmin = auth.user?.email?.toLowerCase() === 'admin@sprconsultech.com';
  const normalizedSystemRole = String(auth.user?.systemRole ?? '').toUpperCase().replace(/-/g, '_');
  const isAdmin = isKnownAdmin || normalizedSystemRole === 'ADMIN' || normalizedSystemRole === 'SUPER_ADMIN';
  const adminPermissions = isAdmin && keycloakPermissions
    ? {
        ...keycloakPermissions,
        modules: [...new Set([...(keycloakPermissions.modules ?? []), ...ADMIN_MODULES])],
        activities: [...new Set([...(keycloakPermissions.activities ?? []), ...ADMIN_ACTIVITIES])],
        capabilities: {
          ...(keycloakPermissions.capabilities ?? {}),
          isApprove: true,
          isEdit: true,
          isUpload: true,
          isOverride: true,
          isReprocess: true,
        },
      }
    : keycloakPermissions;
  const modules = adminPermissions?.modules ?? (isAdmin ? ADMIN_MODULES : []);
  const rbacPermissions: RbacPermissions | null = auth.user
    ? adminPermissions ?? (isAdmin ? {
        modules,
        gates: [],
        docTypes: {},
        ticketCategories: [],
        activities: ADMIN_ACTIVITIES,
        dataScope: isAdmin ? 'ALL' : 'TAGGED',
        capabilities: {
          isApprove: isAdmin,
          isEdit: isAdmin,
          isUpload: isAdmin,
          isOverride: isAdmin,
          isReprocess: isAdmin,
        },
        role: {
          id: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
          name: (isKnownAdmin ? 'ADMIN' : auth.user.systemRole).replace(/_/g, ' '),
          category: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
          color: '#0f766e',
        },
      } : null)
    : null;
  const keycloakRole = adminPermissions?.role;
  const user = auth.user
    ? {
        ...auth.user,
        fullName: auth.user.name,
        systemRole: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
        userType: keycloakRole?.category ?? (isKnownAdmin ? 'ADMIN' : auth.user.systemRole),
        role: keycloakRole ?? {
          id: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
          name: (isKnownAdmin ? 'ADMIN' : auth.user.systemRole).replace(/_/g, ' '),
          category: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
        },
        org: null,
        permissions: permissionsForModules(modules, isAdmin),
        modules,
      }
    : null;

  return {
    ...auth,
    user,
    token: window.localStorage.getItem(SESSION_TOKEN_KEY),
    rbacPermissions,
    login: async (email: string, password: string) => {
      try {
        await auth.login(email, password);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: getAuthErrorMessage(error),
        };
      }
    },
    hasPermission: () => true,
    hasModuleAccess: (module: string) => user?.modules.includes(module) ?? false,
  };
}
