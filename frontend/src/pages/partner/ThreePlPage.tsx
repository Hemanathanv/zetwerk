import { useState, useEffect, useRef, useMemo } from 'react';
import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  Truck, Package, Send, Check, X, Loader2, CheckCircle,
  ClipboardCheck, Camera, Warehouse, AlertTriangle,
  CheckCircle2, ChevronRight, Lock, Clock, Sparkles, ExternalLink,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';
import { useDocTypePermissions, usePermissions } from '@/contexts/PermissionContext';
import { useAuth } from '@/contexts/AuthContext';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── SLA Indicator ────────────────────────────────────────────────────────────

function SlaIndicator({ startTime, slaHours, label }: { startTime: Date; slaHours: number; label: string }) {
  const elapsed = (Date.now() - startTime.getTime()) / 3600000;
  const pct = Math.min((elapsed / slaHours) * 100, 100);
  const remaining = slaHours - elapsed;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-muted-foreground">{label}: {slaHours}h</span>
        <span className={`font-medium ${
          remaining <= 0 ? 'text-red-600' :
          remaining < slaHours * 0.25 ? 'text-amber-600' :
          'text-muted-foreground'
        }`}>
          {remaining <= 0
            ? `${Math.abs(Math.floor(remaining))}h overdue`
            : `${Math.floor(remaining)}h remaining`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${
          remaining <= 0 ? 'bg-red-500' :
          remaining < slaHours * 0.25 ? 'bg-amber-500' :
          'bg-teal-500'
        }`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── QC Checklist Item ────────────────────────────────────────────────────────

function QcChecklistItem({ item, state, onUpdate }: {
  item: any;
  state: { passed: boolean; notes: string; photos: File[] };
  onUpdate: (updates: Partial<typeof state>) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`rounded-lg border p-3 ${
      item.isRequired && !state.passed
        ? 'border-amber-200 bg-amber-50/30 dark:bg-amber-950/10'
        : 'border-border'
    }`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onUpdate({ passed: !state.passed })}
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${
            state.passed
              ? 'bg-teal-500 text-white'
              : 'bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/30'
          }`}
        >
          {state.passed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
        </button>
        <div className="flex-1">
          <div className="text-[14.5px] font-medium">
            {item.itemName}
            {item.isRequired && <span className="text-red-400 ml-0.5">*</span>}
          </div>
          {item.description && (
            <p className="text-[13px] text-muted-foreground mt-0.5">{item.description}</p>
          )}
          {item.mandatoryPhoto && (
            <p className="text-[12px] text-amber-600 mt-0.5 flex items-center gap-1">
              <Camera className="w-3 h-3" /> Photo required
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 ml-11">
        <input
          value={state.notes}
          onChange={e => onUpdate({ notes: e.target.value })}
          placeholder="Notes (optional)"
          className="w-full text-[13px] border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground"
        />
      </div>

      {(item.mandatoryPhoto || item.requiresPhoto) && (
        <div className="mt-2 ml-11">
          <div className="flex items-center gap-2">
            <button
              onClick={() => photoInputRef.current?.click()}
              className="text-[13px] px-3 py-1.5 border border-border rounded-lg hover:bg-muted flex items-center gap-1 transition-colors"
            >
              <Camera className="w-3 h-3" />
              {state.photos.length > 0 ? `${state.photos.length} photo(s)` : 'Add photo'}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={e => {
                const files = Array.from(e.target.files || []);
                onUpdate({ photos: [...state.photos, ...files] });
              }}
              className="hidden"
            />
          </div>

          {state.photos.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {state.photos.map((photo, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-border">
                  <img src={URL.createObjectURL(photo)} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => onUpdate({ photos: state.photos.filter((_, idx) => idx !== i) })}
                    className="absolute top-0 right-0 bg-red-500 text-white rounded-bl p-0.5"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {state.photos.length === 0 && (
            <p className="text-[12px] text-amber-600 mt-1">Photo evidence required for this item</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inbound Card ─────────────────────────────────────────────────────────────

function InboundCard({ container, qcChecklist, warehouse, onRefresh, isInternal }: {
  container: any; qcChecklist: any[]; warehouse: any; onRefresh: () => void;
  isInternal: boolean;
}) {
  const [, navigate] = useLocation();
  const [showQc, setShowQc] = useState(false);
  const [qcState, setQcState] = useState<Record<string, { passed: boolean; notes: string; photos: File[] }>>({});

  // OCR pre-fill from extraction attached to container/GRN document
  const ocrExtraction = container.grnInboundExtraction ?? null;
  const ocrLineItems: any[] = ocrExtraction?.lineItems ?? ocrExtraction?.items ?? [];
  const ocrReceivedDate = ocrExtraction?.receivedDate ?? ocrExtraction?.deliveryDate ?? ocrExtraction?.date ?? '';

  const [truckNumber, setTruckNumber] = useState(ocrExtraction?.truckNumber ?? ocrExtraction?.vehicleNumber ?? '');
  const [sealIntact, setSealIntact] = useState<boolean | null>(
    ocrExtraction?.sealIntact != null ? Boolean(ocrExtraction.sealIntact) : null
  );
  const [sealNumber, setSealNumber] = useState(ocrExtraction?.sealNumber ?? '');
  const [receivedDate, setReceivedDate] = useState(
    ocrReceivedDate ? new Date(ocrReceivedDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ grnId: string; shipmentId: string; shipmentNumber: string } | null>(null);
  const [ocrDismissed, setOcrDismissed] = useState(false);

  // Helper: render an "OCR extracted" badge next to a pre-filled field label
  const OcrBadge = () => ocrExtraction && !ocrDismissed ? (
    <span className="ml-1 inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
      <Sparkles className="w-2 h-2" /> OCR
    </span>
  ) : null;

  useEffect(() => {
    const initial: Record<string, any> = {};
    for (const item of qcChecklist) {
      initial[item.id] = { passed: false, notes: '', photos: [] };
    }
    setQcState(initial);
  }, [qcChecklist]);

  const alreadyDone = !!container.existingGrn;

  const handleQcSubmit = async () => {
    setError('');

    // ── Pre-flight: enforce mandatory photo requirement ─────────────────────
    const missingPhotos = qcChecklist.filter(
      item => (item.mandatoryPhoto || item.requiresPhoto) &&
               (qcState[item.id]?.photos ?? []).length === 0
    );
    if (missingPhotos.length > 0) {
      setError(
        `Photo required for: ${missingPhotos.map((i: any) => i.itemName).join(', ')}. ` +
        'Please add at least one photo for each required item before submitting.'
      );
      return;
    }

    setSubmitting(true);

    const results = qcChecklist.map(item => ({
      checklistItemId: item.id,
      itemName: item.itemName,
      required: item.isRequired ?? false,
      passed: qcState[item.id]?.passed || false,
      notes: qcState[item.id]?.notes || '',
      photoUrls: [] as string[],
    }));

    // Upload photos per item — failures on mandatory items are blocking
    for (const item of qcChecklist) {
      const photos = qcState[item.id]?.photos ?? [];
      if (photos.length === 0) continue;
      try {
        const formData = new FormData();
        for (const photo of photos) formData.append('photos', photo);
        formData.append('containerId', container.id);
        formData.append('checklistItemId', item.id);
        const photoRes = await fetch(`${API_BASE}/api/partner/warehouse/photos`, {
          method: 'POST',
          headers: authHeaders(),
          body: formData,
        });
        if (photoRes.ok) {
          const photoData = await photoRes.json();
          const result = results.find(r => r.checklistItemId === item.id);
          if (result) result.photoUrls = photoData.data?.urls ?? [];
        } else if (item.mandatoryPhoto || item.requiresPhoto) {
          setError(`Failed to upload photo for "${item.itemName}". Please retry.`);
          setSubmitting(false);
          return;
        }
      } catch {
        if (item.mandatoryPhoto || item.requiresPhoto) {
          setError(`Could not upload photo for "${item.itemName}". Check your connection and retry.`);
          setSubmitting(false);
          return;
        }
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/grn/complete`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentId: container.shipment.id,
          containerNumber: container.containerNumber,
          warehouseId: warehouse.id,
          qcResults: results,
          truckNumber: truckNumber || undefined,
          sealIntact: sealIntact ?? undefined,
          sealNumber: sealNumber || undefined,
          receivedAt: receivedDate || undefined,
          receivedItems: ocrLineItems.length > 0 ? ocrLineItems : undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? 'Submission failed');
        setSubmitting(false);
        return;
      }
      const data = await res.json();
      const successData = {
        grnId: data.grnRecord?.id ?? data.document?.id ?? '',
        shipmentId: container.shipment.id,
        shipmentNumber: container.shipment.shipmentNumber,
      };
      setSuccess(successData);
      setSubmitting(false);
      onRefresh();
      // Auto-redirect to shipment view after 2 s so ops can see the GRN document
      setTimeout(() => navigate(`/shipments/${successData.shipmentId}`), 2000);
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="bg-card rounded-lg border border-teal-200 dark:border-teal-800 p-6 text-center">
        <CheckCircle2 className="w-10 h-10 mx-auto text-teal-500 mb-3" />
        <h3 className="text-[14.5px] font-semibold text-foreground mb-1">Inward GRN Complete</h3>
        <p className="text-[13px] text-muted-foreground mb-3">
          Container <span className="font-mono font-semibold">{container.containerNumber}</span> has been received and QC recorded.
        </p>
        <div className="inline-flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground mb-4">
          GRN Ref: <span className="font-mono font-semibold text-foreground">{success.grnId.slice(-8).toUpperCase()}</span>
        </div>
        <div>
          <a
            href={`/shipments/${success.shipmentId}`}
            className="inline-flex items-center gap-1 text-[13px] text-teal-600 hover:text-teal-700 font-medium"
          >
            View shipment {success.shipmentNumber} <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      {/* OCR pre-fill banner */}
      {ocrExtraction && !ocrDismissed && !alreadyDone && (
        <div className="mb-3 flex items-start gap-2 text-[12px] text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/20 rounded-lg px-3 py-2 border border-teal-200 dark:border-teal-800">
          <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">OCR-assisted pre-fill</span> — Truck/seal details extracted from document.
            Please verify before submitting.
          </div>
          <button onClick={() => setOcrDismissed(true)} className="text-teal-500 hover:text-teal-700 shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/inventory/containers/${container.id}`}
              className="text-[14.5px] font-mono font-semibold hover:text-teal-600 transition-colors flex items-center gap-1"
            >
              {container.containerNumber}
              <ExternalLink className="w-3 h-3 opacity-50" />
            </Link>
            {container.currentStatus === 'gate_out' && (
              <span className="text-[12px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                Gate Out
              </span>
            )}
            {container.currentStatus === 'in_transit' && (
              <span className="text-[12px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                In Transit
              </span>
            )}
          </div>
          <div className="text-[13px] text-muted-foreground mt-0.5">
            {isInternal && container.shipment?.id ? (
              <Link href={`/shipments/${container.shipment.id}`} className="hover:text-teal-600 transition-colors">
                {container.shipment.shipmentNumber || 'Pending ID'}
              </Link>
            ) : (container.shipment?.shipmentNumber || '—')}
            {' '}·{' '}
            {container.gateOutDate ? `Gate out: ${formatDate(container.gateOutDate)}` :
             container.shipment?.eta ? `ETA: ${formatDate(container.shipment.eta)}` : 'ETA: —'}
          </div>
          {!alreadyDone && container.expectedInwardAt && (
            <div className="mt-1">
              <span className={`inline-flex items-center gap-1 text-[12px] font-medium px-1.5 py-0.5 rounded-full ${
                container.etaSource === 'ata'
                  ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400'
                  : container.etaSource === 'predictive'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                  : container.etaSource === 'shipment_eta'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
              }`}>
                <Clock className="w-2.5 h-2.5" />
                {container.etaSource === 'ata'
                  ? 'Expected inward'
                  : container.etaSource === 'predictive'
                  ? 'Est. inward'
                  : container.etaSource === 'shipment_eta'
                  ? 'Sched. inward'
                  : 'ETA'}:{' '}
                {formatDate(container.expectedInwardAt)}
              </span>
            </div>
          )}
        </div>
        {!alreadyDone ? (
          <button
            onClick={() => setShowQc(!showQc)}
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1.5 transition-colors"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            {showQc ? 'Hide Inspection' : 'Start QC Inspection'}
          </button>
        ) : (
          <span className="text-[13px] text-teal-600 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5" /> GRN Complete
          </span>
        )}
      </div>

      {warehouse.inboundSlaHrs && container.gateOutDate && (
        <SlaIndicator
          startTime={new Date(container.gateOutDate)}
          slaHours={warehouse.inboundSlaHrs}
          label="Inbound SLA"
        />
      )}

      {alreadyDone && container.existingGrn && (
        <div className="mt-2 text-[12px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          GRN recorded · Status:{' '}
          <span className={`font-semibold ${
            container.existingGrn.qcOverallStatus === 'PASSED' ? 'text-teal-600' :
            container.existingGrn.qcOverallStatus === 'FAILED' ? 'text-red-600' :
            'text-amber-600'
          }`}>{container.existingGrn.qcOverallStatus}</span>
          {container.existingGrn.receivedAt && (
            <> · {formatDate(container.existingGrn.receivedAt)}</>
          )}
        </div>
      )}

      {showQc && !alreadyDone && (
        <div className="mt-4 border-t border-border pt-4">
          {/* Arrival details */}
          <h4 className="text-[14.5px] font-semibold mb-3">Arrival Details</h4>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="flex items-center text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Truck / Vehicle No. <OcrBadge />
              </label>
              <input
                value={truckNumber}
                onChange={e => setTruckNumber(e.target.value)}
                placeholder="e.g. MH12 AB 1234"
                className="w-full text-[13px] border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="flex items-center text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Seal Number <OcrBadge />
              </label>
              <input
                value={sealNumber}
                onChange={e => setSealNumber(e.target.value)}
                placeholder="e.g. INV-2024-001"
                className="w-full text-[13px] border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="flex items-center text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Received Date <OcrBadge />
              </label>
              <input
                type="date"
                value={receivedDate}
                onChange={e => setReceivedDate(e.target.value)}
                className="w-full text-[13px] border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground"
              />
            </div>
          </div>

          {/* OCR extracted received items */}
          {ocrLineItems.length > 0 && (
            <div className="mb-4 p-3 bg-muted/30 rounded-lg border border-border">
              <div className="flex items-center gap-1.5 mb-2 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                <Sparkles className="w-3 h-3 text-teal-600" /> OCR-extracted received items
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[12px] text-muted-foreground">
                    <th className="text-left pb-1">Product</th>
                    <th className="text-right pb-1">Qty</th>
                    <th className="text-right pb-1">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrLineItems.map((item: any, i: number) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1 font-mono">{item.productCode ?? item.description ?? `Item ${i + 1}`}</td>
                      <td className="py-1 text-right font-mono">{item.quantity ?? item.qty ?? '—'}</td>
                      <td className="py-1 text-right font-mono text-muted-foreground">{item.weight != null ? `${item.weight} kg` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[12px] text-muted-foreground mt-2">These quantities come from OCR. Verify against physical count before submitting.</p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-[12px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              Seal Condition
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSealIntact(true)}
                className={`flex-1 py-2 text-[13px] font-medium rounded-lg border transition-all flex items-center justify-center gap-1 ${
                  sealIntact === true
                    ? 'bg-teal-500 text-white border-teal-500'
                    : 'border-border text-muted-foreground hover:border-teal-400'
                }`}
              >
                <Check className="w-3.5 h-3.5" /> Seal Intact
              </button>
              <button
                onClick={() => setSealIntact(false)}
                className={`flex-1 py-2 text-[13px] font-medium rounded-lg border transition-all flex items-center justify-center gap-1 ${
                  sealIntact === false
                    ? 'bg-red-500 text-white border-red-500'
                    : 'border-border text-muted-foreground hover:border-red-400'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Seal Broken
              </button>
            </div>
          </div>

          {/* QC Checklist */}
          <h4 className="text-[14.5px] font-semibold mb-1">QC Inspection Checklist</h4>
          <p className="text-[13px] text-muted-foreground mb-4">
            {qcChecklist.length} item{qcChecklist.length !== 1 ? 's' : ''} to inspect.
            Items marked * are required to pass for QC approval.
          </p>

          {qcChecklist.length === 0 ? (
            <p className="text-[13px] text-muted-foreground italic">
              No checklist configured. Contact your admin to set up the QC checklist.
            </p>
          ) : (
            <div className="space-y-3">
              {qcChecklist.map(item => (
                <QcChecklistItem
                  key={item.id}
                  item={item}
                  state={qcState[item.id] || { passed: false, notes: '', photos: [] }}
                  onUpdate={updates => setQcState(prev => ({
                    ...prev,
                    [item.id]: { ...prev[item.id], ...updates },
                  }))}
                />
              ))}
            </div>
          )}

          <div className="mt-4">
            <label className="block text-[12px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
              Overall Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any additional observations about this delivery…"
              rows={2}
              className="w-full text-[13px] border border-border rounded-lg px-2.5 py-1.5 bg-background text-foreground resize-none"
            />
          </div>

          {error && (
            <p className="text-[13px] text-red-600 mt-3 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
            <button
              onClick={() => setShowQc(false)}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleQcSubmit}
              disabled={submitting}
              className="px-4 py-2 text-[14.5px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
            >
              {submitting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCircle className="w-3.5 h-3.5" />}
              {submitting ? 'Submitting…' : 'Complete QC & Mark Inward'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inbound Tab ──────────────────────────────────────────────────────────────

function InboundTab({ pending, qcChecklist, warehouse, onRefresh, isInternal }: {
  pending: any[]; qcChecklist: any[]; warehouse: any; onRefresh: () => void;
  isInternal: boolean;
}) {
  if (pending.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <Truck className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No containers pending inward QC</p>
        <p className="text-[13px] text-muted-foreground/70 mt-1">
          Containers appear here when they reach gate-out or in-transit status.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {pending.map(container => (
        <InboundCard
          key={container.id}
          container={container}
          qcChecklist={qcChecklist}
          warehouse={warehouse}
          onRefresh={onRefresh}
          isInternal={isInternal}
        />
      ))}
    </div>
  );
}

// ─── Stock Tab ────────────────────────────────────────────────────────────────

function StockTab({ containers }: { containers: any[] }) {
  const inStock = containers.filter(c => c.stage === 'in_stock');
  if (inStock.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <Package className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No containers in stock</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {inStock.map(c => (
        <Link key={c.id} href={`/inventory/containers/${c.id}`}>
          <div className="bg-card rounded-lg border border-border p-4 flex items-center gap-4 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="w-[130px] shrink-0">
              <div className="text-[14.5px] font-mono font-semibold">{c.containerNumber}</div>
              <div className="text-[12px] text-muted-foreground">{c.shipment?.shipmentNumber || 'Pending'}</div>
            </div>
            <div className="flex-1 min-w-0">
              {c.updatedAt && (
                <div className="text-[13px] text-muted-foreground">
                  Inward: {formatDate(c.updatedAt)}
                  <span className="ml-2">
                    ({Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 86400000)}d in stock)
                  </span>
                </div>
              )}
              {c.qcResults && (
                <div className="text-[12px] text-teal-600 flex items-center gap-1 mt-0.5">
                  <CheckCircle className="w-3 h-3" /> QC passed
                </div>
              )}
            </div>
            <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400 shrink-0">
              In Stock
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Outbound Tab ─────────────────────────────────────────────────────────────

function OutboundTab({ containers }: { containers: any[] }) {
  const outbound = containers.filter(c => ['dispatched', 'delivered'].includes(c.stage));
  if (outbound.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-8 text-center">
        <Send className="w-8 h-8 mx-auto text-muted-foreground/40" />
        <p className="text-[14.5px] text-muted-foreground mt-3">No outbound containers</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {outbound.map(c => (
        <div key={c.id} className={`bg-card rounded-lg border border-border p-4 flex items-center gap-4 ${
          c.stage === 'delivered' ? 'opacity-60' : ''
        }`}>
          <div className="w-[130px] shrink-0">
            <div className="text-[14.5px] font-mono font-semibold">{c.containerNumber}</div>
            <div className="text-[12px] text-muted-foreground">{c.shipment?.shipmentNumber || 'Pending'}</div>
          </div>
          <div className="flex-1 min-w-0 text-[13px] text-muted-foreground">
            {c.dispatchedAt && <div>Dispatched: {formatDate(c.dispatchedAt)}</div>}
            {c.deliveryDate && <div>Delivered: {formatDate(c.deliveryDate)}</div>}
          </div>
          <span className={`text-[12px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
            c.stage === 'delivered'
              ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400'
              : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400'
          }`}>
            {c.stage === 'delivered' ? 'Delivered' : 'Dispatched'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ThreePlPage() {
  const { loaded: permLoaded } = usePermissions();
  const { canDo } = useDocTypePermissions();
  const { user } = useAuth();
  const isInternal = user?.role?.category === 'org_admin' || user?.role?.category === 'org_internal';

  const canViewInbound  = canDo('GRN_INBOUND',  'view');
  const canViewOutbound = canDo('OUTWARD_GRN',  'view');

  // Inbound data from /api/grn/pending (gate_out + in_transit containers)
  const [inboundWarehouse, setInboundWarehouse] = useState<any>(null);
  const [qcChecklist, setQcChecklist]           = useState<any[]>([]);
  const [pendingContainers, setPendingContainers] = useState<any[]>([]);

  // Stock/outbound data from /api/partner/warehouse
  const [allContainers, setAllContainers] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'inbound' | 'stock' | 'outbound'>('inbound');

  const visibleTabs = useMemo(() => {
    const tabs: { value: 'inbound' | 'stock' | 'outbound'; label: string; count: number }[] = [];
    if (canViewInbound)  tabs.push({ value: 'inbound',  label: 'Inward QC', count: 0 });
    if (canViewInbound || canViewOutbound) tabs.push({ value: 'stock', label: 'In Stock', count: 0 });
    if (canViewOutbound) tabs.push({ value: 'outbound', label: 'Outbound',  count: 0 });
    return tabs;
  }, [canViewInbound, canViewOutbound]);

  useEffect(() => {
    if (!permLoaded || visibleTabs.length === 0) return;
    if (!visibleTabs.find(t => t.value === activeTab)) {
      setActiveTab(visibleTabs[0].value);
    }
  }, [permLoaded, visibleTabs, activeTab]);

  const loadData = () => {
    setLoading(true);

    const pendingFetch = fetch(`${API_BASE}/api/grn/pending`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setInboundWarehouse(d.data?.warehouse ?? null);
        setQcChecklist(d.data?.qcChecklist ?? []);
        setPendingContainers(d.data?.pending ?? []);
      })
      .catch(() => {});

    const warehouseFetch = fetch(`${API_BASE}/api/partner/warehouse`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setAllContainers(d.data?.containers ?? []);
      })
      .catch(() => {});

    Promise.all([pendingFetch, warehouseFetch]).finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const warehouse = inboundWarehouse;

  const tabCounts = useMemo(() => ({
    inbound: pendingContainers.filter(c => !c.existingGrn).length,
    stock: allContainers.filter(c => c.stage === 'in_stock').length,
    outbound: allContainers.filter(c => ['dispatched', 'delivered'].includes(c.stage)).length,
  }), [pendingContainers, allContainers]);

  if (permLoaded && !canViewInbound && !canViewOutbound) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 flex flex-col items-center justify-center gap-3">
        <Lock className="w-7 h-7 text-destructive" />
        <p className="text-[14.5px] font-semibold text-foreground">Access Restricted</p>
        <p className="text-[13px] text-muted-foreground text-center max-w-xs">
          Your role does not have permission to access warehouse operations.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="h-8 bg-muted rounded animate-pulse w-48" />
        <div className="h-12 bg-muted rounded-lg animate-pulse" />
        <div className="h-32 bg-muted rounded-lg animate-pulse" />
        <div className="h-32 bg-muted rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!warehouse) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-4">
          <a href="/partner" className="text-[14.5px] text-muted-foreground hover:text-foreground transition-colors">
            ← Home
          </a>
        </div>
        <div className="bg-card rounded-lg border border-border p-10 text-center">
          <Warehouse className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
          <h2 className="text-[14.5px] font-semibold">No warehouse assigned</h2>
          <p className="text-[13px] text-muted-foreground mt-1 max-w-xs mx-auto">
            Your organisation hasn't been linked to a warehouse yet.
            Contact your admin to set this up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <a href="/partner" className="text-[14.5px] text-muted-foreground hover:text-foreground transition-colors">
            ← Home
          </a>
          <span className="text-muted-foreground">/</span>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>{warehouse.name}</h1>
        </div>
        {warehouse.address && (
          <p className="text-[14.5px] text-muted-foreground">{warehouse.address}</p>
        )}
      </div>

      {/* Tab bar — only show tabs the user has permission to view */}
      <div className="flex gap-1 mb-6 bg-muted/30 rounded-lg p-1 border border-border">
        {visibleTabs.map(tab => {
          const count = tabCounts[tab.value];
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`flex-1 py-2.5 text-[14.5px] font-medium rounded-lg transition-all ${
                activeTab === tab.value
                  ? 'bg-card shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-1.5 text-[13px] ${
                  activeTab === tab.value && tab.value === 'inbound'
                    ? 'text-teal-500 font-semibold'
                    : 'opacity-60'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content — gated by both activeTab and explicit permission */}
      {activeTab === 'inbound' && canViewInbound && (
        <InboundTab
          pending={pendingContainers}
          qcChecklist={qcChecklist}
          warehouse={warehouse}
          onRefresh={loadData}
          isInternal={isInternal}
        />
      )}
      {activeTab === 'stock'    && (canViewInbound || canViewOutbound) && <StockTab containers={allContainers} />}
      {activeTab === 'outbound' && canViewOutbound && <OutboundTab containers={allContainers} />}
    </div>
  );
}
