import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAuthToken } from '@/lib/api';
import { usePermissions } from '@/contexts/PermissionContext';
import { RequireActivity } from '@/components/PermissionGate';
import {
  Search, ChevronRight, Receipt, FileText, ExternalLink, Clock, AlertTriangle,
} from 'lucide-react';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  pending:   { color: 'bg-amber-100 text-amber-700',  label: 'Pending' },
  in_review: { color: 'bg-blue-100 text-blue-700',    label: 'In Review' },
  approved:  { color: 'bg-teal-100 text-teal-700',    label: 'Approved' },
  posted:    { color: 'bg-green-100 text-green-700',   label: 'Posted' },
  rejected:  { color: 'bg-red-100 text-red-700',      label: 'Rejected' },
};

// ─── SLA display helper ───────────────────────────────────────────────────────

function useSlaDisplay(ticket: any) {
  return useMemo(() => {
    if (!ticket.slaHoursRemaining && ticket.slaStatus === 'ok') return null;
    if (ticket.slaStatus === 'overdue') {
      const hrs = Math.abs(Math.floor(ticket.slaHoursRemaining || 0));
      return { text: `${hrs}h overdue`, color: 'text-red-600 font-medium' };
    }
    if (ticket.slaStatus === 'warning') {
      const rem = Math.floor(ticket.slaHoursRemaining || 0);
      return { text: `${rem}h left`, color: 'text-amber-600' };
    }
    if (ticket.slaHoursRemaining !== null && ticket.slaHoursRemaining !== undefined) {
      const rem = Math.floor(ticket.slaHoursRemaining);
      return { text: `${rem}h left`, color: 'text-muted-foreground' };
    }
    return null;
  }, [ticket.slaHoursRemaining, ticket.slaStatus]);
}

// ─── TicketDetail (expanded) ──────────────────────────────────────────────────

function TicketDetail({ ticket, onAction }: {
  ticket: any;
  onAction: (id: string, action: string, data?: any) => void;
}) {
  const mapping = ticket.ledgerMapping;

  return (
    <div className="px-4 pb-4 border-t bg-muted/5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">

        {/* Left: Journal entry preview */}
        <div>
          <h4 className="text-[12px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Journal Entry Preview</h4>

          {mapping ? (
            <div className="bg-background rounded-lg border p-3 space-y-1.5 text-[13px]">
              {(mapping.debitAccounts || []).map((acc: any, i: number) => (
                <div key={`dr-${i}`} className="flex justify-between items-baseline gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="text-blue-600 font-bold mr-1.5 font-mono">Dr</span>
                    <span className="font-medium">{acc.accountName}</span>
                    {acc.accountCode && (
                      <span className="text-muted-foreground font-mono text-[12px] ml-1">({acc.accountCode})</span>
                    )}
                  </span>
                  <span className="font-mono shrink-0">{ticket.currency} {Number(ticket.amount || 0).toLocaleString()}</span>
                </div>
              ))}

              {(mapping.creditAccounts || []).map((acc: any, i: number) => (
                <div key={`cr-${i}`} className="flex justify-between items-baseline gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="text-teal-600 font-bold mr-1.5 font-mono">Cr</span>
                    <span className="font-medium">{acc.accountName}</span>
                    {acc.accountCode && (
                      <span className="text-muted-foreground font-mono text-[12px] ml-1">({acc.accountCode})</span>
                    )}
                  </span>
                  <span className="font-mono shrink-0">{ticket.currency} {Number(ticket.amount || 0).toLocaleString()}</span>
                </div>
              ))}

              {(mapping.debitAccounts?.length === 0 && mapping.creditAccounts?.length === 0) && (
                <p className="text-muted-foreground text-[13px]">No accounts configured in this mapping.</p>
              )}

              {mapping.taxTreatment && (
                <div className="text-[12px] text-muted-foreground border-t pt-1 mt-1">
                  Tax: {mapping.taxTreatment}{mapping.taxRate ? ` @ ${Number(mapping.taxRate)}%` : ''}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground bg-muted/20 rounded-lg p-3">
              No ledger mapping configured for trigger <span className="font-mono">{ticket.triggerEvent}</span>.
            </p>
          )}

          {ticket.vendorInvoiceNumber && (
            <div className="mt-2 text-[12px] text-muted-foreground space-y-0.5">
              <div>Vendor Invoice: <span className="font-mono">{ticket.vendorInvoiceNumber}</span></div>
              {ticket.vendorInvoiceDate && (
                <div>Invoice Date: {new Date(ticket.vendorInvoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              )}
            </div>
          )}
        </div>

        {/* Right: Metadata */}
        <div className="space-y-3">
          {ticket.triggerDocument && (
            <div>
              <h4 className="text-[13px] font-semibold text-muted-foreground mb-1">Source Document</h4>
              <a
                href={`/documents/${ticket.triggerDocument.id}`}
                className="text-[13px] text-teal-600 hover:underline flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />
                {ticket.triggerDocument.fileName || 'View document'}
              </a>
            </div>
          )}

          <div>
            <h4 className="text-[13px] font-semibold text-muted-foreground mb-1">Timeline</h4>
            <div className="space-y-0.5 text-[12px] text-muted-foreground">
              <div>Created: {new Date(ticket.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              {ticket.slaDeadline && (
                <div>SLA deadline: {new Date(ticket.slaDeadline).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              )}
              {ticket.postedAt && (
                <div>Posted: {new Date(ticket.postedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              )}
            </div>
          </div>

          {ticket.erpVoucherNumber && (
            <div>
              <h4 className="text-[13px] font-semibold text-muted-foreground mb-1">ERP Reference</h4>
              <div className="text-[13px] font-mono">{ticket.erpVoucherNumber}</div>
            </div>
          )}

          {ticket.triggerConfig && (
            <div>
              <h4 className="text-[13px] font-semibold text-muted-foreground mb-1">Trigger Config</h4>
              <div className="text-[12px] text-muted-foreground space-y-0.5">
                {ticket.triggerConfig.description && <div>{ticket.triggerConfig.description}</div>}
                {ticket.triggerConfig.routingRole && <div>Routing: <span className="font-mono">{ticket.triggerConfig.routingRole}</span></div>}
                {ticket.triggerConfig.defaultSlaHours && <div>SLA: {ticket.triggerConfig.defaultSlaHours}h</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t flex-wrap">
        {ticket.status === 'pending' && (
          <RequireActivity code="ACC-001">
            <button
              onClick={() => onAction(ticket.id, 'start_review')}
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Start Review
            </button>
          </RequireActivity>
        )}

        {ticket.status === 'in_review' && (
          <>
            <RequireActivity code="ACC-003">
              <button
                onClick={() => onAction(ticket.id, 'approve')}
                className="px-4 py-2 text-[13px] font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
              >
                Approve
              </button>
            </RequireActivity>
            <RequireActivity code="ACC-003">
              <button
                onClick={() => {
                  const reason = window.prompt('Reason for rejection:');
                  if (reason) onAction(ticket.id, 'reject', { reason });
                }}
                className="px-4 py-2 text-[13px] font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                Reject
              </button>
            </RequireActivity>
          </>
        )}

        {ticket.status === 'approved' && (
          <RequireActivity code="ACC-004">
            <button
              onClick={() => {
                const voucherNum = window.prompt('ERP voucher / journal number:');
                if (voucherNum) onAction(ticket.id, 'post', { erpVoucherNumber: voucherNum });
              }}
              className="px-4 py-2 text-[13px] font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              Mark as Posted
            </button>
          </RequireActivity>
        )}

        <div className="flex-1" />

        {ticket.triggerDocument && (
          <a
            href={`/documents/${ticket.triggerDocument.id}`}
            className="text-[13px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" /> Source doc
          </a>
        )}
        {ticket.shipment && (
          <a
            href={`/shipments/${ticket.shipment.id}`}
            className="text-[13px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" /> Shipment
          </a>
        )}
      </div>
    </div>
  );
}

// ─── TicketCard ───────────────────────────────────────────────────────────────

function TicketCard({ ticket, onAction }: {
  ticket: any;
  onAction: (id: string, action: string, data?: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const slaDisplay = useSlaDisplay(ticket);
  const statusInfo = STATUS_STYLES[ticket.status] || STATUS_STYLES.pending;

  const borderClass =
    ticket.slaStatus === 'overdue' ? 'border-l-4 border-l-red-500' :
    ticket.slaStatus === 'warning' ? 'border-l-4 border-l-amber-500' : '';

  return (
    <div className={`bg-card rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow ${borderClass}`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/5 transition-colors"
      >
        {/* Trigger code + entry type */}
        <div className="w-[100px] shrink-0">
          <div className="text-[13px] font-mono font-bold">{ticket.triggerEvent || ticket.ticketNumber}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
            {ticket.triggerConfig?.category || ticket.entryType || '—'}
          </div>
        </div>

        {/* Vendor + source doc */}
        <div className="w-[160px] shrink-0 hidden sm:block">
          <div className="text-[13px] font-medium truncate">{ticket.vendorName || '—'}</div>
          {ticket.triggerDocument && (
            <div className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <span className="font-mono">{ticket.triggerDocument.documentType?.substring(0, 6)}</span>
              <span className="truncate">{ticket.triggerDocument.fileName || ''}</span>
            </div>
          )}
        </div>

        {/* Amount + due date */}
        <div className="w-[120px] shrink-0">
          <div className="text-[14.5px] font-mono font-semibold">
            {ticket.currency} {Number(ticket.amount || 0).toLocaleString()}
          </div>
          {ticket.dueDate && (
            <div className={`text-[12px] mt-0.5 ${
              new Date(ticket.dueDate) < new Date() ? 'text-red-600 font-medium' : 'text-muted-foreground'
            }`}>
              Due: {new Date(ticket.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </div>
          )}
        </div>

        {/* Status badge */}
        <div className="w-[80px] shrink-0">
          <span className={`text-[12px] font-medium px-1.5 py-0.5 rounded-full ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>

        {/* SLA */}
        <div className="w-[80px] shrink-0 hidden md:flex items-center gap-1">
          {slaDisplay && (
            <>
              {ticket.slaStatus === 'overdue' && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
              {ticket.slaStatus === 'warning' && <Clock className="w-3 h-3 text-amber-500 shrink-0" />}
              <span className={`text-[12px] ${slaDisplay.color}`}>{slaDisplay.text}</span>
            </>
          )}
        </div>

        {/* Shipment + project */}
        <div className="flex-1 min-w-0 text-right">
          {ticket.shipment && (
            <div>
              <a
                href={`/shipments/${ticket.shipment.id}`}
                onClick={e => e.stopPropagation()}
                className="text-[12px] font-mono text-teal-600 hover:underline"
              >
                {ticket.shipment.shipmentNumber || 'Pending'}
              </a>
              {ticket.shipment.project && (
                <a
                  href={`/projects/${ticket.shipment.project.id}`}
                  onClick={e => e.stopPropagation()}
                  className="text-[12px] text-muted-foreground hover:underline block"
                >
                  {ticket.shipment.project.projectCode}
                </a>
              )}
            </div>
          )}
        </div>

        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && <TicketDetail ticket={ticket} onAction={onAction} />}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function FinanceTicketQueuePage() {
  const { role } = usePermissions();

  const [tickets, setTickets]       = useState<any[]>([]);
  const [allTickets, setAllTickets] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);

  const [statusFilter, setStatusFilter]     = useState('pending');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [searchQuery, setSearchQuery]       = useState('');

  const fetchTickets = useCallback((forceAll = false) => {
    const params = new URLSearchParams();
    if (!forceAll && statusFilter !== 'all') params.set('status', statusFilter);
    if (!forceAll && categoryFilter !== 'all') params.set('category', categoryFilter);
    if (!forceAll && currencyFilter !== 'all') params.set('currency', currencyFilter);
    if (!forceAll && searchQuery) params.set('search', searchQuery);

    const url = `/api/accounting/tickets${params.toString() ? `?${params}` : ''}`;
    return fetch(url, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => d.data || []);
  }, [statusFilter, categoryFilter, currencyFilter, searchQuery]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchTickets(false),
      fetch('/api/accounting/tickets', { headers: authHeaders() }).then(r => r.json()).then(d => d.data || []),
    ]).then(([filtered, all]) => {
      setTickets(filtered);
      setAllTickets(all);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [fetchTickets]);

  // Derive filter options from all tickets (not hardcoded)
  const allFilterOptions = useMemo(() => ({
    categories: [...new Set(allTickets.map((t: any) => t.triggerConfig?.category || t.entryType).filter(Boolean))] as string[],
    currencies:  [...new Set(allTickets.map((t: any) => t.currency).filter(Boolean))] as string[],
  }), [allTickets]);

  // Summary counts from allTickets
  const summary = useMemo(() => {
    const pending   = allTickets.filter((t: any) => t.status === 'pending');
    const byCurrency: Record<string, number> = {};
    for (const t of pending) {
      const curr = t.currency || 'INR';
      byCurrency[curr] = (byCurrency[curr] || 0) + Number(t.amount || 0);
    }
    return {
      pendingCount:  pending.length,
      reviewCount:   allTickets.filter((t: any) => t.status === 'in_review').length,
      approvedCount: allTickets.filter((t: any) => t.status === 'approved').length,
      postedCount:   allTickets.filter((t: any) => t.status === 'posted').length,
      pendingByCurrency: byCurrency,
    };
  }, [allTickets]);

  const statusTabs = [
    { value: 'pending',   label: 'Pending',   count: summary.pendingCount },
    { value: 'in_review', label: 'In Review',  count: summary.reviewCount },
    { value: 'approved',  label: 'Approved',   count: summary.approvedCount },
    { value: 'posted',    label: 'Posted',     count: summary.postedCount },
    { value: 'all',       label: 'All',        count: allTickets.length },
  ];

  async function handleAction(ticketId: string, action: string, data?: any) {
    try {
      const res = await fetch(`/api/accounting/tickets/${ticketId}/${action}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Action failed: ${err.error || 'Unknown error'}`);
        return;
      }

      // Refresh both filtered + all lists
      const [filtered, all] = await Promise.all([
        fetchTickets(false),
        fetch('/api/accounting/tickets', { headers: authHeaders() }).then(r => r.json()).then(d => d.data || []),
      ]);
      setTickets(filtered);
      setAllTickets(all);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* ── Header ── */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: 0, color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Accounting Tickets</h1>
            <div className="flex items-center gap-2 mt-1 text-[14.5px] text-muted-foreground flex-wrap">
              <span>{summary.pendingCount} pending</span>
              {Object.entries(summary.pendingByCurrency).map(([curr, amount]) => (
                <span key={curr} className="font-mono">
                  · {curr} {Number(amount).toLocaleString()}
                </span>
              ))}
              {role && (
                <span className="text-[13px] bg-muted px-2 py-0.5 rounded-full ml-2">
                  {role.name}
                </span>
              )}
            </div>
          </div>

          {/* Summary pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {summary.reviewCount > 0 && (
              <span className="text-[13px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                {summary.reviewCount} in review
              </span>
            )}
            {summary.approvedCount > 0 && (
              <span className="text-[13px] bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full font-medium">
                {summary.approvedCount} approved
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Status tabs ── */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {statusTabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-[13px] font-medium rounded-full whitespace-nowrap transition-colors ${
              statusFilter === tab.value
                ? 'bg-teal-600 text-white'
                : 'bg-muted hover:bg-muted/70 text-foreground'
            }`}
          >
            {tab.label}
            <span className={`ml-1 ${statusFilter === tab.value ? 'opacity-80' : 'opacity-50'}`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search vendor, trigger, shipment…"
            className="w-full text-[14.5px] border rounded-lg pl-8 pr-3 py-1.5 bg-background"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="text-[14.5px] border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="all">All categories</option>
          {allFilterOptions.categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={currencyFilter}
          onChange={e => setCurrencyFilter(e.target.value)}
          className="text-[14.5px] border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="all">All currencies</option>
          {allFilterOptions.currencies.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* ── Ticket list ── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg h-16 bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(ticket => (
            <TicketCard key={ticket.id} ticket={ticket} onAction={handleAction} />
          ))}

          {tickets.length === 0 && (
            <div className="bg-card rounded-lg p-12 text-center border">
              <Receipt className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <h3 className="text-[14.5px] font-semibold mt-3">No tickets found</h3>
              <p className="text-[13px] text-muted-foreground mt-1">
                {statusFilter === 'pending'
                  ? 'All caught up — no pending tickets.'
                  : 'Adjust your filters to see tickets.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
