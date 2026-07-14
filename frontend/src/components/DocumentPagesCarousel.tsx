import { useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/api';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';

const API_BASE = ((import.meta.env.VITE_BACKEND_API_BASE as string | undefined) ?? '').replace(/\/$/, '');

interface PageRecord {
  id: string;
  pageNo: number;
  downloadUrl: string | null;
  width?: number | null;
  height?: number | null;
}

interface Props {
  documentId: string;
}

export function DocumentPagesCarousel({ documentId }: Props) {
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE}/api/documents/${documentId}/pages`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const payload = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !payload?.ok) return;
        const raw: unknown[] = Array.isArray(payload.data) ? payload.data : [];
        setPages(
          raw
            .filter((p): p is PageRecord =>
              !!p &&
              typeof (p as PageRecord).pageNo === 'number'
            )
            .sort((a, b) => a.pageNo - b.pageNo)
        );
      } catch {
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [documentId]);

  if (loading) {
    return (
      <div style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'hsl(var(--muted-foreground))', fontSize: 14 }}>
        <Loader2 size={16} className="animate-spin" />
        Loading page images...
      </div>
    );
  }

  if (!pages.length) {
    return (
      <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
        No page images available yet.
      </p>
    );
  }

  const current = lightbox !== null ? pages[lightbox] : null;

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 6,
        }}
      >
        {pages.map((page, idx) => (
          <button
            key={page.id}
            onClick={() => setLightbox(idx)}
            title={`Page ${page.pageNo}`}
            style={{
              flexShrink: 0,
              width: 60,
              height: 80,
              borderRadius: 6,
              border: '1px solid hsl(var(--border))',
              overflow: 'hidden',
              cursor: 'pointer',
              padding: 0,
              background: 'hsl(var(--muted))',
              position: 'relative',
              transition: 'box-shadow 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(var(--vs-teal))';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 2px hsla(173,58%,39%,0.2)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(var(--border))';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
            }}
          >
            {page.downloadUrl ? (
              <img
                src={page.downloadUrl}
                alt={`Page ${page.pageNo}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, color: 'hsl(var(--muted-foreground))' }}>
                —
              </div>
            )}
            <span style={{
              position: 'absolute',
              bottom: 2,
              right: 3,
              fontSize: 14.5,
              fontWeight: 700,
              color: 'hsl(var(--muted-foreground))',
              background: 'hsla(0,0%,100%,0.85)',
              borderRadius: 3,
              padding: '0 3px',
              lineHeight: '14px',
            }}>
              {page.pageNo}
            </span>
          </button>
        ))}
      </div>

      {/* Lightbox */}
      <Dialog open={lightbox !== null} onOpenChange={(v) => { if (!v) setLightbox(null); }}>
        <DialogContent
          className="p-0 overflow-hidden"
          style={{ maxWidth: '90vw', width: 'auto', background: 'hsl(var(--card))' }}
        >
          <DialogTitle className="sr-only">
            {current ? `Page ${current.pageNo} of ${pages.length}` : 'Document page'}
          </DialogTitle>

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Close button */}
            <button
              onClick={() => setLightbox(null)}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 10,
                background: 'hsla(0,0%,0%,0.5)', border: 'none', borderRadius: '50%',
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff',
              }}
            >
              <X className="w-4 h-4" />
            </button>

            {/* Image */}
            {current?.downloadUrl && (
              <img
                src={current.downloadUrl}
                alt={`Page ${current.pageNo}`}
                style={{ maxWidth: '85vw', maxHeight: '85vh', objectFit: 'contain', display: 'block' }}
              />
            )}

            {/* Page nav */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
              fontSize: 14, fontWeight: 500, color: 'hsl(var(--muted-foreground))',
              background: 'hsl(var(--muted) / 0.5)',
              width: '100%', justifyContent: 'center',
            }}>
              <button
                onClick={() => setLightbox((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))}
                disabled={lightbox === 0}
                style={{ background: 'none', border: 'none', cursor: lightbox === 0 ? 'default' : 'pointer', opacity: lightbox === 0 ? 0.3 : 1, display: 'flex' }}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>Page {current?.pageNo} of {pages.length}</span>
              <button
                onClick={() => setLightbox((prev) => (prev !== null && prev < pages.length - 1 ? prev + 1 : prev))}
                disabled={lightbox === pages.length - 1}
                style={{ background: 'none', border: 'none', cursor: lightbox === pages.length - 1 ? 'default' : 'pointer', opacity: lightbox === pages.length - 1 ? 0.3 : 1, display: 'flex' }}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
