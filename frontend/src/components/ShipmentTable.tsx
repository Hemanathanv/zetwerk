import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Shipment } from '@/data/mockData';
import { StatusBadge } from './StatusBadge';

type FilterOption = 'All' | 'In Transit' | 'Validation Pending' | 'Exception' | 'Closed';

type ShipmentTableProps = {
  shipments: Shipment[];
  selectedId: string;
  onSelect: (id: string) => void;
};

const filters: FilterOption[] = ['All', 'In Transit', 'Validation Pending', 'Exception', 'Closed'];

export function ShipmentTable({ shipments, selectedId, onSelect }: ShipmentTableProps) {
  const [activeFilter, setActiveFilter] = useState<FilterOption>('All');

  const filtered = shipments.filter((s) => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'In Transit') return s.status === 'In Transit';
    if (activeFilter === 'Validation Pending') return s.status === 'Document Review' || s.status === 'Pending';
    if (activeFilter === 'Exception') return s.status === 'Exception';
    if (activeFilter === 'Closed') return s.status === 'Closed';
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Filter Chips */}
      <div className="flex items-center gap-1.5 flex-wrap px-4 pt-3 pb-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeFilter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
            }`}
            data-testid={`filter-${f.toLowerCase().replace(/ /g, '-')}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[680px]">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            <tr>
              {['Shipment ID', 'Invoice No', 'BOL', 'Booking No', 'Carrier', 'Stage', 'ETA', 'Status'].map((col) => (
                <th
                  key={col}
                  className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide py-2.5 px-3 border-b whitespace-nowrap"
                  style={{ borderColor: 'hsl(var(--border))' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const isSelected = s.id === selectedId;
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  className={`cursor-pointer border-b transition-colors ${
                    isSelected
                      ? 'bg-primary/5 dark:bg-primary/10'
                      : 'hover:bg-muted/50'
                  }`}
                  style={{
                    borderColor: 'hsl(var(--border))',
                    borderLeft: isSelected ? '3px solid hsl(var(--primary))' : '3px solid transparent',
                  }}
                  data-testid={`row-shipment-${s.id}`}
                >
                  <td className="py-2.5 px-3 font-semibold text-primary text-xs">{s.id}</td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{s.invoiceNo}</td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{s.bol}</td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{s.bookingNo}</td>
                  <td className="py-2.5 px-3 text-xs font-medium">{s.carrier}</td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">{s.stage}</td>
                  <td className="py-2.5 px-3 text-xs font-medium">{s.eta}</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t text-xs text-muted-foreground" style={{ borderColor: 'hsl(var(--border))' }}>
        <span>Showing 1–{filtered.length} of {filtered.length} shipments</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 transition-colors"
            disabled
            data-testid="button-pagination-prev"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium">1</span>
          <button
            className="p-1.5 rounded hover:bg-muted disabled:opacity-40 transition-colors"
            disabled
            data-testid="button-pagination-next"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
