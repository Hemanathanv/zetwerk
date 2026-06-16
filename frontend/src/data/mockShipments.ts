export type AlertVariant = 'danger' | 'warning' | 'info';
export type DocSlaStatus = 'breached' | 'on-track' | 'pending';

export type ShipmentRow = {
  id: string;
  bol: string;
  vessel: string;
  route: string;
  buyer: string;
  projectId: string;
  stage: string;
  stageVariant: 'transit' | 'port' | 'cleared' | 'blocked' | 'validated' | 'pending' | 'warning' | 'danger' | 'info';
  journeyPhase: number;
  loadMode?: string;
  incoterm?: string;
  docsComplete: number;
  docsTotal: number;
  docDanger: boolean;
  docNote: string;
  etaPort: string;
  etaDate: string;
  etaDays: string;
  alert: { text: string; variant: AlertVariant } | null;
  value: string;
  updatedMinsAgo: number;
};

export type ProjectRow = {
  id: string;
  projectName: string;
  clientRef: string;
  commodity: string;
  projectStatus: 'Active' | 'In Transit' | 'Blocked' | 'Completed';
  shipmentIds: string[];
};

export type DocSlaRow = {
  shipmentId: string;
  docType: string;
  note: string;
  dueLabel: string;
  status: DocSlaStatus;
};

export const ALERT_PILL: Record<AlertVariant, { bg: string; color: string }> = {
  danger: { bg: 'hsla(0,84%,60%,0.10)', color: 'hsl(0 84% 45%)' },
  warning: { bg: 'hsla(38,92%,50%,0.12)', color: 'hsl(38 92% 38%)' },
  info: { bg: 'hsla(217,91%,60%,0.10)', color: 'hsl(217 91% 42%)' },
};

export const PHASE_LABELS: Record<number, string> = {
  1: 'Booked',
  2: 'Departed India',
  3: 'Ocean transit',
  4: 'US port',
  5: 'Customs',
  6: 'Delivered',
};

export const PROJECTS: ProjectRow[] = [
  {
    id: 'PRJ-1001',
    projectName: 'Unimatics plant expansion',
    clientRef: 'UMX-0426',
    commodity: 'Machined assemblies',
    projectStatus: 'In Transit',
    shipmentIds: ['SHP-24091', 'SHP-24092', 'SHP-24093'],
  },
  {
    id: 'PRJ-1002',
    projectName: 'Apex turbine retrofit',
    clientRef: 'APX-1187',
    commodity: 'Turbine housings',
    projectStatus: 'Active',
    shipmentIds: ['SHP-24094', 'SHP-24095'],
  },
  {
    id: 'PRJ-1003',
    projectName: 'Northstar line tooling',
    clientRef: 'NST-7740',
    commodity: 'Tooling kits',
    projectStatus: 'Blocked',
    shipmentIds: ['SHP-24096'],
  },
  {
    id: 'PRJ-1004',
    projectName: 'Mariner spares program',
    clientRef: 'MRN-5521',
    commodity: 'Spare parts',
    projectStatus: 'Completed',
    shipmentIds: ['SHP-24097'],
  },
];

export const MOCK_SHIPMENTS: ShipmentRow[] = [
  {
    id: 'SHP-24091',
    bol: 'BOL-77821',
    vessel: 'Maersk Denver',
    route: 'Nhava Sheva -> New York',
    buyer: 'Unimatics Inc',
    projectId: 'PRJ-1001',
    stage: 'Ocean transit',
    stageVariant: 'info',
    journeyPhase: 3,
    loadMode: 'FCL',
    incoterm: 'CIF New York',
    docsComplete: 8,
    docsTotal: 10,
    docDanger: false,
    docNote: '2 docs pending validation',
    etaPort: 'NYC',
    etaDate: 'Jun 18',
    etaDays: '14 days',
    alert: { text: '2 docs', variant: 'warning' },
    value: '$84.2K',
    updatedMinsAgo: 9,
  },
  {
    id: 'SHP-24092',
    bol: 'BOL-77822',
    vessel: 'MSC Aria',
    route: 'Mundra -> Savannah',
    buyer: 'Unimatics Inc',
    projectId: 'PRJ-1001',
    stage: 'US customs',
    stageVariant: 'warning',
    journeyPhase: 5,
    loadMode: 'LCL',
    incoterm: 'DAP Atlanta',
    docsComplete: 9,
    docsTotal: 11,
    docDanger: true,
    docNote: 'Draft BOE breached SLA',
    etaPort: 'Savannah',
    etaDate: 'Jun 08',
    etaDays: 'Awaiting clearance',
    alert: { text: 'SLA', variant: 'danger' },
    value: '$126.8K',
    updatedMinsAgo: 18,
  },
  {
    id: 'SHP-24093',
    bol: 'BOL-77823',
    vessel: 'CMA Victoria',
    route: 'Chennai -> Norfolk',
    buyer: 'Unimatics Inc',
    projectId: 'PRJ-1001',
    stage: 'Booked',
    stageVariant: 'pending',
    journeyPhase: 1,
    loadMode: 'FCL',
    incoterm: 'FOB Chennai',
    docsComplete: 4,
    docsTotal: 9,
    docDanger: false,
    docNote: 'Export docs in progress',
    etaPort: '-',
    etaDate: '',
    etaDays: 'ETD pending',
    alert: null,
    value: '$58.4K',
    updatedMinsAgo: 44,
  },
  {
    id: 'SHP-24094',
    bol: 'BOL-77824',
    vessel: 'ONE Integrity',
    route: 'Nhava Sheva -> Houston',
    buyer: 'Apex Energy',
    projectId: 'PRJ-1002',
    stage: 'Departed India',
    stageVariant: 'info',
    journeyPhase: 2,
    loadMode: 'Break-bulk',
    incoterm: 'CFR Houston',
    docsComplete: 7,
    docsTotal: 10,
    docDanger: false,
    docNote: 'BL copy pending',
    etaPort: 'Houston',
    etaDate: 'Jun 24',
    etaDays: '20 days',
    alert: { text: 'BL', variant: 'warning' },
    value: '$212.0K',
    updatedMinsAgo: 31,
  },
  {
    id: 'SHP-24095',
    bol: 'BOL-77825',
    vessel: 'Hapag Lloyd Pearl',
    route: 'Mundra -> Los Angeles',
    buyer: 'Apex Energy',
    projectId: 'PRJ-1002',
    stage: 'US port',
    stageVariant: 'warning',
    journeyPhase: 4,
    loadMode: 'FCL',
    incoterm: 'CIF Los Angeles',
    docsComplete: 10,
    docsTotal: 10,
    docDanger: false,
    docNote: 'Ready for customs',
    etaPort: 'LAX',
    etaDate: 'Jun 05',
    etaDays: 'At port',
    alert: null,
    value: '$93.6K',
    updatedMinsAgo: 6,
  },
  {
    id: 'SHP-24096',
    bol: 'BOL-77826',
    vessel: 'Ever Summit',
    route: 'Kattupalli -> Newark',
    buyer: 'Northstar Works',
    projectId: 'PRJ-1003',
    stage: 'Exception',
    stageVariant: 'danger',
    journeyPhase: 3,
    loadMode: 'FCL',
    incoterm: 'DDP Newark',
    docsComplete: 5,
    docsTotal: 12,
    docDanger: true,
    docNote: 'CHA bill mismatch',
    etaPort: 'Newark',
    etaDate: 'Jun 21',
    etaDays: '17 days',
    alert: { text: 'Mismatch', variant: 'danger' },
    value: '$174.5K',
    updatedMinsAgo: 4,
  },
  {
    id: 'SHP-24097',
    bol: 'BOL-77827',
    vessel: 'OOCL Mumbai',
    route: 'Nhava Sheva -> Charleston',
    buyer: 'Mariner Systems',
    projectId: 'PRJ-1004',
    stage: 'Delivered',
    stageVariant: 'cleared',
    journeyPhase: 6,
    loadMode: 'LCL',
    incoterm: 'DAP Charleston',
    docsComplete: 11,
    docsTotal: 11,
    docDanger: false,
    docNote: 'Closed',
    etaPort: 'Charleston',
    etaDate: 'May 30',
    etaDays: 'Delivered',
    alert: null,
    value: '$41.9K',
    updatedMinsAgo: 52,
  },
];

export const MOCK_DOC_SLA: DocSlaRow[] = [
  { shipmentId: 'SHP-24092', docType: 'BOE', note: 'Draft bill of entry pending approval', dueLabel: '2d late', status: 'breached' },
  { shipmentId: 'SHP-24096', docType: 'CHA', note: 'CHA bill amount mismatch', dueLabel: '1d late', status: 'breached' },
  { shipmentId: 'SHP-24091', docType: 'PL', note: 'Packing list validation assigned', dueLabel: 'Today', status: 'on-track' },
  { shipmentId: 'SHP-24094', docType: 'BL', note: 'Carrier BL copy pending', dueLabel: 'Tomorrow', status: 'pending' },
  { shipmentId: 'SHP-24095', docType: 'ISF', note: 'ISF filing ready for review', dueLabel: 'Today', status: 'on-track' },
];
