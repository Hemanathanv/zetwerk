type DocBadgeSize = 'sm' | 'md';

type DocBadgeProps = {
  code: string;
  size?: DocBadgeSize;
};

export function DocBadge({ code, size = 'md' }: DocBadgeProps) {
  const dim = size === 'md' ? 32 : 24;
  const fontSize = size === 'md' ? 13 : 11;

  return (
    <div
      className="vs-mono font-semibold flex items-center justify-center flex-shrink-0"
      style={{
        width: dim,
        height: dim,
        borderRadius: 8,
        backgroundColor: 'hsla(221, 83%, 53%, 0.10)',
        color: 'hsl(221 83% 45%)',
        fontSize,
        letterSpacing: '0.02em',
      }}
    >
      {code.slice(0, 2).toUpperCase()}
    </div>
  );
}
