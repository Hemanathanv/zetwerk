import { useState } from "react";
import { Calendar, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface DateRangeFormProps {
  onRun: (from: string | null, to: string | null) => Promise<void>;
  isRunning: boolean;
  accentClass?: string;
}

export default function DateRangeForm({
  onRun,
  isRunning,
  accentClass = "bg-primary text-primary-foreground hover:bg-primary/90",
}: DateRangeFormProps) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const handleRun = async () => {
    await onRun(fromDate || null, toDate || null);
  };

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex flex-wrap items-end gap-4 p-4 bg-card rounded-lg border border-border">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from-date" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            From Date <span className="text-muted-foreground/50">(optional)</span>
          </Label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="pl-8 w-40 font-mono text-sm bg-background"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to-date" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            To Date <span className="text-muted-foreground/50">(optional)</span>
          </Label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="pl-8 w-40 font-mono text-sm bg-background"
            />
          </div>
        </div>

        <Button
          onClick={handleRun}
          disabled={isRunning}
          className={cn("gap-2 min-w-[120px] font-mono", accentClass)}
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Bot
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
