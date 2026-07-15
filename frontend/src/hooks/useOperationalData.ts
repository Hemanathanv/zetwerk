import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { getAuthToken } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';
import { usePermissions } from '@/contexts/PermissionContext';

const API_BASE = ((import.meta.env.VITE_BACKEND_API_BASE as string | undefined) ?? '').replace(/\/$/, '');

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers as Record<string, string> ?? {}) } });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
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
  const [data, setData] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ total: number }>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.status)     params.set('status',     filters.status);
      if (filters.templateId) params.set('templateId', filters.templateId);
      if (filters.search)     params.set('search',     filters.search);
      if (filters.limit)      params.set('limit',      String(filters.limit));
      if (filters.offset)     params.set('offset',     String(filters.offset));
      const qs = params.toString();
      const result = await apiFetch<{ ok: boolean; data: any[]; meta?: { total: number } }>(`/api/shipments${qs ? `?${qs}` : ''}`);
      setData(result.data ?? []);
      setMeta(result.meta ?? { total: 0 });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.templateId, filters.search, filters.limit, filters.offset]);

  useEffect(() => { fetch(); }, [fetch]);

  return { shipments: data, meta, loading, error, refetch: fetch };
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
      const result = await apiFetch<{ ok: boolean; data: any[] }>(`/api/shipments/${shipmentId}/documents`);
      setData(result.data ?? []);
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
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.status)     params.set('status',     filters.status);
      if (filters.urgency)    params.set('urgency',    filters.urgency);
      if (filters.shipmentId) params.set('shipmentId', filters.shipmentId);
      const qs = params.toString();
      const result = await apiFetch<{ ok: boolean; data: any[] }>(`/api/tasks${qs ? `?${qs}` : ''}`);
      setData(result.data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.urgency, filters.shipmentId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { tasks: data, loading, error, refetch: fetch };
}

export function useTaskCount() {
  const [count, setCount] = useState<{ total: number; blockers: number }>({ total: 0, blockers: 0 });
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const result = await apiFetch<{ ok: boolean; data: { total: number; blockers: number } }>('/api/tasks/count');
      setCount(result.data ?? { total: 0, blockers: 0 });
    } catch {
      // non-critical — keep previous count
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => clearInterval(interval);
  }, [fetch]);

  return { count, loading, refetch: fetch };
}

// ─── Task V2 hooks ───────────────────────────────────────────────────────────

export type TaskScope = 'mine' | 'team' | 'all';

export interface TaskListFilters {
  urgency?: string;
  status?: string;
  shipmentId?: string;
  assignedRoleId?: string;
}

export function useTaskList(scope: TaskScope = 'mine', filters: TaskListFilters = {}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope });
      if (filters.urgency)        params.set('urgency',        filters.urgency);
      if (filters.status)         params.set('status',         filters.status);
      if (filters.shipmentId)     params.set('shipmentId',     filters.shipmentId);
      if (filters.assignedRoleId) params.set('assignedRoleId', filters.assignedRoleId);
      const result = await apiFetch<{ ok: boolean; data: any[] }>(`/api/tasks?${params.toString()}`);
      setData(result.data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [scope, filters.urgency, filters.status, filters.shipmentId, filters.assignedRoleId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { tasks: data, loading, error, refetch: fetch };
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
  const [summary, setSummary] = useState<TaskSummary>({ total: 0, blockers: 0, warnings: 0, normal: 0, escalated: 0, myCount: 0, teamCount: 0 });
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const result = await apiFetch<{ ok: boolean; data: TaskSummary }>('/api/tasks/summary');
      setSummary(result.data ?? { total: 0, blockers: 0, warnings: 0, normal: 0, escalated: 0, myCount: 0, teamCount: 0 });
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { summary, loading, refetch: fetch };
}

export function useTaskDetail(taskId: string | null) {
  const [task, setTask] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!taskId) { setTask(null); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ ok: boolean; data: any }>(`/api/tasks/${taskId}`);
      setTask(result.data ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { task, loading, error, refetch: fetch };
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

export function useNotifications() {
  const [data, setData] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const result = await apiFetch<{ ok: boolean; data: any[]; meta?: { unreadCount: number } }>('/api/notifications');
      setData(result.data ?? []);
      setUnreadCount(result.meta?.unreadCount ?? 0);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setData(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [fetch]);

  const markAllAsRead = useCallback(async () => {
    try {
      await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
      setData(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, []);

  return { notifications: data, unreadCount, loading, refetch: fetch, markRead, markAllAsRead };
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
