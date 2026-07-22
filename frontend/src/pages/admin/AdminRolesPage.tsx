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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';

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

// ─── Constants ────────────────────────────────────────────────────────────────
const LEVELS = ['L1', 'L2', 'L3', 'L4'];

const ACTIVITY_GROUP_ORDER = [
  'document',
  'generation',
  'validation',
  'container_mapping',
  'shipment',
  'inventory',
  'admin',
];

const ACTIVITY_GROUP_LABELS: Record<string, string> = {
  document: 'Document Activities',
  generation: 'Generation Activities',
  validation: 'Validation Activities',
  container_mapping: 'Container Mapping Activities',
  shipment: 'Shipment Activities',
  inventory: 'Inventory Activities',
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
  return { background: c.bg, color: c.color, padding: '2px 8px', borderRadius: 10, fontSize: 14.5, fontWeight: 600 };
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

function docScopeSummary(scope: string[] | undefined, docTypes: DocType[]) {
  const selected = scope ?? [];
  if (!selected.length) return 'No documents';
  if (selected.length === docTypes.length) return 'All documents';
  const labels = selected.map((code) => docTypes.find((dt) => dt.typeCode === code)?.displayName ?? code);
  return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
}

function activityScopeSummary(activity: Activity, selected: string[] | undefined, docTypes: DocType[]) {
  if (activity.scopeType !== 'docType') return activity.scope || '-';
  if (!selected?.length) return activity.scope || 'Doc names';
  return docScopeSummary(selected, docTypes);
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ height: 3, background: 'hsl(var(--muted))', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'hsl(173 58% 39%)', borderRadius: 2 }} />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: 5 }}>
      {children}
    </label>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 10, padding: '12px 16px', border: '1px solid hsl(var(--border))', flex: 1 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>{label}</div>
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
  teams: { id: string; name: string }[];
  onBack: () => void;
  onSaved: () => void;
}

function RoleEditor({ roleId, roles, activities, docTypes, sysModules, teams, onBack, onSaved }: EditorProps) {
  const { toast } = useToast();
  const isNew = roleId === 'new';

  const [roleName, setRoleName]               = useState('');
  const [description, setDescription]         = useState('');
  const [category, setCategory]               = useState('INTERNAL_OPS');
  const [color, setColor]                     = useState('#0EA5A0');
  const [allowedLevels, setAllowedLevels]     = useState<string[]>(['L1']);
  const [dataScope, setDataScope]             = useState('TEAM');
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
  const [saving, setSaving]                   = useState(false);
  const [editorLoading, setEditorLoading]     = useState(!isNew);
  const [liveTeams, setLiveTeams]             = useState<{ id: string; name: string }[]>(teams);
  const [assignedLevelsByActivity, setAssignedLevelsByActivity] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (dataScope !== 'TEAM') return;
    apiGet<any>('/api/admin/teams').then(r => {
      if (Array.isArray(r.data)) setLiveTeams(r.data);
    }).catch(() => {});
  }, [dataScope]);

  useEffect(() => {
    if (isNew) { setEditorLoading(false); return; }
    apiGet<any>(`/api/admin/roles/${roleId}`).then(({ data }: any) => {
      if (!data) return;
      setRoleName(data.name ?? '');
      setDescription(data.description ?? '');
      setCategory(data.roleCategory ?? 'INTERNAL_OPS');
      setColor(data.color ?? '#0EA5A0');
      setAllowedLevels(data.allowedLevels ?? ['L1']);
      setDataScope(data.defaultDataScope ?? 'TEAM');
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
      setEditorLoading(false);
    });
  }, [roleId, isNew]);

  useEffect(() => {
    let cancelled = false;
    const roleIds = roles
      .map((role) => role.id)
      .filter((id) => id && (isNew || id !== roleId));
    if (!roleIds.length) {
      setAssignedLevelsByActivity({});
      return;
    }

    Promise.all(
      roleIds.map((id) => apiGet<any>(`/api/admin/roles/${id}`).catch(() => null))
    ).then((responses) => {
      if (cancelled) return;
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
    });

    return () => { cancelled = true; };
  }, [roles, roleId, isNew]);

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
    const known = ACTIVITY_GROUP_ORDER.filter((code) => grouped[code]);
    const extra = Object.keys(grouped).filter((code) => !known.includes(code)).sort();
    return [...known, ...extra];
  }, [grouped]);

  const selectedCount = useMemo(() => {
    let n = 0; activities.forEach((a) => { if (selectedActs.has(a.activityCode)) n++; }); return n;
  }, [activities, selectedActs]);

  function toggleModule(code: string) {
    setEnabledModules((p) => p.includes(code) ? p.filter((m) => m !== code) : [...p, code]);
  }
  function toggleActivity(code: string) {
    setSelectedActs((p) => { const n = new Set(p); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }
  function toggleGroupAll(cat: string, catActs: Activity[]) {
    const codes = catActs.map((a) => a.activityCode);
    const allSel = codes.every((c) => selectedActs.has(c));
    setSelectedActs((p) => { const n = new Set(p); allSel ? codes.forEach((c) => n.delete(c)) : codes.forEach((c) => n.add(c)); return n; });
  }
  function toggleLevel(l: string) {
    setAllowedLevels((p) => p.includes(l) ? p.filter((x) => x !== l) : [...p, l]);
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
    if (!roleName.trim()) { toast({ title: 'Role name is required', variant: 'destructive' }); return; }
    if (!allowedLevels.length) { toast({ title: 'Select at least one level', variant: 'destructive' }); return; }
    if (!enabledModules.length) { toast({ title: 'Enable at least one module', variant: 'destructive' }); return; }
    const selectedDocScoped = activities.filter((act) => selectedActs.has(act.activityCode) && act.scopeType === 'docType');
    const missingDocScope = selectedDocScoped.find((act) => !(docTypeScopes[act.activityCode] ?? []).length);
    if (missingDocScope) {
      toast({ title: `Select documents for ${missingDocScope.name}`, variant: 'destructive' });
      return;
    }
    const derivedDocumentScope = [...new Set(Object.values(docTypeScopes).flat())].sort();
    setSaving(true);
    try {
      const payload = {
        name: roleName.trim(), description: description || null, roleCategory: category,
        color, allowedLevels, defaultDataScope: dataScope, defaultModules: enabledModules,
        documentScope: derivedDocumentScope,
        docTypeScopes,
        activityCodes: Array.from(selectedActs),
      };
      const res = isNew
        ? await apiPost<any>('/api/admin/roles', payload)
        : await apiPut<any>(`/api/admin/roles/${roleId}`, payload);
      if (!res.ok) { toast({ title: res.error ?? 'Save failed', variant: 'destructive' }); setSaving(false); return; }
      toast({ title: `Role ${isNew ? 'created' : 'saved'}` });
      onSaved();
    } catch { toast({ title: 'Network error', variant: 'destructive' }); }
    setSaving(false);
  }

  if (editorLoading) {
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
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          {selectedCount}/{activities.length} activities
        </span>
        <Button variant="outline" size="sm" onClick={onBack}>Cancel</Button>
        <Button size="sm" disabled={saving} onClick={handleSave} style={{ minWidth: 110 }}>
          {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />Saving…</> : 'Save changes'}
        </Button>
      </div>

      {isSystem && (
        <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde047', padding: '8px 32px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#92400e' }}>
          <AlertTriangle size={14} />
          System role — changes apply to all {userCount} users holding this role immediately.
        </div>
      )}

      {/* Body */}
      <div style={{ display: 'flex', gap: 20, padding: '24px 32px', alignItems: 'flex-start' }}>

        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <div style={{ width: 296, flexShrink: 0, position: 'sticky', top: 36, alignSelf: 'flex-start' }}>
          <div style={{ background: 'hsl(var(--card))', borderRadius: 12, border: '1px solid hsl(var(--border))', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

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
                  fontFamily: '"JetBrains Mono", monospace', fontSize: 14,
                  padding: '6px 10px', borderRadius: 6,
                  background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
                  border: '1px solid hsl(var(--border))',
                }}>
                  {systemCode}
                </div>
              </div>
            )}

            <div>
              <FieldLabel>Category</FieldLabel>
              <Select value={category} onValueChange={setCategory} disabled={isSystem}>
                <SelectTrigger style={{ fontSize: 14.5 }}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_CAT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: o.color, display: 'inline-block', flexShrink: 0 }} />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <FieldLabel>Color</FieldLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SWATCHES.map((s) => (
                  <button key={s} onClick={() => setColor(s)}
                    style={{
                      width: 22, height: 22, borderRadius: 11, background: s, border: 'none',
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
              <div style={{ display: 'flex', gap: 10 }}>
                {LEVELS.map((l) => (
                  <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 14.5 }}>
                    <input type="checkbox" checked={allowedLevels.includes(l)} onChange={() => toggleLevel(l)}
                      style={{ accentColor: 'hsl(173 58% 39%)' }} />
                    {l}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>Default data scope</FieldLabel>
              <RadioGroup value={dataScope} onValueChange={setDataScope} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { value: 'ALL',    label: 'All',    help: 'Sees all org data' },
                  { value: 'TEAM',   label: 'Team',   help: 'Sees team shipments' },
                  { value: 'TAGGED', label: 'Tagged', help: 'Only assigned shipments' },
                ].map((o) => (
                  <div key={o.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <RadioGroupItem value={o.value} id={`scope-${o.value}`} style={{ marginTop: 2 }} />
                    <div>
                      <Label htmlFor={`scope-${o.value}`} style={{ fontSize: 14.5, fontWeight: 500, cursor: 'pointer' }}>{o.label}</Label>
                      <p style={{ margin: 0, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{o.help}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>

              {dataScope === 'TEAM' && (
                <div style={{ marginTop: 8, background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--border))', borderRadius: 7, padding: '10px 12px' }}>
                  <p style={{ margin: '0 0 6px', fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>Teams in this org</p>
                  {liveTeams.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>No teams configured yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {liveTeams.map((t) => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 3, background: 'hsl(var(--primary))', flexShrink: 0 }} />
                          <span style={{ fontSize: 14, color: 'hsl(var(--foreground))' }}>{t.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: '8px 0 0', fontSize: 14, color: 'hsl(var(--muted-foreground))', lineHeight: 1.4 }}>
                    Users with this role see only their assigned team's shipments. Assign teams to individual users in User Management.
                  </p>
                </div>
              )}
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
              <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontFamily: '"JetBrains Mono", monospace' }}>
                {selectedCount}/{activities.length} activities · {lvlRange(allowedLevels)} · {dataScope.toLowerCase()}
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
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

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
          <AdminFormSection title="Activity Permissions" defaultOpen isLast>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {groupOrder.map((groupCode) => {
                const groupActs = grouped[groupCode] ?? [];
                const enabledActs = groupActs.filter((act) => isModuleEnabled(activityModule(act), enabledModules));
                const selCount = groupActs.filter((a) => selectedActs.has(a.activityCode)).length;
                const isExpanded = expandedGroups.has(groupCode);
                const groupEnabled = enabledActs.length > 0;
                const allSel = enabledActs.length > 0 && enabledActs.every((a) => selectedActs.has(a.activityCode));
                const someSel = selCount > 0 && !allSel;

                return (
                  <div key={groupCode} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, overflow: 'hidden', opacity: groupEnabled ? 1 : 0.45 }}>
                    {/* Group header */}
                    <div
                      onClick={() => {
                        if (!groupEnabled) return;
                        setExpandedGroups((p) => { const n = new Set(p); n.has(groupCode) ? n.delete(groupCode) : n.add(groupCode); return n; });
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: groupEnabled ? 'pointer' : 'default', background: 'hsl(var(--muted) / 0.3)', userSelect: 'none' }}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <input type="checkbox" checked={allSel}
                        ref={(el) => { if (el) el.indeterminate = someSel; }}
                        disabled={!groupEnabled}
                        onChange={(e) => { e.stopPropagation(); toggleGroupAll(groupCode, enabledActs); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ accentColor: 'hsl(173 58% 39%)', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{groupLabel(groupCode, groupActs)}</span>
                      <span style={{
                        fontSize: 14.5, fontFamily: '"JetBrains Mono", monospace', padding: '2px 8px', borderRadius: 10,
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
                        gridTemplateColumns: '20px minmax(68px, 86px) minmax(220px, 1fr) minmax(140px, 190px) minmax(78px, max-content)',
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
                        <span>Code</span>
                        <span>Activity</span>
                        <span>Scope</span>
                        <span style={{ textAlign: 'right' }}>Level</span>
                      </div>
                    )}
                    {isExpanded && groupActs.map((act) => {
                      const isSel = selectedActs.has(act.activityCode);
                      const rowEnabled = isModuleEnabled(activityModule(act), enabledModules);
                      const levels = activityLevels(act);
                      const scopedDocs = docTypeScopes[act.activityCode] ?? [];
                      const isScopeOpen = openScope === act.activityCode;

                      return (
                        <div key={act.id}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '20px minmax(68px, 86px) minmax(220px, 1fr) minmax(140px, 190px) minmax(78px, max-content)',
                            alignItems: 'center',
                            gap: 12,
                            padding: '7px 14px', borderTop: '1px solid hsl(var(--border))',
                            background: isSel ? 'hsl(173 58% 39% / 0.04)' : undefined,
                          }}>
                            <input type="checkbox" checked={isSel} disabled={!rowEnabled}
                              onChange={() => toggleActivity(act.activityCode)}
                              style={{ accentColor: 'hsl(173 58% 39%)', flexShrink: 0 }} />
                            <span style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: 13.5,
                              color: 'hsl(var(--muted-foreground))',
                              whiteSpace: 'nowrap',
                              lineHeight: 1.25,
                              minWidth: 0,
                            }}>
                              {act.displayCode ?? act.activityCode}
                            </span>
                            <span style={{ fontSize: 14.5, minWidth: 0, lineHeight: 1.3 }}>
                              <span>{act.name}</span>
                              {act.status && (
                                <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12.5, marginLeft: 8 }}>
                                  {act.status}
                                </span>
                              )}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              {act.scopeType === 'docType' ? (
                                <button
                                  type="button"
                                  disabled={!rowEnabled}
                                  onClick={() => {
                                    if (!selectedActs.has(act.activityCode)) toggleActivity(act.activityCode);
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
                                    cursor: rowEnabled ? 'pointer' : 'not-allowed',
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
                                  fontFamily: '"JetBrains Mono", monospace',
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
                                  <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px', fontFamily: '"JetBrains Mono", monospace' }}>
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
        </div>
      </div>
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
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const { roles, docTypes: configDocTypes, modules: sysModules, teams: configTeams, refreshRoles } = useConfig();
  const docTypes = configDocTypes.map(d => ({ ...d, geography: d.geography ?? '' }));
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]       = useState(true);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [deleting, setDeleting]     = useState(false);

  useEffect(() => {
    apiGet<any>('/api/admin/activities').then(a => {
      setActivities(a.data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleDelete() {
    if (!deletingRole) return;
    setDeleting(true);
    try {
      const res = await apiDelete<any>(`/api/admin/roles/${deletingRole.id}`);
      if (!res.ok) { toast({ title: res.error ?? 'Delete failed', variant: 'destructive' }); return; }
      toast({ title: `"${deletingRole.name}" deleted` });
      setDeletingRole(null);
      refreshRoles();
    } catch { toast({ title: 'Network error', variant: 'destructive' }); }
    setDeleting(false);
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
      render: (r) => <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14 }}>{lvlRange(r.allowedLevels)}</span>,
    },
    {
      key: 'activities', label: 'Activities', width: '130px',
      render: (r) => {
        const n = r._count?.roleActivities ?? 0;
        return (
          <div>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14 }}>{n}/{activities.length || 67}</span>
            <ProgressBar value={n} max={activities.length || 67} />
          </div>
        );
      },
    },
    {
      key: 'users', label: 'Users', width: '70px',
      render: (r) => <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14 }}>{r._count?.users ?? 0}</span>,
    },
    {
      key: 'actions', label: 'Actions', width: '110px',
      render: (r) => (
        <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Edit" onClick={() => setEditingRoleId(r.id)}><Pencil size={14} /></IconBtn>
          <IconBtn title="Clone" onClick={async () => {
            try {
              const detail = await apiGet<any>(`/api/admin/roles/${r.id}`);
              const src = detail.data;
              const res = await apiPost<any>('/api/admin/roles', {
                name: `${src.name} (copy)`, description: src.description,
                roleCategory: src.roleCategory, color: src.color,
                allowedLevels: src.allowedLevels, defaultDataScope: src.defaultDataScope,
                defaultModules: src.defaultModules,
                documentScope: src.documentScope ?? [],
                docTypeScopes: src.docTypeScopes ?? {},
                activityCodes: (src.roleActivities ?? []).map((ra: any) => ra.activity?.activityCode).filter(Boolean),
              });
              if (res.ok) { toast({ title: `Cloned as "${src.name} (copy)"` }); refreshRoles(); }
              else toast({ title: res.error ?? 'Clone failed', variant: 'destructive' });
            } catch { toast({ title: 'Network error', variant: 'destructive' }); }
          }}><Copy size={14} /></IconBtn>
          <IconBtn
            title={r.isSystemDefault ? 'System roles cannot be deleted' : 'Delete'}
            disabled={r.isSystemDefault}
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
        teams={configTeams}
        onBack={() => setEditingRoleId(null)}
        onSaved={() => { setEditingRoleId(null); refreshRoles(); }}
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

      <AdminTable
        columns={columns}
        data={roles}
        keyField="id"
        loading={loading}
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
