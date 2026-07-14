import { useState } from 'react';
import { Receipt, DollarSign, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { invoices } from '@/data/mockData';
import { StatusBadge } from '@/components/StatusBadge';

type InvFilter = 'All' | 'Approved' | 'Pending' | 'Exception' | 'Paid';
type TypeFilter = 'All' | 'Sales' | 'Freight' | 'CHA' | 'Forwarder';
const statusFilters: InvFilter[] = ['All', 'Approved', 'Pending', 'Exception', 'Paid'];
const typeFilters: TypeFilter[] = ['All', 'Sales', 'Freight', 'CHA', 'Forwarder'];

const totalValue = invoices.reduce((sum, inv) => {
  const num = parseFloat(inv.value.replace(/[$,]/g, ''));
  return sum + num;
}, 0);

export function InvoicesPage() {
  const [statusFilter, setStatusFilter] = useState<InvFilter>('All');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');

  const filtered = invoices.filter(inv => {
    const matchStatus = statusFilter === 'All' || inv.status === statusFilter;
    const matchType   = typeFilter === 'All'   || inv.type   === typeFilter;
    return matchStatus && matchType;
  });

  const pending   = invoices.filter(i => i.status === 'Pending').length;
  const approved  = invoices.filter(i => i.status === 'Approved').length;
  const exception = invoices.filter(i => i.status === 'Exception').length;
  const paid      = invoices.filter(i => i.status === 'Paid').length;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Invoices</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Sales, freight, CHA, and forwarder invoices across all shipments</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Total Value',  value: `$${(totalValue / 1000).toFixed(0)}K`, icon: DollarSign,   color: 'text-primary',          bg: 'bg-primary/10' },
          { label: 'Approved',     value: approved,                               icon: CheckCircle2, color: 'text-emerald-600',       bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
          { label: 'Pending',      value: pending,                                icon: Clock,        color: 'text-amber-600',         bg: 'bg-amber-50 dark:bg-amber-900/20' },
          { label: 'Exception',    value: exception,                              icon: AlertTriangle, color: 'text-red-600',          bg: 'bg-red-50 dark:bg-red-900/20' },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-card border rounded-lg p-4 flex items-center gap-3" style={{ borderColor: 'hsl(var(--card-border))' }}>
              <div className={`p-2 rounded-md ${c.bg}`}><Icon className={`w-4 h-4 ${c.color}`} /></div>
              <div>
                <p className="text-2xl font-bold">{c.value}</p>
                <p className="text-[13px] text-muted-foreground">{c.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {statusFilters.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-all ${statusFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1 flex-wrap">
          {typeFilters.map(f => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-all ${typeFilter === f ? 'bg-secondary text-secondary-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(var(--card-border))' }}>
        <table className="w-full text-[13px] border-collapse">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              {['Invoice No', 'Shipment', 'Type', 'Vendor', 'Buyer', 'Value', 'Issue Date', 'Due Date', 'Terms', 'Status'].map(col => (
                <th key={col} className="text-left py-3 px-4 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide border-b whitespace-nowrap" style={{ borderColor: 'hsl(var(--border))' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(inv => (
              <tr key={inv.id} className="border-b hover:bg-muted/30 transition-colors" style={{ borderColor: 'hsl(var(--border))' }} data-testid={`row-invoice-${inv.id}`}>
                <td className="py-3 px-4 font-semibold text-primary flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  {inv.invoiceNo}
                </td>
                <td className="py-3 px-4 font-semibold">{inv.shipmentId}</td>
                <td className="py-3 px-4">
                  <span className={`text-[12px] font-semibold px-2 py-0.5 rounded uppercase ${
                    inv.type === 'Sales'     ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : inv.type === 'Freight' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                    : inv.type === 'CHA'     ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    :                         'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
                  }`}>{inv.type}</span>
                </td>
                <td className="py-3 px-4 text-muted-foreground">{inv.vendor}</td>
                <td className="py-3 px-4 text-muted-foreground">{inv.buyer}</td>
                <td className="py-3 px-4 font-semibold">{inv.value}</td>
                <td className="py-3 px-4 text-muted-foreground">{inv.issueDate}</td>
                <td className="py-3 px-4 text-muted-foreground">{inv.dueDate}</td>
                <td className="py-3 px-4 text-muted-foreground">{inv.paymentTerms}</td>
                <td className="py-3 px-4"><StatusBadge status={inv.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t text-[13px] text-muted-foreground" style={{ borderColor: 'hsl(var(--border))' }}>
          Showing {filtered.length} of {invoices.length} invoices
        </div>
      </div>
    </div>
  );
}
