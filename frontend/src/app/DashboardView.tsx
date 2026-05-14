import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, TrendingUp } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { documentApi } from "@/auth/api";
import type { DocumentRecord } from "@/types/backend";

export default function DashboardView() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await documentApi.list();
        setDocuments(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load dashboard data.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const metrics = useMemo(() => {
    const extracted = documents.filter((item) => item.status === "EXTRACTED").length;
    const processing = documents.filter((item) => item.status === "PROCESSING" || item.status === "QUEUED").length;
    const totalPages = documents.reduce((sum, item) => sum + (item.pageCount ?? 0), 0);

    return {
      totalDocuments: documents.length,
      extracted,
      processing,
      totalPages,
    };
  }, [documents]);

  return (
    <PageLayout
      title="Dashboard"
      description="Track uploaded documents, extraction progress, and page volume in one place."
      icon={TrendingUp}
      accentColor="bg-amber-500"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading dashboard data...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total Documents" value={metrics.totalDocuments} />
            <MetricCard label="Extracted" value={metrics.extracted} />
            <MetricCard label="In Progress" value={metrics.processing} />
            <MetricCard label="Total Pages" value={metrics.totalPages} />
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="text-base font-semibold">Recent Documents</h3>
            </div>
            <div className="mt-4 space-y-3">
              {documents.slice(0, 5).map((document) => (
                <div
                  key={document.id}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 px-4 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium text-foreground">{document.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {document.docType} • {document.pageCount ?? 1} page{document.pageCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">{document.status}</p>
                </div>
              ))}

              {documents.length === 0 && (
                <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </PageLayout>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
