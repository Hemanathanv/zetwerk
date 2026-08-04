import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  render?: (row: T) => React.ReactNode;
  mono?: boolean;
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface AdminTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  pagination?: PaginationProps;
}

type SortDir = 'asc' | 'desc' | null;

const MONO = '"JetBrains Mono", "Fira Code", monospace';
const HEADER_BG = 'hsl(var(--muted) / 0.5)';

export function AdminTable<T extends Record<string, any>>({
  columns, data, keyField,
  searchable, searchPlaceholder = 'Search…',
  emptyMessage = 'No data found',
  onRowClick, loading = false,
  pagination,
}: AdminTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  function handleSort(key: string) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    if (sortDir === 'desc') { setSortKey(null); setSortDir(null); }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((v) =>
        v != null && String(v).toLowerCase().includes(q)
      )
    );
  }, [data, search]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 1;
  const startItem = pagination ? (pagination.page - 1) * pagination.pageSize + 1 : 1;
  const endItem = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.total) : sorted.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {searchable && (
        <div style={{ position: 'relative', maxWidth: '100%' }}>
          <Search
            size={14}
            style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)',
              color: 'hsl(var(--muted-foreground))',
              pointerEvents: 'none',
            }}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ paddingLeft: 32, fontSize: 14, height: 38 }}
          />
        </div>
      )}

      <div
        style={{
          border: '1px solid hsl(var(--border))',
          borderRadius: 8,
          overflowX: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: HEADER_BG }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: 14,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'hsl(var(--muted-foreground))',
                    cursor: col.sortable ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                    width: col.width,
                    minWidth: col.width ?? 80,
                    userSelect: 'none',
                    borderBottom: '1px solid hsl(var(--border))',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {col.label}
                    {col.sortable && (
                      sortKey === col.key
                        ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                        : <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} style={{ padding: '14px 16px', borderBottom: '1px solid hsl(var(--border))' }}>
                      <div
                        style={{
                          height: 14,
                          borderRadius: 4,
                          background: 'hsl(var(--muted))',
                          width: `${50 + Math.random() * 40}%`,
                          animation: 'pulse 1.5s ease-in-out infinite',
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
            {!loading && sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: '48px 16px',
                    textAlign: 'center',
                    fontSize: 14.5,
                    color: 'hsl(var(--muted-foreground))',
                  }}
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading && sorted.map((row, ri) => (
              <tr
                key={row[keyField] ?? ri}
                onClick={() => onRowClick?.(row)}
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                  borderBottom: ri < sorted.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted) / 0.3)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '14px 16px',
                      fontSize: 14.5,
                      color: 'hsl(var(--foreground))',
                      fontFamily: col.mono ? MONO : undefined,
                    }}
                  >
                    {col.render ? col.render(row) : (row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > pagination.pageSize && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 14,
            color: 'hsl(var(--muted-foreground))',
          }}
        >
          <span>
            Showing {startItem}–{endItem} of {pagination.total}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              variant="outline" size="sm"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              style={{ height: 34, padding: '0 10px' }}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              style={{ height: 34, padding: '0 10px' }}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
