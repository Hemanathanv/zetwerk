import { Check } from 'lucide-react';

const stages = [
  { id: 1, label: 'Sales Invoice Creation' },
  { id: 2, label: 'Container Movement' },
  { id: 3, label: 'Custom WH → 3rd Party WH' },
  { id: 4, label: '3rd Party WH → Customer' },
  { id: 5, label: 'Closed' },
];

type StageTrackerProps = {
  activeStage?: number;
};

export function StageTracker({ activeStage = 2 }: StageTrackerProps) {
  return (
    <div className="flex items-start gap-0" data-testid="stage-tracker">
      {stages.map((stage, idx) => {
        const isCompleted = stage.id < activeStage;
        const isActive = stage.id === activeStage;
        const isPending = stage.id > activeStage;
        const isLast = idx === stages.length - 1;

        return (
          <div key={stage.id} className="flex flex-col items-center flex-1">
            {/* Step + connector row */}
            <div className="flex items-center w-full">
              {/* Left connector */}
              {idx > 0 && (
                <div
                  className="flex-1 h-0.5 transition-colors"
                  style={{
                    backgroundColor: isCompleted || isActive
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--border))',
                  }}
                />
              )}
              {/* Circle */}
              <div className="relative flex-shrink-0">
                {isActive && (
                  <span
                    className="absolute inset-0 rounded-full pulse-ring"
                    style={{ backgroundColor: 'hsl(var(--primary) / 0.3)' }}
                  />
                )}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all z-10 relative ${
                    isCompleted
                      ? 'bg-primary'
                      : isActive
                      ? 'bg-primary ring-4 ring-primary/20'
                      : 'bg-background border-2'
                  }`}
                  style={{
                    borderColor: isPending ? 'hsl(var(--border))' : undefined,
                  }}
                >
                  {isCompleted ? (
                    <Check className="w-3.5 h-3.5 text-primary-foreground" />
                  ) : isActive ? (
                    <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                  )}
                </div>
              </div>
              {/* Right connector */}
              {!isLast && (
                <div
                  className="flex-1 h-0.5 transition-colors"
                  style={{
                    backgroundColor: isCompleted
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--border))',
                  }}
                />
              )}
            </div>
            {/* Label */}
            <p
              className={`mt-2 text-center text-[10px] font-medium leading-tight px-1 ${
                isActive
                  ? 'text-primary'
                  : isCompleted
                  ? 'text-foreground/70'
                  : 'text-muted-foreground'
              }`}
              style={{ maxWidth: 80 }}
            >
              <span className="block text-[9px] font-bold uppercase tracking-wide mb-0.5 opacity-60">
                S{stage.id}
              </span>
              {stage.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}
