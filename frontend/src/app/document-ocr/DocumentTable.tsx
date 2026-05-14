import { useMemo } from "react";
import { format } from "date-fns";
import { Eye, FileText, RotateCcw, Trash2 } from "lucide-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import AgGridTable from "@/components/AgGridTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DocumentListRow } from "./types";

export function DocumentTable({
  documents,
  statusFilter,
  searchTerm,
  selectedDocType,
  dateRange,
  onViewDocument,
  onDeleteDocument,
  onRetryDocument,
  deletingDocumentId,
  retryingDocumentId,
}: {
  documents: DocumentListRow[];
  statusFilter: "all" | DocumentListRow["reviewStatus"];
  searchTerm: string;
  selectedDocType: string;
  dateRange: { from: Date; to: Date };
  onViewDocument: (document: DocumentListRow) => void;
  onDeleteDocument: (document: DocumentListRow) => void;
  onRetryDocument: (document: DocumentListRow) => void;
  deletingDocumentId: string | null;
  retryingDocumentId: string | null;
}) {
  const filteredDocuments = useMemo(() => {
    return documents.filter((document) => {
      if (statusFilter !== "all" && document.reviewStatus !== statusFilter) return false;
      if (selectedDocType !== "all" && document.docType !== selectedDocType) return false;
      if (searchTerm && !document.fileName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      const createdAt = new Date(document.createdAt);
      return createdAt >= dateRange.from && createdAt <= dateRange.to;
    });
  }, [dateRange, documents, searchTerm, selectedDocType, statusFilter]);

  const columnDefs = useMemo<ColDef[]>(
    () => [
      {
        headerName: "Document",
        field: "fileName",
        flex: 2,
        minWidth: 280,
        cellRenderer: DocumentCellRenderer,
      },
      {
        headerName: "Created",
        field: "createdAt",
        flex: 1.2,
        minWidth: 180,
        valueFormatter: (params) =>
          params.value ? format(new Date(String(params.value)), "MMM dd, yyyy HH:mm") : "",
      },
      {
        headerName: "Type",
        field: "docType",
        flex: 1,
        minWidth: 180,
      },
      {
        headerName: "Status",
        field: "reviewStatus",
        flex: 0.9,
        minWidth: 140,
        cellRenderer: StatusCellRenderer,
      },
      {
        headerName: "View",
        field: "id",
        width: 90,
        sortable: false,
        filter: false,
        cellRenderer: ActionCellRenderer,
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
      flex: 1,
      minWidth: 100,
    }),
    []
  );

  const context = useMemo(
    () => ({
      onViewDocument,
      onDeleteDocument,
      onRetryDocument,
      deletingDocumentId,
      retryingDocumentId,
    }),
    [onViewDocument, onDeleteDocument, onRetryDocument, deletingDocumentId, retryingDocumentId]
  );

  if (!filteredDocuments.length) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">No documents matched your filters.</p>
      </div>
    );
  }

  return (
    <AgGridTable
      columnDefs={columnDefs}
      rowData={filteredDocuments as unknown as Record<string, unknown>[]}
      defaultColDef={defaultColDef}
      context={context}
      height={460}
      rowHeight={68}
    />
  );
}

function DocumentCellRenderer(params: ICellRendererParams) {
  const document = params.data as DocumentListRow;

  return (
    <div className="flex h-full min-w-0 items-center">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{document.fileName}</p>
        <p className="text-xs text-muted-foreground">
          {document.pageCount ?? 1} page{document.pageCount === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

function StatusCellRenderer(params: ICellRendererParams) {
  const status = params.value as DocumentListRow["reviewStatus"];

  if (status === "approved") {
    return <Badge variant="outline" className="border-green-500 text-green-600">Approved</Badge>;
  }
  if (status === "hold") {
    return <Badge variant="destructive">Hold</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

function ActionCellRenderer(params: ICellRendererParams) {
  const document = params.data as DocumentListRow;
  const deletingDocumentId = params.context?.deletingDocumentId as string | null;
  const retryingDocumentId = params.context?.retryingDocumentId as string | null;
  const isDeleting = deletingDocumentId === document.id;
  const isRetrying = retryingDocumentId === document.id;
  const isBusy = isDeleting || isRetrying;

  return (
    <div className="flex h-full items-center justify-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => params.context?.onViewDocument?.(document)}
        disabled={isBusy}
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => params.context?.onRetryDocument?.(document)}
        disabled={isBusy}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => params.context?.onDeleteDocument?.(document)}
        disabled={isBusy}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
