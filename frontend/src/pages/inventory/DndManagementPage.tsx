import { useState, useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import {
  DollarSign, Calendar, Scale, Bell, AlertTriangle,
  ChevronRight, CheckCircle, XCircle, MinusCircle, Circle,
  Wifi, Calculator, HelpCircle, Upload, X, FileText, Download, Settings,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { RequireActivity } from '@/components/PermissionGate';
import { useShipments } from '@/hooks/useOperationalData';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ewms/SegmentedControl';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {};
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Tab definitions ──────────────────────────────────
const TABS = [
  { value: 'charges', label: 'D&D Charges' },
  { value: 'calendar', label: 'LFD Calendar' },
  { value: 'reconciliation', label: '3-Way Recon' },
  { value: 'alerts', label: 'Alert History' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

// ─── Return record modal ──────────────────────────────
function RecordReturnModal({
  charge,
  onClose,
  onSaved,
}: {
  charge: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnDate, setReturnDate] = useState('');
  const [returnDepot, setReturnDepot] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!returnDate || !returnDepot) return;
    setSaving(true);
    await fetch(`/api/dnd/${charge.id}/return`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ returnDate, returnDepot }),
    });
    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-96">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold">Record Container Return</h3>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close return modal">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground mb-4 font-mono">{charge.containerNumber}</p>
        <div className="space-y-3">
          <div>
            <label className="text-[13px] text-muted-foreground block mb-1">Return Date</label>
            <Input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[13px] text-muted-foreground block mb-1">Return Depot</label>
            <Input
              value={returnDepot}
              onChange={(e) => setReturnDepot(e.target.value)}
              placeholder="Depot name"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || !returnDate || !returnDepot}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── D&D Charge row ───────────────────────────────────
function DndChargeRow({
  charge,
  onRecordReturn,
}: {
  charge: any;
  onRecordReturn: (c: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const snapshot = charge.rateSnapshot as any;
  const isAccruing = charge.status === 'ACCRUING';

  return (
    <div
      className={`bg-card rounded-lg overflow-hidden ${
        isAccruing
          ? 'border-l-4 border-l-red-500'
          : charge.status === 'CLOSED'
          ? 'border-l-4 border-l-teal-500'
          : ''
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="w-[120px] shrink-0">
          <Link
            href={charge.containerTrackingId ? `/inventory/containers/${charge.containerTrackingId}` : `/inventory`}
            onClick={e => e.stopPropagation()}
            className="text-[14.5px] font-mono font-semibold hover:text-teal-600 transition-colors"
          >
            {charge.containerNumber}
          </Link>
          <div className="text-[12px] text-muted-foreground">
            {charge.shipment?.id ? (
              <Link
                href={`/shipments/${charge.shipment.id}`}
                onClick={e => e.stopPropagation()}
                className="hover:text-teal-600 transition-colors"
              >
                {charge.shipment.shipmentNumber || 'Pending ID'}
              </Link>
            ) : (charge.shipment?.shipmentNumber || 'Pending ID')}
          </div>
        </div>

        <div className="w-[130px] shrink-0 hidden sm:block">
          <div className="text-[13px]">{charge.portName}</div>
          {charge.terminalName && (
            <div className="text-[12px] text-muted-foreground">{charge.terminalName}</div>
          )}
        </div>

        <div className="w-[150px] shrink-0">
          <div className="text-[13px] font-mono">LFD: {fmtDate(charge.lfd)}</div>
          <div className="text-[13px] text-muted-foreground flex items-center gap-1 mt-0.5">
            {charge.lfdSource === 'tracking_api' ? (
              <><Wifi className="w-2.5 h-2.5 text-teal-500" /> From tracking API</>
            ) : charge.lfdSource === 'calculated' ? (
              <><Calculator className="w-2.5 h-2.5 text-amber-500" /> Calculated from rate</>
            ) : (
              <><HelpCircle className="w-2.5 h-2.5 text-muted-foreground" /> Unknown source</>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {isAccruing ? (
            <div className="text-[14.5px] font-mono text-red-600 font-medium">
              {charge.currency} {Number(charge.totalCharge).toLocaleString()}
              <span className="text-[12px] text-red-400 ml-1">
                ({charge.demurrageDays}d dem + {charge.detentionDays}d det)
              </span>
            </div>
          ) : charge.status === 'CLOSED' ? (
            <div className="text-[14.5px] font-mono text-muted-foreground">
              {charge.currency} {Number(charge.totalCharge).toLocaleString()}
              <span className="text-[12px] ml-1">(closed)</span>
            </div>
          ) : (
            <div className="text-[13px] text-muted-foreground">
              Free: {charge.freeDays} days · Rate: {charge.currency}{' '}
              {Number(charge.demurrageRate).toLocaleString()}/day
            </div>
          )}
        </div>

        <div className="w-[80px] shrink-0 text-right">
          <Badge
            intent={isAccruing ? 'danger' : charge.status === 'MONITORING' ? 'neutral' : 'success'}
            size="sm"
          >
            {charge.status}
          </Badge>
          {charge.ticketId && (
            <a href="/accounting" className="text-[13px] text-teal-600 hover:underline block mt-1">
              Ticket →
            </a>
          )}
        </div>

        <ChevronRight
          className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t">
          <div className="grid grid-cols-2 gap-4 mt-3 text-[13px]">
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">Dates</div>
              <div>Discharged: <span className="font-mono">{fmtDate(charge.dischargeDate)}</span></div>
              <div>LFD: <span className="font-mono">{fmtDate(charge.lfd)}</span></div>
              {charge.gateOutDate && (
                <div>Gate out: <span className="font-mono">{fmtDate(charge.gateOutDate)}</span></div>
              )}
              {charge.returnDate && (
                <div>Returned: <span className="font-mono">{fmtDate(charge.returnDate)}</span></div>
              )}
            </div>
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">Breakdown</div>
              <div>
                Demurrage: {charge.demurrageDays}d × {charge.currency}{' '}
                {Number(charge.demurrageRate).toLocaleString()} ={' '}
                <span className="font-mono font-medium">
                  {charge.currency} {Number(charge.demurrageTotal).toLocaleString()}
                </span>
              </div>
              {(charge.detentionDays > 0 || charge.gateOutDate) && (
                <div>
                  Detention: {charge.detentionDays}d × {charge.currency}{' '}
                  {Number(charge.detentionRate).toLocaleString()} ={' '}
                  <span className="font-mono font-medium">
                    {charge.currency} {Number(charge.detentionTotal).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="font-medium mt-1">
                Total:{' '}
                <span className="font-mono">
                  {charge.currency} {Number(charge.totalCharge).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {snapshot ? (
            <div className="mt-3 bg-muted/30 rounded-lg p-3 text-[12px] text-muted-foreground">
              <div className="font-medium text-foreground mb-1">Rate Source (G-S24)</div>
              <div>
                {snapshot.portName}
                {snapshot.terminalName ? ` / ${snapshot.terminalName}` : ''}
                {snapshot.shippingLine ? ` / ${snapshot.shippingLine}` : ''}
              </div>
              <div>
                Effective: {fmtDate(snapshot.effectiveDate)} · Snapshot:{' '}
                {fmtDate(snapshot.snapshotTakenAt)}
              </div>
              <div className="italic mt-1">
                Rate frozen at discharge date. Admin rate changes do not affect this container.
              </div>
            </div>
          ) : (
            <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 text-[12px] text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                No rate snapshot — charges are estimated.{' '}
                <a href="/settings" className="underline hover:no-underline inline-flex items-center gap-0.5">
                  Configure rates <Settings className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          )}

          {!charge.returnDate && charge.status !== 'CLOSED' && (
            <RequireActivity code="SHP-002">
              <button
                onClick={() => onRecordReturn(charge)}
                className="text-[13px] text-teal-600 hover:underline mt-3 block"
              >
                Record container return
              </button>
            </RequireActivity>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 1: D&D Charges ───────────────────────────────
function DndChargesTab({
  charges,
  onRefresh,
}: {
  charges: any[];
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'monitoring' | 'accruing' | 'closed'>('all');
  const [returnCharge, setReturnCharge] = useState<any | null>(null);

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? charges
        : charges.filter((c) => c.status.toLowerCase() === filter),
    [charges, filter]
  );

  const filterOptions: Array<typeof filter> = ['all', 'monitoring', 'accruing', 'closed'];

  function handleCsvExport() {
    const rows = [
      ['Container', 'Shipment', 'Port', 'Status', 'LFD', 'Discharge Date', 'Gate Out', 'Free Days', 'Demurrage Days', 'Detention Days', 'Currency', 'Demurrage Rate', 'Detention Rate', 'Total Charge'],
      ...filtered.map(c => [
        c.containerNumber,
        c.shipment?.shipmentNumber || '',
        c.portName || '',
        c.status,
        c.lfd ? new Date(c.lfd).toISOString().split('T')[0] : '',
        c.dischargeDate ? new Date(c.dischargeDate).toISOString().split('T')[0] : '',
        c.gateOutDate ? new Date(c.gateOutDate).toISOString().split('T')[0] : '',
        c.freeDays ?? '',
        c.demurrageDays ?? '',
        c.detentionDays ?? '',
        c.currency || 'USD',
        c.demurrageRate ?? '',
        c.detentionRate ?? '',
        Number(c.totalCharge ?? 0).toFixed(2),
      ]),
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dnd-charges-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <SegmentedControl
          value={filter}
          onValueChange={(value) => setFilter(value as any)}
          options={filterOptions.map((f) => ({
            value: f,
            label: `${f} (${f === 'all' ? charges.length : charges.filter((c) => c.status.toLowerCase() === f).length})`,
          }))}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCsvExport}
          className="ml-auto gap-2"
        >
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      <div className="space-y-2">
        {filtered.map((charge) => (
          <DndChargeRow key={charge.id} charge={charge} onRecordReturn={setReturnCharge} />
        ))}
        {filtered.length === 0 && (
          <div className="bg-card rounded-xl p-8 text-center">
            <DollarSign className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p className="text-[14.5px] text-muted-foreground mt-3">No D&D charges in this category</p>
          </div>
        )}
      </div>

      {returnCharge && (
        <RecordReturnModal
          charge={returnCharge}
          onClose={() => setReturnCharge(null)}
          onSaved={() => { setReturnCharge(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Calendar item ────────────────────────────────────
function CalendarItem({ charge, isPast }: { charge: any; isPast: boolean }) {
  const daysUntil = Math.ceil((new Date(charge.lfd).getTime() - Date.now()) / 86400000);
  return (
    <a
      href={charge.containerTrackingId ? `/inventory/containers/${charge.containerTrackingId}` : `/inventory`}
      className={`bg-card rounded-lg p-3 flex items-center gap-4 hover:shadow-sm transition-shadow block ${
        isPast ? 'border-l-4 border-l-red-500' : ''
      }`}
    >
      <div
        className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center shrink-0 ${
          isPast
            ? 'bg-red-100 text-red-700'
            : daysUntil <= 3
            ? 'bg-amber-100 text-amber-700'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <span className="text-[13px] font-bold">
          {new Date(charge.lfd).toLocaleDateString('en-IN', { day: '2-digit' })}
        </span>
        <span className="text-[13px]">
          {new Date(charge.lfd).toLocaleDateString('en-IN', { month: 'short' })}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-mono font-medium">{charge.containerNumber}</div>
        <div className="text-[12px] text-muted-foreground">
          {charge.portName} · {charge.shipment?.shipmentNumber || ''}
        </div>
      </div>
      <div className="text-right shrink-0">
        {isPast ? (
          <span className="text-[13px] font-mono text-red-600">
            {charge.currency} {Number(charge.totalCharge).toLocaleString()}
          </span>
        ) : (
          <span
            className={`text-[13px] font-medium ${
              daysUntil <= 3 ? 'text-amber-600' : 'text-muted-foreground'
            }`}
          >
            {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days`}
          </span>
        )}
      </div>
    </a>
  );
}

// ─── Tab 2: LFD Calendar ──────────────────────────────
function LfdCalendarTab({ charges }: { charges: any[] }) {
  const now = new Date();
  const next30 = new Date(now.getTime() + 30 * 86400000);

  const upcoming = useMemo(
    () =>
      charges
        .filter((c) => c.status === 'MONITORING' && new Date(c.lfd) >= now && new Date(c.lfd) <= next30)
        .sort((a, b) => new Date(a.lfd).getTime() - new Date(b.lfd).getTime()),
    [charges]
  );

  const pastLfd = useMemo(
    () =>
      charges
        .filter((c) => c.status === 'ACCRUING')
        .sort((a, b) => new Date(a.lfd).getTime() - new Date(b.lfd).getTime()),
    [charges]
  );

  const weekGroups = useMemo(() => {
    const thisWeekEnd = new Date(now.getTime() + (7 - now.getDay()) * 86400000);
    const nextWeekEnd = new Date(thisWeekEnd.getTime() + 7 * 86400000);
    return [
      { label: 'This week', items: upcoming.filter((c) => new Date(c.lfd) <= thisWeekEnd) },
      { label: 'Next week', items: upcoming.filter((c) => new Date(c.lfd) > thisWeekEnd && new Date(c.lfd) <= nextWeekEnd) },
      { label: 'Later', items: upcoming.filter((c) => new Date(c.lfd) > nextWeekEnd) },
    ].filter((g) => g.items.length > 0);
  }, [upcoming]);

  // Exposure summary: total estimated exposure for all monitored containers
  const exposureSummary = useMemo(() => {
    const byCurrency: Record<string, number> = {};
    for (const c of charges.filter(ch => ch.status !== 'CLOSED')) {
      const cur = c.currency || 'USD';
      const rate = Number(c.demurrageRate || 0);
      if (c.status === 'ACCRUING') {
        byCurrency[cur] = (byCurrency[cur] || 0) + Number(c.totalCharge || 0);
      } else if (c.lfd) {
        // Estimate max exposure if LFD passes (rate × 30 days cap)
        byCurrency[cur] = (byCurrency[cur] || 0) + rate * 30;
      }
    }
    return byCurrency;
  }, [charges]);

  return (
    <div>
      {/* Exposure summary bar */}
      {charges.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-5 p-3 bg-muted/30 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" /> Exposure Summary
          </div>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span>
              <span className="font-mono font-semibold text-red-600">{pastLfd.length}</span>{' '}
              <span className="text-muted-foreground">past LFD (accruing)</span>
            </span>
            <span>
              <span className="font-mono font-semibold text-amber-600">
                {upcoming.filter(c => {
                  const d = Math.ceil((new Date(c.lfd).getTime() - now.getTime()) / 86400000);
                  return d <= 7;
                }).length}
              </span>{' '}
              <span className="text-muted-foreground">LFD within 7 days</span>
            </span>
            {Object.entries(exposureSummary).map(([cur, amt]) => (
              <span key={cur}>
                <span className="text-muted-foreground">Est. exposure:</span>{' '}
                <span className="font-mono font-semibold">{cur} {Math.round(amt).toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {pastLfd.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[14.5px] font-semibold text-red-600 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Past LFD — D&D Accruing ({pastLfd.length})
          </h3>
          <div className="space-y-1.5">
            {pastLfd.map((c) => <CalendarItem key={c.id} charge={c} isPast />)}
          </div>
        </div>
      )}

      {weekGroups.map((group) => (
        <div key={group.label} className="mb-6">
          <h3 className="text-[14.5px] font-semibold text-muted-foreground mb-2">
            {group.label} ({group.items.length})
          </h3>
          <div className="space-y-1.5">
            {group.items.map((c) => <CalendarItem key={c.id} charge={c} isPast={false} />)}
          </div>
        </div>
      ))}

      {upcoming.length === 0 && pastLfd.length === 0 && (
        <div className="bg-card rounded-xl p-8 text-center">
          <Calendar className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[14.5px] text-muted-foreground mt-3">No upcoming LFDs in the next 30 days</p>
        </div>
      )}
    </div>
  );
}

// ─── Data source badge ────────────────────────────────
function DataSourceBadge({ label, available }: { label: string; available: boolean }) {
  return (
    <Badge
      intent={available ? 'success' : 'neutral'}
      size="sm"
      leadingIcon={available ? <CheckCircle className="size-3" /> : <Circle className="size-3" />}
    >
      {label}
    </Badge>
  );
}

// ─── MSD Upload Modal ─────────────────────────────────
function MsdUploadModal({ shipmentId, onClose }: { shipmentId: string; onClose: () => void }) {
  const [items, setItems] = useState([{ productCode: '', quantity: '', weight: '', value: '' }]);
  const [csvMode, setCsvMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const addRow = () => setItems([...items, { productCode: '', quantity: '', weight: '', value: '' }]);
  const removeRow = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string) => {
    const updated = [...items];
    (updated[i] as any)[field] = value;
    setItems(updated);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim());
      const parsed = lines.slice(1).map((line) => {
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        return { productCode: cols[0] || '', quantity: cols[1] || '', weight: cols[2] || '', value: cols[3] || '' };
      }).filter((r) => r.productCode);
      setItems(parsed);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    const validItems = items.filter((i) => i.productCode);
    if (!validItems.length) return;
    setSaving(true);
    await fetch(`/api/reconciliation/${shipmentId}/msd`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ items: validItems, source: csvMode ? 'csv_upload' : 'manual' }),
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14.5px] font-semibold">Upload MSD Data (Client ERP)</h3>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setCsvMode(false)} className={`text-[13px] px-3 py-1.5 rounded ${!csvMode ? 'bg-teal-600 text-white' : 'bg-muted'}`}>Manual entry</button>
          <button onClick={() => setCsvMode(true)} className={`text-[13px] px-3 py-1.5 rounded ${csvMode ? 'bg-teal-600 text-white' : 'bg-muted'}`}>CSV upload</button>
        </div>

        {csvMode ? (
          <div>
            <p className="text-[13px] text-muted-foreground mb-2">
              CSV columns: productCode, quantity, weight, value
            </p>
            <input type="file" accept=".csv" onChange={handleCsvUpload} className="text-[14.5px]" />
            {items.length > 1 && (
              <p className="text-[13px] text-teal-600 mt-2">{items.length} items loaded from CSV</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 text-[12px] text-muted-foreground px-1">
              <span>Product code</span><span>Qty</span><span>Weight (kg)</span><span>Value (USD)</span>
            </div>
            {items.map((item, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={item.productCode} onChange={(e) => updateRow(i, 'productCode', e.target.value)} placeholder="Code" className="text-[13px] border rounded px-2 py-1.5 flex-1 font-mono" />
                <input value={item.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)} placeholder="0" type="number" className="text-[13px] border rounded px-2 py-1.5 w-20 font-mono" />
                <input value={item.weight} onChange={(e) => updateRow(i, 'weight', e.target.value)} placeholder="0" type="number" className="text-[13px] border rounded px-2 py-1.5 w-20 font-mono" />
                <input value={item.value} onChange={(e) => updateRow(i, 'value', e.target.value)} placeholder="0" type="number" className="text-[13px] border rounded px-2 py-1.5 w-20 font-mono" />
                <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 shrink-0"><X className="w-3 h-3" /></button>
              </div>
            ))}
            <button onClick={addRow} className="text-[13px] text-teal-600 hover:underline">+ Add row</button>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <button onClick={onClose} className="text-[13px] px-3 py-1.5 border rounded-lg">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="text-[13px] px-4 py-1.5 bg-teal-600 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save MSD Data'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 3: 3-Way Reconciliation ─────────────────────
function ReconciliationTab() {
  const { shipments: allShipments } = useShipments();
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [reconData, setReconData] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loadingRecon, setLoadingRecon] = useState(false);

  const loadRecon = (id: string) => {
    setLoadingRecon(true);
    fetch(`/api/reconciliation/${id}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setReconData(d.data); setLoadingRecon(false); })
      .catch(() => setLoadingRecon(false));
  };

  const handleShipmentChange = (id: string | null) => {
    setSelectedShipmentId(id);
    setReconData(null);
    if (id) loadRecon(id);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={selectedShipmentId || ''}
          onChange={(e) => handleShipmentChange(e.target.value || null)}
          className="text-[14.5px] border rounded-lg px-3 py-1.5 flex-1 max-w-xs bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="">Select shipment…</option>
          {allShipments
            .filter((s: any) => s.status !== 'CANCELLED')
            .map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.shipmentNumber || 'Pending ID'} — {s.exporterName || ''}
              </option>
            ))}
        </select>

        {selectedShipmentId && (
          <button
            onClick={() => setShowUpload(true)}
            className="text-[13px] px-3 py-1.5 border rounded-lg hover:bg-muted flex items-center gap-1"
          >
            <Upload className="w-3 h-3" /> Upload MSD Data
          </button>
        )}
      </div>

      {reconData && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <DataSourceBadge label="MSD (Client ERP)" available={reconData.hasMsd} />
          <DataSourceBadge label="EWMS (Packing List)" available={reconData.hasEwms} />
          <DataSourceBadge label="3PL (GRN)" available={reconData.hasTpl} />
        </div>
      )}

      {reconData?.summary && (
        <div className="flex gap-2 mb-4 flex-wrap text-[13px]">
          <span className="px-2 py-1 rounded bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
            {reconData.summary.match} match
          </span>
          <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            {reconData.summary.tolerance} within tolerance
          </span>
          <span className="px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {reconData.summary.mismatch} mismatch
          </span>
          <span className="px-2 py-1 rounded bg-muted text-muted-foreground">
            {reconData.summary.partial} partial data
          </span>
        </div>
      )}

      {loadingRecon ? (
        <div className="text-center py-8 text-[14.5px] text-muted-foreground">Loading reconciliation data…</div>
      ) : reconData?.comparison?.length > 0 ? (
        <div className="bg-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2.5 px-3 font-medium">Product</th>
                  <th colSpan={2} className="text-center py-2.5 px-3 font-medium bg-blue-50/50 dark:bg-blue-950/10">MSD (ERP)</th>
                  <th colSpan={2} className="text-center py-2.5 px-3 font-medium bg-teal-50/50 dark:bg-teal-950/10">EWMS (PL)</th>
                  <th colSpan={2} className="text-center py-2.5 px-3 font-medium bg-purple-50/50 dark:bg-purple-950/10">3PL (GRN)</th>
                  <th className="text-center py-2.5 px-3 font-medium">Status</th>
                </tr>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1.5 px-3 font-normal">Code</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-blue-50/30">Qty</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-blue-50/30">Wt (kg)</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-teal-50/30">Qty</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-teal-50/30">Wt (kg)</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-purple-50/30">Qty</th>
                  <th className="text-right py-1.5 px-2 font-normal bg-purple-50/30">Wt (kg)</th>
                  <th className="text-center py-1.5 px-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {reconData.comparison.map((row: any) => (
                  <tr
                    key={row.productCode}
                    className={`border-b border-muted/20 ${
                      row.qtyStatus === 'mismatch'
                        ? 'bg-red-50/30 dark:bg-red-950/10'
                        : row.qtyStatus === 'tolerance'
                        ? 'bg-amber-50/30 dark:bg-amber-950/10'
                        : ''
                    }`}
                  >
                    <td className="py-2 px-3">
                      <span className="font-mono font-medium">{row.productCode}</span>
                      <div className="text-[13px] text-muted-foreground truncate max-w-[120px]">{row.description}</div>
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-blue-50/20 dark:bg-blue-950/10">
                      {row.msd?.qty != null ? row.msd.qty.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-blue-50/20 dark:bg-blue-950/10">
                      {row.msd?.weight != null ? row.msd.weight.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-teal-50/20 dark:bg-teal-950/10">
                      {row.ewms?.qty != null ? row.ewms.qty.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-teal-50/20 dark:bg-teal-950/10">
                      {row.ewms?.weight != null ? row.ewms.weight.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-purple-50/20 dark:bg-purple-950/10">
                      {row.tpl?.qty != null ? row.tpl.qty.toLocaleString() : '—'}
                    </td>
                    <td className="text-right py-2 px-2 font-mono bg-purple-50/20 dark:bg-purple-950/10">
                      {row.tpl?.weight != null ? row.tpl.weight.toLocaleString() : '—'}
                    </td>
                    <td className="text-center py-2 px-2">
                      {row.qtyStatus === 'match' && <CheckCircle className="w-4 h-4 text-teal-500 mx-auto" />}
                      {row.qtyStatus === 'tolerance' && <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />}
                      {row.qtyStatus === 'mismatch' && <XCircle className="w-4 h-4 text-red-500 mx-auto" />}
                      {row.qtyStatus === 'partial' && <MinusCircle className="w-4 h-4 text-muted-foreground mx-auto" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : !selectedShipmentId ? (
        <div className="bg-card rounded-xl p-8 text-center">
          <Scale className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[14.5px] text-muted-foreground mt-3">Select a shipment to view 3-way reconciliation</p>
        </div>
      ) : reconData ? (
        <div className="bg-card rounded-xl p-8 text-center">
          <Scale className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[14.5px] text-muted-foreground mt-3">No reconciliation data yet for this shipment</p>
          <p className="text-[13px] text-muted-foreground mt-1">Upload MSD data to begin comparison</p>
        </div>
      ) : null}

      {showUpload && selectedShipmentId && (
        <MsdUploadModal
          shipmentId={selectedShipmentId}
          onClose={() => {
            setShowUpload(false);
            if (selectedShipmentId) loadRecon(selectedShipmentId);
          }}
        />
      )}
    </div>
  );
}

// ─── Tab 4: Alert History ─────────────────────────────
function AlertHistoryTab({ alerts }: { alerts: any }) {
  const notifications = alerts?.notifications || [];
  const audits = alerts?.audits || [];

  const combined = useMemo(() => {
    const all = [
      ...notifications.map((n: any) => ({ type: 'notification', data: n, time: n.createdAt })),
      ...audits.map((a: any) => ({ type: 'audit', data: a, time: a.timestamp })),
    ];
    return all.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [notifications, audits]);

  if (combined.length === 0) {
    return (
      <div className="bg-card rounded-xl p-8 text-center">
        <Bell className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No D&D alerts have been triggered</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {combined.map((item, idx) => (
        <div key={idx} className="bg-card rounded-lg p-3 flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            {item.type === 'notification' ? (
              item.data.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              ) : item.data.type === 'escalation' ? (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              ) : (
                <Bell className="w-4 h-4 text-blue-500" />
              )
            ) : (
              <FileText className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">
              {item.type === 'notification'
                ? item.data.title
                : `${item.data.action}: ${item.data.entityType}`}
            </div>
            {item.data.message && (
              <div className="text-[12px] text-muted-foreground mt-0.5">{item.data.message}</div>
            )}
            <div className="text-[13px] text-muted-foreground mt-1">
              {new Date(item.time).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}{' '}
              {new Date(item.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────
export function DndManagementPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('charges');
  const [charges, setCharges] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/dnd/active', { headers: authHeaders() }).then((r) => r.json()),
      fetch('/api/dnd/alerts', { headers: authHeaders() }).then((r) => r.json()).catch(() => ({ data: null })),
    ]).then(([chargesRes, alertsRes]) => {
      setCharges(chargesRes.data || []);
      setAlerts(alertsRes.data || null);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, []);

  const tabCounts: Partial<Record<TabValue, number>> = {
    charges: charges.length,
  };

  const totalAccruing = useMemo(
    () =>
      charges
        .filter((c) => c.status === 'ACCRUING')
        .reduce((s, c) => s + Number(c.totalCharge), 0),
    [charges]
  );

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>D&D Management</h1>
        <div className="flex items-center gap-4 mt-1 text-[13px] text-muted-foreground flex-wrap">
          <span>{charges.filter((c) => c.status === 'ACCRUING').length} accruing</span>
          <span>{charges.filter((c) => c.status === 'MONITORING').length} monitoring</span>
          {totalAccruing > 0 && (
            <span className="text-red-600 font-medium">
              Total accrued: USD {totalAccruing.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2.5 text-[14.5px] font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.value
                ? 'border-teal-600 text-teal-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tabCounts[tab.value] !== undefined && (
              <span className="ml-1.5 text-[12px] bg-muted px-1.5 py-0.5 rounded-full">
                {tabCounts[tab.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-[14.5px]">
          Loading D&D data…
        </div>
      ) : (
        <>
          {activeTab === 'charges' && (
            <DndChargesTab charges={charges} onRefresh={loadData} />
          )}
          {activeTab === 'calendar' && (
            <LfdCalendarTab charges={charges} />
          )}
          {activeTab === 'reconciliation' && (
            <ReconciliationTab />
          )}
          {activeTab === 'alerts' && (
            <AlertHistoryTab alerts={alerts} />
          )}
        </>
      )}
    </div>
  );
}
