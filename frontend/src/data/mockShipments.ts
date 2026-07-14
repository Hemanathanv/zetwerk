export type StageVariant =
  | 'transit'
  | 'port'
  | 'cleared'
  | 'blocked'
  | 'validated'
  | 'pending'
  | 'warning'
  | 'danger'
  | 'info';

export type AlertVariant = 'danger' | 'warning';

export type ShipmentRow = {
  id: string;
  bol: string;
  shipper: string;
  buyer: string;
  vessel: string;
  route: string;
  stage: string;
  stageVariant: StageVariant;
  journeyPhase: number;
  loadMode: string | null;
  incoterm: string | null;
  docsComplete: number;
  docsTotal: number;
  docNote: string;
  docDanger?: boolean;
  etaPort: string;
  etaDate: string;
  etaDays: string;
  alert: { text: string; variant: AlertVariant } | null;
  value: string;
  updatedMinsAgo: number;
  projectId?: string;
};

export type ProjectStatus = 'Active' | 'In Transit' | 'Blocked' | 'Completed';

export interface Project {
  id: string;
  projectName: string;
  clientRef: string;
  origin: string;
  destination: string;
  commodity: string;
  projectStatus: ProjectStatus;
  shipmentIds: string[];
  createdAt: string;
}

export type DocSlaStatus = 'breached' | 'on-track' | 'pending';

export type DocSlaRow = {
  docType: string;
  shipmentId: string;
  status: DocSlaStatus;
  dueLabel: string;
  note: string;
};

// Empty by design. Operational screens must show real API data only.
export const PROJECTS: Project[] = [];
export const MOCK_SHIPMENTS: ShipmentRow[] = [];
export const MOCK_DOC_SLA: DocSlaRow[] = [];

export const ALERT_PILL: Record<AlertVariant, { bg: string; color: string }> = {
  danger: { bg: 'hsla(0,84%,60%,0.1)', color: 'hsl(0 84% 45%)' },
  warning: { bg: 'hsla(38,92%,50%,0.12)', color: 'hsl(38 92% 38%)' },
};

export const PHASE_LABELS = [
  '',
  'Booked',
  'Departed India',
  'Ocean transit',
  'US port',
  'Customs',
  'Delivered',
];
