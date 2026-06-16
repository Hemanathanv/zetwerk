type Chip = {
  label: string;
  count?: number;
};

type FilterChipsProps = {
  chips: Chip[];
  activeIndex: number;
  onSelect: (index: number) => void;
};

export function FilterChips({ chips, activeIndex, onSelect }: FilterChipsProps) {
  return (
    <div className="flex flex-wrap" style={{ gap: 8 }}>
      {chips.map((chip, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              border: isActive ? 'none' : '1px solid hsl(var(--border))',
              backgroundColor: isActive
                ? 'hsl(var(--foreground))'
                : 'hsl(var(--card))',
              color: isActive
                ? 'hsl(var(--card))'
                : 'hsl(var(--muted-foreground))',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(var(--vs-teal))';
                (e.currentTarget as HTMLButtonElement).style.color = 'hsl(var(--vs-teal))';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(var(--border))';
                (e.currentTarget as HTMLButtonElement).style.color = 'hsl(var(--muted-foreground))';
              }
            }}
          >
            {chip.label}
            {chip.count !== undefined && (
              <span style={{ marginLeft: 4, opacity: isActive ? 0.7 : 0.6 }}>
                ({chip.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
