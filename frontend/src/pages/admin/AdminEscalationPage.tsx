import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCcw, Bell, Mail, Headphones, Loader2 } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPut } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EscalationConfig {
  id: string;
  activityType: string;
  baseSlaHours: string | number;
  reminderPct: number;
  warningPct: number;
  escalationPct: number;
  blockerPct: number;
  channels: ChannelConfig | null;
  targets: TargetsConfig | null;
}

interface ChannelConfig {
  reminder?:   { email?: boolean; whatsapp?: boolean; sms?: boolean; freshdesk?: boolean };
  warning?:    { email?: boolean; whatsapp?: boolean; sms?: boolean; freshdesk?: boolean };
  escalation?: { email?: boolean; whatsapp?: boolean; sms?: boolean; freshdesk?: boolean };
  blocker?:    { email?: boolean; whatsapp?: boolean; sms?: boolean; freshdesk?: boolean };
}

interface LevelChannels {
  email?: boolean; whatsapp?: boolean; sms?: boolean; freshdesk?: boolean;
}

interface TargetsConfig {
  warning?:    { additionalRoles?: string[] };
  escalation?: { additionalRoles?: string[] };
  blocker?:    { additionalRoles?: string[]; freshdesk?: boolean };
}

interface Role { id: string; name: string }

// ─── Constants ─────────────────────────────────────────────────────────────────

const ACTIVITY_TYPE_LABELS: Record<string, { name: string; description: string }> = {
  doc_extraction_approval:     { name: 'Document extraction approval', description: 'Time to approve OCR-extracted fields' },
  gen_draft_review:            { name: 'Generation draft review',      description: 'Time to review system-generated drafts' },
  cross_validation_resolution: { name: 'Cross-validation resolution',  description: 'Time to resolve failed validations' },
  accounting_ticket_review:    { name: 'Accounting ticket review',     description: 'Time for finance to review tickets' },
  accounting_ticket_posting:   { name: 'Accounting ticket posting',    description: 'Time for finance to post to ERP' },
  gate_progression:            { name: 'Gate progression (overall)',   description: 'Total time allowed per gate' },
  partner_upload_expected:     { name: 'Partner upload expected',      description: 'Time for partner to upload expected docs' },
};

const DEFAULT_CHANNELS: ChannelConfig = {
  reminder:   { email: false, freshdesk: false },
  warning:    { email: true,  freshdesk: false },
  escalation: { email: true,  freshdesk: false },
  blocker:    { email: true,  freshdesk: true  },
};

const LEVEL_COLORS = {
  reminder:   { dot: '#3b82f6', border: '#3b82f6', label: 'Reminder',   cellBg: '#eff6ff22' },
  warning:    { dot: '#d97706', border: '#d97706', label: 'Warning',    cellBg: '#fffbeb33' },
  escalation: { dot: '#dc2626', border: '#dc2626', label: 'Escalation', cellBg: '#fef2f222' },
  blocker:    { dot: '#7f1d1d', border: '#7f1d1d', label: 'Blocker',    cellBg: '#fee2e233' },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: string | number): number {
  return typeof v === 'number' ? v : parseFloat(String(v)) || 0;
}

function formatHours(h: number): string {
  if (h === 0) return '0h';
  if (h >= 24 && h % 24 === 0) { const d = h / 24; return `${d} day${d === 1 ? '' : 's'}`; }
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rem = h - d * 24;
    return rem === 0 ? `${d}d` : `${d}d ${formatHoursShort(rem)}`;
  }
  return formatHoursShort(h);
}

function formatHoursShort(h: number): string {
  if (h >= 1) {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
  }
  return `${Math.round(h * 60)}m`;
}

function displayBase(h: number): string {
  if (h >= 24 && h % 24 === 0) return `${h / 24} day${h / 24 === 1 ? '' : 's'} (= ${h}h)`;
  return formatHours(h);
}

// ─── SlaRow ────────────────────────────────────────────────────────────────────

interface SlaRowProps {
  config: EscalationConfig;
  onSave: (id: string, data: Partial<EscalationConfig>) => Promise<void>;
}

type EditField = 'base' | 'reminder' | 'warning' | 'esc' | 'blocker' | null;

function SlaRow({ config, onSave }: SlaRowProps) {
  const [base,     setBase]     = useState(String(toNum(config.baseSlaHours)));
  const [reminder, setReminder] = useState(config.reminderPct);
  const [warning,  setWarning]  = useState(config.warningPct);
  const [esc,      setEsc]      = useState(config.escalationPct);
  const [blocker,  setBlocker]  = useState(config.blockerPct);
  const [hovered,  setHovered]  = useState(false);
  const [editing,  setEditing]  = useState<EditField>(null);
  const [saving,   setSaving]   = useState(false);

  const { toast } = useToast();
  const baseH = parseFloat(base) || 0;

  const actLabel = ACTIVITY_TYPE_LABELS[config.activityType] ?? {
    name: config.activityType, description: '',
  };

  async function saveFld(field: string, value: number) {
    setSaving(true);
    try {
      await onSave(config.id, { [field]: value } as Partial<EscalationConfig>);
      toast({ title: field === 'baseSlaHours' ? 'SLA updated' : 'Threshold updated' });
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
    setEditing(null);
  }

  function handleBaseBlur() {
    const h = parseFloat(base);
    if (!isNaN(h) && h > 0) saveFld('baseSlaHours', h);
    else setEditing(null);
  }

  function resetDefaults() {
    setReminder(50); setWarning(75); setEsc(100); setBlocker(150);
    onSave(config.id, { reminderPct: 50, warningPct: 75, escalationPct: 100, blockerPct: 150 })
      .then(() => toast({ title: 'Reset to defaults' }))
      .catch(() => toast({ title: 'Reset failed', variant: 'destructive' }));
  }

  const rH = (baseH * reminder) / 100;
  const wH = (baseH * warning)  / 100;
  const eH = (baseH * esc)      / 100;
  const bH = (baseH * blocker)  / 100;
  const total = bH || 1;

  const showTimeline = hovered || editing !== null;

  const tdBase: React.CSSProperties = {
    padding: '12px 10px', verticalAlign: 'middle',
    borderBottom: '1px solid hsl(var(--border))',
  };
  const monoS: React.CSSProperties = { fontFamily: 'monospace', fontSize: 14 };

  // ── per-level percentage cell ──────────────────────────────────────────────
  type PctLevel = 'reminder' | 'warning' | 'esc' | 'blocker';
  const PCT_META: Record<PctLevel, { value: number; set: (v: number) => void; saveKey: string; color: string; cellBg: string }> = {
    reminder: { value: reminder, set: setReminder, saveKey: 'reminderPct',   color: LEVEL_COLORS.reminder.dot,   cellBg: LEVEL_COLORS.reminder.cellBg },
    warning:  { value: warning,  set: setWarning,  saveKey: 'warningPct',    color: LEVEL_COLORS.warning.dot,    cellBg: LEVEL_COLORS.warning.cellBg  },
    esc:      { value: esc,      set: setEsc,       saveKey: 'escalationPct', color: LEVEL_COLORS.escalation.dot, cellBg: LEVEL_COLORS.escalation.cellBg },
    blocker:  { value: blocker,  set: setBlocker,  saveKey: 'blockerPct',    color: LEVEL_COLORS.blocker.dot,    cellBg: LEVEL_COLORS.blocker.cellBg  },
  };

  function PctCell({ level }: { level: PctLevel }) {
    const m = PCT_META[level];
    const isEditing = editing === level;
    const computed  = formatHours((baseH * m.value) / 100);
    return (
      <td style={{ ...tdBase, background: m.cellBg, textAlign: 'center', minWidth: 90 }}>
        {isEditing ? (
          <input
            autoFocus
            type="number"
            min={1}
            max={999}
            value={m.value}
            style={{
              ...monoS, width: 54, textAlign: 'center',
              padding: '3px 5px', borderRadius: 4,
              border: `1px solid ${m.color}`,
              background: 'hsl(var(--background))',
              color: 'hsl(var(--foreground))',
            }}
            onChange={e => m.set(Number(e.target.value))}
            onBlur={() => saveFld(m.saveKey, m.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  saveFld(m.saveKey, m.value);
              if (e.key === 'Escape') setEditing(null);
            }}
          />
        ) : (
          <button
            onClick={() => setEditing(level)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
              borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}
            title="Click to edit"
          >
            <span style={{ ...monoS, fontSize: 14.5, color: m.color, fontWeight: 600 }}>{m.value}%</span>
            <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{computed}</span>
          </button>
        )}
      </td>
    );
  }

  return (
    <>
      <tr
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { if (!editing) setHovered(false); }}
        style={{ background: hovered ? 'hsl(var(--muted) / 0.25)' : 'hsl(var(--card))', transition: 'background 0.15s' }}
      >
        {/* Activity type */}
        <td style={{ ...tdBase, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{actLabel.name}</div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{actLabel.description}</div>
          {saving && <Loader2 size={10} className="animate-spin" style={{ marginTop: 3, color: 'hsl(var(--muted-foreground))' }} />}
        </td>

        {/* Base SLA */}
        <td style={{ ...tdBase, minWidth: 120, textAlign: 'center' }}>
          {editing === 'base' ? (
            <input
              autoFocus
              type="number"
              min={0.5}
              step={0.5}
              value={base}
              style={{
                ...monoS, width: 72, padding: '3px 6px', borderRadius: 4,
                border: '1px solid hsl(var(--border))',
                background: 'hsl(var(--background))',
                color: 'hsl(var(--foreground))',
              }}
              onChange={e => setBase(e.target.value)}
              onBlur={handleBaseBlur}
              onKeyDown={e => {
                if (e.key === 'Enter')  handleBaseBlur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button
              onClick={() => setEditing('base')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              title="Click to edit"
            >
              <span style={{ ...monoS, fontSize: 14 }}>{displayBase(baseH)}</span>
            </button>
          )}
        </td>

        <PctCell level="reminder" />
        <PctCell level="warning"  />
        <PctCell level="esc"      />
        <PctCell level="blocker"  />

        {/* Reset */}
        <td style={{ ...tdBase, textAlign: 'center' }}>
          <button
            onClick={resetDefaults}
            title="Reset to default thresholds (50 / 75 / 100 / 150)"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'hsl(var(--muted-foreground))', padding: 4, borderRadius: 4,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))'; }}
          >
            <RotateCcw size={14} />
          </button>
        </td>
      </tr>

      {/* Timeline row — visible on hover / edit */}
      {showTimeline && baseH > 0 && (
        <tr style={{ background: 'hsl(var(--muted) / 0.12)' }}>
          <td colSpan={7} style={{ padding: '8px 16px 10px', borderBottom: '1px solid hsl(var(--border))' }}>
            {/* Coloured bar */}
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', height: 6, marginBottom: 5 }}>
              <div style={{ flex: rH,      background: '#16a34a' }} />
              <div style={{ flex: Math.max(wH - rH, 0), background: '#3b82f6' }} />
              <div style={{ flex: Math.max(eH - wH, 0), background: '#d97706' }} />
              <div style={{ flex: Math.max(bH - eH, 0), background: '#dc2626' }} />
            </div>
            {/* Breakpoint labels */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
              <div style={{ textAlign: 'left' }}>
                <span style={{ color: '#3b82f6', fontWeight: 600 }}>▸ {formatHours(rH)}</span><br />
                Reminder (in-app)
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ color: '#d97706', fontWeight: 600 }}>▸ {formatHours(wH)}</span><br />
                Warning (+email)
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>▸ {formatHours(eH)}</span><br />
                Escalation (+banner)
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: '#7f1d1d', fontWeight: 600 }}>▸ {formatHours(bH)}</span><br />
                Blocker (STOP)
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── ChannelMatrix ─────────────────────────────────────────────────────────────

interface ChannelMatrixProps {
  channels: ChannelConfig;
  onChange: (level: keyof ChannelConfig, ch: string, val: boolean) => void;
}

const CHANNEL_COLS = [
  { key: 'email',     label: 'Email',     Icon: Mail },
  { key: 'freshdesk', label: 'Ticket', Icon: Headphones },
] as const;

const LEVEL_ROWS: { level: keyof ChannelConfig; sub: string }[] = [
  { level: 'reminder',   sub: 'Notification' },
  { level: 'warning',    sub: 'Notification + supervisor' },
  { level: 'escalation', sub: 'Notification + manager' },
  { level: 'blocker',    sub: 'Workflow stops' },
];

function ChannelMatrix({ channels, onChange }: ChannelMatrixProps) {
  const thS: React.CSSProperties = {
    padding: '8px 12px', fontSize: 14.5, fontWeight: 700,
    color: 'hsl(var(--muted-foreground))', textAlign: 'center',
    borderBottom: '1px solid hsl(var(--border))',
    background: 'hsl(var(--muted) / 0.5)',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const tdS: React.CSSProperties = {
    padding: '11px 12px', textAlign: 'center',
    borderBottom: '1px solid hsl(var(--border))',
  };

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 10,
      border: '1px solid hsl(var(--border))', overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thS, textAlign: 'left', width: 210 }}>Level</th>
            <th style={thS}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <Bell size={13} /><span>In-app</span>
              </div>
            </th>
            {CHANNEL_COLS.map(({ key, label, Icon }) => (
              <th key={key} style={thS}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <Icon size={13} /><span>{label}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LEVEL_ROWS.map(({ level, sub }, rowIdx) => {
            const cfg  = (channels[level] ?? {}) as LevelChannels;
            const lc   = LEVEL_COLORS[level];
            const isLast = rowIdx === LEVEL_ROWS.length - 1;
            return (
              <tr key={level}>
                <td style={{ ...tdS, textAlign: 'left', borderBottom: isLast ? 'none' : tdS.borderBottom }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: lc.dot, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{lc.label}</div>
                      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{sub}</div>
                    </div>
                  </div>
                </td>
                {/* In-app — always on */}
                <td style={{ ...tdS, borderBottom: isLast ? 'none' : tdS.borderBottom }}>
                  <input type="checkbox" checked disabled style={{ accentColor: 'hsl(173 58% 39%)' }} />
                </td>
                {CHANNEL_COLS.map(({ key }) => (
                  <td key={key} style={{ ...tdS, borderBottom: isLast ? 'none' : tdS.borderBottom }}>
                    <input
                      type="checkbox"
                      checked={!!(cfg[key as keyof LevelChannels])}
                      onChange={e => onChange(level, key, e.target.checked)}
                      style={{ accentColor: lc.dot, cursor: 'pointer', width: 15, height: 15 }}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{
        padding: '9px 14px', fontSize: 14.5, color: 'hsl(var(--muted-foreground))',
        background: 'hsl(var(--muted) / 0.3)', borderTop: '1px solid hsl(var(--border))',
      }}>
        Creates a support ticket via your ticketing integration when a blocker fires.
      </div>
    </div>
  );
}

// ─── RoleMultiSelect ───────────────────────────────────────────────────────────

function RoleMultiSelect({
  selected, roles, onChange,
}: { selected: string[]; roles: Role[]; onChange: (v: string[]) => void }) {
  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name]);
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {roles.map(r => {
        const active = selected.includes(r.name);
        return (
          <button
            key={r.id}
            onClick={() => toggle(r.name)}
            style={{
              fontSize: 14.5, padding: '2px 9px', borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${active ? 'hsl(173 58% 39%)' : 'hsl(var(--border))'}`,
              background: active ? 'hsl(173 58% 39% / 0.1)' : 'hsl(var(--background))',
              color: active ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
              fontWeight: active ? 600 : 400,
            }}
          >
            {r.name}
          </button>
        );
      })}
      {roles.length === 0 && (
        <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>No roles loaded</span>
      )}
    </div>
  );
}

// ─── TargetCards ───────────────────────────────────────────────────────────────

interface TargetCardsProps {
  targets: TargetsConfig;
  roles: Role[];
  onChange: (targets: TargetsConfig) => void;
}

type EditableLevel = 'warning' | 'escalation' | 'blocker';

interface CardDef {
  key: 'reminder' | EditableLevel;
  lc: typeof LEVEL_COLORS['reminder'];
  pct: string;
  target: string;
  desc: string;
  editable: boolean;
}

const TARGET_CARDS: CardDef[] = [
  {
    key: 'reminder', lc: LEVEL_COLORS.reminder, pct: '50% of SLA',
    target: 'Assignee only',
    desc: 'The user assigned to the task receives an in-app notification.',
    editable: false,
  },
  {
    key: 'warning', lc: LEVEL_COLORS.warning, pct: '75% of SLA',
    target: 'Assignee + Direct supervisor',
    desc: 'L+1 in the same team. If assignee is L1, supervisor is L2. If L2, supervisor is L3.',
    editable: true,
  },
  {
    key: 'escalation', lc: LEVEL_COLORS.escalation, pct: '100% of SLA',
    target: 'Assignee + L+1 + L+2 (team manager)',
    desc: 'Full escalation chain is notified and the dashboard shows a warning banner.',
    editable: true,
  },
  {
    key: 'blocker', lc: LEVEL_COLORS.blocker, pct: '150% of SLA',
    target: 'All above + Ops Manager + configurable recipients',
    desc: 'Workflow stops. All listed recipients are notified. Dashboard shows blocker banner.',
    editable: true,
  },
];

function TargetCards({ targets, roles, onChange }: TargetCardsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {TARGET_CARDS.map(({ key, lc, pct, target, desc, editable }) => {
        const lvl = targets[key as keyof TargetsConfig] as { additionalRoles?: string[]; freshdesk?: boolean } | undefined;
        const additionalRoles = lvl?.additionalRoles ?? [];
        const freshdeskOn     = key === 'blocker' ? (lvl?.freshdesk ?? false) : false;

        return (
          <div key={key} style={{
            background: 'hsl(var(--card))', borderRadius: 8, padding: 16,
            border: `1px solid hsl(var(--border))`,
            borderLeft: `3px solid ${lc.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{lc.label}</span>
              <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{pct}</span>
            </div>
            <div style={{ fontSize: 14.5, marginBottom: 4 }}>{target}</div>
            <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{desc}</div>

            {editable && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>
                  Additional recipients
                </div>
                <RoleMultiSelect
                  selected={additionalRoles}
                  roles={roles}
                  onChange={newRoles => onChange({
                    ...targets,
                    [key]: { ...(lvl ?? {}), additionalRoles: newRoles },
                  })}
                />
              </div>
            )}

            {key === 'blocker' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={freshdeskOn}
                  onChange={e => onChange({
                    ...targets,
                    blocker: { ...(lvl ?? {}), freshdesk: e.target.checked },
                  })}
                  style={{ accentColor: LEVEL_COLORS.blocker.dot, cursor: 'pointer', width: 14, height: 14 }}
                />
                <span style={{ fontSize: 14 }}>Create support ticket on blocker</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminEscalationPage() {
  const { toast } = useToast();

  const { roles } = useConfig();
  const [configs,  setConfigs]  = useState<EscalationConfig[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [channels, setChannels] = useState<ChannelConfig>(DEFAULT_CHANNELS);
  const [targets,  setTargets]  = useState<TargetsConfig>({});

  const savingChannels = useRef(false);
  const savingTargets  = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const escRes = await apiGet<any>('/api/admin/escalation');
      if (escRes.ok) {
        const cfgs: EscalationConfig[] = escRes.data ?? [];
        setConfigs(cfgs);
        const first = cfgs[0];
        if (first?.channels)  setChannels(first.channels as ChannelConfig);
        if (first?.targets)   setTargets(first.targets   as TargetsConfig);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveConfig(id: string, data: Partial<EscalationConfig>) {
    const res = await apiPut<any>(`/api/admin/escalation/${id}`, data);
    if (res.ok) {
      setConfigs(prev => prev.map(c => c.id === id ? { ...c, ...res.data } : c));
    } else {
      throw new Error('Failed');
    }
  }

  async function handleChannelChange(level: keyof ChannelConfig, ch: string, val: boolean) {
    const next: ChannelConfig = {
      ...channels,
      [level]: { ...(channels[level] ?? {}), [ch]: val },
    };
    setChannels(next);
    if (savingChannels.current) return;
    savingChannels.current = true;
    try {
      await Promise.all(configs.map(c => apiPut(`/api/admin/escalation/${c.id}`, { channels: next })));
      toast({ title: 'Channel updated' });
    } catch {
      toast({ title: 'Channel save failed', variant: 'destructive' });
    }
    savingChannels.current = false;
  }

  async function handleTargetsChange(next: TargetsConfig) {
    setTargets(next);
    if (savingTargets.current) return;
    savingTargets.current = true;
    try {
      await Promise.all(configs.map(c => apiPut(`/api/admin/escalation/${c.id}`, { targets: next })));
      toast({ title: 'Escalation targets saved' });
    } catch {
      toast({ title: 'Targets save failed', variant: 'destructive' });
    }
    savingTargets.current = false;
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 10px', fontSize: 14.5, fontWeight: 700,
    color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase',
    letterSpacing: '0.05em', textAlign: 'center',
    borderBottom: '1px solid hsl(var(--border))',
    background: 'hsl(var(--muted) / 0.5)',
  };

  return (
    <div>
      <AdminPageHeader
        title="Escalation Configuration"
        description="SLA timers, notification channels, and escalation targets per activity type"
        badge={{ label: 'activity types', count: configs.length }}
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />
        </div>
      ) : (
        <>
          {/* ── SLA Table ── */}
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 16, lineHeight: 1.6 }}>
              Each activity type has a base SLA. When a task approaches or exceeds its SLA, the system escalates through
              4 levels:&nbsp;
              <strong style={{ color: '#3b82f6' }}>Reminder</strong> →&nbsp;
              <strong style={{ color: '#d97706' }}>Warning</strong> →&nbsp;
              <strong style={{ color: '#dc2626' }}>Escalation</strong> →&nbsp;
              <strong style={{ color: '#7f1d1d' }}>Blocker</strong>.&nbsp;
              Thresholds are percentages of the base SLA. Click any value to edit inline.
            </p>

            <div style={{
              background: 'hsl(var(--card))', borderRadius: 10,
              border: '1px solid hsl(var(--border))', overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Activity Type</th>
                    <th style={{ ...thStyle, minWidth: 120 }}>Base SLA</th>
                    <th style={{ ...thStyle, minWidth: 90 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLORS.reminder.dot }} />
                        Reminder
                      </div>
                    </th>
                    <th style={{ ...thStyle, minWidth: 90 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLORS.warning.dot }} />
                        Warning
                      </div>
                    </th>
                    <th style={{ ...thStyle, minWidth: 90 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLORS.escalation.dot }} />
                        Escalation
                      </div>
                    </th>
                    <th style={{ ...thStyle, minWidth: 90 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLORS.blocker.dot }} />
                        Blocker
                      </div>
                    </th>
                    <th style={{ ...thStyle, minWidth: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {configs.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
                        No escalation configs found. Run the seed script to populate activity types.
                      </td>
                    </tr>
                  ) : (
                    configs.map(c => (
                      <SlaRow key={c.id} config={c} onSave={saveConfig} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Notification Channels ── */}
          <AdminFormSection
            title="Notification Channels"
            description="Configure which channels are used at each escalation level"
          >
            <ChannelMatrix channels={channels} onChange={handleChannelChange} />
          </AdminFormSection>

          {/* ── Escalation Targets ── */}
          <AdminFormSection
            title="Escalation Targets"
            description="Who receives notifications at each escalation level"
            isLast
          >
            <TargetCards targets={targets} roles={roles} onChange={handleTargetsChange} />
          </AdminFormSection>
        </>
      )}
    </div>
  );
}
