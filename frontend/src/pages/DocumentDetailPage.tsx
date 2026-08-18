import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, Clock3, Eye, FileText, Info, Loader2, Pencil, Plus, Ship, X } from 'lucide-react';
import { documentApi } from '@/auth/api';
import type { DocumentDetailRecord, JsonValue } from '@/types/backend';
import { getDocConfig } from '@/config/docFieldConfig';
import type { FieldDef } from '@/config/docFieldConfig';
import { DOC_GEN_SCHEMAS } from '@/config/docGenConfig';
import type { DocGenSchema } from '@/config/docGenConfig';
import { DocBadge } from '@/components/vs/DocBadge';
import { useToast } from '@/hooks/use-toast';
import type { ContainerMappingResponse, ContainerMappingRow } from '@/types/backend';
import { apiGet, apiPatch, apiUrl, getAuthToken, readJsonResponse } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ShipmentDndInputsDialog } from '@/pages/ShipmentDetailPage';
import { useDocTypePermissions, usePermissions } from '@/contexts/PermissionContext';
import { usePageMeta } from '@/contexts/PageMetaContext';

const FG = 'hsl(var(--foreground))';
const MUTED = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const TEAL = 'hsl(173 58% 39%)';
const RED = 'hsl(0 84% 60%)';
const GREEN = 'hsl(152 69% 31%)';
const BLUE = 'hsl(221 83% 53%)';
const UPLOAD_PROCESS_ROUTE = '/documents/upload';
const PROCESSING_QUEUE_ROUTE = '/documents/upload/queue';
const UPLOAD_PROCESS_RETURN_PATH_KEY = 'ewms-upload-process-return-path';
const BOL_REFERENCE_ACTION_FIELDS = new Set(['mblNumber', 'bookingReferenceNumber']);

type PipelineStageState = 'done' | 'current' | 'current-spin' | 'future';
type ExtractionFieldFilter = 'all' | 'issues' | 'edited' | `section:${string}` | `array:${string}` | 'additional';

type DraftFieldValue = {
  targetField: string;
  value: string | number | boolean | null;
};

type CbpDraftPayload = {
  draftId: string;
  generatedDocType: 'ENTRY_SUMMARY';
  status: string;
  sourceDocumentIds?: Record<string, string | null | undefined> | null;
  sections?: Array<{ sectionLabel: string; fields: DraftFieldValue[] }> | null;
  lineItems?: Array<Record<string, unknown>> | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

type ShipmentOption = {
  id: string;
  shipmentNumber?: string | null;
  bolNumber?: string | null;
  hblNumber?: string | null;
  mblNumber?: string | null;
  bookingNumber?: string | null;
  projectName?: string | null;
};

type CbpComparisonField = {
  status: 'match' | 'mismatch' | 'blank' | string;
  cbpValue?: JsonValue | null;
  brokerValue?: JsonValue | null;
};

type CbpComparisonResponse = {
  ok: boolean;
  documentId: string;
  linkedDocumentId: string | null;
  linkedDocType: string | null;
  fields: Record<string, CbpComparisonField>;
  tables?: Record<string, {
    rows: Array<{
      rowIndex: number;
      lineNo?: string | null;
      status: 'match' | 'mismatch' | 'blank' | string;
      fields: Record<string, CbpComparisonField>;
    }>;
    summary: {
      total: number;
      mismatches: number;
      matches: number;
    };
  }>;
  summary: {
    total: number;
    mismatches: number;
    matches: number;
  };
};

const PIPELINE_LABELS = ['Upload', 'OCR extract', 'Field approval', 'Cross-validation', 'Complete'];

function DocumentPipeline({ states }: { states: PipelineStageState[] }) {
  return (
    <div style={{ marginBottom: 18, padding: '12px 14px', border: `1px solid ${BORDER}`, borderRadius: 8, backgroundColor: 'hsl(var(--card))' }}>
      <style>{`
        @keyframes doc-pipeline-pulse {
          0% { box-shadow: 0 0 0 0 hsla(173,58%,39%,0.28); }
          70% { box-shadow: 0 0 0 8px hsla(173,58%,39%,0); }
          100% { box-shadow: 0 0 0 0 hsla(173,58%,39%,0); }
        }
        @keyframes doc-pipeline-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.48; }
        }
        @keyframes doc-pipeline-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
        Pipeline
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
        {PIPELINE_LABELS.map((label, index) => {
          const state = states[index] ?? 'future';
          const isDone = state === 'done';
          const isCurrent = state === 'current' || state === 'current-spin';
          const markerColor = isDone ? GREEN : isCurrent ? TEAL : 'hsl(var(--muted-foreground) / 0.32)';
          const connectorColor = isDone ? GREEN : isCurrent ? TEAL : 'hsl(var(--border))';
          return (
            <Fragment key={label}>
              {index > 0 && (
                <span style={{ height: 2, flex: 1, minWidth: 24, marginTop: 12, backgroundColor: connectorColor, opacity: isDone ? 0.9 : 0.55 }} />
              )}
              <div style={{ minWidth: 0, position: 'relative', flexShrink: 0, textAlign: 'center', padding: '0 10px' }}>
                <span style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: `1px solid ${isCurrent ? TEAL : isDone ? GREEN : BORDER}`,
                  backgroundColor: isDone ? GREEN : isCurrent ? `${TEAL}12` : 'hsl(var(--background))',
                  color: isDone ? '#fff' : markerColor,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isCurrent ? `0 0 0 3px ${TEAL}14` : 'none',
                  animation: isCurrent ? 'doc-pipeline-pulse 1.45s ease-out infinite' : undefined,
                }}>
                  {isDone ? (
                    <CheckCircle2 size={15} />
                  ) : isCurrent ? (
                    state === 'current-spin'
                      ? <Clock3 size={14} style={{ color: TEAL, animation: 'doc-pipeline-spin 1.1s linear infinite' }} />
                      : <Circle size={10} fill={TEAL} strokeWidth={0} />
                  ) : (
                    <Circle size={9} />
                  )}
                </span>
                <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: isCurrent ? 800 : 600, color: isDone ? FG : isCurrent ? TEAL : 'hsl(var(--muted-foreground) / 0.50)', lineHeight: 1.25, whiteSpace: 'nowrap' }}>
                  {label}
                </div>
                <div style={{ marginTop: 2, fontSize: 11.5, color: isDone ? GREEN : isCurrent ? TEAL : MUTED, opacity: isDone || isCurrent ? 1 : 0.55 }}>
                  <span style={{ animation: isCurrent ? 'doc-pipeline-blink 1.2s ease-in-out infinite' : undefined }}>
                    {isDone ? 'Done' : isCurrent ? 'Current' : 'Pending'}
                  </span>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function documentPipelineStates(
  status: string | null | undefined,
  validationStatus?: string | null,
): PipelineStageState[] {
  const normalized = String(status ?? '').toUpperCase();
  const validation = String(validationStatus ?? '').toUpperCase();
  if (normalized === 'ARCHIVED') return ['done', 'done', 'done', 'done', 'done'];
  if (normalized === 'REVIEWED') {
    if (validation === 'PASSED' || validation === 'WARNING') return ['done', 'done', 'done', 'done', 'done'];
    if (validation === 'BLOCKED') return ['done', 'done', 'done', 'current', 'future'];
    return ['done', 'done', 'done', 'current', 'future'];
  }
  if (normalized === 'EXTRACTED') return ['done', 'done', 'current', 'future', 'future'];
  if (normalized === 'REJECTED') return ['done', 'current', 'future', 'future', 'future'];
  if (['QUEUED', 'PROCESSING', 'REPROCESSING'].includes(normalized)) return ['done', 'current-spin', 'future', 'future', 'future'];
  return ['current', 'future', 'future', 'future', 'future'];
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findExtractionValue(rawData: JsonValue | null | undefined, key: string): JsonValue | undefined {
  if (!isJsonRecord(rawData)) return undefined;
  if (rawData[key] !== undefined) return rawData[key];

  for (const value of Object.values(rawData)) {
    if (isJsonRecord(value) && value[key] !== undefined) return value[key];
  }

  return undefined;
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === '') return 'Field not in the file';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : 'Field not in the file';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fieldHasIssue(field: FieldDef, rawData: JsonValue | null | undefined, comparison?: CbpComparisonField): boolean {
  if (comparison?.status === 'mismatch') return true;
  if (field.optional) return false;
  return formatValue(findExtractionValue(rawData, field.key)) === 'Field not in the file';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function draftTimestamp(draft: CbpDraftPayload): number {
  const raw = draft.updatedAt ?? draft.createdAt ?? '';
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizedLink(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function draftFieldValues(draft: CbpDraftPayload | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const section of draft?.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (!field.targetField) continue;
      values[field.targetField] = field.value === null || field.value === undefined ? '' : String(field.value);
    }
  }
  return values;
}

function chooseCbpDraft(drafts: CbpDraftPayload[], documentId: string, rawData?: Record<string, JsonValue>): CbpDraftPayload | null {
  const sorted = [...drafts].sort((a, b) => draftTimestamp(b) - draftTimestamp(a));
  const linkedById = sorted.find((draft) => (
    Object.values(draft.sourceDocumentIds ?? {}).some((id) => String(id ?? '') === documentId)
  ));
  if (linkedById) return linkedById;

  const uploadedLinks = [
    rawData?.blOrAwbNumber,
    rawData?.bl_or_awb_number,
    rawData?.houseBill,
    rawData?.house_bill,
    rawData?.additionalBLs,
    rawData?.additional_bls,
    rawData?.brokerImporterFileNumber,
    rawData?.broker_importer_file_number,
  ].map(normalizedLink).filter(Boolean);
  if (uploadedLinks.length) {
    const linkedByBl = sorted.find((draft) => {
      const fields = draftFieldValues(draft);
      const draftLinks = [
        fields.blOrAwbNumber,
        fields.houseBill,
        fields.masterBol,
        fields.houseBol,
        fields.additionalBLs,
        ...(Object.values(draft.sourceDocumentIds ?? {}) as string[]),
      ].map(normalizedLink).filter(Boolean);
      return draftLinks.some((draftLink) => uploadedLinks.some((uploadedLink) => (
        draftLink === uploadedLink || draftLink.includes(uploadedLink) || uploadedLink.includes(draftLink)
      )));
    });
    if (linkedByBl) return linkedByBl;
  }

  return sorted[0] ?? null;
}

function draftManualValues(draft: CbpDraftPayload | null): Record<string, string> {
  return draftFieldValues(draft);
}

function draftRowMap(draft: CbpDraftPayload | null): Record<string, Record<string, string>[]> {
  const rows = (draft?.lineItems ?? []).map((row) => (
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)]))
  ));
  return rows.length ? { 'Tariff Lines': rows } : {};
}

function cbpTableComparisonRows(
  comparison: CbpComparisonResponse | null,
  tableName: string,
): NonNullable<CbpComparisonResponse['tables']>[string]['rows'] | undefined {
  const key = tableName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.includes('tariff')) return comparison?.tables?.tariffLines?.rows;
  if (key.includes('lineitem') || key === 'lineitems') return comparison?.tables?.lineItems?.rows;
  return undefined;
}

function SourceDocumentModal({
  title,
  previewUrl,
  isImage,
  comparisonTitle,
  comparison,
  onClose,
}: {
  title: string;
  previewUrl: string | null;
  isImage: boolean;
  comparisonTitle?: string;
  comparison?: React.ReactNode;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextBlobUrl: string | null = null;
    setBlobUrl(null);
    setPreviewError(null);

    if (!previewUrl || !isImage) return () => undefined;

    const headers: Record<string, string> = {};
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    fetch(previewUrl, { headers, credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `Preview failed (${response.status})`);
        }
        return response.blob();
      })
      .then((blob) => {
        nextBlobUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(nextBlobUrl);
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error instanceof Error && error.name === 'AbortError' ? 'Source preview timed out.' : error instanceof Error ? error.message : 'Preview failed');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
      if (nextBlobUrl) URL.revokeObjectURL(nextBlobUrl);
    };
  }, [previewUrl, isImage]);

  const previewContent = previewError ? (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED, fontSize: 13, padding: 18, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
      {previewError.includes('Not authenticated') ? 'Source preview session expired. Please sign in again.' : previewError}
    </div>
  ) : blobUrl ? (
    isImage ? (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <img src={blobUrl} alt={title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    ) : (
      <iframe title={title} src={blobUrl} style={{ width: '100%', height: '100%', border: 'none', backgroundColor: 'hsl(var(--card))' }} />
    )
  ) : previewUrl ? (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13 }}>
      Loading source preview...
    </div>
  ) : (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13 }}>
      No preview URL returned for this document.
    </div>
  );

  return (
    <div
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(15,23,42,0.58)', padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ width: comparison ? 'min(1540px, 96vw)' : 'min(1120px, 96vw)', height: 'min(860px, 92vh)', background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 22px 52px rgba(15,23,42,0.26)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <FileText size={17} style={{ color: TEAL }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            <div style={{ fontSize: 11, color: MUTED }}>Uploaded source document</div>
          </div>
          <button
            onClick={onClose}
            title="Close source document"
            style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, background: 'hsl(var(--muted) / 0.35)', padding: comparison ? 14 : 0 }}>
          {comparison ? (
            <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
              <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Source Document
                </div>
                <div style={{ flex: 1, minHeight: 0, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: 'hsl(var(--card))' }}>
                  {previewContent}
                </div>
              </div>
              <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {comparisonTitle ?? 'Extracted Fields'}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 14 }}>
                  {comparison}
                </div>
              </div>
            </div>
          ) : (
            previewContent
          )}
        </div>
      </div>
    </div>
  );
}

function AuthenticatedPreviewPane({
  title,
  previewUrl,
  isImage,
  height,
}: {
  title: string;
  previewUrl: string | null;
  isImage: boolean;
  height: number;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextBlobUrl: string | null = null;
    setBlobUrl(null);
    setPreviewError(null);

    if (!previewUrl) return () => undefined;

    const headers: Record<string, string> = {};
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    fetch(previewUrl, { headers, credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `Preview failed (${response.status})`);
        }
        return response.blob();
      })
      .then((blob) => {
        nextBlobUrl = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(nextBlobUrl);
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error instanceof Error && error.name === 'AbortError' ? 'Source preview timed out.' : error instanceof Error ? error.message : 'Preview failed');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
      if (nextBlobUrl) URL.revokeObjectURL(nextBlobUrl);
    };
  }, [previewUrl]);

  if (previewError) {
    return (
      <div style={{ height, border: `1px dashed ${BORDER}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED, fontSize: 12, padding: 18, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
        {previewError.includes('Not authenticated') ? 'Source preview session expired. Please sign in again.' : previewError}
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div style={{ height, border: `1px dashed ${BORDER}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>
        No preview URL returned for this document.
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div style={{ height, border: `1px dashed ${BORDER}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>
        Loading source preview...
      </div>
    );
  }

  return isImage ? (
    <div style={{ height, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', backgroundColor: 'hsl(220 14% 96%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={blobUrl} alt={title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  ) : (
    <iframe title={title} src={blobUrl} style={{ width: '100%', height, border: `1px solid ${BORDER}`, borderRadius: 8, backgroundColor: 'hsl(var(--card))' }} />
  );
}

function GeneratedDraftAlertStrip({ document }: { document: DocumentDetailRecord }) {
  const summary = document.validationSummary;
  const blockerCount = Number(summary?.blockingFailures ?? 0);
  const warningCount = Number(summary?.warnings ?? 0);
  const results = Array.isArray(document.validationResults) ? document.validationResults : [];
  const visible = results.filter((result) => {
    const status = String(result.status ?? '').toUpperCase();
    const level = String(result.alertLevel ?? '').toUpperCase();
    return status.includes('FAIL') || status.includes('BLOCK') || status.includes('WARN') || level.includes('BLOCK') || level.includes('WARN');
  }).slice(0, 3);

  if (!blockerCount && !warningCount && visible.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      {blockerCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 8, border: '1px solid hsla(0,84%,60%,0.28)', background: 'hsla(0,84%,60%,0.08)', color: RED, fontSize: 12 }}>
          <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <div><strong>{blockerCount} blocker{blockerCount === 1 ? '' : 's'}</strong> need attention before this generated draft can pass validation.</div>
        </div>
      )}
      {warningCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 8, border: '1px solid hsla(38,92%,50%,0.34)', background: 'hsla(38,92%,50%,0.10)', color: 'hsl(38 92% 36%)', fontSize: 12 }}>
          <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <div><strong>{warningCount} warning{warningCount === 1 ? '' : 's'}</strong> found during cross-validation.</div>
        </div>
      )}
      {visible.map((result, index) => (
        <div key={`${result.ruleCode ?? 'rule'}-${index}`} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'hsl(var(--card))', fontSize: 11.5, color: FG }}>
          <strong>{result.ruleCode ?? result.description ?? 'Validation alert'}</strong>
          {result.description && result.ruleCode ? ` · ${result.description}` : ''}
        </div>
      ))}
    </div>
  );
}

function GeneratedDraftFieldStage({
  schema,
  draft,
  manualValues,
  rowMap,
  document,
  loading,
  saving,
  onFieldChange,
  onFieldSave,
  onRowChange,
  onRowSave,
}: {
  schema: DocGenSchema;
  draft: CbpDraftPayload | null;
  manualValues: Record<string, string>;
  rowMap: Record<string, Record<string, string>[]>;
  document: DocumentDetailRecord;
  loading: boolean;
  saving: boolean;
  onFieldChange: (field: string, value: string) => void;
  onFieldSave: () => void;
  onRowChange: (sectionLabel: string, rowIndex: number, field: string, value: string) => void;
  onRowSave: () => void;
}) {
  const allMappings = schema.sections.flatMap((section) => section.mappings);
  const manualMappings = allMappings.filter((mapping) => mapping.mappingType === 'manual' || mapping.mappingType === 'conditional');
  const missingManual = manualMappings.filter((mapping) => !String(manualValues[mapping.targetField] ?? schema.mockData.fields[mapping.targetField] ?? '').trim());
  const filledManual = manualMappings.length - missingManual.length;
  const fieldsDone = allMappings.filter((mapping) => String(manualValues[mapping.targetField] ?? schema.mockData.fields[mapping.targetField] ?? '').trim()).length;
  const createdText = draft?.createdAt ? formatDateTime(draft.createdAt) : 'not created yet';

  const valueFor = (field: string) => manualValues[field] ?? schema.mockData.fields[field] ?? '';
  const tableRows = (sectionLabel: string) => {
    const rows = rowMap[sectionLabel];
    if (rows?.length) return rows;
    return (schema.mockData.tables[sectionLabel] ?? []) as Record<string, string>[];
  };

  return (
    <section style={{ minWidth: 0, border: `1px solid ${BORDER}`, borderRadius: 8, background: 'hsl(var(--card))', overflow: 'hidden' }}>
      <div style={{ padding: 14 }}>
        <GeneratedDraftAlertStrip document={document} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'hsl(204 94% 94%)', border: '1px solid hsl(204 94% 78%)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: FG, marginBottom: 14 }}>
          <Info size={13} style={{ flexShrink: 0, color: BLUE }} />
          <span>
            Trigger: <strong>{schema.triggerCondition}</strong>
            {' · '}
            <strong>{schema.fieldCounts.auto + schema.fieldCounts.calculated}/{schema.fieldCounts.total}</strong> fields auto-populated
            {' · '}
            <strong style={{ color: MUTED }}>{schema.fieldCounts.manual} manual fields</strong> need your input
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>
            {saving ? 'Saving...' : loading ? 'Loading draft...' : `Draft v1 · Created ${createdText}`}
          </span>
        </div>

        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: 'hsl(var(--card))', padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: FG, fontSize: 14, fontWeight: 800 }}>
              <AlertTriangle size={16} style={{ color: RED }} />
              {missingManual.length} input{missingManual.length === 1 ? '' : 's'} need your attention
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>{filledManual}/{manualMappings.length} filled</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {manualMappings.slice(0, 12).map((mapping) => {
              const value = valueFor(mapping.targetField);
              const empty = !String(value).trim();
              return (
                <div key={mapping.targetField}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
                    {mapping.targetLabel} {empty ? '*' : ''}
                  </div>
                  <input
                    value={value}
                    onChange={(event) => onFieldChange(mapping.targetField, event.target.value)}
                    onBlur={onFieldSave}
                    placeholder="Enter value..."
                    style={{ height: 40, width: '100%', padding: '0 12px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'hsl(var(--background))', color: FG, fontSize: 13, fontWeight: 600, outline: 'none' }}
                  />
                  {empty && <div style={{ marginTop: 4, fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Manual input required</div>}
                </div>
              );
            })}
          </div>
        </div>

        {schema.sections.map((section) => (
          <div key={section.sectionLabel} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, background: 'hsl(var(--background))', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: FG, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{section.sectionLabel}</div>
            </div>
            {section.renderAs === 'fields' ? (
              <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {section.mappings.map((mapping) => {
                  const value = valueFor(mapping.targetField);
                  const empty = !String(value).trim();
                  return (
                    <div key={mapping.targetField} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '9px 11px', background: empty ? 'hsla(0,84%,60%,0.035)' : 'hsl(var(--card))' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{mapping.targetLabel}</div>
                      <input
                        value={value}
                        onChange={(event) => onFieldChange(mapping.targetField, event.target.value)}
                        onBlur={onFieldSave}
                        placeholder="Enter value..."
                        title={value || 'Field not in the file'}
                        style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, color: FG, fontWeight: 600, padding: 0 }}
                      />
                      <div style={{ marginTop: 6, fontSize: 10, color: MUTED }}>{mapping.mappingType === 'manual' ? 'Manual input required' : mapping.sourceLabel}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ overflow: 'auto' }}>
                <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {section.mappings.map((mapping) => (
                        <th key={mapping.targetField} style={{ padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {mapping.targetLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows(section.sectionLabel).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {section.mappings.map((mapping) => {
                          const value = String(row[mapping.targetField] ?? '');
                          return (
                            <td key={mapping.targetField} style={{ padding: '9px 10px', borderTop: rowIndex === 0 ? 'none' : `1px solid ${BORDER}`, fontSize: 12, color: value ? FG : RED, fontStyle: value ? 'normal' : 'italic' }}>
                              <input
                                value={value}
                                onChange={(event) => onRowChange(section.sectionLabel, rowIndex, mapping.targetField, event.target.value)}
                                onBlur={onRowSave}
                                placeholder="Enter value..."
                                style={{ width: '100%', minWidth: 110, border: 'none', background: 'transparent', outline: 'none', color: FG, fontSize: 12, fontWeight: 600 }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${BORDER}`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'hsl(var(--card))' }}>
        <div style={{ width: 68, height: 5, borderRadius: 99, background: 'hsl(var(--muted))', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, Math.round((fieldsDone / Math.max(1, allMappings.length)) * 100))}%`, height: '100%', background: TEAL }} />
        </div>
        <span style={{ fontSize: 12, color: MUTED }}><strong style={{ color: FG }}>{fieldsDone}</strong>/{allMappings.length} fields</span>
        <span style={{ fontSize: 12, color: MUTED }}>Validations: <strong style={{ color: GREEN }}>{Number(document.validationSummary?.passed ?? 0)}/{Number(document.validationSummary?.total ?? 0)}</strong></span>
      </div>
    </section>
  );
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown; message?: unknown } } }).response;
    const detail = response?.data?.detail;
    const message = response?.data?.message;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map(item => (
      typeof item === 'string' ? item : JSON.stringify(item)
    )).join(', ');
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : fallback;
}

function docCode(docType: string) {
  const config = getDocConfig(docType);
  if (config?.shortCode) return config.shortCode;
  if (docType === 'BILL_OF_LADING') return 'BL';
  return docType.split('_').map((part) => part[0]).join('').slice(0, 2);
}

type WarehouseOption = {
  id: string;
  name: string;
  address?: string | null;
  firmsCode?: string | null;
  locationType?: string | null;
};

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeWarehouseOptions(rows: any[]): WarehouseOption[] {
  const seen = new Set<string>();
  return rows
    .filter((row: any) => row?.id && row?.name && row.name !== 'All warehouses' && row.isActive !== false)
    .map((row: any) => ({
      id: String(row.id),
      name: String(row.name),
      address: row.address ?? null,
      firmsCode: row.firmsCode ?? row.firms_code ?? null,
      locationType: row.locationType ?? row.location_type ?? null,
    }))
    .filter((row: WarehouseOption) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
}

async function loadSettingsWarehouses(): Promise<WarehouseOption[]> {
  try {
    const adminRes = await fetch(apiUrl('/api/admin/warehouses'), { headers: authHeaders() }).then(readJsonResponse);
    const adminRows = Array.isArray((adminRes as any).data) ? (adminRes as any).data : [];
    const options = normalizeWarehouseOptions(adminRows);
    if (options.length) return options;
  } catch {
    // Fall back to inventory read endpoints for non-admin contexts.
  }
  const [warehouseRes, portRes] = await Promise.all([
    fetch(apiUrl('/api/inventory/warehouses'), { headers: authHeaders() }).then(readJsonResponse).catch(() => ({ data: [] })),
    fetch(apiUrl('/api/inventory/port-warehouses'), { headers: authHeaders() }).then(readJsonResponse).catch(() => ({ data: [] })),
  ]);
  return normalizeWarehouseOptions([
    ...(Array.isArray((warehouseRes as any).data) ? (warehouseRes as any).data : []),
    ...(Array.isArray((portRes as any).data) ? (portRes as any).data : []),
  ]);
}

function labelFromKey(key: string): string {
  if (key === 'goodsDescriptionItems') return 'Goods Description Line Items';
  return key
    .replace(/\[\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function FieldCard({ field, rawData, comparison, isEdited = false, onSave, onDraftChange }: {
  field: FieldDef;
  rawData: JsonValue | null | undefined;
  comparison?: CbpComparisonField;
  isEdited?: boolean;
  onSave?: (key: string, value: string | null) => Promise<void>;
  onDraftChange?: (key: string, value: string | null) => void;
}) {
  const formattedValue = formatValue(findExtractionValue(rawData, field.key));
  const extractedValue = field.manual && formattedValue === 'Field not in the file' ? 'Enter value' : formattedValue;
  const [isEditing, setIsEditing] = useState(false);
  const [amendedValue, setAmendedValue] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');

  useEffect(() => {
    setIsEditing(false);
    setAmendedValue(null);
    setDraftValue(['Field not in the file', 'Enter value'].includes(extractedValue) ? '' : extractedValue);
  }, [field.key, extractedValue]);

  const displayValue = amendedValue ?? extractedValue;
  const isEmpty = displayValue === 'Field not in the file';
  const isOptionalEmpty = isEmpty && field.optional;
  const isManualEmpty = field.manual && displayValue === 'Enter value';
  const isAmended = amendedValue !== null || isEdited;
  const isMismatch = comparison?.status === 'mismatch';
  const isCompared = Boolean(comparison);
  const isMatched = comparison?.status === 'match';

  function startEdit() {
    setDraftValue(['Field not in the file', 'Enter value'].includes(displayValue) ? '' : displayValue);
    setIsEditing(true);
  }

  async function saveEdit() {
    const value = draftValue.trim() || null;
    setAmendedValue(value ?? (field.manual ? 'Enter value' : 'Field not in the file'));
    setIsEditing(false);
    await onSave?.(field.key, value);
  }

  return (
    <div
      style={{
        border: `1px solid ${isMismatch ? 'hsla(0,84%,60%,0.42)' : isEmpty && !isOptionalEmpty ? 'hsla(0,84%,60%,0.20)' : isManualEmpty ? `${GREEN}55` : BORDER}`,
        borderRadius: 8,
        padding: '9px 11px',
        backgroundColor: isMismatch ? 'hsla(0,84%,60%,0.07)' : isEmpty && !isOptionalEmpty ? 'hsla(0,84%,60%,0.035)' : isManualEmpty ? `${GREEN}08` : 'hsl(var(--card))',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {field.label}
        </div>
        {isAmended && (
          <span style={{ fontSize: 9, fontWeight: 700, color: BLUE, backgroundColor: `${BLUE}14`, borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>
            edited
          </span>
        )}
        {isCompared && (
          <span style={{ fontSize: 9, fontWeight: 800, color: isMismatch ? RED : isMatched ? GREEN : MUTED, backgroundColor: isMismatch ? 'hsla(0,84%,60%,0.10)' : isMatched ? `${GREEN}12` : 'hsl(var(--muted) / 0.45)', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>
            {isMismatch ? 'mismatch' : isMatched ? 'match' : 'blank'}
          </span>
        )}
        {!isEditing && (
          onSave ? (
            <button
              onClick={startEdit}
              title={`Edit ${field.label}`}
              style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >
              <Pencil size={12} />
            </button>
          ) : null
        )}
      </div>
      {isEditing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <input
            autoFocus
            value={draftValue}
            onChange={(event) => {
              const value = event.target.value;
              setDraftValue(value);
              onDraftChange?.(field.key, value.trim() || null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveEdit();
              if (event.key === 'Escape') setIsEditing(false);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              border: `1.5px solid ${BLUE}`,
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 12.5,
              color: FG,
              backgroundColor: 'hsl(var(--background))',
              outline: 'none',
              fontFamily: field.mono ? 'var(--font-mono, monospace)' : undefined,
            }}
          />
          <button
            onClick={() => void saveEdit()}
            title="Save field"
            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', backgroundColor: BLUE, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => setIsEditing(false)}
            title="Cancel edit"
            style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${BORDER}`, backgroundColor: 'transparent', color: MUTED, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          className={field.mono ? 'vs-mono' : undefined}
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: isMismatch || (isEmpty && !isOptionalEmpty) ? RED : isManualEmpty ? GREEN : isOptionalEmpty ? MUTED : FG,
            fontStyle: isEmpty || isManualEmpty ? 'italic' : 'normal',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
          }}
        >
          {isOptionalEmpty ? '—' : displayValue}
        </div>
      )}
      {isAmended && extractedValue !== displayValue && (
        <div style={{ marginTop: 5, fontSize: 10.5, color: MUTED, whiteSpace: 'normal', wordBreak: 'break-word' }}>
          Original: {extractedValue}
        </div>
      )}
      {isMismatch && (
        <div style={{ marginTop: 5, fontSize: 10.5, color: RED, fontWeight: 700, whiteSpace: 'normal', wordBreak: 'break-word' }}>
          Broker value: {formatValue(comparison?.brokerValue)}
        </div>
      )}
    </div>
  );
}

function BolSafeCubeInputsDialog({
  fields,
  rawData,
  saving,
  onClose,
  onSave,
}: {
  fields: FieldDef[];
  rawData: JsonValue | null | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, string | null>) => Promise<void>;
}) {
  const initialValues = useMemo(() => Object.fromEntries(fields.map((field) => {
    const formattedValue = formatValue(findExtractionValue(rawData, field.key));
    return [field.key, ['Field not in the file', 'Enter value'].includes(formattedValue) ? '' : formattedValue];
  })), [fields, rawData]);
  const [draftValues, setDraftValues] = useState<Record<string, string>>(initialValues);

  useEffect(() => {
    setDraftValues(initialValues);
  }, [initialValues]);

  async function saveEdit() {
    await onSave(Object.fromEntries(Object.entries(draftValues).map(([key, value]) => [key, value.trim() || null])));
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'hsla(220,20%,10%,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(520px, 94vw)', background: 'hsl(var(--background))', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 24px 70px hsla(220,20%,10%,0.3)' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750, color: FG }}>MBL/BR No.</div>
            <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>Enter either MBL No or Booking Ref No for tracking.</div>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 12 }}>
          {fields.map((field, index) => (
            <label key={field.key} style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 750, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{field.label}</span>
              <input
                autoFocus={index === 0}
                value={draftValues[field.key] ?? ''}
                onChange={(event) => setDraftValues((current) => ({ ...current, [field.key]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveEdit();
                  if (event.key === 'Escape') onClose();
                }}
                className={field.mono ? 'vs-mono' : undefined}
                style={{ width: '100%', border: `1.5px solid ${BORDER}`, borderRadius: 8, background: 'hsl(var(--card))', color: FG, fontSize: 14, padding: '9px 11px', outline: 'none' }}
              />
            </label>
          ))}
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void saveEdit()}>
            {saving ? <Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite', marginRight: 6 }} /> : null}
            Save Inputs
          </Button>
        </div>
      </div>
    </div>
  );
}

function LineItemsTable({
  rows,
  title = 'Line Items',
  comparisonRows,
  editable = true,
  onSave,
  onDraftChange,
}: {
  rows: Array<Record<string, JsonValue>>;
  title?: string;
  comparisonRows?: NonNullable<CbpComparisonResponse['tables']>[string]['rows'];
  editable?: boolean;
  onSave?: (rows: Array<Record<string, JsonValue>>) => Promise<void>;
  onDraftChange?: (rows: Array<Record<string, JsonValue>>) => void;
}) {
  const [draftRows, setDraftRows] = useState(rows);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftRows(rows);
  }, [rows]);

  const columns = useMemo(
    () => Array.from(draftRows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>())),
    [draftRows],
  );

  if (!draftRows.length || !columns.length) return null;

  async function saveRows() {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      await onSave(draftRows);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {labelFromKey(title)}
        {saving && <span style={{ marginLeft: 8, color: BLUE, textTransform: 'none' }}>Saving…</span>}
      </div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'auto', backgroundColor: 'hsl(var(--card))' }}>
        <table style={{ width: '100%', minWidth: Math.max(600, columns.length * 140), borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ backgroundColor: 'hsl(var(--muted) / 0.45)' }}>
              <th className="vs-mono" style={{ width: 44, padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left' }}>#</th>
              {columns.map((column) => (
                <th key={column} style={{ width: column === 'itemIndex' ? 90 : undefined, padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {labelFromKey(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draftRows.map((row, index) => (
              <tr key={index}>
                <td className="vs-mono" style={{ padding: '9px 10px', borderTop: index === 0 ? 'none' : `1px solid ${BORDER}`, fontSize: 11, color: MUTED }}>{index + 1}</td>
                {columns.map((column) => {
                  const displayValue = formatValue(row[column]);
                  const isEmpty = displayValue === 'Field not in the file';
                  const comparison = comparisonRows?.[index]?.fields?.[column];
                  const isMismatch = comparison?.status === 'mismatch';
                  return (
                    <td key={column} style={{ minWidth: column === 'itemIndex' ? 90 : 130, padding: '7px 8px', borderTop: index === 0 ? 'none' : `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 12, color: isMismatch || isEmpty ? RED : FG, fontStyle: isEmpty ? 'italic' : 'normal', verticalAlign: 'top', background: isMismatch ? 'hsla(0,84%,60%,0.07)' : undefined }}>
                      {editable ? (
                        <textarea
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${el.scrollHeight}px`;
                            }
                          }}
                          value={isEmpty ? '' : displayValue}
                          placeholder="Field not in the file"
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraftRows((current) => {
                              const nextRows = current.map((currentRow, rowIndex) => (
                                rowIndex === index ? { ...currentRow, [column]: value } : currentRow
                              ));
                              onDraftChange?.(nextRows);
                              return nextRows;
                            });
                          }}
                          onInput={(event) => {
                            const el = event.currentTarget;
                            el.style.height = 'auto';
                            el.style.height = `${el.scrollHeight}px`;
                          }}
                          onBlur={() => void saveRows()}
                          style={{
                            width: '100%', minWidth: column === 'itemIndex' ? 60 : 110, minHeight: 46, resize: 'none', overflow: 'hidden',
                            border: `1px solid ${isMismatch ? 'hsla(0,84%,60%,0.50)' : isEmpty ? `${RED}45` : BORDER}`,
                            borderRadius: 5, padding: '6px 7px', boxSizing: 'border-box',
                            backgroundColor: 'hsl(var(--background))', color: FG,
                            fontSize: 12, lineHeight: 1.35, whiteSpace: 'pre-wrap',
                          }}
                        />
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.4 }}>
                          {displayValue}
                        </div>
                      )}
                      {isMismatch && (
                        <div style={{ marginTop: 5, color: RED, fontSize: 10.5, fontWeight: 700, overflowWrap: 'anywhere' }}>
                          Broker value: {formatValue(comparison?.brokerValue)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BolContainerMappingModal({
  mapping,
  loading,
  saving,
  approved,
  onClose,
  onSave,
  onPageChange,
  unmappedOnly,
  onUnmappedFilterChange,
}: {
  mapping: ContainerMappingResponse | null;
  loading: boolean;
  saving: boolean;
  approved: boolean;
  onClose: () => void;
  onSave: (rows: ContainerMappingRow[]) => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
  unmappedOnly: boolean;
  onUnmappedFilterChange: (enabled: boolean) => Promise<void>;
}) {
  const [rows, setRows] = useState<ContainerMappingRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const containers = new Set(mapping?.containers ?? []);
    setRows((mapping?.rows ?? []).map(row => ({
      ...row,
      containerNo: edits[row.lineItemId] ?? (row.containerNo && containers.has(row.containerNo) ? row.containerNo : null),
    })));
  }, [mapping, edits]);
  const numericValue = (value: string | null | undefined) => {
    const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatInputValue = (value: string | null | undefined) => String(value ?? '');
  const formatMaybeNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  const rowSourceKey = (row: ContainerMappingRow, index: number) => (
    String(row._sourceLineKey || [
      row.packingListDocumentId,
      row.invoiceNumber,
      row.productCode,
      row.containerNo,
      row.lineItemId.includes(':split:') ? row.lineItemId.split(':split:')[0] : row.lineItemId || index,
    ].map(value => String(value ?? '').trim().toUpperCase()).join('|'))
  );
  const withSourceTotals = (row: ContainerMappingRow, index: number): ContainerMappingRow => ({
    ...row,
    _sourceLineKey: rowSourceKey(row, index),
    _sourceTotalQtyInPcs: row._sourceTotalQtyInPcs ?? row.totalQtyInPcs,
    _sourceTotalBundles: row._sourceTotalBundles ?? row.totalBundles,
    _sourceNetWeightKgs: row._sourceNetWeightKgs ?? row.netWeightKgs,
    _sourceGrossWeightKgs: row._sourceGrossWeightKgs ?? row.grossWeightKgs,
  });
  const splitFields = [
    { key: 'totalQtyInPcs', sourceKey: '_sourceTotalQtyInPcs', label: 'quantity' },
    { key: 'totalBundles', sourceKey: '_sourceTotalBundles', label: 'bundles' },
    { key: 'netWeightKgs', sourceKey: '_sourceNetWeightKgs', label: 'net weight' },
    { key: 'grossWeightKgs', sourceKey: '_sourceGrossWeightKgs', label: 'gross weight' },
  ] as const;
  const updateRowValue = (rowIndex: number, key: keyof ContainerMappingRow, value: string | null) => {
    setRows(current => current.map((row, index) => {
      if (index !== rowIndex) return row;
      const next = { ...row, [key]: value };
      if (key === 'totalQtyInPcs' || key === 'totalBundles') {
        const qty = numericValue(key === 'totalQtyInPcs' ? value : next.totalQtyInPcs);
        const bundles = numericValue(key === 'totalBundles' ? value : next.totalBundles);
        next.qtyPerBundle = qty > 0 && bundles > 0 ? formatMaybeNumber(qty / bundles) : null;
      }
      return next;
    }));
  };
  const addSplitRow = (rowIndex: number) => {
    setRows(current => {
      const source = current[rowIndex];
      if (!source) return current;
      const base = withSourceTotals(source, rowIndex);
      const splitRow: ContainerMappingRow = {
        ...base,
        lineItemId: `${base.lineItemId}:split:${Date.now()}`,
        totalQtyInPcs: null,
        totalBundles: null,
        qtyPerBundle: null,
        netWeightKgs: null,
        grossWeightKgs: null,
        _splitRow: true,
      };
      const next = current.map((row, index) => index === rowIndex ? base : row);
      next.splice(rowIndex + 1, 0, splitRow);
      return next;
    });
  };
  const splitIssues = (() => {
    const grouped = new Map<string, Array<ContainerMappingRow>>();
    rows.forEach((row, index) => {
      const key = rowSourceKey(row, index);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    });
    const issues: string[] = [];
    grouped.forEach((group) => {
      if (group.length <= 1) return;
      const source = group.find(row => String(row._splitRow ?? '').toLowerCase() !== 'true') ?? group[0];
      const label = source.productCode || source.description || 'line item';
      for (const field of splitFields) {
        const sourceTotal = numericValue((source as Record<string, unknown>)[field.sourceKey] as string | null | undefined ?? (source as Record<string, unknown>)[field.key] as string | null | undefined);
        if (!sourceTotal) continue;
        const splitTotal = group.reduce((sum, row) => sum + numericValue((row as Record<string, unknown>)[field.key] as string | null | undefined), 0);
        if (Math.abs(splitTotal - sourceTotal) > 0.01) {
          issues.push(`${label}: ${field.label} split total ${formatMaybeNumber(splitTotal)} must equal Packing List ${formatMaybeNumber(sourceTotal)}`);
        }
      }
    });
    return issues;
  })();
  const totals = {
    totalQtyInPcs: rows.reduce((sum, row) => sum + numericValue(row.totalQtyInPcs), 0),
    totalBundles: rows.reduce((sum, row) => sum + numericValue(row.totalBundles), 0),
    netWeightKgs: rows.reduce((sum, row) => sum + numericValue(row.netWeightKgs), 0),
    grossWeightKgs: rows.reduce((sum, row) => sum + numericValue(row.grossWeightKgs), 0),
  };
  const formatTotal = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  const pagination = mapping?.pagination;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'hsla(220,20%,10%,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`
        @keyframes ewms-ship-sail {
          0% { transform: translateX(8px) translateY(1px) rotate(-2deg); }
          50% { transform: translateX(145px) translateY(-3px) rotate(1deg); }
          100% { transform: translateX(285px) translateY(1px) rotate(-2deg); }
        }
        @keyframes ewms-wave {
          0% { transform: translateX(-18px); }
          100% { transform: translateX(18px); }
        }
        @keyframes ewms-cloud {
          0% { transform: translateX(-20px); opacity: 0.3; }
          100% { transform: translateX(25px); opacity: 0.75; }
        }
      `}</style>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(1500px, 96vw)', maxHeight: '88vh', background: 'hsl(var(--background))', border: `1px solid ${BORDER}`, borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750, color: FG }}>Container Mapping</div>
            <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>BOL invoices: {mapping?.invoiceNumbers.join(', ') || 'None'} · Matching Packing Lists: {mapping?.matchedPackingLists ?? 0}</div>
            <button
              onClick={() => void onUnmappedFilterChange(!unmappedOnly)}
              style={{ marginTop: 10, padding: '6px 11px', borderRadius: 999, border: `1px solid ${unmappedOnly ? TEAL : BORDER}`, background: unmappedOnly ? `${TEAL}18` : 'transparent', color: unmappedOnly ? TEAL : FG, fontSize: 11.5, fontWeight: 750, cursor: 'pointer' }}
            >
              Containers unmapped ({mapping?.unmappedCount ?? 0})
            </button>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '46px 40px 54px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 360, height: 112, position: 'relative', overflow: 'hidden', borderRadius: 8, background: 'linear-gradient(180deg, hsl(195 90% 96%) 0%, hsl(190 70% 92%) 58%, hsl(188 62% 78%) 59%, hsl(190 70% 88%) 100%)', border: `1px solid ${TEAL}25` }}>
                <div style={{ position: 'absolute', top: 12, left: 35, color: '#fff', fontSize: 22, animation: 'ewms-cloud 2.4s ease-in-out infinite alternate' }}>☁</div>
                <div style={{ position: 'absolute', top: 4, right: 48, color: '#fff', fontSize: 17, animation: 'ewms-cloud 1.9s ease-in-out infinite alternate-reverse' }}>☁</div>
                <div style={{ position: 'absolute', left: 10, top: 57, animation: 'ewms-ship-sail 3.2s linear infinite', color: TEAL, display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
                  <div style={{ padding: '2px 7px', borderRadius: 999, background: '#fff', boxShadow: `0 2px 7px ${TEAL}35`, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Ship size={29} strokeWidth={2} />
                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.08em' }}>EWMS</span>
                  </div>
                </div>
                <div style={{ position: 'absolute', left: -20, right: -20, bottom: 19, height: 8, background: `repeating-radial-gradient(ellipse at center, ${TEAL}70 0 5px, transparent 6px 13px)`, animation: 'ewms-wave 1.1s linear infinite' }} />
                <span style={{ position: 'absolute', left: 14, bottom: 5, fontSize: 9, fontWeight: 800, color: TEAL }}>INDIA</span>
                <span style={{ position: 'absolute', right: 16, bottom: 5, fontSize: 9, fontWeight: 800, color: TEAL }}>USA</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: TEAL, letterSpacing: '0.04em' }}>EWMS CONTAINER MAPPING</div>
            </div>
          )
            : !mapping?.rows.length ? <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>{unmappedOnly ? 'All container rows are mapped.' : 'No Packing Lists matched this BOL’s invoice numbers.'}</div>
            : (
              <table style={{ width: '100%', minWidth: 1280, borderCollapse: 'collapse' }}>
                <thead><tr>{['', 'Container no', 'Product code', 'Description', 'Specification', 'TOTAL QTY IN PCS', 'Qty per bundle', 'Total bundle', 'Net weight (kg)', 'Gross weight (kg)'].map(label => <th key={label || 'split'} style={{ padding: 10, border: `1px solid ${BORDER}`, textAlign: 'left', fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={row.lineItemId}>
                    <td style={{ padding: 6, border: `1px solid ${BORDER}`, width: 44 }}>
                      <button
                        type="button"
                        disabled={approved}
                        onClick={() => addSplitRow(index)}
                        title="Add split row from Packing List line"
                        style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'hsl(var(--card))', color: TEAL, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: approved ? 'default' : 'pointer', opacity: approved ? 0.45 : 1 }}
                      >
                        <Plus size={14} />
                      </button>
                    </td>
                    <td style={{ padding: 8, border: `1px solid ${BORDER}` }}>
                      <select value={row.containerNo ?? ''} onChange={event => {
                        const containerNo = event.target.value || null;
                        setEdits(current => ({ ...current, [row.lineItemId]: containerNo }));
                        setRows(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, containerNo } : item));
                      }} style={{ width: '100%', padding: 7, border: `1px solid ${row.containerNo ? BORDER : 'hsl(38 92% 50%)'}`, borderRadius: 5, background: 'hsl(var(--background))', color: FG }}>
                        <option value="">Select container</option>
                        {mapping.containers.map(container => <option key={container} value={container}>{container}</option>)}
                      </select>
                    </td>
                    {[row.productCode, row.description, row.specification].map((value, cellIndex) => <td key={cellIndex} style={{ padding: 9, border: `1px solid ${BORDER}`, fontSize: 12, color: FG }}>{value || '—'}</td>)}
                    {([
                      ['totalQtyInPcs', row.totalQtyInPcs],
                      ['qtyPerBundle', row.qtyPerBundle],
                      ['totalBundles', row.totalBundles],
                      ['netWeightKgs', row.netWeightKgs],
                      ['grossWeightKgs', row.grossWeightKgs],
                    ] as Array<[keyof ContainerMappingRow, string | null]>).map(([key, value]) => (
                      <td key={key} style={{ padding: 0, border: `1px solid ${BORDER}`, fontSize: 12, color: FG }}>
                        {key === 'qtyPerBundle' ? (
                          <div style={{ position: 'relative', padding: '7px 42px 3px 10px', minHeight: 34, fontWeight: 700 }}>
                            {value || 'Auto'}
                            {value && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 9, fontWeight: 800, color: TEAL, background: `${TEAL}18`, borderRadius: 999, padding: '1px 6px' }}>auto</span>}
                            {row.totalQtyInPcs && row.totalBundles && (
                              <div style={{ marginTop: 2, fontSize: 10.5, color: MUTED, fontWeight: 650, whiteSpace: 'nowrap' }}>
                                {row.totalQtyInPcs} / {row.totalBundles} = {value || 'Auto'}
                              </div>
                            )}
                          </div>
                        ) : (
                          <input
                            value={formatInputValue(value)}
                            disabled={approved}
                            onChange={event => updateRowValue(index, key, event.target.value || null)}
                            placeholder="Enter..."
                            style={{ width: '100%', minWidth: 95, border: 'none', outline: 'none', background: 'transparent', color: FG, padding: '9px 10px', fontSize: 12, fontWeight: 700 }}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
                <tfoot>
                  <tr style={{ background: 'hsl(var(--muted) / 0.45)', fontWeight: 750 }}>
                    <td colSpan={5} style={{ padding: 10, border: `1px solid ${BORDER}`, color: FG }}>TOTAL</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.totalQtyInPcs ?? 0)}</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>—</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.totalBundles ?? 0)}</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.netWeightKgs ?? 0)}</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.grossWeightKgs ?? 0)}</td>
                  </tr>
                  {splitIssues.length > 0 && (
                    <tr>
                      <td colSpan={10} style={{ padding: 10, border: `1px solid ${BORDER}`, background: 'hsla(0,84%,60%,0.06)', color: RED, fontSize: 12, fontWeight: 700 }}>
                        {splitIssues.slice(0, 3).map(issue => <div key={issue}>{issue}</div>)}
                        {splitIssues.length > 3 && <div>{splitIssues.length - 3} more split issue{splitIssues.length - 3 === 1 ? '' : 's'}.</div>}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            )}
        </div>
        {pagination && pagination.totalPages > 1 && (
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: MUTED, fontSize: 12 }}>
            <span>Showing {(pagination.page - 1) * pagination.pageSize + 1}-{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button disabled={!pagination.hasPreviousPage || loading} onClick={() => void onPageChange(pagination.page - 1)} style={{ padding: '6px 10px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent', color: FG, cursor: pagination.hasPreviousPage ? 'pointer' : 'default', opacity: pagination.hasPreviousPage ? 1 : 0.45 }}>Previous</button>
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <button disabled={!pagination.hasNextPage || loading} onClick={() => void onPageChange(pagination.page + 1)} style={{ padding: '6px 10px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent', color: FG, cursor: pagination.hasNextPage ? 'pointer' : 'default', opacity: pagination.hasNextPage ? 1 : 0.45 }}>Next</button>
            </div>
          </div>
        )}
        <div style={{ padding: 12, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>Cancel</button>
          <button
            disabled={approved || !mapping?.pagination.total || saving || splitIssues.length > 0}
            onClick={() => void onSave(rows)}
            style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: TEAL, color: '#fff', fontWeight: 700, cursor: approved || saving || splitIssues.length > 0 ? 'default' : 'pointer', opacity: approved || mapping?.pagination.total ? (splitIssues.length > 0 ? 0.55 : 1) : 0.5 }}
          >
            {approved ? 'Already approved' : saving ? 'Approving mapping...' : 'Save & approve mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WarehouseMappingModal({
  shipmentId,
  warehouses,
  selectedWarehouseId,
  loading,
  saving,
  onSelectedWarehouseChange,
  onClose,
  onSave,
}: {
  shipmentId: string;
  warehouses: WarehouseOption[];
  selectedWarehouseId: string;
  loading: boolean;
  saving: boolean;
  onSelectedWarehouseChange: (warehouseId: string) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'hsla(220,20%,10%,0.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(820px, 94vw)', maxHeight: '82vh', background: 'hsl(var(--background))', border: `1px solid ${BORDER}`, borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750, color: FG }}>Warehouse Mapping</div>
            <div style={{ marginTop: 4, fontSize: 12, color: MUTED }}>Map this cargo release shipment to one warehouse from Settings.</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 36, textAlign: 'center', color: MUTED }}>Loading warehouse mapping...</div>
          ) : (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.4fr)', background: 'hsl(var(--muted) / 0.42)', borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Shipment ID</div>
                <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Warehouse</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 1.4fr)', alignItems: 'center' }}>
                <div className="vs-mono" style={{ padding: '13px 12px', fontSize: 12, color: FG, borderRight: `1px solid ${BORDER}`, overflowWrap: 'anywhere' }}>
                  {shipmentId}
                </div>
                <div style={{ padding: 12 }}>
                  <select
                    value={selectedWarehouseId}
                    disabled={saving}
                    onChange={(event) => onSelectedWarehouseChange(event.target.value)}
                    style={{
                      width: '100%',
                      height: 38,
                      borderRadius: 6,
                      border: `1px solid ${selectedWarehouseId ? TEAL : BORDER}`,
                      background: 'hsl(var(--background))',
                      color: FG,
                      padding: '0 10px',
                      fontSize: 13,
                      outline: 'none',
                      cursor: saving ? 'wait' : 'pointer',
                    }}
                  >
                    <option value="">{warehouses.length ? 'Choose warehouse' : 'No warehouses found in Settings'}</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: `1px solid ${BORDER}`, borderRadius: 6, background: 'transparent', color: FG, cursor: 'pointer' }}>Cancel</button>
          <button disabled={loading || saving} onClick={() => void onSave()} style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: TEAL, color: '#fff', fontWeight: 700, cursor: loading || saving ? 'not-allowed' : 'pointer', opacity: loading || saving ? 0.65 : 1 }}>{saving ? 'Saving mapping...' : 'Save Mapping'}</button>
        </div>
      </div>
    </div>
  );
}

export function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const [currentPath, navigate] = useLocation();
  const { toast } = useToast();
  const { activities } = usePermissions();
  const { canDo: canDoDocType } = useDocTypePermissions();
  const { setPageMeta } = usePageMeta();
  const documentId = params.id ?? '';
  const [documentDetail, setDocumentDetail] = useState<DocumentDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<'approve' | 'retry' | null>(null);
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState<string | null>(null);
  const [cbpComparison, setCbpComparison] = useState<CbpComparisonResponse | null>(null);
  const [cbpDrafts, setCbpDrafts] = useState<CbpDraftPayload[]>([]);
  const [cbpDraftLoading, setCbpDraftLoading] = useState(false);
  const [cbpDraftSaving, setCbpDraftSaving] = useState(false);
  const [cbpDraftFieldValues, setCbpDraftFieldValues] = useState<Record<string, string>>({});
  const [cbpDraftRowValuesState, setCbpDraftRowValuesState] = useState<Record<string, Record<string, string>[]>>({});
  const [containerMappingOpen, setContainerMappingOpen] = useState(false);
  const [containerMappingLoading, setContainerMappingLoading] = useState(false);
  const [containerMappingSaving, setContainerMappingSaving] = useState(false);
  const [containerMapping, setContainerMapping] = useState<ContainerMappingResponse | null>(null);
  const [containerMappingUnmappedOnly, setContainerMappingUnmappedOnly] = useState(false);
  const [dndInputsOpen, setDndInputsOpen] = useState(false);
  const [safeCubeInputsOpen, setSafeCubeInputsOpen] = useState(false);
  const [safeCubeInputsSaving, setSafeCubeInputsSaving] = useState(false);
  const [warehouseMappingOpen, setWarehouseMappingOpen] = useState(false);
  const [warehouseMappingLoading, setWarehouseMappingLoading] = useState(false);
  const [warehouseMappingSaving, setWarehouseMappingSaving] = useState(false);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [warehouseMappingShipmentId, setWarehouseMappingShipmentId] = useState<string | null>(null);
  const [shipmentAssignOpen, setShipmentAssignOpen] = useState(false);
  const [shipmentAssignLoading, setShipmentAssignLoading] = useState(false);
  const [shipmentAssignSaving, setShipmentAssignSaving] = useState(false);
  const [shipmentOptions, setShipmentOptions] = useState<ShipmentOption[]>([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState('');
  const [documentOverviewCollapsed, setDocumentOverviewCollapsed] = useState(false);
  const [extractionFieldFilter, setExtractionFieldFilter] = useState<ExtractionFieldFilter>('all');
  const [isCategoriesExpanded, setIsCategoriesExpanded] = useState(false);
  const [editedExtractionFields, setEditedExtractionFields] = useState<Set<string>>(() => new Set());
  const [pendingFieldEdits, setPendingFieldEdits] = useState<Record<string, string | null>>({});
  const [pendingArrayEdits, setPendingArrayEdits] = useState<Record<string, Array<Record<string, JsonValue>>>>({});
  const isApprovalRoute = currentPath.endsWith('/approve');
  const uploadProcessBackPath = sessionStorage.getItem(UPLOAD_PROCESS_RETURN_PATH_KEY) === PROCESSING_QUEUE_ROUTE
    ? PROCESSING_QUEUE_ROUTE
    : UPLOAD_PROCESS_ROUTE;
  const canUseDndInputs = activities.includes('documents.dnd_inputs');
  const canUseContainerMapping = activities.includes('documents.map_container_to_sku') && canDoDocType('BILL_OF_LADING', 'container_mapping');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDocumentDetail(null);
    setPendingFieldEdits({});
    setPendingArrayEdits({});
    documentApi.getById(documentId)
      .then(({ data }) => {
        if (!cancelled) setDocumentDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load document.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;
    setDocumentPreviewUrl(null);
    if (!documentDetail) return () => undefined;

    documentApi.getPreviewUrl(documentDetail.id)
      .then(({ data }) => {
        if (!cancelled) setDocumentPreviewUrl(data.previewUrl ? apiUrl(data.previewUrl) : documentDetail.previewUrl);
      })
      .catch(() => {
        if (!cancelled) setDocumentPreviewUrl(documentDetail.previewUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [documentDetail?.id, documentDetail?.previewUrl]);

  const extraction = documentDetail?.extraction ?? documentDetail?.salesInvoiceExtraction ?? null;
  const config = documentDetail ? getDocConfig(documentDetail.docType) : undefined;
  const isDraftCbpBrokerDocument = documentDetail?.docType === 'DRAFT_CBP_FORM_7501_BROKER';
  const isUploadedCbpDocument = documentDetail?.docType === 'ENTRY_SUMMARY';
  const isCbpComparisonDocument = isDraftCbpBrokerDocument || isUploadedCbpDocument;
  const cbpGeneratedSchema = DOC_GEN_SCHEMAS['draft-boe'] as DocGenSchema | undefined;
  const normalizedRawData = isJsonRecord(extraction?.rawData) ? extraction.rawData : {};
  const selectedCbpDraft = isCbpComparisonDocument && documentDetail
    ? chooseCbpDraft(cbpDrafts, documentDetail.id, normalizedRawData)
    : null;
  const cbpDraftManualValues = useMemo(() => draftManualValues(selectedCbpDraft), [selectedCbpDraft]);
  const cbpDraftRowValues = useMemo(() => draftRowMap(selectedCbpDraft), [selectedCbpDraft]);
  const configuredFieldKeys = new Set(
    config?.sections.flatMap((section) => section.fields.map((field) => field.key)) ?? [],
  );
  const isExtractionApproved = (
    Boolean(extraction?.reviewedAt)
    || ['REVIEWED', 'ARCHIVED'].includes(String(documentDetail?.status ?? '').toUpperCase())
  );
  const canReprocessCurrentDoc = (
    activities.includes('documents.reprocess_ocr')
    && Boolean(documentDetail?.docType)
    && canDoDocType(String(documentDetail?.docType ?? ''), 'reprocess_ocr')
  );
  const canEditCurrentExtraction = Boolean(documentDetail?.docType) && (
    isExtractionApproved
      ? activities.includes('documents.override_approved_fields') && canDoDocType(String(documentDetail?.docType ?? ''), 'override_approved_fields')
      : (
          (activities.includes('documents.edit_extracted') && canDoDocType(String(documentDetail?.docType ?? ''), 'edit_extracted'))
          || (activities.includes('documents.override_approved_fields') && canDoDocType(String(documentDetail?.docType ?? ''), 'override_approved_fields'))
        )
  );
  const canApproveCurrentExtraction = (
    activities.includes('documents.approve_draft')
    && Boolean(documentDetail?.docType)
    && canDoDocType(String(documentDetail?.docType ?? ''), 'approve_draft')
  );
  const bolReferenceFields = config?.sections
    .flatMap((section) => section.fields)
    .filter((field) => BOL_REFERENCE_ACTION_FIELDS.has(field.key)) ?? [];
  const hasBolReferenceActionFields = bolReferenceFields.length > 0;
  const approvedContainerMappingRows = Array.isArray(normalizedRawData.containerMappingRows)
    ? normalizedRawData.containerMappingRows.filter(isJsonRecord)
    : [];
  const containerMappingApproved = normalizedRawData.containerMappingApproved === true;
  const goodsDescriptionRows = extraction?.arrays?.goodsDescriptionItems ?? [];
  const hasStructuredGoodsDescription = (
    documentDetail?.docType === 'BILL_OF_LADING'
    && goodsDescriptionRows.length > 0
  );
  const additionalPrismaFields: FieldDef[] = Object.entries(normalizedRawData)
    .filter(([key, value]) => (
      !configuredFieldKeys.has(key)
      && !['source', 'documentType', 'document_confidence'].includes(key)
      && !Array.isArray(value)
      && (value === null || typeof value !== 'object')
    ))
    .map(([key]) => ({ key, label: labelFromKey(key) }));
  const isImagePreview = Boolean(documentDetail?.contentType?.startsWith('image/'));

  const fetchCbpComparison = useCallback(async () => {
    if (!documentDetail || !isCbpComparisonDocument) {
      setCbpComparison(null);
      return;
    }
    try {
      const comparison = await apiGet<CbpComparisonResponse>(`/uploads/documents/${documentDetail.id}/cbp-comparison`);
      setCbpComparison(comparison);
    } catch {
      setCbpComparison(null);
    }
  }, [documentDetail?.id, isCbpComparisonDocument]);

  useEffect(() => {
    void fetchCbpComparison();
  }, [fetchCbpComparison]);

  useEffect(() => {
    setExtractionFieldFilter('all');
    setEditedExtractionFields(new Set());
    setDocumentOverviewCollapsed(false);
  }, [documentDetail?.id]);

  useEffect(() => {
    if (!isCbpComparisonDocument) {
      setCbpDrafts([]);
      return;
    }
    let cancelled = false;
    setCbpDraftLoading(true);
    apiGet<CbpDraftPayload[]>('/doc-generation/drafts?generatedDocType=ENTRY_SUMMARY')
      .then((drafts) => {
        if (!cancelled) setCbpDrafts(Array.isArray(drafts) ? drafts : []);
      })
      .catch(() => {
        if (!cancelled) setCbpDrafts([]);
      })
      .finally(() => {
        if (!cancelled) setCbpDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCbpComparisonDocument, documentDetail?.id]);

  useEffect(() => {
    setCbpDraftFieldValues(cbpDraftManualValues);
    setCbpDraftRowValuesState(cbpDraftRowValues);
  }, [selectedCbpDraft?.draftId, cbpDraftManualValues, cbpDraftRowValues]);

  useEffect(() => {
    let cancelled = false;
    setSourcePreviewUrl(null);
    if (!sourcePreviewOpen || !documentDetail) return () => undefined;

    documentApi.getPreviewUrl(documentDetail.id)
      .then(({ data }) => {
        if (!cancelled) setSourcePreviewUrl(data.previewUrl ? apiUrl(data.previewUrl) : documentDetail.previewUrl);
      })
      .catch(() => {
        if (!cancelled) setSourcePreviewUrl(documentDetail.previewUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [sourcePreviewOpen, documentDetail?.id, documentDetail?.previewUrl]);

  async function loadShipmentOptions() {
    setShipmentAssignLoading(true);
    try {
      const response = await apiGet<{ ok: boolean; data: ShipmentOption[] }>('/shipments?limit=500');
      setShipmentOptions(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setShipmentOptions([]);
      toast({
        title: 'Could not load shipments',
        description: getApiErrorMessage(err, 'Unable to load shipment options.'),
        variant: 'destructive',
      });
    } finally {
      setShipmentAssignLoading(false);
    }
  }

  async function openShipmentAssignment() {
    setSelectedShipmentId(documentDetail?.shipmentId ?? '');
    setShipmentAssignOpen(true);
    await loadShipmentOptions();
  }

  async function saveShipmentAssignment() {
    if (!documentDetail || !selectedShipmentId || shipmentAssignSaving) return;
    setShipmentAssignSaving(true);
    try {
      const response = await documentApi.assignShipment(documentDetail.id, selectedShipmentId);
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
      setShipmentAssignOpen(false);
      toast({
        title: 'Shipment assigned',
        description: response.data.data.shipmentNumber
          ? `${documentDetail.fileName} linked to ${response.data.data.shipmentNumber}.`
          : 'The approved document is now linked to the selected shipment.',
      });
    } catch (err) {
      toast({
        title: 'Could not assign shipment',
        description: getApiErrorMessage(err, 'Unable to link this document to the selected shipment.'),
        variant: 'destructive',
      });
    } finally {
      setShipmentAssignSaving(false);
    }
  }

  async function approveAllFields() {
    if (!documentDetail || actionLoading) return;
    setActionLoading('approve');
    try {
      await flushPendingExtractionEdits();
      const approval = await documentApi.approve(documentDetail.id);
      const validation = approval.data?.validation;
      const blockers = Number(validation?.blockingFailures ?? 0);
      const warnings = Number(validation?.warnings ?? 0);
      const waiting = Number(validation?.waiting ?? 0);
      toast({
        title: blockers > 0 ? 'Approved with blockers' : warnings > 0 ? 'Approved with warnings' : waiting > 0 ? 'Approved, waiting for documents' : 'Extraction approved',
        description: blockers > 0
          ? `${blockers} blocking validation issue${blockers === 1 ? '' : 's'} created.`
          : warnings > 0
          ? `${warnings} warning validation issue${warnings === 1 ? '' : 's'} created.`
          : waiting > 0
          ? `${waiting} validation check${waiting === 1 ? '' : 's'} waiting for related documents.`
          : 'All mandatory fields and active validations passed.',
        variant: blockers > 0 ? 'destructive' : undefined,
      });
      try {
        const { data } = await documentApi.getById(documentDetail.id);
        setDocumentDetail(data);
        await fetchCbpComparison();
        if (!data.shipmentId) {
          setShipmentAssignOpen(true);
          setSelectedShipmentId('');
          void loadShipmentOptions();
          toast({
            title: 'Select shipment',
            description: 'This approved document could not be mapped automatically. Choose the shipment to attach it to.',
          });
        }
      } catch (refreshErr) {
        setDocumentDetail((current) => current
          ? { ...current, status: 'REVIEWED' }
          : current);
        setShipmentAssignOpen(true);
        setSelectedShipmentId('');
        void loadShipmentOptions();
        toast({
          title: 'Approved, refresh skipped',
          description: getApiErrorMessage(refreshErr, 'The document was approved. Select a shipment if it did not map automatically.'),
        });
      }
      navigate(`/documents/upload/${documentDetail.id}/approve`);
    } catch (err) {
      toast({ title: 'Approval failed', description: getApiErrorMessage(err, 'Unable to approve this document.'), variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  }

  async function flagForReExtraction() {
    if (!documentDetail || actionLoading) return;
    setActionLoading('retry');
    try {
      await documentApi.retry(documentDetail.id);
      toast({ title: 'Re-extraction queued', description: 'The document was flagged for OCR re-processing.' });
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
    } catch (err) {
      toast({ title: 'Re-extraction failed', description: err instanceof Error ? err.message : 'Unable to queue OCR retry.', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  }

  async function openContainerMapping() {
    setContainerMappingOpen(true);
    setContainerMappingUnmappedOnly(false);
    await loadContainerMappingPage(1, false);
  }

  async function loadContainerMappingPage(page: number, unmappedOnly = containerMappingUnmappedOnly) {
    setContainerMappingLoading(true);
    try {
      const response = await documentApi.getContainerMapping(documentId, page, 20, unmappedOnly);
      setContainerMapping(response.data);
    } catch (err) {
      toast({ title: 'Could not load container mapping', description: err instanceof Error ? err.message : 'Unable to match Packing Lists.', variant: 'destructive' });
    } finally {
      setContainerMappingLoading(false);
    }
  }

  async function saveContainerMapping(rows: ContainerMappingRow[]) {
    setContainerMappingSaving(true);
    try {
      await documentApi.saveContainerMapping(
        documentId,
        rows.map(row => ({ lineItemId: row.lineItemId, containerNo: row.containerNo })),
        rows as unknown as Array<Record<string, unknown>>,
      );
      const { data } = await documentApi.getById(documentId);
      setDocumentDetail(data);
      toast({ title: 'Container mapping approved', description: `${rows.length} Packing List rows mapped. The BOL approval status was not changed.` });
      setContainerMappingOpen(false);
    } catch (err) {
      toast({ title: 'Could not save mapping', description: err instanceof Error ? err.message : 'Unable to save container assignments.', variant: 'destructive' });
    } finally {
      setContainerMappingSaving(false);
    }
  }

  async function openWarehouseMapping() {
    setWarehouseMappingOpen(true);
    setWarehouseMappingLoading(true);
    setWarehouseMappingShipmentId(null);
    try {
      const [warehouses, mappingRes] = await Promise.all([
        loadSettingsWarehouses(),
        documentApi.getWarehouseMapping(documentId),
      ]);
      setWarehouseOptions(warehouses);
      const mapping = (mappingRes as any).data?.data ?? {};
      setSelectedWarehouseId(String(mapping.warehouseId ?? ''));
      setWarehouseMappingShipmentId(typeof mapping.shipmentId === 'string' && mapping.shipmentId.trim() ? mapping.shipmentId : null);
    } catch (err) {
      toast({
        title: 'Could not load warehouse mapping',
        description: getApiErrorMessage(err, 'Unable to load warehouses from Settings.'),
        variant: 'destructive',
      });
    } finally {
      setWarehouseMappingLoading(false);
    }
  }

  async function saveWarehouseMapping() {
    setWarehouseMappingSaving(true);
    try {
      const response = await documentApi.saveWarehouseMapping(documentId, selectedWarehouseId || null);
      setSelectedWarehouseId(response.data.data.warehouseId ?? '');
      setWarehouseMappingShipmentId(response.data.data.shipmentId ?? null);
      toast({
        title: selectedWarehouseId ? 'Warehouse mapping saved' : 'Warehouse mapping cleared',
        description: response.data.data.warehouseName ?? undefined,
      });
      setWarehouseMappingOpen(false);
    } catch (err) {
      toast({
        title: 'Could not save warehouse mapping',
        description: getApiErrorMessage(err, 'Unable to map this cargo release shipment to a warehouse.'),
        variant: 'destructive',
      });
    } finally {
      setWarehouseMappingSaving(false);
    }
  }

  async function saveArrayRows(
    arrayName: string,
    rows: Array<Record<string, JsonValue>>,
  ) {
    if (!documentDetail) return;
    try {
      await documentApi.updateExtraction(documentDetail.id, {
        arrays: { [arrayName]: rows },
      });
      setPendingArrayEdits((current) => {
        const next = { ...current };
        delete next[arrayName];
        return next;
      });
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
      await fetchCbpComparison();
    } catch (err) {
      toast({
        title: `Could not save ${labelFromKey(arrayName)}`,
        description: err instanceof Error ? err.message : 'Unable to save table edits.',
        variant: 'destructive',
      });
    }
  }

  async function saveFieldValue(key: string, value: string | null) {
    if (!documentDetail) return;
    try {
      await documentApi.updateExtraction(documentDetail.id, { fields: { [key]: value } });
      setPendingFieldEdits((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setEditedExtractionFields((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
      await fetchCbpComparison();
    } catch (err) {
      toast({ title: `Could not save ${labelFromKey(key)}`, description: err instanceof Error ? err.message : 'Unable to save field.', variant: 'destructive' });
      throw err;
    }
  }

  function rememberFieldDraft(key: string, value: string | null) {
    setPendingFieldEdits((current) => ({ ...current, [key]: value }));
  }

  function rememberArrayDraft(arrayName: string, rows: Array<Record<string, JsonValue>>) {
    setPendingArrayEdits((current) => ({ ...current, [arrayName]: rows }));
  }

  async function flushPendingExtractionEdits() {
    if (!documentDetail) return;
    const fields = Object.fromEntries(
      Object.entries(pendingFieldEdits).map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value]),
    );
    const arrays = { ...pendingArrayEdits };
    if (!Object.keys(fields).length && !Object.keys(arrays).length) return;

    await documentApi.updateExtraction(documentDetail.id, {
      ...(Object.keys(fields).length ? { fields } : {}),
      ...(Object.keys(arrays).length ? { arrays } : {}),
    });
    setPendingFieldEdits({});
    setPendingArrayEdits({});
    if (Object.keys(fields).length) {
      setEditedExtractionFields((current) => {
        const next = new Set(current);
        Object.keys(fields).forEach((key) => next.add(key));
        return next;
      });
    }
    const { data } = await documentApi.getById(documentDetail.id);
    setDocumentDetail(data);
    await fetchCbpComparison();
  }

  async function saveSafeCubeInputs(values: Record<string, string | null>) {
    if (!documentDetail) return;
    setSafeCubeInputsSaving(true);
    try {
      await documentApi.updateExtraction(documentDetail.id, { fields: values });
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
      await fetchCbpComparison();
      setSafeCubeInputsOpen(false);
      toast({ title: 'SafeCube inputs saved' });
    } catch (err) {
      toast({ title: 'Could not save SafeCube inputs', description: err instanceof Error ? err.message : 'Unable to save tracking references.', variant: 'destructive' });
      throw err;
    } finally {
      setSafeCubeInputsSaving(false);
    }
  }

  async function saveGeneratedDraftFromDetail(
    nextFields = cbpDraftFieldValues,
    nextRows = cbpDraftRowValuesState,
  ) {
    if (!selectedCbpDraft || !cbpGeneratedSchema || cbpDraftSaving) return;
    const status = ['DRAFT', 'IN_REVIEW', 'CONFIRMED', 'GENERATED'].includes(String(selectedCbpDraft.status))
      ? selectedCbpDraft.status
      : 'DRAFT';
    const fields: Record<string, string | null> = {};
    for (const section of cbpGeneratedSchema.sections.filter((section) => section.renderAs === 'fields')) {
      for (const mapping of section.mappings) {
        fields[mapping.targetField] = nextFields[mapping.targetField] ?? cbpGeneratedSchema.mockData.fields[mapping.targetField] ?? null;
      }
    }
    const firstTableSection = cbpGeneratedSchema.sections.find((section) => section.renderAs === 'table');
    const lineItems = firstTableSection
      ? (nextRows[firstTableSection.sectionLabel] ?? cbpGeneratedSchema.mockData.tables[firstTableSection.sectionLabel] ?? [])
      : undefined;
    setCbpDraftSaving(true);
    try {
      const updated = await apiPatch<CbpDraftPayload>(`/doc-generation/drafts/${selectedCbpDraft.draftId}`, {
        fields,
        lineItems,
        status,
      });
      setCbpDrafts((drafts) => drafts.map((draft) => (
        draft.draftId === updated.draftId ? updated : draft
      )));
      toast({ title: 'Generated draft updated', description: 'Changes are saved to Doc Generate.' });
    } catch (err) {
      toast({
        title: 'Could not update generated draft',
        description: err instanceof Error ? err.message : 'Unable to save generated draft fields.',
        variant: 'destructive',
      });
    } finally {
      setCbpDraftSaving(false);
    }
  }

  function updateGeneratedDraftField(field: string, value: string) {
    setCbpDraftFieldValues((current) => ({ ...current, [field]: value }));
  }

  function updateGeneratedDraftRow(sectionLabel: string, rowIndex: number, field: string, value: string) {
    setCbpDraftRowValuesState((current) => {
      const sourceRows = current[sectionLabel] ?? cbpGeneratedSchema?.mockData.tables[sectionLabel] ?? [];
      const nextRows = sourceRows.map((row, index) => (
        index === rowIndex ? { ...row, [field]: value } : { ...row }
      ));
      return { ...current, [sectionLabel]: nextRows };
    });
  }

  const cbpBrokerRawData = useMemo<Record<string, JsonValue>>(() => {
    if (!cbpComparison?.linkedDocumentId) return {};
    return Object.fromEntries(
      Object.entries(cbpComparison.fields ?? {}).map(([key, field]) => [key, field.brokerValue ?? null]),
    );
  }, [cbpComparison]);

  const cbpBrokerTableRows = useMemo<Record<string, Array<Record<string, JsonValue>>>>(() => {
    if (!cbpComparison?.linkedDocumentId) return {};
    return Object.fromEntries(
      Object.entries(cbpComparison.tables ?? {}).map(([tableName, table]) => [
        tableName,
        table.rows.map((row) => Object.fromEntries(
          Object.entries(row.fields ?? {}).map(([key, field]) => [key, field.brokerValue ?? null]),
        )),
      ]),
    );
  }, [cbpComparison]);

  const displayableSections = config?.sections.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => (
      !(field.key === 'goodsDescription' && hasStructuredGoodsDescription)
      && !(hasBolReferenceActionFields && BOL_REFERENCE_ACTION_FIELDS.has(field.key))
    )),
  })) ?? [];
  const allDisplayableFields = [
    ...displayableSections.flatMap((section) => section.fields),
    ...additionalPrismaFields,
  ];
  const issueFieldCount = allDisplayableFields.filter((field) => fieldHasIssue(field, extraction?.rawData, cbpComparison?.fields?.[field.key])).length;
  const editedFieldCount = allDisplayableFields.filter((field) => editedExtractionFields.has(field.key)).length;
  const filterExtractionFields = (fields: FieldDef[]) => fields.filter((field) => {
    if (extractionFieldFilter === 'issues') return fieldHasIssue(field, extraction?.rawData, cbpComparison?.fields?.[field.key]);
    if (extractionFieldFilter === 'edited') return editedExtractionFields.has(field.key);
    return true;
  });
  const selectedConfiguredSection = extractionFieldFilter.startsWith('section:')
    ? extractionFieldFilter.slice('section:'.length)
    : null;
  const selectedArraySection = extractionFieldFilter.startsWith('array:')
    ? extractionFieldFilter.slice('array:'.length)
    : null;
  const filteredSections = displayableSections
    .filter((section) => {
      if (selectedArraySection || extractionFieldFilter === 'additional') return false;
      return !selectedConfiguredSection || section.sectionLabel === selectedConfiguredSection;
    })
    .map((section) => ({ ...section, fields: selectedConfiguredSection ? section.fields : filterExtractionFields(section.fields) }))
    .filter((section) => section.fields.length > 0);
  const filteredAdditionalPrismaFields = extractionFieldFilter === 'additional' || (!selectedConfiguredSection && !selectedArraySection)
    ? filterExtractionFields(additionalPrismaFields)
    : [];
  const arrayFilterOptions = extraction?.arrays && Object.keys(extraction.arrays).length > 0
    ? Object.entries(extraction.arrays)
        .filter(([, rows]) => rows.length > 0)
        .map(([arrayName, rows]) => ({ key: `array:${arrayName}` as const, label: labelFromKey(arrayName), count: rows.length }))
    : extraction?.lineItems?.length
      ? [{ key: 'array:lineItems' as const, label: 'Line Items', count: extraction.lineItems.length }]
      : [];

  const brokerCbpFieldsPanel = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        Draft CBP Broker Extracted Values
      </div>
      {!cbpComparison ? (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, color: MUTED, fontSize: 13 }}>
          Checking linked Draft CBP Broker document...
        </div>
      ) : !cbpComparison.linkedDocumentId ? (
        <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 16, color: MUTED, fontSize: 13, fontWeight: 700 }}>
          No linked Draft CBP Broker document found by BL/AWB, house bill, or broker importer file number.
        </div>
      ) : !config ? (
        <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 16, color: MUTED, fontSize: 13 }}>
          No extraction field schema is configured for Draft CBP Broker.
        </div>
      ) : (
        <>
          {config.sections.map((section) => (
            <div key={section.sectionLabel}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                {section.sectionLabel}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {section.fields.map((field) => (
                  <FieldCard key={field.key} field={field} rawData={cbpBrokerRawData} />
                ))}
              </div>
            </div>
          ))}
          {Object.entries(cbpBrokerTableRows).map(([tableName, rows]) => (
            rows.length ? (
              <LineItemsTable key={tableName} rows={rows} title={tableName} editable={false} />
            ) : null
          ))}
        </>
      )}
    </section>
  );

  const extractionFieldsPanel = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {isDraftCbpBrokerDocument ? 'Broker Extracted Values' : 'AI Extraction Fields'}
      </div> */}
      {isCbpComparisonDocument && cbpComparison?.linkedDocumentId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${cbpComparison.summary.mismatches ? 'hsla(0,84%,60%,0.28)' : `${GREEN}45`}`, background: cbpComparison.summary.mismatches ? 'hsla(0,84%,60%,0.06)' : `${GREEN}08`, color: cbpComparison.summary.mismatches ? RED : GREEN, borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 750 }}>
          {cbpComparison.summary.mismatches
            ? `${cbpComparison.summary.mismatches} mismatch${cbpComparison.summary.mismatches === 1 ? '' : 'es'} from ${cbpComparison.summary.total} compared CBP broker fields`
            : `${cbpComparison.summary.total} CBP broker fields compared and matched`}
        </div>
      )}
      {isCbpComparisonDocument && cbpComparison && !cbpComparison.linkedDocumentId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${BORDER}`, background: 'hsl(var(--card))', color: MUTED, borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 700 }}>
          No linked {isDraftCbpBrokerDocument ? 'CBP Form 7501' : 'Draft CBP Broker'} document found by BL/AWB, house bill, or broker importer file number.
        </div>
      )}

      {!extraction ? (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, color: MUTED, fontSize: 13 }}>
          AI extraction is not available yet. Current document status: <span className="vs-mono">{documentDetail?.status}</span>.
        </div>
      ) : !config ? (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, color: MUTED, fontSize: 13 }}>
          No extraction field schema is configured for <span className="vs-mono">{documentDetail?.docType}</span>.
        </div>
      ) : (
        <>
          {(() => {
            const filterChips = [
              { key: 'all' as const, label: 'All fields', count: allDisplayableFields.length },
              { key: 'issues' as const, label: 'Issues only', count: issueFieldCount },
              { key: 'edited' as const, label: 'Edited fields', count: editedFieldCount },
            ];
            const categoryChips = [
              ...displayableSections.map((section) => ({
                key: `section:${section.sectionLabel}` as const,
                label: section.sectionLabel,
                count: section.fields.length,
              })),
              ...(additionalPrismaFields.length > 0
                ? [{ key: 'additional' as const, label: 'Additional Fields', count: additionalPrismaFields.length }]
                : []),
              ...arrayFilterOptions,
            ];
            const visibleCategoryChips = isCategoriesExpanded ? categoryChips : categoryChips.slice(0, 3);
            const renderChip = (chip: { key: string; label: string; count: number }) => {
              const active = extractionFieldFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setExtractionFieldFilter(chip.key as ExtractionFieldFilter)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    border: `1px solid ${active ? TEAL : BORDER}`,
                    borderRadius: 999,
                    padding: '5px 10px',
                    backgroundColor: active ? `${TEAL}12` : 'hsl(var(--card))',
                    color: active ? TEAL : FG,
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {chip.label}
                  <span style={{ color: active ? TEAL : MUTED, fontWeight: 750 }}>{chip.count}</span>
                </button>
              );
            };
            return (
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 20, position: 'sticky', top: 0, zIndex: 2, backgroundColor: 'hsl(var(--background))', paddingTop: 2, paddingBottom: 12, borderBottom: `1px solid ${BORDER}`, boxShadow: '0 4px 6px -4px hsla(0,0%,0%,0.08)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Filter
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {filterChips.map(renderChip)}
                  </div>
                </div>

                {categoryChips.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      AI Extraction
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {visibleCategoryChips.map(renderChip)}
                      {categoryChips.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setIsCategoriesExpanded((value) => !value)}
                          aria-expanded={isCategoriesExpanded}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: 'none',
                            background: 'none',
                            padding: '5px 2px',
                            color: TEAL,
                            fontSize: 11.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          {isCategoriesExpanded ? 'Less' : 'More'}
                          {isCategoriesExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {filteredSections.map((section) => (
            <div key={section.sectionLabel}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                {section.sectionLabel}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {section.fields.map((field) => (
                  <FieldCard key={field.key} field={field} rawData={extraction.rawData} comparison={cbpComparison?.fields?.[field.key]} isEdited={editedExtractionFields.has(field.key)} onSave={canEditCurrentExtraction ? saveFieldValue : undefined} onDraftChange={canEditCurrentExtraction ? rememberFieldDraft : undefined} />
                ))}
              </div>
            </div>
          ))}

          {filteredSections.length === 0 && filteredAdditionalPrismaFields.length === 0 && !selectedArraySection && (
            <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 16, color: MUTED, fontSize: 13 }}>
              {extractionFieldFilter === 'issues'
                ? 'No issue fields found.'
                : extractionFieldFilter === 'edited'
                  ? 'No edited fields yet.'
                  : 'No fields match this filter.'}
            </div>
          )}

          {extractionFieldFilter === 'all' && documentDetail?.docType === 'BILL_OF_LADING' && !hasStructuredGoodsDescription && (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px', color: MUTED, fontSize: 11.5, lineHeight: 1.45 }}>
              Goods Description Line Items are not present in this older extraction. Re-extract this BOL to split the cargo text into Sales Invoice-style rows.
            </div>
          )}

          {filteredAdditionalPrismaFields.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                Additional Fields
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {filteredAdditionalPrismaFields.map((field) => (
                  <FieldCard key={field.key} field={field} rawData={extraction.rawData} comparison={cbpComparison?.fields?.[field.key]} isEdited={editedExtractionFields.has(field.key)} onSave={canEditCurrentExtraction ? saveFieldValue : undefined} onDraftChange={canEditCurrentExtraction ? rememberFieldDraft : undefined} />
                ))}
              </div>
            </div>
          )}

          {(extractionFieldFilter === 'all' || selectedArraySection) && extraction.arrays && Object.keys(extraction.arrays).length > 0
            ? Object.entries(extraction.arrays).map(([arrayName, rows]) => (
                rows.length && (!selectedArraySection || selectedArraySection === arrayName)
                  ? (
                    <LineItemsTable
                      key={arrayName}
                      rows={rows}
                      title={arrayName}
                      comparisonRows={cbpTableComparisonRows(cbpComparison, arrayName)}
                      editable={canEditCurrentExtraction}
                      onSave={canEditCurrentExtraction ? (updatedRows) => saveArrayRows(arrayName, updatedRows) : undefined}
                      onDraftChange={canEditCurrentExtraction ? (updatedRows) => rememberArrayDraft(arrayName, updatedRows) : undefined}
                    />
                  )
                  : null
              ))
            : (extractionFieldFilter === 'all' || selectedArraySection === 'lineItems') && extraction.lineItems?.length
              ? (
                <LineItemsTable
                  rows={extraction.lineItems}
                  comparisonRows={cbpComparison?.tables?.lineItems?.rows}
                  editable={canEditCurrentExtraction}
                  onSave={canEditCurrentExtraction ? (updatedRows) => saveArrayRows('lineItems', updatedRows) : undefined}
                  onDraftChange={canEditCurrentExtraction ? (updatedRows) => rememberArrayDraft('lineItems', updatedRows) : undefined}
                />
              )
              : null}
          {extractionFieldFilter === 'all' && approvedContainerMappingRows.length > 0 && (
            <LineItemsTable
              rows={approvedContainerMappingRows}
              title="Approved Container Mapping"
              editable={false}
            />
          )}
        </>
      )}
    </section>
  );

  useEffect(() => {
    if (!documentDetail) { setPageMeta(null); return; }
    setPageMeta({
      title: isApprovalRoute ? `Approve ${config?.displayName ?? documentDetail.docType}` : (config?.displayName ?? documentDetail.docType),
      actions: (
        <button
          type="button"
          onClick={() => setDocumentOverviewCollapsed(value => !value)}
          title={documentOverviewCollapsed ? 'Show document overview' : 'Hide document overview'}
          aria-expanded={!documentOverviewCollapsed}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: MUTED, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
        >
          {documentOverviewCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          {documentOverviewCollapsed ? 'Show overview' : 'Hide overview'}
        </button>
      ),
    });
    return () => setPageMeta(null);
  }, [documentDetail, isApprovalRoute, config, documentOverviewCollapsed, setPageMeta]);

  if (loading) {
    return (
      <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: MUTED, fontSize: 14 }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: TEAL }} />
        Loading document details...
      </div>
    );
  }

  if (error || !documentDetail) {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={() => navigate(uploadProcessBackPath)} style={{ marginBottom: 16, color: TEAL, background: 'transparent', border: `1px solid ${TEAL}50`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
          Back to Upload & Process
        </button>
        <div style={{ border: `1px solid ${RED}30`, borderRadius: 8, padding: 18, color: RED }}>
          {error || 'Document not found.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 24px 24px', backgroundColor: 'hsl(var(--background))', minHeight: 'calc(100vh - 64px)' }}>
      {containerMappingOpen && (
        <BolContainerMappingModal
          mapping={containerMapping}
          loading={containerMappingLoading}
          saving={containerMappingSaving}
          approved={containerMappingApproved}
          onClose={() => setContainerMappingOpen(false)}
          onSave={saveContainerMapping}
          onPageChange={(page) => loadContainerMappingPage(page)}
          unmappedOnly={containerMappingUnmappedOnly}
          onUnmappedFilterChange={async (enabled) => {
            setContainerMappingUnmappedOnly(enabled);
            await loadContainerMappingPage(1, enabled);
          }}
        />
      )}
      {warehouseMappingOpen && (
        <WarehouseMappingModal
          shipmentId={warehouseMappingShipmentId ?? 'Shipment not linked yet'}
          warehouses={warehouseOptions}
          selectedWarehouseId={selectedWarehouseId}
          loading={warehouseMappingLoading}
          saving={warehouseMappingSaving}
          onSelectedWarehouseChange={setSelectedWarehouseId}
          onClose={() => setWarehouseMappingOpen(false)}
          onSave={saveWarehouseMapping}
        />
      )}
      {shipmentAssignOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: 'min(520px, 100%)', background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: '0 24px 70px rgba(15,23,42,0.28)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: FG }}>Select shipment</div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>
                This approved document could not be mapped automatically. Choose the shipment it belongs to.
              </div>
            </div>
            <div style={{ padding: 18, display: 'grid', gap: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Shipment
              </label>
              <select
                value={selectedShipmentId}
                disabled={shipmentAssignLoading || shipmentAssignSaving}
                onChange={(event) => setSelectedShipmentId(event.target.value)}
                style={{ width: '100%', height: 40, border: `1px solid ${BORDER}`, borderRadius: 7, background: 'hsl(var(--background))', color: FG, padding: '0 10px', fontSize: 14 }}
              >
                <option value="">{shipmentAssignLoading ? 'Loading shipments...' : 'Select shipment...'}</option>
                {shipmentOptions.map((shipment) => {
                  const refs = [
                    shipment.mblNumber && `MBL ${shipment.mblNumber}`,
                    shipment.hblNumber && `HBL ${shipment.hblNumber}`,
                    shipment.bookingNumber && `Booking ${shipment.bookingNumber}`,
                    shipment.projectName,
                  ].filter(Boolean).join(' · ');
                  return (
                    <option key={shipment.id} value={shipment.id}>
                      {(shipment.shipmentNumber || shipment.bolNumber || shipment.id)}{refs ? ` - ${refs}` : ''}
                    </option>
                  );
                })}
              </select>
              {shipmentOptions.length === 0 && !shipmentAssignLoading && (
                <div style={{ fontSize: 12, color: MUTED }}>
                  No shipments are available yet. Approve a BOL first to create shipments.
                </div>
              )}
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button type="button" variant="outline" size="sm" disabled={shipmentAssignSaving} onClick={() => setShipmentAssignOpen(false)}>Cancel</Button>
              <Button type="button" size="sm" disabled={!selectedShipmentId || shipmentAssignLoading || shipmentAssignSaving} onClick={() => void saveShipmentAssignment()}>
                {shipmentAssignSaving ? 'Assigning...' : 'Assign Shipment'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ShipmentDndInputsDialog
        open={dndInputsOpen}
        shipmentId={`bol-${documentDetail.id}`}
        onOpenChange={setDndInputsOpen}
      />
      {safeCubeInputsOpen && (
        <BolSafeCubeInputsDialog
          fields={bolReferenceFields}
          rawData={extraction?.rawData}
          saving={safeCubeInputsSaving}
          onClose={() => setSafeCubeInputsOpen(false)}
          onSave={saveSafeCubeInputs}
        />
      )}
      {sourcePreviewOpen && isCbpComparisonDocument && (
        <SourceDocumentModal
          title={documentDetail.fileName}
          previewUrl={sourcePreviewUrl}
          isImage={isImagePreview}
          comparisonTitle={isDraftCbpBrokerDocument ? 'Broker Extracted Fields' : 'AI Extraction Fields'}
          comparison={extractionFieldsPanel}
          onClose={() => setSourcePreviewOpen(false)}
        />
      )}
      {!documentOverviewCollapsed && (
        <DocumentPipeline states={documentPipelineStates(documentDetail.status, documentDetail.validationStatus)} />
      )}

      {!documentOverviewCollapsed && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <DocBadge code={docCode(documentDetail.docType)} size="md" />
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 650, overflowWrap: 'anywhere' }}>{documentDetail.fileName}</span>
        {extraction?.extractedAt && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, backgroundColor: `${GREEN}18`, color: GREEN }}>
            Extracted {formatDateTime(extraction.extractedAt)}
          </span>
        )}
        {extraction?.reviewedAt && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, backgroundColor: `${BLUE}14`, color: BLUE }}>
            Reviewed {formatDateTime(extraction.reviewedAt)}
          </span>
        )}
        {(hasBolReferenceActionFields || documentDetail.docType === 'BILL_OF_LADING') && extraction && (
          <div style={{ marginLeft: isApprovalRoute ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {hasBolReferenceActionFields && (
              <Button type="button" variant="outline" size="sm" onClick={() => setSafeCubeInputsOpen(true)} className="h-9">
                SafeCube Inputs
              </Button>
            )}
            {canUseDndInputs && (
              <Button type="button" variant="outline" size="sm" onClick={() => setDndInputsOpen(true)} className="h-9">
                D&D Inputs
              </Button>
            )}
            {canUseContainerMapping && (
              <Button type="button" size="sm" onClick={() => void openContainerMapping()} className="h-9">
                {containerMappingApproved ? 'Mapping approved' : 'Container Mapping'}
              </Button>
            )}
          </div>
        )}
        {documentDetail.docType === 'US_CARGO_RELEASE_ORDER' && extraction && (
          <button
            onClick={() => void openWarehouseMapping()}
            style={{ marginLeft: isApprovalRoute ? 0 : 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff', background: TEAL, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
          >
            Warehouse Mapping
          </button>
        )}
        {isApprovalRoute && (
          <>
            {canReprocessCurrentDoc && (
              <button
                onClick={flagForReExtraction}
                disabled={actionLoading !== null}
                style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: FG, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 11px', cursor: actionLoading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, opacity: actionLoading ? 0.65 : 1 }}
              >
                {actionLoading === 'retry' ? <Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite' }} /> : null}
                Flag for re-extraction
              </button>
            )}
            {canApproveCurrentExtraction && (
              <button
                onClick={approveAllFields}
                disabled={!extraction || isExtractionApproved || actionLoading !== null}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff', background: isExtractionApproved ? TEAL : GREEN, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: !extraction || isExtractionApproved || actionLoading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 800, opacity: !extraction || actionLoading ? 0.65 : 1 }}
              >
                {actionLoading === 'approve' ? <Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite' }} /> : <CheckCircle2 size={14} />}
                {isExtractionApproved ? 'Approved' : 'Approve all fields'}
              </button>
            )}
          </>
        )}
      </div>
      )}

      {isCbpComparisonDocument ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 0.92fr) minmax(520px, 1.08fr)', gap: 18, alignItems: 'start' }}>
          {isUploadedCbpDocument ? (
            <section style={{ minWidth: 0 }}>
              {brokerCbpFieldsPanel}
            </section>
          ) : (
            <section style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Draft CBP FORM 7501
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11.5, color: MUTED }}>
                    {cbpDraftLoading ? 'Loading generated draft...' : selectedCbpDraft ? `Generated draft ${selectedCbpDraft.status}` : 'Latest generated draft preview'}
                  </div>
                </div>
              </div>
              <div>
                {cbpGeneratedSchema ? (
                  <GeneratedDraftFieldStage
                    schema={cbpGeneratedSchema}
                    draft={selectedCbpDraft}
                    manualValues={cbpDraftFieldValues}
                    rowMap={cbpDraftRowValuesState}
                    document={documentDetail}
                    loading={cbpDraftLoading}
                    saving={cbpDraftSaving}
                    onFieldChange={updateGeneratedDraftField}
                    onFieldSave={() => void saveGeneratedDraftFromDetail()}
                    onRowChange={updateGeneratedDraftRow}
                    onRowSave={() => void saveGeneratedDraftFromDetail()}
                  />
                ) : (
                  <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 18, color: MUTED, fontSize: 13 }}>
                    Draft CBP FORM 7501 preview schema is not configured.
                  </div>
                )}
              </div>
            </section>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isDraftCbpBrokerDocument ? 'Broker Extracted Values' : 'AI Extraction Fields'}
              </div>
              <button
                onClick={() => setSourcePreviewOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'hsl(var(--card))', color: FG, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <Eye size={14} /> Source document
              </button>
            </div>
            {extractionFieldsPanel}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(360px, 0.95fr)', gap: 18 }}>
          <section>
            <AuthenticatedPreviewPane
              title={documentDetail.fileName}
              previewUrl={documentPreviewUrl}
              isImage={isImagePreview}
              height={680}
            />
          </section>

          <div className="ewms-scrollarea" style={{ height: 680, overflowY: 'auto' }}>
            {extractionFieldsPanel}
          </div>
        </div>
      )}
    </div>
  );
}
