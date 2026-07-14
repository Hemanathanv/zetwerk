import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Plus, FileDown, ShieldCheck, Shield, Pencil } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminTable, Column } from '@/components/admin/AdminTable';
import { AdminModal } from '@/components/admin/AdminModal';
import { AdminFormSection } from '@/components/admin/AdminFormSection';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPut, apiPost } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string; productCode: string; description: string | null;
  hsCode: string | null; htsCode: string | null;
  unitWeightKg: string | number | null; dimensions: string | null;
  countryOfOrigin: string | null; section232Applicable: boolean;
  defaultMeltCountry: string | null; defaultSmeltCountry: string | null;
  defaultCastCountry: string | null; isActive: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };
const INP_S = (extra?: React.CSSProperties): React.CSSProperties => ({
  width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 14.5,
  border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
  color: 'hsl(var(--foreground))', ...extra,
});
const LBL_S: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'block' };
const HELPER_S: React.CSSProperties = { fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3, display: 'block' };

const CSV_TEMPLATE = `productCode,description,hsCode,htsCode,unitWeightKg,countryOfOrigin,section232Applicable
ZT-MNT-34A,Steel mounting rail galvanized 2100mm,7308.90,7308.90.9590,12.40,India,true
ZT-CLP-12,Galvanized C-clamp 12mm,7326.90,7326.90.8688,0.35,India,true`;

// ─── ProductEditModal ──────────────────────────────────────────────────────────

function ProductEditModal({ product, onClose, onSave }: {
  product: Partial<Product>; onClose: () => void;
  onSave: (data: Partial<Product>) => Promise<void>;
}) {
  const [code,        setCode]       = useState(product.productCode ?? '');
  const [desc,        setDesc]       = useState(product.description ?? '');
  const [origin,      setOrigin]     = useState(product.countryOfOrigin ?? '');
  const [dims,        setDims]       = useState(product.dimensions ?? '');
  const [hsCode,      setHsCode]     = useState(product.hsCode ?? '');
  const [htsCode,     setHtsCode]    = useState(product.htsCode ?? '');
  const [weight,      setWeight]     = useState(product.unitWeightKg != null ? String(product.unitWeightKg) : '');
  const [s232,        setS232]       = useState(product.section232Applicable ?? false);
  const [melt,        setMelt]       = useState(product.defaultMeltCountry ?? '');
  const [smelt,       setSmelt]      = useState(product.defaultSmeltCountry ?? '');
  const [cast,        setCast]       = useState(product.defaultCastCountry ?? '');
  const [isActive,    setIsActive]   = useState(product.isActive ?? true);
  const [saving,      setSaving]     = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!code || !desc) { toast({ title: 'Product code and description are required', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await onSave({
        productCode: code, description: desc, countryOfOrigin: origin || null, dimensions: dims || null,
        hsCode: hsCode || null, htsCode: htsCode || null,
        unitWeightKg: weight !== '' ? weight : null,
        section232Applicable: s232,
        defaultMeltCountry: s232 ? (melt || null) : null,
        defaultSmeltCountry: s232 ? (smelt || null) : null,
        defaultCastCountry: s232 ? (cast || null) : null,
        isActive,
      });
      toast({ title: product.id ? 'Product updated' : 'Product created' });
      onClose();
    } catch { toast({ title: 'Save failed', variant: 'destructive' }); }
    setSaving(false);
  }

  return (
    <AdminModal
      open onClose={onClose} size="lg"
      title={product.id ? `Edit Product — ${product.productCode}` : 'Add Product'}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Saving…</> : 'Save'}
          </Button>
        </div>
      }
    >
      <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>
        {/* Section: Product Identity */}
        <AdminFormSection title="Product Identity">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={LBL_S}>Product Code *</label>
              <input style={INP_S(MONO)} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g., ZT-MNT-34A" disabled={!!product.id} />
            </div>
            <div>
              <label style={LBL_S}>Country of Origin</label>
              <input style={INP_S()} value={origin} onChange={e => setOrigin(e.target.value)} placeholder="India" />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={LBL_S}>Description *</label>
            <input style={INP_S()} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Steel mounting rail, galvanized 2100mm" />
          </div>
          <div>
            <label style={LBL_S}>Dimensions</label>
            <input style={INP_S()} value={dims} onChange={e => setDims(e.target.value)} placeholder="2100 × 100 × 50 mm" />
          </div>
        </AdminFormSection>

        {/* Section: Classification */}
        <AdminFormSection title="Classification">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={LBL_S}>HS Code</label>
              <input style={INP_S(MONO)} value={hsCode} onChange={e => setHsCode(e.target.value)} placeholder="7308.90" />
              <span style={HELPER_S}>Harmonized System code for India export</span>
            </div>
            <div>
              <label style={LBL_S}>HTS Code</label>
              <input style={INP_S(MONO)} value={htsCode} onChange={e => setHtsCode(e.target.value)} placeholder="7308.90.9590" />
              <span style={HELPER_S}>Harmonized Tariff Schedule code for US import (used in CBP FORM-7501)</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={LBL_S}>Unit Weight (kg)</label>
              <input type="number" min={0} step={0.01} style={INP_S()} value={weight} onChange={e => setWeight(e.target.value)} placeholder="12.40" />
              <span style={HELPER_S}>Weight per unit/piece — used for PL generation and weight validation</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 22 }}>
              <input type="checkbox" id="is-active" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'hsl(173 58% 39%)' }} />
              <label htmlFor="is-active" style={{ fontSize: 14.5, cursor: 'pointer' }}>Active</label>
            </div>
          </div>
        </AdminFormSection>

        {/* Section: Section 232 */}
        <AdminFormSection title="Section 232 Steel" collapsible defaultOpen={s232} isLast>
          <div style={{ marginBottom: s232 ? 14 : 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={s232} onChange={e => setS232(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'hsl(173 58% 39%)' }} />
              <span style={{ fontSize: 14.5 }}>Section 232 Applicable</span>
            </label>
              <span style={HELPER_S}>Enable for steel products subject to Section 232 tariffs. Adds melt & pour declaration to Draft BOE.</span>
          </div>
          {s232 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={LBL_S}>Country of Melt</label>
                <input style={INP_S()} value={melt} onChange={e => setMelt(e.target.value)} placeholder="India" />
              </div>
              <div>
                <label style={LBL_S}>Country of Smelt</label>
                <input style={INP_S()} value={smelt} onChange={e => setSmelt(e.target.value)} placeholder="India" />
              </div>
              <div>
                <label style={LBL_S}>Country of Cast</label>
                <input style={INP_S()} value={cast} onChange={e => setCast(e.target.value)} placeholder="India" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={HELPER_S}>These defaults pre-populate the Draft BOE. The US Broker can override during review.</span>
              </div>
            </div>
          )}
        </AdminFormSection>
      </div>
    </AdminModal>
  );
}

// ─── CsvImportModal ────────────────────────────────────────────────────────────

function CsvImportModal({ onClose, onImport }: {
  onClose: () => void;
  onImport: (rows: Partial<Product>[]) => Promise<{ imported: number; skipped: number }>;
}) {
  const [file,     setFile]     = useState<File | null>(null);
  const [preview,  setPreview]  = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function handleFile(f: File) {
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1, 6).map(l => {
        const vals = l.split(',');
        return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']));
      });
      setPreview(rows);
    };
    reader.readAsText(f);
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'product_import_template.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  async function handleImport() {
    if (!file) { toast({ title: 'Select a CSV file first', variant: 'destructive' }); return; }
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const headers = lines[0].split(',').map(h => h.trim());
      const rows: Partial<Product>[] = lines.slice(1).map(l => {
        const vals = l.split(',');
        const row: Record<string, any> = Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']));
        return {
          productCode: row.productCode, description: row.description,
          hsCode: row.hsCode || null, htsCode: row.htsCode || null,
          unitWeightKg: row.unitWeightKg || null,
          countryOfOrigin: row.countryOfOrigin || null,
          section232Applicable: row.section232Applicable === 'true',
          isActive: true,
        };
      }).filter(r => r.productCode);
      const result = await onImport(rows);
      toast({ title: `${result.imported} products imported, ${result.skipped} skipped (duplicates)` });
      onClose();
    } catch { toast({ title: 'Import failed', variant: 'destructive' }); }
    setImporting(false);
  }

  const EXPECTED = ['productCode', 'description', 'hsCode', 'htsCode', 'unitWeightKg', 'countryOfOrigin', 'section232Applicable'];

  return (
    <AdminModal open onClose={onClose} title="Import Products from CSV" size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid hsl(var(--border))' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleImport} disabled={importing || !file}>
            {importing ? <><Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />Importing…</> : 'Import'}
          </Button>
        </div>
      }
    >
      <div style={{ padding: '20px 24px' }}>
        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.csv')) handleFile(f); }}
          style={{ border: '2px dashed hsl(var(--border))', borderRadius: 8, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: file ? 'hsl(173 58% 39% / 0.04)' : 'hsl(var(--muted) / 0.3)' }}
        >
          <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {file ? (
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(173 58% 39%)' }}>{file.name}</div>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>{preview.length} rows previewed</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 14.5 }}>Drop a CSV file here or click to browse</div>
              <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>Accepted: .csv only</div>
            </div>
          )}
        </div>

        {/* Expected columns */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Expected columns:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {EXPECTED.map(col => (
              <span key={col} style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14.5, padding: '2px 8px', borderRadius: 5, background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }}>{col}</span>
            ))}
          </div>
          <button onClick={downloadTemplate} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'hsl(173 58% 39%)', textDecoration: 'underline', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <FileDown size={12} /> Download template CSV
          </button>
        </div>

        {/* Preview */}
        {preview.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Preview (first {preview.length} rows):</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14.5 }}>
              <thead>
                <tr style={{ background: 'hsl(var(--muted) / 0.5)' }}>
                  {Object.keys(preview[0]).map(h => <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, border: '1px solid hsl(var(--border))' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((v, j) => (
                      <td key={j} style={{ padding: '4px 8px', border: '1px solid hsl(var(--border))', fontFamily: '"JetBrains Mono", monospace', whiteSpace: 'nowrap' }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminModal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminProductsPage() {
  const { toast } = useToast();
  const [products,  setProducts]  = useState<Product[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showEdit,  setShowEdit]  = useState(false);
  const [editing,   setEditing]   = useState<Partial<Product>>({});
  const [showCsv,   setShowCsv]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet('/api/admin/products');
      if (res.ok) setProducts(res.data ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveProduct(data: Partial<Product>) {
    if (editing.id) {
      const res = await apiPut(`/api/admin/products/${editing.id}`, data);
      if (res.ok) setProducts(prev => prev.map(p => p.id === editing.id ? { ...p, ...res.data } : p));
      else throw new Error();
    } else {
      const res = await apiPost('/api/admin/products', data);
      if (res.ok) setProducts(prev => [...prev, res.data]);
      else throw new Error();
    }
  }

  async function importProducts(rows: Partial<Product>[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0; let skipped = 0;
    const existingCodes = new Set(products.map(p => p.productCode));
    for (const row of rows) {
      if (!row.productCode || existingCodes.has(row.productCode!)) { skipped++; continue; }
      const res = await apiPost('/api/admin/products', row);
      if (res.ok) { setProducts(prev => [...prev, res.data]); existingCodes.add(row.productCode!); imported++; }
      else skipped++;
    }
    return { imported, skipped };
  }

  const columns: Column<Product>[] = [
    {
      key: 'productCode', label: 'Product', width: '200px',
      render: p => (
        <div>
          <div style={{ ...MONO, fontSize: 14.5, fontWeight: 600 }}>{p.productCode}</div>
          {p.description && <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{p.description}</div>}
        </div>
      ),
    },
    { key: 'hsCode',   label: 'HS Code',  width: '100px', render: p => <span style={{ ...MONO, fontSize: 14 }}>{p.hsCode ?? '—'}</span> },
    { key: 'htsCode',  label: 'HTS Code', width: '120px', render: p => <span style={{ ...MONO, fontSize: 14 }}>{p.htsCode ?? '—'}</span> },
    { key: 'unitWeightKg', label: 'Weight', width: '80px', render: p => <span style={{ ...MONO, fontSize: 14 }}>{p.unitWeightKg != null ? `${Number(p.unitWeightKg).toFixed(2)} kg` : '—'}</span> },
    { key: 'countryOfOrigin', label: 'Origin', width: '80px', render: p => <span style={{ fontSize: 14 }}>{p.countryOfOrigin ?? '—'}</span> },
    {
      key: 'section232Applicable', label: 'S232', width: '50px',
      render: p => p.section232Applicable
        ? <ShieldCheck size={16} style={{ color: '#dc2626' }} title="Section 232 applicable" />
        : <Shield size={16} style={{ color: 'hsl(var(--muted-foreground))' }} title="Not S232" />,
    },
    { key: 'isActive', label: 'Status', width: '70px', render: p => <AdminStatusBadge status={p.isActive ? 'active' : 'inactive'} size="sm" /> },
    {
      key: '_actions', label: '', width: '80px',
      render: p => (
        <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setShowEdit(true); }}
          style={{ fontSize: 14, padding: '4px 10px', height: 'auto' }}>
          <Pencil size={12} style={{ marginRight: 4 }} /> Edit
        </Button>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Product Master"
        description="Product codes, HS/HTS codes, weights, and Section 232 configuration"
        badge={{ label: 'products', count: products.length }}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setShowCsv(true)}>
              <FileDown size={13} style={{ marginRight: 5 }} /> Import CSV
            </Button>
            <Button size="sm" onClick={() => { setEditing({}); setShowEdit(true); }}>
              <Plus size={13} style={{ marginRight: 5 }} /> Add Product
            </Button>
          </div>
        }
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />
        </div>
      ) : (
        <AdminTable
          columns={columns}
          data={products}
          keyField="id"
          searchable
          searchPlaceholder="Search products…"
          emptyMessage="No products configured. Add your first product or import from CSV."
        />
      )}

      {showEdit && (
        <ProductEditModal
          product={editing}
          onClose={() => { setShowEdit(false); setEditing({}); }}
          onSave={saveProduct}
        />
      )}

      {showCsv && (
        <CsvImportModal
          onClose={() => setShowCsv(false)}
          onImport={importProducts}
        />
      )}
    </div>
  );
}
