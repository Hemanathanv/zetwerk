import { Package } from 'lucide-react';

type MetricCardProps = {
  label: string;
  value: string | number;
  subText?: string;
  subTextColor?: unknown;
  accentColor?: unknown;
  sideStats?: Array<{ value: string | number; label: string }>;
};

export function MetricCard({
  label,
  value,
  subText,
  sideStats,
}: MetricCardProps) {
  const resolvedSideStats = sideStats ?? (subText ? [{ value: subText, label: '' }] : []);

  return (
    <div
      className="group relative flex size-full flex-col items-start gap-3 rounded-2xl border border-[#e5e5e5] bg-white p-6 transition-shadow hover:border-[#e5e5e5] hover:bg-white hover:shadow-[0px_8px_24px_0px_rgba(9,9,9,0.08)]"
      data-node-id="607:14563"
      data-name="KPI Card"
    >
      <div className="flex w-full shrink-0 items-center gap-2 overflow-hidden">
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#dbe9fb] group-hover:bg-[#dbe9fb]">
          <Package className="size-4 text-[#0c46c3]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-[1.4] text-[#090909]">
          {label}
        </span>
      </div>

      <span className="shrink-0 whitespace-nowrap text-[26px] font-semibold leading-[1.1] tracking-[-0.52px] text-[#090909]">
        {value}
      </span>

      <div className="flex w-full shrink-0 flex-col items-start overflow-hidden">
        <div className="h-px w-full shrink-0 bg-[#e5e5e5]" />
        <div className="flex w-full shrink-0 items-start gap-4 overflow-hidden pt-3 whitespace-nowrap">
          {resolvedSideStats.slice(0, 2).map((stat) => (
            <div key={`${stat.label}-${stat.value}`} className="flex shrink-0 items-center gap-1 overflow-hidden">
              <span className="text-[13px] font-semibold leading-normal text-[#090909]">{stat.value}</span>
              {stat.label && (
                <span className="text-[11px] font-normal leading-[1.3] text-[#555]">{stat.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
