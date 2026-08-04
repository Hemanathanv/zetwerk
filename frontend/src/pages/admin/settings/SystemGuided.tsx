import { useState, useEffect } from 'react';
import { Activity, Cpu, Clock } from 'lucide-react';
import { apiUrl, getAuthToken, readJsonResponse } from '@/lib/api';

function authHeaders(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface AuditEntry {
  id: string; action: string; entityType: string; description: string;
  userName: string; createdAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function actionIcon(action: string, entityType: string) {
  if (action === 'create') return '✚';
  if (action === 'delete') return '✕';
  return '✎';
}

export default function SystemGuided() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [ocrConnected, setOcrConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(apiUrl('/api/admin/settings/access-audit?limit=20'), { headers: authHeaders() }).then(readJsonResponse),
      fetch(apiUrl('/api/admin/settings/setup-status'), { headers: authHeaders() }).then(readJsonResponse),
    ]).then(([auditData, statusData]) => {
      setEntries(auditData.data || []);
      setOcrConnected(statusData.data?.ocrConnected ?? false);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      <div className="h-20 bg-card rounded-lg" />
      <div className="h-64 bg-card rounded-lg" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border rounded-xl p-4" style={{ borderColor: 'hsl(var(--card-border))' }}>
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-teal-600" />
            <span className="text-[14.5px] font-medium">OCR Service</span>
          </div>
          <div className={`flex items-center gap-2 mt-1`}>
            <div className={`w-2.5 h-2.5 rounded-full ${ocrConnected ? 'bg-teal-500' : 'bg-red-500'}`} />
            <span className={`text-[14.5px] font-medium ${ocrConnected ? 'text-teal-700 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>
              {ocrConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1.5">Python OCR engine on port 8099</p>
        </div>
        <div className="bg-card border rounded-xl p-4" style={{ borderColor: 'hsl(var(--card-border))' }}>
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-teal-600" />
            <span className="text-[14.5px] font-medium">Audit Logging</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-2.5 h-2.5 rounded-full bg-teal-500" />
            <span className="text-[14.5px] font-medium text-teal-700 dark:text-teal-400">Active</span>
          </div>
          <p className="text-[13px] text-muted-foreground mt-1.5">All access changes are recorded</p>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-5" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-teal-600" />
          <h3 className="font-semibold text-[14.5px]">Recent Access Changes</h3>
        </div>
        {entries.length === 0 ? (
          <div className="py-6 text-center text-[14.5px] text-muted-foreground">
            No access changes recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {entries.slice(0, 20).map(e => (
              <div key={e.id} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[13px] text-muted-foreground shrink-0 font-medium">
                  {actionIcon(e.action, e.entityType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px]">{e.description}</div>
                  <div className="text-[13px] text-muted-foreground mt-0.5">by {e.userName} · {timeAgo(e.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
