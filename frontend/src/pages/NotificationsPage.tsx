import { useState } from 'react';
import { Bell, AlertCircle, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { notifications } from '@/data/mockData';

type NotifFilter = 'All' | 'Unread' | 'alert' | 'warning' | 'info' | 'success';
const filters: NotifFilter[] = ['All', 'Unread', 'alert', 'warning', 'info', 'success'];

const typeConfig = {
  alert:   { icon: AlertCircle,   color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-100 dark:bg-red-900/40',    border: 'border-red-200 dark:border-red-800/50',    label: 'Alert' },
  warning: { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/40', border: 'border-amber-200 dark:border-amber-800/50', label: 'Warning' },
  info:    { icon: Info,          color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-100 dark:bg-blue-900/40',   border: 'border-blue-200 dark:border-blue-800/50',   label: 'Info' },
  success: { icon: CheckCircle2,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/40', border: 'border-emerald-200 dark:border-emerald-800/50', label: 'Success' },
};

export function NotificationsPage() {
  const [filter, setFilter] = useState<NotifFilter>('All');

  const filtered = notifications.filter(n => {
    if (filter === 'All')    return true;
    if (filter === 'Unread') return !n.isRead;
    return n.type === filter;
  });

  const unread = notifications.filter(n => !n.isRead).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Notifications</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">System alerts, exceptions, and workflow updates</p>
        </div>
        {unread > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
            <Bell className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            <span className="text-[13px] font-semibold text-red-700 dark:text-red-400">{unread} unread</span>
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(Object.keys(typeConfig) as Array<keyof typeof typeConfig>).map(type => {
          const config = typeConfig[type];
          const count  = notifications.filter(n => n.type === type).length;
          const Icon   = config.icon;
          return (
            <div key={type} className={`rounded-lg border px-3 py-2.5 flex items-center gap-2.5 ${config.border}`} style={{ backgroundColor: 'hsl(var(--card))' }}>
              <div className={`p-1.5 rounded ${config.bg}`}><Icon className={`w-3.5 h-3.5 ${config.color}`} /></div>
              <div>
                <p className="text-lg font-bold">{count}</p>
                <p className="text-[12px] text-muted-foreground capitalize">{config.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium capitalize transition-all ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            {f === 'Unread' ? `Unread (${unread})` : f}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="space-y-2">
        {filtered.map(n => {
          const config = typeConfig[n.type];
          const Icon   = config.icon;
          return (
            <div
              key={n.id}
              className={`flex gap-3 p-4 rounded-lg border transition-all ${
                !n.isRead
                  ? `${config.border} bg-card`
                  : 'border-border bg-card opacity-70'
              }`}
              data-testid={`notification-${n.id}`}
            >
              <div className={`p-2 rounded-full flex-shrink-0 h-fit ${config.bg}`}>
                <Icon className={`w-4 h-4 ${config.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-[14.5px] font-semibold ${!n.isRead ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {n.title}
                      {!n.isRead && (
                        <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle" />
                      )}
                    </p>
                    <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">{n.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[12px] text-muted-foreground whitespace-nowrap">{n.timestamp}</span>
                    <span className="text-[12px] font-semibold text-primary">{n.shipmentId}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
