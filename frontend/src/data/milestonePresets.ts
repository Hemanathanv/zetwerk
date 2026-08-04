export interface PresetMilestone {
  name: string;
  type: 'AUTO' | 'MANUAL' | 'DOCUMENT';
  notifyRoles: string[];
  slaFromPreviousHrs: number | null;
  photoRequired: boolean;
}

export interface MilestonePreset {
  id: string;
  name: string;
  description: string;
  milestones: PresetMilestone[];
}

export const MILESTONE_PRESETS: MilestonePreset[] = [
  {
    id: 'break-bulk',
    name: 'Break Bulk',
    description: 'Standard break bulk (non-containerised) ocean freight from India to US port, then 3PL delivery.',
    milestones: [
      { name: 'Inventory recognized',        type: 'DOCUMENT', notifyRoles: ['ops_manager', 'india_logistics'], slaFromPreviousHrs: null, photoRequired: true  },
      { name: 'Vessel / truck departed',      type: 'AUTO',     notifyRoles: ['ops_manager', 'us_logistics'],    slaFromPreviousHrs: 48,   photoRequired: false },
      { name: 'Vessel arrived US port',       type: 'AUTO',     notifyRoles: ['us_logistics', 'ops_manager'],    slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Cargo discharged',             type: 'AUTO',     notifyRoles: ['us_logistics'],                   slaFromPreviousHrs: 24,   photoRequired: false },
      { name: 'Customs clearance initiated',  type: 'DOCUMENT', notifyRoles: ['us_logistics', 'us_broker'],      slaFromPreviousHrs: 48,   photoRequired: false },
      { name: 'Customs cleared',              type: 'DOCUMENT', notifyRoles: ['us_logistics', 'ops_manager'],    slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Cargo released to 3PL',        type: 'MANUAL',   notifyRoles: ['us_logistics'],                   slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Inward at 3PL',                type: 'MANUAL',   notifyRoles: ['us_logistics', 'ops_manager'],    slaFromPreviousHrs: 48,   photoRequired: true  },
      { name: 'In transit to customer',       type: 'MANUAL',   notifyRoles: ['ops_manager', 'customer_portal'], slaFromPreviousHrs: 72,   photoRequired: false },
      { name: 'Delivered',                    type: 'MANUAL',   notifyRoles: ['ops_manager', 'finance_revenue', 'customer_portal'], slaFromPreviousHrs: null, photoRequired: true },
    ],
  },
  {
    id: 'container-fcl',
    name: 'Container (FCL)',
    description: 'Full-container load ocean freight with D&D tracking, gate-out to 3PL, and outward movement.',
    milestones: [
      { name: 'Inventory recognized',        type: 'DOCUMENT', notifyRoles: ['ops_manager', 'india_logistics'],  slaFromPreviousHrs: null, photoRequired: true  },
      { name: 'Vessel departed',              type: 'AUTO',     notifyRoles: ['ops_manager', 'us_logistics'],     slaFromPreviousHrs: 24,   photoRequired: false },
      { name: 'Transshipment',                type: 'AUTO',     notifyRoles: ['us_logistics'],                    slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Vessel arrived US',            type: 'AUTO',     notifyRoles: ['us_logistics', 'ops_manager'],     slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Container discharged',         type: 'AUTO',     notifyRoles: ['us_logistics'],                    slaFromPreviousHrs: 24,   photoRequired: false },
      { name: 'Customs clearance initiated',  type: 'DOCUMENT', notifyRoles: ['us_logistics', 'us_broker'],       slaFromPreviousHrs: 48,   photoRequired: false },
      { name: 'Customs cleared',              type: 'DOCUMENT', notifyRoles: ['us_logistics', 'ops_manager'],     slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Gate out \u2014 to 3PL',       type: 'AUTO',     notifyRoles: ['us_logistics', 'tpl_partner'],     slaFromPreviousHrs: null, photoRequired: false },
      { name: 'D&D acknowledged',             type: 'MANUAL',   notifyRoles: ['finance_ap_us'],                   slaFromPreviousHrs: 24,   photoRequired: false },
      { name: 'Inward at 3PL',                type: 'MANUAL',   notifyRoles: ['us_logistics', 'ops_manager'],     slaFromPreviousHrs: 48,   photoRequired: true  },
      { name: 'Outward from 3PL',             type: 'MANUAL',   notifyRoles: ['us_logistics'],                    slaFromPreviousHrs: 24,   photoRequired: true  },
      { name: 'In transit to customer',       type: 'MANUAL',   notifyRoles: ['ops_manager', 'customer_portal'],  slaFromPreviousHrs: 72,   photoRequired: false },
      { name: 'Delivered',                    type: 'MANUAL',   notifyRoles: ['ops_manager', 'finance_revenue', 'customer_portal'], slaFromPreviousHrs: null, photoRequired: true },
    ],
  },
  {
    id: 'rail-inland',
    name: 'Rail (Inland)',
    description: 'Inland rail movement from origin ramp to 3PL delivery — import into any workflow template.',
    milestones: [
      { name: 'Inventory recognized',        type: 'DOCUMENT', notifyRoles: ['ops_manager', 'india_logistics'], slaFromPreviousHrs: null, photoRequired: true  },
      { name: 'Rail departure',               type: 'AUTO',     notifyRoles: ['ops_manager', 'us_logistics'],    slaFromPreviousHrs: 24,   photoRequired: false },
      { name: 'Rail in transit',              type: 'AUTO',     notifyRoles: ['us_logistics'],                   slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Arrived rail ramp',            type: 'AUTO',     notifyRoles: ['us_logistics', 'ops_manager'],    slaFromPreviousHrs: null, photoRequired: false },
      { name: 'Cargo discharged at ramp',     type: 'AUTO',     notifyRoles: ['us_logistics'],                   slaFromPreviousHrs: 24,   photoRequired: false },
      { name: 'Customs cleared',              type: 'DOCUMENT', notifyRoles: ['us_logistics', 'us_broker'],      slaFromPreviousHrs: 48,   photoRequired: false },
      { name: 'Inward at 3PL',                type: 'MANUAL',   notifyRoles: ['us_logistics', 'ops_manager'],    slaFromPreviousHrs: 48,   photoRequired: true  },
      { name: 'Delivered',                    type: 'MANUAL',   notifyRoles: ['ops_manager', 'finance_revenue', 'customer_portal'], slaFromPreviousHrs: null, photoRequired: true },
    ],
  },
];
