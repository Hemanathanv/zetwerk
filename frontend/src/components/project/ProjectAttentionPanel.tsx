import { useLocation } from 'wouter';
import type { AttentionItem, ProjectDetailData } from '@/hooks/useProjectDetail';

const ATTENTION_ICONS: Record<string, string> = {
  DND_ACCRUING:      'ti-clock',
  DOCUMENTS_PENDING: 'ti-file-off',
  ETA_DELAYED:       'ti-calendar-x',
  GRN_PENDING:       'ti-receipt',
  MILESTONE_BLOCKED: 'ti-alert-circle',
  FINANCE_OVERDUE:   'ti-credit-card-off',
};

const SEVERITY_ACCENT: Record<string, string> = {
  danger:  'bg-red-500',
  warning: 'bg-amber-500',
  info:    'bg-blue-500',
};

const SEVERITY_BG: Record<string, string> = {
  danger:  'bg-red-50 dark:bg-red-950/20',
  warning: 'bg-amber-50 dark:bg-amber-950/20',
  info:    'bg-blue-50 dark:bg-blue-950/20',
};

const SEVERITY_ICON_COLOR: Record<string, string> = {
  danger:  'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-500',
  info:    'text-blue-600 dark:text-blue-400',
};

interface AttentionCardProps {
  item: AttentionItem;
  projectId: string;
  shipments: ProjectDetailData['shipments'];
  onNavigate: (shipmentId: string, index: number, projectContext: any) => void;
}

function AttentionCard({ item, projectId, shipments, onNavigate }: AttentionCardProps) {
  const index = item.shipmentId ? shipments.findIndex(s => s.id === item.shipmentId) : -1;
  const clickable = !!item.shipmentId;

  const handleClick = () => {
    if (!clickable || !item.shipmentId) return;
    onNavigate(item.shipmentId, index, { projectId, shipments });
  };

  return (
    <div
      onClick={clickable ? handleClick : undefined}
      className={`relative flex overflow-hidden rounded-lg border border-border ${SEVERITY_BG[item.severity]} ${clickable ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
    >
      {/* Left accent */}
      <div className={`w-[3px] shrink-0 rounded-l-lg ${SEVERITY_ACCENT[item.severity]}`} />

      <div className="flex items-start gap-3 p-3 flex-1 min-w-0">
        <i className={`ti ${ATTENTION_ICONS[item.type] ?? 'ti-alert-circle'} text-[18px] shrink-0 mt-0.5 ${SEVERITY_ICON_COLOR[item.severity]}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground leading-snug">{item.title}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{item.body}</div>
          {(item.shipmentRef || item.metaLabel) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {item.shipmentRef && (
                <span className="text-[11px] font-mono text-muted-foreground">{item.shipmentRef}</span>
              )}
              {item.metaLabel && (
                <span className={`text-[11px] font-medium ${SEVERITY_ICON_COLOR[item.severity]}`}>{item.metaLabel}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  attentionItems: AttentionItem[];
  project: ProjectDetailData['project'];
  shipments: ProjectDetailData['shipments'];
}

export function ProjectAttentionPanel({ attentionItems, project, shipments }: Props) {
  const [, navigate] = useLocation();

  if (attentionItems.length === 0) return null;

  const handleNavigate = (shipmentId: string, index: number, _ctx: any) => {
    navigate(`/shipments/${shipmentId}`, {
      state: {
        fromProject: {
          projectId:     project.id,
          projectRef:    project.projectCode,
          projectName:   project.projectName,
          projectStatus: project.status,
          shipmentIds:   shipments.map(s => s.id),
          shipmentIndex: index >= 0 ? index : 0,
        },
      },
    } as any);
  };

  return (
    <div className="mb-6">
      <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
        <i className="ti ti-alert-circle text-[14px] text-amber-500" />
        Needs attention
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-[11px] font-bold">
          {attentionItems.length}
        </span>
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {attentionItems.map((item, i) => (
          <AttentionCard
            key={`${item.type}-${item.shipmentId ?? i}`}
            item={item}
            projectId={project.id}
            shipments={shipments}
            onNavigate={handleNavigate}
          />
        ))}
      </div>
    </div>
  );
}
