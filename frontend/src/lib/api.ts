import { REFRESH_TOKEN_KEY, SESSION_TOKEN_KEY } from '@/auth/api';
import { API_BASE_URL, resolveApiUrl } from '@/lib/apiBase';

let authToken: string | null = null;
const COOKIE_REFRESH_OK = '__cookie_refresh_ok__';
let refreshPromise: Promise<string | null> | null = null;

export { API_BASE_URL } from '@/lib/apiBase';

export function apiUrl(path: string): string {
  return resolveApiUrl(path);
}

export function setAuthToken(token: string): void {
  authToken = token;
}

export function clearAuthToken(): void {
  authToken = null;
}

export function getAuthToken(): string | null {
  return authToken ?? window.localStorage.getItem(SESSION_TOKEN_KEY);
}

async function refreshAccessToken(): Promise<string | null> {
  // Prefer the httpOnly refresh cookie; fall back to legacy localStorage token.
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);

  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: refreshToken ? JSON.stringify({ refresh_token: refreshToken }) : '{}',
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const accessToken = typeof data?.access_token === 'string' ? data.access_token : null;
        if (!accessToken) {
          clearAuthToken();
          window.localStorage.removeItem(SESSION_TOKEN_KEY);
          return COOKIE_REFRESH_OK;
        }

        authToken = accessToken;
        window.localStorage.setItem(SESSION_TOKEN_KEY, accessToken);
        if (typeof data?.refresh_token === 'string' && data.refresh_token.trim()) {
          window.localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        }
        return accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

let clearingExpiredSession = false;

function clearExpiredSession() {
  if (clearingExpiredSession) return;
  clearingExpiredSession = true;
  clearAuthToken();
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (!['/', '/login', '/forgot-password', '/reset-password'].includes(window.location.pathname)) {
    window.location.replace('/login');
  }
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const url = resolveApiUrl(path);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  // Fallback: if a legacy localStorage token exists, still send it as Bearer
  // so existing sessions keep working during the transition.
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && retry) {
      const nextAccessToken = await refreshAccessToken();
      if (nextAccessToken) {
        return request<T>(path, options, false);
      }
      clearExpiredSession();
    }
    const detail = data && typeof data === 'object' && 'detail' in data ? String(data.detail) : `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return data as T;
}

export async function readJsonResponse<T = any>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const data = contentType.includes('application/json') && text
    ? JSON.parse(text)
    : null;

  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data
      ? String((data as any).detail)
      : data && typeof data === 'object' && 'error' in data
        ? String((data as any).error)
        : text.trim().startsWith('<')
          ? `API returned HTML instead of JSON (${response.status}). Check backend URL/proxy.`
          : text.trim() || `Request failed (${response.status})`;
    throw new Error(detail);
  }

  if (!data) {
    throw new Error('API returned a non-JSON response. Check backend URL/proxy.');
  }
  return data as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
