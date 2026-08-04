interface StatusChipProps {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
  warn?: boolean;
}

function StatusChip({ label, value, highlight, warn }: StatusChipProps) {
  const bg = warn
    ? 'hsl(38 92% 95%)'
    : highlight
    ? 'hsl(var(--primary) / 0.08)'
    : 'hsl(var(--muted) / 0.6)';

  const border = warn
    ? 'hsl(38 92% 80%)'
    : highlight
    ? 'hsl(var(--primary) / 0.25)'
    : 'hsl(var(--border))';

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      borderRadius: 8,
      background: bg,
      border: `1px solid ${border}`,
      fontSize: 14,
      lineHeight: 1,
      flexShrink: 0,
    }}>
      <span style={{ color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>{label}</span>
      <span style={{
        color: warn ? 'hsl(38 60% 35%)' : 'hsl(var(--foreground))',
        fontWeight: 600,
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        {value}
      </span>
    </div>
  );
}

export interface ShipmentStatusChipsData {
  loadMode: string;
  containerCount: number;
  containerSize: string;
  nextGateLocation: string;
  nextGateDate: string;
  daysAtSea: number;
  departureName: string;
  docsValidated: number;
  docsTotal: number;
  usSidePending: number;
  tradeLane: string;
  incoterm: string;
  incotermPort: string;
}

interface ShipmentStatusChipsProps {
  data: ShipmentStatusChipsData;
}

import React from 'react';

export function ShipmentStatusChips({ data }: ShipmentStatusChipsProps) {
  const {
    loadMode, containerCount, containerSize,
    nextGateLocation, nextGateDate,
    daysAtSea, departureName,
    docsValidated, docsTotal, usSidePending,
    tradeLane, incoterm, incotermPort,
  } = data;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 20,
    }}>
      <StatusChip
        label="Load mode"
        value={<>{loadMode} · container · {containerCount}×{containerSize}</>}
      />
      <StatusChip
        label="Next gate"
        value={<>{nextGateLocation} · {nextGateDate}</>}
        highlight
      />
      <StatusChip
        label="At sea"
        value={<>~{daysAtSea} days (since {departureName})</>}
      />
      <StatusChip
        label="Doc pack"
        value={<>{docsValidated}/{docsTotal} · {usSidePending} US-side pending</>}
        warn={usSidePending > 0}
      />
      <StatusChip
        label="Lane"
        value={<>{tradeLane} · {incoterm} {incotermPort}</>}
      />
    </div>
  );
}
