import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/auth/api';

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
  documentScope?: string[];
  activityDocTypes?: Record<string, string[]>;
  activitySla?: Array<Record<string, unknown>>;
  ticketCategories: string[];
  activities: string[];
  dataScope: string;
  capabilities?: Record<string, boolean>;
  role: { id: string; name: string; category: string; color: string; systemCode?: string };
}

interface PermissionContextType extends RbacPermissions {
  refreshPermissions: () => Promise<void>;
  loaded: boolean;
}

const defaultState: PermissionContextType = {
  modules: [],
  gates: [],
  docTypes: {},
  documentScope: [],
  activityDocTypes: {},
  activitySla: [],
  ticketCategories: [],
  activities: [],
  dataScope: 'TAGGED',
  capabilities: {},
  role: { id: '', name: '', category: '', color: '#666' },
  refreshPermissions: async () => {},
  loaded: false,
};

const PermissionContext = createContext<PermissionContextType>(defaultState);

function capabilitiesFromActivities(activities: string[]): Record<string, boolean> {
  const allowed = new Set(activities);
  return {
    isApprove: allowed.has('documents.approve_draft'),
    isEdit: allowed.has('documents.edit_extracted'),
    isUpload: allowed.has('documents.upload'),
    isOverride: allowed.has('documents.override_validation'),
    isReprocess: allowed.has('documents.reprocess_ocr'),
  };
}

function mergeActivities(...activityLists: Array<string[] | null | undefined>): string[] {
  return [...new Set(activityLists.flatMap((activities) => activities ?? []))];
}

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

  const fetchPermissions = useCallback(async () => {
    if (!authToken) {
      setPermissions(null);
      setLoaded(false);
      return;
    }

    const [permissionsResponse, levelResponse] = await Promise.all([
      api.get<{ ok: boolean; data: RbacPermissions }>('/auth/permissions'),
      api.get<{ ok: boolean; data: { level?: string; activities: string[] } }>('/auth/level'),
    ]);
    const nextPermissions = permissionsResponse.data.data;
    const activities = mergeActivities(nextPermissions.activities, levelResponse.data.data.activities);
    setPermissions({
      ...nextPermissions,
      activities,
      capabilities: capabilitiesFromActivities(activities),
    });
    setLoaded(true);
  }, [authToken]);

  useEffect(() => {
    if (initialPermissions) {
      setPermissions(initialPermissions);
      setLoaded(true);
    } else if (!authToken) {
      setPermissions(null);
      setLoaded(false);
    }
  }, [initialPermissions, authToken]);

  const refreshPermissions = useCallback(async () => {
    if (initialPermissions) {
      setPermissions(initialPermissions);
      setLoaded(true);
      return;
    }

    try {
      await fetchPermissions();
    } catch (error) {
      console.error('Permission refresh failed:', error);
      setPermissions(null);
      setLoaded(false);
    }
  }, [fetchPermissions, initialPermissions]);

  // On page reload, initialPermissions may be null but token is set — fetch once
  useEffect(() => {
    if (initialPermissions || !authToken) return;
    fetchPermissions().catch((error) => {
      console.error('Permission load failed:', error);
      setPermissions(null);
      setLoaded(false);
    });
  }, [authToken, fetchPermissions, initialPermissions]);

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
  const allowed = docTypes.upload ?? [];
  return allowed.includes('*') || allowed.includes(docType);
}

export function useCanApproveExtraction(docType: string): boolean {
  const { docTypes } = usePermissions();
  const allowed = docTypes.approve_extraction ?? [];
  return allowed.includes('*') || allowed.includes(docType);
}

export function useCanReviewGeneration(docType: string): boolean {
  const { docTypes } = usePermissions();
  const allowed = docTypes.review_generation ?? [];
  return allowed.includes('*') || allowed.includes(docType);
}

export function useCanViewDocType(docType: string): boolean {
  const { docTypes } = usePermissions();
  const viewList = docTypes.view;
  if (!viewList) return true;
  if (viewList.length === 0) return false;
  return viewList.includes('*') || viewList.includes(docType);
}

export type DocTypeAction =
  | 'upload'
  | 'edit_extracted'
  | 'approve_extraction'
  | 'submit_for_approval'
  | 'approve_draft'
  | 'reject_extraction'
  | 'override_approved_fields'
  | 'review_generation'
  | 'container_mapping'
  | 're_upload_document'
  | 'reprocess_ocr'
  | 'view';

export function useDocTypePermissions(): { canDo: (docType: string, action: DocTypeAction) => boolean } {
  const { docTypes } = usePermissions();

  const canDo = useCallback((docType: string, action: DocTypeAction): boolean => {
    if (action === 'view') {
      const viewList = docTypes.view;
      if (!viewList) return true;
      if (viewList.length === 0) return false;
      return viewList.includes('*') || viewList.includes(docType);
    }
    const allowed = docTypes[action] ?? [];
    return allowed.includes('*') || allowed.includes(docType);
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
