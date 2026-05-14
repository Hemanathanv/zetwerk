import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { FileText, Loader2, Upload, XCircle } from "lucide-react";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { useLocation, useRoute } from "wouter";
import PageLayout from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { adminApi, documentApi } from "@/auth/api";
import { DocumentToolbar } from "./document-ocr/DocumentToolbar";
import { DocumentTable } from "./document-ocr/DocumentTable";
import { InlinePageViewer } from "./document-ocr/InlinePageViewer";
import { DOC_TYPE_OPTIONS, type DocType, type DocumentDetailRecord, type DocumentRecord } from "@/types/backend";
import type { DocumentListRow, ReviewStatus } from "./document-ocr/types";

type TabId = "all documents" | ReviewStatus;

const tabs: { id: TabId; label: string }[] = [
  { id: "all documents", label: "All Documents" },
  { id: "approved", label: "Approved" },
  { id: "hold", label: "Hold" },
  { id: "pending", label: "Pending" },
];

function getReviewStatus(document: DocumentRecord): ReviewStatus {
  if (document.status === "EXTRACTED" || document.status === "REVIEWED") return "approved";
  if (document.status === "REJECTED") return "hold";
  return "pending";
}

export default function OcrWorkflow() {
  const [, setLocation] = useLocation();
  const [isDocumentRouteMatch, routeParams] = useRoute<{ documentId: string }>("/document-ocr/:documentId");
  const [activeTab, setActiveTab] = useState<TabId>("all documents");
  const [dateRange, setDateRange] = useState({
    from: startOfDay(subDays(new Date(), 29)),
    to: endOfDay(new Date()),
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDocType, setSelectedDocType] = useState("all");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState<DocType>("SALES_INVOICE");
  const [uploadNotes, setUploadNotes] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [retryingDocumentId, setRetryingDocumentId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentDetailRecord | null>(null);
  const [loadingActiveDocument, setLoadingActiveDocument] = useState(false);

  const loadDocuments = async () => {
    setLoadingDocuments(true);
    setDocumentsError(null);
    try {
      const response = await documentApi.list();
      setDocuments(response.data);
    } catch (error) {
      setDocumentsError(error instanceof Error ? error.message : "Failed to load documents.");
    } finally {
      setLoadingDocuments(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    const documentId = isDocumentRouteMatch ? routeParams?.documentId ?? null : null;
    if (!documentId) {
      setActiveDocument(null);
      return;
    }

    const loadDocument = async () => {
      setLoadingActiveDocument(true);
      try {
        const response = await documentApi.getById(documentId);
        setActiveDocument(response.data);
      } catch (error) {
        setActiveDocument(null);
        setLocation("/document-ocr");
      } finally {
        setLoadingActiveDocument(false);
      }
    };

    loadDocument();
  }, [isDocumentRouteMatch, routeParams?.documentId, setLocation]);

  const documentRows = useMemo<DocumentListRow[]>(
    () => documents.map((document) => ({ ...document, reviewStatus: getReviewStatus(document) })),
    [documents]
  );

  const tabCount = (tabId: TabId) => {
    if (tabId === "all documents") return documentRows.length;
    return documentRows.filter((document) => document.reviewStatus === tabId).length;
  };

  const pendingCount = documentRows.filter((document) => document.reviewStatus === "pending").length;

  const docTypes = useMemo(() => {
    const values = Array.from(new Set(documents.map((document) => document.docType)));
    return [{ value: "all", label: "All Document Types" }, ...values.map((value) => ({ value, label: value }))];
  }, [documents]);

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
    setUploadError(null);
  };

  const handleDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadError(null);
  };

  const handleUploadDocument = async () => {
    if (!selectedFile) {
      setUploadError("Select a PDF or image before uploading.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setIsUploading(true);
    setUploadError(null);

    try {
      await documentApi.upload(formData);
      await loadDocuments();
      setSelectedFile(null);
      setUploadNotes("");
    } catch (error: any) {
      setUploadError(error?.response?.data?.detail || "Unable to upload document right now.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (document: DocumentListRow) => {
    const shouldDelete = window.confirm(`Delete "${document.fileName}" and all related OCR data?`);
    if (!shouldDelete) return;

    setDeleteError(null);
    setDeletingDocumentId(document.id);

    try {
      await adminApi.deleteDocument(document.id);
      if (routeParams?.documentId === document.id) {
        setLocation("/document-ocr");
      }
      await loadDocuments();
    } catch (error: any) {
      setDeleteError(error?.response?.data?.detail || "Unable to delete document right now.");
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const handleRetryDocument = async (document: DocumentListRow) => {
    setRetryError(null);
    setRetryingDocumentId(document.id);

    try {
      await documentApi.retry(document.id);
      await loadDocuments();
    } catch (error: any) {
      setRetryError(error?.response?.data?.detail || "Unable to queue OCR retry right now.");
    } finally {
      setRetryingDocumentId(null);
    }
  };

  const selectedStatusFilter: "all" | ReviewStatus = activeTab === "all documents" ? "all" : activeTab;

  return (
    <PageLayout
      title="Document OCR"
      description="Upload documents, review extraction output, and inspect pages inline."
      icon={FileText}
      accentColor="bg-emerald-500"
    >
      {loadingActiveDocument && routeParams?.documentId ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading document details...
        </div>
      ) : activeDocument ? (
        <div className="-m-6 h-[calc(100vh-112px)]">
          <InlinePageViewer document={activeDocument} onClose={() => setLocation("/document-ocr")} />
        </div>
      ) : (
        <div className="space-y-4">
          <DocumentToolbar
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            selectedDocType={selectedDocType}
            onDocTypeChange={setSelectedDocType}
            docTypes={docTypes}
            pendingCount={pendingCount}
          />

          <div className="rounded-xl border border-border bg-card p-3 md:p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold tracking-tight">Upload Document</p>
              <p className="text-[11px] text-muted-foreground">PDF, PNG, JPG, JPEG</p>
            </div>

            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Document Type</label>
                <select
                  value={uploadDocType}
                  onChange={(event) => setUploadDocType(event.target.value as DocType)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm"
                >
                  {DOC_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">Role-filtered options.</p>
              </div>

              <div
                className={`rounded-lg border border-dashed px-4 py-4 text-center transition ${
                  isDragActive ? "border-primary bg-primary/5" : "border-border bg-muted/20"
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={handleDropFile}
              >
                <p className="text-sm font-medium">Drag & drop file</p>
                <label className="relative mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted/40">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{selectedFile ? selectedFile.name : "Browse Files"}</span>
                  <input
                    type="file"
                    accept=".pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={handleFileSelection}
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedFile(null);
                  setUploadNotes("");
                }}
                disabled={isUploading}
              >
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>

              <Button onClick={handleUploadDocument} disabled={!selectedFile || isUploading}>
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </div>

            {uploadError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {uploadError}
              </div>
            )}
            {deleteError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {deleteError}
              </div>
            )}
            {retryError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {retryError}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full border px-4 py-2 text-sm transition ${
                    isActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {tab.label} ({tabCount(tab.id)})
                </button>
              );
            })}
          </div>

          {loadingDocuments ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading uploaded documents...
            </div>
          ) : documentsError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {documentsError}
            </div>
          ) : (
            <DocumentTable
              documents={documentRows}
              statusFilter={selectedStatusFilter}
              searchTerm={searchTerm}
              selectedDocType={selectedDocType}
              dateRange={dateRange}
              onViewDocument={(document) => setLocation(`/document-ocr/${document.id}`)}
              onDeleteDocument={handleDeleteDocument}
              onRetryDocument={handleRetryDocument}
              deletingDocumentId={deletingDocumentId}
              retryingDocumentId={retryingDocumentId}
            />
          )}
        </div>
      )}
    </PageLayout>
  );
}
