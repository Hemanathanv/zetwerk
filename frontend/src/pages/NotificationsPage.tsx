import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Bell, AlertCircle, Info, CheckCircle2, AlertTriangle, CheckCheck } from 'lucide-react';
import { useNotifications } from '@/hooks/useOperationalData';
import { usePageMeta } from '@/contexts/PageMetaContext';

type NotifFilter = 'All' | 'Unread' | 'alert' | 'warning' | 'info' | 'success' | 'escalation' | 'blocker';
const filters: NotifFilter[] = ['All', 'Unread', 'alert', 'warning', 'info', 'success', 'escalation', 'blocker'];

const typeConfig = {
  alert:      { icon: AlertCircle,   color: 'text-red-600 dark:text-red-400',       bg: 'bg-red-100 dark:bg-red-900/40',       border: 'border-red-200 dark:border-red-800/50',       label: 'Alert' },
  blocker:    { icon: AlertCircle,   color: 'text-red-600 dark:text-red-400',       bg: 'bg-red-100 dark:bg-red-900/40',       border: 'border-red-200 dark:border-red-800/50',       label: 'Blocker' },
  warning:    { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-100 dark:bg-amber-900/40',   border: 'border-amber-200 dark:border-amber-800/50',   label: 'Warning' },
  escalation: { icon: AlertTriangle, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/40', border: 'border-orange-200 dark:border-orange-800/50', label: 'Escalation' },
  info:       { icon: Info,          color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-100 dark:bg-blue-900/40',     border: 'border-blue-200 dark:border-blue-800/50',     label: 'Info' },
  success:    { icon: CheckCircle2,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/40', border: 'border-emerald-200 dark:border-emerald-800/50', label: 'Success' },
};

function formatTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function NotificationsPage() {
  const { setPageMeta } = usePageMeta();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<NotifFilter>('All');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { notifications, unreadCount, meta, loading, markRead, markAllAsRead } = useNotifications({
    type: filter !== 'All' && filter !== 'Unread' ? filter : undefined,
    unreadOnly: filter === 'Unread',
    page,
    pageSize,
  });

  useEffect(() => {
    setPage(1);
  }, [filter]);

  useEffect(() => {
    setPageMeta({ title: 'Notifications', subtitle: 'Task reminders, escalations, exceptions, and workflow updates' });
    return () => setPageMeta(null);
  }, [setPageMeta]);

  return (
    <div className="px-6 pb-6 space-y-5">
      {unreadCount > 0 && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => markAllAsRead()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span className="text-[13px] font-semibold">Mark {unreadCount} read</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(Object.keys(typeConfig) as Array<keyof typeof typeConfig>).map(type => {
          const config = typeConfig[type];
          const count = meta.typeCounts?.[type] ?? 0;
          const Icon = config.icon;
          return (
            <div key={type} className={`rounded-lg border px-3 py-2.5 flex items-center gap-2.5 ${config.border}`} style={{ backgroundColor: 'hsl(var(--card))' }}>
              <div className={`p-1.5 rounded ${config.bg}`}><Icon className={`w-3.5 h-3.5 ${config.color}`} /></div>
              <div>
                <p className="text-lg font-bold">{count}</p>
                <p className="text-[12px] text-muted-foreground">{config.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-all ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            {f === 'Unread' ? `Unread (${unreadCount})` : f}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {loading && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-[14px] text-muted-foreground">Loading notifications...</div>
        )}
        {!loading && notifications.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Bell className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="text-[14.5px] font-medium mt-3">No notifications</p>
          </div>
        )}
        {!loading && notifications.map((n: any) => {
          const config = typeConfig[(n.type as keyof typeof typeConfig)] ?? typeConfig.info;
          const Icon = config.icon;
          return (
            <button
              key={n.id}
              onClick={() => { if (!n.read) markRead(n.id); if (n.link) navigate(n.link); }}
              className={`w-full text-left flex gap-3 p-4 rounded-lg border transition-all hover:bg-muted/50 ${!n.read ? `${config.border} bg-card` : 'border-border bg-card opacity-70'}`}
              data-testid={`notification-${n.id}`}
            >
              <div className={`p-2 rounded-full flex-shrink-0 h-fit ${config.bg}`}>
                <Icon className={`w-4 h-4 ${config.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-[14.5px] font-semibold ${!n.read ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {n.title}
                      {!n.read && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle" />}
                    </p>
                    <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">{n.message || n.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[12px] text-muted-foreground whitespace-nowrap">{formatTime(n.createdAt)}</span>
                    {n.shipmentId && <span className="text-[12px] font-semibold text-primary">{n.shipmentId}</span>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
        <span className="text-[13px] text-muted-foreground">
          Showing {meta.total === 0 ? 0 : ((meta.page - 1) * meta.pageSize) + 1}-{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={!meta.hasPrev || loading}
            className="px-3 py-1.5 rounded-md border border-border text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-[12px] text-muted-foreground">
            Page {meta.page} / {meta.totalPages}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!meta.hasNext || loading}
            className="px-3 py-1.5 rounded-md border border-border text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
