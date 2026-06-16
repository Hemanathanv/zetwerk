import { useParams, useLocation } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { StatusPill, DocBadge, JourneyBar, ShipmentStatusChips } from '@/components/vs';
import type { JourneyPhase, ShipmentStatusChipsData } from '@/components/vs';
import { useDocumentEvents } from '@/hooks/useDocumentEvents';
import { getAuthToken } from '@/lib/api';
import { AlertCircle } from 'lucide-react';

// ─── API types ────────────────────────────────────────────────────────────────

interface ApiDoc {
  id: string;
  documentType: string;
  documentNumber?: string | null;
  ocrStatus: string;
  approvedAt?: string | null;
  isGenerated?: boolean;
}

interface ApiContainer {
  id: string;
  containerNumber: string;
  containerSize?: string | null;
  containerType?: string | null;
  grossWeightKg?: number | string | null;
  packageCount?: number | null;
}

interface ApiMilestone {
  id: string;
  milestone: string;
  occurredAt: string;
  eventData?: Record<string, unknown> | null;
}

interface ApiTicket {
  id: string;
  ticketNumber: string;
  entryType: string;
  amount: string | number;
  currency: string;
  status: string;
  vendorName?: string | null;
  postedAt?: string | null;
  erpVoucherNumber?: string | null;
}

interface ApiInventoryItem {
  quantity?: number | null;
  netWeightKg?: string | number | null;
  bundleCount?: number | null;
}

interface ApiShipment {
  id: string;
  shipmentNumber: string;
  status: string;
  currentStage: number;
  currentStageName?: string | null;
  blockedReason?: string | null;
  vesselName?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  exporterName?: string | null;
  buyerName?: string | null;
  blNumber?: string | null;
  loadMode?: string | null;
  incoterm?: string | null;
  incotermPort?: string | null;
  documents: ApiDoc[];
  containers: ApiContainer[];
  milestones: ApiMilestone[];
  tickets: ApiTicket[];
  inventoryItems: ApiInventoryItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docTypeCode(dt: string): string {
  const t = dt.toUpperCase();
  if (t === 'SI' || t.includes('SALES_INVOICE')) return 'SI';
  if ((t === 'PL' || t.includes('PACKING_LIST')) && !t.includes('OUTWARD')) return 'PL';
  if (t === 'SB' || t.includes('SHIPPING_BILL')) return 'SB';
  if (t === 'BOL' || t === 'BL' || t.includes('BILL_OF_LADING')) return 'BL';
  if (t.includes('DRAFT_BOE') || (t.includes('BOE') && t.includes('DRAFT')) || t.startsWith('DRAFT')) return 'BE';
  if (t === 'ISF' || t.includes('IMPORTER_SECURITY')) return 'IS';
  if ((t === 'BOE' || t.includes('BILL_OF_ENTRY')) && !t.includes('DRAFT')) return 'BE';
  if (t === 'CRO' || t.includes('CARGO_RELEASE')) return 'CR';
  if (t.includes('CUSTOMS_RELEASE') || t.includes('US_CUSTOMS')) return 'UC';
  if (t === 'CH' || t.includes('CHA_BILL')) return 'CH';
  if (t.includes('DELIVERY_ORDER')) return 'DO';
  if (t === 'GR' || t.includes('GRN') || t.includes('GOODS_RECEIPT')) return 'GR';
  if (t.includes('OUTWARD') || t === 'OP') return 'OP';
  if (t.includes('POD') || t.includes('PROOF_OF_DELIVERY')) return 'PD';
  return dt.slice(0, 2).toUpperCase();
}

function docTypeLabel(dt: string): string {
  const t = dt.toUpperCase();
  if (t === 'SI' || t.includes('SALES_INVOICE')) return 'Sales Invoice';
  if ((t === 'PL' || t.includes('PACKING_LIST')) && !t.includes('OUTWARD')) return 'Packing List';
  if (t === 'SB' || t.includes('SHIPPING_BILL')) return 'Shipping Bill';
  if (t === 'BOL' || t === 'BL' || t.includes('BILL_OF_LADING')) return 'Bill of Lading';
  if (t.includes('DRAFT_BOE') || (t.includes('BOE') && t.includes('DRAFT'))) return 'Draft Bill of Entry';
  if (t.startsWith('DRAFT')) return 'Draft Document';
  if (t === 'ISF' || t.includes('IMPORTER_SECURITY')) return 'ISF Filing';
  if ((t === 'BOE' || t.includes('BILL_OF_ENTRY')) && !t.includes('DRAFT')) return 'Bill of Entry';
  if (t === 'CRO' || t.includes('CARGO_RELEASE')) return 'Cargo Release Order';
  if (t.includes('CUSTOMS_RELEASE') || t.includes('US_CUSTOMS')) return 'Customs Release';
  if (t === 'CH' || t.includes('CHA_BILL')) return 'CHA Bill';
  if (t.includes('DELIVERY_ORDER')) return 'Delivery Order';
  if (t === 'GR' || t.includes('GRN') || t.includes('GOODS_RECEIPT')) return 'Goods Receipt Note';
  if (t.includes('OUTWARD') || t === 'OP') return 'Outward Packing List';
  if (t.includes('POD') || t.includes('PROOF_OF_DELIVERY')) return 'Proof of Delivery';
  return dt;
}

// Derive 6-phase JourneyBar from currentStage (1–10+)
function deriveJourneyPhases(stage: number): JourneyPhase[] {
  const phase = (n: number, name: string, doneThreshold: number, loc?: string): JourneyPhase => {
    const phaseStatus: 'done' | 'current' | 'future' =
      stage >= doneThreshold ? 'done' :
      stage >= (n === 1 ? 1 : [0, 1, 3, 5, 6, 7, 9][n - 1]) ? 'current' :
      'future';
    return { phaseNumber: n, phaseName: name, phaseLocation: loc, phaseStatus, occurredAt: '' };
  };
  return [
    phase(1, 'Booked',        3),
    phase(2, 'Departed India', 5),
    phase(3, 'Ocean transit', 6, 'Pacific'),
    phase(4, 'US port',       7),
    phase(5, 'Customs',       9),
    phase(6, 'Delivered',     11),
  ];
}

// Format currency with symbol
function fmtAmount(amount: string | number, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${currency} —`;
  if (currency === 'INR') return `₹${num.toLocaleString('en-IN')}`;
  if (currency === 'USD') return `$${num.toLocaleString('en-US')}`;
  return `${currency} ${num.toLocaleString()}`;
}

// ─── Dot component ───────────────────────────────────────────────────────────

type MilestoneState = 'done' | 'current' | 'future';

function TimelineDot({ state }: { state: MilestoneState }) {
  const base: React.CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: '50%',
    flexShrink: 0,
    zIndex: 1,
    position: 'relative',
  };

  if (state === 'done') {
    return (
      <div style={{
        ...base,
        backgroundColor: 'hsl(var(--vs-success))',
        boxShadow: '0 0 0 3px hsl(var(--card))',
      }} />
    );
  }
  if (state === 'current') {
    return (
      <div style={{
        ...base,
        backgroundColor: 'hsl(var(--vs-teal))',
        boxShadow: '0 0 0 3px hsl(var(--card)), 0 0 0 6px hsla(173,58%,39%,0.2)',
      }} />
    );
  }
  return (
    <div style={{
      ...base,
      backgroundColor: 'hsl(220 14% 85%)',
      boxShadow: '0 0 0 3px hsl(var(--card))',
    }} />
  );
}

// ─── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        backgroundColor: 'hsl(var(--card))',
        borderRadius: 12,
        padding: 24,
        boxShadow: 'var(--vs-shadow-card)',
        border: '1px solid hsl(var(--card-border))',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Card header ──────────────────────────────────────────────────────────────

function CardHeader({ title, count }: { title: string; count: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>{title}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {count}
      </span>
    </div>
  );
}

// ─── Outline button ───────────────────────────────────────────────────────────

function OutlineBtn({ label }: { label: string }) {
  return (
    <button
      style={{
        padding: '7px 14px',
        borderRadius: 8,
        border: '1px solid hsl(var(--border))',
        background: 'hsl(var(--card))',
        color: 'hsl(var(--foreground))',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ width = 200 }: { width?: number }) {
  return (
    <div style={{
      height: 12, width, borderRadius: 4,
      backgroundColor: 'hsl(var(--muted) / 0.4)',
      animation: 'pulse 1.5s ease-in-out infinite',
    }} />
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id ?? '';
  const [, navigate] = useLocation();

  const [shipment, setShipment] = useState<ApiShipment | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // Live document-event counter on top of API doc count
  const seenDocIds = useRef(new Set<string>());
  const [liveDocDelta, setLiveDocDelta] = useState(0);
  const lastEvent = useDocumentEvents();

  useEffect(() => {
    if (!shipmentId) return;
    const token = getAuthToken();
    setLoading(true);
    setError(null);
    fetch(`/api/shipments/${shipmentId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(json => setShipment(json.data))
      .catch(err => {
        console.error('[ShipmentDetailPage] fetch error:', err);
        setError('Could not load shipment.');
      })
      .finally(() => setLoading(false));
  }, [shipmentId]);

  useEffect(() => {
    if (!lastEvent || !shipment) return;
    if (
      lastEvent.type === 'status_changed' &&
      lastEvent.status?.toUpperCase() === 'EXTRACTED' &&
      lastEvent.shipmentId === shipmentId
    ) {
      if (!seenDocIds.current.has(lastEvent.documentId)) {
        seenDocIds.current.add(lastEvent.documentId);
        setLiveDocDelta(prev => prev + 1);
      }
    }
  }, [lastEvent, shipmentId, shipment]);

  // ─── Derived display data ──────────────────────────────────────────────────

  const docs = shipment?.documents ?? [];
  const containers = shipment?.containers ?? [];
  const milestones = shipment?.milestones ?? [];
  const tickets = shipment?.tickets ?? [];
  const inventoryItems = shipment?.inventoryItems ?? [];

  // Document stats
  const docsValidated = docs.filter(d => d.approvedAt).length + liveDocDelta;
  const docsTotal = docs.length;
  const usSidePending = docs.filter(d => {
    const t = d.documentType.toUpperCase();
    return (t === 'ISF' || t.includes('BILL_OF_ENTRY') || t.includes('CARGO_RELEASE') || t.includes('US_CUSTOMS'))
      && !d.approvedAt;
  }).length;

  // Inventory stats
  const totalBundles = inventoryItems.reduce((acc, i) => acc + (i.bundleCount ?? i.quantity ?? 0), 0);
  const totalWeightKg = inventoryItems.reduce((acc, i) => acc + parseFloat(String(i.netWeightKg ?? 0)), 0);
  const containerCount = containers.length;
  const containerSize = containers[0]?.containerSize ?? '—';

  // JourneyBar phases derived from API stage
  const journeyPhases: JourneyPhase[] = shipment
    ? deriveJourneyPhases(shipment.currentStage)
    : [1,2,3,4,5,6].map(n => ({ phaseNumber: n, phaseName: ['Booked','Departed India','Ocean transit','US port','Customs','Delivered'][n-1], phaseStatus: 'future' as const, occurredAt: '' }));

  // Status chips data derived from API
  const chipsData: ShipmentStatusChipsData = {
    loadMode:         shipment?.loadMode ?? 'FCL',
    containerCount,
    containerSize,
    nextGateLocation: shipment?.portOfDischarge ?? '—',
    nextGateDate:     '—',
    daysAtSea:        0,
    departureName:    shipment?.portOfLoading ?? 'India',
    docsValidated,
    docsTotal,
    usSidePending,
    tradeLane:        `${shipment?.portOfLoading ?? 'IN'} → ${shipment?.portOfDischarge ?? 'US'}`,
    incoterm:         shipment?.incoterm ?? '—',
    incotermPort:     shipment?.incotermPort ?? shipment?.portOfLoading ?? '—',
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 28, minHeight: '100%' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>

      {/* ── Section 1: Breadcrumb + Title ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'hsl(var(--primary))', fontWeight: 500, fontSize: 13 }}
          >
            Shipments
          </button>
          <span>/</span>
          <span className="vs-mono">{shipment?.shipmentNumber ?? shipmentId}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <h2 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.15 }}>
                {loading ? 'Loading…' : (shipment?.shipmentNumber ?? shipmentId)}
              </h2>
              {shipment && (
                <StatusPill status={shipment.currentStageName ?? 'In progress'} variant="transit" />
              )}
              {shipment?.blockedReason && (
                <StatusPill status="Blocked" variant="danger" />
              )}
            </div>

            {shipment && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px', fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
                {shipment.blNumber && (
                  <>
                    <span>BOL: <span className="vs-mono" style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>{shipment.blNumber}</span></span>
                    <span style={{ color: 'hsl(var(--border))' }}>·</span>
                  </>
                )}
                {shipment.vesselName && (
                  <>
                    <span>Vessel: <span className="vs-mono" style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>{shipment.vesselName}</span></span>
                    <span style={{ color: 'hsl(var(--border))' }}>·</span>
                  </>
                )}
                {(shipment.portOfLoading || shipment.portOfDischarge) && (
                  <span>Route: <span className="vs-mono" style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                    {shipment.portOfLoading ?? '—'} → {shipment.portOfDischarge ?? '—'}
                  </span></span>
                )}
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, color: 'hsl(var(--vs-danger))' }}>
                <AlertCircle size={15} />
                <span style={{ fontSize: 13 }}>{error}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <OutlineBtn label="Timeline" />
            <OutlineBtn label="Export report" />
            <OutlineBtn label="Share" />
          </div>
        </div>
      </div>

      {/* ── Journey Bar: 6-phase horizontal progress ── */}
      <JourneyBar phases={journeyPhases} />

      {/* ── Status chips ── */}
      <ShipmentStatusChips data={chipsData} />

      {/* ── Section 2: Top grid — Inventory Journey + Documents ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, marginBottom: 20 }} className="detail-grid">

        {/* LEFT: Inventory Journey (milestones from API, or static if empty) */}
        <Card>
          <CardHeader
            title="Inventory journey"
            count={milestones.length > 0 ? `${milestones.length} milestones` : 'Journey timeline'}
          />

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[1,2,3].map(i => <SkeletonRow key={i} width={240} />)}
            </div>
          ) : milestones.length > 0 ? (
            <div style={{ position: 'relative' }}>
              {milestones.map((m, i) => {
                const isLast = i === milestones.length - 1;
                const date = new Date(m.occurredAt);
                const dateLabel = date > new Date() ? 'Future' :
                  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                // First milestones are done, the last is current if shipment not delivered
                const stateRaw: MilestoneState = i < milestones.length - 1 ? 'done' : 'current';
                const state: MilestoneState = (shipment?.currentStage ?? 0) >= 10 ? 'done' : stateRaw;
                return (
                  <div key={m.id} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 16 }}>
                      <TimelineDot state={state} />
                      {!isLast && <div style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: 'hsl(var(--border))' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: state === 'current' ? 600 : 500, color: 'hsl(var(--foreground))', lineHeight: 1.3 }}>
                        {m.milestone}
                      </div>
                      {(() => {
                        const sub = m.eventData && typeof m.eventData === 'object'
                          ? String((m.eventData as Record<string, unknown>)['subtitle'] ?? '')
                          : '';
                        return sub ? (
                          <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 2, lineHeight: 1.4 }}>
                            {sub}
                          </div>
                        ) : null;
                      })()}
                    </div>
                    <div className="vs-mono" style={{ fontSize: 11, color: state === 'current' ? 'hsl(var(--vs-teal))' : 'hsl(var(--muted-foreground))', fontWeight: state === 'current' ? 600 : 400, flexShrink: 0, paddingTop: 1 }}>
                      {dateLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // No milestones — show journey phases as fallback
            <div style={{ position: 'relative' }}>
              {journeyPhases.map((phase, i) => {
                const isLast = i === journeyPhases.length - 1;
                const state: MilestoneState = phase.phaseStatus === 'done' ? 'done' : phase.phaseStatus === 'current' ? 'current' : 'future';
                return (
                  <div key={phase.phaseNumber} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 16 }}>
                      <TimelineDot state={state} />
                      {!isLast && <div style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: 'hsl(var(--border))' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: state === 'current' ? 600 : 500, color: state === 'future' ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))' }}>
                        {phase.phaseName}
                        {phase.phaseLocation && <span style={{ fontWeight: 400, color: 'hsl(var(--muted-foreground))' }}> · {phase.phaseLocation}</span>}
                      </div>
                    </div>
                    <div className="vs-mono" style={{ fontSize: 11, color: state === 'current' ? 'hsl(var(--vs-teal))' : 'hsl(var(--muted-foreground))', fontWeight: state === 'current' ? 600 : 400, flexShrink: 0 }}>
                      {state === 'done' ? '✓' : state === 'current' ? 'Now' : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, borderTop: '1px solid hsl(var(--border))', paddingTop: 20, marginTop: 20 }}>
            {[
              { label: 'Bundles',    value: totalBundles > 0 ? String(totalBundles) : '—' },
              { label: 'Containers', value: containerCount > 0 ? String(containerCount) : '—' },
              { label: 'Gross kg',   value: totalWeightKg > 0 ? `${(totalWeightKg / 1000).toFixed(1)}K` : '—' },
            ].map(s => (
              <div key={s.label}>
                <div className="vs-mono" style={{ fontSize: 22, fontWeight: 600, color: 'hsl(var(--foreground))', lineHeight: 1 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* RIGHT: Documents from API */}
        <Card>
          <CardHeader
            title="Documents"
            count={docsTotal > 0 ? `${docsValidated} of ${docsTotal} complete` : 'No documents yet'}
          />

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3,4].map(i => <SkeletonRow key={i} width={280} />)}
            </div>
          ) : docs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>No documents uploaded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {docs.map((doc) => {
                const validated = !!doc.approvedAt;
                const code = docTypeCode(doc.documentType);
                const name = docTypeLabel(doc.documentType);
                const number = doc.documentNumber ?? '—';
                return (
                  <div
                    key={doc.id}
                    onClick={() => navigate(`/documents/${doc.id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                      transition: 'background 0.12s ease, transform 0.12s ease',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.background = 'hsl(var(--muted))';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <DocBadge code={code} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'hsl(var(--foreground))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name}
                        </div>
                        <div className="vs-mono" style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                          {number}
                        </div>
                      </div>
                    </div>
                    <StatusPill status={validated ? 'Validated' : 'Pending'} variant={validated ? 'validated' : 'pending'} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Section 3: Bottom grid — Containers + Accounting Tickets ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, marginBottom: 20 }} className="detail-grid">

        {/* LEFT: Containers from API */}
        <Card>
          <CardHeader
            title="Containers"
            count={containerCount > 0 ? `${containerCount} × ${containerSize || 'container'}` : 'No containers'}
          />

          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[1,2].map(i => <SkeletonRow key={i} width={160} />)}
            </div>
          ) : containers.length === 0 ? (
            <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>No containers linked yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {containers.map((c) => (
                <div
                  key={c.id}
                  style={{
                    backgroundColor: 'hsl(var(--background))',
                    borderRadius: 10, padding: 14,
                    borderLeft: '3px solid hsl(var(--vs-teal))',
                  }}
                >
                  <div className="vs-mono" style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: 6 }}>
                    {c.containerNumber}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[c.containerSize, c.containerType].filter(Boolean).map((m, idx) => (
                      <span key={idx} className="vs-mono" style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* RIGHT: Accounting Tickets from API */}
        <Card>
          <CardHeader
            title="Accounting tickets"
            count={tickets.length > 0
              ? `${tickets.filter(t => t.status === 'posted').length} posted · ${tickets.filter(t => t.status === 'pending').length} pending`
              : 'No tickets'}
          />

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2].map(i => <SkeletonRow key={i} width={280} />)}
            </div>
          ) : tickets.length === 0 ? (
            <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>No accounting tickets yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tickets.map((t) => {
                const isPending = t.status !== 'posted';
                const sub = t.erpVoucherNumber
                  ? `${t.postedAt ? `Posted ${new Date(t.postedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ` : ''}${t.erpVoucherNumber}`
                  : t.vendorName ?? t.entryType;
                return (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '10px 12px', borderRadius: 8,
                      ...(isPending ? {
                        backgroundColor: 'hsla(38,92%,50%,0.08)',
                        borderLeft: '3px solid hsl(var(--vs-warning))',
                      } : {}),
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: isPending ? 'hsl(38 92% 38%)' : 'hsl(var(--foreground))', lineHeight: 1.3 }}>
                        {t.entryType.replace(/_/g, ' ')}
                      </div>
                      <div className="vs-mono" style={{ fontSize: 11, color: isPending ? 'hsl(38 92% 38%)' : 'hsl(var(--muted-foreground))', marginTop: 2, opacity: isPending ? 0.8 : 1 }}>
                        {sub}
                      </div>
                    </div>
                    <div className="vs-mono" style={{ fontSize: 14, fontWeight: 600, color: isPending ? 'hsl(38 92% 38%)' : 'hsl(var(--foreground))', flexShrink: 0 }}>
                      {fmtAmount(t.amount, t.currency)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Section 4: Cost summary placeholder ── */}
      <Card style={{ borderStyle: 'dashed', opacity: 0.6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>
          Shipment cost summary — coming soon
        </div>
      </Card>

    </div>
  );
}
