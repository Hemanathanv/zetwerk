import { useState } from 'react';
import { Radio, Ship, TrendingUp, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { shipmentTrackings, trackingEvents } from '@/data/mockData';
import { StatusBadge } from '@/components/StatusBadge';
import { TrackingTimeline } from '@/components/TrackingTimeline';

export function TrackingPage() {
  const [expandedId, setExpandedId] = useState<string | null>('SH1002');

  const inTransit  = shipmentTrackings.filter(s => s.status === 'In Transit').length;
  const exceptions = shipmentTrackings.filter(s => s.status === 'Exception').length;
  const onTime     = shipmentTrackings.filter(s => s.etaStatus === 'On Time').length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Tracking Control Tower</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Live vessel positions and milestone updates via Shipsy</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400">
          <Radio className="w-3 h-3" />
          Shipsy Live
          <span className="relative flex h-1.5 w-1.5 ml-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'In Transit',  value: inTransit,  icon: Ship,          color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/20' },
          { label: 'On Time',     value: onTime,      icon: TrendingUp,    color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { label: 'Exceptions',  value: exceptions,  icon: AlertTriangle, color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/20' },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-card border rounded-lg p-3 flex items-center gap-3" style={{ borderColor: 'hsl(var(--card-border))' }}>
              <div className={`p-2 rounded-md ${c.bg}`}><Icon className={`w-4 h-4 ${c.color}`} /></div>
              <div>
                <p className="text-xl font-bold">{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tracking rows */}
      <div className="space-y-2">
        {shipmentTrackings.map(t => {
          const isExpanded = expandedId === t.shipmentId;
          return (
            <div
              key={t.shipmentId}
              className="bg-card border rounded-lg overflow-hidden"
              style={{ borderColor: 'hsl(var(--card-border))' }}
            >
              {/* Row header */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : t.shipmentId)}
                data-testid={`tracking-row-${t.shipmentId}`}
              >
                {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}

                <span className="font-bold text-primary text-sm w-16 flex-shrink-0">{t.shipmentId}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{t.vessel}</span>
                    <span className="text-xs text-muted-foreground">{t.container}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.origin} → {t.destination}</p>
                </div>

                <div className="hidden md:flex items-center gap-4 flex-shrink-0">
                  {/* Progress bar */}
                  <div className="w-28">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>{t.progress}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${t.progress}%`,
                          backgroundColor: t.status === 'Exception' ? 'hsl(0 84% 60%)' : t.status === 'Closed' ? 'hsl(152 69% 35%)' : 'hsl(var(--primary))',
                        }}
                      />
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    t.etaStatus === 'On Time' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : t.etaStatus === 'Delayed' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                  }`}>{t.etaStatus}</span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="hidden sm:block text-xs text-muted-foreground">ETA {t.eta}</span>
                  <StatusBadge status={t.status} />
                </div>
              </button>

              {/* Expanded timeline */}
              {isExpanded && (
                <div className="border-t px-8 py-4" style={{ borderColor: 'hsl(var(--border))' }}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Timeline</p>
                      <TrackingTimeline events={trackingEvents} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Shipment Info</p>
                      {[
                        ['Vessel', t.vessel],
                        ['Container', t.container],
                        ['Carrier', t.carrier],
                        ['Origin', t.origin],
                        ['Destination', t.destination],
                        ['Current Location', t.currentLocation],
                        ['Last Event', t.lastEvent],
                        ['Last Updated', t.lastEventTime],
                      ].map(([label, val]) => (
                        <div key={label} className="flex items-start justify-between gap-2 py-1.5 border-b text-xs" style={{ borderColor: 'hsl(var(--border))' }}>
                          <span className="text-muted-foreground flex-shrink-0">{label}</span>
                          <span className="font-medium text-right">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
