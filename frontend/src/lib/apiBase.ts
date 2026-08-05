export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

export function getBackendApiBase(): string {
  const backendBase = import.meta.env.VITE_BACKEND_API_BASE as string | undefined;
  if (backendBase) return backendBase.replace(/\/$/, '');

  if (!/^https?:\/\//i.test(API_BASE_URL)) return '';

  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return '';
  }
}

export const BACKEND_API_BASE = getBackendApiBase();

function normalizeApiPath(path: string): string {
  if (path === '/api') return '/api/v1';
  if (path === '/api/v1' || path.startsWith('/api/v1/')) return path;
  if (path.startsWith('/api/')) return `/api/v1/${path.slice('/api/'.length)}`;
  return path;
}

function isSameBackendOrigin(url: URL): boolean {
  const backendOrigin = BACKEND_API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
  const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  return Boolean((backendOrigin && url.origin === backendOrigin) || (browserOrigin && url.origin === browserOrigin));
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (isSameBackendOrigin(url)) {
        url.pathname = normalizeApiPath(url.pathname);
        return url.toString();
      }
    } catch {
      return path;
    }
    return path;
  }

  const normalizedPath = normalizeApiPath(path);
  if (normalizedPath.startsWith('/api/')) {
    return BACKEND_API_BASE ? `${BACKEND_API_BASE}${normalizedPath}` : normalizedPath;
  }
  return `${API_BASE_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}
