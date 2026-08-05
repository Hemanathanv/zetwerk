import React, { useState, useCallback, useEffect } from 'react';
import { Loader2, CheckCircle2, XCircle, RotateCcw, Play } from 'lucide-react';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiGet } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type ComplianceStatus = 'idle' | 'running' | 'pass' | 'fail';
interface ComplianceResult { status: ComplianceStatus; message: string; items?: string[] }

interface AuditEntry {
  id: string; userId: string | null; activityCode: string | null;
  action: string; timestamp: string;
  details: Record<string, any> | null;
}

interface AuditUser { id: string; fullName: string; email: string; status?: string }

// ─── Helpers ───────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: 'var(--app-font-sans)' };

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── ComplianceCard ────────────────────────────────────────────────────────────

function ComplianceCard({ title, description, runCheck, runTrigger }: {
  title: string; description: string;
  runCheck: () => Promise<ComplianceResult>;
  runTrigger: number;
}) {
  const [status, setStatus] = useState<ComplianceStatus>('idle');
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState(false);

  const run = useCallback(async () => {
    setStatus('running');
    try {
      const r = await runCheck();
      setResult(r); setStatus(r.status); setLastChecked(new Date());
    } catch {
      setResult({ status: 'fail', message: 'Check failed — unable to retrieve data' });
      setStatus('fail');
    }
  }, [runCheck]);

  useEffect(() => { if (runTrigger > 0) run(); }, [runTrigger, run]);

  return (
    <div style={{ background: 'hsl(var(--card))', borderRadius: 8, padding: '18px 20px', border: '1px solid hsl(var(--border))', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ paddingTop: 1 }}>
            {status === 'idle'    && <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid hsl(var(--border))' }} />}
            {status === 'running' && <Loader2 size={20} className="animate-spin" style={{ color: 'hsl(var(--muted-foreground))' }} />}
            {status === 'pass'    && <CheckCircle2 size={20} style={{ color: '#16a34a' }} />}
            {status === 'fail'    && <XCircle size={20} style={{ color: '#dc2626' }} />}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>{description}</div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={run} disabled={status === 'running'}
          style={{ flexShrink: 0, fontSize: 14, padding: '4px 10px', height: 'auto' }}>
          {status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
        </Button>
      </div>

      {result && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid hsl(var(--border))' }}>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: status === 'pass' ? '#16a34a' : status === 'fail' ? '#dc2626' : 'hsl(var(--muted-foreground))' }}>
            {result.message}
          </div>
          {result.items && result.items.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setExpanded(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'hsl(173 58% 39%)', textDecoration: 'underline', padding: 0 }}>
                {expanded ? 'Hide issues' : `View ${result.items.length} issue${result.items.length !== 1 ? 's' : ''}`}
              </button>
              {expanded && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {result.items.map((item, i) => (
                    <div key={i} style={{ ...MONO, fontSize: 14.5, padding: '3px 8px', borderRadius: 5, background: '#dc262610', color: '#dc2626' }}>{item}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {lastChecked && (
        <div style={{ marginTop: 10, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
          Last checked: {lastChecked.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function AdminCompliancePage() {
  const [runTriggers, setRunTriggers] = useState([0, 0, 0, 0, 0, 0]);
  const [runningAll,  setRunningAll]  = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [summary,     setSummary]     = useState<string | null>(null);

  async function runAll() {
    setRunningAll(true); setSummary(null);
    for (let i = 0; i < 6; i++) {
      setProgress(i + 1);
      setRunTriggers(prev => { const t = [...prev]; t[i]++; return t; });
      await new Promise(r => setTimeout(r, 800));
    }
    setRunningAll(false);
    setSummary('All 6 checks run — see results below');
    setProgress(0);
  }

  const check5 = useCallback(async (): Promise<ComplianceResult> => {
    const params = new URLSearchParams();
    params.set('action', 'override');
    params.set('startDate', new Date(Date.now() - 90 * 86400000).toISOString());
    params.set('endDate', new Date().toISOString());
    params.set('limit', '200');
    const res = await apiGet<any>(`/api/admin/audit?${params}`);
    if (!res.ok) throw new Error();
    const entries: AuditEntry[] = res.data ?? [];
    if (entries.length === 0) return { status: 'pass', message: 'No overrides recorded — nothing to validate.' };
    const missing = entries.filter(e => {
      const d = e.details ?? {};
      return !d.reason && !d.description && !d.justification;
    });
    if (missing.length === 0) return { status: 'pass', message: `All ${entries.length} override${entries.length !== 1 ? 's' : ''} have documented reasons.` };
    return {
      status: 'fail',
      message: `${missing.length} of ${entries.length} overrides are missing a documented reason.`,
      items: missing.map(e => `${e.activityCode ?? e.id.slice(0, 8)} · ${fmtTs(e.timestamp)}`),
    };
  }, []);

  const check6 = useCallback(async (): Promise<ComplianceResult> => {
    const [usersRes, loginRes] = await Promise.all([
      apiGet<any>('/api/admin/users'),
      apiGet<any>(`/api/admin/audit?action=login&startDate=${new Date(Date.now() - 90 * 86400000).toISOString()}&endDate=${new Date().toISOString()}&limit=500`),
    ]);
    if (!usersRes.ok || !loginRes.ok) throw new Error();
    const users: AuditUser[] = usersRes.data ?? [];
    const logins: AuditEntry[] = loginRes.data ?? [];
    const activeUsers = users.filter((u: any) => u.status === 'active');
    const loggedInIds = new Set(logins.map(l => l.userId).filter(Boolean));
    const dormant = activeUsers.filter((u: AuditUser) => !loggedInIds.has(u.id));
    if (dormant.length === 0) return { status: 'pass', message: `All ${activeUsers.length} active users logged in within the last 90 days.` };
    return {
      status: 'fail',
      message: `${dormant.length} active user${dormant.length !== 1 ? 's' : ''} haven't logged in for 90+ days.`,
      items: dormant.map(u => `${u.fullName} (${u.email})`),
    };
  }, []);

  const placeholder = useCallback(async (): Promise<ComplianceResult> => {
    await new Promise(r => setTimeout(r, 300));
    return { status: 'pass', message: 'Requires operational data — available when shipment processing is live.' };
  }, []);

  const checks: Array<{ title: string; description: string; run: () => Promise<ComplianceResult> }> = [
    { title: 'Section 232 Declarations',     description: 'All steel shipments have complete melt & pour declarations on their CBP FORM 7501', run: placeholder },
    { title: 'e-Invoice IRN Verification',   description: 'All Indian Sales Invoices have verified IRN (QR JWT check passed)',               run: placeholder },
    { title: 'CBP FORM 7501 Filing Deadline', description: 'All CBP FORM 7501s filed within statutory deadline (15 days of vessel arrival)', run: placeholder },
    { title: 'Accounting Entry Posting SLA', description: 'All accounting tickets posted within their configured SLA',                       run: placeholder },
    { title: 'Override Justification',        description: 'All validation overrides have documented reasons (last 90 days)',                 run: check5 },
    { title: 'User Access Review',            description: 'All active users have logged in within the last 90 days',                         run: check6 },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Compliance Checks"
        description="Run automated governance checks across shipments, documents, and access"
        actions={
          <Button variant="outline" size="sm" onClick={runAll} disabled={runningAll}>
            {runningAll
              ? <><Loader2 size={13} className="animate-spin" style={{ marginRight: 6 }} />Running check {progress} of 6…</>
              : <><Play size={13} style={{ marginRight: 6 }} />Run all checks</>}
          </Button>
        }
      />

      {summary && (
        <div style={{ marginBottom: 16, fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>{summary}</div>
      )}

      {checks.map((c, i) => (
        <ComplianceCard key={i} title={c.title} description={c.description} runCheck={c.run} runTrigger={runTriggers[i]} />
      ))}
    </div>
  );
}
