import React, { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Layers, FileText, Fingerprint, Loader2, Plus, ShieldOff } from 'lucide-react';
import { useConfig } from '@/contexts/ConfigContext';
import { RequireActivity } from '@/components/PermissionGate';
import { apiPost } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ─── helpers ───────────────────────────────────────────────────────────────

function genShipmentNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `SHP-${ts}`;
}

// ─── types ─────────────────────────────────────────────────────────────────

interface FormData {
  shipmentType: string;
  exporterName: string;
  buyerName: string;
  portOfLoading: string;
  destination: string;
  estimatedValue: string;
  currency: string;
  projectRef: string;
}

// ─── sub-components ────────────────────────────────────────────────────────

function PermissionBlock() {
  return (
    <div style={{ padding: '48px', textAlign: 'center' }}>
      <ShieldOff style={{ width: 40, height: 40, margin: '0 auto 12px', color: 'hsl(var(--muted-foreground) / 0.4)' }} />
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px' }}>Permission required</h3>
      <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
        You don't have permission to create shipments.
      </p>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────

function CreateShipmentForm() {
  const [, navigate] = useLocation();
  const { templates, docTypes: allDocTypes } = useConfig();

  const activeTemplates = useMemo(
    () => (templates as any[]).filter((t: any) => t.templateStatus === 'ACTIVE'),
    [templates],
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    activeTemplates.length === 1 ? activeTemplates[0].id : null,
  );

  const [formData, setFormData] = useState<FormData>({
    shipmentType: activeTemplates.length === 1
      ? (() => {
          const types = activeTemplates[0].shipmentTypes;
          return Array.isArray(types) ? (types[0] ?? '') : '';
        })()
      : '',
    exporterName: '',
    buyerName: '',
    portOfLoading: '',
    destination: '',
    estimatedValue: '',
    currency: 'USD',
    projectRef: '',
  });

  const [submitting, setSubmitting] = useState(false);

  // ── derived template state ────────────────────────────────────────────────

  const selectedTemplate = useMemo(
    () => (templates as any[]).find((t: any) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const templateGates = useMemo(
    () => ((selectedTemplate?.gates as any[]) || []).sort((a: any, b: any) => a.gateNumber - b.gateNumber),
    [selectedTemplate],
  );

  const templateDocCount = useMemo(
    () => templateGates.reduce((sum: number, g: any) => sum + (g.docTypeGates?.length || 0), 0),
    [templateGates],
  );

  const templateShipmentTypes = useMemo(() => {
    if (!selectedTemplate) return [];
    const types = (selectedTemplate as any).shipmentTypes;
    if (Array.isArray(types)) return types as string[];
    if (typeof types === 'string') return (types as string).split(',').map((t: string) => t.trim()).filter(Boolean);
    return [];
  }, [selectedTemplate]);

  // ── handlers ─────────────────────────────────────────────────────────────

  function selectTemplate(t: any) {
    setSelectedTemplateId(t.id);
    const types = Array.isArray(t.shipmentTypes)
      ? t.shipmentTypes
      : typeof t.shipmentTypes === 'string'
      ? t.shipmentTypes.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    setFormData(prev => ({ ...prev, shipmentType: types[0] ?? '' }));
  }

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setFormData(prev => ({ ...prev, [key]: value }));
  }

  async function handleCreate() {
    if (!selectedTemplateId) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        templateId: selectedTemplateId,
        shipmentNumber: genShipmentNumber(),
        shipmentType: formData.shipmentType || undefined,
        exporterName: formData.exporterName || undefined,
        buyerName: formData.buyerName || undefined,
        portOfLoading: formData.portOfLoading || undefined,
        destination: formData.destination || undefined,
        estimatedValue: formData.estimatedValue ? parseFloat(formData.estimatedValue) : undefined,
        currency: formData.currency || undefined,
        projectRef: formData.projectRef || undefined,
      };

      const res = await apiPost<any>('/api/shipments/from-template', body);
      if (!res.ok) throw new Error(res.error || 'Failed to create shipment');

      const newId = res.data?.id;
      window.location.href = newId ? `/shipments/${newId}` : '/dashboard';
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  // ── styles ────────────────────────────────────────────────────────────────

  const inputCls = 'w-full';
  const selectCls = inputCls;
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 14.5, fontWeight: 500,
    color: 'hsl(var(--muted-foreground))', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const cardStyle: React.CSSProperties = {
    background: 'hsl(var(--card))', borderRadius: 16, padding: 20, marginBottom: 20,
    border: '1px solid hsl(var(--border))',
  };
  const sectionLabelStyle: React.CSSProperties = {
    fontSize: 14, fontWeight: 600, color: 'hsl(var(--muted-foreground))',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '28px', maxWidth: 840, margin: '0 auto' }}>

      {/* ── header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <a
            href="/dashboard"
            style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', textDecoration: 'none' }}
          >
            ← Back
          </a>
          <span style={{ color: 'hsl(var(--muted-foreground))' }}>/</span>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', margin: 0, color: 'hsl(var(--foreground))', lineHeight: 1.2 }}>Create Shipment</h1>
        </div>
        <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
          Select a workflow template and enter shipment details to begin processing.
        </p>
      </div>

      {/* ── section 2: template selector ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={sectionLabelStyle}>Workflow Template</p>

        {activeTemplates.length === 0 ? (
          <div style={{
            background: 'hsl(38 92% 97%)', border: '1px solid hsl(38 92% 80%)',
            borderRadius: 12, padding: 16,
          }}>
            <p style={{ fontSize: 14.5, color: 'hsl(38 55% 40%)', margin: 0 }}>
              No active templates available. Contact your administrator to activate a workflow template.
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(activeTemplates.length, 3)}, 1fr)`,
            gap: 12,
          }}>
            {activeTemplates.map((t: any) => {
              const tGates = ((t.gates || []) as any[]);
              const tDocCount = tGates.reduce((s: number, g: any) => s + (g.docTypeGates?.length || 0), 0);
              const tTypes: string[] = Array.isArray(t.shipmentTypes)
                ? t.shipmentTypes
                : typeof t.shipmentTypes === 'string'
                ? t.shipmentTypes.split(',').map((s: string) => s.trim()).filter(Boolean)
                : [];
              const isSelected = selectedTemplateId === t.id;

              return (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  style={{
                    textAlign: 'left',
                    padding: 16,
                    borderRadius: 14,
                    border: isSelected
                      ? '2px solid hsl(173 58% 39%)'
                      : '1px solid hsl(var(--border))',
                    background: isSelected
                      ? 'hsla(173,58%,39%,0.05)'
                      : 'hsl(var(--card))',
                    cursor: 'pointer',
                    transition: 'all 150ms',
                    outline: isSelected ? '2px solid hsla(173,58%,39%,0.15)' : 'none',
                    outlineOffset: 1,
                  }}
                >
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 2 }}>{t.name}</div>
                  <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 2 }}>
                    {t.corridor || 'No corridor specified'}
                  </div>
                  {t.commodity && (
                    <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 8 }}>
                      {t.commodity}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 12, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Layers size={11} />
                      {tGates.length} gate{tGates.length !== 1 ? 's' : ''}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <FileText size={11} />
                      {tDocCount} doc{tDocCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {tTypes.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      {tTypes.map((type: string) => (
                        <Badge key={type} intent="neutral" size="sm">
                          {type}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── section 3: template preview ── */}
      {selectedTemplate && (
        <div style={cardStyle}>
          <p style={sectionLabelStyle}>Template Preview</p>

          {/* Gate progression */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, marginBottom: 12, flexWrap: 'wrap' }}>
            {templateGates.map((gate: any, idx: number) => (
              <React.Fragment key={gate.id}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'hsl(var(--muted))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14.5, fontWeight: 700,
                  }}>
                    {gate.gateNumber}
                  </div>
                  <div style={{
                    fontSize: 13, color: 'hsl(var(--muted-foreground))',
                    marginTop: 4, textAlign: 'center', maxWidth: 64,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {gate.gateName}
                  </div>
                  {gate.isIdentityGate && (
                    <Fingerprint size={11} style={{ color: 'hsl(173 58% 39%)', marginTop: 2 }} />
                  )}
                </div>
                {idx < templateGates.length - 1 && (
                  <div style={{
                    flex: 1, height: 1, background: 'hsl(var(--border))',
                    marginTop: 16, minWidth: 8,
                  }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 8, fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginBottom: 12 }}>
            <span>{templateGates.length} gate{templateGates.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{templateDocCount} document{templateDocCount !== 1 ? 's' : ''}</span>
            {templateGates.find((g: any) => g.isIdentityGate) && (
              <>
                <span>·</span>
                <span>Identity at gate {templateGates.find((g: any) => g.isIdentityGate)?.gateNumber}</span>
              </>
            )}
          </div>

          {/* Per-gate doc summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {templateGates.map((gate: any) => {
              const gateDocs = ((gate.docTypeGates || []) as any[]);
              const criticalCount = gateDocs.filter((d: any) => d.roleInGate === 'GATE_CRITICAL').length;
              const generatedCount = gateDocs.filter((d: any) => d.isGenerated).length;

              return (
                <div key={gate.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, width: 20 }}>G{gate.gateNumber}</span>
                  <span style={{ color: 'hsl(var(--muted-foreground))', flex: 1 }}>
                    {gateDocs.length} doc{gateDocs.length !== 1 ? 's' : ''}
                    {criticalCount > 0 && (
                      <span style={{ color: 'hsl(0 72% 50%)', marginLeft: 4 }}>({criticalCount} critical)</span>
                    )}
                    {generatedCount > 0 && (
                      <span style={{ color: 'hsl(38 92% 45%)', marginLeft: 4 }}>({generatedCount} auto-gen)</span>
                    )}
                  </span>
                  <span style={{ color: 'hsl(var(--muted-foreground) / 0.5)', fontFamily: 'monospace' }}>
                    {gateDocs.map((d: any) => {
                      const dtInfo = (allDocTypes as any[]).find((dt: any) => dt.typeCode === d.docType);
                      return dtInfo?.displayName || '??';
                    }).join(' · ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── section 4: shipment details form ── */}
      {selectedTemplate && (
        <div style={cardStyle}>
          <p style={sectionLabelStyle}>Shipment Details</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px' }}>

            {/* Shipment Type — from template (G-S14) */}
            <div>
              <label style={labelStyle}>Shipment Type</label>
              {templateShipmentTypes.length > 0 ? (
                <select
                  value={formData.shipmentType}
                  onChange={e => setField('shipmentType', e.target.value)}
                  className={selectCls}
                  style={{ width: '100%' }}
                >
                  {templateShipmentTypes.map((type: string) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              ) : (
                <Input
                  value={formData.shipmentType}
                  onChange={e => setField('shipmentType', e.target.value)}
                  className={inputCls}
                  placeholder="e.g., Container FCL"
                />
              )}
            </div>

            {/* Exporter Name */}
            <div>
              <label style={labelStyle}>Exporter Name</label>
              <Input
                value={formData.exporterName}
                onChange={e => setField('exporterName', e.target.value)}
                className={inputCls}
                placeholder="Exporter / shipper name"
              />
            </div>

            {/* Buyer Name */}
            <div>
              <label style={labelStyle}>Buyer Name</label>
              <Input
                value={formData.buyerName}
                onChange={e => setField('buyerName', e.target.value)}
                className={inputCls}
                placeholder="Buyer / consignee name"
              />
            </div>

            {/* Port of Loading */}
            <div>
              <label style={labelStyle}>Port of Loading</label>
              <Input
                value={formData.portOfLoading}
                onChange={e => setField('portOfLoading', e.target.value)}
                className={inputCls}
                placeholder="e.g., Mundra"
              />
            </div>

            {/* Destination */}
            <div>
              <label style={labelStyle}>Destination</label>
              <Input
                value={formData.destination}
                onChange={e => setField('destination', e.target.value)}
                className={inputCls}
                placeholder="e.g., Oakland, CA"
              />
            </div>

            {/* Estimated Value + Currency */}
            <div>
              <label style={labelStyle}>Estimated Value</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={formData.currency}
                  onChange={e => setField('currency', e.target.value)}
                  style={{ width: 72, fontSize: 14.5, borderRadius: 8, padding: '8px 6px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }}
                >
                  <option value="USD">USD</option>
                  <option value="INR">INR</option>
                  <option value="EUR">EUR</option>
                </select>
                <Input
                  type="number"
                  value={formData.estimatedValue}
                  onChange={e => setField('estimatedValue', e.target.value)}
                  className={inputCls}
                  placeholder="0.00"
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
              </div>
            </div>

            {/* PO / Project Reference — full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>PO / Project Reference</label>
              <Input
                value={formData.projectRef}
                onChange={e => setField('projectRef', e.target.value)}
                className={inputCls}
                placeholder="Purchase order or project reference number"
              />
            </div>

          </div>
        </div>
      )}

      {/* ── section 5: submit ── */}
      {selectedTemplate && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <p style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', margin: 0 }}>
            Creating with{' '}
            <span style={{ fontWeight: 600 }}>{selectedTemplate.name}</span>
            {' '}· {templateGates.length} gate{templateGates.length !== 1 ? 's' : ''} will be initialized
            {' '}· Gate 1 will be active immediately
          </p>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={submitting || !formData.exporterName || !formData.buyerName}
            size="lg"
            className="whitespace-nowrap"
          >
            {submitting ? (
              <><Loader2 className="size-4 animate-spin" /> Creating...</>
            ) : (
              <><Plus className="size-4" /> Create Shipment</>
            )}
          </Button>
        </div>
      )}

    </div>
  );
}

export function CreateShipmentPage() {
  return (
    <RequireActivity
      code="SHP-001"
      fallback={<PermissionBlock />}
    >
      <CreateShipmentForm />
    </RequireActivity>
  );
}
