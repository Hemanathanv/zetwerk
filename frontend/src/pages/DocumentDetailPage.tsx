import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { ArrowLeft, Check, Loader2, Pencil, X } from 'lucide-react';
import { documentApi } from '@/auth/api';
import type { DocumentDetailRecord, JsonValue } from '@/types/backend';
import { getDocConfig } from '@/config/docFieldConfig';
import type { FieldDef } from '@/config/docFieldConfig';
import { PageHeader } from '@/components/vs/PageHeader';
import { DocBadge } from '@/components/vs/DocBadge';
import { useToast } from '@/hooks/use-toast';

const FG = 'hsl(var(--foreground))';
const MUTED = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const TEAL = 'hsl(173 58% 39%)';
const RED = 'hsl(0 84% 60%)';
const GREEN = 'hsl(152 69% 31%)';
const BLUE = 'hsl(221 83% 53%)';

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
  if (value === undefined || value === null || value === '') return 'Not extracted';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : 'Not extracted';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function docCode(docType: string) {
  const config = getDocConfig(docType);
  if (config?.shortCode) return config.shortCode;
  if (docType === 'BILL_OF_LADING') return 'BL';
  return docType.split('_').map((part) => part[0]).join('').slice(0, 2);
}

function labelFromKey(key: string): string {
  return key
    .replace(/\[\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function FieldCard({ field, rawData }: { field: FieldDef; rawData: JsonValue | null | undefined }) {
  const extractedValue = formatValue(findExtractionValue(rawData, field.key));
  const [isEditing, setIsEditing] = useState(false);
  const [amendedValue, setAmendedValue] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');

  useEffect(() => {
    setIsEditing(false);
    setAmendedValue(null);
    setDraftValue(extractedValue === 'Not extracted' ? '' : extractedValue);
  }, [field.key, extractedValue]);

  const displayValue = amendedValue ?? extractedValue;
  const isEmpty = displayValue === 'Not extracted';
  const isAmended = amendedValue !== null;

  function startEdit() {
    setDraftValue(displayValue === 'Not extracted' ? '' : displayValue);
    setIsEditing(true);
  }

  function saveEdit() {
    setAmendedValue(draftValue.trim() || 'Not extracted');
    setIsEditing(false);
  }

  return (
    <div
      style={{
        border: `1px solid ${isEmpty ? 'hsla(0,84%,60%,0.20)' : BORDER}`,
        borderRadius: 8,
        padding: '9px 11px',
        backgroundColor: isEmpty ? 'hsla(0,84%,60%,0.035)' : 'hsl(var(--card))',
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
              if (event.key === 'Enter') saveEdit();
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
            onClick={saveEdit}
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
            color: isEmpty ? RED : FG,
            fontStyle: isEmpty ? 'italic' : 'normal',
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

function LineItemsTable({ rows }: { rows: Array<Record<string, JsonValue>> }) {
  const columns = useMemo(
    () => Array.from(rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>())),
    [rows],
  );

  if (!rows.length || !columns.length) return null;

  return (
    <section>
      <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        Line Items
      </div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'auto', backgroundColor: 'hsl(var(--card))' }}>
        <table style={{ width: '100%', minWidth: Math.max(640, columns.length * 150), borderCollapse: 'collapse', tableLayout: 'fixed' }}>
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
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="vs-mono" style={{ padding: '9px 10px', borderTop: index === 0 ? 'none' : `1px solid ${BORDER}`, fontSize: 11, color: MUTED }}>{index + 1}</td>
                {columns.map((column) => {
                  const displayValue = formatValue(row[column]);
                  const isEmpty = displayValue === 'Not extracted';
                  return (
                    <td key={column} style={{ padding: '9px 10px', borderTop: index === 0 ? 'none' : `1px solid ${BORDER}`, borderLeft: `1px solid ${BORDER}`, fontSize: 12, color: isEmpty ? RED : FG, fontStyle: isEmpty ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={displayValue}>
                      {displayValue}
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

export function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const [currentPath, navigate] = useLocation();
  const { toast } = useToast();
  const documentId = params.id ?? '';
  const [documentDetail, setDocumentDetail] = useState<DocumentDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<'approve' | 'retry' | null>(null);
  const isApprovalRoute = currentPath.endsWith('/approve');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
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
  const isImagePreview = Boolean(documentDetail?.contentType?.startsWith('image/'));

  async function approveAllFields() {
    if (!documentDetail || actionLoading) return;
    setActionLoading('approve');
    try {
      await documentApi.approve(documentDetail.id);
      toast({ title: 'Extraction approved', description: 'All extracted fields were approved.' });
      const { data } = await documentApi.getById(documentDetail.id);
      setDocumentDetail(data);
      navigate(`/documents/upload/${documentDetail.id}/approve`);
    } catch (err) {
      toast({ title: 'Approval failed', description: err instanceof Error ? err.message : 'Unable to approve this document.', variant: 'destructive' });
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

  if (loading) {
    return (
      <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, gap: 8 }}>
        <Loader2 size={16} style={{ animation: 'spin 0.9s linear infinite' }} />
        Loading document...
      </div>
    );
  }

  if (error || !documentDetail) {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={() => navigate('/documents/upload')} style={{ marginBottom: 16, color: TEAL, background: 'transparent', border: `1px solid ${TEAL}50`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <button onClick={() => navigate('/documents/upload')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TEAL, background: 'transparent', border: `1px solid ${TEAL}50`, borderRadius: 8, padding: '7px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          <ArrowLeft size={14} /> Upload & Process
        </button>
        <button
          onClick={() => navigate('/documents/upload')}
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <DocBadge code={docCode(documentDetail.docType)} size="md" />
        <span className="vs-mono" style={{ fontSize: 11, color: MUTED }}>{documentDetail.id}</span>
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
                    {section.fields.map((field) => (
                      <FieldCard key={field.key} field={field} rawData={extraction.rawData} />
                    ))}
                  </div>
                </div>
              ))}
              {extraction.lineItems?.length ? <LineItemsTable rows={extraction.lineItems} /> : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
