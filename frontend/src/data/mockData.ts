export type Shipment = {
  id: string;
  invoiceNo: string;
  bol: string;
  bookingNo: string;
  carrier: string;
  stage: string;
  eta: string;
  status: string;
};

export type TrackingEvent = {
  id: string;
  icon: string;
  event: string;
  location: string;
  timestamp: string;
  isCompleted: boolean;
  isActive: boolean;
};

export type Document = {
  id: string;
  name: string;
  group: 'india' | 'us';
  uploadStatus: string;
  ocrStatus: string;
  validationOwner: string;
  finalStatus: string;
};

export type ActivityEvent = {
  id: string;
  type: 'import' | 'upload' | 'ocr' | 'validation' | 'system' | 'customs';
  event: string;
  timestamp: string;
  actor: string;
};

export type Invoice = {
  id: string;
  invoiceNo: string;
  shipmentId: string;
  type: 'Sales' | 'Freight' | 'CHA' | 'Forwarder';
  vendor: string;
  buyer: string;
  value: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  status: 'Approved' | 'Pending' | 'Exception' | 'Paid';
};

export type Notification = {
  id: string;
  type: 'alert' | 'warning' | 'info' | 'success';
  title: string;
  description: string;
  timestamp: string;
  shipmentId: string;
  isRead: boolean;
};

export const shipments: Shipment[] = [
  {
    id: 'SHP-24091',
    invoiceNo: 'INV-2031',
    bol: 'BOL-77821',
    bookingNo: 'BK-99182',
    carrier: 'Maersk',
    stage: 'Ocean transit',
    eta: 'Jun 18',
    status: 'In Transit',
  },
  {
    id: 'SHP-24092',
    invoiceNo: 'INV-2032',
    bol: 'BOL-77822',
    bookingNo: 'BK-99183',
    carrier: 'MSC',
    stage: 'US customs',
    eta: 'Jun 08',
    status: 'Document Review',
  },
  {
    id: 'SHP-24096',
    invoiceNo: 'INV-2036',
    bol: 'BOL-77826',
    bookingNo: 'BK-99188',
    carrier: 'Evergreen',
    stage: 'Exception review',
    eta: 'Jun 21',
    status: 'Exception',
  },
  {
    id: 'SHP-24097',
    invoiceNo: 'INV-2037',
    bol: 'BOL-77827',
    bookingNo: 'BK-99189',
    carrier: 'OOCL',
    stage: 'Delivered',
    eta: 'May 30',
    status: 'Closed',
  },
];

export const trackingEvents: TrackingEvent[] = [
  { id: 'trk-1', icon: 'FileCheck', event: 'Booking confirmed', location: 'Bengaluru, IN', timestamp: 'May 21', isCompleted: true, isActive: false },
  { id: 'trk-2', icon: 'Package', event: 'Cargo gated in', location: 'Nhava Sheva, IN', timestamp: 'May 25', isCompleted: true, isActive: false },
  { id: 'trk-3', icon: 'Ship', event: 'Vessel departed', location: 'Arabian Sea', timestamp: 'May 28', isCompleted: true, isActive: false },
  { id: 'trk-4', icon: 'Anchor', event: 'Vessel in transit', location: 'Pacific corridor', timestamp: 'Live', isCompleted: false, isActive: true },
  { id: 'trk-5', icon: 'Shield', event: 'Customs clearance', location: 'New York, US', timestamp: 'Pending', isCompleted: false, isActive: false },
  { id: 'trk-6', icon: 'Truck', event: 'Final delivery', location: 'Customer site', timestamp: 'Pending', isCompleted: false, isActive: false },
];

export const documents: Document[] = [
  { id: 'doc-1', name: 'Sales Invoice', group: 'india', uploadStatus: 'Completed', ocrStatus: 'Completed', validationOwner: 'Ops', finalStatus: 'Approved' },
  { id: 'doc-2', name: 'Packing List', group: 'india', uploadStatus: 'Completed', ocrStatus: 'In Review', validationOwner: 'Docs', finalStatus: 'Pending' },
  { id: 'doc-3', name: 'Shipping Bill', group: 'india', uploadStatus: 'Completed', ocrStatus: 'Completed', validationOwner: 'CHA', finalStatus: 'Approved' },
  { id: 'doc-4', name: 'Bill of Lading', group: 'india', uploadStatus: 'Pending', ocrStatus: 'Not Received', validationOwner: 'Carrier', finalStatus: 'Pending' },
  { id: 'doc-5', name: 'Draft Bill of Entry', group: 'us', uploadStatus: 'Completed', ocrStatus: 'In Review', validationOwner: 'Broker', finalStatus: 'Exception' },
  { id: 'doc-6', name: 'Cargo Release Order', group: 'us', uploadStatus: 'Yet to receive', ocrStatus: 'Not Received', validationOwner: 'Broker', finalStatus: 'Pending' },
];

export const activityEvents: ActivityEvent[] = [
  { id: 'act-1', type: 'import', event: 'Shipment imported from Zetwerk ERP', timestamp: 'May 21, 09:10', actor: 'System' },
  { id: 'act-2', type: 'upload', event: 'Sales invoice uploaded', timestamp: 'May 21, 10:42', actor: 'Hemanathan' },
  { id: 'act-3', type: 'ocr', event: 'OCR extraction completed at 98.4% confidence', timestamp: 'May 21, 10:45', actor: 'OCR service' },
  { id: 'act-4', type: 'validation', event: 'Packing list moved to review', timestamp: 'May 22, 14:05', actor: 'Docs team' },
  { id: 'act-5', type: 'customs', event: 'Draft BOE requested by broker', timestamp: 'May 30, 16:20', actor: 'Broker portal' },
];

export const invoices: Invoice[] = [
  {
    id: 'inv-1',
    invoiceNo: 'INV-2031',
    shipmentId: 'SHP-24091',
    type: 'Sales',
    vendor: 'Zetwerk Manufacturing',
    buyer: 'Unimatics Inc',
    value: '$84,250.00',
    issueDate: 'May 21',
    dueDate: 'Jun 20',
    paymentTerms: 'Net 30',
    status: 'Approved',
  },
  {
    id: 'inv-2',
    invoiceNo: 'FR-5518',
    shipmentId: 'SHP-24094',
    type: 'Freight',
    vendor: 'Bollore Logistics',
    buyer: 'Zetwerk Manufacturing',
    value: '$12,840.00',
    issueDate: 'May 25',
    dueDate: 'Jun 10',
    paymentTerms: 'Net 15',
    status: 'Pending',
  },
  {
    id: 'inv-3',
    invoiceNo: 'CHA-0911',
    shipmentId: 'SHP-24096',
    type: 'CHA',
    vendor: 'Rajan Logistics',
    buyer: 'Zetwerk Manufacturing',
    value: '$3,420.00',
    issueDate: 'May 28',
    dueDate: 'Jun 04',
    paymentTerms: 'Due on receipt',
    status: 'Exception',
  },
  {
    id: 'inv-4',
    invoiceNo: 'FW-8820',
    shipmentId: 'SHP-24097',
    type: 'Forwarder',
    vendor: 'OOCL',
    buyer: 'Zetwerk Manufacturing',
    value: '$9,760.00',
    issueDate: 'May 12',
    dueDate: 'May 29',
    paymentTerms: 'Net 15',
    status: 'Paid',
  },
];

export const notifications: Notification[] = [
  {
    id: 'ntf-1',
    type: 'alert',
    title: 'Draft BOE SLA breached',
    description: 'SHP-24092 needs broker approval before customs filing can continue.',
    timestamp: '12m ago',
    shipmentId: 'SHP-24092',
    isRead: false,
  },
  {
    id: 'ntf-2',
    type: 'warning',
    title: 'BL copy pending',
    description: 'Carrier document is expected before the next validation checkpoint.',
    timestamp: '45m ago',
    shipmentId: 'SHP-24094',
    isRead: false,
  },
  {
    id: 'ntf-3',
    type: 'info',
    title: 'Extraction completed',
    description: 'Sales invoice extraction completed and is ready for review.',
    timestamp: '2h ago',
    shipmentId: 'SHP-24091',
    isRead: true,
  },
  {
    id: 'ntf-4',
    type: 'success',
    title: 'Shipment delivered',
    description: 'SHP-24097 reached the customer site and was marked closed.',
    timestamp: '1d ago',
    shipmentId: 'SHP-24097',
    isRead: true,
  },
];
