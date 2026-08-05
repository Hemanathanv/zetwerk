import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Folder, FileText, ChevronRight, Home, RefreshCw, AlertCircle, HardDrive } from 'lucide-react';
import { getAuthToken } from '@/lib/api';
import { BACKEND_API_BASE as API_BASE } from '@/lib/apiBase';

interface S3Folder {
  name: string;
  prefix: string;
}

interface S3File {
  key: string;
  name: string;
  sizeBytes: number;
  lastModified: string | null;
  documentId?: string;
}

interface BrowseResult {
  bucket: string;
  prefix: string;
  folders: S3Folder[];
  files: S3File[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildCrumbs(prefix: string): Array<{ label: string; prefix: string }> {
  if (!prefix) return [];
  const parts = prefix.split('/').filter(Boolean);
  return parts.map((part, i) => ({
    label: part,
    prefix: parts.slice(0, i + 1).join('/'),
  }));
}

const TEAL = 'hsl(var(--vs-teal))';
const TEAL_BG = 'hsla(173,58%,39%,0.07)';
const BORDER_C = 'hsl(var(--border))';
const MUTED_C = 'hsl(var(--muted-foreground))';

interface Props {
  initialBucket?: string;
}

export function S3BrowserPanel({ initialBucket }: Props) {
  const [, navigate] = useLocation();
  const [buckets, setBuckets] = useState<string[]>([]);
  const [defaultBucket, setDefaultBucket] = useState<string | null>(null);
  const [activeBucket, setActiveBucket] = useState<string>(initialBucket ?? '');
  const [prefix, setPrefix] = useState('');
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucketsLoaded, setBucketsLoaded] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    async function loadBuckets() {
      try {
        const res = await fetch(`${API_BASE}/api/storage/buckets`, { headers: authHeaders() });
        const json = await res.json().catch(() => null);
        if (json?.ok) {
          setBuckets(json.data.buckets ?? []);
          setDefaultBucket(json.data.defaultBucket ?? null);
          if (!activeBucket && json.data.defaultBucket) {
            setActiveBucket(json.data.defaultBucket);
          } else if (!activeBucket && json.data.buckets?.length > 0) {
            setActiveBucket(json.data.buckets[0]);
          }
        }
      } catch {
      } finally {
        setBucketsLoaded(true);
      }
    }
    void loadBuckets();
  }, []);

  const browse = useCallback(async (bucket: string, pfx: string) => {
    if (!bucket) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ bucket, prefix: pfx });
      const res = await fetch(`${API_BASE}/api/storage/browse?${params}`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? 'Failed to load folder contents');
        setResult(null);
      } else {
        setResult(json.data);
      }
    } catch {
      setError('Network error — check your connection');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (bucketsLoaded && activeBucket) {
      void browse(activeBucket, prefix);
    }
  }, [activeBucket, prefix, bucketsLoaded]);

  function navigateInto(folder: S3Folder) {
    setPrefix(folder.prefix);
  }

  function navigateToCrumb(pfx: string) {
    setPrefix(pfx);
  }

  function navigateHome() {
    setPrefix('');
  }

  const crumbs = buildCrumbs(prefix);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Bucket selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <HardDrive style={{ width: 15, height: 15, color: TEAL, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: MUTED_C, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bucket</span>
        {buckets.length > 1 ? (
          <select
            value={activeBucket}
            onChange={e => { setActiveBucket(e.target.value); setPrefix(''); }}
            style={{
              fontSize: 14, border: `1px solid ${BORDER_C}`, borderRadius: 6,
              padding: '3px 8px', background: 'hsl(var(--background))',
              color: 'hsl(var(--foreground))', cursor: 'pointer',
            }}
          >
            {buckets.map(b => (
              <option key={b} value={b}>{b}{b === defaultBucket ? ' (default)' : ''}</option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            {activeBucket || 'No bucket configured'}
          </span>
        )}
        <button
          onClick={() => void browse(activeBucket, prefix)}
          disabled={loading}
          title="Refresh"
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6, border: `1px solid ${BORDER_C}`,
            background: 'transparent', cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 14, color: MUTED_C,
          }}
        >
          <RefreshCw style={{ width: 12, height: 12 }} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Breadcrumb nav */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
        padding: '6px 10px', borderRadius: 8, background: 'hsl(var(--muted))',
        border: `1px solid ${BORDER_C}`,
      }}>
        <button
          onClick={navigateHome}
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: prefix ? TEAL : 'hsl(var(--foreground))', fontSize: 14, fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4 }}
        >
          <Home style={{ width: 12, height: 12 }} />
          {activeBucket || 'root'}
        </button>
        {crumbs.map((crumb, i) => (
          <span key={crumb.prefix} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronRight style={{ width: 10, height: 10, color: MUTED_C }} />
            <button
              onClick={() => navigateToCrumb(crumb.prefix)}
              style={{
                color: i === crumbs.length - 1 ? 'hsl(var(--foreground))' : TEAL,
                fontWeight: i === crumbs.length - 1 ? 600 : 400,
                fontSize: 14, background: 'none', border: 'none',
                cursor: i === crumbs.length - 1 ? 'default' : 'pointer',
                padding: '2px 4px', borderRadius: 4,
              }}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
          borderRadius: 8, border: '1px solid hsl(0 72% 40% / 0.3)',
          background: 'hsl(0 72% 40% / 0.05)',
        }}>
          <AlertCircle style={{ width: 15, height: 15, color: 'hsl(0 72% 40%)', marginTop: 1, flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 14.5, fontWeight: 600, color: 'hsl(0 72% 40%)', margin: '0 0 2px' }}>
              Unable to browse S3
            </p>
            <p style={{ fontSize: 14, color: MUTED_C, margin: 0 }}>{error}</p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{
              height: 36, borderRadius: 6, background: 'hsl(var(--muted))',
              animation: 'pulse 1.5s ease-in-out infinite',
              opacity: 1 - i * 0.15,
            }} />
          ))}
        </div>
      )}

      {/* Folder/file table */}
      {result && (
        <div style={{ border: `1px solid ${BORDER_C}`, borderRadius: 8, overflow: 'hidden' }}>
          {result.folders.length === 0 && result.files.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <Folder style={{ width: 32, height: 32, color: MUTED_C, margin: '0 auto 8px' }} />
              <p style={{ fontSize: 14.5, color: MUTED_C, margin: 0 }}>
                {prefix ? 'This folder is empty' : 'No files uploaded to this bucket yet'}
              </p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'hsl(var(--muted))' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 14, color: MUTED_C, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${BORDER_C}` }}>Name</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: 14, color: MUTED_C, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${BORDER_C}`, width: 90 }}>Size</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 14, color: MUTED_C, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${BORDER_C}`, width: 180 }}>Last Modified</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, fontSize: 14, color: MUTED_C, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${BORDER_C}`, width: 100 }}>Document</th>
                </tr>
              </thead>
              <tbody>
                {result.folders.map((folder) => (
                  <tr
                    key={folder.prefix}
                    onClick={() => navigateInto(folder)}
                    style={{ cursor: 'pointer', borderBottom: `1px solid ${BORDER_C}` }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--muted)/0.4)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Folder style={{ width: 14, height: 14, color: TEAL, flexShrink: 0 }} />
                        <span style={{ fontWeight: 500, color: 'hsl(var(--foreground))' }}>{folder.name}/</span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: MUTED_C }}>—</td>
                    <td style={{ padding: '9px 12px', color: MUTED_C }}>—</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center', color: MUTED_C }}>—</td>
                  </tr>
                ))}
                {result.files.map((file) => (
                  <tr
                    key={file.key}
                    style={{ borderBottom: `1px solid ${BORDER_C}`, cursor: file.documentId ? 'pointer' : 'default' }}
                    onClick={() => { if (file.documentId) navigate(`/documents/${file.documentId}`); }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--muted)/0.4)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '9px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText style={{ width: 14, height: 14, color: MUTED_C, flexShrink: 0 }} />
                        <span style={{ color: 'hsl(var(--foreground))', wordBreak: 'break-all' }}>{file.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: MUTED_C, whiteSpace: 'nowrap' }}>
                      {formatBytes(file.sizeBytes)}
                    </td>
                    <td style={{ padding: '9px 12px', color: MUTED_C, whiteSpace: 'nowrap' }}>
                      {formatDate(file.lastModified)}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      {file.documentId ? (
                        <span
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 8,
                            background: TEAL_BG, color: TEAL,
                            fontSize: 14, fontWeight: 600,
                          }}
                        >
                          View
                        </span>
                      ) : (
                        <span style={{ color: MUTED_C, fontSize: 14 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Summary footer */}
      {result && (result.folders.length > 0 || result.files.length > 0) && (
        <p style={{ fontSize: 14.5, color: MUTED_C, margin: 0 }}>
          {result.folders.length} folder{result.folders.length !== 1 ? 's' : ''},&nbsp;
          {result.files.length} file{result.files.length !== 1 ? 's' : ''}
          {result.files.some(f => f.documentId) && (
            <> · <span style={{ color: TEAL }}>{result.files.filter(f => f.documentId).length} linked to documents</span></>
          )}
        </p>
      )}
    </div>
  );
}
