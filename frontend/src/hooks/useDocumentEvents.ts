import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "@/lib/api";

export interface DocumentStatusEvent {
  type: "status_changed";
  documentId: string;
  status: string;
  shipmentId?: string;
}

export type DocumentEvent = DocumentStatusEvent;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useDocumentEvents(): DocumentEvent | null {
  const [lastEvent, setLastEvent] = useState<DocumentEvent | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryDelayRef = useRef(BASE_DELAY_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const token = getAuthToken();
      if (!token) return;

      const url = `/api/events/documents?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as DocumentEvent;
          retryDelayRef.current = BASE_DELAY_MS;
          setLastEvent(data);
        } catch {
          // ignore unparseable frames
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (unmountedRef.current) return;
        reconnectTimerRef.current = setTimeout(() => {
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_DELAY_MS);
          connect();
        }, retryDelayRef.current);
      };
    }

    connect();

    return () => {
      unmountedRef.current = true;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  return lastEvent;
}
