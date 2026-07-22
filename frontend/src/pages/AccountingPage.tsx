import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MetricCard, PageHeader, FilterChips, } from '@/components/vs';

type TicketType = 'EXPENSE' | 'REVENUE' | 'US DUTY' | 'PENALTY';
type Priority = 'URGENT' | 'HIGH' | 'NORMAL';

type DetailCell = { label: string; value: string; verified?: boolean };
type JournalRow = { type: 'Dr' | 'Cr'; account: string; amount: string };
type TicketData = {
  id: string;
  fdNum: string;
  type: TicketType;
  title: string;
  priority: Priority;
  reference: string;
  vendorLabel: string;
  vendorName: string;
  vendorSub: string;
  amountValue: string;
  amountSub: string;
  dueValue: string;
  dueDanger: boolean;
  dueSub: string;
  detail?: DetailCell[];
  journal?: JournalRow[];
  actions?: string[];
};

const TICKETS: TicketData[] = [
  {
    id: 'AE-02-8821', fdNum: '44821',
    type: 'EXPENSE', title: 'CHA Bill · Transys Global Forwarding', priority: 'URGENT',
    reference: 'Invoice INV44260100221 · Shipment J44CES25090019 · BOL TCL25260084',
    vendorLabel: 'Vendor', vendorName: 'Transys Global FF', vendorSub: 'GST: 33AAFCT9874P1ZE',
    amountValue: '₹1,65,837', amountSub: '+ ₹25,297 IGST',
    dueValue: 'Due in 3 days', dueDanger: true, dueSub: '26-Feb-2026',
    detail: [
      { label: 'Invoice value', value: '₹1,40,540.00' },
      { label: 'IGST @ 18%',   value: '₹25,297.20' },
      { label: 'Grand total',  value: '₹1,65,837.20' },
      { label: 'IRN (verified)', value: 'dea6734033ed...', verified: true },
    ],
    journal: [
      { type: 'Dr', account: 'Customs Clearance Expense — CHA charges',      amount: '1,40,540.00' },
      { type: 'Dr', account: 'Input IGST — Receivable',                       amount: '25,297.20' },
      { type: 'Cr', account: 'Accounts Payable — Transys Global FF',          amount: '1,65,837.20' },
    ],
    actions: ['View document', 'Edit entry', 'Reject', 'Post to ERP ↗'],
  },
  {
    id: 'AE-06-8818', fdNum: '44818',
    type: 'US DUTY', title: 'CBP FORM 7501 duty booking · Folgueras Customs', priority: 'URGENT',
    reference: 'Entry E4W-00368291 · Shipment J44CES25090015 · BOL SMAA00214450',
    vendorLabel: 'Vendor', vendorName: 'Folgueras Customs', vendorSub: 'US broker',
    amountValue: '$20,194', amountSub: 'Duty + MPF + HMF',
    dueValue: 'Due tomorrow', dueDanger: true, dueSub: 'Nov 18, 2025',
    detail: [
      { label: 'Customs duty',        value: '$20,005.50' },
      { label: 'MPF (499)',           value: '$138.59' },
      { label: 'HMF (501)',           value: '$50.02' },
      { label: 'Total entered value', value: '$40,011.00' },
    ],
    journal: [
      { type: 'Dr', account: 'US Customs Duty — Section 232 derivative steel', amount: '20,005.50' },
      { type: 'Dr', account: 'Merchandise Processing Fee (MPF)',                amount: '138.59' },
      { type: 'Dr', account: 'Harbor Maintenance Fee (HMF)',                    amount: '50.02' },
      { type: 'Cr', account: 'Accounts Payable — Folgueras Customs',           amount: '20,194.11' },
    ],
    actions: ['View CBP FORM 7501', 'Edit entry', 'Post to ERP ↗'],
  },
  {
    id: 'AE-03-8819', fdNum: '44819',
    type: 'EXPENSE', title: 'Freight Forwarder Bill · Logistics Plus', priority: 'HIGH',
    reference: 'Invoice HRGGN-240002261 · Shipment BE-250888610006',
    vendorLabel: 'Vendor', vendorName: 'Logistics Plus India', vendorSub: 'GST: 06AACCL...',
    amountValue: '₹12,84,000', amountSub: '+ ₹2,31,120 IGST',
    dueValue: 'Due in 11 days', dueDanger: false, dueSub: '28-Nov-2025',
  },
  {
    id: 'AE-01-8820', fdNum: '44820',
    type: 'REVENUE', title: 'Sales Invoice revenue recognition', priority: 'NORMAL',
    reference: 'Invoice KA/UM/2526/00821 · Shipment J44CES25090025 · new booking',
    vendorLabel: 'Customer', vendorName: 'Unimacts Mfg Mx, LLC', vendorSub: 'USD export · FOB',
    amountValue: '$98,420', amountSub: 'ROE ₹83.40 → ₹82.1L',
    dueValue: 'Due in 30 days', dueDanger: false, dueSub: 'Payment terms',
  },
  {
    id: 'AE-08-8822', fdNum: '44822',
    type: 'PENALTY', title: 'Demurrage charge · Husky Terminal', priority: 'HIGH',
    reference: 'Container TXGU5683192 · Shipment J44CES25090015 · 2 days over LFD',
    vendorLabel: 'Vendor', vendorName: 'Husky Terminal', vendorSub: 'FIRMS Z693',
    amountValue: '$340', amountSub: '$170/day × 2',
    dueValue: 'Overdue', dueDanger: true, dueSub: 'Incurred Nov 15',
  },
];

const FILTER_CHIPS = [
  { label: 'All',       count: 17 },
  { label: 'Urgent',    count: 3  },
  { label: 'AP India',  count: 11 },
  { label: 'AP US',     count: 4  },
  { label: 'Revenue',   count: 2  },
  { label: 'By vendor' },
];

const TYPE_STYLE: Record<TicketType, { bg: string; color: string }> = {
  'EXPENSE':  { bg: 'hsla(0,84%,60%,0.10)',   color: 'hsl(0 84% 40%)' },
  'REVENUE':  { bg: 'hsla(152,69%,31%,0.10)', color: 'hsl(152 69% 25%)' },
  'US DUTY':  { bg: 'hsla(38,92%,50%,0.12)',  color: 'hsl(38 92% 35%)' },
  'PENALTY':  { bg: 'hsla(0,84%,60%,0.10)',   color: 'hsl(0 84% 40%)' },
};

const PRIORITY_STYLE: Record<Priority, { bg: string; color: string }> = {
  URGENT: { bg: 'hsla(0,84%,60%,0.10)',   color: 'hsl(0 84% 40%)' },
  HIGH:   { bg: 'hsla(38,92%,50%,0.12)',  color: 'hsl(38 92% 35%)' },
  NORMAL: { bg: 'hsl(var(--border))',     color: 'hsl(var(--muted-foreground))' },
};

function Pill({ text, style }: { text: string; style: { bg: string; color: string } }) {
  return (
    <span
      style={{
        fontSize: 14.5,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        backgroundColor: style.bg,
        color: style.color,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

function ExpandedSection({ ticket }: { ticket: TicketData }) {
  if (!ticket.detail && !ticket.journal) return null;

  return (
    <div
      style={{
        borderTop: '1px solid hsl(var(--border))',
        padding: '0 20px 18px',
        backgroundColor: 'hsl(var(--background))',
      }}
    >
      {/* Part A: Detail grid */}
      {ticket.detail && (
        <div
          className="grid grid-cols-2 lg:grid-cols-4"
          style={{ gap: 16, paddingTop: 16, paddingBottom: 12 }}
        >
          {ticket.detail.map((cell) => (
            <div key={cell.label}>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'hsl(var(--muted-foreground))',
                  marginBottom: 4,
                }}
              >
                {cell.label}
              </div>
              <div
                className="vs-mono"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: cell.verified ? 'hsl(152 69% 25%)' : 'hsl(var(--foreground))',
                }}
              >
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Part B: Journal entry */}
      {ticket.journal && (
        <div
          className="bg-card"
          style={{
            border: '1px solid hsl(var(--border))',
            borderRadius: 10,
            padding: 16,
            marginTop: 6,
          }}
        >
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'hsl(var(--muted-foreground))',
              marginBottom: 10,
            }}
          >
            Suggested journal entry
          </div>
          {ticket.journal.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 110px',
                fontSize: 14.5,
                padding: '6px 0',
                borderBottom: i < ticket.journal!.length - 1 ? '1px solid hsl(220 14% 95%)' : 'none',
                alignItems: 'center',
              }}
            >
              <span
                className="vs-mono"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: row.type === 'Dr' ? 'hsl(221 83% 45%)' : 'hsl(var(--vs-teal-dark))',
                }}
              >
                {row.type}
              </span>
              <span style={{ fontSize: 14.5, color: 'hsl(var(--foreground))' }}>
                {row.account}
              </span>
              <span
                className="vs-mono"
                style={{ fontSize: 14.5, fontWeight: 600, textAlign: 'right', color: 'hsl(var(--foreground))' }}
              >
                {row.amount}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Part C: Action buttons */}
      {ticket.actions && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 14,
          }}
        >
          {ticket.actions.map((label) => {
            const isPost = label.startsWith('Post to ERP');
            return isPost ? (
              <button
                key={label}
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  padding: '8px 16px',
                  borderRadius: 8,
                  backgroundColor: 'hsl(var(--vs-success))',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'hsl(152 69% 26%)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'hsl(var(--vs-success))'; }}
              >
                {label}
              </button>
            ) : (
              <Button
                key={label}
                variant="outline"
                style={{ fontSize: 14.5, padding: '8px 16px', borderRadius: 8 }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  expanded,
  onToggle,
}: {
  ticket: TicketData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const borderLeft =
    ticket.priority === 'URGENT'
      ? '3px solid hsl(var(--vs-danger))'
      : ticket.priority === 'HIGH'
      ? '3px solid hsl(var(--vs-warning))'
      : 'none';

  return (
    <div
      className="bg-card rounded-xl overflow-hidden"
      style={{
        borderLeft,
        marginBottom: 10,
        boxShadow: 'var(--vs-shadow-card)',
        transition: 'box-shadow 0.12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--vs-shadow-elevated)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--vs-shadow-card)'; }}
    >
      {/* Header row — desktop */}
      <div
        onClick={onToggle}
        className="hidden lg:grid"
        style={{
          gridTemplateColumns: 'auto minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) auto',
          gap: 16,
          padding: '20px 22px',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        {/* Ticket ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            className="vs-mono"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'hsl(var(--muted-foreground))',
              backgroundColor: 'hsl(var(--background))',
              padding: '4px 8px',
              borderRadius: 6,
              display: 'inline-block',
              whiteSpace: 'nowrap',
            }}
          >
            {ticket.id}
          </span>
          <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', fontWeight: 500, marginLeft: 2 }}>
            FD-{ticket.fdNum}
          </span>
        </div>

        {/* Title block */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <Pill text={ticket.type} style={TYPE_STYLE[ticket.type]} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
              {ticket.title}
            </span>
            <Pill text={ticket.priority} style={PRIORITY_STYLE[ticket.priority]} />
          </div>
          <div style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            {ticket.reference}
          </div>
        </div>

        {/* Vendor */}
        <div>
          <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginBottom: 3 }}>
            {ticket.vendorLabel}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            {ticket.vendorName}
          </div>
          <div className="vs-mono" style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            {ticket.vendorSub}
          </div>
        </div>

        {/* Amount */}
        <div style={{ textAlign: 'right' }}>
          <div className="vs-mono" style={{ fontSize: 20, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            {ticket.amountValue}
          </div>
          <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            {ticket.amountSub}
          </div>
        </div>

        {/* Due date */}
        <div style={{ textAlign: 'right', minWidth: 100 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              color: ticket.dueDanger ? 'hsl(0 84% 45%)' : 'hsl(var(--foreground))',
            }}
          >
            {ticket.dueValue}
          </div>
          <div className="vs-mono" style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
            {ticket.dueSub}
          </div>
        </div>
      </div>

      {/* Header row — mobile stacked */}
      <div
        onClick={onToggle}
        className="flex flex-col gap-2 lg:hidden"
        style={{ padding: '16px 16px', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="vs-mono"
              style={{
                fontSize: 14.5, fontWeight: 600, color: 'hsl(var(--muted-foreground))',
                backgroundColor: 'hsl(var(--background))', padding: '3px 7px', borderRadius: 6,
              }}
            >
              {ticket.id}
            </span>
            <span style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))', fontWeight: 500 }}>
              FD-{ticket.fdNum}
            </span>
          </div>
          <div className="vs-mono" style={{ fontSize: 16, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            {ticket.amountValue}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Pill text={ticket.type} style={TYPE_STYLE[ticket.type]} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>{ticket.title}</span>
          <Pill text={ticket.priority} style={PRIORITY_STYLE[ticket.priority]} />
        </div>
        <div style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{ticket.reference}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
            {ticket.vendorName}
          </span>
          <span
            style={{
              fontSize: 14.5, fontWeight: 600,
              color: ticket.dueDanger ? 'hsl(0 84% 45%)' : 'hsl(var(--foreground))',
            }}
          >
            {ticket.dueValue}
          </span>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && <ExpandedSection ticket={ticket} />}
    </div>
  );
}

export function AccountingPage() {
  const [activeChip, setActiveChip] = useState(0);
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(
    new Set(['AE-02-8821'])
  );

  function toggleTicket(id: string) {
    setExpandedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-7">

      {/* Section 1: Page Header */}
      <PageHeader
        title="Accounting entry tickets"
        badge={{ label: 'Finance · AP India · Anjali M', variant: 'gold' }}
        subtitle="17 pending tickets · ₹34,82,150 outstanding · ready for posting to Zoho Books"
        actions={
          <>
            <Button variant="outline" size="sm">Export</Button>
            <Button variant="outline" size="sm">Bulk post</Button>
            <Button
              size="sm"
              className="text-white"
              style={{ backgroundColor: 'hsl(var(--vs-teal))' }}
            >
              Configure ERP sync
            </Button>
          </>
        }
      />

      {/* Section 2: Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 14, marginBottom: 24 }}>
        <MetricCard
          label="Pending tickets"
          value={17}
          subText="+5 today"
          subTextColor="success"
          accentColor="teal"
        />
        <MetricCard
          label="Total pending"
          value="₹34.8L"
          subText="₹31.2L INR · $43K USD"
          subTextColor="muted"
          accentColor="info"
        />
        <MetricCard
          label="Urgent (due <7d)"
          value={3}
          subText="₹8.2L"
          subTextColor="danger"
          accentColor="danger"
        />
        <MetricCard
          label="Posted this week"
          value={28}
          subText="₹52.4L value"
          subTextColor="success"
          accentColor="success"
        />
      </div>

      {/* Section 3: Filter Chips + Auto-refresh */}
      <div className="flex items-center flex-wrap gap-2" style={{ marginBottom: 16 }}>
        <FilterChips
          chips={FILTER_CHIPS}
          activeIndex={activeChip}
          onSelect={setActiveChip}
        />
        <div style={{ marginLeft: 'auto' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 14.5,
              fontWeight: 500,
              backgroundColor: 'hsla(152,69%,31%,0.10)',
              color: 'hsl(152 69% 25%)',
              border: '1px solid hsla(152,69%,31%,0.3)',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: 'hsl(152 69% 35%)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            Auto-refresh · on
          </span>
        </div>
      </div>

      {/* Section 4: Ticket Cards */}
      <div>
        {TICKETS.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            expanded={expandedTickets.has(ticket.id)}
            onToggle={() => toggleTicket(ticket.id)}
          />
        ))}
      </div>
    </div>
  );
}
