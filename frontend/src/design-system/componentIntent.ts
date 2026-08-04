export const componentIntentGuide = {
  kpiCard: {
    dashboard: {
      hasIcon: true,
      hasSubMetrics: true,
      subMetricCount: 2,
      hasTrend: false,
      exception: 'D&D Exposure uses one sub-metric.',
    },
    detailPages: {
      hasIcon: false,
      hasSubMetrics: false,
      hasTrend: 'Only when trend-over-time is relevant.',
    },
  },
  badge: {
    rule: 'Route raw statuses through statusToIntent before rendering a Badge.',
  },
  controls: {
    toggle: 'Module and feature on/off settings.',
    checkbox: 'True multi-select only.',
    radio: 'Mutually exclusive single-select options.',
  },
} as const;

export type EwmsIntent =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'active'
  | 'draft'
  | 'neutral';

export const statusToIntent: Record<string, EwmsIntent> = {
  draft: 'draft',
  're-trigger generation': 'draft',
  'pending approval': 'warning',
  'pending revalidation': 'warning',
  'pending review': 'warning',
  'in review': 'warning',
  'hold/resume': 'warning',
  'ocr processing': 'info',
  'validation in progress': 'info',
  'confirmed out': 'info',
  approved: 'success',
  validated: 'success',
  'validated (override)': 'success',
  mapped: 'success',
  delivered: 'success',
  completed: 'success',
  active: 'active',
  custom: 'active',
  system: 'info',
  uploaded: 'success',
  extracted: 'success',
  amended: 'success',
  generated: 'success',
  reserved: 'success',
  returned: 'success',
  rejected: 'danger',
  discarded: 'danger',
  'dispatch rejected': 'danger',
  'validation blocked': 'danger',
  'validation warning': 'danger',
  blocked: 'danger',
  inactive: 'neutral',
  archived: 'neutral',
};

export function intentForStatus(status: string): EwmsIntent {
  return statusToIntent[status.trim().toLowerCase()] ?? 'neutral';
}
