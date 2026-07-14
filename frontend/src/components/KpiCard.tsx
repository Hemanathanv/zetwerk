import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';

type KpiCardProps = {
  label: string;
  value: string | number;
  delta: string;
  deltaPositive?: boolean;
  sparklineData: number[];
  icon: React.ReactNode;
  accentColor?: string;
};

export function KpiCard({
  label,
  value,
  delta,
  deltaPositive = true,
  sparklineData,
  icon,
  accentColor = 'hsl(var(--chart-1))',
}: KpiCardProps) {
  const data = sparklineData.map((v, i) => ({ i, v }));

  return (
    <div
      className="relative bg-card border rounded-lg p-5 hover:shadow-md transition-shadow duration-200 overflow-hidden"
      style={{ borderColor: 'hsl(var(--card-border))' }}
      data-testid={`kpi-card-${label.toLowerCase().replace(/ /g, '-')}`}
    >
      {/* Icon & Label */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {label}
          </p>
          <p className="text-4xl font-bold font-mono leading-none text-foreground">{value}</p>
        </div>
        <div
          className="p-3 rounded-lg opacity-90"
          style={{ backgroundColor: `${accentColor}20` }}
        >
          <span style={{ color: accentColor }}>{icon}</span>
        </div>
      </div>

      {/* Delta & Sparkline */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {deltaPositive ? (
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )}
          <span className={`text-[13px] font-medium ${deltaPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {delta}
          </span>
        </div>
        <div className="w-24 h-10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={accentColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
