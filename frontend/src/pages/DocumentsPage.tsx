import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useConfig } from '@/contexts/ConfigContext';
import { usePageMeta } from '@/contexts/PageMetaContext';
import type { ConfigTemplate, ConfigDocType } from '@/contexts/ConfigContext';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';
import {
  DOCUMENT_GATE_DEFS,
  documentGateForDocType,
} from '@/config/documentGateConfig';
import {
  Upload,
  Loader2,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Check,
  AlertCircle,
  AlertTriangle,
  Circle,
  Search,
  Clock,
} from 'lucide-react';
import { StatusPill, DocBadge, FilterChips } from '@/components/vs';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Gate view — types ───────────────────────────────────────────────────────

type GateStatus = 'passed' | 'active' | 'future' | 'blocked';
type DocStatus  = 'closed' | 'processing' | 'review' | 'gen-closed' | 'gen-review'
                | 'failed-block' | 'failed-warn' | 'expected' | 'na';

interface DocEntry {
  code: string;
  label: string;
  status: DocStatus;
  count?: number;
  docNumber?: string;
  ruleCode?: string;
  docId?: string;
  genType?: string;
  isGenerated?: boolean;
  isParallel?: boolean;
}

interface GateCol {
  name: string;
  label: string;
  status: GateStatus;
  docCount: string;
  docs: DocEntry[];
}

interface ShipmentLane {
  id: string;
  isPending?: boolean;
  shipmentId: string;
  vessel: string;
  meta: string;
  gateStatuses: GateStatus[];
  docSummary: string;
  statusLabel: string;
  statusVariant: 'pending' | 'cleared' | 'danger' | 'info';
  gates: GateCol[];
  parallel: DocEntry[];
  // SafeCube timing + port labels for voyage strip override
  scPolAt?: string | null;
  scPodAt?: string | null;
  scPodEta?: string | null;
  scScheduleStatus?: string | null;
  scPolName?: string | null;
  scPolLocode?: string | null;
  scPodName?: string | null;
  scPodLocode?: string | null;
  scPrepodName?: string | null;
  scPrepodLocode?: string | null;
  scPostpodName?: string | null;
  scPostpodLocode?: string | null;
}

// ─── Gate view — color tokens ────────────────────────────────────────────────

const TEAL    = 'hsl(var(--vs-teal))';
const GREEN   = 'hsl(var(--vs-success))';
const AMBER   = 'hsl(38 92% 50%)';
const RED     = 'hsl(var(--vs-danger))';
const GOLD    = 'hsl(38 92% 50%)';
const INFO    = 'hsl(201 96% 32%)';
const FG      = 'hsl(var(--foreground))';
const MUTED   = 'hsl(var(--muted-foreground))';
const BORDER  = 'hsl(var(--border))';
const CARD_BG = 'hsl(var(--card))';

// ─── Gate view — constants ───────────────────────────────────────────────────

const GATE_DEFS = DOCUMENT_GATE_DEFS.map(gate => ({
  label: gate.label,
  required: gate.docs
    .filter(doc => doc.role !== 'PARALLEL')
    .map(doc => ({ code: doc.code, label: doc.label })),
  parallel: gate.docs
    .filter(doc => doc.role === 'PARALLEL')
    .map(doc => ({ code: doc.code, label: doc.label })),
}));

// ─── Gate view — API mapping ─────────────────────────────────────────────────

interface ApiDoc {
  id: string; documentType: string; documentNumber?: string;
  status?: string | null;
  ocrStatus: string; validationStatus: string;
  approvedAt: string | null; isGenerated: boolean;
  gateNumber?: number | null;
  gateCode?: string | null;
  isParallel?: boolean;
}
interface ApiShipmentGate {
  gateConfigId: string;
  status: string;            // FUTURE | ACTIVE | PASSED | BLOCKED | SKIPPED
  passedAt: string | null;
  blockedReason: string | null;
  gateConfig: { gateNumber: number; gateName: string };
}

interface ApiShipment {
  id: string; shipmentNumber: string; status: string;
  blNumber?: string | null; bolNumber?: string | null;
  hblNumber?: string | null; mblNumber?: string | null;
  bookingNumber?: string | null;
  blockedReason?: string; currentStage: number; currentStageName?: string;
  templateId?: string;
  vesselName?: string; portOfLoading?: string; portOfDischarge?: string;
  exporterName?: string; buyerName?: string;
  documents: ApiDoc[];
  shipmentGates?: ApiShipmentGate[];
  _count: { documents: number };
  // SafeCube enrichment fields (added by GET /api/shipments backend)
  safecubeLinked?: boolean;
  safecubePolAt?: string | null;
  safecubePodAt?: string | null;
  safecubePodEta?: string | null;
  safecubeScheduleStatus?: string | null;
  safecubePolName?: string | null;
  safecubePolLocode?: string | null;
  safecubePodName?: string | null;
  safecubePodLocode?: string | null;
  safecubePrepodName?: string | null;
  safecubePrepodLocode?: string | null;
  safecubePostpodName?: string | null;
  safecubePostpodLocode?: string | null;
}

function validationDone(status?: string | null): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'PASSED';
}

function validationFailed(status?: string | null): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return normalized === 'FAILED' || normalized === 'BLOCKED' || normalized === 'FAIL';
}

function validationPending(status?: string | null): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return !normalized || normalized === 'WAITING' || normalized === 'WARNING' || normalized === 'WARNED' || normalized === 'PENDING';
}

function apiDocStatus(d: ApiDoc): DocStatus {
  const ocrStatus = String(d.ocrStatus ?? '').toLowerCase();
  const recordStatus = String((d as ApiDoc & { status?: string | null }).status ?? '').toLowerCase();
  const isReviewed = ['reviewed', 'archived', 'approved', 'completed', 'done'].includes(recordStatus);
  const isCompleteOcr = ['reviewed', 'archived', 'approved', 'completed', 'complete', 'done', 'generated', 'confirmed'].includes(ocrStatus);
  if (d.approvedAt || isReviewed || isCompleteOcr || validationDone(d.validationStatus)) return d.isGenerated ? 'gen-closed' : 'closed';
  if (ocrStatus === 'failed' || validationFailed(d.validationStatus)) return 'failed-block';
  if (ocrStatus === 'extracted') return d.isGenerated ? 'gen-review' : 'review';
  return 'processing';
}

const DOC_STATUS_PRIORITY: Record<DocStatus, number> = {
  'failed-block': 7,
  'failed-warn': 6,
  processing: 5,
  review: 4,
  'gen-review': 4,
  'gen-closed': 3,
  closed: 3,
  expected: 1,
  na: 0,
};

function strongestDocStatus(entries: DocEntry[]): DocStatus {
  return entries.reduce(
    (strongest, entry) =>
      DOC_STATUS_PRIORITY[entry.status] > DOC_STATUS_PRIORITY[strongest]
        ? entry.status
        : strongest,
    entries[0]?.status ?? 'na',
  );
}

function strongestDocEntry(entries: DocEntry[]): DocEntry {
  return entries.reduce((strongest, entry) => (
    DOC_STATUS_PRIORITY[entry.status] > DOC_STATUS_PRIORITY[strongest.status]
      ? entry
      : strongest
  ), entries[0]);
}

function collapseDuplicateDocs(entries: DocEntry[]): DocEntry[] {
  const grouped = new Map<string, DocEntry[]>();
  const order: string[] = [];
  const normalized = (value?: string) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  for (const entry of entries) {
    const key = `${entry.code}|${entry.isParallel ? 'parallel' : 'main'}|${entry.genType ?? ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(key);
    }
    grouped.get(key)!.push(entry);
  }

  return order.map(key => {
    const rawGroup = grouped.get(key)!;
    const duplicateGroups = new Map<string, DocEntry[]>();
    const duplicateOrder: string[] = [];
    for (const entry of rawGroup) {
      const ref = normalized(entry.docNumber);
      const duplicateKey = ref ? `ref:${entry.code}:${ref}` : entry.docId ? `id:${entry.docId}` : `row:${duplicateOrder.length}`;
      if (!duplicateGroups.has(duplicateKey)) {
        duplicateGroups.set(duplicateKey, []);
        duplicateOrder.push(duplicateKey);
      }
      duplicateGroups.get(duplicateKey)!.push(entry);
    }
    const group = duplicateOrder.map(duplicateKey => {
      const duplicates = duplicateGroups.get(duplicateKey)!;
      return strongestDocEntry(duplicates);
    });
    if (group.length === 0) {
      return strongestDocEntry(rawGroup);
    }
    if (group.length === 1) return group[0];

    const first = group[0];
    return {
      ...first,
      status: strongestDocStatus(group),
      count: group.length,
      label: `${first.label} (${group.length})`,
      docNumber: first.docNumber ?? `${group.length} documents`,
      ruleCode: group.find(item => item.ruleCode)?.ruleCode,
    };
  });
}

// ─── Template-driven gate structure ──────────────────────────────────────────

interface TemplateDef {
  gateDefs: Array<{ label: string; required: Array<{ code: string; label: string; isGenerated: boolean }> }>;
  gateConfigIds: string[];   // gateConfigId in sortOrder — used to match shipmentGates
  docTypeMap: Map<string, { gateIdx: number; code: string; label: string; isGenerated: boolean }>;
  parallelDefs: Array<{ code: string; label: string; isGenerated: boolean }>;
  parallelTypeSet: Set<string>;
}

function buildTemplateDef(template: ConfigTemplate, docTypes: ConfigDocType[]): TemplateDef {
  const gateDefs: TemplateDef['gateDefs'] = [];
  const gateConfigIds: string[] = [];
  const docTypeMap = new Map<string, { gateIdx: number; code: string; label: string; isGenerated: boolean }>();
  const parallelDefs: Array<{ code: string; label: string; isGenerated: boolean }> = [];
  const parallelTypeSet = new Set<string>();

  const sortedGates = [...(template.gates ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  for (let idx = 0; idx < sortedGates.length; idx++) {
    const gate = sortedGates[idx];
    gateConfigIds.push(gate.id);
    const required: Array<{ code: string; label: string; isGenerated: boolean }> = [];

    for (const dtg of [...(gate.docTypeGates ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const dt = docTypes.find(d => d.typeCode === dtg.docType);
      const code  = dt?.shortCode ?? dtg.docType.slice(0, 3).toUpperCase();
      const label = dt?.displayName ?? dtg.docType;

      if (dtg.roleInGate === 'PARALLEL') {
        parallelTypeSet.add(dtg.docType.toUpperCase());
        if (!parallelDefs.some(p => p.code === code)) parallelDefs.push({ code, label, isGenerated: dtg.isGenerated });
      } else {
        required.push({ code, label, isGenerated: dtg.isGenerated });
        docTypeMap.set(dtg.docType.toUpperCase(), { gateIdx: idx, code, label, isGenerated: dtg.isGenerated });
      }
    }
    gateDefs.push({ label: gate.gateName, required });
  }

  for (const dtg of (template.docTypeGates ?? [])) {
    const dt = docTypes.find(d => d.typeCode === dtg.docType);
    const code  = dt?.shortCode ?? dtg.docType.slice(0, 3).toUpperCase();
    const label = dt?.displayName ?? dtg.docType;
    parallelTypeSet.add(dtg.docType.toUpperCase());
    if (!parallelDefs.some(p => p.code === code)) parallelDefs.push({ code, label, isGenerated: dtg.isGenerated });
  }

  return { gateDefs, gateConfigIds, docTypeMap, parallelDefs, parallelTypeSet };
}

// Fallback: string-pattern gate lookup (used when no template is found)
function docTypeToGate(dt: string): { gate: number; code: string; label: string; isParallel?: boolean } | null {
  const t = dt.toUpperCase();
  const canonical = documentGateForDocType(t);
  if (canonical) {
    return {
      gate: canonical.gateNumber,
      code: canonical.doc.code,
      label: canonical.doc.label,
      isParallel: canonical.doc.role === 'PARALLEL',
    };
  }
  if (t === 'US_PACKING_LIST' || t.includes('US_PACKING')) return { gate: 5, code: 'UP', label: 'US Packing List' };
  if (t === 'US_SALES_INVOICE' || t.includes('US_SALES')) return { gate: 5, code: 'UI', label: 'US Sales Invoice' };
  if (t === 'SI' || t.includes('SALES_INVOICE')) return { gate: 1, code: 'SI', label: 'Sales Invoice' };
  if ((t === 'PL' || t.includes('PACKING_LIST') || t === 'PACKING-LIST') && !t.includes('OUTWARD')) return { gate: 1, code: 'PL', label: 'Packing List' };
  if (t === 'SB' || t.includes('SHIPPING_BILL')) return { gate: 1, code: 'SB', label: 'Shipping Bill' };
  if (t === 'BOL' || t === 'BL' || t.includes('BILL_OF_LADING')) return { gate: 2, code: 'BL', label: 'Bill of Lading' };
  if (t === 'DRAFT_CBP_FORM_7501_BROKER' || t.includes('DRAFT_CBP') || t === 'DRAFT-BOE' || (t.includes('BOE') && t.includes('DRAFT'))) {
    return { gate: 2, code: 'CB', label: 'Draft CBP FORM 7501 Broker' };
  }
  if (t === 'CHA_BILL' || t === 'CHA') return { gate: 1, code: 'CH', label: 'CHA Bill', isParallel: true };
  if (t === 'FREIGHT_FORWARDER_BILL' || t.includes('FREIGHT_FORWARDER')) return { gate: 2, code: 'FF', label: 'Freight Forwarder Bill', isParallel: true };
  if (t === 'ISF' || t.includes('IMPORTER_SECURITY')) return { gate: 3, code: 'IS', label: 'ISF Filing' };
  if ((t === 'ENTRY_SUMMARY' || t === 'BOE' || t.includes('BILL_OF_ENTRY') || t.includes('CBP_FORM_7501')) && !t.includes('DRAFT')) return { gate: 3, code: 'CBP', label: 'CBP FORM 7501' };
  if (t === 'CRO' || t.includes('CARGO_RELEASE') || t.includes('US_CARGO')) return { gate: 3, code: 'CR', label: 'Cargo Release Order' };
  if (t.includes('CUSTOMS_RELEASE') || t.includes('US_CUSTOMS')) return { gate: 3, code: 'CU', label: 'Customs Release Order' };
  if (t === 'OCEAN_FREIGHT' || t.includes('OCEAN_FREIGHT')) return { gate: 3, code: 'OF', label: 'Ocean Freight Invoice', isParallel: true };
  if (t === 'CUSTOMER_BROKER_BILL' || t.includes('CUSTOM_BROKER') || t.includes('CUSTOMS_BROKER')) return { gate: 3, code: 'BB', label: 'US Custom Broker Bill', isParallel: true };
  if (t.includes('DND') || t.includes('DEMURRAGE') || t.includes('DETENTION')) return { gate: 3, code: 'DD', label: 'D&D Charge', isParallel: true };
  if (t === 'DO' || t.includes('DELIVERY_ORDER')) return { gate: 4, code: 'DO', label: 'Delivery Order' };
  if (t === 'GR' || t === 'GRN_INBOUND' || t.includes('GOODS_RECEIPT')) return { gate: 4, code: 'GR', label: 'GRN Inbound' };
  if (t === 'PORT_TO_WH' || t.includes('PORT_TO_WAREHOUSE')) return { gate: 4, code: 'PW', label: 'Port to Warehouse Bill', isParallel: true };
  if (t === 'OUTWARD_GRN' || t.includes('OUTWARD_GRN')) return { gate: 5, code: 'OG', label: 'Outward GRN' };
  if (t.includes('POD') || t.includes('PROOF_OF_DELIVERY')) return { gate: 5, code: 'PD', label: 'Proof of Delivery' };
  if (t === 'WH_TO_CUSTOMER' || t.includes('WAREHOUSE_TO_CUSTOMER')) return { gate: 5, code: 'WC', label: 'Warehouse to Customer Bill', isParallel: true };
  return null;
}

function shipmentToLane(
  s: ApiShipment,
  _templates: ConfigTemplate[],
  _docTypes: ConfigDocType[],
): ShipmentLane {
  const blocked   = !!s.blockedReason;
  const gateCount = GATE_DEFS.length;

  const stage = Math.max(1, s.currentStage ?? 1);

  const bolPresent = (s.documents ?? []).some(d => {
    const t = d.documentType.toUpperCase();
    return t === 'BOL' || t === 'BL' || t.includes('BILL_OF_LADING');
  });
  const plApproved = (s.documents ?? []).some(d => {
    const t = d.documentType.toUpperCase();
    return (t === 'PL' || t.includes('PACKING_LIST')) && !t.includes('OUTWARD') && !!d.approvedAt;
  });

  const gateDocsMap = new Map<number, DocEntry[]>();
  for (let i = 1; i <= gateCount; i++) gateDocsMap.set(i, []);

  for (const d of (s.documents ?? [])) {
    let gateNum: number;
    let code: string;
    let label: string;

    const g = docTypeToGate(d.documentType);
    if (!g) continue;
    gateNum = d.gateNumber && d.gateNumber >= 1 && d.gateNumber <= gateCount ? d.gateNumber : g.gate;
    code    = d.gateCode || g.code;
    label   = g.label;

    let entry: DocEntry = {
      code, label,
      status: apiDocStatus(d),
      docNumber: d.documentNumber ?? undefined,
      docId: d.id,
      genType: d.isGenerated ? d.documentType : undefined,
      isGenerated: d.isGenerated,
      isParallel: !!d.isParallel || !!g.isParallel,
    };
    if (entry.status === 'failed-block') {
      entry = { ...entry, ruleCode: 'Cross validation blocked', docNumber: undefined };
    } else if (entry.status === 'failed-warn') {
      entry = { ...entry, ruleCode: 'Cross validation pending', docNumber: undefined };
    }

    if (d.isGenerated) {
      const t = d.documentType.toUpperCase();
      const isOutward  = t.includes('OUTWARD') || t === 'OP';
      const isDraftBOE = t === 'DRAFT-BOE' || (t.includes('BOE') && t.includes('DRAFT')) || t.startsWith('DRAFT');
      if (isDraftBOE && !plApproved) {
        entry = { ...entry, status: 'expected', docNumber: 'Waiting for PL approval' };
      } else if (isOutward && (!bolPresent || !plApproved)) {
        entry = { ...entry, status: 'expected', docNumber: !bolPresent ? 'Waiting for BOL' : 'Waiting for PL approval' };
      }
    }

    gateDocsMap.get(gateNum)!.push(entry);
  }

  const activeDefs = GATE_DEFS;
  const gates: GateCol[] = activeDefs.map((def, i) => {
    const gateNum   = i + 1;
    const realDocs  = collapseDuplicateDocs(gateDocsMap.get(gateNum) ?? []);
    const seenCodes = new Set(realDocs.map(d => d.code));
    const merged: DocEntry[] = [
      ...realDocs,
      ...def.required.filter(r => !seenCodes.has(r.code)).map(r => ({ code: r.code, label: r.label, status: 'expected' as DocStatus })),
      ...def.parallel.filter(r => !seenCodes.has(r.code)).map(r => ({ code: r.code, label: r.label, status: 'expected' as DocStatus, isParallel: true })),
    ];
    // Gate completion is based on required document types, not the raw number
    // of files. Multiple invoices therefore count once toward the SI slot.
    const closedRequired = def.required.filter(required =>
      realDocs.some(document =>
        !document.isParallel
        && document.code === required.code
        && (document.status === 'closed' || document.status === 'gen-closed'),
      ),
    ).length;
    return {
      name: `Gate ${gateNum}`,
      label: def.label,
      status: 'future',
      docCount: `${closedRequired}/${def.required.length}`,
      docs: merged,
    };
  });

  // Strict gate progression: only the first incomplete gate can be active.
  // Documents uploaded for later gates remain visible, but cannot advance or
  // pass those gates until every preceding required slot is approved.
  let precedingGatesComplete = true;
  let activeGateAssigned = false;
  gates.forEach((gate, index) => {
    const [closed, required] = gate.docCount.split('/').map(Number);
    const complete = required > 0 && closed === required;
    if (precedingGatesComplete && complete) {
      gate.status = 'passed';
      return;
    }
    if (precedingGatesComplete && !activeGateAssigned) {
      gate.status = blocked ? 'blocked' : 'active';
      activeGateAssigned = true;
    } else {
      gate.status = 'future';
    }
    precedingGatesComplete = false;
  });

  const totalDocs  = s._count?.documents ?? 0;
  const closedDocs = (s.documents ?? []).filter(d => d.approvedAt).length;
  const shipmentRef = s.bolNumber ?? s.blNumber ?? s.hblNumber ?? s.mblNumber ?? s.shipmentNumber;
  const activeGateIndex = gates.findIndex(gate => gate.status === 'active' || gate.status === 'blocked');
  let statusLabel: string = activeGateIndex >= 0 ? `Gate ${activeGateIndex + 1} active` : 'Completed';
  let statusVariant: ShipmentLane['statusVariant'] = 'info';
  if (blocked) { statusLabel = 'Blocked'; statusVariant = 'danger'; }
  else if (gates.every(g => g.status === 'passed')) { statusLabel = 'Completed'; statusVariant = 'cleared'; }
  else if (stage === 1 && totalDocs === 0) { statusLabel = 'Pending'; statusVariant = 'pending'; }

  // Gate 1 precedes the Bill of Lading, so the document matrix must remain
  // visible even when a BOL has not been uploaded yet.
  const isPending = false;

  return {
    id: s.id,
    isPending,
    shipmentId: shipmentRef,
    vessel: `${s.vesselName ?? 'Vessel TBD'} · ${s.portOfLoading ?? 'India'} → ${s.portOfDischarge ?? 'US'}`,
    meta: `${s.exporterName ?? 'Exporter'} → ${s.buyerName ?? 'Buyer'}${totalDocs ? ` · ${totalDocs} docs` : ''}`,
    gateStatuses: gates.map(g => g.status),
    docSummary: `${closedDocs}/${totalDocs}`,
    statusLabel,
    statusVariant,
    gates,
    parallel: [],
    scPolAt:          s.safecubePolAt          ?? null,
    scPodAt:          s.safecubePodAt          ?? null,
    scPodEta:         s.safecubePodEta         ?? null,
    scScheduleStatus: s.safecubeScheduleStatus ?? null,
    scPolName:        s.safecubePolName        ?? null,
    scPolLocode:      s.safecubePolLocode      ?? null,
    scPodName:        s.safecubePodName        ?? null,
    scPodLocode:      s.safecubePodLocode      ?? null,
    scPrepodName:     s.safecubePrepodName     ?? null,
    scPrepodLocode:   s.safecubePrepodLocode   ?? null,
    scPostpodName:    s.safecubePostpodName    ?? null,
    scPostpodLocode:  s.safecubePostpodLocode  ?? null,
  };
}

// ─── Gate view — small components ────────────────────────────────────────────

function gateColor(s: GateStatus) {
  return s === 'passed' ? GREEN : s === 'active' ? TEAL : s === 'blocked' ? RED : BORDER;
}

function GateCircle({ status, size = 28 }: { status: GateStatus; size?: number }) {
  const bg = gateColor(status);
  const iconSize = Math.round(size * 0.46);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      backgroundColor: status === 'future' ? 'transparent' : bg,
      border: status === 'future' ? `2px solid ${BORDER}` : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: status === 'active' ? `0 0 0 4px ${TEAL}28` : 'none',
    }}>
      {status === 'passed'  && <Check size={iconSize} color="#fff" strokeWidth={2.5} />}
      {status === 'active'  && <div style={{ width: size * 0.26, height: size * 0.26, borderRadius: '50%', backgroundColor: '#fff' }} />}
      {status === 'blocked' && <span style={{ color: '#fff', fontSize: iconSize, fontWeight: 700 }}>!</span>}
    </div>
  );
}

function MiniGateDot({ status }: { status: GateStatus }) {
  return (
    <div style={{
      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
      backgroundColor: status === 'future' ? 'transparent' : gateColor(status),
      border: status === 'future' ? `1.5px solid ${BORDER}` : 'none',
    }} />
  );
}

function GateLine({ from, to }: { from: GateStatus; to: GateStatus }) {
  const isPassed = from === 'passed' && (to === 'passed' || to === 'active');
  return (
    <div style={{
      flex: 1, height: 2,
      backgroundColor: isPassed ? GREEN : 'transparent',
      borderTop: isPassed ? 'none' : `2px dashed ${BORDER}`,
      opacity: 0.6,
    }} />
  );
}

function DocStatusIcon({ status, isParallel }: { status: DocStatus; isParallel?: boolean }) {
  const warnColor = isParallel ? AMBER : RED;
  switch (status) {
    case 'closed':
    case 'gen-closed':
      return <CheckCircle2 size={12} style={{ color: GREEN, flexShrink: 0 }} />;
    case 'review':
      return <Circle size={11} style={{ color: MUTED, flexShrink: 0, opacity: 0.4 }} />;
    case 'processing':
      return <Loader2 size={12} style={{ color: INFO, flexShrink: 0, animation: 'spin 0.9s linear infinite' }} />;
    case 'gen-review':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Sparkles size={11} style={{ color: GOLD }} />
          <Loader2 size={9} style={{ color: GOLD, animation: 'spin 0.9s linear infinite' }} />
        </span>
      );
    case 'failed-block':
      return <AlertCircle size={12} style={{ color: RED, flexShrink: 0 }} />;
    case 'failed-warn':
      return <Clock size={12} style={{ color: warnColor, flexShrink: 0 }} />;
    case 'expected':
      return <Circle size={11} style={{ color: MUTED, flexShrink: 0, opacity: 0.4 }} />;
    case 'na':
      return <span style={{ fontSize: 14.5, color: MUTED, opacity: 0.4, flexShrink: 0 }}>—</span>;
  }
}

function docSubText(doc: DocEntry, isParallel?: boolean): { text: string; color: string; italic?: boolean; mono?: boolean } {
  switch (doc.status) {
    case 'closed':      return { text: doc.docNumber ?? '', color: MUTED, mono: true };
    case 'gen-closed':  return { text: doc.docNumber ?? 'Approved', color: MUTED, mono: true };
    case 'gen-review':  return { text: doc.docNumber ?? 'Draft — review', color: GOLD };
    case 'review':      return { text: doc.docNumber ?? 'Expected', color: MUTED, italic: !doc.docNumber };
    case 'processing':  return { text: doc.docNumber ?? 'Processing...', color: INFO };
    case 'failed-block': return { text: doc.ruleCode ?? 'Cross validation blocked', color: RED };
    case 'failed-warn': return { text: doc.ruleCode ?? doc.docNumber ?? 'Warning', color: isParallel ? AMBER : RED, mono: !!doc.ruleCode };
    case 'expected':    return { text: doc.docNumber ?? 'Expected', color: MUTED, italic: true };
    case 'na':          return { text: '—', color: MUTED };
  }
}

function DocItem({ doc, isParallel, onNavigate }: {
  doc: DocEntry;
  isParallel?: boolean;
  onNavigate: (path: string) => void;
}) {
  const sub = docSubText(doc, isParallel);
  const clickable = doc.status !== 'na' && doc.status !== 'expected';
  const path = doc.status === 'closed' && doc.docId
    ? `/documents/${doc.docId}`
    : (doc.status === 'gen-closed' || doc.status === 'gen-review') && doc.genType
      ? (doc.genType === 'outward-pl' || doc.genType === 'us-packing-list' ? '/documents/generate/outward-grn' : `/documents/generate/${doc.genType}`)
      : doc.status === 'expected' || doc.status === 'review' || doc.status === 'failed-warn' || doc.status === 'failed-block' || doc.status === 'processing'
        ? '/documents/upload'
        : undefined;

  return (
    <div
      onClick={path ? () => onNavigate(path) : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 5, padding: '2px 0',
        cursor: clickable && path ? 'pointer' : 'default',
        borderRadius: 4, transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => { if (path) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'hsla(0,0%,0%,0.03)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
    >
      <DocBadge code={doc.code} size="sm" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{
            fontSize: 12, fontWeight: 600, color: MUTED,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            minWidth: 0, flex: 1,
          }}>{doc.label}</span>
          {doc.isParallel && (
            <span style={{
              fontSize: 9, fontWeight: 700, lineHeight: 1,
              color: INFO, backgroundColor: 'hsla(201,96%,32%,0.10)',
              borderRadius: 999, padding: '2px 5px', flexShrink: 0,
            }}>
              Parallel
            </span>
          )}
          <DocStatusIcon status={doc.status} isParallel={isParallel || doc.isParallel} />
        </div>
        <span style={{
          fontSize: 11.5, color: sub.color,
          fontStyle: sub.italic ? 'italic' : 'normal',
          fontFamily: sub.mono ? 'var(--font-mono, monospace)' : 'inherit',
          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 90,
        }}>
          {sub.text}
        </span>
      </div>
    </div>
  );
}

function GateColPanel({ gate, isParallel, onNavigate }: {
  gate: GateCol;
  isParallel?: boolean;
  onNavigate: (path: string) => void;
}) {
  const hasBlock = gate.docs.some(d => d.status === 'failed-block');
  const headerBg = hasBlock
    ? 'hsla(0,84%,60%,0.06)'
    : isParallel
      ? 'hsl(var(--muted) / 0.18)'
      : gate.status === 'passed'
        ? `${GREEN}08`
        : gate.status === 'active'
          ? `${TEAL}08`
          : 'transparent';
  const dot6 = gateColor(gate.status);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderRight: `1px solid ${BORDER}`, minWidth: 0,
      backgroundColor: isParallel ? 'hsl(var(--muted) / 0.08)' : 'transparent',
      borderLeft: isParallel ? `2px solid ${BORDER}` : undefined,
    }}>
      <div style={{ padding: '7px 10px 6px', borderBottom: `1px solid ${BORDER}`, backgroundColor: headerBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {!isParallel && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              backgroundColor: gate.status === 'future' ? 'transparent' : dot6,
              border: gate.status === 'future' ? `1.5px solid ${BORDER}` : 'none',
            }} />
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: FG, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {gate.name}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{gate.label}</div>
        {!isParallel && (
          <span className="vs-mono" style={{ fontSize: 12.5, color: MUTED, display: 'block', marginTop: 2 }}>
            {gate.docCount}
          </span>
        )}
      </div>
      <div style={{ padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        {gate.docs.length === 0 ? (
          <span style={{ fontSize: 12, color: MUTED, opacity: 0.5, fontStyle: 'italic' }}>—</span>
        ) : (
          gate.docs.map((doc, i) => (
            <DocItem key={i} doc={doc} isParallel={isParallel || doc.isParallel} onNavigate={onNavigate} />
          ))
        )}
        {hasBlock && (
          <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: RED }}>Cross validation blocked</div>
        )}
      </div>
    </div>
  );
}

function ShipmentAccordion({ lane, open, onToggle }: {
  lane: ShipmentLane;
  open: boolean;
  onToggle: () => void;
}) {
  const [, navigate] = useLocation();

  return (
    <div style={{
      backgroundColor: CARD_BG, borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${BORDER}`, boxShadow: 'var(--vs-shadow-card)', marginBottom: 8,
    }}>
      {/* Collapsed header */}
      <div
        onClick={onToggle}
        style={{
          padding: '10px 14px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: open ? `1px solid ${BORDER}` : 'none',
          backgroundColor: open ? 'hsl(var(--muted) / 0.25)' : 'transparent',
          transition: 'background-color 0.12s', userSelect: 'none',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
            {lane.isPending ? (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 5,
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                backgroundColor: `${AMBER}20`, justifyContent: 'center',
              }}>
                <Clock size={11} style={{ color: AMBER }} />
              </span>
            ) : (
              <DocBadge code="BL" size="sm" />
            )}
            <span className="vs-mono" style={{
              fontSize: 12.5, fontWeight: 700,
              color: lane.isPending ? AMBER : FG,
              fontStyle: lane.isPending ? 'italic' : 'normal',
            }}>
              {lane.shipmentId}
            </span>
            {!lane.isPending && lane.vessel && (
              <span style={{ fontSize: 12.5, color: MUTED }}>{lane.vessel}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{lane.meta}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {lane.gateStatuses.map((s, i) => <MiniGateDot key={i} status={s} />)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span className="vs-mono" style={{ fontSize: 12, color: MUTED }}>{lane.docSummary} docs</span>
          <StatusPill status={lane.statusLabel} variant={lane.statusVariant} />
          {open
            ? <ChevronDown size={16} style={{ color: MUTED }} />
            : <ChevronRight size={16} style={{ color: MUTED }} />}
        </div>
      </div>

      {open && (
        <div style={{ animation: 'fadeIn 0.15s ease' }}>
          {lane.isPending ? (
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr' }}>
              <GateColPanel gate={lane.gates[0]} onNavigate={navigate} />
              <div style={{ padding: '24px 28px', display: 'flex', alignItems: 'flex-start' }}>
                <div style={{
                  backgroundColor: `${AMBER}10`, border: `1px solid ${AMBER}40`,
                  borderRadius: 8, padding: '16px 20px', flex: 1,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: AMBER, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={14} /> Waiting for Bill of Lading
                  </div>
                  <div style={{ fontSize: 14, color: FG, lineHeight: 1.6, marginBottom: 6 }}>
                    This shipment will be identified when a BOL is uploaded and matched to this invoice.
                  </div>
                  <div style={{ fontSize: 14, color: MUTED, marginBottom: 14 }}>
                    BOL can be uploaded by the Freight Forwarder or India Logistics.
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); navigate('/documents/upload'); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 14, fontWeight: 700, color: '#fff',
                      backgroundColor: TEAL, border: 'none', borderRadius: 7,
                      padding: '7px 16px', cursor: 'pointer',
                    }}
                  >
                    <Upload size={12} /> Upload BOL →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <style>{`
                @media (min-width: 1180px) { .gate-grid-${lane.id} { grid-template-columns: repeat(${lane.gates.length}, minmax(0, 1fr)) !important; } }
                @media (min-width: 768px) and (max-width: 1179px) { .gate-grid-${lane.id} { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } }
                @media (max-width: 767px) { .gate-grid-${lane.id} { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
              `}</style>
              <div
                className={`gate-grid-${lane.id}`}
                style={{ display: 'grid', gridTemplateColumns: `repeat(${lane.gates.length}, minmax(0, 1fr))` }}
              >
                {lane.gates.map((gate, i) => (
                  <GateColPanel key={i} gate={gate} onNavigate={navigate} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Voyage strip components ──────────────────────────────────────────────────

// Cargo vessel silhouette — bow faces right (direction of travel)
function ShipIcon({ size = 32 }: { size?: number }) {
  const h = Math.round(size * 0.5);
  return (
    <svg width={size} height={h} viewBox="0 0 80 40" fill="none" aria-hidden="true">
      {/* Hull — tapers to a bow on the right */}
      <path d="M2 18 L2 32 L68 32 L76 24 L68 16 L2 16 Z" fill="currentColor" />
      {/* Bridge at stern (left side) */}
      <rect x="4" y="5" width="14" height="11" rx="2" fill="currentColor" opacity="0.85" />
      {/* Funnel / chimney */}
      <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" />
      {/* Smoke puff */}
      <circle cx="10.5" cy="0.5" r="2.5" fill="currentColor" opacity="0.12" />
      {/* Cargo containers (middle deck) */}
      <rect x="22" y="7" width="14" height="9" rx="1.5" fill="currentColor" opacity="0.68" />
      <rect x="38" y="7" width="14" height="9" rx="1.5" fill="currentColor" opacity="0.62" />
      <rect x="54" y="9" width="10" height="7" rx="1"   fill="currentColor" opacity="0.55" />
      {/* Waterline accent */}
      <line x1="2" y1="30" x2="68" y2="30" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
    </svg>
  );
}

// Port stop marker (replaces GateCircle in the voyage strip)
function PortMarker({ status, size = 20 }: { status: GateStatus; size?: number }) {
  const isPassed  = status === 'passed';
  const isActive  = status === 'active';
  const isBlocked = status === 'blocked';
  const color = isPassed ? GREEN : isActive ? TEAL : isBlocked ? RED : BORDER;
  const iconSize = Math.round(size * 0.45);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: size, height: size }}>
      {/* Expanding pulse ring on the active gate */}
      {isActive && (
        <div style={{
          position: 'absolute', inset: -8, borderRadius: '50%',
          border: `2px solid ${TEAL}`,
          animation: 'gateRing 2s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      {/* Main marker disc */}
      <div style={{
        width: size, height: size, borderRadius: '50%',
        backgroundColor: (isPassed || isActive || isBlocked) ? color : 'transparent',
        border: status === 'future' ? `2px solid ${BORDER}` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: isActive ? `0 0 8px ${TEAL}55` : isPassed ? `0 0 4px ${GREEN}40` : 'none',
        transition: 'background-color 0.3s, box-shadow 0.3s',
      }}>
        {isPassed  && <Check size={iconSize} color="#fff" strokeWidth={3} />}
        {isActive  && <div style={{ width: size * 0.28, height: size * 0.28, borderRadius: '50%', backgroundColor: '#fff' }} />}
        {isBlocked && <span style={{ color: '#fff', fontSize: iconSize, fontWeight: 700, lineHeight: 1 }}>!</span>}
      </div>
    </div>
  );
}

// ─── Voyage gate strip (top focused strip) ────────────────────────────────────

function ShipmentGateStrip({ lane }: { lane: ShipmentLane }) {
  const gates = lane.gates;
  const N = gates.length;
  if (N === 0) return null;

  // Ship sits at the 'active' gate; falls back to the last 'passed' gate; defaults to gate 0
  const activeIdx     = gates.findIndex(g => g.status === 'active');
  const lastPassedIdx = gates.reduce((last, g, i) => g.status === 'passed' ? i : last, -1);
  const shipIdx       = activeIdx >= 0 ? activeIdx : lastPassedIdx >= 0 ? lastPassedIdx : 0;

  // Column centres as % of container — each gate column has flex:1
  // centre_i = (2i + 1) / (2N) × 100
  const pct      = (i: number) => (2 * i + 1) / (2 * N) * 100;
  const firstPct = pct(0);
  const lastPct  = pct(N - 1);
  const trackW   = lastPct - firstPct;   // % of container that the route spans

  // Map a gate (by label + index) to its SafeCube port role
  const gateToScPort = (label: string, idx: number): 'prepod' | 'pol' | 'pod' | 'postpod' | null => {
    const l = label.toLowerCase();
    if (l.includes('india') || l.includes('exit') || l.includes('loading') || l === 'pol') return 'pol';
    if (l.includes('us entry') || l.includes('entry') || l.includes('discharge') || l === 'pod') return 'pod';
    if (l.includes('initiat') || l.includes('pre-') || l === 'prepod') return 'prepod';
    if (l.includes('deliver') || l.includes('post')) return 'postpod';
    // index-based fallback for the standard 5-gate template
    if (N === 5) { if (idx === 0) return 'prepod'; if (idx === 1) return 'pol'; if (idx === 2) return 'pod'; if (idx === 4) return 'postpod'; }
    if (N >= 3)  { if (idx === 1) return 'pol';    if (idx === N - 2) return 'pod'; }
    return null;
  };

  // Find pol and pod gate indices for SafeCube position anchoring
  let polGateIdx = N > 1 ? 1 : 0;
  let podGateIdx = N > 2 ? N - 2 : N - 1;
  for (let i = 0; i < N; i++) {
    const p = gateToScPort(gates[i].label, i);
    if (p === 'pol') polGateIdx = i;
    if (p === 'pod') podGateIdx = i;
  }

  // SafeCube pol→pod timing fraction maps to the pol→pod gate segment (not full track)
  let shipPct = pct(shipIdx);
  if (lane.scPolAt && (lane.scPodAt || lane.scPodEta)) {
    const polTime = new Date(lane.scPolAt).getTime();
    const podTime = new Date(lane.scPodAt ?? lane.scPodEta!).getTime();
    if (podTime > polTime) {
      const fraction = Math.max(0, Math.min(1, (Date.now() - polTime) / (podTime - polTime)));
      shipPct = pct(polGateIdx) + fraction * (pct(podGateIdx) - pct(polGateIdx));
    }
  }

  const sailedW  = trackW > 0 ? (shipPct - firstPct) / trackW * 100 : 0;

  const MARKER = 16;

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>

      {/* ── Ship — floats above the port markers ─────────────────────────── */}
      <div style={{ position: 'relative', height: 18, marginBottom: 2 }}>
        <div style={{
          position: 'absolute', top: 0,
          left: `${shipPct}%`,
          transition: 'left 0.55s cubic-bezier(0.4,0,0.2,1)',
          zIndex: 2, pointerEvents: 'none',
          color: TEAL,
        }}>
          {/* Separate inner div so bob animation doesn't fight with translateX */}
          <div style={{ transform: 'translateX(-50%)', animation: 'shipBob 3s ease-in-out infinite' }}>
            <ShipIcon size={24} />
          </div>
        </div>
      </div>

      {/* ── Gate row — route track + port stops ──────────────────────────── */}
      <div style={{ position: 'relative', display: 'flex' }}>

        {/* Route track — absolutely behind the markers */}
        <div style={{
          position: 'absolute',
          top: MARKER / 2 - 1,   // vertically centred on the 20px markers
          left: `${firstPct}%`,
          width: `${trackW}%`,
          height: 2,
          zIndex: 0, pointerEvents: 'none',
        }}>
          {/* Sailed segment — solid teal gradient with glow */}
          <div style={{
            position: 'absolute', inset: 0,
            width: `${sailedW}%`,
            background: `linear-gradient(90deg, ${GREEN}, ${TEAL})`,
            borderRadius: 2,
            boxShadow: `0 0 6px ${TEAL}55`,
          }} />
          {/* Unsailed segment — dashed */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${sailedW}%`, right: 0,
            background: `repeating-linear-gradient(90deg, ${BORDER} 0px, ${BORDER} 5px, transparent 5px, transparent 11px)`,
            opacity: 0.7,
          }} />
        </div>

        {/* Gate columns */}
        {gates.map((gate, i) => {
          const scPort  = lane.scPolAt ? gateToScPort(gate.label, i) : null;
          const scLocode = scPort === 'pol'     ? lane.scPolLocode
                         : scPort === 'pod'     ? lane.scPodLocode
                         : scPort === 'prepod'  ? lane.scPrepodLocode
                         : scPort === 'postpod' ? lane.scPostpodLocode
                         : null;
          return (
            <div key={i} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 4,
              position: 'relative', zIndex: 1,
            }}>
              <PortMarker status={gate.status} size={MARKER} />
              <span
                className="voy-gate-label"
                style={{
                  fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.25,
                  color: gate.status === 'future' ? MUTED : FG,
                  width: '100%',
                }}
              >
                {gate.label}
              </span>
              {scLocode && (
                <span style={{
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
                  color: TEAL, background: 'hsl(var(--vs-teal) / 0.1)',
                  borderRadius: 3, padding: '1px 4px', lineHeight: 1.4,
                }}>
                  {scLocode}
                </span>
              )}
              <span className="vs-mono" style={{
                fontSize: 12, fontWeight: 700,
                color: gate.status === 'future'  ? MUTED
                     : gate.status === 'blocked' ? RED
                     : gate.status === 'active'  ? TEAL : GREEN,
              }}>
                {gate.docCount}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Parallel channel ─────────────────────────────────────────────── */}
      {lane.parallel.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          marginTop: 7, paddingTop: 6, borderTop: `1px dashed ${BORDER}`,
        }}>
          <span style={{ fontSize: 12.5, color: MUTED, fontWeight: 700, lineHeight: 1, flexShrink: 0 }}>∥</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Parallel</span>
          <div style={{ flex: 1, height: 1, background: `repeating-linear-gradient(90deg, ${BORDER} 0, ${BORDER} 4px, transparent 4px, transparent 8px)`, opacity: 0.45 }} />
          <span className="vs-mono" style={{ fontSize: 12, color: MUTED, flexShrink: 0 }}>
            {lane.parallel.filter(p => p.status === 'closed' || p.status === 'gen-closed').length}/{lane.parallel.length}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const { setPageMeta } = usePageMeta();
  // ── Config (template-driven gate structure) ─────────────────────────────────
  const { templates, docTypes } = useConfig();

  // ── Gate view state ────────────────────────────────────────────────────────
  const [rawShipments,  setRawShipments]  = useState<ApiShipment[]>([]);
  const [openLanes,     setOpenLanes]     = useState<Set<string>>(new Set());
  const [focusedLaneId, setFocusedLaneId] = useState<string | undefined>();
  const [gateFilter,    setGateFilter]    = useState(0);
  const [gateSearch,    setGateSearch]    = useState('');
  const [showOverview,  setShowOverview]  = useState(true);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState<string | null>(null);

  // Derive lanes whenever raw shipment data or config changes (config loads async)
  const lanes = useMemo<ShipmentLane[]>(
    () => rawShipments.map(s => shipmentToLane(s, templates, docTypes)),
    [rawShipments, templates, docTypes],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetch(`${API_BASE}/api/v1/shipments?limit=100`, {
      headers: authHeaders(),
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => {
        const raw = json.data ?? [];
        setRawShipments(raw);
        if (raw.length > 0) {
          setOpenLanes(new Set([raw[0].id]));
          setFocusedLaneId(raw[0].id);
        }
      })
      .catch(error => {
        if (error?.name !== 'AbortError') {
          setLoadError(`Could not load approved documents (${String(error)})`);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const handleModuleSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; value: string }>).detail;
      if (detail.scope !== 'documents' && detail.scope !== 'all') return;
      setGateSearch(detail.value);
    };
    window.addEventListener('ewms-module-search', handleModuleSearch);
    return () => window.removeEventListener('ewms-module-search', handleModuleSearch);
  }, []);

  function toggleLane(id: string) {
    setOpenLanes(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setFocusedLaneId(id);   // update focused lane when opening
      }
      return next;
    });
  }

  const filteredLanes = useMemo(() => {
    let result = lanes;
    switch (gateFilter) {
      case 1: result = lanes.filter(l => !l.isPending && l.gates.some(g => g.status === 'active' || g.status === 'blocked')); break;
      case 2: result = lanes.filter(l => !!l.isPending); break;
      case 3: result = lanes.filter(l => l.gateStatuses.every(s => s === 'passed')); break;
    }
    const q = gateSearch.toLowerCase().trim();
    return q
      ? result.filter(l => l.shipmentId.toLowerCase().includes(q) || l.vessel.toLowerCase().includes(q) || l.meta.toLowerCase().includes(q))
      : result;
  }, [lanes, gateFilter, gateSearch]);

  const gateSearchOptions = useMemo(
    () => gateSearch.trim() ? filteredLanes.slice(0, 8) : [],
    [filteredLanes, gateSearch],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    setPageMeta({ title: 'Documents' });
    return () => setPageMeta(null);
  }, [setPageMeta]);

  return (
    <div className="pb-6 px-4">
      <style>{`
        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes fadeIn   { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shipBob  { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-4px); } }
        @keyframes gateRing { 0% { transform: scale(1); opacity: 0.65; } 100% { transform: scale(1.9); opacity: 0; } }
        .voy-gate-label {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-word;
          text-align: center;
        }
      `}</style>

      {/* ── GATE VIEW ── */}
      <div>
          {/* ── Sticky pane: voyage progress + filter chips ── */}
          <div style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            backgroundColor: 'hsl(var(--background))',
            marginLeft: -16,
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 4,
            paddingBottom: 4,
          }}>
          {/* Focused lane gate strip — updates when a shipment is expanded */}
          {showOverview && (() => {
            const focused = focusedLaneId ? lanes.find(l => l.id === focusedLaneId) : lanes[0];
            return focused ? (
              <div style={{
                backgroundColor: CARD_BG, borderRadius: 8,
                padding: '10px 14px', boxShadow: 'var(--vs-shadow-card)',
                border: `1px solid ${BORDER}`, marginBottom: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, lineHeight: 1 }}>⚓</span>
                  <span className="vs-mono" style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Document Tracking
                  </span>
                  <span style={{ fontSize: 11.5, color: BORDER }}>·</span>
                  <span className="vs-mono" style={{ fontSize: 12, fontWeight: 700, color: TEAL }}>
                    {focused.shipmentId}
                  </span>
                  <span style={{ fontSize: 12, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{focused.vessel}</span>
                </div>
                <ShipmentGateStrip lane={focused} />
              </div>
            ) : null;
          })()}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <FilterChips
              size="compact"
              chips={[
                { label: 'All shipments',  count: lanes.length },
                { label: 'Active gate',    count: lanes.filter(l => !l.isPending && l.gates.some(g => g.status === 'active' || g.status === 'blocked')).length },
                // { label: 'Pending BOL',    count: lanes.filter(l => !!l.isPending).length },
                { label: 'Complete',       count: lanes.filter(l => l.gateStatuses.every(s => s === 'passed')).length },
              ]}
              activeIndex={gateFilter}
              onSelect={setGateFilter}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              border: `1px solid ${BORDER}`, borderRadius: 8,
              padding: '0 10px', height: 30, boxSizing: 'border-box', backgroundColor: CARD_BG,
              flex: '0 1 280px', marginLeft: 'auto', position: 'relative', zIndex: 5,
            }}>
              <Search size={12} style={{ color: MUTED, flexShrink: 0 }} />
              <input
                value={gateSearch}
                onChange={e => setGateSearch(e.target.value)}
                placeholder="Search shipment gates..."
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12.5, color: FG, backgroundColor: 'transparent' }}
              />
              {gateSearch && (
                <button onClick={() => setGateSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  <span style={{ fontSize: 14.5, color: MUTED }}>✕</span>
                </button>
              )}
              {gateSearchOptions.length > 0 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
                  backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8,
                  boxShadow: '0 10px 28px hsla(0,0%,0%,0.16)', overflow: 'hidden',
                }}>
                  {gateSearchOptions.map(lane => (
                    <button
                      key={lane.id}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => {
                        setGateSearch(lane.shipmentId);
                        setOpenLanes(prev => new Set(prev).add(lane.id));
                        setFocusedLaneId(lane.id);
                      }}
                      style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '9px 11px', textAlign: 'left' }}
                    >
                      <div className="vs-mono" style={{ fontSize: 13, fontWeight: 700, color: FG }}>{lane.shipmentId}</div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                        {lane.vessel} · Gate {Math.max(1, lane.gateStatuses.findIndex(status => status === 'active' || status === 'blocked') + 1)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowOverview(value => !value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                backgroundColor: CARD_BG,
                color: MUTED,
                fontSize: 11.5,
                fontWeight: 750,
                padding: '0 10px',
                height: 30,
                boxSizing: 'border-box',
                cursor: 'pointer',
                boxShadow: 'var(--vs-shadow-card)',
              }}
            >
              {showOverview ? 'Hide overview' : 'Show overview'}
            </button>
          </div>
          </div>{/* end sticky pane */}

          <div style={{ marginTop: 12 }}>
          {loading ? (
            <div style={{
              backgroundColor: CARD_BG, borderRadius: 8,
              border: `1px solid ${BORDER}`, padding: '40px 24px', textAlign: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>
              <Loader2 size={18} style={{ color: TEAL, flexShrink: 0, animation: 'spin 0.9s linear infinite' }} />
              <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Loading shipments...</p>
            </div>
          ) : loadError ? (
            <div style={{
              backgroundColor: CARD_BG, borderRadius: 8,
              border: `1px solid ${BORDER}`, padding: '40px 24px', textAlign: 'center',
            }}>
              <span style={{ fontSize: 15, color: RED }}>{loadError}</span>
            </div>
          ) : lanes.length === 0 ? (
            <div style={{
              backgroundColor: CARD_BG, borderRadius: 8,
              border: `1px solid ${BORDER}`, padding: '40px 24px', textAlign: 'center',
            }}>
              <span style={{ fontSize: 15, color: MUTED }}>No shipments available.</span>
            </div>
          ) : filteredLanes.length === 0 ? (
            <div style={{
              backgroundColor: CARD_BG, borderRadius: 8,
              border: `1px solid ${BORDER}`, padding: '40px 24px', textAlign: 'center',
            }}>
              <span style={{ fontSize: 15, color: MUTED }}>No shipments match this filter.</span>
            </div>
          ) : (
            filteredLanes.map(lane => (
              <ShipmentAccordion
                key={lane.id}
                lane={lane}
                open={openLanes.has(lane.id)}
                onToggle={() => toggleLane(lane.id)}
              />
            ))
          )}
          </div>{/* end shipment list wrapper */}
      </div>
    </div>
  );
}
