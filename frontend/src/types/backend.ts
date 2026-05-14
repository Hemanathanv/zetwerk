export type SystemRole = "SUPER_ADMIN" | "ADMIN" | "USER";

export type DocType =
  | "SALES_INVOICE"
  | "BILL_OF_LADING"
  | "PACKING_LIST"
  | "ENTRY_SUMMARY"
  | "ENTRY_SUMMARY_TARIFF_LINES"
  | "OCEAN_FREIGHT"
  | "FREIGHT_FORWARDER_BILL"
  | "US_CARGO_RELEASE_ORDER"
  | "US_CUSTOMS_RELEASE_ORDER"
  | "US_DELIVERY_ORDER"
  | "US_PACKING_LIST"
  | "SHIPPING_BILL"
  | "CHA_BILL";

export const DOC_TYPE_OPTIONS: Array<{ value: DocType; label: string }> = [
  { value: "SALES_INVOICE", label: "Sales Invoice" },
  { value: "BILL_OF_LADING", label: "Bill Of Lading" },
  { value: "PACKING_LIST", label: "Packing List" },
  { value: "ENTRY_SUMMARY", label: "Entry Summary" },
  { value: "ENTRY_SUMMARY_TARIFF_LINES", label: "Entry Summary Tariff Lines" },
  { value: "OCEAN_FREIGHT", label: "Ocean Freight" },
  { value: "FREIGHT_FORWARDER_BILL", label: "Freight Forwarder Bill" },
  { value: "US_CARGO_RELEASE_ORDER", label: "US Cargo Release Order" },
  { value: "US_CUSTOMS_RELEASE_ORDER", label: "US Customs Release Order" },
  { value: "US_DELIVERY_ORDER", label: "US Delivery Order" },
  { value: "US_PACKING_LIST", label: "US Packing List" },
  { value: "SHIPPING_BILL", label: "Shipping Bill" },
  { value: "CHA_BILL", label: "CHA Bill" },
];

export type DocumentStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "EXTRACTED"
  | "REVIEWED"
  | "REJECTED"
  | "REPROCESSING"
  | "ARCHIVED";

export type ExtractionTaskStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "RETRYING";
export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  systemRole: SystemRole;
  isActive: boolean;
};

export type AuthStatusResponse = {
  status: string;
  user: AuthUser;
};

export type UserProfile = {
  id: string;
  userId: string;
  email: string;
  systemRole: SystemRole;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  timezone: string | null;
};

export type DocumentRecord = {
  id: string;
  docType: DocType;
  status: DocumentStatus;
  filePath: string;
  fileName: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  pageCount: number | null;
  isPDF: boolean;
  previewUrl: string | null;
};

export type DocumentPageRecord = {
  id: string;
  documentId: string;
  pageNo: number;
  bucket: string;
  objectKey: string;
  sizeBytes: number | null;
  rawText: string | null;
  isExtractionSource: boolean;
  createdAt: string;
  previewUrl: string | null;
};

export type SalesInvoiceExtractionRecord = {
  id: string;
  documentId: string;
  lineItems: Array<Record<string, JsonValue>> | null;
  rawData: JsonValue | null;
  extractedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type DocumentDetailRecord = {
  id: string;
  docType: DocType;
  status: DocumentStatus;
  bucket: string;
  objectKey: string;
  fileName: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  totalPages: number | null;
  uploadedBy: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  previewUrl: string | null;
  pages: DocumentPageRecord[];
  salesInvoiceExtraction: SalesInvoiceExtractionRecord | null;
};

export type AdminStorageFile = {
  key: string;
  name: string;
  sizeBytes: number;
  lastModified: string | null;
  downloadUrl: string;
  previewUrl: string | null;
  contentType: string | null;
};

export type AdminStorageListing = {
  bucket: string;
  prefix: string;
  breadcrumbs: string[];
  folders: string[];
  files: AdminStorageFile[];
};
