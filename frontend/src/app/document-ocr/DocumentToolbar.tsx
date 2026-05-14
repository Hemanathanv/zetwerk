import { Download, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "./DateRangePicker";

interface DocumentToolbarProps {
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range: { from: Date; to: Date }) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectedDocType: string;
  onDocTypeChange: (docType: string) => void;
  docTypes: { value: string; label: string }[];
  pendingCount: number;
}

export function DocumentToolbar({
  dateRange,
  onDateRangeChange,
  searchTerm,
  onSearchChange,
  selectedDocType,
  onDocTypeChange,
  docTypes,
  pendingCount,
}: DocumentToolbarProps) {
  const handleExport = () => {
    const csv = "Document Name,Document Type,Status,Pages\nsample.pdf,SALES_INVOICE,EXTRACTED,3";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "documents_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      <DateRangePicker value={dateRange} onChange={onDateRangeChange} />

      <Select value={selectedDocType} onValueChange={onDocTypeChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="All document types" />
        </SelectTrigger>
        <SelectContent>
          {docTypes.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by file name..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
        {pendingCount > 0 && <Badge className="rounded-full px-3 py-1">Pending: {pendingCount}</Badge>}
      </div>
    </div>
  );
}
