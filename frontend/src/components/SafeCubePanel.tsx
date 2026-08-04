import { useState } from 'react';
import { getAuthToken } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { EwmsScrollArea } from '@/components/ewms/Media';
import { ChevronDown, ChevronRight, RefreshCw, Radio, AlertTriangle, Ship } from 'lucide-react';
import type { SafeCubeData, SafeCubeEvent, SafeCubeAlert } from '@/hooks/useSafeCubeTracking';

// ─── Color tokens ─────────────────────────────────────────────────────────────
const TEAL   = 'hsl(var(--vs-teal))';
const GREEN  = 'hsl(var(--vs-success))';
const AMBER  = 'hsl(38 92% 50%)';
const RED    = 'hsl(var(--vs-danger))';
const MUTED  = 'hsl(var(--muted-foreground))';
const BORDER = 'hsl(var(--border))';
const FG     = 'hsl(var(--foreground))';
const CARD   = 'hsl(var(--card))';
const BG     = 'hsl(var(--background))';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// ─── Schedule status badge ────────────────────────────────────────────────────
export function ScheduleStatusBadge({ status, delayDays }: { status: string | null | undefined; delayDays?: number | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const isOnTime = s.includes('on') || delayDays === 0;
  const isPast   = delayDays !== null && delayDays !== undefined && delayDays < 0;
  const isDelay  = delayDays !== null && delayDays !== undefined && delayDays > 0;

  let label = 'On Time';
  let intent: 'success' | 'warning' | 'danger' | 'neutral' = 'success';
  if (isDelay) { intent = 'warning'; label = `${delayDays}d delay`; }
  if (isPast)  { intent = 'danger'; label = 'Past ETA'; }
  if (!isOnTime && !isDelay && !isPast) { intent = 'neutral'; label = status; }

  return <Badge intent={intent} size="sm">{label}</Badge>;
}

// ─── Ship silhouette (reused in route diagram) ────────────────────────────────
function ShipIcon({ size = 32, color = TEAL }: { size?: number; color?: string }) {
  const h = Math.round(size * 0.5);
  return (
    <svg width={size} height={h} viewBox="0 0 80 40" fill="none" aria-hidden="true" style={{ color }}>
      <path d="M2 18 L2 32 L68 32 L76 24 L68 16 L2 16 Z" fill="currentColor" />
      <rect x="4" y="5" width="14" height="11" rx="2" fill="currentColor" opacity="0.85" />
      <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" />
      <circle cx="10.5" cy="0.5" r="2.5" fill="currentColor" opacity="0.12" />
      <rect x="22" y="7" width="14" height="9" rx="1.5" fill="currentColor" opacity="0.68" />
      <rect x="38" y="7" width="14" height="9" rx="1.5" fill="currentColor" opacity="0.62" />
      <rect x="54" y="9" width="10" height="7" rx="1" fill="currentColor" opacity="0.55" />
      <line x1="2" y1="30" x2="68" y2="30" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
    </svg>
  );
}

// ─── SVG Route Diagram ────────────────────────────────────────────────────────
function SafeCubeRoute({ sc }: { sc: SafeCubeData }) {
  // Port x positions as % of container width
  const PORT_PCTS = [8, 30, 70, 92] as const;
  const [prePol, pol, pod, postPod] = PORT_PCTS;

  // Compute ship position fraction (pol→pod)
  let shipPct = pol; // default: at pol (departing)
  const polTime = sc.polAt ? new Date(sc.polAt).getTime() : null;
  const podTime = (sc.podAt ? new Date(sc.podAt).getTime() : null)
    ?? (sc.podPredictiveEta ? new Date(sc.podPredictiveEta).getTime() : null);

  if (polTime && podTime && podTime > polTime) {
    const fraction = clamp((Date.now() - polTime) / (podTime - polTime), 0, 1);
    shipPct = pol + fraction * (pod - pol);
  }

  // Track span (first port to last port)
  const trackLeft  = `${prePol}%`;
  const trackRight = `${100 - postPod}%`;
  // Sailed width (from prePol to ship) as % of track width
  const trackSpan  = postPod - prePol;
  const sailedPct  = trackSpan > 0 ? clamp((shipPct - prePol) / trackSpan * 100, 0, 100) : 0;

  const ports = [
    { pct: prePol, name: sc.prepodName, locode: sc.prepodLocode, at: sc.prepodAt, actual: sc.prepodActual, predictive: sc.prepodPredictiveEta },
    { pct: pol,    name: sc.polName,    locode: sc.polLocode,    at: sc.polAt,    actual: sc.polActual,    predictive: sc.polPredictiveEta },
    { pct: pod,    name: sc.podName,    locode: sc.podLocode,    at: sc.podAt,    actual: sc.podActual,    predictive: sc.podPredictiveEta },
    { pct: postPod,name: sc.postpodName,locode: sc.postpodLocode,at: sc.postpodAt,actual: sc.postpodActual,predictive: sc.postpodPredictiveEta },
  ];

  return (
    <div style={{ position: 'relative', height: 96, marginBottom: 4 }}>
      <style>{`@keyframes scShipBob { 0%, 100% { transform: translateX(-50%) translateY(0px); } 50% { transform: translateX(-50%) translateY(-3px); }}`}</style>

      {/* Ship icon — bobs above the track */}
      <div style={{
        position: 'absolute', top: 4, left: `${shipPct}%`,
        animation: 'scShipBob 3s ease-in-out infinite',
        zIndex: 3, pointerEvents: 'none',
      }}>
        <ShipIcon size={36} color={TEAL} />
      </div>

      {/* Route track */}
      <div style={{
        position: 'absolute', top: 44, left: trackLeft, right: trackRight,
        height: 2, zIndex: 0,
      }}>
        {/* Sailed segment */}
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${sailedPct}%`,
          background: `linear-gradient(90deg, ${GREEN}, ${TEAL})`,
          borderRadius: 2,
          boxShadow: `0 0 6px ${TEAL}55`,
        }} />
        {/* Future segment — dashed */}
        <div style={{
          position: 'absolute', top: 0, height: '100%',
          left: `${sailedPct}%`, right: 0,
          backgroundImage: `repeating-linear-gradient(90deg, ${BORDER} 0px, ${BORDER} 5px, transparent 5px, transparent 11px)`,
          opacity: 0.7,
        }} />
      </div>

      {/* Port circles + labels */}
      {ports.map((p, i) => {
        const isSailed = p.pct <= shipPct;
        const dotColor = isSailed ? TEAL : BORDER;
        const dateStr = p.actual && p.at ? fmtDtShort(p.at) : (p.predictive ? `~${fmtDtShort(p.predictive)}` : '');
        return (
          <div key={i} style={{
            position: 'absolute', top: 36,
            left: `${p.pct}%`, transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            zIndex: 2, width: 60,
          }}>
            {/* Circle */}
            <div style={{
              width: 14, height: 14, borderRadius: 7, flexShrink: 0,
              backgroundColor: isSailed ? dotColor : 'transparent',
              border: isSailed ? 'none' : `2px solid ${BORDER}`,
              boxShadow: isSailed ? `0 0 4px ${TEAL}55` : 'none',
            }} />
            {/* Labels */}
            {p.locode && (
              <span className="vs-mono" style={{ fontSize: 11, fontWeight: 700, color: isSailed ? TEAL : MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2, textAlign: 'center', whiteSpace: 'nowrap' }}>
                {p.locode}
              </span>
            )}
            {p.name && (
              <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.2, textAlign: 'center', wordBreak: 'break-word', maxWidth: 56 }}>
                {p.name.length > 14 ? p.name.slice(0, 14) + '…' : p.name}
              </span>
            )}
            {dateStr && (
              <span className="vs-mono" style={{ fontSize: 11, color: isSailed ? GREEN : MUTED, fontWeight: 600, lineHeight: 1.2, textAlign: 'center', whiteSpace: 'nowrap' }}>
                {dateStr}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Live Tracking Panel ──────────────────────────────────────────────────────
export function SafeCubeLivePanel({
  data,
  shipmentId,
  onSync,
}: {
  data: SafeCubeData;
  shipmentId: string;
  onSync: () => void;
}) {
  const [open,    setOpen]    = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch(`/api/shipments/${shipmentId}/safecube/sync`, {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      onSync();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{
      backgroundColor: CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
      boxShadow: 'var(--vs-shadow-card)',
      marginTop: 16,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 18px',
          cursor: 'pointer',
          borderBottom: open ? `1px solid ${BORDER}` : 'none',
          userSelect: 'none',
        }}
      >
        <Radio size={14} style={{ color: TEAL, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14.5, color: FG, flex: 1 }}>Live Tracking</span>
        <ScheduleStatusBadge status={data.scheduleStatus} delayDays={data.delayDays} />
        <button
          onClick={e => { e.stopPropagation(); handleSync(); }}
          disabled={syncing}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: MUTED, display: 'flex', alignItems: 'center', borderRadius: 4, marginLeft: 4 }}
          title="Sync tracking data"
        >
          <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
        {open ? <ChevronDown size={15} style={{ color: MUTED }} /> : <ChevronRight size={15} style={{ color: MUTED }} />}
      </div>

      {open && (
        <div style={{ padding: '16px 18px' }}>
          {/* Vessel metadata */}
          {data.vesselName && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 14, fontSize: 14, color: MUTED }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Ship size={12} style={{ color: TEAL }} />
                <span style={{ fontWeight: 600, color: FG }}>{data.vesselName}</span>
              </span>
              {data.vesselImo && (
                <span className="vs-mono">IMO {data.vesselImo}</span>
              )}
              {data.vesselCallSign && (
                <span className="vs-mono">CS {data.vesselCallSign}</span>
              )}
              {data.vesselFlag && (
                <span className="vs-mono">🏴 {data.vesselFlag}</span>
              )}
              {data.currentLocationName && (
                <span style={{ color: TEAL, fontWeight: 500 }}>📍 {data.currentLocationName}</span>
              )}
            </div>
          )}

          {/* SVG route diagram */}
          <SafeCubeRoute sc={data} />

          {/* Milestone rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 }}>
            {[
              { label: 'Pre-POL', name: data.prepodName,  locode: data.prepodLocode,  at: data.prepodAt,  actual: data.prepodActual,  eta: data.prepodPredictiveEta },
              { label: 'POL',     name: data.polName,     locode: data.polLocode,     at: data.polAt,     actual: data.polActual,     eta: data.polPredictiveEta },
              { label: 'POD',     name: data.podName,     locode: data.podLocode,     at: data.podAt,     actual: data.podActual,     eta: data.podPredictiveEta },
              { label: 'Post-POD',name: data.postpodName, locode: data.postpodLocode, at: data.postpodAt, actual: data.postpodActual, eta: data.postpodPredictiveEta },
            ].map((m, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 0',
                borderBottom: i < 3 ? `1px solid ${BORDER}55` : 'none',
                fontSize: 14,
              }}>
                {/* Label */}
                <span className="vs-mono" style={{ fontWeight: 700, color: TEAL, minWidth: 60, fontSize: 14.5 }}>{m.label}</span>
                {/* Locode badge */}
                {m.locode && (
                  <span className="vs-mono" style={{ fontSize: 14, padding: '1px 6px', borderRadius: 4, backgroundColor: 'hsl(var(--muted))', color: MUTED, fontWeight: 700 }}>
                    {m.locode}
                  </span>
                )}
                {/* Location name */}
                <span style={{ flex: 1, color: FG, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name ?? '—'}
                </span>
                {/* Date */}
                <span className="vs-mono" style={{ fontSize: 14.5, flexShrink: 0, fontWeight: m.actual ? 600 : 400, color: m.actual ? GREEN : MUTED }}>
                  {m.actual && m.at ? fmtDt(m.at) : (m.eta ? `~${fmtDtShort(m.eta)}` : '—')}
                  {m.actual && <span style={{ marginLeft: 4, fontSize: 14.5, color: GREEN }}>✓</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Event Timeline ───────────────────────────────────────────────────────────
export function SafeCubeTimeline({ events }: { events: SafeCubeEvent[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...events].sort((a, b) => a.sequenceNo - b.sequenceNo);

  return (
    <div style={{
      backgroundColor: CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
      boxShadow: 'var(--vs-shadow-card)',
      marginTop: 16,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 18px',
          cursor: 'pointer',
          borderBottom: open ? `1px solid ${BORDER}` : 'none',
          userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14.5, color: FG, flex: 1 }}>Tracking Events</span>
        <span className="vs-mono" style={{ fontSize: 14.5, color: MUTED }}>{sorted.length}</span>
        {open ? <ChevronDown size={15} style={{ color: MUTED }} /> : <ChevronRight size={15} style={{ color: MUTED }} />}
      </div>

      {open && (
        <EwmsScrollArea style={{ padding: '12px 18px', maxHeight: 360 }}>
          {sorted.map((ev, i) => (
            <div key={ev.id} style={{ display: 'flex', gap: 12, paddingBottom: i < sorted.length - 1 ? 12 : 0, position: 'relative' }}>
              {/* Timeline spine */}
              {i < sorted.length - 1 && (
                <div style={{
                  position: 'absolute', left: 7, top: 16, bottom: 0, width: 1,
                  background: `repeating-linear-gradient(180deg, ${BORDER} 0, ${BORDER} 4px, transparent 4px, transparent 8px)`,
                  opacity: 0.5,
                }} />
              )}
              {/* Dot */}
              <div style={{ flexShrink: 0, marginTop: 2, zIndex: 1 }}>
                {ev.isActual ? (
                  <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: TEAL, boxShadow: `0 0 4px ${TEAL}55` }} />
                ) : (
                  <div style={{ width: 14, height: 14, borderRadius: 7, border: `2px dashed ${BORDER}`, backgroundColor: BG }} />
                )}
              </div>
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: ev.isActual ? 600 : 400, color: ev.isActual ? FG : MUTED, lineHeight: 1.4 }}>
                  {ev.description ?? ev.eventCode ?? `Event ${ev.sequenceNo}`}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  {ev.locationName && (
                    <span style={{ fontSize: 14.5, color: MUTED }}>📍 {ev.locationName}</span>
                  )}
                  {ev.vesselName && (
                    <span style={{ fontSize: 14.5, color: MUTED }}>🚢 {ev.vesselName}</span>
                  )}
                  {ev.transportType && (
                    <span className="vs-mono" style={{ fontSize: 14, padding: '1px 5px', borderRadius: 4, background: 'hsl(var(--muted))', color: MUTED }}>
                      {ev.transportType}
                    </span>
                  )}
                </div>
              </div>
              {/* Date */}
              <div className="vs-mono" style={{ fontSize: 14.5, color: ev.isActual ? GREEN : MUTED, flexShrink: 0, alignSelf: 'flex-start', marginTop: 1 }}>
                {ev.eventAt ? fmtDtShort(ev.eventAt) : '—'}
              </div>
            </div>
          ))}
        </EwmsScrollArea>
      )}
    </div>
  );
}

// ─── Alerts Panel ─────────────────────────────────────────────────────────────
const SEVERITY_STYLES: Record<string, { border: string; bg: string; color: string }> = {
  critical: { border: RED,   bg: 'hsl(var(--vs-danger) / 0.07)', color: RED },
  high:     { border: AMBER, bg: 'hsl(38 92% 50% / 0.07)',       color: AMBER },
  medium:   { border: AMBER, bg: 'hsl(38 92% 50% / 0.07)',       color: AMBER },
  low:      { border: 'hsl(201 96% 32%)', bg: 'hsl(201 96% 32% / 0.07)', color: 'hsl(201 96% 32%)' },
  info:     { border: 'hsl(201 96% 32%)', bg: 'hsl(201 96% 32% / 0.07)', color: 'hsl(201 96% 32%)' },
};

export function SafeCubeAlerts({ alerts }: { alerts: SafeCubeAlert[] }) {
  const [open,         setOpen]         = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const active   = alerts.filter(a => a.isActive !== false && !a.resolvedAt);
  const resolved = alerts.filter(a => !a.isActive || a.resolvedAt);
  const displayed = showResolved ? [...active, ...resolved] : active;

  if (alerts.length === 0) return null;

  return (
    <div style={{
      backgroundColor: CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
      boxShadow: 'var(--vs-shadow-card)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setOpen(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 18px',
          cursor: 'pointer',
          borderBottom: open ? `1px solid ${BORDER}` : 'none',
          userSelect: 'none',
        }}
      >
        <AlertTriangle size={14} style={{ color: active.length > 0 ? RED : AMBER, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14.5, color: FG, flex: 1 }}>
          Tracking Alerts
          {active.length > 0 && (
            <span style={{
              marginLeft: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, borderRadius: 9,
              fontSize: 14, fontWeight: 700, backgroundColor: RED, color: '#fff',
            }}>{active.length}</span>
          )}
        </span>
        {open ? <ChevronDown size={15} style={{ color: MUTED }} /> : <ChevronRight size={15} style={{ color: MUTED }} />}
      </div>

      {open && (
        <div style={{ padding: '12px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayed.map(a => {
              const sev = (a.severity ?? 'info').toLowerCase();
              const style = SEVERITY_STYLES[sev] ?? SEVERITY_STYLES.info;
              const isRes = !!a.resolvedAt;
              return (
                <div key={a.id} style={{
                  borderLeft: `3px solid ${isRes ? BORDER : style.border}`,
                  backgroundColor: isRes ? 'transparent' : style.bg,
                  borderRadius: 6,
                  padding: '8px 12px',
                  opacity: isRes ? 0.6 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: isRes ? MUTED : style.color, lineHeight: 1.3 }}>
                        {a.title ?? a.severity ?? 'Alert'}
                      </div>
                      {a.description && (
                        <div style={{ fontSize: 14.5, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>
                          {a.description}
                        </div>
                      )}
                      {a.locationName && (
                        <div style={{ fontSize: 14.5, color: MUTED, marginTop: 3 }}>📍 {a.locationName}</div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div className="vs-mono" style={{ fontSize: 14, color: MUTED }}>
                        {isRes ? `Resolved ${fmtDtShort(a.resolvedAt)}` : fmtDtShort(a.alertAt)}
                      </div>
                      {a.severity && (
                        <div className="vs-mono" style={{ fontSize: 14.5, marginTop: 2, textTransform: 'uppercase', color: isRes ? MUTED : style.color, fontWeight: 700 }}>
                          {a.severity}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {resolved.length > 0 && (
            <button
              onClick={() => setShowResolved(p => !p)}
              style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14.5, color: MUTED, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {showResolved ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {showResolved ? 'Hide' : `Show ${resolved.length} resolved`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Enable Live Tracking prompt ──────────────────────────────────────────────
export function LinkSafeCubePrompt({
  shipmentId,
  onLinked,
}: {
  shipmentId: string;
  onLinked: () => void;
}) {
  const [linking, setLinking] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleLink() {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/safecube/link`, {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      const json = await res.json();
      if (json.ok) {
        onLinked();
      } else {
        setError(json.error ?? 'Failed to enable live tracking');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div style={{
      backgroundColor: CARD,
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
      boxShadow: 'var(--vs-shadow-card)',
      padding: '16px 18px',
      marginTop: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Radio size={14} style={{ color: MUTED }} />
        <span style={{ fontWeight: 600, fontSize: 14.5, color: FG }}>Live Tracking</span>
      </div>
      <p style={{ fontSize: 14, color: MUTED, margin: '0 0 12px', lineHeight: 1.5 }}>
        Enable real-time vessel tracking, event timeline, and schedule alerts for this shipment.
      </p>
      {error && (
        <div style={{ fontSize: 14, color: RED, marginBottom: 10, lineHeight: 1.4 }}>{error}</div>
      )}
      <button
        onClick={handleLink}
        disabled={linking}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 600, color: '#fff',
          backgroundColor: linking ? MUTED : TEAL,
          opacity: linking ? 0.7 : 1,
          transition: 'background-color 0.2s',
        }}
      >
        {linking && <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: 6, animation: 'spin 0.8s linear infinite' }} />}
        {linking ? 'Enabling…' : 'Enable Live Tracking'}
      </button>
    </div>
  );
}
