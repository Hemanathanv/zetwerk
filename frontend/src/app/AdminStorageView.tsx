import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Folder, Loader2, Trash2 } from "lucide-react";
import { adminApi } from "@/auth/api";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdminStorageFile, AdminStorageListing } from "@/types/backend";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function AdminStorageView() {
  const [buckets, setBuckets] = useState<string[]>([]);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [listing, setListing] = useState<AdminStorageListing | null>(null);
  const [selectedFile, setSelectedFile] = useState<AdminStorageFile | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(true);
  const [loadingListing, setLoadingListing] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBuckets = async () => {
      setLoadingBuckets(true);
      setError(null);
      try {
        const response = await adminApi.listBuckets();
        const nextBuckets = response.data.buckets;
        setBuckets(nextBuckets);
        if (nextBuckets.length > 0) {
          setSelectedBucket((current) => current || nextBuckets[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load buckets.");
      } finally {
        setLoadingBuckets(false);
      }
    };

    loadBuckets();
  }, []);

  useEffect(() => {
    if (!selectedBucket) return;

    const loadListing = async () => {
      setLoadingListing(true);
      setError(null);
      try {
        const response = await adminApi.listStorage(selectedBucket, prefix);
        setListing(response.data);
        setSelectedFile((current) => {
          if (!current) return response.data.files[0] ?? null;
          return response.data.files.find((file) => file.key === current.key) ?? response.data.files[0] ?? null;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load storage listing.");
      } finally {
        setLoadingListing(false);
      }
    };

    loadListing();
  }, [selectedBucket, prefix]);

  const parentPrefix = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    return parts.slice(0, -1).join("/");
  }, [prefix]);

  const deleteFile = async (file: AdminStorageFile) => {
    if (!listing) return;
    const confirmed = window.confirm(`Delete ${file.name}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingKey(file.key);
    try {
      await adminApi.deleteStorageFile(listing.bucket, file.key);
      const response = await adminApi.listStorage(listing.bucket, listing.prefix);
      setListing(response.data);
      setSelectedFile(response.data.files[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete file.");
    } finally {
      setDeletingKey(null);
    }
  };

  const openFolder = (folder: string) => {
    const nextPrefix = [prefix, folder].filter(Boolean).join("/");
    setPrefix(nextPrefix);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[220px] flex-1">
            <p className="text-sm font-semibold">Storage Browser</p>
            <p className="text-sm text-muted-foreground">Browse buckets, folders, and files with admin access.</p>
          </div>

          <div className="w-full max-w-xs">
            <Select value={selectedBucket} onValueChange={(value:any) => { setSelectedBucket(value); setPrefix(""); }}>
              <SelectTrigger>
                <SelectValue placeholder={loadingBuckets ? "Loading buckets..." : "Select bucket"} />
              </SelectTrigger>
              <SelectContent>
                {buckets.map((bucket) => (
                  <SelectItem key={bucket} value={bucket}>
                    {bucket}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={!prefix} onClick={() => setPrefix(parentPrefix)}>
            Back
          </Button>
          <button className="rounded-md bg-muted px-3 py-1.5 text-sm" onClick={() => setPrefix("")}>
            root
          </button>
          {(listing?.breadcrumbs ?? []).map((part, index) => {
            const nextPrefix = listing?.breadcrumbs.slice(0, index + 1).join("/") ?? "";
            return (
              <button
                key={`${part}-${index}`}
                className="rounded-md bg-muted px-3 py-1.5 text-sm"
                onClick={() => setPrefix(nextPrefix)}
              >
                {part}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loadingListing ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading storage items...
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-xl border border-border">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">Folders</div>
              <div className="max-h-[480px] overflow-auto p-2">
                {listing?.folders.length ? (
                  listing.folders.map((folder) => (
                    <button
                      key={folder}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted/40"
                      onClick={() => openFolder(folder)}
                    >
                      <Folder className="h-4 w-4 text-primary" />
                      <span className="truncate text-sm">{folder}</span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No folders in this location.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">Files</div>
              <div className="max-h-[480px] overflow-auto p-2">
                {listing?.files.length ? (
                  listing.files.map((file) => (
                    <div
                      key={file.key}
                      className={`mb-2 rounded-lg border p-3 ${
                        selectedFile?.key === file.key ? "border-primary bg-primary/5" : "border-border bg-background"
                      }`}
                    >
                      <button className="w-full text-left" onClick={() => setSelectedFile(file)}>
                        <div className="flex items-start gap-3">
                          <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(file.sizeBytes)}
                              {file.lastModified ? ` • ${new Date(file.lastModified).toLocaleString()}` : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <a href={file.downloadUrl} target="_blank" rel="noreferrer">
                            <Download className="h-4 w-4" />
                            Download
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteFile(file)}
                          disabled={deletingKey === file.key}
                        >
                          {deletingKey === file.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No files in this location.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <aside className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Preview</h3>
        {selectedFile ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-medium">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">{selectedFile.key}</p>
            </div>

            {selectedFile.contentType?.startsWith("image/") ? (
              <img
                src={selectedFile.previewUrl ?? selectedFile.downloadUrl}
                alt={selectedFile.name}
                className="w-full rounded-lg border border-border bg-muted/20"
              />
            ) : selectedFile.contentType === "application/pdf" ? (
              <iframe
                src={selectedFile.previewUrl ?? selectedFile.downloadUrl}
                title={selectedFile.name}
                className="h-[640px] w-full rounded-lg border border-border bg-white"
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                Inline preview is available for PDFs and images. Use download for other file types.
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            Select a file to preview it here.
          </div>
        )}
      </aside>
    </div>
  );
}
