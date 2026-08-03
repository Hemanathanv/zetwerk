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

const ADMIN_MODULES = ['dashboard', 'shipments', 'tasks', 'documents', 'inventory', 'warehouse', 'dnd', 'accounting', 'reports', 'admin', 'settings'];
const ADMIN_ACTIVITIES = [
  'admin.configure_doctypes',
  'admin.configure_roles',
  'admin.edit_account_mappings',
  'admin.edit_workflows',
  'admin.manage',
  'admin.manage_partners',
  'admin.manage_users',
  'admin.security_settings',
  'admin.view_audit_log',
  'documents.approve_container_mapping',
  'documents.approve_draft',
  'documents.approve_generated_document',
  'documents.classify_document_type',
  'documents.delete',
  'documents.discard_draft',
  'documents.download_export',
  'documents.edit_extracted',
  'documents.fill_manual_fields',
  'documents.generate_draft',
  'documents.manage',
  'documents.map_container_to_sku',
  'documents.modify_generated_fields',
  'documents.ocr_completed',
  'documents.override_approved_fields',
  'documents.override_validation',
  'documents.re_trigger_generation',
  'documents.re_upload_document',
  'documents.reassign_document_to_shipment',
  'documents.reject_container_mapping',
  'documents.reject_extraction',
  'documents.reject_generated_document',
  'documents.reprocess_ocr',
  'documents.resolve_validation_failure',
  'documents.revoke_approval',
  'documents.save_draft',
  'documents.submit_for_approval',
  'documents.submit_for_review',
  'documents.submit_mapping_for_approval',
  'documents.trigger_re_validation',
  'documents.upload',
  'documents.validation_triggered',
  'documents.view',
  'documents.view_draft',
  'documents.view_extracted',
  'documents.view_validation_results',
  'inventory.3_way_recon',
  'inventory.acknowledge_dnd',
  'inventory.adjust_stock_with_remarks',
  'inventory.adjust_stock_without_remarks',
  'inventory.approve_dispatch',
  'inventory.create_outward_grn_new_dispatch',
  'inventory.delivered',
  'inventory.inventory_tracking_breakbulk',
  'inventory.modify_lfd',
  'inventory.move_inventory',
  'inventory.reject_dispatch',
  'inventory.returned',
  'inventory.update_milestone',
  'inventory.upload_pod',
  'inventory.view_container',
  'inventory.view_dnd_charges',
  'inventory.view_last_free_days_shipment_based',
  'inventory.view_lfd_calendar',
  'inventory.view_outward_dispatches',
  'inventory.view_timeline',
  'inventory.view_warehouse',
  'inventory.warehouse_inventory_stock_position',
  'roles.manage',
  'roles.view',
  'shipments.archive',
  'shipments.assign_user',
  'shipments.cancel_shipment',
  'shipments.change_shipment_type',
  'shipments.create',
  'shipments.delete',
  'shipments.edit_metadata',
  'shipments.export_details',
  'shipments.hold_shipment',
  'shipments.manage',
  'shipments.override_blocked_stage',
  'shipments.resume_shipment',
  'shipments.tag_partner',
  'shipments.view',
  'tasks.assign',
  'tasks.delegate',
  'tasks.escalate',
  'tasks.update',
  'tasks.view',
  'users.manage',
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
        docTypes: {
          ...(keycloakPermissions.docTypes ?? {}),
          upload: ['*'],
          approve_extraction: ['*'],
          review_generation: ['*'],
          view: ['*'],
        },
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
        docTypes: isAdmin ? {
          upload: ['*'],
          approve_extraction: ['*'],
          review_generation: ['*'],
          view: ['*'],
        } : {},
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
    hasPermission: (moduleOrActivity?: string, activity?: string) => {
      if (!user || !moduleOrActivity) return false;
      if (isAdmin) return true;
      const activities = rbacPermissions?.activities ?? [];
      if (!activity) {
        return activities.includes(moduleOrActivity) || user.modules.includes(moduleOrActivity);
      }
      return activities.includes(`${moduleOrActivity}.${activity}`) || activities.includes(activity);
    },
    hasModuleAccess: (module: string) => user?.modules.includes(module) ?? false,
  };
}
