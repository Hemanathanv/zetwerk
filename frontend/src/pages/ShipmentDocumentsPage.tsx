import { useParams, useLocation } from 'wouter';
import { useEffect, useState, useCallback } from 'react';
import { useShipmentDocuments } from '@/hooks/useOperationalData';
import { useConfig } from '@/contexts/ConfigContext';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { RequireActivity } from '@/components/PermissionGate';
import { getAuthToken } from '@/lib/api';
import {
  DOCUMENT_EXPECTED_DOCS_BY_GATE,
  DOCUMENT_GATE_LABELS,
  DOCUMENT_PARALLEL_DOC_TYPES,
  documentGateDocDef,
} from '@/config/documentGateConfig';
import {
  Fingerprint, Sparkles, Calculator, CheckCircle, Circle,
  AlertCircle, Camera, Clock, CheckCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiDocTypeGate {
  id: string;
  docType: string;
  roleInGate?: string | null;
  isGenerated?: boolean;
  mandatoryPhoto?: boolean;
  slaOverrideDays?: number | null;
  sortOrder?: number | null;
}

interface ApiGate {
  id: string;
  gateConfigId: string;
  status: string;
  passedAt?: string | null;
  skippedAt?: string | null;
  failureReason?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  gateConfig: {
    id: string;
    gateNumber: number;
    gateName: string;
    gateLabel?: string | null;
    geography?: string | null;
    isIdentityGate?: boolean;
    gateCheckType?: string | null;
    docTypeGates: ApiDocTypeGate[];
  };
}

interface ValidationCount {
  total: number;
  passed: number;
  failed: number;
  blockers: number;
  warnings: number;
  waiting: number;
  overridden: number;
}

interface ApiMilestoneTracking {
  id: string;
  milestoneNumber: number;
  status: string;
  completedAt?: string | null;
  notes?: string | null;
  completedByName?: string | null;
  milestoneConfig?: {
    id: string;
    gateConfigId?: string | null;
    name: string;
    type?: string | null;
    systemCode?: string | null;
    completionMode?: string | null;
  } | null;
}

const SHIPMENT_GATE_LABELS = DOCUMENT_GATE_LABELS;
const SHIPMENT_EXPECTED_DOCS_BY_GATE = DOCUMENT_EXPECTED_DOCS_BY_GATE;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTypeCode(code: string): string {
  const normalized = code.toUpperCase();
  const canonical = documentGateDocDef(normalized);
  if (canonical) return canonical.label;
  if (normalized === 'US_PACKING_LIST' || normalized.includes('US_PACKING')) return 'US Packing List';
  if (normalized === 'US_SALES_INVOICE' || normalized.includes('US_SALES')) return 'US Sales Invoice';
  return code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function docTypeShortCode(code: string): string {
  const normalized = code.toUpperCase();
  const canonical = documentGateDocDef(normalized);
  if (canonical) return canonical.code;
  if (normalized === 'US_PACKING_LIST' || normalized.includes('US_PACKING')) return 'UP';
  if (normalized === 'US_SALES_INVOICE' || normalized.includes('US_SALES')) return 'UI';
  return code.slice(0, 2).toUpperCase();
}

// Strict: only the stored MIME type is used for the "needs photo" indicator.
// Extension-based fallback excluded to stay consistent with gate engine enforcement.
function fileIsImage(contentType?: string | null, _fileName?: string | null): boolean {
  return typeof contentType === 'string' && contentType.startsWith('image/');
}

function deriveDocStatus(doc: any): string {
  if (!doc) return 'MISSING';
  const validationStatus = String(doc.validationStatus ?? '').toUpperCase();
  if (validationStatus === 'PASSED') return 'CLOSED';
  if (validationStatus === 'BLOCKED' || validationStatus === 'FAILED') return 'REJECTED';
  if (validationStatus === 'WAITING' || validationStatus === 'WARNING') return 'EXTRACTED';
  if (doc.approvedAt) return 'REVIEWED';
  const s = (doc.ocrStatus ?? '').toUpperCase();
  if (s === 'EXTRACTED') return 'EXTRACTED';
  if (s === 'FAILED')    return 'REJECTED';
  if (s === 'PROCESSING' || s === 'QUEUED') return 'PROCESSING';
  return 'UPLOADED';
}

function validationPassed(document: any | undefined, validation?: ValidationCount | null): boolean {
  if (!document) return false;
  if (validation && validation.total > 0) {
    return validation.passed >= validation.total
      && validation.blockers === 0
      && validation.warnings === 0
      && validation.waiting === 0;
  }
  return String(document.validationStatus ?? '').toUpperCase() === 'PASSED';
}

function hasReachedStatus(current: string, required: string): boolean {
  const order: Record<string, number> = {
    UPLOADED: 1, QUEUED: 1, PROCESSING: 2, EXTRACTED: 3,
    REVIEWED: 4, APPROVED: 4, CLOSED: 5, ARCHIVED: 5,
  };
  return (order[current] || 0) >= (order[required] || 0);
}

function matchDoc(docs: any[], docType: string): any | undefined {
  const dt = docType.toUpperCase();
  return docs.find((d: any) => docTypeMatches(d.documentType, dt));
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
  if (e === 'ENTRY_SUMMARY_DRAFT') return false;
  if (e === 'ENTRY_SUMMARY_TARIFF_LINES') return a.includes('ENTRY_SUMMARY_TARIFF') || a.includes('TARIFF_LINES');
  if (e === 'ENTRY_SUMMARY') return a === 'ENTRY_SUMMARY' || a=== 'BOE' || a.includes('BILL_OF_ENTRY') || a.includes('CBP_FORM_7501');
  if (e === 'US_CARGO_RELEASE_ORDER') return a.includes('CARGO_RELEASE');
  if (e === 'US_CUSTOMS_RELEASE_ORDER') return a.includes('CUSTOMS_RELEASE');
  if (e === 'US_DELIVERY_ORDER') return a.includes('DELIVERY_ORDER');
  if (e === 'ISF') return a === 'ISF' || a.includes('IMPORTER_SECURITY');
  if (e === 'CUSTOMER_BROKER_BILL') return a.includes('CUSTOMER_BROKER') || a.includes('CUSTOM_BROKER') || a.includes('CUSTOMS_BROKER');
  if (e === 'OCEAN_FREIGHT') return a.includes('OCEAN_FREIGHT');
  if (e === 'GRN_INBOUND') return a === 'GR' || a.includes('GRN_INBOUND') || a.includes('GOODS_RECEIPT');
  if (e === 'PORT_TO_WH') return a.includes('PORT_TO_WH') || a.includes('PORT_TO_WAREHOUSE');
  if (e === 'OUTWARD_GRN') return a === 'OG' || a.includes('OUTWARD_GRN') || a.includes('OUTWARD');
  if (e === 'US_PACKING_LIST') return a.includes('US_PACKING');
  if (e === 'US_SALES_INVOICE') return a.includes('US_SALES');
  if (e === 'WH_TO_CUSTOMER') return a.includes('WH_TO_CUSTOMER') || a.includes('WAREHOUSE_TO_CUSTOMER');
  return false;
}

function isGeneratedEntrySummaryDoc(doc: any): boolean {
  if (normalizedDocType(doc?.documentType) !== 'ENTRY_SUMMARY') return false;
  const labelText = `${doc?.fileName ?? ''} ${doc?.documentNumber ?? ''} ${doc?.gateCode ?? ''}`.toUpperCase();
  return Boolean(doc?.isGenerated)
    || Number(doc?.gateNumber) === 2
    || labelText.includes('DRAFT_CBP')
    || labelText.includes('DRAFT CBP')
    || labelText.includes('BOE-D');
}

function isDraftBrokerDoc(doc: any): boolean {
  return normalizedDocType(doc?.documentType) === 'DRAFT_CBP_FORM_7501_BROKER';
}

function docBelongsToGate(doc: any, gateNumber?: number): boolean {
  if (gateNumber == null) return true;
  if (isDraftBrokerDoc(doc)) return Number(gateNumber) === 2;
  if (isGeneratedEntrySummaryDoc(doc)) return Number(gateNumber) === 2;
  if (doc.gateNumber == null) return true;
  return Number(doc.gateNumber) === Number(gateNumber);
}


function docMatchesSlot(doc: any, expectedDocType: string, gateNumber?: number): boolean {
  const expected = normalizedDocType(expectedDocType);
  if (expected === 'ENTRY_SUMMARY_DRAFT') {
    return isGeneratedEntrySummaryDoc(doc) && (gateNumber == null || Number(gateNumber) === 2);
  }
  if (expected === 'ENTRY_SUMMARY' && isGeneratedEntrySummaryDoc(doc)) {
    return false;
  }
  return docTypeMatches(doc?.documentType, expectedDocType) && docBelongsToGate(doc, gateNumber);
}

function findDocForSlot(documents: any[], docType: string, usedDocIds?: Set<string>, gateNumber?: number): any | undefined {
  const doc = documents.find((d: any) =>
    !usedDocIds?.has(d.id)
    && docMatchesSlot(d, docType, gateNumber)
  );
  if (doc && usedDocIds) usedDocIds.add(doc.id);
  return doc;
}

function findDocsForSlot(documents: any[], docType: string, usedDocIds?: Set<string>, gateNumber?: number): any[] {
  const docs = documents.filter((d: any) =>
    !usedDocIds?.has(d.id)
    && docMatchesSlot(d, docType, gateNumber)
  );
  if (usedDocIds) docs.forEach(doc => usedDocIds.add(doc.id));
  return docs;
}

function orderedDocTypeGates(docTypeGates: ApiDocTypeGate[] = []): ApiDocTypeGate[] {
  return [...docTypeGates].sort((a, b) => {
    const ao = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.docType ?? '').localeCompare(String(b.docType ?? ''));
  });
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
    .filter(doc => doc.gateNumber != null && docBelongsToGate(doc, gateNumber))
    .map(doc => normalizedDocType(doc.documentType))
    .filter(docType => {
      if (!docType || existingDocTypes.has(docType) || seen.has(docType)) return false;
      seen.add(docType);
      return true;
    })
    .map((docType, index) => {
      const sample = documents.find(doc => docBelongsToGate(doc, gateNumber) && docTypeMatches(doc.documentType, docType));
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

function gateDisplayStatus(gate: ApiGate, isFirst: boolean): string {
  if (gate.status === 'PASSED')  return 'PASSED';
  if (gate.status === 'SKIPPED') return 'SKIPPED';
  if (gate.status === 'FAILED')  return 'BLOCKED';
  if (gate.status === 'OPEN')    return isFirst ? 'ACTIVE' : 'FUTURE';
  return 'FUTURE';
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── GateStatusBadge ──────────────────────────────────────────────────────────

function GateStatusBadge({ status }: { status: string }) {
  const intent = status === 'PASSED' || status === 'ACTIVE'
    ? 'success'
    : status === 'BLOCKED'
      ? 'danger'
      : 'neutral';
  return <Badge intent={intent} size="sm" className="rounded">{status}</Badge>;
}

// ─── DocumentStatusCard (G-S10, G-S11) ───────────────────────────────────────

function DocumentStatusCard({ dtInfo, assignment, document, documentCount = 0, validation, isAccountingTrigger, slaDeadline, gateNumber, onNavigate }: {
  dtInfo: any;
  assignment: ApiDocTypeGate;
  document: any | undefined;
  documentCount?: number;
  validation: ValidationCount | null;
  isAccountingTrigger: boolean;
  slaDeadline?: Date | null;
  gateNumber?: number;
  onNavigate: (path: string) => void;
}) {
  const geo = dtInfo?.geography ?? '';
  const geoBorderColor =
    geo === 'INDIA' ? 'hsl(25 95% 53%)' :
    geo === 'US'    ? 'hsl(217 91% 60%)' :
    'hsl(var(--border))';

  const shortCodeBg =
    geo === 'INDIA' ? 'hsl(25 95% 53%)' :
    geo === 'US'    ? 'hsl(217 91% 60%)' :
    'hsl(173 58% 39%)';

  const isUsPackingOrInvoice = ['US_PACKING_LIST', 'US_SALES_INVOICE'].includes(normalizedDocType(assignment.docType));
  const isGeneratedEntrySummary = normalizedDocType(assignment.docType) === 'ENTRY_SUMMARY' && (
    Number(gateNumber) === 2 || Boolean(document?.isGenerated || assignment.isGenerated)
  );
  const shortCode = isGeneratedEntrySummary
    ? 'CB'
    : isUsPackingOrInvoice ? docTypeShortCode(assignment.docType) : (dtInfo?.shortCode ?? docTypeShortCode(assignment.docType));
  const baseDisplayLabel = isGeneratedEntrySummary
    ? 'Draft CBP FORM 7501'
    : isUsPackingOrInvoice ? formatTypeCode(assignment.docType) : (dtInfo?.displayLabel ?? formatTypeCode(assignment.docType));
  const displayLabel = `${baseDisplayLabel}${documentCount > 1 ? ` (${documentCount})` : ''}`;

  const docStatus = deriveDocStatus(document);
  const isComplete   = validationPassed(document, validation);
  const isProcessing = ['PROCESSING', 'QUEUED', 'UPLOADED'].includes(docStatus);
  const isExtracted  = docStatus === 'EXTRACTED' || docStatus === 'REVIEWED';
  const isRejected   = docStatus === 'REJECTED';
  const hasDoc       = !!document;

  const bgColor =
    isComplete  ? 'hsla(142,71%,45%,0.10)' :
    isRejected  ? 'hsla(0,72%,51%,0.07)' :
    hasDoc      ? 'hsl(var(--card))' :
    'hsl(var(--muted) / 0.2)';

  const statusSymbol =
    isComplete   ? '✓' :
    isExtracted  ? '◐' :
    isProcessing ? '◌' :
    isRejected   ? '✗' : '—';

  const statusColor =
    isComplete   ? 'hsl(142 71% 30%)' :
    isExtracted  ? 'hsl(38 92% 38%)' :
    isProcessing ? 'hsl(217 91% 50%)' :
    isRejected   ? 'hsl(0 72% 45%)' :
    'hsl(var(--muted-foreground))';

  function handleClick() {
    if (document?.id) onNavigate(`/documents/${document.id}`);
  }

  return (
    <div
      onClick={handleClick}
      style={{
        borderRadius: 7, borderLeft: `3px solid ${geoBorderColor}`,
        padding: '7px 8px', backgroundColor: bgColor,
        cursor: document ? 'pointer' : 'default',
        transition: 'box-shadow 0.12s',
        marginBottom: 4,
        overflow: 'hidden',
        minWidth: 0,
      }}
      onMouseEnter={e => { if (document) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px hsla(0,0%,0%,0.12)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
    >
      {/* Row 1: shortCode badge + name + indicators */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, minWidth: 0, flex: 1 }}>
          {/* Geography-colored abbreviation badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            minWidth: 22, height: 17,
            borderRadius: 3,
            backgroundColor: shortCodeBg,
            color: '#fff',
            fontSize: 10, fontWeight: 700, fontFamily: 'var(--app-font-sans)',
            letterSpacing: '0.04em',
            marginTop: 1,
          }}>
            {shortCode}
          </span>
          <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <span style={{
              fontSize: 13, fontWeight: 600, color: 'hsl(var(--foreground))', lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', wordBreak: 'break-word', overflowWrap: 'anywhere',
            }}>
              {displayLabel}
            </span>
          </div>
        </div>

        {/* Status + indicators cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: statusColor }}>{statusSymbol}</span>
          {/* G-S10: Validation badge */}
          {validation && (
            <span style={{
              fontSize: 10, fontFamily: 'var(--app-font-sans)', padding: '1px 3px', borderRadius: 3,
              backgroundColor:
                validation.blockers > 0 ? 'hsla(0,72%,51%,0.15)' :
                validation.warnings > 0 || validation.waiting > 0 ? 'hsla(38,92%,50%,0.15)' :
                validation.passed > 0  ? 'hsla(173,58%,39%,0.15)' :
                'hsl(var(--muted))',
              color:
                validation.blockers > 0 ? 'hsl(0 72% 40%)' :
                validation.warnings > 0 || validation.waiting > 0 ? 'hsl(38 92% 35%)' :
                validation.passed > 0  ? 'hsl(173 58% 30%)' :
                'hsl(var(--muted-foreground))',
            }}>
              {validation.blockers > 0
                ? `${validation.failed}✗`
                : validation.warnings > 0 || validation.waiting > 0
                ? `${validation.passed}✓${validation.waiting}⏳`
                : `${validation.passed}/${validation.total}✓`}
            </span>
          )}
          {isAccountingTrigger && (
            <Calculator size={9} style={{ color: 'hsl(38 92% 45%)' }} />
          )}
          {assignment.isGenerated && (
            <Sparkles size={9} style={{ color: 'hsl(38 92% 45%)' }} />
          )}
          {assignment.mandatoryPhoto && (
            <span title="Photo required" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Camera size={9} style={{ color: 'hsl(217 91% 50%)' }} />
            </span>
          )}
          {assignment.roleInGate === 'GATE_CRITICAL' && (
            <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: 'hsl(0 72% 50%)' }} title="Gate critical" />
          )}
          {assignment.roleInGate === 'PARALLEL' && (
            <span style={{ fontSize: 10, fontWeight: 700, color: 'hsl(201 96% 32%)', backgroundColor: 'hsla(201,96%,32%,0.10)', borderRadius: 999, padding: '1px 6px' }}>
              Parallel
            </span>
          )}
        </div>
      </div>

      {/* Row 2: hint only when no document is available */}
      {!document && (
        <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground) / 0.5)', marginTop: 3, fontStyle: 'italic' }}>
          {assignment.isGenerated ? 'Awaiting generation' : 'Expected'}
        </div>
      )}

      {/* Row 4: SLA deadline chip (only when gate is active, SLA set, doc not yet approved) */}
      {slaDeadline && !document?.approvedAt && (() => {
        const now = Date.now();
        const deadlineMs = slaDeadline.getTime();
        const diffMs = deadlineMs - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const isOverdue = diffMs < 0;
        const isDueSoon = !isOverdue && diffDays <= 2;
        const color = isOverdue
          ? 'hsl(0 72% 40%)'
          : isDueSoon ? 'hsl(38 92% 35%)'
          : 'hsl(173 58% 32%)';
        const bg = isOverdue
          ? 'hsla(0,72%,51%,0.12)'
          : isDueSoon ? 'hsla(38,92%,50%,0.12)'
          : 'hsla(173,58%,39%,0.10)';
        const label = isOverdue
          ? `Overdue ${Math.abs(diffDays)}d`
          : diffDays === 0 ? 'Due today'
          : `Due in ${diffDays}d`;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
            <Clock size={7} style={{ color, flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 600, color, backgroundColor: bg, borderRadius: 3, padding: '1px 4px' }}>
              {label}
            </span>
          </div>
        );
      })()}

      {/* Needs-photo indicator: doc uploaded but is not an image for a photo-required slot.
          Shown even for approved docs — an approved non-image still blocks gate progression. */}
      {assignment.mandatoryPhoto && document &&
        !fileIsImage(document.contentType, document.fileName) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
          <Camera size={7} style={{ color: 'hsl(38 92% 40%)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(38 92% 35%)', backgroundColor: 'hsla(38,92%,50%,0.12)', borderRadius: 3, padding: '1px 4px' }}>
            Needs photo
          </span>
        </div>
      )}

      {/* Mandatory photo hint when no doc uploaded at all */}
      {assignment.mandatoryPhoto && !document && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
          <Camera size={7} style={{ color: 'hsl(217 91% 50%)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: 'hsl(217 91% 45%)', fontStyle: 'italic' }}>Photo required</span>
        </div>
      )}
    </div>
  );
}

// ─── GateColumn ───────────────────────────────────────────────────────────────

function GateColumn({ gate, displayStatus, accessLevel, documents, validationMap, accountingTriggerDocTypes, onNavigate }: {
  gate: ApiGate;
  displayStatus: string;
  accessLevel: 'full' | 'summary' | 'none';
  documents: any[];
  validationMap: Record<string, ValidationCount>;
  accountingTriggerDocTypes: Set<string>;
  onNavigate: (path: string) => void;
}) {
  const { docTypes: allDocTypes } = useConfig();
  const gc = gate.gateConfig;
  const isFull = accessLevel === 'full';

  // Compute SLA deadline baseline: when gate is ACTIVE, updatedAt is when it transitioned to ACTIVE.
  // Fall back to createdAt (set at gate initialization) if updatedAt is unavailable.
  const gateActivatedAt = gate.status === 'ACTIVE'
    ? new Date((gate.updatedAt ?? gate.createdAt) as string)
    : null;

  const allGateDocs = docTypesForGate(gate, documents);
  const blockingGateDocs = allGateDocs.filter(dtg => dtg.roleInGate !== 'PARALLEL');
  const usedDocIds = new Set<string>();

  const borderColor =
    displayStatus === 'PASSED'  ? 'hsl(173 58% 70%)' :
    displayStatus === 'ACTIVE'  ? 'hsl(173 58% 50%)' :
    displayStatus === 'BLOCKED' ? 'hsl(0 72% 70%)' :
    'hsl(var(--border))';

  const headerBg =
    displayStatus === 'PASSED'  ? 'hsla(173,58%,39%,0.06)' :
    displayStatus === 'ACTIVE'  ? 'hsla(173,58%,39%,0.04)' :
    displayStatus === 'BLOCKED' ? 'hsla(0,72%,51%,0.05)' :
    'hsl(var(--muted) / 0.15)';

  const badgeBg =
    displayStatus === 'PASSED'  ? 'hsl(173 58% 39%)' :
    displayStatus === 'ACTIVE'  ? 'transparent' :
    displayStatus === 'BLOCKED' ? 'hsl(0 72% 50%)' :
    'hsl(var(--muted))';

  const badgeColor =
    displayStatus === 'ACTIVE'  ? 'hsl(173 58% 32%)' :
    displayStatus === 'FUTURE'  ? 'hsl(var(--muted-foreground))' :
    '#fff';

  const badgeOutline = displayStatus === 'ACTIVE' ? '1px solid hsl(173 58% 50%)' : 'none';

  // Doc completion count for header
  const completedCount = blockingGateDocs.filter(dtg => {
    const doc = findDocForSlot(documents, dtg.docType, undefined, gc.gateNumber);
    return validationPassed(doc, doc ? validationMap[doc.id] : null);
  }).length;

  return (
    <div style={{
      width: 200, flexShrink: 0, borderRadius: 8,
      border: `1px solid ${borderColor}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid hsl(var(--border))', backgroundColor: headerBg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: badgeBg, color: badgeColor,
            fontSize: 12, fontWeight: 700, outline: badgeOutline,
          }}>
            {gc.gateNumber}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
              {SHIPMENT_GATE_LABELS[gc.gateNumber] ?? gc.gateName}
            </div>
          </div>
          {gc.isIdentityGate && (
            <Fingerprint size={11} style={{ color: 'hsl(173 58% 39%)', flexShrink: 0 }} />
          )}
        </div>

        {/* Subtitle (gateLabel) + status row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            {gc.gateLabel && (
              <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                {gc.gateLabel}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <GateStatusBadge status={displayStatus} />
              {blockingGateDocs.length > 0 && (
                <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>
                  {completedCount}/{blockingGateDocs.length}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Gate check type */}
        {gc.gateCheckType && (
          <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 5 }}>
            {gc.gateCheckType === 'ALL_REQUIRED' && 'All critical docs required'}
            {gc.gateCheckType === 'ANY_REQUIRED' && 'Any critical doc sufficient'}
            {gc.gateCheckType === 'MANUAL'       && 'Manual gate pass'}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px', backgroundColor: 'hsl(var(--card))' }}>
        {isFull ? (
          allGateDocs.length > 0 ? (
            allGateDocs.map((dtg) => {
              const dtInfo = allDocTypes.find(dt => dt.typeCode === dtg.docType);
              const actualDocs = findDocsForSlot(documents, dtg.docType, usedDocIds, gc.gateNumber);
              const actualDoc = actualDocs.find(doc => !validationPassed(doc, validationMap[doc.id])) ?? actualDocs[0];
              const validation = actualDoc ? (validationMap[actualDoc.id] ?? null) : null;
              const isAccTrigger = accountingTriggerDocTypes.has(dtg.docType);
              const slaDeadline = gateActivatedAt && typeof dtg.slaOverrideDays === 'number' && dtg.slaOverrideDays > 0
                ? new Date(gateActivatedAt.getTime() + dtg.slaOverrideDays * 24 * 60 * 60 * 1000)
                : null;
              return (
                <DocumentStatusCard
                  key={dtg.id}
                  dtInfo={dtInfo}
                  assignment={dtg}
                  document={actualDoc}
                  documentCount={actualDocs.length}
                  validation={validation}
                  isAccountingTrigger={isAccTrigger}
                  slaDeadline={slaDeadline}
                  gateNumber={gc.gateNumber}
                  onNavigate={onNavigate}
                />
              );
            })
          ) : (
            <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', textAlign: 'center', padding: '12px 4px' }}>
              No documents assigned
            </div>
          )
        ) : (
          // Summary-only access
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', padding: '6px 2px' }}>
              <div>{allGateDocs.length} doc{allGateDocs.length !== 1 ? 's' : ''}</div>
            {(() => {
              const complete = blockingGateDocs.filter(dtg => {
                const doc = findDocForSlot(documents, dtg.docType, undefined, gc.gateNumber);
                return validationPassed(doc, doc ? validationMap[doc.id] : null);
              }).length;
              return complete > 0 && (
                <div style={{ color: 'hsl(173 58% 32%)', marginTop: 3 }}>{complete} validated</div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── IdentityBanner (G-S13) ───────────────────────────────────────────────────

function IdentityBanner({ shipment, identityGateName }: { shipment: any; identityGateName: string | null }) {
  if (shipment?.shipmentNumber) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderRadius: 8, marginBottom: 20,
        backgroundColor: 'hsla(173,58%,39%,0.08)',
        border: '1px solid hsla(173,58%,39%,0.25)',
      }}>
        <Fingerprint size={15} style={{ color: 'hsl(173 58% 36%)', flexShrink: 0 }} />
        <span style={{ fontSize: 14.5, color: 'hsl(173 58% 26%)' }}>
          Identity assigned:{' '}
          <span style={{ fontFamily: 'var(--app-font-sans)', fontWeight: 700 }}>{shipment.shipmentNumber}</span>
          {identityGateName && (
            <span style={{ opacity: 0.7, marginLeft: 8 }}>via {identityGateName}</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', borderRadius: 8, marginBottom: 20,
      backgroundColor: 'hsla(38,92%,50%,0.08)',
      border: '1px solid hsla(38,92%,50%,0.25)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Fingerprint size={15} style={{ color: 'hsl(38 92% 45%)', flexShrink: 0 }} />
        <span style={{ fontSize: 14.5, color: 'hsl(38 70% 30%)' }}>
          Pending identity — shipment number will be assigned
          {identityGateName && <> when the identity document arrives at <strong>{identityGateName}</strong></>}
        </span>
      </div>
      <RequireActivity code="SHP-002">
        <button
          onClick={() => {
            const num = window.prompt('Manually assign shipment number:');
            if (num?.trim()) {
              fetch(`/api/shipments/${shipment.id}/assign-identity`, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ shipmentNumber: num.trim() }),
              }).then(() => window.location.reload());
            }
          }}
          style={{ fontSize: 14, background: 'none', border: 'none', color: 'hsl(38 92% 40%)', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          Assign manually
        </button>
      </RequireActivity>
    </div>
  );
}

// ─── GenerationStatusPanel (G-S12) ───────────────────────────────────────────

function GenerationStatusPanel({ genTriggers, documents }: { genTriggers: any[]; documents: any[] }) {
  const { docTypes: allDocTypes } = useConfig();
  if (genTriggers.length === 0) return null;

  return (
    <div style={{
      backgroundColor: 'hsl(var(--card))', borderRadius: 8, padding: '16px 20px', marginTop: 20,
      border: '1px solid hsl(var(--card-border))', boxShadow: 'var(--vs-shadow-card)',
    }}>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
        Auto-Generation Status
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {genTriggers.map((trigger: any, idx: number) => {
          const targetDtInfo = allDocTypes.find(dt => dt.typeCode === trigger.generatedDocType);
          const existingDraft = documents.find(d =>
            (d.documentType ?? '').toUpperCase() === (trigger.generatedDocType ?? '').toUpperCase() &&
            !['REJECTED', 'CANCELLED'].includes((d.ocrStatus ?? '').toUpperCase()) &&
            !(d.approvedAt === null && (d.ocrStatus ?? '').toUpperCase() === 'FAILED')
          );

          const conditions = trigger.triggerConditions?.conditions || [];
          const conditionStatuses = conditions.map((cond: any) => {
            const doc = matchDoc(documents, cond.docType);
            const current = deriveDocStatus(doc);
            const met = !!doc && hasReachedStatus(current, cond.status);
            const condDtInfo = allDocTypes.find(dt => dt.typeCode === cond.docType);
            return { docType: cond.docType, requiredStatus: cond.status, displayName: condDtInfo?.displayName || cond.docType, shortCode: condDtInfo?.shortCode || cond.docType.slice(0, 3), met, currentStatus: doc ? current : null };
          });

          const allMet  = conditionStatuses.length > 0 && conditionStatuses.every((c: any) => c.met);
          const someMet = conditionStatuses.some((c: any) => c.met);

          const statusLabel =
            existingDraft ?
              (existingDraft.approvedAt ? 'Approved' :
               (existingDraft.ocrStatus === 'EXTRACTED' ? 'Draft ready for review' : `Draft: ${existingDraft.ocrStatus}`))
            : allMet ? 'Generating…'
            : someMet ? 'Waiting for conditions'
            : 'Conditions not met';

          const statusColor =
            existingDraft ? 'hsl(173 58% 32%)' :
            allMet ? 'hsl(217 91% 50%)' :
            someMet ? 'hsl(38 92% 38%)' :
            'hsl(var(--muted-foreground))';

          const sparkleColor =
            existingDraft ? 'hsl(173 58% 39%)' :
            allMet ? 'hsl(217 91% 50%)' :
            'hsl(var(--muted-foreground) / 0.4)';

          const isLast = idx === genTriggers.length - 1;

          return (
            <div key={trigger.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
              borderBottom: isLast ? 'none' : '1px solid hsl(var(--border) / 0.4)',
            }}>
              <Sparkles size={14} style={{ color: sparkleColor, flexShrink: 0, marginTop: 2, animation: allMet && !existingDraft ? 'pulse 1.5s ease-in-out infinite' : undefined }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
                    {targetDtInfo?.displayName || trigger.generatedDocType}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: statusColor }}>{statusLabel}</span>
                </div>

                {!existingDraft && conditionStatuses.length > 0 && (
                  <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {conditionStatuses.map((cond: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                        {cond.met
                          ? <CheckCircle size={10} style={{ color: 'hsl(173 58% 39%)', flexShrink: 0 }} />
                          : <Circle size={10} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
                        }
                        <span style={{ color: cond.met ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))', textDecoration: cond.met ? 'line-through' : 'none' }}>
                          {cond.displayName} reaches {cond.requiredStatus}
                        </span>
                        {!cond.met && cond.currentStatus && (
                          <span style={{ color: 'hsl(var(--muted-foreground) / 0.6)' }}>
                            (currently: {cond.currentStatus})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {existingDraft && (
                  <a href={`/documents/${existingDraft.id}`} style={{ fontSize: 14, color: 'hsl(173 58% 32%)', display: 'block', marginTop: 3 }}>
                    Open draft →
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MilestonePanelDocs ───────────────────────────────────────────────────────

function MilestonePanelDocs({ shipmentId, milestones, onRefetch }: {
  shipmentId: string;
  milestones: ApiMilestoneTracking[];
  onRefetch: () => void;
}) {
  const manualMilestones = milestones.filter(m => m.milestoneConfig?.type === 'MANUAL');
  if (manualMilestones.length === 0) return null;

  const pending   = manualMilestones.filter(m => m.status === 'PENDING').length;
  const completed = manualMilestones.filter(m => m.status === 'COMPLETED').length;

  return (
    <div style={{
      backgroundColor: 'hsl(var(--card))', borderRadius: 8,
      padding: '16px 20px', marginTop: 20,
      border: '1px solid hsl(var(--card-border))',
      boxShadow: 'var(--vs-shadow-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Manual Milestones
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: completed === manualMilestones.length ? 'hsl(142 71% 32%)' : 'hsl(var(--muted-foreground))' }}>
          {completed}/{manualMilestones.length} complete
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {manualMilestones.map(m => (
          <MilestonePanelRow
            key={m.id}
            milestone={m}
            shipmentId={shipmentId}
            onComplete={onRefetch}
          />
        ))}
      </div>
      {pending > 0 && (
        <div style={{ marginTop: 10, fontSize: 14, color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' }}>
          {pending} milestone{pending !== 1 ? 's' : ''} awaiting manual confirmation
        </div>
      )}
    </div>
  );
}

function MilestonePanelRow({ milestone: m, shipmentId, onComplete }: {
  milestone: ApiMilestoneTracking;
  shipmentId: string;
  onComplete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const isDone = m.status === 'COMPLETED';

  async function submit() {
    setSaving(true); setError(null);
    try {
      const token = getAuthToken();
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const r = await fetch(`/api/tracking/shipments/${shipmentId}/milestones/${m.milestoneNumber}/complete`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? 'Failed');
      setConfirming(false); setNotes('');
      onComplete();
    } catch (e: any) {
      setError(e.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 2 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        background: isDone ? 'hsla(142,71%,45%,0.06)' : 'hsl(var(--muted) / 0.15)',
        border: '1px solid hsl(var(--border) / 0.5)',
        borderRadius: confirming ? '8px 8px 0 0' : 8,
      }}>
        <div style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isDone ? 'hsla(142,71%,45%,0.15)' : 'hsl(var(--muted) / 0.4)',
        }}>
          {isDone
            ? <CheckCircle2 size={12} style={{ color: 'hsl(142 71% 35%)' }} />
            : <Circle size={12} style={{ color: 'hsl(var(--muted-foreground))' }} />
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: isDone ? 400 : 500, color: isDone ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))', textDecoration: isDone ? 'none' : 'none' }}>
            {m.milestoneConfig?.name ?? `Milestone #${m.milestoneNumber}`}
          </div>
          {isDone && m.completedAt && (
            <div style={{ fontSize: 14, color: 'hsl(142 71% 38%)', marginTop: 1 }}>
              Completed {new Date(m.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {m.completedByName && <span style={{ opacity: 0.85 }}> · {m.completedByName}</span>}
              {m.notes && <span style={{ opacity: 0.7 }}> · {m.notes}</span>}
            </div>
          )}
        </div>
        {!isDone && (
          <RequireActivity code="GATE-002">
            {!confirming ? (
              <button
                onClick={() => { setConfirming(true); setNotes(''); setError(null); }}
                style={{ fontSize: 14.5, fontWeight: 600, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                  background: 'hsla(142,71%,45%,0.1)', border: '1px solid hsla(142,71%,45%,0.3)',
                  color: 'hsl(142 71% 30%)', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Mark complete
              </button>
            ) : (
              <button
                onClick={() => { setConfirming(false); setError(null); }}
                style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Cancel
              </button>
            )}
          </RequireActivity>
        )}
      </div>

      {confirming && (
        <div style={{
          padding: '10px 12px', background: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border) / 0.5)', borderTop: 'none',
          borderRadius: '0 0 8px 8px',
        }}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={2}
            style={{ width: '100%', fontSize: 14.5, padding: '6px 8px', borderRadius: 6,
              border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
              color: 'hsl(var(--foreground))', resize: 'vertical', fontFamily: 'inherit',
              outline: 'none', boxSizing: 'border-box' }}
          />
          {error && <div style={{ fontSize: 14.5, color: 'hsl(var(--vs-danger))', marginTop: 4 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              onClick={submit}
              disabled={saving}
              style={{ fontSize: 14, fontWeight: 600, padding: '5px 14px', borderRadius: 6,
                cursor: saving ? 'not-allowed' : 'pointer', background: 'hsl(142 71% 38%)',
                border: 'none', color: '#fff', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Confirm'}
            </button>
            <button
              onClick={() => { setConfirming(false); setError(null); }}
              disabled={saving}
              style={{ fontSize: 14, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ShipmentDocumentsPage() {
  const { setPageMeta } = usePageMeta();
  const params = useParams<{ id: string }>();
  const shipmentId = params.id ?? '';
  const [, navigate] = useLocation();

  const { docTypes: allDocTypes, templates } = useConfig();
  const { documents, loading: docsLoading } = useShipmentDocuments(shipmentId);

  const [shipment, setShipment]     = useState<any>(null);
  const [gates, setGates]           = useState<ApiGate[]>([]);
  const [milestones, setMilestones] = useState<ApiMilestoneTracking[]>([]);
  const [validationMap, setValidationMap] = useState<Record<string, ValidationCount>>({});
  const [accountingTriggerDocTypes, setAccTriggers] = useState<Set<string>>(new Set());
  const [genTriggers, setGenTriggers] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    setError(null);
    const hdrs = authHeaders();
    try {
      const [shipRes, gatesRes, msRes] = await Promise.all([
        fetch(`/api/shipments/${shipmentId}`, { headers: hdrs }),
        fetch(`/api/shipments/${shipmentId}/gates`, { headers: hdrs }),
        fetch(`/api/tracking/shipments/${shipmentId}/milestones`, { headers: hdrs }),
      ]);
      if (!shipRes.ok) throw new Error(`Shipment ${shipRes.status}`);
      const shipJson = await shipRes.json();
      setShipment(shipJson.data);

      if (gatesRes.ok) {
        const gJson = await gatesRes.json();
        const sorted = (gJson.data ?? []).sort((a: ApiGate, b: ApiGate) =>
          (a.gateConfig?.gateNumber ?? 0) - (b.gateConfig?.gateNumber ?? 0)
        );
        setGates(sorted);
      }
      if (msRes.ok) {
        const msJson = await msRes.json();
        setMilestones(msJson.data ?? []);
      }
    } catch (err: any) {
      setError(err.message ?? 'Could not load shipment');
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  // Load validation results
  useEffect(() => {
    if (!shipmentId) return;
    const hdrs = authHeaders();
    fetch(`/api/validation/shipments/${shipmentId}`, { headers: hdrs })
      .then(r => r.ok ? r.json() : Promise.resolve({ data: [] }))
      .then(d => {
        const map: Record<string, ValidationCount> = {};
        for (const result of (d.data ?? [])) {
          const docId = result.documentId;
          if (!docId) continue;
          if (!map[docId]) map[docId] = { total: 0, passed: 0, failed: 0, blockers: 0, warnings: 0, waiting: 0, overridden: 0 };
          map[docId].total++;
          if (result.status === 'PASS')       map[docId].passed++;
          else if (result.status === 'FAIL') {
            if (result.alertLevel === 'BLOCKER' || result.blockingBehavior === 'BLOCK') {
              map[docId].failed++;
              map[docId].blockers++;
            } else {
              map[docId].warnings++;
            }
          }
          else if (result.status === 'WARNING' || result.alertLevel === 'WARNING') map[docId].warnings++;
          else if (result.status === 'WAITING') map[docId].waiting++;
          else if (result.status === 'OVERRIDDEN') map[docId].overridden++;
        }
        setValidationMap(map);
      })
      .catch(() => {});
  }, [shipmentId]);

  // Load accounting triggers (admin-only, graceful 403 fallback)
  useEffect(() => {
    const hdrs = authHeaders();
    fetch('/api/admin/accounting/triggers', { headers: hdrs })
      .then(r => r.ok ? r.json() : Promise.resolve({ data: [] }))
      .then(d => {
        const types = new Set<string>(
          (d.data || []).filter((t: any) => t.isActive).map((t: any) => t.sourceDocType as string)
        );
        setAccTriggers(types);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Load gen triggers from template config when shipment arrives
  useEffect(() => {
    if (!shipment?.templateId) return;
    const template = templates.find((t: any) => t.id === shipment.templateId);
    setGenTriggers((template as any)?.genTriggers || []);
  }, [shipment, templates]);

  // ─── Derived ─────────────────────────────────────────────────────────────

  // Find first OPEN gate index for ACTIVE designation
  const firstOpenIdx = gates.findIndex(g => g.status === 'OPEN');

  // Visible gates (not 'none' access)
  const visibleGates = gates;

  // Identity gate name
  const identityGate = gates.find(g => g.gateConfig?.isIdentityGate);
  const identityGateName = identityGate?.gateConfig?.gateName ?? null;

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading || docsLoading) {
    return (
      <div style={{ padding: 28 }}>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ width: 180, height: 260, borderRadius: 8, backgroundColor: 'hsl(var(--muted) / 0.4)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div style={{ padding: 28, display: 'flex', alignItems: 'center', gap: 8, color: 'hsl(var(--vs-danger))' }}>
        <AlertCircle size={16} />
        <span style={{ fontSize: 14 }}>{error ?? 'Shipment not found'}</span>
      </div>
    );
  }

  const gatesPassed = gates.filter(g => g.status === 'PASSED').length;
  const docsValidated = documents.filter(d => validationPassed(d, validationMap[d.id])).length;
  useEffect(() => {
    setPageMeta({
      title: 'Documents Status',
      subtitle: `Gate-column view · ${gatesPassed}/${gates.length} gates passed · ${docsValidated}/${documents.length} docs validated`,
    });
    return () => setPageMeta(null);
  }, [gatesPassed, gates.length, docsValidated, documents.length, setPageMeta]);

  return (
    <div style={{ padding: 28, minHeight: '100%' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>

      {/* G-S13: Identity banner */}
      <IdentityBanner shipment={shipment} identityGateName={identityGateName} />

      {/* Gate columns (horizontally scrollable) */}
      {gates.length === 0 ? (
        <div style={{
          padding: '40px 24px', textAlign: 'center', borderRadius: 8,
          border: '1px dashed hsl(var(--border))',
          color: 'hsl(var(--muted-foreground))', fontSize: 14.5,
        }}>
          No gates initialized for this shipment.{' '}
          <button
            onClick={() => navigate(`/shipments/${shipmentId}`)}
            style={{ background: 'none', border: 'none', color: 'hsl(var(--primary))', cursor: 'pointer', fontSize: 14.5, fontWeight: 500 }}
          >
            Go to shipment page to initialize gates →
          </button>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16, minWidth: 'max-content' }}>
            {visibleGates.map((gate, idx) => {
              const accessLevel = 'full' as const;

              // Determine display status
              const isFirstOpen = gates.indexOf(gate) === firstOpenIdx;
              const displayStatus = gateDisplayStatus(gate, isFirstOpen);

              return (
                <GateColumn
                  key={gate.id}
                  gate={gate}
                  displayStatus={displayStatus}
                  accessLevel={accessLevel}
                  documents={documents}
                  validationMap={validationMap}
                  accountingTriggerDocTypes={accountingTriggerDocTypes}
                  onNavigate={navigate}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* G-S12: Generation status panel */}
      <GenerationStatusPanel genTriggers={genTriggers} documents={documents} />

      {/* Manual milestone completion panel */}
      <MilestonePanelDocs shipmentId={shipmentId} milestones={milestones} onRefetch={loadAll} />
    </div>
  );
}

export default ShipmentDocumentsPage;
