import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { RequireActivity } from '@/components/PermissionGate';
import { RoleBadge } from '@/components/RoleBadge';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';
import {
  useTaskList,
  useTaskSummary,
  useTaskDetail,
  type TaskScope,
} from '@/hooks/useOperationalData';
import {
  ClipboardList, AlertTriangle, Ban, Clock, ChevronUp, ChevronDown,
  X, ArrowUpRight, RotateCcw, CheckCircle, SlidersHorizontal, Search,
  RefreshCw, UserPlus, Loader2, Plus, Users, Play, Send, UserCheck,
  ArrowRight, Package, BarChart2,
} from 'lucide-react';
import { FilterChips } from '@/components/vs/FilterChips';

// ─── Design tokens ────────────────────────────────────────────────────────────

const TEAL   = '#0d9488';
const RED    = '#ef4444';
const AMBER  = '#f59e0b';
const BLUE   = '#3b82f6';
const GREEN  = '#16a34a';
const INDIGO = '#6366f1';
const BORDER = 'hsl(var(--border))';
const FG     = 'hsl(var(--foreground))';
const MUTED  = 'hsl(var(--muted-foreground))';
const CARD   = 'hsl(var(--card))';
const PANEL  = 'hsl(var(--background))';

const URGENCY_COLOR: Record<string, string> = {
  BLOCKER: RED,
  WARNING: AMBER,
  NORMAL:  '#94a3b8',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING:     '#94a3b8',
  ASSIGNED:    INDIGO,
  IN_PROGRESS: BLUE,
  ESCALATED:   RED,
  COMPLETED:   GREEN,
  CANCELLED:   '#94a3b8',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:     'Pending',
  ASSIGNED:    'Assigned',
  IN_PROGRESS: 'In Progress',
  ESCALATED:   'Escalated',
  COMPLETED:   'Completed',
  CANCELLED:   'Cancelled',
};

const URGENCY_ORDER: Record<string, number> = { BLOCKER: 0, WARNING: 1, NORMAL: 2 };

const CATEGORIES = ['Documents', 'Validation', 'Gates', 'Accounting', 'Inventory', 'General'] as const;
type TaskCategory = typeof CATEGORIES[number];

const ESCALATION_REASONS = [
  'SLA breach',
  'Resource unavailable',
  'Needs senior sign-off',
  'Blocked by external party',
  'Other',
] as const;

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function taskApi<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Task API request failed: ${path}`);
  }
  return data as T;
}

function invalidateTaskQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
  queryClient.invalidateQueries({ queryKey: ['navigation', 'badges'] });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTaskEntityLink(task: any): string {
  switch (task.entityType) {
    case 'document':           return `/documents/${task.entityId}`;
    // case 'accounting_ticket':  return '/accounting';
    // case 'gate':
    // case 'validation_result':
    // case 'generation_trigger':
    // case 'shipment_milestone': return task.shipmentId ? `/shipments/${task.shipmentId}` : '/tasks';
    case 'shipment':           return `/shipments/${task.entityId || task.shipmentId}`;
    // default:                   return task.shipmentId ? `/shipments/${task.shipmentId}` : '/tasks';
    default:                   return 'null';
  }
}

function formatTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60)  return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60)     return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)      return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatSlaChip(task: any): { label: string; color: string; bg: string } | null {
  if (!task.slaDeadline) return null;
  const deadline = new Date(task.slaDeadline).getTime();
  const created  = new Date(task.createdAt).getTime();
  const now      = Date.now();
  const total    = deadline - created;
  if (total <= 0) return null;
  const pct = ((now - created) / total) * 100;
  const remaining = deadline - now;
  const hrs = Math.abs(Math.floor(remaining / 3_600_000));
  const days = Math.floor(hrs / 24);
  const timeStr = days > 0 ? `${days}d ${hrs % 24}h` : `${hrs}h`;

  if (remaining <= 0) {
    return { label: `${timeStr} over`, color: RED, bg: 'hsla(0,84%,60%,0.1)' };
  }
  if (pct >= 75) {
    return { label: `${timeStr} left`, color: AMBER, bg: 'hsla(38,92%,50%,0.1)' };
  }
  if (pct >= 50) {
    return { label: `${timeStr} left`, color: BLUE, bg: 'hsla(221,83%,53%,0.1)' };
  }
  return null;
}


function TaskRoleLabel({ task }: { task: any }) {
  if (!task.assignedRole) return <span style={{ fontSize: 12, color: MUTED }}>—</span>;
  if (task.assignedRoleName && task.assignedRoleName !== task.assignedRole) {
    return <span style={{ fontSize: 12.5, fontWeight: 600, color: FG }}>{task.assignedRoleName}</span>;
  }
  return <RoleBadge roleId={task.assignedRole} size="sm" />;
}

function taskShipmentRef(task: any): string {
  return task.shipmentId && task.shipment?.shipmentNumber ? String(task.shipment.shipmentNumber) : '';
}

function computeSlaBar(task: any) {
  if (!task.slaDeadline) return null;
  const created  = new Date(task.createdAt).getTime();
  const deadline = new Date(task.slaDeadline).getTime();
  const now      = Date.now();
  const total    = deadline - created;
  if (total <= 0) return null;
  const pct     = Math.min(((now - created) / total) * 100, 100);
  const remaining = deadline - now;
  const hrs     = Math.abs(Math.floor(remaining / 3_600_000));
  const days    = Math.floor(hrs / 24);
  const timeStr = days > 0 ? `${days}d ${hrs % 24}h` : `${Math.max(hrs, 0)}h`;
  const isOver  = remaining <= 0;
  const color   = isOver ? RED : pct >= 75 ? AMBER : BLUE;
  const label   = isOver ? `${timeStr} overdue` : `${timeStr} remaining`;
  return { pct, color, label, isOver };
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Sortable column header ───────────────────────────────────────────────────

function SortHeader({
  label, field, sort, onSort, width, textAlign = 'left',
}: {
  label: string; field: string;
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (f: string) => void;
  width?: number; textAlign?: 'left' | 'right';
}) {
  const active = sort.field === field;
  return (
    <div
      onClick={() => onSort(field)}
      style={{
        flexShrink: width ? 0 : undefined,
        flex: width ? undefined : 1,
        width,
        minWidth: 0,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: active ? FG : MUTED,
        textAlign,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        justifyContent: textAlign === 'right' ? 'flex-end' : 'flex-start',
        userSelect: 'none',
      }}
    >
      {label}
      {active
        ? sort.dir === 'asc'
          ? <ChevronUp size={10} />
          : <ChevronDown size={10} />
        : <ChevronDown size={10} style={{ opacity: 0.3 }} />}
    </div>
  );
}

// ─── Modal backdrop wrapper ───────────────────────────────────────────────────

function ModalBackdrop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

// ─── BulkActionBar ────────────────────────────────────────────────────────────

function BulkActionBar({
  count,
  onClear,
  onMarkComplete,
  onReassign,
  onEscalate,
  loading,
}: {
  count: number;
  onClear: () => void;
  onMarkComplete: () => void;
  onReassign: () => void;
  onEscalate: () => void;
  loading: boolean;
}) {
  const btnStyle = (color: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 5,
    fontSize: 12.5, fontWeight: 600, color: '#fff',
    backgroundColor: color, border: 'none', borderRadius: 6,
    padding: '6px 12px', cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap',
  });

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 20,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 16px',
      backgroundColor: `${BLUE}10`,
      borderBottom: `1px solid ${BLUE}30`,
      borderLeft: `3px solid ${BLUE}`,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: BLUE, minWidth: 80 }}>
        {count} selected
      </span>
      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
        <RequireActivity code="TSK-002">
          <button onClick={onMarkComplete} disabled={loading} style={btnStyle(GREEN)}>
            <CheckCircle size={12} />
            Mark complete ({count})
          </button>
        </RequireActivity>
        <RequireActivity code="TSK-003">
          <button onClick={onReassign} disabled={loading} style={btnStyle(INDIGO)}>
            <RotateCcw size={12} />
            Reassign ({count})
          </button>
        </RequireActivity>
        <RequireActivity code="TSK-004">
          <button onClick={onEscalate} disabled={loading} style={btnStyle(AMBER)}>
            <AlertTriangle size={12} />
            Escalate ({count})
          </button>
        </RequireActivity>
      </div>
      <button
        onClick={onClear}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: MUTED, background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <X size={12} /> Clear
      </button>
    </div>
  );
}

// ─── BulkEscalationModal ──────────────────────────────────────────────────────

function BulkEscalationModal({ count, onClose, onConfirm }: {
  count: number; onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason) return;
    setSubmitting(true);
    await onConfirm(reason);
    setSubmitting(false);
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ backgroundColor: CARD, borderRadius: 8, width: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: FG, marginBottom: 4 }}>Escalate {count} task{count !== 1 ? 's' : ''}</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>Select a reason for escalation. All selected tasks will be escalated.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {ESCALATION_REASONS.map(r => (
            <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5, color: reason === r ? FG : MUTED, fontWeight: reason === r ? 600 : 400 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${reason === r ? AMBER : BORDER}`, backgroundColor: reason === r ? AMBER : 'transparent', flexShrink: 0, transition: '0.1s' }} />
              {r}
              <input type="radio" value={r} checked={reason === r} onChange={() => setReason(r)} style={{ display: 'none' }} />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!reason || submitting} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: AMBER, color: '#fff', fontSize: 13, fontWeight: 600, cursor: !reason || submitting ? 'not-allowed' : 'pointer', opacity: !reason || submitting ? 0.6 : 1 }}>
            {submitting ? 'Escalating…' : 'Escalate all'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── BulkRolePickerModal ──────────────────────────────────────────────────────

function BulkRolePickerModal({ count, onClose, onConfirm }: {
  count: number; onClose: () => void;
  onConfirm: (roleId: string) => void;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { data: roles = [] } = useQuery({
    queryKey: ['tasks', 'roles'],
    queryFn: async () => (await taskApi<{ ok: boolean; data: any[] }>('/api/tasks/roles')).data ?? [],
  });

  async function handleSubmit() {
    if (!selectedRoleId) return;
    setSubmitting(true);
    await onConfirm(selectedRoleId);
    setSubmitting(false);
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ backgroundColor: CARD, borderRadius: 8, width: 380, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: FG, marginBottom: 4 }}>Reassign {count} task{count !== 1 ? 's' : ''}</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>Select the role to reassign these tasks to.</div>
        <select
          value={selectedRoleId}
          onChange={e => setSelectedRoleId(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, marginBottom: 20 }}
        >
          <option value="">Select role…</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.displayName || r.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!selectedRoleId || submitting} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: INDIGO, color: '#fff', fontSize: 13, fontWeight: 600, cursor: !selectedRoleId || submitting ? 'not-allowed' : 'pointer', opacity: !selectedRoleId || submitting ? 0.6 : 1 }}>
            {submitting ? 'Reassigning…' : 'Reassign all'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── EscalationDialog ─────────────────────────────────────────────────────────

function EscalationDialog({ taskId, onClose, onSuccess }: {
  taskId: string; onClose: () => void; onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [targetRoleId, setTargetRoleId] = useState('');
  const [error, setError] = useState('');
  const { data: roles = [] } = useQuery({
    queryKey: ['tasks', 'roles', 'minLevel', 3],
    queryFn: async () => (await taskApi<{ ok: boolean; data: any[] }>('/api/tasks/roles?minLevel=3')).data ?? [],
  });
  const escalateMutation = useMutation({
    mutationFn: () => taskApi(`/api/tasks/${taskId}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason, note: note || undefined, targetRoleId: targetRoleId || undefined }),
    }),
    onSuccess: () => {
      invalidateTaskQueries(queryClient);
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Failed to escalate'),
  });

  async function handleSubmit() {
    if (!reason) return;
    setError('');
    escalateMutation.mutate();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ backgroundColor: CARD, borderRadius: 8, width: 420, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: FG }}>Escalate Task</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 8 }}>Reason *</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {ESCALATION_REASONS.map(r => (
            <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 8px', borderRadius: 6, backgroundColor: reason === r ? `${AMBER}10` : 'transparent', border: `1px solid ${reason === r ? `${AMBER}40` : 'transparent'}` }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${reason === r ? AMBER : BORDER}`, backgroundColor: reason === r ? AMBER : 'transparent', flexShrink: 0, transition: '0.1s' }} />
              <span style={{ fontSize: 13.5, color: reason === r ? FG : MUTED, fontWeight: reason === r ? 600 : 400 }}>{r}</span>
              <input type="radio" value={r} checked={reason === r} onChange={() => setReason(r)} style={{ display: 'none' }} />
            </label>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Escalate to role (optional)</div>
        <select
          value={targetRoleId}
          onChange={e => setTargetRoleId(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, marginBottom: 12 }}
        >
          <option value="">Auto-determine</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.displayName || r.name}</option>)}
        </select>

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Note (optional)</div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add context for the escalation target…"
          rows={2}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }}
        />

        {error && <div style={{ fontSize: 12.5, color: RED, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!reason || escalateMutation.isPending} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: AMBER, color: '#fff', fontSize: 13, fontWeight: 600, cursor: !reason || escalateMutation.isPending ? 'not-allowed' : 'pointer', opacity: !reason || escalateMutation.isPending ? 0.6 : 1 }}>
            {escalateMutation.isPending ? 'Escalating…' : 'Escalate & create child task'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── ReassignDialog ───────────────────────────────────────────────────────────

function ReassignDialog({ taskId, onClose, onSuccess }: {
  taskId: string; onClose: () => void; onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const debouncedSearch = useDebounce(userSearch, 300);
  const { data: roles = [] } = useQuery({
    queryKey: ['tasks', 'roles'],
    queryFn: async () => (await taskApi<{ ok: boolean; data: any[] }>('/api/tasks/roles')).data ?? [],
  });
  const userQuery = useQuery({
    queryKey: ['tasks', 'users', selectedRoleId, debouncedSearch],
    enabled: debouncedSearch.length >= 2 || !!selectedRoleId,
    queryFn: async () => {
      const params = new URLSearchParams({ search: debouncedSearch });
      if (selectedRoleId) params.set('roleId', selectedRoleId);
      return (await taskApi<{ ok: boolean; data: any[] }>(`/api/tasks/users?${params.toString()}`)).data ?? [];
    },
  });
  const reassignMutation = useMutation({
    mutationFn: () => taskApi(`/api/tasks/${taskId}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ assignedRoleId: selectedRoleId, assignedToId: selectedUserId || undefined, note: note || undefined }),
    }),
    onSuccess: () => {
      invalidateTaskQueries(queryClient);
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Failed to reassign'),
  });

  useEffect(() => { setUsers(userQuery.data ?? []); }, [userQuery.data]);

  async function handleSubmit() {
    if (!selectedRoleId) return;
    setError('');
    reassignMutation.mutate();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ backgroundColor: CARD, borderRadius: 8, width: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: FG }}>Reassign Task</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={16} /></button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Assign to role *</div>
        <select
          value={selectedRoleId}
          onChange={e => { setSelectedRoleId(e.target.value); setSelectedUserId(''); setUserSearch(''); }}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, marginBottom: 12 }}
        >
          <option value="">Select role…</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.displayName || r.name}</option>)}
        </select>

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Specific user (optional)</div>
        <input
          value={userSearch}
          onChange={e => { setUserSearch(e.target.value); setSelectedUserId(''); }}
          placeholder="Search by name or email…"
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, marginBottom: 6, boxSizing: 'border-box' }}
        />
        {users.length > 0 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 7, overflow: 'hidden', marginBottom: 12, maxHeight: 160, overflowY: 'auto' }}>
            {users.map(u => (
              <div
                key={u.id}
                onClick={() => { setSelectedUserId(u.id); setUserSearch(u.fullName); setUsers([]); }}
                style={{ padding: '8px 10px', cursor: 'pointer', backgroundColor: selectedUserId === u.id ? `${BLUE}10` : 'transparent', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 500, color: FG }}>{u.fullName}</div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{u.email}</div>
                {u.level && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: `${BLUE}15`, color: BLUE, padding: '1px 5px', borderRadius: 999, marginLeft: 'auto' }}>{u.level}</span>}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Note (optional)</div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Reason for reassignment…"
          rows={2}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }}
        />

        {error && <div style={{ fontSize: 12.5, color: RED, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!selectedRoleId || reassignMutation.isPending} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: INDIGO, color: '#fff', fontSize: 13, fontWeight: 600, cursor: !selectedRoleId || reassignMutation.isPending ? 'not-allowed' : 'pointer', opacity: !selectedRoleId || reassignMutation.isPending ? 0.6 : 1 }}>
            {reassignMutation.isPending ? 'Reassigning…' : 'Reassign'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── DelegationDialog ─────────────────────────────────────────────────────────

function DelegationDialog({ taskId, onClose, onSuccess }: {
  taskId: string; onClose: () => void; onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const debouncedSearch = useDebounce(userSearch, 300);
  const userQuery = useQuery({
    queryKey: ['tasks', 'users', 'delegate', debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: async () => (await taskApi<{ ok: boolean; data: any[] }>(`/api/tasks/users?search=${encodeURIComponent(debouncedSearch)}`)).data ?? [],
  });
  const delegateMutation = useMutation({
    mutationFn: () => taskApi(`/api/tasks/${taskId}/delegate`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: selectedUser?.id, note: note || undefined }),
    }),
    onSuccess: () => {
      invalidateTaskQueries(queryClient);
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Failed to delegate'),
  });

  useEffect(() => { setUsers(userQuery.data ?? []); }, [userQuery.data]);

  async function handleSubmit() {
    if (!selectedUser) return;
    setError('');
    delegateMutation.mutate();
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ backgroundColor: CARD, borderRadius: 8, width: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: FG }}>Delegate Task</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 16 }}>Delegate authority to another user. You cannot delegate to a lower-level user.</div>

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Search user *</div>
        <input
          value={userSearch}
          onChange={e => { setUserSearch(e.target.value); if (!e.target.value) setSelectedUser(null); }}
          placeholder="Type name or email (≥2 chars)…"
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${selectedUser ? `${BLUE}60` : BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, marginBottom: 6, boxSizing: 'border-box' }}
        />

        {selectedUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: `${BLUE}10`, border: `1px solid ${BLUE}30`, borderRadius: 7, marginBottom: 12 }}>
            <UserCheck size={13} color={BLUE} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: FG }}>{selectedUser.fullName}</span>
            <span style={{ fontSize: 11.5, color: MUTED }}>{selectedUser.email}</span>
            {selectedUser.level && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: `${BLUE}15`, color: BLUE, padding: '1px 5px', borderRadius: 999, marginLeft: 'auto' }}>{selectedUser.level}</span>}
            <button onClick={() => { setSelectedUser(null); setUserSearch(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, marginLeft: 4 }}><X size={12} /></button>
          </div>
        )}

        {!selectedUser && users.length > 0 && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 7, overflow: 'hidden', marginBottom: 12, maxHeight: 200, overflowY: 'auto' }}>
            {users.map(u => (
              <div
                key={u.id}
                onClick={() => { setSelectedUser(u); setUserSearch(u.fullName); setUsers([]); }}
                style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'hsl(var(--muted)/0.3)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: FG }}>{u.fullName}</div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>{u.email}</div>
                </div>
                {u.level && <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: `${BLUE}15`, color: BLUE, padding: '1px 5px', borderRadius: 999, marginLeft: 'auto' }}>{u.level}</span>}
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: MUTED, marginBottom: 6 }}>Note (optional)</div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Why are you delegating? Handoff context…"
          rows={2}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', color: FG, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }}
        />

        {error && <div style={{ fontSize: 12.5, color: RED, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!selectedUser || delegateMutation.isPending} style={{ flex: 1, padding: '9px 0', borderRadius: 7, border: 'none', backgroundColor: TEAL, color: '#fff', fontSize: 13, fontWeight: 600, cursor: !selectedUser || delegateMutation.isPending ? 'not-allowed' : 'pointer', opacity: !selectedUser || delegateMutation.isPending ? 0.6 : 1 }}>
            {delegateMutation.isPending ? 'Delegating…' : 'Delegate'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── TaskCreationDrawer ───────────────────────────────────────────────────────

function TaskCreationDrawer({ onClose, onCreated }: {
  onClose: () => void; onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('General');
  const [urgency, setUrgency] = useState('NORMAL');
  const [assignedRole, setAssignedRole] = useState('');
  const [slaDeadline, setSlaDeadline] = useState('');
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [shipments, setShipments] = useState<any[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<any | null>(null);
  const [error, setError] = useState('');
  const debouncedShipmentSearch = useDebounce(shipmentSearch, 300);
  const { data: roles = [] } = useQuery({
    queryKey: ['tasks', 'roles'],
    queryFn: async () => (await taskApi<{ ok: boolean; data: any[] }>('/api/tasks/roles')).data ?? [],
  });
  const shipmentQuery = useQuery({
    queryKey: ['shipments', 'task-search', debouncedShipmentSearch],
    enabled: debouncedShipmentSearch.length >= 2,
    queryFn: async () => (await taskApi<{ ok: boolean; data: any[] }>(`/api/shipments?search=${encodeURIComponent(debouncedShipmentSearch)}&limit=8`)).data ?? [],
  });
  const createMutation = useMutation({
    mutationFn: () => taskApi('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        assignedRole,
        urgency,
        shipmentId: selectedShipment?.id || undefined,
        slaDeadline: slaDeadline || undefined,
      }),
    }),
    onSuccess: () => {
      invalidateTaskQueries(queryClient);
      onCreated();
      onClose();
    },
    onError: (err: Error) => setError(err.message || 'Failed to create task'),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => { setShipments(shipmentQuery.data ?? []); }, [shipmentQuery.data]);

  async function handleSubmit() {
    if (!title.trim() || !assignedRole) { setError('Title and role are required'); return; }
    setError('');
    createMutation.mutate();
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 7,
    border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))',
    color: FG, boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', color: MUTED, marginBottom: 5, display: 'block',
  };

  const URGENCY_OPTIONS = [
    { value: 'NORMAL', label: 'Normal', color: '#94a3b8' },
    { value: 'WARNING', label: 'Warning', color: AMBER },
    { value: 'BLOCKER', label: 'Blocker', color: RED },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100 }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
        backgroundColor: CARD, zIndex: 101, display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 30px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={16} color={TEAL} />
            <span style={{ fontSize: 15, fontWeight: 700, color: FG }}>New Task</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Shipment typeahead */}
          <div>
            <span style={labelStyle}>Shipment (optional)</span>
            {selectedShipment ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', backgroundColor: `${TEAL}10`, border: `1px solid ${TEAL}30`, borderRadius: 7 }}>
                <Package size={13} color={TEAL} />
                <span className="vs-mono" style={{ fontSize: 13, fontWeight: 600, color: TEAL }}>{selectedShipment.bolNumber || selectedShipment.shipmentNumber}</span>
                <button onClick={() => { setSelectedShipment(null); setShipmentSearch(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, marginLeft: 'auto' }}><X size={12} /></button>
              </div>
            ) : (
              <>
                <input
                  value={shipmentSearch}
                  onChange={e => setShipmentSearch(e.target.value)}
                  placeholder="Search by shipment number (≥2 chars)…"
                  style={inputStyle}
                />
                {shipments.length > 0 && (
                  <div style={{ border: `1px solid ${BORDER}`, borderRadius: 7, overflow: 'hidden', marginTop: 4, maxHeight: 160, overflowY: 'auto' }}>
                    {shipments.map((s: any) => (
                      <div
                        key={s.id}
                        onClick={() => { setSelectedShipment(s); setShipmentSearch(s.bolNumber || s.shipmentNumber); setShipments([]); }}
                        style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 6 }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'hsl(var(--muted)/0.3)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <span className="vs-mono" style={{ fontSize: 13, color: TEAL, fontWeight: 600 }}>{s.bolNumber || s.shipmentNumber}</span>
                        {s.currentStageName && <span style={{ fontSize: 12, color: MUTED }}>— {s.currentStageName}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Title */}
          <div>
            <span style={labelStyle}>Title *</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              style={{ ...inputStyle, border: `1px solid ${!title && error ? RED : BORDER}` }}
            />
          </div>

          {/* Description */}
          <div>
            <span style={labelStyle}>Description</span>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Additional context…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Category chips */}
          <div>
            <span style={labelStyle}>Category</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  style={{
                    padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: category === c ? 700 : 400,
                    cursor: 'pointer', border: `1.5px solid ${category === c ? TEAL : BORDER}`,
                    backgroundColor: category === c ? `${TEAL}15` : 'transparent',
                    color: category === c ? TEAL : MUTED,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Role */}
          <div>
            <span style={labelStyle}>Assign to role *</span>
            <select
              value={assignedRole}
              onChange={e => setAssignedRole(e.target.value)}
              style={{ ...inputStyle, border: `1px solid ${!assignedRole && error ? RED : BORDER}` }}
            >
              <option value="">Select role…</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.displayName || r.name}</option>)}
            </select>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>Will auto-assign to the least-loaded user in this role</div>
          </div>

          {/* Urgency */}
          <div>
            <span style={labelStyle}>Urgency</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {URGENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setUrgency(opt.value)}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 13, fontWeight: urgency === opt.value ? 700 : 400,
                    cursor: 'pointer', border: `1.5px solid ${urgency === opt.value ? opt.color : BORDER}`,
                    backgroundColor: urgency === opt.value ? `${opt.color}15` : 'transparent',
                    color: urgency === opt.value ? opt.color : MUTED,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: opt.color }} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* SLA date/time */}
          <div>
            <span style={labelStyle}>SLA deadline (optional)</span>
            <input
              type="datetime-local"
              value={slaDeadline}
              onChange={e => setSlaDeadline(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>Leave blank to auto-calculate from category defaults</div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          {error && <div style={{ fontSize: 12.5, color: RED, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 7, border: `1px solid ${BORDER}`, background: 'none', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              style={{ flex: 2, padding: '10px 0', borderRadius: 7, border: 'none', backgroundColor: TEAL, color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: createMutation.isPending ? 'not-allowed' : 'pointer', opacity: createMutation.isPending ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              {createMutation.isPending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
              {createMutation.isPending ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task, selected, onClick,
  checkable, checked, onCheck,
}: {
  task: any; selected: boolean; onClick: () => void;
  checkable?: boolean; checked?: boolean; onCheck?: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [, navigate] = useLocation();
  const urgencyColor = URGENCY_COLOR[task.urgency] ?? '#94a3b8';
  const slaChip     = formatSlaChip(task);

  const delegationLog = task.metadata?.delegationLog;
  const lastDelegate = Array.isArray(delegationLog) && delegationLog.length > 0
    ? delegationLog[delegationLog.length - 1]
    : null;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '9px 16px 9px 0',
        minHeight: 56,
        backgroundColor: selected
          ? 'hsla(221,83%,53%,0.06)'
          : hovered ? 'hsl(var(--muted)/0.35)' : 'transparent',
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: selected
          ? `3px solid ${BLUE}`
          : checked ? `3px solid ${INDIGO}`
          : `3px solid ${urgencyColor}`,
        cursor: 'pointer',
        transition: 'background-color 0.1s',
        boxSizing: 'border-box',
      }}
    >
      {/* Checkbox (when checkable) or urgency spacer */}
      {checkable ? (
        <div
          onClick={(e) => { e.stopPropagation(); onCheck?.(e); }}
          style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <span style={{
            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
            border: `1.5px solid ${checked ? INDIGO : BORDER}`,
            backgroundColor: checked ? INDIGO : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'border-color 0.1s, background-color 0.1s',
          }}>
            {checked && <div style={{ width: 5, height: 3.5, borderLeft: '1.5px solid #fff', borderBottom: '1.5px solid #fff', transform: 'rotate(-45deg)', marginTop: -1 }} />}
          </span>
        </div>
      ) : (
        <div style={{ width: 12, flexShrink: 0 }} />
      )}

      {/* Title + activity code */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: FG,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.35,
        }}>
          {task.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <span className="vs-mono" style={{ fontSize: 11.5, color: MUTED, backgroundColor: 'hsl(var(--muted)/0.5)', padding: '0 5px', borderRadius: 3 }}>
            {task.activityCode}
          </span>
          {task.isDelegated && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, color: INDIGO, fontWeight: 500 }}>
              <UserPlus size={9} /> Delegated
            </span>
          )}
          {lastDelegate && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: BLUE, fontWeight: 500 }}>
              <ArrowRight size={8} />
              {lastDelegate.toName}
            </span>
          )}
        </div>
      </div>

      {/* Shipment # */}
      <div style={{ flexShrink: 0, width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {taskShipmentRef(task) ? (
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/shipments/${task.shipmentId}`); }}
            className="vs-mono"
            style={{ fontSize: 12.5, color: TEAL, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 500 }}
          >
            {taskShipmentRef(task)}
          </button>
        ) : null}
        {task.shipment?.currentStageName && (
          <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {task.shipment.currentStageName}
          </div>
        )}
      </div>

      {/* Status pill */}
      <div style={{ flexShrink: 0, width: 100 }}>
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 999,
          backgroundColor: `${STATUS_COLOR[task.status] ?? '#94a3b8'}18`,
          color: STATUS_COLOR[task.status] ?? '#94a3b8',
          whiteSpace: 'nowrap',
        }}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>

      {/* SLA chip */}
      <div style={{ flexShrink: 0, width: 108 }}>
        {slaChip ? (
          <span style={{
            fontSize: 11.5,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 999,
            backgroundColor: slaChip.bg,
            color: slaChip.color,
            border: `1px solid ${slaChip.color}40`,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}>
            <Clock size={9} />
            {slaChip.label}
          </span>
        ) : (
          task.slaDeadline ? (
            <span style={{ fontSize: 11.5, color: MUTED }}>On track</span>
          ) : null
        )}
      </div>

      {/* Role badge */}
      <div style={{ flexShrink: 0, width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <TaskRoleLabel task={task} />
      </div>

      {/* Action: Open */}
      <div style={{ flexShrink: 0, width: 60, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={(e) => { e.stopPropagation(); navigate(getTaskEntityLink(task)); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 12.5, color: TEAL, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
            borderRadius: 5,
          }}
        >
          Open <ArrowUpRight size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function FilterSidebar({
  urgencyFilter, setUrgencyFilter,
  statusFilter, setStatusFilter,
}: {
  urgencyFilter: string;
  setUrgencyFilter: (v: string) => void;
  statusFilter: string[];
  setStatusFilter: (v: string[]) => void;
}) {
  const statusOptions = ['ASSIGNED', 'ESCALATED', 'IN_PROGRESS', 'COMPLETED', 'PENDING', 'CANCELLED']
    .map(value => ({ value, label: STATUS_LABEL[value] ?? value }));
  const urgencyOptions: { value: string; label: string; color: string }[] = [
    { value: '',        label: 'All',     color: MUTED },
    { value: 'BLOCKER', label: 'Blocker', color: RED },
    { value: 'WARNING', label: 'Warning', color: AMBER },
    { value: 'NORMAL',  label: 'Normal',  color: TEAL },
  ];

  function toggleStatus(v: string) {
    setStatusFilter(
      statusFilter.includes(v) ? statusFilter.filter(s => s !== v) : [...statusFilter, v]
    );
  }

  return (
    <div style={{
      width: 210,
      flexShrink: 0,
      borderRight: `1px solid ${BORDER}`,
      padding: '16px 14px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
    }}>
      {/* Urgency */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, marginBottom: 8 }}>
          Urgency
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {urgencyOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setUrgencyFilter(opt.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 13, fontWeight: urgencyFilter === opt.value ? 600 : 400,
                color: urgencyFilter === opt.value ? FG : MUTED,
                backgroundColor: urgencyFilter === opt.value ? `${BLUE}10` : 'transparent',
                border: urgencyFilter === opt.value ? `1px solid ${BLUE}30` : '1px solid transparent',
                borderRadius: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: opt.color, flexShrink: 0, opacity: opt.value ? 1 : 0.4 }} />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, marginBottom: 8 }}>
          Status
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {statusOptions.map(opt => {
            const checked = statusFilter.includes(opt.value);
            return (
              <label
                key={opt.value}
                onClick={() => toggleStatus(opt.value)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: checked ? FG : MUTED, fontWeight: checked ? 500 : 400 }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: `1.5px solid ${checked ? BLUE : BORDER}`,
                  backgroundColor: checked ? BLUE : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.1s, background-color 0.1s',
                }}>
                  {checked && <div style={{ width: 5, height: 3.5, borderLeft: '1.5px solid #fff', borderBottom: '1.5px solid #fff', transform: 'rotate(-45deg)', marginTop: -1 }} />}
                </span>
                {opt.label}
              </label>
            );
          })}
          {statusFilter.length > 0 && (
            <button
              onClick={() => setStatusFilter([])}
              style={{ fontSize: 11.5, color: BLUE, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '2px 0', marginTop: 2 }}
            >
              Clear status filter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  taskId, onClose, onRefresh,
}: {
  taskId: string; onClose: () => void; onRefresh: () => void;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { task, loading, refetch: refetchDetail } = useTaskDetail(taskId);
  const [showEscalation, setShowEscalation] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [showDelegate, setShowDelegate] = useState(false);

  const slaBar = task ? computeSlaBar(task) : null;

  function refreshAll() {
    invalidateTaskQueries(queryClient);
    onRefresh();
    refetchDetail();
  }

  const completeMutation = useMutation({
    mutationFn: (id: string) => taskApi(`/api/tasks/${id}/complete`, { method: 'POST' }),
    onSuccess: () => refreshAll(),
  });
  const startMutation = useMutation({
    mutationFn: (id: string) => taskApi(`/api/tasks/${id}/start`, { method: 'POST' }),
    onSuccess: () => refreshAll(),
  });
  const actionLoading = completeMutation.isPending || startMutation.isPending;

  async function handleComplete() {
    if (!task) return;
    if (!window.confirm(`Mark "${task.title}" as complete?`)) return;
    completeMutation.mutate(task.id, { onSuccess: onClose });
  }

  async function handleStart() {
    if (!task) return;
    startMutation.mutate(task.id);
  }

  async function handleResolveEscalation() {
    if (!task) return;
    if (!window.confirm(`Resolve escalation for "${task.title}"?`)) return;
    completeMutation.mutate(task.id, { onSuccess: onClose });
  }

  const isTerminal = task?.status === 'COMPLETED' || task?.status === 'CANCELLED';
  const delegationLog = task?.metadata?.delegationLog;
  const lastDelegate = Array.isArray(delegationLog) && delegationLog.length > 0
    ? delegationLog[delegationLog.length - 1]
    : null;

  return (
    <>
      <div style={{
        width: 340,
        flexShrink: 0,
        borderLeft: `1px solid ${BORDER}`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: PANEL,
        overflowY: 'auto',
      }}>
        {/* Panel header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          backgroundColor: CARD,
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, lineHeight: 1 }}>
            Task Detail
          </span>
          <button
            onClick={onClose}
            title="Close task detail"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 6,
              backgroundColor: 'hsl(var(--background))',
              border: `1px solid ${BORDER}`,
              cursor: 'pointer',
              color: MUTED,
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: MUTED, gap: 8, fontSize: 14 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: TEAL }} />
            Loading task...
          </div>
        )}

        {!loading && !task && (
          <div style={{ padding: 24, color: MUTED, fontSize: 14, textAlign: 'center' }}>
            Task not found
          </div>
        )}

        {!loading && task && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Urgency + status badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                backgroundColor: `${URGENCY_COLOR[task.urgency] ?? '#94a3b8'}18`,
                color: URGENCY_COLOR[task.urgency] ?? '#94a3b8',
                border: `1px solid ${URGENCY_COLOR[task.urgency] ?? '#94a3b8'}35`,
              }}>
                {task.urgency}
              </span>
              <span style={{
                fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                backgroundColor: `${STATUS_COLOR[task.status] ?? '#94a3b8'}18`,
                color: STATUS_COLOR[task.status] ?? '#94a3b8',
              }}>
                {STATUS_LABEL[task.status] ?? task.status}
              </span>
              {task.escalationLevel > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, backgroundColor: `${RED}15`, color: RED }}>
                  L{task.escalationLevel} ESC
                </span>
              )}
            </div>

            {/* Title */}
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: FG, lineHeight: 1.4 }}>
                {task.title}
              </div>
              {task.description && (
                <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>
                  {task.description}
                </p>
              )}
            </div>

            {/* Delegation badge */}
            {lastDelegate && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', backgroundColor: `${BLUE}08`, border: `1px solid ${BLUE}20`, borderRadius: 7 }}>
                <UserPlus size={12} color={BLUE} />
                <span style={{ fontSize: 12, color: BLUE }}>Delegated → <strong>{lastDelegate.toName}</strong></span>
              </div>
            )}

            {/* Parent task link */}
            {task.parentTask && (
              <div style={{ fontSize: 12, color: MUTED }}>
                <span>Parent: </span>
                <span style={{ color: FG, fontWeight: 500 }}>{task.parentTask.title}</span>
              </div>
            )}

            {/* Meta grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MetaRow label="Activity">
                <span className="vs-mono" style={{ fontSize: 12, backgroundColor: 'hsl(var(--muted)/0.5)', padding: '1px 6px', borderRadius: 3 }}>
                  {task.activityCode}
                </span>
              </MetaRow>
              {task.assignedRole && (
                <MetaRow label="Assigned role">
                  <TaskRoleLabel task={task} />
                </MetaRow>
              )}
              {task.assignedUser && (
                <MetaRow label="Assigned to">
                  <span style={{ fontSize: 13, color: FG }}>{task.assignedUser.fullName}</span>
                </MetaRow>
              )}
              {task.shipment && (
                <MetaRow label="Shipment">
                  <button
                    onClick={() => navigate(`/shipments/${task.shipmentId}`)}
                    className="vs-mono"
                    style={{ fontSize: 12.5, color: TEAL, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                  >
                    {taskShipmentRef(task)}
                  </button>
                </MetaRow>
              )}
              <MetaRow label="Created">
                <span style={{ fontSize: 12.5, color: MUTED }}>{formatTimeAgo(task.createdAt)}</span>
              </MetaRow>
              {task.startedAt && (
                <MetaRow label="Started">
                  <span style={{ fontSize: 12.5, color: MUTED }}>{formatTimeAgo(task.startedAt)}</span>
                </MetaRow>
              )}
              {task.escalationType && (
                <MetaRow label="Escalation type">
                  <span style={{ fontSize: 12, color: MUTED }}>{task.escalationType.replace(/_/g, ' ')}</span>
                </MetaRow>
              )}
              {task.metadata?.escalationReason && (
                <MetaRow label="Esc. reason">
                  <span style={{ fontSize: 12, color: AMBER, fontWeight: 500 }}>{task.metadata.escalationReason}</span>
                </MetaRow>
              )}
            </div>

            {/* SLA bar */}
            {slaBar && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={11} /> SLA
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: slaBar.color }}>{slaBar.label}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, backgroundColor: 'hsl(var(--muted)/0.4)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${slaBar.pct}%`, backgroundColor: slaBar.color, borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
              {/* Open entity link */}
              {getTaskEntityLink(task)!='null'? 
              <button
                onClick={() => navigate(getTaskEntityLink(task))}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  fontSize: 13.5, fontWeight: 600, color: '#fff',
                  backgroundColor: TEAL, border: 'none', borderRadius: 7,
                  padding: '9px 14px', cursor: 'pointer',
                }}
              >
                Open linked item <ArrowUpRight size={13} />
              </button>
:''}

              {/* Start Working — PENDING or ASSIGNED tasks */}
              {['PENDING', 'ASSIGNED'].includes(task.status) && (
                <RequireActivity code="TSK-002">
                  <button
                    onClick={handleStart}
                    disabled={actionLoading}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, fontWeight: 600, color: BLUE,
                      backgroundColor: `${BLUE}12`, border: `1px solid ${BLUE}35`, borderRadius: 7,
                      padding: '8px 14px', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    <Play size={13} /> Start Working
                  </button>
                </RequireActivity>
              )}

              {/* Mark Complete — IN_PROGRESS or ASSIGNED tasks */}
              {['IN_PROGRESS', 'ASSIGNED'].includes(task.status) && (
                <RequireActivity code="TSK-002">
                  <button
                    onClick={handleComplete}
                    disabled={actionLoading}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, fontWeight: 600, color: GREEN,
                      backgroundColor: `${GREEN}12`, border: `1px solid ${GREEN}35`, borderRadius: 7,
                      padding: '8px 14px', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    <CheckCircle size={13} /> Mark Complete
                  </button>
                </RequireActivity>
              )}

              {/* Resolve Escalation */}
              {task.status === 'ESCALATED' && (
                <RequireActivity code="TSK-003">
                  <button
                    onClick={handleResolveEscalation}
                    disabled={actionLoading}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, fontWeight: 600, color: GREEN,
                      backgroundColor: `${GREEN}12`, border: `1px solid ${GREEN}35`, borderRadius: 7,
                      padding: '8px 14px', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    <CheckCircle size={13} /> Resolve Escalation
                  </button>
                </RequireActivity>
              )}

              {/* Temporarily hidden — Escalate / Reassign / Delegate (keep code for restore)
              {['IN_PROGRESS', 'ASSIGNED'].includes(task.status) && (
                <RequireActivity code="TSK-004">
                  <button
                    onClick={() => setShowEscalation(true)}
                    disabled={actionLoading}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, fontWeight: 600, color: AMBER,
                      backgroundColor: `${AMBER}12`, border: `1px solid ${AMBER}35`, borderRadius: 7,
                      padding: '8px 14px', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    <AlertTriangle size={13} /> Escalate
                  </button>
                </RequireActivity>
              )}

              {['IN_PROGRESS', 'ASSIGNED'].includes(task.status) && (
                <RequireActivity code="TSK-003">
                  <button
                    onClick={() => setShowReassign(true)}
                    disabled={actionLoading}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, fontWeight: 500, color: MUTED,
                      backgroundColor: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 7,
                      padding: '8px 14px', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    <RotateCcw size={13} /> Reassign
                  </button>
                </RequireActivity>
              )}

              {['IN_PROGRESS', 'ASSIGNED'].includes(task.status) && (
                <RequireActivity code="TSK-007">
                  <button
                    onClick={() => setShowDelegate(true)}
                    disabled={actionLoading}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 13, fontWeight: 500, color: INDIGO,
                      backgroundColor: `${INDIGO}08`, border: `1px solid ${INDIGO}25`, borderRadius: 7,
                      padding: '8px 14px', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                    }}
                  >
                    <UserPlus size={13} /> Delegate
                  </button>
                </RequireActivity>
              )}
              */}
            </div>
          </div>
        )}
      </div>

      {/* Detail panel dialogs */}
      {showEscalation && task && (
        <EscalationDialog
          taskId={task.id}
          onClose={() => setShowEscalation(false)}
          onSuccess={refreshAll}
        />
      )}
      {showReassign && task && (
        <ReassignDialog
          taskId={task.id}
          onClose={() => setShowReassign(false)}
          onSuccess={refreshAll}
        />
      )}
      {showDelegate && task && (
        <DelegationDialog
          taskId={task.id}
          onClose={() => setShowDelegate(false)}
          onSuccess={refreshAll}
        />
      )}
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: MUTED, fontWeight: 600, minWidth: 100, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}

// ─── Analytics components ─────────────────────────────────────────────────────

interface AnalyticsData {
  scorecard: { openCount: number; breachedCount: number; avgDaysOverdue: number; completedLast7d: number };
  tasksByRole: { roleId: string; roleCode: string; roleName: string; color: string; total: number; blockers: number; warnings: number; normal: number }[];
  slaTrend: { date: string; breached: number }[];
  hotspots: { shipmentId: string; shipmentNumber: string; currentGateName: string | null; blockers: number; warnings: number; oldestTaskAgeDays: number }[];
  categoryBreakdown: { prefix: string; category: string; count: number }[];
  generatedAt: string;
}

function useTaskAnalytics() {
  const query = useQuery({
    queryKey: ['tasks', 'analytics'],
    queryFn: async () => (await taskApi<{ ok: boolean; data: AnalyticsData }>('/api/tasks/analytics')).data,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function AnalyticsSkeleton() {
  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 4 scorecard tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 96, borderRadius: 8, backgroundColor: 'hsl(var(--muted)/0.3)' }} className="animate-pulse" />
        ))}
      </div>
      {/* 5-col grid: col-span-3 role chart + col-span-2 trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20 }}>
        <div style={{ height: 256, borderRadius: 8, backgroundColor: 'hsl(var(--muted)/0.3)' }} className="animate-pulse" />
        <div style={{ height: 256, borderRadius: 8, backgroundColor: 'hsl(var(--muted)/0.3)' }} className="animate-pulse" />
      </div>
      {/* Table */}
      <div style={{ height: 192, borderRadius: 8, backgroundColor: 'hsl(var(--muted)/0.3)' }} className="animate-pulse" />
    </div>
  );
}

// ── Scorecard ─────────────────────────────────────────────────────────────────

function ScorecardTile({
  label, value, suffix, colorFn, pulse,
}: {
  label: string;
  value: number;
  suffix?: string;
  colorFn: (v: number) => string;
  pulse?: boolean;
}) {
  const color = colorFn(value);
  const bgMap: Record<string, string> = {
    [TEAL]: `${TEAL}15`,
    [AMBER]: `${AMBER}18`,
    [RED]: `${RED}12`,
    [GREEN]: `${GREEN}12`,
  };
  const bg = bgMap[color] ?? 'hsl(var(--muted)/0.25)';
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}
      className={pulse && value > 5 ? 'animate-pulse' : undefined}
    >
      <span style={{ fontSize: 10, fontWeight: 600, color, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      <span style={{ fontSize: 32, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value}
        {suffix && <span style={{ fontSize: 18, fontWeight: 600 }}>{suffix}</span>}
      </span>
    </div>
  );
}

function ScorecardRow({ s }: { s: AnalyticsData['scorecard'] }) {
  const openColor = (v: number) => v < 20 ? TEAL : v <= 50 ? AMBER : RED;
  const redIfAny = (v: number) => v > 0 ? RED : TEAL;
  const overdueColor = (v: number) => v > 2 ? RED : v > 0.5 ? AMBER : TEAL;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <ScorecardTile label="Open Tasks"      value={s.openCount}       colorFn={openColor} />
      <ScorecardTile label="SLA Breached"    value={s.breachedCount}   colorFn={redIfAny}  pulse />
      <ScorecardTile label="Avg Days Overdue" value={s.avgDaysOverdue} suffix="d" colorFn={overdueColor} />
      <ScorecardTile label="Completed (7d)"  value={s.completedLast7d} colorFn={() => TEAL} />
    </div>
  );
}

// ── Tasks by role chart ───────────────────────────────────────────────────────

function TaskRoleBar({ row, maxTotal }: { row: AnalyticsData['tasksByRole'][number]; maxTotal: number }) {
  const isUnassigned = row.roleId === '_unassigned';
  return (
    <button
      onClick={() => {
        window.dispatchEvent(new CustomEvent('filter-by-role', { detail: { roleCode: row.roleCode, roleId: row.roleId } }));
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', textAlign: 'left',
      }}
    >
      <div style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 12.5, color: FG, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 148 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = TEAL; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = FG; }}
        >
          {row.roleName}
        </span>
        {isUnassigned && (
          <span style={{ fontSize: 10, color: AMBER, fontWeight: 600 }}>needs assignment</span>
        )}
      </div>
      <div style={{ flex: 1, height: 22, borderRadius: 5, overflow: 'hidden', backgroundColor: 'hsl(var(--muted)/0.25)', display: 'flex' }}>
        {row.blockers > 0 && (
          <div style={{ width: `${(row.blockers / maxTotal) * 100}%`, backgroundColor: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 22 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{row.blockers}</span>
          </div>
        )}
        {row.warnings > 0 && (
          <div style={{ width: `${(row.warnings / maxTotal) * 100}%`, backgroundColor: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 22 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{row.warnings}</span>
          </div>
        )}
        {row.normal > 0 && (
          <div style={{ width: `${(row.normal / maxTotal) * 100}%`, backgroundColor: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.65, minWidth: row.normal > 0 ? 20 : 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{row.normal}</span>
          </div>
        )}
      </div>
      <div style={{ width: 26, fontSize: 12, fontWeight: 700, color: FG, fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0 }}>{row.total}</div>
    </button>
  );
}

function TasksByRoleChart({ rows }: { rows: AnalyticsData['tasksByRole'] }) {
  if (rows.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 140, color: MUTED, fontSize: 13 }}>
      No active tasks assigned to any role
    </div>
  );
  const maxTotal = Math.max(...rows.map(r => r.total), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(r => <TaskRoleBar key={r.roleId} row={r} maxTotal={maxTotal} />)}
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        {([{ color: RED, label: 'Blocker / Overdue' }, { color: AMBER, label: 'Warning' }, { color: TEAL, label: 'Normal', opacity: 0.65 }] as { color: string; label: string; opacity?: number }[]).map(l => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: l.color, opacity: l.opacity ?? 1, display: 'inline-block', flexShrink: 0 }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── SLA Trend sparkline ───────────────────────────────────────────────────────

function SlaTrendChart({ rows }: { rows: AnalyticsData['slaTrend'] }) {
  const vbW = 320; const vbH = 100;
  const padX = 30; const padY = 15;
  const chartW = vbW - padX * 2; const chartH = vbH - padY * 2;

  const total14d = rows.reduce((s, r) => s + r.breached, 0);
  const maxCount = Math.max(...rows.map(r => r.breached), 1);
  const n = rows.length;

  const xOf = (i: number) => padX + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yOf = (v: number) => padY + chartH - (v / maxCount) * chartH;
  const zeroY = padY + chartH; // y=0 line (bottom of chart area)

  // Trend direction: first 7 days vs last 7 days
  const first7 = rows.slice(0, 7).reduce((s, r) => s + r.breached, 0);
  const last7  = rows.slice(7).reduce((s, r) => s + r.breached, 0);
  const trend = first7 === 0 && last7 === 0 ? 'stable' : last7 < first7 ? 'improving' : last7 > first7 ? 'worsening' : 'stable';
  const trendColor = trend === 'improving' ? TEAL : trend === 'worsening' ? RED : '#94a3b8';
  const trendLabel = trend === 'improving' ? '↓ Improving' : trend === 'worsening' ? '↑ Worsening' : '→ Stable';

  const points = rows.map((r, i) => `${xOf(i)},${yOf(r.breached)}`).join(' ');

  const gridLevels = [0, 0.25, 0.5, 0.75, 1];

  if (rows.length < 2) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: vbH, color: MUTED, fontSize: 13 }}>Not enough data</div>
  );

  return (
    <div>
      {/* Header: title + trend chip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: FG }}>SLA Breaches — 14 days</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: trendColor, backgroundColor: `${trendColor}15`, borderRadius: 999, padding: '2px 8px' }}>
          {trendLabel}
        </span>
      </div>

      <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: '100%', height: vbH }}>
        {/* Grid lines */}
        {gridLevels.map((f, i) => {
          const y = padY + chartH - f * chartH;
          return <line key={i} x1={padX} y1={y} x2={vbW - padX} y2={y} stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />;
        })}

        {/* Zero-target dashed line (teal) */}
        <line x1={padX} y1={zeroY} x2={vbW - padX} y2={zeroY} stroke={TEAL} strokeWidth={1} strokeDasharray="3 3" />

        {/* Data polyline */}
        <polyline points={points} fill="none" stroke={trendColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Data dots */}
        {rows.map((r, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(r.breached)} r={r.breached > 0 ? 3 : 1.5}
            fill={trendColor} fillOpacity={r.breached > 0 ? 1 : 0.35}
          >
            <title>{r.date}: {r.breached} breaches</title>
          </circle>
        ))}

        {/* Y-axis labels */}
        <text x={padX - 4} y={padY + 4} fontSize={8} fill="currentColor" fillOpacity={0.5} textAnchor="end">{maxCount}</text>
        <text x={padX - 4} y={zeroY + 3} fontSize={8} fill="currentColor" fillOpacity={0.5} textAnchor="end">0</text>

        {/* X-axis labels */}
        <text x={padX} y={vbH - 2} fontSize={8} fill="currentColor" fillOpacity={0.5} textAnchor="middle">{rows[0]?.date?.slice(5)}</text>
        <text x={vbW - padX} y={vbH - 2} fontSize={8} fill="currentColor" fillOpacity={0.5} textAnchor="middle">{rows[rows.length - 1]?.date?.slice(5)}</text>
      </svg>

      {/* Footer: 14-day total */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <span style={{ fontSize: 11.5, color: MUTED }}>14-day total: <strong style={{ color: total14d > 0 ? RED : MUTED }}>{total14d} breaches</strong></span>
      </div>
    </div>
  );
}

// ── Hotspot Shipments table ───────────────────────────────────────────────────

function HotspotShipmentsTable({ rows }: { rows: AnalyticsData['hotspots'] }) {
  const [sortBy, setSortBy] = useState<'blockers' | 'oldestTaskAgeDays'>('blockers');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(col: 'blockers' | 'oldestTaskAgeDays') {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return (a[sortBy] - b[sortBy]) * dir;
  });

  if (sorted.length === 0) return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: MUTED, fontSize: 13 }}>No shipments with open blockers</div>
  );

  const SortTh = ({ col, label }: { col: 'blockers' | 'oldestTaskAgeDays'; label: string }) => (
    <th
      onClick={() => toggleSort(col)}
      style={{ padding: '5px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: sortBy === col ? FG : MUTED, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
    >
      {label} {sortBy === col ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            <th style={{ padding: '5px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED }}>Shipment</th>
            <SortTh col="blockers" label="Blockers" />
            <th style={{ padding: '5px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED }}>Warnings</th>
            <SortTh col="oldestTaskAgeDays" label="Oldest Task" />
            <th style={{ padding: '5px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED }}>Gate</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.shipmentId}
              style={{ borderBottom: `1px solid hsl(var(--border)/0.4)`, backgroundColor: r.blockers > 2 ? `${RED}08` : 'transparent' }}
            >
              <td style={{ padding: '7px 8px' }}>
                <a href={`/shipments/${r.shipmentId}`} style={{ color: TEAL, fontWeight: 600, fontFamily: 'var(--app-font-sans)', textDecoration: 'none', fontSize: 12.5 }}>
                  {r.shipmentNumber}
                </a>
              </td>
              <td style={{ padding: '7px 8px' }}>
                {r.blockers > 0 ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, backgroundColor: `${RED}18`, color: RED, borderRadius: 5, padding: '1px 7px', fontWeight: 700, fontSize: 12 }}>
                    {r.blockers}
                  </span>
                ) : <span style={{ color: MUTED }}>—</span>}
              </td>
              <td style={{ padding: '7px 8px' }}>
                {r.warnings > 0 ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, backgroundColor: `${AMBER}18`, color: AMBER, borderRadius: 5, padding: '1px 7px', fontWeight: 700, fontSize: 12 }}>
                    {r.warnings}
                  </span>
                ) : <span style={{ color: MUTED }}>—</span>}
              </td>
              <td style={{ padding: '7px 8px', fontWeight: r.oldestTaskAgeDays > 3 ? 700 : 400, color: r.oldestTaskAgeDays > 3 ? RED : FG }}>
                {r.oldestTaskAgeDays}d
              </td>
              <td style={{ padding: '7px 8px', color: MUTED, fontSize: 12 }}>
                {r.currentGateName ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── TaskAnalyticsPanel ────────────────────────────────────────────────────────

function TaskAnalyticsPanel() {
  const { data, loading, error, refetch } = useTaskAnalytics();
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // 5-minute auto-refresh
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      setLastUpdated(new Date());
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refetch]);

  function handleRefresh() {
    refetch();
    setLastUpdated(new Date());
  }

  if (loading && !data) return <AnalyticsSkeleton />;

  if (error && !data) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: RED, marginBottom: 12 }}>Failed to load analytics: {error}</div>
      <button onClick={handleRefresh} style={{ fontSize: 13, color: BLUE, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>↻ Retry</button>
    </div>
  );

  if (!data) return null;
  const { scorecard, tasksByRole, slaTrend, hotspots } = data;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: FG, display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart2 size={15} style={{ color: TEAL }} />
          Task Overview
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: MUTED }}>Updated {formatTimeAgo(lastUpdated.toISOString())}</span>
          <button
            onClick={handleRefresh}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUTED, background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
          >
            <RefreshCw size={11} /> ↻ Refresh
          </button>
        </div>
      </div>

      {/* Scorecard */}
      <ScorecardRow s={scorecard} />

      {/* Two-column: role chart (3) + trend (2) */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20 }}>
        <div style={{ backgroundColor: CARD, borderRadius: 8, padding: '18px 20px', border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: FG, marginBottom: 14 }}>Tasks by Role</div>
          <TasksByRoleChart rows={tasksByRole} />
        </div>
        <div style={{ backgroundColor: CARD, borderRadius: 8, padding: '18px 20px', border: `1px solid ${BORDER}` }}>
          <SlaTrendChart rows={slaTrend} />
        </div>
      </div>

      {/* Hotspot table */}
      <div style={{ backgroundColor: CARD, borderRadius: 8, padding: '18px 20px', border: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: FG }}>Hotspot Shipments</div>
          <span style={{ fontSize: 11, color: MUTED }}>Top 10 by blocker count</span>
        </div>
        <HotspotShipmentsTable rows={hotspots} />
      </div>

      <div style={{ height: 20 }} />
    </div>
  );
}

// ─── TasksPage ────────────────────────────────────────────────────────────────

type SortField = 'urgency' | 'slaDeadline' | 'createdAt' | 'status' | 'title';
const REMINDER_OPEN_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];

export function TasksPage() {
  const { user } = useAuth();
  const { activities } = usePermissions();
  const { setPageMeta } = usePageMeta();
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const isExternal = !!(user?.role?.category?.includes('external'));
  const isL3Plus = ['L3', 'L4'].includes((user as any)?.level ?? '');
  const hasActivity = (modernCode: string, legacyCode: string) =>
    activities.includes(modernCode) || activities.includes(legacyCode);
  const canSeeOverview = isL3Plus && !isExternal && hasActivity('tasks.view', 'TSK-001');

  // Can show checkboxes
  const canManageTasks = hasActivity('tasks.update', 'TSK-002') || hasActivity('tasks.assign', 'TSK-003');

  const [activeTab, setActiveTab]       = useState<'tasks' | 'overview'>('tasks');
  const [scope, setScope]               = useState<TaskScope>('mine');
  const [assigneeRoleId, setAssigneeRoleId] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [search, setSearch]             = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sort, setSort]                 = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'createdAt', dir: 'desc' });
  const [refreshing, setRefreshing]     = useState(false);
  const [page, setPage]                 = useState(1);
  const pageSize = 20;
  const debouncedSearch = useDebounce(search, 300);

  // Bulk selection
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [showBulkEscalation, setShowBulkEscalation] = useState(false);
  const [showBulkReassign, setShowBulkReassign]     = useState(false);

  // Creation drawer
  const [showCreationDrawer, setShowCreationDrawer] = useState(false);

  const effectiveScope: TaskScope = isExternal ? 'mine' : scope;

  const { tasks, meta, loading, error, refetch } = useTaskList(effectiveScope, {
    assignedRoleId: assigneeRoleId,
    urgency: urgencyFilter || undefined,
    status: statusFilter.length ? statusFilter.join(',') : undefined,
    search: debouncedSearch || undefined,
    page,
    pageSize,
  });
  const { summary, refetch: refetchSummary } = useTaskSummary();
  const completeTaskMutation = useMutation({
    mutationFn: (id: string) => taskApi(`/api/tasks/${id}/complete`, { method: 'POST' }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
  const escalateTaskMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => taskApi(`/api/tasks/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });
  const reassignTaskMutation = useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) => taskApi(`/api/tasks/${id}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ assignedRoleId: roleId }),
    }),
    onSuccess: () => invalidateTaskQueries(queryClient),
  });

  useEffect(() => {
    setPage(1);
  }, [effectiveScope, assigneeRoleId, urgencyFilter, statusFilter, debouncedSearch]);

  useEffect(() => {
    const query = location.split('?')[1];
    if (!query) return;
    const taskId = new URLSearchParams(query).get('taskId');
    if (taskId) {
      setActiveTab('tasks');
      setSelectedId(taskId);
    }
  }, [location]);

  useEffect(() => {
    const handleModuleSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; value?: string }>).detail;
      if (detail.scope && detail.scope !== 'tasks' && detail.scope !== 'all') return;
      setPage(1);
      setSearch(detail.value ?? '');
    };
    window.addEventListener('ewms-module-search', handleModuleSearch);
    return () => window.removeEventListener('ewms-module-search', handleModuleSearch);
  }, []);

  // filter-by-role custom event: role bar click -> switch to All Tasks with role pre-filtered
  useEffect(() => {
    function handleFilterByRole(e: Event) {
      const detail = (e as CustomEvent<{ roleCode: string; roleId: string }>).detail;
      setActiveTab('tasks');
      setScope('all');
      setAssigneeRoleId(detail?.roleId || undefined);
      setSelectedId(null);
      clearSelection();
    }
    window.addEventListener('filter-by-role', handleFilterByRole);
    return () => window.removeEventListener('filter-by-role', handleFilterByRole);
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    Promise.all([refetch(), refetchSummary()]).finally(() => setRefreshing(false));
  }

  function handleSort(field: string) {
    setSort(prev =>
      prev.field === field
        ? { field: field as SortField, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field: field as SortField, dir: 'asc' }
    );
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  async function handleBulkComplete() {
    setBulkActionLoading(true);
    await Promise.allSettled([...selectedIds].map(id =>
      completeTaskMutation.mutateAsync(id)
    ));
    clearSelection();
    handleRefresh();
    setBulkActionLoading(false);
  }

  async function handleBulkEscalate(reason: string) {
    setBulkActionLoading(true);
    await Promise.allSettled([...selectedIds].map(id =>
      escalateTaskMutation.mutateAsync({ id, reason })
    ));
    setShowBulkEscalation(false);
    clearSelection();
    handleRefresh();
    setBulkActionLoading(false);
  }

  async function handleBulkReassign(roleId: string) {
    setBulkActionLoading(true);
    await Promise.allSettled([...selectedIds].map(id =>
      reassignTaskMutation.mutateAsync({ id, roleId })
    ));
    setShowBulkReassign(false);
    clearSelection();
    handleRefresh();
    setBulkActionLoading(false);
  }

  const filteredAndSorted = useMemo(() => {
    let list = [...tasks];

    // Sort current DB page
    list.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.field === 'urgency') {
        return ((URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9)) * dir;
      }
      if (sort.field === 'slaDeadline') {
        const da = a.slaDeadline ? new Date(a.slaDeadline).getTime() : Infinity;
        const db = b.slaDeadline ? new Date(b.slaDeadline).getTime() : Infinity;
        return (da - db) * dir;
      }
      if (sort.field === 'createdAt') {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
      if (sort.field === 'status') {
        return a.status.localeCompare(b.status) * dir;
      }
      if (sort.field === 'title') {
        return a.title.localeCompare(b.title) * dir;
      }
      return 0;
    });

    return list;
  }, [tasks, sort]);

  const reminderCount = Math.max(0, summary.total - summary.blockers - summary.warnings - summary.escalated);
  const isReminderFilter = urgencyFilter === 'NORMAL'
    && statusFilter.length === REMINDER_OPEN_STATUSES.length
    && REMINDER_OPEN_STATUSES.every(status => statusFilter.includes(status));
  const activeFilters = (urgencyFilter ? 1 : 0) + (statusFilter.length ? 1 : 0) + (search ? 1 : 0);

  useEffect(() => {
    setPageMeta({
      title: 'Tasks',
      subtitle: `${meta.total ?? tasks.length} task${(meta.total ?? tasks.length) === 1 ? '' : 's'} in view`,
      badge: summary.blockers > 0 ? { label: `${summary.blockers} blocker${summary.blockers !== 1 ? 's' : ''}`, variant: 'gold' } : undefined,
    });
    return () => setPageMeta(null);
  }, [meta.total, setPageMeta, summary.blockers, tasks.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: PANEL }}>

      {/* ── Scope Navigation ── */}
      <div style={{
        padding: '6px 20px 0 20px',
        flexShrink: 0,
        backgroundColor: PANEL,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {/* Scope tabs (hidden for external users) */}
        {!isExternal && (
          <div style={{ display: 'flex', gap: 0 }}>
            {/* Overview tab — leftmost, L3+ with TSK-001 only */}
            {canSeeOverview && (
              <button
                onClick={() => { setActiveTab('overview'); setSelectedId(null); clearSelection(); }}
                style={{
                  fontSize: 13.5,
                  fontWeight: activeTab === 'overview' ? 600 : 400,
                  color: activeTab === 'overview' ? TEAL : MUTED,
                  background: 'none',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderBottom: `2px solid ${activeTab === 'overview' ? TEAL : 'transparent'}`,
                  padding: '6px 14px 8px 14px',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                  marginRight: 4,
                }}
              >
                <BarChart2 size={13} />
                Overview
              </button>
            )}
            {([
              { key: 'mine',  label: 'Mine',  count: summary.myCount },
              // { key: 'team',  label: 'Team',  count: summary.teamCount },
              { key: 'all',   label: 'All',   count: null },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => { setScope(tab.key); setActiveTab('tasks'); setSelectedId(null); clearSelection(); setAssigneeRoleId(undefined); }}
                style={{
                  fontSize: 13.5,
                  fontWeight: activeTab === 'tasks' && scope === tab.key ? 600 : 400,
                  color: activeTab === 'tasks' && scope === tab.key ? BLUE : MUTED,
                  background: 'none',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderBottom: `2px solid ${activeTab === 'tasks' && scope === tab.key ? BLUE : 'transparent'}`,
                  padding: '6px 14px 8px 14px',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    backgroundColor: activeTab === 'tasks' && scope === tab.key ? BLUE : 'hsl(var(--muted)/0.6)',
                    color: activeTab === 'tasks' && scope === tab.key ? '#fff' : MUTED,
                    borderRadius: 999, padding: '0 5px',
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', paddingBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: MUTED, pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => { setPage(1); setSearch(e.target.value); }}
              placeholder="Search tasks..."
              style={{
                fontSize: 13,
                border: `1px solid ${BORDER}`,
                borderRadius: 7,
                padding: '6px 10px 6px 28px',
                width: 210,
                backgroundColor: 'hsl(var(--background))',
                color: FG,
                outline: 'none',
              }}
            />
          </div>
          {/* <button
            onClick={() => setSidebarOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 13, fontWeight: sidebarOpen ? 600 : 400,
              color: sidebarOpen ? BLUE : MUTED,
              backgroundColor: sidebarOpen ? `${BLUE}10` : 'transparent',
              border: `1px solid ${sidebarOpen ? `${BLUE}30` : BORDER}`,
              borderRadius: 7, padding: '6px 10px', cursor: 'pointer',
            }}
          >
            <SlidersHorizontal size={13} />
            Filters
            {activeFilters > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, backgroundColor: BLUE, color: '#fff', borderRadius: 999, padding: '0 5px' }}>
                {activeFilters}
              </span>
            )}
          </button> */}
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh tasks"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 7,
              backgroundColor: 'transparent', border: `1px solid ${BORDER}`, cursor: 'pointer',
              color: MUTED,
              opacity: (refreshing || loading) ? 0.5 : 1,
            }}
          >
            <RefreshCw size={13} style={{ animation: (refreshing || loading) ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          {/* {!isExternal && (
            <RequireActivity code="TSK-003">
              <button
                onClick={() => setShowCreationDrawer(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 13, fontWeight: 600, color: '#fff',
                  backgroundColor: TEAL, border: 'none',
                  borderRadius: 7, padding: '7px 12px', cursor: 'pointer',
                }}
              >
                <Plus size={13} /> New Task
              </button>
            </RequireActivity>
          )} */}
        </div>
        </div>
      </div>

      {/* ── Stat filter strip (hidden when overview is active) ── */}
      {activeTab !== 'overview' && <div style={{
        display: 'flex', padding: '10px 20px',
        borderBottom: `1px solid ${BORDER}`,
        flexShrink: 0,
        backgroundColor: PANEL,
      }}>
        <FilterChips
          size="compact"
          chips={[
            { label: 'Total',     count: summary.total },
            { label: 'Blockers',  count: summary.blockers },
            { label: 'Warnings',  count: summary.warnings },
            { label: 'Escalated', count: summary.escalated },
            { label: 'Reminder',  count: reminderCount },
          ]}
          activeIndex={
            statusFilter.length === 1 && statusFilter[0] === 'ESCALATED' ? 3
            : isReminderFilter ? 4
            : urgencyFilter === 'BLOCKER' ? 1
            : urgencyFilter === 'WARNING' ? 2
            : urgencyFilter === '' && statusFilter.length === 0 ? 0
            : -1
          }
          onSelect={(i) => {
            setSelectedId(null); clearSelection();
            if (i === 0) { setUrgencyFilter(''); setStatusFilter([]); }
            else if (i === 1) { setUrgencyFilter('BLOCKER'); setStatusFilter([]); }
            else if (i === 2) { setUrgencyFilter('WARNING'); setStatusFilter([]); }
            else if (i === 3) { setUrgencyFilter(''); setStatusFilter(['ESCALATED']); }
            else if (i === 4) { setUrgencyFilter('NORMAL'); setStatusFilter(REMINDER_OPEN_STATUSES); }
          }}
        />
      </div>}

      {/* ── Body (sidebar + table + detail) ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* Overview panel (replaces normal body for L3+ users) */}
        {activeTab === 'overview' && <TaskAnalyticsPanel />}

        {/* Filter sidebar */}
        {/* {activeTab === 'tasks' && sidebarOpen && (
          <FilterSidebar
            urgencyFilter={urgencyFilter}
            setUrgencyFilter={setUrgencyFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
        )} */}

        {/* Main table area (only shown in tasks tab) */}
        {activeTab === 'tasks' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Bulk action bar — shown when items selected */}
          {selectedIds.size > 0 && (
            <BulkActionBar
              count={selectedIds.size}
              onClear={clearSelection}
              onMarkComplete={handleBulkComplete}
              onReassign={() => setShowBulkReassign(true)}
              onEscalate={() => setShowBulkEscalation(true)}
              loading={bulkActionLoading}
            />
          )}

          {/* Column headers */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '6px 16px 6px 0',
            borderBottom: `1px solid ${BORDER}`,
            backgroundColor: 'hsl(var(--muted)/0.25)',
            flexShrink: 0,
          }}>
            {/* Checkbox header / select-all */}
            {canManageTasks ? (
              <div
                style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => {
                  if (selectedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0) {
                    clearSelection();
                  } else {
                    setSelectedIds(new Set(filteredAndSorted.map(t => t.id)));
                  }
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: `1.5px solid ${selectedIds.size > 0 ? INDIGO : BORDER}`,
                  backgroundColor: selectedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0 ? INDIGO : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.1s, background-color 0.1s',
                }}>
                  {selectedIds.size > 0 && selectedIds.size < filteredAndSorted.length && (
                    <div style={{ width: 6, height: 1.5, backgroundColor: INDIGO, borderRadius: 1 }} />
                  )}
                  {selectedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0 && (
                    <div style={{ width: 5, height: 3.5, borderLeft: '1.5px solid #fff', borderBottom: '1.5px solid #fff', transform: 'rotate(-45deg)', marginTop: -1 }} />
                  )}
                </span>
              </div>
            ) : (
              <div style={{ width: 12, flexShrink: 0 }} />
            )}
            <SortHeader label="Task" field="title" sort={sort} onSort={handleSort} />
            <SortHeader label="Shipment" field="shipment" sort={sort} onSort={handleSort} width={110} />
            <SortHeader label="Status" field="status" sort={sort} onSort={handleSort} width={100} />
            <SortHeader label="SLA" field="slaDeadline" sort={sort} onSort={handleSort} width={108} />
            <div style={{ flexShrink: 0, width: 120, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED }}>Role</div>
            <div style={{ flexShrink: 0, width: 60 }} />
          </div>

          {/* Rows scroll area */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{ height: 56, borderBottom: `1px solid ${BORDER}`, backgroundColor: i % 2 === 0 ? 'hsl(var(--muted)/0.12)' : 'transparent' }} className="animate-pulse" />
                ))}
              </div>
            )}

            {!loading && error && (
              <div style={{ padding: 32, textAlign: 'center', color: RED, fontSize: 14 }}>
                Failed to load tasks: {error}
              </div>
            )}

            {!loading && !error && filteredAndSorted.length === 0 && (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <ClipboardList size={32} style={{ color: MUTED, opacity: 0.4, margin: '0 auto 12px' }} />
                <div style={{ fontSize: 15, fontWeight: 600, color: FG }}>No tasks</div>
                <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                  {tasks.length > 0
                    ? 'No tasks match your current filters'
                    : "You're all caught up — no active tasks assigned to you"}
                </div>
                {activeFilters > 0 && (
                  <button
                    onClick={() => { setUrgencyFilter(''); setStatusFilter([]); setSearch(''); }}
                    style={{ marginTop: 12, fontSize: 13, color: BLUE, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            )}

            {!loading && !error && filteredAndSorted.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onClick={() => setSelectedId(task.id === selectedId ? null : task.id)}
                checkable={canManageTasks}
                checked={selectedIds.has(task.id)}
                onCheck={() => toggleSelect(task.id)}
              />
            ))}

            {/* Bottom padding */}
            <div style={{ height: 32 }} />
          </div>
          <div style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 16px',
            borderTop: `1px solid ${BORDER}`,
            backgroundColor: CARD,
          }}>
            <span style={{ fontSize: 12.5, color: MUTED }}>
              Showing {meta.total === 0 ? 0 : ((meta.page - 1) * meta.pageSize) + 1}-{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={!meta.hasPrev || loading}
                style={{
                  fontSize: 12.5,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: `1px solid ${BORDER}`,
                  backgroundColor: 'hsl(var(--background))',
                  color: (!meta.hasPrev || loading) ? MUTED : FG,
                  opacity: (!meta.hasPrev || loading) ? 0.55 : 1,
                  cursor: (!meta.hasPrev || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                Previous
              </button>
              <span className="vs-mono" style={{ fontSize: 12, color: MUTED }}>
                Page {meta.page} / {meta.totalPages}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!meta.hasNext || loading}
                style={{
                  fontSize: 12.5,
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: `1px solid ${BORDER}`,
                  backgroundColor: 'hsl(var(--background))',
                  color: (!meta.hasNext || loading) ? MUTED : FG,
                  opacity: (!meta.hasNext || loading) ? 0.55 : 1,
                  cursor: (!meta.hasNext || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>}

        {/* Detail panel (tasks tab only) */}
        {activeTab === 'tasks' && selectedId && (
          <DetailPanel
            taskId={selectedId}
            onClose={() => setSelectedId(null)}
            onRefresh={() => { refetch(); refetchSummary(); }}
          />
        )}
      </div>

      {/* ── Bulk modals ── */}
      {showBulkEscalation && (
        <BulkEscalationModal
          count={selectedIds.size}
          onClose={() => setShowBulkEscalation(false)}
          onConfirm={handleBulkEscalate}
        />
      )}
      {showBulkReassign && (
        <BulkRolePickerModal
          count={selectedIds.size}
          onClose={() => setShowBulkReassign(false)}
          onConfirm={handleBulkReassign}
        />
      )}

      {/* ── Creation drawer ── */}
      {showCreationDrawer && (
        <TaskCreationDrawer
          onClose={() => setShowCreationDrawer(false)}
          onCreated={() => { handleRefresh(); setShowCreationDrawer(false); }}
        />
      )}
    </div>
  );
}
