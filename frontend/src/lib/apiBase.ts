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

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/api/')) return BACKEND_API_BASE ? `${BACKEND_API_BASE}${path}` : path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
