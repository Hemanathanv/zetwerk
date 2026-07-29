import { useState, useEffect } from 'react';
import { Building2, AlertTriangle, Download, ChevronDown, ChevronUp, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { PartnerWarehouseSection } from '../AdminWarehousesPage';
import { apiGet, apiUrl, getAuthToken, readJsonResponse } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';
import {
  levelNum, getAuthorityLabel, getAuthorityColor,
} from '@/utils/authorityLevel';
import { AdminUsersPage } from '../AdminUsersPage';
import { AdminRolesPage } from '../AdminRolesPage';
import { AdminOrgsPage } from '../AdminOrgsPage';

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CATEGORY_LABELS: Record<string, string> = {
  admin: 'Administration', operations: 'Operations',
  document_controller: 'Document Controllers', finance: 'Finance',
  partner: 'Partner Access', auditor: 'Auditing', customer: 'Customer Portal',
};
const CATEGORY_ORDER = ['admin', 'operations', 'document_controller', 'finance', 'partner', 'auditor', 'customer'];

const PARTNER_TYPE_LABELS: Record<string, string> = {
  tpl: '3PL', cha: 'CHA', freight: 'Freight', shipping_line: 'Shipping Line',
  inspection: 'Inspection', other: 'Partner', customer: 'Customer',
};

// ─── Stat Pill ────────────────────────────────────────────────────────────────
function StatPill({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 20,
      background: warn ? 'hsl(38 92% 50% / 0.12)' : 'hsl(var(--muted))',
      fontSize: 14,
    }}>
      <strong style={{
        fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: warn ? 'hsl(38 70% 40%)' : 'hsl(var(--foreground))',
      }}>
        {value}
      </strong>
      <span style={{ color: warn ? 'hsl(38 60% 45%)' : 'hsl(var(--muted-foreground))' }}>{label}</span>
    </span>
  );
}

function StatPillSkeleton() {
  return (
    <span
      className="animate-pulse"
      style={{
        display: 'inline-flex',
        width: 82,
        height: 28,
        borderRadius: 20,
        background: 'hsl(var(--muted))',
      }}
    />
  );
}

// ─── Section Bar ──────────────────────────────────────────────────────────────
function SectionBar({
  title, open, onToggle, extra,
}: {
  title: string; open: boolean; onToggle: () => void; extra?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '11px 0', borderTop: '1px solid hsl(var(--border))',
    }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, background: 'none',
          border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>{title}</span>
        {open
          ? <ChevronUp style={{ width: 14, height: 14, color: 'hsl(var(--muted-foreground))' }} />
          : <ChevronDown style={{ width: 14, height: 14, color: 'hsl(var(--muted-foreground))' }} />
        }
      </button>
      {extra && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{extra}</div>
      )}
    </div>
  );
}

// ─── Access Profiles content ──────────────────────────────────────────────────
function AccessProfilesContent() {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<any>('/api/admin/roles')
      .then(d => { setRoles(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const grouped = CATEGORY_ORDER.reduce<Record<string, any[]>>((acc, cat) => {
    const group = roles.filter(r => r.profileCategory === cat && r.isActive);
    if (group.length > 0) acc[cat] = group;
    return acc;
  }, {});
  const ungrouped = roles.filter(r => !r.profileCategory && r.isActive);
  if (ungrouped.length > 0) grouped['other'] = ungrouped;

  if (loading) return (
    <div className="space-y-5 animate-pulse">
      {[...Array(3)].map((_, i) => (
        <div key={i}>
          <div className="h-3 w-24 bg-muted rounded mb-2" />
          <div className="border rounded-lg divide-y" style={{ borderColor: 'hsl(var(--card-border))' }}>
            {[...Array(2)].map((_, j) => <div key={j} className="h-12 bg-card" />)}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([cat, catRoles]) => (
        <div key={cat}>
          <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 px-0.5">
            {CATEGORY_LABELS[cat] || cat}
          </h3>
          <div className="border rounded-lg overflow-hidden divide-y" style={{ borderColor: 'hsl(var(--card-border))' }}>
            {catRoles.map(role => {
              const maxLevel = (role.allowedLevels as string[] || []).reduce(
                (max: number, l: string) => Math.max(max, levelNum(l)), 0
              );
              const mods = (role.defaultModules as string[] || []);
              const visible = mods.slice(0, 4);
              const extra = mods.length - 4;
              return (
                <div key={role.id} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14.5px] font-medium leading-none">{role.displayName || role.name}</span>
                      <span className={`text-[12px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${getAuthorityColor(maxLevel)}`}>
                        {getAuthorityLabel(maxLevel)}
                      </span>
                      {role.profileCategory === 'customer' && (
                        <span className="text-[12px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-medium shrink-0">
                          Phase 2
                        </span>
                      )}
                    </div>
                    {role.businessDescription && (
                      <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {role.businessDescription}
                      </p>
                    )}
                  </div>
                  <div className="hidden sm:flex items-center gap-1 shrink-0">
                    {visible.map((m: string) => (
                      <span key={m} className="text-[12px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono leading-none">
                        {m}
                      </span>
                    ))}
                    {extra > 0 && (
                      <span className="text-[12px] text-muted-foreground leading-none">+{extra}</span>
                    )}
                  </div>
                  <div className="text-[13px] text-muted-foreground shrink-0 w-14 text-right tabular-nums">
                    {role._count?.users ?? 0} user{(role._count?.users ?? 0) !== 1 ? 's' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Organisations content ─────────────────────────────────────────────────────
function OrgsContent() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<any>('/api/admin/organisations'),
      apiGet<any>('/api/admin/partners'),
    ]).then(([orgData, partnerData]) => {
      setOrgs(orgData.data || []);
      setPartners(partnerData.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function InternalOrgCard({ org }: { org: any }) {
    return (
      <div className="bg-card border rounded-lg p-4 flex items-center gap-3" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <div className="w-9 h-9 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[14.5px] truncate">{org.name}</div>
          <div className="text-[13px] text-muted-foreground">{org._count?.users ?? 0} user{org._count?.users !== 1 ? 's' : ''}</div>
        </div>
        <span className="text-[12px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
          {org.subscriptionTier || 'pilot'}
        </span>
      </div>
    );
  }

  function PartnerCard({ partner }: { partner: any }) {
    const isExpanded = expandedPartnerId === partner.id;
    const is3PL = partner.partnerType === 'tpl';
    const typeLabel = PARTNER_TYPE_LABELS[partner.partnerType] ?? partner.partnerType;

    return (
      <div className="bg-card border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <button
          className="w-full text-left p-4 flex items-center gap-3 hover:bg-muted/30 transition-colors"
          onClick={() => is3PL ? setExpandedPartnerId(isExpanded ? null : partner.id) : undefined}
          style={{ cursor: is3PL ? 'pointer' : 'default' }}
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            is3PL ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-blue-100 dark:bg-blue-900/30'
          }`}>
            <Building2 className={`w-4 h-4 ${is3PL ? 'text-amber-600' : 'text-blue-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[14.5px] truncate">{partner.companyName}</div>
            <div className="text-[13px] text-muted-foreground">
              {partner.contactEmail || '—'}
              {partner._count?.shipmentTags > 0 && ` · ${partner._count.shipmentTags} shipment${partner._count.shipmentTags !== 1 ? 's' : ''}`}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[12px] px-1.5 py-0.5 rounded font-medium ${
              is3PL ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
            }`}>
              {typeLabel}
            </span>
            {!partner.isActive && (
              <span className="text-[12px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Inactive</span>
            )}
            {is3PL && (
              isExpanded
                ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
        </button>
        {is3PL && isExpanded && (
          <div className="border-t px-4 pb-4" style={{ borderColor: 'hsl(var(--border))' }}>
            <PartnerWarehouseSection partnerOrgId={partner.id} />
          </div>
        )}
      </div>
    );
  }

  if (loading) return (
    <div className="space-y-2 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-card rounded-lg" />)}</div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Internal</h3>
        {orgs.length === 0 ? (
          <p className="text-[14.5px] text-muted-foreground py-2">No internal organisation found.</p>
        ) : (
          <div className="space-y-2">{orgs.map(o => <InternalOrgCard key={o.id} org={o} />)}</div>
        )}
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">External Partners</h3>
        {partners.length === 0 ? (
          <div className="py-4 text-[14.5px] text-muted-foreground">
            No external partners yet. Use Advanced configuration to add partners.
          </div>
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground mb-3">3PL partners can be expanded to configure warehouses and SLAs.</p>
            <div className="space-y-2">{partners.map(p => <PartnerCard key={p.id} partner={p} />)}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Access Audit content ──────────────────────────────────────────────────────
function AuditContent() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<any>('/api/admin/settings/access-audit')
      .then(d => { setEntries(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function exportCsv() {
    const rows = [['Time', 'Action', 'Description', 'User']];
    entries.forEach(e => rows.push([new Date(e.createdAt).toISOString(), e.action, e.description, e.userName]));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'access-audit.csv';
    a.click();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[14.5px] text-muted-foreground">Recent permission changes</p>
        <button onClick={exportCsv} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      {loading ? (
        <div className="space-y-3 animate-pulse">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-card rounded-lg" />)}</div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center text-[14.5px] text-muted-foreground">
          No access changes recorded yet.
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(e => (
            <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] shrink-0 font-medium mt-0.5 ${
                e.action === 'create' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                  : e.action === 'delete' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {e.action === 'create' ? '+' : e.action === 'delete' ? '×' : '✎'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px]">{e.description}</div>
                <div className="text-[13px] text-muted-foreground mt-0.5">by {e.userName} · {timeAgo(e.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Teams content ────────────────────────────────────────────────────────────
interface TeamRow { id: string; name: string; function?: string | null; region?: string | null; _count?: { users: number }; }
interface TeamForm { name: string; function: string; region: string; }
const BLANK_FORM: TeamForm = { name: '', function: '', region: '' };

function TeamsContent() {
  const { refreshTeams } = useConfig();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // null = none, 'new' = add row
  const [form, setForm] = useState<TeamForm>(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    apiGet<any>('/api/admin/teams')
      .then(d => { setTeams(d.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEdit(team: TeamRow) {
    setEditingId(team.id);
    setForm({ name: team.name, function: team.function || '', region: team.region || '' });
    setError('');
  }

  function startAdd() {
    setEditingId('new');
    setForm(BLANK_FORM);
    setError('');
  }

  function cancel() { setEditingId(null); setForm(BLANK_FORM); setError(''); }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const isNew = editingId === 'new';
      const url = isNew ? '/api/admin/teams' : `/api/admin/teams/${editingId}`;
      const r = await fetch(apiUrl(url), {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: form.name, function: form.function, region: form.region }),
      });
      const d = await readJsonResponse<any>(r);
      if (!d.ok) { setError(d.error || 'Failed'); return; }
      setEditingId(null);
      load();
      refreshTeams();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  async function deleteTeam(team: TeamRow) {
    const userCount = team._count?.users ?? 0;
    if (userCount > 0) {
      setError(`"${team.name}" has ${userCount} user${userCount !== 1 ? 's' : ''} assigned — reassign them first.`);
      return;
    }
    if (!confirm(`Delete team "${team.name}"?`)) return;
    setSaving(true); setError('');
    try {
      const r = await fetch(apiUrl(`/api/admin/teams/${team.id}`), { method: 'DELETE', headers: authHeaders() });
      const d = await readJsonResponse<any>(r);
      if (!d.ok) { setError(d.error || 'Failed'); return; }
      load();
      refreshTeams();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '5px 8px', fontSize: 14.5,
    border: '1px solid hsl(var(--border))', borderRadius: 6,
    background: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
    outline: 'none', fontFamily: "'Instrument Sans', sans-serif",
  };
  const iconBtn = (color: string): React.CSSProperties => ({
    background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px',
    borderRadius: 5, color, display: 'inline-flex', alignItems: 'center',
  });

  if (loading) return (
    <div className="space-y-2 animate-pulse">
      {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-card rounded-lg" />)}
    </div>
  );

  return (
    <div>
      {error && (
        <div style={{ marginBottom: 10, padding: '7px 12px', background: 'hsl(0 72% 95%)', border: '1px solid hsl(0 60% 80%)', borderRadius: 7, fontSize: 14, color: 'hsl(0 60% 40%)' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden divide-y" style={{ borderColor: 'hsl(var(--card-border))' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 140px 60px 72px', gap: 0 }}>
          {['Name', 'Function', 'Region', 'Users', ''].map(h => (
            <div key={h} style={{ padding: '6px 12px', fontSize: 14, fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.06em', background: 'hsl(var(--muted)/0.5)' }}>
              {h}
            </div>
          ))}
        </div>

        {teams.length === 0 && editingId !== 'new' && (
          <div style={{ padding: '18px 12px', fontSize: 14.5, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>
            No teams yet — add your first team below.
          </div>
        )}

        {teams.map(team => (
          <div key={team.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 140px 60px 72px', alignItems: 'center', background: 'hsl(var(--card))' }}>
            {editingId === team.id ? (
              <>
                <div style={{ padding: '6px 8px' }}>
                  <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Team name (appears in dropdowns)" autoFocus />
                </div>
                <div style={{ padding: '6px 6px' }}>
                  <input style={inputStyle} value={form.function} onChange={e => setForm(f => ({ ...f, function: e.target.value }))} placeholder="e.g. Finance" />
                </div>
                <div style={{ padding: '6px 6px' }}>
                  <input style={inputStyle} value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="e.g. AP India" onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }} />
                </div>
                <div style={{ padding: '6px 8px', fontSize: 14, color: 'hsl(var(--muted-foreground))', textAlign: 'center' }}>
                  {team._count?.users ?? 0}
                </div>
                <div style={{ padding: '6px 8px', display: 'flex', gap: 2 }}>
                  <button style={iconBtn('hsl(173 58% 39%)')} onClick={save} disabled={saving} title="Save"><Check size={14} /></button>
                  <button style={iconBtn('hsl(var(--muted-foreground))')} onClick={cancel} disabled={saving} title="Cancel"><X size={14} /></button>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: '9px 12px', fontSize: 14.5, fontWeight: 500, color: 'hsl(var(--foreground))' }}>{team.name}</div>
                <div style={{ padding: '9px 12px', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{team.function || <span style={{ opacity: 0.4 }}>—</span>}</div>
                <div style={{ padding: '9px 12px', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{team.region  || <span style={{ opacity: 0.4 }}>—</span>}</div>
                <div style={{ padding: '9px 12px', fontSize: 14, color: 'hsl(var(--muted-foreground))', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {team._count?.users ?? 0}
                </div>
                <div style={{ padding: '6px 8px', display: 'flex', gap: 2 }}>
                  <button style={iconBtn('hsl(var(--muted-foreground))')} onClick={() => startEdit(team)} title="Edit"><Pencil size={13} /></button>
                  <button
                    style={iconBtn((team._count?.users ?? 0) > 0 ? 'hsl(var(--muted-foreground)/0.4)' : 'hsl(0 60% 55%)')}
                    onClick={() => deleteTeam(team)}
                    title={(team._count?.users ?? 0) > 0 ? 'Reassign users before deleting' : 'Delete'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {/* New-team row */}
        {editingId === 'new' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 140px 60px 72px', alignItems: 'center', background: 'hsl(173 58% 39% / 0.05)' }}>
            <div style={{ padding: '6px 8px' }}>
              <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Team name (appears in dropdowns)" autoFocus />
            </div>
            <div style={{ padding: '6px 6px' }}>
              <input style={inputStyle} value={form.function} onChange={e => setForm(f => ({ ...f, function: e.target.value }))} placeholder="e.g. Finance" />
            </div>
            <div style={{ padding: '6px 6px' }}>
              <input style={inputStyle} value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="e.g. AP India" onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }} />
            </div>
            <div style={{ padding: '6px 8px' }} />
            <div style={{ padding: '6px 8px', display: 'flex', gap: 2 }}>
              <button style={iconBtn('hsl(173 58% 39%)')} onClick={save} disabled={saving} title="Save"><Check size={14} /></button>
              <button style={iconBtn('hsl(var(--muted-foreground))')} onClick={cancel} disabled={saving} title="Cancel"><X size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Add button */}
      {editingId !== 'new' && (
        <button
          onClick={startAdd}
          style={{
            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 7, border: '1px dashed hsl(var(--border))',
            background: 'transparent', color: 'hsl(var(--muted-foreground))',
            fontSize: 14, fontWeight: 500, cursor: 'pointer',
            fontFamily: "'Instrument Sans', sans-serif",
          }}
          className="hover:border-teal-500 hover:text-teal-600 transition-colors"
        >
          <Plus size={12} /> Add team
        </button>
      )}

      <p style={{ marginTop: 12, fontSize: 14.5, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
        Team names appear in user assignment dropdowns. Function and Region are optional metadata fields.
      </p>
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────────
export default function TeamAccessSection() {
  const [overview, setOverview] = useState<any>(null);
  const [triggerCreate, setTriggerCreate] = useState(0);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [advancedView, setAdvancedView] = useState<null | 'roles' | 'orgs'>(null);

  useEffect(() => {
    apiGet<any>('/api/admin/settings/team-overview')
      .then(d => setOverview(d.data))
      .catch(() => {});
  }, []);

  if (advancedView) return (
    <div>
      <button
        onClick={() => setAdvancedView(null)}
        className="text-[13px] text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1"
      >
        ← Back to Team &amp; Access
      </button>
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-5 text-[13px] text-amber-700 dark:text-amber-400 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Advanced configuration — changes here affect system behaviour.
      </div>
      {advancedView === 'roles' && <AdminRolesPage />}
      {advancedView === 'orgs' && <AdminOrgsPage />}
    </div>
  );

  return (
    <div style={{ paddingBottom: 48 }}>
      {/* Page header + stats strip */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4, color: 'hsl(var(--foreground))' }}>
            Team &amp; Access
          </h1>
          <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
            Manage who has access, what they can see, and what they can do.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', flexShrink: 0 }}>
          {!overview ? (
            <>
              <StatPillSkeleton />
              <StatPillSkeleton />
              <StatPillSkeleton />
              <StatPillSkeleton />
            </>
          ) : (
            <>
            <StatPill label="active" value={overview.activeUsers} />
            <StatPill label="partners" value={overview.partnerUsers} />
            <StatPill label="admin" value={overview.adminUsers} />
            {overview.overrideUsers > 0 && (
              <StatPill label="override" value={overview.overrideUsers} warn={overview.overrideUsers > 3} />
            )}
            </>
          )}
        </div>
      </div>

      {/* People */}
      <SectionBar
        title="People"
        open={peopleOpen}
        onToggle={() => setPeopleOpen(o => !o)}
        extra={
          <button
            onClick={e => { e.stopPropagation(); setPeopleOpen(true); setTriggerCreate(c => c + 1); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 7,
              background: 'hsl(173 58% 39%)', color: '#fff',
              fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            <Plus style={{ width: 12, height: 12 }} /> Add User
          </button>
        }
      />
      {peopleOpen && (
        <div style={{ paddingTop: 20, paddingBottom: 28 }}>
          <AdminUsersPage compact triggerCreate={triggerCreate} />
        </div>
      )}

      {/* Access Profiles */}
      <SectionBar
        title="Access Profiles"
        open={profilesOpen}
        onToggle={() => setProfilesOpen(o => !o)}
        extra={
          <button
            onClick={() => setAdvancedView('roles')}
            style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            className="hover:text-foreground transition-colors"
          >
            Advanced →
          </button>
        }
      />
      {profilesOpen && (
        <div style={{ paddingTop: 16, paddingBottom: 28 }}>
          <AccessProfilesContent />
        </div>
      )}

      {/* Organisations & Partners */}
      <SectionBar
        title="Organisations &amp; Partners"
        open={orgsOpen}
        onToggle={() => setOrgsOpen(o => !o)}
        extra={
          <button
            onClick={() => setAdvancedView('orgs')}
            style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            className="hover:text-foreground transition-colors"
          >
            Advanced →
          </button>
        }
      />
      {orgsOpen && (
        <div style={{ paddingTop: 16, paddingBottom: 28 }}>
          <OrgsContent />
        </div>
      )}

      {/* Access Audit (collapsed by default) */}
      <SectionBar
        title="Access Audit"
        open={auditOpen}
        onToggle={() => setAuditOpen(o => !o)}
      />
      {auditOpen && (
        <div style={{ paddingTop: 16, paddingBottom: 16 }}>
          <AuditContent />
        </div>
      )}
    </div>
  );
}
