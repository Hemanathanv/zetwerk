import { useState } from 'react';
import { FileText, RotateCw, CheckCircle2 } from 'lucide-react';
import { Document } from '@/data/mockData';
import { StatusBadge } from './StatusBadge';

type DocumentStatusBoardProps = {
  documents: Document[];
};

const extractedJson = `{
  "invoice_no": "INV-2031",
  "date": "2024-04-01",
  "value": "$84,250.00",
  "currency": "USD",
  "vendor": "Zetwerk Mfg Ltd",
  "buyer": "Unimatics Inc"
}`;

export function DocumentStatusBoard({ documents }: DocumentStatusBoardProps) {
  const indiaDoc = documents.filter((d) => d.group === 'india');
  const usDocs = documents.filter((d) => d.group === 'us');

  return (
    <div className="flex gap-4 min-h-0" data-testid="document-status-board">
      {/* Document list */}
      <div className="flex-1 overflow-auto min-w-0">
        <DocGroup title="India Export Documents" docs={indiaDoc} />
        <div className="mt-3">
          <DocGroup title="US Import Documents" docs={usDocs} />
        </div>
      </div>

      {/* Recent extraction mini panel */}
      <div
        className="w-52 flex-shrink-0 rounded-lg border p-3 flex flex-col gap-2.5"
        style={{ borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}
      >
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-xs font-semibold">Recent Extraction</span>
        </div>

        {/* PDF thumbnail placeholder */}
        <div
          className="w-full h-16 rounded flex items-center justify-center gap-1.5 border"
          style={{ backgroundColor: 'hsl(var(--muted))', borderColor: 'hsl(var(--border))' }}
        >
          <FileText className="w-5 h-5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Sales Invoice.pdf</span>
        </div>

        {/* OCR Confidence */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">OCR Confidence</span>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">98.4%</span>
        </div>

        {/* JSON preview */}
        <div
          className="rounded p-2 text-[9px] leading-4 font-mono overflow-auto max-h-28 whitespace-pre"
          style={{
            backgroundColor: 'hsl(var(--muted))',
            color: 'hsl(var(--muted-foreground))',
            fontFamily: 'var(--app-font-mono)',
          }}
        >
          {extractedJson}
        </div>

        {/* Buttons */}
        <button
          className="w-full py-1.5 rounded text-xs font-medium text-primary-foreground bg-primary hover:opacity-90 transition-opacity"
          data-testid="button-validate-ocr"
        >
          Validate
        </button>
        <button
          className="w-full py-1.5 rounded text-xs font-medium border hover:bg-muted transition-colors flex items-center justify-center gap-1"
          style={{ borderColor: 'hsl(var(--border))' }}
          data-testid="button-rerun-ocr"
        >
          <RotateCw className="w-3 h-3" />
          Re-run OCR
        </button>
      </div>
    </div>
  );
}

function DocGroup({ title, docs }: { title: string; docs: Document[] }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 px-1">{title}</p>
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: 'hsl(var(--border))' }}
      >
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left py-1.5 px-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Document</th>
              <th className="text-left py-1.5 px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upload</th>
              <th className="text-left py-1.5 px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">OCR</th>
              <th className="text-left py-1.5 px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Owner</th>
              <th className="text-left py-1.5 px-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc, i) => (
              <tr
                key={doc.id}
                className="border-t hover:bg-muted/30 transition-colors"
                style={{ borderColor: 'hsl(var(--border))' }}
                data-testid={`row-doc-${doc.id}`}
              >
                <td className="py-1.5 px-2.5 font-medium text-foreground/80">{doc.name}</td>
                <td className="py-1.5 px-2"><StatusBadge status={doc.uploadStatus} /></td>
                <td className="py-1.5 px-2"><StatusBadge status={doc.ocrStatus} /></td>
                <td className="py-1.5 px-2 text-muted-foreground text-[10px]">{doc.validationOwner}</td>
                <td className="py-1.5 px-2"><StatusBadge status={doc.finalStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
