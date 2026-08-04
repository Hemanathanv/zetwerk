import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Ship, Upload, CheckCircle, Clock, XCircle, Circle, FileText, X, Warehouse } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useShipments, useShipmentDocuments, useUploadableDocTypes } from '@/hooks/useOperationalData';
import { RoleBadge } from '@/components/RoleBadge';
import { Badge } from '@/components/ui/badge';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getPillStatus(doc: any | undefined): 'missing' | 'done' | 'pending' | 'failed' {
  if (!doc) return 'missing';
  if (doc.approvedAt) return 'done';
  const s = (doc.ocrStatus ?? '').toUpperCase();
  if (['FAILED', 'ERROR', 'FAILED_PERMANENTLY'].includes(s)) return 'failed';
  return 'pending';
}

function DocStatusBadge({ doc }: { doc: any }) {
  if (doc.approvedAt) {
    return <Badge intent="success" size="sm">Approved</Badge>;
  }
  const s = (doc.ocrStatus ?? '').toUpperCase();
  const map: Record<string, { label: string; intent: 'neutral' | 'info' | 'warning' | 'danger' }> = {
    QUEUED:              { label: 'Queued',       intent: 'neutral' },
    UPLOADED:            { label: 'Processing',   intent: 'info' },
    PROCESSING:          { label: 'Extracting',   intent: 'info' },
    REPROCESSING:        { label: 'Reprocessing', intent: 'info' },
    EXTRACTED:           { label: 'Under review', intent: 'warning' },
    COMPLETED:           { label: 'Under review', intent: 'warning' },
    FAILED:              { label: 'Failed',       intent: 'danger' },
    ERROR:               { label: 'Error',        intent: 'danger' },
    FAILED_PERMANENTLY:  { label: 'Failed',       intent: 'danger' },
    PENDING:             { label: 'Queued',       intent: 'neutral' },
  };
  const info = map[s] ?? { label: s || 'Uploaded', intent: 'neutral' };
  return <Badge intent={info.intent} size="sm">{info.label}</Badge>;
}

// ─── ShipmentUploadCard ─────────────────────────────────────────────────────

interface ShipmentUploadCardProps {
  shipment: any;
  uploadableTypes: any[];
  allDocTypes: any[];
  onUploaded?: (docs: any[]) => void;
}

function ShipmentUploadCard({ shipment, uploadableTypes, allDocTypes, onUploaded }: ShipmentUploadCardProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { documents: myDocs, refetch: refetchDocs } = useShipmentDocuments(shipment.id);

  const filteredDocs = useMemo(() => {
    const permitted = new Set(uploadableTypes.map(t => t.typeCode));
    return myDocs.filter((d: any) => permitted.has(d.documentType));
  }, [myDocs, uploadableTypes]);

  useEffect(() => {
    if (onUploaded) onUploaded(filteredDocs);
  }, [filteredDocs]);

  const handleUpload = useCallback(async () => {
    if (!file || !uploadingDocType) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('shipmentId', shipment.id);
      formData.append('docType', uploadingDocType);

      const res = await fetch(`${API_BASE}/api/uploads`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }

      setUploadResult({ success: true, message: 'Document uploaded successfully. Processing will begin shortly.' });
      setFile(null);
      setUploadingDocType(null);
      setShowUpload(false);
      await refetchDocs();
    } catch (err: any) {
      setUploadResult({ success: false, message: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  }, [file, uploadingDocType, shipment.id, refetchDocs]);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[14.5px] font-mono font-semibold leading-tight">
            {shipment.shipmentNumber
              ? shipment.shipmentNumber
              : <span className="text-muted-foreground italic font-normal text-[13px]">Pending BOL</span>
            }
          </div>
          <div className="text-[13px] text-muted-foreground mt-0.5 truncate">
            {[shipment.exporterName, shipment.buyerName].filter(Boolean).join(' → ')}
            {shipment.templateCorridor && (
              <span className="ml-1.5 text-[12px] bg-muted px-1.5 py-0.5 rounded font-medium">
                {shipment.templateCorridor}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => { setShowUpload(v => !v); setUploadResult(null); }}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
        >
          <Upload className="w-3 h-3" />
          Upload
        </button>
      </div>

      {/* Doc-type status pills */}
      {uploadableTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {uploadableTypes.map(dt => {
            const dtInfo = allDocTypes.find((d: any) => d.typeCode === dt.typeCode);
            const existingDoc = filteredDocs.find((d: any) => d.documentType === dt.typeCode);
            const status = getPillStatus(existingDoc);

            const pillStyle: Record<string, string> = {
              missing: 'text-muted-foreground bg-muted',
              done:    'text-teal-600 bg-teal-50',
              pending: 'text-amber-600 bg-amber-50',
              failed:  'text-red-600 bg-red-50',
            };
            const pillIcon: Record<string, React.ReactNode> = {
              missing: <Circle className="w-3 h-3" />,
              done:    <CheckCircle className="w-3 h-3" />,
              pending: <Clock className="w-3 h-3" />,
              failed:  <XCircle className="w-3 h-3" />,
            };

            const tooltip = existingDoc
              ? `${dtInfo?.displayName || dt.typeCode}: ${existingDoc.approvedAt ? 'Approved' : existingDoc.ocrStatus}`
              : `${dtInfo?.displayName || dt.typeCode}: Not uploaded`;

            return (
              <div
                key={dt.typeCode}
                className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-1 rounded-full ${pillStyle[status]}`}
                title={tooltip}
              >
                {pillIcon[status]}
                {dtInfo?.displayName || dt.typeCode}
              </div>
            );
          })}
        </div>
      )}

      {/* Upload result message */}
      {uploadResult && (
        <div className={`flex items-center gap-1.5 text-[13px] px-3 py-2 rounded-lg mb-3 ${
          uploadResult.success ? 'bg-teal-50 text-teal-700' : 'bg-red-50 text-red-700'
        }`}>
          {uploadResult.success
            ? <CheckCircle className="w-3 h-3 shrink-0" />
            : <XCircle className="w-3 h-3 shrink-0" />
          }
          {uploadResult.message}
        </div>
      )}

      {/* Upload form */}
      {showUpload && (
        <div className="border-t border-border pt-4 mt-1 space-y-4">
          {/* Doc type selector */}
          <div>
            <label className="text-[13px] font-medium text-muted-foreground block mb-2">
              Document type
            </label>
            <div className="flex flex-wrap gap-2">
              {uploadableTypes.map(dt => {
                const dtInfo = allDocTypes.find((d: any) => d.typeCode === dt.typeCode);
                const isSelected = uploadingDocType === dt.typeCode;
                const existingDoc = filteredDocs.find((d: any) => d.documentType === dt.typeCode);
                const alreadyUploaded = existingDoc && !existingDoc.approvedAt &&
                  !['FAILED', 'ERROR', 'FAILED_PERMANENTLY'].includes((existingDoc.ocrStatus ?? '').toUpperCase());

                return (
                  <button
                    key={dt.typeCode}
                    onClick={() => setUploadingDocType(dt.typeCode)}
                    disabled={!!alreadyUploaded}
                    className={[
                      'px-3 py-1.5 text-[13px] rounded-lg border-2 transition-all text-left',
                      alreadyUploaded
                        ? 'border-muted bg-muted/30 text-muted-foreground cursor-not-allowed opacity-50'
                        : isSelected
                        ? 'border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/30'
                        : 'border-border hover:border-teal-300 bg-background',
                    ].join(' ')}
                  >
                    {dtInfo?.displayName || dt.typeCode}
                    {alreadyUploaded && <span className="ml-1 text-teal-500">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* File drop zone */}
          {uploadingDocType && (
            <div>
              <label className="text-[13px] font-medium text-muted-foreground block mb-2">
                Select file (PDF)
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-teal-400 transition-colors"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-4 h-4 text-teal-600 shrink-0" />
                    <span className="text-[14.5px] truncate max-w-[200px]">{file.name}</span>
                    <span className="text-[13px] text-muted-foreground shrink-0">
                      ({(file.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); setFile(null); }}
                      className="text-red-400 hover:text-red-600 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 mx-auto text-muted-foreground/40 mb-1" />
                    <p className="text-[13px] text-muted-foreground">Click to select PDF</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* Submit / cancel */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setShowUpload(false); setFile(null); setUploadingDocType(null); }}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            {uploadingDocType && file && (
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-4 py-2 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {uploading ? 'Uploading…' : 'Upload Document'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function PartnerUploadPage() {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { docTypes: allDocTypes } = useConfig();
  const { shipments, loading: shipmentsLoading } = useShipments();

  const allUploadable = useUploadableDocTypes();

  const uploadCodes = permissions.docTypes.upload ?? [];
  const roleFilteredTypes = useMemo(
    () => allUploadable.filter(dt => uploadCodes.includes(dt.typeCode)),
    [allUploadable, uploadCodes.join(',')]
  );

  const activeShipments = useMemo(
    () => shipments.filter(s => ['active', 'pending'].includes((s.status ?? '').toLowerCase())),
    [shipments]
  );
  const completedShipments = useMemo(
    () => shipments.filter(s => (s.status ?? '').toLowerCase() === 'completed'),
    [shipments]
  );

  // Recently uploaded — try org-level docs list; silently ignore 403
  const [recentDocs, setRecentDocs] = useState<any[]>([]);
  const loadRecent = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/documents?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const permitted = new Set(roleFilteredTypes.map(t => t.typeCode));
      setRecentDocs((data.data ?? []).filter((d: any) => permitted.has(d.documentType)));
    } catch {
      // No permission or network error — skip section
    }
  }, [roleFilteredTypes]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // Collect per-shipment docs for "recently uploaded" aggregation
  const [perShipmentDocs, setPerShipmentDocs] = useState<Record<string, any[]>>({});
  const handleShipmentDocsLoaded = useCallback((docs: any[], shipmentId: string) => {
    setPerShipmentDocs(prev => ({ ...prev, [shipmentId]: docs }));
  }, []);

  const firstName = user?.fullName?.split(' ')[0] ?? 'Partner';
  const orgName = user?.org?.name ?? '';
  const roleId = user?.role?.id ?? '';

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* ── Welcome header ── */}
      <div className="mb-8">
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>
          Welcome, {firstName}
        </h1>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {orgName && (
            <span className="text-[14.5px] text-muted-foreground">{orgName}</span>
          )}
          {roleId && (
            <>
              {orgName && <span className="text-muted-foreground/50 text-[14.5px]">·</span>}
              <RoleBadge roleId={roleId} size="sm" />
            </>
          )}
        </div>
      </div>

      {/* ── Quick links ── */}
      <div className="flex items-center gap-3 mb-6 -mt-2">
        <a
          href="/partner/documents"
          className="text-[13px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <FileText className="w-3 h-3" /> My Documents
        </a>
        <span className="text-muted-foreground/30">·</span>
        <a
          href="/partner/warehouse"
          className="text-[13px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <Warehouse className="w-3 h-3" /> Warehouse
        </a>
      </div>

      {/* ── Assigned shipments ── */}
      {shipmentsLoading ? (
        <div className="space-y-3 mb-8">
          {[1, 2].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-5 animate-pulse">
              <div className="h-4 bg-muted rounded w-32 mb-2" />
              <div className="h-3 bg-muted rounded w-48" />
            </div>
          ))}
        </div>
      ) : activeShipments.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center mb-8">
          <Ship className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
          <h3 className="text-[14.5px] font-semibold">No assigned shipments</h3>
          <p className="text-[13px] text-muted-foreground mt-1">
            You'll see shipments here once your organisation is tagged as a partner.
          </p>
        </div>
      ) : (
        <div className="mb-8">
          <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Assigned Shipments ({activeShipments.length})
          </h2>
          <div className="space-y-4">
            {activeShipments.map(shipment => (
              <ShipmentUploadCard
                key={shipment.id}
                shipment={shipment}
                uploadableTypes={roleFilteredTypes}
                allDocTypes={allDocTypes}
                onUploaded={docs => handleShipmentDocsLoaded(docs, shipment.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Recently uploaded ── */}
      {recentDocs.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">
              Recently Uploaded
            </h2>
            <a href="/partner/documents" className="text-[13px] text-teal-600 hover:underline">
              View all documents →
            </a>
          </div>
          <div className="space-y-1.5">
            {recentDocs.slice(0, 10).map(doc => {
              const dtInfo = allDocTypes.find((d: any) => d.typeCode === doc.documentType);
              const shipment = shipments.find((s: any) => s.id === doc.shipmentId);
              const geoColor = dtInfo?.geography === 'INDIA'
                ? 'bg-orange-100 text-orange-700'
                : dtInfo?.geography === 'US'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-muted text-muted-foreground';

              return (
                <div key={doc.id} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
                  <span className={`text-[12px] font-mono font-bold px-2 py-1 rounded shrink-0 ${geoColor}`}>
                    {dtInfo?.displayName ?? doc.documentType}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">
                      {dtInfo?.displayName || doc.documentType}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {shipment?.shipmentNumber ?? 'Pending'} · {formatTimeAgo(new Date(doc.createdAt))}
                    </div>
                  </div>
                  <DocStatusBadge doc={doc} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Completed shipments (collapsed) ── */}
      {completedShipments.length > 0 && (
        <details className="group">
          <summary className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1.5">
            <span className="group-open:rotate-90 transition-transform inline-block">›</span>
            Completed Shipments ({completedShipments.length})
          </summary>
          <div className="mt-3 space-y-2">
            {completedShipments.map(s => (
              <div
                key={s.id}
                className="bg-card rounded-lg border border-border p-3 flex items-center gap-3 opacity-60"
              >
                <CheckCircle className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-mono">{s.shipmentNumber ?? 'Pending'}</span>
                  {(s.exporterName || s.buyerName) && (
                    <span className="text-[12px] text-muted-foreground ml-2">
                      {[s.exporterName, s.buyerName].filter(Boolean).join(' → ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
