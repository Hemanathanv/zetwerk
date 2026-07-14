import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

export interface GateAccess {
  gateNumber: number;
  gateName: string;
  accessLevel: string;
  canEscalate: boolean;
  canOverride: boolean;
}

export interface RbacPermissions {
  modules: string[];
  gates: GateAccess[];
  docTypes: Record<string, string[]>;
  ticketCategories: string[];
  activities: string[];
  dataScope: string;
  level?: string;
  role: { id: string; name: string; category: string; color: string };
}

interface PermissionContextType extends RbacPermissions {
  refreshPermissions: () => Promise<void>;
  loaded: boolean;
}

const defaultState: PermissionContextType = {
  modules: [],
  gates: [],
  docTypes: {},
  ticketCategories: [],
  activities: [],
  dataScope: 'TAGGED',
  role: { id: '', name: '', category: '', color: '#666' },
  refreshPermissions: async () => {},
  loaded: false,
};

const PermissionContext = createContext<PermissionContextType>(defaultState);

export function PermissionProvider({
  initialPermissions,
  authToken,
  children,
}: {
  initialPermissions: RbacPermissions | null;
  authToken: string | null;
  children: React.ReactNode;
}) {
  const [permissions, setPermissions] = useState<RbacPermissions | null>(initialPermissions);
  const [loaded, setLoaded] = useState(!!initialPermissions);

  useEffect(() => {
    if (initialPermissions) {
      setPermissions(initialPermissions);
      setLoaded(true);
    } else {
      setPermissions(null);
      setLoaded(false);
    }
  }, [initialPermissions]);

  const refreshPermissions = useCallback(async () => {
    if (initialPermissions) {
      setPermissions(initialPermissions);
      setLoaded(true);
    }
  }, [initialPermissions]);

  // On page reload, initialPermissions may be null but token is set — fetch once
  const value: PermissionContextType = {
    ...(permissions ?? defaultState),
    refreshPermissions,
    loaded,
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions(): PermissionContextType {
  return useContext(PermissionContext);
}

export function useHasModule(moduleCode: string): boolean {
  const { modules } = usePermissions();
  return modules.includes(moduleCode);
}

export function useHasActivity(activityCode: string): boolean {
  const { activities } = usePermissions();
  return activities.includes(activityCode);
}

export function useCanUploadDocType(docType: string): boolean {
  const { docTypes } = usePermissions();
  return docTypes.upload?.includes(docType) ?? false;
}

export function useCanApproveExtraction(docType: string): boolean {
  const { docTypes } = usePermissions();
  return docTypes.approve_extraction?.includes(docType) ?? false;
}

export function useCanReviewGeneration(docType: string): boolean {
  const { docTypes } = usePermissions();
  return docTypes.review_generation?.includes(docType) ?? false;
}

export function useCanViewDocType(docType: string): boolean {
  const { docTypes } = usePermissions();
  const viewList = docTypes.view;
  if (!viewList || viewList.length === 0) return true;
  return viewList.includes(docType);
}

export type DocTypeAction = 'upload' | 'approve_extraction' | 'review_generation' | 'view';

export function useDocTypePermissions(): { canDo: (docType: string, action: DocTypeAction) => boolean } {
  const { docTypes } = usePermissions();

  const canDo = useCallback((docType: string, action: DocTypeAction): boolean => {
    if (action === 'view') {
      const viewList = docTypes.view;
      if (!viewList || viewList.length === 0) return true;
      return viewList.includes(docType);
    }
    return docTypes[action]?.includes(docType) ?? false;
  }, [docTypes]);

  return useMemo(() => ({ canDo }), [canDo]);
}

export function useGateAccess(gateNumber: number): GateAccess | undefined {
  const { gates } = usePermissions();
  return gates.find(g => g.gateNumber === gateNumber);
}

export function usePermittedUploadDocTypes(): string[] {
  const { docTypes } = usePermissions();
  return docTypes.upload ?? [];
}

export function usePermittedGates(): GateAccess[] {
  const { gates } = usePermissions();
  return gates.filter(g => g.accessLevel !== 'none');
}

export function useIsAdmin(): boolean {
  return useHasModule('admin');
}

export function useUserRoleColor(): string {
  const { role } = usePermissions();
  return role.color || '#666';
}
