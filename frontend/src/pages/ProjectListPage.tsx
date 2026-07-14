import { useState, useEffect, useMemo } from 'react';
import { Search, FolderOpen, ChevronRight } from 'lucide-react';
import { getAuthToken } from '@/lib/api';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  ON_HOLD:   'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  CANCELLED: 'bg-muted text-muted-foreground',
};

function ProjectCard({ project }: { project: any }) {
  return (
    <a
      href={`/projects/${project.id}`}
      className="bg-card rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition-shadow border border-transparent hover:border-border"
    >
      <div className="w-[200px] shrink-0">
        <div className="text-[14.5px] font-mono font-semibold">{project.projectCode}</div>
        {project.projectName && project.projectName !== project.projectCode && (
          <div className="text-[13px] text-muted-foreground mt-0.5 truncate">{project.projectName}</div>
        )}
      </div>

      <div className="w-[150px] shrink-0 hidden sm:block">
        <div className="text-[13px] truncate">{project.customerName || '—'}</div>
        <span className={`text-[13px] font-medium px-1.5 py-0.5 rounded mt-0.5 inline-block ${STATUS_STYLES[project.status] || STATUS_STYLES.ACTIVE}`}>
          {project.status.replace('_', ' ')}
        </span>
      </div>

      <div className="flex-1 min-w-[120px]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] text-muted-foreground">
            {project.completedCount}/{project.shipmentCount} shipments
          </span>
          <span className="text-[12px] font-mono font-medium">{project.completionPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              project.completionPct === 100 ? 'bg-green-500' :
              project.completionPct > 0    ? 'bg-teal-500'  : 'bg-muted'
            }`}
            style={{ width: `${project.completionPct}%` }}
          />
        </div>
      </div>

      <div className="w-[80px] shrink-0 text-right hidden md:block">
        {project.activeCount > 0 && (
          <div className="text-[13px]">
            <span className="font-mono">{project.activeCount}</span>
            <span className="text-muted-foreground ml-1">active</span>
          </div>
        )}
      </div>

      <div className="w-[70px] shrink-0 text-right">
        <div className="text-[12px] text-muted-foreground font-mono">{fmtDate(project.createdAt)}</div>
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </a>
  );
}

export function ProjectListPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter.toUpperCase());
    if (search) params.set('search', search);
    setLoading(true);
    fetch(`/api/projects?${params}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setProjects(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [statusFilter, search]);

  const stats = useMemo(() => ({
    total:          projects.length,
    active:         projects.filter(p => p.status === 'ACTIVE').length,
    completed:      projects.filter(p => p.status === 'COMPLETED').length,
    totalShipments: projects.reduce((s, p) => s + p.shipmentCount, 0),
  }), [projects]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 style={{ fontSize: 'var(--text-page-title-size)', fontWeight: 'var(--text-page-title-weight)', letterSpacing: '-0.025em', color: 'hsl(var(--foreground))', margin: 0, lineHeight: 1.2 }}>Projects</h1>
          <p className="text-[14.5px] text-muted-foreground mt-0.5">
            {stats.total} project{stats.total !== 1 ? 's' : ''} · {stats.totalShipments} shipments
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search projects…"
              className="text-[14.5px] border rounded-lg pl-8 pr-3 py-1.5 w-48 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-[14.5px] border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="on_hold">On Hold</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card rounded-xl p-3">
          <div className="text-2xl font-bold font-mono">{stats.active}</div>
          <div className="text-[12px] text-muted-foreground">Active Projects</div>
        </div>
        <div className="bg-card rounded-xl p-3">
          <div className="text-2xl font-bold font-mono text-teal-600">{stats.completed}</div>
          <div className="text-[12px] text-muted-foreground">Completed</div>
        </div>
        <div className="bg-card rounded-xl p-3">
          <div className="text-2xl font-bold font-mono">{stats.totalShipments}</div>
          <div className="text-[12px] text-muted-foreground">Total Shipments</div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-card rounded-lg h-14 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
          {projects.length === 0 && (
            <div className="bg-card rounded-xl p-12 text-center">
              <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/40" />
              <h3 className="text-[14.5px] font-semibold mt-3">No projects found</h3>
              <p className="text-[13px] text-muted-foreground mt-1">
                Projects are auto-created when shipments include a PO or project reference.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
