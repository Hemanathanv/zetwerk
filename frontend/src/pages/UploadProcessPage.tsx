import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { apiGet, getAuthToken } from '@/lib/api';
import { documentApi } from '@/auth/api';
import { useConfig } from '@/contexts/ConfigContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { buildDocTypeOptions } from '@/utils/docTypeDropdown';
import { useLocation } from 'wouter';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UploadCloud, ChevronDown, ChevronRight,
  Sparkles, X, CheckCircle2, Search, Pencil,
  ChevronRight as ArrowRight,
  AlertTriangle, Clock3, Loader2,
} from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { StatusPill }    from '@/components/vs/StatusPill';
import { DocBadge }      from '@/components/vs/DocBadge';
import { ConfidenceBar } from '@/components/vs/ConfidenceBar';
import { FilterChips }   from '@/components/vs/FilterChips';
import { useToast } from '@/hooks/use-toast';
import type { ContainerMappingResponse, ContainerMappingRow } from '@/types/backend';
import { ShipmentDndInputsDialog } from '@/pages/ShipmentDetailPage';

// ─── Design tokens ───────────────────────────────────────────────────────────
const TEAL   = 'hsl(173 58% 39%)';
const FG     = 'hsl(var(--foreground))';
const MUTED  = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const GREEN  = 'hsl(152 69% 31%)';
const AMBER  = 'hsl(38 92% 50%)';
const RED    = 'hsl(0 84% 60%)';
const BLUE   = 'hsl(221 83% 53%)';
const INFO   = 'hsl(201 96% 32%)';
const GOLD   = 'hsl(43 96% 56%)';
const GOLD_BG = 'hsla(43,96%,56%,0.10)';
// Data columns use minmax(0, Nfr) so they shrink instead of overflowing.
// Action column keeps minmax(88px, …) so Review/Details never collide with Status.
const QUEUE_ROW_GRID = '3px 32px minmax(0, 24fr) minmax(0, 28fr) minmax(0, 10fr) minmax(0, 7fr) minmax(0, 12fr) minmax(88px, 14fr)';
const QUEUE_ROW_GAP = 14;
const QUEUE_ROW_ESTIMATE_H = 72;
const QUEUE_PAGE_SIZE = 20;
const QUEUE_SECTION_BY_CHIP = [
  'all',
  'needs-approval',
  'needs-reapproval',
  'processing',
  'cross-validating',
  'draft-review',
  'done',
  'waiting-for-bol',
] as const;

function normalizeQueueDocTypeFilter(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'all';
}

function queueDocTypeFilterFromLocation(location: string): string {
  const query = location.includes('?') ? location.slice(location.indexOf('?') + 1) : '';
  return normalizeQueueDocTypeFilter(new URLSearchParams(query).get('docType'));
}

type StatusCategory = 'needs-approval' | 'needs-reapproval' | 'processing' | 'cross-validating' | 'draft-review' | 'done' | 'waiting-for-bol';

type WaitingDoc = {
  id: string;
  documentType?: string | null;
  documentNumber?: string | null;
  corridor?: string | null;
  ocrStatus?: string | null;
  generatedFrom?: Record<string, any> | null;
  createdAt?: string | null;
  uploadedBy?: { fullName?: string | null; email?: string | null } | null;
  salesInvoiceExtraction?: Record<string, any> | null;
  packingListExtraction?: Record<string, any> | null;
  billOfLadingExtraction?: Record<string, any> | null;
  bolExtraction?: Record<string, any> | null;
};

type GeneratedDocType = 'PACKING_LIST' | 'US_PACKING_LIST' | 'ENTRY_SUMMARY';

type EscalationConfig = {
  id: string;
  activityType: string;
  activityName?: string;
  scope?: string;
  baseDoc?: string;
  baseSlaHours: number | string;
  reminderPct: number;
  warningPct: number;
  escalationPct: number;
  blockerPct: number;
};

type GeneratedDraftValidation = ValidationSummary & {
  status?: 'PASSED' | 'WARNING' | 'BLOCKED' | 'WAITING' | string | null;
  okToProgress?: boolean;
  alerts?: Array<Record<string, unknown>>;
  results?: ValidationResultRow[];
};

type DraftPayload = {
  draftId: string;
  generatedDocType: GeneratedDocType;
  displayName: string;
  status: string;
  sourceDocs: string[];
  sourceDocumentIds: Record<string, string>;
  sections: Array<{
    sectionLabel: string;
    fields: Array<{
      targetField?: string;
      targetLabel?: string;
      value?: unknown;
      sourceDoc?: string;
      mappingType?: string;
    }>;
  }>;
  stats?: Record<string, number>;
  createdAt?: string | null;
  updatedAt?: string | null;
};

// ─── Live clock hook (ticks every 60 s so SLA badges update without reload) ───
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return now;
}

// ─── Pipeline dots ────────────────────────────────────────────────────────────
type DotState = 'done' | 'current' | 'current-spin' | 'future';

function uploadErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
  }
  return err instanceof Error ? err.message : 'Unable to upload right now.';
}

const STAGE_LABELS = ['Upload', 'Extract', 'Approve', 'Cross-val', 'Close'];

function PipelineDots({ dots, gold }: { dots: DotState[]; gold?: boolean }) {
  const activeColor = gold ? GOLD : TEAL;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
      {dots.map((dot, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor:
                dot === 'done'    ? activeColor :
                dot === 'current' || dot === 'current-spin' ? activeColor :
                'hsl(var(--border))',
              boxShadow: (dot === 'current' || dot === 'current-spin')
                ? `0 0 0 3px ${gold ? 'hsla(43,96%,56%,0.25)' : 'hsla(173,58%,39%,0.25)'}`
                : 'none',
              opacity: dot === 'future' ? 0.35 : 1,
              position: 'relative',
            }}>
              {dot === 'current-spin' && (
                <div style={{
                  position: 'absolute', inset: -3, borderRadius: '50%',
                  border: `2px solid ${INFO}`, borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                }} />
              )}
            </div>
            <span style={{ fontSize: 13, color: dot === 'future' ? MUTED : FG, opacity: dot === 'future' ? 0.4 : 0.7, whiteSpace: 'nowrap' }}>
              {STAGE_LABELS[i]}
            </span>
          </div>
          {i < dots.length - 1 && (
            <div style={{
              flex: 1, height: 1, minWidth: 4,
              backgroundColor: dot === 'done' ? activeColor : 'hsl(var(--border))',
              opacity: 0.5, flexShrink: 1, marginTop: 4,
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function waitingAgeInfo(createdAt: string, now: number) {
  const ageH = (now - new Date(createdAt).getTime()) / 3600000;
  if (ageH >= 96) {
    const d = Math.floor(ageH / 24);
    return { color: RED, bg: 'hsla(0,84%,60%,0.10)', border: 'hsla(0,84%,60%,0.25)', label: `${d}d` };
  }
  if (ageH >= 48) {
    const h = Math.round(ageH);
    return { color: AMBER, bg: 'hsla(38,92%,50%,0.10)', border: 'hsla(38,92%,50%,0.25)', label: `${h}h` };
  }
  const h = Math.max(1, Math.round(ageH));
  return { color: MUTED, bg: 'hsl(var(--muted) / 0.4)', border: BORDER, label: `${h}h` };
}

// ─── Single waiting group (SI header + optional linked PL row) ────────────────
function WaitingGroupEl({ si, pl, solo, now }: {
  si: WaitingDoc | null;
  pl: WaitingDoc | null;
  solo?: WaitingDoc;
  now: number;
}) {
  // Determine which doc carries the group header
  const primary = si ?? solo ?? pl!;
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/-/g, '_');
  const isPrimaryPL = norm(primary.documentType) === 'packing_list' || norm(primary.documentType) === 'pl';
  const ext = primary.salesInvoiceExtraction ?? {};
  const invoiceNo = ext.invoiceNumber ?? ext.invoiceNo ?? primary.documentNumber ?? '—';
  const exporterName = ext.exporterName ?? ext.sellerName ?? ext.exporter ?? '';
  const uploadedBy = primary.uploadedBy?.fullName ?? primary.uploadedBy?.email ?? '';
  const age = waitingAgeInfo(primary.createdAt ?? new Date().toISOString(), now);
  const accentColor = si ? GREEN : BLUE;

  function PlRow({ doc }: { doc: WaitingDoc }) {
    const plNum = doc.documentNumber ?? '—';
    const plUploadedBy = doc.uploadedBy?.fullName ?? doc.uploadedBy?.email ?? '';
    const plAge = waitingAgeInfo(doc.createdAt ?? new Date().toISOString(), now);
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px 8px 48px',
        borderLeft: `3px solid ${BORDER}`,
        backgroundColor: 'hsl(var(--muted) / 0.15)',
        borderTop: `1px solid ${BORDER}`,
      }}>
        <DocBadge code="PL" size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: FG }}>Packing List</span>
            {plNum !== '—' && (
              <span className="vs-mono" style={{ fontSize: 14.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plNum}</span>
            )}
          </div>
          {plUploadedBy && (
            <div style={{ fontSize: 14, color: MUTED, marginTop: 1 }}>Uploaded by {plUploadedBy}</div>
          )}
        </div>
        {doc.corridor && (
          <span style={{ fontSize: 14, fontWeight: 600, padding: '2px 7px', borderRadius: 4, flexShrink: 0, backgroundColor: `${TEAL}14`, color: TEAL, border: `1px solid ${TEAL}30` }}>{doc.corridor}</span>
        )}
        <span style={{ fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 999, flexShrink: 0, backgroundColor: plAge.bg, color: plAge.color, border: `1px solid ${plAge.border}` }}>{plAge.label}</span>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: 'hsl(var(--card))', borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
      {/* Group header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderLeft: `3px solid ${accentColor}`,
        backgroundColor: si ? `${GREEN}06` : isPrimaryPL ? `${BLUE}06` : 'hsl(var(--card))',
      }}>
        <DocBadge code={si ? 'SI' : isPrimaryPL ? 'PL' : 'DR'} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="vs-mono" style={{ fontSize: 14, fontWeight: 700, color: FG }}>{invoiceNo}</span>
            {exporterName && (
              <span style={{ fontSize: 14, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exporterName}</span>
            )}
          </div>
          {uploadedBy && (
            <div style={{ fontSize: 14, color: MUTED, marginTop: 1 }}>Uploaded by {uploadedBy}</div>
          )}
        </div>
        {primary.corridor && (
          <span style={{ fontSize: 14, fontWeight: 600, padding: '2px 7px', borderRadius: 4, flexShrink: 0, backgroundColor: `${TEAL}14`, color: TEAL, border: `1px solid ${TEAL}30` }}>{primary.corridor}</span>
        )}
        <span style={{ fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 999, flexShrink: 0, backgroundColor: age.bg, color: age.color, border: `1px solid ${age.border}` }}>{age.label}</span>
      </div>
      {/* Linked PL row */}
      {pl && <PlRow doc={pl} />}
    </div>
  );
}

// ─── Inbox BOL card — shown for BOL docs awaiting manual template selection ───
function BolWaitingCard({
  doc,
  now,
  onResolved,
}: {
  doc: WaitingDoc;
  now: number;
  onResolved: () => void;
}) {
  const [templates, setTemplates] = useState<{ id: string; name: string; shipmentType?: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const age = waitingAgeInfo(doc.createdAt ?? new Date().toISOString(), now);
  const bolNum = doc.bolExtraction?.bolNumber ?? doc.documentNumber ?? '—';
  const isTerminal = ['extracted', 'EXTRACTED', 'completed', 'UPLOADED'].includes(doc.ocrStatus ?? '');

  useEffect(() => {
    const token = getAuthToken();
    fetch('/api/admin/templates', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => setTemplates((j.data ?? []).filter((t: any) => t.templateStatus === 'ACTIVE')))
      .catch(() => {});
  }, []);

  async function handleCreate() {
    if (!selectedTemplate || creating) return;
    setCreating(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/documents/${doc.id}/inbox-bol/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ templateId: selectedTemplate }),
      });
      const json = await res.json();
      if (json.ok) {
        toast({ title: 'Shipment created', description: 'Gates initialised and awaiting identity assignment.' });
        onResolved();
      } else {
        toast({ title: 'Error', description: json.error ?? 'Failed to create shipment', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach server', variant: 'destructive' });
    }
    setCreating(false);
  }

  return (
    <div style={{
      backgroundColor: 'hsl(var(--card))',
      borderRadius: 8,
      border: `1px solid ${isTerminal ? AMBER + '60' : BORDER}`,
      overflow: 'hidden',
      marginBottom: 4,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        borderLeft: `3px solid ${isTerminal ? AMBER : MUTED}`,
        backgroundColor: isTerminal ? `${AMBER}08` : 'hsl(var(--card))',
      }}>
        <DocBadge code="BOL" size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="vs-mono" style={{ fontSize: 14, fontWeight: 700, color: FG }}>{bolNum}</span>
            <span style={{ fontSize: 14.5, color: MUTED }}>Bill of Lading</span>
          </div>
          <div style={{ fontSize: 14, color: isTerminal ? AMBER : MUTED, marginTop: 1 }}>
            {isTerminal ? 'OCR complete · Template selection required' : 'OCR in progress…'}
          </div>
        </div>
        {doc.uploadedBy && (
          <span style={{ fontSize: 14, color: MUTED, flexShrink: 0 }}>
            {doc.uploadedBy.fullName ?? doc.uploadedBy.email}
          </span>
        )}
        <span style={{
          fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 999, flexShrink: 0,
          backgroundColor: age.bg, color: age.color, border: `1px solid ${age.border}`,
        }}>{age.label}</span>
      </div>
      {isTerminal && (
        <div style={{
          padding: '10px 14px',
          borderTop: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <select
            value={selectedTemplate}
            onChange={e => setSelectedTemplate(e.target.value)}
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 7,
              border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))',
              fontSize: 14, color: selectedTemplate ? FG : MUTED, cursor: 'pointer',
            }}
          >
            <option value="">Select workflow template…</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.shipmentType ? ` (${t.shipmentType})` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={!selectedTemplate || creating}
            style={{
              padding: '7px 16px', borderRadius: 7, fontSize: 14, fontWeight: 600,
              backgroundColor: selectedTemplate && !creating ? TEAL : 'hsl(var(--muted))',
              color: selectedTemplate && !creating ? 'white' : MUTED,
              border: 'none', cursor: selectedTemplate && !creating ? 'pointer' : 'not-allowed',
              flexShrink: 0, transition: 'background 0.15s',
            }}
          >
            {creating ? 'Creating…' : 'Create Shipment'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Waiting list view ────────────────────────────────────────────────────────
function WaitingListView({ docs, now }: { docs: WaitingDoc[]; now: number }) {
  const groups: { si: WaitingDoc | null; pl: WaitingDoc | null; solo?: WaitingDoc }[] = useMemo(() => {
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/-/g, '_');
    const isSI = (d: WaitingDoc) => ['sales_invoice', 'si'].includes(norm(d.documentType));
    const isPL = (d: WaitingDoc) => ['packing_list', 'pl'].includes(norm(d.documentType));

    const siDocs = docs.filter(isSI);
    const plDocs = docs.filter(isPL);
    const otherDocs = docs.filter(d => !isSI(d) && !isPL(d));

    const usedPlIds = new Set<string>();
    const result: { si: WaitingDoc | null; pl: WaitingDoc | null; solo?: WaitingDoc }[] = [];

    for (const si of siDocs) {
      // Match PL via generatedFrom.sourceDocIds.SALES_INVOICE or generatedFrom.sales_invoice_id
      const matchedPl = plDocs.find(pl => {
        if (usedPlIds.has(pl.id)) return false;
        const gf = pl.generatedFrom ?? {};
        const sourceDocIds: Record<string, string> = (gf.sourceDocIds && typeof gf.sourceDocIds === 'object') ? gf.sourceDocIds : {};
        return sourceDocIds['SALES_INVOICE'] === si.id || gf.sales_invoice_id === si.id;
      }) ?? null;
      if (matchedPl) usedPlIds.add(matchedPl.id);
      result.push({ si, pl: matchedPl });
    }
    // Orphan PLs (not linked to any SI)
    for (const pl of plDocs) {
      if (!usedPlIds.has(pl.id)) result.push({ si: null, pl, solo: pl });
    }
    // Other doc types
    for (const d of otherDocs) result.push({ si: null, pl: null, solo: d });
    return result;
  }, [docs]);

  if (docs.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', color: MUTED }}>
        <CheckCircle2 size={32} style={{ opacity: 0.25, marginBottom: 10 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: FG, marginBottom: 4 }}>No documents waiting</div>
        <div style={{ fontSize: 14 }}>Uploaded SIs and PLs without a BOL match will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: MUTED, marginBottom: 10 }}>
        {docs.length} document{docs.length === 1 ? '' : 's'} uploaded without a BOL — will attach automatically once a matching Bill of Lading arrives.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map(({ si, pl, solo }) => (
          <WaitingGroupEl
            key={si?.id ?? solo?.id ?? pl?.id}
            si={si}
            pl={pl}
            solo={solo}
            now={now}
          />
        ))}
      </div>
    </div>
  );
}

type QueueCard = {
  id: string;
  docId?: string;          // real DB document UUID — set for live API docs
  headerColor: string;
  docCode: string;
  docType: string;
  documentTypeCode?: string;
  isGenerated?: boolean;
  issuer: string;
  docNumber: string;
  status: string;
  statusVariant: 'info' | 'warning' | 'pending' | 'validated' | 'danger' | 'success';
  statusCategory: StatusCategory;
  avgConfidence: number;       // 0–1, used in row view confidence pill
  dots: DotState[];
  goldDots?: boolean;
  detail: React.ReactNode;
  action?: { label: string; primary?: boolean; teal?: boolean; onClick?: () => void; href?: string };
  context: string;
  timestamp: string;
  createdAt?: string;
  validationSummary?: ValidationSummary | null;
  validationResults?: ValidationResultRow[];
  // Generated doc provenance — sourceDocId navigates to the triggering source document
  sourceDocId?: string;
  provenanceLabel?: string;
  containerMappingAction?: () => void;
  dndInputsAction?: () => void;
  canUseContainerMapping?: boolean;
  canUseDndInputs?: boolean;
  dndInputsContext?: { bolCarrierName?: string | null; origin?: string | null; destination?: string | null; cargo?: string | null; };
};

type ValidationSummary = {
  total?: number;
  passed?: number;
  failed?: number;
  warnings?: number;
  waiting?: number;
  skipped?: number;
  blockingFailures?: number;
};

type ValidationResultRow = {
  ruleCode?: string | null;
  description?: string | null;
  sourceDocType?: string | null;
  targetDocType?: string | null;
  status?: string | null;
  displayStatus?: string | null;
  blockingBehavior?: string | null;
  delta?: string | null;
  alertLevel?: string | null;
};

function validationCounts(summary?: ValidationSummary | null, results: ValidationResultRow[] = []) {
  const total = Number(summary?.total ?? results.length ?? 0);
  const hasResults = results.length > 0;
  const isWarnOutcome = (r: ValidationResultRow) => {
    const status = String(r.status ?? '').toUpperCase();
    const behavior = String(r.blockingBehavior ?? '').toUpperCase();
    return behavior === 'WARN' && ['FAIL', 'WARNING', 'SKIPPED'].includes(status);
  };
  const isBlockedOutcome = (r: ValidationResultRow) => {
    const status = String(r.status ?? '').toUpperCase();
    const behavior = String(r.blockingBehavior ?? '').toUpperCase();
    return behavior === 'BLOCK' && ['FAIL', 'SKIPPED'].includes(status);
  };
  const passed = Number(hasResults ? results.filter(r => String(r.status ?? '').toUpperCase() === 'PASS').length : summary?.passed ?? 0);
  const warnings = Number(hasResults ? results.filter(isWarnOutcome).length : summary?.warnings ?? 0);
  const waiting = Number(hasResults ? results.filter(r => String(r.status ?? '').toUpperCase() === 'WAITING').length : summary?.waiting ?? 0);
  const blockingFailures = Number(hasResults ? results.filter(isBlockedOutcome).length : summary?.blockingFailures ?? 0);
  const failed = Number(hasResults ? results.filter(isBlockedOutcome).length : summary?.failed ?? 0);
  return { total, passed, warnings, waiting, blockingFailures, failed };
}

function formatDocTypeLabel(value?: string | null) {
  const text = String(value || 'Self').replace(/_/g, ' ').toLowerCase();
  return text.replace(/\b\w/g, char => char.toUpperCase());
}

function QueueCardEl({ card, onApproveClick, onStopClick, onRetryClick, onCardClick, onDetailsClick, slaConfig }: {
  card: QueueCard;
  onApproveClick?: () => void;
  onStopClick?: () => void;
  onRetryClick?: () => void;
  onCardClick?: () => void;
  onDetailsClick?: () => void;
  slaConfig?: EscalationConfig | null;
}) {
  const [, navigate] = useLocation();
  const [hovered, setHovered] = useState(false);
  const now = useNow();
  const slaInfo = slaBadgeInfo(card, slaConfig, now);
  const slaHours: number | null = null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onCardClick}
      style={{
        backgroundColor: 'hsl(var(--card))',
        borderRadius: 8, overflow: 'hidden',
        border: `1px solid ${BORDER}`,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.12s',
        cursor: onCardClick ? 'pointer' : 'default',
        boxShadow: hovered ? '0 4px 16px hsla(220,14%,10%,0.12)' : 'var(--vs-shadow-card)',
      }}
    >
      {/* Colored top strip */}
      <div style={{ height: 4, backgroundColor: card.headerColor }} />

      {/* Body */}
      <div style={{ padding: '14px 18px 16px' }}>
        {/* Row 1: identity + pill */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <DocBadge code={card.docCode} size="md" />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: FG }}>{card.docType}</span>
                {card.isGenerated && <Sparkles size={13} style={{ color: GOLD, flexShrink: 0 }} />}
              </div>
              <span style={{ fontSize: 14.5, color: MUTED }}>{card.issuer}</span>
              <br />
              <span className="vs-mono" style={{ fontSize: 14.5, color: FG }}>{card.docNumber}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {card.statusVariant === 'info' ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 999, fontSize: 14.5, fontWeight: 500,
                backgroundColor: 'hsla(221,83%,53%,0.12)', color: BLUE,
              }}>
                {card.status}
              </span>
            ) : card.statusVariant === 'validated' ? (
              <span style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 14.5, fontWeight: 500,
                backgroundColor: GOLD_BG, color: 'hsl(38 92% 30%)',
                display: 'inline-block',
              }}>
                {card.status}
              </span>
            ) : card.statusVariant === 'danger' ? (
              <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, display: 'inline-block', backgroundColor: 'hsla(0,84%,60%,0.12)', color: RED }}>
                {card.status}
              </span>
            ) : card.statusVariant === 'success' ? (
              <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 14.5, fontWeight: 500, display: 'inline-block', backgroundColor: `${GREEN}18`, color: GREEN }}>
                {card.status}
              </span>
            ) : (
              <StatusPill status={card.status} variant={card.statusVariant} />
            )}
            <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{card.timestamp}</div>
            {/* SLA urgency badge — shown when approval is overdue */}
            {false && slaHours != null && needsReviewApproval(card) && card.createdAt && (() => {
              const elapsed = (now - new Date(card.createdAt!).getTime()) / 3600000;
              if (elapsed <= slaHours!) {
                // Within SLA — show warning chip only when < 25% of window remains
                const remainingH = slaHours! - elapsed;
                if (remainingH >= slaHours! * 0.25) return null;
                const totalMins = Math.round(remainingH * 60);
                const hPart = Math.floor(totalMins / 60);
                const mPart = totalMins % 60;
                const timeStr = hPart > 0 ? (mPart > 0 ? `${hPart}h ${mPart}m` : `${hPart}h`) : `${Math.max(1, mPart)}m`;
                return (
                  <span style={{
                    display: 'inline-block', fontSize: 14, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 999, marginTop: 3,
                    backgroundColor: 'hsla(43,96%,56%,0.13)',
                    color: 'hsl(38 85% 32%)',
                    border: '1px solid hsla(43,96%,56%,0.35)',
                    whiteSpace: 'nowrap',
                  }}>
                    {timeStr} remaining
                  </span>
                );
              }
              const isBreached = elapsed > slaHours! * 1.5;
              const overdueH = elapsed - slaHours!;
              const days = Math.floor(overdueH / 24);
              const hrs = Math.floor(overdueH % 24);
              const timeStr = days > 0 ? (hrs > 0 ? `${days}d ${hrs}h` : `${days}d`) : `${Math.max(1, hrs)}h`;
              return (
                <span style={{
                  display: 'inline-block', fontSize: 14, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 999, marginTop: 3,
                  backgroundColor: isBreached ? 'hsla(0,84%,60%,0.12)' : 'hsla(38,92%,50%,0.12)',
                  color: isBreached ? RED : AMBER,
                  border: `1px solid ${isBreached ? 'hsla(0,84%,60%,0.25)' : 'hsla(38,92%,50%,0.25)'}`,
                  whiteSpace: 'nowrap',
                }}>
                  {timeStr} {isBreached ? 'SLA breached' : 'overdue'}
                </span>
              );
            })()}
            {slaInfo && (
              <span style={{
                display: 'inline-block', fontSize: 14, fontWeight: 700,
                padding: '1px 6px', borderRadius: 999, marginTop: 3,
                backgroundColor: slaInfo.bg,
                color: slaInfo.color,
                border: `1px solid ${slaInfo.border}`,
                whiteSpace: 'nowrap',
              }}>
                {slaInfo.label}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Pipeline */}
        <div style={{ marginTop: 12 }}>
          <PipelineDots dots={card.dots} gold={card.goldDots} />
        </div>

        {/* Row 3: Status detail */}
        <div style={{ marginTop: 10, fontSize: 14, color: FG }}>
          {card.detail}
        </div>

        {/* Row 3b: Provenance chip for generated docs */}
        {card.isGenerated && card.provenanceLabel && (
          <div style={{ marginTop: 6 }}>
            {card.sourceDocId ? (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/documents/${card.sourceDocId}`); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 14.5, color: GOLD, fontWeight: 500,
                  background: GOLD_BG, border: `1px solid ${GOLD}40`,
                  borderRadius: 999, padding: '2px 9px', cursor: 'pointer',
                }}
              >
                <Sparkles size={9} />
                {card.provenanceLabel} →
              </button>
            ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 14.5, color: GOLD, fontWeight: 500,
                background: GOLD_BG, border: `1px solid ${GOLD}40`,
                borderRadius: 999, padding: '2px 9px',
              }}>
                <Sparkles size={9} />
                {card.provenanceLabel}
              </span>
            )}
          </div>
        )}

        {/* Row 4: Shipment context */}
        <div style={{ marginTop: 6, fontSize: 14.5, color: MUTED }}>
          <span className="vs-mono" style={{ fontSize: 14.5,}}>{card.context}</span>
        </div>

        {/* Row 5: Actions */}
        {onStopClick && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={(event) => { event.stopPropagation(); onStopClick(); }}
              style={{
                fontSize: 14, fontWeight: 700, color: RED,
                backgroundColor: 'transparent', border: `1px solid ${RED}60`, borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer',
              }}
            >
              Stop extraction
            </button>
          </div>
        )}
        {onRetryClick && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={(event) => { event.stopPropagation(); onRetryClick(); }}
              style={{
                fontSize: 14, fontWeight: 700, color: '#fff',
                backgroundColor: BLUE, border: 'none', borderRadius: 6,
                padding: '7px 16px', cursor: 'pointer',
              }}
            >
              Retry extraction
            </button>
          </div>
        )}
        {card.action && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {card.action.label === 'View details →' ? (
              <button
                onClick={(e) => { e.stopPropagation(); onDetailsClick?.(); }}
                style={{
                  fontSize: 14.5, fontWeight: 500, color: TEAL,
                  background: 'none', border: `1px solid ${TEAL}40`, borderRadius: 6,
                  padding: '5px 12px', cursor: 'pointer',
                }}
              >
                View details →
              </button>
            ) : card.action.teal ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  card.action?.href ? navigate(card.action.href) : card.action?.onClick?.();
                }}
                style={{
                  fontSize: 14, fontWeight: 700, color: '#fff',
                  backgroundColor: TEAL, border: 'none', borderRadius: 6,
                  padding: '7px 16px', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Sparkles size={11} />
                {card.action.label}
              </button>
            ) : (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  (onApproveClick ?? card.action?.onClick)?.();
                }}
                style={{
                  fontSize: 14, fontWeight: 700, color: '#fff',
                  backgroundColor: BLUE, border: 'none', borderRadius: 6,
                  padding: '7px 16px', cursor: 'pointer',
                }}
              >
                {card.action.label}
              </button>
            )}
          </div>
        )}
        {(card.containerMappingAction || card.dndInputsAction) && (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            {card.dndInputsAction && card.canUseDndInputs && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(event) => { event.stopPropagation(); card.dndInputsAction?.(); }}
              >
                D&D Inputs
              </Button>
            )}
            {card.containerMappingAction && card.canUseContainerMapping && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(event) => { event.stopPropagation(); card.containerMappingAction?.(); }}
              >
                Container Mapping
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compact row component ────────────────────────────────────────────────────
function QueueRowHeader() {
  const headerCell: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: MUTED,
    minWidth: 0,
    whiteSpace: 'nowrap',
  };
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: QUEUE_ROW_GRID,
      columnGap: QUEUE_ROW_GAP,
      alignItems: 'center',
      padding: '7px 20px',
      borderBottom: `1px solid ${BORDER}`,
      backgroundColor: 'hsl(var(--muted) / 0.25)',
      boxSizing: 'border-box',
    }}>
      <div />
      <div />
      <div style={headerCell}>Document</div>
      <div style={headerCell}>Issuer / Context</div>
      <div style={{ ...headerCell, textAlign: 'center' }}>Pipeline</div>
      <div style={{ ...headerCell, textAlign: 'center' }}>Conf</div>
      <div style={{ ...headerCell, textAlign: 'center' }}>Status</div>
      <div />
    </div>
  );
}

function MiniPipeline({ dots, gold }: { dots: DotState[]; gold?: boolean }) {
  const active = gold ? GOLD : TEAL;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {dots.map((dot, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            backgroundColor: dot === 'future' ? 'hsl(var(--border))' : active,
            opacity: dot === 'future' ? 0.3 : 1,
            position: 'relative',
          }}>
            {dot === 'current-spin' && (
              <div style={{
                position: 'absolute', inset: -2, borderRadius: '50%',
                border: `1.5px solid ${INFO}`, borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
          </div>
          {i < dots.length - 1 && (
            <div style={{
              width: 10, height: 1,
              backgroundColor: dot === 'done' ? active : 'hsl(var(--border))',
              opacity: 0.4, flexShrink: 0,
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function QueueRowEl({ card, onApproveClick, onStopClick, onRetryClick, onRowClick, onDetailsClick, slaConfig, style }: {
  card: QueueCard;
  onApproveClick?: () => void;
  onStopClick?: () => void;
  onRetryClick?: () => void;
  onRowClick?: () => void;
  onDetailsClick?: () => void;
  slaConfig?: EscalationConfig | null;
  style?: React.CSSProperties;
}) {
  const [, navigate] = useLocation();
  const [hovered, setHovered] = useState(false);
  const now = useNow();
  const confPct = Math.round(card.avgConfidence * 100);
  const confColor = card.avgConfidence >= 0.95 ? GREEN : card.avgConfidence >= 0.85 ? AMBER : RED;
  const slaInfo = slaBadgeInfo(card, slaConfig, now);
  const slaHours: number | null = null;
  const overdueInfo = (() => {
    if (slaHours == null || !needsReviewApproval(card) || !card.createdAt) return null;
    const elapsed = (now - new Date(card.createdAt).getTime()) / 3600000;
    if (elapsed <= slaHours) return null;
    const isBreached = elapsed > slaHours * 1.5;
    const overdueH = elapsed - slaHours;
    const days = Math.floor(overdueH / 24);
    const hrs = Math.floor(overdueH % 24);
    const timeStr = days > 0 ? (hrs > 0 ? `${days}d ${hrs}h` : `${days}d`) : `${Math.max(1, hrs)}h`;
    return { level: isBreached ? 'breached' : 'overdue', timeStr, isBreached } as const;
  })();
  const overdueLevel = overdueInfo?.level ?? null;
  const remainingInfo = (() => {
    if (slaHours == null || !needsReviewApproval(card) || !card.createdAt) return null;
    const elapsed = (now - new Date(card.createdAt).getTime()) / 3600000;
    if (elapsed >= slaHours) return null;
    const remainingH = slaHours - elapsed;
    if (remainingH >= slaHours * 0.25) return null;
    const totalMins = Math.round(remainingH * 60);
    const hPart = Math.floor(totalMins / 60);
    const mPart = totalMins % 60;
    const timeStr = hPart > 0 ? (mPart > 0 ? `${hPart}h ${mPart}m` : `${hPart}h`) : `${Math.max(1, mPart)}m`;
    return { timeStr } as const;
  })();

  return (
    <div
      onClick={onRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: QUEUE_ROW_GRID,
        columnGap: QUEUE_ROW_GAP,
        alignItems: 'start',
        padding: '10px 20px',
        minHeight: QUEUE_ROW_ESTIMATE_H,
        backgroundColor: hovered ? 'hsl(var(--muted) / 0.4)' : 'transparent',
        borderBottom: `1px solid ${BORDER}`,
        borderLeft: slaInfo?.level === 'blocker' || slaInfo?.level === 'escalation' ? `3px solid ${RED}` : slaInfo?.level === 'warning' ? `3px solid ${AMBER}` : '3px solid transparent',
        transition: 'background-color 0.1s',
        cursor: onRowClick ? 'pointer' : 'default',
        boxSizing: 'border-box',
        width: '100%',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Left accent strip */}
      <div style={{ width: 3, height: 36, borderRadius: 2, backgroundColor: card.headerColor, flexShrink: 0, marginTop: 2 }} />

      {/* DocBadge */}
      <div style={{ display: 'flex', justifyContent: 'center', minWidth: 0, paddingTop: 2 }}>
        <DocBadge code={card.docCode} size="sm" />
      </div>

      {/* Doc type + number */}
      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.docType}
          </span>
          {card.isGenerated && <Sparkles size={10} style={{ color: GOLD, flexShrink: 0 }} />}
        </div>
        <span className="vs-mono" style={{ fontSize: 14, color: MUTED, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {card.docNumber}
        </span>
      </div>

      {/* Issuer / provenance + field detail — must stay a real grid cell (no div-inside-span) */}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
        {card.isGenerated && card.provenanceLabel ? (
          card.sourceDocId ? (
            <button
              type="button"
              title={card.provenanceLabel}
              onClick={(e) => { e.stopPropagation(); navigate(`/documents/${card.sourceDocId}`); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 3, alignSelf: 'flex-start',
                fontSize: 10, color: GOLD, fontWeight: 500,
                background: GOLD_BG, border: `1px solid ${GOLD}40`,
                borderRadius: 999, padding: '1px 7px', cursor: 'pointer',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
              }}
            >
              <Sparkles size={8} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.provenanceLabel} →
              </span>
            </button>
          ) : (
            <span
              title={card.provenanceLabel}
              style={{
                display: 'flex', alignItems: 'center', gap: 3, alignSelf: 'flex-start',
                fontSize: 10, color: GOLD, fontWeight: 500,
                background: GOLD_BG, border: `1px solid ${GOLD}40`,
                borderRadius: 999, padding: '1px 7px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
              }}
            >
              <Sparkles size={8} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.provenanceLabel}
              </span>
            </span>
          )
        ) : (
          <span title={card.issuer} style={{ fontSize: 10.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {card.issuer}
          </span>
        )}
        <div style={{ minWidth: 0, overflow: 'hidden', color: MUTED, opacity: 0.9, fontSize: 12, lineHeight: 1.35 }}>
          {card.detail}
        </div>
      </div>

      {/* Mini pipeline */}
      <div style={{ display: 'flex', justifyContent: 'center', minWidth: 0, paddingTop: 10 }}>
        <MiniPipeline dots={card.dots} gold={card.goldDots} />
      </div>

      {/* Confidence pill */}
      <div style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 4 }}>
        <span style={{
          fontSize: 14, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
          backgroundColor: `${confColor}15`, color: confColor,
        }}>
          {confPct}%
        </span>
      </div>

      {/* Status pill */}
      <div style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, overflow: 'hidden', paddingTop: 4 }}>
        {card.statusVariant === 'info' ? (
          <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, backgroundColor: 'hsla(221,83%,53%,0.12)', color: BLUE }}>
            {card.status}
          </span>
        ) : card.statusVariant === 'validated' ? (
          <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, backgroundColor: GOLD_BG, color: 'hsl(38 92% 30%)' }}>
            {card.status}
          </span>
        ) : card.statusVariant === 'danger' ? (
          <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, backgroundColor: 'hsla(0,84%,60%,0.12)', color: RED }}>
            {card.status}
          </span>
        ) : card.statusVariant === 'success' ? (
          <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, backgroundColor: `${GREEN}18`, color: GREEN }}>
            {card.status}
          </span>
        ) : (
          <StatusPill status={card.status} variant={card.statusVariant} />
        )}
        {overdueInfo && (
          <span style={{
            fontSize: 11, fontWeight: 700,
            padding: '1px 5px', borderRadius: 999,
            backgroundColor: overdueInfo.isBreached ? 'hsla(0,84%,60%,0.12)' : 'hsla(38,92%,50%,0.12)',
            color: overdueInfo.isBreached ? RED : AMBER,
            border: `1px solid ${overdueInfo.isBreached ? 'hsla(0,84%,60%,0.25)' : 'hsla(38,92%,50%,0.25)'}`,
            whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {overdueInfo.timeStr} {overdueInfo.isBreached ? 'SLA breached' : 'overdue'}
          </span>
        )}
        {remainingInfo && (
          <span style={{
            fontSize: 11, fontWeight: 700,
            padding: '1px 5px', borderRadius: 999,
            backgroundColor: 'hsla(43,96%,56%,0.13)',
            color: 'hsl(38 85% 32%)',
            border: '1px solid hsla(43,96%,56%,0.35)',
            whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {remainingInfo.timeStr} remaining
          </span>
        )}
        {slaInfo && (
          <span style={{
            fontSize: 11, fontWeight: 700,
            padding: '1px 5px', borderRadius: 999,
            backgroundColor: slaInfo.bg,
            color: slaInfo.color,
            border: `1px solid ${slaInfo.border}`,
            whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {slaInfo.label}
          </span>
        )}
      </div>

      {/* Action button */}
      <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end', gap: 6, overflow: 'hidden', paddingTop: 2 }}>
        {onStopClick && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => { event.stopPropagation(); onStopClick(); }}
            className="h-8 shrink-0 whitespace-nowrap border-red-300 text-red-600 hover:text-red-700"
          >
            Stop
          </Button>
        )}
        {onRetryClick && (
          <Button
            type="button"
            size="sm"
            onClick={(event) => { event.stopPropagation(); onRetryClick(); }}
            className="h-8 shrink-0 whitespace-nowrap"
          >
            Retry
          </Button>
        )}
        {card.action && (
          card.action.label === 'Approve extraction →' ? (
            <Button
              type="button"
              size="sm"
              onClick={(e) => { e.stopPropagation(); (onApproveClick ?? card.action?.onClick)?.(); }}
              className="h-8 shrink-0 whitespace-nowrap"
            >
              Approve
            </Button>
          ) : card.action.teal ? (
            <Button
              type="button"
              size="sm"
              onClick={(e) => { e.stopPropagation(); card.action?.href ? navigate(card.action.href) : card.action?.onClick?.(); }}
              className="h-8 shrink-0 gap-1 whitespace-nowrap"
            >
              <Sparkles size={9} /> Review
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDetailsClick?.(); }}
              className="h-8 shrink-0 gap-1 whitespace-nowrap"
            >
              Details <ArrowRight size={10} />
            </Button>
          )
        )}
      </div>
    </div>
  );
}

// ─── Row detail drawer ────────────────────────────────────────────────────────
type ReuploadAction = 'document' | 'source';

const WAITING_FOR_BOL_CHIP_INDEX = 7;
const UPLOAD_PROCESS_ROUTE = '/documents/upload';
const PROCESSING_QUEUE_ROUTE = '/documents/upload/queue';
const UPLOAD_PROCESS_RETURN_PATH_KEY = 'ewms-upload-process-return-path';

function needsReviewApproval(card: Pick<QueueCard, 'statusCategory'>) {
  return card.statusCategory === 'needs-approval' || card.statusCategory === 'needs-reapproval';
}

function splitEscalationScope(value?: string): string[] {
  return String(value ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => !/^doc names$/i.test(v) && !/^\d+\s+docs?$/i.test(v))
    .filter(v => !['document', 'documents', 'generated documents', 'validation'].includes(v.toLowerCase()));
}

function normalizeDocLabel(value?: string): string {
  return String(value ?? '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escalationActivityForCard(card: QueueCard): string | null {
  if (card.statusCategory === 'processing' && !card.isGenerated) return 'Upload Document';
  if (card.isGenerated && card.statusCategory === 'draft-review') return 'Fill Manual Fields';
  if (card.status === 'Validation blocked') return 'Resolve Validation Failure';
  if (card.containerMappingAction) return 'Map Container to SKU';
  return null;
}

function configMatchesCardScope(config: EscalationConfig, card: QueueCard): boolean {
  const scopeItems = splitEscalationScope(config.scope);
  if (scopeItems.length === 0) return true;
  const docCode = normalizeDocLabel(card.documentTypeCode);
  const docLabel = normalizeDocLabel(card.docType);
  return scopeItems.some(item => {
    const normalized = normalizeDocLabel(item);
    return normalized === docCode || normalized === docLabel;
  });
}

function escalationConfigForCard(card: QueueCard, configs: EscalationConfig[]): EscalationConfig | null {
  const activity = escalationActivityForCard(card);
  if (!activity) return null;
  return configs.find(config =>
    (config.activityName ?? config.activityType) === activity && configMatchesCardScope(config, card)
  ) ?? configs.find(config => (config.activityName ?? config.activityType) === activity) ?? null;
}

function formatSlaTime(hours: number): string {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const hrs = Math.floor(hours % 24);
    return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
  }
  if (hours >= 1) return `${Math.max(1, Math.floor(hours))}h`;
  return `${Math.max(1, Math.round(hours * 60))}m`;
}

function slaBadgeInfo(card: QueueCard, config: EscalationConfig | null | undefined, now: number) {
  if (!config || !card.createdAt) return null;
  const base = Number(config.baseSlaHours);
  if (!Number.isFinite(base) || base <= 0) return null;
  const elapsed = (now - new Date(card.createdAt).getTime()) / 3600000;
  const levels = [
    { key: 'blocker', label: 'Blocker', pct: config.blockerPct, color: RED, bg: 'hsla(0,84%,60%,0.12)', border: 'hsla(0,84%,60%,0.25)' },
    { key: 'escalation', label: 'Escalation', pct: config.escalationPct, color: RED, bg: 'hsla(0,84%,60%,0.10)', border: 'hsla(0,84%,60%,0.22)' },
    { key: 'warning', label: 'Warning', pct: config.warningPct, color: AMBER, bg: 'hsla(38,92%,50%,0.12)', border: 'hsla(38,92%,50%,0.25)' },
    { key: 'reminder', label: 'Reminder', pct: config.reminderPct, color: BLUE, bg: 'hsla(221,83%,53%,0.10)', border: 'hsla(221,83%,53%,0.22)' },
  ];
  const crossed = levels.find(level => elapsed >= (base * level.pct) / 100);
  if (crossed) {
    const crossedAt = (base * crossed.pct) / 100;
    return {
      level: crossed.key,
      label: `${formatSlaTime(Math.max(0, elapsed - crossedAt))} ${crossed.label}`,
      color: crossed.color,
      bg: crossed.bg,
      border: crossed.border,
    };
  }
  const next = [...levels].reverse().find(level => elapsed < (base * level.pct) / 100);
  if (!next) return null;
  return {
    level: 'upcoming',
    label: `${formatSlaTime((base * next.pct) / 100 - elapsed)} to ${next.label.toLowerCase()}`,
    color: AMBER,
    bg: 'hsla(43,96%,56%,0.13)',
    border: 'hsla(43,96%,56%,0.35)',
  };
}

function validationDetailsPath(card: QueueCard) {
  if (!card.docId) return '/documents/upload';
  const encodedId = encodeURIComponent(card.docId);
  return card.isGenerated
    ? `/documents/upload/generated/${encodedId}/details`
    : `/documents/upload/${encodedId}/details`;
}

function parseValidationDetailsRoute(path: string): { id: string; isGenerated: boolean } | null {
  const generatedMatch = path.match(/^\/documents\/upload\/generated\/([^/]+)\/details$/);
  if (generatedMatch?.[1]) {
    return { id: decodeURIComponent(generatedMatch[1]), isGenerated: true };
  }
  const uploadedMatch = path.match(/^\/documents\/upload\/([^/]+)\/details$/);
  if (uploadedMatch?.[1]) {
    return { id: decodeURIComponent(uploadedMatch[1]), isGenerated: false };
  }
  return null;
}

function ValidationDetailSheet({ card, open, onOpenChange, onReupload }: {
  card: QueueCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReupload: (card: QueueCard, file: File, action: ReuploadAction) => Promise<void>;
}) {
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAction, setPendingAction] = useState<ReuploadAction | null>(null);
  const [uploadingAction, setUploadingAction] = useState<ReuploadAction | null>(null);
  if (!card) return null;

  const results = card.validationResults ?? [];
  const counts = validationCounts(card.validationSummary, results);
  const confPct = Math.round((card.avgConfidence || 0) * 100);
  const confColor = card.avgConfidence >= 0.95 ? GREEN : card.avgConfidence >= 0.85 ? AMBER : RED;
  const detailContext = card.isGenerated || !String(card.context ?? '').startsWith('id: ')
    ? card.provenanceLabel ?? card.context
    : '';
  const isValidationBlocked = counts.blockingFailures > 0 || String(card.status ?? '').toLowerCase().includes('blocked');
  const canReuploadDocument = isValidationBlocked && !card.isGenerated && !!card.docId;
  const canReuploadSource = isValidationBlocked && card.isGenerated && !!card.sourceDocId;
  const canEditGenerated = isValidationBlocked && card.isGenerated && !!card.action?.href;
  const confirmTitle = pendingAction === 'source' ? 'Re-upload source document?' : 'Re-upload document?';
  const confirmBody = pendingAction === 'source'
    ? 'Re-uploading the source document will replace its file, rerun OCR, regenerate this generated document, and mark the source as needing re-approval. Cross-validation will be overridden only after approval.'
    : 'Re-uploading this document will replace the current file, rerun OCR, and mark it as needing re-approval. Cross-validation will be overridden only after approval.';

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const action = pendingAction;
    event.target.value = '';
    if (!file || !action || !card) return;
    setUploadingAction(action);
    try {
      await onReupload(card, file, action);
      setPendingAction(null);
      onOpenChange(false);
    } finally {
      setUploadingAction(null);
    }
  }

  const statusMeta = (status: string | null | undefined, blocking?: string | null) => {
    const normalized = String(status ?? '').toUpperCase();
    const behavior = String(blocking ?? '').toUpperCase();
    if (normalized === 'PASSED') return { label: 'Passed', color: GREEN, icon: <CheckCircle2 size={13} /> };
    if (normalized === 'WARNED') return { label: 'Warned', color: AMBER, icon: <AlertTriangle size={13} /> };
    if (normalized === 'BLOCKED') return { label: 'Blocked', color: RED, icon: <AlertTriangle size={13} /> };
    const isBlocking = behavior === 'BLOCK' && ['FAIL', 'SKIPPED'].includes(normalized);
    const isWarning = behavior === 'WARN' && ['FAIL', 'WARNING', 'SKIPPED'].includes(normalized);
    if (normalized === 'PASS') return { label: 'Passed', color: GREEN, icon: <CheckCircle2 size={13} /> };
    if (isWarning) return { label: 'Warned', color: AMBER, icon: <AlertTriangle size={13} /> };
    if (isBlocking) return { label: 'Blocked', color: RED, icon: <AlertTriangle size={13} /> };
    if (normalized === 'WAITING') return { label: 'Running...', color: AMBER, icon: <Clock3 size={13} /> };
    if (normalized === 'SKIPPED') return { label: behavior === 'IGNORE' ? 'Skipped' : 'Needs review', color: MUTED, icon: <Clock3 size={13} /> };
    return { label: normalized || 'Skipped', color: MUTED, icon: <Clock3 size={13} /> };
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" style={{ width: 520, maxWidth: 'calc(100vw - 28px)', padding: 0, display: 'flex', flexDirection: 'column' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          onChange={handleFileSelected}
          style={{ display: 'none' }}
        />
        {pendingAction && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'hsla(220,18%,8%,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
            <div style={{ width: '100%', maxWidth: 420, borderRadius: 8, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, boxShadow: '0 20px 60px hsla(220,20%,10%,0.28)', padding: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 750, color: FG }}>{confirmTitle}</div>
              <div style={{ marginTop: 8, fontSize: 14.5, color: MUTED, lineHeight: 1.5 }}>{confirmBody}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <button
                  onClick={() => setPendingAction(null)}
                  disabled={!!uploadingAction}
                  style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: FG, cursor: uploadingAction ? 'default' : 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!!uploadingAction}
                  style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: RED, color: '#fff', fontWeight: 700, cursor: uploadingAction ? 'wait' : 'pointer' }}
                >
                  {uploadingAction ? 'Uploading...' : 'Yes, choose file'}
                </button>
              </div>
            </div>
          </div>
        )}
        <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingRight: 30 }}>
            <div style={{ width: 4, height: 40, borderRadius: 2, backgroundColor: card.headerColor, flexShrink: 0, marginTop: 2 }} />
            <DocBadge code={card.docCode} size="md" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: FG }}>{card.docType}</div>
              <div className="vs-mono" style={{ fontSize: 14.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.docNumber}</div>
              <div style={{ fontSize: 14.5, color: MUTED, marginTop: 2 }}>{card.issuer}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <StatusPill status={card.status} variant={card.statusVariant} />
            {card.avgConfidence > 0 && (
              <span style={{ fontSize: 14.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, backgroundColor: `${confColor}15`, color: confColor, border: `1px solid ${confColor}40` }}>
                {confPct}% avg confidence
              </span>
            )}
            <span style={{ fontSize: 14.5, color: MUTED, marginLeft: 'auto' }}>{card.timestamp}</span>
          </div>
          {card.statusCategory === 'done' && (
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 8,
                border: `1px solid ${TEAL}55`,
                background: `${TEAL}12`,
              }}
            >
              <CheckCircle2 size={18} style={{ color: TEAL, flexShrink: 0, marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: TEAL }}>
                  {String(card.status ?? '').toLowerCase().includes('validated') ? card.status : 'Approved'}
                </div>
                <div style={{ marginTop: 2, fontSize: 13, color: MUTED, lineHeight: 1.45 }}>
                  This record is already approved. Editing is locked — open the document to view fields in read-only mode.
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Pipeline</div>
          <PipelineDots dots={card.dots} gold={card.goldDots} />
          {detailContext && (
            <div style={{ marginTop: 8, fontSize: 14.5, color: MUTED }}>
              <span className={card.isGenerated ? undefined : 'vs-mono'}>{detailContext}</span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Cross-validation checks</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 18, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: GREEN }}>{counts.passed} passed</span>
            {counts.warnings > 0 && <span style={{ fontSize: 14.5, fontWeight: 700, color: AMBER }}>{counts.warnings} warn</span>}
            {counts.blockingFailures > 0 && <span style={{ fontSize: 14.5, fontWeight: 700, color: RED }}>{counts.blockingFailures} blocked</span>}
            {counts.waiting > 0 && <span style={{ fontSize: 14.5, fontWeight: 700, color: AMBER }}>{counts.waiting} running</span>}
            <span style={{ fontSize: 14.5, color: MUTED, marginLeft: 'auto' }}>{counts.total || results.length} checks total</span>
          </div>

          {results.length === 0 ? (
            <div style={{ fontSize: 14.5, color: MUTED, lineHeight: 1.6 }}>
              Cross-validation has not produced rule-level results for this document yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {results.map((result, index) => {
                const meta = statusMeta(result.displayStatus ?? result.status, result.blockingBehavior);
                return (
                  <div key={`${result.ruleCode ?? 'rule'}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 120px 74px', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{meta.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, color: FG, fontWeight: 500, lineHeight: 1.35 }}>{result.description || result.ruleCode || 'Validation rule'}</div>
                      {result.delta && String(result.status ?? '').toUpperCase() !== 'PASS' && (
                        <div style={{ fontSize: 13, color: MUTED, marginTop: 3, lineHeight: 1.35 }}>{result.delta}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: MUTED, textAlign: 'right' }}>vs {formatDocTypeLabel(result.targetDocType)}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: meta.color, textAlign: 'right' }}>{meta.label}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: `1px solid ${BORDER}`, display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          {canReuploadDocument && (
            <button
              onClick={() => setPendingAction('document')}
              style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', backgroundColor: RED, border: 'none', borderRadius: 7, padding: '8px 12px', cursor: 'pointer' }}
            >
              Re-upload document
            </button>
          )}
          {canReuploadSource && (
            <button
              onClick={() => setPendingAction('source')}
              style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', backgroundColor: RED, border: 'none', borderRadius: 7, padding: '8px 12px', cursor: 'pointer' }}
            >
              Re-upload source doc
            </button>
          )}
          {canEditGenerated && (
            <button
              onClick={() => { onOpenChange(false); navigate(card.action!.href!); }}
              style={{ fontSize: 14.5, fontWeight: 700, color: TEAL, backgroundColor: 'transparent', border: `1px solid ${TEAL}50`, borderRadius: 7, padding: '8px 12px', cursor: 'pointer' }}
            >
              Edit generated
            </button>
          )}
          {card.docId && needsReviewApproval(card) && (
            <button
              onClick={() => {
                onOpenChange(false);
                sessionStorage.setItem(UPLOAD_PROCESS_RETURN_PATH_KEY, PROCESSING_QUEUE_ROUTE);
                navigate(`/documents/upload/${card.docId}/approve`);
              }}
              style={{ marginLeft: 'auto', fontSize: 14.5, fontWeight: 700, color: '#fff', backgroundColor: GREEN, border: 'none', borderRadius: 7, padding: '8px 14px', cursor: 'pointer' }}
            >
              Approve
            </button>
          )}
          {card.docId && !needsReviewApproval(card) && (
            <button
              onClick={() => { onOpenChange(false); navigate(card.isGenerated && card.action?.href ? card.action.href : `/documents/upload/${card.docId}`); }}
              style={{ marginLeft: 'auto', fontSize: 14.5, fontWeight: 700, color: TEAL, backgroundColor: 'transparent', border: 'none', padding: '8px 0', cursor: 'pointer' }}
            >
              {card.statusCategory === 'done' ? 'View document →' : 'Open document →'}
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VirtualList({
  cards,
  onApproveClick,
  onStopClick,
  onRetryClick,
  onRowClick,
  onDetailsClick,
  escalationConfigs,
}: {
  cards: QueueCard[];
  onApproveClick: (card: QueueCard) => (() => void) | undefined;
  onStopClick: (card: QueueCard) => (() => void) | undefined;
  onRetryClick: (card: QueueCard) => (() => void) | undefined;
  onRowClick: (card: QueueCard) => void;
  onDetailsClick: (card: QueueCard) => void;
  escalationConfigs: EscalationConfig[];
}) {
  const scrollEl = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollEl.current,
    estimateSize: () => QUEUE_ROW_ESTIMATE_H,
    overscan: 8,
    // Measure real row height so provenance chips / SLA badges / wrapped
    // field counts don't overlap neighboring absolutely-positioned rows.
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const totalHeight = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollEl}
      style={{ height: Math.min(totalHeight, QUEUE_ROW_ESTIMATE_H * 12), overflowY: 'auto', overflowX: 'hidden' }}
    >
      <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vItem) => {
          const card = cards[vItem.index];
          return (
            <div
              key={card.id}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              <QueueRowEl
                card={card}
                onApproveClick={onApproveClick(card)}
                onStopClick={onStopClick(card)}
                onRetryClick={onRetryClick(card)}
                onRowClick={() => onRowClick(card)}
                onDetailsClick={() => onDetailsClick(card)}
                slaConfig={escalationConfigForCard(card, escalationConfigs)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── API → QueueCard helpers ──────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)} days ago`;
}

function storageFileName(value: unknown): string {
  const text = String(value ?? '').trim().split(/[?#]/)[0];
  const parts = text.split(/[\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function storageIntegrationLabel(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  const storageLike = lower.includes('s3://') || lower.includes('ewms-storage') || lower.includes('zw-ewms-zata-files') || lower.includes('/processed/');
  if (!storageLike) return '';
  const fileName = storageFileName(text);
  const source = lower.includes('zata') || fileName.toLowerCase().startsWith('ewms_') ? 'zata integration' : 'integration';
  return fileName ? `${source} & filename (${fileName})` : source;
}

function cleanDisplayLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (storageIntegrationLabel(text)) return '';
  if (/^id:\s*/i.test(text)) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return '';
  return text;
}

function sourceDisplayLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  const known = GEN_SOURCE_NAMES[text.toUpperCase()];
  if (known) return known;
  return storageIntegrationLabel(text) || cleanDisplayLabel(text);
}

function generatedProvenanceLabel(sourceName: string): string {
  if (!sourceName) return 'Auto-generated by system';
  return sourceName.includes('& filename (') ? sourceName : `Generated from ${sourceName}`;
}

function extractedString(value: unknown, targetKeys: string[]): string | null {
  const wanted = new Set(targetKeys.map(key => key.toLowerCase()));
  const seen = new Set<unknown>();
  let match: string | null = null;

  function visit(node: unknown, key = '') {
    if (match || node == null || seen.has(node)) return;
    if (typeof node === 'object') seen.add(node);
    if (key && wanted.has(key.toLowerCase()) && (typeof node === 'string' || typeof node === 'number')) {
      const text = String(node).trim();
      if (text) match = text;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(item => visit(item));
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node as Record<string, unknown>).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  }

  visit(value);
  return match;
}
function apiDocToQueueCard(d: any): QueueCard {
  const documentType = d.documentType ?? d.docType ?? 'Document';
  const dt = String(documentType).toUpperCase();
  let docCode = 'DR', docTypeLabel = documentType, color = BLUE;
  if (dt === 'SALES_INVOICE' || dt === 'SI') { docCode = 'SI'; docTypeLabel = 'Sales Invoice'; color = GREEN; }
  else if ((dt === 'PACKING_LIST' || dt === 'PL' || dt === 'PACKING-LIST') && !dt.includes('OUTWARD')) { docCode = 'PL'; docTypeLabel = 'Packing List'; color = BLUE; }
  else if (dt === 'BILL_OF_LADING' || dt === 'BOL' || dt === 'BL') { docCode = 'BL'; docTypeLabel = 'Bill of Lading'; color = BLUE; }
  else if (dt === 'SHIPPING_BILL' || dt === 'SB') { docCode = 'SB'; docTypeLabel = 'Shipping Bill'; color = BLUE; }
  else if (dt === 'ISF' || dt.includes('IMPORTER_SECURITY')) { docCode = 'IS'; docTypeLabel = 'ISF'; color = INFO; }
  else if (dt === 'DRAFT_CBP_FORM_7501_BROKER') { docCode = 'CBP'; docTypeLabel = 'Draft CBP FORM 7501 Broker'; color = INFO; }
  else if (dt === 'ENTRY_SUMMARY') { docCode = 'CBP'; docTypeLabel = 'CBP FORM 7501'; color = INFO; }
  else if ((dt === 'BOE' || dt.includes('BILL_OF_ENTRY')) && !dt.includes('DRAFT')) { docCode = 'CBP'; docTypeLabel = 'CBP FORM 7501'; color = INFO; }
  else if (dt === 'FREIGHT_FORWARDER_BILL' || dt.includes('FREIGHT_FORWARDER')) {
    docCode = 'FF'; docTypeLabel = 'Freight Forwarder Bill'; color = BLUE;
  }
  else if (dt === 'CHA_BILL' || dt === 'CHA' || dt.includes('CHA_BILL')) {
    docCode = 'CH'; docTypeLabel = 'CHA Bill'; color = BLUE;
  }

  // Use real ocrConfidenceAvg when available; 0 when absent/null.
  // Sentinel semantics: the confidence pill guard is `avgConfidence > 0` (hides
  // the pill when unknown), and the slide-over confidence ring falls back to 0.5
  // when avgConfidence is 0 — preserving the expected "not yet scored" visual.
  const conf: number = d.ocrConfidenceAvg ?? d.ocrConfidence ?? 0;
  const confPct = conf > 0 ? `${Math.round(conf * 100)}% avg confidence · ` : '';
  const ship = d.shipment?.shipmentNumber ?? '';
  const fileNameLabel = storageFileName(d.fileName) || storageFileName(d.objectKey);
  const extractionData = d.extractedData ?? d.extraction?.rawData ?? d.billOfLadingExtraction?.rawData ?? d.bolExtraction?.rawData ?? d.extraction ?? d.billOfLadingExtraction ?? d.bolExtraction ?? d;
  const isBolDocument = dt === 'BILL_OF_LADING' || dt === 'BOL' || dt === 'BL';
  const dndInputsContext = isBolDocument ? {
    bolCarrierName: cleanDisplayLabel(d.dndCarrierName) || extractedString(extractionData, ['carrierCompanyName', 'carrierName', 'vesselCarrierName']),
    origin: cleanDisplayLabel(d.dndOrigin) || extractedString(extractionData, ['portOfLoading', 'placeOfReceipt', 'placeOfAcceptance']),
    destination: cleanDisplayLabel(d.dndDestination) || extractedString(extractionData, ['portOfDischarge', 'finalDestination', 'placeOfDelivery']),
    cargo: cleanDisplayLabel(d.dndCargo) || 'FCL',
  } : undefined;
  const issuerLabel = cleanDisplayLabel(d.issuerName)
    || cleanDisplayLabel(d.sourceName)
    || cleanDisplayLabel(d.extractedData?.issuerName)
    || cleanDisplayLabel(d.extraction?.rawData?.issuerName)
    || cleanDisplayLabel(d.extraction?.rawData?.issuerCompanyName)
    || sourceDisplayLabel(d.sourceName)
    || cleanDisplayLabel(d.uploadedBy?.fullName)
    || (fileNameLabel ? `Source file: ${fileNameLabel}` : 'Document source pending');
  const contextLabel = ship
    ? `Shipment: ${ship}`
    : sourceDisplayLabel(d.sourceName)
      || (fileNameLabel ? `File: ${fileNameLabel}` : 'Source pending');
  const dbStatus = String(d.ocrStatus ?? d.status ?? '').toUpperCase();
  const validationStatus = String(d.validationStatus ?? '').toUpperCase();
  const validationResults: ValidationResultRow[] = Array.isArray(d.validationResults) ? d.validationResults : [];
  const validationSummary: ValidationSummary | null = d.validationSummary ?? null;
  const counts = validationCounts(validationSummary, validationResults);
  const isExtracted = ['EXTRACTED', 'REVIEWED'].includes(dbStatus);
  const isApproved  = !!d.approvedAt || dbStatus === 'REVIEWED';
  const validationActive = ['BLOCKED', 'WAITING'].includes(validationStatus);
  const hasPriorValidation = !!validationStatus || counts.total > 0 || validationResults.length > 0;

  let statusCategory: StatusCategory, status: string, resolvedColor: string;
  let dots: DotState[], detail: React.ReactNode, action: QueueCard['action'];

  if (dbStatus === 'REJECTED') {
    statusCategory = 'draft-review'; status = 'Extraction failed';
    resolvedColor = RED; dots = ['done', 'current', 'future', 'future', 'future'];
    detail = 'OCR could not complete for this document';
  } else if (dbStatus === 'ARCHIVED') {
    statusCategory = 'done'; status = dbStatus;
    resolvedColor = GREEN; dots = ['done', 'done', 'done', 'done', 'done'];
    detail = `Database status: ${dbStatus}`;
  } else if (isApproved && !validationActive) {
    statusCategory = 'done';
    status = validationStatus === 'WARNING'
      ? 'Validated with warnings'
      : validationStatus === 'PASSED'
        ? 'Validated'
        : 'Approved';
    resolvedColor = validationStatus === 'WARNING' ? AMBER : GREEN;
    dots = ['done', 'done', 'done', 'done', 'done'];
    detail = validationStatus === 'WARNING'
      ? `Cross-validation completed with ${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`
      : validationStatus === 'PASSED'
        ? `Cross-validation passed: ${counts.passed}/${counts.total || counts.passed} checks passed`
        : `Database status: ${dbStatus}`;
    action = { label: 'View details →' };
  } else if (isApproved) {
    statusCategory = 'cross-validating';
    status = validationStatus === 'BLOCKED'
      ? 'Validation blocked'
      : validationStatus === 'WAITING'
        ? 'Waiting for related docs'
        : 'Cross-validating';
    resolvedColor = validationStatus === 'BLOCKED' ? RED : TEAL;
    dots = validationStatus === 'BLOCKED'
      ? ['done', 'done', 'done', 'current', 'future']
      : ['done', 'done', 'done', 'current-spin', 'future'];
    detail = validationStatus === 'BLOCKED'
      ? `${counts.blockingFailures || counts.failed} blocking validation issue${(counts.blockingFailures || counts.failed) === 1 ? '' : 's'}`
      : validationStatus === 'WAITING'
        ? `${counts.waiting} validation check${counts.waiting === 1 ? '' : 's'} waiting for related documents`
        : `Database status: ${dbStatus}`;
    action = { label: 'View details →' };
  } else if (isExtracted) {
    statusCategory = hasPriorValidation ? 'needs-reapproval' : 'needs-approval';
    status = hasPriorValidation ? 'Needs re-approval' : 'Needs approval';
    resolvedColor = color; dots = ['done', 'done', 'current', 'future', 'future'];
    detail = `${confPct}${hasPriorValidation ? 'Re-uploaded extraction awaiting approval' : 'Awaiting your approval'}`;
    action = { label: 'Approve extraction →', primary: true };
  } else {
    statusCategory = 'processing'; status = dbStatus || 'UPLOADED';
    resolvedColor = INFO; dots = ['done', 'current-spin', 'future', 'future', 'future'];
    detail = `Database status: ${dbStatus || 'UPLOADED'}`;
  }

  return {
    id: `live-${d.id}`,
    docId: d.id,
    headerColor: resolvedColor,
    docCode, docType: docTypeLabel,
    documentTypeCode: dt,
    issuer: issuerLabel,
    docNumber: cleanDisplayLabel(d.documentNumber) || storageFileName(d.fileName) || '—',
    status, statusVariant: dbStatus === 'REJECTED' ? 'danger' : !isApproved ? 'info' : validationStatus === 'PASSED' ? 'success' : validationStatus === 'BLOCKED' ? 'danger' : validationStatus === 'WARNING' ? 'warning' : statusCategory === 'done' ? 'success' : 'pending',
    statusCategory, avgConfidence: conf, dots,
    detail, action,
    validationSummary,
    validationResults,
    context: contextLabel,
    timestamp: timeAgo(d.createdAt),
    createdAt: d.createdAt,
    dndInputsContext,
  };
}

// ─── Generated doc type display mappings ──────────────────────────────────────
const GEN_DOC_LABELS: Record<string, [string, string]> = {
  PACKING_LIST:          ['PL', 'Packing List'],
  PACKING_LIST_GEN:      ['PL', 'Packing List'],
  ENTRY_SUMMARY:         ['CBP', 'CBP FORM 7501'],
  ENTRY_SUMMARY_DRAFT:   ['CBP', 'CBP FORM 7501'],
  US_PACKING_LIST_GEN:   ['UP', 'US Packing List'],
  US_PACKING_LIST:       ['UP', 'US Packing List'],
};
const GEN_SOURCE_NAMES: Record<string, string> = {
  SALES_INVOICE:         'Sales Invoice',
  PACKING_LIST:          'Packing List',
  BILL_OF_LADING:        'Bill of Lading',
  SHIPPING_BILL:         'Shipping Bill',
  ENTRY_SUMMARY:         'CBP FORM 7501',
  OCEAN_FREIGHT:         'Ocean Freight',
};

function apiGeneratedDocToQueueCard(d: any): QueueCard {
  const dt = (d.documentType ?? '').toUpperCase();
  const [docCode, docTypeLabel] = GEN_DOC_LABELS[dt] ?? ['GN', d.documentType ?? 'Generated Doc'];

  const genFrom: Record<string, any> = (d.generatedFrom && typeof d.generatedFrom === 'object') ? d.generatedFrom : {};
  const sourceDocTypes: string[] = Array.isArray(genFrom.sourceDocTypes) ? genFrom.sourceDocTypes : [];
  const sourceDocIds: Record<string, string> = (genFrom.sourceDocIds && typeof genFrom.sourceDocIds === 'object') ? genFrom.sourceDocIds : {};
  const fieldMapping: Record<string, string> = (genFrom.fieldMapping && typeof genFrom.fieldMapping === 'object') ? genFrom.fieldMapping : {};
  const generatedFields: Record<string, any> = (genFrom.generatedFields && typeof genFrom.generatedFields === 'object') ? genFrom.generatedFields : {};

  // Primary source type for provenance (first in list)
  const primarySourceType = sourceDocTypes[0] ?? '';
  const sourceName = sourceDisplayLabel(primarySourceType) || sourceDisplayLabel(d.documentNumber) || sourceDisplayLabel(d.fileName);
  // Pull the doc number from generatedFields if available (e.g. invoiceNo from SI)
  const sourceDocNumField = primarySourceType === 'SALES_INVOICE' ? 'invoiceNo'
    : primarySourceType === 'PACKING_LIST' ? 'invoiceNo'
    : primarySourceType === 'BILL_OF_LADING' ? 'bolNumber'
    : null;
  const sourceDocNum: string = sourceDocNumField ? (generatedFields[sourceDocNumField] ?? '') : '';
  const provenanceLabel = sourceName
    ? (sourceName.includes('& filename (') ? sourceName : `Generated from ${sourceName}${sourceDocNum ? ` · ${sourceDocNum}` : ''}`)
    : 'Auto-generated by system';
  // First source doc ID (for clickable navigation)
  const primarySourceDocId = sourceDocIds[primarySourceType] ?? Object.values(sourceDocIds)[0] ?? undefined;

  // ── Field breakdown from actual fieldMapping ───────────────────────────────
  const mapVals = Object.values(fieldMapping);
  const fromSource  = mapVals.filter(v => !String(v).startsWith('calculated') && String(v) !== 'manual').length;
  const calculated  = mapVals.filter(v => String(v).startsWith('calculated')).length;
  const manual      = mapVals.filter(v => String(v) === 'manual').length;
  const totalFields = mapVals.length;

  // ── Map ocrStatus to queue card state ────────────────────────────────────────
  const ocr = (d.ocrStatus ?? '').toLowerCase();
  const isApproved = !!d.approvedAt;
  let statusCategory: StatusCategory;
  let status: string;
  let statusVariant: QueueCard['statusVariant'];
  let dots: DotState[];
  let headerColor: string;
  let goldDots: boolean;

  if (isApproved) {
    // Approved with no active validation blocker is terminal for the queue.
    statusCategory = 'done'; status = 'Approved';
    statusVariant = 'success'; dots = ['done', 'done', 'done', 'done', 'done'];
    headerColor = GREEN; goldDots = false;
  } else if (ocr === 'discarded') {
    // Discarded — hide by mapping to done so it's filtered out
    statusCategory = 'done'; status = 'Discarded';
    statusVariant = 'pending'; dots = ['done', 'done', 'done', 'done', 'done'];
    headerColor = MUTED; goldDots = false;
  } else if (ocr === 'failed' || ocr === 'error' || ocr === 'failed_permanently') {
    // Generation/processing failure
    statusCategory = 'processing'; status = 'Generation failed';
    statusVariant = 'info'; dots = ['done', 'future', 'future', 'future', 'future'];
    headerColor = RED; goldDots = false;
  } else if (ocr === 'pending' || ocr === 'queued' || ocr === 'processing' || ocr === 'reprocessing') {
    // Actively in a processing pipeline step — show in the processing section
    statusCategory = 'processing'; status = ocr === 'processing' ? 'Generating...' : 'Pending generation';
    statusVariant = 'info'; dots = ['done', 'current-spin', 'future', 'future', 'future'];
    headerColor = INFO; goldDots = false;
  } else {
    // 'generated', 'COMPLETED', 'EXTRACTED', 'done', or any other status:
    // document exists and has content for the user to review → draft-review
    statusCategory = 'draft-review'; status = 'Draft — review needed';
    statusVariant = 'validated'; dots = ['done', 'done', 'current', 'future', 'future'];
    headerColor = GOLD; goldDots = true;
  }

  const detail = totalFields > 0 ? (
    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', lineHeight: 1.35 }}>
      <span>{totalFields} fields:</span>
      {fromSource > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: GOLD, display: 'inline-block', flexShrink: 0 }} />
          {fromSource} from source
        </span>
      )}
      {calculated > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: BLUE, display: 'inline-block', flexShrink: 0 }} />
          {calculated} calculated
        </span>
      )}
      {manual > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: RED, display: 'inline-block', flexShrink: 0 }} />
          {manual} need input
        </span>
      )}
    </div>
  ) : (
    <span style={{ fontSize: 12, color: MUTED }}>awaiting extraction</span>
  );

  const ship = d.shipment?.shipmentNumber ?? '';

  return {
    id: `gen-${d.id}`,
    docId: d.id,
    headerColor,
    docCode, docType: docTypeLabel,
    documentTypeCode: dt,
    isGenerated: true,
    issuer: 'System',
    docNumber: cleanDisplayLabel(d.documentNumber) || storageFileName(d.documentNumber) || dt.replace('_GEN', '').replace('_DRAFT', ''),
    status, statusVariant,
    statusCategory,
    avgConfidence: 1.0,
    dots, goldDots,
    detail,
    action: statusCategory === 'draft-review' ? { label: `Review ${docTypeLabel} draft →`, teal: true } : undefined,
    context: ship ? `Shipment: ${ship}` : 'No shipment assigned',
    timestamp: timeAgo(d.createdAt ?? new Date().toISOString()),
    createdAt: d.createdAt,
    sourceDocId: primarySourceDocId,
    provenanceLabel,
  };
}

// ─── Main page ────────────────────────────────────────────────────────────────
function generatedDocTypeToRoute(type: GeneratedDocType): string {
  if (type === 'ENTRY_SUMMARY') return 'entry-summary';
  return 'packing-list';
}

function apiDraftToQueueCard(d: DraftPayload, validation?: GeneratedDraftValidation | null): QueueCard {
  const dt = String(d.generatedDocType ?? '').toUpperCase();
  const [docCode, docTypeLabel] = GEN_DOC_LABELS[dt] ?? ['GN', d.displayName ?? 'Generated Doc'];
  const fields = (d.sections ?? []).flatMap(section => section.fields ?? []);
  const totalFields = fields.length;
  const fromSource = fields.filter(field => !['manual', 'derived', 'calculated'].includes(String(field.mappingType ?? '').toLowerCase())).length;
  const calculated = fields.filter(field => ['derived', 'calculated'].includes(String(field.mappingType ?? '').toLowerCase())).length;
  const manual = fields.filter(field => String(field.mappingType ?? '').toLowerCase() === 'manual').length;
  const primarySourceType = d.sourceDocs?.[0] ?? '';
  const sourceName = sourceDisplayLabel(primarySourceType) || sourceDisplayLabel(d.displayName);
  const primarySourceDocId = d.sourceDocumentIds?.[primarySourceType] ?? Object.values(d.sourceDocumentIds ?? {})[0] ?? undefined;
  const statusText = String(d.status ?? '').toUpperCase();
  const isApproved = ['CONFIRMED', 'GENERATED'].includes(statusText);
  const isFailed = ['FAILED', 'ERROR', 'FAILED_PERMANENTLY'].includes(statusText);
  const isProcessing = ['PENDING', 'QUEUED', 'PROCESSING', 'REPROCESSING'].includes(statusText);
  const validationStatus = String(validation?.status ?? '').toUpperCase();
  const validationResults: ValidationResultRow[] = Array.isArray(validation?.results) ? validation.results : [];
  const validationSummary: ValidationSummary | null = validation ? validation : null;
  const counts = validationCounts(validationSummary, validationResults);
  const validationActive = isApproved && ['BLOCKED', 'WAITING'].includes(validationStatus);
  const validationPassed = isApproved && !validationActive;
  const validationBlocked = isApproved && validationStatus === 'BLOCKED';
  const validationWarning = isApproved && validationStatus === 'WARNING';
  const validationWaiting = isApproved && validationStatus === 'WAITING';
  const statusCategory: StatusCategory = validationPassed
    ? 'done'
    : isApproved
      ? 'cross-validating'
      : isFailed
        ? 'processing'
        : isProcessing
          ? 'processing'
          : 'draft-review';
  const status = isApproved ? 'Cross-validating' : isFailed ? 'Generation failed' : isProcessing ? 'Generating...' : 'Draft — review needed';
  const resolvedStatus = validationPassed
    ? validationWarning ? 'Validated with warnings' : validationStatus === 'PASSED' ? 'Validated' : 'Approved'
    : validationBlocked
      ? 'Validation blocked'
      : validationWarning
        ? 'Validation warning'
        : validationWaiting
          ? 'Waiting for related docs'
          : status;
  const headerColor = validationPassed ? (validationWarning ? AMBER : GREEN) : validationBlocked ? RED : statusCategory === 'draft-review' ? GOLD : isFailed ? RED : isApproved ? TEAL : INFO;
  const dots: DotState[] = statusCategory === 'draft-review'
    ? ['done', 'done', 'current', 'future', 'future']
    : validationPassed
      ? ['done', 'done', 'done', 'done', 'done']
      : isApproved
      ? ['done', 'done', 'done', 'current', 'future']
      : ['done', 'current-spin', 'future', 'future', 'future'];
  const detail = totalFields > 0 ? (
    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', lineHeight: 1.35 }}>
      <span>{totalFields} fields:</span>
      {fromSource > 0 && <span>{fromSource} from source</span>}
      {calculated > 0 && <span>{calculated} calculated</span>}
      {manual > 0 && <span>{manual} need input</span>}
    </div>
  ) : (
    <span style={{ fontSize: 12, color: MUTED }}>Draft ready for review</span>
  );
  const generatedDraftHref = d.generatedDocType === 'US_PACKING_LIST'
    ? '/documents/generate/outward-grn'
    : `/documents/generate/${generatedDocTypeToRoute(d.generatedDocType)}`;

  return {
    id: `gen-${d.draftId}`,
    docId: d.draftId,
    headerColor,
    docCode,
    docType: docTypeLabel,
    documentTypeCode: dt,
    isGenerated: true,
    issuer: 'System',
    docNumber: cleanDisplayLabel(d.displayName) || storageFileName(d.displayName) || docTypeLabel,
    status: resolvedStatus,
    statusVariant: validationPassed ? 'success' : validationBlocked ? 'danger' : validationWarning ? 'warning' : statusCategory === 'draft-review' ? 'validated' : isFailed ? 'danger' : 'pending',
    statusCategory,
    avgConfidence: 1,
    dots,
    goldDots: statusCategory === 'draft-review',
    detail,
    action: statusCategory === 'draft-review'
      ? { label: `Review ${docTypeLabel} draft →`, teal: true, href: generatedDraftHref }
      : isApproved
        ? { label: 'View details â†’', href: generatedDraftHref }
        : undefined,
    context: generatedProvenanceLabel(sourceName),
    timestamp: timeAgo(d.createdAt ?? d.updatedAt ?? new Date().toISOString()),
    createdAt: d.createdAt ?? d.updatedAt ?? undefined,
    validationSummary,
    validationResults,
    sourceDocId: primarySourceDocId,
    provenanceLabel: generatedProvenanceLabel(sourceName),
  };
}

function ContainerMappingModal({
  mapping,
  loading,
  saving,
  onClose,
  onSave,
}: {
  mapping: ContainerMappingResponse | null;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (rows: ContainerMappingRow[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<ContainerMappingRow[]>([]);

  useEffect(() => setRows(mapping?.rows ?? []), [mapping]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'hsla(220,20%,10%,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(1500px, 96vw)', maxHeight: '88vh', overflow: 'hidden', borderRadius: 8, background: 'hsl(var(--background))', border: `1px solid ${BORDER}`, boxShadow: '0 24px 70px hsla(220,20%,10%,0.3)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750, color: FG }}>Container Mapping</div>
            <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>
              BOL invoices: {mapping?.invoiceNumbers.join(', ') || 'None extracted'} · Matching Packing Lists: {mapping?.matchedPackingLists ?? 0}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ overflow: 'auto', padding: 16, flex: 1 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>Loading container mapping…</div>
          ) : !mapping?.rows.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>No Packing List line items matched the invoice numbers extracted from this BOL.</div>
          ) : (
            <table style={{ width: '100%', minWidth: 1180, borderCollapse: 'collapse', background: 'hsl(var(--card))', border: `1px solid ${BORDER}` }}>
              <thead>
                <tr style={{ background: 'hsl(var(--muted) / 0.45)' }}>
                  {['Container no', 'Product code', 'Description', 'Specification', 'TOTAL QTY IN PCS', 'Qty per bundle', 'Total bundle'].map((label) => (
                    <th key={label} style={{ padding: '10px', border: `1px solid ${BORDER}`, textAlign: 'left', fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.lineItemId}>
                    <td style={{ padding: 8, border: `1px solid ${BORDER}`, minWidth: 180 }}>
                      <select
                        value={row.containerNo ?? ''}
                        onChange={(event) => setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, containerNo: event.target.value || null } : item))}
                        style={{ width: '100%', padding: '7px 8px', borderRadius: 5, border: `1px solid ${row.containerNo ? BORDER : AMBER}`, background: 'hsl(var(--background))', color: FG }}
                      >
                        <option value="">Select container</option>
                        {mapping.containers.map(container => <option key={container} value={container}>{container}</option>)}
                      </select>
                    </td>
                    {[row.productCode, row.description, row.specification, row.totalQtyInPcs, row.qtyPerBundle, row.totalBundles].map((value, cellIndex) => (
                      <td key={cellIndex} style={{ padding: '9px 10px', border: `1px solid ${BORDER}`, fontSize: 12, color: FG, minWidth: cellIndex === 2 ? 280 : 130, whiteSpace: 'pre-wrap' }}>{value || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: FG, cursor: 'pointer' }}>Cancel</button>
          <button disabled={!mapping?.rows.length || saving} onClick={() => void onSave(rows)} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: TEAL, color: '#fff', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: !mapping?.rows.length ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UploadProcessPage() {
  const { setPageMeta } = usePageMeta();
  const { templates, docTypes, loading: configLoading } = useConfig();
  const { activities, activitySla, docTypes: permittedDocTypes } = usePermissions();
  const [location, navigate] = useLocation();
  const { toast }          = useToast();
  const queryClient = useQueryClient();
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const [isDragOver,    setIsDragOver]    = useState(false);
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null);
  const [isUploading,   setIsUploading]   = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classification, setClassification] = useState<{
    docType: string;
    label: string;
    confidence: number;
  } | null>(null);
  const { groups: docTypeGroups, flat: docTypeFlat } = useMemo(
    () => buildDocTypeOptions(templates, docTypes),
    [templates, docTypes],
  );
  const [docType,       setDocType]       = useState('auto');
  const [shipmentVal,   setShipmentVal]   = useState('');
  const [activeChip,    setActiveChip]    = useState(0);
  const [queueSearch,   setQueueSearch]   = useState('');
  const [queueDocTypeFilter, setQueueDocTypeFilter] = useState(() => queueDocTypeFilterFromLocation(location));
  const [queuePage,         setQueuePage]         = useState(1);
  const [detailCard,        setDetailCard]        = useState<QueueCard | null>(null);
  const [waitingDocs,       setWaitingDocs]       = useState<WaitingDoc[]>([]);
  const [bolInboxDocs,      setBolInboxDocs]      = useState<WaitingDoc[]>([]);
  const [containerMappingOpen, setContainerMappingOpen] = useState(false);
  const [containerMappingDocumentId, setContainerMappingDocumentId] = useState<string | null>(null);
  const [dndInputsOpen, setDndInputsOpen] = useState(false);
  const [dndInputsDocumentId, setDndInputsDocumentId] = useState<string | null>(null);
  const [dndInputsContext, setDndInputsContext] = useState<QueueCard['dndInputsContext'] | null>(null);
  const now = useNow();
  const routedDetail = useMemo(() => parseValidationDetailsRoute(location), [location]);
  const queueSection = activeChip === WAITING_FOR_BOL_CHIP_INDEX
    ? 'waiting-for-bol'
    : QUEUE_SECTION_BY_CHIP[activeChip] ?? 'all';

  useEffect(() => {
    const locationFilter = queueDocTypeFilterFromLocation(location);
    setQueueDocTypeFilter(current => current === locationFilter ? current : locationFilter);
  }, [location]);

  useEffect(() => {
    const handleModuleSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; value: string }>).detail;
      if (detail.scope !== 'upload-process' && detail.scope !== 'all') return;
      setQueueSearch(detail.value);
      if (detail.value) navigate(PROCESSING_QUEUE_ROUTE);
    };
    window.addEventListener('ewms-module-search', handleModuleSearch);
    return () => window.removeEventListener('ewms-module-search', handleModuleSearch);
  }, [navigate]);

  // Derive distinct corridors from config templates for the upload corridor selector
  const corridors = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of templates) {
      if (t.corridor && !seen.has(t.corridor)) {
        seen.add(t.corridor);
        result.push(t.corridor);
      }
    }
    return result.sort();
  }, [templates]);
  const [corridorVal, setCorridorVal] = useState('');
  const chooseFile = useCallback((file: File | null) => {
    setSelectedFile(file);
    setClassification(null);
  }, []);
  // Auto-select when org only has one corridor
  useEffect(() => {
    if (corridors.length === 1) setCorridorVal(corridors[0]);
  }, [corridors]);

  const documentsQuery = useQuery({
    queryKey: ['upload-process', 'documents', queueSection, queuePage, QUEUE_PAGE_SIZE, queueDocTypeFilter],
    queryFn: async () => {
      const response = await documentApi.list({ page: queuePage, pageSize: QUEUE_PAGE_SIZE, section: queueSection, docType: queueDocTypeFilter === 'all' ? undefined : queueDocTypeFilter });
      return response.data;
    },
    enabled: !routedDetail || !routedDetail.isGenerated,
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const data = query.state.data as { documents?: any[] } | undefined;
      const documents = data?.documents ?? [];
      const hasRunningOcr = documents.some((doc: any) => {
        const status = String(doc.ocrStatus ?? doc.status ?? '').toUpperCase();
        return ['QUEUED', 'PROCESSING', 'REPROCESSING'].includes(status);
      });
      return hasRunningOcr && document.visibilityState === 'visible' ? 3_000 : false;
    },
    refetchOnWindowFocus: false,
  });

  const liveDocs = useMemo(
    () => (documentsQuery.data?.documents ?? []).map((doc: any) => {
      const card = apiDocToQueueCard(doc);
      const docType = String(doc.documentType ?? doc.docType ?? '').toUpperCase();
      const isBol = docType === 'BILL_OF_LADING' || docType === 'BOL' || docType === 'BL';
      const waitingForBolCard = queueSection === 'waiting-for-bol'
        ? {
            ...card,
            headerColor: AMBER,
            statusCategory: 'waiting-for-bol' as StatusCategory,
            status: 'Waiting for BOL',
            statusVariant: 'warning' as QueueCard['statusVariant'],
            dots: ['done', 'done', 'current', 'future', 'future'] as DotState[],
            detail: 'No linked Bill of Lading shipment yet',
            action: { label: 'Open document →' },
          }
        : card;
      if (isBol && waitingForBolCard.docId) {
        return {
          ...waitingForBolCard,
          containerMappingAction: () => openContainerMapping(waitingForBolCard.docId!),
          dndInputsAction: () => openDndInputs(waitingForBolCard.docId!, waitingForBolCard.dndInputsContext),
          canUseContainerMapping: activities.includes('documents.map_container_to_sku'),
          canUseDndInputs: activities.includes('documents.dnd_inputs'),
        };
      }
      return waitingForBolCard;
    }),
    [activities, documentsQuery.data, queueSection],
  );
  const queuePagination = documentsQuery.data?.pagination ?? null;
  const queueLoading = documentsQuery.isLoading || (documentsQuery.isFetching && !documentsQuery.data);
  const queueError = documentsQuery.isError ? 'Could not load documents from the backend.' : null;

  useEffect(() => {
    setQueuePage(1);
  }, [activeChip, queueSearch, queueDocTypeFilter]);

  const generatedDocsQuery = useQuery({
    queryKey: ['upload-process', 'generated-drafts'],
    queryFn: async () => {
      const generatedTypes: GeneratedDocType[] = ['PACKING_LIST', 'US_PACKING_LIST', 'ENTRY_SUMMARY'];
      const draftGroups = await Promise.all(
        generatedTypes.map(async (generatedDocType) => {
          try {
            return await apiGet<DraftPayload[]>(`/doc-generation/drafts?generatedDocType=${generatedDocType}`);
          } catch {
            return [];
          }
        }),
      );
      const drafts = draftGroups.flat();
      const validations = await Promise.all(
        drafts.map(async (draft) => {
          try {
            const response = await apiGet<{ ok: boolean; data: GeneratedDraftValidation }>(`/api/validation/generated-drafts/${draft.draftId}`);
            return response.ok ? response.data : null;
          } catch {
            return null;
          }
        }),
      );
      return drafts
        .map((draft, index) => apiDraftToQueueCard(draft, validations[index]))
        .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
    },
    enabled: !routedDetail || routedDetail.isGenerated,
    placeholderData: (previousData) => previousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const liveGeneratedDocs = generatedDocsQuery.data ?? [];
  const routedDetailCard = useMemo(
    () => routedDetail
      ? (routedDetail.isGenerated ? liveGeneratedDocs : liveDocs).find(item => item.docId === routedDetail.id) ?? null
      : null,
    [liveDocs, liveGeneratedDocs, routedDetail],
  );
  const routedQueueItemQuery = useQuery({
    queryKey: ['upload-process', 'queue-item', routedDetail?.id],
    queryFn: async () => {
      const response = await documentApi.getQueueItem(routedDetail!.id);
      return apiDocToQueueCard(response.data);
    },
    enabled: Boolean(routedDetail && !routedDetail.isGenerated && !routedDetailCard),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (!routedDetail) {
      return;
    }

    setPageTab('queue');
    if (routedDetailCard) {
      setDetailCard(routedDetailCard);
      return;
    }
    if (routedQueueItemQuery.data) {
      setDetailCard(routedQueueItemQuery.data);
    } else if (routedQueueItemQuery.isError) {
      toast({
        title: 'Could not load details',
        description: routedQueueItemQuery.error instanceof Error ? routedQueueItemQuery.error.message : 'The stored validation details could not be loaded.',
        variant: 'destructive',
      });
      navigate(PROCESSING_QUEUE_ROUTE);
    }
  }, [navigate, routedDetail, routedDetailCard, routedQueueItemQuery.data, routedQueueItemQuery.error, routedQueueItemQuery.isError, toast]);

  const fetchBolInboxDocs = useCallback(() => {
    setBolInboxDocs([]);
  }, []);

  useEffect(() => {
    fetchBolInboxDocs();
  }, [fetchBolInboxDocs]);

  const shipmentsQuery = useQuery({
    queryKey: ['upload-process', 'shipments'],
    queryFn: async () => {
      const token = getAuthToken();
      const response = await fetch('/api/v1/shipments', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error('Could not load shipments.');
      return response.json() as Promise<{ data?: Array<{ id: string; shipmentNumber?: string }> }>;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const shipmentOpts = useMemo(
    () => (shipmentsQuery.data?.data ?? []).map((s) => ({
      id: s.id,
      label: s.shipmentNumber ?? s.id,
    })),
    [shipmentsQuery.data],
  );

  const escalationQuery = useQuery({
    queryKey: ['upload-process', 'escalation-configs'],
    queryFn: async () => {
      const response = await apiGet<{ ok: boolean; data: EscalationConfig[] }>('/api/admin/escalation');
      return response.ok && Array.isArray(response.data) ? response.data : [];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const roleEscalationConfigs = useMemo<EscalationConfig[]>(
    () => (activitySla ?? [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: `role-${String(item.activityCode ?? item.activityType ?? '')}-${String(item.scope ?? '')}`,
        activityType: String(item.activityType ?? ''),
        activityName: item.activityName ? String(item.activityName) : undefined,
        scope: item.scope ? String(item.scope) : undefined,
        baseDoc: item.baseDoc ? String(item.baseDoc) : undefined,
        baseSlaHours: Number(item.baseSlaHours ?? 0),
        reminderPct: Number(item.reminderPct ?? 0),
        warningPct: Number(item.warningPct ?? 50),
        escalationPct: Number(item.escalationPct ?? 75),
        blockerPct: Number(item.blockerPct ?? 100),
      }))
      .filter((item) => item.activityType && Number.isFinite(Number(item.baseSlaHours)) && Number(item.baseSlaHours) > 0),
    [activitySla],
  );
  const escalationConfigs = useMemo(
    () => [...roleEscalationConfigs, ...(escalationQuery.data ?? [])],
    [roleEscalationConfigs, escalationQuery.data],
  );

  const ocrHealthQuery = useQuery({
    queryKey: ['upload-process', 'ocr-health'],
    queryFn: async () => {
      await documentApi.list({ page: 1, pageSize: 1, section: 'all' });
      return 'connected' as const;
    },
    enabled: !routedDetail,
    retry: 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const ocrHealth = (
    ocrHealthQuery.isLoading ? 'unknown' : ocrHealthQuery.isError ? 'offline' : ocrHealthQuery.data ?? 'unknown'
  ) as 'unknown' | 'connected' | 'degraded' | 'offline';

  const backendDocTypes: Record<string, string> = {
    sales_invoices: 'SALES_INVOICE',
    bill_of_lading: 'BILL_OF_LADING',
    shipping_bill: 'SHIPPING_BILL',
    packing_list: 'PACKING_LIST',
    entry_summary: 'ENTRY_SUMMARY',
    draft_cbp_form_7501_broker: 'DRAFT_CBP_FORM_7501_BROKER',
    cha: 'CHA_BILL',
    freight_forwarder_bill: 'FREIGHT_FORWARDER_BILL',
    customer_broker_bill: 'CUSTOMER_BROKER_BILL',
    ocean_freight: 'OCEAN_FREIGHT',
    grn_inbound: 'GRN_INBOUND',
    port_to_wh: 'PORT_TO_WH',
    wh_to_customer: 'WH_TO_CUSTOMER',
    outward_grn: 'OUTWARD_GRN',
    us_sales_invoice: 'US_SALES_INVOICE',
    us_packing_list: 'US_PACKING_LIST',
    us_delivery_order: 'US_DELIVERY_ORDER',
    us_cargo_release_order: 'US_CARGO_RELEASE_ORDER',
    us_customs_release_order: 'US_CUSTOMS_RELEASE_ORDER',
    isf: 'ISF',
  };
  const allowedUploadDocTypes = permittedDocTypes.upload ?? [];
  const canUploadDocType = useCallback((docTypeCode: string): boolean => {
    if (!allowedUploadDocTypes.length) return false;
    return allowedUploadDocTypes.includes('*') || allowedUploadDocTypes.includes(docTypeCode);
  }, [allowedUploadDocTypes]);
  const uploadDocTypeForOption = useCallback((optionValue: string): string => (
    backendDocTypes[optionValue]
    ?? optionValue.trim().replace(/-/g, '_').toUpperCase()
  ), []);
  const permittedDocTypeGroups = useMemo(
    () => docTypeGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) => canUploadDocType(uploadDocTypeForOption(option.value))),
      }))
      .filter((group) => group.options.length > 0),
    [canUploadDocType, docTypeGroups, uploadDocTypeForOption],
  );
  const permittedDocTypeFlat = useMemo(
    () => docTypeFlat.filter((option) => canUploadDocType(uploadDocTypeForOption(option.value))),
    [canUploadDocType, docTypeFlat, uploadDocTypeForOption],
  );
  useEffect(() => {
    if (docType === 'auto') return;
    if (!canUploadDocType(uploadDocTypeForOption(docType))) {
      setDocType('auto');
      setClassification(null);
    }
  }, [canUploadDocType, docType, uploadDocTypeForOption]);

  const classifyDocumentMutation = useMutation({
    mutationFn: (form: FormData) => documentApi.classify(form),
  });
  const uploadDocumentMutation = useMutation({
    mutationFn: (form: FormData) => documentApi.upload(form),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['upload-process', 'documents'] });
    },
  });
  const stopDocumentMutation = useMutation({
    mutationFn: (documentId: string) => documentApi.stop(documentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['upload-process', 'documents'] });
    },
  });
  const retryDocumentMutation = useMutation({
    mutationFn: (documentId: string) => documentApi.retry(documentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['upload-process', 'documents'] });
    },
  });
  const reuploadDocumentMutation = useMutation({
    mutationFn: ({ documentId, form }: { documentId: string; form: FormData }) => documentApi.reupload(documentId, form),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['upload-process', 'documents'] }),
        queryClient.invalidateQueries({ queryKey: ['upload-process', 'generated-drafts'] }),
      ]);
    },
  });
  const containerMappingQuery = useQuery({
    queryKey: ['upload-process', 'container-mapping', containerMappingDocumentId],
    queryFn: async () => {
      const response = await documentApi.getContainerMapping(containerMappingDocumentId!);
      return response.data;
    },
    enabled: containerMappingOpen && Boolean(containerMappingDocumentId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const saveContainerMappingMutation = useMutation({
    mutationFn: ({ documentId, rows }: { documentId: string; rows: ContainerMappingRow[] }) =>
      documentApi.saveContainerMapping(
        documentId,
        rows.map(row => ({ lineItemId: row.lineItemId, containerNo: row.containerNo })),
      ),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['upload-process', 'container-mapping', variables.documentId] });
    },
  });
  const containerMapping = containerMappingQuery.data ?? null;
  const containerMappingLoading = containerMappingQuery.isLoading || (containerMappingQuery.isFetching && !containerMappingQuery.data);
  const containerMappingSaving = saveContainerMappingMutation.isPending;
  useEffect(() => {
    if (!containerMappingQuery.isError) return;
    toast({
      title: 'Could not load container mapping',
      description: containerMappingQuery.error instanceof Error ? containerMappingQuery.error.message : 'The BOL could not be matched to Packing Lists.',
      variant: 'destructive',
    });
  }, [containerMappingQuery.error, containerMappingQuery.isError, toast]);

  async function runAutoDetect() {
    if (!selectedFile || isClassifying || isUploading) return;
    setIsClassifying(true);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      const { data } = await classifyDocumentMutation.mutateAsync(form);
      const resolvedDocType = String(data.docType ?? '').toUpperCase();
      if (!resolvedDocType) throw new Error('Document type could not be detected.');
      setClassification({
        docType: resolvedDocType,
        label: data.label || resolvedDocType.replace(/_/g, ' '),
        confidence: Number(data.confidence ?? 0),
      });
    } catch (err) {
      toast({
        title: 'Auto-detect failed',
        description: err instanceof Error ? err.message : 'Unable to verify the document type.',
        variant: 'destructive',
      });
    } finally {
      setIsClassifying(false);
    }
  }

  async function runPageUpload() {
    if (!selectedFile || isUploading) return;
    const resolvedDocType = classification?.docType
      ?? backendDocTypes[docType]
      ?? (docType !== 'auto' ? docType.trim().replace(/-/g, '_').toUpperCase() : '');
    if (!resolvedDocType) {
      toast({ title: 'Verify the document first', description: 'Run Auto-detect before approving the upload.' });
      return;
    }
    if (!canUploadDocType(resolvedDocType)) {
      toast({ title: 'Access denied for this doc', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    const form = new FormData();
    form.append('file', selectedFile);
    form.append('docType', resolvedDocType);
    try {
      const uploadResponse = await uploadDocumentMutation.mutateAsync(form);
      const uploadedDocument = uploadResponse.data?.documents?.[0];
      toast({ title: 'Uploaded successfully', description: `${selectedFile.name} is queued for OCR processing.` });
      setUploadSuccess({
        id: uploadedDocument?.id ?? null,
        name: uploadedDocument?.fileName ?? selectedFile.name,
      });
      chooseFile(null);
      setQueuePage(1);
    } catch (err) {
      const message = uploadErrorMessage(err);
      const isAccessDenied = message.toLowerCase().includes('access denied') || message.toLowerCase().includes('permission denied');
      toast({
        title: isAccessDenied ? 'Access denied for this doc' : 'Upload failed',
        description: isAccessDenied ? undefined : message,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  }

  const [recentExpanded, setRecentExpanded] = useState(false);
  const [ocrTooltipOpen,   setOcrTooltipOpen]   = useState(false);
  const [pageTab, setPageTab] = useState<'upload' | 'queue'>(() => (
    location === PROCESSING_QUEUE_ROUTE ? 'queue' : 'upload'
  ));
  const [uploadSuccess, setUploadSuccess] = useState<{ id: string | null; name: string } | null>(null);

  useEffect(() => {
    if (location === PROCESSING_QUEUE_ROUTE || routedDetail) {
      setPageTab('queue');
    } else if (location === UPLOAD_PROCESS_ROUTE) {
      setPageTab('upload');
    }
  }, [location, routedDetail]);

  useEffect(() => {
    if (sessionStorage.getItem(UPLOAD_PROCESS_RETURN_PATH_KEY) === PROCESSING_QUEUE_ROUTE) {
      sessionStorage.removeItem(UPLOAD_PROCESS_RETURN_PATH_KEY);
      setPageTab('queue');
    }
  }, []);

  // Queue and completed sections are derived exclusively from backend records.
  const QUEUE_CARDS: QueueCard[] = [...liveDocs, ...liveGeneratedDocs];
  const uploadSuccessCard = uploadSuccess?.id
    ? liveDocs.find(card => card.docId === uploadSuccess.id)
    : undefined;
  const uploadIsExtracted = uploadSuccessCard ? needsReviewApproval(uploadSuccessCard) : false;
  const uploadIsApproved = uploadSuccessCard?.statusCategory === 'cross-validating'
    || uploadSuccessCard?.statusCategory === 'done';
  const uploadStatusTitle = uploadIsApproved
    ? 'Extraction approved ✓'
    : uploadIsExtracted
      ? 'Extraction completed ✓'
      : 'Queued successfully ✓';
  const uploadStatusDescription = uploadIsApproved
    ? 'has been extracted and approved'
    : uploadIsExtracted
      ? 'has completed OCR extraction and is ready for approval'
      : 'is queued for OCR extraction';
  const uploadStatusDots: DotState[] = uploadSuccessCard?.dots
    ?? ['done', 'current-spin', 'future', 'future', 'future'];
  const COMPLETED = QUEUE_CARDS
    .filter(card => card.statusCategory === 'done')
    .map(card => ({
      code: card.docCode,
      label: card.docType,
      number: card.docNumber,
      checks: '—',
      time: card.timestamp,
      generated: !!card.isGenerated,
    }));
  function openApprovalPanel(card: QueueCard) {
    if (card.docId) navigate(`/documents/upload/${card.docId}/approve`);
  }

  async function stopExtraction(card: QueueCard) {
    if (!card.docId) return;
    try {
      await stopDocumentMutation.mutateAsync(card.docId);
      toast({ title: 'Extraction stopped', description: `${card.docNumber} returned to the upload state.` });
    } catch (error) {
      toast({
        title: 'Could not stop extraction',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  }

  async function retryExtraction(card: QueueCard) {
    if (!card.docId) return;
    try {
      await retryDocumentMutation.mutateAsync(card.docId);
      toast({ title: 'Extraction queued again', description: card.docNumber });
    } catch (error) {
      toast({
        title: 'Could not retry extraction',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  }

  async function reuploadBlockedDocument(card: QueueCard, file: File, action: ReuploadAction) {
    const targetDocumentId = action === 'source' ? card.sourceDocId : card.docId;
    if (!targetDocumentId) {
      toast({
        title: 'No source document found',
        description: 'This generated document is missing a linked source document.',
        variant: 'destructive',
      });
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('refreshGeneratedDrafts', String(action === 'source'));
    try {
      await reuploadDocumentMutation.mutateAsync({ documentId: targetDocumentId, form });
      toast({
        title: action === 'source' ? 'Source document re-upload queued' : 'Document re-upload queued',
        description: action === 'source'
          ? 'OCR will rerun, generated drafts will be replaced, and validation will refresh after re-approval.'
          : 'OCR will rerun and cross-validation will be overridden after re-approval.',
      });
    } catch (error) {
      toast({
        title: 'Re-upload failed',
        description: error instanceof Error ? error.message : 'Could not re-upload this document.',
        variant: 'destructive',
      });
      throw error;
    }
  }

  async function handleRowClick(card: QueueCard) {
    if (card.statusCategory === 'draft-review' && card.action?.href) {
      navigate(card.action.href);
      return;
    }
    if (card.docId) {
      sessionStorage.setItem(UPLOAD_PROCESS_RETURN_PATH_KEY, PROCESSING_QUEUE_ROUTE);
      navigate(`/documents/upload/${card.docId}`);
      return;
    }
  }

  function handleDetailsClick(card: QueueCard) {
    setDetailCard(card);
    navigate(validationDetailsPath(card));
  }

  // ── Derived stats & filter ──────────────────────────────────────────────────
  function openContainerMapping(documentId: string) {
    setContainerMappingDocumentId(documentId);
    setContainerMappingOpen(true);
  }

  function openDndInputs(documentId: string, context?: QueueCard['dndInputsContext']) {
    setDndInputsDocumentId(documentId);
    setDndInputsContext(context ?? null);
    setDndInputsOpen(true);
  }

  async function saveContainerMappingRows(rows: ContainerMappingRow[]) {
    if (!containerMappingDocumentId) return;
    try {
      await saveContainerMappingMutation.mutateAsync({ documentId: containerMappingDocumentId, rows });
      toast({ title: 'Container mapping saved', description: `${rows.length} Packing List rows updated.` });
      setContainerMappingOpen(false);
    } catch (error) {
      toast({ title: 'Could not save container mapping', description: error instanceof Error ? error.message : 'Container assignments were not saved.', variant: 'destructive' });
    }
  }

  const visibleCards: QueueCard[] = QUEUE_CARDS;

  const categoryCounts = useMemo(() => ({
    total: visibleCards.length,
    needsApproval: visibleCards.filter((c) => c.statusCategory === 'needs-approval').length,
    needsReapproval: visibleCards.filter((c) => c.statusCategory === 'needs-reapproval').length,
    processing: visibleCards.filter((c) => c.statusCategory === 'processing').length,
    crossValidating: visibleCards.filter((c) => c.statusCategory === 'cross-validating').length,
    draftReview: visibleCards.filter((c) => c.statusCategory === 'draft-review').length,
    done: visibleCards.filter((c) => c.statusCategory === 'done').length,
    waitingForBol: visibleCards.filter((c) => c.statusCategory === 'waiting-for-bol').length,
  }), [visibleCards]);
  const statsCount = categoryCounts;

  const liveUnattachedCount = statsCount.waitingForBol;
  const reviewActionCount = statsCount.needsApproval + statsCount.needsReapproval;

  const CHIP_CATEGORIES: (StatusCategory | null)[] = [null, 'needs-approval', 'needs-reapproval', 'processing', 'cross-validating', 'draft-review', 'done', 'waiting-for-bol'];
  const queueDocTypeKey = (card: QueueCard) => (
    card.documentTypeCode || card.docType || card.docCode
  ).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const queueDocTypeFilterLabel = (card: QueueCard) => {
    const raw = String(card.documentTypeCode || '').toUpperCase();
    if (raw === 'DRAFT_CBP_FORM_7501_BROKER') return 'Draft CBP FORM 7501 Broker';
    if (raw === 'ENTRY_SUMMARY') return card.statusCategory === 'draft-review' ? 'Generated Draft CBP FORM 7501' : 'CBP FORM 7501';
    return card.docType;
  };
  const queueDocTypeOptions = useMemo(() => {
    const options = new Map<string, { label: string; count: number }>();
    for (const card of visibleCards) {
      const key = queueDocTypeKey(card);
      if (!key) continue;
      const existing = options.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        options.set(key, { label: queueDocTypeFilterLabel(card), count: 1 });
      }
    }
    return Array.from(options.entries())
      .map(([value, option]) => ({ value, ...option }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleCards]);

  useEffect(() => {
    if (queueDocTypeFilter === 'all' || queueDocTypeOptions.length === 0) return;
    if (!queueDocTypeOptions.some((option) => option.value === queueDocTypeFilter)) {
      setQueueDocTypeFilter('all');
    }
  }, [queueDocTypeFilter, queueDocTypeOptions]);

  const searchedCards = queueSearch.trim()
    ? visibleCards.filter((c) => {
        const q = queueSearch.toLowerCase();
        return c.docNumber.toLowerCase().includes(q)
          || c.docType.toLowerCase().includes(q)
          || c.issuer.toLowerCase().includes(q)
          || c.status.toLowerCase().includes(q);
      })
    : visibleCards;

  const docTypeFilteredCards = queueDocTypeFilter === 'all'
    ? searchedCards
    : searchedCards.filter((c) => queueDocTypeKey(c) === queueDocTypeFilter);

  const filteredCards = activeChip === 0
    ? docTypeFilteredCards
    : docTypeFilteredCards.filter((c) => c.statusCategory === CHIP_CATEGORIES[activeChip]);

  const queueSearchOptions = queueSearch.trim() ? filteredCards.slice(0, 8) : [];

  const queueTotalPages = Math.max(1, queuePagination?.totalPages ?? 1);
  const queuePageNumbers = (() => {
    const current = queuePagination?.page ?? queuePage;
    const total = queueTotalPages;
    const start = Math.max(1, Math.min(current - 2, total - 4));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  })();
  const goToQueuePage = (page: number) => {
    const nextPage = Math.min(queueTotalPages, Math.max(1, page));
    if (nextPage === queuePage || queueLoading) return;
    setQueuePage(nextPage);
  };

  useEffect(() => {
    setPageMeta({
      title: 'Upload & Process',
      subtitle: 'Upload documents · OCR extract · Approve fields · Route to shipment',
    });
    return () => setPageMeta(null);
  }, [setPageMeta]);

  return (
    <div className="ewms-page-shell">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes recentUploadMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .recent-upload-rail {
          overflow: hidden;
          padding: 2px 0 4px;
          mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%);
        }
        .recent-upload-track {
          display: flex;
          gap: 12px;
          width: max-content;
          animation: recentUploadMarquee 34s linear infinite;
        }
        .recent-upload-track:hover {
          animation-play-state: paused;
        }
        .recent-upload-card-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
      {containerMappingOpen && (
        <ContainerMappingModal
          mapping={containerMapping}
          loading={containerMappingLoading}
          saving={containerMappingSaving}
          onClose={() => setContainerMappingOpen(false)}
          onSave={saveContainerMappingRows}
        />
      )}
      <ShipmentDndInputsDialog
        open={dndInputsOpen}
        shipmentId={dndInputsDocumentId ? `bol-${dndInputsDocumentId}` : 'bol'}
        bolCarrierName={dndInputsContext?.bolCarrierName}
        origin={dndInputsContext?.origin}
        destination={dndInputsContext?.destination}
        cargo={dndInputsContext?.cargo ?? 'FCL'}
        onOpenChange={(open) => {
          setDndInputsOpen(open);
          if (!open) setDndInputsContext(null);
        }}
      />
      <ValidationDetailSheet
        card={detailCard}
        open={!!detailCard}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCard(null);
            if (routedDetail) navigate(PROCESSING_QUEUE_ROUTE);
          }
        }}
        onReupload={reuploadBlockedDocument}
      />

      {/* ── Tab navigation ── */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${BORDER}`, marginBottom: 28 }}>
        <button
          onClick={() => navigate(UPLOAD_PROCESS_ROUTE)}
          style={{
            fontSize: 14.5, fontWeight: pageTab === 'upload' ? 700 : 500,
            color: pageTab === 'upload' ? TEAL : MUTED,
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: pageTab === 'upload' ? `2px solid ${TEAL}` : '2px solid transparent',
            padding: '6px 20px 8px', marginBottom: -1, transition: 'color 0.12s',
          }}
        >
          Upload
        </button>
        <button
          onClick={() => navigate(PROCESSING_QUEUE_ROUTE)}
          style={{
            fontSize: 14.5, fontWeight: pageTab === 'queue' ? 700 : 500,
            color: pageTab === 'queue' ? TEAL : MUTED,
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: pageTab === 'queue' ? `2px solid ${TEAL}` : '2px solid transparent',
            padding: '6px 20px 8px', marginBottom: -1, transition: 'color 0.12s',
            display: 'inline-flex', alignItems: 'center', gap: 7,
          }}
        >
          Processing queue
          {reviewActionCount > 0 && (
            <span style={{ fontSize: 14, fontWeight: 700, padding: '1px 7px', borderRadius: 999, backgroundColor: BLUE, color: '#fff' }}>
              {reviewActionCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Upload tab ── */}
      <div style={{ display: pageTab === 'upload' ? 'block' : 'none' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>

          {/* ─ Success card (shown after upload) ─ */}
          {uploadSuccess && (
            <div style={{
              backgroundColor: 'hsl(var(--card))', borderRadius: 8,
              border: `2px solid ${GREEN}`, padding: '32px 36px', marginBottom: 28,
              boxShadow: 'var(--vs-shadow-card)', textAlign: 'center',
            }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: `${GREEN}18`, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle2 size={28} style={{ color: GREEN }} />
              </div>
              <div style={{ fontSize: 21, fontWeight: 700, color: FG, marginBottom: 8 }}>{uploadStatusTitle}</div>
              <div style={{ fontSize: 14.5, color: MUTED, marginBottom: 20 }}>
                <span className="vs-mono" style={{ color: FG, fontWeight: 600 }}>{uploadSuccess.name}</span>
                {' '}{uploadStatusDescription}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                <PipelineDots dots={uploadStatusDots} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button
                  onClick={() => { setUploadSuccess(null); navigate(PROCESSING_QUEUE_ROUTE); }}
                  style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', backgroundColor: TEAL, border: 'none', borderRadius: 8, padding: '10px 22px', cursor: 'pointer' }}
                >
                  View in queue →
                </button>
                <button
                  onClick={() => setUploadSuccess(null)}
                  style={{ fontSize: 14.5, fontWeight: 500, color: MUTED, backgroundColor: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 22px', cursor: 'pointer' }}
                >
                  Upload another
                </button>
              </div>
            </div>
          )}

          {/* ─ Upload zone + form card ─ */}
          {!uploadSuccess && (
            <div style={{ backgroundColor: 'hsl(var(--card))', borderRadius: 8, border: `1px solid ${BORDER}`, boxShadow: 'var(--vs-shadow-card)', overflow: 'hidden' }}>
              {/* Card header */}
              <div style={{ padding: '16px 24px 15px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: `${TEAL}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <UploadCloud size={16} style={{ color: TEAL }} />
                </div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: FG, lineHeight: 1 }}>Upload document</div>
                  <div style={{ fontSize: 14.5, color: MUTED, marginTop: 3 }}>Drop a file · OCR extracts fields automatically · approve when ready</div>
                </div>
                {/* OCR health pre-flight pill */}
                {ocrHealth !== 'unknown' && (
                  <div style={{ marginLeft: 'auto', position: 'relative', flexShrink: 0 }}>
                    <button
                      onClick={() => ocrHealth !== 'connected' && setOcrTooltipOpen(v => !v)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 9px', borderRadius: 999, fontSize: 14.5, fontWeight: 600,
                        backgroundColor: ocrHealth === 'connected' ? `${GREEN}15` : 'hsla(0,84%,60%,0.10)',
                        color: ocrHealth === 'connected' ? GREEN : RED,
                        border: `1px solid ${ocrHealth === 'connected' ? `${GREEN}40` : 'hsla(0,84%,60%,0.3)'}`,
                        cursor: ocrHealth !== 'connected' ? 'pointer' : 'default',
                        background: ocrHealth === 'connected' ? `${GREEN}15` : 'hsla(0,84%,60%,0.10)',
                      }}
                    >
                      <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, backgroundColor: ocrHealth === 'connected' ? GREEN : RED }} />
                      {ocrHealth === 'connected' ? 'OCR ready' : ocrHealth === 'degraded' ? 'OCR degraded' : 'OCR offline'}
                    </button>
                    {ocrTooltipOpen && ocrHealth !== 'connected' && (
                      <div
                        onClick={() => setOcrTooltipOpen(false)}
                        style={{
                          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20,
                          backgroundColor: 'hsl(var(--card))', borderRadius: 8,
                          border: `1px solid ${BORDER}`,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                          padding: '10px 14px', maxWidth: 260,
                          fontSize: 14, color: FG, lineHeight: 1.5,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: RED }}>OCR service unreachable.</span>
                        {' '}Uploaded files will be queued and processed automatically when the service reconnects. Uploads are not blocked.
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ padding: '22px 24px' }}>
                {/* Large drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) chooseFile(f); }}
                  style={{
                    height: selectedFile ? 88 : 220, borderRadius: 8, cursor: 'pointer',
                    border: `2px dashed ${isDragOver ? TEAL : selectedFile ? GREEN : BORDER}`,
                    backgroundColor: isDragOver ? 'hsla(173,58%,39%,0.06)' : selectedFile ? 'hsla(152,69%,31%,0.05)' : 'hsl(var(--background))',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                    transition: 'all 0.2s',
                  }}
                >
                  <UploadCloud size={selectedFile ? 24 : 44} style={{ color: selectedFile ? GREEN : isDragOver ? TEAL : MUTED }} />
                  {selectedFile ? (
                    <>
                      <span style={{ fontSize: 14.5, fontWeight: 600, color: GREEN }}>File ready — {selectedFile.name}</span>
                      <span style={{ fontSize: 14, color: MUTED }}>Click to change file</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 16, fontWeight: 600, color: FG }}>Drop file here</span>
                      <span style={{ fontSize: 14.5, color: MUTED }}>or click to browse · PDF · JPG · PNG</span>
                    </>
                  )}
                </div>
                {selectedFile && (
                  <button onClick={(e) => { e.stopPropagation(); chooseFile(null); }} style={{ fontSize: 14.5, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', marginTop: 6, padding: '2px 0' }}>
                    ✕ Remove file
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseFile(f); e.target.value = ''; }} />
                {/* Two-column selectors */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
                  {/* Corridor row — full width, only shown when org has 2+ corridors */}
                  {corridors.length >= 2 && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: MUTED, letterSpacing: 0, marginBottom: 5 }}>Corridor</label>
                      <select value={corridorVal} onChange={(e) => setCorridorVal(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', fontSize: 14.5, color: FG, cursor: 'pointer' }}>
                        <option value="">Select corridor…</option>
                        {corridors.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <p style={{ fontSize: 14, color: MUTED, margin: '4px 0 0' }}>Corridor helps route this document to the correct template</p>
                    </div>
                  )}
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: MUTED, letterSpacing: 0, marginBottom: 5 }}>Document type</label>
                    <select value={docType} onChange={(e) => { setDocType(e.target.value); setClassification(null); }} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', fontSize: 14.5, color: FG, cursor: 'pointer' }}>
                      <option value="auto">Auto-detect</option>
                      {configLoading && !docTypeFlat.length
                        ? <option disabled value="">Loading…</option>
                        : permittedDocTypeGroups.length > 0
                          ? (() => {
                              const usedVals = new Set<string>();
                              return permittedDocTypeGroups.map((g, gi) => {
                                const opts = g.options.filter(o => {
                                  if (usedVals.has(o.value)) return false;
                                  usedVals.add(o.value);
                                  return true;
                                });
                                if (!opts.length) return null;
                                return (
                                  <optgroup key={`g${gi}`} label={g.label}>
                                    {opts.map((o, oi) => (
                                      <option key={`g${gi}o${oi}`} value={o.value}>{o.label}</option>
                                    ))}
                                  </optgroup>
                                );
                              });
                            })()
                          : (() => {
                              const usedVals = new Set<string>();
                              return permittedDocTypeFlat.filter(o => {
                                if (usedVals.has(o.value)) return false;
                                usedVals.add(o.value);
                                return true;
                              }).map((o, i) => (
                                <option key={i} value={o.value}>{o.label}</option>
                              ));
                            })()
                      }
                    </select>
                    <p style={{ fontSize: 14, color: MUTED, margin: '4px 0 0' }}>Leave on Auto-detect to let OCR identify</p>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: MUTED, letterSpacing: 0, marginBottom: 5 }}>Assign to shipment</label>
                    <select value={shipmentVal} onChange={(e) => setShipmentVal(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, backgroundColor: 'hsl(var(--background))', fontSize: 14.5, color: FG, cursor: 'pointer' }}>
                      <option value="">Auto-match after OCR</option>
                      {shipmentOpts.map(s => (<option key={s.id} value={s.id}>{s.label}</option>))}
                    </select>
                    <p style={{ fontSize: 14, color: MUTED, margin: '4px 0 0' }}>Matched via invoice / BOL</p>
                  </div>
                </div>
                {classification && (
                  <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, border: `1px solid ${GREEN}55`, backgroundColor: `${GREEN}0D`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, color: MUTED }}>Verified document type</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: FG }}>{classification.label}</div>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>{Math.round(classification.confidence * 100)}% confidence</span>
                  </div>
                )}
                {/* Auto-detect verifies the type; approval then uploads and starts OCR. */}
                <button
                  onClick={docType === 'auto' && !classification ? runAutoDetect : runPageUpload}
                  disabled={!selectedFile || isUploading || isClassifying}
                  style={{ marginTop: 16, width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', cursor: selectedFile && !isUploading && !isClassifying ? 'pointer' : 'not-allowed', backgroundColor: selectedFile && !isUploading && !isClassifying ? (classification || docType !== 'auto' ? GREEN : TEAL) : 'hsl(var(--border))', color: selectedFile && !isUploading && !isClassifying ? '#fff' : MUTED, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'background-color 0.15s' }}
                >
                  {isUploading ? (
                    <><span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #fff4', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Uploading & starting OCR…</>
                  ) : isClassifying ? (
                    <><span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #fff4', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Verifying document…</>
                  ) : docType === 'auto' && !classification ? (
                    <><Sparkles size={16} />{selectedFile ? 'Auto-detect document type' : 'Select a file to verify'}</>
                  ) : (
                    <><CheckCircle2 size={16} />Approve & start OCR</>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ─ My recent uploads (4–6 status cards) ─ */}
          <div style={{ marginTop: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: FG }}>My recent uploads</span>
              {liveUnattachedCount > 0 && (
                <button onClick={() => navigate(PROCESSING_QUEUE_ROUTE)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14.5, fontWeight: 600, padding: '3px 10px', borderRadius: 999, backgroundColor: 'hsla(38,92%,50%,0.10)', color: AMBER, border: `1px solid hsla(38,92%,50%,0.25)`, cursor: 'pointer' }}>
                  ⚠ {liveUnattachedCount} waiting for BOL
                </button>
              )}
            </div>
            {liveDocs.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0', color: MUTED }}>
                <UploadCloud size={28} style={{ opacity: 0.35, marginBottom: 8 }} />
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>No uploads yet</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>Documents you upload will appear here.</div>
              </div>
            )}
            {liveDocs.length > 0 && (() => {
              const sorted = [...liveDocs].sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return tb - ta;
              }).slice(0, 6);
              const railCards = sorted.length > 2 ? [...sorted, ...sorted] : sorted;
              const renderRecentCard = (card: QueueCard, key: string) => (
                <div
                  key={key}
                  onClick={() => handleRowClick(card)}
                  style={{
                    width: 210,
                    flex: '0 0 210px',
                    backgroundColor: 'hsl(var(--card))',
                    borderRadius: 8,
                    border: `1px solid ${BORDER}`,
                    borderLeft: `3px solid ${card.headerColor}`,
                    padding: '14px 16px',
                    boxShadow: 'var(--vs-shadow-card)',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.15s',
                  }}
                  onMouseEnter={event => {
                    event.currentTarget.style.boxShadow = '0 4px 18px hsla(0,0%,0%,0.18)';
                    event.currentTarget.style.borderColor = card.headerColor;
                    event.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={event => {
                    event.currentTarget.style.boxShadow = 'var(--vs-shadow-card)';
                    event.currentTarget.style.borderColor = BORDER;
                    event.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, minWidth: 0 }}>
                    <DocBadge code={card.docCode} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        <span className="recent-upload-card-text" style={{ fontSize: 14, fontWeight: 700, color: FG }}>
                          {card.docType}
                        </span>
                        {card.isGenerated && <Sparkles size={9} style={{ color: GOLD, flexShrink: 0 }} />}
                      </div>
                      <span className="vs-mono recent-upload-card-text" style={{ fontSize: 14, color: MUTED, display: 'block' }}>
                        {card.docNumber}
                      </span>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <PipelineDots dots={card.dots} gold={card.goldDots} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      {card.statusCategory === 'needs-approval' ? (
                        <span className="recent-upload-card-text" style={{ maxWidth: 120, display: 'inline-block', fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 999, backgroundColor: 'hsla(221,83%,53%,0.10)', color: BLUE }}>
                          {card.status}
                        </span>
                      ) : card.statusCategory === 'done' ? (
                        <span className="recent-upload-card-text" style={{ maxWidth: 120, display: 'inline-block', fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 999, backgroundColor: `${GREEN}12`, color: GREEN }}>
                          {card.status}
                        </span>
                      ) : card.statusCategory === 'draft-review' ? (
                        <span className="recent-upload-card-text" style={{ maxWidth: 120, display: 'inline-block', fontSize: 14, fontWeight: 600, padding: '2px 8px', borderRadius: 999, backgroundColor: GOLD_BG, color: 'hsl(38 92% 30%)' }}>
                          {card.status}
                        </span>
                      ) : (
                        <StatusPill status={card.status} variant={card.statusVariant} />
                      )}
                    </div>
                    <span style={{ fontSize: 14, color: MUTED, flexShrink: 0 }}>{card.timestamp}</span>
                  </div>
                </div>
              );
              return (
                <div className="recent-upload-rail">
                  <div
                    className={sorted.length > 2 ? 'recent-upload-track' : undefined}
                    style={sorted.length <= 2 ? { display: 'flex', gap: 12 } : undefined}
                  >
                    {railCards.map((card, index) => renderRecentCard(card, `${card.id}-${index}`))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* View full queue link */}
          <div style={{ textAlign: 'center', marginTop: 32, paddingBottom: 8 }}>
            <button onClick={() => navigate(PROCESSING_QUEUE_ROUTE)} style={{ fontSize: 14, fontWeight: 500, color: TEAL, background: 'none', border: `1px solid ${TEAL}40`, borderRadius: 8, padding: '8px 22px', cursor: 'pointer' }}>
              View full processing queue ({statsCount.total} docs) →
            </button>
          </div>

        </div>
      </div>

      {/* ── Queue tab (full-width) ── */}
      <div style={{ display: pageTab === 'queue' ? 'block' : 'none' }}>
        <div>

          {/* ── Document type filter + search ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <select
              value={queueDocTypeFilter}
              onChange={(event) => setQueueDocTypeFilter(event.target.value)}
              aria-label="Filter queue by document type"
              style={{
                height: 38,
                boxSizing: 'border-box',
                flex: '0 0 auto',
                minWidth: 190,
                padding: '0 34px 0 12px',
                border: `1px solid ${BORDER}`,
                borderRadius: 7,
                backgroundColor: 'hsl(var(--card))',
                color: queueDocTypeFilter === 'all' ? MUTED : FG,
                fontSize: 14,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All document types</option>
              {queueDocTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px',
              height: 38, boxSizing: 'border-box', flex: '0 0 auto',
              width: 280, border: `1px solid ${BORDER}`, borderRadius: 7, backgroundColor: 'hsl(var(--card))',
              position: 'relative', zIndex: 5,
            }}>
              <Search size={13} style={{ color: MUTED, flexShrink: 0 }} />
              <input
                value={queueSearch}
                onChange={event => setQueueSearch(event.target.value)}
                placeholder="Search documents..."
                style={{ border: 'none', outline: 'none', background: 'transparent', color: FG, fontSize: 14, flex: 1, minWidth: 0 }}
              />
              {queueSearch && (
                <button onClick={() => setQueueSearch('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED, padding: 0 }}>×</button>
              )}
              {queueSearchOptions.length > 0 && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
                  backgroundColor: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8,
                  boxShadow: '0 10px 28px hsla(0,0%,0%,0.16)', overflow: 'hidden',
                }}>
                  {queueSearchOptions.map(card => (
                    <button
                      key={card.id}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => {
                        setQueueSearch(card.docNumber);
                        handleRowClick(card);
                      }}
                      style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '9px 11px', textAlign: 'left' }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, color: FG }}>{card.docType}</div>
                      <div className="vs-mono" style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{card.docNumber} · {card.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Status tabs ── */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <FilterChips
              chips={[
                { label: 'All',              count: statsCount.total },
                { label: 'Needs approval',   count: statsCount.needsApproval },
                { label: 'Needs re-approval', count: statsCount.needsReapproval },
                { label: 'Processing',       count: statsCount.processing },
                { label: 'Cross-validating', count: statsCount.crossValidating },
                { label: 'Draft review',     count: statsCount.draftReview },
                { label: 'Done',             count: statsCount.done },
                { label: 'Waiting for BOL',  count: statsCount.waitingForBol },
              ]}
              activeIndex={activeChip}
              onSelect={setActiveChip}
              size="compact"
            />
          </div>

          {/* ── Queue content ── */}
          <div style={{ position: 'relative' }}>
          {queueLoading ? (
            <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: MUTED, fontSize: 14 }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: TEAL }} />
              Loading document queue...
            </div>
          ) : queueError ? (
            <div style={{ padding: 24, border: `1px solid ${RED}40`, borderRadius: 8, color: RED }}>{queueError}</div>
          ) : filteredCards.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: MUTED }}>No database documents found for this section.</div>
          ) : false ? (
            /* Sectioned view: All + row mode — grouped by category */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {([
                { label: 'Needs your action', cats: ['needs-approval', 'needs-reapproval'] as StatusCategory[], color: BLUE },
                { label: 'Auto-generated — review required', cats: ['draft-review'] as StatusCategory[], color: GOLD },
                { label: 'In progress', cats: ['processing', 'cross-validating'] as StatusCategory[], color: INFO },
                { label: 'Completed', cats: ['done'] as StatusCategory[], color: GREEN },
              ]).map(({ label, cats, color }) => {
                const sectionCards = filteredCards.filter(c => cats.includes(c.statusCategory));
                if (sectionCards.length === 0) return null;
                return (
                  <div key={label}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
                      <div style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
                      <span style={{ fontSize: 14.5, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                      <span style={{
                        fontSize: 14, fontWeight: 600, padding: '1px 8px', borderRadius: 999,
                        backgroundColor: `${color}18`, color,
                      }}>({sectionCards.length})</span>
                    </div>
                    <div style={{
                      backgroundColor: 'hsl(var(--card))', borderRadius: 8,
                      border: `1px solid ${color}28`, overflow: 'hidden',
                    }}>
                      <QueueRowHeader />
                      {sectionCards.map((card) => (
                        <QueueRowEl
                          key={card.id}
                          card={card}
                          onApproveClick={needsReviewApproval(card)
                            ? () => openApprovalPanel(card)
                            : undefined}
                          onStopClick={card.statusCategory === 'processing'
                            ? () => stopExtraction(card)
                            : undefined}
                          onRetryClick={card.status === 'Extraction stopped'
                            ? () => retryExtraction(card)
                            : undefined}
                          onRowClick={() => handleRowClick(card)}
                          onDetailsClick={() => handleDetailsClick(card)}
                          slaConfig={escalationConfigForCard(card, escalationConfigs)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Row view with virtual scroll */
            <div style={{
              backgroundColor: 'hsl(var(--card))', borderRadius: 8,
              border: `1px solid ${BORDER}`, overflow: 'hidden',
            }}>
              <QueueRowHeader />
              {/* Virtual list */}
              <VirtualList
                cards={filteredCards}
                onApproveClick={(card) => needsReviewApproval(card) ? () => openApprovalPanel(card) : undefined}
                onStopClick={(card) => card.statusCategory === 'processing' ? () => stopExtraction(card) : undefined}
                onRetryClick={(card) => card.status === 'Extraction stopped' ? () => retryExtraction(card) : undefined}
                onRowClick={handleRowClick}
                onDetailsClick={handleDetailsClick}
                escalationConfigs={escalationConfigs}
              />
            </div>
          )}

          {queuePagination && queueTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '14px 0 2px', flexWrap: 'wrap' }}>
              <button
                onClick={() => goToQueuePage((queuePagination.page ?? queuePage) - 1)}
                disabled={!queuePagination.hasPreviousPage || queueLoading}
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: !queuePagination.hasPreviousPage || queueLoading ? MUTED : TEAL,
                  background: 'hsl(var(--card))',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: '7px 12px',
                  cursor: !queuePagination.hasPreviousPage || queueLoading ? 'default' : 'pointer',
                  opacity: !queuePagination.hasPreviousPage ? 0.55 : 1,
                }}
              >
                Previous
              </button>
              {queuePageNumbers.map((pageNumber) => {
                const active = pageNumber === (queuePagination.page ?? queuePage);
                return (
                  <button
                    key={pageNumber}
                    onClick={() => goToQueuePage(pageNumber)}
                    disabled={active || queueLoading}
                    style={{
                      minWidth: 34,
                      height: 34,
                      borderRadius: 8,
                      border: `1px solid ${active ? TEAL : BORDER}`,
                      background: active ? TEAL : 'hsl(var(--card))',
                      color: active ? '#fff' : FG,
                      fontSize: 14,
                      fontWeight: 800,
                      cursor: active || queueLoading ? 'default' : 'pointer',
                    }}
                  >
                    {pageNumber}
                  </button>
                );
              })}
              <button
                onClick={() => goToQueuePage((queuePagination.page ?? queuePage) + 1)}
                disabled={!queuePagination.hasNextPage || queueLoading}
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: !queuePagination.hasNextPage || queueLoading ? MUTED : TEAL,
                  background: 'hsl(var(--card))',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: '7px 12px',
                  cursor: !queuePagination.hasNextPage || queueLoading ? 'default' : 'pointer',
                  opacity: !queuePagination.hasNextPage ? 0.55 : 1,
                }}
              >
                Next
              </button>
              <span style={{ fontSize: 13.5, color: MUTED, marginLeft: 4 }}>
                Page {queuePagination.page} of {queueTotalPages} · {QUEUE_PAGE_SIZE} per page
              </span>
            </div>
          )}

          </div>
        </div>
      </div>

      {/* ── Recently Completed Strip ── */}
      <div style={{ marginTop: 32, borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
        <button
          onClick={() => setRecentExpanded(!recentExpanded)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            width: '100%', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: FG }}>
            Recently completed (last 24 hours)
          </span>
          <span style={{ fontSize: 14, color: MUTED }}>12 documents</span>
          <div style={{ marginLeft: 'auto' }}>
            {recentExpanded
              ? <ChevronDown size={16} color={MUTED} />
              : <ChevronRight size={16} color={MUTED} />}
          </div>
        </button>

        {recentExpanded && (
          <div style={{
            backgroundColor: 'hsl(var(--card))', borderRadius: 8,
            border: `1px solid ${BORDER}`, overflow: 'hidden', marginTop: 12,
          }}>
            <QueueRowHeader />
            {QUEUE_CARDS.filter(card => card.statusCategory === 'done').map((card) => (
              <QueueRowEl
                key={card.id}
                card={card}
                onApproveClick={undefined}
                onStopClick={undefined}
                onRetryClick={undefined}
                onRowClick={() => handleRowClick(card)}
                onDetailsClick={() => handleDetailsClick(card)}
                slaConfig={escalationConfigForCard(card, escalationConfigs)}
              />
            ))}
          </div>
        )}

        {false && recentExpanded && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12,
          }}
               className="grid-cols-1 md:grid-cols-3"
          >
            {COMPLETED.map((item, i) => (
              <div key={i} style={{
                backgroundColor: 'hsl(var(--card))', borderRadius: 8,
                padding: '10px 14px', border: `1px solid ${BORDER}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <DocBadge code={item.code} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </span>
                    {item.generated && <Sparkles size={10} style={{ color: GOLD, flexShrink: 0 }} />}
                  </div>
                  <span className="vs-mono" style={{ fontSize: 14, color: MUTED, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.number}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <CheckCircle2 size={10} style={{ color: GREEN }} />
                    <span style={{ fontSize: 14.5, color: GREEN }}>Closed · {item.checks}</span>
                  </div>
                </div>
                <span style={{ fontSize: 14.5, color: MUTED, flexShrink: 0 }}>{item.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
