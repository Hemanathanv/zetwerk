import { Anchor } from 'lucide-react';

export function EwmsShipLoader({
  compact = false,
  fullPage = false,
}: {
  compact?: boolean;
  fullPage?: boolean;
}) {
  const width = fullPage ? 680 : compact ? 300 : 520;
  const height = fullPage ? 250 : compact ? 138 : 188;

  return (
    <div
      style={{
        minHeight: fullPage ? '100vh' : undefined,
        width: fullPage ? '100vw' : undefined,
        padding: fullPage ? '40px 20px' : compact ? '22px 14px' : '44px 32px 52px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: fullPage ? 'center' : undefined,
        gap: compact ? 10 : 14,
        background: fullPage
          ? 'linear-gradient(180deg, hsl(205 42% 96%) 0%, hsl(200 48% 90%) 38%, hsl(196 62% 72%) 39%, hsl(199 70% 42%) 100%)'
          : undefined,
      }}
    >
      <style>{`
        @keyframes ewms-cargo-cross {
          0% { left: 17%; transform: translateX(-50%) translateY(1px); }
          25% { transform: translateX(-50%) translateY(-2px); }
          50% { transform: translateX(-50%) translateY(1px); }
          75% { transform: translateX(-50%) translateY(-2px); }
          100% { left: 83%; transform: translateX(-50%) translateY(1px); }
        }
        @keyframes ewms-sea-a {
          from { transform: translateX(-36px); }
          to { transform: translateX(36px); }
        }
        @keyframes ewms-sea-b {
          from { transform: translateX(28px); }
          to { transform: translateX(-28px); }
        }
        @keyframes ewms-route-flow {
          from { background-position: 0 0; }
          to { background-position: 78px 0; }
        }
        @keyframes ewms-beacon {
          0%, 100% { opacity: .38; transform: scale(.86); }
          50% { opacity: .95; transform: scale(1); }
        }
        @keyframes ewms-smoke {
          0% { transform: translate(0, 0) scale(.72); opacity: .28; }
          60% { opacity: .18; }
          100% { transform: translate(-14px, -18px) scale(1.22); opacity: 0; }
        }
        @keyframes ewms-status {
          0%, 100% { opacity: .72; }
          50% { opacity: 1; }
        }
      `}</style>

      <div
        style={{
          width,
          maxWidth: fullPage ? 'min(92vw, 680px)' : '88vw',
          height,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: fullPage ? 8 : 14,
          border: fullPage ? '1px solid hsla(188,58%,32%,.16)' : '1px solid hsla(188,58%,32%,.22)',
          background:
            fullPage
              ? 'linear-gradient(180deg, hsl(205 46% 94%) 0%, hsl(202 54% 86%) 42%, hsl(197 63% 58%) 43%, hsl(200 70% 36%) 100%)'
              : 'linear-gradient(180deg, hsl(205 34% 92%) 0%, hsl(202 42% 86%) 43%, hsl(198 58% 58%) 44%, hsl(200 66% 39%) 100%)',
          boxShadow: fullPage
            ? '0 30px 80px hsla(205,54%,24%,.18), inset 0 1px 0 rgba(255,255,255,.86)'
            : '0 22px 52px hsla(205,54%,24%,.14), inset 0 1px 0 rgba(255,255,255,.82)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 12% 21%, rgba(255,255,255,.52) 0 22px, transparent 23px), radial-gradient(circle at 70% 17%, rgba(255,255,255,.35) 0 34px, transparent 35px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: compact ? 60 : 84,
            height: 1,
            background: 'linear-gradient(90deg, transparent, hsla(188,58%,32%,.28), transparent)',
          }}
        />

        <PortMarker label="INDIA" side="left" compact={compact} />
        <PortMarker label="USA" side="right" compact={compact} />

        <div
          style={{
            position: 'absolute',
            left: compact ? 54 : 82,
            right: compact ? 54 : 82,
            top: compact ? 74 : 104,
            height: 2,
            borderRadius: 999,
            backgroundImage: 'linear-gradient(90deg, hsla(173,58%,39%,.68) 0 14px, transparent 14px 26px)',
            backgroundSize: '52px 2px',
            animation: 'ewms-route-flow 1.8s linear infinite',
          }}
        />

        <CargoShip compact={compact} />

        <div
          style={{
            position: 'absolute',
            left: -34,
            right: -34,
            bottom: compact ? 23 : 31,
            height: compact ? 15 : 20,
            background: 'repeating-radial-gradient(ellipse at center, hsla(185,42%,88%,.42) 0 5px, transparent 6px 18px)',
            animation: 'ewms-sea-a 1.25s linear infinite alternate',
            opacity: .78,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: -26,
            right: -26,
            bottom: compact ? 9 : 12,
            height: compact ? 12 : 16,
            background: 'repeating-radial-gradient(ellipse at center, hsla(202,64%,24%,.34) 0 5px, transparent 6px 20px)',
            animation: 'ewms-sea-b 1.5s linear infinite alternate',
            opacity: .7,
          }}
        />
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: fullPage ? 16 : compact ? 12 : 14,
            fontWeight: 900,
            color: 'hsl(190 56% 28%)',
            letterSpacing: fullPage ? '.06em' : '.08em',
            animation: 'ewms-status 1.6s ease-in-out infinite',
          }}
        >
          EWMS CARGO IN TRANSIT
        </div>
        {!compact && (
          <div style={{ marginTop: 4, fontSize: 12.5, color: 'hsl(215 16% 46%)' }}>
            Sailing documents from India to USA
          </div>
        )}
      </div>
    </div>
  );
}

function CargoShip({ compact }: { compact: boolean }) {
  const shipWidth = compact ? 150 : 220;
  const shipHeight = compact ? 52 : 72;
  const hullHeight = compact ? 24 : 32;
  const containerSize = compact ? { width: 20, height: 9 } : { width: 28, height: 12 };
  const containers = [
    ['hsl(9 72% 46%)', 'hsl(42 82% 48%)', 'hsl(205 66% 42%)', 'hsl(154 54% 36%)'],
    ['hsl(205 66% 42%)', 'hsl(154 54% 36%)', 'hsl(9 72% 46%)'],
    ['hsl(42 82% 48%)', 'hsl(205 66% 42%)'],
  ];

  return (
    <div
      style={{
        position: 'absolute',
        width: shipWidth,
        height: shipHeight,
        left: '17%',
        top: compact ? 56 : 78,
        transform: 'translateX(-50%)',
        animation: 'ewms-cargo-cross 4.6s ease-in-out infinite',
        zIndex: 4,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: compact ? 20 : 32,
          top: compact ? 5 : 7,
          display: 'flex',
          alignItems: 'flex-end',
          gap: compact ? 3 : 4,
        }}
      >
        {containers.flatMap((row, rowIndex) =>
          row.map((color, index) => (
            <span
              key={`${rowIndex}-${index}`}
              style={{
                width: containerSize.width,
                height: containerSize.height,
                background: color,
                border: '1px solid rgba(255,255,255,.30)',
                boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.12)',
                position: 'absolute',
                left: index * (containerSize.width + (compact ? 2 : 3)) + rowIndex * (compact ? 11 : 15),
                top: (2 - rowIndex) * (containerSize.height + (compact ? 1 : 2)),
              }}
            />
          )),
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          right: compact ? 28 : 40,
          top: compact ? 12 : 16,
          width: compact ? 30 : 42,
          height: compact ? 24 : 32,
          background: 'linear-gradient(180deg, hsl(210 18% 94%), hsl(210 14% 78%))',
          borderRadius: '3px 3px 1px 1px',
          border: '1px solid hsla(210,20%,35%,.18)',
          boxShadow: 'inset 0 -5px 0 rgba(0,0,0,.08)',
        }}
      >
        <span style={{ position: 'absolute', left: 5, top: 5, width: 6, height: 4, background: 'hsl(200 58% 42%)', borderRadius: 1 }} />
        <span style={{ position: 'absolute', left: 15, top: 5, width: 6, height: 4, background: 'hsl(200 58% 42%)', borderRadius: 1 }} />
        <span style={{ position: 'absolute', right: 6, bottom: 6, width: 8, height: 5, background: 'hsl(200 58% 42%)', borderRadius: 1 }} />
      </div>

      <div style={{ position: 'absolute', right: compact ? 36 : 52, top: compact ? 2 : 3, width: 6, height: 16, background: 'hsl(215 22% 28%)', borderRadius: '2px 2px 0 0' }}>
        {[0, 0.75, 1.5].map((delay) => (
          <span
            key={delay}
            style={{
              position: 'absolute',
              left: -2,
              top: -5,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'hsla(210,14%,58%,.38)',
              animation: `ewms-smoke 2.1s ease-out ${delay}s infinite`,
            }}
          />
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: hullHeight,
          background: 'linear-gradient(180deg, hsl(213 33% 28%), hsl(213 42% 18%))',
          clipPath: 'polygon(3% 0, 92% 0, 100% 36%, 86% 100%, 16% 100%, 0 35%)',
          boxShadow: 'inset 0 -8px 0 hsla(0,0%,0%,.18)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: compact ? 15 : 22,
          right: compact ? 18 : 28,
          bottom: compact ? 12 : 17,
          height: 2,
          background: 'hsl(43 76% 52%)',
          opacity: .9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: compact ? -26 : -36,
          bottom: compact ? 2 : 4,
          width: compact ? 42 : 58,
          height: compact ? 8 : 10,
          background: 'linear-gradient(90deg, transparent, hsla(185,48%,92%,.72), transparent)',
          borderRadius: 999,
          filter: 'blur(.2px)',
        }}
      />
    </div>
  );
}

function PortMarker({ label, side, compact }: { label: string; side: 'left' | 'right'; compact: boolean }) {
  const anchorPosition = side === 'left' ? { left: compact ? 14 : 22 } : { right: compact ? 14 : 22 };
  const labelPosition = side === 'left' ? { left: compact ? 12 : 20 } : { right: compact ? 12 : 20 };

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: compact ? 55 : 78,
          ...anchorPosition,
          width: compact ? 32 : 40,
          height: compact ? 32 : 40,
          borderRadius: 8,
          background: 'linear-gradient(180deg, rgba(255,255,255,.84), rgba(255,255,255,.62))',
          border: '1px solid hsla(188,58%,32%,.25)',
          color: 'hsl(188 58% 30%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 18px hsla(205,46%,26%,.12)',
          zIndex: 3,
        }}
      >
        <Anchor size={compact ? 15 : 18} strokeWidth={2.2} />
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: compact ? 9 : 12,
          ...labelPosition,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: compact ? 10 : 11,
          fontWeight: 900,
          letterSpacing: '.08em',
          color: 'hsl(188 58% 26%)',
          zIndex: 3,
        }}
      >
        {side === 'left' && <span style={beaconStyle} />}
        <span>{label}</span>
        {side === 'right' && <span style={beaconStyle} />}
      </div>
    </>
  );
}

const beaconStyle = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'hsl(173 58% 39%)',
  animation: 'ewms-beacon 1.5s ease-in-out infinite',
} as const;
