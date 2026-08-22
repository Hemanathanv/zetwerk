import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Pencil, ArrowRightLeft, UserX, UserCheck, Search,
  ChevronDown, Loader2, X,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminTable, type Column } from '@/components/admin/AdminTable';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface User {
  id: string; orgId: string; roleId: string; email: string; fullName: string;
  userType: string; status: string; phone?: string; level: string; teamId?: string;
  documentScope?: string[]; docTypeScopes?: Record<string, string[]>;
  dataScope: string; geographyOrigin?: string; geographyDestination?: string;
  approvalLimitInr?: number; approvalLimitUsd?: number; createdAt: string;
  role?: { id: string; name: string; roleCategory: string };
}
interface Role {
  id: string; name: string; roleCategory: string; color: string;
  allowedLevels: string[]; defaultDataScope: string; defaultModules: string[];
  documentScope?: string[]; docTypeScopes?: Record<string, string[]>;
}
interface Org { id: string; name: string; type?: string; }
interface Team { id: string; name: string; orgId: string; }
interface Delegation {
  id: string; delegatorId: string; delegateId: string;
  startDate: string; endDate: string; isActive: boolean;
  scope: string; reason?: string;
  delegator?: { id: string; fullName: string; email: string };
  delegate?: { id: string; fullName: string; email: string };
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const LEVELS = ['L1', 'L2', 'L3', 'L4'];
const LEVEL_NUM: Record<string, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };
const GEO_OPTIONS = ['India', 'US', 'Global'];

const ROLE_CAT_LABELS: Record<string, string> = {
  INTERNAL_OPS: 'Internal Ops', INTERNAL_SPECIALIST: 'Specialist',
  EXTERNAL_PARTNER: 'Partner', CUSTOMER: 'Customer',
  org_internal: 'Internal', org_external: 'External', org_admin: 'Admin', platform: 'Platform',
};

const EMPTY_FORM = {
  fullName: '', email: '', phone: '', roleId: '', level: '',
  dataScope: 'TEAM', teamId: '', geographyOrigin: '', geographyDestination: '',
  orgId: '', overrideApproval: false, approvalLimitInr: '', approvalLimitUsd: '',
  password: '',
};
const EMPTY_DEL = {
  delegateId: '', startDate: '', endDate: '', scope: 'all' as 'all' | 'specific',
  selectedActivities: [] as string[], reason: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarBg(role?: { color?: string }) {
  return role?.color ?? '#0EA5A0';
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function canUseAllScope(level: string) { return LEVEL_NUM[level] >= 3; }
function docScopeSummary(scope: string[] | undefined, docTypes: { typeCode: string; displayName: string }[]) {
  const selected = scope ?? [];
  if (!selected.length) return 'No documents';
  if (selected.length === docTypes.length) return 'All documents';
  const labels = selected.map((code) => docTypes.find((dt) => dt.typeCode === code)?.displayName ?? code);
  return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
}
function docScopeButtonLabel(scope: string[] | undefined, docTypes: { typeCode: string; displayName: string }[]) {
  const selected = scope ?? [];
  if (!selected.length) return 'No documents';
  if (selected.length === docTypes.length) return 'All documents';
  return `${selected.length} documents`;
}
function isInternalUser(user: User, org?: Org) {
  const userType = String(user.userType ?? '').trim().toLowerCase();
  const roleCategory = String(user.role?.roleCategory ?? '').trim().toLowerCase();
  const orgType = String(org?.type ?? '').trim().toLowerCase();
  const orgId = String(user.orgId ?? '').trim();

  if (!orgType || orgType === 'internal' || orgId === 'default-org') return true;
  if (userType === 'external' || userType === 'partner') return false;
  if (roleCategory === 'org_external' || roleCategory === 'external') return false;
  if (orgType === 'external' || orgType === 'partner') return false;
  return true;
}

// ─── Small sub-components ────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, loading = false }: {
  label: string; value: React.ReactNode; sub?: string; color?: string;
  loading?: boolean;
}) {
  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 8, padding: '12px 16px',
      border: '1px solid hsl(var(--border))', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      {loading ? (
        <div className="animate-pulse">
          <div className="h-6 w-10 bg-muted rounded mb-3" />
          <div className="h-3 w-28 bg-muted rounded" />
        </div>
      ) : (
        <>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'hsl(var(--foreground))',
        lineHeight: 1, marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', lineHeight: 1.4 }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

function displayUserName(user: Pick<User, 'fullName' | 'email'>) {
  return String(user.fullName || user.email || 'User').trim() || 'User';
}

function Avatar({ user, role, size = 36 }: { user: User; role?: Role; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2, flexShrink: 0,
      background: avatarBg(role), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, letterSpacing: 0,
    }}>
      {initials(displayUserName(user))}
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  return (
    <span style={{
      fontFamily: 'var(--app-font-sans)', fontSize: 14.5, fontWeight: 600,
      background: 'hsl(var(--muted))', color: 'hsl(var(--foreground))',
      borderRadius: 4, padding: '2px 8px',
    }}>
      {level}
    </span>
  );
}

// ─── Multi-select dropdown ────────────────────────────────────────────────────
function MultiSelect({ options, value, onChange, placeholder }: {
  options: { value: string; label: string }[];
  value: string[]; onChange: (v: string[]) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 14.5,
          border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
          cursor: 'pointer', color: value.length ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
        }}
      >
        <span>{value.length ? `${value.length} selected` : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          marginTop: 4, maxHeight: 220, overflowY: 'auto',
        }}>
          {options.map((opt) => (
            <label key={opt.value} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              cursor: 'pointer', fontSize: 14.5,
            }}>
              <input type="checkbox" checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)} style={{ accentColor: 'hsl(173 58% 39%)' }} />
              {opt.label}
            </label>
          ))}
        </div>
      )}
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function AdminUsersPage({ compact = false, triggerCreate = 0 }: { compact?: boolean; triggerCreate?: number } = {}) {
  const { toast } = useToast();

  // ── Shared config (roles, orgs, teams) ──────────────────────────────────────
  const { roles, organisations: configOrgs, teams: configTeams, docTypes, loading: configLoading, refreshRoles } = useConfig();
  const orgs = configOrgs as Org[];
  const teams = configTeams as Team[];

  // ── Data ────────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [scopeUser, setScopeUser] = useState<User | null>(null);
  const [scopeRole, setScopeRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const pageLoading = loading || configLoading;

  async function fetchAll() {
    setLoading(true);
    setLoadError('');
    const [u, d] = await Promise.allSettled([
      apiGet<any>('/api/admin/users'),
      apiGet<any>('/api/admin/delegations'),
    ]);
    if (u.status === 'fulfilled') {
      setUsers(u.value.data ?? []);
    } else {
      setUsers([]);
      setLoadError(u.reason instanceof Error ? u.reason.message : 'Could not load users.');
    }
    if (d.status === 'fulfilled') {
      setDelegations(d.value.data ?? []);
    } else {
      setDelegations([]);
    }
    setLoading(false);
  }
  useEffect(() => { fetchAll(); }, []);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  const [filterLevels, setFilterLevels] = useState<string[]>([]);
  const [filterOrg, setFilterOrg] = useState('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'inactive' | 'all'>('active');

  // ── Role lookup map ───────────────────────────────────────────────────────────
  const roleMap = useMemo(() => {
    const m: Record<string, Role> = {};
    roles.forEach((r) => { m[r.id] = r; });
    return m;
  }, [roles]);

  const teamMap = useMemo(() => {
    const m: Record<string, Team> = {};
    teams.forEach((t) => { m[t.id] = t; });
    return m;
  }, [teams]);

  const orgMap = useMemo(() => {
    const m: Record<string, Org> = {};
    orgs.forEach((o) => { m[o.id] = o; });
    return m;
  }, [orgs]);

  // Active delegations map: userId → { given?: Delegation; received?: Delegation }
  const delMap = useMemo(() => {
    const m: Record<string, { given?: Delegation; received?: Delegation }> = {};
    delegations.filter((d) => {
      const now = Date.now();
      return d.isActive && new Date(d.startDate).getTime() <= now && new Date(d.endDate).getTime() >= now;
    }).forEach((d) => {
      if (!m[d.delegatorId]) m[d.delegatorId] = {};
      m[d.delegatorId].given = d;
      if (!m[d.delegateId]) m[d.delegateId] = {};
      m[d.delegateId].received = d;
    });
    return m;
  }, [delegations]);

  // ── Filtered users ────────────────────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (filterStatus !== 'all' && u.status !== filterStatus) return false;
      if (q && !u.fullName.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (filterRoles.length && !filterRoles.includes(u.roleId)) return false;
      if (filterLevels.length && !filterLevels.includes(u.level)) return false;
      if (filterOrg && u.orgId !== filterOrg) return false;
      return true;
    });
  }, [users, search, filterRoles, filterLevels, filterOrg, filterStatus]);

  // ── Summary stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active   = users.filter((u) => u.status === 'active');
    const inactive = users.filter((u) => u.status !== 'active');
    const levels: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0 };
    active.forEach((u) => { if (u.level && levels[u.level] !== undefined) levels[u.level]++; });

    const internalUsers = active.filter((u) => isInternalUser(u, orgMap[u.orgId]));
    const partnerUsers  = active.filter((u) => !isInternalUser(u, orgMap[u.orgId]));

    // Derive subtitle: unique role names, first word only, max 3 shown
    function roleSubtitle(list: User[]): string {
      const names = [...new Set(
        list.map((u) => u.role?.name).filter(Boolean) as string[]
      )];
      if (names.length === 0) return '';
      // Abbreviate each name to first word
      const abbr = names.map((n) => n.split(/\s+/)[0]);
      const unique = [...new Set(abbr)];
      if (unique.length <= 3) return unique.join(' + ');
      return unique.slice(0, 3).join(' + ') + ` +${unique.length - 3}`;
    }

    return {
      total: users.length,
      active: active.length,
      inactive: inactive.length,
      levels,
      internal: internalUsers.length,
      partners: partnerUsers.length,
      internalSub: roleSubtitle(internalUsers) || 'Internal users',
      partnersSub:  roleSubtitle(partnerUsers)  || 'External users',
      activeDels: delegations.filter((d) => d.isActive).length,
    };
  }, [users, delegations, delMap, orgMap]);

  // ── Modal state ───────────────────────────────────────────────────────────────
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [delegatingUser, setDelegatingUser] = useState<User | null>(null);
  const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null);

  // ── User form state ───────────────────────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [roleChangeWarning, setRoleChangeWarning] = useState(false);

  const selectedRole = useMemo(() => roleMap[form.roleId], [roleMap, form.roleId]);
  const inheritedLevel = useMemo(() => {
    const levels = selectedRole?.allowedLevels ?? [];
    return levels[0] ?? 'L1';
  }, [selectedRole]);

  function setFormField(field: string, value: any) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onRoleChange(roleId: string) {
    if (modalMode === 'edit' && editingUser?.roleId !== roleId) setRoleChangeWarning(true);
    const role = roleMap[roleId];
    setForm((prev) => ({
      ...prev, roleId,
      dataScope: role?.defaultDataScope ?? 'TEAM',
    }));
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setFormError(''); setRoleChangeWarning(false);
    setEditingUser(null); setModalMode('create');
  }

  useEffect(() => { if (triggerCreate > 0) openCreate(); }, [triggerCreate]);

  function openEdit(user: User) {
    setForm({
      fullName: user.fullName, email: user.email, phone: user.phone ?? '',
      roleId: user.roleId, level: user.level, dataScope: user.dataScope,
      teamId: user.teamId ?? '', geographyOrigin: user.geographyOrigin ?? '',
      geographyDestination: user.geographyDestination ?? '', orgId: user.orgId,
      overrideApproval: !!(user.approvalLimitInr || user.approvalLimitUsd),
      approvalLimitInr: user.approvalLimitInr?.toString() ?? '',
      approvalLimitUsd: user.approvalLimitUsd?.toString() ?? '',
      password: '',
    });
    setFormError(''); setRoleChangeWarning(false);
    setEditingUser(user); setModalMode('edit');
  }

  async function saveUser() {
    if (!form.fullName.trim() || !form.email.trim() || !form.roleId) {
      setFormError('Full name, email, and role are required.');
      return;
    }
    if (modalMode === 'create' && !form.password.trim()) {
      setFormError('Initial password is required.');
      return;
    }
    setSaving(true); setFormError('');
    try {
      const payload: any = {
        fullName: form.fullName, phone: form.phone || null,
        roleId: form.roleId, dataScope: form.dataScope,
        teamId: form.teamId || null, orgId: form.orgId || undefined,
        geographyOrigin: form.geographyOrigin || null,
        geographyDestination: form.geographyDestination || null,
        approvalLimitInr: form.overrideApproval && form.approvalLimitInr ? parseFloat(form.approvalLimitInr) : null,
        approvalLimitUsd: form.overrideApproval && form.approvalLimitUsd ? parseFloat(form.approvalLimitUsd) : null,
      };
      if (form.password.trim()) payload.password = form.password.trim();
      if (modalMode === 'create') {
        payload.email = form.email;
        const res = await apiPost<any>('/api/admin/users', payload);
        if (!res.ok) { setFormError(res.error ?? 'Failed to create user'); setSaving(false); return; }
        toast({ title: 'User created', description: `${form.fullName} has been added.` });
      } else {
        const res = await apiPut<any>(`/api/admin/users/${editingUser!.id}`, payload);
        if (!res.ok) { setFormError(res.error ?? 'Failed to update user'); setSaving(false); return; }
        toast({ title: 'User updated', description: `${form.fullName} has been saved.` });
      }
      setModalMode(null);
      await fetchAll();
      refreshRoles();
    } catch {
      setFormError('Network error. Please try again.');
    }
    setSaving(false);
  }

  // ── Delegation form ───────────────────────────────────────────────────────────
  const [delForm, setDelForm] = useState({ ...EMPTY_DEL });
  const [delSaving, setDelSaving] = useState(false);

  function openDelegate(user: User) {
    setDelForm({ ...EMPTY_DEL });
    setDelegatingUser(user);
  }

  async function saveDelegate() {
    if (!delegatingUser || !delForm.delegateId || !delForm.startDate || !delForm.endDate) return;
    setDelSaving(true);
    try {
      const res = await apiPost<any>(`/api/admin/users/${delegatingUser.id}/delegate`, {
        delegateId: delForm.delegateId, startDate: delForm.startDate,
        endDate: delForm.endDate, scope: delForm.scope, reason: delForm.reason || null,
      });
      if (!res.ok) { toast({ title: 'Failed', description: res.error, variant: 'destructive' }); setDelSaving(false); return; }
      toast({ title: 'Delegation created', description: `Authority delegated successfully.` });
      setDelegatingUser(null); await fetchAll();
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    }
    setDelSaving(false);
  }

  // ── Deactivation ─────────────────────────────────────────────────────────────
  async function confirmDeactivate() {
    if (!deactivatingUser) return;
    try {
      await apiPatch(`/api/admin/users/${deactivatingUser.id}/deactivate`);
      toast({ title: `${deactivatingUser.fullName} deactivated` });
      setDeactivatingUser(null);
      await fetchAll();
      refreshRoles();
    } catch {
      toast({ title: 'Failed', variant: 'destructive' });
    }
  }

  async function activateUser(user: User) {
    try {
      await apiPut(`/api/admin/users/${user.id}`, { status: 'active' });
      toast({ title: `${user.fullName} reactivated` });
      await fetchAll();
      refreshRoles();
    } catch {
      toast({ title: 'Failed', variant: 'destructive' });
    }
  }

  async function revokeDelegate(delegId: string) {
    try {
      await apiDelete(`/api/admin/delegations/${delegId}`);
      toast({ title: 'Delegation revoked' });
      await fetchAll();
    } catch {
      toast({ title: 'Failed', variant: 'destructive' });
    }
  }

  // ── Table columns ─────────────────────────────────────────────────────────────
  const columns: Column<User>[] = [
    {
      key: 'user', label: 'User', width: '260px',
      render: (u) => {
        const role = roleMap[u.roleId];
        const displayName = displayUserName(u);
        const given = delMap[u.id]?.given;
        const received = delMap[u.id]?.received;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar user={u} role={role} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'hsl(var(--foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </div>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {u.email}
              </div>
              {given && (
                <div style={{ fontSize: 14.5, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 6px', display: 'inline-block', marginTop: 2 }}>
                  Delegated → {given.delegate?.fullName} until {fmtDate(given.endDate)}
                </div>
              )}
              {received && !given && (
                <div style={{ fontSize: 14.5, color: '#065f46', background: '#d1fae5', borderRadius: 4, padding: '1px 6px', display: 'inline-block', marginTop: 2 }}>
                  Receiving ← {received.delegator?.fullName} until {fmtDate(received.endDate)}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'role', label: 'Role', width: '160px',
      render: (u) => {
        const role = roleMap[u.roleId];
        if (!role) return <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>—</span>;
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: role.color, flexShrink: 0 }} />
              {role.name}
            </div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
              {ROLE_CAT_LABELS[role.roleCategory] ?? role.roleCategory}
            </div>
          </div>
        );
      },
    },
    { key: 'level', label: 'Level', width: '60px', render: (u) => <LevelBadge level={u.level} /> },
    {
      key: 'team', label: 'Team', width: '140px',
      render: (u) => {
        const t = u.teamId ? teamMap[u.teamId] : null;
        return t
          ? <span style={{ fontSize: 14.5 }}>{t.name}</span>
          : <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>Unassigned</span>;
      },
    },
    {
      key: 'org', label: 'Organisation', width: '160px',
      render: (u) => {
        const org = orgMap[u.orgId];
        return <span style={{ fontSize: 14.5 }}>{org?.name ?? u.orgId.slice(0, 8) + '…'}</span>;
      },
    },
    {
      key: 'documentScope', label: 'Scope', width: '220px',
      render: (u) => {
        const role = roleMap[u.roleId];
        const scope = u.documentScope?.length ? u.documentScope : role?.documentScope;
        const label = docScopeButtonLabel(scope, docTypes);
        const dataScope = u.dataScope === 'ALL' ? 'All data' : u.dataScope === 'TEAM' ? 'Team data' : 'Tagged data';
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setScopeUser(u);
            }}
            title={dataScope}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              maxWidth: 160,
              padding: '4px 9px',
              borderRadius: 6,
              border: '1px solid hsl(var(--border))',
              background: 'hsl(var(--background))',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: 14.5,
              color: 'hsl(173 58% 32%)',
            }}
          >
            {label}
          </button>
        );
      },
    },
    {
      key: 'status', label: 'Status', width: '80px',
      render: (u) => <AdminStatusBadge status={u.status === 'active' ? 'active' : 'inactive'} size="sm" />,
    },
    {
      key: 'actions', label: 'Actions', width: '100px',
      render: (u) => (
        <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button title="Edit" onClick={() => openEdit(u)} style={iconBtn}>
            <Pencil size={14} />
          </button>
          <button title="Delegate" onClick={() => openDelegate(u)} style={iconBtn}>
            <ArrowRightLeft size={14} />
          </button>
          {u.status === 'active' ? (
            <button title="Deactivate" onClick={() => setDeactivatingUser(u)} style={{ ...iconBtn, color: '#dc2626' }}>
              <UserX size={14} />
            </button>
          ) : (
            <button title="Activate" onClick={() => activateUser(u)} style={{ ...iconBtn, color: '#16a34a' }}>
              <UserCheck size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  // ── Delegate dropdown candidates ──────────────────────────────────────────────
  const delegateCandidates = useMemo(() => {
    if (!delegatingUser) return [];
    const delegatorLevelNum = LEVEL_NUM[delegatingUser.level] ?? 1;
    return users.filter((u) =>
      u.id !== delegatingUser.id &&
      u.status === 'active' &&
      (LEVEL_NUM[u.level] ?? 0) >= delegatorLevelNum
    );
  }, [users, delegatingUser]);

  // ── Edit modal: active delegations section ────────────────────────────────────
  const editUserDelegations = useMemo(() => {
    if (!editingUser) return [];
    return delegations.filter((d) =>
      d.isActive && (d.delegatorId === editingUser.id || d.delegateId === editingUser.id)
    );
  }, [delegations, editingUser]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      {!compact && (
        <AdminPageHeader
          title="Users"
          description="Manage users, hierarchy levels, teams, and delegations"
          badge={{ label: 'active users', count: stats.active }}
          actions={<Button size="sm" onClick={openCreate}>Add User</Button>}
        />
      )}

      {loadError && (
        <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 8, border: '1px solid hsl(0 72% 75%)', background: 'hsl(0 72% 96%)', color: 'hsl(0 65% 35%)', fontSize: 14 }}>
          {loadError}
        </div>
      )}

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <StatCard
          label="Total Users"
          value={stats.total}
          loading={pageLoading}
          sub={`${stats.active} active · ${stats.inactive} inactive`}
        />
        <StatCard
          label="By Level"
          loading={pageLoading}
          value={
            <div style={{ display: 'flex', gap: 6, fontSize: 14.5 }}>
              {LEVELS.map((l) => (
                <span key={l} style={{ background: 'hsla(173,58%,39%,0.12)', color: 'hsl(173 58% 39%)', borderRadius: 4, padding: '2px 7px', fontSize: 14, fontWeight: 600 }}>
                  {l}: {stats.levels[l] ?? 0}
                </span>
              ))}
            </div>
          }
        />
        <StatCard label="Internal" value={stats.internal} sub={stats.internalSub} color="hsl(221 83% 53%)" loading={pageLoading} />
        <StatCard label="Partners" value={stats.partners} sub={stats.partnersSub} color="hsl(262 83% 58%)" loading={pageLoading} />
        <StatCard label="Delegations" value={stats.activeDels} sub="active right now" color="hsl(38 92% 50%)" loading={pageLoading} />
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--muted-foreground))', pointerEvents: 'none' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…" style={{ paddingLeft: 28, height: 34, fontSize: 14.5 }} />
        </div>
        <div style={{ flex: '0 0 160px' }}>
          <MultiSelect
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
            value={filterRoles} onChange={setFilterRoles} placeholder="All roles"
          />
        </div>
        <div style={{ flex: '0 0 130px' }}>
          <MultiSelect
            options={LEVELS.map((l) => ({ value: l, label: l }))}
            value={filterLevels} onChange={setFilterLevels} placeholder="All levels"
          />
        </div>
        <div style={{ flex: '0 0 160px' }}>
          <Select value={filterOrg || '__all'} onValueChange={(v) => setFilterOrg(v === '__all' ? '' : v)}>
            <SelectTrigger style={{ height: 34, fontSize: 14.5 }}>
              <SelectValue placeholder="All orgs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All organisations</SelectItem>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div style={{ display: 'flex', gap: 0, border: '1px solid hsl(var(--border))', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {(['active', 'inactive', 'all'] as const).map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{
              padding: '5px 12px', fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer',
              background: filterStatus === s ? 'hsl(173 58% 39%)' : 'hsl(var(--background))',
              color: filterStatus === s ? '#fff' : 'hsl(var(--muted-foreground))',
              textTransform: 'capitalize',
            }}>
              {s}
            </button>
          ))}
        </div>
        {(search || filterRoles.length || filterLevels.length || filterOrg) && (
          <button onClick={() => { setSearch(''); setFilterRoles([]); setFilterLevels([]); setFilterOrg(''); }}
            style={{ ...iconBtn, gap: 4, padding: '5px 10px', fontSize: 14 }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <AdminTable
        columns={columns}
        data={filteredUsers}
        keyField="id"
        loading={pageLoading}
        onRowClick={openEdit}
        emptyMessage="No users match your filters"
        pagination={filteredUsers.length > 20 ? { page: 1, pageSize: 20, total: filteredUsers.length, onPageChange: () => {} } : undefined}
      />

      {scopeUser && (() => {
        const role = roleMap[scopeUser.roleId];
        const scope = scopeUser.documentScope?.length ? scopeUser.documentScope : role?.documentScope ?? [];
        const dataScope = scopeUser.dataScope === 'ALL' ? 'All data' : scopeUser.dataScope === 'TEAM' ? 'Team data' : 'Tagged data';
        return (
          <div
            onClick={() => setScopeUser(null)}
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
                width: 'min(680px, 100%)',
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
                    {scopeUser.fullName} · {role?.name ?? scopeUser.roleId} · {dataScope}
                  </div>
                </div>
                <Button size="sm" onClick={() => setScopeUser(null)}>Done</Button>
              </div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {!scope.length ? (
                  <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 14, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                    No documents selected
                  </div>
                ) : (
                  ['INDIA', 'US', 'GLOBAL'].map((geo) => {
                    const geoTypes = docTypes.filter((dt) => dt.geography === geo && scope.includes(dt.typeCode));
                    if (!geoTypes.length) return null;
                    return (
                      <div key={geo} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>{geo}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 7 }}>
                          {geoTypes.map((dt) => (
                            <div key={dt.id} style={{ padding: '7px 9px', borderRadius: 6, background: 'hsl(var(--muted) / 0.35)', fontSize: 14.5 }}>
                              {dt.displayName}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      {scopeRole && (
        <div
          onClick={() => setScopeRole(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
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
              width: 'min(680px, 100%)',
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
                  {scopeRole.name}
                </div>
              </div>
              <Button size="sm" onClick={() => setScopeRole(null)}>Done</Button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {!(scopeRole.documentScope ?? []).length ? (
                <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 14, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                  No documents selected
                </div>
              ) : (
                ['INDIA', 'US', 'GLOBAL'].map((geo) => {
                  const geoTypes = docTypes.filter((dt) => dt.geography === geo && (scopeRole.documentScope ?? []).includes(dt.typeCode));
                  if (!geoTypes.length) return null;
                  return (
                    <div key={geo} style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>{geo}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 7 }}>
                        {geoTypes.map((dt) => (
                          <div key={dt.id} style={{ padding: '7px 9px', borderRadius: 6, background: 'hsl(var(--muted) / 0.35)', fontSize: 14.5 }}>
                            {dt.displayName}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <AdminModal
        open={modalMode !== null}
        onClose={() => setModalMode(null)}
        title={modalMode === 'create' ? 'Add new user' : `Edit user: ${editingUser?.fullName ?? ''}`}
        description={modalMode === 'create' ? 'Create a user and assign role and team' : editingUser?.email}
        size="lg"
        footer={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {formError && <span style={{ fontSize: 14, color: '#dc2626', flex: 1 }}>{formError}</span>}
            <Button variant="outline" size="sm" onClick={() => setModalMode(null)}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={saveUser}
              style={{ minWidth: 80 }}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Save'}
            </Button>
          </div>
        }
      >
        {roleChangeWarning && (
          <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: '8px 12px', fontSize: 14, color: '#854d0e', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚠️ Changing role will reassign permissions. This takes effect immediately.
            <button onClick={() => setRoleChangeWarning(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#854d0e' }}><X size={14} /></button>
          </div>
        )}

        {/* Section: Identity */}
        <AdminFormSection title="Identity">
          <div style={{ display: 'grid', gap: 12 }}>
            <FieldRow label="Full Name" required>
              <Input value={form.fullName} onChange={(e) => setFormField('fullName', e.target.value)}
                placeholder="Enter full name" style={{ fontSize: 14.5 }} />
            </FieldRow>
            <FieldRow label="Email" required>
              <Input value={form.email} onChange={(e) => setFormField('email', e.target.value)}
                type="email" placeholder="user@company.com"
                readOnly={modalMode === 'edit'}
                style={{ fontSize: 14.5, opacity: modalMode === 'edit' ? 0.6 : 1, background: modalMode === 'edit' ? 'hsl(var(--muted))' : undefined }} />
              {modalMode === 'edit' && <p style={helpText}>Email cannot be changed after creation</p>}
            </FieldRow>
            <FieldRow label="Phone">
              <Input value={form.phone} onChange={(e) => setFormField('phone', e.target.value)}
                placeholder="+91 98765 43210" style={{ fontSize: 14.5 }} />
              <p style={helpText}>Used for WhatsApp escalation notifications</p>
            </FieldRow>
            <FieldRow label={modalMode === 'create' ? 'Password' : 'Reset Password'} required={modalMode === 'create'}>
              <Input value={form.password} onChange={(e) => setFormField('password', e.target.value)}
                type="password" placeholder={modalMode === 'create' ? 'Set initial password' : 'Leave blank to keep current password'} style={{ fontSize: 14.5 }} />
            </FieldRow>
          </div>
        </AdminFormSection>

        {/* Section: Role & Access */}
        <AdminFormSection title="Role & Access">
          <div style={{ display: 'grid', gap: 12 }}>
            <FieldRow label="Role" required>
              <Select value={form.roleId} onValueChange={onRoleChange}>
                <SelectTrigger style={{ fontSize: 14.5 }}>
                  <SelectValue placeholder="Select a role…" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, display: 'inline-block', flexShrink: 0 }} />
                        {r.name}
                        <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                          {ROLE_CAT_LABELS[r.roleCategory] ?? r.roleCategory}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRole && (
                <button
                  type="button"
                  onClick={() => setScopeRole(selectedRole)}
                  style={{ ...iconBtn, width: 'fit-content', gap: 6, padding: '5px 10px', fontSize: 14 }}
                >
                  Scope: {docScopeButtonLabel(selectedRole.documentScope, docTypes)}
                </button>
              )}
            </FieldRow>
            <FieldRow label="Hierarchy Level">
              <div style={{ fontSize: 14.5, padding: '8px 0', color: 'hsl(var(--foreground))' }}>
                {selectedRole ? (
                  <span>{inheritedLevel} <span style={{ color: 'hsl(var(--muted-foreground))' }}>(from {selectedRole.name})</span></span>
                ) : (
                  <span style={{ color: 'hsl(var(--muted-foreground))' }}>Select a role to see level</span>
                )}
              </div>
            </FieldRow>
            <FieldRow label="Data Scope" required>
              <RadioGroup value={form.dataScope} onValueChange={(v) => setFormField('dataScope', v)}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { value: 'ALL', label: 'All', help: 'Sees all shipments in the organisation', needsL3: true },
                  { value: 'TEAM', label: 'Team', help: 'Sees shipments assigned to their team', needsL3: false },
                  { value: 'TAGGED', label: 'Tagged', help: 'Sees only shipments explicitly tagged to them', needsL3: false },
                ].map((opt) => {
                  const disabled = opt.needsL3 && !canUseAllScope(inheritedLevel);
                  return (
                    <div key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, opacity: disabled ? 0.4 : 1 }}>
                      <RadioGroupItem value={opt.value} id={`scope-${opt.value}`} disabled={disabled} style={{ marginTop: 2 }} />
                      <div>
                        <Label htmlFor={`scope-${opt.value}`} style={{ fontSize: 14.5, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                          {opt.label}
                        </Label>
                        <p style={helpText}>{opt.help}</p>
                      </div>
                    </div>
                  );
                })}
              </RadioGroup>
            </FieldRow>
          </div>
        </AdminFormSection>

        {/* Section: Team & Geography */}
        <AdminFormSection title="Team & Geography">
          <div style={{ display: 'grid', gap: 12 }}>
            <FieldRow label="Team">
              <Select value={form.teamId || '__none'} onValueChange={(v) => setFormField('teamId', v === '__none' ? '' : v)}>
                <SelectTrigger style={{ fontSize: 14.5 }}>
                  <SelectValue placeholder="Select team…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FieldRow label="Origin">
                <Select value={form.geographyOrigin || '__none'} onValueChange={(v) => setFormField('geographyOrigin', v === '__none' ? '' : v)}>
                  <SelectTrigger style={{ fontSize: 14.5 }}><SelectValue placeholder="Origin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Any</SelectItem>
                    {GEO_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Destination">
                <Select value={form.geographyDestination || '__none'} onValueChange={(v) => setFormField('geographyDestination', v === '__none' ? '' : v)}>
                  <SelectTrigger style={{ fontSize: 14.5 }}><SelectValue placeholder="Destination" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Any</SelectItem>
                    {GEO_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
            </div>
          </div>
        </AdminFormSection>

        {/* Section: Organisation */}
        <AdminFormSection title="Organisation">
          <FieldRow label="Organisation">
            <Select value={form.orgId || '__none'} onValueChange={(v) => setFormField('orgId', v === '__none' ? '' : v)}>
              <SelectTrigger style={{ fontSize: 14.5 }}><SelectValue placeholder="Select organisation…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None</SelectItem>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}{o.type ? ` (${o.type})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        </AdminFormSection>

        {/* Section: Approval Limits (collapsible) */}
        <AdminFormSection title="Approval Limits" collapsible defaultOpen={false} isLast>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Switch checked={form.overrideApproval} onCheckedChange={(c) => setFormField('overrideApproval', c)} />
            <span style={{ fontSize: 14.5, color: form.overrideApproval ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>
              {form.overrideApproval ? 'Custom limits enabled' : 'Using role defaults'}
            </span>
          </div>
          {form.overrideApproval && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FieldRow label="INR Limit">
                <Input value={form.approvalLimitInr} onChange={(e) => setFormField('approvalLimitInr', e.target.value)}
                  type="number" placeholder="500000" style={{ fontSize: 14.5 }} />
              </FieldRow>
              <FieldRow label="USD Limit">
                <Input value={form.approvalLimitUsd} onChange={(e) => setFormField('approvalLimitUsd', e.target.value)}
                  type="number" placeholder="5000" style={{ fontSize: 14.5 }} />
              </FieldRow>
            </div>
          )}
          <p style={{ ...helpText, marginTop: 8 }}>
            This user can self-approve up to these amounts. Above requires L+1 approval.
          </p>
        </AdminFormSection>

        {/* Edit-mode: member since + active delegations */}
        {modalMode === 'edit' && editingUser && (
          <div style={{ marginTop: 8 }}>
            <p style={{ ...helpText, marginBottom: editUserDelegations.length ? 12 : 0 }}>
              Member since: {fmtDate(editingUser.createdAt)}
            </p>
            {editUserDelegations.length > 0 && (
              <div>
                <div style={{ fontSize: 14.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>
                  Active Delegations
                </div>
                {editUserDelegations.map((d) => {
                  const isGiven = d.delegatorId === editingUser.id;
                  const counterpart = isGiven ? d.delegate : d.delegator;
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid hsl(var(--border))', borderRadius: 6, marginBottom: 6, fontSize: 14 }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{isGiven ? 'Given →' : '← Received'}</span>
                        {' '}{counterpart?.fullName}
                        <span style={{ color: 'hsl(var(--muted-foreground))' }}> · {fmtDate(d.startDate)} – {fmtDate(d.endDate)}</span>
                        {d.reason && <span style={{ color: 'hsl(var(--muted-foreground))' }}> · "{d.reason}"</span>}
                      </div>
                      <button onClick={() => revokeDelegate(d.id)} style={{ ...iconBtn, fontSize: 14.5, padding: '2px 8px', color: '#dc2626' }}>
                        Revoke
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </AdminModal>

      {/* ── Delegation Modal ───────────────────────────────────────────────── */}
      <AdminModal
        open={!!delegatingUser}
        onClose={() => setDelegatingUser(null)}
        title="Delegate authority"
        description={`Temporarily transfer ${delegatingUser?.fullName ?? ''}'s permissions to another user`}
        size="md"
        footer={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setDelegatingUser(null)}>Cancel</Button>
            <Button size="sm" disabled={!delForm.delegateId || !delForm.startDate || !delForm.endDate || delSaving}
              onClick={saveDelegate}>
              {delSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : 'Create delegation'}
            </Button>
          </div>
        }
      >
        {delegatingUser && (
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Delegator info */}
            <div style={{ background: 'hsl(var(--muted) / 0.4)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar user={delegatingUser} role={roleMap[delegatingUser.roleId]} size={32} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{delegatingUser.fullName}</div>
                <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                  {roleMap[delegatingUser.roleId]?.name ?? '—'} · {delegatingUser.level}
                </div>
              </div>
            </div>

            {/* Delegate to */}
            <FieldRow label="Delegate to" required>
              <Select value={delForm.delegateId || '__none'} onValueChange={(v) => setDelForm((p) => ({ ...p, delegateId: v === '__none' ? '' : v }))}>
                <SelectTrigger style={{ fontSize: 14.5 }}><SelectValue placeholder="Select user…" /></SelectTrigger>
                <SelectContent>
                  {delegateCandidates.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName} · {u.level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>

            {/* Period */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FieldRow label="Start date" required>
                <Input type="date" value={delForm.startDate}
                  onChange={(e) => setDelForm((p) => ({ ...p, startDate: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]} style={{ fontSize: 14.5 }} />
              </FieldRow>
              <FieldRow label="End date" required>
                <Input type="date" value={delForm.endDate}
                  onChange={(e) => setDelForm((p) => ({ ...p, endDate: e.target.value }))}
                  min={delForm.startDate || new Date().toISOString().split('T')[0]} style={{ fontSize: 14.5 }} />
              </FieldRow>
            </div>
            <p style={helpText}>Delegation auto-expires on end date</p>

            {/* Scope */}
            <FieldRow label="Scope">
              <RadioGroup value={delForm.scope} onValueChange={(v: any) => setDelForm((p) => ({ ...p, scope: v }))}
                style={{ display: 'flex', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RadioGroupItem value="all" id="del-scope-all" />
                  <Label htmlFor="del-scope-all" style={{ fontSize: 14.5 }}>All activities</Label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RadioGroupItem value="specific" id="del-scope-specific" />
                  <Label htmlFor="del-scope-specific" style={{ fontSize: 14.5 }}>Specific activities</Label>
                </div>
              </RadioGroup>
            </FieldRow>

            {/* Reason */}
            <FieldRow label="Reason">
              <textarea
                value={delForm.reason}
                onChange={(e) => setDelForm((p) => ({ ...p, reason: e.target.value }))}
                placeholder="e.g., Annual leave June 5–12"
                rows={2}
                style={{
                  width: '100%', fontSize: 14.5, borderRadius: 6, padding: '6px 10px',
                  border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
                  color: 'hsl(var(--foreground))', resize: 'vertical', outline: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </FieldRow>
          </div>
        )}
      </AdminModal>

      {/* ── Deactivation Confirm ───────────────────────────────────────────── */}
      <AdminConfirmDialog
        open={!!deactivatingUser}
        onClose={() => setDeactivatingUser(null)}
        onConfirm={confirmDeactivate}
        title={`Deactivate user: ${deactivatingUser?.fullName ?? ''}`}
        description="This user will be logged out and excluded from login. Their historical records (uploads, approvals, audit entries) will be preserved. Open tasks will need to be reassigned."
        confirmLabel="Deactivate"
        confirmVariant="warning"
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: 6, borderRadius: 6, border: 'none', cursor: 'pointer',
  background: 'transparent', color: 'hsl(var(--muted-foreground))',
  transition: 'background 0.1s, color 0.1s',
};

const helpText: React.CSSProperties = {
  fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4, margin: 0,
};

function FieldRow({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))', display: 'block', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}
