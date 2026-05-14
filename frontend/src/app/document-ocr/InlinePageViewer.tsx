import { useEffect, useMemo, useState } from "react";
import type { ColDef } from "ag-grid-community";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { format } from "date-fns";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import AgGridTable from "@/components/AgGridTable";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentDetailRecord, DocumentPageRecord, JsonValue } from "@/types/backend";

type EditableSections = Record<string, Record<string, string>>;

export function InlinePageViewer({
  document,
  onClose,
}: {
  document: DocumentDetailRecord;
  onClose: () => void;
}) {
  const pages = document.pages.length ? document.pages : [buildFallbackPage(document)];
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [editableSections, setEditableSections] = useState<EditableSections>({});
  const [lineItems, setLineItems] = useState<Array<Record<string, JsonValue>>>([]);

  useEffect(() => {
    setSelectedPageIndex(0);
    setEditableSections(buildEditableSections(document.salesInvoiceExtraction?.rawData ?? null));
    setLineItems(document.salesInvoiceExtraction?.lineItems ?? []);
  }, [document]);

  const selectedPage = pages[selectedPageIndex];
  const isPdf = document.contentType === "application/pdf" || document.fileName.toLowerCase().endsWith(".pdf");
  const previewUrl = isPdf
    ? buildPdfPreviewUrl(document.previewUrl, selectedPage.pageNo)
    : selectedPage.previewUrl ?? document.previewUrl;

  const lineItemColumns = useMemo<ColDef[]>(() => {
    const keys = Array.from(
      new Set(lineItems.flatMap((item) => Object.keys(item)))
    );

    return keys.map((key) => ({
      headerName: prettifyLabel(key),
      field: key,
      editable: true,
      minWidth: 140,
      flex: 1,
    }));
  }, [lineItems]);

  const gridRows = useMemo(
    () =>
      lineItems.map((item, index) => ({
        id: String(index),
        ...item,
      })),
    [lineItems]
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-500" />
            <p className="truncate text-sm font-semibold text-foreground">{document.fileName}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {document.docType} • {format(new Date(document.createdAt), "MMM dd, yyyy")}
          </p>
        </div>

        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid flex-1 overflow-hidden xl:grid-cols-[1.08fr_0.92fr]">
        <section className="flex min-h-0 flex-col border-r border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={selectedPageIndex === 0}
                onClick={() => setSelectedPageIndex((current) => current - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {selectedPage.pageNo} of {pages.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={selectedPageIndex === pages.length - 1}
                onClick={() => setSelectedPageIndex((current) => current + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <StatusBadge status={document.status} />
          </div>

          <div className="relative flex-1 overflow-hidden p-4">
            {previewUrl ? (
              <div className="flex h-full items-start justify-center overflow-auto rounded-xl border border-border bg-white">
                {isPdf ? (
                  <iframe
                    title={`${document.fileName}-page-${selectedPage.pageNo}`}
                    src={previewUrl}
                    className="h-full w-full rounded-xl border-0 bg-white"
                  />
                ) : (
                  <TransformWrapper
                    initialScale={1}
                    minScale={0.6}
                    maxScale={3}
                    wheel={{ step: 0.12 }}
                    doubleClick={{ disabled: true }}
                    limitToBounds={false}
                    centerOnInit
                  >
                    {({ zoomIn, zoomOut, resetTransform }) => (
                      <>
                        <div className="absolute right-8 top-8 z-10 flex items-center gap-2 rounded-lg border border-border bg-card p-1 shadow-sm">
                          <Button size="sm" variant="outline" onClick={() => zoomOut()}>
                            <ZoomOut className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => zoomIn()}>
                            <ZoomIn className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => resetTransform()}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                        <TransformComponent
                          wrapperClass="!w-full !h-full"
                          contentClass="flex min-h-full min-w-full items-start justify-center p-6"
                        >
                          <img
                            src={previewUrl}
                            alt={`Page ${selectedPage.pageNo}`}
                            className="h-auto max-w-none rounded-lg border border-border bg-white shadow-sm"
                          />
                        </TransformComponent>
                      </>
                    )}
                  </TransformWrapper>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                Preview unavailable for this document.
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card/60 px-3 py-2">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{isPdf ? "Pages" : "Preview Assets"}</p>
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-2 pb-1">
                {pages.map((page, index) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => setSelectedPageIndex(index)}
                    className={`min-w-36 rounded-lg border px-3 py-2 text-left transition ${
                      index === selectedPageIndex
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <p className="text-sm font-medium">Page {page.pageNo}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{page.objectKey}</p>
                  </button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        </section>

        <ScrollArea className="h-full">
            <div className="space-y-4 p-4">
              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Document Metadata</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Meta label="Document ID" value={document.id} />
                  <Meta label="Type" value={document.docType} />
                  <Meta label="Status" value={document.status} />
                  <Meta label="Pages" value={String(document.totalPages ?? pages.length)} />
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Extracted Line Items</h3>
                  <Badge variant="outline">{gridRows.length} rows</Badge>
                </div>
                {gridRows.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No line items available for this document yet.</p>
                ) : (
                  <div className="mt-3">
                    <AgGridTable
                      columnDefs={lineItemColumns}
                      rowData={gridRows as unknown as Record<string, unknown>[]}
                      defaultColDef={{
                        editable: true,
                        sortable: false,
                        filter: false,
                        resizable: true,
                        flex: 1,
                        minWidth: 120,
                      }}
                      height={300}
                      rowHeight={40}
                    />
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Extracted Fields</h3>
                <Accordion type="multiple" className="mt-3">
                  {Object.entries(editableSections).map(([sectionName, fields]) => (
                    <AccordionItem key={sectionName} value={sectionName} className="border border-border rounded-lg px-4 mb-3 last:mb-0">
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{prettifyLabel(sectionName)}</span>
                          <Badge variant="secondary">{Object.keys(fields).length} fields</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          {Object.entries(fields).map(([fieldName, value]) => (
                            <EditableField
                              key={`${sectionName}-${fieldName}`}
                              label={prettifyLabel(fieldName)}
                              value={value}
                              multiline={value.length > 80 || value.includes("\n")}
                              onChange={(nextValue) =>
                                setEditableSections((current) => ({
                                  ...current,
                                  [sectionName]: {
                                    ...current[sectionName],
                                    [fieldName]: nextValue,
                                  },
                                }))
                              }
                            />
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                {Object.keys(editableSections).length === 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">No extracted fields available yet.</p>
                )}
              </section>
            </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function EditableField({
  label,
  value,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  multiline: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</label>
      {multiline ? (
        <Textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-[92px] resize-y" />
      ) : (
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentDetailRecord["status"] }) {
  if (status === "EXTRACTED" || status === "REVIEWED") {
    return (
      <Badge variant="outline" className="border-green-500 text-green-600">
        {status}
      </Badge>
    );
  }
  if (status === "REJECTED") {
    return <Badge variant="destructive">{status}</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm text-foreground">{value}</p>
    </div>
  );
}

function buildFallbackPage(document: DocumentDetailRecord): DocumentPageRecord {
  return {
    id: document.id,
    documentId: document.id,
    pageNo: 1,
    bucket: document.bucket,
    objectKey: document.objectKey,
    sizeBytes: document.sizeBytes,
    rawText: null,
    isExtractionSource: true,
    createdAt: document.createdAt,
    previewUrl: document.previewUrl,
  };
}

function buildPdfPreviewUrl(url: string | null, pageNo: number) {
  if (!url) return null;
  return `${url}#page=${pageNo}&view=FitH`;
}

function prettifyLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function buildEditableSections(rawData: JsonValue | null): EditableSections {
  if (!rawData || Array.isArray(rawData) || typeof rawData !== "object") {
    return {};
  }

  const sections: EditableSections = {};

  for (const [key, value] of Object.entries(rawData)) {
    if (key === "lineItems" || key.startsWith("_")) {
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      sections[key] = Object.fromEntries(
        Object.entries(value).map(([field, fieldValue]) => [field, stringifyFieldValue(fieldValue)])
      );
      continue;
    }

    sections.general ??= {};
    sections.general[key] = stringifyFieldValue(value);
  }

  return sections;
}

function stringifyFieldValue(value: JsonValue) {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}
