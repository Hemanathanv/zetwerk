import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';
import { usePermissions } from '@/contexts/PermissionContext';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (method === 'POST') return apiPost<T>(path, body ?? {});
  if (method === 'PUT') return apiPut<T>(path, body ?? {});
  if (method === 'PATCH') return apiPatch<T>(path, body);
  if (method === 'DELETE') return apiDelete<T>(path);
  return apiGet<T>(path);
}

function normalizeApprovedDocument(document: any): any {
  return {
    ...document,
    id: String(document.id),
    documentNumber: document.documentNumber ?? document.fileName,
    ocrStatus: document.ocrStatus ?? document.status ?? 'COMPLETED',
    validationStatus: document.validationStatus ?? null,
    approvedAt: document.approvedAt ?? document.extractedAt ?? null,
    isGenerated: Boolean(document.isGenerated),
  };
}

function mergeDocuments(primary: any[], supplemental: any[]): any[] {
  const merged = new Map<string, any>();
  [...supplemental, ...primary].forEach(document => {
    if (!document?.id) return;
    const existing = merged.get(String(document.id));
    merged.set(String(document.id), { ...document, ...existing });
  });
  return Array.from(merged.values()).sort((a, b) => {
    const ad = a.approvedAt ? new Date(a.approvedAt).getTime() : 0;
    const bd = b.approvedAt ? new Date(b.approvedAt).getTime() : 0;
    return bd - ad;
  });
}

// ─── Shipments ──────────────────────────────────────────────────────────────

export interface ShipmentFilters {
  status?: string;
  templateId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useShipments(filters: ShipmentFilters = {}) {
  const query = useQuery({
    queryKey: [
      'shipments',
      'legacy-list',
      filters.status ?? '',
      filters.templateId ?? '',
      filters.search ?? '',
      filters.limit ?? 'all',
      filters.offset ?? 0,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status)     params.set('status',     filters.status);
      if (filters.templateId) params.set('templateId', filters.templateId);
      if (filters.search)     params.set('search',     filters.search);
      if (filters.limit)      params.set('limit',      String(filters.limit));
      if (filters.offset)     params.set('offset',     String(filters.offset));
      const qs = params.toString();
      return apiFetch<{ ok: boolean; data: any[]; meta?: { total: number } }>('/api/shipments' + (qs ? '?' + qs : ''));
    },
    placeholderData: previousData => previousData,
    staleTime: 60_000,
  });

  return {
    shipments: query.data?.data ?? [],
    meta: query.data?.meta ?? { total: 0 },
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}

export function useShipmentDocuments(shipmentId: string | null | undefined) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!shipmentId) { setData([]); return; }
    setLoading(true);
    setError(null);
    try {
      const [linkedResult, approvedResult] = await Promise.all([
        apiFetch<{ ok: boolean; data: any[] }>(`/api/shipments/${shipmentId}/documents`),
        apiFetch<{ ok: boolean; data: any[] }>(`/api/v1/uploads/documents-approved?shipmentId=${encodeURIComponent(shipmentId)}`).catch(() => ({ ok: false, data: [] })),
      ]);

      const linkedDocuments = linkedResult.data ?? [];
      const documentModuleDocuments = (approvedResult.data ?? []).map(normalizeApprovedDocument);
      setData(mergeDocuments(linkedDocuments, documentModuleDocuments));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { documents: data, loading, error, refetch: fetch };
}

// ─── Doc-type helpers (config-derived, no network calls) ────────────────────

export function useUploadableDocTypes() {
  const { docTypes } = useConfig();
  return docTypes.filter(dt => !dt.isSystem).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function useApprovableDocTypes() {
  const { docTypes } = useConfig();
  const { activities } = usePermissions();
  const canApprove = activities.includes('documents.approve_draft');
  return docTypes.filter(dt => dt.hasExtraction && canApprove);
}

// ─── Gate display (derived from shipment data, no extra network call) ────────

export interface GateDisplay {
  id: string;
  gateNumber: number;
  gateName: string;
  status: string;
  isIdentityGate?: boolean;
  gateCheckType?: string;
}

export function useGateDisplay(shipment: any | null | undefined): GateDisplay[] {
  if (!shipment?.shipmentGates) return [];
  return (shipment.shipmentGates as any[]).map(sg => ({
    id:            sg.gateConfig?.id ?? sg.id,
    gateNumber:    sg.gateConfig?.gateNumber ?? 0,
    gateName:      sg.gateConfig?.gateName ?? '',
    status:        sg.status ?? 'FUTURE',
    isIdentityGate: sg.gateConfig?.isIdentityGate ?? false,
    gateCheckType: sg.gateConfig?.gateCheckType ?? '',
  }));
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface TaskFilters {
  status?: string;
  urgency?: string;
  shipmentId?: string;
}

export function useTasks(filters: TaskFilters = {}) {
  const query = useQuery({
    queryKey: ['tasks', 'legacy-list', filters.status ?? '', filters.urgency ?? '', filters.shipmentId ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status)     params.set('status',     filters.status);
      if (filters.urgency)    params.set('urgency',    filters.urgency);
      if (filters.shipmentId) params.set('shipmentId', filters.shipmentId);
      const qs = params.toString();
      const result = await apiFetch<{ ok: boolean; data: any[] }>(`/api/tasks${qs ? `?${qs}` : ''}`);
      return result.data ?? [];
    },
  });

  return {
    tasks: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}

export function useTaskCount() {
  const query = useQuery({
    queryKey: ['tasks', 'count'],
    queryFn: async () => {
      const result = await apiFetch<{ ok: boolean; data: { total: number; blockers: number } }>('/api/tasks/count');
      return result.data ?? { total: 0, blockers: 0 };
    },
    refetchInterval: 60_000,
  });

  return {
    count: query.data ?? { total: 0, blockers: 0 },
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
// ─── Task V2 hooks ───────────────────────────────────────────────────────────

export type TaskScope = 'mine' | 'team' | 'all';

export interface TaskListFilters {
  urgency?: string;
  status?: string;
  search?: string;
  shipmentId?: string;
  assignedRoleId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const DEFAULT_PAGINATION: PaginationMeta = {
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
};

export function useTaskList(scope: TaskScope = 'mine', filters: TaskListFilters = {}) {
  const query = useQuery({
    queryKey: ['tasks', 'list', scope, filters.urgency ?? '', filters.status ?? '', filters.search ?? '', filters.shipmentId ?? '', filters.assignedRoleId ?? '', filters.page ?? 1, filters.pageSize ?? 20],
    queryFn: async () => {
      const params = new URLSearchParams({ scope });
      if (filters.urgency)        params.set('urgency',        filters.urgency);
      if (filters.status)         params.set('status',         filters.status);
      if (filters.search)         params.set('search',         filters.search);
      if (filters.shipmentId)     params.set('shipmentId',     filters.shipmentId);
      if (filters.assignedRoleId) params.set('assignedRoleId', filters.assignedRoleId);
      if (filters.page)           params.set('page',           String(filters.page));
      if (filters.pageSize)       params.set('pageSize',       String(filters.pageSize));
      return apiFetch<{ ok: boolean; data: any[]; meta?: PaginationMeta }>(`/api/tasks?${params.toString()}`);
    },
  });

  return {
    tasks: query.data?.data ?? [],
    meta: query.data?.meta ?? DEFAULT_PAGINATION,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
export interface TaskSummary {
  total: number;
  blockers: number;
  warnings: number;
  normal: number;
  escalated: number;
  myCount: number;
  teamCount: number;
}

export function useTaskSummary() {
  const query = useQuery({
    queryKey: ['tasks', 'summary'],
    queryFn: async () => {
      const result = await apiFetch<{ ok: boolean; data: TaskSummary }>('/api/tasks/summary');
      return result.data ?? { total: 0, blockers: 0, warnings: 0, normal: 0, escalated: 0, myCount: 0, teamCount: 0 };
    },
  });

  return {
    summary: query.data ?? { total: 0, blockers: 0, warnings: 0, normal: 0, escalated: 0, myCount: 0, teamCount: 0 },
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
export function useTaskDetail(taskId: string | null) {
  const query = useQuery({
    queryKey: ['tasks', 'detail', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const result = await apiFetch<{ ok: boolean; data: any }>(`/api/tasks/${taskId}`);
      return result.data ?? null;
    },
  });

  return {
    task: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
// ─── Accounting tickets ──────────────────────────────────────────────────────

export interface TicketFilters {
  status?: string;
  category?: string;
  shipmentId?: string;
}

export function useAccountingTickets(filters: TicketFilters = {}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.status)     params.set('status',     filters.status);
      if (filters.category)   params.set('category',   filters.category);
      if (filters.shipmentId) params.set('shipmentId', filters.shipmentId);
      const qs = params.toString();
      const result = await apiFetch<{ ok: boolean; data: any[] }>(`/api/accounting/tickets${qs ? `?${qs}` : ''}`);
      setData(result.data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.category, filters.shipmentId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { tickets: data, loading, error, refetch: fetch };
}

// ─── D&D rates (derived from shipment data, no extra call) ──────────────────

export interface DndRate {
  containerNumber: string;
  detentionDays: number;
  demurrageDays: number;
  estimatedCost: number;
  currency: string;
}

export function useDndRates(shipment: any | null | undefined): DndRate[] {
  if (!shipment?.dndAlerts) return [];
  return (shipment.dndAlerts as any[]).map((alert: any) => ({
    containerNumber: alert.containerNumber ?? '',
    detentionDays:   alert.detentionDays   ?? 0,
    demurrageDays:   alert.demurrageDays   ?? 0,
    estimatedCost:   alert.estimatedCost   ?? 0,
    currency:        alert.currency        ?? 'USD',
  }));
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface NotificationFilters {
  type?: string;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface NotificationMeta extends PaginationMeta {
  unreadCount: number;
  typeCounts: Record<string, number>;
}

const DEFAULT_NOTIFICATION_META: NotificationMeta = {
  ...DEFAULT_PAGINATION,
  pageSize: 20,
  unreadCount: 0,
  typeCounts: {},
};

export function useNotifications(filters: NotificationFilters = {}) {
  const queryClient = useQueryClient();
  const queryKey = ['notifications', filters.type ?? '', filters.unreadOnly ?? false, filters.page ?? 1, filters.pageSize ?? 20] as const;
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.type)       params.set('type',       filters.type);
      if (filters.unreadOnly) params.set('unreadOnly', 'true');
      if (filters.page)       params.set('page',       String(filters.page));
      if (filters.pageSize)   params.set('pageSize',   String(filters.pageSize));
      const qs = params.toString();
      return apiFetch<{ ok: boolean; data: any[]; meta?: NotificationMeta }>(`/api/notifications${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['navigation', 'badges'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiFetch('/api/notifications/mark-all-read', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['navigation', 'badges'] });
    },
  });

  const data = query.data?.data ?? [];
  const meta = query.data?.meta ?? DEFAULT_NOTIFICATION_META;

  return {
    notifications: data,
    unreadCount: meta.unreadCount ?? 0,
    meta,
    loading: query.isLoading,
    refetch: query.refetch,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllAsRead: () => markAllReadMutation.mutate(),
  };
}
// ─── Part 3: Admin exit refresh ──────────────────────────────────────────────

export function useAdminExitRefresh() {
  const [location] = useLocation();
  const { refreshAll } = useConfig();
  const prevLocationRef = useRef<string>(location);

  useEffect(() => {
    const prev = prevLocationRef.current;
    prevLocationRef.current = location;

    const wasAdmin = prev.startsWith('/admin');
    const isAdmin  = location.startsWith('/admin');

    if (wasAdmin && !isAdmin) {
      refreshAll();
    }
  }, [location, refreshAll]);
}
