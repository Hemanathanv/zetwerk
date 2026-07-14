import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Info, Sparkles, FileText, Search, CheckCircle2, Clock, AlertCircle, Lock,
  ChevronDown, ChevronUp, MoreHorizontal, Eye, X, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { DOC_GEN_SCHEMAS, DocGenSchema, FieldMapping, GenSection } from '@/config/docGenConfig';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import type { MappingType } from '@/config/docGenConfig';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import { useLocation, useParams } from 'wouter';

// ─── Design tokens ────────────────────────────────────────────────────────────
const TEAL   = 'hsl(173 58% 39%)';
const FG     = 'hsl(var(--foreground))';
const MUTED  = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const GREEN  = 'hsl(152 69% 31%)';
const RED    = 'hsl(0 84% 60%)';
const AMBER  = 'hsl(38 92% 50%)';

const MONO = { fontFamily: 'var(--font-mono,"JetBrains Mono",monospace)' } as const;

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
  sections: Array<{ sectionLabel: string; fields: DraftFieldValue[] }>;
  lineItems: Array<Record<string, unknown>>;
  containers: Array<Record<string, unknown>>;
  stats: Record<string, number>;
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
  if (m.mappingType === 'derived')     return { text: `Calculated · ${m.transformation ?? label}` };
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

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, prereqs }: { status: GenQueueItem['status']; prereqs: Prerequisite[] }) {
  if (status === 'generated') return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 20,
      background: 'hsla(152,69%,31%,0.12)', color: GREEN, whiteSpace: 'nowrap',
    }}>
      <CheckCircle2 size={8} /> Done
    </span>
  );
  if (status === 'waiting') {
    const hint = prereqShortHint(prereqs);
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 20,
        background: 'hsla(38,92%,50%,0.10)', color: AMBER, whiteSpace: 'nowrap',
      }}>
        <Lock size={8} /> {hint}
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 20,
      background: 'hsla(38,92%,50%,0.12)', color: AMBER, whiteSpace: 'nowrap',
    }}>
      <AlertCircle size={8} /> Draft
    </span>
  );
}

// ─── QueueFilter type ─────────────────────────────────────────────────────────

type QueueFilter = 'all' | 'needs-review' | 'generated';

// ─── QueueTable ───────────────────────────────────────────────────────────────

function QueueTable({
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

  const counts = {
    all:         items.length,
    needsReview: items.filter(i => i.status !== 'generated').length,
    generated:   items.filter(i => i.status === 'generated').length,
  };

  const TD: React.CSSProperties = {
    padding: '12px 16px', fontSize: 13, color: FG,
    borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle',
  };

  const FILTERS: { key: QueueFilter; label: string }[] = [
    { key: 'all',          label: 'All'     },
    { key: 'needs-review', label: 'Pending' },
    { key: 'generated',    label: 'Done'    },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0, borderBottom: `1px solid ${BORDER}`,
        background: 'hsl(var(--card))',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          borderRadius: 7, border: `1px solid ${BORDER}`,
          background: 'hsl(var(--background))', flex: 1, maxWidth: 340,
        }}>
          <Search size={12} style={{ color: MUTED, flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search by invoice, doc type or shipment…"
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: FG, flex: 1, minWidth: 0 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(t => (
            <button key={t.key} onClick={() => onFilter(t.key)} style={{
              fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20,
              border: `1px solid ${filter === t.key ? TEAL : BORDER}`,
              background: filter === t.key ? 'hsla(173,58%,39%,0.08)' : 'transparent',
              color: filter === t.key ? TEAL : MUTED, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all 0.1s',
            }}>
              {t.label}
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '0 4px', borderRadius: 10, lineHeight: '16px',
                background: filter === t.key ? 'hsla(173,58%,39%,0.15)' : 'hsl(var(--muted))',
                color: filter === t.key ? TEAL : MUTED,
              }}>
                {counts[t.key === 'all' ? 'all' : t.key === 'needs-review' ? 'needsReview' : 'generated']}
              </span>
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: MUTED, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {filteredByTab.length} document{filteredByTab.length !== 1 ? 's' : ''}
        </span>
      </div>

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
                        fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 600,
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

function FieldGrid({ section, fields, sourceDocs, manualValues, onManualChange, computedFields }: {
  section:         GenSection;
  fields:          Record<string, string>;
  sourceDocs:      { docType: string; label: string }[];
  manualValues:    Record<string, string>;
  onManualChange:  (key: string, v: string) => void;
  computedFields:  Record<string, string>;
}) {
  const sectionName = section.sectionLabel.trim().toLowerCase();
  const isTotalsSection = sectionName === 'totals' || sectionName === 'duties and fees';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px' }}>
      {section.mappings.map(m => {
        const isDerived = m.mappingType === 'derived';
        const isEditable = !isTotalsSection;
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

function LineItemTable({ section, rows, sourceDocs, manualValues, onManualChange, computedRows, packageTypes = [], onPackageTypeChange }: {
  section:        GenSection;
  rows:           Record<string, string>[];
  sourceDocs:     { docType: string; label: string }[];
  manualValues:   Record<string, string>;
  onManualChange: (key: string, v: string) => void;
  computedRows:   Record<string, string>[];
  packageTypes?: string[];
  onPackageTypeChange?: (rowIndex: number, value: string, customTypes: string[]) => void;
}) {
  void sourceDocs;
  const cols = section.mappings.filter(m => m.isLineItem !== false);
  const packageTypeValues = Array.from(new Set(
    [...packageTypes, ...rows.map((row, ri) => manualValues[`${section.sectionLabel}.${ri}.kindOfPkg`] ?? row.kindOfPkg)]
      .filter((value): value is string => Boolean(value))
      .map(value => value.trim())
      .filter(value => !['PKGS', 'BUNDLE'].includes(value.toUpperCase()))
  ));
  const isTotalsSection = section.sectionLabel.trim().toLowerCase() === 'totals';
  if (cols.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'hsl(var(--muted))', borderBottom: `1px solid ${BORDER}` }}>
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
              {cols.map(col => {
                const isDerived = col.mappingType === 'derived';
                const isEditable = !isTotalsSection;
                const manualKey = `${section.sectionLabel}.${ri}.${col.targetField}`;
                const baseVal = isDerived
                  ? (computedRows[ri]?.[col.targetField] ?? row[col.targetField] ?? '')
                  : (row[col.targetField] ?? '');
                const val = isEditable ? (manualValues[manualKey] ?? baseVal) : baseVal;
                return (
                  <td key={col.targetField} style={{
                    padding: 0,
                    backgroundColor: 'hsl(var(--muted) / 0.42)',
                    verticalAlign: 'middle',
                    ...(col.mono ? MONO : {}), fontSize: 12,
                    whiteSpace: 'nowrap',
                    outline: `1px solid ${BORDER}`,
                    outlineOffset: -1,
                  }}>
                    {isEditable && col.targetField === 'kindOfPkg' ? (
                      <select
                        value={val}
                        onChange={e => {
                          let next = e.target.value;
                          let customTypes = packageTypeValues;
                          if (next === '__ADD_TYPE__') {
                            const added = window.prompt('Enter a new package type')?.trim();
                            if (!added) return;
                            next = added.toUpperCase();
                            customTypes = Array.from(new Set([...packageTypeValues, next]));
                          }
                          onManualChange(manualKey, next);
                          onPackageTypeChange?.(ri, next, customTypes);
                        }}
                        style={{
                          border: 'none', background: 'transparent', outline: 'none',
                          padding: '7px 10px', fontSize: 12, fontWeight: 600, color: FG,
                          width: '100%', minWidth: 120, cursor: 'pointer',
                        }}
                      >
                        <option value="PKGS">PKGS</option>
                        <option value="BUNDLE">BUNDLE</option>
                        {packageTypeValues.map(type => <option key={type} value={type}>{type}</option>)}
                        <option value="__ADD_TYPE__">+ Add type</option>
                      </select>
                    ) : isEditable ? (
                      <input
                        value={val}
                        onChange={e => onManualChange(manualKey, e.target.value)}
                        placeholder="Enter..."
                        style={{
                          border: 'none', background: 'transparent', outline: 'none',
                          padding: '7px 10px', fontSize: 12, fontWeight: 600, color: FG,
                          width: '100%', minWidth: 90,
                          ...(col.mono ? MONO : {}),
                        }}
                      />
                    ) : (
                      <span style={{ display: 'block', padding: '7px 10px' }}>
                        {val || '—'}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ background: 'hsl(var(--muted) / 0.65)', borderTop: `2px solid ${BORDER}`, fontWeight: 700 }}>
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

function ActionRequiredCard({ schema, manualValues, onManualChange }: {
  schema:          DocGenSchema;
  manualValues:    Record<string, string>;
  onManualChange:  (key: string, v: string) => void;
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
      background: 'hsl(var(--muted) / 0.35)',
      border: `1px solid ${BORDER}`,
      borderRadius: 10, padding: '14px 16px', marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: allFilled ? 0 : 14 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: 'hsl(var(--muted))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {allFilled
            ? <CheckCircle2 size={13} style={{ color: GREEN }} />
            : <AlertCircle size={13} style={{ color: RED }} />
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
                  onChange={v => onManualChange(m.targetField, v)}
                />
              ))}
            </div>
          )}
          {tableManualInfo.filter(t => t.filled < t.total).map(t => (
            <div key={t.section} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 6,
              background: 'hsl(var(--muted) / 0.45)', border: `1px solid ${BORDER}`,
              marginBottom: 6,
            }}>
              <AlertCircle size={12} style={{ color: RED, flexShrink: 0 }} />
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
  section, schema, manualValues, onManualChange, packageTypes, onPackageTypeChange, computedFields, computedRowMap, defaultExpanded,
}: {
  section:         GenSection;
  schema:          DocGenSchema;
  manualValues:    Record<string, string>;
  onManualChange:  (key: string, v: string) => void;
  packageTypes?: string[];
  onPackageTypeChange?: (rowIndex: number, value: string, customTypes: string[]) => void;
  computedFields:  Record<string, string>;
  computedRowMap:  Record<string, Record<string, string>[]>;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const fieldValues  = schema.mockData.fields;
  const tableRows    = schema.mockData.tables[section.sectionLabel] ?? [];
  const computedRows = computedRowMap[section.sectionLabel] ?? [];

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
            ? <FieldGrid section={section} fields={fieldValues} sourceDocs={schema.sourceDocs} manualValues={manualValues} onManualChange={onManualChange} computedFields={computedFields} />
            : <LineItemTable section={section} rows={tableRows} sourceDocs={schema.sourceDocs} manualValues={manualValues} onManualChange={onManualChange} packageTypes={packageTypes} onPackageTypeChange={onPackageTypeChange} computedRows={computedRows} />
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
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
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
          padding: '8px 12px', background: 'hsl(var(--muted))', borderRadius: 6,
        }}>
          <span style={{ fontWeight: 600, color: FG }}>Trigger: </span>{schema.triggerCondition}
        </div>
      )}

      <div style={{
        background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 10,
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
                fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
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

function StickyReviewFooter({ schema, manualValues, computedFields, computedRowMap, isApproved, isBlocked, onApprove, onPreview, approving }: {
  schema:       DocGenSchema;
  manualValues: Record<string, string>;
  computedFields: Record<string, string>;
  computedRowMap: Record<string, Record<string, string>[]>;
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
  const canApprove = !isBlocked && !isApproved && filledManual >= totalManualReqd && critFailing === 0;
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
  item, schema, siblings, isBlocked, isApproved, manualValues,
  computedDerivations, packageTypes, sourcePanelOpen, approving, showPreview,
  onClose, onManualChange, onPackageTypeChange, onApprove, onPreview, onSelectSibling,
  onToggleSourcePanel, onSetShowPreview,
}: {
  item:                GenQueueItem;
  schema:              DocGenSchema;
  siblings:            GenQueueItem[];
  isBlocked:           boolean;
  isApproved:          boolean;
  manualValues:        Record<string, string>;
  computedDerivations: { fields: Record<string, string>; rowMap: Record<string, Record<string, string>[]> };
  packageTypes:        string[];
  sourcePanelOpen:     boolean;
  approving:           boolean;
  showPreview:         boolean;
  onClose:             () => void;
  onManualChange:      (key: string, v: string) => void;
  onPackageTypeChange: (rowIndex: number, value: string, customTypes: string[]) => void;
  onApprove:           () => void;
  onPreview:           () => void;
  onSelectSibling:     (item: GenQueueItem) => void;
  onToggleSourcePanel: () => void;
  onSetShowPreview:    (v: boolean) => void;
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

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
          top: 24, left: 24, right: 24, bottom: 24,
          margin: 'auto', maxWidth: 1380, maxHeight: 920,
          background: 'hsl(var(--background))',
          borderRadius: 14,
          boxShadow: '0 32px 100px hsla(0,0%,0%,0.28)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Modal header ── */}
        <div style={{
          padding: '12px 18px', borderBottom: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: 'hsl(var(--card))',
        }}>
          {/* Title */}
          <div style={{ minWidth: 0, flexShrink: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: FG, margin: 0, whiteSpace: 'nowrap' }}>
                {isBlocked ? 'Waiting:' : isApproved ? 'Approved:' : 'Draft:'}{' '}{schema.displayName}
              </h2>
              {isApproved && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'hsla(152,69%,31%,0.12)', color: GREEN, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <CheckCircle2 size={9} /> Approved
                </span>
              )}
            </div>
            <p style={{ fontSize: 11.5, color: MUTED, margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ ...MONO }}>{item.invoiceNo}</span>
              {(item.shipmentRef ?? '').trim() && <> &middot; <span style={{ ...MONO }}>{item.shipmentRef}</span></>}
              &nbsp;&middot;&nbsp; Source: {schema.sourceDocs.map(d => d.label).join(' + ')}
            </p>
          </div>

          {/* Sibling doc tabs */}
          {siblings.length > 1 && (
            <div style={{ display: 'flex', gap: 3, marginLeft: 14, flexWrap: 'wrap', flexShrink: 0 }}>
              {siblings.map(sib => {
                const sibSch    = DOC_GEN_SCHEMAS[sib.docType];
                const isActive  = sib.id === item.id;
                const sibBlocked = sib.status === 'waiting' && sib.prerequisites.some(p => !p.met);
                const sibDone   = sib.status === 'generated';
                return (
                  <button key={sib.id} onClick={() => onSelectSibling(sib)} style={{
                    padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                    border: isActive ? `1.5px solid ${TEAL}` : `1px solid ${BORDER}`,
                    background: isActive ? 'hsla(173,58%,39%,0.08)' : 'transparent',
                    color: isActive ? TEAL : sibDone ? GREEN : sibBlocked ? AMBER : MUTED,
                    transition: 'all 0.1s',
                  }}>
                    {sibDone && <CheckCircle2 size={9} />}
                    {sibBlocked && !isActive && <Lock size={9} />}
                    {sibSch?.displayName ?? sib.docType}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Source doc toggle */}
          {!isBlocked && (
            <button onClick={onToggleSourcePanel} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 11px', borderRadius: 7, flexShrink: 0,
              border: `1px solid ${sourcePanelOpen ? TEAL : BORDER}`,
              background: sourcePanelOpen ? 'hsla(173,58%,39%,0.08)' : 'transparent',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
              color: sourcePanelOpen ? TEAL : MUTED, transition: 'all 0.15s',
            }}>
              <FileText size={12} />
              {sourcePanelOpen ? 'Hide source' : 'View source doc'}
            </button>
          )}

          {!isBlocked && <OverflowMenu />}

          {/* Close */}
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 7, border: `1px solid ${BORDER}`,
            background: 'transparent', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--muted))'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
          >
            <X size={15} style={{ color: MUTED }} />
          </button>
        </div>

        {/* ── Modal body: source panel | editor ── */}
        <div style={{
          flex: 1, overflow: 'hidden', minHeight: 0, display: 'grid',
          gridTemplateColumns: sourcePanelOpen && !isBlocked ? '280px 1fr' : '1fr',
          gridTemplateRows: '1fr',
          transition: 'grid-template-columns 0.15s ease',
        }}>
          {sourcePanelOpen && !isBlocked && (
            <SourceDocPanel schema={schema} onClose={onToggleSourcePanel} />
          )}

          {/* Draft editor column */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 24px 4px' }}>
              {isBlocked ? (
                <div style={{ background: 'hsl(var(--card))', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '22px 26px' }}>
                  <BlockedView item={item} schema={schema} />
                </div>
              ) : (
                <>
                  {/* Trigger + counts banner */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: 'hsl(var(--muted) / 0.35)', border: `1px solid ${BORDER}`,
                    borderRadius: 8, padding: '8px 14px', fontSize: 12, color: FG,
                    marginBottom: 14,
                  }}>
                    <Info size={13} style={{ flexShrink: 0, color: MUTED }} />
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

                  <ActionRequiredCard schema={schema} manualValues={manualValues} onManualChange={onManualChange} />

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
                isApproved={isApproved}
                isBlocked={isBlocked}
                onApprove={onApprove}
                onPreview={onPreview}
                approving={approving}
              />
            )}
          </div>
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
    </>
  );
}

// ─── Page skeleton (shared for loading/error/empty states) ────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 20px', borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'hsl(var(--card))',
      }}>
        <Sparkles size={15} style={{ color: TEAL }} />
        <h1 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: FG, margin: 0 }}>
          Document Generation
        </h1>
        <span style={{ fontSize: 11.5, color: MUTED }}>— AI-drafted documents for review &amp; approval</span>
      </div>
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

function draftToSchema(baseSchema: DocGenSchema, draft: DraftPayload): DocGenSchema {
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
      displayName: 'Draft BOE',
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
      const normalized: Record<string, string> = {};
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

  return {
    id: draft.draftId,
    shipmentRef: fieldMap.exporterRef || fieldMap.zetwerkRef || '',
    invoiceNo: fieldMap.invoiceNo || 'Sales Invoice',
    docType: schema.docType,
    status: draft.status === 'GENERATED' ? 'generated' : 'draft',
    createdAt: draft.createdAt || draft.updatedAt || new Date().toISOString(),
    prerequisites: [
      {
        key: 'sales-invoice-approved',
        label: 'Sales Invoice extraction available',
        met: Boolean(draft.sourceDocumentIds.SALES_INVOICE),
        actionHint: 'Approve a Sales Invoice extraction in Upload & Process',
      },
    ],
  };
}

function routeTypeToGeneratedDocType(type: string | undefined): DraftPayload['generatedDocType'] {
  if (type === 'packing-list' || type === 'PACKING_LIST') return 'PACKING_LIST';
  if (type === 'outward-pl' || type === 'us-packing-list' || type === 'US_PACKING_LIST') return 'US_PACKING_LIST';
  if (type === 'draft-boe' || type === 'entry-summary' || type === 'ENTRY_SUMMARY') return 'ENTRY_SUMMARY';
  return 'PACKING_LIST';
}

function generatedDocTypeToSchemaKey(type: DraftPayload['generatedDocType']): string {
  if (type === 'PACKING_LIST') return 'packing-list';
  if (type === 'US_PACKING_LIST') return 'outward-pl';
  return 'draft-boe';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DocumentGeneratePage() {
  const params = useParams<{ type?: string }>();
  const [location, navigate] = useLocation();
  const routeType = params.type
    ?? (location.endsWith('/boe') ? 'draft-boe' : location.endsWith('/packing-list') ? 'packing-list' : undefined);
  const [search,         setSearch]         = useState('');
  const [queueFilter,    setQueueFilter]     = useState<QueueFilter>('all');
  const [reviewingItem,  setReviewingItem]   = useState<GenQueueItem | null>(null);
  const [approving,      setApproving]       = useState(false);
  const [manualValues,   setManualValues]    = useState<Record<string, string>>({});
  const [showPreview,    setShowPreview]     = useState(false);

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
    setManualValues(prev => ({ ...prev, [key]: v }));
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
  const [draftPackageTypes, setDraftPackageTypes] = useState<Record<string, string[]>>({});
  const [loading,  setLoading]  = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      setFetchErr(null);
      const generatedDocType = routeTypeToGeneratedDocType(routeType);
      const schemaKey = generatedDocTypeToSchemaKey(generatedDocType);
      const baseSchema = DOC_GEN_SCHEMAS[schemaKey] as DocGenSchema | undefined;
      if (!baseSchema) throw new Error(`Unsupported document generation type: ${routeType ?? 'packing-list'}`);

      let drafts = await apiGet<DraftPayload[]>(`/doc-generation/drafts?generatedDocType=${generatedDocType}`);
      if (drafts.length === 0) {
        drafts = [await apiPost<DraftPayload>('/doc-generation/drafts', {
          generatedDocType,
          sourceDocumentIds: {},
        })];
      }
      const schemas: Record<string, DocGenSchema> = {};
      const packageTypes: Record<string, string[]> = {};
      const queueItems = drafts
        .map((draft) => {
          const hydratedSchema = draftToSchema(baseSchema, draft);
          const queueItem = draftToQueueItem(draft, hydratedSchema);
          schemas[queueItem.id] = hydratedSchema;
          packageTypes[queueItem.id] = draft.customPackageTypes ?? [];
          return queueItem;
        })
        .sort((a, b) => {
          const createdDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
          return Number.isNaN(createdDiff) ? 0 : createdDiff;
        });
      setDraftSchemas(schemas);
      setDraftPackageTypes(packageTypes);
      setRawQueue(queueItems);
    } catch (err) {
      setRawQueue([]);
      setDraftSchemas({});
      setDraftPackageTypes({});
      setFetchErr(err instanceof Error ? err.message : 'Could not load generation queue');
    } finally {
      setLoading(false);
    }
  }, [routeType]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

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
      (DOC_GEN_SCHEMAS[i.docType]?.displayName ?? i.docType).toLowerCase().includes(q)
    );
  }, [queue, search]);

  // Keep reviewingItem in sync with latest queue data (status may change after approve)
  const liveReviewingItem = reviewingItem
    ? (queue.find(i => i.id === reviewingItem.id) ?? reviewingItem)
    : null;

  const schema = liveReviewingItem
    ? (draftSchemas[liveReviewingItem.id] ?? DOC_GEN_SCHEMAS[liveReviewingItem.docType]) as DocGenSchema | undefined
    : undefined;

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
            else if (!isNaN(av) && av > 0) computedRows[ri][col.targetField] = fmtNum(av * 0.94, 2);
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

  const siblings = useMemo(() =>
    liveReviewingItem ? queue.filter(i => i.shipmentRef === liveReviewingItem.shipmentRef) : [],
    [queue, liveReviewingItem]
  );

  function handleReview(item: GenQueueItem) {
    setReviewingItem(item);
    setManualValues({});
    setShowPreview(false);
  }

  async function handleApprove() {
    if (!liveReviewingItem || !schema || isBlocked || approving) return;
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
      const lineItems = tableSection ? tableRows.map((row, rowIndex) => Object.fromEntries(
        tableSection.mappings
          .filter(mapping => mapping.isLineItem !== false)
          .map(mapping => [
            mapping.targetField,
            manualValues[`${tableSection.sectionLabel}.${rowIndex}.${mapping.targetField}`]
              ?? computedDerivations.rowMap[tableSection.sectionLabel]?.[rowIndex]?.[mapping.targetField]
              ?? row[mapping.targetField]
              ?? null,
          ]),
      )) : undefined;
      await apiPatch<DraftPayload>(`/doc-generation/drafts/${liveReviewingItem.id}`, {
        fields,
        lineItems,
        status: 'GENERATED',
      });
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
  if (loading) return (
    <PageShell>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: MUTED, fontSize: 14 }}>
        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: TEAL }} />
        Loading document queue...
      </div>
    </PageShell>
  );

  if (fetchErr) return (
    <PageShell>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <AlertCircle size={24} style={{ color: RED }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: FG }}>{fetchErr}</div>
        <button onClick={fetchQueue} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, background: TEAL, color: '#fff', border: 'none', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    </PageShell>
  );

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Page header */}
      <div style={{
        padding: '11px 24px', borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'hsl(var(--card))',
      }}>
        <Sparkles size={15} style={{ color: TEAL, flexShrink: 0 }} />
        <h1 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: FG, margin: 0 }}>
          Document Generation
        </h1>
        <span style={{ fontSize: 11.5, color: MUTED }}>— AI-drafted documents for review &amp; approval</span>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3, marginLeft: 14,
          padding: 3, borderRadius: 8, background: 'hsl(var(--muted) / 0.55)',
        }}>
          {[
            { type: 'packing-list', label: 'Packing List' },
            { type: 'outward-pl', label: 'Outward Packing List' },
            { type: 'draft-boe', label: 'Draft BOE' },
          ].map(option => {
            const activeType = generatedDocTypeToSchemaKey(routeTypeToGeneratedDocType(routeType));
            const active = activeType === option.type;
            return (
              <button
                key={option.type}
                type="button"
                onClick={() => navigate(`/documents/generate/${option.type}`)}
                style={{
                  border: active ? `1px solid ${BORDER}` : '1px solid transparent',
                  borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                  background: active ? 'hsl(var(--card))' : 'transparent',
                  color: active ? FG : MUTED, fontSize: 11.5, fontWeight: active ? 700 : 600,
                  boxShadow: active ? '0 1px 2px hsla(0,0%,0%,0.08)' : 'none',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {queue.length > 0 && (() => {
          const pending = queue.filter(i => i.status !== 'generated').length;
          return (
            <span style={{
              marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: pending > 0 ? 'hsla(38,92%,50%,0.12)' : 'hsla(152,69%,31%,0.10)',
              color: pending > 0 ? AMBER : GREEN,
            }}>
              {pending > 0 ? `${pending} pending` : 'All approved'}
            </span>
          );
        })()}
      </div>

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
          search={search}
          onSearch={setSearch}
          filter={queueFilter}
          onFilter={setQueueFilter}
        />
      )}

      {/* Review modal — opens when a row is clicked */}
      {liveReviewingItem && schema && (
        <DocReviewModal
          item={liveReviewingItem}
          schema={schema}
          siblings={siblings}
          isBlocked={isBlocked}
          isApproved={isApproved}
          manualValues={manualValues}
          computedDerivations={computedDerivations}
          packageTypes={draftPackageTypes[liveReviewingItem.id] ?? []}
          sourcePanelOpen={sourcePanelOpen}
          approving={approving}
          showPreview={showPreview}
          onClose={() => setReviewingItem(null)}
          onManualChange={handleManualChange}
          onPackageTypeChange={handlePackageTypeChange}
          onApprove={handleApprove}
          onPreview={() => setShowPreview(true)}
          onSelectSibling={item => { setReviewingItem(item); setManualValues({}); setShowPreview(false); }}
          onToggleSourcePanel={toggleSourcePanel}
          onSetShowPreview={setShowPreview}
        />
      )}
    </div>
  );
}
