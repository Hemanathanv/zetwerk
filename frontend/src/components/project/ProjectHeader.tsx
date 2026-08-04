import { useLocation } from 'wouter';
import type { ProjectDetailData } from '@/hooks/useProjectDetail';

const ICONS = {
  refresh:  'ti-refresh',
  folder:   'ti-folder',
  chevron:  'ti-chevron-right',
  edit:     'ti-pencil',
} as const;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:    'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  ON_HOLD:   'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  CANCELLED: 'bg-muted text-muted-foreground',
};

interface Props {
  project: ProjectDetailData['project'];
  loading: boolean;
  onRefresh: () => void;
  onEdit: () => void;
}

export function ProjectHeader({ project, loading, onRefresh, onEdit }: Props) {
  const [, navigate] = useLocation();

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
      <div className="min-w-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground mb-2 flex-wrap">
          <button
            onClick={() => navigate('/projects')}
            className="hover:text-foreground transition-colors"
          >
            Projects
          </button>
          <i className={`ti ${ICONS.chevron} text-[10px] opacity-40`} />
          <span className="font-mono text-foreground font-semibold">{project.projectCode}</span>
        </div>

        {/* Title row */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-mono font-semibold text-foreground" style={{ fontSize: 'var(--text-page-title-size, 22px)', lineHeight: 1.2, margin: 0 }}>
            {project.projectName && project.projectName !== project.projectCode
              ? project.projectName
              : project.projectCode}
          </h1>
          {project.status && (
            <span className={`text-[12px] font-medium px-2 py-0.5 rounded shrink-0 ${STATUS_STYLES[project.status] ?? 'bg-muted text-muted-foreground'}`}>
              {project.status.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {/* Sub-line */}
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground mt-1 flex-wrap">
          {project.customerName && (
            <span>Customer: <span className="font-medium text-foreground">{project.customerName}</span></span>
          )}
          {project.buyerOrgName && (
            <span>Buyer: <span className="font-medium text-foreground">{project.buyerOrgName}</span></span>
          )}
          {project.createdAt && (
            <span className="hidden md:inline">
              Created {new Date(project.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Refresh"
          className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          <i className={`ti ${ICONS.refresh} text-[14px] ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          onClick={onEdit}
          title="Edit project"
          className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 border rounded-lg hover:bg-muted transition-colors"
        >
          <i className={`ti ${ICONS.edit} text-[14px]`} />
          Edit
        </button>
      </div>
    </div>
  );
}
