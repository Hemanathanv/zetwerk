import { useParams, useLocation, Link } from 'wouter';
import { useEffect, useState, useCallback, useRef, Fragment, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUpload } from '@/contexts/UploadContext';
import { StatusPill } from '@/components/vs';
import { apiGet, apiPost, apiPut, getAuthToken } from '@/lib/api';
import { useShipmentDocuments, useAccountingTickets } from '@/hooks/useOperationalData';
import { RequireActivity } from '@/components/PermissionGate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle, Check, ChevronDown, ChevronRight,
  SkipForward, RotateCcw, PauseCircle, XCircle, PlayCircle,
  Package, Users, CreditCard, FileText, Navigation, Truck,
  FolderOpen, AlertTriangle, Lock, MapPin, CheckCircle2,
  Anchor, Clock, Box, Calculator,
} from 'lucide-react';
import { useSafeCubeTracking } from '@/hooks/useSafeCubeTracking';
import type { SafeCubeData, SafeCubeEvent } from '@/hooks/useSafeCubeTracking';
import { SafeCubeLivePanel, SafeCubeTimeline, SafeCubeAlerts } from '@/components/SafeCubePanel';
import VesselRouteMap from '@/components/VesselRouteMap';
import { adaptSafeCubeToMapProps } from '@/utils/safeCubeMapAdapter';
import {
  DOCUMENT_EXPECTED_DOCS_BY_GATE,
  DOCUMENT_GATE_LABELS,
  DOCUMENT_PARALLEL_DOC_TYPES,
  documentGateDocDef,
} from '@/config/documentGateConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiPartnerTag {
  id: string; tagSource: string;
  partner: { id: string; companyName: string; partnerType: string; contactName: string | null; contactEmail: string; contactPhone: string | null };
}
interface ApiShipment {
  id: string; shipmentNumber: string; status: string;
  eta?: string | null;
  shipmentType?: string | null;
  currentStage: number; currentStageName?: string | null;
  blockedReason?: string | null;
  vesselName?: string | null; portOfLoading?: string | null; portOfDischarge?: string | null;
  exporterName?: string | null; buyerName?: string | null;
  blNumber?: string | null; loadMode?: string | null; incoterm?: string | null; incotermPort?: string | null;
  template?: { id: string; name: string } | null;
  documents: { id: string; documentType: string; ocrStatus: string; approvedAt?: string | null; documentNumber?: string | null; isGenerated?: boolean }[];
  containers: { id: string; containerNumber: string; containerSize?: string | null; containerType?: string | null; grossWeightKg?: number | null }[];
  tickets: { id: string; ticketNumber: string; entryType: string; amount: string | number; currency: string; status: string; vendorName?: string | null; erpVoucherNumber?: string | null; postedAt?: string | null }[];
  inventoryItems: { bundleCount?: number | null; netWeightKg?: string | number | null }[];
  dndAlerts: { id: string; containerNumber: string; lfd?: string | null; status: string; demurrageTotal?: number | null; detentionTotal?: number | null; totalCharge?: number | null }[];
  partnerTags?: ApiPartnerTag[];
  packingListItems?: { id: string; productCode?: string | null; productDescription?: string | null; productSpecification?: string | null; hsnCode?: string | null; noOfBundles?: string | null; totalQtyInPcs?: string | null; netWeightKgs?: string | null; grossWeightKgs?: string | null }[];
}
interface ApiDocTypeGate { id: string; docType: string; roleInGate?: string | null; isGenerated?: boolean; mandatoryPhoto?: boolean; sortOrder?: number | null }
interface ApiGate {
  id: string; gateConfigId: string; status: 'OPEN' | 'PASSED' | 'SKIPPED' | 'FAILED' | string;
  passedAt?: string | null; skippedAt?: string | null; failureReason?: string | null;
  gateConfig: { id: string; gateNumber: number; gateName: string; gateLabel?: string | null; geography?: string | null; docTypeGates: ApiDocTypeGate[]; roleAssignments: { role: { id: string; name: string; color?: string | null } }[] };
}
interface ApiMilestoneTracking {
  id: string; milestoneNumber: number; status: string;
  completedAt?: string | null; notes?: string | null;
  completedByName?: string | null;
  milestoneConfig?: { id: string; gateConfigId?: string | null; name: string; type?: string | null; systemCode?: string | null; completionMode?: string | null } | null;
}

const SHIPMENT_GATE_LABELS = DOCUMENT_GATE_LABELS;
const SHIPMENT_EXPECTED_DOCS_BY_GATE = DOCUMENT_EXPECTED_DOCS_BY_GATE;

// ─── Color tokens ─────────────────────────────────────────────────────────────
const TEAL  = 'hsl(var(--vs-teal))';
const GREEN = 'hsl(var(--vs-success))';
const AMBER = 'hsl(38 92% 50%)';
const FG    = 'hsl(var(--foreground))';
const MUTED = 'hsl(var(--muted-foreground))';
const BDR   = 'hsl(var(--border))';

// ─── Route constants ──────────────────────────────────────────────────────────
const PROJECTS_LIST_ROUTE        = '/projects';
const PROJECT_DETAIL_ROUTE       = (id: string) => `/projects/${id}`;
const SHIPMENT_ROUTE             = (id: string) => `/shipments/${id}`;
const PROJECT_CTX_KEY            = 'fromProject';

// ─── Project context types ────────────────────────────────────────────────────
interface ProjectCtx {
  projectId:     string;
  projectRef:    string;
  projectName:   string | null;
  projectStatus: string;
  shipmentIds:   string[];
  shipmentIndex: number;
}

function getProjectStatusStyle(status: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    ACTIVE:    { background: 'hsl(var(--vs-teal) / 0.15)', color: TEAL },
    PLANNED:   { background: 'hsl(217 91% 50% / 0.12)',    color: 'hsl(217 91% 60%)' },
    ON_HOLD:   { background: 'hsl(38 92% 50% / 0.15)',     color: AMBER },
    COMPLETED: { background: 'hsl(145 63% 42% / 0.15)',    color: 'hsl(145 63% 38%)' },
    CLOSED:    { background: 'hsl(var(--muted))',           color: MUTED },
  };
  return map[status] ?? { background: 'hsl(var(--muted))', color: MUTED };
}
const CARD  = 'hsl(var(--card))';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dtShort(dt: string): string {
  const t = dt.toUpperCase();
  const canonical = documentGateDocDef(t);
  if (canonical) return canonical.code;
  if (t === 'US_PACKING_LIST' || t.includes('US_PACKING')) return 'UP';
  if (t === 'US_SALES_INVOICE' || t.includes('US_SALES')) return 'UI';
  if (t.includes('SALES_INVOICE') || t === 'SI') return 'SI';
  if (t.includes('PACKING_LIST') && !t.includes('OUTWARD')) return 'PL';
  if (t.includes('SHIPPING_BILL') || t === 'SB') return 'SB';
  if (t.includes('BILL_OF_LADING') || t === 'BOL' || t === 'BL') return 'BL';
  if (t.includes('ENTRY_SUMMARY_DRAFT') || t.includes('DRAFT')) return 'DR';
  if (t.includes('ENTRY_SUMMARY_TARIFF')) return 'TL';
  if (t === 'ENTRY_SUMMARY' || t.includes('BILL_OF_ENTRY') || t.includes('CBP_FORM_7501') || t === 'BOE') return 'CBP';
  if (t.includes('IMPORTER_SECURITY') || t === 'ISF') return 'IS';
  if (t.includes('US_CUSTOMS_RELEASE')) return 'CU';
  if (t.includes('CARGO_RELEASE') || t === 'CRO') return 'CR';
  if (t.includes('DELIVERY_ORDER')) return 'DO';
  if (t.includes('PROOF_OF_DELIVERY') || t.includes('POD')) return 'PD';
  if (t.includes('OCEAN_FREIGHT')) return 'OF';
  if (t.includes('CUSTOMER_BROKER') || t.includes('CUSTOMS_BROKER')) return 'BB';
  if (t.includes('FREIGHT_FORWARDER')) return 'FR';
  if (t.includes('GRN_INBOUND')) return 'GR';
  if (t.includes('PORT_TO_WH')) return 'PO';
  if (t.includes('WH_TO_CUSTOMER')) return 'WH';
  if (t.includes('OUTWARD')) return 'OP';
  if (t.includes('METAL_CONTENT')) return 'MC';
  if (t.includes('DEDUCTION')) return 'DD';
  if (t.includes('CHA')) return 'CH';
  return dt.slice(0, 2).toUpperCase();
}
function docLabel(dt: string): string {
  const t = dt.toUpperCase();
  const canonical = documentGateDocDef(t);
  if (canonical) return canonical.label;
  if (t === 'US_PACKING_LIST' || t.includes('US_PACKING')) return 'US Packing List';
  if (t === 'US_SALES_INVOICE' || t.includes('US_SALES')) return 'US Sales Invoice';
  if (t.includes('SALES_INVOICE')) return 'Sales Invoice';
  if (t.includes('PACKING_LIST') && !t.includes('OUTWARD')) return 'Packing List';
  if (t.includes('SHIPPING_BILL')) return 'Shipping Bill';
  if (t.includes('BILL_OF_LADING')) return 'Bill of Lading';
  if (t.includes('ENTRY_SUMMARY_DRAFT') || t.includes('DRAFT')) return 'Draft CBP FORM 7501';
  if (t.includes('ENTRY_SUMMARY_TARIFF')) return 'CBP FORM 7501 Tariff Lines';
  if (t === 'ENTRY_SUMMARY' || t.includes('BILL_OF_ENTRY') || t.includes('CBP_FORM_7501') || t === 'BOE') return 'CBP FORM 7501';
  if (t.includes('IMPORTER_SECURITY') || t === 'ISF') return 'ISF Filing';
  if (t.includes('US_CUSTOMS_RELEASE')) return 'US Customs Release Order';
  if (t.includes('CARGO_RELEASE')) return 'Cargo Release';
  if (t.includes('DELIVERY_ORDER')) return 'Delivery Order';
  if (t.includes('PROOF_OF_DELIVERY')) return 'Proof of Delivery';
  if (t.includes('OCEAN_FREIGHT')) return 'Ocean Freight Invoice';
  if (t.includes('CUSTOMER_BROKER') || t.includes('CUSTOMS_BROKER')) return 'US Customs Broker Bill';
  if (t.includes('FREIGHT_FORWARDER')) return 'Freight Forwarder Bill';
  if (t.includes('GRN_INBOUND')) return 'GRN Inbound';
  if (t.includes('PORT_TO_WH')) return 'Port To WH';
  if (t.includes('WH_TO_CUSTOMER')) return 'WH To Customer';
  if (t.includes('OUTWARD')) return 'Outward Packing List';
  if (t.includes('METAL_CONTENT')) return 'Metal Content Sheet';
  if (t.includes('DEDUCTION')) return 'Deduction Certificate';
  if (t.includes('CHA')) return 'CHA Bill';
  return dt.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function readExtractedString(value: unknown, targetKeys: string[]): string | null {
  const normalizedTargets = new Set(targetKeys.map(key => key.toLowerCase()));
  let match: string | null = null;

  function visit(node: unknown, key = ''): void {
    if (match) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, key));
      return;
    }
    if (node && typeof node === 'object') {
      Object.entries(node as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
      return;
    }
    if (!key || !normalizedTargets.has(key.toLowerCase())) return;
    if (typeof node === 'string' && node.trim()) match = node.trim();
    if (typeof node === 'number') match = String(node);
  }

  visit(value);
  return match;
}
function bolCarrierNameFromDocuments(documents: any[]): string | null {
  const bolDocument = documents.find(document => {
    const type = String(document?.documentType ?? '').toUpperCase();
    return type === 'BOL' || type === 'BL' || type.includes('BILL_OF_LADING');
  });
  if (!bolDocument) return null;
  return readExtractedString(
    bolDocument.extractedData,
    ['carrierCompanyName', 'carrierName', 'vesselCarrierName'],
  );
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return '—'; }
}
function fmtDateFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); } catch { return '—'; }
}
function fmtAmount(amount: string | number, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${currency} —`;
  if (currency === 'INR') return `₹${num.toLocaleString('en-IN')}`;
  if (currency === 'USD') return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  return `${currency} ${num.toLocaleString()}`;
}
function gateStatusColor(s: string) { return s === 'PASSED' ? GREEN : s === 'FAILED' ? 'hsl(var(--vs-danger))' : s === 'SKIPPED' ? MUTED : TEAL; }
function gateStatusBg(s: string) { return s === 'PASSED' ? 'hsla(142,71%,45%,0.08)' : s === 'FAILED' ? 'hsla(0,72%,51%,0.08)' : s === 'SKIPPED' ? 'hsl(var(--muted)/0.4)' : 'hsla(173,58%,39%,0.06)'; }

// ─── Container view state machine ─────────────────────────────────────────────
type ContainerViewState = 'early' | 'preview' | 'approaching' | 'active';

// Helper: last milestone by milestoneNumber within a specific gate (by gateConfigId).
// Returns undefined when the gate has no linked milestones or none are found.
function lastMilestoneOfGate(milestones: ApiMilestoneTracking[], gateConfigId: string): ApiMilestoneTracking | undefined {
  return milestones
    .filter(m => m.milestoneConfig?.gateConfigId === gateConfigId)
    .sort((a, b) => a.milestoneNumber - b.milestoneNumber)
    .at(-1);
}

function containerViewState(
  scData: SafeCubeData | null,
  milestones: ApiMilestoneTracking[],
  shipment: ApiShipment | null,
  gates: ApiGate[],
): ContainerViewState {
  // SafeCube live data takes priority when available
  if (scData) {
    if (scData.podAt) return 'active';
    const eta = scData.podPredictiveEta ? new Date(scData.podPredictiveEta) : null;
    const days = eta ? (eta.getTime() - Date.now()) / 86400000 : null;
    if (days !== null && days <= 5)  return 'approaching';
    if (days !== null && days <= 10) return 'preview';
    return 'early';
  }
  // No SafeCube: check milestone completion using order-within-gate semantics.
  // Vessel arrival = the first milestone (entry slot) of the first US-geography gate is COMPLETED.
  // "First milestone within first US gate" is the structural slot that begins when the vessel
  // reaches the US port; no US-side activity can complete before arrival.
  // Degrades to ETA/stage heuristics when gate/milestone data is absent.
  const usGatesSorted = [...gates]
    .filter(g => g.gateConfig.geography === 'US')
    .sort((a, b) => a.gateConfig.gateNumber - b.gateConfig.gateNumber);
  const firstUsGate = usGatesSorted[0];
  if (firstUsGate) {
    const entryMs = milestones
      .filter(m => m.milestoneConfig?.gateConfigId === firstUsGate.gateConfigId)
      .sort((a, b) => a.milestoneNumber - b.milestoneNumber)[0];
    if (entryMs?.status === 'COMPLETED' && entryMs.completedAt) return 'active';
  }
  // ETA-based fallback (defensive: invalid/missing ETA treated as no ETA)
  const etaDate = shipment?.eta ? new Date(shipment.eta) : null;
  if (etaDate && !isNaN(etaDate.getTime())) {
    const daysToEta = (etaDate.getTime() - Date.now()) / 86400000;
    if (daysToEta <= 0) return 'active';
    if (daysToEta <= 5) return 'approaching';
  }
  // Stage-based fallback — containers become visible as shipment progresses
  // gate 3 = US Port Entry (stages 5-6), gate 4 = 3PL (stages 7-8), gate 5 = delivery (9-10)
  const stage = shipment?.currentStage ?? 0;
  if (stage >= 7) return 'active';
  if (stage >= 5) return 'approaching';
  if (stage >= 3) return 'preview';
  return 'early';
}

// ─── Voyage steps derivation ──────────────────────────────────────────────────
type StepState = 'done' | 'active' | 'upcoming';
interface VoyageStep { label: string; sublabel?: string; date?: string | null; isEst?: boolean; state: StepState }

function deriveVoyageSteps(scData: SafeCubeData | null, gates: ApiGate[], shipment: ApiShipment | null): VoyageStep[] {
  if (scData) {
    const polDone = !!scData.polAt;
    const podDone = !!scData.podAt;
    const postDone = !!scData.postpodAt;
    const inTransit = polDone && !podDone;
    return [
      { label: 'Booked', sublabel: scData.prepodName ?? shipment?.portOfLoading ?? undefined, state: 'done', date: scData.prepodAt },
      { label: `Departed ${scData.polName ?? scData.polLocode ?? shipment?.portOfLoading ?? 'Origin'}`, state: polDone ? 'done' : 'upcoming', date: scData.polAt ?? scData.polPredictiveEta, isEst: !polDone && !!scData.polPredictiveEta },
      { label: 'Ocean transit', sublabel: inTransit ? (scData.currentLocationName ?? undefined) : undefined, state: inTransit ? 'active' : (podDone ? 'done' : 'upcoming') },
      { label: scData.podName ?? scData.podLocode ?? shipment?.portOfDischarge ?? 'Destination', state: podDone ? 'done' : 'upcoming', date: scData.podAt ?? scData.podPredictiveEta, isEst: !podDone && !!scData.podPredictiveEta },
      { label: 'Customs', state: postDone ? 'done' : (podDone ? 'active' : 'upcoming'), date: scData.postpodAt ?? undefined },
      { label: 'Delivered', sublabel: scData.postpodName ?? scData.postpodLocode ?? undefined, state: postDone ? 'done' : 'upcoming', date: scData.postpodAt ?? scData.postpodPredictiveEta, isEst: !postDone && !!scData.postpodPredictiveEta },
    ];
  }
  const gbt = (t: string) => gates.find(g => g.gateConfig.gateName.toLowerCase().includes(t));
  const indiaG = gbt('india') ?? gbt('exit') ?? gbt('loading') ?? gates[1];
  const usG    = gbt('us entry') ?? gbt('entry') ?? gbt('discharge') ?? gates[2];
  const custG  = gbt('custom') ?? gbt('3pl') ?? gates[3];
  const delG   = gbt('deliver') ?? gates[gates.length - 1];
  const gs     = (g?: ApiGate): StepState => !g ? 'upcoming' : g.status === 'PASSED' ? 'done' : g.status === 'OPEN' ? 'active' : 'upcoming';
  const inT    = indiaG?.status === 'PASSED' && usG?.status !== 'PASSED';
  return [
    { label: 'Booked', state: 'done' },
    { label: `Departed ${shipment?.portOfLoading ?? 'India'}`, state: gs(indiaG), date: indiaG?.passedAt },
    { label: 'Ocean transit', sublabel: inT ? 'Vessel in transit' : undefined, state: inT ? 'active' : (usG?.status === 'PASSED' ? 'done' : 'upcoming') },
    { label: shipment?.portOfDischarge ?? 'US Port', state: gs(usG), date: usG?.passedAt },
    { label: 'Customs', state: gs(custG), date: custG?.passedAt },
    { label: 'Delivered', state: gs(delG), date: delG?.passedAt },
  ];
}

// ─── Shared small components ──────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ backgroundColor: CARD, borderRadius: 8, padding: '20px 24px', boxShadow: 'var(--vs-shadow-card)', border: '1px solid hsl(var(--card-border))', ...style }}>{children}</div>;
}
function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: FG, letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 7 }}>{children}</div>
      {right && <div style={{ fontSize: 14.5, fontWeight: 600, color: MUTED }}>{right}</div>}
    </div>
  );
}
function SkeletonRow({ width = 200 }: { width?: number }) {
  return <div style={{ height: 12, width, borderRadius: 4, backgroundColor: 'hsl(var(--muted)/0.4)', animation: 'pulse 1.5s ease-in-out infinite' }} />;
}
function ActionBtn({ onClick, icon, label, variant = 'outline', disabled = false }: { onClick: () => void; icon?: React.ReactNode; label: string; variant?: 'outline' | 'danger' | 'success' | 'primary'; disabled?: boolean }) {
  const s: Record<string, React.CSSProperties> = {
    outline: { background: CARD, border: `1px solid ${BDR}`, color: FG },
    danger:  { background: 'hsla(0,72%,51%,0.1)', border: '1px solid hsla(0,72%,51%,0.3)', color: 'hsl(var(--vs-danger))' },
    success: { background: 'hsla(142,71%,45%,0.1)', border: '1px solid hsla(142,71%,45%,0.3)', color: 'hsl(142 71% 32%)' },
    primary: { background: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' },
  };
  return <button onClick={onClick} disabled={disabled} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, fontSize: 14.5, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', transition: 'opacity 0.12s', ...s[variant] }}>{icon}{label}</button>;
}

// ─── VoyageStepper helpers ────────────────────────────────────────────────────
const STEP = { DONE: 'done', ACTIVE: 'active', UPCOMING: 'upcoming' } as const;
const MAX_LABEL_CHARS = 14;
const ACTIVE_STATUS_LABEL = 'In progress';
const SCHEDULE_STATUS_COLOUR: Record<string, string> = {
  DELAYED: AMBER,
  ON_TIME: MUTED,
  EARLY:   GREEN,
};
function getConnectorVariant(curr: VoyageStep, next: VoyageStep): 'sailed' | 'active-to-next' | 'ahead' {
  if (curr.state === STEP.DONE && next.state === STEP.DONE) return 'sailed';
  if (curr.state === STEP.DONE && next.state === STEP.ACTIVE) return 'active-to-next';
  return 'ahead';
}

// ─── VoyageStepper ────────────────────────────────────────────────────────────
function VoyageStepper({ steps, eta, scheduleStatus }: {
  steps: VoyageStep[];
  eta?: string | null;
  scheduleStatus?: string | null;
}) {
  const N = steps.length;
  const etaValue      = eta ?? null;
  const schedColour   = scheduleStatus ? (SCHEDULE_STATUS_COLOUR[scheduleStatus] ?? MUTED) : MUTED;
  const schedLabel    = scheduleStatus === 'ON_TIME' ? 'On time'
                      : scheduleStatus === 'DELAYED' ? 'Delayed'
                      : (scheduleStatus ?? '');

  return (
    <Card style={{ padding: '18px 28px 14px', marginBottom: 12 }}>
      {/* ETA chip — only when data is available */}
      {etaValue && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 999, background: 'hsl(var(--muted)/0.45)', border: `1px solid ${BDR}`, fontSize: 14.5 }}>
            <span style={{ color: MUTED, fontWeight: 500 }}>ETA</span>
            <span style={{ color: FG, fontWeight: 700 }}>{fmtDate(etaValue)}</span>
            {scheduleStatus && (
              <span style={{ color: schedColour, fontWeight: 600, marginLeft: 1 }}>· {schedLabel}</span>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start' }}>
        {/* Per-segment connector lines (sailed / active-to-next / ahead-dashed) */}
        {steps.slice(0, -1).map((step, i) => {
          const variant  = getConnectorVariant(step, steps[i + 1]);
          const leftPct  = ((i + 0.5) / N) * 100;
          const widthPct = (1 / N) * 100;
          const base: React.CSSProperties = { position: 'absolute', top: 14, left: `${leftPct}%`, width: `${widthPct}%`, height: 2, zIndex: 0, borderRadius: 1 };
          if (variant === 'sailed')         return <div key={i} style={{ ...base, background: GREEN }} />;
          if (variant === 'active-to-next') return <div key={i} style={{ ...base, background: `linear-gradient(90deg, ${GREEN}, ${TEAL})` }} />;
          return <div key={i} style={{ ...base, backgroundImage: `repeating-linear-gradient(90deg, ${BDR} 0px, ${BDR} 4px, transparent 4px, transparent 8px)` }} />;
        })}

        {steps.map((step, i) => {
          const isDone   = step.state === STEP.DONE;
          const isActive = step.state === STEP.ACTIVE;

          const circleStyle: React.CSSProperties = isDone
            ? { background: GREEN, color: '#fff', border: 'none' }
            : isActive
            ? { background: TEAL,  color: '#fff', border: 'none' }
            : { background: 'transparent', border: `2px solid ${BDR}` };

          const shortLabel = step.label.length > MAX_LABEL_CHARS
            ? step.label.slice(0, MAX_LABEL_CHARS - 1) + '…'
            : step.label;

          const subLabel = isActive
            ? (step.sublabel ?? (step.date ? `${step.isEst ? 'Est. ' : ''}${fmtDate(step.date)}` : ACTIVE_STATUS_LABEL))
            : (step.date ? `${step.isEst ? 'Est. ' : ''}${fmtDate(step.date)}` : '');

          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 2 }}>
              {/* Pulse wrapper — active node only */}
              <div className={isActive ? 'milestone-active-pulse' : undefined} style={{ position: 'relative' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 700, transition: 'all 0.3s', ...circleStyle }}>
                  {isDone ? <Check size={13} /> : isActive ? i + 1 : null}
                </div>
              </div>
              {/* Label — truncated with native tooltip showing full name */}
              <div title={step.label} style={{ marginTop: 7, fontSize: 14.5, fontWeight: isActive ? 700 : 500, color: step.state === STEP.UPCOMING ? MUTED : FG, textAlign: 'center', lineHeight: 1.3, maxWidth: 90, width: '100%', overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                {shortLabel}
              </div>
              {/* Sub-label — date or status */}
              <div style={{ fontSize: 14, color: isActive ? TEAL : MUTED, marginTop: 2, textAlign: 'center', fontWeight: isActive ? 600 : 400 }}>
                {subLabel}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Context strip ────────────────────────────────────────────────────────────
function ContextStrip({ shipment, gates, scData, documents }: {
  shipment: ApiShipment | null; gates: ApiGate[];
  scData: SafeCubeData | null; documents: any[];
}) {
  if (!shipment) return null;
  const nextGate  = gates.find(g => g.status === 'OPEN');
  const atSeaDays = scData?.polAt && !scData?.podAt
    ? Math.floor((Date.now() - new Date(scData.polAt).getTime()) / 86400000) : null;
  const docsTotal    = documents.length || shipment.documents.length;
  const docsValidated = (documents.length ? documents : shipment.documents).filter(isCrossValidationPassed).length;
  const eta          = scData?.podPredictiveEta ?? scData?.podAt;
  const hasDelay     = scData && scData.delayDays != null && scData.delayDays > 0;
  const isOnTime     = scData && !hasDelay && (scData.delayDays === 0 || (scData.scheduleStatus ?? '').toLowerCase().includes('on time'));

  const chips = [
    shipment.loadMode && { icon: <Box size={11} />, text: `${shipment.loadMode}${shipment.containers[0]?.containerSize ? ` · ${shipment.containers[0].containerSize}` : ''}` },
    nextGate && { icon: <ChevronRight size={11} />, text: `Next: ${nextGate.gateConfig.gateLabel ?? nextGate.gateConfig.gateName}${eta ? ` · ${fmtDate(eta)}` : ''}` },
    atSeaDays !== null && { icon: <Anchor size={11} />, text: `~${atSeaDays}d at sea` },
    hasDelay && { icon: <Clock size={11} />, text: `${scData!.delayDays}d delay`, variant: 'delay' as const },
    isOnTime  && { icon: <Check size={11} />,  text: 'On Time',              variant: 'ontime' as const },
    docsTotal > 0 && { icon: <FileText size={11} />, text: `${docsValidated}/${docsTotal} docs validated` },
    (shipment.portOfLoading || shipment.portOfDischarge) && { icon: <Navigation size={11} />, text: `${shipment.portOfLoading ?? '—'} → ${shipment.portOfDischarge ?? '—'}${shipment.incoterm ? ` · ${shipment.incoterm}` : ''}` },
  ].filter(Boolean) as { icon: React.ReactNode; text: string; variant?: 'delay' | 'ontime' }[];

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
      {chips.map((chip, i) => {
        const isDelay  = chip.variant === 'delay';
        const isOnTime = chip.variant === 'ontime';
        return (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 500, padding: '4px 10px', borderRadius: 999,
            backgroundColor: isDelay ? 'hsla(38,92%,50%,0.12)' : isOnTime ? 'hsla(142,71%,45%,0.1)' : 'hsl(var(--muted)/0.5)',
            color:           isDelay ? AMBER : isOnTime ? GREEN : FG,
            border:          `1px solid ${isDelay ? 'hsl(38 92% 50% / 0.3)' : isOnTime ? 'hsla(142,71%,45%,0.3)' : BDR}`,
          }}>
            <span style={{ color: isDelay ? AMBER : isOnTime ? GREEN : MUTED }}>{chip.icon}</span>
            {chip.text}
          </span>
        );
      })}
    </div>
  );
}

// ─── Alerts Banner ────────────────────────────────────────────────────────────
function AlertsBanner({ scData }: { scData: SafeCubeData | null }) {
  const [showAll, setShowAll] = useState(false);
  if (!scData?.alerts?.length) return null;

  const active = scData.alerts.filter(a => a.isActive !== false && a.status !== 'RESOLVED');
  if (!active.length) return null;

  const sevOrder = (s: string | null) => s === 'HIGH' || s === 'CRITICAL' ? 0 : s === 'MEDIUM' ? 1 : 2;
  const sorted   = [...active].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity));
  const top      = sorted[0];
  const rest     = sorted.slice(1);

  const isHigh = top.severity === 'HIGH' || top.severity === 'CRITICAL';
  const isMed  = top.severity === 'MEDIUM';
  const mainColor = isHigh ? 'hsl(var(--vs-danger))' : isMed ? AMBER : MUTED;
  const mainBg    = isHigh ? 'hsla(0,72%,51%,0.06)'  : isMed ? 'hsla(38,92%,50%,0.08)' : 'hsl(var(--muted)/0.3)';
  const mainBdr   = isHigh ? 'hsl(var(--vs-danger)/0.25)' : isMed ? 'hsl(38 92% 50% / 0.25)' : BDR;
  const sevColor  = (s: string | null) =>
    s === 'HIGH' || s === 'CRITICAL' ? 'hsl(var(--vs-danger))' : s === 'MEDIUM' ? AMBER : MUTED;
  const catEmoji  = (cat: string | null) =>
    cat === 'WEATHER' ? '🌩' : cat === 'PORT' ? '⚓' : cat === 'CUSTOMS' ? '🛂' : cat === 'VESSEL' ? '🚢' : cat === 'DELAY' ? '⏱' : '⚠';

  return (
    <div style={{ backgroundColor: mainBg, border: `1px solid ${mainBdr}`, borderRadius: 8, padding: '10px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AlertTriangle size={14} color={mainColor} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: mainColor }}>
              {catEmoji(top.category)} {top.title ?? top.category ?? 'Tracking Alert'}
            </span>
            {rest.length > 0 && (
              <button onClick={() => setShowAll(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14.5, color: MUTED, padding: 0, whiteSpace: 'nowrap' }}>
                {showAll ? 'collapse' : `+${rest.length} more`}
              </button>
            )}
          </div>
          {top.description && (
            <div style={{ fontSize: 14.5, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>{top.description}</div>
          )}
          {top.locationName && (
            <div style={{ fontSize: 14.5, color: MUTED, marginTop: 2 }}>📍 {top.locationName}</div>
          )}
          {showAll && rest.map(a => (
            <div key={a.id} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BDR}` }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: sevColor(a.severity) }}>
                {catEmoji(a.category)} {a.title ?? a.category}
              </div>
              {a.description && <div style={{ fontSize: 14.5, color: MUTED, marginTop: 1 }}>{a.description}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Inventory Journey Panel ──────────────────────────────────────────────────
function InventoryJourneyPanel({ scData, milestones, shipment, inventoryItems, packingListItems = [] }: {
  scData: SafeCubeData | null; milestones: ApiMilestoneTracking[];
  shipment: ApiShipment | null; inventoryItems: ApiShipment['inventoryItems'];
  packingListItems?: PlItem[];
}) {
  type JItem = { id: string; date: string | null; label: string; sublabel?: string; isActual: boolean; isCurrent?: boolean };

  const apiJourneyItems = safeCubeInventoryJourneyItems(scData);
  const items: JItem[] = apiJourneyItems.length > 0
    ? apiJourneyItems
    : milestones
        .filter(m => m.status !== 'PENDING' || m.completedAt)
        .sort((a, b) => (a.milestoneNumber - b.milestoneNumber))
        .map(m => ({
          id: m.id, date: m.completedAt ?? null,
          label: m.milestoneConfig?.name ?? `Milestone ${m.milestoneNumber}`,
          sublabel: m.notes ?? undefined, isActual: !!m.completedAt,
        }));

  const invBundles = inventoryItems.reduce((a, i) => a + (i.bundleCount ?? 0), 0);
  const invKg      = inventoryItems.reduce((a, i) => a + parseFloat(String(i.netWeightKg ?? 0)), 0);
  // Fall back to packing list totals when inventory items have no data yet
  const plBundles  = packingListItems.reduce((a, i) => a + (parseInt(i.noOfBundles ?? '0') || 0), 0);
  const plGrossKg  = packingListItems.reduce((a, i) => a + (parseInt(i.grossWeightKgs ?? '0') || 0), 0);
  const totalBundles = invBundles > 0 ? invBundles : plBundles;
  const totalKg      = invKg      > 0 ? invKg      : plGrossKg;
  const containers   = shipment?.containers ?? [];

  return (
    <Card style={{ padding: '18px 20px', marginBottom: 16 }}>
      <SectionLabel right={<span style={{ fontSize: 14.5, color: MUTED }}>{items.length} MILESTONES</span>}>
        <Package size={12} style={{ display: 'inline', marginRight: 5 }} />Inventory Journey
      </SectionLabel>

      {items.length === 0 ? (
        <div style={{ fontSize: 14.5, color: MUTED, fontStyle: 'italic', padding: '8px 0' }}>No journey events yet.</div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Vertical line */}
          <div style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 2, background: BDR, borderRadius: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {items.map((item, idx) => {
              const isLast = idx === items.length - 1;
              const isPast = item.isActual && !item.isCurrent;
              const dotColor = item.isCurrent ? TEAL : isPast ? GREEN : MUTED;
              return (
                <div key={item.id} style={{ display: 'flex', gap: 12, paddingBottom: isLast ? 0 : 14, position: 'relative' }}>
                  <div style={{ flexShrink: 0, width: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 2 }}>
                    <div style={{
                      width: item.isCurrent ? 12 : 10, height: item.isCurrent ? 12 : 10,
                      borderRadius: '50%', flexShrink: 0,
                      background: item.isCurrent ? TEAL : isPast ? GREEN : 'hsl(var(--muted))',
                      border: item.isCurrent ? `2px solid ${TEAL}` : isPast ? `2px solid ${GREEN}` : `2px dashed ${MUTED}`,
                      boxShadow: item.isCurrent ? `0 0 0 3px hsl(var(--vs-teal)/0.15)` : 'none',
                      transition: 'all 0.2s',
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14.5, fontWeight: item.isCurrent ? 600 : 500, color: item.isCurrent ? FG : isPast ? FG : MUTED, lineHeight: 1.3 }}>
                        {item.label}
                      </span>
                      <span style={{ fontSize: 14.5, color: item.isCurrent ? TEAL : MUTED, fontWeight: item.isCurrent ? 600 : 400, flexShrink: 0 }}>
                        {item.isCurrent ? 'Now' : item.date ? fmtDate(item.date) : '—'}
                      </span>
                    </div>
                    {item.sublabel && (
                      <div style={{ fontSize: 14.5, color: MUTED, marginTop: 1 }}>{item.sublabel}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cargo summary KPIs */}
      {(totalBundles > 0 || containers.length > 0) && (
        <div style={{ display: 'flex', gap: 0, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${BDR}` }}>
          {[
            { val: totalBundles || '—', label: 'BUNDLES' },
            { val: containers.length || '—', label: 'CONTAINERS' },
            { val: totalKg > 0 ? `${(totalKg / 1000).toFixed(1)}t` : '—', label: 'GROSS WT' },
          ].map((k, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', borderRight: i < 2 ? `1px solid ${BDR}` : 'none' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: FG, fontFamily: 'var(--app-font-sans)' }}>{k.val}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: '0.08em', marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Container Grid Panel ─────────────────────────────────────────────────────
type PlItem = NonNullable<ApiShipment['packingListItems']>[0];

function safeCubeInventoryJourneyItems(scData: SafeCubeData | null): {
  id: string;
  date: string | null;
  label: string;
  sublabel?: string;
  isActual: boolean;
  isCurrent?: boolean;
}[] {
  if (!scData?.events?.length) return [];

  const groups = new Map<string, { event: SafeCubeEvent; containers: Set<string> }>();
  [...scData.events]
    .sort((a, b) => {
      const at = a.eventAt ? new Date(a.eventAt).getTime() : 0;
      const bt = b.eventAt ? new Date(b.eventAt).getTime() : 0;
      return at - bt || a.sequenceNo - b.sequenceNo;
    })
    .forEach(event => {
      const key = [
        event.eventAt ?? '',
        event.description ?? event.eventCode ?? '',
        event.locationName ?? '',
        event.facilityName ?? '',
        event.vesselName ?? '',
      ].join('|');
      const existing = groups.get(key);
      if (existing) {
        if (event.containerId) existing.containers.add(event.containerId);
        return;
      }
      groups.set(key, {
        event,
        containers: new Set(event.containerId ? [event.containerId] : []),
      });
    });

  const items = Array.from(groups.values()).map(({ event, containers }, index) => {
    const containerList = Array.from(containers);
    const containerText = containerList.length > 0
      ? `${containerList.length} container${containerList.length === 1 ? '' : 's'}: ${containerList.slice(0, 3).join(', ')}${containerList.length > 3 ? ` +${containerList.length - 3}` : ''}`
      : null;

    return {
      id: `${event.id}-${index}`,
      date: event.eventAt,
      label: event.description ?? event.eventCode ?? 'SafeCube event',
      sublabel: [event.facilityName ?? event.locationName, event.vesselName, containerText].filter(Boolean).join(' - ') || undefined,
      isActual: event.isActual ?? false,
      isCurrent: false,
    };
  });

  const latestActualFromEnd = [...items].reverse().findIndex(item => item.isActual);
  if (latestActualFromEnd >= 0) {
    const index = items.length - 1 - latestActualFromEnd;
    items[index] = { ...items[index], isCurrent: scData.shippingStatus !== 'DELIVERED' };
  }

  return items;
}

function SkuTable({ items }: { items: PlItem[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${BDR}`, paddingTop: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', color: MUTED, textTransform: 'uppercase', marginBottom: 6 }}>Contents</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '3px 12px', alignItems: 'baseline' }}>
        {/* header */}
        <span style={{ fontSize: 14, color: MUTED, fontWeight: 600 }}>SKU / Description</span>
        <span style={{ fontSize: 14, color: MUTED, fontWeight: 600, textAlign: 'right' }}>Bundles</span>
        <span style={{ fontSize: 14, color: MUTED, fontWeight: 600, textAlign: 'right' }}>Qty (pcs)</span>
        <span style={{ fontSize: 14, color: MUTED, fontWeight: 600, textAlign: 'right' }}>Net Wt (kg)</span>
        {items.map((item, i) => (
          <Fragment key={item.id ?? i}>
            <div style={{ minWidth: 0 }}>
              {item.productCode && <span className="vs-mono" style={{ fontSize: 14.5, fontWeight: 600, color: FG }}>{item.productCode}</span>}
              {item.productDescription && <span style={{ fontSize: 14.5, color: MUTED, marginLeft: item.productCode ? 6 : 0 }}>{item.productDescription}</span>}
              {item.productSpecification && <span style={{ fontSize: 14, color: MUTED, display: 'block', marginTop: 1 }}>{item.productSpecification}</span>}
            </div>
            <span style={{ fontSize: 14.5, color: FG, textAlign: 'right' }}>{item.noOfBundles ?? '—'}</span>
            <span style={{ fontSize: 14.5, color: FG, textAlign: 'right' }}>{item.totalQtyInPcs ?? '—'}</span>
            <span style={{ fontSize: 14.5, color: FG, textAlign: 'right' }}>{item.netWeightKgs ?? '—'}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ContainerGridPanel({ containers, scData, dndAlerts, viewState, packingListItems }: {
  containers: ApiShipment['containers']; scData: SafeCubeData | null;
  dndAlerts: ApiShipment['dndAlerts']; viewState: ContainerViewState;
  packingListItems: PlItem[];
}) {
  const N = containers.length;
  const sizeLabel = containers[0]?.containerSize ?? '—';

  const getScContainer = (num: string) => scData?.containers.find(c => c.number === num);
  const getDnd         = (num: string) => dndAlerts.find(a => a.containerNumber === num);

  const stateChip = (label: string, color: string, bg: string) => (
    <span style={{ fontSize: 14, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: bg, color, letterSpacing: '0.04em' }}>{label}</span>
  );

  const containerMilestones = (c: ApiShipment['containers'][0]): { label: string; done: boolean; date?: string }[] => {
    const sc  = getScContainer(c.containerNumber);
    const dnd = getDnd(c.containerNumber);
    const st  = (sc?.status ?? '').toLowerCase();
    const arrived    = !!scData?.podAt;
    const discharged = arrived || st.includes('discharg') || st.includes('gate') || st.includes('deliver') || !!dnd;
    const gatedOut   = st.includes('gate') || st.includes('deliver') || dnd?.status === 'ACCRUING';
    const delivered  = st.includes('deliver') || dnd?.status === 'CLEARED';
    return [
      { label: 'Arrived at port',  done: arrived,    date: scData?.podAt ?? undefined },
      { label: 'Discharged',       done: discharged },
      { label: 'Customs gate out', done: gatedOut },
      { label: 'Delivered',        done: delivered },
    ];
  };

  const headerRight = viewState === 'active' && dndAlerts.some(a => a.status === 'ACCRUING')
    ? <span style={{ fontSize: 14, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'hsla(0,72%,51%,0.1)', color: 'hsl(var(--vs-danger))' }}>D&amp;D ACCRUING</span>
    : viewState === 'approaching'
    ? <span style={{ fontSize: 14, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'hsla(38,92%,50%,0.12)', color: AMBER }}>ARRIVING SOON</span>
    : null;

  const rowLink = (id: string) => `/inventory/containers/${id}`;

  return (
    <Card style={{ padding: '18px 20px' }}>
      <SectionLabel right={headerRight}>
        <Package size={12} style={{ display: 'inline', marginRight: 5 }} />
        Containers ({N} × {sizeLabel})
      </SectionLabel>

      {/* early — locked, no detail page yet */}
      {viewState === 'early' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {containers.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'hsl(var(--muted)/0.3)', opacity: 0.7 }}>
              <span className="vs-mono" style={{ fontSize: 14.5, fontWeight: 600, color: MUTED }}>{c.containerNumber}</span>
              <span style={{ fontSize: 14.5, color: MUTED }}>{c.containerSize} {c.containerType}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14.5, color: MUTED, marginTop: 4 }}>
            <Lock size={11} />
            Container-level tracking activates as vessel approaches destination
          </div>
        </div>
      )}

      {/* preview */}
      {viewState === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {containers.map(c => {
            const sc = getScContainer(c.containerNumber);
            return (
              <Link key={c.id} href={rowLink(c.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, background: 'hsl(var(--muted)/0.3)', border: `1px solid ${BDR}`, textDecoration: 'none' }}>
                <span className="vs-mono" style={{ fontSize: 14.5, fontWeight: 600, color: FG }}>{c.containerNumber}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 14.5, color: MUTED }}>{c.containerSize}</span>
                  {sc?.status && stateChip(sc.status, TEAL, 'hsl(var(--vs-teal)/0.1)')}
                  <ChevronRight size={13} color={MUTED} />
                </div>
              </Link>
            );
          })}
          <div style={{ fontSize: 14.5, color: MUTED, marginTop: 4 }}>Full container detail activates at T-5 days</div>
        </div>
      )}

      {/* approaching */}
      {viewState === 'approaching' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {containers.map(c => {
            const sc  = getScContainer(c.containerNumber);
            const dnd = getDnd(c.containerNumber);
            return (
              <Link key={c.id} href={rowLink(c.id)} style={{ display: 'block', padding: '10px 14px', borderRadius: 8, border: `1px solid ${BDR}`, background: 'hsl(var(--background))', textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="vs-mono" style={{ fontSize: 14.5, fontWeight: 600, color: FG }}>{c.containerNumber}</span>
                    <span style={{ fontSize: 14.5, color: MUTED }}>{c.containerSize}</span>
                    {sc?.status && stateChip(sc.status, TEAL, 'hsl(var(--vs-teal)/0.1)')}
                  </div>
                  <ChevronRight size={13} color={MUTED} />
                </div>
                {dnd?.lfd && <div style={{ fontSize: 14.5, color: AMBER, fontWeight: 600, marginTop: 5 }}>LFD: {fmtDate(dnd.lfd)} · {dnd.status}</div>}
                {c.grossWeightKg && <div style={{ fontSize: 14.5, color: MUTED, marginTop: 2 }}>{c.grossWeightKg.toLocaleString()} kg</div>}
              </Link>
            );
          })}
        </div>
      )}

      {/* active — flat rows with inline milestone stepper */}
      {viewState === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {containers.map(c => {
            const sc         = getScContainer(c.containerNumber);
            const dnd        = getDnd(c.containerNumber);
            const ms         = containerMilestones(c);
            const isAccruing = dnd?.status === 'ACCRUING';
            return (
              <Link key={c.id} href={rowLink(c.id)} style={{ display: 'block', borderRadius: 8, border: `1px solid ${isAccruing ? 'hsl(var(--vs-danger)/0.3)' : BDR}`, background: isAccruing ? 'hsla(0,72%,51%,0.03)' : 'hsl(var(--background))', padding: '10px 14px', textDecoration: 'none' }}>
                {/* header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="vs-mono" style={{ fontSize: 14.5, fontWeight: 700, color: FG }}>{c.containerNumber}</span>
                    <span style={{ fontSize: 14.5, color: MUTED }}>{c.containerSize}</span>
                    {sc?.status && stateChip(sc.status, TEAL, 'hsl(var(--vs-teal)/0.12)')}
                    {isAccruing && stateChip(`D&D Day ${Math.floor((Date.now() - new Date(scData!.podAt!).getTime()) / 86400000)}`, 'hsl(var(--vs-danger))', 'hsla(0,72%,51%,0.1)')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {dnd?.lfd && <span style={{ fontSize: 14.5, color: AMBER, fontWeight: 600 }}>LFD {fmtDate(dnd.lfd)}</span>}
                    {dnd?.totalCharge && dnd.totalCharge > 0 && <span style={{ fontSize: 14.5, fontWeight: 700, color: 'hsl(var(--vs-danger))' }}>${dnd.totalCharge.toFixed(0)}</span>}
                    <ChevronRight size={13} color={MUTED} />
                  </div>
                </div>
                {/* inline 4-step stepper */}
                <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 10, left: 9, right: 9, height: 2, background: BDR, zIndex: 0 }} />
                  {ms.map((m, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.done ? GREEN : 'hsl(var(--muted))', border: `2px solid ${m.done ? GREEN : BDR}` }}>
                        {m.done && <Check size={10} color="#fff" />}
                      </div>
                      <div style={{ fontSize: 14, color: m.done ? FG : MUTED, marginTop: 5, textAlign: 'center', lineHeight: 1.3, maxWidth: 70, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{m.label}</div>
                      {m.date && <div style={{ fontSize: 13, color: MUTED, marginTop: 1 }}>{fmtDate(m.date)}</div>}
                    </div>
                  ))}
                </div>
                {c.grossWeightKg && <div style={{ fontSize: 14.5, color: MUTED, marginTop: 8 }}>{c.grossWeightKg.toLocaleString()} kg · {c.containerType ?? ''}</div>}
                <SkuTable items={packingListItems} />
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── Documents Panel ──────────────────────────────────────────────────────────
const US_DOC_TYPES = ['IMPORTER_SECURITY', 'ISF', 'BILL_OF_ENTRY', 'BOE', 'CARGO_RELEASE', 'PROOF_OF_DELIVERY', 'DELIVERY_ORDER'];

function orderedDocTypeGates(docTypeGates: ApiDocTypeGate[] = []): ApiDocTypeGate[] {
  return [...docTypeGates].sort((a, b) => {
    const ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.docType ?? '').localeCompare(String(b.docType ?? ''));
  });
}

function normalizedDocType(dt: string | null | undefined): string {
  return String(dt ?? '').toUpperCase();
}

function docTypeMatches(actual: string | null | undefined, expected: string): boolean {
  const a = normalizedDocType(actual);
  const e = normalizedDocType(expected);
  if (a === e) return true;
  if (e === 'SALES_INVOICE') return a === 'SI' || a.includes('SALES_INVOICE');
  if (e === 'PACKING_LIST') return a === 'PL' || (a.includes('PACKING_LIST') && !a.includes('OUTWARD'));
  if (e === 'SHIPPING_BILL') return a === 'SB' || a.includes('SHIPPING_BILL');
  if (e === 'CHA_BILL') return a === 'CHA' || a.includes('CHA_BILL');
  if (e === 'BILL_OF_LADING') return a === 'BL' || a === 'BOL' || a.includes('BILL_OF_LADING');
  if (e === 'FREIGHT_FORWARDER_BILL') return a.includes('FREIGHT_FORWARDER');
  if (e === 'ENTRY_SUMMARY_DRAFT') return a.includes('DRAFT') && (a.includes('ENTRY_SUMMARY') || a.includes('BOE') || a.includes('CBP'));
  if (e === 'ENTRY_SUMMARY_TARIFF_LINES') return a.includes('ENTRY_SUMMARY_TARIFF') || a.includes('TARIFF_LINES');
  if (e === 'ENTRY_SUMMARY') return a === 'BOE' || a.includes('BILL_OF_ENTRY') || a.includes('CBP_FORM_7501');
  if (e === 'US_CARGO_RELEASE_ORDER') return a.includes('CARGO_RELEASE');
  if (e === 'US_CUSTOMS_RELEASE_ORDER') return a.includes('CUSTOMS_RELEASE');
  if (e === 'US_DELIVERY_ORDER') return a.includes('DELIVERY_ORDER');
  if (e === 'ISF') return a === 'ISF' || a.includes('IMPORTER_SECURITY');
  if (e === 'CUSTOMER_BROKER_BILL') return a.includes('CUSTOMER_BROKER') || a.includes('CUSTOM_BROKER') || a.includes('CUSTOMS_BROKER');
  if (e === 'OCEAN_FREIGHT') return a.includes('OCEAN_FREIGHT');
  if (e === 'GRN_INBOUND') return a === 'GR' || a.includes('GRN_INBOUND') || a.includes('GOODS_RECEIPT');
  if (e === 'PORT_TO_WH') return a.includes('PORT_TO_WH') || a.includes('PORT_TO_WAREHOUSE');
  if (e === 'US_PACKING_LIST') return a.includes('US_PACKING');
  if (e === 'US_SALES_INVOICE') return a.includes('US_SALES');
  if (e === 'WH_TO_CUSTOMER') return a.includes('WH_TO_CUSTOMER') || a.includes('WAREHOUSE_TO_CUSTOMER');
  return false;
}

function findDocForSlot(documents: any[], docType: string, usedDocIds?: Set<string>, gateNumber?: number): any | null {
  const doc = documents.find(d =>
    !usedDocIds?.has(d.id)
    && docTypeMatches(d.documentType, docType)
    && (gateNumber == null || d.gateNumber == null || Number(d.gateNumber) === gateNumber)
  );
  if (doc && usedDocIds) usedDocIds.add(doc.id);
  return doc ?? null;
}

function findDocsForSlot(documents: any[], docType: string, usedDocIds?: Set<string>, gateNumber?: number): any[] {
  const docs = documents.filter(d =>
    !usedDocIds?.has(d.id)
    && docTypeMatches(d.documentType, docType)
    && (gateNumber == null || d.gateNumber == null || Number(d.gateNumber) === gateNumber)
  );
  if (usedDocIds) docs.forEach(doc => usedDocIds.add(doc.id));
  return docs;
}

function expectedDocTypesForGate(gate: ApiGate): ApiDocTypeGate[] {
  const gateNumber = Number(gate.gateConfig.gateNumber ?? 0);
  const configured = orderedDocTypeGates(gate.gateConfig.docTypeGates ?? []);
  const fallbackTypes = SHIPMENT_EXPECTED_DOCS_BY_GATE[gateNumber] ?? [];
  if (fallbackTypes.length === 0) return configured;
  const merged = fallbackTypes.map((docType, index) => {
    const key = normalizedDocType(docType);
    const configuredMatch = configured.find(item => normalizedDocType(item.docType) === key);
    return configuredMatch ? { ...configuredMatch, sortOrder: index + 1 } : {
      id: `shipment-expected-${gateNumber}-${index}-${key}`,
      docType,
      roleInGate: DOCUMENT_PARALLEL_DOC_TYPES.has(key) ? 'PARALLEL' : 'PRIMARY',
      isGenerated: key.includes('DRAFT') || key === 'US_PACKING_LIST',
      sortOrder: index + 1,
    };
  });
  return orderedDocTypeGates(merged);
}

function documentModuleDocTypesForGate(documents: any[], gateNumber: number, existingDocTypes: Set<string>): ApiDocTypeGate[] {
  const seen = new Set<string>();
  return documents
    .filter(doc => Number(doc.gateNumber) === gateNumber)
    .map(doc => normalizedDocType(doc.documentType))
    .filter(docType => {
      if (!docType || existingDocTypes.has(docType) || seen.has(docType)) return false;
      seen.add(docType);
      return true;
    })
    .map((docType, index) => {
      const sample = documents.find(doc => Number(doc.gateNumber) === gateNumber && docTypeMatches(doc.documentType, docType));
      return {
        id: `document-module-${gateNumber}-${docType}`,
        docType,
        roleInGate: sample?.isParallel || DOCUMENT_PARALLEL_DOC_TYPES.has(docType) ? 'PARALLEL' : 'PRIMARY',
        isGenerated: Boolean(sample?.isGenerated),
        sortOrder: 1000 + index,
      };
    });
}

function docTypesForGate(gate: ApiGate, documents: any[]): ApiDocTypeGate[] {
  const gateNumber = Number(gate.gateConfig.gateNumber ?? 0);
  const expected = expectedDocTypesForGate(gate);
  const existing = new Set(expected.map(dt => normalizedDocType(dt.docType)));
  return orderedDocTypeGates([
    ...expected,
    ...documentModuleDocTypesForGate(documents, gateNumber, existing),
  ]);
}

function isCrossValidationPassed(doc: any | null | undefined): boolean {
  return String(doc?.validationStatus ?? '').toUpperCase() === 'PASSED';
}

function docStatusPill(doc: any): { label: string; color: string; bg: string } {
  const validationStatus = String(doc.validationStatus ?? '').toUpperCase();
  if (validationStatus === 'PASSED') return { label: 'Cross validated', color: 'hsl(142 71% 30%)', bg: 'hsla(142,71%,45%,0.10)' };
  if (validationStatus === 'BLOCKED' || validationStatus === 'FAILED' || doc.ocrStatus === 'FAILED')
    return { label: 'Cross validation failed', color: 'hsl(var(--vs-danger))', bg: 'hsla(0,72%,51%,0.08)' };
  if (validationStatus === 'WAITING') return { label: 'Cross validation waiting', color: 'hsl(38 92% 38%)', bg: 'hsla(38,92%,50%,0.12)' };
  if (validationStatus === 'WARNING') return { label: 'Cross validation warning', color: 'hsl(38 92% 38%)', bg: 'hsla(38,92%,50%,0.12)' };
  if (doc.approvedAt) return { label: 'Reviewed', color: MUTED, bg: 'hsl(var(--muted)/0.45)' };
  if (doc.ocrStatus === 'PROCESSING') return { label: 'Processing', color: 'hsl(217 91% 55%)', bg: 'hsla(217,91%,55%,0.10)' };
  return { label: 'Pending', color: MUTED, bg: 'hsl(var(--muted)/0.5)' };
}

function docGroupStatusPill(docs: any[]): { label: string; color: string; bg: string } {
  if (docs.some(doc => ['BLOCKED', 'FAILED'].includes(String(doc.validationStatus ?? '').toUpperCase()) || doc.ocrStatus === 'FAILED')) {
    return { label: 'Cross validation failed', color: 'hsl(var(--vs-danger))', bg: 'hsla(0,72%,51%,0.08)' };
  }
  if (docs.length > 0 && docs.every(isCrossValidationPassed)) {
    return { label: 'Cross validated', color: 'hsl(142 71% 30%)', bg: 'hsla(142,71%,45%,0.10)' };
  }
  if (docs.some(doc => ['WAITING', 'WARNING'].includes(String(doc.validationStatus ?? '').toUpperCase()))) {
    return { label: 'Cross validation pending', color: 'hsl(38 92% 38%)', bg: 'hsla(38,92%,50%,0.12)' };
  }
  if (docs.some(doc => doc.approvedAt)) {
    return { label: 'Reviewed', color: MUTED, bg: 'hsl(var(--muted)/0.45)' };
  }
  return docs[0] ? docStatusPill(docs[0]) : { label: 'Pending', color: MUTED, bg: 'hsl(var(--muted)/0.5)' };
}

function groupDocsByType(docs: any[]): Array<{ docType: string; docs: any[] }> {
  const groups = new Map<string, any[]>();
  docs.forEach(doc => {
    const docType = String(doc.documentType ?? 'DOCUMENT').toUpperCase();
    groups.set(docType, [...(groups.get(docType) ?? []), doc]);
  });
  return Array.from(groups.entries()).map(([docType, groupDocs]) => ({ docType, docs: groupDocs }));
}

function DocRow360({ docType, docs, isLast }: { docType: string; docs: any[]; isLast: boolean }) {
  const pill = docGroupStatusPill(docs);
  const count = docs.length;
  const label = `${docLabel(docType)}${count > 1 ? ` (${count})` : ''}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderBottom: isLast ? 'none' : `1px solid ${BDR}` }}>
      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'hsl(var(--muted)/0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: MUTED, flexShrink: 0, fontFamily: 'var(--app-font-sans)', letterSpacing: '0.02em' }}>
        {dtShort(docType)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, padding: '4px 12px', borderRadius: 999, flexShrink: 0, background: pill.bg, color: pill.color }}>
        {pill.label}
      </span>
    </div>
  );
}

function AwaitedRow360({ docType, isLast }: { docType: string; isLast: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderBottom: isLast ? 'none' : `1px solid ${BDR}`, opacity: 0.45 }}>
      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'hsl(var(--muted)/0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: MUTED, flexShrink: 0, fontFamily: 'var(--app-font-sans)', letterSpacing: '0.02em' }}>
        {dtShort(docType)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: MUTED }}>{docLabel(docType)}</div>
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, padding: '4px 12px', borderRadius: 999, flexShrink: 0, background: 'hsl(var(--muted)/0.3)', color: MUTED }}>
        Awaited
      </span>
    </div>
  );
}

type ShipmentGateProgressStatus = 'passed' | 'active' | 'future' | 'blocked';

function shipmentGateApiStatus(gate: ApiGate): ShipmentGateProgressStatus {
  const status = String(gate.status ?? '').toUpperCase();
  if (status === 'PASSED') return 'passed';
  if (status === 'FAILED' || status === 'BLOCKED') return 'blocked';
  if (status === 'OPEN' || status === 'ACTIVE') return 'active';
  return 'future';
}

interface ShipmentGateProgressRow {
  gate: ApiGate;
  label: string;
  status: ShipmentGateProgressStatus;
  docCount: string;
}

function buildShipmentGateProgressRows(gates: ApiGate[], documents: any[]): ShipmentGateProgressRow[] {
  const sortedGates = [...gates].sort((a, b) => a.gateConfig.gateNumber - b.gateConfig.gateNumber);
  const rows = sortedGates.map(gate => {
    const gateNumber = Number(gate.gateConfig.gateNumber ?? 0);
    const requiredDocs = docTypesForGate(gate, documents).filter(dt => !dt.isGenerated && dt.roleInGate !== 'PARALLEL');
    const usedDocIds = new Set<string>();
    const completed = requiredDocs.filter(dt => {
      const doc = findDocForSlot(documents, dt.docType, usedDocIds, gateNumber);
      return isCrossValidationPassed(doc);
    }).length;
    return {
      gate,
      label: SHIPMENT_GATE_LABELS[gateNumber] ?? gate.gateConfig.gateLabel ?? gate.gateConfig.gateName,
      apiStatus: shipmentGateApiStatus(gate),
      required: requiredDocs.length,
      completed,
    };
  });

  let precedingGatesComplete = true;
  let activeGateAssigned = false;

  return rows.map(row => {
    const complete = row.required > 0 && row.completed === row.required;
    let status: ShipmentGateProgressStatus = 'future';

    if (row.apiStatus === 'blocked') {
      status = 'blocked';
      precedingGatesComplete = false;
      activeGateAssigned = true;
    } else if (precedingGatesComplete && complete) {
      status = 'passed';
    } else if (precedingGatesComplete && !activeGateAssigned) {
      status = 'active';
      activeGateAssigned = true;
      precedingGatesComplete = false;
    } else {
      status = 'future';
      precedingGatesComplete = false;
    }

    return {
      gate: row.gate,
      label: row.label,
      status,
      docCount: `${row.completed}/${row.required}`,
    };
  });
}

function shipmentGateProgressColor(status: ShipmentGateProgressStatus): string {
  if (status === 'passed') return GREEN;
  if (status === 'active') return TEAL;
  if (status === 'blocked') return 'hsl(var(--vs-danger))';
  return BDR;
}

function ShipmentPortMarker({ status, size = 20 }: { status: ShipmentGateProgressStatus; size?: number }) {
  const isPassed = status === 'passed';
  const isActive = status === 'active';
  const isBlocked = status === 'blocked';
  const color = shipmentGateProgressColor(status);
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {isActive && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: '50%',
          border: `2px solid ${TEAL}`, opacity: 0.45,
          animation: 'gateRing 1.4s ease-out infinite',
        }} />
      )}
      <div style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: isPassed ? GREEN : isActive ? TEAL : isBlocked ? 'hsl(var(--vs-danger))' : CARD,
        border: status === 'future' ? `2px solid ${BDR}` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: isActive ? `0 0 8px ${TEAL}55` : isPassed ? `0 0 4px ${GREEN}40` : 'none',
      }}>
        {isPassed && <Check size={11} color="#fff" strokeWidth={3} />}
        {isActive && <div style={{ width: size * 0.28, height: size * 0.28, borderRadius: '50%', backgroundColor: '#fff' }} />}
        {isBlocked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 800, lineHeight: 1 }}>!</span>}
      </div>
    </div>
  );
}

function VoyageProgressDocumentTracker({
  documents,
  loading,
  gates = [],
  shipment,
  scData: _scData,
}: {
  documents: any[];
  loading: boolean;
  gates?: ApiGate[];
  shipment: ApiShipment | null;
  scData: SafeCubeData | null;
}) {
  const gateRows = buildShipmentGateProgressRows(gates, documents);
  if (!loading && gateRows.length === 0) return null;

  const N = gateRows.length;

  const activeIdx = gateRows.findIndex(row => row.status === 'active' || row.status === 'blocked');
  const lastPassedIdx = gateRows.reduce((last, row, index) => row.status === 'passed' ? index : last, -1);
  const shipIdx = activeIdx >= 0 ? activeIdx : lastPassedIdx >= 0 ? lastPassedIdx : 0;
  const pct = (index: number) => (2 * index + 1) / (2 * Math.max(N, 1)) * 100;
  const firstPct = pct(0);
  const lastPct = pct(Math.max(N - 1, 0));
  const trackW = Math.max(lastPct - firstPct, 0);
  let shipPct = pct(shipIdx);

  const sailedW = trackW > 0 ? Math.max(0, Math.min(100, (shipPct - firstPct) / trackW * 100)) : 0;
  const marker = 20;
  const route = [shipment?.portOfLoading, shipment?.portOfDischarge].filter(Boolean).join(' -> ');

  return (
    <Card style={{ padding: '16px 24px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Anchor size={14} color={TEAL} />
        <span className="vs-mono" style={{ fontSize: 14, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Voyage progress
        </span>
        <span style={{ fontSize: 14, color: BDR }}>·</span>
        <span className="vs-mono" style={{ fontSize: 14, fontWeight: 700, color: TEAL }}>
          {shipment?.shipmentNumber ?? 'Shipment'}
        </span>
        {(shipment?.vesselName || route) && (
          <span style={{ fontSize: 14, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[shipment?.vesselName, route].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {loading ? (
        <SkeletonRow width={320} />
      ) : (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BDR}` }}>
          <div style={{ position: 'relative', display: 'flex' }}>
            <div style={{
              position: 'absolute', top: marker / 2 - 1,
              left: `${firstPct}%`, width: `${trackW}%`, height: 2,
              zIndex: 0, pointerEvents: 'none',
            }}>
              <div style={{
                position: 'absolute', inset: 0, width: `${sailedW}%`,
                background: `linear-gradient(90deg, ${GREEN}, ${TEAL})`,
                borderRadius: 2, boxShadow: `0 0 6px ${TEAL}55`,
              }} />
              <div style={{
                position: 'absolute', top: 0, bottom: 0, left: `${sailedW}%`, right: 0,
                background: `repeating-linear-gradient(90deg, ${BDR} 0px, ${BDR} 5px, transparent 5px, transparent 11px)`,
                opacity: 0.7,
              }} />
            </div>

            {gateRows.map(row => (
              <div key={row.gate.id} style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4, position: 'relative', zIndex: 1,
                minWidth: 0,
              }}>
                <ShipmentPortMarker status={row.status} size={marker} />
                <div style={{
                  fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', lineHeight: 1.3,
                  color: row.status === 'future' ? MUTED : FG,
                  width: '100%', textAlign: 'center',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-word',
                }}>
                  {row.label}
                </div>
                <span className="vs-mono" style={{
                  fontSize: 14, fontWeight: 700,
                  color: row.status === 'future' ? MUTED : row.status === 'blocked' ? 'hsl(var(--vs-danger))' : row.status === 'active' ? TEAL : GREEN,
                }}>
                  {row.docCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function DocumentsPanel360({ documents, loading, gates = [] }: { documents: any[]; loading: boolean; gates?: ApiGate[] }) {
  const pending   = documents.filter(d => !isCrossValidationPassed(d));
  const pendingUs = pending.filter(d => US_DOC_TYPES.some(t => (d.documentType ?? '').toUpperCase().includes(t)));
  const hasAlert  = pendingUs.length > 0;

  // Build the complete gate document matrix for the side panel:
  // expected, generated, uploaded, and validated documents all stay visible.
  const sortedGates = [...gates].sort((a, b) => a.gateConfig.gateNumber - b.gateConfig.gateNumber);
  const gateGroups = sortedGates.map(gate => {
    const gateNumber = Number(gate.gateConfig.gateNumber ?? 0);
    const usedInGate = new Set<string>();
    const entries = docTypesForGate(gate, documents).map(dt => ({
      dt,
      docs: findDocsForSlot(documents, dt.docType, usedInGate, gateNumber),
    }));
    return { gate, entries };
  });

  // Docs not matched to any gate (manually uploaded extras)
  const assignedDocIds = new Set<string>(
    gateGroups.flatMap(g => g.entries.flatMap(e => e.docs.map(doc => doc.id)).filter((id): id is string => !!id))
  );
  const ungatedDocs = documents.filter(d => !assignedDocIds.has(d.id));
  const expectedCount = gateGroups.reduce((sum, group) => sum + group.entries.length, 0) + ungatedDocs.length;
  const validatedCount = gateGroups.reduce(
    (sum, group) => sum + group.entries.filter(entry => entry.docs.length > 0 && entry.docs.every(isCrossValidationPassed)).length,
    0,
  ) + ungatedDocs.filter(isCrossValidationPassed).length;

  return (
    <Card style={{ padding: '18px 20px', marginBottom: 16 }}>
      <SectionLabel right={<span style={{ fontSize: 14.5, fontWeight: 700, color: expectedCount > 0 && validatedCount === expectedCount ? GREEN : MUTED }}>{validatedCount} OF {expectedCount} VALIDATED</span>}>
        <FileText size={12} style={{ display: 'inline', marginRight: 5 }} />Documents
      </SectionLabel>

      {loading && <SkeletonRow width={220} />}

      {!loading && hasAlert && (
        <div style={{ display: 'flex', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'hsla(38,92%,50%,0.08)', border: `1px solid hsl(38 92% 50% / 0.3)`, marginBottom: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={13} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 14, color: 'hsl(38 92% 30%)' }}>
            <strong>US broker queue:</strong>{' '}
            {pendingUs.map(d => docLabel(d.documentType)).join(', ')} {pendingUs.length === 1 ? 'is' : 'are'} still open
          </div>
        </div>
      )}

      {!loading && gateGroups.length === 0 && documents.length === 0 && (
        <div style={{ fontSize: 14.5, color: MUTED, fontStyle: 'italic' }}>No documents yet.</div>
      )}

      {/* Gate-grouped view */}
      {!loading && gateGroups.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {gateGroups.map(({ gate, entries }) => {
            const gc = gate.gateConfig;
            const gateNumber = Number(gc.gateNumber ?? 0);
            const status = gate.status;
            const visible = entries;
            if (visible.length === 0) return null;

            const statusColor = gateStatusColor(status);
            const isPassed  = status === 'PASSED';
            const isSkipped = status === 'SKIPPED';

            return (
              <div key={gate.id}>
                {/* Gate section header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    backgroundColor: statusColor,
                  }}>
                    {gc.gateNumber}
                  </div>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: FG, flex: 1 }}>{SHIPMENT_GATE_LABELS[gateNumber] ?? gc.gateName}</span>
                  {gc.geography && <span style={{ fontSize: 14, color: MUTED }}>{gc.geography}</span>}
                  <span style={{ fontSize: 14, fontWeight: 700, color: statusColor, letterSpacing: '0.03em' }}>
                    {isPassed ? `✓ ${gate.passedAt ? fmtDate(gate.passedAt) : 'Passed'}` : isSkipped ? 'Skipped' : status}
                  </span>
                </div>

                {/* Document rows */}
                <div style={{ borderRadius: 8, border: `1px solid ${BDR}`, overflow: 'hidden' }}>
                  {visible.map(({ dt, docs }, i) => {
                    const isLast = i === visible.length - 1;
                    return docs.length > 0
                      ? <DocRow360 key={dt.id} docType={dt.docType} docs={docs} isLast={isLast} />
                      : <AwaitedRow360 key={dt.id} docType={dt.docType} isLast={isLast} />;
                  })}
                </div>
              </div>
            );
          })}

          {/* Documents not matched to any gate */}
          {ungatedDocs.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: 'hsl(var(--muted)/0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 13, color: MUTED }}>•</span>
                </div>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: MUTED }}>Other</span>
              </div>
              <div style={{ borderRadius: 8, border: `1px solid ${BDR}`, overflow: 'hidden' }}>
                {groupDocsByType(ungatedDocs).map((group, i, groups) => (
                  <DocRow360 key={group.docType} docType={group.docType} docs={group.docs} isLast={i === groups.length - 1} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fallback flat list when no gate data */}
      {!loading && gateGroups.length === 0 && documents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {groupDocsByType(documents).map((group, i, groups) => (
            <DocRow360 key={group.docType} docType={group.docType} docs={group.docs} isLast={i === groups.length - 1} />
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Outward PL / POD CTA ─────────────────────────────────────────────────────
function OutwardPlCta({ shipment, documents, milestones, gates, onRefresh }: {
  shipment: ApiShipment;
  documents: any[];
  milestones: ApiMilestoneTracking[];
  gates: ApiGate[];
  onRefresh: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState<string | null>(null);
  const { user } = useAuth();
  const { openUploadWith } = useUpload();
  const token = getAuthToken();
  const hdrs: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  // CTA is visible only to ops_manager and us_logistics; org_admin is included as fallback.
  const allowedSystemCodes = ['ops_manager', 'us_logistics'];
  const sc = user?.role?.systemCode ?? '';
  const cat = user?.role?.category ?? '';
  const isAllowed = cat === 'org_admin' || allowedSystemCodes.includes(sc);
  if (!isAllowed) return null;

  const isBb        = shipment.shipmentType === 'break_bulk';
  const isContainer = shipment.shipmentType === 'container';

  // Hide CTA entirely for any shipment type other than container or break_bulk
  if (!isBb && !isContainer) return null;

  if (isBb) {
    // Order-within-gate: customs cleared = the last milestone (by milestoneNumber) of the
    // first PASSED US-geography gate is COMPLETED with a completedAt timestamp.
    // The "last milestone within a gate" is the gate's completion step — the structural
    // slot that represents "this phase is done."  Degrades neutrally when absent.
    const passedUsGates = gates
      .filter(g => g.status === 'PASSED' && g.gateConfig.geography === 'US')
      .sort((a, b) => a.gateConfig.gateNumber - b.gateConfig.gateNumber);
    const customsGate   = passedUsGates[0]; // first PASSED US gate = entry/customs
    const customsLastMs = customsGate ? lastMilestoneOfGate(milestones, customsGate.gateConfigId) : undefined;
    const bbCleared     = !!(customsLastMs?.status === 'COMPLETED' && customsLastMs.completedAt);
    if (!bbCleared) return null;
    const podDoc = documents.find(d =>
      ((d.documentType ?? '').toUpperCase().includes('PROOF_OF_DELIVERY') || (d.documentType ?? '').toUpperCase().includes('POD'))
      && d.ocrStatus !== 'discarded',
    );
    return (
      <div style={{ marginBottom: 16, padding: '14px 18px', borderRadius: 8, border: `1px solid ${BDR}`, background: CARD, boxShadow: 'var(--vs-shadow-card)' }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
          <Truck size={11} style={{ display: 'inline', marginRight: 5 }} />Proof of Delivery
        </div>
        {podDoc ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'hsla(142,71%,45%,0.08)', border: '1px solid hsla(142,71%,45%,0.3)' }}>
            <Check size={13} color={GREEN} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(142 71% 30%)' }}>POD uploaded</span>
            {podDoc.approvedAt && <span style={{ fontSize: 14.5, color: MUTED }}>· {fmtDate(podDoc.approvedAt)}</span>}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, color: MUTED, marginBottom: 10 }}>Customs cleared. Upload the Proof of Delivery to close out this shipment.</div>
            <ActionBtn
              onClick={() => openUploadWith({ shipmentId: shipment.id, docType: 'proof_of_delivery' })}
              icon={<MapPin size={13} />}
              label="Upload Proof of Delivery"
              variant="primary"
            />
          </div>
        )}
      </div>
    );
  }

  // Container path — state machine (exclude discarded generated docs)
  const grnDoc = documents.find(d => (d.documentType ?? '').toUpperCase() === 'GRN_INBOUND');
  const grnOk  = grnDoc && (grnDoc.approvedAt || grnDoc.ocrStatus === 'reviewed' || grnDoc.ocrStatus === 'completed');
  const plDoc  = documents.find(d =>
    (d.documentType ?? '').toUpperCase() === 'US_PACKING_LIST_GEN'
    && d.isGenerated
    && d.ocrStatus !== 'discarded',
  );

  const ctaState: 'locked' | 'ready' | 'done' = plDoc ? 'done' : grnOk ? 'ready' : 'locked';

  async function handleGenerate() {
    setGenerating(true); setGenError(null);
    try {
      const r = await fetch('/api/documents/generate', { method: 'POST', headers: hdrs, body: JSON.stringify({ shipmentId: shipment.id, documentType: 'US_PACKING_LIST_GEN' }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'Generation failed');
      onRefresh();
    } catch (e: any) {
      setGenError(e.message ?? 'Generation failed');
    } finally { setGenerating(false); }
  }

  return (
    <div style={{ marginBottom: 16, padding: '14px 18px', borderRadius: 8, border: `1px solid ${ctaState === 'done' ? 'hsla(142,71%,45%,0.3)' : ctaState === 'ready' ? 'hsl(var(--primary)/0.3)' : BDR}`, background: CARD, boxShadow: 'var(--vs-shadow-card)' }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        <Box size={11} style={{ display: 'inline', marginRight: 5 }} />Outward GRN / Packing List
      </div>
      {ctaState === 'locked' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'hsl(var(--muted)/0.3)', border: `1px solid ${BDR}` }}>
          <Lock size={13} color={MUTED} />
          <span style={{ fontSize: 14, color: MUTED }}>Awaiting inbound GRN confirmation from 3PL partner</span>
        </div>
      )}
      {ctaState === 'ready' && (
        <div>
          <div style={{ fontSize: 14, color: MUTED, marginBottom: 10 }}>Inbound GRN confirmed. Generate the Outward Packing List to proceed.</div>
          {genError && <div style={{ fontSize: 14, color: 'hsl(var(--vs-danger))', marginBottom: 8 }}>{genError}</div>}
          <ActionBtn
            onClick={handleGenerate}
            icon={generating
              ? <div style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              : <CheckCircle2 size={13} />}
            label={generating ? 'Generating…' : 'Generate Outward GRN/PL'}
            variant="primary"
            disabled={generating}
          />
        </div>
      )}
      {ctaState === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'hsla(142,71%,45%,0.08)', border: '1px solid hsla(142,71%,45%,0.3)' }}>
          <CheckCircle2 size={14} color={GREEN} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(142 71% 30%)' }}>
              {plDoc?.approvedAt ? 'Outward GRN/PL approved' : 'Outward GRN/PL generated — pending approval'}
            </div>
            {plDoc?.approvedAt && <div style={{ fontSize: 14.5, color: MUTED }}>{fmtDate(plDoc.approvedAt)}</div>}
          </div>
          <button
            onClick={() => window.location.href = `/shipments/${shipment.id}/documents`}
            style={{ fontSize: 14, fontWeight: 500, color: TEAL, background: 'none', border: 'none', cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}
          >
            View →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Accounting Panel ─────────────────────────────────────────────────────────
function AccountingPanel360({ tickets, loading }: { tickets: any[]; loading: boolean }) {
  const posted  = tickets.filter(t => t.status === 'posted' || t.status === 'POSTED');
  const pending = tickets.filter(t => t.status !== 'posted' && t.status !== 'POSTED');

  return (
    <Card style={{ padding: '18px 20px' }}>
      <SectionLabel right={
        <div style={{ display: 'flex', gap: 8 }}>
          {posted.length > 0  && <span style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>{posted.length} POSTED</span>}
          {pending.length > 0 && <span style={{ fontSize: 14, fontWeight: 700, color: AMBER }}>{pending.length} PENDING</span>}
        </div>
      }>
        <CreditCard size={12} style={{ display: 'inline', marginRight: 5 }} />Accounting
      </SectionLabel>

      {loading && <SkeletonRow width={220} />}
      {!loading && tickets.length === 0 && <div style={{ fontSize: 14.5, color: MUTED, fontStyle: 'italic' }}>No accounting tickets.</div>}

      {!loading && tickets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {tickets.map((t, i) => {
            const isPending = t.status !== 'posted' && t.status !== 'POSTED';
            const isLast    = i === tickets.length - 1;
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '9px 10px', marginBottom: 2, borderRadius: 7,
                ...(isPending ? { background: 'hsla(38,92%,50%,0.07)', borderLeft: `3px solid ${AMBER}`, paddingLeft: 8 } : {}),
                borderBottom: isLast || isPending ? 'none' : `1px solid ${BDR}`,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: isPending ? 'hsl(38 92% 28%)' : FG, lineHeight: 1.3 }}>
                    {(t.entryType ?? '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </div>
                  {(t.postedAt || t.erpVoucherNumber || t.vendorName) && (
                    <div className="vs-mono" style={{ fontSize: 14.5, color: MUTED, marginTop: 1 }}>
                      {t.postedAt ? `Posted ${fmtDateFull(t.postedAt)}` : ''}{t.erpVoucherNumber ? ` · ${t.erpVoucherNumber}` : t.vendorName ? ` · ${t.vendorName}` : ''}
                    </div>
                  )}
                  {isPending && <div style={{ fontSize: 14.5, color: AMBER, fontWeight: 500, marginTop: 2 }}>{t.status?.replace(/_/g, ' ')}</div>}
                </div>
                <div className="vs-mono" style={{ fontSize: 14.5, fontWeight: 700, color: isPending ? AMBER : FG, flexShrink: 0 }}>
                  {fmtAmount(t.amount, t.currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── Gate Row (unused — kept as dead code placeholder to avoid import churn) ───
function GateRow({ gate, milestones, documents, shipmentId, onGateAction, onMilestoneComplete, isExpanded, onToggle }: {
  gate: ApiGate; milestones: ApiMilestoneTracking[]; documents: any[]; shipmentId: string;
  onGateAction: (a: 'pass' | 'skip' | 'revert', gateConfigId: string) => Promise<void>;
  onMilestoneComplete?: () => void;
  isExpanded: boolean; onToggle: () => void;
}) {
  const gc = gate.gateConfig;
  const status = gate.status;
  const gateMilestones = milestones.filter(m => m.milestoneConfig?.gateConfigId === gc.id);
  const gateDocTypes   = orderedDocTypeGates(gc.docTypeGates ?? []);
  const [acting, setActing] = useState(false);

  const [completingMs, setCompletingMs] = useState<number | null>(null);
  const [completeNotes, setCompleteNotes] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  async function handleAction(action: 'pass' | 'skip' | 'revert') {
    if (acting) return;
    setActing(true);
    try { await onGateAction(action, gc.id); } finally { setActing(false); }
  }

  async function handleMilestoneComplete(milestoneNumber: number) {
    setCompleting(true);
    setCompleteError(null);
    try {
      const token = getAuthToken();
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const r = await fetch(`/api/tracking/shipments/${shipmentId}/milestones/${milestoneNumber}/complete`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ notes: completeNotes.trim() || undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'Failed to complete milestone');
      setCompletingMs(null);
      setCompleteNotes('');
      onMilestoneComplete?.();
    } catch (e: any) {
      setCompleteError(e.message ?? 'Failed');
    } finally {
      setCompleting(false);
    }
  }

  const requiredDocs  = gateDocTypes.filter(d => !d.isGenerated);
  const coveredCodes  = new Set(documents.filter(d => d.approvedAt).map((d: any) => dtShort(d.documentType)));

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${status === 'OPEN' ? 'hsl(var(--vs-teal)/0.3)' : BDR}`, overflow: 'hidden', marginBottom: 8 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', backgroundColor: isExpanded ? gateStatusBg(status) : CARD, cursor: 'pointer', transition: 'background 0.15s', borderBottom: isExpanded ? `1px solid ${BDR}` : 'none' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: gateStatusColor(status), color: '#fff', fontSize: 14, fontWeight: 700 }}>{gc.gateNumber}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: FG }}>{gc.gateName}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            {gc.geography && <span style={{ fontSize: 14.5, color: MUTED }}>{gc.geography}</span>}
            <span style={{ fontSize: 14.5, color: gateStatusColor(status), fontWeight: 500 }}>{status}</span>
            {gate.passedAt && <span style={{ fontSize: 14.5, color: MUTED }}>· {fmtDate(gate.passedAt)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {requiredDocs.map(dt => {
            const code = dtShort(dt.docType);
            const ok   = coveredCodes.has(code);
            return <span key={dt.id} style={{ fontSize: 14.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, fontFamily: 'var(--app-font-sans)', background: ok ? 'hsla(142,71%,45%,0.12)' : 'hsl(var(--muted)/0.5)', color: ok ? 'hsl(142 71% 30%)' : MUTED }}>{code}</span>;
          })}
        </div>
        {isExpanded ? <ChevronDown size={16} color={MUTED} /> : <ChevronRight size={16} color={MUTED} />}
      </div>

      {isExpanded && (
        <div style={{ padding: '14px 16px', background: gateStatusBg(status) }}>
          {gateMilestones.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {gateMilestones.map(m => {
                const isManualPending = m.milestoneConfig?.type === 'MANUAL' && m.status === 'PENDING';
                const isConfirming    = completingMs === m.milestoneNumber;
                return (
                  <div key={m.id} style={{ marginBottom: isConfirming ? 10 : 6 }}>
                    {/* Milestone row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: FG }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: m.status === 'COMPLETED' ? GREEN : isManualPending ? AMBER : MUTED }} />
                      <span style={{ flex: 1 }}>{m.milestoneConfig?.name}</span>
                      {m.status === 'COMPLETED' && m.completedAt && (
                        <span style={{ fontSize: 14.5, color: MUTED }}>
                          ✓ {fmtDate(m.completedAt)}
                          {m.completedByName && <span style={{ marginLeft: 4 }}>· {m.completedByName}</span>}
                        </span>
                      )}
                      {isManualPending && !isConfirming && (
                        <RequireActivity code="GATE-002">
                          <button
                            onClick={e => { e.stopPropagation(); setCompletingMs(m.milestoneNumber); setCompleteNotes(''); setCompleteError(null); }}
                            style={{ fontSize: 14.5, fontWeight: 600, padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
                              background: 'hsla(142,71%,45%,0.1)', border: '1px solid hsla(142,71%,45%,0.3)', color: 'hsl(142 71% 30%)',
                              whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            Mark complete
                          </button>
                        </RequireActivity>
                      )}
                      {isManualPending && isConfirming && (
                        <button
                          onClick={e => { e.stopPropagation(); setCompletingMs(null); setCompleteError(null); }}
                          style={{ fontSize: 14.5, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {/* Inline confirmation */}
                    {isManualPending && isConfirming && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ marginTop: 6, marginLeft: 15, padding: '10px 12px', borderRadius: 8,
                          background: CARD, border: `1px solid ${BDR}`, boxShadow: '0 1px 6px hsl(var(--background)/0.8)' }}
                      >
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: FG, marginBottom: 6 }}>
                          Complete: {m.milestoneConfig?.name}
                        </div>
                        <textarea
                          value={completeNotes}
                          onChange={e => setCompleteNotes(e.target.value)}
                          placeholder="Optional notes…"
                          rows={2}
                          style={{ width: '100%', fontSize: 14.5, padding: '6px 8px', borderRadius: 6,
                            border: `1px solid ${BDR}`, background: 'hsl(var(--background))', color: FG,
                            resize: 'vertical', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                        />
                        {completeError && (
                          <div style={{ fontSize: 14.5, color: 'hsl(var(--vs-danger))', marginTop: 4 }}>{completeError}</div>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          <button
                            onClick={() => handleMilestoneComplete(m.milestoneNumber)}
                            disabled={completing}
                            style={{ fontSize: 14, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: completing ? 'not-allowed' : 'pointer',
                              background: 'hsl(142 71% 38%)', border: 'none', color: '#fff', opacity: completing ? 0.7 : 1 }}
                          >
                            {completing ? 'Saving…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => { setCompletingMs(null); setCompleteNotes(''); setCompleteError(null); }}
                            disabled={completing}
                            style={{ fontSize: 14, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                              background: CARD, border: `1px solid ${BDR}`, color: FG }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <RequireActivity code="GATE-002">
              {status === 'OPEN' && (<><ActionBtn onClick={() => handleAction('pass')} icon={<CheckCircle2 size={13} />} label="Pass" variant="success" disabled={acting} /><ActionBtn onClick={() => handleAction('skip')} icon={<SkipForward size={13} />} label="Skip" variant="outline" disabled={acting} /></>)}
            </RequireActivity>
            <RequireActivity code="SHP-005">
              {status === 'PASSED' && <ActionBtn onClick={() => handleAction('revert')} icon={<RotateCcw size={13} />} label="Revert" variant="outline" disabled={acting} />}
            </RequireActivity>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type DndInputsDraft = {
  carrierName: string;
  scac: string;
  matchedTariffId?: string | null;
  dndStatus?: string;
  lastFreeDay?: string | null;
  chargeableDays?: number | null;
  estimatedCharge?: number | null;
  currency?: string | null;
  basis?: string | null;
  startEvent: string;
  freeDays: string;
  pricingMethod: string;
  startDate: string;
  endDate: string;
  excludeWeekends: boolean;
  excludeHolidays: boolean;
  carrierState: 'matched' | 'unrecognized' | 'no-tariff';
};

type DndMatchedOptions = {
  events: string[];
  freeDaysByEvent: Record<string, string[]>;
  pricingMethods: string[];
  exclusionDefault: { weekends?: boolean; holidays?: boolean };
  chargeTypes: string[];
};
const EMPTY_DND_OPTIONS: DndMatchedOptions = {
  events: [],
  freeDaysByEvent: {},
  pricingMethods: [],
  exclusionDefault: { weekends: true, holidays: false },
  chargeTypes: [],
};
const DND_METHOD_LABELS: Record<string, string> = {
  flat: 'Flat Daily Rate',
  tier: 'Tier Multiplier',
  slab: 'Slab Pricing',
};

function blankDndInputsDraft(): DndInputsDraft {
  return {
    carrierName: '',
    scac: '',
    startEvent: '',
    freeDays: '',
    pricingMethod: '',
    startDate: '',
    endDate: '',
    excludeWeekends: true,
    excludeHolidays: true,
    carrierState: 'matched',
  };
}

function DndFieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{children}</div>;
}

function DndSectionTitle({ title, desc }: { title: string; desc: string }) {
  return <div className="mb-3"><h3 className="m-0 text-[14px] font-semibold">{title}</h3><p className="m-0 mt-1 text-[12px] text-muted-foreground">{desc}</p></div>;
}

function daysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function addDays(date: string, days: number) {
  if (!date || days < 1) return '';
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days - 1);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function freeDayCount(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function ShipmentDndInputsDialog({
  open,
  shipmentId,
  bolCarrierName,
  origin,
  destination,
  cargo,
  onOpenChange,
}: {
  open: boolean;
  shipmentId: string;
  bolCarrierName?: string | null;
  origin?: string | null;
  destination?: string | null;
  cargo?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<DndInputsDraft>(blankDndInputsDraft);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [matchStatus, setMatchStatus] = useState<'idle' | 'matched' | 'carrier-review' | 'no-match'>('idle');
  const [matchedOptions, setMatchedOptions] = useState<DndMatchedOptions>(EMPTY_DND_OPTIONS);
  const totalDays = daysBetween(draft.startDate, draft.endDate);
  const freeDays = freeDayCount(draft.freeDays);
  const chargeableDays = Math.max(totalDays - freeDays, 0);
  const lastFreeDay = addDays(draft.startDate, freeDays);
  const isActivated = draft.dndStatus === 'ACTIVATED' || Boolean(draft.startEvent && draft.freeDays && draft.pricingMethod && matchStatus === 'matched');
  const displayCarrierName = draft.carrierName || bolCarrierName;
  const freeDayOptions = matchedOptions.freeDaysByEvent[draft.startEvent] ?? [];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const baseDraft = { ...blankDndInputsDraft(), carrierName: bolCarrierName ?? '' };
    setSaveNote(null);
    setShowRules(false);
    if (!bolCarrierName) {
      setMatchStatus('carrier-review');
      setMatchedOptions(EMPTY_DND_OPTIONS);
    }
    Promise.all([
      apiGet<{ data: Partial<DndInputsDraft> | null }>(`/dnd/inputs/${shipmentId}`).catch(() => ({ data: null })),
      bolCarrierName
        ? apiPost<{ data: { status: string; tariff: any | null; options: DndMatchedOptions } }>('/dnd/tariffs/match', {
            carrierName: bolCarrierName,
            origin,
            destination,
            cargo: cargo || 'FCL',
            chargeTypes: ['Demurrage', 'Detention'],
          }).catch(() => ({ data: { status: 'NO_MATCHING_TARIFF', tariff: null, options: EMPTY_DND_OPTIONS } }))
        : Promise.resolve({ data: { status: 'CARRIER_REVIEW', tariff: null, options: EMPTY_DND_OPTIONS } }),
    ])
      .then(([inputsResponse, matchResponse]) => {
        if (cancelled) return;
        const options = matchResponse.data.options ?? EMPTY_DND_OPTIONS;
        const matchedTariffId = matchResponse.data.tariff?.id ?? null;
        setMatchedOptions(options);
        setMatchStatus(matchResponse.data.status === 'MATCHED' ? 'matched' : bolCarrierName ? 'no-match' : 'carrier-review');
        setDraft({
          ...baseDraft,
          excludeWeekends: options.exclusionDefault.weekends ?? baseDraft.excludeWeekends,
          excludeHolidays: options.exclusionDefault.holidays ?? baseDraft.excludeHolidays,
          matchedTariffId,
          ...(inputsResponse.data ?? {}),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, shipmentId, bolCarrierName, origin, destination, cargo]);

  async function saveInputs() {
    try {
      const payload = {
        ...draft,
        carrierName: draft.carrierName || bolCarrierName || null,
        origin,
        destination,
        cargo: cargo || 'FCL',
        chargeTypes: matchedOptions.chargeTypes.length ? matchedOptions.chargeTypes : ['Demurrage', 'Detention'],
      };
      const response = await apiPut<{ data: Partial<DndInputsDraft> }>(`/dnd/inputs/${shipmentId}`, payload);
      setDraft({ ...blankDndInputsDraft(), ...(response.data ?? payload) });
      setSaveNote('D&D inputs saved for this BOL upload.');
    } catch (error) {
      setSaveNote(error instanceof Error ? error.message : 'Could not save D&D inputs.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-48px)] max-w-4xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Shipment - BOL Upload</DialogTitle>
          <DialogDescription>Operations shipment console inputs for D&D applicability, free time and day-count rules.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 bg-muted/20 px-6 py-5">
          <section className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <DndFieldLabel>Shipment</DndFieldLabel>
                <div className="text-[22px] font-semibold leading-tight">{displayCarrierName || 'Field not in the file (Carrier Name)'}</div>
              </div>
              <Badge intent={draft.carrierState === 'matched' ? 'success' : 'warning'} size="sm">
                {matchStatus === 'matched' ? 'Auto Detected' : matchStatus === 'carrier-review' ? 'Carrier Review' : 'No Matching Tariff'}
              </Badge>
            </div>
            {matchStatus === 'carrier-review' && (
              <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-[13px] text-destructive">
                Carrier could not be matched from the BOL. Logistics Admin review is required before D&D can be activated.
              </div>
            )}
            {matchStatus === 'no-match' && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
                No Published D&D tariff matches this carrier, route, cargo and charge combination.
              </div>
            )}
          </section>

          <section className="rounded-md border border-border p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <DndSectionTitle title="D&D Configuration" desc="Select only the applicable free-time window and chargeable-day rules for this shipment." />
              <Badge intent={isActivated ? 'success' : 'neutral'} size="sm">{isActivated ? 'D&D Activated' : 'Awaiting Inputs'}</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <DndFieldLabel>Start Event *</DndFieldLabel>
                <RequireActivity
                  code="dnd.activate.start_event_date"
                  fallback={<Select value={draft.startEvent || undefined} disabled><SelectTrigger><SelectValue placeholder="No permission" /></SelectTrigger></Select>}
                >
                  <Select value={draft.startEvent || undefined} disabled={matchStatus !== 'matched'} onValueChange={(startEvent) => setDraft({ ...draft, startEvent, freeDays: '' })}>
                    <SelectTrigger><SelectValue placeholder="Select start event" /></SelectTrigger>
                    <SelectContent>{matchedOptions.events.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </RequireActivity>
              </div>
              <div>
                <DndFieldLabel>Free Days *</DndFieldLabel>
                <Select value={draft.freeDays || undefined} disabled={matchStatus !== 'matched' || !draft.startEvent} onValueChange={(freeDays) => setDraft({ ...draft, freeDays })}>
                  <SelectTrigger><SelectValue placeholder="Select free days" /></SelectTrigger>
                  <SelectContent>{freeDayOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                </Select>
                <p className="m-0 mt-1 text-[12px] text-muted-foreground">Options are Admin-curated master data from the matching Published tariff.</p>
              </div>
              <div>
                <DndFieldLabel>Pricing Method *</DndFieldLabel>
                <Select value={draft.pricingMethod || undefined} disabled={matchStatus !== 'matched'} onValueChange={(pricingMethod) => setDraft({ ...draft, pricingMethod })}>
                  <SelectTrigger><SelectValue placeholder="Select pricing method" /></SelectTrigger>
                  <SelectContent>{matchedOptions.pricingMethods.map((item) => <SelectItem key={item} value={item}>{DND_METHOD_LABELS[item] ?? item}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-3">
                <DndFieldLabel>Day Count Basis</DndFieldLabel>
                <RequireActivity code="dnd.activate.weekends">
                  <label className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={draft.excludeWeekends} onCheckedChange={(checked) => setDraft({ ...draft, excludeWeekends: checked === true })} />
                    Exclude weekends from chargeable day count
                  </label>
                </RequireActivity>
                <RequireActivity code="dnd.activate.holiday_days">
                  <label className="flex items-center gap-2 text-[13px]">
                    <Checkbox checked={draft.excludeHolidays} onCheckedChange={(checked) => setDraft({ ...draft, excludeHolidays: checked === true })} />
                    Exclude public holidays from chargeable day count
                  </label>
                </RequireActivity>
              </div>
              <div>
                <DndFieldLabel>Start Date *</DndFieldLabel>
                <RequireActivity
                  code="dnd.activate.start_event_date"
                  fallback={<Input type="date" value={draft.startDate} disabled />}
                >
                  <Input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
                </RequireActivity>
              </div>
              <div>
                <DndFieldLabel>Return / End Date</DndFieldLabel>
                <Input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} />
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border p-4">
            <DndSectionTitle title="LFD Preview" desc="Preview uses the same selected rule inputs that will be saved for the shipment." />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border bg-background p-3">
                <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Last Free Day</div>
                <div className="mt-2 text-[18px] font-semibold">{draft.lastFreeDay || lastFreeDay || '-'}</div>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Chargeable Days</div>
                <div className="mt-2 text-[18px] font-semibold">{draft.chargeableDays ?? chargeableDays}</div>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">D&D Status</div>
                <div className="mt-2 text-[18px] font-semibold">{draft.dndStatus || (isActivated ? 'ACTIVATED' : 'PENDING_SELECTION')}</div>
              </div>
            </div>
            {draft.estimatedCharge != null && (
              <div className="mt-3 rounded-md border border-border bg-background p-3 text-[13px]">
                Estimated charge: <span className="font-mono font-semibold">{draft.currency ?? 'USD'} {draft.estimatedCharge.toFixed(2)}</span>
                {draft.basis && <span className="text-muted-foreground"> · {draft.basis}</span>}
              </div>
            )}
            {showRules && (
              <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-[13px] text-foreground">
                Rates, thresholds and slabs stay in D&D Tariff Master. Operations selects the matched event, free days, pricing method and exclusions; those inputs drive LFD and chargeable-day calculation.
              </div>
            )}
            {saveNote && <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-[13px]">{saveNote}</div>}
          </section>
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => setShowRules((value) => !value)} className="mr-auto gap-2"><FileText className="size-4" /> Rules & Logic</Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <RequireActivity code="dnd.activate">
            <Button type="button" onClick={saveInputs} className="gap-2"><CheckCircle2 className="size-4" /> Save D&D Inputs</Button>
          </RequireActivity>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const shipmentId = params.id ?? '';
  const [, navigate] = useLocation();

  // ─── Project context (passed via Wouter history state from ProjectDetailPage) ─
  const projectCtx: ProjectCtx | null =
    (typeof window !== 'undefined' ? (window.history.state as any)?.[PROJECT_CTX_KEY] : null) ?? null;

  const navigateSibling = (direction: 1 | -1, ctx: ProjectCtx) => {
    const nextIndex = ctx.shipmentIndex + direction;
    if (nextIndex < 0 || nextIndex >= ctx.shipmentIds.length) return;
    navigate(SHIPMENT_ROUTE(ctx.shipmentIds[nextIndex]), {
      state: { [PROJECT_CTX_KEY]: { ...ctx, shipmentIndex: nextIndex } },
    } as any);
  };

  const [shipment,   setShipment]   = useState<ApiShipment | null>(null);
  const [gates,      setGates]      = useState<ApiGate[]>([]);
  const [milestones, setMilestones] = useState<ApiMilestoneTracking[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [acting,        setActing]        = useState(false);
  const [trackingMessage, setTrackingMessage] = useState<string | null>(null);
  const [dndInputsOpen, setDndInputsOpen] = useState(false);

  const { data: scData, loading: scLoading, refetch: scRefetch } = useSafeCubeTracking(shipmentId);
  const { documents, loading: docsLoading, refetch: refetchDocs } = useShipmentDocuments(shipmentId);
  const { tickets: acctTickets, loading: acctLoading } = useAccountingTickets({ shipmentId });
  const token = getAuthToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  // Auto-link live tracking silently when no tracking data exists.
  // Fires at most once per mount (ref guard) after the initial fetch completes.
  // Failures (no BOL, not configured, 403) are swallowed — no user-facing prompt.
  const autoLinkedRef = useRef(false);
  useEffect(() => {
    if (scLoading || scData || !shipmentId || autoLinkedRef.current) return;
    autoLinkedRef.current = true;
    const authH: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`/api/shipments/${shipmentId}/safecube/link`, {
      method: 'POST',
      headers: { ...authH, 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          setTrackingMessage(null);
          scRefetch();
        } else {
          setTrackingMessage(j.error ?? j.detail ?? 'SafeCube tracking is not linked yet');
        }
      })
      .catch(() => setTrackingMessage('SafeCube tracking is not reachable'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scLoading]);

  const loadData = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true); setError(null);
    try {
      const [shipRes, gatesRes, msRes] = await Promise.all([
        fetch(`/api/shipments/${shipmentId}`, { headers }),
        fetch(`/api/shipments/${shipmentId}/gates`, { headers }),
        fetch(`/api/tracking/shipments/${shipmentId}/milestones`, { headers }),
      ]);
      if (!shipRes.ok) throw new Error(`Shipment ${shipRes.status}`);
      setShipment((await shipRes.json()).data);
      if (gatesRes.ok) {
        const sorted: ApiGate[] = ((await gatesRes.json()).data ?? []).sort((a: ApiGate, b: ApiGate) => (a.gateConfig?.gateNumber ?? 0) - (b.gateConfig?.gateNumber ?? 0));
        setGates(sorted);
      }
      if (msRes.ok) setMilestones((await msRes.json()).data ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Could not load shipment.');
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleShipmentAction(action: 'hold' | 'resume' | 'cancel') {
    if (action === 'cancel' && !confirm('Cancel this shipment? This cannot be undone.')) return;
    setActing(true);
    try { const r = await fetch(`/api/shipments/${shipmentId}/${action}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }); if (r.ok) await loadData(); }
    finally { setActing(false); }
  }

  // ─── Derived ────────────────────────────────────────────────────────────────
  const containers    = shipment?.containers    ?? [];
  const dndAlerts     = shipment?.dndAlerts     ?? [];
  const partnerTags   = shipment?.partnerTags   ?? [];
  const inventoryItems = shipment?.inventoryItems ?? [];
  const isOnHold      = shipment?.status === 'on_hold';
  const isCancelled   = shipment?.status === 'cancelled';
  const cvState       = containerViewState(scData, milestones, shipment, gates);
  const bolCarrierName = useMemo(() => bolCarrierNameFromDocuments(documents), [documents]);
  const mapProps      = useMemo(() => {
    if (!scData) return null;
    return adaptSafeCubeToMapProps(scData, scData.events ?? []);
  }, [scData]);

  // Shipment value from tickets
  const revTicket = (shipment?.tickets ?? []).find(t => (t.entryType ?? '').toLowerCase().includes('revenue') || (t.entryType ?? '').toLowerCase().includes('invoice'));

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px', minHeight: '100%', maxWidth: 1600, margin: '0 auto', width: '100%' }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shipBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes gateRing{0%{transform:scale(1);opacity:.65}100%{transform:scale(1.9);opacity:0}}
      `}</style>

      {/* Breadcrumb — three-level when arriving from a project, single-level otherwise */}
      {projectCtx ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 14.5, color: MUTED }}>
          <button onClick={() => navigate(PROJECTS_LIST_ROUTE)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'hsl(var(--primary))', fontWeight: 500, fontSize: 14.5 }}>Projects</button>
          <span style={{ opacity: 0.5 }}>›</span>
          <button onClick={() => navigate(PROJECT_DETAIL_ROUTE(projectCtx.projectId))} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'hsl(var(--primary))', fontWeight: 500, fontSize: 14.5 }}>{projectCtx.projectRef}</button>
          <span style={{ opacity: 0.5 }}>›</span>
          <span className="vs-mono">{shipment?.shipmentNumber ?? shipmentId}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 14.5, color: MUTED }}>
          <button onClick={() => navigate('/dashboard')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'hsl(var(--primary))', fontWeight: 500, fontSize: 14.5 }}>← Shipments</button>
          <span>/</span>
          <span className="vs-mono">{shipment?.shipmentNumber ?? shipmentId}</span>
        </div>
      )}

      {/* Project context bar — only visible when navigated from a project detail page */}
      {projectCtx && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', marginBottom: 12,
          background: 'hsl(var(--card))', border: `1px solid ${BDR}`,
          borderRadius: 8, gap: 12, flexWrap: 'wrap',
        }}>
          {/* Left — project identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <i className="ti ti-folder" style={{ fontSize: 15, color: MUTED }} aria-hidden="true" />
            <span style={{ fontWeight: 600, fontSize: 14, color: FG, letterSpacing: '0.01em' }}>
              {projectCtx.projectRef}
            </span>
            {projectCtx.projectName && (
              <span style={{ fontSize: 14, color: MUTED }}>{projectCtx.projectName}</span>
            )}
            <span style={{
              ...getProjectStatusStyle(projectCtx.projectStatus),
              fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em',
              textTransform: 'uppercase', padding: '2px 8px', borderRadius: 5,
            }}>
              {projectCtx.projectStatus}
            </span>
          </div>

          {/* Right — sibling navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: MUTED, marginRight: 2 }}>
              Shipment {projectCtx.shipmentIndex + 1} of {projectCtx.shipmentIds.length}
            </span>
            <button
              disabled={projectCtx.shipmentIndex === 0}
              onClick={() => navigateSibling(-1, projectCtx)}
              aria-label="Previous shipment in project"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', fontSize: 13, fontWeight: 500,
                border: `1px solid ${BDR}`, borderRadius: 7,
                background: 'hsl(var(--background))', cursor: projectCtx.shipmentIndex === 0 ? 'not-allowed' : 'pointer',
                color: projectCtx.shipmentIndex === 0 ? MUTED : FG,
                opacity: projectCtx.shipmentIndex === 0 ? 0.45 : 1,
              }}
            >
              <i className="ti ti-chevron-left" style={{ fontSize: 13 }} aria-hidden="true" />
              Prev
            </button>
            <button
              disabled={projectCtx.shipmentIndex === projectCtx.shipmentIds.length - 1}
              onClick={() => navigateSibling(1, projectCtx)}
              aria-label="Next shipment in project"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', fontSize: 13, fontWeight: 500,
                border: `1px solid ${BDR}`, borderRadius: 7,
                background: 'hsl(var(--background))',
                cursor: projectCtx.shipmentIndex === projectCtx.shipmentIds.length - 1 ? 'not-allowed' : 'pointer',
                color: projectCtx.shipmentIndex === projectCtx.shipmentIds.length - 1 ? MUTED : FG,
                opacity: projectCtx.shipmentIndex === projectCtx.shipmentIds.length - 1 ? 0.45 : 1,
              }}
            >
              Next
              <i className="ti ti-chevron-right" style={{ fontSize: 13 }} aria-hidden="true" />
            </button>
            <button
              onClick={() => navigate(PROJECT_DETAIL_ROUTE(projectCtx.projectId))}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', fontSize: 13, fontWeight: 500,
                border: `1px solid ${BDR}`, borderRadius: 7,
                background: 'hsl(var(--background))', cursor: 'pointer',
                color: 'hsl(var(--primary))',
              }}
            >
              <i className="ti ti-layout-list" style={{ fontSize: 13 }} aria-hidden="true" />
              All shipments
            </button>
          </div>
        </div>
      )}

      {/* Voyage stepper — full width */}
      {/* Alerts banner — active tracking alerts from SafeCube */}
      <VoyageProgressDocumentTracker
        documents={documents}
        loading={docsLoading}
        gates={gates}
        shipment={shipment}
        scData={scData}
      />

      {!scLoading && <AlertsBanner scData={scData} />}

      {/* Context strip */}
      {!loading && <ContextStrip shipment={shipment} gates={gates} scData={scData} documents={documents} />}

      {/* Page header — sticky so identity + actions stay visible while scrolling */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'hsl(var(--background))',
        marginLeft: -28, marginRight: -28,
        paddingLeft: 28, paddingRight: 28,
        paddingTop: 10, paddingBottom: 10,
        borderBottom: `1px solid ${BDR}`,
        boxShadow: '0 2px 12px hsl(var(--background) / 0.95)',
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: FG, margin: 0, lineHeight: 1.15 }}>
                {loading ? 'Loading…' : (shipment?.shipmentNumber ?? shipmentId)}
              </h2>
              {shipment && !loading && <StatusPill status={shipment.currentStageName ?? shipment.status} variant="transit" />}
              {isOnHold    && <StatusPill status="On Hold" variant="warning" />}
              {isCancelled && <StatusPill status="Cancelled" variant="danger" />}
            </div>
            {shipment && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 14px', fontSize: 14.5, color: MUTED }}>
                {shipment.loadMode && <span style={{ fontWeight: 500, color: FG }}>Load: {shipment.loadMode}</span>}
                {shipment.blNumber && <span>MBL: <span className="vs-mono" style={{ fontWeight: 600, color: FG }}>{shipment.blNumber}</span></span>}
                {shipment.vesselName && <span>Vessel: <span className="vs-mono" style={{ fontWeight: 600, color: FG }}>{shipment.vesselName}</span></span>}
                {(shipment.portOfLoading || shipment.portOfDischarge) && <span>Route: <span className="vs-mono" style={{ fontWeight: 600, color: FG }}>{shipment.portOfLoading ?? '—'} → {shipment.portOfDischarge ?? '—'}</span></span>}
                {revTicket && <span>Value: <span className="vs-mono" style={{ fontWeight: 600, color: FG }}>{fmtAmount(revTicket.amount, revTicket.currency)}</span></span>}
                {(shipment as any).project && <a href={`/projects/${(shipment as any).project.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: TEAL, textDecoration: 'none', fontSize: 14 }}><FolderOpen size={12} />{(shipment as any).project.projectCode}</a>}
              </div>
            )}
            {error && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, color: 'hsl(var(--vs-danger))' }}><AlertCircle size={14} /><span style={{ fontSize: 14.5 }}>{error}</span></div>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <ActionBtn onClick={() => setDndInputsOpen(true)} icon={<Calculator size={14} />} label="D&D Inputs" variant="outline" />
            <RequireActivity code="GATE-002">
              {isOnHold
                ? <ActionBtn onClick={() => handleShipmentAction('resume')} icon={<PlayCircle size={14} />} label="Resume" variant="success" disabled={acting} />
                : <ActionBtn onClick={() => handleShipmentAction('hold')} icon={<PauseCircle size={14} />} label="Hold" variant="outline" disabled={acting || isCancelled} />
              }
            </RequireActivity>
            <RequireActivity code="SHP-005">
              {!isCancelled && <ActionBtn onClick={() => handleShipmentAction('cancel')} icon={<XCircle size={14} />} label="Cancel" variant="danger" disabled={acting} />}
            </RequireActivity>
            <ActionBtn onClick={() => navigate(`/shipments/${shipmentId}/documents`)} icon={<FileText size={14} />} label="Document matrix" variant="outline" />
          </div>
        </div>
      </div>

      {/* ── Vessel route map ── */}
      <ShipmentDndInputsDialog
        open={dndInputsOpen}
        shipmentId={shipmentId}
        bolCarrierName={bolCarrierName}
        origin={shipment?.portOfLoading}
        destination={shipment?.portOfDischarge}
        cargo={shipment?.loadMode?.toUpperCase().includes('BREAK') ? 'Breakbulk' : 'FCL'}
        onOpenChange={setDndInputsOpen}
      />

      {!scLoading && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: MUTED, margin: 0 }}>Vessel tracking</h3>
            {mapProps?.shippingStatus && (
              <span style={{ fontSize: 11, color: MUTED }}>{mapProps.shippingStatus}</span>
            )}
          </div>
          {mapProps ? (
            <VesselRouteMap {...mapProps} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 260, borderRadius: 8, background: '#071e32', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)' }}>
                {trackingMessage ?? 'Waiting for SafeCube tracking from MBL or booking reference'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 2-column 360° body ── */}
      <style>{`
        @media (max-width: 1279px) {
          .shipment-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div className="shipment-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 55fr) minmax(0, 45fr)', gap: 20, alignItems: 'start' }}>

        {/* LEFT — Inventory Journey + Containers */}
        <div>
          {loading ? (
            <Card><div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[1,2,3,4,5].map(i => <SkeletonRow key={i} width={280} />)}</div></Card>
          ) : (
            <>
              <InventoryJourneyPanel scData={scData} milestones={milestones} shipment={shipment} inventoryItems={inventoryItems} packingListItems={shipment?.packingListItems ?? []} />
              {(containers.length > 0 || shipment?.loadMode === 'FCL') && (
                <ContainerGridPanel containers={containers} scData={scData} dndAlerts={dndAlerts} viewState={cvState} packingListItems={shipment?.packingListItems ?? []} />
              )}
            </>
          )}
        </div>

        {/* RIGHT — Documents + Accounting */}
        <div>
          <DocumentsPanel360 documents={documents} loading={docsLoading} gates={gates} />
          {!loading && shipment && (() => {
            // Order-within-gate: inward at 3PL = the last milestone (by milestoneNumber) of the
            // last PASSED US-geography gate is COMPLETED with a completedAt timestamp.
            // The "last milestone within a gate" is the gate's completion step — the structural
            // slot that represents "this phase is done."  Degrades neutrally when absent.
            const passedUsGates = gates
              .filter(g => g.status === 'PASSED' && g.gateConfig.geography === 'US')
              .sort((a, b) => a.gateConfig.gateNumber - b.gateConfig.gateNumber);
            const inwardGate      = passedUsGates.at(-1); // last PASSED US gate = 3PL/inward gate
            const inwardLastMs    = inwardGate ? lastMilestoneOfGate(milestones, inwardGate.gateConfigId) : undefined;
            const inwardMilestone = (inwardLastMs?.status === 'COMPLETED' && inwardLastMs.completedAt)
              ? inwardLastMs
              : undefined;
            if (!inwardMilestone) return null;
            const warehouseTag = (shipment.partnerTags ?? []).find(
              t => t.partner.partnerType === 'THREE_PL' || t.partner.partnerType === '3PL',
            );
            const warehouseName = warehouseTag?.partner.companyName ?? 'Warehouse';
            const inwardDate = inwardMilestone.completedAt;
            const totalUnits = (shipment.inventoryItems ?? []).reduce(
              (sum: number, item: { bundleCount?: number | null }) => sum + (item.bundleCount ?? 0), 0
            );
            return (
              <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 8, border: '1px solid hsla(142,71%,45%,0.3)', background: 'hsla(142,71%,45%,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={15} color={GREEN} />
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(142 71% 30%)' }}>
                    Inwarded —{totalUnits > 0 ? ` ${totalUnits.toLocaleString()} units` : ''} at {warehouseName}
                  </div>
                  {inwardDate && <div style={{ fontSize: 14.5, color: MUTED, marginTop: 1 }}>{fmtDate(inwardDate)}</div>}
                </div>
              </div>
            );
          })()}
          <AccountingPanel360 tickets={acctTickets} loading={acctLoading} />

          {/* Partners (compact) */}
          {!loading && partnerTags.length > 0 && (
            <Card style={{ marginTop: 0, padding: '16px 20px' }}>
              <SectionLabel><Users size={12} style={{ display: 'inline', marginRight: 5 }} />Partners</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {partnerTags.map(tag => (
                  <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'hsl(var(--background))', border: `1px solid ${BDR}` }}>
                    <div style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'hsl(var(--primary)/0.1)', color: 'hsl(var(--primary))', fontSize: 13, fontWeight: 700 }}>
                      {(tag.partner.partnerType || 'P').substring(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag.partner.companyName}</div>
                      <div style={{ fontSize: 14.5, color: MUTED }}>{tag.partner.partnerType?.replace(/_/g, ' ')}</div>
                    </div>
                    {tag.tagSource === 'auto' && <span style={{ fontSize: 14, padding: '2px 5px', borderRadius: 8, background: 'hsl(var(--muted))', color: MUTED }}>Auto</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

    </div>
  );
}
