import { AuthProvider as ConnectedAuthProvider, useAuth as useConnectedAuth } from '@/auth/AuthContext';
import type { ReactNode } from 'react';

export type Permission = {
  module: string;
  activity: string;
  dataScope: string;
  conditions: Record<string, unknown> | null;
};

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
  const user = auth.user
    ? {
        ...auth.user,
        fullName: auth.user.name,
        userType: auth.user.systemRole,
        role: {
          id: auth.user.systemRole,
          name: auth.user.systemRole.replace(/_/g, ' '),
          category: auth.user.systemRole,
        },
        org: null,
        permissions: [] as Permission[],
        modules:
          auth.user.systemRole === 'ADMIN' || auth.user.systemRole === 'SUPER_ADMIN'
            ? ['reports', 'shipments', 'documents', 'inventory', 'accounting', 'admin']
            : ['reports', 'shipments', 'documents', 'inventory', 'accounting'],
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
