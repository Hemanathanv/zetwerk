import React, { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff, Copy, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPut, apiPost } from '@/lib/api';
import { useLocation } from 'wouter';

interface SafeCubeConfig {
  id: string;
  apiUrl: string;
  apiKeyHint: string | null;
  webhookSecretConfigured: boolean;
  pollingMode: string;
  pollingFrequencyHrs: number;
  isActive: boolean;
  updatedAt: string;
}

interface LinkedShipment {
  id: string;
  shipmentNumber: string;
  bolNumber: string | null;
  safecubeShipmentId: string | null;
  sealine: string | null;
  scheduleStatus: string | null;
  delayDays: number | null;
  lastSyncedAt: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ScheduleStatusPill({ status, delayDays }: { status: string | null; delayDays: number | null }) {
  if (!status) return <span className="text-muted-foreground text-[13px]">—</span>;
  if (delayDays === 0 || status.toLowerCase().includes('on time')) {
    return (
      <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
        On Time
      </span>
    );
  }
  if (delayDays && delayDays > 0) {
    return (
      <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        {delayDays}d delay
      </span>
    );
  }
  if (delayDays && delayDays < 0) {
    return (
      <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
        Past ETA
      </span>
    );
  }
  return <span className="text-[13px] text-muted-foreground">{status}</span>;
}

const POLLING_OPTIONS = [
  { label: '30 min', value: '30m' },
  { label: '1 hr',   value: '1h' },
  { label: '2 hr',   value: '2h' },
  { label: 'Manual only', value: 'manual' },
];

const INP: React.CSSProperties = {
  fontSize: 14.5,
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  padding: '7px 10px',
  background: 'hsl(var(--background))',
  color: 'hsl(var(--foreground))',
  width: '100%',
  outline: 'none',
};

export function SafeCubeSettingsCard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [config, setConfig] = useState<SafeCubeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [apiUrl, setApiUrl] = useState('https://api.safecube.io');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [pollingMode, setPollingMode] = useState('1h');

  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [shipments, setShipments] = useState<LinkedShipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; data: SafeCubeConfig | null }>('/api/settings/tracking/safecube');
      if (res.ok && res.data) {
        const d = res.data;
        setConfig(d);
        setApiUrl(d.apiUrl || 'https://api.safecube.io');
        setPollingMode(d.pollingMode || '1h');
      }
    } catch {
      /* ignore — shows empty form */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchShipments = useCallback(async () => {
    setShipmentsLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; data: LinkedShipment[] }>('/api/settings/tracking/safecube/shipments');
      if (res.ok) setShipments(res.data || []);
    } catch {
      /* ignore */
    } finally {
      setShipmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchShipments();
  }, [fetchConfig, fetchShipments]);

  const handleTest = async () => {
    setTestState('loading');
    setTestMsg('');
    try {
      const body: Record<string, string> = {};
      if (apiUrl) body.apiUrl = apiUrl;
      if (apiKey) body.apiKey = apiKey;
      const res = await apiPost<{ ok: boolean; data?: { accountId?: string }; error?: string }>(
        '/api/settings/tracking/safecube/test',
        body,
      );
      if (res.ok) {
        setTestState('ok');
        setTestMsg(res.data?.accountId ? `Connected — ${res.data.accountId}` : 'Connected');
      } else {
        setTestState('error');
        setTestMsg(res.error || 'Connection failed');
      }
    } catch {
      setTestState('error');
      setTestMsg('Connection failed');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const body: Record<string, unknown> = { apiUrl, pollingMode };
      if (apiKey) body.apiKey = apiKey;
      if (webhookSecret) body.webhookSecret = webhookSecret;
      const res = await apiPut<{ ok: boolean; error?: string }>('/api/settings/tracking/safecube', body);
      if (res.ok) {
        toast({ title: 'SafeCube configuration saved' });
        await fetchConfig();
        setApiKey('');
        setWebhookSecret('');
        setTestState('idle');
      } else {
        setSaveError(res.error || 'Save failed');
      }
    } catch {
      setSaveError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    const url = `${window.location.origin}/api/webhooks/safecube`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: 'Webhook URL copied to clipboard' });
    }).catch(() => {
      toast({ title: 'Copy failed — check browser permissions', variant: 'destructive' });
    });
  };

  const webhookEndpoint = `${window.location.origin}/api/webhooks/safecube`;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-2">
        <Loader2 size={13} className="animate-spin" /> Loading configuration…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Config form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            API Base URL
          </label>
          <input
            style={INP}
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            placeholder="https://api.safecube.io"
          />
        </div>

        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Polling Interval
          </label>
          <select
            style={INP}
            value={pollingMode}
            onChange={e => setPollingMode(e.target.value)}
          >
            {POLLING_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            API Key
            {config?.apiKeyHint && (
              <span className="normal-case font-normal ml-1 text-muted-foreground">
                (current: {config.apiKeyHint})
              </span>
            )}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              style={{ ...INP, paddingRight: 36 }}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={config?.apiKeyHint ? '••• enter new key to replace •••' : 'Paste API key'}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              style={{
                position: 'absolute', right: 10, top: '50%',
                transform: 'translateY(-50%)',
                color: 'hsl(var(--muted-foreground))',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Webhook Secret
            {config?.webhookSecretConfigured && (
              <span className="normal-case font-normal ml-1 text-emerald-600 dark:text-emerald-400">
                ✓ configured
              </span>
            )}
          </label>
          <input
            style={INP}
            type="text"
            value={webhookSecret}
            onChange={e => setWebhookSecret(e.target.value)}
            placeholder={
              config?.webhookSecretConfigured
                ? '••• enter new secret to replace •••'
                : 'Paste or generate a shared secret'
            }
            autoComplete="off"
          />
        </div>
      </div>

      <div>
        <label className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          Inbound Webhook URL
        </label>
        <div className="flex items-center gap-2">
          <input
            style={{ ...INP, flex: 1, background: 'hsl(var(--muted)/0.3)', color: 'hsl(var(--muted-foreground))' }}
            readOnly
            value={webhookEndpoint}
          />
          <button
            type="button"
            onClick={handleCopyWebhookUrl}
            className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded-md border hover:bg-muted/50 transition-colors flex-shrink-0"
            style={{ borderColor: 'hsl(var(--border))', fontSize: 14 }}
          >
            <Copy size={12} />
            Copy
          </button>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1">
          Register this URL with SafeCube to receive real-time push updates. Set the shared secret above.
        </p>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => { setTestState('idle'); handleTest(); }}
          disabled={testState === 'loading'}
          className="flex items-center gap-1.5 text-[13px] font-medium px-3 py-2 rounded-md border hover:bg-muted/50 transition-colors disabled:opacity-50"
          style={{ borderColor: 'hsl(var(--border))', fontSize: 14 }}
        >
          {testState === 'loading' ? <Loader2 size={12} className="animate-spin" /> : null}
          Test Connection
        </button>

        {testState === 'ok' && (
          <span className="flex items-center gap-1 text-[13px] text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 size={13} /> {testMsg}
          </span>
        )}
        {testState === 'error' && (
          <span className="flex items-center gap-1 text-[13px] text-red-600 dark:text-red-400 font-medium">
            <XCircle size={13} /> {testMsg}
          </span>
        )}

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-md text-white transition-colors disabled:opacity-70"
          style={{ background: 'hsl(var(--primary))', fontSize: 14 }}
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {saveError && (
        <p className="text-[13px] text-red-500">{saveError}</p>
      )}

      {/* Linked shipments table */}
      <div className="border-t pt-4" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Linked Shipments
          </h3>
          {shipmentsLoading
            ? <Loader2 size={12} className="animate-spin text-muted-foreground" />
            : (
              <button
                type="button"
                onClick={fetchShipments}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw size={11} />
              </button>
            )
          }
          {shipments.length > 0 && (
            <span className="text-[13px] text-muted-foreground ml-auto">{shipments.length} tracked</span>
          )}
        </div>

        {!shipmentsLoading && shipments.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No shipments linked yet. SafeCube tracking auto-links when a BOL is matched or approved.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-[13px]" style={{ minWidth: 480 }}>
              <thead>
                <tr className="border-b" style={{ borderColor: 'hsl(var(--border))' }}>
                  {['BOL Number', 'Sealine', 'Schedule', 'Last Synced'].map(h => (
                    <th
                      key={h}
                      className="text-left pb-1.5 pr-4 font-semibold text-muted-foreground uppercase tracking-wide"
                      style={{ fontSize: 14 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shipments.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/shipments/${s.id}`)}
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                    style={{ borderColor: 'hsl(var(--border))' }}
                  >
                    <td className="py-2 pr-4 font-mono font-medium">
                      {s.bolNumber || '—'}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {s.sealine || '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <ScheduleStatusPill status={s.scheduleStatus} delayDays={s.delayDays} />
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {timeAgo(s.lastSyncedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
