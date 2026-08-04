import { useState, useEffect, useMemo } from 'react';
import { Search, Package, Ship, Truck, CheckCircle, ChevronDown } from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Shipment Row ─────────────────────────────────────────────────────────────

function CustomerShipmentRow({ shipment }: { shipment: any }) {
  const isComplete = shipment.status === 'COMPLETED';

  return (
    <a
      href={`/portal/tracking/${shipment.id}`}
      className={`flex items-center gap-4 p-3 rounded-lg hover:bg-muted/30 transition-colors ${
        isComplete ? 'opacity-60' : ''
      }`}
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
        isComplete
          ? 'bg-green-100 text-green-600 dark:bg-green-950/30 dark:text-green-400'
          : shipment.stage.progress >= 70
          ? 'bg-teal-100 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400'
          : 'bg-blue-100 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
      }`}>
        {isComplete ? (
          <CheckCircle className="w-5 h-5" />
        ) : shipment.stage.progress >= 70 ? (
          <Truck className="w-5 h-5" />
        ) : (
          <Ship className="w-5 h-5" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-medium">
            {shipment.shipmentNumber || 'Processing'}
          </span>
          {shipment.containerCount > 0 && (
            <span className="text-[12px] text-muted-foreground">
              {shipment.containerCount} container{shipment.containerCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="text-[13px] text-muted-foreground mt-0.5">{shipment.stage.label}</div>
        <div className="h-1 rounded-full bg-muted/50 overflow-hidden mt-1.5 max-w-[200px]">
          <div
            className={`h-full rounded-full ${isComplete ? 'bg-green-500' : 'bg-teal-500'}`}
            style={{ width: `${shipment.stage.progress}%` }}
          />
        </div>
      </div>

      <div className="text-right shrink-0">
        {shipment.etaDelivery && !isComplete ? (
          <div>
            <div className="text-[12px] text-muted-foreground">Est. delivery</div>
            <div className="text-[13px] font-mono font-medium">
              {new Date(shipment.etaDelivery).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          </div>
        ) : isComplete ? (
          <span className="text-[13px] text-green-600 font-medium">Delivered</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">Tracking →</span>
        )}
      </div>
    </a>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────

function CustomerProjectCard({ project }: { project: any }) {
  const [expanded, setExpanded] = useState(project.status === 'ACTIVE');

  return (
    <div className="bg-card rounded-xl overflow-hidden border border-border">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-5 text-left">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold">{project.projectCode}</h3>
              {project.status === 'COMPLETED' && (
                <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                  All delivered
                </span>
              )}
            </div>
            {project.projectName && project.projectName !== project.projectCode && (
              <p className="text-[14.5px] text-muted-foreground mt-0.5 truncate">{project.projectName}</p>
            )}
          </div>

          <div className="text-right ml-4 shrink-0">
            {project.nextDeliveryEta && project.status === 'ACTIVE' && (
              <div>
                <div className="text-[12px] text-muted-foreground">Next delivery</div>
                <div className="text-[14.5px] font-mono font-medium">
                  {new Date(project.nextDeliveryEta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            )}
            <ChevronDown className={`w-4 h-4 text-muted-foreground mt-1 transition-transform mx-auto ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] text-muted-foreground">
              {project.completedCount} of {project.shipmentCount} shipment{project.shipmentCount !== 1 ? 's' : ''} delivered
            </span>
            <span className="text-[13px] font-mono font-medium">{project.completionPct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                project.completionPct === 100 ? 'bg-green-500' : 'bg-teal-500'
              }`}
              style={{ width: `${project.completionPct}%` }}
            />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border">
          {project.shipments.length === 0 ? (
            <p className="text-[13px] text-muted-foreground mt-4">No shipments yet.</p>
          ) : (
            <div className="space-y-1 mt-3">
              {project.shipments.map((shipment: any) => (
                <CustomerShipmentRow key={shipment.id} shipment={shipment} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter.toUpperCase());
    if (searchQuery) params.set('search', searchQuery);

    fetch(`${API_BASE}/api/portal/projects?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => {
        setProjects(d.data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [statusFilter, searchQuery]);

  const summary = useMemo(() => ({
    total: projects.length,
    active: projects.filter(p => p.status === 'ACTIVE').length,
    completed: projects.filter(p => p.status === 'COMPLETED').length,
    totalShipments: projects.reduce((s: number, p: any) => s + p.shipmentCount, 0),
  }), [projects]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-8">
        <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Your Orders</h1>
        <p className="text-[14.5px] text-muted-foreground mt-1">
          Track the status of your purchase orders and shipments
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <div className="text-3xl font-bold font-mono">{summary.active}</div>
          <div className="text-[13px] text-muted-foreground mt-1">Active Orders</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <div className="text-3xl font-bold font-mono text-teal-600">{summary.completed}</div>
          <div className="text-[13px] text-muted-foreground mt-1">Completed</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <div className="text-3xl font-bold font-mono">{summary.totalShipments}</div>
          <div className="text-[13px] text-muted-foreground mt-1">Total Shipments</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by PO number..."
            className="w-full text-[14.5px] border border-border rounded-xl pl-9 pr-4 py-2.5 bg-background text-foreground"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-[14.5px] border border-border rounded-xl px-3 py-2.5 bg-background text-foreground"
        >
          <option value="all">All orders</option>
          <option value="active">In progress</option>
          <option value="completed">Delivered</option>
        </select>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-card rounded-xl border border-border p-5 animate-pulse h-28" />
          ))}
        </div>
      )}

      {/* Project cards */}
      {!loading && (
        <div className="space-y-4">
          {projects.map(project => (
            <CustomerProjectCard key={project.id} project={project} />
          ))}

          {projects.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <Package className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <h3 className="text-[14.5px] font-semibold mt-3">No orders found</h3>
              <p className="text-[13px] text-muted-foreground mt-1">
                {statusFilter !== 'all' || searchQuery
                  ? 'No orders match your search. Try clearing the filters.'
                  : 'Your purchase orders will appear here once shipments are created.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
