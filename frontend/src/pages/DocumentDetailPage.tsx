import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { ArrowLeft, Check, CheckCircle2, Circle, Clock3, Loader2, Pencil, Ship, X } from 'lucide-react';
import { documentApi } from '@/auth/api';
import type { DocumentDetailRecord, JsonValue } from '@/types/backend';
import { getDocConfig } from '@/config/docFieldConfig';
import type { FieldDef } from '@/config/docFieldConfig';
import { PageHeader } from '@/components/vs/PageHeader';
import { DocBadge } from '@/components/vs/DocBadge';
import { useToast } from '@/hooks/use-toast';
import type { ContainerMappingResponse, ContainerMappingRow } from '@/types/backend';
import { apiUrl, getAuthToken, readJsonResponse } from '@/lib/api';

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

type PipelineStageState = 'done' | 'current' | 'current-spin' | 'future';

const PIPELINE_LABELS = ['Upload', 'OCR extract', 'Field approval', 'Cross-validation', 'Complete'];

function DocumentPipeline({ states }: { states: PipelineStageState[] }) {
  return (
    <div style={{ marginBottom: 18, padding: '12px 14px', border: `1px solid ${BORDER}`, borderRadius: 10, backgroundColor: 'hsl(var(--card))' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PIPELINE_LABELS.length}, minmax(112px, 1fr))`, alignItems: 'start', width: '100%', gap: 0 }}>
        {PIPELINE_LABELS.map((label, index) => {
          const state = states[index] ?? 'future';
          const nextState = states[index + 1] ?? 'future';
          const isDone = state === 'done';
          const isCurrent = state === 'current' || state === 'current-spin';
          const nextReached = nextState === 'done' || nextState === 'current' || nextState === 'current-spin';
          const markerColor = isDone ? GREEN : isCurrent ? TEAL : 'hsl(var(--muted-foreground) / 0.32)';
          const connectorColor = nextReached ? (nextState === 'done' ? GREEN : TEAL) : 'hsl(var(--border))';
          return (
            <div key={label} style={{ minWidth: 0, position: 'relative', paddingRight: index < PIPELINE_LABELS.length - 1 ? 10 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', minHeight: 26 }}>
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
                  flexShrink: 0,
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
                {index < PIPELINE_LABELS.length - 1 && (
                  <span style={{ height: 2, flex: 1, backgroundColor: connectorColor, marginLeft: 8, minWidth: 24, opacity: isDone ? 0.9 : 0.55 }} />
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: isCurrent ? 800 : 600, color: isDone ? FG : isCurrent ? TEAL : 'hsl(var(--muted-foreground) / 0.50)', lineHeight: 1.25, whiteSpace: 'normal' }}>
                {label}
              </div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: isDone ? GREEN : isCurrent ? TEAL : MUTED, opacity: isDone || isCurrent ? 1 : 0.55 }}>
                <span style={{ animation: isCurrent ? 'doc-pipeline-blink 1.2s ease-in-out infinite' : undefined }}>
                  {isDone ? 'Done' : isCurrent ? 'Current' : 'Pending'}
                </span>
              </div>
            </div>
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

function FieldCard({ field, rawData, onSave }: {
  field: FieldDef;
  rawData: JsonValue | null | undefined;
  onSave?: (key: string, value: string | null) => Promise<void>;
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
  const isManualEmpty = field.manual && displayValue === 'Enter value';
  const isAmended = amendedValue !== null;

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
        border: `1px solid ${isEmpty ? 'hsla(0,84%,60%,0.20)' : isManualEmpty ? `${GREEN}55` : BORDER}`,
        borderRadius: 8,
        padding: '9px 11px',
        backgroundColor: isEmpty ? 'hsla(0,84%,60%,0.035)' : isManualEmpty ? `${GREEN}08` : 'hsl(var(--card))',
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
        {!isEditing && (
          <button
            onClick={startEdit}
            title={`Edit ${field.label}`}
            style={{ width: 22, height: 22, borderRadius: 5, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
      {isEditing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <input
            autoFocus
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
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
            color: isEmpty ? RED : isManualEmpty ? GREEN : FG,
            fontStyle: isEmpty || isManualEmpty ? 'italic' : 'normal',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={displayValue}
        >
          {displayValue}
        </div>
      )}
      {isAmended && extractedValue !== displayValue && (
        <div style={{ marginTop: 5, fontSize: 10.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={extractedValue}>
          Original: {extractedValue}
        </div>
      )}
    </div>
  );
}

function LineItemsTable({
  rows,
  title = 'Line Items',
  editable = true,
  onSave,
}: {
  rows: Array<Record<string, JsonValue>>;
  title?: string;
  editable?: boolean;
  onSave?: (rows: Array<Record<string, JsonValue>>) => Promise<void>;
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
        <table style={{ width: '100%', minWidth: Math.max(760, columns.length * 190), borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ backgroundColor: 'hsl(var(--muted) / 0.45)' }}>
              <th className="vs-mono" style={{ width: 44, padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left' }}>#</th>
              {columns.map((column) => (
                <th key={column} style={{ padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                  return (
                    <td key={column} style={{ minWidth: 180, padding: '7px 8px', borderTop: index === 0 ? 'none' : `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 12, color: isEmpty ? RED : FG, fontStyle: isEmpty ? 'italic' : 'normal', verticalAlign: 'top' }}>
                      {editable ? (
                        <textarea
                          value={isEmpty ? '' : displayValue}
                          placeholder="Field not in the file"
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraftRows(current => current.map((currentRow, rowIndex) => (
                              rowIndex === index ? { ...currentRow, [column]: value } : currentRow
                            )));
                          }}
                          onBlur={() => void saveRows()}
                          style={{
                            width: '100%', minWidth: 160, minHeight: 46, resize: 'vertical',
                            border: `1px solid ${isEmpty ? `${RED}45` : BORDER}`,
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
  onClose,
  onSave,
  onPageChange,
  unmappedOnly,
  onUnmappedFilterChange,
}: {
  mapping: ContainerMappingResponse | null;
  loading: boolean;
  saving: boolean;
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
  const numericValue = (value: string | null) => {
    const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const totals = mapping?.totals;
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
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(1500px, 96vw)', maxHeight: '88vh', background: 'hsl(var(--background))', border: `1px solid ${BORDER}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
              <div style={{ width: 360, height: 112, position: 'relative', overflow: 'hidden', borderRadius: 16, background: 'linear-gradient(180deg, hsl(195 90% 96%) 0%, hsl(190 70% 92%) 58%, hsl(188 62% 78%) 59%, hsl(190 70% 88%) 100%)', border: `1px solid ${TEAL}25` }}>
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
              <table style={{ width: '100%', minWidth: 1180, borderCollapse: 'collapse' }}>
                <thead><tr>{['Container no', 'Product code', 'Description', 'Specification', 'TOTAL QTY IN PCS', 'Qty per bundle', 'Total bundle', 'Net weight (kg)', 'Gross weight (kg)'].map(label => <th key={label} style={{ padding: 10, border: `1px solid ${BORDER}`, textAlign: 'left', fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{label}</th>)}</tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={row.lineItemId}>
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
                    {[row.productCode, row.description, row.specification, row.totalQtyInPcs, row.qtyPerBundle, row.totalBundles, row.netWeightKgs, row.grossWeightKgs].map((value, cellIndex) => <td key={cellIndex} style={{ padding: 9, border: `1px solid ${BORDER}`, fontSize: 12, color: FG }}>{value || '—'}</td>)}
                  </tr>
                ))}</tbody>
                <tfoot>
                  <tr style={{ background: 'hsl(var(--muted) / 0.45)', fontWeight: 750 }}>
                    <td colSpan={4} style={{ padding: 10, border: `1px solid ${BORDER}`, color: FG }}>TOTAL</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.totalQtyInPcs ?? 0)}</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>—</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.totalBundles ?? 0)}</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.netWeightKgs ?? 0)}</td>
                    <td style={{ padding: 10, border: `1px solid ${BORDER}` }}>{formatTotal(totals?.grossWeightKgs ?? 0)}</td>
                  </tr>
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
          <button disabled={!mapping?.pagination.total || saving} onClick={() => void onSave(Object.entries(edits).map(([lineItemId, containerNo]) => ({ lineItemId, containerNo } as ContainerMappingRow)))} style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: TEAL, color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: mapping?.pagination.total ? 1 : 0.5 }}>{saving ? 'Approving mapping…' : 'Save & approve mapping'}</button>
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
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(820px, 94vw)', maxHeight: '82vh', background: 'hsl(var(--background))', border: `1px solid ${BORDER}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
  const documentId = params.id ?? '';
  const [documentDetail, setDocumentDetail] = useState<DocumentDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<'approve' | 'retry' | null>(null);
  const [containerMappingOpen, setContainerMappingOpen] = useState(false);
  const [containerMappingLoading, setContainerMappingLoading] = useState(false);
  const [containerMappingSaving, setContainerMappingSaving] = useState(false);
  const [containerMapping, setContainerMapping] = useState<ContainerMappingResponse | null>(null);
  const [containerMappingUnmappedOnly, setContainerMappingUnmappedOnly] = useState(false);
  const [warehouseMappingOpen, setWarehouseMappingOpen] = useState(false);
  const [warehouseMappingLoading, setWarehouseMappingLoading] = useState(false);
  const [warehouseMappingSaving, setWarehouseMappingSaving] = useState(false);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [warehouseMappingShipmentId, setWarehouseMappingShipmentId] = useState<string | null>(null);
  const isApprovalRoute = currentPath.endsWith('/approve');
  const uploadProcessBackPath = sessionStorage.getItem(UPLOAD_PROCESS_RETURN_PATH_KEY) === PROCESSING_QUEUE_ROUTE
    ? PROCESSING_QUEUE_ROUTE
    : UPLOAD_PROCESS_ROUTE;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setDocumentDetail(null);
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

  const extraction = documentDetail?.extraction ?? documentDetail?.salesInvoiceExtraction ?? null;
  const config = documentDetail ? getDocConfig(documentDetail.docType) : undefined;
  const configuredFieldKeys = new Set(
    config?.sections.flatMap((section) => section.fields.map((field) => field.key)) ?? [],
  );
  const normalizedRawData = isJsonRecord(extraction?.rawData) ? extraction.rawData : {};
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

  async function approveAllFields() {
    if (!documentDetail || actionLoading) return;
    setActionLoading('approve');
    try {
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
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
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
      await documentApi.saveContainerMapping(documentId, rows.map(row => ({ lineItemId: row.lineItemId, containerNo: row.containerNo })));
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
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
    } catch (err) {
      toast({ title: `Could not save ${labelFromKey(key)}`, description: err instanceof Error ? err.message : 'Unable to save field.', variant: 'destructive' });
      throw err;
    }
  }

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
        <div style={{ border: `1px solid ${RED}30`, borderRadius: 10, padding: 18, color: RED }}>
          {error || 'Document not found.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, backgroundColor: 'hsl(var(--background))', minHeight: 'calc(100vh - 64px)' }}>
      {containerMappingOpen && (
        <BolContainerMappingModal
          mapping={containerMapping}
          loading={containerMappingLoading}
          saving={containerMappingSaving}
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <button onClick={() => navigate(uploadProcessBackPath)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TEAL, background: 'transparent', border: `1px solid ${TEAL}50`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          <ArrowLeft size={14} /> Upload & Process
        </button>
        <button
          onClick={() => navigate(uploadProcessBackPath)}
          title="Close document"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: MUTED, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <X size={14} /> Close
        </button>
      </div>

      <PageHeader
        title={isApprovalRoute ? `Approve ${config?.displayName ?? documentDetail.docType}` : (config?.displayName ?? documentDetail.docType)}
        subtitle={`${documentDetail.fileName} · ${documentDetail.status}`}
      />

      <DocumentPipeline states={documentPipelineStates(documentDetail.status, documentDetail.validationStatus)} />

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
        {documentDetail.docType === 'BILL_OF_LADING' && extraction && (
          <button
            onClick={() => void openContainerMapping()}
            style={{ marginLeft: isApprovalRoute ? 0 : 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff', background: TEAL, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
          >
            {containerMappingApproved ? 'Mapping approved' : 'Container Mapping'}
          </button>
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
            <button
              onClick={flagForReExtraction}
              disabled={actionLoading !== null}
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: FG, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '7px 11px', cursor: actionLoading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700, opacity: actionLoading ? 0.65 : 1 }}
            >
              {actionLoading === 'retry' ? <Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite' }} /> : null}
              Flag for re-extraction
            </button>
            <button
              onClick={approveAllFields}
              disabled={!extraction || actionLoading !== null}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#fff', background: GREEN, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: !extraction || actionLoading ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 800, opacity: !extraction || actionLoading ? 0.65 : 1 }}
            >
              {actionLoading === 'approve' ? <Loader2 size={14} style={{ animation: 'spin 0.9s linear infinite' }} /> : <Check size={14} />}
              Approve all fields
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(360px, 0.95fr)', gap: 18 }}>
        <section>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Source PDF
          </div>
          {documentDetail.previewUrl ? (
            isImagePreview ? (
              <div style={{ height: 680, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', backgroundColor: 'hsl(220 14% 96%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={documentDetail.previewUrl} alt={documentDetail.fileName} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
            ) : (
              <iframe title={documentDetail.fileName} src={documentDetail.previewUrl} style={{ width: '100%', height: 680, border: `1px solid ${BORDER}`, borderRadius: 10, backgroundColor: 'hsl(var(--card))' }} />
            )
          ) : (
            <div style={{ height: 360, border: `1px dashed ${BORDER}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 12 }}>
              No preview URL returned for this document.
            </div>
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            AI Extraction Fields
          </div>

          {!extraction ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, color: MUTED, fontSize: 13 }}>
              AI extraction is not available yet. Current document status: <span className="vs-mono">{documentDetail.status}</span>.
            </div>
          ) : !config ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, color: MUTED, fontSize: 13 }}>
              No extraction field schema is configured for <span className="vs-mono">{documentDetail.docType}</span>.
            </div>
          ) : (
            <>
              {config.sections.map((section) => (
                <div key={section.sectionLabel}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                    {section.sectionLabel}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    {section.fields
                      .filter((field) => !(field.key === 'goodsDescription' && hasStructuredGoodsDescription))
                      .map((field) => (
                      <FieldCard key={field.key} field={field} rawData={extraction.rawData} onSave={saveFieldValue} />
                      ))}
                  </div>
                </div>
              ))}
              {documentDetail.docType === 'BILL_OF_LADING' && !hasStructuredGoodsDescription && (
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px', color: MUTED, fontSize: 11.5, lineHeight: 1.45 }}>
                  Goods Description Line Items are not present in this older extraction. Re-extract this BOL to split the cargo text into Sales Invoice-style rows.
                </div>
              )}
              {additionalPrismaFields.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                    Additional Prisma Fields
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                    {additionalPrismaFields.map((field) => (
                      <FieldCard key={field.key} field={field} rawData={extraction.rawData} onSave={saveFieldValue} />
                    ))}
                  </div>
                </div>
              )}
              {extraction.arrays && Object.keys(extraction.arrays).length > 0
                ? Object.entries(extraction.arrays).map(([arrayName, rows]) => (
                    rows.length
                      ? (
                        <LineItemsTable
                          key={arrayName}
                          rows={rows}
                          title={arrayName}
                          editable
                          onSave={(updatedRows) => saveArrayRows(arrayName, updatedRows)}
                        />
                      )
                      : null
                  ))
                : extraction.lineItems?.length
                  ? (
                    <LineItemsTable
                      rows={extraction.lineItems}
                      editable
                      onSave={(updatedRows) => saveArrayRows('lineItems', updatedRows)}
                    />
                  )
                  : null}
              {approvedContainerMappingRows.length > 0 && (
                <LineItemsTable
                  rows={approvedContainerMappingRows}
                  title="Approved Container Mapping"
                  editable={false}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
