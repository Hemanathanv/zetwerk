interface Tab {
  label: string;
  value: string;
  icon?: string;
  count?: number;
}

interface AdminSectionTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (value: string) => void;
}

export function AdminSectionTabs({ tabs, activeTab, onTabChange }: AdminSectionTabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid hsl(var(--border))',
        marginBottom: 24,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      } as React.CSSProperties}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === activeTab;
        return (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? 'hsl(173 58% 39%)' : 'hsl(var(--muted-foreground))',
              background: 'none',
              border: 'none',
              borderBottom: isActive ? '2px solid hsl(173 58% 39%)' : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.color = 'hsl(var(--foreground))';
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLElement).style.color = 'hsl(var(--muted-foreground))';
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 20,
                  height: 20,
                  borderRadius: 10,
                  background: 'hsl(var(--muted))',
                  color: 'hsl(var(--muted-foreground))',
                  fontSize: 14,
                  fontWeight: 600,
                  padding: '0 5px',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
