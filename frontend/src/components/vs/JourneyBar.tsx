import React from 'react';

export type JourneyPhaseStatus = 'done' | 'current' | 'future';

export interface JourneyPhase {
  phaseNumber: number;
  phaseName: string;
  phaseLocation?: string;
  phaseStatus: JourneyPhaseStatus;
  occurredAt?: string;
  phaseNote?: string;
}

interface JourneyBarProps {
  phases: JourneyPhase[];
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function JourneyBar({ phases }: JourneyBarProps) {
  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 12,
      padding: '20px 24px 18px',
      marginBottom: 12,
    }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>

        {phases.map((phase, i) => {
          const isDone    = phase.phaseStatus === 'done';
          const isCurrent = phase.phaseStatus === 'current';
          const isFuture  = phase.phaseStatus === 'future';
          const isLast    = i === phases.length - 1;

          const nodeBg = isDone
            ? 'hsl(var(--primary))'
            : isCurrent
            ? 'hsl(var(--primary))'
            : 'hsl(var(--muted))';

          const nodeColor = isDone || isCurrent ? '#fff' : 'hsl(var(--muted-foreground))';

          const lineColor = isDone ? 'hsl(var(--primary))' : 'hsl(var(--border))';
          const lineDash  = isFuture ? '4 4' : undefined;

          return (
            <React.Fragment key={phase.phaseNumber}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: isLast ? 'none' : 1, position: 'relative', minWidth: 80 }}>

                {/* Connector line to the right (skip for last node) */}
                {!isLast && (
                  <svg
                    style={{
                      position: 'absolute',
                      top: 16,
                      left: '50%',
                      width: '100%',
                      height: 2,
                      overflow: 'visible',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                    preserveAspectRatio="none"
                  >
                    <line
                      x1="0" y1="1" x2="100%" y2="1"
                      stroke={lineColor}
                      strokeWidth="2"
                      strokeDasharray={
                        /* done→done: solid; done→current: solid; current→future or future→future: dashed */
                        (() => {
                          const next = phases[i + 1];
                          if (isDone) return undefined;
                          if (isCurrent && next?.phaseStatus === 'future') return '4 4';
                          return '4 4';
                        })()
                      }
                    />
                  </svg>
                )}

                {/* Node circle */}
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: nodeBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: nodeColor,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                  position: 'relative',
                  zIndex: 1,
                  boxShadow: isCurrent
                    ? '0 0 0 4px hsl(var(--primary) / 0.15), 0 0 0 8px hsl(var(--primary) / 0.07)'
                    : undefined,
                  flexShrink: 0,
                }}>
                  {isDone ? <CheckIcon /> : phase.phaseNumber}
                </div>

                {/* Labels */}
                <div style={{ marginTop: 8, textAlign: 'center', paddingInline: 4 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: isCurrent ? 600 : 500,
                    color: isFuture ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                  }}>
                    {phase.phaseName}
                  </div>
                  {(phase.phaseLocation || phase.occurredAt) && (
                    <div style={{
                      fontSize: 11,
                      color: isCurrent ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                      fontWeight: isCurrent ? 500 : 400,
                      marginTop: 2,
                      fontFamily: 'JetBrains Mono, monospace',
                      whiteSpace: 'nowrap',
                    }}>
                      {[phase.phaseLocation, phase.occurredAt].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
