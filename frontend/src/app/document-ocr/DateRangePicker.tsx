import { useState } from "react";
import {
  format, subDays, startOfDay, endOfDay,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameDay,
} from "date-fns";
import { CalendarIcon, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

interface DateRangePickerProps {
  value: { from: Date; to: Date };
  onChange: (range: { from: Date; to: Date }) => void;
}

type PresetRange = {
  label: string;
  value: string;
  getRange: () => { from: Date; to: Date };
};

const presetRanges: PresetRange[] = [
  { label: "Today", value: "today", getRange: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: "2 Days", value: "2days", getRange: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(new Date()) }) },
  { label: "7 Days", value: "7days", getRange: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }) },
  { label: "This Week", value: "week", getRange: () => ({ from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: endOfWeek(new Date(), { weekStartsOn: 1 }) }) },
  { label: "This Month", value: "month", getRange: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
  { label: "30 Days", value: "30days", getRange: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }) },
];

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>("30days");
  const [manualSelection, setManualSelection] = useState<{ from: Date | null; to: Date | null; selectingEnd: boolean }>({ from: null, to: null, selectingEnd: false });

  const getCurrentPreset = () => {
    for (const preset of presetRanges) {
      const { from: pFrom, to: pTo } = preset.getRange();
      if (isSameDay(value.from, pFrom) && isSameDay(value.to, pTo)) return preset.value;
    }
    return null;
  };

  const handlePresetSelect = (preset: PresetRange) => {
    onChange(preset.getRange());
    setSelectedPreset(preset.value);
    setManualSelection({ from: null, to: null, selectingEnd: false });
    setIsOpen(false);
  };

  const handleCalendarSelect = (range: DateRange | undefined) => {
    if (!range) return;
    if (range.from && range.to) {
      onChange({ from: startOfDay(range.from), to: endOfDay(range.to) });
      setManualSelection({ from: null, to: null, selectingEnd: false });
      setSelectedPreset(null);
      setIsOpen(false);
      return;
    }
    if (range.from && !range.to) {
      if (!manualSelection.selectingEnd || !manualSelection.from || range.from.getTime() !== manualSelection.from.getTime()) {
        setManualSelection({ from: startOfDay(range.from), to: null, selectingEnd: true });
        setSelectedPreset(null);
      } else if (manualSelection.selectingEnd && manualSelection.from) {
        const from = manualSelection.from;
        const to = endOfDay(range.from);
        if (from <= to) { onChange({ from, to }); } else { onChange({ from: startOfDay(range.from), to: endOfDay(from) }); }
        setManualSelection({ from: null, to: null, selectingEnd: false });
        setSelectedPreset(null);
        setIsOpen(false);
      }
    }
  };

  const resetManualSelection = () => setManualSelection({ from: null, to: null, selectingEnd: false });

  const formatDateRange = () => {
    if (value?.from && value?.to) {
      if (format(value.from, "yyyy-MM-dd") === format(value.to, "yyyy-MM-dd")) return format(value.from, "MMM dd, yyyy");
      return `${format(value.from, "MMM dd")} – ${format(value.to, "MMM dd, yyyy")}`;
    }
    return "Select date range";
  };

  const displayedPreset = selectedPreset ?? getCurrentPreset();

  const calendarSelected = () => {
    if (manualSelection.from && !manualSelection.to) return { from: manualSelection.from, to: undefined };
    if (manualSelection.from && manualSelection.to) return { from: manualSelection.from, to: manualSelection.to };
    return { from: value?.from, to: value?.to };
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("w-[260px] justify-start text-left font-normal gap-2", !value && "text-muted-foreground")}>
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 truncate">{formatDateRange()}</span>
          {displayedPreset && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {presetRanges.find((p) => p.value === displayedPreset)?.label}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          {/* Quick Select Panel */}
          <div className="border-r px-3 py-4 space-y-1 min-w-[120px]">
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Quick Select</div>
            {presetRanges.map((preset) => (
              <Button
                key={preset.value}
                variant="ghost"
                size="sm"
                className={cn("w-full justify-start text-left text-xs h-7 px-2", displayedPreset === preset.value && "bg-primary/10 text-primary")}
                onClick={() => handlePresetSelect(preset)}
              >
                {displayedPreset === preset.value && <Check className="mr-1.5 h-3 w-3" />}
                {preset.label}
              </Button>
            ))}
            <div className="pt-2 border-t mt-2">
              <Button variant="ghost" size="sm" className="w-full justify-start text-left text-xs h-7 px-2 text-muted-foreground" onClick={resetManualSelection}>
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Custom Range
              </Button>
            </div>
          </div>

          {/* Calendar Panel */}
          <div className="p-3">
            <div className="mb-2">
              <div className="text-xs font-medium text-muted-foreground">Custom Range</div>
              {manualSelection.from && !manualSelection.to && (
                <div className="text-xs text-primary mt-1">Start: {format(manualSelection.from, "MMM dd, yyyy")} – click end date</div>
              )}
            </div>
            <Calendar mode="range" defaultMonth={value?.from} selected={calendarSelected()} onSelect={handleCalendarSelect} numberOfMonths={1} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
