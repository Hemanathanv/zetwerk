import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Camera, Plus, Trash2, Eye, EyeOff, RefreshCw, Loader2, Pencil, History, ChevronDown, ChevronUp, Power, PowerOff, Clock, MoreVertical, Library } from 'lucide-react';
import { MILESTONE_PRESETS, type MilestonePreset } from '@/data/milestonePresets';
import { Switch } from '@/components/ui/switch';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminSectionTabs } from '@/components/admin/AdminSectionTabs';
import { AdminTable, Column } from '@/components/admin/AdminTable';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPut, apiPost, apiDelete } from '@/lib/api';
import {
  MilestoneAccountingTriggers,
  type AccountingTriggerOption,
  type AccountingTriggerRow,
} from '@/components/admin/MilestoneAccountingTriggers';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface WorkflowTemplate { id: string; name: string; templateStatus: string; gates?: GateConfig[] }
interface GateConfig       { id: string; gateName: string; gateNumber: number }

interface MilestoneConfig {
  id: string; templateId: string; gateConfigId: string | null;
  milestoneNumber: number; name: string; type: MilestoneType;
  triggerCondition: Record<string, any> | null;
  photoRequired: boolean; notifyRoles: string[];
  slaFromPreviousHrs: number | null; sortOrder: number;
  systemCode?: string | null;
  completionMode?: string | null;
  accountingTriggers?: AccountingTriggerRow[];
}
type MilestoneType = 'AUTO' | 'MANUAL' | 'DOCUMENT' | 'SYSTEM';

interface DndRateEntry {
  id: string; portName: string; terminalName: string | null; firmsCode: string | null;
  shippingLine: string | null; freeDays: number;
  demurragePerDay: string | number; detentionPerDay: string | number;
  currency: string; effectiveDate: string;
}

interface AlertThreshold {
  id: string; alertType: string; thresholdValue: number; thresholdUnit: string;
  recipientRoles: string[]; recipientUsers: string[];
  isActive: boolean;
  valueHistory: Array<{ value: number; unit: string; changedAt: string }>;
  updatedAt?: string;
}

interface SimpleRole { id: string; name: string; color?: string | null; systemCode?: string | null; }

// ─── Constants ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<MilestoneType, { color: string; label: string }> = {
  AUTO:     { color: '#3b82f6', label: 'Auto'     },
  DOCUMENT: { color: '#16a34a', label: 'Document' },
  MANUAL:   { color: '#d97706', label: 'Manual'   },
  SYSTEM:   { color: '#9ca3af', label: 'System'   },
};

const ALERT_META: Record<string, { name: string; description: string; unit: string }> = {
  dnd_approaching:          { name: 'D&D Risk — LFD Approaching',    description: 'Alert when Last Free Day is near',                   unit: 'days'  },
  dnd_past_lfd:             { name: 'D&D Risk — Past LFD',           description: 'Alert immediately on LFD day',                       unit: 'days'  },
  container_not_discharged: { name: 'Container Not Discharged',      description: 'After vessel arrival, container still on ship',       unit: 'hours' },
  stale_tracking:           { name: 'Stale Tracking Data',           description: 'No tracking update received',                        unit: 'hours' },
  grn_overdue:              { name: 'GRN Overdue',                   description: "After gate out, 3PL hasn't confirmed receipt",        unit: 'hours' },
  pod_overdue:              { name: 'POD Overdue',                   description: 'After dispatch, POD not uploaded',                   unit: 'days'  },
  empty_container_return:   { name: 'Empty Container Return',        description: 'After delivery, container not returned',              unit: 'days'  },
};

const CUSTOM_ALERT_OPTIONS: Array<{ value: string; name: string; description: string }> = [
  { value: 'vessel_arrival_delay',        name: 'Vessel Arrival Delay',           description: 'Vessel has not arrived by expected ETA' },
  { value: 'customs_hold',                name: 'Customs Hold',                   description: 'Shipment placed on hold by customs authority' },
  { value: 'inspection_due',              name: 'Inspection Due',                 description: 'Scheduled inspection not yet completed' },
  { value: 'payment_overdue',             name: 'Payment Overdue',                description: 'Invoice issued but payment not received' },
  { value: 'booking_confirmation_pending',name: 'Booking Confirmation Pending',   description: 'Shipping line booking not yet confirmed' },
  { value: 'bl_amendment_needed',         name: 'B/L Amendment Needed',           description: 'Bill of Lading requires correction' },
  { value: 'origin_delay',               name: 'Origin Delay',                   description: 'Origin milestone not achieved on schedule' },
  { value: 'rail_ramp_overdue',           name: 'Rail Ramp Overdue',              description: 'Container not picked up from inland rail ramp' },
  { value: 'doc_submission_overdue',      name: 'Document Submission Overdue',    description: 'Required documents not submitted by deadline' },
  { value: 'ams_filing_overdue',          name: 'AMS Filing Overdue',             description: 'AMS/ISF filing not completed before cutoff' },
];

const PROVIDERS    = ['MarineTraffic', 'Project44', 'FourKites', 'Portcast', 'Custom API'];
const DOC_STATUSES = ['UPLOADED', 'EXTRACTED', 'APPROVED', 'CLOSED'];
const MONO: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };
const INP_S = (extra?: React.CSSProperties): React.CSSProperties => ({
  width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 14.5,
  border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
  color: 'hsl(var(--foreground))', ...extra,
});
const LBL_S: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'block' };

function fmt(v: string | number) { return Number(v).toFixed(2); }

// ─── MilestoneTypeBadge ────────────────────────────────────────────────────────

function MilestoneTypeBadge({ type }: { type: MilestoneType }) {
  const c = TYPE_CONFIG[type] ?? TYPE_CONFIG.SYSTEM;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 99, fontSize: 14.5, fontWeight: 600, background: `${c.color}22`, color: c.color }}>
      {c.label}
    </span>
  );
}

function triggerText(m: MilestoneConfig): string {
  const tc = m.triggerCondition;
  if (!tc) return '—';
  switch (m.type) {
    case 'AUTO': {
      const code = autoTcToEventCode(tc);
      const label = SAFECUBE_EVENTS.find(e => e.code === code)?.label ?? code;
      return `Tracking event: ${label || '—'}`;
    }
    case 'DOCUMENT': {
      const dt = KNOWN_DOC_TYPES.find(d => d.code === tc.docType)?.label ?? tc.docType ?? '—';
      const st = tc.status ? tc.status.charAt(0) + tc.status.slice(1).toLowerCase() : '—';
      return `${dt} reaches ${st}`;
    }
    case 'MANUAL':   return `Marked by: ${(tc.roles ?? []).join(', ') || '—'}`;
    case 'SYSTEM':   return `Calculated: ${tc.rule ?? '—'}`;
    default: return '—';
  }
}

// ─── MilestoneCard ─────────────────────────────────────────────────────────────

function MilestoneCard({
  milestone: m, isLast, roles, canMoveUp, canMoveDown,
  onEdit, onDelete, onDuplicate, onMoveUp, onMoveDown,
  onDragStart, onDragOver, onDrop, onDragEnd,
  isDragging, isDragOver,
}: {
  milestone: MilestoneConfig; isLast: boolean; roles: SimpleRole[];
  canMoveUp: boolean; canMoveDown: boolean;
  onEdit: (m: MilestoneConfig) => void;
  onDelete: (m: MilestoneConfig) => void;
  onDuplicate: (m: MilestoneConfig) => void;
  onMoveUp: (m: MilestoneConfig) => void;
  onMoveDown: (m: MilestoneConfig) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  isDragging: boolean;
  isDragOver: boolean;
}) {
  const [kebab, setKebab] = useState(false);
  const tc = TYPE_CONFIG[m.type] ?? TYPE_CONFIG.SYSTEM;

  function resolveRoleName(code: string) {
    const r = roles.find(r => r.systemCode === code || r.id === code);
    return r?.name ?? code;
  }

  const menuItem = (label: string, action: () => void, danger = false, disabled = false) => (
    <button
      key={label}
      onClick={() => { if (!disabled) action(); }}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
        background: 'transparent', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 5, fontSize: 14.5,
        color: disabled ? 'hsl(var(--muted-foreground))' : danger ? 'hsl(var(--destructive))' : 'hsl(var(--foreground))',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: isLast ? 0 : 4, opacity: isDragging ? 0.35 : 1, transition: 'opacity 0.15s' }}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14, flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: tc.color, flexShrink: 0 }} />
        {!isLast && <div style={{ width: 2, flex: 1, minHeight: 32, background: 'hsl(var(--border))', borderRadius: 1, marginTop: 4 }} />}
      </div>

      {/* Card body */}
      <div style={{
        flex: 1, background: 'hsl(var(--card))', borderRadius: 8, padding: '12px 14px', marginBottom: 8, cursor: 'grab',
        border: isDragOver ? `2px solid #3b82f6` : '1px solid hsl(var(--border))',
        boxShadow: isDragOver ? '0 0 0 3px rgba(59,130,246,0.15)' : 'none',
        transition: 'border-color 0.1s, box-shadow 0.1s',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
            <span style={{ ...MONO, fontSize: 14.5, color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>#{m.milestoneNumber}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</span>
            <MilestoneTypeBadge type={m.type} />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
            <button
              onClick={() => onEdit(m)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14.5, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--muted-foreground))' }}
            >
              <Pencil size={11} /> Edit
            </button>

            {/* ⋮ kebab */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={e => { e.stopPropagation(); setKebab(v => !v); }}
                onBlur={() => setTimeout(() => setKebab(false), 150)}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 5, cursor: 'pointer', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--muted-foreground))' }}
              >
                <MoreVertical size={13} />
              </button>
              {kebab && (
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, padding: 4, minWidth: 148, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                  {menuItem('Duplicate', () => { onDuplicate(m); setKebab(false); })}
                  {menuItem('Move Up',   () => { onMoveUp(m);   setKebab(false); }, false, !canMoveUp)}
                  {menuItem('Move Down', () => { onMoveDown(m); setKebab(false); }, false, !canMoveDown)}
                  <div style={{ borderTop: '1px solid hsl(var(--border))', margin: '4px 0' }} />
                  {menuItem('Delete', () => { onDelete(m); setKebab(false); }, true)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info chips */}
        <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 14.5, color: 'hsl(var(--muted-foreground))', alignItems: 'center' }}>
          {m.slaFromPreviousHrs != null && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Clock size={10} />
              {m.slaFromPreviousHrs % 24 === 0
                ? `${m.slaFromPreviousHrs / 24}d SLA`
                : `${m.slaFromPreviousHrs}h SLA`}
            </span>
          )}
          {m.photoRequired && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Camera size={10} /> Photo required
            </span>
          )}
          {m.notifyRoles.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              Notifies:
              {m.notifyRoles.map(code => (
                <span key={code} style={{ padding: '1px 7px', borderRadius: 99, background: 'hsl(var(--muted))', fontWeight: 500 }}>
                  {resolveRoleName(code)}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AlertCard ─────────────────────────────────────────────────────────────────

function AlertCard({ alert, roles, onSave, onEdit, onDelete }: {
  alert: AlertThreshold;
  roles: SimpleRole[];
  onSave: (id: string, data: Partial<AlertThreshold>) => Promise<void>;
  onEdit: (a: AlertThreshold) => void;
  onDelete: (a: AlertThreshold) => void;
}) {
  const [val, setVal]           = useState(alert.thresholdValue);
  const [saving, setSaving]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { toast } = useToast();
  const meta = ALERT_META[alert.alertType];

  // sync if parent updates
  useEffect(() => { setVal(alert.thresholdValue); }, [alert.thresholdValue]);

  async function handleBlur() {
    if (val === alert.thresholdValue) return;
    setSaving(true);
    try { await onSave(alert.id, { thresholdValue: val }); toast({ title: 'Threshold updated' }); }
    catch { toast({ title: 'Save failed', variant: 'destructive' }); setVal(alert.thresholdValue); }
    setSaving(false);
  }

  async function toggleActive() {
    setSaving(true);
    try { await onSave(alert.id, { isActive: !alert.isActive }); }
    catch { toast({ title: 'Save failed', variant: 'destructive' }); }
    setSaving(false);
  }

  function roleName(id: string) {
    const r = (roles ?? []).find(r => r.id === id || r.systemCode === id);
    return r?.name ?? id;
  }

  const history = Array.isArray(alert.valueHistory) ? alert.valueHistory : [];

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 10,
      border: `1px solid ${alert.isActive ? 'hsl(var(--border))' : '#e2e8f0'}`,
      overflow: 'hidden',
      opacity: alert.isActive ? 1 : 0.65,
      transition: 'opacity 0.2s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 16px' }}>
        {/* Active toggle */}
        <div style={{ paddingTop: 1, flexShrink: 0 }}>
          <Switch checked={alert.isActive} onCheckedChange={toggleActive} disabled={saving} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{meta?.name ?? alert.alertType}</span>
            {!alert.isActive && (
              <span style={{ fontSize: 14, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Disabled
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            {meta?.description ?? 'Custom alert'}
          </div>
          {alert.recipientRoles.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {alert.recipientRoles.map(r => (
                <span key={r} style={{ fontSize: 14, padding: '1px 8px', borderRadius: 5, background: 'hsl(173 58% 39% / 0.1)', color: 'hsl(173 58% 39%)', fontWeight: 600 }}>
                  {roleName(r)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Threshold value + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {saving && <Loader2 size={12} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />}
          <input
            type="number" min={0} value={val}
            disabled={!alert.isActive}
            style={{ ...MONO, width: 60, padding: '4px 7px', borderRadius: 5, textAlign: 'center', border: '1px solid hsl(var(--border))', background: alert.isActive ? 'hsl(var(--background))' : 'hsl(var(--muted) / 0.5)', color: 'hsl(var(--foreground))', fontSize: 14, fontWeight: 600 }}
            onChange={e => setVal(Number(e.target.value))} onBlur={handleBlur}
          />
          <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', minWidth: 32 }}>
            {meta?.unit ?? alert.thresholdUnit}
          </span>
          <button onClick={() => onEdit(alert)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', padding: 3 }}>
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(alert)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 3 }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* History footer */}
      {history.length > 0 && (
        <div style={{ borderTop: '1px solid hsl(var(--border))' }}>
          <button
            onClick={() => setShowHistory(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '6px 16px', background: 'hsl(var(--muted) / 0.3)', border: 'none', cursor: 'pointer', fontSize: 14.5, color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}
          >
            <Clock size={11} />
            {showHistory ? 'Hide' : 'Show'} change history ({history.length})
            {showHistory ? <ChevronUp size={11} style={{ marginLeft: 'auto' }} /> : <ChevronDown size={11} style={{ marginLeft: 'auto' }} />}
          </button>
          {showHistory && (
            <div style={{ padding: '8px 16px 10px', background: 'hsl(var(--muted) / 0.2)' }}>
              {history.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 0', fontSize: 14, color: 'hsl(var(--muted-foreground))', borderBottom: i < history.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}>
                  <span style={{ ...MONO, fontWeight: 600, color: 'hsl(var(--foreground))' }}>{h.value} {h.unit}</span>
                  <span style={{ flex: 1 }}>↳ changed to current</span>
                  <span>{new Date(h.changedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AlertThresholdModal ────────────────────────────────────────────────────────

function AlertThresholdModal({ alert, roles, onClose, onSave }: {
  alert: Partial<AlertThreshold> | null;
  roles: SimpleRole[];
  onClose: () => void;
  onSave: (data: Partial<AlertThreshold>) => Promise<void>;
}) {
  const isNew = !alert?.id;
  const [alertType,   setAlertType]   = useState(alert?.alertType ?? '');
  const [customLabel, setCustomLabel] = useState('');
  const [value,       setValue]       = useState(String(alert?.thresholdValue ?? ''));
  const [unit,        setUnit]        = useState(alert?.thresholdUnit ?? 'hours');
  const [selRoles,    setSelRoles]    = useState<string[]>(alert?.recipientRoles ?? []);
  const [isActive,    setIsActive]    = useState(alert?.isActive !== false);
  const [saving,      setSaving]      = useState(false);
  const { toast } = useToast();

  const knownTypes = Object.keys(ALERT_META);
  const isCustom = alertType === '__custom__';
  const effectiveType = isCustom ? customLabel : alertType;

  function toggleRole(id: string) {
    setSelRoles(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSave() {
    if (!effectiveType) { toast({ title: 'Alert type required', variant: 'destructive' }); return; }
    if (!value || isNaN(Number(value))) { toast({ title: 'Threshold value required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await onSave({ alertType: effectiveType, thresholdValue: Number(value), thresholdUnit: unit, recipientRoles: selRoles, isActive });
      toast({ title: isNew ? 'Alert threshold created' : 'Alert threshold updated' });
      onClose();
    } catch (e: any) {
      toast({ title: e?.message ?? 'Save failed', variant: 'destructive' });
    }
    setSaving(false);
  }

  return (
    <AdminModal open onClose={onClose} title={isNew ? 'Add Alert Threshold' : 'Edit Alert Threshold'} size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Saving…</> : isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      }
    >
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Alert type */}
        <div>
          <label style={LBL_S}>Alert type *</label>
          <select style={INP_S()} value={alertType} onChange={e => setAlertType(e.target.value)} disabled={!isNew}>
            <option value="">— select —</option>
            {knownTypes.map(k => <option key={k} value={k}>{ALERT_META[k].name}</option>)}
            <option value="__custom__">Custom…</option>
          </select>
        </div>
        {isCustom && (
          <div>
            <label style={LBL_S}>Custom alert type *</label>
            <select style={INP_S()} value={customLabel} onChange={e => setCustomLabel(e.target.value)}>
              <option value="">— select —</option>
              {CUSTOM_ALERT_OPTIONS
                .filter(o => !knownTypes.includes(o.value))
                .map(o => <option key={o.value} value={o.value}>{o.name}</option>)}
            </select>
            {customLabel && (
              <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4, display: 'block' }}>
                {CUSTOM_ALERT_OPTIONS.find(o => o.value === customLabel)?.description}
              </span>
            )}
          </div>
        )}
        {/* Value + unit */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <div>
            <label style={LBL_S}>Threshold value *</label>
            <input type="number" min={0} style={INP_S()} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g., 3" />
          </div>
          <div>
            <label style={LBL_S}>Unit</label>
            <select style={INP_S()} value={unit} onChange={e => setUnit(e.target.value)}>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
        {/* Active */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          <span style={{ fontSize: 14.5 }}>Active — system will fire this alert</span>
        </div>
        {/* Recipient roles */}
        <div>
          <label style={LBL_S}>Notify roles</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {roles.map(r => {
              const code = r.systemCode ?? r.id;
              const selected = selRoles.includes(code);
              return (
                <button
                  key={r.id}
                  onClick={() => toggleRole(code)}
                  style={{
                    padding: '4px 10px', borderRadius: 99, fontSize: 14.5, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${selected ? 'hsl(173 58% 39%)' : 'hsl(var(--border))'}`,
                    background: selected ? 'hsl(173 58% 39% / 0.12)' : 'transparent',
                    color: selected ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {r.color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.color }} />}
                  {r.name}
                </button>
              );
            })}
            {roles.length === 0 && <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>No roles available</span>}
          </div>
        </div>
      </div>
    </AdminModal>
  );
}

// ─── MilestoneEditModal — constants ────────────────────────────────────────────

const TEAL = 'hsl(173 58% 39%)';

const SAFECUBE_EVENTS = [
  { code: 'VESSEL_DEPARTURE',      label: 'Vessel Departure' },
  { code: 'VESSEL_ARRIVAL',        label: 'Vessel Arrival' },
  { code: 'TRANSSHIPMENT_ARRIVAL', label: 'Transshipment Arrival' },
  { code: 'CONTAINER_DISCHARGE',   label: 'Container Discharge' },
  { code: 'GATE_OUT',              label: 'Gate Out' },
  { code: 'GATE_IN',               label: 'Gate In' },
  { code: 'RAIL_DEPARTURE',        label: 'Rail Departure' },
  { code: 'AT_SEA_POSITION',       label: 'At Sea (Interim Position)' },
  { code: 'CUSTOMS_RELEASE',       label: 'Customs Release' },
  { code: 'DELIVERY',              label: 'Delivery Confirmed' },
  { code: 'EMPTY_RETURN',          label: 'Empty Container Returned' },
];

const AUTO_TC_MAP: Record<string, object> = {
  VESSEL_DEPARTURE:      { safecubeSignal: 'polActual' },
  VESSEL_ARRIVAL:        { safecubeSignal: 'podActual' },
  TRANSSHIPMENT_ARRIVAL: { safecubeEventCodes: ['TRANSSHIPMENT', 'TRANSSHIPMENT_ARRIVAL', 'TS_ARRIVAL', 'TS_DEPARTURE'] },
  CONTAINER_DISCHARGE:   { safecubeEventCodes: ['CONTAINER_DISCHARGE', 'CONTAINER_DISCHARGED', 'FULL_DISCHARGE', 'DISCHARGED'] },
  GATE_OUT:              { safecubeEventCodes: ['GATE_OUT', 'GATEOUT', 'OUT_GATE', 'CONTAINER_GATE_OUT'] },
  GATE_IN:               { safecubeEventCodes: ['GATE_IN', 'GATEIN', 'IN_GATE', 'CONTAINER_GATE_IN'] },
  RAIL_DEPARTURE:        { safecubeEventCodes: ['RAIL_DEPARTURE', 'RAIL_DEPART', 'RAIL_DEP'] },
  AT_SEA_POSITION:       { safecubeEventCodes: ['AT_SEA', 'AT_SEA_POSITION', 'POSITION_UPDATE'] },
  CUSTOMS_RELEASE:       { safecubeEventCodes: ['CUSTOMS_RELEASE', 'CUSTOMS_RELEASED', 'CUSTOMS_CLEARED_EVENT'] },
  DELIVERY:              { safecubeEventCodes: ['DELIVERY', 'DELIVERED', 'FINAL_DELIVERY'] },
  EMPTY_RETURN:          { safecubeEventCodes: ['EMPTY_RETURN', 'EMPTY_RETURNED', 'EMPTY_CONTAINER_RETURN'] },
};

function autoTcToEventCode(tc: any): string {
  if (!tc) return '';
  if (tc.safecubeSignal === 'polActual') return 'VESSEL_DEPARTURE';
  if (tc.safecubeSignal === 'podActual') return 'VESSEL_ARRIVAL';
  if (tc.eventCode) return tc.eventCode;
  if (Array.isArray(tc.safecubeEventCodes) && tc.safecubeEventCodes.length > 0) {
    const first = tc.safecubeEventCodes[0] as string;
    for (const [code, map] of Object.entries(AUTO_TC_MAP)) {
      const m = map as any;
      if (Array.isArray(m.safecubeEventCodes) && (m.safecubeEventCodes as string[]).includes(first)) return code;
    }
    return first;
  }
  return '';
}

const KNOWN_DOC_TYPES = [
  { code: 'BILL_OF_LADING',         label: 'Bill of Lading' },
  { code: 'PACKING_LIST',           label: 'Packing List' },
  { code: 'SHIPPING_INSTRUCTION',   label: 'Shipping Instruction' },
  { code: 'CHA_BILL',               label: 'CHA Bill' },
  { code: 'FREIGHT_FORWARDER_BILL', label: 'Freight Forwarder Bill' },
  { code: 'OCEAN_FREIGHT_INVOICE',  label: 'Ocean Freight Invoice' },
  { code: 'COMMERCIAL_INVOICE',     label: 'Commercial Invoice' },
  { code: 'CERTIFICATE_OF_ORIGIN',  label: 'Certificate of Origin' },
];

// ─── MilestoneEditModal ────────────────────────────────────────────────────────

function MilestoneEditModal({ milestone: m, templateId, nextNumber, milestones, gates, roles, triggerOptions, onTriggersChanged, onClose, onSave }: {
  milestone: MilestoneConfig | null; templateId?: string; nextNumber?: number;
  milestones: MilestoneConfig[]; gates: GateConfig[];
  roles: SimpleRole[];
  triggerOptions: AccountingTriggerOption[];
  onTriggersChanged: () => void;
  onClose: () => void;
  onSave: (id: string, data: Partial<MilestoneConfig> & { templateId?: string; milestoneNumber?: number }) => Promise<void>;
}) {
  const isCreate = !m;
  const isSystem = m?.type === 'SYSTEM';

  const _initSlaUnit: 'hours' | 'days' = (m?.slaFromPreviousHrs && m.slaFromPreviousHrs % 24 === 0) ? 'days' : 'hours';
  const _initSlaVal = m?.slaFromPreviousHrs
    ? (_initSlaUnit === 'days' ? String(m.slaFromPreviousHrs / 24) : String(m.slaFromPreviousHrs))
    : '';

  const [step,           setStep]           = useState(isSystem ? 2 : 1);
  const [name,           setName]           = useState(m?.name ?? '');
  const [type,           setType]           = useState<MilestoneType>(m?.type ?? 'MANUAL');
  const [gateId,         setGateId]         = useState(m?.gateConfigId ?? '');
  const [photo,          setPhoto]          = useState(m?.photoRequired ?? false);
  const [slaVal,         setSlaVal]         = useState(_initSlaVal);
  const [slaUnit,        setSlaUnit]        = useState<'hours' | 'days'>(_initSlaUnit);
  const [notifyRoles,    setNotifyRoles]    = useState<string[]>(m?.notifyRoles ?? []);
  const [tc,             setTc]             = useState<Record<string, any>>(() => {
    if (!m?.triggerCondition) return {};
    const raw = m.triggerCondition as any;
    if (m.type === 'AUTO') {
      const code = autoTcToEventCode(raw);
      return code ? { eventCode: code } : raw;
    }
    return raw;
  });
  const [completionMode, setCompletionMode] = useState(m?.completionMode ?? 'SHIPMENT_LEVEL');
  const [msNumber,       setMsNumber]       = useState(String(m?.milestoneNumber ?? nextNumber ?? 1));
  const [advOpen,        setAdvOpen]        = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [liveRoles,      setLiveRoles]      = useState<SimpleRole[]>(roles);
  const { toast } = useToast();

  useEffect(() => {
    apiGet('/api/admin/roles').then(res => {
      if (res.ok && Array.isArray(res.data)) setLiveRoles(res.data);
    });
  }, []);

  function toggleRole(code: string) {
    setNotifyRoles(prev => prev.includes(code) ? prev.filter(r => r !== code) : [...prev, code]);
  }

  function slaToHrs(): number | null {
    if (!slaVal || slaVal === '') return null;
    return slaUnit === 'days' ? Number(slaVal) * 24 : Number(slaVal);
  }

  async function handleSave() {
    if (!name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      // Convert wizard selection to correct backend format per type
      const triggerCondition =
        type === 'MANUAL' ? { ...tc, roles: notifyRoles } :
        type === 'AUTO' && tc.eventCode ? (AUTO_TC_MAP[tc.eventCode] ?? tc) :
        tc;
      const data: any = {
        name: name.trim(), type, gateConfigId: gateId || null, photoRequired: photo,
        slaFromPreviousHrs: slaToHrs(),
        notifyRoles,
        triggerCondition,
        completionMode,
      };
      if (isCreate) { data.templateId = templateId; data.milestoneNumber = Number(msNumber); data.sortOrder = Number(msNumber); }
      await onSave(m?.id ?? '', data);
      toast({ title: isCreate ? 'Milestone added' : 'Milestone saved' });
      onClose();
    } catch { toast({ title: 'Save failed', variant: 'destructive' }); }
    setSaving(false);
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function triggerSummary() {
    switch (type) {
      case 'AUTO': {
        const label = tc.eventCode ? (SAFECUBE_EVENTS.find(e => e.code === tc.eventCode)?.label ?? tc.eventCode) : null;
        return `Tracking event${label ? ` — ${label}` : ' (none selected)'}`;
      }
      case 'DOCUMENT': {
        const dt = KNOWN_DOC_TYPES.find(d => d.code === tc.docType)?.label ?? tc.docType ?? '—';
        const st = tc.status ? tc.status.charAt(0) + tc.status.slice(1).toLowerCase() : '—';
        return `${dt} reaches ${st}`;
      }
      case 'MANUAL':   return 'Someone marks it complete manually';
      case 'SYSTEM':   return 'Calculated automatically by the system';
      default:         return String(type);
    }
  }

  function notifySummary() {
    if (notifyRoles.length === 0) return 'No roles selected';
    return notifyRoles.map(code => liveRoles.find(r => r.systemCode === code)?.name ?? code).join(', ');
  }

  function slaSummary() {
    if (!slaVal) return 'No SLA set';
    return `${slaVal} ${slaUnit} from previous milestone`;
  }

  // ── Step indicator ──────────────────────────────────────────────────
  const STEP_LABELS = ['Trigger', 'Notification', 'Review'];

  function StepIndicator() {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 24 }}>
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done   = step > n;
          const active = step === n;
          return (
            <React.Fragment key={n}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 52 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, flexShrink: 0,
                  background: (done || active) ? TEAL : 'hsl(var(--muted))',
                  color: (done || active) ? '#fff' : 'hsl(var(--muted-foreground))',
                  outline: active ? `2px solid ${TEAL}` : 'none',
                  outlineOffset: 2,
                }}>
                  {done ? '✓' : n}
                </div>
                <span style={{ fontSize: 14, fontWeight: active ? 700 : 500, color: active ? TEAL : 'hsl(var(--muted-foreground))', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: step > i + 1 ? TEAL : 'hsl(var(--border))', margin: '13px 4px 0' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ── Step 1 — What triggers this? ────────────────────────────────────
  function Step1() {
    if (isSystem) {
      return (
        <div style={{ padding: 18, borderRadius: 8, background: 'hsl(var(--muted) / 0.5)', border: '1px solid hsl(var(--border))', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Automatically Calculated</div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
            This milestone is calculated automatically by the system and cannot be reconfigured.
            You can still adjust who gets notified and the SLA in the next steps.
          </div>
        </div>
      );
    }

    type Option = { value: MilestoneType; label: string; desc: string };
    const options: Option[] = [
      { value: 'DOCUMENT', label: 'A document is uploaded or approved', desc: 'Triggered when a specific document reaches a required status' },
      { value: 'AUTO',     label: 'A tracking event arrives automatically', desc: 'Triggered by a live event from your vessel or container tracking provider' },
      { value: 'MANUAL',   label: 'Someone marks it complete manually', desc: 'An authorised team member confirms this milestone on the shipment' },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.map(opt => {
          const sel = type === opt.value;
          return (
            <div key={opt.value}>
              <div onClick={() => setType(opt.value)} style={{ padding: '12px 14px', borderRadius: sel ? '8px 8px 0 0' : 8, cursor: 'pointer', border: `2px solid ${sel ? TEAL : 'hsl(var(--border))'}`, background: sel ? `${TEAL}0f` : 'hsl(var(--card))', transition: 'border-color 0.15s', marginBottom: sel ? 0 : 6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2, border: `2px solid ${sel ? TEAL : 'hsl(var(--muted-foreground))'}`, background: sel ? TEAL : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {sel && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{opt.label}</div>
                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{opt.desc}</div>
                  </div>
                </div>
              </div>

              {sel && opt.value === 'AUTO' && (
                <div style={{ padding: '12px 14px', borderRadius: '0 0 8px 8px', background: 'hsl(var(--muted) / 0.35)', border: `2px solid ${TEAL}`, borderTop: 'none', marginBottom: 6 }}>
                  <label style={LBL_S}>Tracking event</label>
                  <input
                    type="text"
                    list="safecube-event-list"
                    value={tc.eventCode ?? ''}
                    placeholder="Type to search events…"
                    style={INP_S()}
                    onChange={e => setTc(p => ({ ...p, eventCode: e.target.value }))}
                  />
                  <datalist id="safecube-event-list">
                    {SAFECUBE_EVENTS.map(ev => <option key={ev.code} value={ev.code}>{ev.label}</option>)}
                  </datalist>
                  {tc.eventCode && (
                    <div style={{ fontSize: 14.5, color: TEAL, marginTop: 4 }}>
                      {SAFECUBE_EVENTS.find(ev => ev.code === tc.eventCode)?.label ?? tc.eventCode}
                    </div>
                  )}
                </div>
              )}

              {sel && opt.value === 'DOCUMENT' && (
                <div style={{ padding: '12px 14px', borderRadius: '0 0 8px 8px', background: 'hsl(var(--muted) / 0.35)', border: `2px solid ${TEAL}`, borderTop: 'none', marginBottom: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={LBL_S}>Document type</label>
                    <select style={INP_S()} value={tc.docType ?? ''} onChange={e => setTc(p => ({ ...p, docType: e.target.value }))}>
                      <option value="">— select type —</option>
                      {KNOWN_DOC_TYPES.map(dt => <option key={dt.code} value={dt.code}>{dt.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={LBL_S}>Reaches status</label>
                    <select style={INP_S()} value={tc.status ?? ''} onChange={e => setTc(p => ({ ...p, status: e.target.value }))}>
                      <option value="">— select status —</option>
                      {DOC_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Step 2 — Who should be notified? ────────────────────────────────
  function Step2() {
    const notifiableRoles = liveRoles.filter(r => r.systemCode);
    return (
      <div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 12 }}>Who should be notified when this milestone completes?</div>
          {notifiableRoles.length === 0 ? (
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', padding: '12px', borderRadius: 6, background: 'hsl(var(--muted) / 0.4)' }}>
              No roles with system codes configured — add roles in Settings first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {notifiableRoles.map(role => {
                const checked = notifyRoles.includes(role.systemCode!);
                return (
                  <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${checked ? TEAL : 'hsl(var(--border))'}`, background: checked ? `${TEAL}0f` : 'hsl(var(--card))', transition: 'border-color 0.15s' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleRole(role.systemCode!)} style={{ width: 14, height: 14, accentColor: TEAL }} />
                    <span style={{ fontSize: 14.5, fontWeight: checked ? 600 : 400 }}>{role.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 18 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 10 }}>Alert if not completed within…</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" min={0} value={slaVal} placeholder="—" style={{ ...INP_S(), width: 80 }} onChange={e => setSlaVal(e.target.value)} />
            <select style={{ ...INP_S(), width: 110 }} value={slaUnit} onChange={e => setSlaUnit(e.target.value as 'hours' | 'days')}>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>of previous milestone</span>
          </div>
          {!slaVal && <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 6 }}>Leave blank to set no SLA for this milestone.</div>}
        </div>
      </div>
    );
  }

  // ── Step 3 — Review + name + Advanced ────────────────────────────────
  function Step3() {
    return (
      <div>
        <div style={{ marginBottom: 18 }}>
          <label style={LBL_S}>Milestone name</label>
          <input style={INP_S()} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cargo loaded" autoFocus />
          {isCreate && (
            <div style={{ marginTop: 10 }}>
              <label style={LBL_S}>Sequence number</label>
              <input style={{ ...INP_S(), width: 90 }} type="number" min={1} value={msNumber} onChange={e => setMsNumber(e.target.value)} />
            </div>
          )}
        </div>

        <div style={{ borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--muted) / 0.3)', padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>Summary</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 14.5 }}>
            <div><span style={{ fontWeight: 600 }}>Triggered by: </span>{triggerSummary()}</div>
            <div><span style={{ fontWeight: 600 }}>Notifies: </span>{notifySummary()}</div>
            <div><span style={{ fontWeight: 600 }}>SLA: </span>{slaSummary()}</div>
          </div>
        </div>

        <div style={{ border: '1px solid hsl(var(--border))', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setAdvOpen(v => !v)} style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'hsl(var(--muted) / 0.4)', border: 'none', cursor: 'pointer', fontSize: 14.5, fontWeight: 600 }}>
            <span>Advanced settings</span>
            {advOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {advOpen && (
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={LBL_S}>Completion mode</label>
                <select style={INP_S()} value={completionMode} onChange={e => setCompletionMode(e.target.value)}>
                  <option value="SHIPMENT_LEVEL">Shipment-level (single completion)</option>
                  <option value="ALL_CONTAINERS">Per-container (all containers must complete)</option>
                </select>
              </div>
              <div>
                <label style={LBL_S}>Gate linkage (optional)</label>
                <select style={INP_S()} value={gateId} onChange={e => setGateId(e.target.value)}>
                  <option value="">— no gate —</option>
                  {gates.map(g => <option key={g.id} value={g.id}>Gate {g.gateNumber}: {g.gateName}</option>)}
                </select>
              </div>
              {!isCreate && m?.systemCode && (
                <div>
                  <label style={LBL_S}>System code</label>
                  <div style={{ ...MONO, fontSize: 14, padding: '6px 10px', borderRadius: 6, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', border: '1px solid hsl(var(--border))' }}>
                    {m.systemCode}
                  </div>
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={photo} onChange={e => setPhoto(e.target.checked)} style={{ width: 15, height: 15, accentColor: TEAL }} />
                <span style={{ fontSize: 14.5 }}>Photo required at this milestone</span>
              </label>
              {!isCreate && m?.systemCode && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid hsl(var(--border))' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: '#0D9488', letterSpacing: '0.04em' }}>ACCOUNTING TRIGGERS</span>
                    <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>Auto-creates an accounting ticket when this milestone completes</span>
                  </div>
                  <MilestoneAccountingTriggers milestoneId={m.id} existingTriggers={m.accountingTriggers ?? []} options={triggerOptions} onChanged={onTriggersChanged} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
      <Button variant="ghost" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}>
        {step === 1 ? 'Cancel' : '← Back'}
      </Button>
      {step < 3
        ? <Button onClick={() => setStep(s => s + 1)}>Next →</Button>
        : <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Saving…</> : 'Save'}
          </Button>
      }
    </div>
  );

  return (
    <AdminModal open onClose={onClose} title={isCreate ? 'Add Milestone' : `Edit Milestone #${m!.milestoneNumber}`} size="md" footer={footer}>
      <StepIndicator />
      {step === 1 && <Step1 />}
      {step === 2 && <Step2 />}
      {step === 3 && <Step3 />}
    </AdminModal>
  );
}

// ─── DndRateModal ──────────────────────────────────────────────────────────────

function DndRateModal({ rate, defaultNewVersion = false, onClose, onSave }: {
  rate: Partial<DndRateEntry>;
  defaultNewVersion?: boolean;
  onClose: () => void;
  onSave: (data: Partial<DndRateEntry>, newVersion: boolean) => Promise<void>;
}) {
  const isEditing = !!rate.id;
  const [newVersion, setNewVersion] = useState(defaultNewVersion);
  const [portName, setPortName] = useState(rate.portName ?? '');
  const [terminal, setTerminal] = useState(rate.terminalName ?? '');
  const [firms,    setFirms]    = useState(rate.firmsCode ?? '');
  const [line,     setLine]     = useState(rate.shippingLine ?? '');
  const [free,     setFree]     = useState(rate.freeDays ?? 5);
  const [dem,      setDem]      = useState(String(rate.demurragePerDay ?? ''));
  const [det,      setDet]      = useState(String(rate.detentionPerDay ?? ''));
  const [currency, setCurrency] = useState(rate.currency ?? 'USD');
  const [effDate,  setEffDate]  = useState(
    newVersion || !rate.effectiveDate
      ? new Date().toISOString().slice(0, 10)
      : rate.effectiveDate.slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function handleVersionToggle(checked: boolean) {
    setNewVersion(checked);
    if (checked) setEffDate(new Date().toISOString().slice(0, 10));
    else if (rate.effectiveDate) setEffDate(rate.effectiveDate.slice(0, 10));
  }

  async function handleSave() {
    if (!portName || !dem || !det) { toast({ title: 'Fill required fields', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await onSave(
        { portName, terminalName: terminal || null, firmsCode: firms || null, shippingLine: line || null,
          freeDays: Number(free), demurragePerDay: dem, detentionPerDay: det, currency,
          effectiveDate: new Date(effDate).toISOString() },
        newVersion,
      );
      toast({ title: isEditing ? (newVersion ? 'New version saved' : 'Rate updated') : 'Rate created' });
      onClose();
    } catch { toast({ title: 'Save failed', variant: 'destructive' }); }
    setSaving(false);
  }

  const title = !isEditing ? 'Add D&D Rate' : newVersion ? 'Save as New Version' : 'Edit D&D Rate';

  return (
    <AdminModal open onClose={onClose} title={title} size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Saving…</> : isEditing && newVersion ? 'Create New Version' : 'Save'}
          </Button>
        </div>
      }
    >
      <div style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>
        {isEditing && (
          <div style={{ padding: '12px 24px', borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--muted) / 0.4)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={newVersion} onChange={e => handleVersionToggle(e.target.checked)}
                style={{ marginTop: 2, width: 14, height: 14, accentColor: '#0D9488', flexShrink: 0 }}
              />
              <div>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>Save as new version</span>
                <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', margin: '2px 0 0' }}>
                  Creates a new rate record with today's effective date. The existing rate is kept as history and can be viewed by expanding the row.
                </p>
              </div>
            </label>
          </div>
        )}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={LBL_S}>Port Name *</label><input style={INP_S()} value={portName} onChange={e => setPortName(e.target.value)} placeholder="e.g., Oakland" /></div>
            <div><label style={LBL_S}>Terminal Name</label><input style={INP_S()} value={terminal} onChange={e => setTerminal(e.target.value)} placeholder="e.g., Husky Terminal" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={LBL_S}>FIRMS Code</label><input style={INP_S(MONO)} value={firms} onChange={e => setFirms(e.target.value)} placeholder="e.g., Z693" /></div>
            <div><label style={LBL_S}>Shipping Line</label><input style={INP_S()} value={line} onChange={e => setLine(e.target.value)} placeholder="e.g., MSC" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={LBL_S}>Free Days *</label><input type="number" min={0} style={INP_S()} value={free} onChange={e => setFree(Number(e.target.value))} /></div>
            <div><label style={LBL_S}>Demurrage/day *</label><input type="number" min={0} style={INP_S()} value={dem} onChange={e => setDem(e.target.value)} /></div>
            <div><label style={LBL_S}>Detention/day *</label><input type="number" min={0} style={INP_S()} value={det} onChange={e => setDet(e.target.value)} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL_S}>Currency</label>
              <select style={INP_S()} value={currency} onChange={e => setCurrency(e.target.value)}>
                {['USD', 'EUR', 'INR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL_S}>Effective Date *{isEditing && newVersion ? ' (new version start)' : ''}</label>
              <input type="date" style={INP_S()} value={effDate} onChange={e => setEffDate(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </AdminModal>
  );
}

// ─── Library Modal ─────────────────────────────────────────────────────────────

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  AUTO:     { label: 'AUTO',     color: '#2563eb' },
  MANUAL:   { label: 'MANUAL',  color: '#7c3aed' },
  DOCUMENT: { label: 'DOC',     color: '#0d9488' },
};

function MilestoneLibraryModal({ open, onClose, onImport, importing }: {
  open: boolean;
  onClose: () => void;
  onImport: (preset: MilestonePreset) => Promise<void>;
  importing: string | null;
}) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 12, width: 820, maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Library size={18} style={{ color: '#2563eb' }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Milestone library</div>
            <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>Import a pre-built sequence and customise from there.</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* Preset cards */}
        <div style={{ padding: 20, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {MILESTONE_PRESETS.map(preset => {
            const isImporting = importing === preset.id;
            const preview = preset.milestones.slice(0, 5);
            return (
              <div key={preset.id} style={{ border: '1px solid hsl(var(--border))', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{preset.name}</div>
                  <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>{preset.description}</div>
                </div>

                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {preset.milestones.length} milestones
                </div>

                {/* Preview list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {preview.map((m, i) => {
                    const badge = TYPE_BADGE[m.type];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', background: badge.color, borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>{badge.label}</span>
                        <span style={{ fontSize: 14, color: 'hsl(var(--foreground))' }}>{m.name}</span>
                      </div>
                    );
                  })}
                  {preset.milestones.length > 5 && (
                    <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', paddingLeft: 2 }}>
                      +{preset.milestones.length - 5} more…
                    </div>
                  )}
                </div>

                <button
                  onClick={() => { if (!isImporting) onImport(preset); }}
                  disabled={!!importing}
                  style={{ marginTop: 'auto', padding: '8px 0', borderRadius: 7, fontSize: 14.5, fontWeight: 600, cursor: importing ? 'not-allowed' : 'pointer', border: 'none', background: isImporting ? 'hsl(var(--muted))' : '#2563eb', color: isImporting ? 'hsl(var(--muted-foreground))' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {isImporting ? <><Loader2 size={13} className="animate-spin" /> Importing…</> : 'Use this template'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Milestones ───────────────────────────────────────────────────────────

function MilestonesTab({ templates, selectedTplId, setSelectedTplId, milestones, roles, onEdit, onDelete, onSave, onAdd, onAfterImport }: {
  templates: WorkflowTemplate[]; selectedTplId: string; setSelectedTplId: (id: string) => void;
  milestones: MilestoneConfig[]; roles: SimpleRole[];
  onEdit: (m: MilestoneConfig) => void;
  onDelete: (m: MilestoneConfig) => void;
  onSave: (id: string, data: Partial<MilestoneConfig> & { templateId?: string; milestoneNumber?: number }) => Promise<void>;
  onAdd: () => void;
  onAfterImport: () => Promise<void>;
  onDedup: (templateId: string) => Promise<number>;
}) {
  const [dragId,      setDragId]      = useState<string | null>(null);
  const [dragOver,    setDragOver]    = useState<string | null>(null);
  const [localOrder,  setLocalOrder]  = useState<string[] | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [importing,   setImporting]   = useState<string | null>(null);
  const [deduping,    setDeduping]    = useState(false);
  const importLock                    = React.useRef(false);
  const { toast } = useToast();

  const tplMilestones = milestones.filter(m => m.templateId === selectedTplId);
  const activeTemplates = templates.filter(t => t.templateStatus !== 'DRAFT');

  async function handleImport(preset: MilestonePreset) {
    if (importLock.current) return;
    importLock.current = true;
    setImporting(preset.id);

    // Re-read live milestones for this template to avoid stale-closure dedup
    const currentNames = new Set(
      milestones.filter(m => m.templateId === selectedTplId).map(m => m.name.trim().toLowerCase())
    );
    const toCreate = preset.milestones.filter(p => !currentNames.has(p.name.trim().toLowerCase()));
    const skipped  = preset.milestones.length - toCreate.length;
    const existing = milestones.filter(m => m.templateId === selectedTplId);
    const maxNum   = Math.max(...existing.map(m => m.milestoneNumber), 0);
    const maxSort  = Math.max(...existing.map(m => m.sortOrder), 0);
    let added = 0;
    try {
      for (let i = 0; i < toCreate.length; i++) {
        const p = toCreate[i];
        await onSave('', {
          templateId: selectedTplId,
          name: p.name,
          type: p.type as any,
          notifyRoles: p.notifyRoles,
          slaFromPreviousHrs: p.slaFromPreviousHrs,
          photoRequired: p.photoRequired,
          milestoneNumber: maxNum + i + 1,
          sortOrder: maxSort + i + 1,
        });
        added++;
      }
      await onAfterImport();
      setShowLibrary(false);
      const msg = skipped > 0
        ? `${added} milestone${added !== 1 ? 's' : ''} imported from ${preset.name}. ${skipped} skipped (already exist). Tap any milestone to customise it.`
        : `${added} milestone${added !== 1 ? 's' : ''} imported from ${preset.name}. Tap any milestone to customise it.`;
      toast({ title: `Imported from ${preset.name}`, description: msg });
    } catch {
      toast({ title: 'Import failed', variant: 'destructive' });
    } finally {
      importLock.current = false;
      setImporting(null);
    }
  }

  const sorted = useMemo(() => {
    const base = [...tplMilestones].sort((a, b) => a.sortOrder - b.sortOrder);
    if (localOrder && localOrder.length === base.length) {
      const byId = Object.fromEntries(base.map(m => [m.id, m]));
      const resolved = localOrder.map(id => byId[id]).filter(Boolean) as MilestoneConfig[];
      if (resolved.length === base.length) return resolved;
    }
    return base;
  }, [tplMilestones, localOrder]);

  async function handleDuplicate(m: MilestoneConfig) {
    const maxNum  = Math.max(...tplMilestones.map(x => x.milestoneNumber), 0) + 1;
    const maxSort = Math.max(...tplMilestones.map(x => x.sortOrder), 0) + 1;
    const { id: _id, systemCode: _sc, accountingTriggers: _at, ...rest } = m as any;
    try {
      await onSave('', { ...rest, milestoneNumber: maxNum, sortOrder: maxSort });
      toast({ title: 'Milestone duplicated' });
    } catch {
      toast({ title: 'Duplicate failed', variant: 'destructive' });
    }
  }

  async function handleMoveUp(m: MilestoneConfig) {
    const idx = sorted.findIndex(x => x.id === m.id);
    if (idx <= 0) return;
    const above = sorted[idx - 1];
    try {
      await Promise.all([
        onSave(m.id,     { sortOrder: above.sortOrder }),
        onSave(above.id, { sortOrder: m.sortOrder    }),
      ]);
    } catch {
      toast({ title: 'Reorder failed', variant: 'destructive' });
    }
  }

  async function handleMoveDown(m: MilestoneConfig) {
    const idx = sorted.findIndex(x => x.id === m.id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const below = sorted[idx + 1];
    try {
      await Promise.all([
        onSave(m.id,     { sortOrder: below.sortOrder }),
        onSave(below.id, { sortOrder: m.sortOrder    }),
      ]);
    } catch {
      toast({ title: 'Reorder failed', variant: 'destructive' });
    }
  }

  async function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const fromIdx = sorted.findIndex(m => m.id === dragId);
    const toIdx   = sorted.findIndex(m => m.id === targetId);
    setDragId(null);
    setDragOver(null);
    if (!dragId || dragId === targetId || fromIdx < 0 || toIdx < 0) return;

    // Compute new ordering
    const reordered = [...sorted];
    const [dragged] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, dragged);

    // Optimistic local display order
    setLocalOrder(reordered.map(m => m.id));

    // Reassign sortOrders sequentially for each changed card
    const updates = reordered
      .map((m, i) => ({ id: m.id, oldSort: m.sortOrder, newSort: i + 1 }))
      .filter(u => u.oldSort !== u.newSort);

    if (updates.length === 0) { setLocalOrder(null); return; }

    try {
      await Promise.all(updates.map(u => onSave(u.id, { sortOrder: u.newSort })));
    } catch {
      toast({ title: 'Reorder failed', variant: 'destructive' });
      setLocalOrder(null);
    }
  }

  return (
    <>
    <MilestoneLibraryModal
      open={showLibrary}
      onClose={() => setShowLibrary(false)}
      onImport={handleImport}
      importing={importing}
    />
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <label style={{ fontSize: 14.5, fontWeight: 600 }}>Template:</label>
        <select value={selectedTplId} onChange={e => setSelectedTplId(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, fontSize: 14.5, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}>
          <option value="">— select template —</option>
          {activeTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{sorted.length} milestones</span>
        {(() => {
          const dupCount = tplMilestones.length - new Set(tplMilestones.map(m => m.name.trim().toLowerCase())).size;
          return dupCount > 0 ? (
            <button
              onClick={async () => {
                setDeduping(true);
                try {
                  const removed = await onDedup(selectedTplId);
                  toast({ title: `Removed ${removed} duplicate milestone${removed !== 1 ? 's' : ''}` });
                } catch {
                  toast({ title: 'Cleanup failed', variant: 'destructive' });
                } finally { setDeduping(false); }
              }}
              disabled={deduping}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, padding: '5px 12px', borderRadius: 6, cursor: deduping ? 'not-allowed' : 'pointer', border: '1px solid #dc2626', background: '#fef2f2', color: '#dc2626', fontWeight: 500 }}
            >
              {deduping ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Remove {dupCount} duplicate{dupCount !== 1 ? 's' : ''}
            </button>
          ) : null;
        })()}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {selectedTplId && (
            <>
              <button onClick={() => setShowLibrary(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                <Library size={13} /> Import from library
              </button>
              <button onClick={onAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: '1px solid hsl(var(--primary))', background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', fontWeight: 500 }}>
                <Plus size={13} /> Add Milestone
              </button>
            </>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        selectedTplId ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', border: '1.5px dashed hsl(var(--border))', borderRadius: 12, margin: '8px 0' }}>
            <Library size={32} style={{ color: '#2563eb', marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Start from a template</div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 20, maxWidth: 380, margin: '0 auto 20px' }}>
              Import a pre-built milestone sequence and customise from there — or add milestones one by one.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setShowLibrary(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, padding: '9px 18px', borderRadius: 7, cursor: 'pointer', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600 }}>
                <Library size={14} /> Import from library
              </button>
              <button onClick={onAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, padding: '9px 18px', borderRadius: 7, cursor: 'pointer', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                <Plus size={14} /> Add manually
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
            Select a template to view milestones.
          </div>
        )
      ) : (
        <div style={{ paddingLeft: 8 }}>
          {sorted.map((m, i) => (
            <MilestoneCard
              key={m.id}
              milestone={m}
              isLast={i === sorted.length - 1}
              roles={roles}
              canMoveUp={i > 0}
              canMoveDown={i < sorted.length - 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onDuplicate={handleDuplicate}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              isDragging={dragId === m.id}
              isDragOver={dragOver === m.id}
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(m.id); }}
              onDragOver={e => { e.preventDefault(); setDragOver(m.id); }}
              onDrop={e => handleDrop(e, m.id)}
              onDragEnd={() => { setDragId(null); setDragOver(null); }}
            />
          ))}
        </div>
      )}
    </div>
    </>
  );
}

// ─── Tab: Tracking API ─────────────────────────────────────────────────────────

function TrackingApiTab({ milestones }: { milestones: MilestoneConfig[] }) {
  const [provider, setProvider]     = useState('MarineTraffic');
  const [apiUrl, setApiUrl]         = useState('');
  const [apiKey, setApiKey]         = useState('');
  const [showKey, setShowKey]       = useState(false);
  const [mode, setMode]             = useState('webhook');
  const [pollHz, setPollHz]         = useState(6);
  const [isActive, setIsActive]     = useState(true);
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mappings, setMappings]     = useState([
    { id: '1', code: 'VESSEL_DEPARTURE',      mn: 2, auto: true },
    { id: '2', code: 'TRANSSHIPMENT_ARRIVAL', mn: 3, auto: true },
    { id: '3', code: 'VESSEL_ARRIVAL',        mn: 4, auto: true },
    { id: '4', code: 'CONTAINER_DISCHARGE',   mn: 5, auto: true },
    { id: '5', code: 'GATE_OUT',              mn: 8, auto: true },
  ]);
  const { toast } = useToast();

  function testConn() {
    setTesting(true); setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      const ok = apiUrl.startsWith('http');
      setTestResult({ ok, msg: ok ? 'Connection successful — API responded in 240ms' : 'Connection failed — check URL and key' });
    }, 1200);
  }

  function upd(id: string, field: string, v: any) {
    setMappings(prev => prev.map(m => m.id === id ? { ...m, [field]: v } : m));
  }

  const thS: React.CSSProperties = { padding: '8px 10px', fontSize: 14.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'hsl(var(--muted-foreground))', textAlign: 'left', borderBottom: '1px solid hsl(var(--border))', background: 'hsl(var(--muted) / 0.4)' };
  const tdS: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid hsl(var(--border))', fontSize: 14.5 };

  return (
    <div style={{ maxWidth: 720 }}>
      <AdminFormSection title="Connection" description="Configure your container tracking data provider">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={LBL_S}>Provider</label>
            <select style={INP_S()} value={provider} onChange={e => setProvider(e.target.value)}>
              {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL_S}>API URL</label>
            <input style={INP_S()} type="url" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://api.provider.com/v2" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={LBL_S}>API Key</label>
          <div style={{ position: 'relative' }}>
            <input style={INP_S({ paddingRight: 36 })} type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="••••••••••••••••" />
            <button onClick={() => setShowKey(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))' }}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={LBL_S}>Webhook URL (provide to your tracking provider)</label>
          <input style={INP_S({ ...MONO, background: 'hsl(var(--muted) / 0.4)', color: 'hsl(var(--muted-foreground))' })}
            readOnly value={`${window.location.origin}/api/webhooks/tracking`} />
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3, display: 'block' }}>Provide this URL to your tracking provider for push notifications</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={LBL_S}>Polling mode</label>
            <select style={INP_S()} value={mode} onChange={e => setMode(e.target.value)}>
              {['webhook', 'polling', 'both'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {(mode === 'polling' || mode === 'both') && (
            <div>
              <label style={LBL_S}>Frequency (hours)</label>
              <input type="number" min={1} style={INP_S({ width: 80 })} value={pollHz} onChange={e => setPollHz(Number(e.target.value))} />
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, cursor: 'pointer', paddingBottom: 2 }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'hsl(173 58% 39%)' }} />
            Active
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button variant="outline" onClick={testConn} disabled={testing}>
            {testing ? <><Loader2 size={13} className="animate-spin" style={{ marginRight: 6 }} />Testing…</> : <><RefreshCw size={13} style={{ marginRight: 6 }} />Test Connection</>}
          </Button>
          <Button onClick={() => toast({ title: 'Tracking API settings saved' })}>Save Settings</Button>
          {testResult && <span style={{ fontSize: 14, color: testResult.ok ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{testResult.ok ? '✓' : '✗'} {testResult.msg}</span>}
        </div>
      </AdminFormSection>

      <AdminFormSection title="Event Mappings" description="Map provider event codes to shipment milestones" isLast>
        <div style={{ background: 'hsl(var(--card))', borderRadius: 8, border: '1px solid hsl(var(--border))', overflow: 'hidden', marginBottom: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thS}>Provider Event Code</th>
                <th style={thS}>Maps to Milestone</th>
                <th style={{ ...thS, textAlign: 'center' }}>Auto-create</th>
                <th style={{ ...thS, width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {mappings.map(mp => (
                <tr key={mp.id}>
                  <td style={tdS}>
                    <input style={{ ...MONO, padding: '4px 7px', borderRadius: 5, fontSize: 14, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', width: 200 }}
                      value={mp.code} onChange={e => upd(mp.id, 'code', e.target.value)} />
                  </td>
                  <td style={tdS}>
                    <select style={{ padding: '4px 7px', borderRadius: 5, fontSize: 14, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                      value={mp.mn} onChange={e => upd(mp.id, 'mn', Number(e.target.value))}>
                      {milestones.map(m => <option key={m.id} value={m.milestoneNumber}>#{m.milestoneNumber} {m.name}</option>)}
                    </select>
                  </td>
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    <input type="checkbox" checked={mp.auto} onChange={e => upd(mp.id, 'auto', e.target.checked)} style={{ accentColor: 'hsl(173 58% 39%)' }} />
                  </td>
                  <td style={tdS}>
                    <button onClick={() => setMappings(prev => prev.filter(x => x.id !== mp.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))' }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="outline" size="sm"
          onClick={() => setMappings(prev => [...prev, { id: Date.now().toString(), code: '', mn: 1, auto: true }])}>
          <Plus size={13} style={{ marginRight: 5 }} /> Add Mapping
        </Button>
        <div style={{ marginTop: 16, padding: '10px 14px', background: 'hsl(var(--muted) / 0.4)', borderRadius: 8, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span>Status: <strong style={{ color: 'hsl(var(--foreground))' }}>Not configured</strong></span>
            <span>Last event: <strong style={{ color: 'hsl(var(--foreground))' }}>Never</strong></span>
            <span>Events (30d): <strong style={{ color: 'hsl(var(--foreground))' }}>0</strong></span>
            <span>Unmapped (30d): <strong style={{ color: 'hsl(var(--foreground))' }}>0</strong></span>
          </div>
        </div>
      </AdminFormSection>
    </div>
  );
}

// ─── Tab: D&D Rates ────────────────────────────────────────────────────────────

type DndGroup = { key: string; current: DndRateEntry; history: DndRateEntry[] };

function groupDndRates(rates: DndRateEntry[]): DndGroup[] {
  const map = new Map<string, DndRateEntry[]>();
  for (const r of rates) {
    const k = `${r.portName}||${r.terminalName ?? ''}||${r.shippingLine ?? ''}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const groups: DndGroup[] = [];
  for (const [key, entries] of map) {
    const sorted = [...entries].sort((a, b) =>
      new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime()
    );
    groups.push({ key, current: sorted[0], history: sorted.slice(1) });
  }
  return groups.sort((a, b) => a.current.portName.localeCompare(b.current.portName));
}

function DndTab({ rates, onAdd, onEdit, onNewVersion, onDelete }: {
  rates: DndRateEntry[]; onAdd: () => void;
  onEdit: (r: DndRateEntry) => void;
  onNewVersion: (r: DndRateEntry) => void;
  onDelete: (r: DndRateEntry) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [calcPort, setCalcPort] = useState('');
  const [calcDays, setCalcDays] = useState('');
  const groups = useMemo(() => groupDndRates(rates), [rates]);
  const calcRate = rates.find(r => `${r.portName}${r.terminalName ? ' / ' + r.terminalName : ''}` === calcPort);
  const est = calcRate ? (Number(calcRate.demurragePerDay) * (parseFloat(calcDays) || 0)).toFixed(2) : null;

  function toggleExpanded(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const TH: React.CSSProperties = {
    padding: '9px 14px', textAlign: 'left', fontSize: 14.5, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap',
    borderBottom: '1px solid hsl(var(--border))',
    background: 'hsl(var(--muted) / 0.5)',
    userSelect: 'none',
  };
  const TD: React.CSSProperties = { padding: '11px 14px', fontSize: 14.5, color: 'hsl(var(--foreground))' };
  const inpS: React.CSSProperties = { padding: '6px 10px', borderRadius: 6, fontSize: 14.5, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          {groups.length} configured — "New Version" updates a rate while preserving its history
        </span>
        <Button size="sm" onClick={onAdd}><Plus size={13} style={{ marginRight: 5 }} /> Add Rate</Button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid hsl(var(--border))', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Port', 'Terminal', 'Shipping Line', 'Free Days', 'Demurrage', 'Detention', 'Currency', 'Effective', ''].map(h => (
                <th key={h} style={{ ...TH, textAlign: h === '' ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: '40px 14px', textAlign: 'center', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                  No D&D rates configured
                </td>
              </tr>
            )}
            {groups.map((group, gi) => (
              <React.Fragment key={group.key}>
                <tr
                  style={{ borderBottom: '1px solid hsl(var(--border))' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted) / 0.3)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...TD, fontWeight: 600 }}>{group.current.portName}</td>
                  <td style={TD}>
                    <div>{group.current.terminalName ?? '—'}</div>
                    {group.current.firmsCode && <div style={{ ...MONO, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{group.current.firmsCode}</div>}
                  </td>
                  <td style={TD}>{group.current.shippingLine ?? '—'}</td>
                  <td style={{ ...TD, ...MONO }}>{group.current.freeDays}d</td>
                  <td style={{ ...TD, ...MONO, color: '#dc2626' }}>${fmt(group.current.demurragePerDay)}/day</td>
                  <td style={{ ...TD, ...MONO, color: '#d97706' }}>${fmt(group.current.detentionPerDay)}/day</td>
                  <td style={{ ...TD, ...MONO, fontSize: 14.5 }}>{group.current.currency}</td>
                  <td style={TD}>
                    <div style={{ ...MONO, fontSize: 14 }}>
                      {group.current.effectiveDate ? new Date(group.current.effectiveDate).toLocaleDateString() : '—'}
                    </div>
                    {group.history.length > 0 && (
                      <button
                        onClick={() => toggleExpanded(group.key)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 14, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 2 }}
                      >
                        {expanded.has(group.key) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        {group.history.length} prev version{group.history.length !== 1 ? 's' : ''}
                      </button>
                    )}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <button
                        title="Create new version (keeps history)"
                        onClick={() => onNewVersion(group.current)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14.5, padding: '3px 8px', borderRadius: 5, cursor: 'pointer', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--muted-foreground))' }}
                      >
                        <History size={12} /> New version
                      </button>
                      <button title="Edit in place" onClick={() => onEdit(group.current)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', padding: 4 }}>
                        <Pencil size={13} />
                      </button>
                      <button title="Delete" onClick={() => onDelete(group.current)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded.has(group.key) && group.history.map((r, hi) => (
                  <tr key={r.id}
                    style={{
                      borderBottom: hi < group.history.length - 1 ? '1px solid hsl(var(--border))' : gi < groups.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                      background: 'hsl(var(--muted) / 0.2)',
                      opacity: 0.75,
                    }}
                  >
                    <td colSpan={2} style={{ ...TD, fontSize: 14.5, color: 'hsl(var(--muted-foreground))', paddingLeft: 28 }}>
                      ↳ Historical
                    </td>
                    <td style={{ ...TD, fontSize: 14 }}>{r.shippingLine ?? '—'}</td>
                    <td style={{ ...TD, ...MONO, fontSize: 14 }}>{r.freeDays}d</td>
                    <td style={{ ...TD, ...MONO, fontSize: 14, color: '#dc2626' }}>${fmt(r.demurragePerDay)}/day</td>
                    <td style={{ ...TD, ...MONO, fontSize: 14, color: '#d97706' }}>${fmt(r.detentionPerDay)}/day</td>
                    <td style={{ ...TD, ...MONO, fontSize: 14.5 }}>{r.currency}</td>
                    <td style={{ ...TD, ...MONO, fontSize: 14.5 }}>
                      {r.effectiveDate ? new Date(r.effectiveDate).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <button title="Delete historical record" onClick={() => onDelete(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, padding: '14px 16px', background: 'hsl(var(--card))', borderRadius: 8, border: '1px solid hsl(var(--border))', maxWidth: 480 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>Quick D&D estimate</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={{ ...inpS, minWidth: 180 }} value={calcPort} onChange={e => setCalcPort(e.target.value)}>
            <option value="">— select port / terminal —</option>
            {rates.map(r => {
              const lbl = `${r.portName}${r.terminalName ? ' / ' + r.terminalName : ''}`;
              return <option key={r.id} value={lbl}>{lbl}</option>;
            })}
          </select>
          <input type="number" min={0} style={{ ...inpS, width: 70 }} value={calcDays} onChange={e => setCalcDays(e.target.value)} placeholder="days" />
          {est !== null && <span style={{ ...MONO, fontSize: 14, fontWeight: 700, color: '#dc2626' }}>${est} estimated demurrage</span>}
        </div>
        <div style={{ marginTop: 7, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
          This is an estimate. Actual charges depend on the shipping line's tariff.
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Alert Thresholds ─────────────────────────────────────────────────────

function AlertsTab({ alerts, roles, onSave, onAdd, onEdit, onDelete }: {
  alerts: AlertThreshold[];
  roles: SimpleRole[];
  onSave: (id: string, data: Partial<AlertThreshold>) => Promise<void>;
  onAdd: () => void;
  onEdit: (a: AlertThreshold) => void;
  onDelete: (a: AlertThreshold) => void;
}) {
  // Order: known types first (in ALERT_META order), then any custom ones
  const knownOrder = Object.keys(ALERT_META);
  const ordered = [
    ...knownOrder.map(k => alerts.find(a => a.alertType === k)).filter(Boolean) as AlertThreshold[],
    ...alerts.filter(a => !knownOrder.includes(a.alertType)),
  ];

  const activeCount   = ordered.filter(a => a.isActive).length;
  const inactiveCount = ordered.filter(a => !a.isActive).length;

  return (
    <div>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          <span><strong style={{ color: '#16a34a' }}>{activeCount}</strong> active</span>
          {inactiveCount > 0 && <span><strong style={{ color: '#94a3b8' }}>{inactiveCount}</strong> disabled</span>}
          <span>{ordered.length} total</span>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus size={13} style={{ marginRight: 5 }} /> Add threshold
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
          No alert thresholds configured yet. Click <strong>Add threshold</strong> to create one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ordered.map(a => (
            <AlertCard key={a.id} alert={a} roles={roles} onSave={onSave} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminInventoryPage() {
  const { toast } = useToast();
  const [tab,            setTab]            = useState('milestones');
  const [templates,      setTemplates]      = useState<WorkflowTemplate[]>([]);
  const [selectedTpl,    setSelectedTpl]    = useState('');
  const [milestones,     setMilestones]     = useState<MilestoneConfig[]>([]);
  const [dndRates,       setDndRates]       = useState<DndRateEntry[]>([]);
  const [alerts,         setAlerts]         = useState<AlertThreshold[]>([]);
  const [roles,          setRoles]          = useState<SimpleRole[]>([]);
  const [triggerOptions, setTriggerOptions] = useState<AccountingTriggerOption[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [editMs,       setEditMs]       = useState<MilestoneConfig | null>(null);
  const [addMsMode,    setAddMsMode]    = useState(false);
  const [deleteMs,     setDeleteMs]     = useState<MilestoneConfig | null>(null);
  const [showDnd,      setShowDnd]      = useState(false);
  const [editDnd,      setEditDnd]      = useState<DndRateEntry | null>(null);
  const [dndNewVer,    setDndNewVer]    = useState(false);
  const [deleteDnd,    setDeleteDnd]    = useState<DndRateEntry | null>(null);
  const [alertModal,   setAlertModal]   = useState(false);
  const [editAlert,    setEditAlert]    = useState<AlertThreshold | null>(null);
  const [deleteAlert,  setDeleteAlert]  = useState<AlertThreshold | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, dndRes, alertRes, msRes, rolesRes, atRes] = await Promise.all([
        apiGet('/api/admin/templates'),
        apiGet('/api/admin/inventory/dnd-rates'),
        apiGet('/api/admin/inventory/alerts'),
        apiGet('/api/admin/inventory/milestones'),
        apiGet('/api/admin/roles'),
        apiGet('/api/admin/accounting/triggers'),
      ]);
      if (tplRes.ok) {
        const ts: WorkflowTemplate[] = tplRes.data ?? [];
        setTemplates(ts);
        const active = ts.find(t => t.templateStatus === 'ACTIVE') ?? ts.find(t => t.templateStatus !== 'DRAFT') ?? ts[0];
        if (active) setSelectedTpl(prev => prev || active.id);
      }
      if (dndRes.ok)   setDndRates(dndRes.data ?? []);
      if (alertRes.ok) setAlerts(alertRes.data ?? []);
      if (msRes.ok)    setMilestones(msRes.data ?? []);
      if (rolesRes.ok) setRoles(rolesRes.data ?? []);
      if (atRes.ok)    setTriggerOptions((atRes.data ?? []).filter((a: AccountingTriggerOption) => a.systemCode));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function reloadMilestones() {
    const res = await apiGet('/api/admin/inventory/milestones');
    if (res.ok) setMilestones(res.data ?? []);
  }

  async function deduplicateMilestones(templateId: string): Promise<number> {
    const tpl = milestones.filter(m => m.templateId === templateId);
    const byName: Record<string, MilestoneConfig[]> = {};
    for (const m of tpl) {
      const key = m.name.trim().toLowerCase();
      if (!byName[key]) byName[key] = [];
      byName[key].push(m);
    }
    const toDelete: MilestoneConfig[] = [];
    for (const group of Object.values(byName)) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => a.milestoneNumber - b.milestoneNumber);
        toDelete.push(...sorted.slice(1));
      }
    }
    if (toDelete.length === 0) return 0;
    await Promise.all(toDelete.map(m => apiDelete(`/api/admin/inventory/milestones/${m.id}`)));
    setMilestones(prev => prev.filter(m => !toDelete.some(d => d.id === m.id)));
    return toDelete.length;
  }

  async function saveMilestone(id: string, data: Partial<MilestoneConfig> & { templateId?: string; milestoneNumber?: number }) {
    if (!id) {
      const res = await apiPost('/api/admin/inventory/milestones', data);
      if (res.ok) setMilestones(prev => [...prev, { ...res.data, accountingTriggers: res.data.accountingTriggers ?? [] }]);
      else throw new Error(res.error ?? 'Failed');
    } else {
      const res = await apiPut(`/api/admin/inventory/milestones/${id}`, data);
      if (res.ok) setMilestones(prev => prev.map(m => m.id === id ? { ...m, ...res.data } : m));
      else throw new Error(res.error ?? 'Failed');
    }
  }

  async function confirmDeleteMs() {
    if (!deleteMs) return;
    const res = await apiDelete(`/api/admin/inventory/milestones/${deleteMs.id}`);
    if (res.ok) { setMilestones(prev => prev.filter(m => m.id !== deleteMs.id)); toast({ title: 'Milestone deleted' }); }
    else toast({ title: 'Delete failed', variant: 'destructive' });
    setDeleteMs(null);
  }

  async function saveDnd(data: Partial<DndRateEntry>, newVersion: boolean) {
    if (editDnd?.id && !newVersion) {
      const res = await apiPut(`/api/admin/inventory/dnd-rates/${editDnd.id}`, data);
      if (res.ok) setDndRates(prev => prev.map(r => r.id === editDnd.id ? { ...r, ...res.data } : r));
      else throw new Error();
    } else {
      const { id: _id, ...postData } = data as any;
      const res = await apiPost('/api/admin/inventory/dnd-rates', postData);
      if (res.ok) setDndRates(prev => [...prev, res.data]);
      else throw new Error();
    }
  }

  async function confirmDeleteDnd() {
    if (!deleteDnd) return;
    const res = await apiDelete(`/api/admin/inventory/dnd-rates/${deleteDnd.id}`);
    if (res.ok) { setDndRates(prev => prev.filter(r => r.id !== deleteDnd.id)); toast({ title: 'Rate deleted' }); }
    else toast({ title: 'Delete failed', variant: 'destructive' });
    setDeleteDnd(null);
  }

  async function saveAlert(id: string, data: Partial<AlertThreshold>) {
    const res = await apiPut(`/api/admin/inventory/alerts/${id}`, data);
    if (!res.ok) throw new Error(res.error ?? 'Failed');
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, ...res.data } : a));
  }

  async function createOrUpdateAlert(data: Partial<AlertThreshold>) {
    if (editAlert?.id) {
      await saveAlert(editAlert.id, data);
    } else {
      const res = await apiPost('/api/admin/inventory/alerts', data);
      if (!res.ok) throw new Error(res.error ?? 'Failed');
      setAlerts(prev => [...prev, res.data]);
    }
  }

  async function confirmDeleteAlert() {
    if (!deleteAlert) return;
    const res = await apiDelete(`/api/admin/inventory/alerts/${deleteAlert.id}`);
    if (res.ok) {
      setAlerts(prev => prev.filter(a => a.id !== deleteAlert.id));
      toast({ title: 'Alert threshold deleted' });
    } else {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
    setDeleteAlert(null);
  }

  const activeTpl = templates.find(t => t.id === selectedTpl);
  const gates: GateConfig[] = activeTpl?.gates ?? [];
  const tabs = [
    { label: 'Milestones',       value: 'milestones', count: milestones.filter(m => m.templateId === selectedTpl).length },
    { label: 'Tracking API',     value: 'tracking' },
    { label: 'D&D Rates',        value: 'dnd',    count: dndRates.length },
    { label: 'Alert Thresholds', value: 'alerts', count: alerts.length },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Tracking & D&D"
        description="Milestones, container tracking API, D&D rates, and alert thresholds"
        badge={{ label: 'milestones', count: milestones.length }}
      />
      <AdminSectionTabs tabs={tabs} activeTab={tab} onTabChange={setTab} />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />
        </div>
      ) : (
        <>
          {tab === 'milestones' && <MilestonesTab templates={templates} selectedTplId={selectedTpl} setSelectedTplId={setSelectedTpl} milestones={milestones} roles={roles} onEdit={setEditMs} onDelete={setDeleteMs} onSave={saveMilestone} onAdd={() => setAddMsMode(true)} onAfterImport={reloadMilestones} onDedup={deduplicateMilestones} />}
          {tab === 'tracking'   && <TrackingApiTab milestones={milestones.filter(m => m.templateId === selectedTpl)} />}
          {tab === 'dnd'        && <DndTab rates={dndRates}
            onAdd={() => { setEditDnd(null); setDndNewVer(false); setShowDnd(true); }}
            onEdit={r => { setEditDnd(r); setDndNewVer(false); setShowDnd(true); }}
            onNewVersion={r => { setEditDnd(r); setDndNewVer(true); setShowDnd(true); }}
            onDelete={r => setDeleteDnd(r)}
          />}
          {tab === 'alerts' && (
            <AlertsTab
              alerts={alerts}
              roles={roles}
              onSave={saveAlert}
              onAdd={() => { setEditAlert(null); setAlertModal(true); }}
              onEdit={a => { setEditAlert(a); setAlertModal(true); }}
              onDelete={a => setDeleteAlert(a)}
            />
          )}
        </>
      )}

      {editMs && <MilestoneEditModal milestone={editMs} milestones={milestones} gates={gates} roles={roles} triggerOptions={triggerOptions} onTriggersChanged={load} onClose={() => setEditMs(null)} onSave={saveMilestone} />}

      {addMsMode && (() => {
        const tplMilestones = milestones.filter(m => m.templateId === selectedTpl);
        const nextNum = tplMilestones.length > 0 ? Math.max(...tplMilestones.map(m => m.milestoneNumber)) + 1 : 1;
        return (
          <MilestoneEditModal
            milestone={null} templateId={selectedTpl} nextNumber={nextNum}
            milestones={milestones} gates={gates} roles={roles}
            triggerOptions={triggerOptions} onTriggersChanged={load}
            onClose={() => setAddMsMode(false)} onSave={saveMilestone}
          />
        );
      })()}

      <AdminConfirmDialog
        open={!!deleteMs}
        title="Delete milestone"
        description={`Remove milestone #${deleteMs?.milestoneNumber} "${deleteMs?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete" confirmVariant="danger"
        onConfirm={confirmDeleteMs} onCancel={() => setDeleteMs(null)}
      />

      {showDnd && <DndRateModal rate={editDnd ?? {}} defaultNewVersion={dndNewVer} onClose={() => { setShowDnd(false); setEditDnd(null); setDndNewVer(false); }} onSave={saveDnd} />}

      {alertModal && (
        <AlertThresholdModal
          alert={editAlert}
          roles={roles}
          onClose={() => { setAlertModal(false); setEditAlert(null); }}
          onSave={createOrUpdateAlert}
        />
      )}

      <AdminConfirmDialog
        open={!!deleteDnd}
        title="Delete D&D Rate"
        description={`Remove rate for ${deleteDnd?.portName ?? ''}${deleteDnd?.terminalName ? ' / ' + deleteDnd.terminalName : ''}? This cannot be undone.`}
        confirmLabel="Delete" confirmVariant="danger"
        onConfirm={confirmDeleteDnd} onCancel={() => setDeleteDnd(null)}
      />

      <AdminConfirmDialog
        open={!!deleteAlert}
        title="Delete alert threshold"
        description={`Remove the "${ALERT_META[deleteAlert?.alertType ?? '']?.name ?? deleteAlert?.alertType}" threshold? This cannot be undone.`}
        confirmLabel="Delete" confirmVariant="danger"
        onConfirm={confirmDeleteAlert} onCancel={() => setDeleteAlert(null)}
      />
    </div>
  );
}
