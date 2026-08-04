import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, FileText, Box, Clock, Layers, Truck, Ship,
  Package, ChevronDown, ChevronRight, CheckCircle2, Zap,
  ScanLine, Globe, Flag, RefreshCw, Settings2, Plus,
  ChevronDown as DropIcon, Receipt,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import {
  MilestoneAccountingTriggers,
  type AccountingTriggerOption,
  type AccountingTriggerRow,
} from '@/components/admin/MilestoneAccountingTriggers';

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface Gate {
  id: string; gateName: string; gateNumber: number; gateCheckType: string;
  isIdentityGate: boolean; slaHours: number; sortOrder: number;
}
interface Template { id: string; name: string; templateStatus?: string; status?: string; gates?: Gate[] }

interface Milestone {
  id: string;
  name: string;
  shortCode?: string;
  sequenceOrder?: number;
  systemCode?: string;
  accountingTriggers?: AccountingTriggerRow[];
}

interface DocType {
  id: string; typeCode: string; displayName: string; shortCode: string;
  geography: 'INDIA' | 'US' | 'BOTH'; hasExtraction: boolean; isActive: boolean; sortOrder: number;
}

type Phase = 'origin' | 'transit' | 'port' | 'warehouse' | 'delivery';

function inferPhase(name: string): Phase {
  const n = name.toLowerCase();
  if (n.includes('delivered') || n.includes('pod')) return 'delivery';
  if (n.includes('inventory recognized') || n.includes('departed') || n.includes('truck')) return 'origin';
  if (n.includes('3pl') || n.includes('warehouse') || n.includes('inward') || n.includes('outward') || n.includes('d&d') || n.includes('acknowledged') || n.includes('released to')) return 'warehouse';
  if (n.includes('customs') || n.includes('discharged') || n.includes('port') || n.includes('arrived') || n.includes('gate out') || n.includes('clearance') || n.includes('cleared') || n.includes('cargo') || n.includes('transship') || n.includes('container')) return 'port';
  if (n.includes('transit') || n.includes('in transit')) return 'transit';
  return 'transit';
}

const PHASE_CONFIG: Record<Phase, { label: string; color: string; bg: string; border: string; Icon: React.ComponentType<any> }> = {
  origin:    { label: 'Origin & Dispatch', color: '#6366F1', bg: 'rgba(99,102,241,0.10)',   border: 'rgba(99,102,241,0.25)',  Icon: Package },
  transit:   { label: 'In Transit',        color: '#0EA5E9', bg: 'rgba(14,165,233,0.10)',   border: 'rgba(14,165,233,0.25)',  Icon: Ship },
  port:      { label: 'US Port & Customs', color: '#D97706', bg: 'rgba(217,119,6,0.10)',    border: 'rgba(217,119,6,0.25)',   Icon: Layers },
  warehouse: { label: '3PL & Warehouse',   color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)',   border: 'rgba(139,92,246,0.25)', Icon: Box },
  delivery:  { label: 'Customer Delivery', color: '#10B981', bg: 'rgba(16,185,129,0.10)',   border: 'rgba(16,185,129,0.25)', Icon: Truck },
};

const PHASE_ORDER: Phase[] = ['origin', 'transit', 'port', 'warehouse', 'delivery'];
const GATE_PALETTE = ['#0D9488', '#6366F1', '#D97706', '#8B5CF6', '#10B981'];

function slaLabel(hours: number) {
  if (hours >= 24) return `${Math.round(hours / 24)}d SLA`;
  return `${hours}h SLA`;
}

function StatChip({ label, value, color, spinning }: { label: string; value: number | string; color: string; spinning?: boolean }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 10,
      padding: '12px 16px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{
        fontSize: 22, fontWeight: 700, color,
        fontFamily: "'Jura', monospace", lineHeight: 1,
        opacity: spinning ? 0.5 : 1, transition: 'opacity 0.2s',
      }}>{value}</span>
      <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontWeight: 500, letterSpacing: '0.02em' }}>
        {label}
      </span>
    </div>
  );
}

function GatePipeline({ gates }: { gates: Gate[] }) {
  const sorted = [...gates].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
      {sorted.map((g, i) => {
        const color = GATE_PALETTE[i % GATE_PALETTE.length];
        return (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', flex: '1 1 0', minWidth: 130 }}>
            <div style={{
              flex: 1, background: `${color}18`, border: `1px solid ${color}40`,
              borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: color, color: '#fff',
                  fontSize: 14, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Jura', monospace", flexShrink: 0,
                }}>{g.gateNumber}</div>
                {g.isIdentityGate && (
                  <span style={{
                    fontSize: 14.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                    background: '#D9770620', color: '#D97706', border: '1px solid #D9770640',
                    letterSpacing: '0.03em',
                  }}>ID GATE</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: 4, lineHeight: 1.3 }}>
                {g.gateName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 3, color: 'hsl(var(--muted-foreground))' }}>
                  <Clock size={9} /> {slaLabel(g.slaHours)}
                </span>
                <span style={{
                  fontSize: 14.5, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                  background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
                }}>
                  {g.gateCheckType === 'ALL_REQUIRED' ? 'ALL REQ' : g.gateCheckType}
                </span>
              </div>
            </div>
            {i < sorted.length - 1 && (
              <div style={{ padding: '0 4px', flexShrink: 0 }}>
                <ChevronRight size={14} style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.5 }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MilestoneCard({
  milestone, phaseColor, phaseBg, phaseBorder, triggerOptions, onTriggersChanged,
}: {
  milestone: Milestone;
  phaseColor: string;
  phaseBg: string;
  phaseBorder: string;
  triggerOptions: AccountingTriggerOption[];
  onTriggersChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggers = milestone.accountingTriggers ?? [];

  return (
    <div style={{ borderRadius: 7, background: phaseBg, border: `1px solid ${phaseBorder}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px' }}>
        <CheckCircle2 size={11} style={{ color: phaseColor, flexShrink: 0, opacity: 0.7 }} />
        <span style={{ fontSize: 14.5, color: 'hsl(var(--foreground))', lineHeight: 1.3, flex: 1 }}>{milestone.name}</span>
        {milestone.systemCode && (
          <button
            onClick={() => setOpen(o => !o)}
            title="Accounting triggers"
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 6px', borderRadius: 4, fontSize: 14.5, fontWeight: 600,
              background: triggers.length > 0 ? 'rgba(13,148,136,0.12)' : 'rgba(100,100,100,0.08)',
              color: triggers.length > 0 ? '#0D9488' : 'hsl(var(--muted-foreground))',
              border: `1px solid ${triggers.length > 0 ? 'rgba(13,148,136,0.25)' : 'hsl(var(--border))'}`,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <Receipt size={8} />
            {triggers.length > 0 ? triggers.length : '+'}
            {open ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
          </button>
        )}
      </div>

      {open && milestone.systemCode && (
        <div style={{
          borderTop: '1px solid rgba(13,148,136,0.2)',
          padding: '7px 9px 9px',
          background: 'rgba(13,148,136,0.04)',
        }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0D9488', letterSpacing: '0.04em', marginBottom: 5 }}>
            ACCOUNTING TRIGGERS
          </div>
          <MilestoneAccountingTriggers
            milestoneId={milestone.id}
            existingTriggers={triggers}
            options={triggerOptions}
            onChanged={onTriggersChanged}
          />
        </div>
      )}
    </div>
  );
}

function PhaseGroup({
  phase, milestones, defaultOpen, triggerOptions, onTriggersChanged,
}: {
  phase: Phase;
  milestones: Milestone[];
  defaultOpen?: boolean;
  triggerOptions: AccountingTriggerOption[];
  onTriggersChanged: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const cfg = PHASE_CONFIG[phase];
  const Icon = cfg.Icon;
  const totalTriggers = milestones.reduce((s, m) => s + (m.accountingTriggers?.length ?? 0), 0);
  return (
    <div style={{ border: `1px solid ${cfg.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: cfg.bg, border: 'none', cursor: 'pointer',
          padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <Icon size={13} style={{ color: cfg.color, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: cfg.color, flex: 1, textAlign: 'left' }}>{cfg.label}</span>
        {totalTriggers > 0 && (
          <span style={{
            fontSize: 14.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
            background: 'rgba(13,148,136,0.15)', color: '#0D9488',
            border: '1px solid rgba(13,148,136,0.3)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Receipt size={8} />{totalTriggers}
          </span>
        )}
        <span style={{
          fontSize: 14, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
          background: cfg.color, color: '#fff', fontFamily: "'Jura', monospace",
        }}>{milestones.length}</span>
        {open
          ? <ChevronDown size={12} style={{ color: cfg.color, flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: cfg.color, flexShrink: 0 }} />
        }
      </button>
      {open && (
        <div style={{
          padding: '10px 14px 12px', background: 'hsl(var(--card))',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6,
        }}>
          {milestones.map(m => (
            <MilestoneCard
              key={m.id}
              milestone={m}
              phaseColor={cfg.color}
              phaseBg={cfg.bg}
              phaseBorder={cfg.border}
              triggerOptions={triggerOptions}
              onTriggersChanged={onTriggersChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const GEO_CONFIG = {
  INDIA: { label: 'India', color: '#F97316', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.25)', flag: '🇮🇳' },
  US:    { label: 'United States', color: '#3B82F6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.25)', flag: '🇺🇸' },
  BOTH:  { label: 'India + US', color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.25)', flag: '🌐' },
};

function DocTypesCard({ docTypes, onConfigure }: { docTypes: DocType[]; onConfigure?: () => void }) {
  const [openGeo, setOpenGeo] = useState<Set<string>>(new Set(['INDIA', 'US', 'BOTH']));

  const toggleGeo = (geo: string) => setOpenGeo(prev => {
    const next = new Set(prev);
    next.has(geo) ? next.delete(geo) : next.add(geo);
    return next;
  });

  const withOCR = docTypes.filter(d => d.hasExtraction).length;
  const geoGroups: Record<string, DocType[]> = { INDIA: [], US: [], BOTH: [] };
  docTypes.forEach(d => { if (geoGroups[d.geography]) geoGroups[d.geography].push(d); });

  return (
    <div style={{
      background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={15} style={{ color: '#D97706' }} />
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>Document Types</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 14, padding: '2px 8px', borderRadius: 99, fontWeight: 600,
            background: 'rgba(217,119,6,0.12)', color: '#D97706',
            border: '1px solid rgba(217,119,6,0.3)',
          }}>{docTypes.length} registered</span>
          {onConfigure && (
            <button onClick={onConfigure} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, fontSize: 14.5, fontWeight: 500,
              background: 'rgba(217,119,6,0.08)', color: '#D97706',
              border: '1px solid rgba(217,119,6,0.25)', cursor: 'pointer',
            }}>
              <Plus size={10} /> Configure
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'OCR-enabled', value: withOCR, color: '#0D9488', bg: 'rgba(13,148,136,0.10)', Icon: ScanLine },
          { label: 'India docs',   value: geoGroups.INDIA.length, color: '#F97316', bg: 'rgba(249,115,22,0.10)', Icon: Flag },
          { label: 'US docs',      value: geoGroups.US.length,    color: '#3B82F6', bg: 'rgba(59,130,246,0.10)', Icon: Flag },
          { label: 'Both regions', value: geoGroups.BOTH.length,  color: '#8B5CF6', bg: 'rgba(139,92,246,0.10)', Icon: Globe },
        ].map(({ label, value, color, bg, Icon }) => (
          <div key={label} style={{
            flex: 1, background: bg, borderRadius: 8, padding: '8px 10px',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <Icon size={12} style={{ color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "'Jura', monospace", lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(['INDIA', 'US', 'BOTH'] as const).map(geo => {
          const items = geoGroups[geo];
          if (!items.length) return null;
          const cfg = GEO_CONFIG[geo];
          const isOpen = openGeo.has(geo);
          return (
            <div key={geo} style={{ border: `1px solid ${cfg.border}`, borderRadius: 9, overflow: 'hidden' }}>
              <button
                onClick={() => toggleGeo(geo)}
                style={{
                  width: '100%', background: cfg.bg, border: 'none', cursor: 'pointer',
                  padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 7,
                }}
              >
                <span style={{ fontSize: 14.5 }}>{cfg.flag}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: cfg.color, flex: 1, textAlign: 'left' }}>{cfg.label}</span>
                <span style={{
                  fontSize: 14, fontWeight: 700, padding: '1px 6px', borderRadius: 99,
                  background: cfg.color, color: '#fff', fontFamily: "'Jura', monospace",
                }}>{items.length}</span>
                {isOpen
                  ? <ChevronDown size={12} style={{ color: cfg.color, flexShrink: 0 }} />
                  : <ChevronRight size={12} style={{ color: cfg.color, flexShrink: 0 }} />
                }
              </button>
              {isOpen && (
                <div style={{
                  padding: '10px 12px 12px', background: 'hsl(var(--card))',
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                }}>
                  {items.map(dt => (
                    <div key={dt.id} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '4px 8px 4px 5px', borderRadius: 6,
                      background: `${cfg.color}12`, border: `1px solid ${cfg.color}30`,
                    }}>
                      <span style={{
                        fontSize: 14, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                        background: cfg.color, color: '#fff', flexShrink: 0,
                      }}>{dt.displayName}</span>
                      {dt.hasExtraction && (
                        <ScanLine size={10} style={{ color: '#0D9488', flexShrink: 0, opacity: 0.8 }} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TemplateDropdown({
  templates, activeId, onSelect, activating,
}: {
  templates: Template[];
  activeId: string | null;
  onSelect: (id: string) => void;
  activating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (templates.length <= 1) return null;

  const active = templates.find(t => t.id === activeId);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={activating}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px 4px 8px', borderRadius: 6,
          fontSize: 14.5, fontWeight: 500,
          background: 'rgba(99,102,241,0.08)', color: '#6366F1',
          border: '1px solid rgba(99,102,241,0.25)',
          cursor: activating ? 'not-allowed' : 'pointer',
          opacity: activating ? 0.7 : 1,
        }}
      >
        <GitBranch size={10} />
        {activating ? 'Activating…' : (active?.name ?? 'Select template')}
        <DropIcon size={10} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          zIndex: 100, minWidth: 220, overflow: 'hidden',
        }}>
          {templates.map(t => {
            const isActive = t.id === activeId;
            const status = (t.templateStatus || t.status || '').toUpperCase();
            return (
              <button
                key={t.id}
                onClick={() => { setOpen(false); if (!isActive) onSelect(t.id); }}
                style={{
                  width: '100%', padding: '9px 12px', textAlign: 'left', border: 'none',
                  background: isActive ? 'rgba(99,102,241,0.10)' : 'transparent',
                  cursor: isActive ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  borderBottom: '1px solid hsl(var(--border))',
                }}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: isActive ? '#6366F1' : 'hsl(var(--muted-foreground))',
                }} />
                <span style={{ fontSize: 14, fontWeight: isActive ? 600 : 400, color: 'hsl(var(--foreground))', flex: 1 }}>
                  {t.name}
                </span>
                <span style={{
                  fontSize: 14.5, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                  background: isActive ? 'rgba(99,102,241,0.15)' : 'rgba(100,100,100,0.1)',
                  color: isActive ? '#6366F1' : 'hsl(var(--muted-foreground))',
                }}>{status || 'DRAFT'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WorkflowGuided({ onSwitchToAdvanced }: { onSwitchToAdvanced?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [triggerOptions, setTriggerOptions] = useState<AccountingTriggerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [tData, mData, dtData, atData] = await Promise.all([
        fetch('/api/admin/workflow-templates', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/admin/milestones', { headers: authHeaders() }).then(r => r.json()),
        fetch('/api/admin/registries/doc-types', { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch('/api/admin/accounting/triggers', { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
      ]);
      const ts: Template[] = tData.data || tData || [];
      setTemplates(ts);
      const ms: Milestone[] = mData.data || mData || [];
      setMilestones(ms);
      const dts: DocType[] = Array.isArray(dtData.data || dtData) ? (dtData.data || dtData) : [];
      setDocTypes(dts.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)));
      const ats: AccountingTriggerOption[] = atData.data || [];
      setTriggerOptions(ats.filter(a => a.systemCode));

      const currentActive = ts.find(t => (t.templateStatus || t.status) === 'ACTIVE') || ts[0] || null;
      setActiveTemplateId(prev => {
        if (prev && ts.find(t => t.id === prev)) return prev;
        return currentActive?.id ?? null;
      });
      setLastRefreshed(new Date());
    } catch {}
    finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(false); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleActivateTemplate = useCallback(async (templateId: string) => {
    setActivating(true);
    const prev = activeTemplateId;
    setActiveTemplateId(templateId);
    setTemplates(ts => ts.map(t => ({
      ...t,
      templateStatus: t.id === templateId ? 'ACTIVE' : (t.templateStatus === 'ACTIVE' || t.status === 'ACTIVE' ? 'DRAFT' : (t.templateStatus || t.status)),
    })));
    try {
      await fetch(`/api/admin/templates/${templateId}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateStatus: 'ACTIVE' }),
      });
    } catch {
      setActiveTemplateId(prev);
    } finally {
      setActivating(false);
      fetchData(true);
    }
  }, [activeTemplateId, fetchData]);

  const handleManualRefresh = () => fetchData(false);
  const handleTriggersChanged = useCallback(() => fetchData(true), [fetchData]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[80, 180, 240].map((h, i) => (
        <div key={i} style={{ height: h, background: 'hsl(var(--card))', borderRadius: 12, opacity: 0.5 }} />
      ))}
    </div>
  );

  const activeTemplate = templates.find(t => t.id === activeTemplateId) || templates.find(t => (t.templateStatus || t.status) === 'ACTIVE') || templates[0] || null;
  const gates = activeTemplate?.gates || [];
  const totalSLA = gates.reduce((s, g) => s + (g.slaHours || 0), 0);
  const isActiveInDB = (activeTemplate?.templateStatus || activeTemplate?.status) === 'ACTIVE';

  const grouped = PHASE_ORDER.reduce<Record<Phase, Milestone[]>>((acc, p) => {
    acc[p] = milestones.filter(m => inferPhase(m.name) === p);
    return acc;
  }, { origin: [], transit: [], port: [], warehouse: [], delivery: [] });

  const secondsSinceRefresh = Math.round((Date.now() - lastRefreshed.getTime()) / 1000);
  const refreshLabel = secondsSinceRefresh < 5 ? 'just now'
    : secondsSinceRefresh < 60 ? `${secondsSinceRefresh}s ago`
    : `${Math.round(secondsSinceRefresh / 60)}m ago`;

  const totalAccountingTriggers = milestones.reduce((s, m) => s + (m.accountingTriggers?.length ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Stat chips ─────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <StatChip label="Workflow Templates" value={templates.length}  color="#0D9488" spinning={refreshing} />
        <StatChip label="Checkpoints"        value={gates.length}      color="#6366F1" spinning={refreshing} />
        <StatChip label="Milestones"         value={milestones.length} color="#8B5CF6" spinning={refreshing} />
        <StatChip label="Acctg. Triggers"    value={totalAccountingTriggers || '—'} color="#0D9488" spinning={refreshing} />
        <StatChip label="Document Types"     value={docTypes.length || '—'} color="#D97706" spinning={refreshing} />
        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          title={`Refreshed ${refreshLabel}`}
          style={{
            alignSelf: 'center',
            padding: '10px 12px', borderRadius: 10,
            background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          <RefreshCw
            size={14}
            style={{ color: '#0D9488', animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}
          />
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
            {refreshLabel}
          </span>
        </button>
      </div>

      {/* ── Active template ─────────────────────────────────── */}
      <div style={{
        background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
        borderRadius: 12, padding: '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch size={15} style={{ color: '#0D9488' }} />
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              Active Workflow Template
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeTemplate && (
              <span style={{
                fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                background: isActiveInDB ? 'rgba(13,148,136,0.15)' : 'rgba(217,119,6,0.15)',
                color: isActiveInDB ? '#0D9488' : '#D97706',
                border: `1px solid ${isActiveInDB ? 'rgba(13,148,136,0.3)' : 'rgba(217,119,6,0.3)'}`,
              }}>{isActiveInDB ? 'ACTIVE' : 'PREVIEW'}</span>
            )}
            {totalSLA > 0 && (
              <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, color: 'hsl(var(--muted-foreground))' }}>
                <Zap size={10} /> {slaLabel(totalSLA)} total
              </span>
            )}
            <TemplateDropdown
              templates={templates}
              activeId={activeTemplate?.id ?? null}
              onSelect={handleActivateTemplate}
              activating={activating}
            />
            {onSwitchToAdvanced && (
              <button
                onClick={onSwitchToAdvanced}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 6, fontSize: 14.5, fontWeight: 500,
                  background: 'rgba(13,148,136,0.08)', color: '#0D9488',
                  border: '1px solid rgba(13,148,136,0.25)', cursor: 'pointer',
                }}
              >
                <Settings2 size={10} /> Edit
              </button>
            )}
          </div>
        </div>

        {activeTemplate ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: 12 }}>
              {activeTemplate.name}
            </div>
            {gates.length > 0
              ? <GatePipeline gates={gates} />
              : <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>No gates configured.</p>
            }
          </>
        ) : (
          <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>No active template configured.</p>
        )}
      </div>

      {/* ── Milestone journey ───────────────────────────────── */}
      <div style={{
        background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
        borderRadius: 12, padding: '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ship size={15} style={{ color: '#0EA5E9' }} />
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>Milestone Journey</span>
            <span style={{
              fontSize: 14, padding: '2px 7px', borderRadius: 99, fontWeight: 600,
              background: 'rgba(14,165,233,0.12)', color: '#0EA5E9',
              border: '1px solid rgba(14,165,233,0.25)',
            }}>{milestones.length} total</span>
            {totalAccountingTriggers > 0 && (
              <span style={{
                fontSize: 14, padding: '2px 7px', borderRadius: 99, fontWeight: 600,
                background: 'rgba(13,148,136,0.12)', color: '#0D9488',
                border: '1px solid rgba(13,148,136,0.25)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Receipt size={9} /> {totalAccountingTriggers} acctg. trigger{totalAccountingTriggers !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {onSwitchToAdvanced && (
            <button
              onClick={onSwitchToAdvanced}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 6, fontSize: 14.5, fontWeight: 500,
                background: 'rgba(14,165,233,0.08)', color: '#0EA5E9',
                border: '1px solid rgba(14,165,233,0.25)', cursor: 'pointer',
              }}
            >
              <Settings2 size={10} /> Configure
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PHASE_ORDER.map((phase, i) =>
            grouped[phase].length > 0 ? (
              <PhaseGroup
                key={phase}
                phase={phase}
                milestones={grouped[phase]}
                defaultOpen={i === 0}
                triggerOptions={triggerOptions}
                onTriggersChanged={handleTriggersChanged}
              />
            ) : null
          )}
        </div>
      </div>

      {/* ── Document types ──────────────────────────────────── */}
      <DocTypesCard docTypes={docTypes} onConfigure={onSwitchToAdvanced} />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
