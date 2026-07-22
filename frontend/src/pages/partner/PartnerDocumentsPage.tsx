import { useState, useEffect, useMemo } from 'react';
import React from 'react';
import {
  FileText, Check, X, Loader2, Clock, CheckCircle, XCircle, Upload,
} from 'lucide-react';
import { useConfig } from '@/contexts/ConfigContext';
import { useShipments, useUploadableDocTypes } from '@/hooks/useOperationalData';
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

const FAILED_STATUSES = ['REJECTED', 'FAILED', 'ERROR', 'FAILED_PERMANENTLY'];

function buildLifecycleSteps(doc: any): Array<{ key: string; label: string; status: 'complete' | 'active' | 'failed' | 'pending' }> {
  const s = (doc.ocrStatus ?? '').toUpperCase();

  const steps: Array<{ key: string; label: string; status: 'complete' | 'active' | 'failed' | 'pending' }> = [
    {
      key: 'uploaded',
      label: 'Uploaded',
      status: 'complete',
    },
    {
      key: 'processed',
      label: 'Processed',
      status:
        ['PROCESSING', 'QUEUED', 'REPROCESSING'].includes(s) ? 'active' :
        ['EXTRACTED', 'REVIEWED', 'CLOSED', 'ARCHIVED'].includes(s) ? 'complete' :
        FAILED_STATUSES.includes(s) ? 'failed' :
        'pending',
    },
    {
      key: 'reviewed',
      label: 'Reviewed',
      status:
        s === 'EXTRACTED' ? 'active' :
        ['REVIEWED', 'CLOSED', 'ARCHIVED'].includes(s) ? 'complete' :
        FAILED_STATUSES.includes(s) ? 'failed' :
        'pending',
    },
  ];

  if (['REVIEWED', 'CLOSED', 'ARCHIVED'].includes(s)) {
    steps.push({
      key: 'validated',
      label: 'Validated',
      status: 'complete',
    });
  }

  return steps;
}

function PartnerDocCard({ doc, allDocTypes, shipments }: {
  doc: any; allDocTypes: any[]; shipments: any[];
}) {
  const dtInfo = allDocTypes.find((d: any) => d.typeCode === doc.documentType);
  const shipment = shipments.find((s: any) => s.id === doc.shipmentId);
  const metadata = (doc.metadata as any) || {};
  const steps = buildLifecycleSteps(doc);
  const rejectionReason = metadata.rejectionReason || metadata.rejectReason || null;
  const valSummary = (metadata.validationSummary as any) || null;
  const s = (doc.ocrStatus ?? '').toUpperCase();
  const isRejected = FAILED_STATUSES.includes(s);

  return (
    <div className={`bg-card rounded-xl p-5 border border-border ${isRejected ? 'border-l-4 border-l-red-500' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`px-2 py-1 rounded-md text-[12px] font-mono font-bold shrink-0 ${
            dtInfo?.geography === 'INDIA'
              ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
              : dtInfo?.geography === 'US'
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
              : 'bg-muted text-muted-foreground'
          }`}>
            {dtInfo?.displayName || doc.documentType || '??'}
          </div>
          <div>
            <h3 className="text-[14.5px] font-medium">{dtInfo?.displayName || doc.documentType}</h3>
            <div className="text-[12px] text-muted-foreground mt-0.5 truncate max-w-[260px]">
              {doc.fileName || 'Document'}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {shipment && (
            <div className="text-[12px] font-mono text-muted-foreground">
              {shipment.shipmentNumber || 'Pending ID'}
            </div>
          )}
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {formatTimeAgo(new Date(doc.createdAt))}
          </div>
        </div>
      </div>

      {/* Lifecycle bar */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {steps.map((step, idx) => (
          <React.Fragment key={step.key}>
            <div className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                step.status === 'complete' ? 'bg-teal-500' :
                step.status === 'active' ? 'bg-teal-500/20 ring-2 ring-teal-500' :
                step.status === 'failed' ? 'bg-red-500' :
                'bg-muted'
              }`}>
                {step.status === 'complete' && <Check className="w-3 h-3 text-white" />}
                {step.status === 'failed' && <X className="w-3 h-3 text-white" />}
                {step.status === 'active' && <div className="w-2 h-2 rounded-full bg-teal-500" />}
              </div>
              <span className={`text-[12px] ${
                step.status === 'complete' ? 'text-teal-600 dark:text-teal-400' :
                step.status === 'active' ? 'text-teal-600 dark:text-teal-400 font-medium' :
                step.status === 'failed' ? 'text-red-600 dark:text-red-400 font-medium' :
                'text-muted-foreground'
              }`}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`flex-1 h-px mx-1 min-w-[12px] ${
                step.status === 'complete' ? 'bg-teal-400' : 'bg-border'
              }`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Status message */}
      <div className="text-[13px] text-muted-foreground mt-2">
        {(s === 'UPLOADED' || s === 'QUEUED') && (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-blue-500 shrink-0" />
            Document is being processed. This usually takes a few minutes.
          </span>
        )}
        {(s === 'PROCESSING' || s === 'REPROCESSING') && (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-blue-500 shrink-0" />
            Extracting data from your document…
          </span>
        )}
        {s === 'EXTRACTED' && (
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-amber-500 shrink-0" />
            Data extracted. Awaiting review by the operations team.
          </span>
        )}
        {s === 'REVIEWED' && (
          <span className="flex items-center gap-1.5">
            <CheckCircle className="w-3 h-3 text-teal-500 shrink-0" />
            Document reviewed and approved.
            {valSummary && valSummary.failed === 0 && ' All validation checks passed.'}
            {valSummary && valSummary.failed > 0 && ` ${valSummary.failed} validation issue(s) noted — the team is handling it.`}
          </span>
        )}
        {(s === 'CLOSED' || s === 'ARCHIVED') && (
          <span className="flex items-center gap-1.5">
            <CheckCircle className="w-3 h-3 text-teal-500 shrink-0" />
            Complete. This document has been fully processed.
          </span>
        )}
      </div>

      {/* Rejection panel */}
      {isRejected && (
        <div className="mt-3 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-medium text-red-700 dark:text-red-400">
                Document rejected
              </div>
              {rejectionReason && (
                <p className="text-[13px] text-red-600/80 dark:text-red-400/80 mt-1">{rejectionReason}</p>
              )}
              <a href="/partner" className="text-[13px] text-teal-600 hover:underline mt-2 inline-flex items-center gap-1">
                <Upload className="w-3 h-3" /> Re-upload this document
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_MAP: Record<string, string> = {
  processing: 'UPLOADED,QUEUED,PROCESSING,REPROCESSING',
  review: 'EXTRACTED',
  done: 'REVIEWED,CLOSED,ARCHIVED',
  rejected: 'REJECTED,FAILED,ERROR,FAILED_PERMANENTLY',
};

export default function PartnerDocumentsPage() {
  const { docTypes: allDocTypes } = useConfig();
  const uploadableTypes = useUploadableDocTypes();
  const { shipments } = useShipments();

  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [shipmentFilter, setShipmentFilter] = useState('all');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'all' && STATUS_MAP[statusFilter]) {
      params.set('ocrStatus', STATUS_MAP[statusFilter]);
    }
    if (shipmentFilter !== 'all') {
      params.set('shipmentId', shipmentFilter);
    }

    fetch(`${API_BASE}/api/documents?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        const permitted = new Set(uploadableTypes.map((t: any) => t.value));
        const filtered = (d.data || []).filter((doc: any) => permitted.has(doc.documentType));
        setDocuments(filtered);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [statusFilter, shipmentFilter, uploadableTypes]);

  const docsByStatus = useMemo(() => ({
    processing: documents.filter(d => ['UPLOADED', 'QUEUED', 'PROCESSING', 'REPROCESSING'].includes((d.ocrStatus ?? '').toUpperCase())).length,
    review: documents.filter(d => (d.ocrStatus ?? '').toUpperCase() === 'EXTRACTED').length,
    done: documents.filter(d => ['REVIEWED', 'CLOSED', 'ARCHIVED'].includes((d.ocrStatus ?? '').toUpperCase())).length,
    rejected: documents.filter(d => FAILED_STATUSES.includes((d.ocrStatus ?? '').toUpperCase())).length,
  }), [documents]);

  const shipmentOptions = useMemo(() => {
    const ids = [...new Set(documents.map((d: any) => d.shipmentId).filter(Boolean))] as string[];
    return ids.map(id => {
      const s = shipments.find((sh: any) => sh.id === id);
      return { id, label: s?.shipmentNumber || 'Pending ID' };
    });
  }, [documents, shipments]);

  const filterTabs = [
    { value: 'all', label: 'All', count: documents.length },
    { value: 'processing', label: 'Processing', count: docsByStatus.processing },
    { value: 'review', label: 'Under Review', count: docsByStatus.review },
    { value: 'done', label: 'Complete', count: docsByStatus.done },
    { value: 'rejected', label: 'Rejected', count: docsByStatus.rejected },
  ].filter(tab => tab.count > 0 || tab.value === 'all');

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <a href="/partner" className="text-[14.5px] text-muted-foreground hover:text-foreground transition-colors">
            ← Home
          </a>
          <span className="text-muted-foreground">/</span>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>My Documents</h1>
        </div>
        <p className="text-[14.5px] text-muted-foreground mt-0.5">
          {documents.length} document{documents.length !== 1 ? 's' : ''} across{' '}
          {shipmentOptions.length} shipment{shipmentOptions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {filterTabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
              statusFilter === tab.value
                ? 'bg-teal-600 text-white'
                : 'bg-muted hover:bg-muted/70 text-foreground'
            }`}
          >
            {tab.label}
            <span className="ml-1 opacity-70">{tab.count}</span>
          </button>
        ))}

        <div className="flex-1" />

        {shipmentOptions.length > 1 && (
          <select
            value={shipmentFilter}
            onChange={e => setShipmentFilter(e.target.value)}
            className="text-[14.5px] border border-border rounded-lg px-2 py-1.5 bg-background text-foreground"
          >
            <option value="all">All shipments</option>
            {shipmentOptions.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border p-5 animate-pulse h-28" />
          ))}
        </div>
      )}

      {/* Document cards */}
      {!loading && (
        <div className="space-y-3">
          {documents.map(doc => (
            <PartnerDocCard
              key={doc.id}
              doc={doc}
              allDocTypes={allDocTypes}
              shipments={shipments}
            />
          ))}

          {documents.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <FileText className="w-8 h-8 mx-auto text-muted-foreground/40" />
              <h3 className="text-[14.5px] font-semibold mt-3">No documents found</h3>
              <p className="text-[13px] text-muted-foreground mt-1">
                {statusFilter !== 'all'
                  ? 'No documents match this filter. Try "All" to see everything.'
                  : 'Upload your first document from the home screen.'}
              </p>
              <a href="/partner" className="text-[13px] text-teal-600 hover:underline mt-2 inline-block">
                Go to upload →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
