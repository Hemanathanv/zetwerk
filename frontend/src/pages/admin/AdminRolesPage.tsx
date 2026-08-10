import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Check, Copy, Trash2, Pencil,
  FileText, Layers, Receipt, Loader2, AlertTriangle, ArrowLeft,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProgressBar as EwmsProgressBar } from '@/components/vs/ProgressBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { usePermissions } from '@/contexts/PermissionContext';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Role {
  id: string; name: string; description?: string; roleCategory: string;
  isSystemDefault: boolean; color: string; allowedLevels: string[];
  defaultDataScope: string; defaultModules: string[]; documentScope?: string[];
  docTypeScopes?: Record<string, string[]>;
  _count?: { users: number; roleActivities: number };
}
interface Activity {
  id: string; activityCode: string; name: string; category: string;
  displayCode?: string; displayGroup?: string;
  moduleCode?: string; subModule?: string; status?: string; scope?: string;
  minLevel: string; scopeType?: string;
}
interface DocType {
  id: string; typeCode: string; displayName: string; shortCode: string; geography: string;
}
interface SysModule {
  id: string; moduleCode: string; displayName: string; icon: string; sortOrder: number;
}
interface EscalationConfig {
  id: string;
  activityType: string;
  activityName?: string;
  description?: string;
  scope?: string;
  baseDoc?: string;
  baseSlaHours: string | number;
  reminderPct: number;
  warningPct: number;
  escalationPct: number;
  blockerPct: number;
  taskEnabled?: boolean;
  channels?: Record<string, unknown> | null;
  targets?: Record<string, unknown> | null;
}
interface RequiredSlaRow {
  key: string;
  activityCode: string;
  activityType: string;
  activityName: string;
  description: string;
  scopeCode: string;
  scopeLabel: string;
  baseDoc: string;
  subModule?: string;
  taskEnabled?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const LEVELS = ['L1', 'L2', 'L3', 'L4'];

const ACTIVITY_GROUP_ORDER = [
  'document',
  'generation',
  'validation',
  'container_mapping',
  'shipment',
  'inventory',
  'dnd_activate',
  'dnd_tariff_master',
  'dnd_holiday_calendar',
  'admin',
];

const ACTIVITY_GROUP_LABELS: Record<string, string> = {
  document: 'Document Activities',
  generation: 'Generation Activities',
  validation: 'Validation Activities',
  container_mapping: 'Container Mapping Activities',
  shipment: 'Shipment Activities',
  inventory: 'Inventory Activities',
  dnd_activate: 'Demurrage and detention',
  dnd_tariff_master: 'Demurrage and detention',
  dnd_holiday_calendar: 'Demurrage and detention',
  admin: 'Admin Activities',
};

const SWATCHES = [
  '#64748B', '#6B7280', '#0EA5A0', '#06B6D4', '#3B82F6',
  '#6366F1', '#A855F7', '#EC4899', '#F43F5E', '#F59E0B',
  '#F97316', '#22C55E',
];

const ROLE_CAT_OPTIONS = [
  { value: 'INTERNAL_OPS',       label: 'Internal Ops',       color: '#3B82F6' },
  { value: 'INTERNAL_SPECIALIST', label: 'Internal Specialist', color: '#0EA5A0' },
  { value: 'EXTERNAL_PARTNER',   label: 'External Partner',   color: '#A855F7' },
  { value: 'CUSTOMER',           label: 'Customer',           color: '#22C55E' },
];

const TICKET_CATS = [
  { id: 'ap_india', label: 'AP India (INR)' },
  { id: 'ap_us',    label: 'AP US (USD)'    },
  { id: 'revenue',  label: 'Revenue (USD)'  },
  { id: 'penalty',  label: 'Penalty (USD)'  },
];

const SCOPE_ICON: Record<string, React.ElementType> = {
  docType: FileText, gate: Layers, ticketCategory: Receipt,
};

const SLA_LEVEL_COLORS = {
  reminder:   { dot: '#3b82f6', cellBg: '#eff6ff22' },
  warning:    { dot: '#d97706', cellBg: '#fffbeb33' },
  escalation: { dot: '#dc2626', cellBg: '#fef2f222' },
  blocker:    { dot: '#7f1d1d', cellBg: '#fee2e233' },
};

const ACTIVITY_SLA_GRID_COLUMNS = '230px 86px 145px 120px 145px repeat(4, 108px)';

const SLA_ACTIVITY_CONFIG: Record<string, { activityType: string; activityName: string; description: string; baseDoc: string }> = {
  'documents.upload': {
    activityType: 'upload_document',
    activityName: 'Upload Document',
    description: 'SCOPE OF DOCS BASED - every doc to have a SLA',
    baseDoc: 'Doc names',
  },
  'documents.fill_manual_fields': {
    activityType: 'fill_manual_fields',
    activityName: 'Fill Manual Fields',
    description: 'Scope -3 docs',
    baseDoc: 'Sales Invoice, Packing List, Bill of Lading',
  },
  'documents.submit_for_review': {
    activityType: 'submit_for_review',
    activityName: 'Submit for Review',
    description: 'SCOPE OF DOCS BASED - every doc to have a SLA. Edge case: If the doc is rejected - the submit for review timer will start',
    baseDoc: 'Sales Invoice, Packing List, Bill of Lading',
  },
  'documents.approve_generated_document': {
    activityType: 'approve_generated_document',
    activityName: 'Approve Generated Document',
    description: '',
    baseDoc: 'Sales Invoice, Packing List, Bill of Lading',
  },
  'documents.resolve_validation_failure': {
    activityType: 'resolve_validation_failure',
    activityName: 'Resolve Validation Failure',
    description: 'SCOPE OF DOCS BASED - every doc to have a SLA',
    baseDoc: 'Doc names',
  },
  'documents.map_container_to_sku': {
    activityType: 'map_container_to_sku',
    activityName: 'Map Container to SKU',
    description: '',
    baseDoc: '',
  },
  'documents.approve_container_mapping': {
    activityType: 'approve_container_mapping',
    activityName: 'Approve Container Mapping',
    description: '',
    baseDoc: '',
  },
};

const ACTIVITY_PERMISSION_GRID_COLUMNS =
  '20px minmax(0, 112px) minmax(0, 1.35fr) minmax(120px, 190px) minmax(64px, max-content)';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function catBadgeStyle(cat: string): React.CSSProperties {
  const m: Record<string, { bg: string; color: string }> = {
    INTERNAL_OPS:        { bg: '#dbeafe', color: '#1d4ed8' },
    INTERNAL_SPECIALIST: { bg: '#d1fae5', color: '#065f46' },
    EXTERNAL_PARTNER:    { bg: '#ede9fe', color: '#7c3aed' },
    CUSTOMER:            { bg: '#dcfce7', color: '#15803d' },
    org_external:        { bg: '#f3f4f6', color: '#374151' },
  };
  const c = m[cat] ?? { bg: '#f3f4f6', color: '#374151' };
  return { background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 8, fontSize: 14.5, fontWeight: 600 };
}

function catLabel(cat: string) {
  return ROLE_CAT_OPTIONS.find((o) => o.value === cat)?.label ?? cat;
}

function initials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function lvlRange(levels: string[]) {
  if (!levels.length) return '—';
  if (levels.length === 1) return levels[0];
  const s = [...levels].sort();
  return `${s[0]}–${s[s.length - 1]}`;
}

function activityModule(activity: Activity) {
  return activity.moduleCode ?? activity.category;
}

function activityGroup(activity: Activity) {
  return activity.category || activity.moduleCode || 'other';
}

function groupLabel(groupCode: string, activities: Activity[]) {
  return activities.find((a) => a.displayGroup)?.displayGroup ?? ACTIVITY_GROUP_LABELS[groupCode] ?? groupCode;
}

function isModuleEnabled(moduleCode: string, enabledModules: string[]) {
  return enabledModules.includes(moduleCode);
}

function isActivityEnabled(activity: Activity, enabledModules: string[]) {
  const moduleCode = activityModule(activity);
  if (moduleCode === 'admin') {
    return enabledModules.includes('admin') || enabledModules.includes('settings');
  }
  return isModuleEnabled(moduleCode, enabledModules);
}

function docScopeSummary(scope: string[] | undefined, docTypes: DocType[]) {
  const selected = scope ?? [];
  if (!selected.length) return 'No documents';
  if (selected.length === docTypes.length) return 'All documents';
  const labels = selected.map((code) => docTypes.find((dt) => dt.typeCode === code)?.displayName ?? code);
  return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
}

function docLabel(typeCode: string, docTypes: DocType[]) {
  return docTypes.find((dt) => dt.typeCode === typeCode)?.displayName ?? typeCode;
}

function positiveHours(value: string | number | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatSlaHours(hours: number): string {
  if (!hours) return '0h';
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rem = hours - days * 24;
    return `${days}d ${formatSlaHoursShort(rem)}`;
  }
  return formatSlaHoursShort(hours);
}

function formatSlaHoursShort(hours: number): string {
  if (hours >= 1) {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    return minutes === 0 ? `${wholeHours}h` : `${wholeHours}h ${minutes}m`;
  }
  return `${Math.round(hours * 60)}m`;
}

function displaySlaDays(hours: number): string {
  const days = hours / 24;
  const rounded = Math.round(days * 100) / 100;
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
}

function escalationMatches(row: EscalationConfig, required: RequiredSlaRow) {
  return row.activityType === required.activityType
    && String(row.scope ?? '').trim().toLowerCase() === required.scopeLabel.trim().toLowerCase();
}

function activityScopeSummary(activity: Activity, selected: string[] | undefined, docTypes: DocType[]) {
  if (activity.scopeType !== 'docType') return activity.scope || '-';
  if (!selected?.length) return activity.scope || 'Doc names';
  return docScopeSummary(selected, docTypes);
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div style={{ marginTop: 4 }}>
      <EwmsProgressBar
        current={value}
        total={max}
        intent="active"
        size="sm"
        hasLabel={false}
        valueDisplay="none"
      />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 8, padding: '12px 16px', border: '1px solid hsl(var(--border))', flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0, color: 'hsl(var(--muted-foreground))', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? 'hsl(var(--foreground))' }}>{value}</div>
    </div>
  );
}

function IconBtn({ children, onClick, title, disabled, danger }: {
  children: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: 6, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'transparent',
        color: disabled ? 'hsl(var(--muted-foreground) / 0.35)' : danger ? '#dc2626' : 'hsl(var(--muted-foreground))',
      }}>
      {children}
    </button>
  );
}

function ScopePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '0 14px 8px 46px', padding: 14, background: 'hsl(var(--muted) / 0.3)', borderRadius: 8, border: '1px solid hsl(var(--border))' }}>
      <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, marginTop: 0 }}>{title}</p>
      {children}
    </div>
  );
}

// ─── Role Editor ──────────────────────────────────────────────────────────────
interface EditorProps {
  roleId: string;
  roles: Role[];
  activities: Activity[];
  docTypes: DocType[];
  sysModules: SysModule[];
  onBack: () => void;
  onSaved: () => void;
}

const roleApiPath = (roleId: string) => `/api/admin/roles/${encodeURIComponent(roleId)}`;

function RoleEditor({ roleId, roles, activities, docTypes, sysModules, onBack, onSaved }: EditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { refreshPermissions } = usePermissions();
  const isNew = roleId === 'new';

  const [roleName, setRoleName]               = useState('');
  const [editorStep, setEditorStep]           = useState<'permissions' | 'sla'>('permissions');
  const [description, setDescription]         = useState('');
  const [category, setCategory]               = useState('INTERNAL_OPS');
  const [color, setColor]                     = useState('#0EA5A0');
  const [allowedLevels, setAllowedLevels]     = useState<string[]>(['L1']);
  const dataScope                             = 'TEAM';
  const [enabledModules, setEnabledModules]   = useState<string[]>([]);
  const [selectedActs, setSelectedActs]       = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups]   = useState<Set<string>>(new Set(['document', 'generation']));
  const [openScope, setOpenScope]             = useState<string | null>(null);
  const [scopeDialogActivity, setScopeDialogActivity] = useState<Activity | null>(null);
  const [docTypeScopes, setDocTypeScopes]     = useState<Record<string, string[]>>({});
  const [ticketScopes, setTicketScopes]       = useState<Record<string, string[]>>({});
  const [gateScopes, setGateScopes]           = useState<Record<string, { accessLevel: string; canEscalate: boolean; canOverride: boolean }>>({});
  const [isSystem, setIsSystem]               = useState(false);
  const [systemCode, setSystemCode]           = useState('');
  const [userCount, setUserCount]             = useState(0);
  const [assignedLevelsByActivity, setAssignedLevelsByActivity] = useState<Record<string, string[]>>({});
  const [escalationConfigs, setEscalationConfigs] = useState<EscalationConfig[]>([]);
  const [slaHoursByKey, setSlaHoursByKey] = useState<Record<string, string>>({});
  const [slaBaseDocByKey, setSlaBaseDocByKey] = useState<Record<string, string>>({});
  const [slaThresholdsByKey, setSlaThresholdsByKey] = useState<Record<string, {
    reminderPct: string;
    warningPct: string;
    escalationPct: string;
    blockerPct: string;
  }>>({});
  const [slaTaskEnabledByKey, setSlaTaskEnabledByKey] = useState<Record<string, boolean>>({});
  const [editingSlaCell, setEditingSlaCell] = useState<{ rowKey: string; field: 'baseSlaHours' | 'reminderPct' | 'warningPct' | 'escalationPct' | 'blockerPct' } | null>(null);
  const [baseDocPickerRow, setBaseDocPickerRow] = useState<RequiredSlaRow | null>(null);

  useEffect(() => {
    if (editorStep !== 'sla') return;
    window.dispatchEvent(new CustomEvent('ewms-settings-sidebar', { detail: { collapsed: true } }));
  }, [editorStep]);

  const escalationQuery = useQuery({
    queryKey: ['admin', 'escalation'],
    queryFn: () => apiGet<any>('/api/admin/escalation'),
    staleTime: 60_000,
  });

  const roleDetailQuery = useQuery({
    queryKey: ['admin', 'roles', roleId],
    queryFn: () => apiGet<any>(roleApiPath(roleId)),
    enabled: !isNew,
    staleTime: 30_000,
  });

  const comparisonRoleIds = useMemo(
    () => roles
      .map((role) => role.id)
      .filter((id) => id && (isNew || id !== roleId)),
    [roles, roleId, isNew],
  );

  const assignedRoleDetailsQuery = useQuery({
    queryKey: ['admin', 'roles', 'activity-levels', comparisonRoleIds],
    queryFn: () => Promise.all(
      comparisonRoleIds.map((id) => apiGet<any>(roleApiPath(id)).catch(() => null))
    ),
    enabled: comparisonRoleIds.length > 0,
    staleTime: 30_000,
  });

  const saveRoleMutation = useMutation({
    mutationFn: (payload: any) => isNew
      ? apiPost<any>('/api/admin/roles', payload)
      : apiPut<any>(roleApiPath(roleId), payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'escalation'] });
    },
  });

  useEffect(() => {
    if (escalationQuery.data?.ok) setEscalationConfigs(escalationQuery.data.data ?? []);
  }, [escalationQuery.data]);

  useEffect(() => {
    if (isNew) return;
    const data = roleDetailQuery.data?.data;
      if (!data) return;
      setRoleName(data.name ?? '');
      setDescription(data.description ?? '');
      setCategory(data.roleCategory ?? 'INTERNAL_OPS');
      setColor(data.color ?? '#0EA5A0');
      const savedLevels = (data.allowedLevels ?? ['L1']).filter((level: string) => LEVELS.includes(level));
      setAllowedLevels([savedLevels[0] ?? 'L1']);
      setEnabledModules(data.defaultModules ?? []);
      setIsSystem(data.isSystemDefault ?? false);
      setSystemCode(data.systemCode ?? '');
      setUserCount(data._count?.users ?? 0);
      setSelectedActs(new Set(
        (data.roleActivities ?? []).map((ra: any) => ra.activity?.activityCode).filter(Boolean)
      ));
      const ds: Record<string, string[]> = {};
      (data.docTypePerms ?? []).forEach((p: any) => {
        if (!ds[p.action]) ds[p.action] = [];
        if (!ds[p.action].includes(p.docType)) ds[p.action].push(p.docType);
      });
      setDocTypeScopes(ds);
      if (data.docTypeScopes && typeof data.docTypeScopes === 'object') {
        setDocTypeScopes(data.docTypeScopes);
      }
      if (Array.isArray(data.activitySla)) {
        const roleSlaConfigs: EscalationConfig[] = data.activitySla
          .filter((item: any) => item && item.activityType && item.scope)
          .map((item: any) => ({
            id: `role-${item.activityCode ?? item.activityType}-${item.scope}`,
            activityType: String(item.activityType),
            activityName: item.activityName,
            description: item.description,
            scope: String(item.scope),
            baseDoc: item.baseDoc,
            baseSlaHours: item.baseSlaHours,
            reminderPct: Number(item.reminderPct ?? 0),
            warningPct: Number(item.warningPct ?? 50),
            escalationPct: Number(item.escalationPct ?? 75),
            blockerPct: Number(item.blockerPct ?? 100),
            taskEnabled: item.taskEnabled !== false,
            channels: null,
            targets: null,
          }));
        setEscalationConfigs((prev) => {
          const next = [...prev];
          roleSlaConfigs.forEach((config) => {
            const index = next.findIndex((item) =>
              item.activityType === config.activityType
              && String(item.scope ?? '').trim().toLowerCase() === String(config.scope ?? '').trim().toLowerCase()
            );
            if (index >= 0) next[index] = { ...next[index], ...config };
            else next.push(config);
          });
          return next;
        });
      }
      const ts: Record<string, string[]> = {};
      (data.ticketPerms ?? []).forEach((p: any) => {
        if (!ts['accounting']) ts['accounting'] = [];
        if (!ts['accounting'].includes(p.category)) ts['accounting'].push(p.category);
      });
      setTicketScopes(ts);
      const gs: Record<string, any> = {};
      (data.gateAssignments ?? []).forEach((g: any) => {
        gs[g.gateConfigId] = { accessLevel: g.accessLevel, canEscalate: g.canEscalate, canOverride: g.canOverride };
      });
      setGateScopes(gs);
  }, [roleDetailQuery.data, isNew]);

  useEffect(() => {
    const responses = assignedRoleDetailsQuery.data ?? [];
    if (!comparisonRoleIds.length) {
      setAssignedLevelsByActivity({});
      return;
    }
    const next: Record<string, Set<string>> = {};
    responses.forEach((res) => {
      const data = res?.data;
      if (!data) return;
      const levels = (data.allowedLevels ?? []).filter((level: string) => LEVELS.includes(level));
      (data.roleActivities ?? []).forEach((ra: any) => {
        const code = ra.activity?.activityCode;
        if (!code) return;
        if (!next[code]) next[code] = new Set();
        levels.forEach((level: string) => next[code].add(level));
      });
    });
    setAssignedLevelsByActivity(
      Object.fromEntries(Object.entries(next).map(([code, levels]) => [code, [...levels].sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b))]))
    );
  }, [assignedRoleDetailsQuery.data, comparisonRoleIds]);

  const grouped = useMemo(() => {
    const m: Record<string, Activity[]> = {};
    activities.forEach((a) => {
      const key = activityGroup(a);
      if (!m[key]) m[key] = [];
      m[key].push(a);
    });
    return m;
  }, [activities]);

  const groupOrder = useMemo(() => {
    const visibleGroups = Object.keys(grouped).filter((code) =>
      (grouped[code] ?? []).some((activity) => isActivityEnabled(activity, enabledModules))
    );
    const known = ACTIVITY_GROUP_ORDER.filter((code) => visibleGroups.includes(code));
    const extra = visibleGroups.filter((code) => !known.includes(code)).sort();
    return [...known, ...extra];
  }, [enabledModules, grouped]);

  const enabledActivityCodes = useMemo(() => {
    return new Set(
      activities
        .filter((activity) => isActivityEnabled(activity, enabledModules))
        .map((activity) => activity.activityCode)
    );
  }, [activities, enabledModules]);

  const strictSelectedActs = useMemo(() => {
    return new Set(Array.from(selectedActs).filter((code) => enabledActivityCodes.has(code)));
  }, [enabledActivityCodes, selectedActs]);

  const selectedCount = useMemo(() => {
    let n = 0; activities.forEach((a) => { if (strictSelectedActs.has(a.activityCode)) n++; }); return n;
  }, [activities, strictSelectedActs]);
  const enabledActivityTotal = enabledActivityCodes.size;

  const requiredSlaRows = useMemo<RequiredSlaRow[]>(() => {
    return activities
      .filter((act) => strictSelectedActs.has(act.activityCode) && SLA_ACTIVITY_CONFIG[act.activityCode])
      .flatMap((act) => {
        const cfg = SLA_ACTIVITY_CONFIG[act.activityCode];
        const scopedDocs = act.scopeType === 'docType' ? (docTypeScopes[act.activityCode] ?? []) : [];
        const scopes = scopedDocs.length
          ? scopedDocs.map((code) => ({ code, label: docLabel(code, docTypes) }))
          : [{ code: 'general', label: act.scope || '-' }];
        return scopes.map((scope) => ({
          key: `${act.activityCode}::${scope.code}`,
          activityCode: act.activityCode,
          activityType: cfg.activityType,
          activityName: cfg.activityName,
          description: cfg.description,
          scopeCode: scope.code,
          scopeLabel: scope.label,
          baseDoc: cfg.baseDoc || scope.label,
          subModule: act.subModule,
          taskEnabled: true,
        }));
      });
  }, [activities, strictSelectedActs, docTypeScopes, docTypes]);

  useEffect(() => {
    setSlaHoursByKey((prev) => {
      const next = { ...prev };
      requiredSlaRows.forEach((row) => {
        if (next[row.key] !== undefined) return;
        const existing = escalationConfigs.find((cfg) => escalationMatches(cfg, row))
          ?? escalationConfigs.find((cfg) => String(cfg.activityType || '').toLowerCase() === row.activityType.toLowerCase());
        next[row.key] = existing ? String(existing.baseSlaHours) : '';
      });
      Object.keys(next).forEach((key) => {
        if (!requiredSlaRows.some((row) => row.key === key)) delete next[key];
      });
      return next;
    });

    setSlaBaseDocByKey((prev) => {
      const next = { ...prev };
      requiredSlaRows.forEach((row) => {
        if (next[row.key] !== undefined) return;
        const existing = escalationConfigs.find((cfg) => escalationMatches(cfg, row))
          ?? escalationConfigs.find((cfg) => String(cfg.activityType || '').toLowerCase() === row.activityType.toLowerCase());
        next[row.key] = existing?.baseDoc || row.baseDoc || row.scopeLabel;
      });
      Object.keys(next).forEach((key) => {
        if (!requiredSlaRows.some((row) => row.key === key)) delete next[key];
      });
      return next;
    });

    setSlaThresholdsByKey((prev) => {
      const next = { ...prev };
      requiredSlaRows.forEach((row) => {
        if (next[row.key] !== undefined) return;
        const existing = escalationConfigs.find((cfg) => escalationMatches(cfg, row))
          ?? escalationConfigs.find((cfg) => String(cfg.activityType || '').toLowerCase() === row.activityType.toLowerCase());
        next[row.key] = {
          reminderPct: String(existing?.reminderPct ?? 0),
          warningPct: String(existing?.warningPct ?? 50),
          escalationPct: String(existing?.escalationPct ?? 75),
          blockerPct: String(existing?.blockerPct ?? 100),
        };
      });
      Object.keys(next).forEach((key) => {
        if (!requiredSlaRows.some((row) => row.key === key)) delete next[key];
      });
      return next;
    });

    setSlaTaskEnabledByKey((prev) => {
      const next = { ...prev };
      requiredSlaRows.forEach((row) => {
        if (next[row.key] !== undefined) return;
        const existing = escalationConfigs.find((cfg) => escalationMatches(cfg, row))
          ?? escalationConfigs.find((cfg) => String(cfg.activityType || '').toLowerCase() === row.activityType.toLowerCase());
        next[row.key] = existing?.taskEnabled ?? row.taskEnabled ?? true;
      });
      Object.keys(next).forEach((key) => {
        if (!requiredSlaRows.some((row) => row.key === key)) delete next[key];
      });
      return next;
    });
  }, [requiredSlaRows, escalationConfigs]);

  const roleSaveBlockedReason = useMemo(() => {
    if (!roleName.trim()) return 'Role name is required';
    if (!allowedLevels.length) return 'Select at least one level';
    if (!enabledModules.length) return 'Enable at least one module';
    const selectedDocScoped = activities.filter((act) => strictSelectedActs.has(act.activityCode) && act.scopeType === 'docType');
    const missingDocScope = selectedDocScoped.find((act) => !(docTypeScopes[act.activityCode] ?? []).length);
    if (missingDocScope) return `Select documents for ${missingDocScope.name}`;
    return null;
  }, [
    roleName,
    allowedLevels,
    enabledModules,
    activities,
    strictSelectedActs,
    docTypeScopes,
  ]);

  function toggleModule(code: string) {
    const turningOff = enabledModules.includes(code);
    const nextModules = turningOff ? enabledModules.filter((m) => m !== code) : [...enabledModules, code];
    setEnabledModules(nextModules);
    if (!turningOff) return;
    const disabledActivityCodes = activities
      .filter((activity) => activityModule(activity) === code && !isActivityEnabled(activity, nextModules))
      .map((activity) => activity.activityCode);
    const disabledSet = new Set(disabledActivityCodes);
    setSelectedActs((p) => {
      const n = new Set(p);
      disabledSet.forEach((activityCode) => n.delete(activityCode));
      return n;
    });
    setDocTypeScopes((p) => {
      const n = { ...p };
      disabledSet.forEach((activityCode) => delete n[activityCode]);
      return n;
    });
    setTicketScopes((p) => {
      const n = { ...p };
      disabledSet.forEach((activityCode) => delete n[activityCode]);
      return n;
    });
    if (openScope && disabledSet.has(openScope)) setOpenScope(null);
    if (scopeDialogActivity && disabledSet.has(scopeDialogActivity.activityCode)) setScopeDialogActivity(null);
  }
  function toggleActivity(code: string) {
    if (!enabledActivityCodes.has(code)) return;
    setSelectedActs((p) => { const n = new Set(p); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }
  function toggleGroupAll(cat: string, catActs: Activity[]) {
    const codes = catActs.map((a) => a.activityCode);
    const allSel = codes.every((c) => selectedActs.has(c));
    setSelectedActs((p) => { const n = new Set(p); allSel ? codes.forEach((c) => n.delete(c)) : codes.forEach((c) => n.add(c)); return n; });
  }
  function selectLevel(level: string) {
    setAllowedLevels([level]);
  }
  function activityLevels(act: Activity) {
    const levels = new Set(assignedLevelsByActivity[act.activityCode] ?? []);
    if (selectedActs.has(act.activityCode)) {
      allowedLevels.forEach((level) => levels.add(level));
    }
    if (!levels.size && act.minLevel) levels.add(act.minLevel);
    return [...levels].filter((level) => LEVELS.includes(level)).sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b));
  }
  function toggleDocType(key: string, typeCode: string) {
    setDocTypeScopes((p) => {
      const arr = p[key] ?? [];
      return { ...p, [key]: arr.includes(typeCode) ? arr.filter((t) => t !== typeCode) : [...arr, typeCode] };
    });
  }
  function selectActivityDocTypes(key: string, types: DocType[]) {
    setDocTypeScopes((p) => ({ ...p, [key]: [...new Set([...(p[key] ?? []), ...types.map((dt) => dt.typeCode)])] }));
  }
  function clearActivityDocTypes(key: string) {
    setDocTypeScopes((p) => ({ ...p, [key]: [] }));
  }
  function toggleTicketCat(key: string, catId: string) {
    setTicketScopes((p) => {
      const arr = p[key] ?? [];
      return { ...p, [key]: arr.includes(catId) ? arr.filter((c) => c !== catId) : [...arr, catId] };
    });
  }

  async function handleSave() {
    if (roleSaveBlockedReason) {
      toast({ title: roleSaveBlockedReason, variant: 'destructive' });
      return;
    }
    if (!roleName.trim()) { toast({ title: 'Role name is required', variant: 'destructive' }); return; }
    if (!allowedLevels.length) { toast({ title: 'Select at least one level', variant: 'destructive' }); return; }
    if (!enabledModules.length) { toast({ title: 'Enable at least one module', variant: 'destructive' }); return; }
    const selectedDocScoped = activities.filter((act) => strictSelectedActs.has(act.activityCode) && act.scopeType === 'docType');
    const missingDocScope = selectedDocScoped.find((act) => !(docTypeScopes[act.activityCode] ?? []).length);
    if (missingDocScope) {
      toast({ title: `Select documents for ${missingDocScope.name}`, variant: 'destructive' });
      return;
    }
    const strictActivityCodes = Array.from(strictSelectedActs);
    const strictDocTypeScopes = Object.fromEntries(
      Object.entries(docTypeScopes).filter(([activityCode]) => strictSelectedActs.has(activityCode))
    );
    const derivedDocumentScope = [...new Set(Object.values(strictDocTypeScopes).flat())].sort();
    const activitySla = requiredSlaRows.map((row) => {
      const thresholds = slaThresholdsByKey[row.key] ?? { reminderPct: '50', warningPct: '75', escalationPct: '100', blockerPct: '150' };
      return {
        activityCode: row.activityCode,
        activityType: row.activityType,
        activityName: row.activityName,
        description: row.description,
        scope: row.scopeLabel,
        baseDoc: slaBaseDocByKey[row.key] || row.baseDoc || row.scopeLabel,
        baseSlaHours: positiveHours(slaHoursByKey[row.key]),
        taskEnabled: slaTaskEnabledByKey[row.key] ?? row.taskEnabled ?? true,
        reminderPct: Number(thresholds.reminderPct),
        warningPct: Number(thresholds.warningPct),
        escalationPct: Number(thresholds.escalationPct),
        blockerPct: Number(thresholds.blockerPct),
      };
    });
    try {
      const payload = {
        name: roleName.trim(), description: description || null, roleCategory: category,
        color, allowedLevels, defaultDataScope: dataScope, defaultModules: enabledModules,
        documentScope: derivedDocumentScope,
        docTypeScopes: strictDocTypeScopes,
        activityCodes: strictActivityCodes,
        activitySla,
      };
      const res = await saveRoleMutation.mutateAsync(payload);
      if (!res.ok) { toast({ title: res.error ?? 'Save failed', variant: 'destructive' }); return; }
      await refreshPermissions();
      toast({ title: `Role ${isNew ? 'created' : 'saved'}` });
      onSaved();
    } catch { toast({ title: 'Network error', variant: 'destructive' }); }
  }

  const saving = saveRoleMutation.isPending;

  if (!isNew && roleDetailQuery.isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'hsl(173 58% 39%)' }} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: -32, marginLeft: -32, marginRight: -32 }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: -32, zIndex: 20,
        background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))',
        padding: '12px 32px', display: 'flex', alignItems: 'center', gap: 16,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', fontSize: 14.5, padding: '4px 0' }}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ width: 1, height: 18, background: 'hsl(var(--border))' }} />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: color, display: 'inline-block' }} />
          {isNew ? 'New role' : roleName || 'Editing role'}
        </span>
        <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          {selectedCount}/{activities.length} activities
        </span>
        {editorStep === 'permissions' ? (
          <>
            <Button variant="outline" size="sm" onClick={onBack}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                if (roleSaveBlockedReason) {
                  toast({ title: roleSaveBlockedReason, variant: 'destructive' });
                  return;
                }
                setEditorStep('sla');
              }}
              title={roleSaveBlockedReason ?? undefined}
              style={{ minWidth: 92 }}
            >
              Next
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditorStep('permissions')}>Back</Button>
            <Button size="sm" disabled={saving} onClick={handleSave} title={roleSaveBlockedReason ?? undefined} style={{ minWidth: 110 }}>
              {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />Saving...</> : 'Save changes'}
            </Button>
          </>
        )}
      </div>

      {isSystem && (
        <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde047', padding: '8px 32px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#92400e' }}>
          <AlertTriangle size={14} />
          System role — changes apply to all {userCount} users holding this role immediately.
        </div>
      )}

      {/* Body */}
      <div style={{ display: 'flex', gap: editorStep === 'sla' ? 0 : 'var(--ewms-content-grid-gap)', padding: 'var(--ewms-page-padding-y) var(--ewms-page-padding-x)', alignItems: 'flex-start' }}>

        {/* ── Left panel ─────────────────────────────────────────────────── */}
        {editorStep === 'permissions' && (<>
        <div style={{ width: 296, flexShrink: 0, position: 'sticky', top: 36, alignSelf: 'flex-start' }}>
          <div style={{ background: 'hsl(var(--card))', borderRadius: 8, border: '1px solid hsl(var(--border))', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div>
              <FieldLabel>Role name <span style={{ color: '#dc2626' }}>*</span></FieldLabel>
              <Input value={roleName} onChange={(e) => setRoleName(e.target.value)}
                readOnly={isSystem} placeholder="e.g., India Logistics"
                style={{ fontSize: 14.5 }} />
            </div>

            <div>
              <FieldLabel>Description</FieldLabel>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} placeholder="What does this role do?"
                style={{
                  width: '100%', fontSize: 14.5, borderRadius: 6, padding: '6px 10px',
                  border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
                  color: 'hsl(var(--foreground))', resize: 'vertical', fontFamily: 'inherit',
                  boxSizing: 'border-box', outline: 'none',
                }} />
            </div>

            {systemCode && (
              <div>
                <FieldLabel>System code</FieldLabel>
                <div style={{
                  fontFamily: 'var(--app-font-sans)', fontSize: 14,
                  padding: '6px 10px', borderRadius: 6,
                  background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
                  border: '1px solid hsl(var(--border))',
                }}>
                  {systemCode}
                </div>
              </div>
            )}

            <div>
              <FieldLabel>Color</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SWATCHES.map((s) => (
                  <button key={s} onClick={() => setColor(s)}
                    style={{
                      width: 22, height: 22, borderRadius: 8, background: s, border: 'none',
                      cursor: 'pointer', boxSizing: 'border-box',
                      outline: color === s ? `2px solid ${s}` : 'none', outlineOffset: 2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                    {color === s && <Check size={12} color="#fff" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>Levels</FieldLabel>
              <RadioGroup value={allowedLevels[0] ?? 'L1'} onValueChange={selectLevel} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {LEVELS.map((level) => (
                  <label key={level} htmlFor={`role-level-${level}`} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 14.5 }}>
                    <RadioGroupItem value={level} id={`role-level-${level}`} />
                    {level}
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* Preview card */}
            <div style={{ background: 'hsl(var(--muted) / 0.4)', borderRadius: 8, padding: 14, border: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 42, height: 42, borderRadius: 21, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                  {initials(roleName || 'NR')}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleName || 'New role'}</div>
                  <span style={catBadgeStyle(category)}>{catLabel(category)}</span>
                </div>
              </div>
              <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-sans)' }}>
                {selectedCount}/{enabledActivityTotal} activities · {lvlRange(allowedLevels)}
              </div>
              {enabledModules.length > 0 && (
                <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {enabledModules.join(', ')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        </>)}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {editorStep === 'permissions' ? (
          <>

          {/* Tier 1: Module toggles */}
          <AdminFormSection title="Module Access" defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[...sysModules].sort((a, b) => a.sortOrder - b.sortOrder).map((mod) => {
                const on = enabledModules.includes(mod.moduleCode);
                return (
                  <label key={mod.moduleCode} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${on ? 'hsl(173 58% 39% / 0.4)' : 'hsl(var(--border))'}`,
                    background: on ? 'hsl(173 58% 39% / 0.06)' : 'hsl(var(--background))',
                  }}>
                    <span style={{ fontSize: 14.5, fontWeight: 500 }}>{mod.displayName}</span>
                    <Switch checked={on} onCheckedChange={() => toggleModule(mod.moduleCode)} />
                  </label>
                );
              })}
            </div>
          </AdminFormSection>

          {/* Tier 2: Activity groups */}
          <AdminFormSection title="Activity Permissions" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {groupOrder.length === 0 && (
                <div style={{
                  border: '1px dashed hsl(var(--border))',
                  borderRadius: 8,
                  padding: '18px 14px',
                  color: 'hsl(var(--muted-foreground))',
                  fontSize: 14.5,
                }}>
                  Enable a module to configure its activities.
                </div>
              )}
              {groupOrder.map((groupCode) => {
                const groupActs = (grouped[groupCode] ?? []).filter((act) => isActivityEnabled(act, enabledModules));
                const selCount = groupActs.filter((a) => strictSelectedActs.has(a.activityCode)).length;
                const isExpanded = expandedGroups.has(groupCode);
                const allSel = groupActs.length > 0 && groupActs.every((a) => strictSelectedActs.has(a.activityCode));
                const someSel = selCount > 0 && !allSel;

                return (
                  <div key={groupCode} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, overflow: 'hidden' }}>
                    {/* Group header */}
                    <div
                      onClick={() => {
                        setExpandedGroups((p) => { const n = new Set(p); n.has(groupCode) ? n.delete(groupCode) : n.add(groupCode); return n; });
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: 'hsl(var(--muted) / 0.3)', userSelect: 'none' }}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <input type="checkbox" checked={allSel}
                        ref={(el) => { if (el) el.indeterminate = someSel; }}
                        onChange={(e) => { e.stopPropagation(); toggleGroupAll(groupCode, groupActs); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ accentColor: 'hsl(173 58% 39%)', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{groupLabel(groupCode, groupActs)}</span>
                      <span style={{
                        fontSize: 14.5, fontFamily: 'var(--app-font-sans)', padding: '2px 8px', borderRadius: 8,
                        background: selCount > 0 ? 'hsl(173 58% 39% / 0.12)' : 'hsl(var(--muted))',
                        color: selCount > 0 ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
                      }}>
                        {selCount}/{groupActs.length}
                      </span>
                    </div>

                    {/* Activity rows */}
                    {isExpanded && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: ACTIVITY_PERMISSION_GRID_COLUMNS,
                        alignItems: 'center',
                        gap: 12,
                        padding: '7px 14px',
                        borderTop: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--muted) / 0.18)',
                        color: 'hsl(var(--muted-foreground))',
                        fontSize: 12.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}>
                        <span />
                        <span style={{ minWidth: 0 }}>Code</span>
                        <span style={{ minWidth: 0 }}>Activity</span>
                        <span style={{ minWidth: 0 }}>Scope</span>
                        <span style={{ textAlign: 'right' }}>Level</span>
                      </div>
                    )}
                    {isExpanded && groupActs.map((act) => {
                      const isSel = strictSelectedActs.has(act.activityCode);
                      const levels = activityLevels(act);
                      const scopedDocs = docTypeScopes[act.activityCode] ?? [];
                      const isScopeOpen = openScope === act.activityCode;

                      return (
                        <div key={act.id}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: ACTIVITY_PERMISSION_GRID_COLUMNS,
                            alignItems: 'center',
                            gap: 12,
                            padding: '7px 14px', borderTop: '1px solid hsl(var(--border))',
                            background: isSel ? 'hsl(173 58% 39% / 0.04)' : undefined,
                          }}>
                            <input type="checkbox" checked={isSel}
                              onChange={() => toggleActivity(act.activityCode)}
                              style={{ accentColor: 'hsl(173 58% 39%)', flexShrink: 0 }} />
                            <span style={{
                              fontFamily: 'var(--app-font-sans)',
                              fontSize: 13.5,
                              color: 'hsl(var(--muted-foreground))',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              lineHeight: 1.25,
                              minWidth: 0,
                            }}>
                              {act.displayCode ?? act.activityCode}
                            </span>
                            <span style={{
                              fontSize: 14.5,
                              minWidth: 0,
                              lineHeight: 1.3,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {act.name}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              {act.scopeType === 'docType' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!strictSelectedActs.has(act.activityCode)) toggleActivity(act.activityCode);
                                    setScopeDialogActivity(act);
                                  }}
                                  title={activityScopeSummary(act, scopedDocs, docTypes)}
                                  style={{
                                    maxWidth: '100%',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '3px 8px',
                                    borderRadius: 5,
                                    border: '1px solid hsl(var(--border))',
                                    background: scopedDocs.length ? 'hsl(173 58% 39% / 0.08)' : 'hsl(var(--background))',
                                    color: scopedDocs.length ? 'hsl(173 58% 30%)' : 'hsl(var(--muted-foreground))',
                                    cursor: 'pointer',
                                    fontSize: 13.5,
                                    overflow: 'hidden',
                                  }}
                                >
                                  <FileText size={12} style={{ flexShrink: 0 }} />
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {activityScopeSummary(act, scopedDocs, docTypes)}
                                  </span>
                                </button>
                              ) : (
                                <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13.5 }}>
                                  {activityScopeSummary(act, undefined, docTypes)}
                                </span>
                              )}
                            </span>
                            <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                              {levels.map((level) => (
                                <span key={level} style={{
                                  fontFamily: 'var(--app-font-sans)',
                                  fontSize: 12.5,
                                  background: 'hsl(var(--muted))',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  lineHeight: 1.2,
                                }}>
                                  {level}
                                </span>
                              ))}
                            </span>
                          </div>

                          {/* Tier 3: docType scope */}
                          {isScopeOpen && act.scopeType === 'docType' && (
                            <ScopePanel title={`Document type scope — ${act.name}`}>
                              {['INDIA', 'US', 'GLOBAL'].map((geo) => {
                                const geoTypes = docTypes.filter((dt) => dt.geography === geo);
                                if (!geoTypes.length) return null;
                                const scopeKey = act.activityCode;
                                return (
                                  <div key={geo} style={{ marginBottom: 12 }}>
                                    <p style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'hsl(var(--muted-foreground))', margin: '0 0 6px' }}>{geo}</p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                      {geoTypes.map((dt) => {
                                        const chk = (docTypeScopes[scopeKey] ?? []).includes(dt.typeCode);
                                        return (
                                          <label key={dt.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, cursor: 'pointer',
                                            padding: '2px 8px', borderRadius: 4,
                                            border: `1px solid ${chk ? 'hsl(173 58% 39%)' : 'hsl(var(--border))'}`,
                                            background: chk ? 'hsl(173 58% 39% / 0.08)' : undefined,
                                          }}>
                                            <input type="checkbox" checked={chk}
                                              onChange={() => toggleDocType(scopeKey, dt.typeCode)}
                                              style={{ accentColor: 'hsl(173 58% 39%)' }} />
                                            <span style={{ fontWeight: 600 }}>{dt.displayName}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                    <button
                                      onClick={() => geoTypes.forEach((dt) => { if (!(docTypeScopes[act.activityCode] ?? []).includes(dt.typeCode)) toggleDocType(act.activityCode, dt.typeCode); })}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(173 58% 39%)', fontSize: 14.5, padding: '4px 0', textDecoration: 'underline' }}>
                                      Select all {geo.toLowerCase()}
                                    </button>
                                  </div>
                                );
                              })}
                              <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', margin: '6px 0 0' }}>
                                {(docTypeScopes[act.activityCode] ?? []).length} of {docTypes.length} doc types selected
                              </p>
                            </ScopePanel>
                          )}

                          {/* Tier 3: ticket scope */}
                          {isScopeOpen && act.scopeType === 'ticketCategory' && (
                            <ScopePanel title={`Ticket category scope — ${act.name}`}>
                              {TICKET_CATS.map((tc) => {
                                const chk = (ticketScopes[act.activityCode] ?? []).includes(tc.id);
                                return (
                                  <label key={tc.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, cursor: 'pointer', marginBottom: 6 }}>
                                    <input type="checkbox" checked={chk}
                                      onChange={() => toggleTicketCat(act.activityCode, tc.id)}
                                      style={{ accentColor: 'hsl(173 58% 39%)' }} />
                                    {tc.label}
                                  </label>
                                );
                              })}
                            </ScopePanel>
                          )}

                          {/* Tier 3: gate scope */}
                          {isScopeOpen && act.scopeType === 'gate' && (
                            <ScopePanel title={`Gate access scope — ${act.name}`}>
                              {Object.keys(gateScopes).length === 0 ? (
                                <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
                                  Gate assignments are configured per workflow template. Open the Template editor to assign gate access for this role.
                                </p>
                              ) : Object.entries(gateScopes).map(([gateId, cfg]) => (
                                <div key={gateId} style={{ marginBottom: 12 }}>
                                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px', fontFamily: 'var(--app-font-sans)' }}>
                                    Gate {gateId.slice(0, 8)}…
                                  </p>
                                  <RadioGroup value={cfg.accessLevel}
                                    onValueChange={(v) => setGateScopes((p) => ({ ...p, [gateId]: { ...cfg, accessLevel: v } }))}
                                    style={{ display: 'flex', gap: 16 }}>
                                    {['full', 'summary', 'none'].map((lvl) => (
                                      <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <RadioGroupItem value={lvl} id={`gate-${gateId}-${lvl}`} />
                                        <Label htmlFor={`gate-${gateId}-${lvl}`} style={{ fontSize: 14, textTransform: 'capitalize', cursor: 'pointer' }}>{lvl}</Label>
                                      </div>
                                    ))}
                                  </RadioGroup>
                                  {cfg.accessLevel === 'full' && (
                                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={cfg.canEscalate}
                                          onChange={(e) => setGateScopes((p) => ({ ...p, [gateId]: { ...cfg, canEscalate: e.target.checked } }))}
                                          style={{ accentColor: 'hsl(173 58% 39%)' }} />
                                        Can escalate
                                      </label>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={cfg.canOverride}
                                          onChange={(e) => setGateScopes((p) => ({ ...p, [gateId]: { ...cfg, canOverride: e.target.checked } }))}
                                          style={{ accentColor: 'hsl(173 58% 39%)' }} />
                                        Can override
                                      </label>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </ScopePanel>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </AdminFormSection>

          </>
          ) : (
          <AdminFormSection
            title="Activity SLA"
            description="Required SLA timers for the selected role activities and their scopes"
            defaultOpen
            isLast
          >
            {requiredSlaRows.length === 0 ? (
              <div style={{
                padding: 18,
                borderRadius: 8,
                border: '1px dashed hsl(var(--border))',
                color: 'hsl(var(--muted-foreground))',
                fontSize: 14.5,
                background: 'hsl(var(--muted) / 0.18)',
              }}>
                Select an SLA-enabled activity to configure timers.
              </div>
            ) : (
              <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, overflowX: 'auto', overflowY: 'hidden' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: ACTIVITY_SLA_GRID_COLUMNS,
                  minWidth: 1246,
                  background: 'hsl(var(--muted) / 0.45)',
                  color: 'hsl(var(--muted-foreground))',
                  fontSize: 14.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid hsl(var(--border))',
                }}>
                  {['Activity Type', 'Task', 'Scope', 'Base SLA (Days)', 'Base Doc'].map((label) => (
                    <div key={label} style={{ padding: '10px 10px', display: 'flex', alignItems: 'center' }}>{label}</div>
                  ))}
                  {([
                    ['Reminder', SLA_LEVEL_COLORS.reminder.dot],
                    ['Warning', SLA_LEVEL_COLORS.warning.dot],
                    ['Escalation', SLA_LEVEL_COLORS.escalation.dot],
                    ['Blocker', SLA_LEVEL_COLORS.blocker.dot],
                  ] as const).map(([label, color]) => (
                    <div key={label} style={{ padding: '10px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                      {label}
                    </div>
                  ))}
                </div>
                {requiredSlaRows.map((row) => {
                  const value = slaHoursByKey[row.key] ?? '';
                  const invalid = positiveHours(value) <= 0;
                  const baseH = positiveHours(value);
                  const baseDocValue = slaBaseDocByKey[row.key] || row.baseDoc || row.scopeLabel;
                  const thresholds = slaThresholdsByKey[row.key] ?? {
                    reminderPct: '50',
                    warningPct: '75',
                    escalationPct: '100',
                    blockerPct: '150',
                  };
                  const setThreshold = (field: keyof typeof thresholds, nextValue: string) => {
                    setSlaThresholdsByKey((prev) => ({
                      ...prev,
                      [row.key]: {
                        ...(prev[row.key] ?? thresholds),
                        [field]: nextValue,
                      },
                    }));
                  };
                  const thresholdCells = [
                    { field: 'reminderPct' as const, fallback: '50', color: SLA_LEVEL_COLORS.reminder.dot, bg: SLA_LEVEL_COLORS.reminder.cellBg },
                    { field: 'warningPct' as const, fallback: '75', color: SLA_LEVEL_COLORS.warning.dot, bg: SLA_LEVEL_COLORS.warning.cellBg },
                    { field: 'escalationPct' as const, fallback: '100', color: SLA_LEVEL_COLORS.escalation.dot, bg: SLA_LEVEL_COLORS.escalation.cellBg },
                    { field: 'blockerPct' as const, fallback: '150', color: SLA_LEVEL_COLORS.blocker.dot, bg: SLA_LEVEL_COLORS.blocker.cellBg },
                  ];
                  return (
                    <div
                      key={row.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: ACTIVITY_SLA_GRID_COLUMNS,
                        minWidth: 1246,
                        alignItems: 'center',
                        borderBottom: '1px solid hsl(var(--border))',
                        background: invalid ? 'hsl(38 92% 50% / 0.05)' : 'hsl(var(--card))',
                      }}
                    >
                      <div style={{ minWidth: 0, padding: '12px 10px' }}>
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>{row.activityName}</div>
                        {row.subModule && (
                          <div style={{ marginTop: 2, fontSize: 12.5, color: 'hsl(var(--muted-foreground))' }}>{row.subModule}</div>
                        )}
                      </div>
                      <label
                        title="Create task for this role"
                        style={{ padding: '12px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <input
                          type="checkbox"
                          checked={slaTaskEnabledByKey[row.key] ?? row.taskEnabled ?? true}
                          onChange={(e) => setSlaTaskEnabledByKey((prev) => ({ ...prev, [row.key]: e.target.checked }))}
                          style={{ width: 16, height: 16, accentColor: 'hsl(173 58% 39%)', cursor: 'pointer' }}
                        />
                      </label>
                      <span style={{ padding: '12px 10px', fontSize: 14, color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {row.scopeLabel}
                      </span>
                      <div style={{ padding: '12px 10px', textAlign: 'center' }}>
                        {editingSlaCell?.rowKey === row.key && editingSlaCell.field === 'baseSlaHours' ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Input
                              autoFocus
                              type="number"
                              min="0.1"
                              step="0.25"
                              value={baseH ? String(Math.round((baseH / 24) * 100) / 100) : ''}
                              onChange={(e) => {
                                const days = Number(e.target.value);
                                setSlaHoursByKey((prev) => ({
                                  ...prev,
                                  [row.key]: Number.isFinite(days) ? String(days * 24) : '',
                                }));
                              }}
                              onBlur={() => setEditingSlaCell(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') setEditingSlaCell(null);
                              }}
                              style={{ height: 30, width: 58, fontSize: 14, textAlign: 'center', borderColor: invalid ? '#d97706' : undefined }}
                            />
                            <span style={{ fontSize: 12.5, color: 'hsl(var(--muted-foreground))' }}>days</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingSlaCell({ rowKey: row.key, field: 'baseSlaHours' })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'hsl(var(--foreground))' }}
                            title="Click to edit"
                          >
                            <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14 }}>{baseH ? displaySlaDays(baseH) : 'Set SLA'}</span>
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setBaseDocPickerRow(row)}
                        title={baseDocValue}
                        style={{
                          height: 32,
                          minWidth: 0,
                          width: 'calc(100% - 20px)',
                          margin: '12px 10px',
                          padding: '0 10px',
                          borderRadius: 6,
                          border: '1px solid hsl(var(--border))',
                          background: 'hsl(var(--background))',
                          color: baseDocValue ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                          fontSize: 14,
                          textAlign: 'left',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {baseDocValue || 'Choose doc'}
                      </button>
                      {thresholdCells.map(({ field, fallback, color, bg }) => {
                        const thresholdValue = thresholds[field] ?? fallback;
                        const n = Number(thresholdValue);
                        const thresholdInvalid = !Number.isFinite(n) || n < 0 || n > 500;
                        const isEditing = editingSlaCell?.rowKey === row.key && editingSlaCell.field === field;
                        const computed = formatSlaHours((baseH * (Number.isFinite(n) ? n : 0)) / 100);
                        return (
                          <div key={field} style={{ padding: '12px 10px', background: bg, textAlign: 'center', minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isEditing ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Input
                                  autoFocus
                                  type="number"
                                  min="0"
                                  max="500"
                                  step="1"
                                  value={thresholdValue}
                                  onChange={(e) => setThreshold(field, e.target.value)}
                                  onBlur={() => setEditingSlaCell(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === 'Escape') setEditingSlaCell(null);
                                  }}
                                  style={{ height: 30, width: 54, fontSize: 13.5, textAlign: 'center', borderColor: thresholdInvalid ? '#d97706' : color }}
                                />
                                <span style={{ fontSize: 12.5, color: 'hsl(var(--muted-foreground))' }}>%</span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditingSlaCell({ rowKey: row.key, field })}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: 1,
                                }}
                                title="Click to edit"
                              >
                                <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 13.5, color, fontWeight: 700 }}>{thresholdValue}%</span>
                                <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{computed}</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </AdminFormSection>
          )}
        </div>
      </div>
      {baseDocPickerRow && (
        <div
          onClick={() => setBaseDocPickerRow(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            background: 'rgba(15, 23, 42, 0.38)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100%)',
              maxHeight: '78vh',
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              boxShadow: '0 22px 60px rgba(15, 23, 42, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Base Doc</div>
                <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {baseDocPickerRow.activityName} · {baseDocPickerRow.scopeLabel}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setBaseDocPickerRow(null)}>Cancel</Button>
            </div>
            <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {['INDIA', 'US', 'GLOBAL'].map((geo) => {
                const geoTypes = docTypes.filter((dt) => dt.geography === geo);
                if (!geoTypes.length) return null;
                return (
                  <div key={geo} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>{geo}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 7 }}>
                      {geoTypes.map((dt) => {
                        const selected = (slaBaseDocByKey[baseDocPickerRow.key] || baseDocPickerRow.baseDoc || baseDocPickerRow.scopeLabel) === dt.displayName;
                        return (
                          <button
                            key={dt.typeCode}
                            type="button"
                            onClick={() => {
                              setSlaBaseDocByKey((prev) => ({ ...prev, [baseDocPickerRow.key]: dt.displayName }));
                              setBaseDocPickerRow(null);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                              minWidth: 0,
                              padding: '8px 10px',
                              borderRadius: 6,
                              border: `1px solid ${selected ? 'hsl(173 58% 39%)' : 'hsl(var(--border))'}`,
                              background: selected ? 'hsl(173 58% 39% / 0.08)' : 'hsl(var(--background))',
                              color: 'hsl(var(--foreground))',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontSize: 14.5,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dt.displayName}</span>
                            {selected && <Check size={13} style={{ color: 'hsl(173 58% 39%)', flexShrink: 0 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {scopeDialogActivity && (
        <div
          onClick={() => setScopeDialogActivity(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 23, 42, 0.38)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(720px, 100%)',
              maxHeight: '82vh',
              overflow: 'auto',
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              boxShadow: '0 22px 60px rgba(15, 23, 42, 0.25)',
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Scope</div>
                <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {scopeDialogActivity.displayCode ?? scopeDialogActivity.activityCode} · {scopeDialogActivity.name}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => clearActivityDocTypes(scopeDialogActivity.activityCode)}>Clear</Button>
              <Button size="sm" onClick={() => setScopeDialogActivity(null)}>Done</Button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {['INDIA', 'US', 'GLOBAL'].map((geo) => {
                const geoTypes = docTypes.filter((dt) => dt.geography === geo);
                if (!geoTypes.length) return null;
                const activityCode = scopeDialogActivity.activityCode;
                return (
                  <div key={geo} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))' }}>{geo}</span>
                      <button
                        type="button"
                        onClick={() => selectActivityDocTypes(activityCode, geoTypes)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(173 58% 39%)', fontSize: 14, padding: 0 }}
                      >
                        Select all
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 7 }}>
                      {geoTypes.map((dt) => {
                        const checked = (docTypeScopes[activityCode] ?? []).includes(dt.typeCode);
                        return (
                          <label
                            key={dt.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 7,
                              minWidth: 0,
                              fontSize: 14.5,
                              cursor: 'pointer',
                              padding: '7px 9px',
                              borderRadius: 6,
                              border: `1px solid ${checked ? 'hsl(173 58% 39%)' : 'hsl(var(--border))'}`,
                              background: checked ? 'hsl(173 58% 39% / 0.08)' : 'hsl(var(--background))',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleDocType(activityCode, dt.typeCode)}
                              style={{ accentColor: 'hsl(173 58% 39%)', flexShrink: 0 }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dt.displayName}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                {(docTypeScopes[scopeDialogActivity.activityCode] ?? []).length} of {docTypes.length} documents selected
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function AdminRolesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { loaded: permissionsLoaded } = usePermissions();
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => apiGet<any>('/api/admin/roles'),
    enabled: permissionsLoaded,
    staleTime: 30_000,
  });

  const docTypesQuery = useQuery({
    queryKey: ['admin', 'registries', 'doc-types'],
    queryFn: () => apiGet<any>('/api/admin/registries/doc-types'),
    enabled: permissionsLoaded,
    staleTime: 5 * 60_000,
  });

  const modulesQuery = useQuery({
    queryKey: ['admin', 'registries', 'modules'],
    queryFn: () => apiGet<any>('/api/admin/registries/modules'),
    enabled: permissionsLoaded,
    staleTime: 5 * 60_000,
  });

  const activitiesQuery = useQuery({
    queryKey: ['admin', 'activities'],
    queryFn: () => apiGet<any>('/api/admin/activities'),
    enabled: permissionsLoaded,
    staleTime: 5 * 60_000,
  });
  const roles = (rolesQuery.data?.data ?? []) as Role[];
  const docTypes = ((docTypesQuery.data?.data ?? []) as DocType[]).map(d => ({ ...d, geography: d.geography ?? '' }));
  const sysModules = (modulesQuery.data?.data ?? []) as SysModule[];
  const activities = (activitiesQuery.data?.data ?? []) as Activity[];
  const pageLoading = !permissionsLoaded || rolesQuery.isLoading || docTypesQuery.isLoading || modulesQuery.isLoading || activitiesQuery.isLoading;
  const pageError = rolesQuery.error || docTypesQuery.error || modulesQuery.error || activitiesQuery.error;

  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: string) => apiDelete<any>(roleApiPath(roleId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });

  const cloneRoleMutation = useMutation({
    mutationFn: async (role: Role) => {
      const detail = await apiGet<any>(roleApiPath(role.id));
      const src = detail.data;
      const res = await apiPost<any>('/api/admin/roles', {
        name: `${src.name} (copy)`, description: src.description,
        roleCategory: src.roleCategory, color: src.color,
        allowedLevels: src.allowedLevels, defaultDataScope: src.defaultDataScope,
        defaultModules: src.defaultModules,
        documentScope: src.documentScope ?? [],
        docTypeScopes: src.docTypeScopes ?? {},
        activityCodes: (src.roleActivities ?? []).map((ra: any) => ra.activity?.activityCode).filter(Boolean),
        activitySla: src.activitySla ?? [],
      });
      return { res, sourceName: src.name };
    },
    onSuccess: ({ res, sourceName }) => {
      if (res.ok) {
        toast({ title: `Cloned as "${sourceName} (copy)"` });
        queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      } else {
        toast({ title: res.error ?? 'Clone failed', variant: 'destructive' });
      }
    },
    onError: () => {
      toast({ title: 'Network error', variant: 'destructive' });
    },
  });

  async function handleDelete() {
    if (!deletingRole) return;
    try {
      const res = await deleteRoleMutation.mutateAsync(deletingRole.id);
      if (!res.ok) { toast({ title: res.error ?? 'Delete failed', variant: 'destructive' }); return; }
      toast({ title: `"${deletingRole.name}" deleted` });
      setDeletingRole(null);
    } catch { toast({ title: 'Network error', variant: 'destructive' }); }
  }

  const systemRoles = roles.filter((r) => r.isSystemDefault).length;
  const customRoles = roles.length - systemRoles;
  const totalUsers  = roles.reduce((acc, r) => acc + (r._count?.users ?? 0), 0);

  const columns: Column<Role>[] = [
    {
      key: 'name', label: 'Role', width: '280px',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: r.color, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600 }}>
              {r.name}
              {r.isSystemDefault && <AdminStatusBadge status="system" size="sm" />}
            </div>
            {r.description && (
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'roleCategory', label: 'Category', width: '150px',
      render: (r) => <span style={catBadgeStyle(r.roleCategory)}>{catLabel(r.roleCategory)}</span>,
    },
    {
      key: 'scope', label: 'Scope', width: '220px',
      render: (r) => (
        <span title={docScopeSummary(r.documentScope, docTypes)} style={{ display: 'block', fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {docScopeSummary(r.documentScope, docTypes)}
        </span>
      ),
    },
    {
      key: 'allowedLevels', label: 'Levels', width: '80px',
      render: (r) => <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14 }}>{lvlRange(r.allowedLevels)}</span>,
    },
    {
      key: 'activities', label: 'Activities', width: '130px',
      render: (r) => {
        const n = r._count?.roleActivities ?? 0;
        return (
          <div>
            <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14 }}>{n}/{activities.length || 67}</span>
            <ProgressBar value={n} max={activities.length || 67} />
          </div>
        );
      },
    },
    {
      key: 'users', label: 'Users', width: '70px',
      render: (r) => <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14 }}>{r._count?.users ?? 0}</span>,
    },
    {
      key: 'actions', label: 'Actions', width: '110px',
      render: (r) => (
        <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Edit" onClick={() => setEditingRoleId(r.id)}><Pencil size={14} /></IconBtn>
          <IconBtn title="Clone" disabled={cloneRoleMutation.isPending} onClick={() => cloneRoleMutation.mutate(r)}><Copy size={14} /></IconBtn>
          <IconBtn
            title={r.isSystemDefault ? 'System roles cannot be deleted' : 'Delete'}
            disabled={r.isSystemDefault || deleteRoleMutation.isPending}
            danger={!r.isSystemDefault}
            onClick={() => setDeletingRole(r)}
          ><Trash2 size={14} /></IconBtn>
        </div>
      ),
    },
  ];

  if (editingRoleId !== null) {
    return (
      <RoleEditor
        roleId={editingRoleId}
        roles={roles}
        activities={activities}
        docTypes={docTypes}
        sysModules={sysModules}
        onBack={() => setEditingRoleId(null)}
        onSaved={() => { setEditingRoleId(null); }}
      />
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="Roles & Permissions"
        description="Configure roles, activity permissions, and access scoping for your team"
        badge={{ label: 'roles', count: roles.length }}
        actions={<Button size="sm" onClick={() => setEditingRoleId('new')}>Create Role</Button>}
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <StatCard label="System Roles"  value={systemRoles} color="hsl(221 83% 53%)" />
        <StatCard label="Custom Roles"  value={customRoles} color="hsl(173 58% 39%)" />
        <StatCard label="Activities"    value={activities.length} />
        <StatCard label="Total Users"   value={totalUsers} />
      </div>

      {pageError && (
        <div style={{ marginBottom: 12, padding: 12, border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 14 }}>
          Settings permissions data could not be loaded. Check that this role has Roles/View or Admin access, then retry.
          <Button
            type="button"
            variant="outline"
            size="sm"
            style={{ marginLeft: 12 }}
            onClick={() => {
              rolesQuery.refetch();
              docTypesQuery.refetch();
              modulesQuery.refetch();
              activitiesQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      <AdminTable
        columns={columns}
        data={roles}
        keyField="id"
        loading={pageLoading}
        onRowClick={(r) => setEditingRoleId(r.id)}
        searchable
        searchPlaceholder="Search roles…"
        emptyMessage="No roles found"
      />

      <AdminConfirmDialog
        open={!!deletingRole}
        onClose={() => setDeletingRole(null)}
        onConfirm={handleDelete}
        title={`Delete "${deletingRole?.name ?? ''}"`}
        description={`${deletingRole?._count?.users ?? 0} users hold this role and will need to be reassigned. This action cannot be undone.`}
        confirmLabel="Delete role"
        confirmVariant="danger"
        requireTypedConfirmation={deletingRole?.name}
      />
    </div>
  );
}
