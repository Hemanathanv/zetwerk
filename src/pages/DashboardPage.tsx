import { BarChart, Bar, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { TrendingUp, Package, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { shipments, activityEvents, invoices } from '@/data/mockData';
import { ActivityFeed } from '@/components/ActivityFeed';
import { StatusBadge } from '@/components/StatusBadge';

const stageData = [
  { name: 'Stage 1', count: shipments.filter(s => s.stage === 'Stage 1').length, fill: 'hsl(199 89% 48%)' },
  { name: 'Stage 2', count: shipments.filter(s => s.stage === 'Stage 2').length, fill: 'hsl(45 93% 47%)' },
  { name: 'Stage 3', count: shipments.filter(s => s.stage === 'Stage 3').length, fill: 'hsl(152 69% 35%)' },
  { name: 'Closed',  count: shipments.filter(s => s.status === 'Closed').length, fill: 'hsl(220 9% 46%)' },
];

const weeklyTrend = [
  { day: 'Mon', shipments: 18, docs: 12 },
  { day: 'Tue', shipments: 22, docs: 19 },
  { day: 'Wed', shipments: 19, docs: 16 },
  { day: 'Thu', shipments: 27, docs: 24 },
  { day: 'Fri', shipments: 24, docs: 21 },
  { day: 'Sat', shipments: 14, docs: 10 },
  { day: 'Sun', shipments: 8,  docs: 5  },
];

const summaryCards = [
  { label: 'Total Shipments', value: 8, sub: '3 in transit', icon: Package, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { label: 'On-Time Delivery', value: '87%', sub: '+4% vs last week', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { label: 'Docs Completed', value: '22 / 28', sub: '6 pending OCR', icon: CheckCircle2, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-900/20' },
  { label: 'Avg Cycle Time', value: '18 days', sub: '−2d vs last month', icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
];

export function DashboardPage() {
  const recentShipments = shipments.slice(0, 5);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Overview across all shipments and operations</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {summaryCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-card border rounded-lg p-4" style={{ borderColor: 'hsl(var(--card-border))' }}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</p>
                  <p className="text-2xl font-bold mt-1">{c.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
                </div>
                <div className={`p-2 rounded-md ${c.bg}`}>
                  <Icon className={`w-4 h-4 ${c.color}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Weekly trend */}
        <div className="xl:col-span-2 bg-card border rounded-lg p-4" style={{ borderColor: 'hsl(var(--card-border))' }}>
          <p className="text-sm font-semibold mb-1">Weekly Activity</p>
          <p className="text-xs text-muted-foreground mb-4">Shipments processed vs documents extracted</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={weeklyTrend}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={24} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid hsl(var(--border))' }} />
              <Line type="monotone" dataKey="shipments" stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} name="Shipments" />
              <Line type="monotone" dataKey="docs" stroke="hsl(152 69% 35%)" strokeWidth={2} dot={false} name="Documents" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Stage distribution */}
        <div className="bg-card border rounded-lg p-4" style={{ borderColor: 'hsl(var(--card-border))' }}>
          <p className="text-sm font-semibold mb-1">Stage Distribution</p>
          <p className="text-xs text-muted-foreground mb-4">Current shipments by stage</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={stageData} barSize={28}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={16} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid hsl(var(--border))' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Shipments">
                {stageData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1">
            {stageData.map(d => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.fill }} />
                  {d.name}
                </span>
                <span className="font-semibold">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recent shipments */}
        <div className="bg-card border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(var(--card-border))' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            <p className="text-sm font-semibold">Recent Shipments</p>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {['ID', 'Invoice', 'Carrier', 'ETA', 'Status'].map(col => (
                  <th key={col} className="text-left py-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentShipments.map(s => (
                <tr key={s.id} className="border-t hover:bg-muted/30" style={{ borderColor: 'hsl(var(--border))' }}>
                  <td className="py-2.5 px-3 font-semibold text-primary">{s.id}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{s.invoiceNo}</td>
                  <td className="py-2.5 px-3">{s.carrier}</td>
                  <td className="py-2.5 px-3 text-muted-foreground">{s.eta}</td>
                  <td className="py-2.5 px-3"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent activity */}
        <div className="bg-card border rounded-lg overflow-hidden" style={{ borderColor: 'hsl(var(--card-border))' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
            <p className="text-sm font-semibold">Recent Activity</p>
          </div>
          <div className="p-4">
            <ActivityFeed events={activityEvents.slice(0, 6)} />
          </div>
        </div>
      </div>
    </div>
  );
}
