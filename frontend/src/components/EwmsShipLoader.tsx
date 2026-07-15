import { MapPin } from 'lucide-react';

export function EwmsShipLoader({
  compact = false,
  fullPage = false,
}: {
  compact?: boolean;
  fullPage?: boolean;
}) {
  // Size tokens per variant — kept small and quiet on purpose.
  const s = fullPage
    ? { ship: 132, route: 260, shipH: 46, hull: 22, title: 15, sub: 13, gap: 22 }
    : compact
    ? { ship: 84, route: 156, shipH: 30, hull: 15, title: 12, sub: 0, gap: 10 }
    : { ship: 104, route: 196, shipH: 37, hull: 18, title: 13.5, sub: 12, gap: 16 };

  const travel = s.route - s.ship; // px the ship travels along the route

  return (
    <div
      style={{
        position: fullPage ? 'fixed' : 'relative',
        inset: fullPage ? 0 : undefined,
        width: fullPage ? '100vw' : '100%',
        minHeight: fullPage ? '100vh' : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        padding: compact ? 20 : 32,
        background: 'rgba(255,255,255,0.86)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        zIndex: fullPage ? 9999 : undefined,
      }}
    >
      <style>{`
        @keyframes ewms-voyage {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(${travel}px); }
        }
        @keyframes ewms-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes ewms-wake {
          0%, 100% { opacity: .35; transform: scaleX(.9); }
          50% { opacity: .6; transform: scaleX(1.05); }
        }
        @keyframes ewms-dot {
          0%, 80%, 100% { opacity: .22; }
          40% { opacity: 1; }
        }
      `}</style>

      {/* soft ambient glow — the one restrained flourish */}
      <div
        style={{
          position: 'absolute',
          width: s.route * 1.6,
          height: s.route * 1.6,
          borderRadius: '50%',
          background: 'radial-gradient(circle, hsla(190,55%,68%,0.16), transparent 70%)',
          filter: 'blur(6px)',
          pointerEvents: 'none',
        }}
      />

      {/* voyage track */}
      <div style={{ position: 'relative', width: s.route, height: s.shipH + 14 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: s.shipH / 2 + 5,
            height: 1,
            backgroundImage:
              'linear-gradient(90deg, hsla(190,30%,55%,.5) 0 5px, transparent 5px 12px)',
            backgroundSize: '12px 1px',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 0,
            top: s.shipH / 2 + 5,
            transform: 'translate(-50%, -100%)',
            color: 'hsl(190 55% 34%)',
          }}
        >
          <MapPin size={s.hull * 0.95} strokeWidth={2.2} fill="hsl(190 45% 88%)" />
        </div>
        <div
          style={{
            position: 'absolute',
            left: s.route,
            top: s.shipH / 2 + 5,
            transform: 'translate(-50%, -100%)',
            color: 'hsl(9 55% 42%)',
          }}
        >
          <MapPin size={s.hull * 0.95} strokeWidth={2.2} fill="hsl(9 55% 90%)" />
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: s.ship,
            height: s.shipH,
            animation: 'ewms-voyage 4.8s ease-in-out infinite',
          }}
        >
          <div style={{ animation: 'ewms-bob 1.6s ease-in-out infinite', width: '100%', height: '100%', position: 'relative' }}>
            <CargoShip width={s.ship} height={s.shipH} hull={s.hull} />
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: -3,
              left: s.ship * 0.08,
              width: s.ship * 0.7,
              height: 4,
              borderRadius: 999,
              background: 'hsla(195,35%,60%,.4)',
              filter: 'blur(1.5px)',
              animation: 'ewms-wake 1.6s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'center',
            gap: 3,
            fontSize: s.title,
            fontWeight: 600,
            color: 'hsl(215 25% 24%)',
            letterSpacing: '.01em',
          }}
        >
          <span>Loading</span>
          <span style={{ display: 'inline-flex', gap: 2 }}>
            {[0, 0.2, 0.4].map((d) => (
              <span
                key={d}
                style={{
                  animation: `ewms-dot 1.3s ease-in-out ${d}s infinite`,
                  fontWeight: 700,
                }}
              >
                .
              </span>
            ))}
          </span>
        </div>
        {!compact && (
          <div style={{ marginTop: 4, fontSize: s.sub, color: 'hsl(215 12% 52%)' }}>
            Preparing your shipping documents
          </div>
        )}
      </div>
    </div>
  );
}

function CargoShip({ width, height, hull }: { width: number; height: number; hull: number }) {
  const crateH = hull * 0.42;
  const crateW = width * 0.13;
  const crateGap = width * 0.02;
  const crates = ['hsl(9 62% 50%)', 'hsl(190 45% 38%)', 'hsl(42 70% 50%)'];

  return (
    <div style={{ position: 'relative', width, height }}>
      {/* crates on deck */}
      <div
        style={{
          position: 'absolute',
          left: width * 0.22,
          top: height - hull - crateH + 1,
          display: 'flex',
          gap: crateGap,
        }}
      >
        {crates.map((color, i) => (
          <span
            key={i}
            style={{
              width: crateW,
              height: crateH,
              background: color,
              borderRadius: 1,
              boxShadow: 'inset 0 -2px 0 rgba(0,0,0,.14)',
            }}
          />
        ))}
      </div>

      {/* hull with EWMS wordmark */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: hull,
          background: 'linear-gradient(180deg, hsl(213 30% 30%), hsl(213 40% 17%))',
          clipPath: 'polygon(4% 0, 94% 0, 100% 40%, 88% 100%, 12% 100%, 0 38%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: Math.max(hull * 0.4, 9),
            fontWeight: 800,
            letterSpacing: '.09em',
            color: 'hsl(0 0% 97%)',
            marginTop: hull * 0.06,
          }}
        >
          EWMS
        </span>
      </div>
    </div>
  );
}