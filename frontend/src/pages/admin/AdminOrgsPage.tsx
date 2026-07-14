import { useState, useEffect, useMemo } from 'react';
import {
  Building2, Pencil, Tags, Power, Plus, X,
  Tag, ExternalLink,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminTable, Column } from '@/components/admin/AdminTable';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { AdminSectionTabs } from '@/components/admin/AdminSectionTabs';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useConfig } from '@/contexts/ConfigContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type MainOrg = {
  id: string; name: string; slug: string; isActive: boolean;
  createdAt: string; _count: { users: number }; _isMain: true;
};
type Partner = {
  id: string; companyName: string; partnerType: string;
  contactName: string | null; contactEmail: string; contactPhone: string | null;
  allowedDocTypes: string[]; autoTagRules: AutoTagRule[] | null;
  autoTagEnabled: boolean; isActive: boolean; createdAt: string;
  _count: { shipmentTags: number }; _isMain: false;
};
type OrgRow = MainOrg | Partner;
type DocType = {
  id: string; typeCode: string; shortCode: string; displayName: string; geography: string | null;
};
type PartnerType = {
  id: string; typeCode: string; displayName: string; defaultAllowedDocTypes: string[];
};
type AutoTagRule = { field: string; operator: string; value: string };
type TagRecord = {
  id: string; taggedAt: string; tagSource: string;
  shipment: { shipmentNumber: string; vesselName: string | null; status: string };
};
type UntaggedShipment = {
  id: string; shipmentNumber: string; vesselName: string | null; status: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const GEO_LABELS: Record<string, string> = {
  INDIA: 'India Documents',
  US: 'US Documents',
  GLOBAL: 'Global Documents',
};
const TAG_FIELDS = [
  'Port of Loading', 'Port of Discharge', 'Exporter Name', 'Destination', 'Corridor',
];
const TAG_OPERATORS = ['equals', 'contains', 'starts with'];

const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  cha:               { bg: '#ede9fe', text: '#6d28d9', label: 'CHA' },
  freight_forwarder: { bg: '#e0e7ff', text: '#3730a3', label: 'Freight Forwarder' },
  customs_broker:    { bg: '#fce7f3', text: '#9d174d', label: 'Customs Broker' },
  tpl:               { bg: '#fef3c7', text: '#92400e', label: '3PL' },
  customer:          { bg: '#dcfce7', text: '#166534', label: 'Customer' },
  __main:            { bg: '#dbeafe', text: '#1e40af', label: 'Main Org' },
};

const MONO = '"JetBrains Mono", "Fira Code", monospace';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TypeBadge({ typeCode }: { typeCode: string }) {
  const cfg = TYPE_BADGE[typeCode] ?? TYPE_BADGE.__main;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 10px', borderRadius: 99,
      fontSize: 14, fontWeight: 600,
      background: cfg.bg, color: cfg.text,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div style={{
      flex: 1, padding: '16px 20px', borderRadius: 10,
      border: '1px solid hsl(var(--border))',
      background: 'hsl(var(--card))',
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: MONO, color: 'hsl(var(--foreground))' }}>
        {value}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 500, color: 'hsl(var(--foreground))', marginTop: 2 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

function defaultForm() {
  return {
    companyName: '',
    partnerType: '',
    isActive: true,
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    allowedDocTypes: [] as string[],
    autoTagRules: [] as AutoTagRule[],
  };
}

// ─── Micro-styles ─────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600,
  color: 'hsl(var(--muted-foreground))',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  display: 'block', marginBottom: 6,
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
  color: 'hsl(var(--muted-foreground))',
  background: 'transparent',
  border: '1px solid hsl(var(--border))',
};

const linkBtnStyle: React.CSSProperties = {
  fontSize: 14, color: 'hsl(173 58% 39%)',
  cursor: 'pointer', background: 'transparent',
  border: 'none', padding: 0, fontWeight: 500,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminOrgsPage() {
  const { toast } = useToast();

  // ── Shared config ──────────────────────────────────────────────────────────
  const { docTypes, partnerTypes, refreshOrganisations } = useConfig();

  // ── Data state ─────────────────────────────────────────────────────────────
  const [mainOrgs, setMainOrgs]         = useState<MainOrg[]>([]);
  const [partners, setPartners]         = useState<Partner[]>([]);
  const [loading, setLoading]           = useState(true);

  // ── Modal state ────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen]   = useState(false);
  const [modalMode, setModalMode]   = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<Partner | null>(null);
  const [activeTab, setActiveTab]   = useState('details');
  const [form, setForm]             = useState(defaultForm());
  const [saving, setSaving]         = useState(false);

  // ── Tag sheet state ────────────────────────────────────────────────────────
  const [tagSheetOpen, setTagSheetOpen]   = useState(false);
  const [tagTarget, setTagTarget]         = useState<Partner | null>(null);
  const [tags, setTags]                   = useState<TagRecord[]>([]);
  const [tagsLoading, setTagsLoading]     = useState(false);
  const [untaggedShips, setUntaggedShips] = useState<UntaggedShipment[]>([]);
  const [addTagShipId, setAddTagShipId]   = useState('');
  const [addingTag, setAddingTag]         = useState(false);
  const [removeTagId, setRemoveTagId]     = useState<string | null>(null);

  // ── Edit main org state ────────────────────────────────────────────────────
  const [viewOrg, setViewOrg]         = useState<MainOrg | null>(null);
  const [editOrgForm, setEditOrgForm] = useState<{ name: string; isActive: boolean }>({ name: '', isActive: true });
  const [editOrgSaving, setEditOrgSaving] = useState(false);

  // ── Deactivate state ───────────────────────────────────────────────────────
  const [deactivateOpen, setDeactivateOpen]     = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Partner | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function fetchAll() {
    setLoading(true);
    try {
      const [orgsRes, partnersRes] = await Promise.all([
        apiGet<any>('/api/admin/organisations'),
        apiGet<any>('/api/admin/partners'),
      ]);
      setMainOrgs((orgsRes.data ?? []).map((o: any) => ({ ...o, _isMain: true as const })));
      setPartners((partnersRes.data ?? []).map((p: any) => ({ ...p, _isMain: false as const })));
    } catch { /* silent */ }
    setLoading(false);
  }

  useEffect(() => { fetchAll(); }, []);

  // ── Computed ───────────────────────────────────────────────────────────────
  const allRows: OrgRow[] = useMemo(
    () => [
      ...mainOrgs.map((o) => ({ ...o, _isMain: true as const })),
      ...partners.map((p) => ({ ...p, _isMain: false as const })),
    ],
    [mainOrgs, partners],
  );

  const totalUsers = mainOrgs.reduce((s, o) => s + (o._count?.users ?? 0), 0);
  const totalTags  = partners.reduce((s, p) => s + (p._count?.shipmentTags ?? 0), 0);

  const docTypeGroups = useMemo(() => {
    const groups: Record<string, DocType[]> = {};
    for (const dt of docTypes) {
      const key = dt.geography ?? 'OTHER';
      if (!groups[key]) groups[key] = [];
      groups[key].push(dt);
    }
    return groups;
  }, [docTypes]);

  // ── Modal helpers ──────────────────────────────────────────────────────────
  function openCreate() {
    setModalMode('create');
    setEditTarget(null);
    setForm(defaultForm());
    setActiveTab('details');
    setModalOpen(true);
  }

  function openEdit(p: Partner) {
    setModalMode('edit');
    setEditTarget(p);
    setForm({
      companyName: p.companyName,
      partnerType: p.partnerType,
      isActive: p.isActive,
      contactName: p.contactName ?? '',
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone ?? '',
      allowedDocTypes: p.allowedDocTypes ?? [],
      autoTagRules: (p.autoTagRules as AutoTagRule[]) ?? [],
    });
    setActiveTab('details');
    setModalOpen(true);
  }

  function handleTypeChange(typeCode: string) {
    const pt = partnerTypes.find((t) => t.typeCode === typeCode);
    setForm((f) => ({
      ...f,
      partnerType: typeCode,
      allowedDocTypes: pt?.defaultAllowedDocTypes ?? [],
    }));
  }

  function toggleDocType(code: string) {
    setForm((f) => ({
      ...f,
      allowedDocTypes: f.allowedDocTypes.includes(code)
        ? f.allowedDocTypes.filter((c) => c !== code)
        : [...f.allowedDocTypes, code],
    }));
  }

  function addRule() {
    setForm((f) => ({
      ...f,
      autoTagRules: [
        ...f.autoTagRules,
        { field: TAG_FIELDS[0], operator: TAG_OPERATORS[0], value: '' },
      ],
    }));
  }

  function updateRule(i: number, patch: Partial<AutoTagRule>) {
    setForm((f) => {
      const rules = [...f.autoTagRules];
      rules[i] = { ...rules[i], ...patch };
      return { ...f, autoTagRules: rules };
    });
  }

  function removeRule(i: number) {
    setForm((f) => ({ ...f, autoTagRules: f.autoTagRules.filter((_, j) => j !== i) }));
  }

  async function handleSave() {
    if (!form.companyName.trim() || (modalMode === 'create' && !form.partnerType)) return;
    setSaving(true);
    try {
      const payload = {
        companyName: form.companyName.trim(),
        contactName: form.contactName || null,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone || null,
        allowedDocTypes: form.allowedDocTypes,
        autoTagRules: form.autoTagRules.length > 0 ? form.autoTagRules : null,
        autoTagEnabled: form.autoTagRules.length > 0,
        isActive: form.isActive,
      };
      if (modalMode === 'create') {
        await apiPost<any>('/api/admin/partners', { ...payload, partnerType: form.partnerType });
        toast({ title: 'Partner saved', description: `${form.companyName} has been added.` });
      } else {
        await apiPut<any>(`/api/admin/partners/${editTarget!.id}`, payload);
        toast({ title: 'Organisation updated', description: `${form.companyName} has been saved.` });
      }
      await fetchAll();
      refreshOrganisations();
      setModalOpen(false);
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
  }

  // ── Tag sheet helpers ──────────────────────────────────────────────────────
  async function openTagSheet(p: Partner) {
    setTagTarget(p);
    setTagSheetOpen(true);
    setAddTagShipId('');
    setRemoveTagId(null);
    setTagsLoading(true);
    try {
      const [tagsRes, shipsRes] = await Promise.all([
        apiGet<any>(`/api/admin/partners/${p.id}/tags`),
        apiGet<any>(`/api/admin/partners/${p.id}/untagged-shipments`),
      ]);
      setTags(tagsRes.data ?? []);
      setUntaggedShips(shipsRes.data ?? []);
    } catch { /* silent */ }
    setTagsLoading(false);
  }

  async function handleAddTag() {
    if (!addTagShipId || !tagTarget) return;
    setAddingTag(true);
    try {
      await apiPost<any>(`/api/admin/partners/${tagTarget.id}/tags`, { shipmentId: addTagShipId });
      toast({ title: 'Shipment tagged' });
      const [tagsRes, shipsRes] = await Promise.all([
        apiGet<any>(`/api/admin/partners/${tagTarget.id}/tags`),
        apiGet<any>(`/api/admin/partners/${tagTarget.id}/untagged-shipments`),
      ]);
      setTags(tagsRes.data ?? []);
      setUntaggedShips(shipsRes.data ?? []);
      setAddTagShipId('');
      fetchAll();
    } catch {
      toast({ title: 'Failed to add tag', variant: 'destructive' });
    }
    setAddingTag(false);
  }

  async function handleRemoveTag(tagId: string) {
    if (!tagTarget) return;
    try {
      await apiDelete<any>(`/api/admin/partners/${tagTarget.id}/tags/${tagId}`);
      setTags((prev) => prev.filter((t) => t.id !== tagId));
      setRemoveTagId(null);
      fetchAll();
    } catch {
      toast({ title: 'Failed to remove tag', variant: 'destructive' });
    }
  }

  // ── Deactivate ─────────────────────────────────────────────────────────────
  async function handleDeactivate() {
    if (!deactivateTarget) return;
    try {
      await apiPut<any>(`/api/admin/partners/${deactivateTarget.id}`, { isActive: false });
      toast({ title: 'Partner deactivated' });
      await fetchAll();
    } catch {
      toast({ title: 'Failed to deactivate', variant: 'destructive' });
    }
    setDeactivateOpen(false);
    setDeactivateTarget(null);
  }

  // ── Main org edit helpers ──────────────────────────────────────────────────
  function openEditOrg(org: MainOrg) {
    setEditOrgForm({ name: org.name, isActive: org.isActive });
    setViewOrg(org);
  }

  async function handleSaveOrg() {
    if (!viewOrg || !editOrgForm.name.trim()) return;
    setEditOrgSaving(true);
    try {
      await apiPut<any>(`/api/admin/organisations/${viewOrg.id}`, {
        name: editOrgForm.name.trim(),
        isActive: editOrgForm.isActive,
      });
      toast({ title: 'Organisation updated', description: `${editOrgForm.name.trim()} has been saved.` });
      await fetchAll();
      refreshOrganisations();
      setViewOrg(null);
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
    setEditOrgSaving(false);
  }

  // ── Auto-tag preview text ──────────────────────────────────────────────────
  function autoTagPreview(rules: AutoTagRule[]): string {
    const filled = rules.filter((r) => r.value.trim());
    if (filled.length === 0) return '';
    return filled.map((r) => `${r.field} ${r.operator} '${r.value}'`).join(' AND ');
  }

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns: Column<OrgRow>[] = [
    {
      key: 'name',
      label: 'Organisation',
      width: '260px',
      render: (row) => {
        const name = row._isMain ? row.name : (row as Partner).companyName;
        const email = !row._isMain ? (row as Partner).contactEmail : '';
        const typeKey = row._isMain ? '__main' : (row as Partner).partnerType;
        const cfg = TYPE_BADGE[typeKey] ?? TYPE_BADGE.__main;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: cfg.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Building2 size={15} color={cfg.text} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'hsl(var(--foreground))' }}>
                {name}
              </div>
              {email && (
                <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{email}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '160px',
      render: (row) => (
        <TypeBadge typeCode={row._isMain ? '__main' : (row as Partner).partnerType} />
      ),
    },
    {
      key: 'allowedDocs',
      label: 'Allowed Docs',
      width: '180px',
      render: (row) => {
        if (row._isMain) {
          return (
            <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
              All document types
            </span>
          );
        }
        const codes = (row as Partner).allowedDocTypes ?? [];
        if (codes.length === 0) {
          return <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>—</span>;
        }
        const shown = codes.slice(0, 3);
        const extra = codes.length - 3;
        return (
          <span style={{ fontSize: 14.5, fontFamily: MONO }}>
            {shown.join(', ')}
            {extra > 0 && (
              <span style={{ color: 'hsl(var(--muted-foreground))' }}> +{extra} more</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'users',
      label: 'Users',
      width: '60px',
      render: (row) => (
        <span style={{ fontFamily: MONO, fontSize: 14.5 }}>
          {(row._count as any)?.users ?? 0}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '80px',
      render: (row) => <AdminStatusBadge status={row.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      width: '120px',
      render: (row) => (
        <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {row._isMain && (
            <button
              onClick={() => openEditOrg(row as MainOrg)}
              style={actionBtnStyle}
              title="Edit organisation"
            >
              <Pencil size={13} />
            </button>
          )}
          {!row._isMain && (
            <button
              onClick={() => openEdit(row as Partner)}
              style={actionBtnStyle}
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}
          {!row._isMain && (
            <button
              onClick={() => openTagSheet(row as Partner)}
              style={actionBtnStyle}
              title="Manage Tags"
            >
              <Tags size={13} />
            </button>
          )}
          {!row._isMain && (row as Partner).isActive && (
            <button
              onClick={() => {
                setDeactivateTarget(row as Partner);
                setDeactivateOpen(true);
              }}
              style={{ ...actionBtnStyle, color: '#dc2626' }}
              title="Deactivate"
            >
              <Power size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const saveDisabled =
    !form.companyName.trim() || (modalMode === 'create' && !form.partnerType) || saving;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <AdminPageHeader
        title="Organisations & Partners"
        description="Manage partner organisations, document access, and shipment tagging"
        badge={{ label: 'organisations', count: allRows.length }}
        actions={
          <Button
            size="sm"
            onClick={openCreate}
            style={{ background: 'hsl(173 58% 39%)', color: '#fff' }}
          >
            <Plus size={14} style={{ marginRight: 4 }} />
            Add Partner
          </Button>
        }
      />

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
        <StatCard label="Your organisation" value={mainOrgs.length} sub={mainOrgs[0]?.name} />
        <StatCard label="Partner organisations" value={partners.length} sub="Active partners" />
        <StatCard label="Total users" value={totalUsers} />
        <StatCard label="Active shipment tags" value={totalTags} sub="Across all partners" />
      </div>

      {/* Table */}
      <AdminTable
        columns={columns}
        data={allRows}
        keyField="id"
        searchable
        searchPlaceholder="Search organisations..."
        loading={loading}
        onRowClick={(row) => {
          if (row._isMain) openEditOrg(row as MainOrg);
          else openEdit(row as Partner);
        }}
        emptyMessage="No organisations found"
      />

      {/* ── Edit Main Org Modal ─────────────────────────────────────────────── */}
      <AdminModal
        open={!!viewOrg}
        onClose={() => setViewOrg(null)}
        title={`Edit: ${viewOrg?.name ?? ''}`}
        description="Update this organisation's name and status."
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
            <Button variant="outline" size="sm" onClick={() => setViewOrg(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!editOrgForm.name.trim() || editOrgSaving}
              onClick={handleSaveOrg}
              style={{ background: 'hsl(173 58% 39%)', color: '#fff', opacity: (!editOrgForm.name.trim() || editOrgSaving) ? 0.5 : 1 }}
            >
              {editOrgSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        }
      >
        {viewOrg && (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Org icon + slug (read-only identifiers) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={20} color="#1e40af" />
              </div>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))' }}>Slug</div>
                <div style={{ fontSize: 14.5, fontFamily: MONO, color: 'hsl(var(--muted-foreground))' }}>/{viewOrg.slug}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))' }}>Users</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO }}>{viewOrg._count?.users ?? 0}</div>
              </div>
            </div>

            {/* Editable: name */}
            <div>
              <Label style={labelStyle}>Organisation name *</Label>
              <Input
                value={editOrgForm.name}
                onChange={(e) => setEditOrgForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Organisation name"
                style={{ height: 36, fontSize: 14 }}
              />
            </div>

            {/* Editable: active toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'hsl(var(--muted)/0.3)', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Active</div>
                <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                  Inactive organisations cannot receive users or shipments.
                </div>
              </div>
              <Switch
                checked={editOrgForm.isActive}
                onCheckedChange={(v) => setEditOrgForm(f => ({ ...f, isActive: v }))}
              />
            </div>

            {/* Read-only info strip */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Created', value: new Date(viewOrg.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                { label: 'Org ID',  value: viewOrg.id.slice(0, 8) + '…', mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label} style={{ background: 'hsl(var(--muted)/0.2)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', fontFamily: mono ? MONO : undefined }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <AdminModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          modalMode === 'create'
            ? 'Add Partner Organisation'
            : `Edit: ${editTarget?.companyName}`
        }
        size="lg"
        footer={
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '16px 24px',
            borderTop: '1px solid hsl(var(--border))',
          }}>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saveDisabled}
              onClick={handleSave}
              style={{
                background: 'hsl(173 58% 39%)', color: '#fff',
                opacity: saveDisabled ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <div style={{ padding: '0 24px 0 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{ paddingTop: 20 }}>
            <AdminSectionTabs
              tabs={[
                { label: 'Details', value: 'details' },
                { label: 'Document Access', value: 'documents' },
                { label: 'Auto-Tag Rules', value: 'autotag' },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>

          {/* Tab: Details */}
          {activeTab === 'details' && (
            <div style={{ paddingBottom: 24 }}>
              <AdminFormSection title="Organisation Info">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <Label style={labelStyle}>Organisation Name *</Label>
                    <Input
                      value={form.companyName}
                      onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                      placeholder="Partner company name"
                      style={{ height: 36, fontSize: 14 }}
                    />
                  </div>

                  <div>
                    <Label style={labelStyle}>
                      Type {modalMode === 'create' ? '*' : ''}
                    </Label>
                    {modalMode === 'edit' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                        <TypeBadge typeCode={editTarget?.partnerType ?? ''} />
                        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                          Type cannot be changed after creation
                        </span>
                      </div>
                    ) : (
                      <Select value={form.partnerType} onValueChange={handleTypeChange}>
                        <SelectTrigger style={{ marginTop: 6 }}>
                          <SelectValue placeholder="Select partner type…" />
                        </SelectTrigger>
                        <SelectContent>
                          {partnerTypes.map((pt) => (
                            <SelectItem key={pt.id} value={pt.typeCode}>
                              {pt.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Switch
                      checked={form.isActive}
                      onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                    />
                    <span style={{ fontSize: 14.5 }}>
                      {form.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </AdminFormSection>

              <AdminFormSection title="Contact Information" isLast>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <Label style={labelStyle}>Contact Person</Label>
                    <Input
                      value={form.contactName}
                      onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                      placeholder="Primary contact name"
                      style={{ height: 36, fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <Label style={labelStyle}>Contact Email</Label>
                    <Input
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                      placeholder="ops@partner.com"
                      style={{ height: 36, fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <Label style={labelStyle}>Contact Phone</Label>
                    <Input
                      value={form.contactPhone}
                      onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                      placeholder="+91 98765 43210"
                      style={{ height: 36, fontSize: 14 }}
                    />
                  </div>
                  {modalMode === 'edit' && editTarget && (
                    <div style={{
                      paddingTop: 10,
                      borderTop: '1px solid hsl(var(--border))',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                        Created: {new Date(editTarget.createdAt).toLocaleDateString()}
                      </span>
                      <a
                        href={`/admin/users?org=${editTarget.id}`}
                        style={{
                          fontSize: 14, color: 'hsl(173 58% 39%)',
                          display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none',
                        }}
                      >
                        <ExternalLink size={11} />
                        View users in this organisation
                      </a>
                    </div>
                  )}
                </div>
              </AdminFormSection>
            </div>
          )}

          {/* Tab: Document Access */}
          {activeTab === 'documents' && (
            <div style={{ paddingBottom: 24 }}>
              <AdminFormSection title="Allowed Document Types" isLast>
                <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 12 }}>
                  Documents this partner's users can upload. Unselected types will not appear in their upload dropdown.
                </p>
                <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                  <button
                    onClick={() => setForm((f) => ({
                      ...f,
                      allowedDocTypes: docTypes.map((d) => d.shortCode),
                    }))}
                    style={linkBtnStyle}
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setForm((f) => ({ ...f, allowedDocTypes: [] }))}
                    style={linkBtnStyle}
                  >
                    Deselect all
                  </button>
                </div>

                {Object.entries(docTypeGroups).map(([geo, types]) => (
                  <div key={geo} style={{ marginBottom: 18 }}>
                    <div style={{
                      fontSize: 14.5, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: 'hsl(var(--muted-foreground))',
                      marginBottom: 8,
                    }}>
                      {GEO_LABELS[geo] ?? geo}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {types.map((dt) => (
                        <label
                          key={dt.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        >
                          <Checkbox
                            checked={form.allowedDocTypes.includes(dt.shortCode)}
                            onCheckedChange={() => toggleDocType(dt.shortCode)}
                          />
                          <span style={{ fontSize: 14.5 }}>
                            {dt.displayName}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                <div style={{
                  marginTop: 8, paddingTop: 12,
                  borderTop: '1px solid hsl(var(--border))',
                  fontSize: 14, color: 'hsl(var(--muted-foreground))',
                }}>
                  {form.allowedDocTypes.length} document type
                  {form.allowedDocTypes.length !== 1 ? 's' : ''} selected
                </div>
              </AdminFormSection>
            </div>
          )}

          {/* Tab: Auto-Tag Rules */}
          {activeTab === 'autotag' && (
            <div style={{ paddingBottom: 24 }}>
              <AdminFormSection title="Auto-Tag Rules" isLast>
                <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 16 }}>
                  Automatically tag this partner on new shipments matching these conditions.
                  Manual tagging is always available.
                </p>

                {form.autoTagRules.length > 0 && (
                  <div style={{
                    fontSize: 14.5, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: 'hsl(var(--muted-foreground))',
                    marginBottom: 10,
                  }}>
                    All conditions must match
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {form.autoTagRules.map((rule, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Select
                        value={rule.field}
                        onValueChange={(v) => updateRule(i, { field: v })}
                      >
                        <SelectTrigger style={{ flex: 1, height: 32, fontSize: 14.5 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TAG_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={rule.operator}
                        onValueChange={(v) => updateRule(i, { operator: v })}
                      >
                        <SelectTrigger style={{ width: 120, height: 32, fontSize: 14.5 }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TAG_OPERATORS.map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        value={rule.value}
                        onChange={(e) => updateRule(i, { value: e.target.value })}
                        placeholder='e.g. "Mundra"'
                        style={{ flex: 1, height: 32, fontSize: 14.5 }}
                      />

                      <button
                        onClick={() => removeRule(i)}
                        style={{
                          color: 'hsl(var(--muted-foreground))',
                          padding: 4, cursor: 'pointer',
                          background: 'transparent', border: 'none',
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addRule}
                  style={{ ...linkBtnStyle, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Plus size={12} /> Add condition
                </button>

                <div style={{
                  marginTop: 16, padding: '10px 14px', borderRadius: 8,
                  background: 'hsl(var(--muted) / 0.4)',
                  fontSize: 14, color: 'hsl(var(--muted-foreground))',
                  lineHeight: 1.6,
                }}>
                  {form.autoTagRules.length === 0
                    ? 'No auto-tag rules. This partner will only be tagged manually.'
                    : autoTagPreview(form.autoTagRules)
                      ? `New shipments where ${autoTagPreview(form.autoTagRules)} will be automatically tagged with this partner.`
                      : 'Fill in the condition values above to preview the rule.'}
                </div>
              </AdminFormSection>
            </div>
          )}
        </div>
      </AdminModal>

      {/* ── Tag Management Sheet ──────────────────────────────────────────────── */}
      <Sheet open={tagSheetOpen} onOpenChange={(v) => !v && setTagSheetOpen(false)}>
        <SheetContent
          side="right"
          style={{ width: 600, maxWidth: '95vw', overflowY: 'auto', padding: 0 }}
        >
          <SheetHeader style={{
            padding: '24px 24px 16px 24px',
            borderBottom: '1px solid hsl(var(--border))',
          }}>
            <SheetTitle style={{ fontSize: 16, fontWeight: 700 }}>
              Shipment Tags — {tagTarget?.companyName}
            </SheetTitle>
            <SheetDescription style={{ fontSize: 14.5 }}>
              {tags.length} shipment{tags.length !== 1 ? 's' : ''} tagged to this partner
            </SheetDescription>
          </SheetHeader>

          <div style={{ padding: '20px 24px' }}>
            {/* Active tags */}
            {tagsLoading ? (
              <div style={{
                textAlign: 'center', padding: 32,
                color: 'hsl(var(--muted-foreground))', fontSize: 14.5,
              }}>
                Loading…
              </div>
            ) : tags.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '20px 16px', borderRadius: 8,
                border: '1px dashed hsl(var(--border))',
                color: 'hsl(var(--muted-foreground))', fontSize: 14.5,
                marginBottom: 24,
              }}>
                No shipments tagged yet
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <div style={{
                  fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))',
                  marginBottom: 10,
                }}>
                  Active Tags
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {tags.map((tag) => (
                    <div key={tag.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 6,
                      background: 'hsl(var(--muted) / 0.3)',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 500 }}>
                          {tag.shipment.shipmentNumber}
                        </div>
                        {tag.shipment.vesselName && (
                          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                            {tag.shipment.vesselName}
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize: 14.5, fontWeight: 600, padding: '1px 8px', borderRadius: 99,
                        background: tag.tagSource === 'auto' ? '#fef3c7' : '#dbeafe',
                        color: tag.tagSource === 'auto' ? '#92400e' : '#1e40af',
                      }}>
                        {tag.tagSource === 'auto' ? 'Auto' : 'Manual'}
                      </span>
                      <div style={{
                        fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontFamily: MONO,
                      }}>
                        {new Date(tag.taggedAt).toLocaleDateString()}
                      </div>
                      {removeTagId === tag.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleRemoveTag(tag.id)}
                            style={{
                              fontSize: 14.5, color: '#dc2626', cursor: 'pointer',
                              padding: '2px 8px', borderRadius: 4, background: '#fee2e2',
                              border: 'none',
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setRemoveTagId(null)}
                            style={{
                              fontSize: 14.5, color: 'hsl(var(--muted-foreground))',
                              cursor: 'pointer', background: 'none', border: 'none',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRemoveTagId(tag.id)}
                          style={{
                            color: 'hsl(var(--muted-foreground))',
                            cursor: 'pointer', padding: 4,
                            background: 'none', border: 'none',
                          }}
                          title="Remove tag"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add manual tag */}
            <div style={{
              padding: 16, borderRadius: 8,
              border: '1px solid hsl(var(--border))',
              marginBottom: 20,
            }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 12 }}>
                Add manual tag
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Select value={addTagShipId} onValueChange={setAddTagShipId}>
                  <SelectTrigger style={{ flex: 1, height: 32, fontSize: 14.5 }}>
                    <SelectValue placeholder="Select shipment…" />
                  </SelectTrigger>
                  <SelectContent>
                    {untaggedShips.length === 0 ? (
                      <div style={{
                        padding: '8px 12px', fontSize: 14,
                        color: 'hsl(var(--muted-foreground))',
                      }}>
                        No untagged shipments
                      </div>
                    ) : (
                      untaggedShips.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.shipmentNumber}
                          {s.vesselName ? ` — ${s.vesselName}` : ''}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!addTagShipId || addingTag}
                  onClick={handleAddTag}
                  style={{ background: 'hsl(173 58% 39%)', color: '#fff', height: 32 }}
                >
                  {addingTag ? 'Tagging…' : 'Tag shipment'}
                </Button>
              </div>
            </div>

            {/* Auto-tag summary */}
            <div style={{ padding: 14, borderRadius: 8, background: 'hsl(var(--muted) / 0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Tag size={13} color="hsl(var(--muted-foreground))" />
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {tagTarget?.autoTagRules &&
                  (tagTarget.autoTagRules as AutoTagRule[]).length > 0
                    ? 'Auto-tag rules active'
                    : 'No auto-tag rules'}
                </span>
              </div>
              {tagTarget?.autoTagRules &&
               (tagTarget.autoTagRules as AutoTagRule[]).length > 0 && (
                <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 6 }}>
                  {(tagTarget.autoTagRules as AutoTagRule[])
                    .map((r) => `${r.field} ${r.operator} '${r.value}'`)
                    .join(' AND ')}
                </div>
              )}
              <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                Rules apply to new shipments only. Existing shipments must be tagged manually.
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Deactivate Dialog ─────────────────────────────────────────────────── */}
      <AdminConfirmDialog
        open={deactivateOpen}
        onClose={() => { setDeactivateOpen(false); setDeactivateTarget(null); }}
        onConfirm={handleDeactivate}
        title={`Deactivate partner: ${deactivateTarget?.companyName}`}
        description="All users in this organisation will be locked out. Existing documents and shipment tags will be preserved. Auto-tag rules will stop firing for new shipments. This can be reversed."
        confirmLabel="Deactivate partner"
        confirmVariant="warning"
      />
    </div>
  );
}
