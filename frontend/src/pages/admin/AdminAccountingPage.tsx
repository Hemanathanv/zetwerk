import React, { useState, useEffect, useCallback } from 'react';
import {
  Pencil, Plus, CheckCircle2, XCircle, Loader2,
  Eye, EyeOff, Trash2, RefreshCw,
} from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminSectionTabs } from '@/components/admin/AdminSectionTabs';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useConfig } from '@/contexts/ConfigContext';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LedgerLine {
  name: string;
  code: string;
  amountExpression: string;
}

interface LedgerMapping {
  id: string;
  triggerId: string;
  debitAccounts: LedgerLine[];
  creditAccounts: LedgerLine[];
  taxTreatment: string | null;
  taxRate: string | null;
  amountSourceField: string | null;
}

interface AccountingTrigger {
  id: string;
  triggerCode: string;
  systemCode?: string | null;
  description: string;
  sourceDocType: string;
  category: string;
  currency: string;
  routingRole: string;
  defaultSlaHours: number;
  isActive: boolean;
  ledgerMappings: LedgerMapping[];
}

interface ApprovalThreshold {
  id: string;
  currency: string;
  l2Limit: string;
  l3Limit: string;
  l4Limit: string;
}

interface DocType {
  id: string;
  shortCode: string;
  displayName: string;
  geography: string;
}

interface Role {
  id: string;
  name: string;
  category: string;
  colorHex?: string;
}

interface TicketCategory {
  id: string;
  categoryCode: string;
  displayName: string;
  currency: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TABS = [
  { label: 'Trigger Events',      value: 'triggers'   },
  { label: 'Ledger Mappings',     value: 'ledger'     },
  { label: 'Approval Thresholds', value: 'thresholds' },
  { label: 'ERP Integration',     value: 'erp'        },
];

const GEO_COLORS: Record<string, { bg: string; color: string }> = {
  INDIA:  { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  US:     { bg: 'rgba(22,163,74,0.12)',   color: '#16a34a' },
  GLOBAL: { bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
};

const CAT_COLORS: Record<string, string> = {
  'AP India':   'rgba(59,130,246,0.12)',
  'AP US':      'rgba(22,163,74,0.12)',
  'AR':         'rgba(234,179,8,0.12)',
  'Penalty':    'rgba(239,68,68,0.12)',
  'Regulatory': 'rgba(168,85,247,0.12)',
};

// ─── DocBadge ──────────────────────────────────────────────────────────────────

function DocBadge({ label, geography }: { label: string; geography: string }) {
  const c = GEO_COLORS[geography] ?? { bg: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 7px',
      borderRadius: 5, fontSize: 14.5, fontWeight: 700,
      background: c.bg, color: c.color,
    }}>
      {label}
    </span>
  );
}

// ─── CategoryBadge ─────────────────────────────────────────────────────────────

function CategoryBadge({ name }: { name: string }) {
  const bg = CAT_COLORS[name] ?? 'hsl(var(--muted))';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 8px',
      borderRadius: 5, fontSize: 14.5, fontWeight: 600,
      background: bg, color: 'hsl(var(--foreground))',
    }}>
      {name}
    </span>
  );
}

// ─── EditTriggerModal ──────────────────────────────────────────────────────────

interface EditTriggerModalProps {
  trigger: AccountingTrigger | null;
  isNew: boolean;
  docTypes: DocType[];
  roles: Role[];
  ticketCategories: TicketCategory[];
  onSave: (id: string | null, data: Partial<AccountingTrigger>) => Promise<void>;
  onClose: () => void;
}

function EditTriggerModal({
  trigger, isNew, docTypes, roles, ticketCategories, onSave, onClose,
}: EditTriggerModalProps) {
  const [description,   setDescription]   = useState(trigger?.description   ?? '');
  const [sourceDocType, setSourceDocType] = useState(trigger?.sourceDocType ?? '');
  const [category,      setCategory]      = useState(trigger?.category      ?? '');
  const [currency,      setCurrency]      = useState(trigger?.currency      ?? 'INR');
  const [routingRole,   setRoutingRole]   = useState(trigger?.routingRole   ?? '');
  const [slaHours,      setSlaHours]      = useState(String(trigger?.defaultSlaHours ?? 48));
  const [isActive,      setIsActive]      = useState(trigger?.isActive      ?? true);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    const cat = ticketCategories.find(c => c.categoryCode === category);
    if (cat?.currency) setCurrency(cat.currency);
  }, [category, ticketCategories]);

  async function handleSave() {
    setSaving(true);
    await onSave(trigger?.id ?? null, {
      description, sourceDocType, category, currency,
      routingRole, defaultSlaHours: parseInt(slaHours) || 48, isActive,
    });
    setSaving(false);
  }

  const selStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))', fontSize: 14.5,
  };
  const inputStyle: React.CSSProperties = { ...selStyle };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 14, fontWeight: 600,
    marginBottom: 4, color: 'hsl(var(--muted-foreground))',
  };
  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 };

  return (
    <AdminModal
      open
      onClose={onClose}
      title={isNew ? 'Add Trigger' : `Edit Trigger — ${trigger?.triggerCode}`}
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}
            style={{ background: 'hsl(173 58% 39%)', color: '#fff' }}>
            {saving && <Loader2 size={14} className="animate-spin" style={{ marginRight: 4 }} />}
            Save
          </Button>
        </div>
      }
    >
      <div style={{ padding: '4px 0' }}>
        {!isNew && (
          <div style={fieldStyle}>
            <span style={labelStyle}>Trigger Code</span>
            <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
              {trigger?.triggerCode}
            </span>
          </div>
        )}
        <div style={fieldStyle}>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Source Document Type</label>
          <select style={selStyle} value={sourceDocType} onChange={e => setSourceDocType(e.target.value)}>
            <option value="">— select —</option>
            {docTypes.map(d => (
              <option key={d.id} value={d.shortCode}>{d.displayName}</option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Category</label>
          <select style={selStyle} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— select —</option>
            {ticketCategories.map(c => (
              <option key={c.id} value={c.categoryCode}>
                {c.displayName}{c.currency ? ` (${c.currency})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Currency</label>
          <select style={selStyle} value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Routing Role</label>
          <select style={selStyle} value={routingRole} onChange={e => setRoutingRole(e.target.value)}>
            <option value="">— select —</option>
            {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
          </select>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            Tickets from this trigger will be routed to users with this role
          </span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Default SLA</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input style={{ ...inputStyle, width: 100 }} type="number" min={1}
              value={slaHours} onChange={e => setSlaHours(e.target.value)} />
            <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>hours</span>
          </div>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            Time allowed before escalation
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          <span style={{ fontSize: 14.5 }}>Active</span>
        </div>
      </div>
    </AdminModal>
  );
}

// ─── TriggerCard ───────────────────────────────────────────────────────────────

interface TriggerCardProps {
  trigger: AccountingTrigger;
  docTypes: DocType[];
  ticketCategories: TicketCategory[];
  roles: Role[];
  onEdit: () => void;
  onToggle: (isActive: boolean) => void;
  onGoLedger: () => void;
}

function TriggerCard({
  trigger, docTypes, ticketCategories, roles, onEdit, onToggle, onGoLedger,
}: TriggerCardProps) {
  const docType = docTypes.find(d => d.shortCode === trigger.sourceDocType);
  const cat     = ticketCategories.find(c => c.categoryCode === trigger.category);
  const role    = roles.find(r => r.name === trigger.routingRole || r.id === trigger.routingRole);
  const mapping = trigger.ledgerMappings[0];

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 8,
      border: '1px solid hsl(var(--border))',
      padding: 16, marginBottom: 12,
      opacity: trigger.isActive ? 1 : 0.55,
      transition: 'opacity 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
            {trigger.triggerCode}
          </span>
          {trigger.systemCode && (
            <span style={{
              fontFamily: 'var(--app-font-sans)', fontSize: 14.5,
              padding: '1px 6px', borderRadius: 4,
              background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
              border: '1px solid hsl(var(--border))',
            }}>
              {trigger.systemCode}
            </span>
          )}
          <span style={{ fontSize: 14, fontWeight: 600 }}>{trigger.description}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch checked={trigger.isActive} onCheckedChange={onToggle} />
          <button onClick={onEdit} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6, fontSize: 14,
            border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
            cursor: 'pointer', color: 'hsl(var(--foreground))',
          }}>
            <Pencil size={12} /> Edit
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{
        marginTop: 12,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>Source document</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {docType
              ? <DocBadge label={docType.displayName} geography={docType.geography} />
              : <span style={{ fontSize: 14 }}>{trigger.sourceDocType}</span>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>Category</div>
          <CategoryBadge name={cat?.displayName ?? trigger.category} />
        </div>
        <div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>Currency</div>
          <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14 }}>{trigger.currency}</span>
        </div>
        <div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>Routing</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {role?.colorHex && (
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: role.colorHex, flexShrink: 0,
              }} />
            )}
            <span style={{ fontSize: 14 }}>{(role?.name ?? trigger.routingRole) || '—'}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>Default SLA</div>
          <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14 }}>{trigger.defaultSlaHours}h</span>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 12, paddingTop: 10,
        borderTop: '1px solid hsl(var(--border))',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {mapping ? (
          <>
            <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
              Ledger mapping: {(mapping.debitAccounts?.length ?? 0) + (mapping.creditAccounts?.length ?? 0)} accounts configured
            </span>
            <button onClick={onGoLedger} style={{
              fontSize: 14.5, color: 'hsl(173 58% 39%)', background: 'none', border: 'none',
              cursor: 'pointer', textDecoration: 'underline', padding: 0,
            }}>
              View in Ledger Mappings →
            </button>
          </>
        ) : (
          <span style={{ fontSize: 14, color: '#d97706' }}>
            ⚠ No ledger mapping — configure in Ledger Mappings tab
          </span>
        )}
      </div>
    </div>
  );
}

// ─── EditMappingModal sub-components ───────────────────────────────────────────

interface LineEditorProps {
  lines: LedgerLine[];
  setLines: (v: LedgerLine[]) => void;
  side: 'DEBIT' | 'CREDIT';
}

function LineEditor({ lines, setLines, side }: LineEditorProps) {
  const color = side === 'DEBIT' ? '#16a34a' : '#dc2626';

  function updateLine(idx: number, field: keyof LedgerLine, value: string) {
    setLines(lines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  const inputS: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 5, fontSize: 14,
    border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))', width: '100%',
  };

  return (
    <div>
      <div style={{
        fontSize: 14, fontWeight: 700, color,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
      }}>
        {side}
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{
          background: 'hsl(var(--muted) / 0.4)', borderRadius: 6, padding: 10, marginBottom: 8,
          border: '1px solid hsl(var(--border))',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 6, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Account name</div>
              <input style={inputS} value={line.name}
                onChange={e => updateLine(i, 'name', e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Code</div>
              <input style={{ ...inputS, fontFamily: 'var(--app-font-sans)' }} value={line.code}
                onChange={e => updateLine(i, 'code', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Amount expression</div>
              <input style={{ ...inputS, fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}
                value={line.amountExpression} placeholder="{sourceField}"
                onChange={e => updateLine(i, 'amountExpression', e.target.value)} />
            </div>
            <button onClick={() => setLines(lines.filter((_, j) => j !== i))} style={{
              padding: '5px 7px', borderRadius: 5, border: '1px solid hsl(var(--border))',
              background: 'none', cursor: 'pointer', color: '#dc2626',
            }}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => setLines([...lines, { name: '', code: '', amountExpression: '' }])}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 14,
          padding: '4px 10px', borderRadius: 5, border: '1px dashed hsl(var(--border))',
          background: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))',
          width: '100%', justifyContent: 'center',
        }}
      >
        <Plus size={12} /> Add {side.toLowerCase()} line
      </button>
    </div>
  );
}

// ─── EditMappingModal ──────────────────────────────────────────────────────────

interface EditMappingModalProps {
  trigger: AccountingTrigger;
  mapping: LedgerMapping | null;
  onSave: (triggerId: string, data: Partial<LedgerMapping>) => Promise<void>;
  onClose: () => void;
}

function EditMappingModal({ trigger, mapping, onSave, onClose }: EditMappingModalProps) {
  const [debits,      setDebits]   = useState<LedgerLine[]>(mapping?.debitAccounts  ?? []);
  const [credits,     setCredits]  = useState<LedgerLine[]>(mapping?.creditAccounts ?? []);
  const [taxTreatment, setTax]     = useState(mapping?.taxTreatment ?? 'None');
  const [taxRate,     setTaxRate]  = useState(mapping?.taxRate ?? '');
  const [amtField,    setAmtField] = useState(mapping?.amountSourceField ?? '');
  const [saving,      setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(trigger.id, {
      debitAccounts: debits, creditAccounts: credits,
      taxTreatment, taxRate: taxRate || null, amountSourceField: amtField || null,
    });
    setSaving(false);
  }

  const inputS: React.CSSProperties = {
    padding: '5px 8px', borderRadius: 5, fontSize: 14,
    border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  };
  const selS: React.CSSProperties = { ...inputS, width: '100%' };
  const sectionHead: React.CSSProperties = {
    fontSize: 14, fontWeight: 700, color: 'hsl(var(--muted-foreground))',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
  };

  return (
    <AdminModal
      open
      onClose={onClose}
      title={`Edit ledger mapping — ${trigger.description}`}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}
            style={{ background: 'hsl(173 58% 39%)', color: '#fff' }}>
            {saving && <Loader2 size={14} className="animate-spin" style={{ marginRight: 4 }} />}
            Save
          </Button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <LineEditor lines={debits}  setLines={setDebits}  side="DEBIT"  />
        <LineEditor lines={credits} setLines={setCredits} side="CREDIT" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12 }}>
        <div>
          <div style={sectionHead}>Tax treatment</div>
          <select style={selS} value={taxTreatment} onChange={e => setTax(e.target.value)}>
            {['IGST', 'CGST + SGST', 'None', 'Custom'].map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <div style={sectionHead}>Tax rate</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input style={{ ...inputS, width: 56 }} type="number" min={0} max={100}
              value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="18" />
            <span style={{ fontSize: 14 }}>%</span>
          </div>
        </div>
        <div>
          <div style={sectionHead}>Amount source field</div>
          <input style={{ ...inputS, width: '100%', fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}
            value={amtField} placeholder="e.g. totalsGrandTotalInr"
            onChange={e => setAmtField(e.target.value)} />
        </div>
      </div>
    </AdminModal>
  );
}

// ─── LedgerMappingCard ─────────────────────────────────────────────────────────

interface LedgerMappingCardProps {
  trigger: AccountingTrigger;
  ticketCategories: TicketCategory[];
  onEdit: () => void;
}

function LedgerMappingCard({ trigger, ticketCategories, onEdit }: LedgerMappingCardProps) {
  const mapping  = trigger.ledgerMappings[0];
  const cat      = ticketCategories.find(c => c.categoryCode === trigger.category);
  const debits   = (mapping?.debitAccounts  ?? []) as LedgerLine[];
  const credits  = (mapping?.creditAccounts ?? []) as LedgerLine[];
  const maxRows  = Math.max(debits.length, credits.length, 1);

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 8,
      border: '1px solid hsl(var(--border))', marginBottom: 16, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: 'hsl(var(--muted) / 0.5)',
        borderBottom: '1px solid hsl(var(--border))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
            {trigger.triggerCode}
          </span>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{trigger.description}</span>
          <CategoryBadge name={cat?.displayName ?? trigger.category} />
          <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            {trigger.currency}
          </span>
        </div>
        <button onClick={onEdit} style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6, fontSize: 14,
          border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
          cursor: 'pointer', color: 'hsl(var(--foreground))',
        }}>
          <Pencil size={12} /> Edit
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        {mapping ? (
          <>
            {/* T-account grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              borderRadius: 6, overflow: 'hidden',
              border: '1px solid hsl(var(--border))',
            }}>
              {/* Column headers */}
              <div style={{
                background: 'rgba(22,163,74,0.1)', padding: '6px 12px',
                borderBottom: '1px solid hsl(var(--border))',
                borderRight: '1px solid hsl(var(--border))',
              }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Debit</span>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.1)', padding: '6px 12px', borderBottom: '1px solid hsl(var(--border))' }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Credit</span>
              </div>
              {/* Rows */}
              {Array.from({ length: maxRows }).map((_, i) => {
                const dr = debits[i];
                const cr = credits[i];
                const notLast = i < maxRows - 1;
                return (
                  <React.Fragment key={i}>
                    <div style={{
                      padding: '8px 12px',
                      borderRight: '1px solid hsl(var(--border))',
                      borderBottom: notLast ? '1px solid hsl(var(--border))' : undefined,
                    }}>
                      {dr ? (
                        <>
                          <div style={{ fontSize: 14.5, fontWeight: 500 }}>
                            {dr.name || <span style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>}
                          </div>
                          {dr.code && (
                            <div style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                              Account: {dr.code}
                            </div>
                          )}
                          {dr.amountExpression && (
                            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>
                              Amount: {dr.amountExpression}
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                    <div style={{
                      padding: '8px 12px',
                      borderBottom: notLast ? '1px solid hsl(var(--border))' : undefined,
                    }}>
                      {cr ? (
                        <>
                          <div style={{ fontSize: 14.5, fontWeight: 500 }}>
                            {cr.name || <span style={{ color: 'hsl(var(--muted-foreground))' }}>—</span>}
                          </div>
                          {cr.code && (
                            <div style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                              Account: {cr.code}
                            </div>
                          )}
                          {cr.amountExpression && (
                            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>
                              Amount: {cr.amountExpression}
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            {/* Metadata row */}
            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              {mapping.taxTreatment && mapping.taxTreatment !== 'None' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>Tax:</span>
                  <span style={{
                    fontSize: 14.5, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                    background: 'rgba(234,179,8,0.12)', color: '#ca8a04',
                  }}>
                    {mapping.taxTreatment}
                  </span>
                  {mapping.taxRate && (
                    <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}>{mapping.taxRate}%</span>
                  )}
                </div>
              )}
              {mapping.amountSourceField && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>Amount source:</span>
                  <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}>{mapping.amountSourceField}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{
            textAlign: 'center', padding: '24px 0',
            color: 'hsl(var(--muted-foreground))', fontSize: 14.5,
          }}>
            No ledger mapping configured — click Edit to add debit/credit accounts.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ThresholdCurrencyCard ─────────────────────────────────────────────────────

interface ThresholdCurrencyCardProps {
  currency: string;
  symbol: string;
  initialL2: string;
  initialL3: string;
  onSave: (l2: string, l3: string) => Promise<void>;
}

function ThresholdCurrencyCard({ currency, symbol, initialL2, initialL3, onSave }: ThresholdCurrencyCardProps) {
  const [l2,     setL2]     = useState(initialL2);
  const [l3,     setL3]     = useState(initialL3);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const l2n = parseFloat(l2) || 0;
  const l3n = parseFloat(l3) || 0;

  async function save() {
    setSaving(true);
    try {
      await onSave(l2, l3);
      toast({ title: `${currency} thresholds saved` });
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
  }

  const inputS: React.CSSProperties = {
    padding: '6px 10px', borderRadius: 6, border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--background))', fontSize: 14.5, fontFamily: 'var(--app-font-sans)',
    color: 'hsl(var(--foreground))', width: 160,
  };
  const labelS: React.CSSProperties = {
    fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 4, display: 'block',
  };
  const flag = currency === 'INR' ? '🇮🇳' : '🇺🇸';
  const name = currency === 'INR' ? 'Indian Rupee (INR)' : 'US Dollar (USD)';

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 8,
      padding: 24, border: '1px solid hsl(var(--border))',
    }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{flag} {name}</div>
      <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 20 }}>
        Thresholds for {currency}-denominated accounting tickets
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelS}>L2 Senior can self-approve up to</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}>{symbol}</span>
            <input style={inputS} type="number" min={0} value={l2} onChange={e => setL2(e.target.value)} />
          </div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            Tickets below this amount don't need manager approval
          </div>
        </div>
        <div>
          <label style={labelS}>L3 Manager approval required above</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
              {symbol}{l2 || '0'} up to
            </span>
            <span style={{ fontFamily: 'var(--app-font-sans)', fontSize: 14.5 }}>{symbol}</span>
            <input style={inputS} type="number" min={0} value={l3} onChange={e => setL3(e.target.value)} />
          </div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            Tickets between L2 and L3 limits need manager sign-off
          </div>
        </div>
        <div>
          <label style={labelS}>L4 Director approval required above</label>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-sans)' }}>
            Above {symbol}{l3 || '0'}
          </div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            Tickets exceeding the L3 limit need director approval
          </div>
        </div>
      </div>

      {/* Tier diagram */}
      <div style={{ marginTop: 20 }}>
        <div style={{ position: 'relative', height: 20, display: 'flex', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ flex: l2n || 1, background: '#16a34a' }} />
          <div style={{ flex: Math.max(l3n - l2n, 1), background: '#d97706' }} />
          <div style={{ flex: Math.max(l3n, 1), background: '#dc2626' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          <div>{symbol}0<br /><span style={{ color: '#16a34a', fontWeight: 600 }}>L2 self</span></div>
          <div style={{ textAlign: 'center' }}>
            {symbol}{l2n.toLocaleString()}<br />
            <span style={{ color: '#d97706', fontWeight: 600 }}>L3 needed</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            {symbol}{l3n.toLocaleString()}<br />
            <span style={{ color: '#dc2626', fontWeight: 600 }}>L4 needed</span>
          </div>
          <div style={{ textAlign: 'right' }}>∞</div>
        </div>
      </div>

      <Button size="sm" onClick={save} disabled={saving}
        style={{ marginTop: 20, background: 'hsl(173 58% 39%)', color: '#fff' }}>
        {saving && <Loader2 size={13} className="animate-spin" style={{ marginRight: 4 }} />}
        Save {currency} thresholds
      </Button>
    </div>
  );
}

// ─── ThresholdTab ──────────────────────────────────────────────────────────────

interface ThresholdTabProps {
  thresholds: ApprovalThreshold[];
  onSave: (currency: string, l2: string, l3: string) => Promise<void>;
}

function ThresholdTab({ thresholds, onSave }: ThresholdTabProps) {
  const inr = thresholds.find(t => t.currency === 'INR');
  const usd = thresholds.find(t => t.currency === 'USD');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
      <ThresholdCurrencyCard
        currency="INR" symbol="₹"
        initialL2={inr?.l2Limit ?? '500000'}
        initialL3={inr?.l3Limit ?? '2500000'}
        onSave={(l2, l3) => onSave('INR', l2, l3)}
      />
      <ThresholdCurrencyCard
        currency="USD" symbol="$"
        initialL2={usd?.l2Limit ?? '5000'}
        initialL3={usd?.l3Limit ?? '25000'}
        onSave={(l2, l3) => onSave('USD', l2, l3)}
      />
    </div>
  );
}

// ─── ERPTab ────────────────────────────────────────────────────────────────────

interface ErpSettings {
  erpSystem: string;
  apiUrl: string;
  authMethod: string;
  orgIdField: string;
  autoRetry: boolean;
  maxRetries: string;
  retryInterval: string;
  alertAfter: string;
  freshdeskOn: boolean;
  fdPriority: string;
  fdType: string;
  fdGroup: string;
}

const ERP_DEFAULTS: ErpSettings = {
  erpSystem: 'Zoho Books', apiUrl: 'https://books.zoho.com/api/v3',
  authMethod: 'API Key', orgIdField: '',
  autoRetry: true, maxRetries: '3', retryInterval: '60', alertAfter: '3',
  freshdeskOn: false, fdPriority: 'High', fdType: 'Accounting', fdGroup: 'Finance',
};

interface ERPTabProps {
  initialData: ErpSettings | null;
  onSave: (data: ErpSettings) => Promise<void>;
}

function ERPTab({ initialData, onSave }: ERPTabProps) {
  const init = initialData ?? ERP_DEFAULTS;
  const [erpSystem,     setErpSystem]     = useState(init.erpSystem);
  const [apiUrl,        setApiUrl]        = useState(init.apiUrl);
  const [authMethod,    setAuthMethod]    = useState(init.authMethod);
  const [apiKey,        setApiKey]        = useState('');
  const [showKey,       setShowKey]       = useState(false);
  const [orgIdField,    setOrgIdField]    = useState(init.orgIdField);
  const [testStatus,    setTestStatus]    = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const [autoRetry,     setAutoRetry]     = useState(init.autoRetry);
  const [maxRetries,    setMaxRetries]    = useState(init.maxRetries);
  const [retryInterval, setRetryInterval] = useState(init.retryInterval);
  const [alertAfter,    setAlertAfter]    = useState(init.alertAfter);
  const [freshdeskOn,   setFreshdeskOn]   = useState(init.freshdeskOn);
  const [fdKey,         setFdKey]         = useState('');
  const [fdPriority,    setFdPriority]    = useState(init.fdPriority);
  const [fdType,        setFdType]        = useState(init.fdType);
  const [fdGroup,       setFdGroup]       = useState(init.fdGroup);
  const [fdTestStatus,  setFdTestStatus]  = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const [saving,        setSaving]        = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ erpSystem, apiUrl, authMethod, orgIdField, autoRetry, maxRetries,
                     retryInterval, alertAfter, freshdeskOn, fdPriority, fdType, fdGroup });
      toast({ title: 'ERP settings saved' });
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
  }

  function testConnection() {
    if (!apiUrl) { setTestStatus('fail'); return; }
    setTestStatus('loading');
    // Real connection test would hit the ERP endpoint; stub for now
    setTimeout(() => setTestStatus('fail'), 1800);
  }
  function testFreshdesk() {
    if (!fdKey) { setFdTestStatus('fail'); return; }
    setFdTestStatus('loading');
    setTimeout(() => setFdTestStatus('fail'), 1600);
  }

  const inputS: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))', fontSize: 14.5,
  };
  const labelS: React.CSSProperties = {
    display: 'block', fontSize: 14, fontWeight: 600,
    marginBottom: 4, color: 'hsl(var(--muted-foreground))',
  };
  const fieldS: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 };

  function StatusDot({ ok }: { ok: boolean | null }) {
    const bg = ok == null ? '#94a3b8' : ok ? '#16a34a' : '#dc2626';
    return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: bg, marginRight: 6 }} />;
  }

  const erpOk    = testStatus   === 'ok' ? true  : testStatus   === 'fail' ? false : null;
  const fdOk     = (freshdeskOn && fdTestStatus === 'ok')   ? true
                 : (freshdeskOn && fdTestStatus === 'fail')  ? false : null;

  return (
    <div style={{ maxWidth: 720 }}>
      <AdminFormSection title="ERP Connection" description="Connect to your organisation's ERP system">
        <div style={fieldS}>
          <label style={labelS}>ERP System</label>
          <select style={inputS} value={erpSystem} onChange={e => setErpSystem(e.target.value)}>
            {['Zoho Books', 'Tally Prime', 'SAP Business One', 'Custom API'].map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div style={fieldS}>
          <label style={labelS}>API Endpoint URL</label>
          <input style={inputS} type="url" value={apiUrl} onChange={e => setApiUrl(e.target.value)}
            placeholder="https://books.zoho.com/api/v3" />
        </div>
        <div style={fieldS}>
          <label style={labelS}>Authentication Method</label>
          <select style={inputS} value={authMethod} onChange={e => setAuthMethod(e.target.value)}>
            {['API Key', 'OAuth 2.0', 'Basic Auth'].map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div style={fieldS}>
          <label style={labelS}>API Key / Token</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...inputS, paddingRight: 36 }} type={showKey ? 'text' : 'password'}
              value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Enter API key" />
            <button onClick={() => setShowKey(v => !v)} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center',
            }}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            Stored encrypted. Only administrators can view.
          </span>
        </div>
        <div style={fieldS}>
          <label style={labelS}>Organisation ID</label>
          <input style={inputS} value={orgIdField} onChange={e => setOrgIdField(e.target.value)} placeholder="Zoho org ID" />
        </div>
      </AdminFormSection>

      <AdminFormSection title="Connection Test" description="Verify the ERP connection is working">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="outline" size="sm" onClick={testConnection} disabled={testStatus === 'loading'}>
            {testStatus === 'loading'
              ? <Loader2 size={13} className="animate-spin" style={{ marginRight: 4 }} />
              : <RefreshCw size={13} style={{ marginRight: 4 }} />}
            Test Connection
          </Button>
          {testStatus === 'ok' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, color: '#16a34a' }}>
              <CheckCircle2 size={14} /> Connected to {erpSystem}
            </span>
          )}
          {testStatus === 'fail' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, color: '#dc2626' }}>
              <XCircle size={14} /> Connection failed — check endpoint and credentials
            </span>
          )}
        </div>
        <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 8 }}>
          Last tested: Never
        </div>
      </AdminFormSection>

      <AdminFormSection
        title="Retry Configuration"
        description="How to handle failed ERP posts"
        collapsible
        defaultOpen={false}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Switch checked={autoRetry} onCheckedChange={setAutoRetry} />
          <span style={{ fontSize: 14.5 }}>Auto-retry on failure</span>
        </div>
        {autoRetry && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={fieldS}>
                <label style={labelS}>Max retries</label>
                <input style={inputS} type="number" min={1} max={10}
                  value={maxRetries} onChange={e => setMaxRetries(e.target.value)} />
              </div>
              <div style={fieldS}>
                <label style={labelS}>Retry interval</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input style={{ ...inputS, width: 80 }} type="number" min={1}
                    value={retryInterval} onChange={e => setRetryInterval(e.target.value)} />
                  <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>minutes</span>
                </div>
              </div>
              <div style={fieldS}>
                <label style={labelS}>Alert admin after</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input style={{ ...inputS, width: 70 }} type="number" min={1}
                    value={alertAfter} onChange={e => setAlertAfter(e.target.value)} />
                  <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>failures</span>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
              When posting fails, the system will retry automatically. After max failures, the ticket is marked 'Post failed' and admin is alerted.
            </div>
          </>
        )}
      </AdminFormSection>

      <AdminFormSection
        title="Ticketing Integration"
        description="Create support tickets for accounting events"
        collapsible
        defaultOpen={false}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: freshdeskOn ? 16 : 0 }}>
          <Switch checked={freshdeskOn} onCheckedChange={setFreshdeskOn} />
          <span style={{ fontSize: 14.5 }}>Enable support tickets</span>
        </div>
        {freshdeskOn && (
          <>
            <div style={fieldS}>
              <label style={labelS}>API Key</label>
              <input style={inputS} type="password" value={fdKey}
                onChange={e => setFdKey(e.target.value)} placeholder="API key" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={fieldS}>
                <label style={labelS}>Priority</label>
                <select style={inputS} value={fdPriority} onChange={e => setFdPriority(e.target.value)}>
                  {['Low', 'Medium', 'High', 'Urgent'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div style={fieldS}>
                <label style={labelS}>Type</label>
                <input style={inputS} value={fdType} onChange={e => setFdType(e.target.value)} />
              </div>
              <div style={fieldS}>
                <label style={labelS}>Group</label>
                <input style={inputS} value={fdGroup} onChange={e => setFdGroup(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Button variant="outline" size="sm" onClick={testFreshdesk} disabled={fdTestStatus === 'loading'}>
                {fdTestStatus === 'loading' && (
                  <Loader2 size={13} className="animate-spin" style={{ marginRight: 4 }} />
                )}
                Test connection
              </Button>
              {fdTestStatus === 'ok' && (
                <span style={{ fontSize: 14.5, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle2 size={14} /> Connected
                </span>
              )}
              {fdTestStatus === 'fail' && (
                <span style={{ fontSize: 14.5, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <XCircle size={14} /> Connection failed
                </span>
              )}
            </div>
          </>
        )}
      </AdminFormSection>

      <AdminFormSection title="Connection Status" description="Current status of all integrations" isLast>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {([['ERP', erpOk], ['Ticketing', fdOk]] as [string, boolean | null][]).map(([label, ok]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', fontSize: 14.5 }}>
              <StatusDot ok={ok} />
              {label}:&nbsp;
              <span style={{ color: ok === true ? '#16a34a' : ok === false ? '#dc2626' : 'hsl(var(--muted-foreground))' }}>
                {ok === true ? 'Connected' : ok === false ? 'Connection failed' : 'Not configured'}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            Last successful post: <span style={{ fontFamily: 'var(--app-font-sans)' }}>Never</span>
          </span>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            Posts this month: <span style={{ fontFamily: 'var(--app-font-sans)' }}>0</span>
          </span>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            Failed posts: <span style={{ fontFamily: 'var(--app-font-sans)', color: '#dc2626' }}>0</span>
          </span>
        </div>
      </AdminFormSection>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <Button size="sm" onClick={handleSave} disabled={saving}
          style={{ background: 'hsl(173 58% 39%)', color: '#fff' }}>
          {saving && <Loader2 size={13} className="animate-spin" style={{ marginRight: 4 }} />}
          Save ERP settings
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminAccountingPage() {
  const { toast } = useToast();

  const { docTypes: rawDocTypes, roles: rawRoles, ticketCategories } = useConfig();
  const docTypes = rawDocTypes.map(d => ({ ...d, geography: d.geography ?? '' }));
  const roles    = rawRoles.map(r => ({ ...r, category: r.roleCategory ?? '' }));
  const [triggers,         setTriggers]        = useState<AccountingTrigger[]>([]);
  const [thresholds,       setThresholds]       = useState<ApprovalThreshold[]>([]);
  const [erpSettings,      setErpSettings]      = useState<ErpSettings | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [activeTab,        setActiveTab]        = useState('triggers');
  const [editTrigger,      setEditTrigger]      = useState<AccountingTrigger | null>(null);
  const [showAddTrigger,   setShowAddTrigger]   = useState(false);
  const [editMapping,      setEditMapping]      = useState<AccountingTrigger | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trigRes, thrRes] = await Promise.all([
        apiGet<any>('/api/admin/accounting/triggers'),
        apiGet<any>('/api/admin/accounting/thresholds'),
      ]);
      if (trigRes.ok) setTriggers(trigRes.data ?? []);
      if (thrRes.ok)  setThresholds(thrRes.data ?? []);
      // ERP settings are optional — load separately so a 404 doesn't crash the page
      apiGet<any>('/api/admin/accounting/erp').then(r => {
        if (r.ok && r.data) setErpSettings(r.data as ErpSettings);
      }).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, []);

  async function saveErpSettings(data: ErpSettings) {
    const res = await apiPut<any>('/api/admin/accounting/erp', data);
    if (res.ok) setErpSettings(data);
    else throw new Error('Failed');
  }

  useEffect(() => { load(); }, [load]);

  async function saveTrigger(id: string | null, data: Partial<AccountingTrigger>) {
    try {
      if (id) {
        const res = await apiPut<any>(`/api/admin/accounting/triggers/${id}`, data);
        if (res.ok) {
          setTriggers(prev => prev.map(t => t.id === id ? { ...t, ...res.data } : t));
          toast({ title: 'Trigger updated' });
        } else {
          toast({ title: 'Save failed', variant: 'destructive' });
        }
      } else {
        const res = await apiPost<any>('/api/admin/accounting/triggers', data);
        if (res.ok) {
          setTriggers(prev => [...prev, res.data].sort((a, b) => a.triggerCode.localeCompare(b.triggerCode)));
          toast({ title: `Trigger ${res.data.triggerCode} created` });
        } else {
          toast({ title: 'Create failed', variant: 'destructive' });
        }
      }
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setEditTrigger(null);
      setShowAddTrigger(false);
    }
  }

  async function toggleTrigger(t: AccountingTrigger, isActive: boolean) {
    const res = await apiPut<any>(`/api/admin/accounting/triggers/${t.id}`, { isActive });
    if (res.ok) setTriggers(prev => prev.map(x => x.id === t.id ? { ...x, isActive } : x));
  }

  async function saveMapping(triggerId: string, data: Partial<LedgerMapping>) {
    const trigger  = triggers.find(t => t.id === triggerId);
    const existing = trigger?.ledgerMappings[0];
    try {
      if (existing) {
        const res = await apiPut<any>(`/api/admin/accounting/ledger-mappings/${existing.id}`, data);
        if (res.ok) {
          setTriggers(prev => prev.map(t =>
            t.id === triggerId
              ? { ...t, ledgerMappings: [{ ...existing, ...res.data }] }
              : t
          ));
          toast({ title: 'Ledger mapping updated' });
        } else {
          toast({ title: 'Save failed', variant: 'destructive' });
        }
      } else {
        const res = await apiPost<any>('/api/admin/accounting/ledger-mappings', { triggerId, ...data });
        if (res.ok) {
          setTriggers(prev => prev.map(t =>
            t.id === triggerId
              ? { ...t, ledgerMappings: [res.data] }
              : t
          ));
          toast({ title: 'Ledger mapping created' });
        } else {
          toast({ title: 'Create failed', variant: 'destructive' });
        }
      }
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setEditMapping(null);
    }
  }

  async function saveThreshold(currency: string, l2: string, l3: string) {
    const payload = {
      currency,
      l2Limit:  parseFloat(l2),
      l3Limit:  parseFloat(l3),
      l4Limit:  parseFloat(l3) * 10,
    };
    const res = await apiPut<any>('/api/admin/accounting/thresholds', payload);
    if (res.ok) {
      setThresholds(prev => [...prev.filter(t => t.currency !== currency), res.data]);
    } else {
      throw new Error('Failed');
    }
  }

  const activeTabs = TABS.map(t =>
    t.value === 'triggers' ? { ...t, count: triggers.length } : t
  );

  return (
    <div>
      <AdminPageHeader
        title="Accounting Configuration"
        description="Trigger events, ledger mappings, approval thresholds, and ERP integration"
        badge={{ label: 'triggers', count: triggers.length }}
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowAddTrigger(true)}>
            <Plus size={14} style={{ marginRight: 4 }} /> Add Trigger
          </Button>
        }
      />

      <AdminSectionTabs tabs={activeTabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />
        </div>
      ) : (
        <>
          {/* Trigger Events */}
          {activeTab === 'triggers' && (
            <div style={{ paddingBottom: 32 }}>
              {triggers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'hsl(var(--muted-foreground))' }}>
                  No triggers configured. Click "Add Trigger" to create the first one.
                </div>
              ) : (
                triggers.map(t => (
                  <TriggerCard
                    key={t.id}
                    trigger={t}
                    docTypes={docTypes}
                    ticketCategories={ticketCategories}
                    roles={roles}
                    onEdit={() => setEditTrigger(t)}
                    onToggle={active => toggleTrigger(t, active)}
                    onGoLedger={() => setActiveTab('ledger')}
                  />
                ))
              )}
            </div>
          )}

          {/* Ledger Mappings */}
          {activeTab === 'ledger' && (
            <div style={{ paddingBottom: 32 }}>
              {triggers.map(t => (
                <LedgerMappingCard
                  key={t.id}
                  trigger={t}
                  ticketCategories={ticketCategories}
                  onEdit={() => setEditMapping(t)}
                />
              ))}
            </div>
          )}

          {/* Approval Thresholds */}
          {activeTab === 'thresholds' && (
            <ThresholdTab thresholds={thresholds} onSave={saveThreshold} />
          )}

          {/* ERP Integration */}
          {activeTab === 'erp' && (
            <ERPTab initialData={erpSettings} onSave={saveErpSettings} />
          )}
        </>
      )}

      {editTrigger && (
        <EditTriggerModal
          trigger={editTrigger}
          isNew={false}
          docTypes={docTypes}
          roles={roles}
          ticketCategories={ticketCategories}
          onSave={saveTrigger}
          onClose={() => setEditTrigger(null)}
        />
      )}

      {showAddTrigger && (
        <EditTriggerModal
          trigger={null}
          isNew
          docTypes={docTypes}
          roles={roles}
          ticketCategories={ticketCategories}
          onSave={saveTrigger}
          onClose={() => setShowAddTrigger(false)}
        />
      )}

      {editMapping && (
        <EditMappingModal
          trigger={editMapping}
          mapping={editMapping.ledgerMappings[0] ?? null}
          onSave={saveMapping}
          onClose={() => setEditMapping(null)}
        />
      )}
    </div>
  );
}
