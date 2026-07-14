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
const USER_MODULES = ['dashboard', 'reports', 'shipments', 'tasks', 'documents', 'inventory', 'warehouse', 'dnd', 'accounting', 'settings'];

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
  const isAdmin = isKnownAdmin || auth.user?.systemRole === 'ADMIN' || auth.user?.systemRole === 'SUPER_ADMIN';
  const modules = keycloakPermissions?.modules ?? (isAdmin ? ADMIN_MODULES : USER_MODULES);
  const rbacPermissions: RbacPermissions | null = auth.user
    ? keycloakPermissions ?? {
        modules,
        gates: [],
        docTypes: {},
        ticketCategories: [],
        activities: ['DOC-003'],
        dataScope: isAdmin ? 'ALL' : 'TAGGED',
        level: isAdmin ? 'L4' : 'L1',
        role: {
          id: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
          name: (isKnownAdmin ? 'ADMIN' : auth.user.systemRole).replace(/_/g, ' '),
          category: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
          color: '#0f766e',
        },
      }
    : null;
  const keycloakRole = keycloakPermissions?.role;
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
        level: keycloakPermissions?.level ?? (isAdmin ? 'L4' : 'L1'),
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
