import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { FileText, Upload, UploadCloud, Download, Loader2, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/vs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TEAL        = 'hsl(var(--vs-teal))';
const TEAL_DARK   = 'hsl(var(--vs-teal-dark))';
const TEAL_ACTIVE_BG = 'hsla(173,58%,39%,0.04)';
const MUTED       = 'hsl(var(--muted-foreground))';
const DESTRUCTIVE = 'hsl(var(--destructive))';

type Method = 'invoice' | 'csv';

type FormState = {
  invoiceNumber: string;
  invoiceDate: string;
  exporter: string;
  buyer: string;
  shipmentType: string;
  workflowTemplate: string;
  portOfLoading: string;
  destination: string;
  projectRef: string;
  estimatedValue: string;
  incoterm: string;
  notes: string;
  indiaOwner: string;
  usOwner: string;
};

type Errors = Partial<Record<keyof FormState, string>>;

const REQUIRED: (keyof FormState)[] = ['invoiceNumber', 'invoiceDate', 'exporter', 'buyer', 'shipmentType', 'workflowTemplate'];

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'hsl(var(--foreground))' }}>
      {children}
      {required && <span style={{ color: DESTRUCTIVE, marginLeft: 2 }}>*</span>}
    </label>
  );
}

function HelperText({ children, error }: { children?: React.ReactNode; error?: string }) {
  if (error) return <p style={{ fontSize: 11, color: DESTRUCTIVE, marginTop: 4 }}>{error}</p>;
  if (children) return <p style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{children}</p>;
  return null;
}

function StyledSelect({
  value,
  onChange,
  children,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: `1px solid ${error ? DESTRUCTIVE : 'hsl(var(--border))'}`,
        background: 'hsl(var(--card))',
        color: 'hsl(var(--foreground))',
        fontSize: 14,
        outline: 'none',
        cursor: 'pointer',
        appearance: 'auto',
      }}
    >
      {children}
    </select>
  );
}

export function CreateShipmentPage() {
  const [, navigate] = useLocation();
  const [method, setMethod] = useState<Method>('invoice');
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [form, setForm] = useState<FormState>({
    invoiceNumber: '',
    invoiceDate: '',
    exporter: 'Zetwerk Manufacturing Businesses Pvt Ltd',
    buyer: 'Unimacts Manufacturing Mx., LLC',
    shipmentType: 'container',
    workflowTemplate: 'standard-container',
    portOfLoading: 'Mundra',
    destination: '',
    projectRef: '',
    estimatedValue: '',
    incoterm: 'FOB',
    notes: '',
    indiaOwner: '',
    usOwner: '',
  });

  function setField(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  function validate(): boolean {
    const next: Errors = {};
    for (const key of REQUIRED) {
      if (!form[key].trim()) next[key] = 'This field is required';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleCreate() {
    if (!validate()) return;
    setCreating(true);
    setTimeout(() => {
      setCreating(false);
      navigate('/dashboard');
    }, 1000);
  }

  const inputStyle = (key: keyof FormState) => ({
    borderColor: errors[key] ? DESTRUCTIVE : undefined,
  });

  return (
    <div style={{ padding: '28px', maxWidth: 800, margin: '0 auto' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, marginBottom: 10 }}>
        <Link href="/dashboard" style={{ color: MUTED, textDecoration: 'none' }}>
          Shipments
        </Link>
        <ChevronRight style={{ width: 12, height: 12 }} />
        <span style={{ color: 'hsl(var(--foreground))' }}>New shipment</span>
      </div>

      <PageHeader
        title="Create new shipment"
        subtitle="Start a new shipment by entering the Sales Invoice details or uploading a CSV file"
      />

      {/* ── Method toggle ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {[
          {
            key: 'invoice' as Method,
            icon: FileText,
            title: 'From Sales Invoice',
            desc: 'Enter or pull invoice details from the accounting system. Best for single shipments.',
          },
          {
            key: 'csv' as Method,
            icon: Upload,
            title: 'CSV Bulk Upload',
            desc: 'Upload a CSV file with multiple shipments. Template available for download.',
          },
        ].map(({ key, icon: Icon, title, desc }) => {
          const active = method === key;
          return (
            <div
              key={key}
              onClick={() => setMethod(key)}
              style={{
                padding: 20,
                borderRadius: 12,
                border: active ? `2px solid ${TEAL}` : '1px solid hsl(var(--border))',
                background: active ? TEAL_ACTIVE_BG : 'hsl(var(--card))',
                cursor: 'pointer',
                transition: 'all 200ms',
              }}
            >
              <Icon style={{ width: 24, height: 24, color: active ? TEAL : MUTED, marginBottom: 10 }} />
              <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px', color: 'hsl(var(--foreground))' }}>{title}</p>
              <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.5 }}>{desc}</p>
            </div>
          );
        })}
      </div>

      {/* ── Invoice form ── */}
      {method === 'invoice' && (
        <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px hsla(0,0%,0%,0.06)' }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 20px' }}>Shipment details</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px 24px' }}>

            {/* Row 1 */}
            <div>
              <FieldLabel required>Sales Invoice Number</FieldLabel>
              <Input
                placeholder="e.g., KA/UM/2526/00773"
                value={form.invoiceNumber}
                onChange={(e) => setField('invoiceNumber', e.target.value)}
                style={inputStyle('invoiceNumber')}
              />
              {errors.invoiceNumber
                ? <HelperText error={errors.invoiceNumber} />
                : <HelperText>Enter the invoice number from your accounting system</HelperText>
              }
            </div>

            <div>
              <FieldLabel required>Invoice Date</FieldLabel>
              <Input
                type="date"
                value={form.invoiceDate}
                onChange={(e) => setField('invoiceDate', e.target.value)}
                style={inputStyle('invoiceDate')}
              />
              <HelperText error={errors.invoiceDate} />
            </div>

            {/* Row 2 */}
            <div>
              <FieldLabel required>Exporter</FieldLabel>
              <StyledSelect value={form.exporter} onChange={(v) => setField('exporter', v)} error={errors.exporter}>
                <option>Zetwerk Manufacturing Businesses Pvt Ltd</option>
                <option>Immadi E-Commerce Pvt Ltd</option>
              </StyledSelect>
              <HelperText error={errors.exporter} />
            </div>

            <div>
              <FieldLabel required>Buyer / Consignee</FieldLabel>
              <Input
                value={form.buyer}
                onChange={(e) => setField('buyer', e.target.value)}
                style={inputStyle('buyer')}
              />
              <HelperText error={errors.buyer} />
            </div>

            {/* Row 3 */}
            <div>
              <FieldLabel required>Shipment Type</FieldLabel>
              <StyledSelect value={form.shipmentType} onChange={(v) => setField('shipmentType', v)} error={errors.shipmentType}>
                <option value="container">Container (FCL)</option>
                <option value="breakbulk">Break Bulk</option>
              </StyledSelect>
              <HelperText error={errors.shipmentType} />
            </div>

            <div>
              <FieldLabel required>Workflow Template</FieldLabel>
              <StyledSelect value={form.workflowTemplate} onChange={(v) => setField('workflowTemplate', v)} error={errors.workflowTemplate}>
                <option value="standard-container">Standard India → US (Container)</option>
                <option value="standard-breakbulk">Standard India → US (Break Bulk)</option>
                <option value="custom">Custom...</option>
              </StyledSelect>
              <HelperText error={errors.workflowTemplate}>Defines the stages, SLAs, and role assignments</HelperText>
            </div>

            {/* Row 4 */}
            <div>
              <FieldLabel>Port of Loading</FieldLabel>
              <StyledSelect value={form.portOfLoading} onChange={(v) => setField('portOfLoading', v)}>
                <option>Mundra</option>
                <option>Chennai</option>
                <option>Nhava Sheva</option>
                <option>Kolkata</option>
              </StyledSelect>
            </div>

            <div>
              <FieldLabel>Final Destination</FieldLabel>
              <Input
                placeholder="e.g., 14600 Arville St, Sloan NV 89054"
                value={form.destination}
                onChange={(e) => setField('destination', e.target.value)}
              />
            </div>

            {/* Row 5 — full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel>Project / PO Reference</FieldLabel>
              <Input
                placeholder="e.g., J44CES25090019"
                value={form.projectRef}
                onChange={(e) => setField('projectRef', e.target.value)}
              />
              <HelperText>Links this shipment to a project for consolidated tracking</HelperText>
            </div>

            {/* Row 6 */}
            <div>
              <FieldLabel>Estimated Value (USD)</FieldLabel>
              <Input
                className="vs-mono"
                placeholder="e.g., 142,384"
                value={form.estimatedValue}
                onChange={(e) => setField('estimatedValue', e.target.value)}
              />
            </div>

            <div>
              <FieldLabel>Incoterm</FieldLabel>
              <StyledSelect value={form.incoterm} onChange={(v) => setField('incoterm', v)}>
                <option>FOB</option>
                <option>CIF</option>
                <option>CFR</option>
                <option>EXW</option>
                <option>DDP</option>
              </StyledSelect>
            </div>

            {/* Row 7 — full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel>Internal Notes</FieldLabel>
              <textarea
                rows={3}
                placeholder="Any special instructions for this shipment..."
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--card))',
                  color: 'hsl(var(--foreground))',
                  fontSize: 14,
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                }}
              />
            </div>
          </div>

          {/* Assignment section */}
          <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 20, marginTop: 20 }}>
            <h4 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>Assignment</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px 24px' }}>
              <div>
                <FieldLabel>India Logistics Owner</FieldLabel>
                <StyledSelect value={form.indiaOwner} onChange={(v) => setField('indiaOwner', v)}>
                  <option value="priya">Priya K</option>
                  <option value="">Unassigned</option>
                </StyledSelect>
              </div>
              <div>
                <FieldLabel>US Logistics Owner</FieldLabel>
                <StyledSelect value={form.usOwner} onChange={(v) => setField('usOwner', v)}>
                  <option value="">Unassigned</option>
                  <option value="james">James R</option>
                </StyledSelect>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <HelperText>You can reassign at any stage from the shipment detail page</HelperText>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV upload ── */}
      {method === 'csv' && (
        <div style={{ background: 'hsl(var(--card))', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px hsla(0,0%,0%,0.06)' }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 20px' }}>Upload shipment CSV</h3>

          <div
            onClick={() => document.getElementById('csv-file-input')?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) setCsvFile(file);
            }}
            style={{
              border: `2px dashed ${dragOver ? TEAL : 'hsl(var(--border))'}`,
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              background: dragOver ? TEAL_ACTIVE_BG : 'hsl(var(--background))',
              cursor: 'pointer',
              transition: 'all 200ms',
            }}
          >
            <input
              id="csv-file-input"
              type="file"
              accept=".csv,.xlsx"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setCsvFile(file);
              }}
            />
            <UploadCloud style={{ width: 40, height: 40, color: MUTED, margin: '0 auto 12px' }} />
            <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 6px', color: 'hsl(var(--foreground))' }}>
              {csvFile ? csvFile.name : 'Drop CSV file here or click to browse'}
            </p>
            <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
              {csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : 'Supports .csv and .xlsx files up to 5MB'}
            </p>
          </div>

          {/* Template download */}
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download style={{ width: 14, height: 14, color: TEAL }} />
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              style={{ fontSize: 13, color: TEAL, textDecoration: 'none' }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              Download CSV template
            </a>
          </div>
          <p style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>Use this template to ensure correct column mapping</p>

          {/* Column mapping preview */}
          <div style={{
            background: 'hsl(var(--muted))',
            borderRadius: 8,
            padding: 16,
            marginTop: 16,
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px', color: 'hsl(var(--foreground))' }}>CSV Preview</p>
            <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
              {csvFile
                ? `File "${csvFile.name}" selected. Column mapping will appear here after processing.`
                : 'No file selected. Upload a CSV to see column mapping and row preview.'
              }
            </p>
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
        <Button variant="outline" onClick={() => navigate('/dashboard')}>
          Cancel
        </Button>
        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 20px',
            borderRadius: 8,
            border: 'none',
            background: creating ? TEAL_DARK : TEAL,
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor: creating ? 'not-allowed' : 'pointer',
            transition: 'background 200ms',
            opacity: creating ? 0.85 : 1,
          }}
          onMouseEnter={(e) => { if (!creating) (e.currentTarget as HTMLElement).style.background = TEAL_DARK; }}
          onMouseLeave={(e) => { if (!creating) (e.currentTarget as HTMLElement).style.background = TEAL; }}
        >
          {creating && <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />}
          {creating ? 'Creating...' : 'Create shipment'}
        </button>
      </div>
    </div>
  );
}
