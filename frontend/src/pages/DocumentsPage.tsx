import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { getAuthToken } from '@/lib/api';
import {
  ChevronDown, ChevronRight as ChevronRightIcon, Check, Loader2, Sparkles,
  AlertTriangle, AlertCircle, Circle, Search, Clock, Upload as UploadIcon,
  CheckCircle2, CircleDot,
} from 'lucide-react';
import { PageHeader, StatusPill, DocBadge, FilterChips } from '@/components/vs';

// ─── Color tokens ─────────────────────────────────────────────────────────────
const TEAL    = 'hsl(var(--vs-teal))';
const GREEN   = 'hsl(var(--vs-success))';
const AMBER   = 'hsl(38 92% 50%)';
const RED     = 'hsl(var(--vs-danger))';
const BLUE    = 'hsl(221 83% 53%)';
const INFO    = 'hsl(201 96% 32%)';
const GOLD    = 'hsl(38 92% 50%)';
const FG      = 'hsl(var(--foreground))';
const MUTED   = 'hsl(var(--muted-foreground))';
const BORDER  = 'hsl(var(--border))';
const CARD_BG = 'hsl(var(--card))';

// ─── Types ────────────────────────────────────────────────────────────────────
type GateStatus = 'passed' | 'active' | 'future' | 'blocked';
type DocStatus  = 'closed' | 'processing' | 'gen-closed' | 'gen-review'
                | 'failed-block' | 'failed-warn' | 'expected' | 'na';

interface DocEntry {
  code: string;
  label: string;
  status: DocStatus;
  docNumber?: string;
  ruleCode?: string;
  docId?: string;
  genType?: string;
}

interface GateCol {
  name: string;
  label: string;
  status: GateStatus;
  docCount: string;
  docs: DocEntry[];
}

interface ShipmentLane {
  id: string;
  isPending?: boolean;
  shipmentId: string;
  vessel: string;
  meta: string;
  gateStatuses: GateStatus[];
  docSummary: string;
  statusLabel: string;
  statusVariant: 'pending' | 'cleared' | 'danger' | 'info';
  gates: GateCol[];
  parallel: DocEntry[];
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function gateColor(s: GateStatus) {
  return s === 'passed' ? GREEN : s === 'active' ? TEAL : s === 'blocked' ? RED : BORDER;
}

function GateCircle({ status, size = 28 }: { status: GateStatus; size?: number }) {
  const bg = gateColor(status);
  const iconSize = Math.round(size * 0.46);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      backgroundColor: status === 'future' ? 'transparent' : bg,
      border: status === 'future' ? `2px solid ${BORDER}` : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: status === 'active' ? `0 0 0 4px ${TEAL}28` : 'none',
    }}>
      {status === 'passed'  && <Check size={iconSize} color="#fff" strokeWidth={2.5} />}
      {status === 'active'  && <div style={{ width: size * 0.26, height: size * 0.26, borderRadius: '50%', backgroundColor: '#fff' }} />}
      {status === 'blocked' && <span style={{ color: '#fff', fontSize: iconSize, fontWeight: 700 }}>!</span>}
    </div>
  );
}

function MiniGateDot({ status }: { status: GateStatus }) {
  return (
    <div style={{
      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
      backgroundColor: status === 'future' ? 'transparent' : gateColor(status),
      border: status === 'future' ? `1.5px solid ${BORDER}` : 'none',
    }} />
  );
}

function GateLine({ from, to, hasShip = false }: { from: GateStatus; to: GateStatus; hasShip?: boolean }) {
  const isPassed = from === 'passed' && (to === 'passed' || to === 'active');
  return (
    <div style={{ flex: 1, minWidth: 64, height: 2, position: 'relative', overflow: 'visible' }}>
      {/* Line — opacity lives on this inner div so the ship sibling is unaffected */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundColor: isPassed ? GREEN : 'transparent',
        borderTop: isPassed ? 'none' : `2px dashed ${BORDER}`,
        opacity: 0.6,
      }} />
      {hasShip && (
        <div className="ewms-ship-bob" style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, calc(-50% - 22px))',
          zIndex: 10,
          pointerEvents: 'none',
          fontSize: 26,
          lineHeight: 1,
          filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.22))',
        }}>
          🚢
        </div>
      )}
    </div>
  );
}

function DocStatusIcon({ status, isParallel }: { status: DocStatus; isParallel?: boolean }) {
  const warnColor = isParallel ? AMBER : RED;
  switch (status) {
    case 'closed':
      return <CheckCircle2 size={12} style={{ color: GREEN, flexShrink: 0 }} />;
    case 'processing':
      return <Loader2 size={12} style={{ color: INFO, flexShrink: 0, animation: 'spin 0.9s linear infinite' }} />;
    case 'gen-closed':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Sparkles size={11} style={{ color: GOLD }} />
          <Check size={9} style={{ color: GREEN, strokeWidth: 3 }} />
        </span>
      );
    case 'gen-review':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Sparkles size={11} style={{ color: GOLD }} />
          <Loader2 size={9} style={{ color: GOLD, animation: 'spin 0.9s linear infinite' }} />
        </span>
      );
    case 'failed-block':
      return <AlertCircle size={12} style={{ color: RED, flexShrink: 0 }} />;
    case 'failed-warn':
      return <AlertTriangle size={12} style={{ color: warnColor, flexShrink: 0 }} />;
    case 'expected':
      return <Circle size={11} style={{ color: MUTED, flexShrink: 0, opacity: 0.4 }} />;
    case 'na':
      return <span style={{ fontSize: 11, color: MUTED, opacity: 0.4, flexShrink: 0 }}>—</span>;
  }
}

function docSubText(doc: DocEntry, isParallel?: boolean): { text: string; color: string; italic?: boolean; mono?: boolean } {
  switch (doc.status) {
    case 'closed':
      return { text: doc.docNumber ?? '', color: MUTED, mono: true };
    case 'gen-closed':
      return { text: doc.docNumber ?? 'Draft approved', color: GOLD };
    case 'gen-review':
      return { text: doc.docNumber ?? 'Draft — review', color: GOLD };
    case 'processing':
      return { text: doc.docNumber ?? 'Processing...', color: INFO };
    case 'failed-block':
      return { text: doc.ruleCode ?? 'Failed', color: RED, mono: true };
    case 'failed-warn':
      return { text: doc.ruleCode ?? doc.docNumber ?? 'Warning', color: isParallel ? AMBER : RED, mono: !!doc.ruleCode };
    case 'expected':
      return { text: doc.docNumber ?? 'Expected', color: MUTED, italic: true };
    case 'na':
      return { text: '—', color: MUTED };
  }
}

// ─── DocItem ──────────────────────────────────────────────────────────────────
function DocItem({ doc, isParallel, onNavigate }: {
  doc: DocEntry;
  isParallel?: boolean;
  onNavigate: (path: string) => void;
}) {
  const sub = docSubText(doc, isParallel);
  const clickable = doc.status !== 'na' && doc.status !== 'expected';
  const path = (doc.status === 'gen-closed' || doc.status === 'gen-review') && doc.genType
    ? `/documents/generate/${doc.genType}`
    : doc.status === 'closed' && doc.docId
      ? '/documents/upload'
      : doc.status === 'expected' || doc.status === 'failed-warn' || doc.status === 'failed-block' || doc.status === 'processing'
        ? '/documents/upload'
        : undefined;

  return (
    <div
      onClick={path ? () => onNavigate(path) : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0',
        cursor: clickable && path ? 'pointer' : 'default',
        borderRadius: 4,
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={(e) => { if (path) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'hsla(0,0%,0%,0.03)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
    >
      <DocBadge code={doc.code} size="sm" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED }}>{doc.label}</span>
          <DocStatusIcon status={doc.status} isParallel={isParallel} />
        </div>
        <span style={{
          fontSize: 10, color: sub.color,
          fontStyle: sub.italic ? 'italic' : 'normal',
          fontFamily: sub.mono ? 'var(--font-mono, monospace)' : 'inherit',
          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 90,
        }}>
          {sub.text}
        </span>
      </div>
    </div>
  );
}

// ─── Gate column ──────────────────────────────────────────────────────────────
function GateColPanel({ gate, isParallel, onNavigate }: {
  gate: GateCol;
  isParallel?: boolean;
  onNavigate: (path: string) => void;
}) {
  const hasBlock = gate.docs.some((d) => d.status === 'failed-block');
  const headerBg = hasBlock
    ? 'hsla(0,84%,60%,0.06)'
    : isParallel
      ? 'hsla(220,14%,85%,0.25)'
      : gate.status === 'passed'
        ? `${GREEN}08`
        : gate.status === 'active'
          ? `${TEAL}08`
          : 'transparent';
  const dot6 = gateColor(gate.status);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderRight: `1px solid ${BORDER}`,
      minWidth: 0,
      backgroundColor: isParallel ? 'hsla(220,14%,90%,0.18)' : 'transparent',
    }}>
      {/* Column header */}
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: `1px solid ${BORDER}`,
        backgroundColor: headerBg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {!isParallel && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              backgroundColor: gate.status === 'future' ? 'transparent' : dot6,
              border: gate.status === 'future' ? `1.5px solid ${BORDER}` : 'none',
            }} />
          )}
          <span style={{ fontSize: 10.5, fontWeight: 700, color: FG, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {gate.name}
          </span>
        </div>
        <div style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{gate.label}</div>
        {!isParallel && (
          <span className="vs-mono" style={{ fontSize: 9.5, color: MUTED, display: 'block', marginTop: 2 }}>
            {gate.docCount}
          </span>
        )}
      </div>
      {/* Column body */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {gate.docs.length === 0 ? (
          <span style={{ fontSize: 10, color: MUTED, opacity: 0.5, fontStyle: 'italic' }}>—</span>
        ) : (
          gate.docs.map((doc, i) => (
            <DocItem key={i} doc={doc} isParallel={isParallel} onNavigate={onNavigate} />
          ))
        )}
        {hasBlock && (
          <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: RED }}>
            BLOCKED
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shipment accordion ───────────────────────────────────────────────────────
function ShipmentAccordion({ lane, open, onToggle }: {
  lane: ShipmentLane;
  open: boolean;
  onToggle: () => void;
}) {
  const [, navigate] = useLocation();
  const accentColor = lane.isPending ? AMBER : TEAL;
  void accentColor;

  return (
    <div style={{
      backgroundColor: CARD_BG, borderRadius: 12, overflow: 'hidden',
      border: `1px solid ${BORDER}`,
      boxShadow: 'var(--vs-shadow-card)',
      marginBottom: 10,
    }}>
      {/* ── Collapsed header ── */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 16,
          borderBottom: open ? `1px solid ${BORDER}` : 'none',
          backgroundColor: open ? 'hsl(var(--muted) / 0.25)' : 'transparent',
          transition: 'background-color 0.12s',
          userSelect: 'none',
        }}
      >
        {/* Left: identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            {lane.isPending ? (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 5,
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                backgroundColor: `${AMBER}20`, justifyContent: 'center',
              }}>
                <Clock size={13} style={{ color: AMBER }} />
              </span>
            ) : (
              <DocBadge code="BL" size="sm" />
            )}
            <span className="vs-mono" style={{
              fontSize: 14, fontWeight: 700,
              color: lane.isPending ? AMBER : FG,
              fontStyle: lane.isPending ? 'italic' : 'normal',
            }}>
              {lane.shipmentId}
            </span>
            {!lane.isPending && lane.vessel && (
              <span style={{ fontSize: 13, color: MUTED }}>{lane.vessel}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{lane.meta}</div>
        </div>

        {/* Center: per-shipment gate position — ship floats above the active/blocked dot */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {/* Ship row — one aligned slot per gate; ship only appears at the active position */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 16 }}>
            {lane.gateStatuses.map((s, i) => (
              <div key={i} style={{ width: 10, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
                {(s === 'active' || s === 'blocked') && (
                  <span className="ewms-ship-bob-mini" style={{
                    fontSize: 12, lineHeight: 1,
                    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))',
                  }}>🚢</span>
                )}
              </div>
            ))}
          </div>
          {/* Dot row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {lane.gateStatuses.map((s, i) => <MiniGateDot key={i} status={s} />)}
          </div>
        </div>

        {/* Right: doc count + status + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span className="vs-mono" style={{ fontSize: 12, color: MUTED }}>{lane.docSummary} docs</span>
          <StatusPill status={lane.statusLabel} variant={lane.statusVariant} />
          {open
            ? <ChevronDown size={18} style={{ color: MUTED }} />
            : <ChevronRightIcon size={18} style={{ color: MUTED }} />}
        </div>
      </div>

      {/* ── Expanded body ── */}
      {open && (
        <div style={{ animation: 'fadeIn 0.15s ease' }}>
          {lane.isPending ? (
            /* Pending lane: Gate 1 + message box */
            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr' }}>
              <GateColPanel
                gate={lane.gates[0]}
                onNavigate={navigate}
              />
              <div style={{ padding: '24px 28px', display: 'flex', alignItems: 'flex-start' }}>
                <div style={{
                  backgroundColor: `${AMBER}10`,
                  border: `1px solid ${AMBER}40`,
                  borderRadius: 10, padding: '16px 20px',
                  flex: 1,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: AMBER, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={14} /> Waiting for Bill of Lading
                  </div>
                  <div style={{ fontSize: 12.5, color: FG, lineHeight: 1.6, marginBottom: 6 }}>
                    This shipment will be identified when a BOL is uploaded and matched to this invoice.
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>
                    BOL can be uploaded by the Freight Forwarder or India Logistics.
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate('/documents/upload'); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontSize: 12.5, fontWeight: 700, color: '#fff',
                      backgroundColor: TEAL, border: 'none', borderRadius: 7,
                      padding: '7px 16px', cursor: 'pointer',
                    }}
                  >
                    <UploadIcon size={12} /> Upload BOL →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Regular lane: 6-column grid (Gate 1-5 + Parallel) */
            <div
              className="grid grid-cols-2 md:grid-cols-3"
              style={{ display: 'grid' }}
            >
              {/* Hack: use inline grid-template-columns for xl behavior */}
              <style>{`
                @media (min-width: 1280px) {
                  .gate-grid-${lane.id} { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; }
                }
                @media (min-width: 768px) and (max-width: 1279px) {
                  .gate-grid-${lane.id} { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
                }
                @media (max-width: 767px) {
                  .gate-grid-${lane.id} { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
                }
              `}</style>
              <div
                className={`gate-grid-${lane.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                  gridColumn: '1 / -1',
                }}
              >
                {lane.gates.map((gate, i) => (
                  <GateColPanel key={i} gate={gate} onNavigate={navigate} />
                ))}
                <GateColPanel
                  gate={{
                    name: 'Parallel',
                    label: 'Financial / cost',
                    status: 'future',
                    docCount: `${lane.parallel.filter((d) => d.status === 'closed').length}/${lane.parallel.filter((d) => d.status !== 'na').length}`,
                    docs: lane.parallel,
                  }}
                  isParallel
                  onNavigate={navigate}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Gate Progress Strip (dynamic — computed from live lanes) ─────────────────
const GATE_LABELS = ['Initiation', 'India Exit', 'US Entry', '3PL', 'Delivery'];

function GateProgressStrip({ lanes }: { lanes: ShipmentLane[] }) {
  const total = lanes.length;

  const stripData = GATE_LABELS.map((label, i) => {
    const passed  = lanes.filter(l => l.gates[i]?.status === 'passed').length;
    const active  = lanes.filter(l => l.gates[i]?.status === 'active' || l.gates[i]?.status === 'blocked').length;
    const blocked = lanes.filter(l => l.gates[i]?.status === 'blocked').length;

    let overallStatus: GateStatus = 'future';
    if (total > 0) {
      if (blocked > 0) overallStatus = 'blocked';
      else if (active > 0) overallStatus = 'active';
      else if (passed === total) overallStatus = 'passed';
      else if (passed > 0) overallStatus = 'active';
    }

    const sub = total === 0
      ? '—'
      : blocked > 0
        ? `${blocked} blocked`
        : passed === total
          ? 'All shipments passed'
          : active > 0
            ? `${active} shipment${active > 1 ? 's' : ''} active`
            : `${passed} of ${total} passed`;

    return { name: `Gate ${i + 1}`, label, status: overallStatus, count: `${passed}/${total}`, sub };
  });

  const parallelUploaded = lanes.reduce((acc, l) => acc + l.parallel.filter(d => d.status === 'closed' || d.status === 'gen-closed').length, 0);
  const parallelTotal    = lanes.reduce((acc, l) => acc + l.parallel.filter(d => d.status !== 'na').length, 0);

  // Rightmost gate that is active or blocked — ship rides the line immediately before it.
  // If no gate is active yet (all future) shipGateIdx stays -1 (no ship shown).
  const shipGateIdx = stripData.reduce((best, g, i) =>
    (g.status === 'active' || g.status === 'blocked') ? i : best, -1);
  // Line index = gate-before the leading edge gate (ship on line between them).
  const shipLineIdx = shipGateIdx > 0 ? shipGateIdx - 1 : -1;
  // Edge case: leading gate is index 0 — no line before it, float ship above the circle.
  const gate0HasShip = shipGateIdx === 0;

  return (
    <div style={{
      backgroundColor: CARD_BG, borderRadius: 14,
      padding: '36px 24px 18px', boxShadow: 'var(--vs-shadow-card)',
      border: `1px solid ${BORDER}`, marginBottom: 20,
      overflow: 'visible',
    }}>
      {/* Keyframe animations */}
      <style>{`
        @keyframes ewmsShipBob {
          0%   { transform: translate(-50%, calc(-50% - 20px)) rotate(-5deg); }
          50%  { transform: translate(-50%, calc(-50% - 28px)) rotate(5deg); }
          100% { transform: translate(-50%, calc(-50% - 20px)) rotate(-5deg); }
        }
        @keyframes ewmsShipBobCircle {
          0%   { transform: translateX(-50%) translateY(-2px) rotate(-5deg); }
          50%  { transform: translateX(-50%) translateY(-8px) rotate(5deg); }
          100% { transform: translateX(-50%) translateY(-2px) rotate(-5deg); }
        }
        @keyframes ewmsShipBobMini {
          0%   { transform: translateY(0px) rotate(-4deg); }
          50%  { transform: translateY(-3px) rotate(4deg); }
          100% { transform: translateY(0px) rotate(-4deg); }
        }
        .ewms-ship-bob        { animation: ewmsShipBob 2.8s ease-in-out infinite; }
        .ewms-ship-bob-circle { animation: ewmsShipBobCircle 2.8s ease-in-out infinite; }
        .ewms-ship-bob-mini   { display: inline-block; animation: ewmsShipBobMini 2.8s ease-in-out infinite; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', overflow: 'visible' }}>
        {/* Gate blocks with connecting lines */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', overflow: 'visible' }}>
          {stripData.map((gate, i) => (
            <div key={gate.name} style={{ display: 'flex', alignItems: 'center', flex: i < stripData.length - 1 ? 'none' : 1, overflow: 'visible' }}>
              {/* Gate block */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80, position: 'relative', overflow: 'visible' }}>
                {/* Ship above gate-0 when it's the first active and has no line before it */}
                {i === 0 && gate0HasShip && (
                  <div className="ewms-ship-bob-circle" style={{
                    position: 'absolute', top: -34, left: '50%',
                    fontSize: 26, lineHeight: 1, pointerEvents: 'none',
                    filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.22))',
                  }}>
                    🚢
                  </div>
                )}
                <GateCircle status={gate.status} size={28} />
                <span style={{
                  fontSize: 9.5, fontWeight: 700, color: gate.status === 'future' ? MUTED : FG,
                  textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 6,
                }}>
                  {gate.label}
                </span>
                <span className="vs-mono" style={{
                  fontSize: 12.5, fontWeight: 700,
                  color: gate.status === 'future' ? MUTED : gate.status === 'active' ? TEAL : gate.status === 'blocked' ? RED : GREEN,
                  marginTop: 2,
                }}>
                  {gate.count}
                </span>
                <span style={{ fontSize: 9.5, color: MUTED, marginTop: 1, textAlign: 'center', maxWidth: 70 }}>
                  {gate.sub}
                </span>
              </div>
              {/* Connecting line — ship appears on the line just before the leading-edge active gate */}
              {i < stripData.length - 1 && (
                <GateLine from={gate.status} to={stripData[i + 1].status} hasShip={i === shipLineIdx} />
              )}
            </div>
          ))}
        </div>

        {/* Parallel column indicator */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingLeft: 20, marginLeft: 16,
          borderLeft: `1px solid ${BORDER}`,
          minWidth: 72,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            backgroundColor: 'hsl(var(--muted) / 0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 10, color: MUTED }}>∥</span>
          </div>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 6 }}>
            Parallel
          </span>
          <span className="vs-mono" style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, marginTop: 2 }}>
            {parallelUploaded}/{parallelTotal}
          </span>
          <span style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>
            {parallelTotal > 0 ? `${parallelTotal} types` : 'No docs'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Map API documentType to generate-page route slug ────────────────────────
function docTypeToGenSlug(documentType: string): string | undefined {
  const t = documentType.toUpperCase();
  if ((t === 'PL' || t.includes('PACKING_LIST') || t === 'PACKING-LIST') && !t.includes('OUTWARD'))
    return 'packing-list';
  if (t.includes('OUTWARD') || t === 'OP')
    return 'outward-pl';
  if (t === 'DRAFT-BOE' || (t.includes('BOE') && t.includes('DRAFT')) || t.startsWith('DRAFT_BOE'))
    return 'draft-boe';
  return undefined;
}

// ─── API → ShipmentLane mapping ───────────────────────────────────────────────
interface ApiDoc {
  id: string; documentType: string; documentNumber?: string;
  ocrStatus?: string; validationStatus?: string;
  approvedAt: string | null; isGenerated: boolean;
}
interface ApiShipment {
  id: string; shipmentNumber: string; status: string;
  blockedReason?: string; currentStage: number; currentStageName?: string;
  vesselName?: string; portOfLoading?: string; portOfDischarge?: string;
  exporterName?: string; buyerName?: string;
  documents: ApiDoc[];
  _count: { documents: number };
}

interface ApiUploadedDocument {
  id: string;
  docType?: string;
  documentType?: string;
  documentNumber?: string;
  fileName?: string;
  status?: string;
  ocrStatus?: string;
  validationStatus?: string;
  approvedAt?: string | null;
  isGenerated?: boolean;
  createdAt?: string;
  shipment?: {
    id?: string;
    shipmentNumber?: string;
    vesselName?: string;
    portOfLoading?: string;
    portOfDischarge?: string;
    exporterName?: string;
    buyerName?: string;
  } | null;
}

function payloadData<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data;
  }
  return [];
}

async function fetchFirstOk<T>(paths: string[], headers: HeadersInit): Promise<T[]> {
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      const response = await fetch(path, { headers });
      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${path}`;
        continue;
      }
      const payload = await response.json().catch(() => []);
      return payloadData<T>(payload);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('No API endpoint responded');
}

function uploadedDocToApiDoc(doc: ApiUploadedDocument): ApiDoc {
  const status = doc.ocrStatus ?? doc.status ?? 'UPLOADED';
  const approvedAt = doc.approvedAt ?? (String(status).toUpperCase() === 'REVIEWED' ? doc.createdAt ?? null : null);
  return {
    id: doc.id,
    documentType: doc.documentType ?? doc.docType ?? 'DOCUMENT',
    documentNumber: doc.documentNumber ?? doc.fileName,
    ocrStatus: status,
    validationStatus: doc.validationStatus ?? (String(status).toUpperCase() === 'REJECTED' ? 'FAILED' : 'PASSED'),
    approvedAt,
    isGenerated: !!doc.isGenerated,
  };
}

function uploadedDocumentsToLanes(docs: ApiUploadedDocument[]): ShipmentLane[] {
  if (docs.length === 0) return [];

  const groups = new Map<string, { shipment?: ApiUploadedDocument['shipment']; docs: ApiUploadedDocument[] }>();
  for (const doc of docs) {
    const shipment = doc.shipment ?? null;
    const key = shipment?.id ?? shipment?.shipmentNumber ?? 'unassigned-documents';
    const group = groups.get(key) ?? { shipment: shipment ?? undefined, docs: [] };
    group.docs.push(doc);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group], index) => {
    const shipment = group.shipment;
    const shipmentDocs = group.docs.map(uploadedDocToApiDoc);
    return shipmentToLane({
      id: shipment?.id ?? key,
      shipmentNumber: shipment?.shipmentNumber ?? (key === 'unassigned-documents' ? 'Unassigned documents' : key),
      status: 'ACTIVE',
      currentStage: Math.min(5, Math.max(1, index + 1)),
      currentStageName: key === 'unassigned-documents' ? 'Documents uploaded' : undefined,
      vesselName: shipment?.vesselName ?? 'Documents',
      portOfLoading: shipment?.portOfLoading ?? 'Uploaded',
      portOfDischarge: shipment?.portOfDischarge ?? 'Review',
      exporterName: shipment?.exporterName ?? 'Document intake',
      buyerName: shipment?.buyerName ?? 'EWMS',
      documents: shipmentDocs,
      _count: { documents: shipmentDocs.length },
    });
  });
}

function apiDocStatus(d: ApiDoc): DocStatus {
  // Approved takes highest priority
  if (d.approvedAt && d.isGenerated) return 'gen-closed';
  if (d.approvedAt) return 'closed';
  // Failure states
  const ocr = d.ocrStatus?.toUpperCase() ?? '';
  const val = d.validationStatus?.toUpperCase() ?? '';
  if (ocr === 'FAILED' || val === 'FAILED') return 'failed-block';
  if (val === 'FLAGGED') return 'failed-warn';
  // Generated but not yet approved = awaiting review
  if (d.isGenerated) return 'gen-review';
  // Non-generated: OCR completed but not approved = in review / processing
  return 'processing';
}

function docTypeToGate(dt: string): { gate: number; code: string; label: string } | null {
  const t = dt.toUpperCase();
  if (t === 'SI' || t.includes('SALES_INVOICE')) return { gate: 1, code: 'SI', label: 'Sales Invoice' };
  if ((t === 'PL' || t.includes('PACKING_LIST') || t === 'PACKING-LIST') && !t.includes('OUTWARD')) return { gate: 1, code: 'PL', label: 'Packing List' };
  if (t === 'SB' || t.includes('SHIPPING_BILL')) return { gate: 1, code: 'SB', label: 'Shipping Bill' };
  if (t === 'BOL' || t === 'BL' || t.includes('BILL_OF_LADING')) return { gate: 2, code: 'BL', label: 'Bill of Lading' };
  if (t === 'DRAFT-BOE' || (t.includes('BOE') && t.includes('DRAFT')) || t.startsWith('DRAFT_BOE')) return { gate: 2, code: 'BE', label: 'Draft BoE' };
  if (t === 'ISF' || t.includes('IMPORTER_SECURITY')) return { gate: 3, code: 'IS', label: 'ISF' };
  if ((t === 'BOE' || t.includes('BILL_OF_ENTRY')) && !t.includes('DRAFT')) return { gate: 3, code: 'BE', label: 'Bill of Entry' };
  if (t === 'CRO' || t.includes('CARGO_RELEASE') || t.includes('US_CARGO')) return { gate: 3, code: 'CR', label: 'Cargo Release' };
  if (t.includes('CUSTOMS_RELEASE') || t.includes('US_CUSTOMS')) return { gate: 3, code: 'UC', label: 'Customs Release' };
  if (t === 'DO' || t.includes('DELIVERY_ORDER')) return { gate: 4, code: 'DO', label: 'Delivery Order' };
  if (t === 'GR' || t.includes('GRN') || t.includes('GOODS_RECEIPT')) return { gate: 4, code: 'GR', label: 'Goods Receipt' };
  if (t === 'OP' || t.includes('OUTWARD')) return { gate: 5, code: 'OP', label: 'Outward PL' };
  if (t.includes('POD') || t.includes('PROOF_OF_DELIVERY')) return { gate: 5, code: 'PD', label: 'Proof of Delivery' };
  return null;
}

const GATE_DEFS = [
  { name: 'gate1', label: 'Initiation', required: [{ code: 'SI', label: 'Sales Invoice' }, { code: 'PL', label: 'Packing List' }, { code: 'SB', label: 'Shipping Bill' }] },
  { name: 'gate2', label: 'India Exit',  required: [{ code: 'BL', label: 'Bill of Lading' }, { code: 'BE', label: 'Draft BoE' }] },
  { name: 'gate3', label: 'US Entry',    required: [{ code: 'IS', label: 'ISF' }, { code: 'BE', label: 'Bill of Entry' }, { code: 'CR', label: 'Cargo Release' }] },
  { name: 'gate4', label: '3PL',         required: [{ code: 'DO', label: 'Delivery Order' }, { code: 'GR', label: 'Goods Receipt' }] },
  { name: 'gate5', label: 'Delivery',    required: [{ code: 'OP', label: 'Outward PL' }, { code: 'PD', label: 'Proof of Delivery' }] },
];

function shipmentToLane(s: ApiShipment): ShipmentLane {
  // Map API currentStage (1-10+) to 5-gate progression (1-5)
  // Stage mapping: 1-2 = gate1, 3-4 = gate2, 5-6 = gate3, 7-8 = gate4, 9-10 = gate5
  const rawStage = s.currentStage ?? 1;
  const stage = rawStage <= 2 ? 1
              : rawStage <= 4 ? 2
              : rawStage <= 6 ? 3
              : rawStage <= 8 ? 4
              : 5;

  const blocked = !!s.blockedReason;
  const gateStatuses: GateStatus[] = GATE_DEFS.map((_, i) => {
    const gn = i + 1;
    if (gn < stage) return 'passed';
    if (gn === stage) return blocked ? 'blocked' : 'active';
    return 'future';
  });

  // BOL gating: detect whether a BOL has been uploaded and whether PL is approved
  const bolPresent = (s.documents ?? []).some(d => {
    const t = d.documentType.toUpperCase();
    return t === 'BOL' || t === 'BL' || t.includes('BILL_OF_LADING');
  });
  const plApproved = (s.documents ?? []).some(d => {
    const t = d.documentType.toUpperCase();
    return (t === 'PL' || t.includes('PACKING_LIST')) && !t.includes('OUTWARD') && !!d.approvedAt;
  });

  // Track which gates have ALL generated docs gated (waiting for prerequisites)
  const gatesAllDocsGated = new Set<number>();
  const gateGeneratedGatedCount = new Map<number, number>();
  const gateGeneratedTotalCount = new Map<number, number>();

  const gateDocsMap = new Map<number, DocEntry[]>([[1, []], [2, []], [3, []], [4, []], [5, []]]);
  for (const d of (s.documents ?? [])) {
    const g = docTypeToGate(d.documentType);
    if (g) {
      let entry: DocEntry = {
        code: g.code, label: g.label,
        status: apiDocStatus(d),
        docNumber: d.documentNumber ?? undefined,
        docId: d.id,
        genType: d.isGenerated ? docTypeToGenSlug(d.documentType) : undefined,
      };
      // Gate generated docs behind their prerequisites
      if (d.isGenerated) {
        const t = d.documentType.toUpperCase();
        const isPL       = (t === 'PL' || t.includes('PACKING_LIST')) && !t.includes('OUTWARD');
        const isOutward  = t.includes('OUTWARD') || t === 'OP';
        const isDraftBOE = t === 'DRAFT-BOE' || (t.includes('BOE') && t.includes('DRAFT')) || t.startsWith('DRAFT_BOE');
        let gated = false;
        if (isPL && !bolPresent) {
          entry = { ...entry, status: 'expected', docNumber: 'Waiting for BOL' };
          gated = true;
        } else if (isDraftBOE && !plApproved) {
          entry = { ...entry, status: 'expected', docNumber: 'Waiting for PL approval' };
          gated = true;
        } else if (isOutward && (!bolPresent || !plApproved)) {
          entry = { ...entry, status: 'expected', docNumber: !bolPresent ? 'Waiting for BOL' : 'Waiting for PL approval' };
          gated = true;
        }
        gateGeneratedTotalCount.set(g.gate, (gateGeneratedTotalCount.get(g.gate) ?? 0) + 1);
        if (gated) {
          gateGeneratedGatedCount.set(g.gate, (gateGeneratedGatedCount.get(g.gate) ?? 0) + 1);
        }
      }
      gateDocsMap.get(g.gate)!.push(entry);
    }
  }

  // Mark gates where ALL generated docs are gated (prerequisites unmet)
  for (const [gateNum, total] of gateGeneratedTotalCount) {
    if ((gateGeneratedGatedCount.get(gateNum) ?? 0) >= total) {
      gatesAllDocsGated.add(gateNum);
    }
  }

  const gates: GateCol[] = GATE_DEFS.map((def, i) => {
    const gateNum  = i + 1;
    const realDocs = gateDocsMap.get(gateNum) ?? [];
    const seenCodes = new Set(realDocs.map(d => d.code));
    const merged: DocEntry[] = [
      ...realDocs,
      ...def.required.filter(r => !seenCodes.has(r.code)).map(r => ({ code: r.code, label: r.label, status: 'expected' as DocStatus })),
    ];
    const closed = merged.filter(d => d.status === 'closed' || d.status === 'gen-closed').length;
    let effectiveStatus = gateStatuses[i];
    if (gatesAllDocsGated.has(gateNum) && effectiveStatus !== 'future') {
      const hasNonGatedDoc = merged.some(d => d.status !== 'expected');
      if (!hasNonGatedDoc) effectiveStatus = 'future';
    }
    return { name: def.name, label: def.label, status: effectiveStatus, docCount: `${closed}/${merged.length}`, docs: merged };
  });

  const totalDocs = s._count?.documents ?? 0;
  const closedDocs = (s.documents ?? []).filter(d => d.approvedAt).length;
  let statusLabel = s.currentStageName ?? `Gate ${stage} active`;
  let statusVariant: ShipmentLane['statusVariant'] = 'info';
  if (blocked) { statusLabel = 'Blocked'; statusVariant = 'danger'; }
  else if (gateStatuses.every(g => g === 'passed')) { statusLabel = 'Delivered'; statusVariant = 'cleared'; }
  else if (stage === 1 && totalDocs === 0) { statusLabel = 'Pending'; statusVariant = 'pending'; }

  const finalGateStatuses: GateStatus[] = gates.map(g => g.status);

  return {
    id: s.id,
    shipmentId: s.shipmentNumber,
    vessel: `${s.vesselName ?? 'Vessel TBD'} · ${s.portOfLoading ?? 'India'} → ${s.portOfDischarge ?? 'US'}`,
    meta: `${s.exporterName ?? 'Exporter'} → ${s.buyerName ?? 'Buyer'}${totalDocs ? ` · ${totalDocs} docs` : ''}`,
    gateStatuses: finalGateStatuses,
    docSummary: `${closedDocs}/${totalDocs}`,
    statusLabel,
    statusVariant,
    gates,
    parallel: [],
  };
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function makeGate(name: string, label: string, status: GateStatus, docs: DocEntry[]): GateCol {
  const closed = docs.filter((d) => d.status === 'closed' || d.status === 'gen-closed').length;
  return { name, label, status, docCount: `${closed}/${docs.length}`, docs };
}

function expectedDocs(items: ReadonlyArray<{ code: string; label: string }>): DocEntry[] {
  return items.map((item) => ({ ...item, status: 'expected' as DocStatus }));
}

function closedDocs(items: ReadonlyArray<{ code: string; label: string }>, prefix: string): DocEntry[] {
  return items.map((item, index) => ({
    ...item,
    status: 'closed' as DocStatus,
    docNumber: `${prefix}-${String(index + 1).padStart(3, '0')}`,
  }));
}

const REQUIRED_GATE_DOCS = [
  [{ code: 'SI', label: 'Sales Invoice' }, { code: 'PL', label: 'Packing List' }, { code: 'SB', label: 'Shipping Bill' }],
  [{ code: 'BL', label: 'Bill of Lading' }, { code: 'BE', label: 'Draft BoE' }],
  [{ code: 'IS', label: 'ISF' }, { code: 'BE', label: 'Bill of Entry' }, { code: 'CR', label: 'Cargo Release' }],
  [{ code: 'DO', label: 'Delivery Order' }, { code: 'GR', label: 'Goods Receipt' }],
  [{ code: 'OP', label: 'Outward PL' }, { code: 'PD', label: 'Proof of Delivery' }],
] as const;

function makeMockLane(params: {
  id: string;
  vessel: string;
  meta: string;
  gateStatuses: GateStatus[];
  docSummary: string;
  statusLabel: string;
  statusVariant: ShipmentLane['statusVariant'];
  closedGateCount?: number;
  blockedGate?: number;
}): ShipmentLane {
  const gates = GATE_LABELS.map((label, index) => {
    const gateNumber = index + 1;
    const status = params.gateStatuses[index] ?? 'future';
    const requiredDocs = REQUIRED_GATE_DOCS[index];
    const docs = params.blockedGate === gateNumber
      ? requiredDocs.map((doc, docIndex) => ({
          ...doc,
          status: docIndex === 0 ? 'failed-block' as DocStatus : 'expected' as DocStatus,
          ruleCode: docIndex === 0 ? `G${gateNumber}-BLOCK` : undefined,
        }))
      : gateNumber <= (params.closedGateCount ?? 0)
        ? closedDocs(requiredDocs, params.id.replace('ZTW-2025-', 'DOC'))
        : expectedDocs(requiredDocs);

    return makeGate(`gate${gateNumber}`, label, status, docs);
  });

  return {
    id: params.id,
    shipmentId: params.id,
    vessel: params.vessel,
    meta: params.meta,
    gateStatuses: params.gateStatuses,
    docSummary: params.docSummary,
    statusLabel: params.statusLabel,
    statusVariant: params.statusVariant,
    gates,
    parallel: [],
  };
}

const DEFAULT_DOCUMENT_LANES: ShipmentLane[] = [
  makeMockLane({
    id: 'ZTW-2025-0419',
    vessel: 'CMA CGM Antoine de Saint Exupery · Mundra → Savannah',
    meta: 'Zetwerk Mfg → Samuel, Son & Co.',
    gateStatuses: ['passed', 'active', 'future', 'future', 'future'],
    docSummary: '0/0',
    statusLabel: 'At India port',
    statusVariant: 'info',
  }),
  makeMockLane({
    id: 'ZTW-2025-0422',
    vessel: 'Yang Ming Witness · Nhava Sheva → Chicago (via rail)',
    meta: 'Zetwerk Mfg → Olympic Steel',
    gateStatuses: ['passed', 'passed', 'passed', 'passed', 'passed'],
    docSummary: '8/8',
    statusLabel: 'Delivered',
    statusVariant: 'cleared',
    closedGateCount: 5,
  }),
  makeMockLane({
    id: 'ZTW-2025-0428',
    vessel: 'COSCO Shipping Universe · Nhava Sheva → Los Angeles',
    meta: 'Zetwerk Mfg → Worthington Industries',
    gateStatuses: ['passed', 'passed', 'passed', 'passed', 'active'],
    docSummary: '0/0',
    statusLabel: '3PL inward',
    statusVariant: 'info',
    closedGateCount: 4,
  }),
  makeMockLane({
    id: 'ZTW-2025-0431',
    vessel: 'Evergreen Ever Ace · Mundra → New Orleans',
    meta: 'Zetwerk Mfg → Commercial Metals',
    gateStatuses: ['active', 'future', 'future', 'future', 'future'],
    docSummary: '0/0',
    statusLabel: 'Pending',
    statusVariant: 'pending',
  }),
  makeMockLane({
    id: 'ZTW-2025-0435',
    vessel: 'MSC Gülsün · Nhava Sheva → Baltimore',
    meta: 'Zetwerk Mfg → Metals USA',
    gateStatuses: ['passed', 'passed', 'passed', 'future', 'active'],
    docSummary: '0/0',
    statusLabel: 'At US port',
    statusVariant: 'info',
    closedGateCount: 3,
  }),
  makeMockLane({
    id: 'ZTW-2025-0438',
    vessel: 'Maersk Eindhoven · Mundra → Houston',
    meta: 'Zetwerk Mfg → Steel Technologies',
    gateStatuses: ['passed', 'passed', 'passed', 'blocked', 'future'],
    docSummary: '0/0',
    statusLabel: 'Blocked',
    statusVariant: 'danger',
    closedGateCount: 3,
    blockedGate: 4,
  }),
  makeMockLane({
    id: 'ZTW-2025-0441',
    vessel: 'OOCL Hamburg · Nhava Sheva → Los Angeles',
    meta: 'Zetwerk Mfg → Nucor Steel',
    gateStatuses: ['passed', 'passed', 'active', 'future', 'future'],
    docSummary: '0/0',
    statusLabel: 'Ocean transit',
    statusVariant: 'info',
    closedGateCount: 2,
  }),
];

function LaneSkeleton() {
  return (
    <div style={{
      backgroundColor: CARD_BG, borderRadius: 12, overflow: 'hidden',
      border: `1px solid ${BORDER}`, boxShadow: 'var(--vs-shadow-card)',
      marginBottom: 10, padding: '14px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 14, width: 180, borderRadius: 4, backgroundColor: 'hsl(var(--muted) / 0.5)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 11, width: 260, borderRadius: 4, backgroundColor: 'hsl(var(--muted) / 0.35)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0,1,2,3,4].map(i => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'hsl(var(--muted) / 0.35)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
        <div style={{ height: 24, width: 90, borderRadius: 12, backgroundColor: 'hsl(var(--muted) / 0.35)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function DocumentsPage() {
  const [, navigate]   = useLocation();
  const [filterChip, setFilterChip] = useState(0);
  const [search,     setSearch]     = useState('');
  const [openLanes,  setOpenLanes]  = useState<Set<string>>(new Set([DEFAULT_DOCUMENT_LANES[0].id]));
  const [lanes,      setLanes]      = useState<ShipmentLane[]>(DEFAULT_DOCUMENT_LANES);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    setLoading(lanes.length === 0);
    setError(null);

    fetchFirstOk<ApiShipment>(['/api/shipments', '/api/v1/shipments'], headers)
      .then((shipments) => shipments.map(shipmentToLane))
      .catch(() => (
        fetchFirstOk<ApiUploadedDocument>(
          ['/api/documents', '/api/uploads/documents', '/api/v1/uploads/documents'],
          headers,
        ).then(uploadedDocumentsToLanes)
      ))
      .then((live) => {
        if (live.length > 0) {
          setLanes(live);
          setOpenLanes(new Set([live[0].id]));
        }
      })
      .catch((err) => {
        console.warn('[DocumentsPage] Using default document lanes:', err);
        setLanes(DEFAULT_DOCUMENT_LANES);
        setOpenLanes(new Set([DEFAULT_DOCUMENT_LANES[0].id]));
        setError(null);
      })
      .finally(() => setLoading(false));
  }, [lanes.length]);

  function toggleLane(id: string) {
    setOpenLanes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Dynamic filter counts derived from real lanes
  const allCount     = lanes.length;
  const activeCount  = lanes.filter(l => !l.isPending && l.gates.some(g => g.status === 'active' || g.status === 'blocked')).length;
  const pendingCount = lanes.filter(l => l.isPending || (l.gateStatuses[0] === 'active' && !l.gates[0]?.docs.some(d => d.status !== 'expected'))).length;
  const completeCount = lanes.filter(l => l.gateStatuses.every(s => s === 'passed')).length;

  // Filter lanes by chip
  const chipFiltered = (() => {
    switch (filterChip) {
      case 1: return lanes.filter(l => !l.isPending && l.gates.some(g => g.status === 'active' || g.status === 'blocked'));
      case 2: return lanes.filter(l => l.isPending || l.statusLabel === 'Pending');
      case 3: return lanes.filter(l => l.gateStatuses.every(s => s === 'passed'));
      default: return lanes;
    }
  })();

  // Filter by search
  const q = search.toLowerCase().trim();
  const filteredLanes = q
    ? chipFiltered.filter(l =>
        l.shipmentId.toLowerCase().includes(q) ||
        l.vessel.toLowerCase().includes(q) ||
        l.meta.toLowerCase().includes(q),
      )
    : chipFiltered;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 'none' }}>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeIn  { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse   { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      <PageHeader
        title="Shipment Documents"
        subtitle="Document completion by shipment · 5 gates · India → US corridor"
        actions={
          <>
            <button
              onClick={() => navigate('/documents/upload')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: 600, color: '#fff',
                backgroundColor: TEAL, border: 'none', borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer',
              }}
            >
              <UploadIcon size={13} /> Upload document
            </button>
            <button
              style={{
                fontSize: 13, fontWeight: 500, color: FG,
                backgroundColor: 'transparent',
                border: `1px solid ${BORDER}`, borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer',
              }}
            >
              Export status
            </button>
          </>
        }
      />

      {/* Section 2: Gate progress strip — dynamic */}
      <GateProgressStrip lanes={lanes} />

      {/* Section 3: Filter + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <FilterChips
          chips={[
            { label: 'All shipments', count: allCount },
            { label: 'Active gate',   count: activeCount },
            { label: 'Pending BOL',   count: pendingCount },
            { label: 'Complete',      count: completeCount },
          ]}
          activeIndex={filterChip}
          onSelect={setFilterChip}
        />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: '6px 12px', backgroundColor: CARD_BG,
          flex: 1, maxWidth: 320,
        }}>
          <Search size={13} style={{ color: MUTED, flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by shipment, BOL, vessel..."
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 12.5, color: FG, backgroundColor: 'transparent',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <span style={{ fontSize: 12, color: MUTED }}>✕</span>
            </button>
          )}
        </div>
      </div>

      {/* Section 4: Shipment lane accordions */}
      {loading ? (
        <>
          <LaneSkeleton />
          <LaneSkeleton />
          <LaneSkeleton />
        </>
      ) : error ? (
        <div style={{
          backgroundColor: CARD_BG, borderRadius: 12,
          border: `1px solid ${BORDER}`, padding: '40px 24px',
          textAlign: 'center',
        }}>
          <AlertCircle size={20} style={{ color: RED, marginBottom: 8 }} />
          <div style={{ fontSize: 13.5, color: RED }}>{error}</div>
        </div>
      ) : filteredLanes.length === 0 ? (
        <div style={{
          backgroundColor: CARD_BG, borderRadius: 12,
          border: `1px solid ${BORDER}`, padding: '40px 24px',
          textAlign: 'center',
        }}>
          <CircleDot size={20} style={{ color: MUTED, marginBottom: 8 }} />
          <div style={{ fontSize: 13.5, color: MUTED }}>
            {lanes.length === 0 ? 'No shipments found.' : 'No shipments match this filter.'}
          </div>
        </div>
      ) : (
        filteredLanes.map((lane) => (
          <ShipmentAccordion
            key={lane.id}
            lane={lane}
            open={openLanes.has(lane.id)}
            onToggle={() => toggleLane(lane.id)}
          />
        ))
      )}
    </div>
  );
}
