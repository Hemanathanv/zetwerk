import { createContext, useContext, useState, type ReactNode } from 'react';

export type PageMetaBadgeVariant = 'teal' | 'gold';

export type PageMeta = {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: { label: string; variant: PageMetaBadgeVariant };
  actions?: ReactNode;
};

interface PageMetaContextType {
  pageMeta: PageMeta | null;
  setPageMeta: (meta: PageMeta | null) => void;
}

const PageMetaContext = createContext<PageMetaContextType | null>(null);

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  return (
    <PageMetaContext.Provider value={{ pageMeta, setPageMeta }}>
      {children}
    </PageMetaContext.Provider>
  );
}

export function usePageMeta() {
  const ctx = useContext(PageMetaContext);
  if (!ctx) throw new Error('usePageMeta must be used within a PageMetaProvider');
  return ctx;
}
