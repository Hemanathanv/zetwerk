import type { DocumentDetailRecord, DocumentPageRecord, DocumentRecord } from "@/types/backend";

export type ReviewStatus = "pending" | "approved" | "hold";

export type DocumentListRow = DocumentRecord & {
  reviewStatus: ReviewStatus;
};

export type DocumentViewerState = {
  document: DocumentDetailRecord;
  selectedPage: DocumentPageRecord;
};
