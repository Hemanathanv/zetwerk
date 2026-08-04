import { useState } from 'react';
import { Receipt, Plus, X, Loader2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api';

export interface AccountingTriggerOption {
  id: string;
  systemCode?: string;
  triggerCode: string;
  description: string;
  category: string;
  currency: string;
}

export interface AccountingTriggerRow {
  id: string;
  milestoneSystemCode: string;
  accountingTriggerSystemCode: string;
  isActive: boolean;
  description?: string;
  category?: string;
  currency?: string;
  triggerCode?: string;
}

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function MilestoneAccountingTriggers({
  milestoneId,
  existingTriggers,
  options,
  onChanged,
}: {
  milestoneId: string;
  existingTriggers: AccountingTriggerRow[];
  options: AccountingTriggerOption[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const existingCodes = new Set(existingTriggers.map(t => t.accountingTriggerSystemCode));
  const available = options.filter(o => o.systemCode && !existingCodes.has(o.systemCode));

  const handleAdd = async () => {
    if (!selectedCode || !milestoneId) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/inventory/milestones/${milestoneId}/accounting-triggers`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountingTriggerSystemCode: selectedCode }),
      });
      setAdding(false);
      setSelectedCode('');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (triggerId: string) => {
    setRemoving(triggerId);
    try {
      await fetch(`/api/admin/inventory/milestones/${milestoneId}/accounting-triggers/${triggerId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      onChanged();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      {existingTriggers.length === 0 && (
        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 5 }}>
          No triggers configured.
        </div>
      )}

      {existingTriggers.map(t => (
        <div key={t.id} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 7px', borderRadius: 5, marginBottom: 4,
          background: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.2)',
        }}>
          <Receipt size={9} style={{ color: '#0D9488', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: 'hsl(var(--foreground))', flex: 1, lineHeight: 1.3 }}>
            {t.description || t.accountingTriggerSystemCode}
          </span>
          {t.category && (
            <span style={{
              fontSize: 12, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
              background: 'rgba(13,148,136,0.15)', color: '#0D9488', flexShrink: 0,
            }}>{t.category.toUpperCase()}</span>
          )}
          {t.currency && (
            <span style={{
              fontSize: 12, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
              background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))', flexShrink: 0,
            }}>{t.currency}</span>
          )}
          <button
            onClick={() => handleRemove(t.id)}
            disabled={removing === t.id}
            title="Remove trigger"
            style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#EF4444', cursor: removing === t.id ? 'not-allowed' : 'pointer',
              opacity: removing === t.id ? 0.5 : 1,
            }}
          >
            {removing === t.id
              ? <Loader2 size={8} style={{ animation: 'spin 0.8s linear infinite' }} />
              : <X size={8} />
            }
          </button>
        </div>
      ))}

      {!adding && available.length > 0 && (
        <button
          onClick={() => setAdding(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 5, fontSize: 14, fontWeight: 500,
            background: 'rgba(13,148,136,0.08)', color: '#0D9488',
            border: '1px dashed rgba(13,148,136,0.4)', cursor: 'pointer',
            marginTop: existingTriggers.length > 0 ? 2 : 0,
          }}
        >
          <Plus size={9} /> Add trigger
        </button>
      )}

      {adding && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
          <select
            value={selectedCode}
            onChange={e => setSelectedCode(e.target.value)}
            style={{
              flex: 1, fontSize: 14, padding: '3px 6px', borderRadius: 5,
              background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
            }}
          >
            <option value="">Select trigger…</option>
            {available.map(o => (
              <option key={o.systemCode} value={o.systemCode!}>
                {o.description} ({o.currency})
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedCode || saving}
            style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 14, fontWeight: 600,
              background: selectedCode ? '#0D9488' : 'hsl(var(--muted))',
              color: selectedCode ? '#fff' : 'hsl(var(--muted-foreground))',
              border: 'none', cursor: !selectedCode || saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 3,
            }}
          >
            {saving ? <Loader2 size={9} style={{ animation: 'spin 0.8s linear infinite' }} /> : null}
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setSelectedCode(''); }}
            style={{
              padding: '3px 6px', borderRadius: 5, fontSize: 14,
              background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))',
              border: 'none', cursor: 'pointer',
            }}
          >Cancel</button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
