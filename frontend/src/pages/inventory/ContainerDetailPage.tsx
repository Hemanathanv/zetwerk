import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'wouter';
import {
  CheckCircle, AlertCircle, AlertTriangle, Check, Ship, Anchor,
  Package, DollarSign, ArrowLeft, Clock, MapPin, Warehouse,
  ClipboardCheck, ExternalLink, ArrowRight, List,
} from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { RequireActivity } from '@/components/PermissionGate';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmt(d: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', opts ?? { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return '';
  const diffMs = Date.now() - new Date(d).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    at_origin:    { bg: 'hsl(var(--muted))', text: 'hsl(var(--muted-foreground))' },
    in_transit:   { bg: 'hsl(214 100% 95%)', text: 'hsl(214 72% 40%)' },
    at_port:      { bg: 'hsl(38 92% 94%)',   text: 'hsl(38 55% 38%)' },
    discharged:   { bg: 'hsl(38 92% 94%)',   text: 'hsl(38 55% 38%)' },
    gate_out:     { bg: 'hsl(270 60% 96%)',  text: 'hsl(270 50% 42%)' },
    in_warehouse: { bg: 'hsl(143 60% 93%)',  text: 'hsl(143 50% 32%)' },
    delivered:    { bg: 'hsl(173 58% 93%)',  text: 'hsl(173 58% 30%)' },
    returned:     { bg: 'hsl(143 60% 93%)',  text: 'hsl(143 50% 32%)' },
  };
  const s = map[status] ?? map.at_origin;
  return (
    <span style={{
      fontSize: 14, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
      background: s.bg, color: s.text, textTransform: 'capitalize',
    }}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

// ─── SafeCube event category chip ─────────────────────────────────────────────

const EVENT_CODE_META: Record<string, { label: string; color: string }> = {
  GATE_IN:           { label: 'Gate In',     color: 'hsl(214 72% 40%)' },
  LOADED_ON_VESSEL:  { label: 'Loaded',      color: 'hsl(270 50% 42%)' },
  VESSEL_DEPARTURE:  { label: 'Departed',    color: 'hsl(214 72% 40%)' },
  VESSEL_ARRIVAL:    { label: 'Arrived',     color: 'hsl(38 55% 38%)' },
  DISCHARGE:         { label: 'Discharged',  color: 'hsl(38 55% 38%)' },
  GATE_OUT:          { label: 'Gate Out',    color: 'hsl(173 58% 30%)' },
  EMPTY_RETURN:      { label: 'Returned',    color: 'hsl(143 50% 32%)' },
  CUSTOMS_RELEASE:   { label: 'Customs',     color: 'hsl(38 55% 38%)' },
  DELIVERY:          { label: 'Delivered',   color: 'hsl(173 58% 30%)' },
};

function EventCodeChip({ code }: { code: string | null }) {
  if (!code) return null;
  const meta = EVENT_CODE_META[code];
  if (!meta) return (
    <span style={{
      fontSize: 14.5, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
      background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
    }}>{code.replace(/_/g, ' ')}</span>
  );
  return (
    <span style={{
      fontSize: 14.5, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
      background: meta.color.replace(')', ' / 0.1)').replace('hsl(', 'hsl('),
      color: meta.color, border: `1px solid ${meta.color.replace(')', ' / 0.2)').replace('hsl(', 'hsl(')}`,
    }}>{meta.label}</span>
  );
}

// ─── SafeCube event timeline ──────────────────────────────────────────────────

function SafeCubeTimeline({ events, scShipment, embedded }: { events: any[]; scShipment: any; embedded?: boolean }) {
  const teal = 'hsl(173 58% 39%)';
  const muted = 'hsl(var(--muted-foreground))';

  if (events.length === 0) {
    return (
      <p style={{ fontSize: 14, color: muted, margin: 0 }}>
        No live tracking events recorded for this container yet.
      </p>
    );
  }

  const inner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {events.map((ev, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === events.length - 1;
        const dotColor = ev.isActual ? teal : 'hsl(var(--muted))';
        const location = ev.facilityName || ev.locationName || '';
        const locode = ev.facilityLocode || ev.locationLocode || '';

        return (
          <div key={ev.id} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: dotColor, flexShrink: 0, zIndex: 1,
                ...(isFirst && ev.isActual ? { boxShadow: `0 0 0 3px hsla(173,58%,39%,0.2)` } : {}),
              }} />
              {!isLast && (
                <div style={{
                  width: 1, flex: 1,
                  background: ev.isActual ? 'hsl(173 58% 75%)' : 'hsl(var(--muted))',
                  minHeight: 20,
                }} />
              )}
            </div>

            <div style={{ flex: 1, paddingBottom: isLast ? 0 : 12, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.3 }}>
                  {ev.description || ev.eventCode?.replace(/_/g, ' ') || 'Event'}
                </span>
                <EventCodeChip code={ev.eventCode} />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
                {location && (
                  <span style={{ fontSize: 14.5, color: muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <MapPin size={10} />
                    {location}
                    {locode && <span style={{ opacity: 0.6 }}> ({locode})</span>}
                  </span>
                )}
                {ev.vesselName && (
                  <span style={{ fontSize: 14.5, color: muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Ship size={10} /> {ev.vesselName}
                    {ev.voyage && <span style={{ opacity: 0.6 }}> V.{ev.voyage}</span>}
                  </span>
                )}
                <span style={{ fontSize: 14.5, color: muted, marginLeft: 'auto' }}>
                  {ev.eventAt ? fmtTime(ev.eventAt) : ''}
                  {ev.isActual === false && (
                    <span style={{ marginLeft: 5, fontSize: 14.5, opacity: 0.6 }}>estimated</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  if (embedded) return inner;

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          Live Tracking Events
          <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>({events.length})</span>
        </div>
        {scShipment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {(scShipment.delayDays ?? 0) > 0 && (
              <span style={{
                fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                background: 'hsl(38 92% 93%)', color: 'hsl(38 55% 38%)',
                border: '1px solid hsl(38 80% 80%)',
              }}>+{scShipment.delayDays}d delay</span>
            )}
            {scShipment.scheduleStatus && !(scShipment.delayDays > 0) && (
              <span style={{
                fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
                background: 'hsl(143 60% 93%)', color: 'hsl(143 50% 32%)',
                border: '1px solid hsl(143 50% 78%)',
              }}>On Time</span>
            )}
            {scShipment.podPredictiveEta && (
              <span style={{ fontSize: 14, color: muted }}>
                ETA {fmt(scShipment.podPredictiveEta, { day: '2-digit', month: 'short' })}
              </span>
            )}
          </div>
        )}
      </div>
      {inner}
    </div>
  );
}

// ─── Inventory position banner ────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PORT_ARRIVAL:    { label: 'Arrived at Port',       color: 'hsl(38 55% 38%)',  bg: 'hsl(38 92% 94%)' },
  GATE_OUT:        { label: 'Gate Out',               color: 'hsl(270 50% 42%)', bg: 'hsl(270 60% 96%)' },
  THREE_PL_INWARD: { label: 'Received at 3PL',       color: 'hsl(143 50% 32%)', bg: 'hsl(143 60% 93%)' },
  DISPATCHED:      { label: 'Dispatched from 3PL',   color: 'hsl(214 72% 40%)', bg: 'hsl(214 100% 95%)' },
  DELIVERED:       { label: 'Delivered',              color: 'hsl(173 58% 30%)', bg: 'hsl(173 58% 93%)' },
};

function InventoryPositionBanner({ movements, containerNumber }: {
  movements: any[];
  containerNumber: string;
}) {
  const containerMovements = movements
    .filter((m: any) => m.container_number === containerNumber || m.containerNumber === containerNumber)
    .sort((a: any, b: any) => new Date(b.moved_at ?? b.movedAt).getTime() - new Date(a.moved_at ?? a.movedAt).getTime());

  if (containerMovements.length === 0) return null;

  const latest = containerMovements[0];
  const movementType = latest.movement_type ?? latest.movementType;
  const meta = MOVEMENT_LABELS[movementType] ?? { label: movementType, color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted))' };
  const movedAt = latest.moved_at ?? latest.movedAt;
  const warehouseName = latest.to_warehouse_name ?? latest.toWarehouseName ?? latest.from_warehouse_name ?? latest.fromWarehouseName;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 10,
      background: meta.bg, color: meta.color,
      marginBottom: 16,
    }}>
      <Warehouse size={14} />
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{meta.label}</div>
        {warehouseName && (
          <div style={{ fontSize: 14, opacity: 0.8 }}>{warehouseName}</div>
        )}
      </div>
      <div style={{ marginLeft: 'auto', fontSize: 14, opacity: 0.75 }}>
        {movedAt ? fmtTime(movedAt) : ''}
      </div>
    </div>
  );
}

// ─── Movement Ledger panel ────────────────────────────────────────────────────

const LEDGER_TYPE_META: Record<string, { label: string; direction: string; color: string; bg: string }> = {
  PORT_ARRIVAL:    { label: 'Arrived at Port',      direction: 'INWARD',   color: 'hsl(38 55% 38%)',  bg: 'hsl(38 92% 94%)' },
  IN_TRANSIT:      { label: 'Gate Out / In Transit', direction: 'TRANSFER', color: 'hsl(270 50% 42%)', bg: 'hsl(270 60% 96%)' },
  THREE_PL_INWARD: { label: 'Received at 3PL',      direction: 'INWARD',   color: 'hsl(143 50% 32%)', bg: 'hsl(143 60% 93%)' },
  DISPATCHED:      { label: 'Dispatched',            direction: 'OUTWARD',  color: 'hsl(214 72% 40%)', bg: 'hsl(214 100% 95%)' },
  DELIVERED:       { label: 'Delivered',             direction: 'OUTWARD',  color: 'hsl(173 58% 30%)', bg: 'hsl(173 58% 93%)' },
};

const DIRECTION_META: Record<string, { label: string; color: string; bg: string }> = {
  INWARD:   { label: 'IN',       color: 'hsl(143 50% 32%)', bg: 'hsl(143 60% 93%)' },
  OUTWARD:  { label: 'OUT',      color: 'hsl(0 60% 45%)',   bg: 'hsl(0 72% 96%)' },
  TRANSFER: { label: 'TRANSFER', color: 'hsl(270 50% 42%)', bg: 'hsl(270 60% 96%)' },
};

function MovementTypeBadge({ type }: { type: string }) {
  const meta = LEDGER_TYPE_META[type] ?? { label: type.replace(/_/g, ' '), direction: 'TRANSFER', color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted))' };
  const dir = DIRECTION_META[meta.direction];
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {dir && (
        <span style={{
          fontSize: 14, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
          background: dir.bg, color: dir.color, letterSpacing: '0.04em',
        }}>
          {dir.label}
        </span>
      )}
      <span style={{
        fontSize: 14.5, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
        background: meta.bg, color: meta.color, whiteSpace: 'nowrap',
      }}>
        {meta.label}
      </span>
    </span>
  );
}

function MovementLedgerPanel({ movements, containerNumber }: {
  movements: any[];
  containerNumber: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const muted = 'hsl(var(--muted-foreground))';

  const containerMovements = movements
    .filter((m: any) => !containerNumber || m.container_number === containerNumber || m.containerNumber === containerNumber)
    .sort((a: any, b: any) => new Date(a.moved_at ?? a.movedAt).getTime() - new Date(b.moved_at ?? b.movedAt).getTime());

  const COLLAPSED_ROWS = 4;
  const visible = expanded ? containerMovements : containerMovements.slice(0, COLLAPSED_ROWS);
  const hasMore = containerMovements.length > COLLAPSED_ROWS;

  const headers = ['Date & Time', 'Type', 'Qty', 'Weight', 'Performed By', 'Notes'];

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <List size={14} style={{ color: muted }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Movement Ledger</span>
        <span style={{ fontSize: 14, fontWeight: 400, color: muted }}>({containerMovements.length})</span>
      </div>

      {containerMovements.length === 0 ? (
        <p style={{ fontSize: 14, color: muted, margin: 0 }}>
          No inventory movements recorded yet for this container.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  {headers.map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '0 8px 8px 0',
                      fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.05em', color: muted, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((mv: any, idx: number) => {
                  const movedAt = mv.moved_at ?? mv.movedAt;
                  const type = mv.movement_type ?? mv.movementType ?? '';
                  const notes = mv.notes ?? mv.grn_notes ?? '';
                  const qty = mv.quantity != null ? Number(mv.quantity) : null;
                  const weightKg = mv.weight_kg != null ? Number(mv.weight_kg) : null;
                  const performedBy = mv.performed_by_name ?? mv.performedByName ?? null;

                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid hsl(var(--border) / 0.4)' }}>
                      <td style={{ padding: '16px 20px 16px 0', fontFamily: 'monospace', whiteSpace: 'nowrap', color: muted, fontSize: 14.5 }}>
                        {movedAt ? fmtTime(movedAt) : '—'}
                      </td>
                      <td style={{ padding: '16px 20px 16px 0' }}>
                        <MovementTypeBadge type={type} />
                      </td>
                      <td style={{ padding: '16px 20px 16px 0', fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {qty != null ? qty.toLocaleString() : <span style={{ color: muted }}>—</span>}
                      </td>
                      <td style={{ padding: '16px 20px 16px 0', fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap', color: muted }}>
                        {weightKg != null ? `${weightKg.toLocaleString()} kg` : '—'}
                      </td>
                      <td style={{ padding: '16px 20px 16px 0' }}>
                        {performedBy || <span style={{ color: muted }}>—</span>}
                      </td>
                      <td style={{ padding: '16px 20px 16px 0', color: muted }}>
                        {notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                marginTop: 8, fontSize: 14, color: 'hsl(173 58% 39%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              {expanded ? 'Show fewer' : `Show all ${containerMovements.length} movements`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── GRN Inward section ───────────────────────────────────────────────────────

function GrnInwardPanel({ movements, containerNumber, shipmentId, currentStatus, grnDocumentId }: {
  movements: any[];
  containerNumber: string;
  shipmentId: string;
  currentStatus: string;
  grnDocumentId?: string | null;
}) {
  // Primary: look for a THREE_PL_INWARD movement for this container
  const inwardMovement = movements.find(
    (mv: any) =>
      (mv.container_number === containerNumber || mv.containerNumber === containerNumber) &&
      (mv.movement_type === 'THREE_PL_INWARD' || mv.movementType === 'THREE_PL_INWARD')
  );

  // Also check if container is en route (gate_out) or in warehouse (in_warehouse)
  const isAtWarehouse = currentStatus === 'in_warehouse' || currentStatus === 'delivered';
  const isEnRoute = currentStatus === 'gate_out';

  if (!inwardMovement && !isAtWarehouse) {
    if (!isEnRoute) return null;
    // En route: show awaiting state
    return (
      <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <ClipboardCheck size={14} style={{ color: 'hsl(var(--muted-foreground))' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>3PL Inward GRN</span>
          <span style={{ fontSize: 14.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
            Awaiting
          </span>
        </div>
        <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
          Container is in transit to the warehouse. Inward QC not yet recorded.
        </p>
      </div>
    );
  }

  const receivedAt = inwardMovement?.moved_at ?? inwardMovement?.movedAt ?? null;
  const warehouseName = inwardMovement?.to_warehouse_name ?? inwardMovement?.toWarehouseName ?? null;
  const receivedBy = inwardMovement?.performed_by_name ?? inwardMovement?.performedByName ?? null;
  const qcStatus = inwardMovement?.qc_overall_status ?? inwardMovement?.qcOverallStatus ?? null;
  const warehouseStockItems: any[] = inwardMovement?.warehouseStockItems ?? inwardMovement?.warehouse_stock_items ?? [];

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px',
      borderLeft: '3px solid hsl(173 58% 39%)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <ClipboardCheck size={14} style={{ color: 'hsl(173 58% 39%)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>3PL Inward GRN</span>
        {qcStatus ? (
          <span style={{
            fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
            background: qcStatus === 'PASSED' ? 'hsl(173 58% 93%)' : qcStatus === 'FAILED' ? 'hsl(0 72% 96%)' : 'hsl(38 92% 94%)',
            color: qcStatus === 'PASSED' ? 'hsl(173 58% 30%)' : qcStatus === 'FAILED' ? 'hsl(0 60% 45%)' : 'hsl(38 55% 38%)',
          }}>
            QC {qcStatus === 'PASSED' ? 'Passed' : qcStatus === 'FAILED' ? 'Failed' : 'Pending'}
          </span>
        ) : (
          <span style={{ fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'hsl(173 58% 93%)', color: 'hsl(173 58% 30%)' }}>
            Complete
          </span>
        )}
        {grnDocumentId ? (
          <Link
            href={`/documents/${grnDocumentId}`}
            style={{ marginLeft: 'auto', fontSize: 14.5, color: 'hsl(173 58% 39%)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            View GRN document <ExternalLink size={10} />
          </Link>
        ) : (
          <Link
            href={`/shipments/${shipmentId}`}
            style={{ marginLeft: 'auto', fontSize: 14.5, color: 'hsl(173 58% 39%)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            Shipment docs <ExternalLink size={10} />
          </Link>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: 14.5, marginBottom: warehouseStockItems.length > 0 ? 16 : 0 }}>
        {receivedAt && (
          <div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Received</div>
            <div style={{ fontFamily: 'monospace' }}>{fmtTime(receivedAt)}</div>
          </div>
        )}
        {warehouseName && (
          <div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Warehouse</div>
            <div style={{ fontWeight: 500 }}>{warehouseName}</div>
          </div>
        )}
        {receivedBy && (
          <div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Received by</div>
            <div style={{ fontWeight: 500 }}>{receivedBy}</div>
          </div>
        )}
        {inwardMovement?.quantity_mt != null && (
          <div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>Received (MT)</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 500 }}>
              {Number(inwardMovement.quantity_mt ?? inwardMovement.quantityMt).toLocaleString()} MT
            </div>
          </div>
        )}
      </div>

      {/* Received SKU breakdown — declared vs received */}
      {warehouseStockItems.length > 0 && (
        <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 12 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'hsl(var(--muted-foreground))', marginBottom: 6 }}>
            Received SKUs
          </div>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'hsl(var(--muted) / 0.5)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Product</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Received</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Declared</th>
                <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {warehouseStockItems.map((item: any, i: number) => {
                const received  = Number(item.quantity_on_hand ?? item.quantityOnHand ?? 0);
                const declared  = Number(item.declared_quantity ?? item.declaredQuantity ?? received);
                const variance  = received - declared;
                const weight    = item.net_weight_kg ?? item.netWeightKg;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid hsl(var(--border) / 0.5)' }}>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
                      {item.product_code ?? item.productCode ?? '—'}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                      {received.toLocaleString()}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'hsl(var(--muted-foreground))' }}>
                      {declared.toLocaleString()}
                      {variance !== 0 && (
                        <span style={{ marginLeft: 4, color: variance > 0 ? 'hsl(143 50% 38%)' : 'hsl(0 60% 45%)', fontWeight: 600 }}>
                          ({variance > 0 ? '+' : ''}{variance})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'hsl(var(--muted-foreground))' }}>
                      {weight != null ? `${Number(weight).toLocaleString()} kg` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Contents panel ───────────────────────────────────────────────────────────

function ContentsPanel({ contents }: { contents: any[] }) {
  const hasMismatches = contents.some(c => !c.matched);

  if (contents.length === 0) {
    return (
      <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Contents</div>
        <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
          No packing list data available for this container.
        </p>
      </div>
    );
  }

  const totalQty = contents.reduce((s, c) => s + (parseFloat(c.quantity) || 0), 0);
  const totalWeight = contents.reduce((s, c) => {
    const weight = c.masterData?.unitWeightKg
      ? parseFloat(c.quantity || 0) * Number(c.masterData.unitWeightKg)
      : parseFloat(c.grossWeight || c.netWeight || 0);
    return s + weight;
  }, 0);

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Contents</div>
        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          {contents.length} product{contents.length !== 1 ? 's' : ''} · {totalQty.toLocaleString()} items · {totalWeight.toLocaleString()} kg
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Product', 'Qty', 'Weight', 'HS Code', 'Origin'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Product' || h === 'HS Code' || h === 'Origin' ? 'left' : 'right',
                  padding: '0 8px 8px 0',
                  fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: 'hsl(var(--muted-foreground))',
                  borderBottom: '1px solid hsl(var(--border))',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contents.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid hsl(var(--border) / 0.4)' }}>
                <td style={{ padding: '8px 8px 8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {item.matched
                      ? <CheckCircle size={11} style={{ color: 'hsl(173 58% 39%)', flexShrink: 0 }} />
                      : <AlertCircle size={11} style={{ color: 'hsl(38 55% 40%)', flexShrink: 0 }} />}
                    <div>
                      <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {item.masterData?.productCode || item.productCode || '—'}
                      </div>
                      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                        {item.masterData?.description || item.description || ''}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '8px 8px 8px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                  {parseFloat(item.quantity || 0).toLocaleString()}
                </td>
                <td style={{ padding: '8px 8px 8px 0', textAlign: 'right', fontFamily: 'monospace' }}>
                  {item.masterData?.unitWeightKg
                    ? `${(parseFloat(item.quantity || 0) * Number(item.masterData.unitWeightKg)).toLocaleString()} kg`
                    : item.grossWeight ? `${parseFloat(item.grossWeight).toLocaleString()} kg` : '—'}
                </td>
                <td style={{ padding: '8px 8px 8px 0', fontFamily: 'monospace', color: 'hsl(var(--muted-foreground))' }}>
                  {item.masterData?.hsCode || item.hsCode || '—'}
                </td>
                <td style={{ padding: '8px 0 8px 0' }}>
                  {item.masterData?.countryOfOrigin || '—'}
                  {item.masterData?.section232Applicable && (
                    <span style={{
                      fontSize: 14, marginLeft: 4, padding: '2px 5px', borderRadius: 3,
                      background: 'hsl(270 60% 96%)', color: 'hsl(270 50% 42%)',
                    }}>S232</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid hsl(var(--border))' }}>
              <td style={{ padding: '8px 8px 4px 0', fontWeight: 600 }}>Total</td>
              <td style={{ padding: '8px 8px 4px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{totalQty.toLocaleString()}</td>
              <td style={{ padding: '8px 8px 4px 0', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{totalWeight.toLocaleString()} kg</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {hasMismatches && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14.5, color: 'hsl(38 55% 40%)' }}>
            <AlertCircle size={12} />
            {contents.filter(c => !c.matched).length} product(s) not matched to product master
          </div>
          <a
            href="/settings"
            style={{ fontSize: 14.5, color: 'hsl(173 58% 39%)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
            title="Fix in Settings → Workflow & Documents → Product SKUs"
          >
            Fix in Products → <ExternalLink size={9} />
          </a>
        </div>
      )}
    </div>
  );
}

// ─── D&D breakdown ────────────────────────────────────────────────────────────

function DndPanel({ charge }: { charge: any }) {
  const isAccruing = charge?.status === 'ACCRUING';
  const isClosed   = charge?.status === 'CLOSED';
  const snapshot   = charge?.rateSnapshot as any;

  if (!charge) {
    return (
      <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>D&D Charges</div>
        <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
          No D&D monitoring (not yet discharged or no rate configured).
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px',
      borderLeft: isAccruing ? '3px solid hsl(0 72% 50%)' : isClosed ? '3px solid hsl(173 58% 39%)' : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DollarSign size={14} style={{ color: isAccruing ? 'hsl(0 60% 45%)' : 'hsl(var(--muted-foreground))' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>D&D Charges</span>
          {isAccruing && (
            <span style={{ fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'hsl(0 72% 96%)', color: 'hsl(0 60% 45%)' }}>
              Accruing
            </span>
          )}
          {isClosed && (
            <span style={{ fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'hsl(173 58% 93%)', color: 'hsl(173 58% 30%)' }}>
              Closed
            </span>
          )}
          {charge.status === 'MONITORING' && (
            <span style={{ fontSize: 14.5, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>
              Monitoring
            </span>
          )}
        </div>
        {charge.ticketId && (
          <Link href="/accounting" style={{ fontSize: 14.5, color: 'hsl(173 58% 39%)', textDecoration: 'none' }}>
            View ticket →
          </Link>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', marginBottom: 16 }}>
        {[
          ['Discharged', fmt(charge.dischargeDate)],
          ['Last Free Day', fmt(charge.lfd)],
          ['Free Days', `${charge.freeDays} days`],
          ...(charge.gateOutDate ? [['Gate Out', fmt(charge.gateOutDate)] as [string, string]] : []),
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14.5, fontFamily: 'monospace', fontWeight: label === 'Last Free Day' && isAccruing ? 600 : 400, color: label === 'Last Free Day' && isAccruing ? 'hsl(0 60% 45%)' : 'inherit' }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      {(isAccruing || isClosed) && (
        <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 12 }}>
          {[
            [`Demurrage`, `${charge.demurrageDays}d × ${charge.currency} ${Number(charge.demurrageRate).toLocaleString()}/day`, `${charge.currency} ${Number(charge.demurrageTotal).toLocaleString()}`],
            ...(charge.detentionDays > 0 || charge.gateOutDate ? [['Detention', `${charge.detentionDays}d × ${charge.currency} ${Number(charge.detentionRate).toLocaleString()}/day`, `${charge.currency} ${Number(charge.detentionTotal).toLocaleString()}`] as [string, string, string]] : []),
          ].map(([label, formula, total]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, fontSize: 14.5 }}>
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 14,}}>
                {formula} = <span style={{ fontWeight: 600 }}>{total}</span>
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid hsl(var(--border))', paddingTop: 8, marginTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Total</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: isAccruing ? 'hsl(0 60% 45%)' : 'inherit' }}>
              {charge.currency} {Number(charge.totalCharge).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {snapshot && (
        <div style={{ marginTop: 14, background: 'hsl(var(--muted) / 0.5)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'hsl(var(--muted-foreground))', marginBottom: 5 }}>Rate Source</div>
          <div style={{ fontSize: 14.5 }}>
            <span style={{ fontWeight: 600 }}>{snapshot.portName}</span>
            {snapshot.terminalName && <span style={{ color: 'hsl(var(--muted-foreground))' }}> / {snapshot.terminalName}</span>}
            {snapshot.shippingLine && <span style={{ color: 'hsl(var(--muted-foreground))' }}> / {snapshot.shippingLine}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            <span>Demurrage: {charge.currency} {snapshot.demurragePerDay}/day</span>
            <span>Detention: {charge.currency} {snapshot.detentionPerDay}/day</span>
          </div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 4, fontStyle: 'italic' }}>
            Rate frozen at discharge. Effective: {fmt(snapshot.effectiveDate)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inventory Journey (milestone-driven) ─────────────────────────────────────

function MilestoneJourneyTimeline({ milestones }: { milestones: any[] }) {
  const teal     = 'hsl(173 58% 39%)';
  const muted    = 'hsl(var(--muted-foreground))';
  const sorted   = [...milestones].sort((a, b) => (a.milestoneNumber ?? 0) - (b.milestoneNumber ?? 0));
  const completed = sorted.filter(m => m.status === 'COMPLETED').length;

  const typeBg: Record<string, string> = {
    AUTO:     'hsl(214 100% 95%)', DOCUMENT: 'hsl(173 58% 93%)',
    MANUAL:   'hsl(38 92% 93%)',   SYSTEM:   'hsl(270 60% 96%)',
  };
  const typeColor: Record<string, string> = {
    AUTO:     'hsl(214 72% 40%)', DOCUMENT: 'hsl(173 58% 30%)',
    MANUAL:   'hsl(38 55% 38%)',  SYSTEM:   'hsl(270 50% 42%)',
  };

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 14.5, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: muted,
          }}>
            Inventory Journey
          </span>
          <span style={{
            fontSize: 14.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: 'hsl(var(--muted))', color: muted,
          }}>
            {milestones.length} milestones
          </span>
        </div>
        <span style={{ fontSize: 14.5, color: muted }}>
          {completed}/{milestones.length} complete
        </span>
      </div>

      {/* Empty state */}
      {milestones.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <ClipboardCheck size={28} style={{ color: muted, marginBottom: 10 }} />
          <div style={{ fontSize: 14, color: muted, marginBottom: 6 }}>
            No milestones configured for this shipment's workflow.
          </div>
          <a
            href="/settings"
            style={{ fontSize: 14.5, color: teal, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            Configure in Settings → Workflow <ExternalLink size={10} />
          </a>
        </div>
      )}

      {/* Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {sorted.map((ms, idx) => {
          const config   = ms.milestoneConfig;
          const isLast   = idx === sorted.length - 1;
          const isDone   = ms.status === 'COMPLETED';
          const isOver   = ms.status === 'OVERDUE';
          const isPend   = !isDone && !isOver;
          const dotColor = isDone ? teal : isOver ? 'hsl(0 72% 50%)' : 'hsl(var(--muted))';
          const lineColor = isDone ? 'hsl(173 58% 75%)' : 'hsl(var(--muted))';

          return (
            <div key={ms.id ?? idx} style={{ display: 'flex', gap: 12, position: 'relative' }}>
              {/* Dot + line */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0, zIndex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: dotColor,
                  ...(isDone ? {} : { border: `2px solid ${dotColor}`, background: 'hsl(var(--card))' }),
                }}>
                  {isDone && <Check size={10} style={{ color: 'white' }} />}
                  {isOver && <AlertTriangle size={9} style={{ color: 'white' }} />}
                </div>
                {!isLast && (
                  <div style={{ width: 1, flex: 1, background: lineColor, minHeight: 18 }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                    <span style={{
                      fontSize: 14.5, lineHeight: 1.35,
                      fontWeight: isDone ? 600 : 400,
                      color: isPend ? muted : 'hsl(var(--foreground))',
                    }}>
                      {config?.name || `Milestone ${ms.milestoneNumber}`}
                    </span>
                    {config?.type && (
                      <span style={{
                        fontSize: 14.5, padding: '2px 6px', borderRadius: 3, flexShrink: 0,
                        background: typeBg[config.type] ?? 'hsl(var(--muted))',
                        color: typeColor[config.type] ?? muted,
                      }}>
                        {config.type}
                      </span>
                    )}
                  </div>
                  {/* Date flushed right */}
                  {isDone && ms.completedAt && (
                    <span style={{ fontSize: 14.5, color: muted, flexShrink: 0, marginTop: 2 }}>
                      {fmt(ms.completedAt, { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                  {isPend && ms.expectedAt && (
                    <span style={{ fontSize: 14.5, color: muted, flexShrink: 0, marginTop: 2 }}>
                      {fmt(ms.expectedAt, { day: '2-digit', month: 'short' })}
                    </span>
                  )}
                </div>

                {/* Sub-line */}
                {isDone && ms.source && (
                  <div style={{ fontSize: 14.5, color: muted, marginTop: 2, textTransform: 'capitalize' }}>
                    via {ms.source}
                  </div>
                )}
                {isOver && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14.5, color: 'hsl(0 60% 45%)', fontWeight: 500 }}>
                      Overdue
                      {ms.expectedAt && ` · was due ${fmt(ms.expectedAt, { day: '2-digit', month: 'short' })}`}
                    </span>
                    {(ms.notifyRoles?.length ?? (ms.milestoneConfig?.notifyRoles?.length ?? 0)) > 0 && (
                      <span style={{
                        fontSize: 14.5, padding: '2px 7px', borderRadius: 3, fontWeight: 600,
                        background: 'hsl(0 72% 95%)', color: 'hsl(0 60% 40%)',
                        border: '1px solid hsl(0 72% 85%)',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        <ClipboardCheck size={9} /> Task created
                      </span>
                    )}
                  </div>
                )}
                {isPend && (ms.expectedAt || ms.slaFromPreviousHrs) && (
                  <div style={{ fontSize: 14.5, color: muted, marginTop: 2 }}>
                    {ms.expectedAt
                      ? `Expected ${fmt(ms.expectedAt, { day: '2-digit', month: 'short', year: 'numeric' })}`
                      : ms.slaFromPreviousHrs
                      ? `SLA: ${ms.slaFromPreviousHrs < 24 ? `${ms.slaFromPreviousHrs}h` : `${Math.round(ms.slaFromPreviousHrs / 24)}d`} after previous`
                      : null}
                    {ms.slaFromPreviousHrs && ms.expectedAt && (
                      <span style={{ marginLeft: 5, opacity: 0.6 }}>
                        (SLA {ms.slaFromPreviousHrs < 24 ? `${ms.slaFromPreviousHrs}h` : `${Math.round(ms.slaFromPreviousHrs / 24)}d`})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Live Tracking (SafeCube events, collapsible) ─────────────────────────────

function LiveTrackingCard({ events, scShipment }: { events: any[]; scShipment: any }) {
  const [open, setOpen] = useState(false);
  const muted = 'hsl(var(--muted-foreground))';

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '14px 20px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Ship size={13} style={{ color: muted }} />
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            Live Tracking
          </span>
          <span style={{ fontSize: 14.5, color: muted }}>
            ({events.length} carrier events)
          </span>
        </div>
        <span style={{ fontSize: 14.5, color: muted }}>{open ? 'Hide ↑' : 'Show ↓'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          <SafeCubeTimeline events={events} scShipment={scShipment} embedded />
        </div>
      )}
    </div>
  );
}

// ─── Empty return panel ───────────────────────────────────────────────────────

async function handleRecordReturn(container: any) {
  const depot = window.prompt('Return depot name:');
  if (!depot) return;
  const dateStr = window.prompt('Return date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  if (!dateStr) return;
  const dndRes = await fetch(`/api/tracking/shipments/${container.shipmentId}/dnd`, { headers: authHeaders() });
  const dndData = await dndRes.json();
  const charge = (dndData.data || []).find((c: any) => c.containerNumber === container.containerNumber);
  if (charge) {
    await fetch(`/api/tracking/dnd/${charge.id}/return`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnDate: dateStr, returnDepot: depot }),
    });
  }
  window.location.reload();
}

function EmptyReturnPanel({ container, charge }: { container: any; charge: any }) {
  const isDelivered = container.currentStatus === 'delivered';
  const isReturned = container.currentStatus === 'returned';
  if (!isDelivered && !isReturned && !container.returnDate) return null;

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Empty Container Return</div>
      {isReturned || container.returnDate ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>Return Date</span>
            <span style={{ fontFamily: 'monospace' }}>{fmt(container.returnDate)}</span>
          </div>
          {container.returnDepot && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>Return Depot</span>
              <span style={{ fontWeight: 600 }}>{container.returnDepot}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 14.5, color: 'hsl(173 58% 39%)' }}>
            <CheckCircle size={13} /> Container returned — D&D charges finalized
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>Status</span>
            <span style={{ fontWeight: 600, color: 'hsl(38 55% 38%)' }}>Not returned</span>
          </div>
          {container.deliveryDate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
              <span style={{ color: 'hsl(var(--muted-foreground))' }}>Days since delivery</span>
              <span style={{ fontFamily: 'monospace' }}>
                {Math.floor((Date.now() - new Date(container.deliveryDate).getTime()) / 86400000)}d
              </span>
            </div>
          )}
          <div style={{ fontSize: 14.5, color: 'hsl(38 55% 38%)', marginTop: 4 }}>
            Detention continues until container is returned to depot.
          </div>
          <RequireActivity code="GATE-001">
            <button
              onClick={() => handleRecordReturn(container)}
              style={{ fontSize: 14, color: 'hsl(173 58% 39%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', marginTop: 4, textAlign: 'left' }}
            >
              Record container return
            </button>
          </RequireActivity>
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function ContainerDetailPage() {
  const params = useParams<{ id: string }>();
  const containerId = params.id;

  const [container, setContainer] = useState<any>(null);
  const [dndCharge, setDndCharge] = useState<any>(null);
  const [contents, setContents] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerId) return;
    Promise.all([
      fetch(`/api/tracking/containers/${containerId}`, { headers: authHeaders() }).then(r => r.json()),
      fetch(`/api/tracking/containers/${containerId}/contents`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
    ])
      .then(([ctnRes, contentsRes]) => {
        if (!ctnRes.ok) { setError('Container not found'); setLoading(false); return; }
        const ctnData = ctnRes.data;
        setContainer(ctnData);
        setContents(contentsRes.data || []);
        if (ctnData?.shipmentId) {
          Promise.all([
            fetch(`/api/tracking/shipments/${ctnData.shipmentId}/dnd`, { headers: authHeaders() }).then(r => r.json()),
            fetch(`/api/tracking/shipments/${ctnData.shipmentId}/container-milestones`, { headers: authHeaders() }).then(r => r.json()),
            fetch(`/api/inventory/movements/${ctnData.shipmentId}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({ data: [] })),
          ]).then(([dndRes, cmRes, mvRes]) => {
            const charge = (dndRes.data || []).find((c: any) => c.containerNumber === ctnData.containerNumber);
            setDndCharge(charge || null);
            // Prefer the full journey (allMilestones = all template configs overlaid with records)
            if (cmRes.data?.allMilestones?.length) {
              setMilestones(cmRes.data.allMilestones);
            } else {
              const byContainer = cmRes.data?.byContainer ?? {};
              const shipmentLevelMs = cmRes.data?.shipmentLevelMilestones ?? [];
              const containerSpecificMs = byContainer[ctnData.containerNumber] ?? [];
              setMilestones([...containerSpecificMs, ...shipmentLevelMs]);
            }
            setMovements(mvRes.data || []);
          });
        }
        setLoading(false);
      })
      .catch(() => { setError('Failed to load container'); setLoading(false); });
  }, [containerId]);

  if (loading) {
    return (
      <div style={{ padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>Loading container…</span>
      </div>
    );
  }

  if (error || !container) {
    return (
      <div style={{ padding: 28 }}>
        <div style={{ fontSize: 14.5, color: 'hsl(var(--destructive))' }}>{error || 'Container not found'}</div>
        <Link href="/inventory/containers" style={{ fontSize: 14.5, color: 'hsl(173 58% 39%)', display: 'inline-block', marginTop: 8 }}>
          ← Back to containers
        </Link>
      </div>
    );
  }

  const scData = container.scData;
  const scEvents: any[] = scData?.events ?? [];
  const scShipment = scData?.shipment ?? null;
  const scContainer = scData?.container ?? null;

  const lastScEvent = scEvents[0] ?? null;
  const lastKnownLocation = lastScEvent
    ? (lastScEvent.facilityName || lastScEvent.locationName)
    : (container.currentLocation || null);

  return (
    <div style={{ padding: '24px 32px' }}>

      {/* Back nav */}
      <Link
        href="/inventory/containers"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 14.5, color: 'hsl(var(--muted-foreground))', textDecoration: 'none',
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={13} /> Containers
      </Link>

      {/* Inventory position banner */}
      {movements.length > 0 && (
        <InventoryPositionBanner movements={movements} containerNumber={container.containerNumber} />
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <h1 style={{
            fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)',
            fontFamily: 'var(--app-font-mono)', letterSpacing: '-0.025em',
            margin: 0, color: 'hsl(var(--foreground))', lineHeight: 1.2,
          }}>
            {container.containerNumber}
          </h1>
          <StatusBadge status={container.currentStatus} />
          {scContainer?.isoCode && (
            <span style={{
              fontSize: 14.5, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
              background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
            }}>
              {scContainer.isoCode}
              {scContainer.sizeType && <span style={{ marginLeft: 4, opacity: 0.7 }}>{scContainer.sizeType}</span>}
            </span>
          )}
        </div>

        {/* Meta strip */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
          {(scShipment?.vesselName || container.vesselName) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Ship size={11} />
              <span style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>
                {scShipment?.vesselName || container.vesselName}
              </span>
              {container.voyageNumber && <span style={{ fontFamily: 'monospace' }}>V.{container.voyageNumber}</span>}
            </span>
          )}
          {lastKnownLocation && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={11} />
              <span style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>{lastKnownLocation}</span>
              {lastScEvent?.eventAt && (
                <span style={{ opacity: 0.6 }}>· {timeAgo(lastScEvent.eventAt)}</span>
              )}
            </span>
          )}
          {container.sealNumber && (
            <span>Seal: <span style={{ fontFamily: 'monospace', color: 'hsl(var(--foreground))' }}>{container.sealNumber}</span></span>
          )}
          {container.containerType && (
            <span>Type: <span style={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}>{container.containerType}</span></span>
          )}
          {container.shipment && (
            <span>
              Shipment:{' '}
              <Link
                href={`/shipments/${container.shipment.id}`}
                style={{ color: 'hsl(173 58% 39%)', fontFamily: 'monospace', textDecoration: 'none' }}
              >
                {container.shipment.shipmentNumber || 'Pending ID'}
              </Link>
            </span>
          )}
        </div>

        {/* SafeCube schedule status */}
        {scShipment && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {(scShipment.delayDays ?? 0) > 0 ? (
              <span style={{
                fontSize: 14.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                background: 'hsl(38 92% 93%)', color: 'hsl(38 55% 38%)',
                border: '1px solid hsl(38 80% 80%)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Clock size={11} /> +{scShipment.delayDays}d delay
              </span>
            ) : (
              <span style={{
                fontSize: 14.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                background: 'hsl(143 60% 93%)', color: 'hsl(143 50% 32%)',
                border: '1px solid hsl(143 50% 78%)',
              }}>
                On Time
              </span>
            )}
            {scShipment.podPredictiveEta && (
              <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                <Anchor size={11} style={{ marginRight: 3 }} />
                ETA {fmt(scShipment.podPredictiveEta, { day: '2-digit', month: 'short', year: 'numeric' })}
                {!scShipment.podActual && <span style={{ opacity: 0.6, marginLeft: 4 }}>(predicted)</span>}
              </span>
            )}
            {scShipment.sealine && (
              <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>· {scShipment.sealine}</span>
            )}
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 16 }}>
        {/* Left: Inventory Journey (milestones) + Live Tracking + Contents */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MilestoneJourneyTimeline milestones={milestones} />
          {scEvents.length > 0 && (
            <LiveTrackingCard events={scEvents} scShipment={scShipment} />
          )}
          <ContentsPanel contents={contents} />
        </div>

        {/* Right: GRN inward + Movement ledger + D&D + empty return */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {container.shipmentId && (
            <GrnInwardPanel
              movements={movements}
              containerNumber={container.containerNumber}
              shipmentId={container.shipmentId}
              currentStatus={container.currentStatus ?? ''}
              grnDocumentId={container.grnDocumentId ?? null}
            />
          )}
          <MovementLedgerPanel movements={movements} containerNumber={container.containerNumber} />
          <DndPanel charge={dndCharge} />
          <EmptyReturnPanel container={container} charge={dndCharge} />
        </div>
      </div>

    </div>
  );
}
