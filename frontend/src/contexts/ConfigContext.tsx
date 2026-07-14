import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConfigRole {
  id: string; name: string; description?: string; roleCategory: string;
  isSystemDefault: boolean; color: string; allowedLevels: string[];
  defaultModules: string[]; defaultDataScope: string;
  _count?: { users: number; roleActivities: number };
}

export interface ConfigOrg {
  id: string; name: string; slug?: string; type?: string;
  isActive: boolean; createdAt?: string;
  _count?: { users: number };
}

export interface ConfigTeam {
  id: string; name: string; orgId: string; function?: string; region?: string;
}

export interface ConfigDocTypeGate {
  docType: string; isGenerated: boolean; sortOrder: number; roleInGate?: string;
}

export interface ConfigGate {
  id: string; gateNumber: number; gateName: string; sortOrder: number;
  docTypeGates?: ConfigDocTypeGate[];
}

export interface ConfigTemplate {
  id: string; name: string; templateStatus: string; corridor?: string;
  commodity?: string; _count?: { shipments: number }; gates?: ConfigGate[];
  docTypeGates?: ConfigDocTypeGate[];
}

export interface ConfigDocType {
  id: string; orgId?: string; typeCode: string; displayName: string;
  shortCode: string; geography: string | null; hasExtraction?: boolean;
  isSystem?: boolean; sortOrder?: number;
}

export interface ConfigPartnerType {
  id: string; typeCode: string; displayName: string;
  defaultAllowedDocTypes: string[];
}

export interface ConfigTicketCategory {
  id: string; categoryCode: string; displayName: string; currency: string;
}

export interface ConfigModule {
  id: string; moduleCode: string; displayName: string; icon: string;
  route: string; sortOrder: number; isActive: boolean;
}

export interface ConfigActivity {
  id: string; activityCode: string; name: string; category: string;
  minLevel: string; description?: string;
}

interface ConfigState {
  roles: ConfigRole[];
  organisations: ConfigOrg[];
  teams: ConfigTeam[];
  templates: ConfigTemplate[];
  docTypes: ConfigDocType[];
  partnerTypes: ConfigPartnerType[];
  ticketCategories: ConfigTicketCategory[];
  modules: ConfigModule[];
  activities: ConfigActivity[];
  loading: boolean;
  error: string | null;
}

interface ConfigActions {
  refreshRoles: () => Promise<void>;
  refreshOrganisations: () => Promise<void>;
  refreshTeams: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  refreshRegistries: () => Promise<void>;
  refreshActivities: () => Promise<void>;
  refreshAll: () => Promise<void>;
  getRoleById: (id: string) => ConfigRole | undefined;
  getOrgById: (id: string) => ConfigOrg | undefined;
  getDocTypeByCode: (code: string) => ConfigDocType | undefined;
  getTemplateById: (id: string) => ConfigTemplate | undefined;
  getPartnerTypeByCode: (code: string) => ConfigPartnerType | undefined;
}

type ConfigContextType = ConfigState & ConfigActions;

const initialState: ConfigState = {
  roles: [], organisations: [], teams: [], templates: [],
  docTypes: [], partnerTypes: [], ticketCategories: [], modules: [], activities: [],
  loading: false, error: null,
};

const ConfigContext = createContext<ConfigContextType>({
  ...initialState,
  refreshRoles: async () => {},
  refreshOrganisations: async () => {},
  refreshTeams: async () => {},
  refreshTemplates: async () => {},
  refreshRegistries: async () => {},
  refreshActivities: async () => {},
  refreshAll: async () => {},
  getRoleById: () => undefined,
  getOrgById: () => undefined,
  getDocTypeByCode: () => undefined,
  getTemplateById: () => undefined,
  getPartnerTypeByCode: () => undefined,
});

// ─── Provider ──────────────────────────────────────────────────────────────────

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [state, setState] = useState<ConfigState>(initialState);

  const refreshRoles = useCallback(async () => {
    try {
      const r = await apiGet<any>('/api/admin/roles');
      setState(s => ({ ...s, roles: r.data ?? [] }));
    } catch { /* silent */ }
  }, []);

  const refreshOrganisations = useCallback(async () => {
    try {
      const r = await apiGet<any>('/api/admin/organisations');
      setState(s => ({ ...s, organisations: r.data ?? [] }));
    } catch { /* silent */ }
  }, []);

  const refreshTeams = useCallback(async () => {
    try {
      const r = await apiGet<any>('/api/admin/teams');
      setState(s => ({ ...s, teams: r.data ?? [] }));
    } catch { /* silent */ }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const r = await apiGet<any>('/api/admin/templates');
      setState(s => ({ ...s, templates: r.data ?? [] }));
    } catch { /* silent */ }
  }, []);

  const refreshActivities = useCallback(async () => {
    try {
      const r = await apiGet<any>('/api/admin/activities');
      setState(s => ({ ...s, activities: r.data ?? [] }));
    } catch { /* silent */ }
  }, []);

  const refreshRegistries = useCallback(async () => {
    try {
      const [dtRes, ptRes, catRes, modRes] = await Promise.all([
        apiGet<any>('/api/admin/registries/doc-types'),
        apiGet<any>('/api/admin/registries/partner-types'),
        apiGet<any>('/api/admin/registries/ticket-categories'),
        apiGet<any>('/api/admin/registries/modules'),
      ]);
      setState(s => ({
        ...s,
        docTypes:         dtRes.data  ?? [],
        partnerTypes:     ptRes.data  ?? [],
        ticketCategories: catRes.data ?? [],
        modules:          modRes.data ?? [],
      }));
    } catch { /* silent */ }
  }, []);

  const refreshAll = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const [rolesRes, orgsRes, teamsRes, templatesRes, dtRes, ptRes, catRes, modRes, actRes] = await Promise.all([
        apiGet<any>('/api/admin/roles'),
        apiGet<any>('/api/admin/organisations'),
        apiGet<any>('/api/admin/teams').catch(() => ({ data: [] })),
        apiGet<any>('/api/admin/templates'),
        apiGet<any>('/api/admin/registries/doc-types'),
        apiGet<any>('/api/admin/registries/partner-types'),
        apiGet<any>('/api/admin/registries/ticket-categories'),
        apiGet<any>('/api/admin/registries/modules'),
        apiGet<any>('/api/admin/activities'),
      ]);
      setState({
        roles:            rolesRes.data     ?? [],
        organisations:    orgsRes.data      ?? [],
        teams:            teamsRes.data     ?? [],
        templates:        templatesRes.data ?? [],
        docTypes:         dtRes.data        ?? [],
        partnerTypes:     ptRes.data        ?? [],
        ticketCategories: catRes.data       ?? [],
        modules:          modRes.data       ?? [],
        activities:       actRes.data       ?? [],
        loading: false, error: null,
      });
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err?.message ?? 'Config load failed' }));
    }
  }, []);

  useEffect(() => {
    setState(initialState);
  }, [isAuthenticated]);

  const getRoleById = useCallback((id: string) => state.roles.find(r => r.id === id), [state.roles]);
  const getOrgById = useCallback((id: string) => state.organisations.find(o => o.id === id), [state.organisations]);
  const getDocTypeByCode = useCallback((code: string) => state.docTypes.find(d => d.typeCode === code), [state.docTypes]);
  const getTemplateById = useCallback((id: string) => state.templates.find(t => t.id === id), [state.templates]);
  const getPartnerTypeByCode = useCallback((code: string) => state.partnerTypes.find(p => p.typeCode === code), [state.partnerTypes]);

  return (
    <ConfigContext.Provider value={{
      ...state,
      refreshRoles, refreshOrganisations, refreshTeams, refreshTemplates,
      refreshRegistries, refreshActivities, refreshAll,
      getRoleById, getOrgById, getDocTypeByCode, getTemplateById, getPartnerTypeByCode,
    }}>
      {children}
    </ConfigContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useConfig(): ConfigContextType {
  return useContext(ConfigContext);
}

export function useRoles()            { return useConfig().roles; }
export function useOrganisations()    { return useConfig().organisations; }
export function useDocTypes()         { return useConfig().docTypes; }
export function useTemplates()        { return useConfig().templates; }
export function useModules()          { return useConfig().modules; }
export function usePartnerTypes()     { return useConfig().partnerTypes; }
export function useTicketCategories() { return useConfig().ticketCategories; }
export function useActivities()       { return useConfig().activities; }
