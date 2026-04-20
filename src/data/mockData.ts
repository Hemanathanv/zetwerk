// ─── SHIPMENTS ────────────────────────────────────────────────────────────────

export type ShipmentStatus = 'In Transit' | 'Document Review' | 'Customs Cleared' | 'Exception' | 'Pending' | 'Closed';

export type Shipment = {
  id: string;
  invoiceNo: string;
  bol: string;
  bookingNo: string;
  carrier: string;
  stage: string;
  eta: string;
  status: ShipmentStatus;
};

export const shipments: Shipment[] = [
  { id: 'SH1001', invoiceNo: 'INV-2030', bol: 'BOL-77820', bookingNo: 'BK-99181', carrier: 'Evergreen', stage: 'Stage 1', eta: 'Apr 15', status: 'Closed' },
  { id: 'SH1002', invoiceNo: 'INV-2031', bol: 'BOL-77821', bookingNo: 'BK-99182', carrier: 'Maersk', stage: 'Stage 2', eta: 'Apr 18', status: 'In Transit' },
  { id: 'SH1003', invoiceNo: 'INV-2032', bol: 'BOL-77822', bookingNo: 'BK-99183', carrier: 'Hapag-Lloyd', stage: 'Stage 1', eta: 'Apr 21', status: 'Document Review' },
  { id: 'SH1004', invoiceNo: 'INV-2033', bol: 'BOL-77823', bookingNo: 'BK-99184', carrier: 'MSC', stage: 'Stage 3', eta: 'Apr 22', status: 'Customs Cleared' },
  { id: 'SH1005', invoiceNo: 'INV-2034', bol: 'BOL-77824', bookingNo: 'BK-99185', carrier: 'CMA CGM', stage: 'Stage 2', eta: 'Apr 24', status: 'In Transit' },
  { id: 'SH1006', invoiceNo: 'INV-2035', bol: 'BOL-77825', bookingNo: 'BK-99186', carrier: 'COSCO', stage: 'Stage 1', eta: 'Apr 26', status: 'Pending' },
  { id: 'SH1007', invoiceNo: 'INV-2036', bol: 'BOL-77826', bookingNo: 'BK-99187', carrier: 'ONE', stage: 'Stage 2', eta: 'Apr 28', status: 'Exception' },
  { id: 'SH1008', invoiceNo: 'INV-2037', bol: 'BOL-77827', bookingNo: 'BK-99188', carrier: 'Yang Ming', stage: 'Stage 3', eta: 'Apr 30', status: 'In Transit' },
];

// ─── TRACKING ─────────────────────────────────────────────────────────────────

export type TrackingEvent = {
  id: string;
  timestamp: string;
  location: string;
  event: string;
  isCompleted: boolean;
  isActive: boolean;
  icon: string;
};

export const trackingEvents: TrackingEvent[] = [
  { id: '1', timestamp: 'Mar 28, 09:12', location: 'Mumbai, India', event: 'Booking created', isCompleted: true, isActive: false, icon: 'FileCheck' },
  { id: '2', timestamp: 'Apr 01, 14:30', location: 'Mumbai, India', event: 'BOL received', isCompleted: true, isActive: false, icon: 'FileText' },
  { id: '3', timestamp: 'Apr 02, 11:00', location: 'JNPT Port, India', event: 'Container mapped: MSCU-7834521', isCompleted: true, isActive: false, icon: 'Package' },
  { id: '4', timestamp: 'Apr 03, 06:45', location: 'JNPT Port, India', event: 'Vessel departed India port', isCompleted: true, isActive: false, icon: 'Ship' },
  { id: '5', timestamp: 'Apr 08, 19:20', location: 'Colombo, Sri Lanka', event: 'Arrived at transshipment hub', isCompleted: true, isActive: false, icon: 'Anchor' },
  { id: '6', timestamp: 'Apr 14, 08:55', location: 'Port of Long Beach, USA', event: 'Reached US port', isCompleted: true, isActive: false, icon: 'MapPin' },
  { id: '7', timestamp: 'Apr 16, 10:00', location: 'Port of Long Beach, USA', event: 'Customs clearance in progress', isCompleted: false, isActive: true, icon: 'Shield' },
  { id: '8', timestamp: 'Est. Apr 19', location: 'Los Angeles, USA', event: 'Released for warehouse transfer', isCompleted: false, isActive: false, icon: 'Truck' },
];

export type ShipmentTracking = {
  shipmentId: string;
  vessel: string;
  container: string;
  origin: string;
  destination: string;
  currentLocation: string;
  lastEvent: string;
  lastEventTime: string;
  progress: number;
  etaStatus: 'On Time' | 'Delayed' | 'Early';
  carrier: string;
  eta: string;
  status: ShipmentStatus;
};

export const shipmentTrackings: ShipmentTracking[] = [
  { shipmentId: 'SH1001', vessel: 'Ever Given', container: 'EGHU-4421003', origin: 'JNPT, India', destination: 'Los Angeles, USA', currentLocation: 'Los Angeles, USA', lastEvent: 'Shipment closed — POD received', lastEventTime: 'Apr 15, 14:00', progress: 100, etaStatus: 'On Time', carrier: 'Evergreen', eta: 'Apr 15', status: 'Closed' },
  { shipmentId: 'SH1002', vessel: 'Maersk Seletar', container: 'MSCU-7834521', origin: 'JNPT, India', destination: 'Long Beach, USA', currentLocation: 'Port of Long Beach, USA', lastEvent: 'Customs clearance in progress', lastEventTime: 'Apr 16, 10:00', progress: 72, etaStatus: 'On Time', carrier: 'Maersk', eta: 'Apr 18', status: 'In Transit' },
  { shipmentId: 'SH1003', vessel: 'Hapag Express', container: 'HLCU-2299134', origin: 'JNPT, India', destination: 'New York, USA', currentLocation: 'JNPT, India', lastEvent: 'Awaiting DDS and BOL confirmation', lastEventTime: 'Apr 17, 09:15', progress: 18, etaStatus: 'On Time', carrier: 'Hapag-Lloyd', eta: 'Apr 21', status: 'Document Review' },
  { shipmentId: 'SH1004', vessel: 'MSC Allegra', container: 'MSCU-9918773', origin: 'JNPT, India', destination: 'Houston, USA', currentLocation: 'Houston Port, USA', lastEvent: 'Customs cleared — Ready for delivery', lastEventTime: 'Apr 18, 11:30', progress: 85, etaStatus: 'Early', carrier: 'MSC', eta: 'Apr 22', status: 'Customs Cleared' },
  { shipmentId: 'SH1005', vessel: 'CMA CGM Titus', container: 'CMAU-3344218', origin: 'Mundra, India', destination: 'Long Beach, USA', currentLocation: 'Arabian Sea', lastEvent: 'Vessel en route — mid-ocean', lastEventTime: 'Apr 17, 06:00', progress: 45, etaStatus: 'On Time', carrier: 'CMA CGM', eta: 'Apr 24', status: 'In Transit' },
  { shipmentId: 'SH1006', vessel: 'COSCO Universe', container: 'COSU-7712209', origin: 'Chennai, India', destination: 'Seattle, USA', currentLocation: 'Chennai Port, India', lastEvent: 'Waiting for booking confirmation', lastEventTime: 'Apr 17, 08:45', progress: 5, etaStatus: 'On Time', carrier: 'COSCO', eta: 'Apr 26', status: 'Pending' },
  { shipmentId: 'SH1007', vessel: 'ONE Stork', container: 'ONEY-8821004', origin: 'JNPT, India', destination: 'Miami, USA', currentLocation: 'Colombo, Sri Lanka', lastEvent: 'Container hold placed by customs', lastEventTime: 'Apr 16, 22:00', progress: 38, etaStatus: 'Delayed', carrier: 'ONE', eta: 'Apr 28', status: 'Exception' },
  { shipmentId: 'SH1008', vessel: 'YM Warranty', container: 'YMLU-6634401', origin: 'Nhava Sheva, India', destination: 'Los Angeles, USA', currentLocation: 'Singapore Transshipment Hub', lastEvent: 'Transshipment completed', lastEventTime: 'Apr 17, 15:20', progress: 60, etaStatus: 'On Time', carrier: 'Yang Ming', eta: 'Apr 30', status: 'In Transit' },
];

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

export type DocStatus = 'Completed' | 'TBP' | 'Confirming' | 'Yet to receive' | 'Exception';

export type Document = {
  id: string;
  name: string;
  group: 'india' | 'us';
  uploadStatus: DocStatus;
  ocrStatus: DocStatus;
  validationOwner: string;
  finalStatus: DocStatus;
  shipmentId: string;
  lastUpdated: string;
};

export const documents: Document[] = [
  { id: 'd1',  name: 'Sales Invoice',             group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'Finance',   finalStatus: 'Completed',      shipmentId: 'SH1002', lastUpdated: 'Apr 16, 10:45' },
  { id: 'd2',  name: 'Packing List (PL)',          group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'Ops',       finalStatus: 'Completed',      shipmentId: 'SH1002', lastUpdated: 'Apr 16, 10:52' },
  { id: 'd3',  name: 'DDS',                        group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Confirming',     validationOwner: 'CHA',       finalStatus: 'Confirming',     shipmentId: 'SH1002', lastUpdated: 'Apr 16, 11:10' },
  { id: 'd4',  name: 'SSD Metal Content',          group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'QA',        finalStatus: 'Completed',      shipmentId: 'SH1002', lastUpdated: 'Apr 16, 11:30' },
  { id: 'd5',  name: 'Shipping Bill',              group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'CHA',       finalStatus: 'Completed',      shipmentId: 'SH1002', lastUpdated: 'Apr 16, 12:00' },
  { id: 'd6',  name: 'Ocean Freight',              group: 'india', uploadStatus: 'Completed',      ocrStatus: 'TBP',            validationOwner: 'Finance',   finalStatus: 'TBP',            shipmentId: 'SH1002', lastUpdated: 'Apr 16, 12:05' },
  { id: 'd7',  name: 'Freight Forwarder Bill',     group: 'india', uploadStatus: 'Completed',      ocrStatus: 'TBP',            validationOwner: 'Finance',   finalStatus: 'TBP',            shipmentId: 'SH1002', lastUpdated: 'Apr 16, 12:10' },
  { id: 'd8',  name: 'CHA Bills',                  group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Yet to receive', validationOwner: 'Finance',   finalStatus: 'Yet to receive', shipmentId: 'SH1002', lastUpdated: 'Apr 16, 12:15' },
  { id: 'd9',  name: 'BOL',                        group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'Ops',       finalStatus: 'Completed',      shipmentId: 'SH1002', lastUpdated: 'Apr 16, 12:20' },
  { id: 'd10', name: 'BOE',                        group: 'us',    uploadStatus: 'Completed',      ocrStatus: 'Confirming',     validationOwner: 'US Broker', finalStatus: 'Confirming',     shipmentId: 'SH1002', lastUpdated: 'Apr 17, 11:20' },
  { id: 'd11', name: 'US Cargo Release Order',     group: 'us',    uploadStatus: 'TBP',            ocrStatus: 'TBP',            validationOwner: 'US Broker', finalStatus: 'TBP',            shipmentId: 'SH1002', lastUpdated: 'Apr 17, 11:25' },
  { id: 'd12', name: 'US Customs Release Order',   group: 'us',    uploadStatus: 'TBP',            ocrStatus: 'TBP',            validationOwner: 'US Broker', finalStatus: 'TBP',            shipmentId: 'SH1002', lastUpdated: 'Apr 17, 11:30' },
  { id: 'd13', name: 'ISF',                        group: 'us',    uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'US Broker', finalStatus: 'Completed',      shipmentId: 'SH1002', lastUpdated: 'Apr 17, 09:30' },
  { id: 'd14', name: 'Delivery Order',             group: 'us',    uploadStatus: 'Yet to receive', ocrStatus: 'Yet to receive', validationOwner: '3PL',       finalStatus: 'Yet to receive', shipmentId: 'SH1002', lastUpdated: '—' },
  { id: 'd15', name: 'GRN',                        group: 'us',    uploadStatus: 'Yet to receive', ocrStatus: 'Yet to receive', validationOwner: 'Warehouse',  finalStatus: 'Yet to receive', shipmentId: 'SH1002', lastUpdated: '—' },
  { id: 'd16', name: 'Sales Invoice',              group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'Finance',   finalStatus: 'Completed',      shipmentId: 'SH1003', lastUpdated: 'Apr 15, 09:00' },
  { id: 'd17', name: 'Packing List (PL)',          group: 'india', uploadStatus: 'Completed',      ocrStatus: 'Exception',      validationOwner: 'Ops',       finalStatus: 'Exception',      shipmentId: 'SH1003', lastUpdated: 'Apr 15, 09:30' },
  { id: 'd18', name: 'DDS',                        group: 'india', uploadStatus: 'Yet to receive', ocrStatus: 'Yet to receive', validationOwner: 'CHA',       finalStatus: 'Yet to receive', shipmentId: 'SH1003', lastUpdated: '—' },
  { id: 'd19', name: 'BOL',                        group: 'india', uploadStatus: 'TBP',            ocrStatus: 'TBP',            validationOwner: 'Ops',       finalStatus: 'TBP',            shipmentId: 'SH1003', lastUpdated: 'Apr 17, 08:00' },
  { id: 'd20', name: 'ISF',                        group: 'us',    uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'US Broker', finalStatus: 'Completed',      shipmentId: 'SH1004', lastUpdated: 'Apr 14, 14:00' },
  { id: 'd21', name: 'BOE',                        group: 'us',    uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'US Broker', finalStatus: 'Completed',      shipmentId: 'SH1004', lastUpdated: 'Apr 17, 10:00' },
  { id: 'd22', name: 'US Customs Release Order',   group: 'us',    uploadStatus: 'Completed',      ocrStatus: 'Completed',      validationOwner: 'US Broker', finalStatus: 'Completed',      shipmentId: 'SH1004', lastUpdated: 'Apr 18, 11:00' },
];

// ─── INVOICES ─────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'Approved' | 'Pending' | 'Exception' | 'Paid';

export type Invoice = {
  id: string;
  invoiceNo: string;
  shipmentId: string;
  vendor: string;
  buyer: string;
  value: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  paymentTerms: string;
  type: 'Sales' | 'Freight' | 'CHA' | 'Forwarder';
};

export const invoices: Invoice[] = [
  { id: 'i1',  invoiceNo: 'INV-2030', shipmentId: 'SH1001', vendor: 'Zetwerk Mfg Ltd',       buyer: 'Unimatics Inc',      value: '$71,400.00', currency: 'USD', issueDate: 'Mar 20', dueDate: 'Apr 19', status: 'Paid',      paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i2',  invoiceNo: 'INV-2031', shipmentId: 'SH1002', vendor: 'Zetwerk Mfg Ltd',       buyer: 'Unimatics Inc',      value: '$84,250.00', currency: 'USD', issueDate: 'Apr 01', dueDate: 'May 01', status: 'Approved',  paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i3',  invoiceNo: 'INV-2032', shipmentId: 'SH1003', vendor: 'MSD Components',        buyer: 'GlobalParts Corp',   value: '$38,900.00', currency: 'USD', issueDate: 'Apr 05', dueDate: 'May 05', status: 'Pending',   paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i4',  invoiceNo: 'INV-2033', shipmentId: 'SH1004', vendor: 'Zetwerk Mfg Ltd',       buyer: 'ProTech Solutions',  value: '$62,750.00', currency: 'USD', issueDate: 'Apr 08', dueDate: 'May 08', status: 'Approved',  paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i5',  invoiceNo: 'INV-2034', shipmentId: 'SH1005', vendor: 'Precision Parts Ltd',   buyer: 'Unimatics Inc',      value: '$47,300.00', currency: 'USD', issueDate: 'Apr 10', dueDate: 'May 10', status: 'Approved',  paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i6',  invoiceNo: 'INV-2035', shipmentId: 'SH1006', vendor: 'MSD Components',        buyer: 'AutoVision LLC',     value: '$29,800.00', currency: 'USD', issueDate: 'Apr 12', dueDate: 'May 12', status: 'Pending',   paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i7',  invoiceNo: 'INV-2036', shipmentId: 'SH1007', vendor: 'Zetwerk Mfg Ltd',       buyer: 'TechImports USA',    value: '$93,100.00', currency: 'USD', issueDate: 'Apr 13', dueDate: 'May 13', status: 'Exception', paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i8',  invoiceNo: 'INV-2037', shipmentId: 'SH1008', vendor: 'Precision Parts Ltd',   buyer: 'ProTech Solutions',  value: '$55,620.00', currency: 'USD', issueDate: 'Apr 15', dueDate: 'May 15', status: 'Approved',  paymentTerms: 'Net 30', type: 'Sales' },
  { id: 'i9',  invoiceNo: 'FRT-1021', shipmentId: 'SH1002', vendor: 'Maersk Line',           buyer: 'Unimatics Inc',      value: '$4,200.00',  currency: 'USD', issueDate: 'Apr 02', dueDate: 'Apr 17', status: 'Approved',  paymentTerms: 'Prepaid', type: 'Freight' },
  { id: 'i10', invoiceNo: 'FRT-1022', shipmentId: 'SH1003', vendor: 'Hapag-Lloyd',           buyer: 'GlobalParts Corp',   value: '$3,850.00',  currency: 'USD', issueDate: 'Apr 06', dueDate: 'Apr 21', status: 'Pending',   paymentTerms: 'Prepaid', type: 'Freight' },
  { id: 'i11', invoiceNo: 'CHA-0081', shipmentId: 'SH1002', vendor: 'Rajan Logistics',       buyer: 'Unimatics Inc',      value: '$1,250.00',  currency: 'USD', issueDate: 'Apr 03', dueDate: 'Apr 18', status: 'Pending',   paymentTerms: 'Net 15', type: 'CHA' },
  { id: 'i12', invoiceNo: 'FFB-0044', shipmentId: 'SH1002', vendor: 'Bolloré Logistics',     buyer: 'Unimatics Inc',      value: '$2,100.00',  currency: 'USD', issueDate: 'Apr 04', dueDate: 'Apr 19', status: 'Approved',  paymentTerms: 'Net 15', type: 'Forwarder' },
];

// ─── ACTIVITY / NOTIFICATIONS ─────────────────────────────────────────────────

export type ActivityEvent = {
  id: string;
  timestamp: string;
  event: string;
  actor: string;
  type: 'import' | 'upload' | 'ocr' | 'validation' | 'system' | 'customs';
};

export const activityEvents: ActivityEvent[] = [
  { id: 'a1',  timestamp: 'Apr 16, 10:32', event: 'Invoice imported from Zetwerk',           actor: 'System',      type: 'import' },
  { id: 'a2',  timestamp: 'Apr 16, 10:45', event: 'Packing List uploaded',                   actor: 'Ramesh K.',   type: 'upload' },
  { id: 'a3',  timestamp: 'Apr 16, 11:02', event: 'DDS uploaded',                            actor: 'Ramesh K.',   type: 'upload' },
  { id: 'a4',  timestamp: 'Apr 16, 12:15', event: 'BOL received from port',                  actor: 'System',      type: 'import' },
  { id: 'a5',  timestamp: 'Apr 16, 12:20', event: 'OCR completed for Sales Invoice',         actor: 'AI Engine',   type: 'ocr' },
  { id: 'a6',  timestamp: 'Apr 16, 14:05', event: 'CSO validated packing list',              actor: 'Priya S.',    type: 'validation' },
  { id: 'a7',  timestamp: 'Apr 16, 15:30', event: 'Outward GRN created in MSD',              actor: 'System',      type: 'system' },
  { id: 'a8',  timestamp: 'Apr 17, 09:00', event: 'Shipsy tracking activated',               actor: 'System',      type: 'system' },
  { id: 'a9',  timestamp: 'Apr 17, 11:20', event: 'Draft BOE created',                       actor: 'US Broker',   type: 'customs' },
  { id: 'a10', timestamp: 'Apr 17, 14:00', event: 'US customs release pending',              actor: 'System',      type: 'customs' },
];

export type Notification = {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  type: 'alert' | 'info' | 'warning' | 'success';
  shipmentId: string;
  isRead: boolean;
};

export const notifications: Notification[] = [
  { id: 'n1',  timestamp: 'Apr 17, 14:00', title: 'US Customs Release Pending',       description: 'SH1002 — Customs hold at Port of Long Beach. Action required from US broker.',        type: 'alert',   shipmentId: 'SH1002', isRead: false },
  { id: 'n2',  timestamp: 'Apr 17, 13:30', title: 'Exception Raised on SH1007',       description: 'Container hold placed at Colombo transshipment hub by customs inspection.',            type: 'alert',   shipmentId: 'SH1007', isRead: false },
  { id: 'n3',  timestamp: 'Apr 17, 12:00', title: 'DDS OCR Under Review',             description: 'SH1002 — DDS document OCR output is being confirmed by the CHA agent.',              type: 'warning', shipmentId: 'SH1002', isRead: false },
  { id: 'n4',  timestamp: 'Apr 17, 11:20', title: 'Draft BOE Created',                description: 'SH1002 — US Broker has created a draft Bill of Entry for review.',                   type: 'info',    shipmentId: 'SH1002', isRead: false },
  { id: 'n5',  timestamp: 'Apr 17, 09:00', title: 'Shipsy Tracking Activated',        description: 'SH1002 — Real-time tracking enabled via Shipsy. Vessel: Maersk Seletar.',            type: 'success', shipmentId: 'SH1002', isRead: true },
  { id: 'n6',  timestamp: 'Apr 16, 15:30', title: 'Outward GRN Created in MSD',       description: 'SH1002 — GRN successfully posted to MSD system by automated workflow.',              type: 'success', shipmentId: 'SH1002', isRead: true },
  { id: 'n7',  timestamp: 'Apr 16, 14:05', title: 'Packing List Validated',           description: 'SH1002 — Packing List OCR output validated by Priya S. (CSO team).',                type: 'success', shipmentId: 'SH1002', isRead: true },
  { id: 'n8',  timestamp: 'Apr 16, 12:20', title: 'OCR Completed — Sales Invoice',    description: 'SH1002 — OCR extraction complete with 98.4% confidence. Review extracted fields.', type: 'info',    shipmentId: 'SH1002', isRead: true },
  { id: 'n9',  timestamp: 'Apr 15, 16:45', title: 'Shipment SH1001 Closed',           description: 'SH1001 — POD received and validated. Shipment fully closed in system.',             type: 'success', shipmentId: 'SH1001', isRead: true },
  { id: 'n10', timestamp: 'Apr 15, 11:00', title: 'SH1003 — DDS Not Received',        description: 'SH1003 — DDS document still not received from CHA. Departure is in 4 days.',        type: 'warning', shipmentId: 'SH1003', isRead: true },
];
