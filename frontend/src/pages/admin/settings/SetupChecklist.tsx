import { useState, useEffect } from 'react';
import { Check, AlertTriangle, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { apiUrl, getAuthToken, readJsonResponse } from '@/lib/api';

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* ── Colour tokens ────────────────────────────────────────── */
const T = {
  bg:          'hsl(var(--background))',
  surface:     'hsl(var(--card))',
  border:      'hsl(var(--border))',
  teal:        'hsl(var(--primary))',
  tealDark:    'hsl(var(--primary))',
  tealLight:   'hsl(var(--primary) / 0.30)',
  tealBg:      'hsl(var(--primary) / 0.10)',
  green:       'hsl(var(--vs-success))',
  greenBg:     'hsl(var(--vs-success) / 0.12)',
  greenBorder: 'hsl(var(--vs-success) / 0.30)',
  amber:       'hsl(var(--vs-warning))',
  amberBg:     'hsl(var(--vs-warning) / 0.10)',
  amberBorder: 'hsl(var(--vs-warning) / 0.30)',
  blue:        'hsl(var(--vs-info))',
  blueBg:      'hsl(var(--vs-info) / 0.10)',
  blueBorder:  'hsl(var(--vs-info) / 0.30)',
  purple:      'hsl(var(--vs-info))',
  purpleBg:    'hsl(var(--vs-info) / 0.10)',
  purpleBorder:'hsl(var(--vs-info) / 0.30)',
  slate900:    'hsl(var(--foreground))',
  slate500:    'hsl(var(--muted-foreground))',
  slate400:    'hsl(var(--muted-foreground))',
  border2:     'hsl(var(--border))',
};

/* ── Classification config ────────────────────────────────── */
type Classification = 'ships_ready' | 'confirm' | 'client_specific' | 'external';

const CLASS_CONFIG: Record<Classification, {
  icon: string; label: string; adminAction: string;
  color: string; bg: string; border: string;
}> = {
  ships_ready:     { icon: '✅', label: 'Ships ready',         adminAction: 'Use as-is',               color: T.green,  bg: T.greenBg,  border: T.greenBorder },
  confirm:         { icon: '🔍', label: 'Confirm',             adminAction: 'Review once',              color: T.blue,   bg: T.blueBg,   border: T.blueBorder },
  client_specific: { icon: '✏️', label: 'Client-specific',     adminAction: 'Must fill in',             color: T.amber,  bg: T.amberBg,  border: T.amberBorder },
  external:        { icon: '🔌', label: 'External dependency', adminAction: 'Coordinate with vendor',   color: T.purple, bg: T.purpleBg, border: T.purpleBorder },
};

/* ── Data interfaces ──────────────────────────────────────── */
interface ChecksData {
  orgProfile: boolean; orgName: string | null;
  userCount: number; teamCount: number;
  rolesConfigured: boolean;
  roleWarnings: { name: string; issue: string }[];
  templateCount: number; templateName: string | null;
  docTypeCount: number; validationCount: number;
  triggerCount: number; dndRateCount: number; ocrConnected: boolean;
}

type StepStatus = 'done' | 'warn' | 'pending';

interface Step {
  key: string;
  label: string;
  classification: Classification;
  defaultNote: string;
  statusDetail: string;
  status: StepStatus;
  section: string;
  warnings?: { name: string; issue: string }[];
}

interface Group { id: string; label: string; steps: Step[] }

/* ── Legend row ───────────────────────────────────────────── */
function Legend() {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      padding: '10px 16px',
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      marginBottom: 14,
    }}>
      <span style={{ fontSize: 14.5, fontWeight: 600, color: T.slate400, alignSelf: 'center', marginRight: 4, fontFamily: 'var(--app-font-sans)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Guide:
      </span>
      {(Object.entries(CLASS_CONFIG) as [Classification, typeof CLASS_CONFIG[Classification]][]).map(([key, cfg]) => (
        <span key={key} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 10px 3px 7px',
          background: cfg.bg, border: `1px solid ${cfg.border}`,
          borderRadius: 99,
        }}>
          <span style={{ fontSize: 14 }}>{cfg.icon}</span>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: cfg.color, fontFamily: 'var(--app-font-sans)' }}>{cfg.label}</span>
          <span style={{ fontSize: 14.5, color: T.slate400, fontFamily: 'var(--app-font-sans)' }}>— {cfg.adminAction}</span>
        </span>
      ))}
    </div>
  );
}

/* ── Progress bar ─────────────────────────────────────────── */
function ProgressBar({ groups }: { groups: Group[] }) {
  const all       = groups.flatMap(g => g.steps);
  const done      = all.filter(s => s.status === 'done').length;
  const warn      = all.filter(s => s.status === 'warn').length;
  const total     = all.length;
  const pct       = Math.round(((done + warn * 0.5) / total) * 100);
  const pending   = total - done - warn;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 16px',
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 8, marginBottom: 20,
    }}>
      <div style={{ flex: 1, height: 7, background: T.border, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99,
          background: `linear-gradient(90deg, ${T.teal}, ${T.green})`,
          width: `${pct}%`, transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: T.teal, flexShrink: 0, fontFamily: 'var(--app-font-sans)' }}>
        {pct}%
      </span>
      <span style={{ fontSize: 14, color: T.slate400, flexShrink: 0, fontFamily: 'var(--app-font-sans)' }}>
        {done} done · {warn > 0 ? `${warn} warn · ` : ''}{pending} pending
      </span>
    </div>
  );
}

/* ── Status badge ─────────────────────────────────────────── */
function StatusBadge({ step }: { step: Step }) {
  const { status, statusDetail, warnings } = step;

  if (status === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Badge intent="success" size="sm" leadingIcon={<Check className="size-3" />}>
          {statusDetail || 'Configured'}
        </Badge>
      </div>
    );
  }
  if (status === 'warn') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Badge intent="warning" size="sm" leadingIcon={<AlertTriangle className="size-3" />}>
          {statusDetail || 'Needs attention'}
        </Badge>
        {warnings?.map((w, i) => (
          <span key={i} style={{ fontSize: 14, color: T.amber, fontFamily: 'var(--app-font-sans)', paddingLeft: 15 }}>
            {w.name}: {w.issue}
          </span>
        ))}
      </div>
    );
  }
  return (
    <span style={{
      fontSize: 14.5, color: T.slate400,
      fontFamily: 'var(--app-font-sans)',
    }}>
      {statusDetail || 'Not set'}
    </span>
  );
}

/* ── Table ────────────────────────────────────────────────── */
function SetupTable({ groups, onNavigate }: { groups: Group[]; onNavigate: (s: string) => void }) {
  const COL = {
    name:    { width: 180, flexShrink: 0 },
    cls:     { width: 160, flexShrink: 0 },
    note:    { flex: 1, minWidth: 0 },
    status:  { width: 200, flexShrink: 0 },
    action:  { width: 28, flexShrink: 0 },
  };

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {/* Table header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '9px 16px',
        borderBottom: `1px solid ${T.border}`,
        background: 'hsl(var(--muted)/0.4)',
      }}>
        <span style={{ ...COL.name, fontSize: 14, fontWeight: 700, color: T.slate400, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--app-font-sans)', display: 'block' }}>Item</span>
        <span style={{ ...COL.cls,  fontSize: 14, fontWeight: 700, color: T.slate400, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--app-font-sans)', display: 'block' }}>Classification</span>
        <span style={{ ...COL.note, fontSize: 14, fontWeight: 700, color: T.slate400, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--app-font-sans)', display: 'block' }}>Default / Note</span>
        <span style={{ ...COL.status, fontSize: 14, fontWeight: 700, color: T.slate400, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--app-font-sans)', display: 'block' }}>Current status</span>
        <span style={{ ...COL.action, display: 'block' }} />
      </div>

      {/* Groups */}
      {groups.map((group, gi) => (
        <div key={group.id}>
          {/* Section header */}
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '7px 16px',
            background: 'hsl(var(--muted)/0.25)',
            borderTop: gi > 0 ? `1px solid ${T.border}` : undefined,
          }}>
            <span style={{
              fontSize: 14, fontWeight: 700, color: T.slate400,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              fontFamily: 'var(--app-font-sans)',
            }}>
              {group.label}
            </span>
          </div>

          {/* Steps */}
          {group.steps.map((step, si) => {
            const cls = CLASS_CONFIG[step.classification];
            const isLast = si === group.steps.length - 1;
            return (
              <div
                key={step.key}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate(step.section)}
                onKeyDown={e => e.key === 'Enter' && onNavigate(step.section)}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: '11px 16px',
                  borderTop: `1px solid ${T.border}`,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                  outline: 'none',
                  position: 'relative',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--muted)/0.3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Left accent line — classification colour */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: 3, background: cls.color,
                }} />

                {/* Item name */}
                <div style={{ ...COL.name, paddingLeft: 8 }}>
                  <span style={{
                    fontSize: 14.5, fontWeight: 600, color: T.slate900,
                    fontFamily: 'var(--app-font-sans)',
                  }}>
                    {step.label}
                  </span>
                </div>

                {/* Classification pill */}
                <div style={COL.cls}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px 2px 6px',
                    background: cls.bg, border: `1px solid ${cls.border}`,
                    borderRadius: 99,
                  }}>
                    <span style={{ fontSize: 14 }}>{cls.icon}</span>
                    <span style={{
                      fontSize: 14.5, fontWeight: 700, color: cls.color,
                      fontFamily: 'var(--app-font-sans)',
                    }}>
                      {cls.label}
                    </span>
                  </span>
                </div>

                {/* Default note */}
                <div style={{ ...COL.note, paddingRight: 24 }}>
                  <span style={{
                    fontSize: 14, color: T.slate400, lineHeight: 1.4,
                    fontFamily: 'var(--app-font-sans)',
                  }}>
                    {step.defaultNote}
                  </span>
                </div>

                {/* Status */}
                <div style={COL.status}>
                  <StatusBadge step={step} />
                </div>

                {/* Navigate arrow */}
                <div style={COL.action}>
                  <ChevronRight size={14} color={T.slate400} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Go Live Banner ───────────────────────────────────────── */
function GoLiveBanner({ attentionCount, onNavigate }: { attentionCount: number; onNavigate: (s: string) => void }) {
  if (attentionCount === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: T.tealBg, border: `2px solid ${T.tealLight}`,
        borderRadius: 8, padding: '14px 20px', marginTop: 20,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: T.teal, borderRadius: '12px 0 0 12px' }} />
        <Check size={18} color={T.green} strokeWidth={2.5} style={{ flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.tealDark, fontFamily: 'var(--app-font-sans)' }}>
            Your workflow is live
          </div>
          <div style={{ fontSize: 14, color: T.slate500, marginTop: 2, fontFamily: 'var(--app-font-sans)' }}>
            All setup steps complete — export workflow engine is active.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
      background: T.tealBg, border: `2px solid ${T.tealLight}`,
      borderRadius: 8, padding: '14px 20px', marginTop: 20,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: T.teal, borderRadius: '12px 0 0 12px' }} />
      <div style={{ paddingLeft: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.tealDark, fontFamily: 'var(--app-font-sans)' }}>
          Ready to go live?
        </div>
        <div style={{ fontSize: 14, color: T.slate500, marginTop: 2, fontFamily: 'var(--app-font-sans)' }}>
          {attentionCount} item{attentionCount > 1 ? 's' : ''} still need attention before your workflow is fully active.
        </div>
      </div>
      <button
        onClick={() => onNavigate('team')}
        style={{
          padding: '9px 18px', fontSize: 14.5, fontWeight: 700,
          background: T.teal, color: '#fff',
          border: 'none', borderRadius: 8, cursor: 'pointer',
          fontFamily: 'var(--app-font-sans)',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        Complete Setup →
      </button>
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────── */
function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ height: 44, background: T.border, borderRadius: 8, opacity: 0.5 }} />
      <div style={{ height: 24, background: T.border, borderRadius: 8, opacity: 0.4, width: '60%' }} />
      <div style={{ height: 280, background: T.border, borderRadius: 8, opacity: 0.35 }} />
    </div>
  );
}

/* ── Main component ───────────────────────────────────────── */
export default function SetupChecklist({
  onNavigate,
  onProgress,
}: {
  onNavigate: (section: string) => void;
  onProgress?: (pct: number, attentionCount: number) => void;
}) {
  const [checks, setChecks] = useState<ChecksData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl('/api/admin/settings/setup-status'), { headers: authHeaders() })
      .then(readJsonResponse)
      .then(d => { setChecks(d.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!checks || !onProgress) return;
    const st = (ok: boolean, warn?: boolean): StepStatus => warn ? 'warn' : ok ? 'done' : 'pending';
    const all: StepStatus[] = [
      st(checks.orgProfile),
      st(checks.userCount > 0),
      st(checks.rolesConfigured, checks.roleWarnings.length > 0),
      st(checks.templateCount > 0),
      st(checks.docTypeCount > 0),
      st(checks.validationCount > 0),
      st(checks.triggerCount > 0),
      st(checks.dndRateCount > 0),
      st(checks.ocrConnected),
      'done' as StepStatus,
    ];
    const done    = all.filter(s => s === 'done').length;
    const warn    = all.filter(s => s === 'warn').length;
    const total   = all.length;
    const pct     = Math.round(((done + warn * 0.5) / total) * 100);
    const attn    = all.filter(s => s !== 'done').length;
    onProgress(pct, attn);
  }, [checks]);

  if (loading) return <Skeleton />;
  if (!checks) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: T.slate400, fontFamily: 'var(--app-font-sans)' }}>
      Failed to load setup status.
    </div>
  );

  const st = (ok: boolean, warn?: boolean): StepStatus => warn ? 'warn' : ok ? 'done' : 'pending';

  const groups: Group[] = [
    {
      id: 'team', label: 'Team & Access',
      steps: [
        {
          key: 'org', label: 'Company Profile', section: 'team',
          classification: 'client_specific',
          defaultNote: 'Legal entity name, registered address, IEC — every company is different.',
          status: st(checks.orgProfile),
          statusDetail: checks.orgProfile ? (checks.orgName || 'Configured') : 'Not set',
        },
        {
          key: 'users', label: 'Team Members', section: 'team',
          classification: 'client_specific',
          defaultNote: 'Invite your ops, finance, and logistics staff. Roles are pre-configured — just add people.',
          status: st(checks.userCount > 0),
          statusDetail: checks.userCount > 0 ? `${checks.userCount} active member${checks.userCount !== 1 ? 's' : ''}` : 'No members yet',
        },
        {
          key: 'roles', label: 'Access Profiles', section: 'team',
          classification: 'confirm',
          defaultNote: 'Standard roles (Ops, Finance, Logistics, 3PL Partner) pre-built. Review permissions before going live.',
          status: st(checks.rolesConfigured, checks.roleWarnings.length > 0),
          statusDetail: checks.roleWarnings.length > 0
            ? `${checks.roleWarnings.length} profile${checks.roleWarnings.length > 1 ? 's' : ''} need review`
            : checks.rolesConfigured ? 'Configured' : 'Not configured',
          warnings: checks.roleWarnings,
        },
      ],
    },
    {
      id: 'workflow', label: 'Workflow & Documents',
      steps: [
        {
          key: 'template', label: 'Workflow Template', section: 'workflow',
          classification: 'ships_ready',
          defaultNote: 'Standard India-to-US steel export workflow with 5 gate checkpoints — pre-built and active.',
          status: st(checks.templateCount > 0),
          statusDetail: checks.templateCount > 0 ? (checks.templateName || `${checks.templateCount} active`) : 'No active template',
        },
        {
          key: 'docs', label: 'Document Types', section: 'workflow',
          classification: 'ships_ready',
          defaultNote: 'All standard export docs pre-registered: Invoice, BOL, Packing List, COO, CHA, POD, GRN, and more.',
          status: st(checks.docTypeCount > 0),
          statusDetail: checks.docTypeCount > 0 ? `${checks.docTypeCount} types registered` : 'None registered',
        },
      ],
    },
    {
      id: 'validation', label: 'Validation Rules',
      steps: [
        {
          key: 'validation', label: 'Validation Rules', section: 'validation',
          classification: 'ships_ready',
          defaultNote: 'Industry-standard document checks (invoice amount, weight tolerance, BOL match) active by default.',
          status: st(checks.validationCount > 0),
          statusDetail: checks.validationCount > 0 ? `${checks.validationCount} rules active` : 'No rules',
        },
      ],
    },
    {
      id: 'finance', label: 'Finance & Cost',
      steps: [
        {
          key: 'triggers', label: 'Finance Triggers', section: 'finance',
          classification: 'confirm',
          defaultNote: 'Auto-creates accounting tickets on approval. Confirm trigger codes match your ERP entries.',
          status: st(checks.triggerCount > 0),
          statusDetail: checks.triggerCount > 0 ? `${checks.triggerCount} active` : 'None configured',
        },
        {
          key: 'dnd', label: 'D&D Rates', section: 'finance',
          classification: 'client_specific',
          defaultNote: 'Demurrage & detention rates vary by port, terminal, and shipping line contract.',
          status: st(checks.dndRateCount > 0),
          statusDetail: checks.dndRateCount > 0 ? `${checks.dndRateCount} port rate${checks.dndRateCount !== 1 ? 's' : ''}` : 'None entered',
        },
      ],
    },
    {
      id: 'system', label: 'System & Integrations',
      steps: [
        {
          key: 'ocr', label: 'OCR Integration', section: 'system',
          classification: 'external',
          defaultNote: 'Python document-AI service on port 8099. Deploy and connect before processing documents.',
          status: st(checks.ocrConnected),
          statusDetail: checks.ocrConnected ? 'Connected on port 8099' : 'Service unreachable',
        },
        {
          key: 'audit', label: 'Audit Logging', section: 'system',
          classification: 'ships_ready',
          defaultNote: 'Full audit trail on by default. Every action is recorded automatically.',
          status: 'done',
          statusDetail: 'Active',
        },
      ],
    },
  ];

  const allSteps      = groups.flatMap(g => g.steps);
  const pendingCount  = allSteps.filter(s => s.status !== 'done').length;

  return (
    <div style={{ width: '100%' }}>
      {/* Page heading */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{
          fontSize: 26, fontWeight: 700, color: T.slate900,
          fontFamily: 'var(--app-font-sans)',
          margin: 0, lineHeight: 1.1,
        }}>
          Setup Checklist
        </h1>
        <p style={{ fontSize: 14.5, color: T.slate500, marginTop: 5, fontFamily: 'var(--app-font-sans)' }}>
          Defaults are set for a standard India-to-US manufacturing exporter. Review ✏️ client-specific items and connect 🔌 external services.
        </p>
      </div>

      {/* Legend */}
      <Legend />

      {/* Progress */}
      <ProgressBar groups={groups} />

      {/* Table */}
      <SetupTable groups={groups} onNavigate={onNavigate} />

      {/* Go live */}
      <GoLiveBanner attentionCount={pendingCount} onNavigate={onNavigate} />

      <div style={{ height: 8 }} />
    </div>
  );
}
