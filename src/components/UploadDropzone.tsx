import { useState } from 'react';
import { UploadCloud } from 'lucide-react';

const acceptedFormats = ['PDF', 'JPG', 'PNG', 'XLSX'];

export function UploadDropzone() {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      className="bg-card border rounded-lg p-5 flex flex-col"
      style={{ borderColor: 'hsl(var(--card-border))' }}
      data-testid="upload-dropzone-card"
    >
      <h3 className="text-sm font-semibold mb-3">Document Upload</h3>
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={() => setIsDragging(false)}
        className={`flex-1 border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/30'
        }`}
        data-testid="dropzone-area"
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
          style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}
        >
          <UploadCloud className="w-5 h-5 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          Upload BOL, BOE, Invoice, PL or supporting shipping documents
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Files are sent for OCR extraction and validation workflow
        </p>
        <p className="text-xs text-primary cursor-pointer hover:underline mb-3">
          Or click to browse
        </p>
        <div className="flex items-center gap-1.5 flex-wrap justify-center">
          {acceptedFormats.map((fmt) => (
            <span
              key={fmt}
              className="px-2 py-0.5 rounded border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide"
              style={{ borderColor: 'hsl(var(--border))' }}
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
