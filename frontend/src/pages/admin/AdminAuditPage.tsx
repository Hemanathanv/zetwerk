import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, Download, ChevronDown, ChevronRight,
  X, Code2,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiGet } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string; orgId: string; userId: string | null; activityCode: string | null;
  action: string; entityType: string; entityId: string | null;
  details: Record<string, any> | null; ipAddress: string | null;
  timestamp: string;
  user?: { fullName: string; email: string } | null;
}

interface AuditUser { id: string; fullName: string; email: string; role?: { name: string } }

interface Filters {
  startDate: Date; endDate: Date;
  userId: string; entityType: string; action: string;
  search: string; limit: number; offset: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  create:        { bg: '#16a34a22', text: '#16a34a' },
  update:        { bg: '#2563eb22', text: '#2563eb' },
  delete:        { bg: '#dc262622', text: '#dc2626' },
  approve:       { bg: '#0d948022', text: '#0d9488' },
  override:      { bg: '#d9770622', text: '#d97706' },
  post:          { bg: '#4f46e522', text: '#4f46e5' },
  reverse:       { bg: '#db277722', text: '#db2777' },
  login:         { bg: '#6b728022', text: '#6b7280' },
  config_change: { bg: '#47556922', text: '#475569' },
  revoke:        { bg: '#dc262622', text: '#dc2626' },
};

const ENTITY_COLORS: Record<string, string> = {
  document: '#0d9488', shipment: '#2563eb', ticket: '#7c3aed',
  role: '#d97706', user: '#16a34a', template: '#0891b2',
  rule: '#4f46e5', organisation: '#db2777', delegation: '#6b7280',
  gate: '#475569', warehouse: '#15803d',
};

const ENTITY_TYPES = ['Document', 'Shipment', 'Ticket', 'Role', 'User', 'Template', 'Rule', 'Organisation', 'Delegation', 'Gate'];
const ACTIONS = ['create', 'update', 'delete', 'approve', 'override', 'post', 'reverse', 'login', 'config_change', 'revoke'];
const PAGE_SIZES = [20, 50, 100];

function sevenDaysAgo(): Date {
  const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d;
}

function todayEnd(): Date {
  const d = new Date(); d.setHours(23, 59, 59, 999); return d;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtTsLong(ts: string): string {
  return new Date(ts).toLocaleString('en-US', { timeZoneName: 'short', hour12: false });
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function userColor(name: string): string {
  const colors = ['#0d9488', '#2563eb', '#7c3aed', '#d97706', '#16a34a', '#db2777', '#4f46e5'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[h];
}

// ─── ActionBadge ──────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const c = ACTION_COLORS[action] ?? { bg: '#6b728022', text: '#6b7280' };
  return (
    <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 99, fontSize: 14.5, fontWeight: 700, background: c.bg, color: c.text }}>
      {action}
    </span>
  );
}

// ─── EntityBadge ─────────────────────────────────────────────────────────────

function EntityBadge({ type, id }: { type: string; id: string | null }) {
  const color = ENTITY_COLORS[type.toLowerCase()] ?? '#475569';
  return (
    <div>
      <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 5, fontSize: 14, fontWeight: 700, background: `${color}22`, color }}>
        {type}
      </span>
      {id && (
        <div style={{ ...MONO, fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
          {id.slice(0, 8)}…
        </div>
      )}
    </div>
  );
}

// ─── UserCell ─────────────────────────────────────────────────────────────────

function UserCell({ entry }: { entry: AuditEntry }) {
  const name = entry.user?.fullName ?? 'System';
  const color = userColor(name);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14.5, fontWeight: 700, color: '#fff' }}>
        {initials(name)}
      </div>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{name}</div>
        {entry.user?.email && <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{entry.user.email}</div>}
      </div>
    </div>
  );
}

// ─── DetailSummary ────────────────────────────────────────────────────────────

function DetailSummary({ entry }: { entry: AuditEntry }) {
  const d = entry.details ?? {};
  switch (entry.action) {
    case 'create': return (
      <span style={{ fontSize: 14, color: 'hsl(var(--foreground))' }}>
        Created {entry.entityType}{d.name ? `: ${d.name}` : d.email ? `: ${d.email}` : ''}
      </span>
    );
    case 'update': {
      const before = d.before ?? {}; const after = d.after ?? {};
      const changed = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]);
      if (changed.length === 0) return <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Updated {entry.entityType}</span>;
      const show = changed.slice(0, 2);
      return (
        <div>
          {show.map(k => (
            <div key={k} style={{ ...MONO, fontSize: 14.5, color: 'hsl(var(--foreground))' }}>
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>{k}:</span>{' '}
              <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>{String(before[k] ?? '—')}</span>
              {' → '}
              <span style={{ color: '#16a34a' }}>{String(after[k] ?? '—')}</span>
            </div>
          ))}
          {changed.length > 2 && <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>+{changed.length - 2} more</div>}
        </div>
      );
    }
    case 'delete': return (
      <span style={{ fontSize: 14, color: '#dc2626' }}>
        Deleted {entry.entityType}{d.name ? `: ${d.name}` : ''}
      </span>
    );
    case 'approve': return (
      <span style={{ fontSize: 14 }}>
        Approved {entry.entityType}{d.description ? `: ${d.description}` : ''}
      </span>
    );
    case 'override': return (
      <span style={{ fontSize: 14, fontWeight: 600, color: '#d97706' }}>
        Override: {d.description ?? d.reason ?? d.validationCode ?? 'Manual override'}
      </span>
    );
    case 'login': return (
      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
        Login{entry.ipAddress ? ` from ${entry.ipAddress}` : ''}
      </span>
    );
    case 'config_change': return (
      <span style={{ fontSize: 14 }}>Config: {d.description ?? d.field ?? 'Configuration changed'}</span>
    );
    default: return (
      <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
        {d.description ?? d.name ?? entry.action}
      </span>
    );
  }
}

// ─── ExpandedDetail ──────────────────────────────────────────────────────────

function ExpandedDetail({ entry }: { entry: AuditEntry }) {
  const [showRaw, setShowRaw] = useState(false);
  const d = entry.details ?? {};
  const before = d.before ?? {}; const after = d.after ?? {};
  const changed = entry.action === 'update'
    ? Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k])
    : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: '16px 24px', background: 'hsl(var(--muted)/0.3)', borderTop: '1px solid hsl(var(--border))' }}>
      {/* Left: Metadata */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entry Metadata</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <MetaRow label="Timestamp"  value={fmtTsLong(entry.timestamp)} mono />
          <MetaRow label="User"       value={entry.user ? `${entry.user.fullName} (${entry.user.email})` : 'System'} />
          {entry.ipAddress && <MetaRow label="IP Address" value={entry.ipAddress} mono />}
          {entry.activityCode && <MetaRow label="Activity Code" value={entry.activityCode} mono />}
          <MetaRow label="Entity Type" value={entry.entityType} />
          {entry.entityId && <MetaRow label="Entity ID" value={entry.entityId} mono />}
          <MetaRow label="Entry ID" value={entry.id} mono small />
        </div>
      </div>
      {/* Right: Diff / Details */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {entry.action === 'update' ? 'Changed Fields' : 'Details'}
          </div>
          <button onClick={() => setShowRaw(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14.5, color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Code2 size={11} /> {showRaw ? 'Hide raw' : 'Show raw'}
          </button>
        </div>
        {showRaw ? (
          <pre style={{ ...MONO, fontSize: 14, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, padding: 10, overflowX: 'auto', maxHeight: 200, margin: 0, color: 'hsl(var(--foreground))' }}>
            {JSON.stringify(d, null, 2)}
          </pre>
        ) : entry.action === 'update' && changed.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {changed.map(k => (
              <div key={k} style={{ background: 'hsl(var(--card))', borderRadius: 6, padding: '6px 10px', border: '1px solid hsl(var(--border))' }}>
                <div style={{ ...MONO, fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 3 }}>{k}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ ...MONO, fontSize: 14.5, padding: '1px 6px', borderRadius: 4, background: '#dc262620', color: '#dc2626', textDecoration: 'line-through' }}>{String(before[k] ?? '—')}</span>
                  <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>→</span>
                  <span style={{ ...MONO, fontSize: 14.5, padding: '1px 6px', borderRadius: 4, background: '#16a34a20', color: '#16a34a' }}>{String(after[k] ?? '—')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : entry.action === 'override' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {d.reason && <MetaRow label="Reason" value={d.reason} />}
            {d.validationCode && <MetaRow label="Validation" value={d.validationCode} mono />}
            {d.description && <MetaRow label="Description" value={d.description} />}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(d).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object').slice(0, 10).map(([k, v]) => (
              <MetaRow key={k} label={k} value={String(v)} />
            ))}
            {Object.keys(d).length === 0 && <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>No additional details recorded.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: small ? 10 : 12 }}>
      <span style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0, minWidth: 90 }}>{label}:</span>
      <span style={{ ...mono ? MONO : {}, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

// ─── AuditRow ─────────────────────────────────────────────────────────────────

const thS: React.CSSProperties = { padding: '9px 12px', fontSize: 14.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'hsl(var(--muted-foreground))', textAlign: 'left', background: 'hsl(var(--muted)/0.4)', borderBottom: '2px solid hsl(var(--border))' };
const tdS: React.CSSProperties = { padding: '9px 12px', borderBottom: '1px solid hsl(var(--border))', verticalAlign: 'top' };

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isOverride = entry.action === 'override';
  const rowStyle: React.CSSProperties = {
    background: expanded ? 'hsl(var(--muted)/0.3)' : (isOverride ? '#d9770608' : 'hsl(var(--card))'),
    cursor: 'pointer',
    borderLeft: isOverride ? '3px solid #d97706' : '3px solid transparent',
  };

  return (
    <>
      <tr style={rowStyle} onClick={() => setExpanded(v => !v)}>
        <td style={tdS}>
          <span style={{ ...MONO, fontSize: 14 }}>{fmtTs(entry.timestamp)}</span>
        </td>
        <td style={tdS}><UserCell entry={entry} /></td>
        <td style={tdS}><ActionBadge action={entry.action} /></td>
        <td style={tdS}>
          {entry.activityCode
            ? <span style={{ ...MONO, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{entry.activityCode}</span>
            : <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>—</span>}
        </td>
        <td style={tdS}><EntityBadge type={entry.entityType} id={entry.entityId} /></td>
        <td style={tdS}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ paddingTop: 1, flexShrink: 0, color: 'hsl(var(--muted-foreground))' }}>
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            <DetailSummary entry={entry} />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid hsl(var(--border))' }}>
            <ExpandedDetail entry={entry} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── FilterChip ──────────────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 10px', borderRadius: 99, fontSize: 14.5, fontWeight: 600, background: 'hsl(173 58% 39% / 0.1)', color: 'hsl(173 58% 39%)', border: '1px solid hsl(173 58% 39% / 0.3)' }}>
      {label}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'hsl(173 58% 39%)' }}><X size={10} /></button>
    </span>
  );
}

// ─── ActivityLog Tab ──────────────────────────────────────────────────────────

function ActivityLog({ onExport }: { onExport: (filters: Filters) => void }) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>({
    startDate: sevenDaysAgo(), endDate: todayEnd(),
    userId: '', entityType: '', action: '', search: '', limit: 50, offset: 0,
  });
  const [entries,    setEntries]    = useState<AuditEntry[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [users,      setUsers]      = useState<AuditUser[]>([]);
  const [overridesOnly, setOverridesOnly] = useState(false);
  const [adminOnly,     setAdminOnly]     = useState(false);
  const [loginsOnly,    setLoginsOnly]    = useState(false);

  useEffect(() => {
    apiGet<any>('/api/admin/users').then(r => { if (r.ok) setUsers(r.data ?? []); });
  }, []);

  const fetch = useCallback(async (f: Filters, ov: boolean, adm: boolean, lg: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('startDate', f.startDate.toISOString());
      params.set('endDate', f.endDate.toISOString());
      if (f.userId)     params.set('userId', f.userId);
      if (f.entityType) params.set('entityType', f.entityType.toLowerCase());
      const effectiveAction = ov ? 'override' : lg ? 'login' : f.action;
      if (effectiveAction) params.set('action', effectiveAction);
      params.set('limit',  String(f.limit));
      params.set('offset', String(f.offset));
      const res = await apiGet<any>(`/api/admin/audit?${params}`);
      if (res.ok) {
        let data: AuditEntry[] = res.data ?? [];
        if (adm) data = data.filter(e => e.activityCode?.startsWith('ADM-'));
        if (f.search) {
          const q = f.search.toLowerCase();
          data = data.filter(e =>
            e.entityId?.toLowerCase().includes(q) ||
            e.activityCode?.toLowerCase().includes(q) ||
            JSON.stringify(e.details ?? {}).toLowerCase().includes(q) ||
            e.user?.fullName?.toLowerCase().includes(q)
          );
        }
        setEntries(data);
        setTotal(adm || f.search ? data.length : res.meta?.total ?? data.length);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(filters, overridesOnly, adminOnly, loginsOnly); }, [filters, overridesOnly, adminOnly, loginsOnly, fetch]);

  function setDatePreset(days: number | 'today') {
    const end = todayEnd();
    const start = new Date();
    if (days === 'today') { start.setHours(0, 0, 0, 0); }
    else { start.setDate(start.getDate() - (days - 1)); start.setHours(0, 0, 0, 0); }
    setFilters(f => ({ ...f, startDate: start, endDate: end, offset: 0 }));
  }

  function upd(patch: Partial<Filters>) { setFilters(f => ({ ...f, ...patch, offset: 0 })); }

  const activeChips: { label: string; clear: () => void }[] = [];
  activeChips.push({ label: `Date: ${fmtDate(filters.startDate)} – ${fmtDate(filters.endDate)}`, clear: () => upd({ startDate: sevenDaysAgo(), endDate: todayEnd() }) });
  if (filters.userId) { const u = users.find(x => x.id === filters.userId); activeChips.push({ label: `User: ${u?.fullName ?? '…'}`, clear: () => upd({ userId: '' }) }); }
  if (filters.entityType) activeChips.push({ label: `Type: ${filters.entityType}`, clear: () => upd({ entityType: '' }) });
  if (filters.action)     activeChips.push({ label: `Action: ${filters.action}`, clear: () => upd({ action: '' }) });
  if (overridesOnly)      activeChips.push({ label: 'Overrides only', clear: () => setOverridesOnly(false) });
  if (adminOnly)          activeChips.push({ label: 'Admin changes', clear: () => setAdminOnly(false) });
  if (loginsOnly)         activeChips.push({ label: 'Logins only', clear: () => setLoginsOnly(false) });
  if (filters.search)     activeChips.push({ label: `Search: ${filters.search}`, clear: () => upd({ search: '' }) });

  const page = Math.floor(filters.offset / filters.limit) + 1;
  const totalPages = Math.ceil(total / filters.limit);
  const showingStart = total === 0 ? 0 : filters.offset + 1;
  const showingEnd = Math.min(filters.offset + entries.length, total);

  const inpS: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, fontSize: 14, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' };
  const toggleBtn = (active: boolean): React.CSSProperties => ({
    padding: '5px 10px', borderRadius: 6, fontSize: 14.5, fontWeight: 600, cursor: 'pointer',
    border: active ? '1px solid hsl(173 58% 39%)' : '1px solid hsl(var(--border))',
    background: active ? 'hsl(173 58% 39% / 0.1)' : 'hsl(var(--background))',
    color: active ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
  });
  const presetBtn: React.CSSProperties = { padding: '4px 9px', borderRadius: 5, fontSize: 14.5, cursor: 'pointer', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' };

  return (
    <div>
      {/* Filter Bar */}
      <div style={{ background: 'hsl(var(--card))', borderRadius: 10, padding: 16, marginBottom: 12, border: '1px solid hsl(var(--border))' }}>
        {/* Row 1 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" style={{ ...inpS, width: 136 }} value={fmtDate(filters.startDate)} onChange={e => upd({ startDate: new Date(e.target.value + 'T00:00:00') })} />
            <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>–</span>
            <input type="date" style={{ ...inpS, width: 136 }} value={fmtDate(filters.endDate)} onChange={e => upd({ endDate: new Date(e.target.value + 'T23:59:59') })} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {([['Today', 'today'], ['7d', 7], ['30d', 30], ['90d', 90]] as [string, any][]).map(([lbl, val]) => (
              <button key={lbl} style={presetBtn} onClick={() => setDatePreset(val)}>{lbl}</button>
            ))}
          </div>
          <select style={inpS} value={filters.userId} onChange={e => upd({ userId: e.target.value })}>
            <option value="">All users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
          <select style={inpS} value={filters.entityType} onChange={e => upd({ entityType: e.target.value })}>
            <option value="">All types</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {/* Row 2 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={inpS} value={filters.action} onChange={e => upd({ action: e.target.value })}>
            <option value="">All actions</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input style={{ ...inpS, minWidth: 260, flex: 1 }} value={filters.search} placeholder="Search by shipment ID, doc type, rule code…"
            onChange={e => upd({ search: e.target.value })} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={toggleBtn(overridesOnly)} onClick={() => { setOverridesOnly(v => !v); if (!overridesOnly) { setLoginsOnly(false); upd({ action: '' }); } }}>
              Overrides only
            </button>
            <button style={toggleBtn(adminOnly)} onClick={() => setAdminOnly(v => !v)}>
              Admin changes
            </button>
            <button style={toggleBtn(loginsOnly)} onClick={() => { setLoginsOnly(v => !v); if (!loginsOnly) { setOverridesOnly(false); upd({ action: '' }); } }}>
              Logins
            </button>
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {activeChips.map((ch, i) => <FilterChip key={i} label={ch.label} onRemove={ch.clear} />)}
          <button onClick={() => {
            setFilters({ startDate: sevenDaysAgo(), endDate: todayEnd(), userId: '', entityType: '', action: '', search: '', limit: 50, offset: 0 });
            setOverridesOnly(false); setAdminOnly(false); setLoginsOnly(false);
          }} style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Clear all filters
          </button>
        </div>
      )}

      {/* Results summary */}
      <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 10 }}>
        {loading ? 'Loading…' : `Showing ${showingStart}–${showingEnd} of ${total} entries · ${fmtDate(filters.startDate)} to ${fmtDate(filters.endDate)}`}
      </div>

      {/* Table */}
      <div style={{ background: 'hsl(var(--card))', borderRadius: 10, border: '1px solid hsl(var(--border))', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 size={22} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thS, width: 160 }}>Timestamp</th>
                  <th style={{ ...thS, width: 180 }}>User</th>
                  <th style={{ ...thS, width: 100 }}>Action</th>
                  <th style={{ ...thS, width: 100 }}>Activity</th>
                  <th style={{ ...thS, width: 180 }}>Entity</th>
                  <th style={{ ...thS }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '48px 0', textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
                      No audit entries match the current filters.
                    </td>
                  </tr>
                ) : entries.map(e => <AuditRow key={e.id} entry={e} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
            Showing {showingStart}–{showingEnd} of {total}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button variant="outline" size="sm" disabled={filters.offset === 0}
              onClick={() => setFilters(f => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}>
              Previous
            </Button>
            <span style={{ fontSize: 14 }}>Page {page} of {totalPages || 1}</span>
            <Button variant="outline" size="sm" disabled={showingEnd >= total}
              onClick={() => setFilters(f => ({ ...f, offset: f.offset + f.limit }))}>
              Next
            </Button>
            <select style={{ padding: '5px 8px', borderRadius: 5, fontSize: 14, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
              value={filters.limit} onChange={e => setFilters(f => ({ ...f, limit: Number(e.target.value), offset: 0 }))}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={() => onExport(filters)}>
            <Download size={13} style={{ marginRight: 5 }} /> Export CSV
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminAuditPage() {
  const { toast } = useToast();
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExport(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleExport(filters: Filters) {
    setShowExport(false);
    try {
      toast({ title: 'Preparing CSV export…' });
      const params = new URLSearchParams();
      params.set('startDate', filters.startDate.toISOString());
      params.set('endDate',   filters.endDate.toISOString());
      if (filters.userId)     params.set('userId',     filters.userId);
      if (filters.entityType) params.set('entityType', filters.entityType.toLowerCase());
      if (filters.action)     params.set('action',     filters.action);
      params.set('limit', '10000'); params.set('offset', '0');
      const res = await apiGet<any>(`/api/admin/audit?${params}`);
      if (!res.ok) throw new Error();
      const entries: AuditEntry[] = res.data ?? [];
      const header = ['timestamp', 'userName', 'userEmail', 'action', 'activityCode', 'entityType', 'entityId', 'ipAddress', 'detailsSummary'];
      const rows = entries.map(e => [
        e.timestamp, e.user?.fullName ?? '', e.user?.email ?? '', e.action,
        e.activityCode ?? '', e.entityType, e.entityId ?? '', e.ipAddress ?? '',
        JSON.stringify(e.details ?? {}),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      const csv = [header.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const start = filters.startDate.toISOString().slice(0, 10);
      const end   = filters.endDate.toISOString().slice(0, 10);
      a.href = url; a.download = `ewms-audit-${start}-${end}.csv`;
      a.click(); URL.revokeObjectURL(url);
      toast({ title: `Exported ${entries.length} entries` });
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' });
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Audit Log"
        description="Complete activity trail of user and system actions with CSV export"
        actions={
          <div style={{ position: 'relative' }} ref={exportRef}>
            <Button variant="outline" size="sm" onClick={() => setShowExport(v => !v)}>
              <Download size={13} style={{ marginRight: 5 }} /> Export
            </Button>
            {showExport && (
              <div style={{ position: 'absolute', right: 0, top: '110%', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '6px 0', minWidth: 180, zIndex: 50 }}>
                <button onClick={() => setShowExport(false)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: 14.5, background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--foreground))' }}
                  onMouseDown={e => { e.stopPropagation(); }}>
                  Export as CSV — use button below table
                </button>
                <button style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', fontSize: 14.5, background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))' }}>
                  Export as PDF — coming soon
                </button>
              </div>
            )}
          </div>
        }
      />

      <ActivityLog onExport={handleExport} />
    </div>
  );
}
