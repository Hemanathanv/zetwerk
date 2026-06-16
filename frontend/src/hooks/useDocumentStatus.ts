import { useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/api';

const API_BASE = ((import.meta.env.VITE_BACKEND_API_BASE as string | undefined) ?? 'http://localhost:8000').replace(/\/$/, '');

export type OcrStatus =
  | 'UPLOADED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'EXTRACTED'
  | 'FAILED'
  | 'ERROR'
  | 'FAILED_PERMANENTLY';

// Normalise legacy lowercase statuses to canonical uppercase enum values.
// Backend may still return 'completed', 'failed', 'pending', 'error' for older rows.
function normalizeStatus(raw: string): OcrStatus {
  switch (raw.toLowerCase()) {
    case 'completed':
    case 'extracted': return 'EXTRACTED';
    case 'failed':    return 'FAILED';
    case 'error':     return 'ERROR';
    case 'queued':    return 'QUEUED';
    case 'processing': return 'PROCESSING';
    case 'failed_permanently': return 'FAILED_PERMANENTLY';
    case 'uploaded':
    case 'pending':
    default:          return 'UPLOADED';
  }
}

const TERMINAL: OcrStatus[] = ['EXTRACTED', 'FAILED', 'ERROR', 'FAILED_PERMANENTLY'];

export interface DocumentStatusResult {
  status: OcrStatus | null;
  extractionId: string | null;
  errorMessage: string | null;
  ocrProcessedAt: string | null;
  isPolling: boolean;
  isTerminal: boolean;
  isStalled: boolean;
  stalledForMs: number | null;
  refetch: () => void;
}

export function useDocumentStatus(documentId: string | null | undefined): DocumentStatusResult {
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ocrProcessedAt, setOcrProcessedAt] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [stalledForMs, setStalledForMs] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  function clearPoll() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function fetchStatus() {
    if (!documentId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/documents/${documentId}/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      if (!payload?.ok || !mountedRef.current) return;

      const data = payload.data;
      const rawStatus: string = data.ocrStatus ?? data.status ?? 'UPLOADED';
      const newStatus: OcrStatus = normalizeStatus(rawStatus);
      setStatus(newStatus);
      setExtractionId(data.extraction?.id ?? null);
      setErrorMessage(data.errorMessage ?? null);
      setOcrProcessedAt(data.ocrProcessedAt ?? null);
      setIsStalled(data.isStalled === true);
      setStalledForMs(typeof data.stalledForMs === 'number' ? data.stalledForMs : null);

      if (TERMINAL.includes(newStatus)) {
        clearPoll();
        setIsPolling(false);
      }
    } catch {
    }
  }

  function startPolling() {
    clearPoll();
    setIsPolling(true);
    void fetchStatus();
    intervalRef.current = setInterval(() => {
      void fetchStatus();
    }, 3000);
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!documentId) return;
    startPolling();
    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [documentId]);

  const isTerminal = status !== null && TERMINAL.includes(status);

  function refetch() {
    setStatus(null);
    setExtractionId(null);
    setErrorMessage(null);
    setOcrProcessedAt(null);
    setIsStalled(false);
    setStalledForMs(null);
    startPolling();
  }

  return { status, extractionId, errorMessage, ocrProcessedAt, isPolling, isTerminal, isStalled, stalledForMs, refetch };
}
