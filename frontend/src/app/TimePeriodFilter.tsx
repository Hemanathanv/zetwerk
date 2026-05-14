import { useState } from "react";
import { Calendar, BarChart2, PieChart } from "lucide-react";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Label } from "../components/ui/label";

interface TimePeriodFilterProps {
  onTimePeriodChange: (period: string) => void;
  onDateRangeChange: (from: string | null, to: string | null) => void;
  accentClass?: string;
}

export default function TimePeriodFilter({
  onTimePeriodChange,
  onDateRangeChange,
  accentClass = "bg-primary text-primary-foreground hover:bg-primary/90",
}: TimePeriodFilterProps) {
  const [timePeriod, setTimePeriod] = useState("monthly");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const handleTimePeriodChange = (value: string) => {
    setTimePeriod(value);
    onTimePeriodChange(value);
  };

  const handleApplyDateRange = () => {
    onDateRangeChange(fromDate || null, toDate || null);
  };

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex flex-wrap items-end gap-4 p-4 bg-card rounded-xl border border-border">
        {/* Time Period Selector */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="time-period" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Time Period
          </Label>
          <Select value={timePeriod} onValueChange={handleTimePeriodChange}>
            <SelectTrigger id="time-period" className="w-40 font-mono text-sm">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date Range Picker */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from-date" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            From Date <span className="text-muted-foreground/50">(optional)</span>
          </Label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="pl-8 w-40 font-mono text-sm bg-background border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to-date" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            To Date <span className="text-muted-foreground/50">(optional)</span>
          </Label>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="pl-8 w-40 font-mono text-sm bg-background border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <Button
          onClick={handleApplyDateRange}
          className={cn("gap-2 min-w-[120px] font-mono", accentClass)}
        >
          <BarChart2 className="w-4 h-4" />
          Apply Filters
        </Button>
      </div>
    </div>
  );
}

// Helper function for class merging
function cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}