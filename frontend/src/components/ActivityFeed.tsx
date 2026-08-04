import { ActivityEvent } from '@/data/mockData';

type ActivityFeedProps = {
  events: ActivityEvent[];
};

const typeConfig: Record<ActivityEvent['type'], { color: string; bg: string }> = {
  import: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/40' },
  upload: { color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/40' },
  ocr: { color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-100 dark:bg-cyan-900/40' },
  validation: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/40' },
  system: { color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800/60' },
  customs: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/40' },
};

const typeLabels: Record<ActivityEvent['type'], string> = {
  import: 'Import',
  upload: 'Upload',
  ocr: 'OCR',
  validation: 'Validated',
  system: 'System',
  customs: 'Customs',
};

export function ActivityFeed({ events }: ActivityFeedProps) {
  const reversed = [...events].reverse();

  return (
    <div className="space-y-0" data-testid="activity-feed">
      {reversed.map((evt, idx) => {
        const config = typeConfig[evt.type];
        const isLast = idx === reversed.length - 1;
        return (
          <div key={evt.id} className="flex gap-3 relative">
            {/* Dot + line */}
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                <span className={`w-2 h-2 rounded-full ${config.color.replace('text-', 'bg-').replace('dark:', '')}`} />
              </div>
              {!isLast && (
                <div className="w-px flex-1 my-1 bg-border" style={{ minHeight: 16 }} />
              )}
            </div>

            {/* Content */}
            <div className="pb-3 flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[14.5px] text-foreground leading-snug">{evt.event}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-[13px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${config.bg} ${config.color}`}>
                    {typeLabels[evt.type]}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[12px] text-muted-foreground">{evt.timestamp}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-[12px] font-medium text-muted-foreground">{evt.actor}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
