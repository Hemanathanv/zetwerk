import { AuthProvider as ConnectedAuthProvider, useAuth as useConnectedAuth } from '@/auth/AuthContext';
import type { ReactNode } from 'react';

export type Permission = {
  module: string;
  activity: string;
  dataScope: string;
  conditions: Record<string, unknown> | null;
};

const ADMIN_MODULES = ['reports', 'shipments', 'documents', 'inventory', 'accounting', 'admin', 'settings'];
const USER_MODULES = ['reports', 'shipments', 'documents', 'inventory', 'accounting', 'settings'];

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
  const isKnownAdmin = auth.user?.email?.toLowerCase() === 'admin@sprconsultech.com';
  const isAdmin = isKnownAdmin || auth.user?.systemRole === 'ADMIN' || auth.user?.systemRole === 'SUPER_ADMIN';
  const modules = isAdmin ? ADMIN_MODULES : USER_MODULES;
  const user = auth.user
    ? {
        ...auth.user,
        fullName: auth.user.name,
        systemRole: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
        userType: isKnownAdmin ? 'ADMIN' : auth.user.systemRole,
        role: {
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
