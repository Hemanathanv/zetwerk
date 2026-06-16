type ConfidenceBarProps = {
  confidence: number;
  segments?: number;
};

export function ConfidenceBar({ confidence, segments = 5 }: ConfidenceBarProps) {
  const filled = Math.round(confidence * segments);

  return (
    <div className="flex items-center gap-0.5" style={{ gap: 2 }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 3,
            flex: 1,
            borderRadius: 2,
            backgroundColor:
              i < filled
                ? 'hsl(var(--vs-success))'
                : 'hsl(var(--border))',
          }}
        />
      ))}
    </div>
  );
}
