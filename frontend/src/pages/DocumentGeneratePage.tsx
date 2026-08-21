import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Info, Sparkles, FileText, Search, CheckCircle2, Clock, AlertCircle, Lock,
  ChevronDown, ChevronUp, MoreHorizontal, Eye, X, Loader2, AlertTriangle, Ban, Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { DOC_GEN_SCHEMAS, DocGenSchema, FieldMapping, GenSection } from '@/config/docGenConfig';
import { getDocConfig } from '@/config/docFieldConfig';
import { apiGet, apiPatch, apiPost, apiUrl, getAuthToken } from '@/lib/api';
import type { MappingType } from '@/config/docGenConfig';
import type { DocumentDetailRecord, DocumentPreviewUrlResponse, JsonValue } from '@/types/backend';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DocGenerationTabs } from '@/components/DocGenerationHeader';
import { useLocation, useParams } from 'wouter';
import { usePermissions } from '@/contexts/PermissionContext';
import { usePageMeta } from '@/contexts/PageMetaContext';
import { allowedDocGenerationOptions } from '@/lib/docGenerationAccess';

// ─── Design tokens ────────────────────────────────────────────────────────────
const TEAL   = 'hsl(173 58% 39%)';
const FG     = 'hsl(var(--foreground))';
const MUTED  = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const GREEN  = 'hsl(152 69% 31%)';
const RED    = 'hsl(0 84% 60%)';
const AMBER  = 'hsl(38 92% 50%)';
const BLUE   = 'hsl(var(--vs-info))';

const SEMANTIC_SURFACE = {
  info: {
    background: 'hsl(var(--vs-info) / 0.08)',
    border: '1px solid hsl(var(--vs-info) / 0.28)',
    color: BLUE,
  },
  success: {
    background: 'hsl(var(--vs-success) / 0.08)',
    border: '1px solid hsl(var(--vs-success) / 0.28)',
    color: GREEN,
  },
  warning: {
    background: 'hsl(var(--vs-warning) / 0.10)',
    border: '1px solid hsl(var(--vs-warning) / 0.32)',
    color: AMBER,
  },
  danger: {
    background: 'hsl(var(--destructive) / 0.08)',
    border: '1px solid hsl(var(--destructive) / 0.28)',
    color: RED,
  },
} as const;

const MONO = { fontFamily: 'var(--app-font-sans)' } as const;

const PACKING_LIST_WEIGHT_EDIT_FIELDS = new Set(['netWeightKgs', 'grossWeightKgs']);
const PACKING_LIST_SPLIT_ONLY_EDIT_FIELDS = new Set(['totalQtyInPcs', 'noOfBundles']);

function isPackingListEditableLineField(
  targetField: string,
  row: Record<string, string>,
  rows: Record<string, string>[],
): boolean {
  if (PACKING_LIST_WEIGHT_EDIT_FIELDS.has(targetField)) return true;
  if (!PACKING_LIST_SPLIT_ONLY_EDIT_FIELDS.has(targetField)) return false;
  if (row._splitRow === 'true') return true;

  const sourceKey = String(row._sourceLineKey ?? '').trim();
  if (!sourceKey) return false;
  return rows.some(other => (
    other !== row &&
    other._splitRow === 'true' &&
    String(other._sourceLineKey ?? '').trim() === sourceKey
  ));
}

// ─── Queue data types ──────────────────────────────────────────────────────────

interface Prerequisite {
  key:        string;
  label:      string;
  met:        boolean;
  actionHint: string;
}

interface GenQueueItem {
  id:            string;
  shipmentRef:   string;
  invoiceNo:     string;
  docType:       string;
  status:        'draft' | 'waiting' | 'generated';
  createdAt:     string;
  prerequisites: Prerequisite[];
}

interface DraftFieldValue {
  targetField: string;
  targetLabel: string;
  value: string | null;
  sourceDoc: string;
  sourceDocumentId?: string | null;
  sourceField?: string | null;
  sourceLabel?: string | null;
  mappingType: MappingType;
  validation?: string | null;
  validationSeverity?: 'critical' | 'warning' | 'info' | null;
  validationStatus: string;
  mono?: boolean;
}

interface DraftPayload {
  draftId: string;
  generatedDocType: 'PACKING_LIST' | 'US_PACKING_LIST' | 'ENTRY_SUMMARY';
  displayName: string;
  status: string;
  schemaVersion: number;
  sourceDocs: string[];
  sourceDocumentIds: Record<string, string>;
  sourceExtractedData?: Record<string, SourceExtractedData>;
  sections: Array<{ sectionLabel: string; fields: DraftFieldValue[] }>;
  lineItems: Array<Record<string, unknown>>;
  containers: Array<Record<string, unknown>>;
  stats: Record<string, number>;
  outwardDispatch?: {
    warehouse?: { id?: string | null; name?: string | null; address?: string | null; firmsCode?: string | null } | null;
    warehouseId?: string | null;
    destinationName?: string | null;
    destinationAddress?: string | null;
  };
  customPackageTypes?: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sourceDocLabel(sourceDoc: string, sourceDocs: { docType: string; label: string }[]): string {
  if (sourceDoc === 'MANUAL')     return 'Manual Entry';
  if (sourceDoc === 'CALCULATED') return 'Calculated';
  return sourceDocs.find(s => s.docType === sourceDoc)?.label ?? sourceDoc;
}

function sourceTagContent(m: FieldMapping, sourceDocs: { docType: string; label: string }[]) {
  const label = sourceDocLabel(m.sourceDoc, sourceDocs);
  if (m.mappingType === 'manual')      return { text: 'Manual input required' };
  if (m.mappingType === 'derived') {
    const formula = String(m.transformation ?? '').trim();
    return { text: formula && formula.toLowerCase() !== label.toLowerCase() ? `Calculated · ${formula}` : 'Calculated' };
  }
  if (m.mappingType === 'conditional') return { text: `Conditional · ${m.transformation ?? ''}` };
  return { text: `From ${label}` };
}

function prereqShortHint(prereqs: Prerequisite[]): string {
  const firstUnmet = prereqs.find(p => !p.met);
  if (!firstUnmet) return 'Waiting';
  if (firstUnmet.key === 'bol-received')       return 'BOL needed';
  if (firstUnmet.key === 'pl-approved')        return 'PL pending';
  if (firstUnmet.key === 'commercial-invoice') return 'CI needed';
  return 'Waiting';
}

const DRAFT_BOE_OPTIONAL_FIELDS = new Set([
  'teamNumber', 'summaryStatus', 'formVersion', 'formNumber', 'subhouseBill',
  'billQty', 'billQtyUnit', 'itNumber', 'itDate', 'missingDocs',
  'countryOfMeltAndPour', 'primaryCountryOfSmelt', 'secondaryCountryOfSmelt',
  'countryOfCast', 'isOwner', 'isPurchase',
]);

function isRequiredManualMapping(schema: DocGenSchema, mapping: FieldMapping): boolean {
  const isManual = mapping.mappingType === 'manual' || mapping.mappingType === 'conditional';
  return isManual && (schema.docType !== 'draft-boe' || !DRAFT_BOE_OPTIONAL_FIELDS.has(mapping.targetField));
}

interface SourceExtractedData {
  documentId?: string | null;
  docType?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  rawData?: JsonValue | null;
  arrays?: Record<string, Array<Record<string, JsonValue>>> | null;
  lineItems?: Array<Record<string, JsonValue>> | null;
}

function isJsonRecord(value: JsonValue | undefined | null): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractionValue(rawData: JsonValue | null | undefined, key: string): JsonValue | undefined {
  if (!isJsonRecord(rawData)) return undefined;
  if (rawData[key] !== undefined) return rawData[key];
  for (const value of Object.values(rawData)) {
    if (isJsonRecord(value) && value[key] !== undefined) return value[key];
  }
  return undefined;
}

function displayExtractionValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === '') return 'Field not in the file';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : 'Field not in the file';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function flattenExtractionFields(value: JsonValue | null | undefined, prefix = ''): Array<{ key: string; label: string; value: string }> {
  if (!isJsonRecord(value)) return [];
  const rows: Array<{ key: string; label: string; value: string }> = [];
  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (child === null || child === undefined || child === '') continue;
    if (Array.isArray(child)) {
      continue;
    } else if (isJsonRecord(child)) {
      rows.push(...flattenExtractionFields(child, nextKey));
    } else {
      rows.push({ key: nextKey, label: nextKey, value: displayExtractionValue(child) });
    }
  }
  return rows;
}

function docGenerationDisplayName(docType: string, fallback?: string): string {
  if (docType === 'ENTRY_SUMMARY' || docType === 'draft-boe' || docType === 'entry-summary') {
    return 'Draft CBP FORM 7501';
  }
  return fallback ?? DOC_GEN_SCHEMAS[docType]?.displayName ?? docType;
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, prereqs }: { status: GenQueueItem['status']; prereqs: Prerequisite[] }) {
  if (status === 'generated') return (
    <Badge intent="success" size="sm" leadingIcon={<CheckCircle2 className="size-3" />}>Done</Badge>
  );
  if (status === 'waiting') {
    const hint = prereqShortHint(prereqs);
    return (
      <Badge intent="warning" size="sm" leadingIcon={<Lock className="size-3" />}>{hint}</Badge>
    );
  }
  return (
    <Badge intent="draft" size="sm" leadingIcon={<AlertCircle className="size-3" />}>Draft</Badge>
  );
}

// ─── QueueFilter type ─────────────────────────────────────────────────────────

type QueueFilter = 'all' | 'needs-review' | 'generated';

// ─── QueueTable ───────────────────────────────────────────────────────────────

function QueueToolbar({
  items, onReview, search, onSearch, filter, onFilter,
}: {
  items:    GenQueueItem[];
  onReview: (item: GenQueueItem) => void;
  search:   string;
  onSearch: (v: string) => void;
  filter:   QueueFilter;
  onFilter: (f: QueueFilter) => void;
}) {
  const filteredByTab = useMemo(() => {
    if (filter === 'needs-review') return items.filter(i => i.status !== 'generated');
    if (filter === 'generated')    return items.filter(i => i.status === 'generated');
    return items;
  }, [items, filter]);

  const searchOptions = useMemo(
    () => search.trim() ? filteredByTab.slice(0, 8) : [],
    [filteredByTab, search],
  );

  const counts = {
    all:         items.length,
    needsReview: items.filter(i => i.status !== 'generated').length,
    generated:   items.filter(i => i.status === 'generated').length,
  };

  const FILTERS: { key: QueueFilter; label: string }[] = [
    { key: 'all',          label: 'All'     },
    { key: 'needs-review', label: 'Pending' },
    { key: 'generated',    label: 'Done'    },
  ];

  return (
    <div style={{
      paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
      flexShrink: 0, borderBottom: `1px solid ${BORDER}`, marginBottom: 20, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {FILTERS.map(t => (
          <button key={t.key} onClick={() => onFilter(t.key)} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 999,
            border: `1px solid ${filter === t.key ? TEAL : BORDER}`,
            background: filter === t.key ? 'hsla(173,58%,39%,0.08)' : 'transparent',
            color: filter === t.key ? TEAL : MUTED, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all 0.1s',
          }}>
            {t.label}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '0 4px', borderRadius: 8, lineHeight: '16px',
              background: filter === t.key ? 'hsla(173,58%,39%,0.15)' : 'hsl(var(--muted))',
              color: filter === t.key ? TEAL : MUTED,
            }}>
              {counts[t.key === 'all' ? 'all' : t.key === 'needs-review' ? 'needsReview' : 'generated']}
            </span>
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>
        {filteredByTab.length} document{filteredByTab.length !== 1 ? 's' : ''}
      </span>
      <div className="ewms-search-field" style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
        background: 'hsl(var(--background))', flex: '0 1 340px', marginLeft: 'auto', position: 'relative', zIndex: 5,
      }}>
        <Search size={12} style={{ color: MUTED, flexShrink: 0 }} />
        <input
          className="ewms-search-input"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search generated documents..."
          style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: FG, flex: 1, minWidth: 0 }}
        />
        {searchOptions.length > 0 && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
            background: 'hsl(var(--card))', border: `1px solid ${BORDER}`,
            borderRadius: 8, boxShadow: '0 10px 28px hsla(0,0%,0%,0.16)', overflow: 'hidden',
          }}>
            {searchOptions.map(item => (
              <button
                key={item.id}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  onSearch(item.invoiceNo || item.shipmentRef || docGenerationDisplayName(item.docType) || item.docType);
                  onReview(item);
                }}
                style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '9px 11px', textAlign: 'left' }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: FG }}>{docGenerationDisplayName(item.docType)}</div>
                <div style={{ ...MONO, fontSize: 12.5, color: MUTED, marginTop: 2 }}>{item.invoiceNo} · {item.shipmentRef || 'No shipment'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueTable({
  items, onReview, filter,
}: {
  items:    GenQueueItem[];
  onReview: (item: GenQueueItem) => void;
  filter:   QueueFilter;
}) {
  const filteredByTab = useMemo(() => {
    if (filter === 'needs-review') return items.filter(i => i.status !== 'generated');
    if (filter === 'generated')    return items.filter(i => i.status === 'generated');
    return items;
  }, [items, filter]);

  const TD: React.CSSProperties = {
    padding: '12px 16px', fontSize: 13, color: FG,
    borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[
                { h: 'Doc Type',       w: '22%' },
                { h: 'Source Invoice', w: '17%' },
                { h: 'Shipment',       w: '17%' },
                { h: 'Status',         w: '12%' },
                { h: 'Created',        w: '12%' },
                { h: '',               w: '20%' },
              ].map(({ h, w }) => (
                <th key={h} style={{
                  padding: '9px 16px', textAlign: 'left', fontSize: 10.5, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.055em', color: MUTED,
                  borderBottom: `2px solid ${BORDER}`, position: 'sticky', top: 0,
                  background: 'hsl(var(--background))', width: w, whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredByTab.map(item => {
              const sch         = DOC_GEN_SCHEMAS[item.docType];
              const isBlocked   = item.status === 'waiting' && item.prerequisites.some(p => !p.met);
              const isGenerated = item.status === 'generated';
              const hasShipment = !!(item.shipmentRef ?? '').trim();

              return (
                <tr
                  key={item.id}
                  onClick={() => onReview(item)}
                  style={{ cursor: 'pointer', transition: 'background 0.07s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'hsl(var(--muted)/0.45)'}
                  onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
                >
                  <td style={TD}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                        background: isBlocked ? 'hsla(38,92%,50%,0.10)' : isGenerated ? 'hsla(152,69%,31%,0.10)' : 'hsla(173,58%,39%,0.10)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Sparkles size={14} style={{ color: isBlocked ? AMBER : isGenerated ? GREEN : TEAL }} />
                      </div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{sch?.displayName ?? item.docType}</span>
                    </div>
                  </td>
                  <td style={TD}>
                    <span style={{ ...MONO, fontSize: 12, color: MUTED }}>{item.invoiceNo}</span>
                  </td>
                  <td style={TD}>
                    {hasShipment ? (
                      <span style={{ ...MONO, fontSize: 12, fontWeight: 600, color: TEAL }}>{item.shipmentRef}</span>
                    ) : (
                      <span style={{
                        fontSize: 11, padding: '2px 9px', borderRadius: 999, fontWeight: 600,
                        background: 'hsla(38,92%,50%,0.10)', color: AMBER,
                      }}>
                        Unattached
                      </span>
                    )}
                  </td>
                  <td style={TD}>
                    <StatusBadge status={item.status} prereqs={item.prerequisites} />
                  </td>
                  <td style={TD}>
                    <span style={{ fontSize: 12, color: MUTED }}>{relativeTime(item.createdAt)}</span>
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onReview(item); }}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 7,
                        border: `1px solid ${isBlocked ? BORDER : isGenerated ? BORDER : TEAL}`,
                        background: isGenerated || isBlocked ? 'transparent' : 'hsla(173,58%,39%,0.08)',
                        color: isBlocked ? MUTED : isGenerated ? MUTED : TEAL,
                        cursor: 'pointer', whiteSpace: 'nowrap',
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}
                    >
                      {isBlocked && <Lock size={11} />}
                      {isBlocked ? 'View status' : isGenerated ? 'View ✓' : 'Review →'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredByTab.length === 0 && (
          <div style={{ padding: '56px 24px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
            {filter !== 'all' ? 'No items in this view' : 'No items match your search'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FieldCard ────────────────────────────────────────────────────────────────

function FieldCard({ mapping, value, sourceDocs, onChange }: {
  mapping:    FieldMapping;
  value:      string;
  sourceDocs: { docType: string; label: string }[];
  onChange?:  (v: string) => void;
}) {
  const { text } = sourceTagContent(mapping, sourceDocs);
  const isEmpty  = !value;
  const isManual = mapping.mappingType === 'manual' || mapping.mappingType === 'conditional';
  const isEditable = !!onChange;

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.045em', color: MUTED, fontWeight: 500, marginBottom: 5 }}>
        {mapping.targetLabel}
        {isManual && isEmpty && (
          <span style={{ color: MUTED, fontWeight: 700, marginLeft: 4 }}>*</span>
        )}
      </div>
      <div
        title={mapping.validation ?? undefined}
        style={{
          backgroundColor: 'hsl(var(--muted) / 0.42)', border: `1px solid ${BORDER}`, borderRadius: 6,
          padding: isEditable ? '0 0 0 10px' : '7px 10px', fontSize: 13, fontWeight: 600,
          ...(mapping.mono ? MONO : {}),
          minHeight: 34, display: 'flex', alignItems: 'center',
        }}
      >
        {isEditable ? (
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="Enter value..."
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 13, fontWeight: 600, color: FG, padding: '7px 10px 7px 0',
              minHeight: 34, width: '100%',
              ...(mapping.mono ? MONO : {}),
            }}
          />
        ) : (
          value || <span style={{ color: MUTED, fontStyle: 'italic', fontWeight: 400 }}>—</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, fontWeight: 500 }}>
          {text}
        </span>
      </div>
    </div>
  );
}

// ─── FieldGrid ────────────────────────────────────────────────────────────────

function FieldGrid({ section, fields, sourceDocs, manualValues, onManualChange, computedFields, readOnly = false }: {
  section:         GenSection;
  fields:          Record<string, string>;
  sourceDocs:      { docType: string; label: string }[];
  manualValues:    Record<string, string>;
  onManualChange:  (key: string, v: string) => void;
  computedFields:  Record<string, string>;
  readOnly?:       boolean;
}) {
  const sectionName = section.sectionLabel.trim().toLowerCase();
  const isTotalsSection = sectionName === 'totals' || sectionName === 'duties and fees';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
      {section.mappings.map(m => {
        const isDerived = m.mappingType === 'derived';
        const isEditable = !readOnly && !isTotalsSection;
        const baseValue = isDerived
          ? (computedFields[m.targetField] ?? fields[m.targetField] ?? '')
          : (fields[m.targetField] ?? '');
        const value = isEditable
          ? (manualValues[m.targetField] ?? baseValue)
          : baseValue;
        return (
          <FieldCard
            key={m.targetField}
            mapping={m}
            value={value}
            sourceDocs={sourceDocs}
            onChange={isEditable ? (v) => onManualChange(m.targetField, v) : undefined}
          />
        );
      })}
    </div>
  );
}

// ─── LineItemTable ────────────────────────────────────────────────────────────

function LineItemTable({ docType, section, rows, sourceDocs, manualValues, onManualChange, computedRows, packageTypes = [], onPackageTypeChange, onAddRow, onRemoveRow, splitIssues = [], readOnly = false }: {
  docType:        string;
  section:        GenSection;
  rows:           Record<string, string>[];
  sourceDocs:     { docType: string; label: string }[];
  manualValues:   Record<string, string>;
  onManualChange: (key: string, v: string) => void;
  computedRows:   Record<string, string>[];
  packageTypes?: string[];
  onPackageTypeChange?: (rowIndex: number, value: string, customTypes: string[]) => void;
  onAddRow?: (rowIndex: number) => void;
  onRemoveRow?: (rowIndex: number) => void;
  splitIssues?: string[];
  readOnly?: boolean;
}) {
  void sourceDocs;
  void packageTypes;
  void onPackageTypeChange;
  const cols = section.mappings.filter(m => m.isLineItem !== false);
  const isPackingListLineItems = docType === 'packing-list' && section.sectionLabel === 'Line Items';
  const isTotalsSection = section.sectionLabel.trim().toLowerCase() === 'totals';
  if (cols.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'hsl(var(--muted))', borderBottom: `1px solid ${BORDER}` }}>
            {(onAddRow || onRemoveRow) && (
              <th style={{ width: 44, padding: '7px 8px', borderRight: `1px solid ${BORDER}` }} />
            )}
            {cols.map(col => (
                <th key={col.targetField} style={{
                  padding: '7px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: '0.04em', color: FG, whiteSpace: 'nowrap',
                }}>
                  {col.targetLabel}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: `1px solid ${BORDER}` }}>
              {(onAddRow || onRemoveRow) && (
                <td style={{ padding: 0, backgroundColor: 'hsl(var(--muted) / 0.42)', verticalAlign: 'middle', outline: `1px solid ${BORDER}`, outlineOffset: -1 }}>
                  {row._splitRow === 'true' ? (
                    <button
                      type="button"
                      onClick={() => onRemoveRow?.(ri)}
                      title="Remove split row"
                      aria-label="Remove split row"
                      style={{ width: 32, height: 32, margin: 4, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'hsl(var(--card))', color: RED, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X size={14} />
                    </button>
                  ) : onAddRow ? (
                    <button
                      type="button"
                      onClick={() => onAddRow(ri)}
                      title="Add split row"
                      aria-label="Add split row"
                      style={{ width: 32, height: 32, margin: 4, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'hsl(var(--card))', color: TEAL, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                </td>
              )}
              {cols.map(col => {
                const isDerived = col.mappingType === 'derived';
                const manualKey = `${section.sectionLabel}.${ri}.${col.targetField}`;
                const forceCalculated = col.targetField === 'qtyPerBundle';
                const baseVal = isDerived
                  ? (computedRows[ri]?.[col.targetField] ?? row[col.targetField] ?? '')
                  : (row[col.targetField] ?? '');
                const isEditable = !readOnly && !isTotalsSection && (
                  isPackingListLineItems
                    ? isPackingListEditableLineField(col.targetField, row, rows)
                    : !forceCalculated
                );
                const val = isEditable ? (manualValues[manualKey] ?? baseVal) : baseVal;
                const hasValue = String(val ?? '').trim() !== '';
                const netWeight = isPackingListLineItems
                  ? numericDraftValue(rowVisibleValue(section.sectionLabel, ri, 'netWeightKgs', row, manualValues, { [section.sectionLabel]: computedRows }))
                  : null;
                const grossWeight = isPackingListLineItems
                  ? numericDraftValue(rowVisibleValue(section.sectionLabel, ri, 'grossWeightKgs', row, manualValues, { [section.sectionLabel]: computedRows }))
                  : null;
                const hasWeightOrderError = netWeight !== null && grossWeight !== null && grossWeight <= netWeight;
                const isWeightErrorCell = hasWeightOrderError && (col.targetField === 'netWeightKgs' || col.targetField === 'grossWeightKgs');
                const highlightState = isWeightErrorCell
                  ? 'invalid'
                  : isPackingListLineItems && isEditable
                    ? (hasValue ? 'complete' : 'missing')
                    : null;
                const cellBackground = highlightState === 'invalid'
                  ? 'hsla(0,84%,60%,0.14)'
                  : highlightState === 'complete'
                    ? 'hsla(152,69%,31%,0.12)'
                    : highlightState === 'missing'
                      ? 'hsla(0,84%,60%,0.12)'
                      : 'hsl(var(--muted) / 0.42)';
                const cellOutline = highlightState === 'invalid'
                  ? '1px solid hsla(0,84%,60%,0.72)'
                  : highlightState === 'complete'
                    ? '1px solid hsla(152,69%,31%,0.46)'
                    : highlightState === 'missing'
                      ? '1px solid hsla(0,84%,60%,0.46)'
                      : `1px solid ${BORDER}`;
                const textColor = isWeightErrorCell ? RED : FG;
                const isAutoDerived = !isTotalsSection && isDerived && forceCalculated && String(computedRows[ri]?.[col.targetField] ?? '').trim() !== '';
                const qtyBundleHint = forceCalculated && String(computedRows[ri]?.[col.targetField] ?? '').trim()
                  ? `${rowVisibleValue(section.sectionLabel, ri, 'totalQtyInPcs', row, manualValues, { [section.sectionLabel]: computedRows }) || 'Qty'} / ${rowVisibleValue(section.sectionLabel, ri, 'noOfBundles', row, manualValues, { [section.sectionLabel]: computedRows }) || 'Bundles'} = ${computedRows[ri]?.[col.targetField]}`
                  : '';
                return (
                  <td key={col.targetField} style={{
                    padding: 0,
                    backgroundColor: cellBackground,
                    verticalAlign: 'middle',
                    ...(col.mono ? MONO : {}), fontSize: 12,
                    whiteSpace: 'nowrap',
                    outline: cellOutline,
                    outlineOffset: -1,
                  }}>
                    {isEditable ? (
                      <div style={{ position: 'relative' }}>
                        <input
                          value={val}
                          onChange={e => onManualChange(manualKey, e.target.value)}
                          placeholder="Enter..."
                          style={{
                            border: 'none', background: 'transparent', outline: 'none',
                            padding: '7px 10px', fontSize: 12, fontWeight: 700, color: textColor,
                            width: '100%', minWidth: 90,
                            ...(col.mono ? MONO : {}),
                          }}
                        />
                      </div>
                    ) : (
                      <span style={{ display: 'block', padding: isAutoDerived ? '7px 42px 3px 10px' : '7px 10px', position: 'relative', color: textColor, fontWeight: isWeightErrorCell ? 800 : undefined }}>
                        {val || '—'}
                        {isAutoDerived && (
                          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 9, fontWeight: 800, color: TEAL, background: 'hsla(173,58%,39%,0.10)', borderRadius: 999, padding: '1px 6px', pointerEvents: 'none' }}>
                            auto
                          </span>
                        )}
                      </span>
                    )}
                    {isWeightErrorCell && col.targetField === 'grossWeightKgs' && (
                      <div style={{ padding: '0 10px 6px', fontSize: 10.5, color: RED, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        Must be &gt; net
                      </div>
                    )}
                    {qtyBundleHint && (
                      <div style={{ padding: '0 10px 6px', fontSize: 10.5, color: MUTED, fontWeight: 650, whiteSpace: 'nowrap' }}>
                        {qtyBundleHint}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ background: 'hsl(var(--muted) / 0.65)', borderTop: `2px solid ${BORDER}`, fontWeight: 700 }}>
            {(onAddRow || onRemoveRow) && <td style={{ padding: '7px 8px' }} />}
            {cols.map((col, ci) => (
              <td key={col.targetField} style={{
                padding: '7px 10px', fontSize: 12,
                color: MUTED,
                ...(col.mono ? MONO : {}),
              }}>
                {ci === 0 ? 'TOTAL' : col.mappingType === 'derived' ? `SUM(${col.targetLabel})` : ''}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {splitIssues.length > 0 && (
        <div style={{ padding: '9px 10px', borderTop: `1px solid ${BORDER}`, background: 'hsla(0,84%,60%,0.06)', color: RED, fontSize: 11.5, lineHeight: 1.45 }}>
          {splitIssues.slice(0, 3).map(issue => <div key={issue}>{issue}</div>)}
          {splitIssues.length > 3 && <div>{splitIssues.length - 3} more packing list issue{splitIssues.length - 3 === 1 ? '' : 's'}.</div>}
        </div>
      )}
    </div>
  );
}

// ─── SourceLegendTooltip ──────────────────────────────────────────────────────

function SourceLegendTooltip({ schema }: { schema: DocGenSchema }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const allMappings = schema.sections.flatMap(s => s.mappings);
  const calcCount   = allMappings.filter(m => m.mappingType === 'derived').length;
  const manualCount = allMappings.filter(m => m.mappingType === 'manual' || m.mappingType === 'conditional').length;
  const uniqueSources = Array.from(new Set(
    allMappings.filter(m => m.sourceDoc !== 'MANUAL' && m.sourceDoc !== 'CALCULATED').map(m => m.sourceDoc)
  ));

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: 18, height: 18, borderRadius: '50%', border: `1px solid ${BORDER}`,
          background: open ? 'hsl(var(--muted))' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: MUTED, lineHeight: 1,
          flexShrink: 0,
        }}
        title="Field source summary"
      >
        ?
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 22, zIndex: 50,
          background: 'hsl(var(--card))', border: `1px solid ${BORDER}`,
          borderRadius: 8, padding: '10px 12px', minWidth: 180,
          boxShadow: '0 4px 16px hsla(0,0%,0%,0.12)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED, marginBottom: 8 }}>
            Field sources
          </div>
          {uniqueSources.map(src => {
            const cnt = allMappings.filter(m => m.sourceDoc === src && (m.mappingType === 'direct' || m.mappingType === 'contextual')).length;
            return (
              <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, fontSize: 11.5 }}>
                <span style={{ flex: 1, color: FG }}>{sourceDocLabel(src, schema.sourceDocs)}</span>
                <span style={{ color: MUTED }}>{cnt}</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, fontSize: 11.5 }}>
            <span style={{ flex: 1, color: FG }}>Calculated</span>
            <span style={{ color: MUTED }}>{calcCount}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span style={{ flex: 1, color: FG }}>Manual input</span>
            <span style={{ color: MUTED }}>{manualCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ActionRequiredCard ───────────────────────────────────────────────────────

function ActionRequiredCard({ schema, manualValues, onManualChange, readOnly = false }: {
  schema:          DocGenSchema;
  manualValues:    Record<string, string>;
  onManualChange:  (key: string, v: string) => void;
  readOnly?:       boolean;
}) {
  const scalarManual = schema.sections
    .filter(s => s.renderAs === 'fields')
    .flatMap(s => s.mappings.filter(m => isRequiredManualMapping(schema, m)));

  // Table-section manual fields: row-aware keys and fill counts
  const tableManualInfo: { section: string; total: number; filled: number }[] = [];
  for (const section of schema.sections.filter(s => s.renderAs === 'table')) {
    const rows = (schema.mockData.tables as Record<string, unknown[]>)[section.sectionLabel] ?? [];
    const manualCols = section.mappings.filter(m => isRequiredManualMapping(schema, m) && m.isLineItem !== false);
    if (manualCols.length === 0 || rows.length === 0) continue;
    const keys = rows.flatMap((_, ri) =>
      manualCols.map(c => `${section.sectionLabel}.${ri}.${c.targetField}`)
    );
    const filledCount = keys.filter(k => !!(manualValues[k] ?? '').trim()).length;
    tableManualInfo.push({ section: section.sectionLabel, total: keys.length, filled: filledCount });
  }

  const scalarFilled   = scalarManual.filter(m => !!(manualValues[m.targetField] ?? '').trim()).length;
  const tableTotalAll  = tableManualInfo.reduce((a, t) => a + t.total, 0);
  const tableFilledAll = tableManualInfo.reduce((a, t) => a + t.filled, 0);
  const totalRequired  = scalarManual.length + tableTotalAll;
  const totalFilled    = scalarFilled + tableFilledAll;
  const allFilled      = totalFilled >= totalRequired;

  if (totalRequired === 0) return null;

  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: `1px solid ${BORDER}`,
      borderRadius: 8, padding: '14px 16px', marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: allFilled ? 0 : 14 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: allFilled ? 'hsl(var(--vs-success) / 0.14)' : 'hsl(var(--destructive) / 0.14)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {allFilled
            ? <CheckCircle2 size={13} style={{ color: GREEN }} />
            : <Ban size={13} style={{ color: RED }} />
          }
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: allFilled ? GREEN : FG, flex: 1 }}>
          {allFilled
            ? 'All required fields filled'
            : `${totalRequired - totalFilled} input${(totalRequired - totalFilled) !== 1 ? 's' : ''} need your attention`
          }
        </span>
        <span style={{ fontSize: 11, color: MUTED }}>
          {totalFilled}/{totalRequired} filled
        </span>
      </div>
      {!allFilled && (
        <>
          {scalarManual.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 20px', marginBottom: tableManualInfo.length > 0 ? 12 : 0 }}>
              {scalarManual.filter(m => !(manualValues[m.targetField] ?? '').trim()).map(m => (
                <FieldCard
                  key={m.targetField}
                  mapping={m}
                  value={manualValues[m.targetField] ?? ''}
                  sourceDocs={schema.sourceDocs}
                  onChange={readOnly ? undefined : v => onManualChange(m.targetField, v)}
                />
              ))}
            </div>
          )}
          {tableManualInfo.filter(t => t.filled < t.total).map(t => (
            <div key={t.section} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 6,
              background: SEMANTIC_SURFACE.warning.background, border: SEMANTIC_SURFACE.warning.border,
              marginBottom: 6,
            }}>
              <AlertTriangle size={12} style={{ color: AMBER, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: FG, flex: 1 }}>
                <strong>{t.section}</strong> — {t.total - t.filled} table cell{(t.total - t.filled) !== 1 ? 's' : ''} need input
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>{t.filled}/{t.total}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── CollapsibleSectionBlock ──────────────────────────────────────────────────

function CollapsibleSectionBlock({
  section, schema, manualValues, onManualChange, packageTypes, onPackageTypeChange, onAddLineItemRow, onRemoveLineItemRow, allowLineItemSplit = true, readOnly = false, computedFields, computedRowMap, defaultExpanded,
}: {
  section:         GenSection;
  schema:          DocGenSchema;
  manualValues:    Record<string, string>;
  onManualChange:  (key: string, v: string) => void;
  packageTypes?: string[];
  onPackageTypeChange?: (rowIndex: number, value: string, customTypes: string[]) => void;
  onAddLineItemRow?: (sectionLabel: string, rowIndex: number) => void;
  onRemoveLineItemRow?: (sectionLabel: string, rowIndex: number) => void;
  allowLineItemSplit?: boolean;
  readOnly?: boolean;
  computedFields:  Record<string, string>;
  computedRowMap:  Record<string, Record<string, string>[]>;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const fieldValues  = schema.mockData.fields;
  const tableRows    = schema.mockData.tables[section.sectionLabel] ?? [];
  const computedRows = computedRowMap[section.sectionLabel] ?? [];
  const splitIssues = packingListSplitIssues(schema, manualValues, computedRowMap);
  const canAddSplitRows = !readOnly && allowLineItemSplit && schema.docType === 'packing-list' && section.sectionLabel === 'Line Items';

  const sectionMappings = section.mappings.filter(m => m.isLineItem !== false);
  const manualCount = section.renderAs === 'fields'
    ? section.mappings.filter(m => m.mappingType === 'manual' || m.mappingType === 'conditional').length
    : sectionMappings.filter(m => m.mappingType === 'manual' || m.mappingType === 'conditional').length;
  const totalCount = section.renderAs === 'fields' ? section.mappings.length : sectionMappings.length;
  const autoCount  = totalCount - manualCount;

  return (
    <div style={{ marginBottom: 8, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      {/* Section header — split: toggle area + tooltip button as siblings (no nested buttons) */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: expanded ? 'hsl(var(--muted)/0.35)' : 'hsl(var(--muted)/0.18)',
        borderBottom: expanded ? `1px solid ${BORDER}` : 'none',
      }}>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            flex: 1, textAlign: 'left', padding: '8px 10px 8px 12px',
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
        >
          {expanded
            ? <ChevronUp   size={12} style={{ color: MUTED, flexShrink: 0 }} />
            : <ChevronDown size={12} style={{ color: MUTED, flexShrink: 0 }} />
          }
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: MUTED, flex: 1 }}>
            {section.sectionLabel}
          </span>
          {!expanded && (
            <span style={{ fontSize: 10.5 }}>
              {manualCount > 0
                ? <span style={{ color: MUTED, fontWeight: 600 }}>{manualCount} manual field{manualCount > 1 ? 's' : ''}</span>
                : <span style={{ color: MUTED }}>{autoCount}/{totalCount} auto-filled</span>
              }
            </span>
          )}
        </button>
        {/* Tooltip trigger — outside the toggle button to avoid nested <button> */}
        <div style={{ padding: '0 10px', flexShrink: 0 }}>
          <SourceLegendTooltip schema={schema} />
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '14px 14px' }}>
          {section.condition && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10,
              background: 'hsl(var(--muted) / 0.45)', border: `1px solid ${BORDER}`,
              borderRadius: 6, padding: '3px 9px', fontSize: 10.5, fontWeight: 600,
              color: MUTED, textTransform: 'uppercase' as const, letterSpacing: '0.05em',
            }}>
              <Info size={11} />
              Section 232 steel import — applies to this shipment
            </div>
          )}
          {section.renderAs === 'fields'
            ? <FieldGrid section={section} fields={fieldValues} sourceDocs={schema.sourceDocs} manualValues={manualValues} onManualChange={onManualChange} computedFields={computedFields} readOnly={readOnly} />
            : <LineItemTable docType={schema.docType} section={section} rows={tableRows} sourceDocs={schema.sourceDocs} manualValues={manualValues} onManualChange={onManualChange} packageTypes={packageTypes} onPackageTypeChange={onPackageTypeChange} onAddRow={canAddSplitRows ? (rowIndex) => onAddLineItemRow?.(section.sectionLabel, rowIndex) : undefined} onRemoveRow={canAddSplitRows ? (rowIndex) => onRemoveLineItemRow?.(section.sectionLabel, rowIndex) : undefined} splitIssues={canAddSplitRows ? splitIssues : []} computedRows={computedRows} readOnly={readOnly} />
          }
        </div>
      )}
    </div>
  );
}

// ─── BlockedView ──────────────────────────────────────────────────────────────

function BlockedView({ item, schema }: { item: GenQueueItem; schema: DocGenSchema | undefined }) {
  const metCount   = item.prerequisites.filter(p => p.met).length;
  const totalCount = item.prerequisites.length;

  return (
    <div style={{ maxWidth: 540 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 8, flexShrink: 0,
          background: 'hsla(38,92%,50%,0.10)', border: '1.5px solid hsla(38,92%,50%,0.30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Lock size={20} style={{ color: AMBER }} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: FG, marginBottom: 2 }}>
            {schema?.displayName ?? item.docType} — Waiting for prerequisites
          </div>
          <div style={{ fontSize: 12.5, color: MUTED }}>
            {metCount}/{totalCount} conditions met · Will unlock automatically once all are satisfied
          </div>
        </div>
      </div>

      {schema && (
        <div style={{
          fontSize: 12, color: MUTED, marginBottom: 20,
          padding: '8px 12px',
          background: SEMANTIC_SURFACE.warning.background,
          border: SEMANTIC_SURFACE.warning.border,
          borderRadius: 6,
        }}>
          <span style={{ fontWeight: 600, color: FG }}>Trigger: </span>{schema.triggerCondition}
        </div>
      )}

      <div style={{
        background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8,
        overflow: 'hidden', marginBottom: 16,
      }}>
        <div style={{
          padding: '10px 14px', borderBottom: `1px solid ${BORDER}`,
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: MUTED,
        }}>
          Prerequisites
        </div>
        {item.prerequisites.map((prereq, i) => (
          <div key={prereq.key} style={{
            padding: '13px 14px',
            borderBottom: i < item.prerequisites.length - 1 ? `1px solid ${BORDER}` : 'none',
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              {prereq.met
                ? <CheckCircle2 size={17} style={{ color: GREEN }} />
                : <Clock size={17} style={{ color: AMBER }} />
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600, marginBottom: 3,
                color: prereq.met ? GREEN : FG,
                textDecoration: prereq.met ? 'line-through' : 'none',
              }}>
                {prereq.label}
              </div>
              {!prereq.met && (
                <div style={{ fontSize: 11.5, color: MUTED }}>{prereq.actionHint}</div>
              )}
            </div>
            {prereq.met && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                background: 'hsla(152,69%,31%,0.10)', color: GREEN, flexShrink: 0,
              }}>
                Done
              </span>
            )}
          </div>
        ))}
      </div>

      {schema && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
          background: 'hsla(173,58%,39%,0.06)', border: '1px solid hsla(173,58%,39%,0.18)',
          borderRadius: 8, fontSize: 12, color: 'hsl(173 58% 28%)',
        }}>
          <Info size={14} style={{ flexShrink: 0, color: TEAL, marginTop: 1 }} />
          <span>
            Once unlocked, an AI draft will auto-generate with{' '}
            <strong>{schema.fieldCounts.auto + schema.fieldCounts.calculated}/{schema.fieldCounts.total}</strong>{' '}
            fields populated. You'll fill in <strong>{schema.fieldCounts.manual}</strong> field{schema.fieldCounts.manual !== 1 ? 's' : ''} manually.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── SourceDocPanel ───────────────────────────────────────────────────────────

function SourceDocPanel({ schema, onClose }: { schema: DocGenSchema; onClose: () => void }) {
  const fields = schema.mockData.fields;
  const tables = schema.mockData.tables;

  // For each section, collect only the mappings that came from a real source doc
  // (not MANUAL or CALCULATED — those have no source value to show)
  const fieldSections = schema.sections
    .filter(s => s.renderAs === 'fields')
    .map(s => ({
      label: s.sectionLabel,
      rows:  s.mappings.filter(m => m.sourceDoc !== 'MANUAL' && m.sourceDoc !== 'CALCULATED'),
    }))
    .filter(s => s.rows.length > 0);

  const tableSections = schema.sections
    .filter(s => s.renderAs === 'table')
    .map(s => ({
      label: s.sectionLabel,
      cols:  s.mappings.filter(m =>
        m.sourceDoc !== 'MANUAL' && m.sourceDoc !== 'CALCULATED' && m.isLineItem !== false
      ),
      rows: (tables[s.sectionLabel] as Record<string, string>[] | undefined) ?? [],
    }))
    .filter(s => s.cols.length > 0 && s.rows.length > 0);

  const sourceLabel = schema.sourceDocs.map(d => d.label).join(' + ');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', minWidth: 0,
      borderRight: `1px solid ${BORDER}`,
      background: 'hsl(var(--card))',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px', borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
      }}>
        <FileText size={13} style={{ color: TEAL, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: FG, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sourceLabel}
          </div>
          <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>
            Source · auto-extracted values
          </div>
        </div>
        <button
          onClick={onClose}
          title="Hide source doc"
          style={{
            width: 22, height: 22, borderRadius: 5, border: `1px solid ${BORDER}`,
            background: 'transparent', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={12} style={{ color: MUTED }} />
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Field sections */}
        {fieldSections.map(sec => (
          <div key={sec.label}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
              color: MUTED, marginBottom: 6, paddingLeft: 2,
            }}>
              {sec.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {sec.rows.map(m => {
                const val = fields[m.targetField];
                const isEmpty = !val || val === '—';
                return (
                  <div key={m.targetField} style={{
                    padding: '5px 8px', borderRadius: 5, background: 'hsl(var(--muted) / 0.5)',
                    border: `1px solid ${BORDER}`,
                  }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', color: MUTED, fontWeight: 600, marginBottom: 2 }}>
                      {m.sourceLabel}
                    </div>
                    <div style={{
                      fontSize: 11.5, fontWeight: 600, color: isEmpty ? MUTED : FG,
                      fontStyle: isEmpty ? 'italic' : 'normal',
                      wordBreak: 'break-word', lineHeight: 1.35,
                      ...(m.mono ? MONO : {}),
                    }}>
                      {val || '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Table sections — compact */}
        {tableSections.map(sec => (
          <div key={sec.label}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
              color: MUTED, marginBottom: 6, paddingLeft: 2,
            }}>
              {sec.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sec.rows.map((row, ri) => (
                <div key={ri} style={{
                  padding: '7px 8px', borderRadius: 6,
                  background: 'hsl(var(--muted) / 0.5)', border: `1px solid ${BORDER}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, marginBottom: 4, ...MONO }}>
                    Row {ri + 1} · {row['productCode'] ?? ''}
                  </div>
                  {sec.cols.map(col => {
                    const val = row[col.targetField];
                    if (!val) return null;
                    return (
                      <div key={col.targetField} style={{ display: 'flex', gap: 4, marginBottom: 2, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, flexShrink: 0, minWidth: 70 }}>
                          {col.sourceLabel}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: FG, ...(col.mono ? MONO : {}), wordBreak: 'break-all' }}>
                          {val}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── StickyReviewFooter ───────────────────────────────────────────────────────

function BrokerExtractionPanel({
  document,
  loading,
  schema,
  onOpenSource,
  snapshot,
}: {
  document: DocumentDetailRecord | null;
  loading: boolean;
  schema: DocGenSchema;
  onOpenSource?: () => void;
  snapshot?: SourceExtractedData | null;
}) {
  const extraction = document?.extraction ?? document?.salesInvoiceExtraction ?? null;
  const rawData = extraction?.rawData ?? snapshot?.rawData ?? null;
  const docType = document?.docType ?? snapshot?.docType ?? 'DRAFT_CBP_FORM_7501_BROKER';
  const fileName = document?.fileName ?? snapshot?.fileName ?? 'Broker extraction';
  const config = getDocConfig(docType);
  const brokerRows = isJsonRecord(rawData) && Array.isArray(rawData.lineItems)
    ? rawData.lineItems.filter(isJsonRecord)
    : [];
  void schema;
  const configuredKeys = new Set(config?.sections.flatMap(section => section.fields.map(field => field.key)) ?? []);
  const additionalFields = flattenExtractionFields(rawData)
    .filter(field => {
      const lastKey = field.key.split('.').pop()?.replace(/\[\d+\]/g, '') ?? field.key;
      return !configuredKeys.has(lastKey);
    });
  const extractedTables = [
    ...Object.entries(extraction?.arrays ?? snapshot?.arrays ?? {}).map(([title, rows]) => ({ title, rows })),
    ...(brokerRows.length ? [{ title: 'lineItems', rows: brokerRows }] : []),
    ...((extraction?.lineItems ?? snapshot?.lineItems)?.length ? [{ title: 'lineItems', rows: (extraction?.lineItems ?? snapshot?.lineItems) ?? [] }] : []),
  ].filter((table, index, tables) => (
    table.rows.length > 0 && tables.findIndex(other => other.title === table.title) === index
  ));
  const hasBrokerData = Boolean(document || snapshot);
  const isWaitingForData = loading && !snapshot;
  return (
    <aside style={{
      borderLeft: `2px solid ${BORDER}`,
      background: 'hsl(var(--card))',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={14} style={{ color: TEAL }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>DRAFT_CBP_FORM_7501_BROKER</div>
            <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fileName}
            </div>
          </div>
          {onOpenSource && (
            <Button type="button" variant="outline" size="sm" onClick={onOpenSource} className="shrink-0 gap-1.5">
              <FileText className="size-3.5" />
              Broker source
            </Button>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
        {isWaitingForData ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 12 }}>Loading broker extracted fields...</div>
        ) : !hasBrokerData ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 12, border: `1px dashed ${BORDER}`, borderRadius: 8 }}>
            No uploaded broker extraction is linked to this generated draft.
          </div>
        ) : !rawData ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 12, border: `1px dashed ${BORDER}`, borderRadius: 8 }}>
            Broker extraction fields are not available yet.
          </div>
        ) : !config ? (
          <div style={{ color: MUTED, fontSize: 13, padding: 12, border: `1px dashed ${BORDER}`, borderRadius: 8 }}>
            No extraction field schema is configured for this broker document.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {config.sections.map(section => (
              <div key={section.sectionLabel}>
                <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  {section.sectionLabel}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                  {section.fields.map(field => (
                    <BrokerExtractedFieldCard key={field.key} label={field.label} value={displayExtractionValue(extractionValue(rawData, field.key))} optional={field.optional} />
                  ))}
                </div>
              </div>
            ))}
            {extractedTables.map(table => (
              <BrokerExtractedLineItemsTable key={table.title} rows={table.rows} title={table.title} />
            ))}
            {additionalFields.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Additional Extracted Fields
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {additionalFields.map(field => (
                    <BrokerExtractedFieldCard key={field.key} label={field.label} value={field.value} multiline />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function BrokerExtractedFieldCard({ label, value, multiline = false, optional = false }: { label: string; value: string; multiline?: boolean; optional?: boolean }) {
  const empty = value === 'Field not in the file';
  const optionalEmpty = empty && optional;
  return (
    <div style={{
      border: `1px solid ${empty && !optionalEmpty ? 'hsla(0,84%,60%,0.20)' : BORDER}`,
      borderRadius: 8,
      padding: '9px 11px',
      backgroundColor: empty && !optionalEmpty ? 'hsla(0,84%,60%,0.035)' : 'hsl(var(--card))',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: multiline ? 'normal' : 'nowrap' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: empty && !optionalEmpty ? RED : optionalEmpty ? MUTED : FG,
          fontStyle: empty ? 'italic' : 'normal',
          overflow: multiline ? 'visible' : 'hidden',
          textOverflow: multiline ? undefined : 'ellipsis',
          whiteSpace: multiline ? 'normal' : 'nowrap',
          overflowWrap: multiline ? 'anywhere' : undefined,
          lineHeight: 1.35,
        }}
        title={value}
      >
        {optionalEmpty ? '—' : value}
      </div>
    </div>
  );
}

function BrokerExtractedLineItemsTable({ rows, title = 'Line Items' }: { rows: Record<string, JsonValue>[]; title?: string }) {
  const columns = useMemo(
    () => Array.from(rows.reduce((keys, row) => {
      Object.keys(row).forEach(key => {
        const value = row[key];
        if (value !== null && value !== undefined && value !== '') keys.add(key);
      });
      return keys;
    }, new Set<string>())),
    [rows],
  );
  if (!rows.length || !columns.length) {
    return (
      <div style={{ padding: 12, color: MUTED, fontSize: 12 }}>
        No extracted line items found.
      </div>
    );
  }
  return (
    <section>
      <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {title.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}
      </div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'auto', backgroundColor: 'hsl(var(--card))' }}>
        <table style={{ width: '100%', minWidth: Math.max(760, columns.length * 190), borderCollapse: 'collapse', tableLayout: 'auto' }}>
          <thead>
          <tr style={{ background: 'hsl(var(--muted) / 0.45)' }}>
            <th style={{ width: 44, padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left' }}>#</th>
            {columns.map(column => (
              <th key={column} style={{ padding: '9px 10px', borderBottom: `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 10, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                {column.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
          </thead>
          <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td style={{ padding: '9px 10px', borderTop: rowIndex === 0 ? 'none' : `1px solid ${BORDER}`, fontSize: 11, color: MUTED }}>{rowIndex + 1}</td>
              {columns.map(column => {
                const value = displayExtractionValue(row[column]);
                const empty = value === 'Field not in the file';
                return (
                  <td key={column} style={{ minWidth: 140, padding: '9px 10px', borderTop: rowIndex === 0 ? 'none' : `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 12, color: empty ? RED : FG, fontStyle: empty ? 'italic' : 'normal', verticalAlign: 'top', lineHeight: 1.35 }}>
                    {value}
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

function SourceDocumentPopup({
  document,
  loading,
  title,
  comparisonTitle,
  comparison,
  onClose,
}: {
  document: DocumentDetailRecord | null;
  loading: boolean;
  title: string;
  comparisonTitle: string;
  comparison: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9000,
          background: 'hsla(0,0%,0%,0.48)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        onClick={event => event.stopPropagation()}
        style={{
          position: 'fixed',
          zIndex: 9001,
          top: 34,
          left: 42,
          right: 42,
          bottom: 34,
          background: 'hsl(var(--background))',
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          boxShadow: '0 28px 90px hsla(0,0%,0%,0.30)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${BORDER}`,
          background: 'hsl(var(--card))',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <FileText size={15} style={{ color: TEAL, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: FG }}>{title}</div>
            <div style={{ fontSize: 11.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loading ? 'Loading source document...' : document?.fileName ?? 'Source document not found'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close source document"
            title="Close source document"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: 14, background: 'hsl(var(--muted) / 0.30)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {title}
            </div>
            <SourceDocumentPreviewPane document={document} loading={loading} title={title} />
          </div>
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {comparisonTitle}
            </div>
            {comparison}
          </div>
        </div>
      </div>
    </>
  );
}

function SourceDocumentPreviewPane({ document, loading, title }: { document: DocumentDetailRecord | null; loading: boolean; title: string }) {
  const isImage = document?.contentType?.startsWith('image/');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextBlobUrl: string | null = null;
    setBlobUrl(null);
    setPreviewError(null);

    if (!document?.previewUrl) {
      return () => undefined;
    }

    const headers: Record<string, string> = {};
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    fetch(document.previewUrl, { headers, credentials: 'include' })
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
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Preview failed');
      });

    return () => {
      cancelled = true;
      if (nextBlobUrl) URL.revokeObjectURL(nextBlobUrl);
    };
  }, [document?.previewUrl]);

  if (loading) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
        Loading source document...
      </div>
    );
  }
  if (!document) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, background: 'hsl(var(--card))', border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 18, textAlign: 'center' }}>
        No linked source document is available for this draft.
      </div>
    );
  }
  if (!document.previewUrl) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, background: 'hsl(var(--card))', border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 18, textAlign: 'center' }}>
        Preview is not available for this source document.
      </div>
    );
  }
  if (previewError) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: RED, fontSize: 13, background: 'hsl(var(--card))', border: `1px dashed ${BORDER}`, borderRadius: 8, padding: 18, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
        {previewError.includes('Not authenticated') ? 'Source preview session expired. Please sign in again.' : previewError}
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 13, background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
        Loading source preview...
      </div>
    );
  }
  return isImage ? (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
      <img src={blobUrl} alt={document.fileName} style={{ maxWidth: '100%', height: 'auto', background: '#fff' }} />
    </div>
  ) : (
    <iframe
      title={title}
      src={blobUrl}
      style={{ flex: 1, minHeight: 0, width: '100%', border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff' }}
    />
  );
}

async function loadDocumentWithPreview(documentId: string): Promise<DocumentDetailRecord> {
  const [document, preview] = await Promise.all([
    apiGet<DocumentDetailRecord>(`/uploads/documents/${documentId}`),
    apiGet<DocumentPreviewUrlResponse>(`/uploads/documents/${documentId}/preview-url`),
  ]);
  return {
    ...document,
    previewUrl: preview.previewUrl ? apiUrl(preview.previewUrl) : document.previewUrl,
  };
}

function GeneratedDraftComparisonPanel({
  schema,
  manualValues,
  computedFields,
  computedRowMap,
}: {
  schema: DocGenSchema;
  manualValues: Record<string, string>;
  computedFields: Record<string, string>;
  computedRowMap: Record<string, Record<string, string>[]>;
}) {
  const valueFor = (targetField: string) =>
    manualValues[targetField]
    ?? computedFields[targetField]
    ?? schema.mockData.fields[targetField]
    ?? '';
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {schema.sections.filter(section => section.renderAs === 'fields').map(section => (
          <section key={section.sectionLabel}>
            <div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {section.sectionLabel}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {section.mappings.map(mapping => (
                <BrokerExtractedFieldCard
                  key={mapping.targetField}
                  label={mapping.targetLabel}
                  value={displayExtractionValue(valueFor(mapping.targetField))}
                />
              ))}
            </div>
          </section>
        ))}
        {schema.sections.filter(section => section.renderAs === 'table').map(section => {
          const rows = (schema.mockData.tables as Record<string, Array<Record<string, JsonValue>>>)[section.sectionLabel] ?? [];
          const mergedRows = rows.map((row, rowIndex) => Object.fromEntries(
            section.mappings
              .filter(mapping => mapping.isLineItem !== false)
              .map(mapping => [
                mapping.targetField,
                manualValues[`${section.sectionLabel}.${rowIndex}.${mapping.targetField}`]
                  ?? computedRowMap[section.sectionLabel]?.[rowIndex]?.[mapping.targetField]
                  ?? row[mapping.targetField]
                  ?? null,
              ]),
          )) as Record<string, JsonValue>[];
          return (
            <BrokerExtractedLineItemsTable key={section.sectionLabel} rows={mergedRows} title={section.sectionLabel} />
          );
        })}
      </div>
    </div>
  );
}

function StickyReviewFooter({ schema, manualValues, computedFields, computedRowMap, splitIssues = [], isApproved, isBlocked, onApprove, onPreview, approving }: {
  schema:       DocGenSchema;
  manualValues: Record<string, string>;
  computedFields: Record<string, string>;
  computedRowMap: Record<string, Record<string, string>[]>;
  splitIssues?: string[];
  isApproved:   boolean;
  isBlocked:    boolean;
  onApprove:    () => void;
  onPreview:    () => void;
  approving?:   boolean;
}) {
  const allMappings    = schema.sections.flatMap(s => s.mappings);
  const manualMappings = allMappings.filter(m => isRequiredManualMapping(schema, m));
  const scalarValue = (targetField: string) =>
    manualValues[targetField]
    ?? computedFields[targetField]
    ?? schema.mockData.fields[targetField]
    ?? '';
  const tableValue = (sectionLabel: string, rowIndex: number, targetField: string) => {
    const rows = (schema.mockData.tables as Record<string, Array<Record<string, unknown>>>)[sectionLabel] ?? [];
    return manualValues[`${sectionLabel}.${rowIndex}.${targetField}`]
      ?? computedRowMap[sectionLabel]?.[rowIndex]?.[targetField]
      ?? rows[rowIndex]?.[targetField]
      ?? '';
  };

  // Scalar manual keys (renderAs: 'fields' sections)
  const scalarManual = schema.sections
    .filter(s => s.renderAs === 'fields')
    .flatMap(s => s.mappings.filter(m => isRequiredManualMapping(schema, m)));

  // Table manual keys — row-aware: ${sectionLabel}.${rowIndex}.${targetField}
  const tableManualKeys: string[] = [];
  for (const section of schema.sections.filter(s => s.renderAs === 'table')) {
    const rows = (schema.mockData.tables as Record<string, unknown[]>)[section.sectionLabel] ?? [];
    const manualCols = section.mappings.filter(m => isRequiredManualMapping(schema, m) && m.isLineItem !== false);
    for (let ri = 0; ri < rows.length; ri++) {
      for (const col of manualCols) {
        tableManualKeys.push(`${section.sectionLabel}.${ri}.${col.targetField}`);
      }
    }
  }

  const filledScalar = scalarManual.filter(m => String(scalarValue(m.targetField)).trim()).length;
  const filledTable = tableManualKeys.filter(key => {
    const [sectionLabel, rowIndex, targetField] = key.split('.');
    return Boolean(String(tableValue(sectionLabel, Number(rowIndex), targetField)).trim());
  }).length;
  const totalManualReqd = scalarManual.length + tableManualKeys.length;
  const filledManual    = filledScalar + filledTable;

  const autoCount  = allMappings.length - manualMappings.length;
  const filledTotal = autoCount + filledManual;
  const totalCount  = allMappings.length + tableManualKeys.length;

  // Runtime critical failures: empty manual/conditional fields (scalar or table) with critical severity.
  // Auto/derived fields come from approved source docs and always pass in this context.
  const validations = allMappings.filter(m => m.validation);
  const scalarCritFailing = allMappings.filter(m =>
    m.validation &&
    m.validationSeverity === 'critical' &&
    (m.mappingType === 'manual' || m.mappingType === 'conditional') &&
    !String(scalarValue(m.targetField)).trim()
  ).length;
  const tableCritFailing = (() => {
    let count = 0;
    for (const section of schema.sections.filter(s => s.renderAs === 'table')) {
      const rows = (schema.mockData.tables as Record<string, unknown[]>)[section.sectionLabel] ?? [];
      const critManualCols = section.mappings.filter(m =>
        m.validation && m.validationSeverity === 'critical' &&
        (m.mappingType === 'manual' || m.mappingType === 'conditional') && m.isLineItem !== false
      );
      for (let ri = 0; ri < rows.length; ri++) {
        for (const col of critManualCols) {
          if (!String(tableValue(section.sectionLabel, ri, col.targetField)).trim()) count++;
        }
      }
    }
    return count;
  })();
  const critFailing = scalarCritFailing + tableCritFailing;
  const passing = validations.length - scalarCritFailing;

  // Approve requires ALL manual fields filled (scalar + table) AND 0 critical validation failures
  const canApprove = !isBlocked && !isApproved && filledManual >= totalManualReqd && critFailing === 0 && splitIssues.length === 0;
  const fillPct    = totalCount > 0 ? Math.round((filledTotal / totalCount) * 100) : 100;

  return (
    <div style={{
      flexShrink: 0,
      background: 'hsl(var(--card))', borderTop: `1px solid ${BORDER}`,
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 14,
      flexWrap: 'wrap',
    }}>
      {/* Fill progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 60, height: 5, borderRadius: 3, background: 'hsl(var(--muted))', overflow: 'hidden',
        }}>
          <div style={{ width: `${fillPct}%`, height: '100%', background: fillPct === 100 ? GREEN : TEAL, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, color: filledTotal >= totalCount ? GREEN : FG }}>{filledTotal}</span>
          <span>/{totalCount} fields</span>
        </span>
      </div>

      <div style={{ width: 1, height: 16, background: BORDER, flexShrink: 0 }} />

      {/* Validation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: 'nowrap' }}>Validations:</span>
        <span style={{
          fontSize: 11.5, fontWeight: 700,
          color: critFailing === 0 ? GREEN : RED,
          ...MONO,
        }}>
          {passing}/{validations.length}
        </span>
        {critFailing > 0 && (
          <span style={{ fontSize: 10.5, color: RED }}>({critFailing} critical)</span>
        )}
        {splitIssues.length > 0 && (
          <span style={{ fontSize: 10.5, color: RED }}>({splitIssues.length} packing list issue{splitIssues.length === 1 ? '' : 's'})</span>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Preview button — always available */}
      <button
        onClick={onPreview}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12.5, fontWeight: 600, color: FG,
          background: 'transparent', border: `1px solid ${BORDER}`,
          borderRadius: 7, padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'background 0.12s, border-color 0.12s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--muted))'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <Eye size={13} />
        {isApproved ? 'View Document' : 'Preview Draft'}
      </button>

      {/* Send for review */}
      {!isApproved && !isBlocked && (
        <button style={{
          fontSize: 12.5, fontWeight: 500, color: FG,
          background: 'transparent', border: `1px solid ${BORDER}`,
          borderRadius: 7, padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          Send for review
        </button>
      )}

      {/* Approve CTA */}
      {!isBlocked && (
        <button
          onClick={onApprove}
          disabled={!canApprove || !!approving}
          style={{
            fontSize: 13, fontWeight: 700,
            background: isApproved ? 'hsl(var(--muted))' : canApprove ? GREEN : `hsla(152,69%,31%,0.35)`,
            color: isApproved ? MUTED : canApprove ? '#fff' : 'hsla(152,69%,31%,0.6)',
            border: 'none', borderRadius: 8,
            padding: '8px 18px', cursor: (canApprove && !approving) ? 'pointer' : 'default',
            whiteSpace: 'nowrap', transition: 'background 0.15s',
            opacity: approving ? 0.7 : 1,
          }}
        >
          {isApproved ? '✓ Approved' : approving ? 'Saving…' : 'Approve & generate PDF'}
        </button>
      )}
    </div>
  );
}

// ─── OverflowMenu ─────────────────────────────────────────────────────────────

function OverflowMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: 30, height: 30, borderRadius: 6, border: `1px solid ${BORDER}`,
          background: open ? 'hsl(var(--muted))' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <MoreHorizontal size={15} style={{ color: MUTED }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 34, zIndex: 50, minWidth: 140,
          background: 'hsl(var(--card))', border: `1px solid ${BORDER}`,
          borderRadius: 8, padding: '4px', boxShadow: '0 4px 16px hsla(0,0%,0%,0.12)',
        }}>
          {[
            { label: 'Save draft',  action: () => { toast.info('Draft saved'); setOpen(false); } },
            { label: 'Discard',     action: () => { toast.error('Draft discarded'); setOpen(false); } },
          ].map(item => (
            <button key={item.label} onClick={item.action} style={{
              width: '100%', textAlign: 'left', padding: '7px 10px',
              border: 'none', background: 'transparent', borderRadius: 5,
              fontSize: 12.5, color: FG, cursor: 'pointer', display: 'block',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--muted))'}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DocReviewModal ───────────────────────────────────────────────────────────

function DocReviewModal({
  item, schema, isBlocked, isApproved, manualValues,
  computedDerivations, splitIssues, packageTypes, sourcePanelOpen, approving, showPreview,
  bolDocument, bolDocumentLoading, brokerDocument, brokerDocumentLoading,
  brokerSourceExtractedData,
  onClose, onManualChange, onPackageTypeChange, onAddLineItemRow, onRemoveLineItemRow, onApprove, onPreview,
  onToggleSourcePanel, onSetShowPreview,
}: {
  item:                GenQueueItem;
  schema:              DocGenSchema;
  isBlocked:           boolean;
  isApproved:          boolean;
  manualValues:        Record<string, string>;
  computedDerivations: { fields: Record<string, string>; rowMap: Record<string, Record<string, string>[]> };
  splitIssues:         string[];
  packageTypes:        string[];
  sourcePanelOpen:     boolean;
  approving:           boolean;
  showPreview:         boolean;
  bolDocument:         DocumentDetailRecord | null;
  bolDocumentLoading:  boolean;
  brokerDocument:      DocumentDetailRecord | null;
  brokerDocumentLoading: boolean;
  brokerSourceExtractedData: SourceExtractedData | null;
  onClose:             () => void;
  onManualChange:      (key: string, v: string) => void;
  onPackageTypeChange: (rowIndex: number, value: string, customTypes: string[]) => void;
  onAddLineItemRow:    (sectionLabel: string, rowIndex: number) => void;
  onRemoveLineItemRow: (sectionLabel: string, rowIndex: number) => void;
  onApprove:           () => void;
  onPreview:           () => void;
  onToggleSourcePanel: () => void;
  onSetShowPreview:    (v: boolean) => void;
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  const isEntrySummaryReview = schema.docType === 'draft-boe';
  const [sourcePopup, setSourcePopup] = useState<'bol' | 'broker' | null>(null);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 8000,
          background: 'hsla(0,0%,0%,0.50)',
          backdropFilter: 'blur(3px)',
        }}
      />

      {/* Dialog */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', zIndex: 8001,
          top: 18, left: 18, right: 18, bottom: 18,
          margin: 0, maxWidth: 'none', maxHeight: 'none',
          background: 'hsl(var(--background))',
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          boxShadow: '0 32px 100px hsla(0,0%,0%,0.28)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Modal header ── */}
        <div style={{ flexShrink: 0, background: 'hsl(var(--card))', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{
            padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {/* Title */}
            <div style={{ minWidth: 0, flexShrink: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0, color: FG, margin: 0, whiteSpace: 'nowrap' }}>
                  {isBlocked ? 'Waiting:' : isApproved ? 'Approved:' : 'Draft:'}{' '}{docGenerationDisplayName(schema.docType, schema.displayName)}
                </h2>
                {isApproved && (
                  <Badge intent="success" size="sm" leadingIcon={<CheckCircle2 className="size-3" />}>Approved</Badge>
                )}
              </div>
              <p style={{ fontSize: 11.5, color: MUTED, margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ ...MONO }}>{item.invoiceNo}</span>
                {(item.shipmentRef ?? '').trim() && <> &middot; <span style={{ ...MONO }}>{item.shipmentRef}</span></>}
                &nbsp;&middot;&nbsp; Source: {schema.sourceDocs.map(d => d.label).join(' + ')}
              </p>
            </div>

            <div style={{ flex: 1 }} />

            {/* Source doc toggle */}
            {!isBlocked && !isEntrySummaryReview && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onToggleSourcePanel}
                className="shrink-0 gap-1.5"
              >
                <FileText className="size-3.5" />
                {sourcePanelOpen ? 'Hide source' : 'View source doc'}
              </Button>
            )}

            {!isBlocked && <OverflowMenu />}

            {/* Close */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close document generation review"
              title="Close"
              onClick={onClose}
              className="shrink-0"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* ── Modal body: source panel | editor ── */}
        <div style={{
          flex: 1, overflow: 'hidden', minHeight: 0, display: 'grid',
          gridTemplateColumns: isEntrySummaryReview && !isBlocked
            ? 'minmax(0, 1fr) minmax(0, 1fr)'
            : sourcePanelOpen && !isBlocked ? '280px 1fr' : '1fr',
          gridTemplateRows: '1fr',
          transition: 'grid-template-columns 0.15s ease',
        }}>
          {sourcePanelOpen && !isBlocked && !isEntrySummaryReview && (
            <SourceDocPanel schema={schema} onClose={onToggleSourcePanel} />
          )}

          {/* Draft editor column */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            {isEntrySummaryReview && !isBlocked && (
              <div style={{
                flexShrink: 0,
                padding: '10px 24px',
                borderBottom: `1px solid ${BORDER}`,
                background: 'hsl(var(--card))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: FG }}>Generated Draft CBP FORM 7501</div>
                  <div style={{ fontSize: 11, color: MUTED }}>Bill of Lading source</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setSourcePopup('bol')} className="shrink-0 gap-1.5">
                  <FileText className="size-3.5" />
                  Source BOL
                </Button>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px 4px' }}>
              {isBlocked ? (
                <div style={{ background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '22px 26px' }}>
                  <BlockedView item={item} schema={schema} />
                </div>
              ) : (
                <>
                  {/* Trigger + counts banner */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: SEMANTIC_SURFACE.info.background, border: SEMANTIC_SURFACE.info.border,
                    borderRadius: 8, padding: '8px 14px', fontSize: 12, color: FG,
                    marginBottom: 14,
                  }}>
                    <Info size={13} style={{ flexShrink: 0, color: BLUE }} />
                    <span>
                      Trigger: <strong>{schema.triggerCondition}</strong>
                      &nbsp;·&nbsp;
                      <strong>{schema.fieldCounts.auto + schema.fieldCounts.calculated}/{schema.fieldCounts.total}</strong> fields auto-populated
                      {schema.fieldCounts.manual > 0 && (
                        <> · <strong style={{ color: MUTED }}>{schema.fieldCounts.manual} manual field{schema.fieldCounts.manual !== 1 ? 's' : ''}</strong> need your input</>
                      )}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>
                      Draft v1 · Created {relativeTime(item.createdAt)}
                    </span>
                  </div>

                  <ActionRequiredCard schema={schema} manualValues={manualValues} onManualChange={onManualChange} readOnly={isApproved} />

                  {schema.sections.map(section => {
                    const hasManual = section.mappings.some(m => m.mappingType === 'manual' || m.mappingType === 'conditional');
                    return (
                      <CollapsibleSectionBlock
                        key={section.sectionLabel}
                        section={section}
                        schema={schema}
                        manualValues={manualValues}
                        onManualChange={onManualChange}
                        packageTypes={packageTypes}
                        onPackageTypeChange={onPackageTypeChange}
                        onAddLineItemRow={onAddLineItemRow}
                        onRemoveLineItemRow={onRemoveLineItemRow}
                        allowLineItemSplit={!isApproved}
                        readOnly={isApproved}
                        computedFields={computedDerivations.fields}
                        computedRowMap={computedDerivations.rowMap}
                        defaultExpanded={hasManual}
                      />
                    );
                  })}
                </>
              )}
            </div>

            {!isBlocked && (
              <StickyReviewFooter
                schema={schema}
                manualValues={manualValues}
                computedFields={computedDerivations.fields}
                computedRowMap={computedDerivations.rowMap}
                splitIssues={splitIssues}
                isApproved={isApproved}
                isBlocked={isBlocked}
                onApprove={onApprove}
                onPreview={onPreview}
                approving={approving}
              />
            )}
          </div>
          {isEntrySummaryReview && !isBlocked && (
            <BrokerExtractionPanel
              document={brokerDocument}
              loading={brokerDocumentLoading}
              schema={schema}
              onOpenSource={() => setSourcePopup('broker')}
              snapshot={brokerSourceExtractedData}
            />
          )}
        </div>
      </div>

      {/* Document preview — layered above the review modal */}
      {showPreview && (
        <DocumentPreviewModal
          schema={schema}
          manualValues={manualValues}
          computedFields={computedDerivations.fields}
          computedRowMap={computedDerivations.rowMap}
          isApproved={isApproved}
          onClose={() => onSetShowPreview(false)}
        />
      )}

      {sourcePopup === 'bol' && (
        <SourceDocumentPopup
          title="Source Bill of Lading"
          document={bolDocument}
          loading={bolDocumentLoading}
          comparisonTitle="Generated Draft CBP FORM 7501"
          comparison={
            <GeneratedDraftComparisonPanel
              schema={schema}
              manualValues={manualValues}
              computedFields={computedDerivations.fields}
              computedRowMap={computedDerivations.rowMap}
            />
          }
          onClose={() => setSourcePopup(null)}
        />
      )}
      {sourcePopup === 'broker' && (
        <SourceDocumentPopup
          title="Draft CBP FORM 7501 Broker Source"
          document={brokerDocument}
          loading={brokerDocumentLoading}
          comparisonTitle="DRAFT_CBP_FORM_7501_BROKER Extracted Fields"
          comparison={<BrokerExtractionPanel document={brokerDocument} loading={brokerDocumentLoading} schema={schema} snapshot={brokerSourceExtractedData} />}
          onClose={() => setSourcePopup(null)}
        />
      )}
    </>
  );
}

// ─── Page skeleton (shared for loading/error/empty states) ────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ewms-page-shell" style={{ display: 'flex', flexDirection: 'column', height: '100%', paddingTop: 12, paddingBottom: 16 }}>
      {children}
    </div>
  );
}

function stringifyDraftValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function isDraftBlank(value: string | undefined): boolean {
  const normalized = (value ?? '').trim();
  return !normalized || normalized === '-' || normalized === '—' || normalized === '–' || normalized === 'â€”';
}

const PACKING_LIST_SPLIT_FIELDS = [
  { key: 'totalQtyInPcs', sourceKey: '_sourceTotalQtyInPcs', label: 'quantity' },
  { key: 'noOfBundles', sourceKey: '_sourceNoOfBundles', label: 'bundles' },
  { key: 'netWeightKgs', sourceKey: '_sourceNetWeightKgs', label: 'net weight' },
  { key: 'grossWeightKgs', sourceKey: '_sourceGrossWeightKgs', label: 'gross weight' },
] as const;

const PACKING_LIST_SPLIT_META_KEYS = [
  '_sourceLineKey',
  '_sourceTotalQtyInPcs',
  '_sourceNoOfBundles',
  '_sourceNetWeightKgs',
  '_sourceGrossWeightKgs',
  '_splitRow',
] as const;

function numericDraftValue(value: unknown): number | null {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw || isDraftBlank(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineSourceKey(row: Record<string, unknown>, rowIndex: number): string {
  const existing = String(row._sourceLineKey ?? '').trim();
  if (existing) return existing;
  return [
    row.productCode,
    row.itemCode,
    row.hsnCode,
    row.containerNo,
    row.sealNo,
    rowIndex,
  ].map(value => String(value ?? '').trim().toUpperCase()).join('|');
}

function rowVisibleValue(
  sectionLabel: string,
  rowIndex: number,
  field: string,
  row: Record<string, string>,
  manualValues: Record<string, string>,
  computedRowMap: Record<string, Record<string, string>[]>,
): string {
  return String(
    manualValues[`${sectionLabel}.${rowIndex}.${field}`]
    ?? computedRowMap[sectionLabel]?.[rowIndex]?.[field]
    ?? row[field]
    ?? '',
  );
}

function splitSourceValue(row: Record<string, string>, field: typeof PACKING_LIST_SPLIT_FIELDS[number]): number | null {
  return numericDraftValue(row[field.sourceKey] ?? row[field.key]);
}

function packingListSplitIssues(
  schema: DocGenSchema | undefined,
  manualValues: Record<string, string>,
  computedRowMap: Record<string, Record<string, string>[]>,
): string[] {
  if (!schema || schema.docType !== 'packing-list') return [];
  const sectionLabel = 'Line Items';
  const rows = schema.mockData.tables[sectionLabel] ?? [];
  const grouped = new Map<string, Array<{ row: Record<string, string>; index: number }>>();
  rows.forEach((row, index) => {
    const key = lineSourceKey(row, index);
    grouped.set(key, [...(grouped.get(key) ?? []), { row, index }]);
  });

  const issues: string[] = [];
  rows.forEach((row, index) => {
    const netWeight = numericDraftValue(rowVisibleValue(sectionLabel, index, 'netWeightKgs', row, manualValues, computedRowMap));
    const grossWeight = numericDraftValue(rowVisibleValue(sectionLabel, index, 'grossWeightKgs', row, manualValues, computedRowMap));
    if (netWeight === null || grossWeight === null) return;
    if (grossWeight <= netWeight) {
      const product = String(row.productCode || row.itemCode || row.productDesc || `line ${index + 1}`);
      issues.push(`${product}: gross weight must be greater than net weight`);
    }
  });
  grouped.forEach((items) => {
    const sourceRow = items.find(item => item.row._splitRow !== 'true')?.row ?? items[0].row;
    const product = String(sourceRow.productCode || sourceRow.itemCode || sourceRow.productDesc || 'line item');
    for (const field of PACKING_LIST_SPLIT_FIELDS) {
      const sourceTotal = splitSourceValue(sourceRow, field);
      if (sourceTotal === null) continue;
      if (items.length <= 1) {
        const item = items[0];
        const visibleValue = numericDraftValue(rowVisibleValue(sectionLabel, item.index, field.key, item.row, manualValues, computedRowMap));
        if (visibleValue === null) continue;
        if (Math.abs(visibleValue - sourceTotal) > 0.01) {
          issues.push(`${product}: ${field.label} ${visibleValue.toLocaleString('en-US')} must match source ${sourceTotal.toLocaleString('en-US')}`);
        }
        continue;
      }
      const splitTotal = items.reduce((sum, item) => (
        sum + (numericDraftValue(rowVisibleValue(sectionLabel, item.index, field.key, item.row, manualValues, computedRowMap)) ?? 0)
      ), 0);
      if (Math.abs(splitTotal - sourceTotal) > 0.01) {
        issues.push(`${product}: ${field.label} split total ${splitTotal.toLocaleString('en-US')} must equal source ${sourceTotal.toLocaleString('en-US')}`);
      }
    }
  });
  return issues;
}

function draftValueOr(...values: Array<string | undefined>): string {
  return values.find(value => !isDraftBlank(value)) ?? '';
}

function draftToSchema(baseSchema: DocGenSchema, draft: DraftPayload): DocGenSchema {
  const isWarehouseOutwardDraft =
    draft.generatedDocType === 'US_PACKING_LIST' &&
    (draft.sourceDocs.includes('WAREHOUSE_STOCK') || Boolean(draft.sourceDocumentIds.WAREHOUSE_STOCK));

  if (isWarehouseOutwardDraft) {
    const warehouse = draft.outwardDispatch?.warehouse ?? null;
    const fields: Record<string, string> = {};
    const sections: GenSection[] = draft.sections.map(section => ({
      sectionLabel: section.sectionLabel,
      renderAs: 'fields',
      mappings: section.fields.map(field => {
        fields[field.targetField] = stringifyDraftValue(field.value);
        const filledManual = field.mappingType === 'manual' && stringifyDraftValue(field.value).trim();
        return {
          targetField: field.targetField,
          targetLabel: field.targetLabel,
          sourceDoc: filledManual ? 'WAREHOUSE_DISPATCH' : field.sourceDoc,
          sourceField: field.sourceField ?? '',
          sourceLabel: filledManual ? 'New Outward Dispatch' : (field.sourceLabel ?? field.sourceDoc),
          mappingType: filledManual ? 'direct' : field.mappingType,
          validation: field.validation ?? undefined,
          validationSeverity: field.validationSeverity ?? undefined,
          mono: field.mono,
        };
      }),
    }));

    const lineMappings: FieldMapping[] = [
      { targetField: 'lineNo', targetLabel: 'Line', sourceDoc: 'CALCULATED', sourceField: 'lineNo', sourceLabel: 'Line number', mappingType: 'derived', mono: true, isLineItem: true },
      { targetField: 'productCode', targetLabel: 'Part Number', sourceDoc: 'WAREHOUSE_STOCK', sourceField: 'productCode', sourceLabel: 'Selected stock/product', mappingType: 'direct', mono: true, isLineItem: true },
      { targetField: 'productDesc', targetLabel: 'Description', sourceDoc: 'WAREHOUSE_STOCK', sourceField: 'productDesc', sourceLabel: 'Selected stock/product', mappingType: 'direct', isLineItem: true },
      { targetField: 'containerNo', targetLabel: 'Container No', sourceDoc: 'BILL_OF_LADING', sourceField: 'containerNo', sourceLabel: 'BOL container matched from selected line', mappingType: 'direct', mono: true, isLineItem: true },
      { targetField: 'deliveryDate', targetLabel: 'Delivery Date', sourceDoc: 'WAREHOUSE_DISPATCH', sourceField: 'deliveryDate', sourceLabel: 'User input', mappingType: 'manual', mono: true, isLineItem: true },
      { targetField: 'totalQtyInPcs', targetLabel: 'Qty Pieces', sourceDoc: 'WAREHOUSE_DISPATCH', sourceField: 'quantityDispatched', sourceLabel: 'User input', mappingType: 'manual', mono: true, isLineItem: true },
      { targetField: 'packageType', targetLabel: 'Package Type', sourceDoc: 'WAREHOUSE_DISPATCH', sourceField: 'packageType', sourceLabel: 'User input / stock package', mappingType: 'manual', isLineItem: true },
      { targetField: 'noOfBundles', targetLabel: 'Bundles', sourceDoc: 'PACKING_LIST', sourceField: 'noOfBundles', sourceLabel: 'Approved Packing List Stock', mappingType: 'direct', mono: true, isLineItem: true },
      { targetField: 'netWeightKgs', targetLabel: 'Net Weight', sourceDoc: 'PACKING_LIST', sourceField: 'netWeightKgs', sourceLabel: 'Approved Packing List Stock', mappingType: 'direct', mono: true, isLineItem: true },
      { targetField: 'grossWeightKgs', targetLabel: 'Gross Weight', sourceDoc: 'PACKING_LIST', sourceField: 'grossWeightKgs', sourceLabel: 'Approved Packing List Stock', mappingType: 'direct', mono: true, isLineItem: true },
    ];

    sections.push({
      sectionLabel: 'Line Items',
      renderAs: 'table',
      mappings: lineMappings,
    });

    const lineItems = draft.lineItems.map(row => Object.fromEntries(
      lineMappings.map(mapping => [mapping.targetField, stringifyDraftValue(row[mapping.targetField])]),
    ));
    fields.grnDate = draftValueOr(fields.documentDate, fields.grnDate);
    fields.additionalDetails = draftValueOr(fields.additionalDetails, fields.bolRef);
    fields.bolRef = draftValueOr(fields.bolRef, fields.additionalDetails);
    fields.plRef = draftValueOr(fields.plRef, 'Approved Packing List Stock');
    fields.warehouseName = draftValueOr(fields.warehouseName, stringifyDraftValue(warehouse?.name));
    fields.warehouseAddress = draftValueOr(fields.warehouseAddress, stringifyDraftValue(warehouse?.address));
    fields.threePlName = draftValueOr(fields.threePlName, fields.warehouseName);
    fields.threePlAddress = draftValueOr(fields.threePlAddress, fields.warehouseAddress);
    fields.shipperName = draftValueOr(fields.shipperName, fields.warehouseName);
    fields.shipperAddress = draftValueOr(fields.shipperAddress, fields.warehouseAddress);
    fields.shipTo = draftValueOr(fields.shipTo, fields.destinationName, stringifyDraftValue(draft.outwardDispatch?.destinationName));
    fields.shipToAddress = draftValueOr(fields.shipToAddress, fields.destinationAddress, stringifyDraftValue(draft.outwardDispatch?.destinationAddress));
    fields.consigneeName = draftValueOr(fields.consigneeName, 'Unimatics');
    fields.consigneeAddress = draftValueOr(fields.consigneeAddress, 'Unimatics Manufacturing Mx,LLC\n14600 Arville Street\nSloan, NV 89054\nUSA');
    fields.totalBundles = draftValueOr(fields.totalBundles);
    fields.totalNetWeightLbs = draftValueOr(fields.totalNetWeightLbs, fields.totalNetWeightKgs);
    fields.totalGrossWeightLbs = draftValueOr(fields.totalGrossWeightLbs, fields.totalGrossWeightKgs);
    const fieldCount = Object.keys(fields).length;
    const lineCount = lineItems.length * lineMappings.length;

    return {
      ...baseSchema,
      displayName: 'Outward GRN',
      triggerCondition: 'Warehouse outward dispatch created from approved Packing List stock',
      sourceDocs: [
        { docType: 'WAREHOUSE_STOCK', label: 'Approved Packing List Stock' },
        { docType: 'WAREHOUSE_DISPATCH', label: 'New Outward Dispatch' },
      ],
      humanAction: 'Review the outward dispatch and approve the GRN',
      fieldCounts: {
        auto: fieldCount + lineCount,
        calculated: 0,
        manual: 0,
        total: fieldCount + lineCount,
      },
      sections,
      mockData: {
        fields,
        tables: { 'Line Items': lineItems },
      },
    };
  }

  if (draft.generatedDocType === 'ENTRY_SUMMARY') {
    const sourceDocs = [
      { docType: 'BILL_OF_LADING', label: 'Bill of Lading' },
      { docType: 'SALES_INVOICE', label: 'Sales Invoice' },
    ];
    const sections: GenSection[] = draft.sections.map(section => ({
      sectionLabel: section.sectionLabel,
      renderAs: 'fields',
      mappings: section.fields.map(field => ({
        targetField: field.targetField,
        targetLabel: field.targetLabel,
        sourceDoc: field.sourceDoc,
        sourceField: field.sourceField ?? '',
        sourceLabel: field.sourceLabel ?? field.sourceDoc,
        mappingType: field.mappingType,
        validation: field.validation ?? undefined,
        validationSeverity: field.validationSeverity ?? undefined,
        mono: field.mono,
      })),
    }));
    const tariffMappings: FieldMapping[] = [
      { targetField: 'lineNo', targetLabel: 'Line No', sourceDoc: 'CALCULATED', sourceField: 'row number', sourceLabel: 'Calculated', mappingType: 'derived', mono: true, isLineItem: true },
      { targetField: 'lineMerchandiseDescription', targetLabel: 'Merchandise Description', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productDescription', sourceLabel: 'Sales Invoice', mappingType: 'direct', isLineItem: true },
      { targetField: 'lineHtsusNumber', targetLabel: 'HTSUS Number', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Tariff master / broker', mappingType: 'manual', mono: true, isLineItem: true },
      { targetField: 'quantity', targetLabel: 'Quantity', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].quantity', sourceLabel: 'Sales Invoice', mappingType: 'direct', mono: true, isLineItem: true },
      { targetField: 'quantityUnit', targetLabel: 'Unit', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].unit', sourceLabel: 'Sales Invoice', mappingType: 'direct', isLineItem: true },
      { targetField: 'enteredValue', targetLabel: 'Entered Value', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].lineTotal', sourceLabel: 'Sales Invoice', mappingType: 'direct', mono: true, isLineItem: true },
      { targetField: 'dutyRate', targetLabel: 'Duty Rate (%)', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Tariff master', mappingType: 'manual', mono: true, isLineItem: true },
      { targetField: 'dutyAmount', targetLabel: 'Duty Amount', sourceDoc: 'CALCULATED', sourceField: 'enteredValue * dutyRate', sourceLabel: 'Calculated', mappingType: 'derived', mono: true, isLineItem: true },
    ];
    sections.splice(Math.max(0, sections.length - 2), 0, {
      sectionLabel: 'Tariff Lines',
      renderAs: 'table',
      mappings: tariffMappings,
    });
    const fields = Object.fromEntries(
      draft.sections.flatMap(section => section.fields.map(field => [field.targetField, stringifyDraftValue(field.value)])),
    );
    return {
      ...baseSchema,
      displayName: 'Draft CBP FORM 7501',
      triggerCondition: 'Bill of Lading and Sales Invoice extracted',
      sourceDocs,
      humanAction: 'Complete broker and filing fields, assign tariff rates, and review calculated duties and fees',
      fieldCounts: {
        auto: draft.stats.auto ?? 0,
        calculated: draft.stats.calc ?? 0,
        manual: draft.stats.manual ?? 0,
        total: draft.stats.total ?? 0,
      },
      sections,
      mockData: {
        fields,
        tables: {
          'Tariff Lines': draft.lineItems.map(row => Object.fromEntries(
            tariffMappings.map(mapping => [mapping.targetField, stringifyDraftValue(row[mapping.targetField])]),
          )),
        },
      },
    };
  }

  const fields: Record<string, string> = {};
  for (const section of draft.sections) {
    for (const field of section.fields) {
      fields[field.targetField] = stringifyDraftValue(field.value);
    }
  }

  const tables: Record<string, Record<string, string>[]> = {};
  const lineItemSection = baseSchema.sections.find((section) => section.renderAs === 'table' && section.sectionLabel === 'Line Items');
  if (lineItemSection) {
    tables[lineItemSection.sectionLabel] = draft.lineItems.map((row) => {
      const normalized: Record<string, string> = Object.fromEntries(
        PACKING_LIST_SPLIT_META_KEYS.map(key => [key, stringifyDraftValue(row[key])]).filter(([, value]) => value),
      );
      for (const mapping of lineItemSection.mappings) {
        normalized[mapping.targetField] = stringifyDraftValue(row[mapping.targetField]);
      }
      return normalized;
    });
  }

  for (const section of baseSchema.sections.filter((section) => section.renderAs === 'table')) {
    if (!tables[section.sectionLabel]) {
      tables[section.sectionLabel] = baseSchema.mockData.tables[section.sectionLabel] ?? [];
    }
  }

  return {
    ...baseSchema,
    displayName: draft.displayName || baseSchema.displayName,
    mockData: {
      fields: { ...baseSchema.mockData.fields, ...fields },
      tables: { ...baseSchema.mockData.tables, ...tables },
    },
  };
}

function draftToQueueItem(draft: DraftPayload, schema: DocGenSchema): GenQueueItem {
  const fieldMap = Object.fromEntries(
    draft.sections.flatMap((section) => section.fields.map((field) => [field.targetField, field.value])),
  ) as Record<string, string | null>;
  const isWarehouseOutwardDraft =
    draft.generatedDocType === 'US_PACKING_LIST' &&
    (draft.sourceDocs.includes('WAREHOUSE_STOCK') || Boolean(draft.sourceDocumentIds.WAREHOUSE_STOCK));

  return {
    id: draft.draftId,
    shipmentRef: isWarehouseOutwardDraft ? '' : (fieldMap.exporterRef || fieldMap.zetwerkRef || ''),
    invoiceNo: isWarehouseOutwardDraft
      ? (fieldMap.dispatchNumber || 'Outward GRN')
      : (fieldMap.invoiceNo || 'Sales Invoice'),
    docType: schema.docType,
    status: draft.status === 'GENERATED' ? 'generated' : 'draft',
    createdAt: draft.createdAt || draft.updatedAt || new Date().toISOString(),
    prerequisites: [
      {
        key: isWarehouseOutwardDraft ? 'warehouse-dispatch-created' : 'sales-invoice-approved',
        label: isWarehouseOutwardDraft ? 'Warehouse outward dispatch created' : 'Sales Invoice extraction available',
        met: isWarehouseOutwardDraft ? true : Boolean(draft.sourceDocumentIds.SALES_INVOICE),
        actionHint: isWarehouseOutwardDraft ? 'Create an outward dispatch from Warehouse stock' : 'Approve a Sales Invoice extraction in Upload & Process',
      },
    ],
  };
}

function routeTypeToGeneratedDocType(type: string | undefined): DraftPayload['generatedDocType'] {
  if (type === 'packing-list' || type === 'PACKING_LIST') return 'PACKING_LIST';
  if (type === 'outward-grn' || type === 'outward-pl' || type === 'us-packing-list' || type === 'US_PACKING_LIST') return 'US_PACKING_LIST';
  if (type === 'draft-boe' || type === 'entry-summary' || type === 'ENTRY_SUMMARY') return 'ENTRY_SUMMARY';
  return 'PACKING_LIST';
}

function generatedDocTypeToSchemaKey(type: DraftPayload['generatedDocType']): string {
  if (type === 'PACKING_LIST') return 'packing-list';
  if (type === 'US_PACKING_LIST') return 'outward-grn';
  return 'draft-boe';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DocumentGeneratePage() {
  const params = useParams<{ type?: string }>();
  const [location, navigate] = useLocation();
  const { setPageMeta } = usePageMeta();
  const { activities, docTypes, documentScope, activityDocTypes, loaded: permissionsLoaded } = usePermissions();
  const routeType = params.type
    ?? (location.endsWith('/boe') ? 'draft-boe' : location.endsWith('/packing-list') ? 'packing-list' : undefined);
  const generationOptions = useMemo(
    () => allowedDocGenerationOptions({ activities, docTypes, documentScope, activityDocTypes }),
    [activities, activityDocTypes, docTypes, documentScope],
  );
  const currentGeneratedDocType = routeTypeToGeneratedDocType(routeType);
  const currentGenerationOption = generationOptions.find((option) => option.generatedDocType === currentGeneratedDocType);
  const isCurrentGenerationAllowed = !!currentGenerationOption;
  const isOutwardDocGenerationRoute =
    routeType === 'outward-grn' || routeType === 'outward-pl' || routeType === 'us-packing-list' || routeType === 'US_PACKING_LIST';
  const [search,         setSearch]         = useState('');
  const [queueFilter,    setQueueFilter]     = useState<QueueFilter>('all');
  const [reviewingItem,  setReviewingItem]   = useState<GenQueueItem | null>(null);
  const [approving,      setApproving]       = useState(false);
  const [manualValues,   setManualValues]    = useState<Record<string, string>>({});
  const [showPreview,    setShowPreview]     = useState(false);

  useEffect(() => {
    setPageMeta({ title: 'Document Generation', subtitle: 'AI-drafted documents for review & approval' });
    return () => setPageMeta(null);
  }, [setPageMeta]);

  useEffect(() => {
    const handleModuleSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; value: string }>).detail;
      if (detail.scope !== 'doc-generation' && detail.scope !== 'all') return;
      setSearch(detail.value);
    };
    window.addEventListener('ewms-module-search', handleModuleSearch);
    return () => window.removeEventListener('ewms-module-search', handleModuleSearch);
  }, []);

  const [sourcePanelOpen, setSourcePanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('docgen-source-panel-open') === 'true'; } catch { return false; }
  });

  function toggleSourcePanel() {
    setSourcePanelOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('docgen-source-panel-open', next ? 'true' : 'false'); } catch {}
      return next;
    });
  }

  function handleManualChange(key: string, v: string) {
    if (isApproved) return;
    setManualValues(prev => ({ ...prev, [key]: v }));
  }

  function shiftManualRowsForInsert(sectionLabel: string, afterRowIndex: number) {
    setManualValues((current) => {
      const next: Record<string, string> = {};
      const prefix = `${sectionLabel}.`;
      for (const [key, value] of Object.entries(current)) {
        if (!key.startsWith(prefix)) {
          next[key] = value;
          continue;
        }
        const rest = key.slice(prefix.length);
        const dotIndex = rest.indexOf('.');
        const rowIndex = Number(rest.slice(0, dotIndex));
        if (!Number.isFinite(rowIndex) || dotIndex < 0) {
          next[key] = value;
          continue;
        }
        const field = rest.slice(dotIndex + 1);
        const nextRowIndex = rowIndex > afterRowIndex ? rowIndex + 1 : rowIndex;
        next[`${sectionLabel}.${nextRowIndex}.${field}`] = value;
      }
      return next;
    });
  }

  function shiftManualRowsForRemove(sectionLabel: string, removedRowIndex: number) {
    setManualValues((current) => {
      const next: Record<string, string> = {};
      const prefix = `${sectionLabel}.`;
      for (const [key, value] of Object.entries(current)) {
        if (!key.startsWith(prefix)) {
          next[key] = value;
          continue;
        }
        const rest = key.slice(prefix.length);
        const dotIndex = rest.indexOf('.');
        const rowIndex = Number(rest.slice(0, dotIndex));
        if (!Number.isFinite(rowIndex) || dotIndex < 0) {
          next[key] = value;
          continue;
        }
        if (rowIndex === removedRowIndex) continue;
        const field = rest.slice(dotIndex + 1);
        const nextRowIndex = rowIndex > removedRowIndex ? rowIndex - 1 : rowIndex;
        next[`${sectionLabel}.${nextRowIndex}.${field}`] = value;
      }
      return next;
    });
  }

  function handleAddLineItemRow(sectionLabel: string, rowIndex: number) {
    if (!liveReviewingItem || !schema || schema.docType !== 'packing-list') return;
    const rows = schema.mockData.tables[sectionLabel] ?? [];
    const sourceRow = rows[rowIndex];
    if (!sourceRow) return;
    const sourceLineKey = lineSourceKey(sourceRow, rowIndex);
    const sourceTotals = Object.fromEntries(PACKING_LIST_SPLIT_FIELDS.map(field => [
      field.sourceKey,
      String(sourceRow[field.sourceKey] ?? sourceRow[field.key] ?? ''),
    ]));
    const rowWithSource = {
      ...sourceRow,
      _sourceLineKey: sourceLineKey,
      ...sourceTotals,
    };
    const splitRow: Record<string, string> = {
      ...rowWithSource,
      lineNo: '',
      totalQtyInPcs: '',
      noOfBundles: '',
      qtyPerBundle: '',
      netWeightKgs: '',
      grossWeightKgs: '',
      _splitRow: 'true',
    };
    const nextRows = rows.map((row, index) => index === rowIndex ? rowWithSource : row);
    nextRows.splice(rowIndex + 1, 0, splitRow);
    shiftManualRowsForInsert(sectionLabel, rowIndex);
    setDraftSchemas((current) => ({
      ...current,
      [liveReviewingItem.id]: {
        ...schema,
        mockData: {
          ...schema.mockData,
          tables: {
            ...schema.mockData.tables,
            [sectionLabel]: nextRows,
          },
        },
      },
    }));
  }

  function handleRemoveLineItemRow(sectionLabel: string, rowIndex: number) {
    if (!liveReviewingItem || !schema || schema.docType !== 'packing-list') return;
    const rows = schema.mockData.tables[sectionLabel] ?? [];
    const removedRow = rows[rowIndex];
    if (removedRow?._splitRow !== 'true') return;

    const sourceLineKey = lineSourceKey(removedRow, rowIndex);
    const nextRows = rows.filter((_, index) => index !== rowIndex);
    const originalRowIndex = nextRows.findIndex((row, index) => (
      row._splitRow !== 'true' && lineSourceKey(row, index) === sourceLineKey
    ));
    const hasRemainingSplitForSource = nextRows.some((row, index) => (
      row._splitRow === 'true' && lineSourceKey(row, index) === sourceLineKey
    ));
    const restoreOriginalValues = originalRowIndex >= 0 && !hasRemainingSplitForSource;

    shiftManualRowsForRemove(sectionLabel, rowIndex);
    if (restoreOriginalValues) {
      const originalRow = nextRows[originalRowIndex];
      const restoredValues = Object.fromEntries(PACKING_LIST_SPLIT_FIELDS.map(field => [
        field.key,
        String(originalRow[field.sourceKey] ?? originalRow[field.key] ?? ''),
      ]));
      setManualValues((current) => {
        const next = { ...current };
        for (const [field, value] of Object.entries(restoredValues)) {
          next[`${sectionLabel}.${originalRowIndex}.${field}`] = value;
        }
        delete next[`${sectionLabel}.${originalRowIndex}.qtyPerBundle`];
        return next;
      });
    }
    setDraftSchemas((current) => ({
      ...current,
      [liveReviewingItem.id]: {
        ...schema,
        mockData: {
          ...schema.mockData,
          tables: {
            ...schema.mockData.tables,
            [sectionLabel]: nextRows,
          },
        },
      },
    }));
  }

  async function handlePackageTypeChange(rowIndex: number, value: string, customTypes: string[]) {
    if (!liveReviewingItem) return;
    try {
      await apiPatch(`/doc-generation/drafts/${liveReviewingItem.id}/package-type`, {
        lineItemIndex: rowIndex,
        packageType: value,
        customPackageTypes: customTypes,
      });
      setDraftPackageTypes(prev => ({ ...prev, [liveReviewingItem.id]: customTypes }));
      setDraftSchemas(prev => {
        const current = prev[liveReviewingItem.id];
        if (!current) return prev;
        const rows = current.mockData.tables['Line Items']?.map((row, index) => (
          index === rowIndex ? { ...row, kindOfPkg: value } : row
        ));
        return {
          ...prev,
          [liveReviewingItem.id]: {
            ...current,
            mockData: {
              ...current.mockData,
              tables: { ...current.mockData.tables, 'Line Items': rows ?? [] },
            },
          },
        };
      });
      toast.success('Package type saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save package type');
    }
  }

  // ── Live data from API ──────────────────────────────────────────────────────
  const [rawQueue, setRawQueue] = useState<GenQueueItem[]>([]);
  const [draftSchemas, setDraftSchemas] = useState<Record<string, DocGenSchema>>({});
  const [draftPayloads, setDraftPayloads] = useState<Record<string, DraftPayload>>({});
  const [draftPackageTypes, setDraftPackageTypes] = useState<Record<string, string[]>>({});
  const [bolDocument, setBolDocument] = useState<DocumentDetailRecord | null>(null);
  const [bolDocumentLoading, setBolDocumentLoading] = useState(false);
  const [brokerDocument, setBrokerDocument] = useState<DocumentDetailRecord | null>(null);
  const [brokerDocumentLoading, setBrokerDocumentLoading] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    if (!permissionsLoaded) return;
    if (!generationOptions.length || !isCurrentGenerationAllowed) {
      setRawQueue([]);
      setDraftSchemas({});
      setDraftPayloads({});
      setDraftPackageTypes({});
      setLoading(false);
      return;
    }
    if (isOutwardDocGenerationRoute) {
      setRawQueue([]);
      setDraftSchemas({});
      setDraftPayloads({});
      setDraftPackageTypes({});
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setFetchErr(null);
      const generatedDocType = routeTypeToGeneratedDocType(routeType);
      const schemaKey = generatedDocTypeToSchemaKey(generatedDocType);
      const baseSchema = DOC_GEN_SCHEMAS[schemaKey] as DocGenSchema | undefined;
      if (!baseSchema) throw new Error(`Unsupported document generation type: ${routeType ?? 'packing-list'}`);

      let drafts = await apiGet<DraftPayload[]>(`/doc-generation/drafts?generatedDocType=${generatedDocType}`);
      if (drafts.length === 0 && generatedDocType === 'PACKING_LIST') {
        drafts = [await apiPost<DraftPayload>('/doc-generation/drafts', {
          generatedDocType,
          sourceDocumentIds: {},
        })];
      }
      const schemas: Record<string, DocGenSchema> = {};
      const payloads: Record<string, DraftPayload> = {};
      const packageTypes: Record<string, string[]> = {};
      const queueItems = drafts
        .map((draft) => {
          const hydratedSchema = draftToSchema(baseSchema, draft);
          const queueItem = draftToQueueItem(draft, hydratedSchema);
          schemas[queueItem.id] = hydratedSchema;
          payloads[queueItem.id] = draft;
          packageTypes[queueItem.id] = draft.customPackageTypes ?? [];
          return queueItem;
        })
        .sort((a, b) => {
          const createdDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
          return Number.isNaN(createdDiff) ? 0 : createdDiff;
        });
      setDraftSchemas(schemas);
      setDraftPayloads(payloads);
      setDraftPackageTypes(packageTypes);
      setRawQueue(queueItems);
    } catch (err) {
      setRawQueue([]);
      setDraftSchemas({});
      setDraftPayloads({});
      setDraftPackageTypes({});
      setFetchErr(err instanceof Error ? err.message : 'Could not load generation queue');
    } finally {
      setLoading(false);
    }
  }, [generationOptions.length, isCurrentGenerationAllowed, isOutwardDocGenerationRoute, permissionsLoaded, routeType]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  useEffect(() => {
    if (!permissionsLoaded) return;
    if (!generationOptions.length) {
      navigate('/unauthorized');
      return;
    }
    if (generationOptions.some((option) => option.generatedDocType === currentGeneratedDocType)) return;
    navigate(`/documents/generate/${generationOptions[0].type}`);
  }, [currentGeneratedDocType, generationOptions, navigate, permissionsLoaded]);

  useEffect(() => {
    if (isOutwardDocGenerationRoute) {
      navigate('/inventory/warehouse');
    }
  }, [isOutwardDocGenerationRoute, navigate]);

  // Build queue with recomputed prerequisites based on live server data
  const queue = useMemo(() => rawQueue.map(i => {
    const plSiblingApproved = rawQueue.some(
      other => other.shipmentRef === i.shipmentRef && other.docType === 'packing-list' &&
               other.status === 'generated'
    );
    const updatedPrereqs = i.prerequisites.map(p => ({
      ...p,
      met: p.key === 'pl-approved' ? (plSiblingApproved || p.met) : p.met,
    }));
    return { ...i, prerequisites: updatedPrereqs };
  }), [rawQueue]);

  const filteredQueue = useMemo(() => {
    if (!search.trim()) return queue;
    const q = search.toLowerCase();
    return queue.filter(i =>
      i.invoiceNo.toLowerCase().includes(q) ||
      (i.shipmentRef ?? '').toLowerCase().includes(q) ||
      docGenerationDisplayName(i.docType).toLowerCase().includes(q)
    );
  }, [queue, search]);

  // Keep reviewingItem in sync with latest queue data (status may change after approve)
  const liveReviewingItem = reviewingItem
    ? (queue.find(i => i.id === reviewingItem.id) ?? reviewingItem)
    : null;

  const schema = liveReviewingItem
    ? (draftSchemas[liveReviewingItem.id] ?? DOC_GEN_SCHEMAS[liveReviewingItem.docType]) as DocGenSchema | undefined
    : undefined;

  const brokerSourceDocumentId = liveReviewingItem && schema?.docType === 'draft-boe'
    ? (
      draftPayloads[liveReviewingItem.id]?.sourceDocumentIds?.DRAFT_CBP_FORM_7501_BROKER
      ?? Object.entries(draftPayloads[liveReviewingItem.id]?.sourceDocumentIds ?? {})
        .find(([key]) => key.toUpperCase() === 'DRAFT_CBP_FORM_7501_BROKER')?.[1]
      ?? null
    )
    : null;
  const brokerSourceExtractedData = liveReviewingItem && schema?.docType === 'draft-boe'
    ? (
      draftPayloads[liveReviewingItem.id]?.sourceExtractedData?.DRAFT_CBP_FORM_7501_BROKER
      ?? Object.entries(draftPayloads[liveReviewingItem.id]?.sourceExtractedData ?? {})
        .find(([key]) => key.toUpperCase() === 'DRAFT_CBP_FORM_7501_BROKER')?.[1]
      ?? null
    )
    : null;
  const bolSourceDocumentId = liveReviewingItem && schema?.docType === 'draft-boe'
    ? (
      draftPayloads[liveReviewingItem.id]?.sourceDocumentIds?.BILL_OF_LADING
      ?? Object.entries(draftPayloads[liveReviewingItem.id]?.sourceDocumentIds ?? {})
        .find(([key]) => key.toUpperCase() === 'BILL_OF_LADING')?.[1]
      ?? null
    )
    : null;
  useEffect(() => {
    let cancelled = false;
    if (!bolSourceDocumentId) {
      setBolDocument(null);
      setBolDocumentLoading(false);
      return;
    }
    setBolDocumentLoading(true);
    loadDocumentWithPreview(bolSourceDocumentId)
      .then((document) => {
        if (!cancelled) setBolDocument(document);
      })
      .catch(() => {
        if (!cancelled) setBolDocument(null);
      })
      .finally(() => {
        if (!cancelled) setBolDocumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bolSourceDocumentId]);

  useEffect(() => {
    let cancelled = false;
    if (!brokerSourceDocumentId) {
      setBrokerDocument(null);
      setBrokerDocumentLoading(false);
      return;
    }
    setBrokerDocumentLoading(true);
    loadDocumentWithPreview(brokerSourceDocumentId)
      .then((document) => {
        if (!cancelled) setBrokerDocument(document);
      })
      .catch(() => {
        if (!cancelled) setBrokerDocument(null);
      })
      .finally(() => {
        if (!cancelled) setBrokerDocumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brokerSourceDocumentId]);

  // ── Derived-value computation ──────────────────────────────────────────────
  const computedDerivations = useMemo(() => {
    const emptyResult = { fields: {} as Record<string, string>, rowMap: {} as Record<string, Record<string, string>[]> };
    if (!schema) return emptyResult;

    const ALIAS: Record<string, string> = {
      quantity:    'totalQtyInPcs',
      grossWeight: 'grossWeightKgs',
      netWeight:   'netWeightKgs',
      tareWeight:  'tareWeightKgs',
    };
    const resolve = (s: string) => ALIAS[s.trim()] ?? s.trim();
    const fmtNum = (n: number, dec = 2) =>
      isNaN(n) ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });

    const rowMap: Record<string, Record<string, string>[]> = {};
    for (const section of schema.sections) {
      if (section.renderAs !== 'table') continue;
      const sLabel = section.sectionLabel;
      const mockRows = schema.mockData.tables[sLabel] ?? [];
      const derivedCols = section.mappings.filter(m => m.mappingType === 'derived');
      const computedRows: Record<string, string>[] = mockRows.map(() => ({}));
      const getNum = (ri: number, fieldName: string) => {
        const raw = (manualValues[`${sLabel}.${ri}.${fieldName}`] ?? mockRows[ri]?.[fieldName] ?? '').toString().replace(/,/g, '');
        return parseFloat(raw);
      };
      for (const col of derivedCols) {
        const sf = col.sourceField;
        for (let ri = 0; ri < mockRows.length; ri++) {
          const manualTarget = manualValues[`${sLabel}.${ri}.${col.targetField}`];
          if (manualTarget !== undefined && manualTarget.trim() !== '') continue;
          const savedTarget = mockRows[ri]?.[col.targetField];
          if (savedTarget !== undefined && savedTarget !== null && !isDraftBlank(String(savedTarget))) continue;

          if (col.targetField === 'dutyAmount') {
            const enteredValue = getNum(ri, 'enteredValue');
            const dutyRate = getNum(ri, 'dutyRate');
            if (!isNaN(enteredValue) && !isNaN(dutyRate)) {
              computedRows[ri][col.targetField] = fmtNum(enteredValue * dutyRate / 100, 2);
            }
          } else if (sf.includes(' / ')) {
            const [a, b] = sf.split(' / ');
            const av = getNum(ri, resolve(a)), bv = getNum(ri, resolve(b));
            if (!isNaN(av) && !isNaN(bv) && bv > 0) computedRows[ri][col.targetField] = fmtNum(av / bv, 0);
          } else if (sf.match(/^\w[\w\s]*×\s*[\d.]+$/) && !sf.includes('SUM')) {
            const [fp, factorPart] = sf.split('×');
            const av = getNum(ri, resolve(fp)), factor = parseFloat(factorPart);
            if (!isNaN(av) && !isNaN(factor)) computedRows[ri][col.targetField] = fmtNum(av * factor, 0);
          } else if (sf.includes(' − ')) {
            const [a, b] = sf.split(' − ');
            const av = getNum(ri, resolve(a)), bv = getNum(ri, resolve(b));
            if (!isNaN(av) && !isNaN(bv)) computedRows[ri][col.targetField] = fmtNum(av - bv, 2);
          }
        }
      }
      rowMap[sLabel] = computedRows;
    }

    const fields: Record<string, string> = {};
    for (const section of schema.sections) {
      if (section.renderAs !== 'fields') continue;
      for (const m of section.mappings) {
        if (m.mappingType !== 'derived') continue;
        const sf = m.sourceField;
        const sumMatch = sf.match(/SUM\([^.)]*?\.?(\w+)\)/);
        if (!sumMatch) continue;
        const field = sumMatch[1];
        const tableSection: GenSection | undefined = schema.sections.find(ts => ts.renderAs === 'table' && ts.mappings.some((c: FieldMapping) => c.targetField === field));
        if (!tableSection) continue;
        const sLabel = tableSection.sectionLabel;
        const mockRows = schema.mockData.tables[sLabel] ?? [];
        let sum = 0, hasAny = false;
        for (let ri = 0; ri < mockRows.length; ri++) {
          const computedVal = rowMap[sLabel]?.[ri]?.[field];
          const raw = (manualValues[`${sLabel}.${ri}.${field}`] ?? computedVal ?? mockRows[ri]?.[field] ?? '').toString().replace(/,/g, '');
          const n = parseFloat(raw);
          if (!isNaN(n) && n > 0) { sum += n; hasAny = true; }
        }
        if (hasAny) {
          const multiMatch = sf.match(/SUM\([^)]+\)\s*×\s*([\d.]+)/);
          fields[m.targetField] = fmtNum(multiMatch ? sum * parseFloat(multiMatch[1]) : sum, 2);
        }
      }
    }

    if (schema.docType === 'draft-boe') {
      const rawEnteredValue = (manualValues.totalEnteredValue ?? schema.mockData.fields.totalEnteredValue ?? '')
        .toString().replace(/[^0-9.-]/g, '');
      const enteredValue = parseFloat(rawEnteredValue);
      const dutyRows = rowMap['Tariff Lines'] ?? [];
      let totalDuty = 0;
      let hasDuty = false;
      dutyRows.forEach((row, index) => {
        const raw = (manualValues[`Tariff Lines.${index}.dutyAmount`] ?? row.dutyAmount ?? '')
          .toString().replace(/[^0-9.-]/g, '');
        const value = parseFloat(raw);
        if (!isNaN(value)) {
          totalDuty += value;
          hasDuty = true;
        }
      });
      if (hasDuty) fields.totalDuty = fmtNum(totalDuty, 2);
      if (!isNaN(enteredValue)) {
        const mpf = enteredValue * 0.003464;
        const hmf = enteredValue * 0.00125;
        const other = mpf + hmf;
        const tax = parseFloat((manualValues.totalTax ?? schema.mockData.fields.totalTax ?? '0').replace(/[^0-9.-]/g, '')) || 0;
        fields.mpfTotal = fmtNum(mpf, 2);
        fields.hmfTotal = fmtNum(hmf, 2);
        fields.totalOtherFees = fmtNum(other, 2);
        fields.totalOther = fmtNum(other, 2);
        fields.grandTotal = fmtNum((hasDuty ? totalDuty : 0) + tax + other, 2);
      }
    }
    return { fields, rowMap };
  }, [schema, manualValues]);

  const isBlocked  = !!liveReviewingItem && liveReviewingItem.status === 'waiting' && liveReviewingItem.prerequisites.some(p => !p.met);
  const isApproved = !!liveReviewingItem && liveReviewingItem.status === 'generated';
  const splitIssues = useMemo(
    () => packingListSplitIssues(schema, manualValues, computedDerivations.rowMap),
    [schema, manualValues, computedDerivations.rowMap],
  );

  function handleReview(item: GenQueueItem) {
    setReviewingItem(item);
    setManualValues({});
    setShowPreview(false);
  }

  async function handleApprove() {
    if (!liveReviewingItem || !schema || isBlocked || approving) return;
    if (splitIssues.length > 0) {
      toast.error(splitIssues[0] ?? 'Packing list validations must pass before approval');
      return;
    }
    setApproving(true);
    try {
      const fields: Record<string, string | null> = {};
      for (const section of schema.sections.filter(section => section.renderAs === 'fields')) {
        for (const mapping of section.mappings) {
          fields[mapping.targetField] =
            manualValues[mapping.targetField]
            ?? computedDerivations.fields[mapping.targetField]
            ?? schema.mockData.fields[mapping.targetField]
            ?? null;
        }
      }
      const tableSection = schema.sections.find(section => section.renderAs === 'table');
      const tableRows = tableSection ? (schema.mockData.tables[tableSection.sectionLabel] ?? []) : [];
      const originalDraft = draftPayloads[liveReviewingItem.id];
      const isWarehouseOutwardDraft =
        originalDraft?.generatedDocType === 'US_PACKING_LIST' &&
        (originalDraft.sourceDocs.includes('WAREHOUSE_STOCK') || Boolean(originalDraft.sourceDocumentIds.WAREHOUSE_STOCK));
      const lineItems = tableSection ? tableRows.map((row, rowIndex) => {
        const visibleValues = Object.fromEntries(
          tableSection.mappings
            .filter(mapping => mapping.isLineItem !== false)
            .map(mapping => [
              mapping.targetField,
              mapping.targetField === 'qtyPerBundle'
                ? (
                  computedDerivations.rowMap[tableSection.sectionLabel]?.[rowIndex]?.[mapping.targetField]
                  ?? row[mapping.targetField]
                  ?? null
                )
                : manualValues[`${tableSection.sectionLabel}.${rowIndex}.${mapping.targetField}`]
                ?? computedDerivations.rowMap[tableSection.sectionLabel]?.[rowIndex]?.[mapping.targetField]
                ?? row[mapping.targetField]
                ?? null,
            ]),
        );
        const preservedRow = {
          ...row,
          ...visibleValues,
        };
        if (!isWarehouseOutwardDraft) return preservedRow;
        const originalLine = originalDraft?.lineItems?.[rowIndex] ?? {};
        return {
          ...originalLine,
          ...preservedRow,
          warehouseStockId: originalLine.warehouseStockId,
          quantityDispatched: originalLine.quantityDispatched ?? preservedRow.totalQtyInPcs,
        };
      }) : undefined;
      const updatedDraft = await apiPatch<DraftPayload>(`/doc-generation/drafts/${liveReviewingItem.id}`, {
        fields,
        lineItems,
        status: 'GENERATED',
      });
      const baseSchema = DOC_GEN_SCHEMAS[generatedDocTypeToSchemaKey(updatedDraft.generatedDocType)] as DocGenSchema | undefined;
      const updatedSchema = baseSchema ? draftToSchema(baseSchema, updatedDraft) : schema;
      setDraftPayloads((payloads) => ({
        ...payloads,
        [liveReviewingItem.id]: updatedDraft,
      }));
      setDraftSchemas((schemas) => ({
        ...schemas,
        [liveReviewingItem.id]: updatedSchema,
      }));
      setManualValues({});
      setRawQueue((items) => items.map((item) => (
        item.id === liveReviewingItem.id ? { ...item, status: 'generated' } : item
      )));
      toast.success(`${schema?.displayName ?? 'Document'} approved — opening PDF save dialog`);
      setShowPreview(true);
      window.setTimeout(() => window.print(), 350);
    } catch {
      toast.error('Approval failed — please try again');
    } finally {
      setApproving(false);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────
  if (permissionsLoaded && (!generationOptions.length || !isCurrentGenerationAllowed)) return null;

  if (loading) return (
    <PageShell>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: MUTED, fontSize: 14 }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: TEAL }} />
        Loading document queue...
      </div>
    </PageShell>
  );

  if (!generationOptions.length) return (
    <PageShell>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <AlertCircle size={24} style={{ color: RED }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: FG }}>Access denied</div>
        <div style={{ fontSize: 13, color: MUTED }}>No generated document types are assigned to this role.</div>
      </div>
    </PageShell>
  );

  if (fetchErr) return (
    <PageShell>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <AlertCircle size={24} style={{ color: RED }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: FG }}>{fetchErr}</div>
        <Button type="button" size="sm" onClick={fetchQueue}>
          Retry
        </Button>
      </div>
    </PageShell>
  );

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="ewms-page-shell" style={{ display: 'flex', flexDirection: 'column', height: '100%', paddingTop: 12, paddingBottom: 16 }}>

      {/* Document type tabs */}
      <DocGenerationTabs
        activeType={generatedDocTypeToSchemaKey(routeTypeToGeneratedDocType(routeType))}
        options={generationOptions}
        onSelectType={(value) => navigate(`/documents/generate/${value}`)}
        pendingCount={queue.length > 0 ? queue.filter(i => i.status !== 'generated').length : undefined}
      />

      {/* Search + status filters */}
      {queue.length > 0 && (
        <QueueToolbar
          items={filteredQueue}
          onReview={handleReview}
          search={search}
          onSearch={setSearch}
          filter={queueFilter}
          onFilter={setQueueFilter}
        />
      )}

      {/* Queue table — full width */}
      {queue.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <FileText size={36} style={{ color: MUTED }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: FG }}>No documents in queue</div>
          <div style={{ fontSize: 13, color: MUTED, textAlign: 'center', maxWidth: 340 }}>
            Documents appear here once a Sales Invoice has been approved in Upload &amp; Process.
          </div>
        </div>
      ) : (
        <QueueTable
          items={filteredQueue}
          onReview={handleReview}
          filter={queueFilter}
        />
      )}

      {/* Review modal — opens when a row is clicked */}
      {liveReviewingItem && schema && (
        <DocReviewModal
          item={liveReviewingItem}
          schema={schema}
          isBlocked={isBlocked}
          isApproved={isApproved}
          manualValues={manualValues}
          computedDerivations={computedDerivations}
          splitIssues={splitIssues}
          packageTypes={draftPackageTypes[liveReviewingItem.id] ?? []}
          sourcePanelOpen={sourcePanelOpen}
          approving={approving}
          showPreview={showPreview}
          bolDocument={bolDocument}
          bolDocumentLoading={bolDocumentLoading}
          brokerDocument={brokerDocument}
          brokerDocumentLoading={brokerDocumentLoading}
          brokerSourceExtractedData={brokerSourceExtractedData}
          onClose={() => setReviewingItem(null)}
          onManualChange={handleManualChange}
          onPackageTypeChange={handlePackageTypeChange}
          onAddLineItemRow={handleAddLineItemRow}
          onRemoveLineItemRow={handleRemoveLineItemRow}
          onApprove={handleApprove}
          onPreview={() => setShowPreview(true)}
          onToggleSourcePanel={toggleSourcePanel}
          onSetShowPreview={setShowPreview}
        />
      )}
    </div>
  );
}
