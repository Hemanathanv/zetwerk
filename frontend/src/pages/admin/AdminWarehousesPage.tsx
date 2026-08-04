import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Pencil, Trash2, Plus, ChevronUp, ChevronDown, Warehouse as WarehouseIcon } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminConfirmDialog } from '@/components/admin/AdminConfirmDialog';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPut, apiPost } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface QcChecklistItem {
  id: string; name: string; description: string;
  required: boolean; photoRequired: boolean; minPhotos: number; autoEscalate: boolean;
}

export interface QcChecklist { id?: string; warehouseId?: string; items: QcChecklistItem[] }

export interface Warehouse {
  id: string; name: string; address: string | null; firmsCode: string | null;
  partnerOrgId: string | null; inboundSlaHrs: number | null; outboundSlaHrs: number | null;
  isActive: boolean; qcChecklist?: QcChecklist | null;
}

type AdminApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

const SEED_QC_ITEMS: QcChecklistItem[] = [
  { id: 'seed-1', name: 'Verify container seal intact',          description: 'Check seal number matches shipping docs', required: true,  photoRequired: true,  minPhotos: 1, autoEscalate: true  },
  { id: 'seed-2', name: 'Verify material condition',             description: 'Check for damage, rust, or deformation',  required: true,  photoRequired: true,  minPhotos: 2, autoEscalate: true  },
  { id: 'seed-3', name: 'Verify bundle/piece count matches PL', description: 'Count items against packing list',         required: true,  photoRequired: false, minPhotos: 0, autoEscalate: true  },
  { id: 'seed-4', name: 'Verify weight (scale if available)',    description: 'Compare with declared weight',            required: false, photoRequired: false, minPhotos: 0, autoEscalate: false },
  { id: 'seed-5', name: 'Note any discrepancies',                description: 'Record variances for dispute resolution', required: false, photoRequired: false, minPhotos: 0, autoEscalate: false },
];

const INP_S = (extra?: React.CSSProperties): React.CSSProperties => ({
  width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 14.5,
  border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
  color: 'hsl(var(--foreground))', ...extra,
});
const LBL_S: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'block' };

// ─── QcItemRow ─────────────────────────────────────────────────────────────────
// Uses index-based callbacks to avoid id-collision bugs when server items lack ids

function QcItemRow({ item, index, total, onChange, onDelete, onMove }: {
  item: QcChecklistItem; index: number; total: number;
  onChange: (idx: number, field: string, value: any) => void;
  onDelete: (idx: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 8, border: '1px solid hsl(var(--border))', padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {/* Reorder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 4, flexShrink: 0 }}>
          <button disabled={index === 0} onClick={() => onMove(index, index - 1)}
            style={{ background: 'none', border: 'none', cursor: index === 0 ? 'not-allowed' : 'pointer', color: 'hsl(var(--muted-foreground))', padding: 1 }}>
            <ChevronUp size={13} />
          </button>
          <button disabled={index === total - 1} onClick={() => onMove(index, index + 1)}
            style={{ background: 'none', border: 'none', cursor: index === total - 1 ? 'not-allowed' : 'pointer', color: 'hsl(var(--muted-foreground))', padding: 1 }}>
            <ChevronDown size={13} />
          </button>
        </div>
        {/* Fields */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input style={INP_S({ fontSize: 14.5 })} value={item.name} placeholder="Item name"
              onChange={e => onChange(index, 'name', e.target.value)} />
            <input style={INP_S({ fontSize: 14, color: 'hsl(var(--muted-foreground))' })} value={item.description} placeholder="Description"
              onChange={e => onChange(index, 'description', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={item.required} onChange={e => onChange(index, 'required', e.target.checked)}
                style={{ width: 13, height: 13, accentColor: 'hsl(173 58% 39%)' }} />
              Required
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={item.photoRequired} onChange={e => onChange(index, 'photoRequired', e.target.checked)}
                style={{ width: 13, height: 13, accentColor: 'hsl(173 58% 39%)' }} />
              Photo required
            </label>
            {item.photoRequired && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                Min photos:
                <input type="number" min={1} value={item.minPhotos}
                  style={{ width: 48, padding: '2px 6px', borderRadius: 5, fontSize: 14, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', color: 'hsl(var(--foreground))', textAlign: 'center' }}
                  onChange={e => onChange(index, 'minPhotos', Number(e.target.value))} />
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer', color: item.autoEscalate ? '#dc2626' : 'hsl(var(--foreground))' }}>
              <input type="checkbox" checked={item.autoEscalate} onChange={e => onChange(index, 'autoEscalate', e.target.checked)}
                style={{ width: 13, height: 13, accentColor: '#dc2626' }} />
              Auto-escalate on fail
            </label>
          </div>
        </div>
        {/* Delete */}
        <button onClick={() => onDelete(index)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'hsl(var(--muted-foreground))', padding: 4 }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── QcChecklistModal ──────────────────────────────────────────────────────────

export function QcChecklistModal({ warehouse, onClose, onSave }: {
  warehouse: Warehouse; onClose: () => void;
  onSave: (warehouseId: string, items: QcChecklistItem[]) => Promise<void>;
}) {
  const [items, setItems] = useState<QcChecklistItem[]>(() => {
    const src = warehouse.qcChecklist?.items?.length ? warehouse.qcChecklist.items : SEED_QC_ITEMS;
    return src.map((item, i) => ({ ...item, id: item.id || `item-${i}-${Date.now()}` }));
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  function updateItem(idx: number, field: string, value: any) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function deleteItem(idx: number) { setItems(prev => prev.filter((_, i) => i !== idx)); }

  function moveItem(from: number, to: number) {
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function addItem() {
    setItems(prev => [...prev, {
      id: `new-${Date.now()}`, name: '', description: '',
      required: true, photoRequired: false, minPhotos: 0, autoEscalate: false,
    }]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(warehouse.id, items);
      toast({ title: 'QC checklist saved' });
      onClose();
    } catch { toast({ title: 'Save failed', variant: 'destructive' }); }
    setSaving(false);
  }

  return (
    <AdminModal
      open onClose={onClose} size="lg"
      title={`QC Checklist — ${warehouse.name}`}
      description="Items checked during inbound inspection. Failures can auto-escalate."
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Saving…</> : 'Save Checklist'}
          </Button>
        </div>
      }
    >
      <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>
        {items.map((item, i) => (
          <QcItemRow key={`${item.id}-${i}`} item={item} index={i} total={items.length}
            onChange={updateItem} onDelete={deleteItem} onMove={moveItem} />
        ))}
        <Button variant="outline" size="sm" onClick={addItem} style={{ marginTop: 4 }}>
          <Plus size={13} style={{ marginRight: 5 }} /> Add checklist item
        </Button>
      </div>
    </AdminModal>
  );
}

// ─── WarehouseEditModal ────────────────────────────────────────────────────────

export function WarehouseEditModal({ warehouse, onClose, onSave }: {
  warehouse: Partial<Warehouse>; onClose: () => void;
  onSave: (data: Partial<Warehouse>) => Promise<void>;
}) {
  const [name,     setName]     = useState(warehouse.name ?? '');
  const [address,  setAddress]  = useState(warehouse.address ?? '');
  const [firms,    setFirms]    = useState(warehouse.firmsCode ?? '');
  const [inSla,    setInSla]    = useState(String(warehouse.inboundSlaHrs ?? 48));
  const [outSla,   setOutSla]   = useState(String(warehouse.outboundSlaHrs ?? 120));
  const [isActive, setIsActive] = useState(warehouse.isActive ?? true);
  const [saving,   setSaving]   = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!name) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await onSave({ name, address: address || null, firmsCode: firms || null, isActive,
        inboundSlaHrs: inSla !== '' ? Number(inSla) : null,
        outboundSlaHrs: outSla !== '' ? Number(outSla) : null });
      toast({ title: warehouse.id ? 'Warehouse updated' : 'Warehouse created' });
      onClose();
    } catch { toast({ title: 'Save failed', variant: 'destructive' }); }
    setSaving(false);
  }

  return (
    <AdminModal
      open onClose={onClose} size="md"
      title={warehouse.id ? 'Edit Warehouse' : 'Add Warehouse'}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Saving…</> : 'Save'}
          </Button>
        </div>
      }
    >
      <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: 'calc(90vh - 120px)' }}>
        <div style={{ marginBottom: 12 }}>
          <label style={LBL_S}>Warehouse Name *</label>
          <input style={INP_S()} value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Nevada 3PL — Sloan" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={LBL_S}>Address</label>
          <textarea rows={2} style={{ ...INP_S(), resize: 'vertical' }} value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Logistics Dr, Sloan, NV 89054" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={LBL_S}>FIRMS Code</label>
          <input style={INP_S({ fontFamily: '"JetBrains Mono", monospace' })} value={firms} onChange={e => setFirms(e.target.value)} placeholder="e.g., Z693" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={LBL_S}>Inbound SLA (hours)</label>
            <input type="number" min={0} style={INP_S()} value={inSla} onChange={e => setInSla(e.target.value)} placeholder="48" />
            <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3, display: 'block' }}>Time to complete QC after container arrival</span>
          </div>
          <div>
            <label style={LBL_S}>Outbound SLA (hours)</label>
            <input type="number" min={0} style={INP_S()} value={outSla} onChange={e => setOutSla(e.target.value)} placeholder="120" />
            <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3, display: 'block' }}>Time to dispatch after receiving order</span>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: 'hsl(173 58% 39%)' }} />
          <span style={{ fontSize: 14.5 }}>Active</span>
        </label>
      </div>
    </AdminModal>
  );
}

// ─── WarehouseCard ─────────────────────────────────────────────────────────────

export function WarehouseCard({ warehouse, onEdit, onQc, onDeactivate }: {
  warehouse: Warehouse; onEdit: () => void; onQc: () => void; onDeactivate: () => void;
}) {
  const itemCount = warehouse.qcChecklist?.items?.length ?? 0;
  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 10, border: '1px solid hsl(var(--border))', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{warehouse.name}</div>
          {warehouse.address && <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{warehouse.address}</div>}
          {warehouse.firmsCode && (
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
              FIRMS: {warehouse.firmsCode}
            </div>
          )}
        </div>
        <AdminStatusBadge status={warehouse.isActive ? 'active' : 'inactive'} size="sm" />
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: 14, fontSize: 14 }}>
        <div>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Inbound SLA</span><br />
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
            {warehouse.inboundSlaHrs != null ? `${warehouse.inboundSlaHrs}h` : '—'}
          </span>
        </div>
        <div>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>Outbound SLA</span><br />
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
            {warehouse.outboundSlaHrs != null ? `${warehouse.outboundSlaHrs}h` : '—'}
          </span>
        </div>
        <div>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>QC items</span><br />
          <span style={{ fontWeight: 600 }}>{itemCount} checklist items</span>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, borderTop: '1px solid hsl(var(--border))', paddingTop: 12 }}>
        <button onClick={onEdit} style={{ background: 'none', border: '1px solid hsl(var(--border))', borderRadius: 6, padding: '5px 12px', fontSize: 14, cursor: 'pointer', color: 'hsl(var(--foreground))' }}>
          Edit
        </button>
        <button onClick={onQc} style={{ background: 'none', border: '1px solid hsl(var(--border))', borderRadius: 6, padding: '5px 12px', fontSize: 14, cursor: 'pointer', color: 'hsl(var(--foreground))' }}>
          QC Checklist
        </button>
        <button onClick={onDeactivate} style={{ background: 'none', border: '1px solid hsl(var(--border))', borderRadius: 6, padding: '5px 12px', fontSize: 14, cursor: 'pointer', color: 'hsl(var(--muted-foreground))', marginLeft: 'auto' }}>
          {warehouse.isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
  );
}

// ─── PartnerWarehouseSection ────────────────────────────────────────────────────
// Self-contained warehouse panel embedded in partner org cards

export function PartnerWarehouseSection({ partnerOrgId }: { partnerOrgId: string }) {
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [qcWarehouse, setQcWarehouse] = useState<Warehouse | null>(null);
  const [deactivating, setDeactivating] = useState<Warehouse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<AdminApiResponse<Warehouse[]>>('/api/admin/warehouses');
      if (res.ok) {
        const all: Warehouse[] = res.data ?? [];
        setWarehouses(all.filter(w => w.partnerOrgId === partnerOrgId));
      }
    } finally { setLoading(false); }
  }, [partnerOrgId]);

  useEffect(() => { load(); }, [load]);

  async function saveWarehouse(data: Partial<Warehouse>) {
    if (editing?.id) {
      const res = await apiPut<AdminApiResponse<Warehouse>>(`/api/admin/warehouses/${editing.id}`, data);
      if (res.ok) setWarehouses(prev => prev.map(w => w.id === editing.id ? { ...w, ...res.data } : w));
      else throw new Error();
    } else {
      const res = await apiPost<AdminApiResponse<Warehouse>>('/api/admin/warehouses', { ...data, partnerOrgId });
      if (res.ok && res.data) {
        const created = res.data;
        setWarehouses(prev => [...prev, created]);
      }
      else throw new Error();
    }
  }

  async function saveQcChecklist(warehouseId: string, items: QcChecklistItem[]) {
    const res = await apiPut<AdminApiResponse<QcChecklist>>(`/api/admin/warehouses/${warehouseId}/qc-checklist`, { items });
    if (res.ok) {
      setWarehouses(prev => prev.map(w => w.id === warehouseId
        ? { ...w, qcChecklist: { ...w.qcChecklist, items, warehouseId } }
        : w
      ));
    } else throw new Error();
  }

  async function toggleActive(w: Warehouse) {
    const res = await apiPut<AdminApiResponse<Warehouse>>(`/api/admin/warehouses/${w.id}`, { ...w, isActive: !w.isActive });
    if (res.ok) {
      setWarehouses(prev => prev.map(wh => wh.id === w.id ? { ...wh, ...res.data } : wh));
      toast({ title: w.isActive ? 'Warehouse deactivated' : 'Warehouse activated' });
    } else {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
    setDeactivating(null);
  }

  if (loading) return (
    <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8, color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
      <Loader2 size={14} className="animate-spin" /> Loading warehouses…
    </div>
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>
          <WarehouseIcon size={13} />
          WAREHOUSES
          {warehouses.length > 0 && (
            <span style={{ background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', borderRadius: 10, padding: '0 6px', fontSize: 14.5, fontWeight: 700 }}>
              {warehouses.length}
            </span>
          )}
        </div>
        <button
          onClick={() => { setEditing(null); setShowEdit(true); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, padding: '4px 10px', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'none', cursor: 'pointer', color: 'hsl(var(--foreground))' }}>
          <Plus size={11} /> Add Warehouse
        </button>
      </div>

      {warehouses.length === 0 ? (
        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', padding: '8px 0' }}>
          No warehouses linked to this partner yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {warehouses.map(w => (
            <WarehouseCard
              key={w.id} warehouse={w}
              onEdit={() => { setEditing(w); setShowEdit(true); }}
              onQc={() => setQcWarehouse(w)}
              onDeactivate={() => setDeactivating(w)}
            />
          ))}
        </div>
      )}

      {showEdit && (
        <WarehouseEditModal
          warehouse={editing ?? {}}
          onClose={() => { setShowEdit(false); setEditing(null); }}
          onSave={saveWarehouse}
        />
      )}

      {qcWarehouse && (
        <QcChecklistModal
          warehouse={qcWarehouse}
          onClose={() => setQcWarehouse(null)}
          onSave={saveQcChecklist}
        />
      )}

      <AdminConfirmDialog
        open={!!deactivating}
        title={deactivating?.isActive ? 'Deactivate Warehouse' : 'Activate Warehouse'}
        description={`${deactivating?.isActive ? 'Deactivate' : 'Activate'} "${deactivating?.name ?? ''}"?`}
        confirmLabel={deactivating?.isActive ? 'Deactivate' : 'Activate'}
        confirmVariant="warning"
        onConfirm={() => { if (deactivating) void toggleActive(deactivating); }}
        onClose={() => setDeactivating(null)}
      />
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminWarehousesPage() {
  const { toast } = useToast();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showEdit,   setShowEdit]   = useState(false);
  const [editing,    setEditing]    = useState<Warehouse | null>(null);
  const [qcWarehouse, setQcWarehouse] = useState<Warehouse | null>(null);
  const [deactivating, setDeactivating] = useState<Warehouse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<AdminApiResponse<Warehouse[]>>('/api/admin/warehouses');
      if (res.ok) setWarehouses(res.data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveWarehouse(data: Partial<Warehouse>) {
    if (editing?.id) {
      const res = await apiPut<AdminApiResponse<Warehouse>>(`/api/admin/warehouses/${editing.id}`, data);
      if (res.ok) setWarehouses(prev => prev.map(w => w.id === editing.id ? { ...w, ...res.data } : w));
      else throw new Error();
    } else {
      const res = await apiPost<AdminApiResponse<Warehouse>>('/api/admin/warehouses', data);
      if (res.ok && res.data) {
        const created = res.data;
        setWarehouses(prev => [...prev, created]);
      }
      else throw new Error();
    }
  }

  async function saveQcChecklist(warehouseId: string, items: QcChecklistItem[]) {
    const res = await apiPut<AdminApiResponse<QcChecklist>>(`/api/admin/warehouses/${warehouseId}/qc-checklist`, { items });
    if (res.ok) {
      setWarehouses(prev => prev.map(w => w.id === warehouseId
        ? { ...w, qcChecklist: { ...w.qcChecklist, items, warehouseId } }
        : w
      ));
    } else throw new Error();
  }

  async function toggleActive(w: Warehouse) {
    const res = await apiPut<AdminApiResponse<Warehouse>>(`/api/admin/warehouses/${w.id}`, { ...w, isActive: !w.isActive });
    if (res.ok) {
      setWarehouses(prev => prev.map(wh => wh.id === w.id ? { ...wh, ...res.data } : wh));
      toast({ title: w.isActive ? 'Warehouse deactivated' : 'Warehouse activated' });
    } else {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
    setDeactivating(null);
  }

  return (
    <div>
      <AdminPageHeader
        title="3PL Configuration"
        description="Warehouse registration, QC checklists, and photo evidence requirements"
        badge={{ label: 'warehouses', count: warehouses.length }}
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setShowEdit(true); }}>
            <Plus size={13} style={{ marginRight: 5 }} /> Add Warehouse
          </Button>
        }
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />
        </div>
      ) : warehouses.length === 0 ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 14.5 }}>
          No warehouses configured. Click "Add Warehouse" to register your first 3PL partner.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {warehouses.map(w => (
            <WarehouseCard
              key={w.id} warehouse={w}
              onEdit={() => { setEditing(w); setShowEdit(true); }}
              onQc={() => setQcWarehouse(w)}
              onDeactivate={() => setDeactivating(w)}
            />
          ))}
        </div>
      )}

      {showEdit && (
        <WarehouseEditModal
          warehouse={editing ?? {}}
          onClose={() => { setShowEdit(false); setEditing(null); }}
          onSave={saveWarehouse}
        />
      )}

      {qcWarehouse && (
        <QcChecklistModal
          warehouse={qcWarehouse}
          onClose={() => setQcWarehouse(null)}
          onSave={saveQcChecklist}
        />
      )}

      <AdminConfirmDialog
        open={!!deactivating}
        title={deactivating?.isActive ? 'Deactivate Warehouse' : 'Activate Warehouse'}
        description={`${deactivating?.isActive ? 'Deactivate' : 'Activate'} "${deactivating?.name ?? ''}"?`}
        confirmLabel={deactivating?.isActive ? 'Deactivate' : 'Activate'}
        confirmVariant={deactivating?.isActive ? 'warning' : 'warning'}
        onConfirm={() => { if (deactivating) void toggleActive(deactivating); }}
        onClose={() => setDeactivating(null)}
      />
    </div>
  );
}
