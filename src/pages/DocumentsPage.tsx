import { useState } from 'react';
import { FileText, RotateCw, CheckCircle2, Upload } from 'lucide-react';
import { documents, shipments } from '@/data/mockData';
import { StatusBadge } from '@/components/StatusBadge';
import { UploadDropzone } from '@/components/UploadDropzone';

type DocFilter = 'All' | 'Completed' | 'TBP' | 'Confirming' | 'Yet to receive' | 'Exception';
const filterOptions: DocFilter[] = ['All', 'Completed', 'TBP', 'Confirming', 'Yet to receive', 'Exception'];

const extractedJson = `{
  "invoice_no": "INV-2031",
  "date": "2024-04-01",
  "value": "$84,250.00",
  "currency": "USD",
  "vendor": "Zetwerk Mfg Ltd",
  "buyer": "Unimatics Inc"
}`;

export function DocumentsPage() {
  const [filter, setFilter]       = useState<DocFilter>('All');
  const [shipFilter, setShipFilter] = useState<string>('All');

  const filtered = documents.filter(d => {
    const matchStatus = filter === 'All' || d.finalStatus === filter;
    const matchShip   = shipFilter === 'All' || d.shipmentId === shipFilter;
    return matchStatus && matchShip;
  });

  const completed   = documents.filter(d => d.finalStatus === 'Completed').length;
  const tbp         = documents.filter(d => d.finalStatus === 'TBP').length;
  const confirming  = documents.filter(d => d.finalStatus === 'Confirming').length;
  const ytr         = documents.filter(d => d.finalStatus === 'Yet to receive').length;
  const exceptions  = documents.filter(d => d.finalStatus === 'Exception').length;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold">Document AI</h1>
        <p className="text-xs text-muted-foreground mt-0.5">OCR extraction, validation workflows, and document status across all shipments</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Completed',      value: completed,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { label: 'Confirming',     value: confirming, color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'TBP',            value: tbp,        color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Yet to receive', value: ytr,        color: 'text-slate-500',                         bg: 'bg-slate-50 dark:bg-slate-800/30' },
          { label: 'Exception',      value: exceptions, color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-lg px-3 py-2.5 text-center`}>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-4 min-h-0">
        {/* Document table */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Filters row */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="flex items-center gap-1 flex-wrap">
              {filterOptions.map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="h-4 w-px bg-border" />
            <select
              value={shipFilter}
              onChange={e => setShipFilter(e.target.value)}
              className="text-xs border rounded-md px-2 py-1 bg-background text-foreground focus:outline-none"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              <option value="All">All Shipments</option>
              {shipments.map(s => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
            </select>
          </div>

          <div className="bg-card border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(var(--card-border))' }}>
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  {['Document', 'Shipment', 'Group', 'Upload', 'OCR', 'Owner', 'Status', 'Updated'].map(col => (
                    <th key={col} className="text-left py-2.5 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-b whitespace-nowrap" style={{ borderColor: 'hsl(var(--border))' }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(doc => (
                  <tr key={doc.id} className="border-b hover:bg-muted/30 transition-colors" style={{ borderColor: 'hsl(var(--border))' }}>
                    <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        {doc.name}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-primary font-semibold">{doc.shipmentId}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${
                        doc.group === 'india'
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {doc.group === 'india' ? 'India' : 'US'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3"><StatusBadge status={doc.uploadStatus} /></td>
                    <td className="py-2.5 px-3"><StatusBadge status={doc.ocrStatus} /></td>
                    <td className="py-2.5 px-3 text-muted-foreground">{doc.validationOwner}</td>
                    <td className="py-2.5 px-3"><StatusBadge status={doc.finalStatus} /></td>
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{doc.lastUpdated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t text-xs text-muted-foreground" style={{ borderColor: 'hsl(var(--border))' }}>
              Showing {filtered.length} of {documents.length} documents
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-56 flex-shrink-0 space-y-3">
          {/* OCR extraction */}
          <div className="bg-card border rounded-lg p-3" style={{ borderColor: 'hsl(var(--card-border))' }}>
            <div className="flex items-center gap-1.5 mb-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs font-semibold">Recent Extraction</span>
            </div>
            <div className="w-full h-14 rounded flex items-center justify-center gap-1.5 border mb-2" style={{ backgroundColor: 'hsl(var(--muted))', borderColor: 'hsl(var(--border))' }}>
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Sales Invoice.pdf</span>
            </div>
            <div className="flex justify-between text-[10px] mb-2">
              <span className="text-muted-foreground">OCR Confidence</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">98.4%</span>
            </div>
            <div className="rounded p-2 text-[9px] leading-4 font-mono overflow-auto max-h-28 whitespace-pre mb-2" style={{ backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)' }}>
              {extractedJson}
            </div>
            <button className="w-full py-1.5 rounded text-xs font-medium text-primary-foreground bg-primary hover:opacity-90 mb-1.5">Validate</button>
            <button className="w-full py-1.5 rounded text-xs font-medium border hover:bg-muted flex items-center justify-center gap-1" style={{ borderColor: 'hsl(var(--border))' }}>
              <RotateCw className="w-3 h-3" /> Re-run OCR
            </button>
          </div>

          {/* Upload */}
          <UploadDropzone />
        </div>
      </div>
    </div>
  );
}
