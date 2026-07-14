export type ActivityEvent = {
  id: string;
  type: 'import' | 'upload' | 'ocr' | 'validation' | 'system' | 'customs';
  event: string;
  timestamp: string;
  actor: string;
};

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

export type Document = {
  id: string;
  name: string;
  type: string;
  group: 'india' | 'us';
  shipmentId: string;
  status: string;
  uploadStatus: string;
  ocrStatus: string;
  finalStatus: string;
  validationOwner: string;
  uploadedAt: string;
  lastUpdated: string;
};

export type TrackingEvent = {
  id: string;
  icon: string;
  label: string;
  event: string;
  location: string;
  timestamp: string;
  isCompleted: boolean;
  isActive: boolean;
};

export type ShipmentTracking = {
  id: string;
  shipmentId: string;
  origin: string;
  destination: string;
  carrier: string;
  vessel: string;
  container: string;
  status: string;
  etaStatus: string;
  eta: string;
  pol: string;
  pod: string;
  progress: number;
  currentLocation: string;
  lastEvent: string;
  lastEventTime: string;
};

export type Invoice = {
  id: string;
  invoiceNo: string;
  shipmentId: string;
  type: 'Sales' | 'Freight' | 'CHA' | 'Forwarder';
  value: string;
  status: 'Pending' | 'Approved' | 'Exception' | 'Paid';
  date: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: string;
  vendor: string;
  buyer: string;
};

export type Notification = {
  id: string;
  type: 'alert' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  description: string;
  shipmentId: string;
  timestamp: string;
  isRead: boolean;
};

export const shipments: Shipment[] = [];
export const activityEvents: ActivityEvent[] = [];
export const documents: Document[] = [];
export const trackingEvents: TrackingEvent[] = [];
export const shipmentTrackings: ShipmentTracking[] = [];
export const invoices: Invoice[] = [];
export const notifications: Notification[] = [];
