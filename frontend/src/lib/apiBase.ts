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

function toSameOriginApiPath(url: URL): string {
  return `${normalizeApiPath(url.pathname)}${url.search}${url.hash}`;
}

/**
 * Resolve API paths for the browser.
 *
 * Always prefer same-origin `/api/...` URLs in the browser so:
 * - Vite (dev) or nginx (prod) can proxy to the real backend
 * - httpOnly session cookies set on the app origin are sent
 *
 * Rewriting to VITE_BACKEND_API_BASE (cross-origin) drops those cookies,
 * causes 401s on roles/notifications, and triggers a login redirect loop.
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (typeof window !== 'undefined') {
        const backendOrigin = BACKEND_API_BASE
          ? (() => {
              try {
                return new URL(BACKEND_API_BASE).origin;
              } catch {
                return '';
              }
            })()
          : '';
        if (
          url.origin === window.location.origin ||
          (backendOrigin && url.origin === backendOrigin)
        ) {
          return toSameOriginApiPath(url);
        }
      } else if (isSameBackendOrigin(url)) {
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
    if (typeof window !== 'undefined') {
      return normalizedPath;
    }
    return BACKEND_API_BASE ? `${BACKEND_API_BASE}${normalizedPath}` : normalizedPath;
  }
  return `${API_BASE_URL}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}
