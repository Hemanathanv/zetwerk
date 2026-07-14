import { useState, useEffect } from 'react';
import { DollarSign, Anchor, TrendingUp, Loader2 } from 'lucide-react';
import { getAuthToken } from '@/lib/api';

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface AccountingTrigger {
  id: string;
  triggerCode: string;
  description: string;
  sourceDocType: string;
  category: string;
  currency: string;
  defaultSlaHours: number;
  isActive: boolean;
}

interface DndRate {
  id: string;
  portName: string;
  terminalName: string | null;
  shippingLine: string | null;
  demurragePerDay: number;
  detentionPerDay: number;
  currency: string;
  freeDays: number | null;
}


const CARD: React.CSSProperties = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 14,
  padding: '20px 22px',
  position: 'relative',
  overflow: 'hidden',
};

function accentBar(color: string): React.CSSProperties {
  return {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 4,
    background: color,
    borderRadius: '14px 0 0 14px',
  };
}

function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 9px',
    borderRadius: 99,
    fontSize: 14.5,
    fontWeight: 600,
    background: bg,
    color,
    flexShrink: 0,
  };
}

const BADGE: React.CSSProperties = {
  display: 'inline-block',
  fontFamily: 'monospace',
  fontSize: 14,
  fontWeight: 700,
  padding: '2px 7px',
  borderRadius: 6,
  background: 'hsl(var(--muted))',
  color: 'hsl(var(--muted-foreground))',
  letterSpacing: '0.04em',
  flexShrink: 0,
};

function SectionHeader({ icon, title, description, stat }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  stat: React.ReactNode;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }}>{icon}</div>
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</span>
        {description && (
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            — {description}
          </span>
        )}
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{stat}</div>
      </div>
      <div style={{ borderTop: '1px solid hsl(var(--border))', marginBottom: 4 }} />
    </>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{
      padding: '16px 0',
      textAlign: 'center',
      fontSize: 14,
      color: 'hsl(var(--muted-foreground))',
      fontStyle: 'italic',
    }}>
      {text}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0' }}>
      <Loader2 size={16} style={{ color: 'hsl(var(--muted-foreground))' }} className="animate-spin" />
    </div>
  );
}

function TriggersSection() {
  const [data, setData] = useState<AccountingTrigger[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/accounting/triggers', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setData(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const active = data.filter(t => t.isActive).length;

  const docLabel = (s: string) =>
    s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={CARD}>
      <div style={accentBar('#0d9488')} />
      <div style={{ paddingLeft: 10 }}>
        <SectionHeader
          icon={<DollarSign size={14} />}
          title="Finance Triggers"
          description="auto-create accounting tickets on approval"
          stat={!loading && (
            <span style={pill('hsl(var(--muted))', 'hsl(var(--muted-foreground))')}>
              {active} active / {data.length} total
            </span>
          )}
        />
        {loading ? <Spinner /> : data.length === 0 ? (
          <EmptyNote text="No triggers configured — manage them in Accounting › Triggers" />
        ) : (
          <div>
            {data.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 0',
                borderBottom: i < data.length - 1 ? '1px solid hsl(var(--border))' : 'none',
              }}>
                <span style={BADGE}>{t.triggerCode}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.description}
                  </div>
                  <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                    {docLabel(t.sourceDocType)}
                    {t.category && <span style={{ marginLeft: 6, opacity: 0.7 }}>· {t.category}</span>}
                  </div>
                </div>
                <span style={pill('hsl(var(--muted))', 'hsl(var(--muted-foreground))')}>
                  {t.currency}
                </span>
                <span style={t.isActive
                  ? pill('rgba(13,148,136,0.12)', '#0d9488')
                  : pill('hsl(var(--muted))', 'hsl(var(--muted-foreground))')
                }>
                  {t.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DndSection() {
  const [data, setData] = useState<DndRate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/inventory/dnd-rates', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setData((d.data ?? []).map((r: any) => ({
          id: r.id,
          portName: r.portName,
          terminalName: r.terminalName ?? null,
          shippingLine: r.shippingLine ?? null,
          demurragePerDay: Number(r.demurragePerDay ?? 0),
          detentionPerDay: Number(r.detentionPerDay ?? 0),
          currency: r.currency ?? 'USD',
          freeDays: r.freeDays ?? null,
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fmt = (n: number, cur: string) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: cur, maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${cur} ${n.toLocaleString()}`;
    }
  };

  return (
    <div style={CARD}>
      <div style={accentBar('#2563eb')} />
      <div style={{ paddingLeft: 10 }}>
        <SectionHeader
          icon={<Anchor size={14} />}
          title="D&D Rates"
          description="demurrage & detention by port"
          stat={!loading && (() => {
            const portCount = new Set(data.map(r => r.portName)).size;
            return (
              <span style={pill('hsl(var(--muted))', 'hsl(var(--muted-foreground))')}>
                {portCount} port{portCount !== 1 ? 's' : ''}
              </span>
            );
          })()}
        />
        {loading ? <Spinner /> : data.length === 0 ? (
          <EmptyNote text="No D&D rates configured — manage them in Inventory › D&D Rates" />
        ) : (() => {
          const grouped = Array.from(
            data.reduce((m, r) => {
              if (!m.has(r.portName)) m.set(r.portName, []);
              m.get(r.portName)!.push(r);
              return m;
            }, new Map<string, DndRate[]>()).entries()
          );
          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 10,
              paddingTop: 8,
            }}>
              {grouped.map(([portName, entries]) => {
                const primary = entries[0];
                return (
                  <div key={portName} style={{
                    background: 'hsl(var(--muted)/0.4)',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 10,
                    padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{portName}</div>
                      {entries.length > 1 && (
                        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--muted))', borderRadius: 99, padding: '1px 6px' }}>
                          {entries.length} lines
                        </span>
                      )}
                    </div>
                    {primary.terminalName && (
                      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{primary.terminalName}</div>
                    )}
                    {primary.shippingLine && (
                      <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{primary.shippingLine}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <div style={{
                        flex: 1, background: 'rgba(13,148,136,0.09)',
                        borderRadius: 7, padding: '6px 8px',
                      }}>
                        <div style={{ fontSize: 14, color: '#0d9488', fontWeight: 600, marginBottom: 2 }}>Demurrage</div>
                        <div style={{ fontSize: 14.5, fontWeight: 700, fontFamily: 'monospace' }}>
                          {fmt(primary.demurragePerDay, primary.currency)}
                        </div>
                        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>/day</div>
                      </div>
                      <div style={{
                        flex: 1, background: 'rgba(37,99,235,0.09)',
                        borderRadius: 7, padding: '6px 8px',
                      }}>
                        <div style={{ fontSize: 14, color: '#2563eb', fontWeight: 600, marginBottom: 2 }}>Detention</div>
                        <div style={{ fontSize: 14.5, fontWeight: 700, fontFamily: 'monospace' }}>
                          {fmt(primary.detentionPerDay, primary.currency)}
                        </div>
                        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>/day</div>
                      </div>
                    </div>
                    {primary.freeDays != null && (
                      <div style={{ marginTop: 8, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                        {primary.freeDays} free days included
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}


export default function FinanceGuided() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <TrendingUp size={13} style={{ color: 'hsl(var(--muted-foreground))' }} />
        <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          Read-only summary — edit in Advanced configuration
        </span>
      </div>
      <TriggersSection />
      <DndSection />
    </div>
  );
}
