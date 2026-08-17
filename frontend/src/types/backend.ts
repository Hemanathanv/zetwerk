export type SystemRole = "SUPER_ADMIN" | "ADMIN" | "USER";

export type DocType =
  | "SALES_INVOICE"
  | "BILL_OF_LADING"
  | "PACKING_LIST"
  | "ENTRY_SUMMARY"
  | "DRAFT_CBP_FORM_7501_BROKER"
  | "OCEAN_FREIGHT"
  | "FREIGHT_FORWARDER_BILL"
  | "CUSTOMER_BROKER_BILL"
  | "GRN_INBOUND"
  | "PORT_TO_WH"
  | "WH_TO_CUSTOMER"
  | "US_SALES_INVOICE"
  | "US_CARGO_RELEASE_ORDER"
  | "US_CUSTOMS_RELEASE_ORDER"
  | "US_DELIVERY_ORDER"
  | "US_PACKING_LIST"
  | "ISF"
  | "SHIPPING_BILL"
  | "CHA_BILL";

export const DOC_TYPE_OPTIONS: Array<{ value: DocType; label: string }> = [
  { value: "SALES_INVOICE", label: "Sales Invoice" },
  { value: "BILL_OF_LADING", label: "Bill Of Lading" },
  { value: "PACKING_LIST", label: "Packing List" },
  { value: "ENTRY_SUMMARY", label: "CBP FORM 7501" },
  { value: "DRAFT_CBP_FORM_7501_BROKER", label: "Draft CBP FORM 7501_Broker" },
  { value: "OCEAN_FREIGHT", label: "Ocean Freight" },
  { value: "FREIGHT_FORWARDER_BILL", label: "Freight Forwarder Bill" },
  { value: "CUSTOMER_BROKER_BILL", label: "Customs Broker Bill" },
  { value: "GRN_INBOUND", label: "GRN Inbound" },
  { value: "PORT_TO_WH", label: "Port To WH" },
  { value: "WH_TO_CUSTOMER", label: "WH To Customer" },
  { value: "US_SALES_INVOICE", label: "US Sales Invoice" },
  { value: "US_CARGO_RELEASE_ORDER", label: "US Cargo Release Order" },
  { value: "US_CUSTOMS_RELEASE_ORDER", label: "US Customs Release Order" },
  { value: "US_DELIVERY_ORDER", label: "US Delivery Order" },
  { value: "US_PACKING_LIST", label: "US Packing List" },
  { value: "ISF", label: "Importer Security Filing (ISF)" },
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
  issuerName?: string | null;
  sourceName?: string | null;
  validationStatus?: "PASSED" | "WARNING" | "BLOCKED" | "WAITING" | string | null;
  validationSummary?: {
    total?: number;
    passed?: number;
    failed?: number;
    warnings?: number;
    waiting?: number;
    skipped?: number;
    blockingFailures?: number;
  } | null;
  validationResults?: Array<{
    ruleCode?: string | null;
    description?: string | null;
    sourceDocType?: string | null;
    targetDocType?: string | null;
    sourceField?: string | null;
    targetField?: string | null;
    matchType?: string | null;
    blockingBehavior?: string | null;
    status?: string | null;
    sourceValue?: string | null;
    targetValue?: string | null;
    delta?: string | null;
    alertLevel?: string | null;
    updatedAt?: string | null;
  }>;
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
  ocrConfidence: number | null;
};

export type DocumentListCounts = {
  total: number;
  needsApproval: number;
  processing: number;
  crossValidating: number;
  draftReview: number;
  done: number;
};

export type DocumentListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type DocumentListResponse = {
  documents: DocumentRecord[];
  pagination: DocumentListPagination;
  counts: DocumentListCounts;
};

export type DocumentClassificationResponse = {
  status: "success";
  message: string;
  docType: DocType;
  label: string;
  confidence: number;
  reasoning: string;
  matchedFields: string[];
  alternatives: Array<{ docType?: DocType | string; confidence?: number; label?: string; reasoning?: string }>;
  fileName: string;
};

export type DocumentClassificationQueuedResponse = {
  status: "queued";
  message: string;
  classificationJobId: string;
  fileName: string;
};

export type DocumentClassificationStatusResponse = {
  status: "queued" | "running" | "success" | "failed";
  message: string;
  classificationJobId: string;
  fileName: string;
  docType: DocType | null;
  label: string | null;
  confidence: number | null;
  reasoning: string | null;
  matchedFields: string[];
  alternatives: Array<{ docType?: DocType | string; confidence?: number; label?: string; reasoning?: string }>;
};

export type DocumentClassificationBulkResponse = {
  status: "queued";
  message: string;
  jobs: Array<{
    classificationJobId: string;
    fileName: string;
    status: string;
    message: string;
  }>;
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
  arrays?: Record<string, Array<Record<string, JsonValue>>> | null;
  rawData: JsonValue | null;
  extractedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type DocumentPreviewUrlResponse = {
  previewUrl: string;
  bucket: string;
  objectKey: string;
  expiresIn: number;
};

export type DocumentDetailRecord = {
  id: string;
  docType: DocType;
  status: DocumentStatus;
  shipmentId?: string | null;
  validationStatus?: "PASSED" | "WARNING" | "BLOCKED" | "WAITING" | string | null;
  validationSummary?: DocumentRecord["validationSummary"];
  validationResults?: DocumentRecord["validationResults"];
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
  extraction: SalesInvoiceExtractionRecord | null;
  salesInvoiceExtraction: SalesInvoiceExtractionRecord | null;
};

export type ApprovalValidationSummary = {
  shipmentId?: string;
  status?: "PASSED" | "WARNING" | "WAITING" | "BLOCKED" | string;
  total?: number;
  passed?: number;
  failed?: number;
  warnings?: number;
  waiting?: number;
  blockingFailures?: number;
  okToProgress?: boolean;
  alerts?: Array<Record<string, unknown>>;
};

export type ApproveDocumentResponse = {
  status: string;
  message: string;
  documentId: string;
  validation?: ApprovalValidationSummary | null;
};

export type ContainerMappingRow = {
  lineItemId: string;
  packingListDocumentId: string;
  invoiceNumber: string | null;
  containerNo: string | null;
  productCode: string | null;
  description: string | null;
  specification: string | null;
  totalQtyInPcs: string | null;
  qtyPerBundle: string | null;
  totalBundles: string | null;
  netWeightKgs: string | null;
  grossWeightKgs: string | null;
  _sourceLineKey?: string | null;
  _sourceTotalQtyInPcs?: string | null;
  _sourceTotalBundles?: string | null;
  _sourceNetWeightKgs?: string | null;
  _sourceGrossWeightKgs?: string | null;
  _splitRow?: string | boolean | null;
};

export type ContainerMappingResponse = {
  bolDocumentId: string;
  invoiceNumbers: string[];
  containers: string[];
  matchedPackingLists: number;
  unmappedCount: number;
  rows: ContainerMappingRow[];
  totals: {
    totalQtyInPcs: number;
    totalBundles: number;
    netWeightKgs: number;
    grossWeightKgs: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

export type WarehouseMappingResponse = {
  documentId: string;
  shipmentId: string | null;
  operationalShipmentId?: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  mappedBy?: string | null;
  mappedAt: string | null;
  updatedAt: string | null;
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
