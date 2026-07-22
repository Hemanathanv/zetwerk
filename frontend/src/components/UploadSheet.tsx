import { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, X, CheckCircle2, AlertCircle, ArrowRight, RotateCw } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useUpload } from '@/contexts/UploadContext';
import { documentApi } from '@/auth/api';
import type { DocType } from '@/types/backend';
import { toast } from 'sonner';

type OcrTypeOption = { id: DocType; label: string };
type ShipmentOption = { id: string; label: string };
type Step = 'select' | 'configure' | 'uploading' | 'success' | 'error';

interface RunResult {
  ocrLabel: string;
  inputFileName: string;
  elapsedMs: number;
  outputUrl?: string;
  docId?: string;
}

const fallbackOcrTypes: OcrTypeOption[] = [
  { id: 'PACKING_LIST', label: 'Packing List' },
  { id: 'SALES_INVOICE', label: 'Sales Invoice' },
  { id: 'BILL_OF_LADING', label: 'Bill of Lading' },
  { id: 'SHIPPING_BILL', label: 'Shipping Bill' },
  { id: 'ENTRY_SUMMARY', label: 'CBP FORM 7501' },
  { id: 'OCEAN_FREIGHT', label: 'Ocean Freight' },
  { id: 'FREIGHT_FORWARDER_BILL', label: 'Freight Forwarder Bill' },
  { id: 'CHA_BILL', label: 'CHA Bill' },
  { id: 'CUSTOMER_BROKER_BILL', label: 'Customs Broker Bill' },
  { id: 'GRN_INBOUND', label: 'GRN Inbound' },
  { id: 'PORT_TO_WH', label: 'Port to WH' },
  { id: 'WH_TO_CUSTOMER', label: 'WH to Customer' },
  { id: 'US_SALES_INVOICE', label: 'US Sales Invoice' },
  { id: 'US_CARGO_RELEASE_ORDER', label: 'US Cargo Release Order' },
  { id: 'US_CUSTOMS_RELEASE_ORDER', label: 'US Customs Release Order' },
  { id: 'US_DELIVERY_ORDER', label: 'US Delivery Order' },
  { id: 'US_PACKING_LIST', label: 'US Packing List' },
];

function moduleSlugForDocType(value: DocType) {
  return value === 'CUSTOMER_BROKER_BILL' ? 'customs-broker-bill' : value.toLowerCase().replace(/_/g, '-');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadSheet() {
  const { open, closeUpload } = useUpload();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<Step>('select');
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ocrTypes, setOcrTypes] = useState<OcrTypeOption[]>(fallbackOcrTypes);
  const [selectedOcrType, setSelectedOcrType] = useState(fallbackOcrTypes[0]!.id);
  const [shipmentOptions, setShipmentOptions] = useState<ShipmentOption[]>([]);
  const [selectedShipment, setSelectedShipment] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isGeneratingPl, setIsGeneratingPl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setOcrTypes(fallbackOcrTypes);
    setSelectedOcrType((prev) =>
      fallbackOcrTypes.some((s) => s.id === prev) ? prev : fallbackOcrTypes[0]!.id
    );
  }, [open]);

  function reset() {
    setStep('select');
    setFile(null);
    setResult(null);
    setErrorMsg('');
    setSelectedShipment('');
    setIsGeneratingPl(false);
  }

  function handleClose() {
    if (step === 'uploading') return;
    closeUpload();
    setTimeout(reset, 300);
  }

  function acceptFile(f: File) {
    setFile(f);
    setStep('configure');
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) acceptFile(f);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
    e.target.value = '';
  }

  async function runUpload() {
    if (!file) return;
    setStep('uploading');
    const form = new FormData();
    form.append('file', file);
    form.append('docType', selectedOcrType);
    form.append('module', moduleSlugForDocType(selectedOcrType));
    try {
      const { data: payload } = await documentApi.upload(form);
      const uploadedDoc = payload.documents?.[0];
      setResult({
        ocrLabel: ocrTypes.find((type) => type.id === selectedOcrType)?.label ?? selectedOcrType,
        inputFileName: uploadedDoc?.fileName ?? file.name,
        elapsedMs: 0,
        outputUrl: uploadedDoc?.filePath,
        docId: uploadedDoc?.id,
      });
      setStep('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to upload right now.');
      setStep('error');
    }
  }

  async function generatePlNow() {
    if (!result) return;
    setIsGeneratingPl(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsGeneratingPl(false);
    toast.success('Draft O-PL generated successfully');
    closeUpload();
    setTimeout(reset, 300);
  }

  const ext = file?.name.split('.').pop()?.toUpperCase() ?? 'FILE';

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v && step !== 'uploading') handleClose(); }}>
      <SheetContent
        side="right"
        className="flex flex-col p-0 overflow-hidden"
        style={{ width: 480, maxWidth: '95vw' }}
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold">Upload Document</SheetTitle>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-3">
            {(['select', 'configure', 'uploading'] as Step[]).map((s, i) => {
              const labels = ['Select file', 'Configure', 'Process'];
              const stepOrder: Step[] = ['select', 'configure', 'uploading', 'success', 'error'];
              const currentIdx = stepOrder.indexOf(step);
              const thisIdx = stepOrder.indexOf(s);
              const done = currentIdx > thisIdx;
              const active = currentIdx === thisIdx || (s === 'uploading' && (step === 'success' || step === 'error'));
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className={`h-px w-6 ${done ? 'bg-primary' : 'bg-border'}`} />}
                  <div className="flex items-center gap-1.5">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                      done ? 'bg-primary text-primary-foreground' :
                      active ? 'bg-primary text-primary-foreground' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {done ? '✓' : i + 1}
                    </div>
                    <span className={`text-xs ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                      {labels[i]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Step: select ── */}
          {step === 'select' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-14 px-6 text-center cursor-pointer transition-all select-none ${
                isDragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/60 hover:bg-muted/30'
              }`}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: 'hsl(var(--primary) / 0.10)' }}
              >
                <UploadCloud className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">Drop your document here</p>
              <p className="text-xs text-muted-foreground mb-4">BOL, CBP FORM 7501, Invoice, Packing List, or any shipping document</p>
              <span className="text-xs font-medium text-primary hover:underline">Or click to browse</span>
              <div className="flex items-center gap-1.5 mt-5 flex-wrap justify-center">
                {['PDF', 'JPG', 'PNG', 'XLSX'].map((f) => (
                  <span key={f} className="px-2 py-0.5 rounded border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide" style={{ borderColor: 'hsl(var(--border))' }}>
                    {f}
                  </span>
                ))}
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx" className="hidden" onChange={onFileInput} />
            </div>
          )}

          {/* ── Step: configure ── */}
          {step === 'configure' && file && (
            <div className="space-y-5">
              {/* File card */}
              <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.5)' }}>
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'hsl(var(--primary) / 0.10)' }}
                >
                  <FileText className="w-4.5 h-4.5 text-primary" style={{ width: 18, height: 18 }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)} · <span className="font-bold">{ext}</span></p>
                </div>
                <button
                  onClick={() => { setFile(null); setStep('select'); }}
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* OCR type */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">OCR Type</label>
                <select
                  value={selectedOcrType}
                  onChange={(e) => setSelectedOcrType(e.target.value as DocType)}
                  className="w-full text-sm border rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  style={{ borderColor: 'hsl(var(--border))' }}
                  data-testid="upload-ocr-type-select"
                >
                  {ocrTypes.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground">Select the extraction template that matches your document type.</p>
              </div>

              {/* Shipment link (optional) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Link to Shipment <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <select
                  value={selectedShipment}
                  onChange={(e) => setSelectedShipment(e.target.value)}
                  className="w-full text-sm border rounded-lg px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  style={{ borderColor: 'hsl(var(--border))' }}
                >
                  <option value="">— No shipment —</option>
                  {shipmentOptions.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── Step: uploading ── */}
          {step === 'uploading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'hsl(var(--primary) / 0.10)' }}
              >
                <UploadCloud className="w-7 h-7 text-primary animate-bounce" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold mb-1">Running OCR…</p>
                <p className="text-xs text-muted-foreground truncate max-w-xs">{file?.name}</p>
              </div>
              {/* Indeterminate progress bar */}
              <div className="w-full max-w-xs h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(var(--muted))' }}>
                <div
                  className="h-full rounded-full animate-[indeterminate_1.4s_ease-in-out_infinite]"
                  style={{ background: 'hsl(var(--primary))', width: '40%' }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Extracting fields from your document. This may take a moment.</p>
            </div>
          )}

          {/* ── Step: success ── */}
          {step === 'success' && result && (
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'hsl(142 72% 29% / 0.1)' }}
              >
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-bold mb-1">OCR Complete</p>
                <p className="text-xs text-muted-foreground">{result.inputFileName}</p>
              </div>
              <div className="w-full rounded-xl border p-4 text-left space-y-2.5" style={{ borderColor: 'hsl(var(--border))' }}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium">{result.ocrLabel}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Elapsed</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{(result.elapsedMs / 1000).toFixed(1)}s</span>
                </div>
                {result.outputUrl && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Output</span>
                    <a href={result.outputUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium flex items-center gap-0.5">
                      Download <ArrowRight className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
              <div className="w-full flex gap-2">
                <Button
                  size="sm"
                  className="w-full gap-2"
                  onClick={generatePlNow}
                  disabled={isGeneratingPl}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {isGeneratingPl ? 'Generating...' : 'Generate PL Now'}
                </Button>
                <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleClose} disabled={isGeneratingPl}>
                  Skip
                </Button>
              </div>
              <Button
                size="sm"
                className="w-full gap-2"
                onClick={() => { handleClose(); navigate(result.docId ? `/documents/upload/${result.docId}` : '/documents/upload'); }}
              >
                {result.docId ? 'View document' : 'Browse documents'} <ArrowRight className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={reset}>
                <UploadCloud className="w-3.5 h-3.5" /> Upload another
              </Button>
            </div>
          )}

          {/* ── Step: error ── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: 'hsl(0 72% 51% / 0.1)' }}
              >
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-bold mb-1">Upload Failed</p>
                <p className="text-xs text-muted-foreground max-w-xs">{errorMsg}</p>
              </div>
              <Button size="sm" className="w-full gap-2" onClick={() => setStep('configure')}>
                <RotateCw className="w-3.5 h-3.5" /> Retry
              </Button>
              <Button variant="outline" size="sm" className="w-full gap-2" onClick={reset}>
                Start over
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions — only on configure step */}
        {step === 'configure' && (
          <div className="flex-shrink-0 px-6 pb-6 pt-4 border-t flex gap-2" style={{ borderColor: 'hsl(var(--border))' }}>
            <Button variant="outline" className="flex-1" onClick={() => setStep('select')}>
              Back
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={runUpload}
              disabled={!file || !selectedOcrType}
              data-testid="upload-confirm-button"
            >
              <UploadCloud className="w-4 h-4" /> Run OCR
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
