import {
  FileCheck, FileText, Package, Ship, Anchor, MapPin, Shield, Truck
} from 'lucide-react';
import { TrackingEvent } from '@/data/mockData';

const iconMap: Record<string, React.ReactNode> = {
  FileCheck: <FileCheck className="w-3.5 h-3.5" />,
  FileText: <FileText className="w-3.5 h-3.5" />,
  Package: <Package className="w-3.5 h-3.5" />,
  Ship: <Ship className="w-3.5 h-3.5" />,
  Anchor: <Anchor className="w-3.5 h-3.5" />,
  MapPin: <MapPin className="w-3.5 h-3.5" />,
  Shield: <Shield className="w-3.5 h-3.5" />,
  Truck: <Truck className="w-3.5 h-3.5" />,
};

type TrackingTimelineProps = {
  events: TrackingEvent[];
};

export function TrackingTimeline({ events }: TrackingTimelineProps) {
  return (
    <div className="space-y-0" data-testid="tracking-timeline">
      {events.map((evt, idx) => {
        const isLast = idx === events.length - 1;
        return (
          <div key={evt.id} className="flex gap-3">
            {/* Icon + line */}
            <div className="flex flex-col items-center">
              <div
                className={`relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 z-10 transition-all ${
                  evt.isCompleted
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : evt.isActive
                    ? 'ring-4 ring-primary/20'
                    : 'bg-muted text-muted-foreground border border-dashed'
                }`}
                style={evt.isActive ? { backgroundColor: 'hsl(var(--primary))', color: 'white' } : undefined}
              >
                {evt.isActive && (
                  <span
                    className="absolute inset-0 rounded-full pulse-ring"
                    style={{ backgroundColor: 'hsl(var(--primary) / 0.3)' }}
                  />
                )}
                {iconMap[evt.icon] || <Package className="w-3.5 h-3.5" />}
              </div>
              {!isLast && (
                <div
                  className="w-px flex-1 my-1"
                  style={{
                    minHeight: 24,
                    backgroundColor: evt.isCompleted
                      ? 'hsl(152 69% 35%)'
                      : evt.isActive
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--border))',
                    borderLeft: !evt.isCompleted && !evt.isActive ? '1px dashed hsl(var(--border))' : undefined,
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div className="pb-4 flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p
                    className={`text-[14.5px] font-medium leading-snug ${
                      evt.isActive ? 'text-foreground' : evt.isCompleted ? 'text-foreground/80' : 'text-muted-foreground'
                    }`}
                  >
                    {evt.event}
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-0.5">{evt.location}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {evt.isActive && (
                    <span className="text-[12px] font-bold px-2 py-0.5 rounded bg-primary text-primary-foreground uppercase tracking-wide">
                      Live
                    </span>
                  )}
                  <span className="text-[12px] text-muted-foreground whitespace-nowrap">{evt.timestamp}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
