import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotifications } from '@/hooks/useOperationalData';
import { EwmsScrollArea } from '@/components/ewms/Media';

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_ICON: Record<string, string> = {
  info: 'i',
  success: 'OK',
  warning: '!',
  alert: '!',
  escalation: '^',
  blocker: '!',
};

export function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        data-testid="button-notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[12px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 w-[420px] bg-card border rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            <span className="text-[15px] font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="text-[13px] text-teal-600 hover:underline flex items-center gap-1"
              >
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          <EwmsScrollArea className="max-h-[400px]">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-[14.5px] text-muted-foreground">
                No notifications
              </div>
            ) : (
              notifications.slice(0, 20).map((n: any) => (
                <a
                  key={n.id}
                  href={n.link || '#'}
                  onClick={() => { if (!n.read) markRead(n.id); setOpen(false); }}
                  className={`flex gap-3 px-4 py-4 border-b hover:bg-muted/50 transition-colors cursor-pointer ${!n.read ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
                  style={{ borderColor: 'hsl(var(--border))' }}
                >
                  <div className="shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                    {TYPE_ICON[n.type] ?? 'i'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[14px] leading-tight ${!n.read ? 'font-semibold' : ''}`}>
                      {n.title}
                    </div>
                    {n.message && (
                      <div className="text-[13px] text-muted-foreground mt-1 line-clamp-2">
                        {n.message}
                      </div>
                    )}
                    <div className="text-[12px] text-muted-foreground mt-1">
                      {formatTimeAgo(new Date(n.createdAt))}
                    </div>
                  </div>
                  {!n.read && (
                    <div className="shrink-0 mt-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                    </div>
                  )}
                </a>
              ))
            )}
          </EwmsScrollArea>

          <div className="px-4 py-2 border-t text-center" style={{ borderColor: 'hsl(var(--border))' }}>
            <a href="/notifications" className="text-[13px] text-teal-600 hover:underline">
              View all notifications
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
