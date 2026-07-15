import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';

export interface SafeCubeContainer {
  id: string;
  number: string;
  isoCode: string | null;
  sizeType: string | null;
  status: string | null;
}

export interface SafeCubeEvent {
  id: string;
  containerId: string | null;
  sequenceNo: number;
  eventAt: string | null;
  description: string | null;
  eventCode: string | null;
  locationName: string | null;
  locationLocode: string | null;
  locationLat: number | null;
  locationLng: number | null;
  facilityName: string | null;
  isActual: boolean | null;
  transportType: string | null;
  vesselName: string | null;
}

export interface SafeCubeAlert {
  id: string;
  title: string | null;
  description: string | null;
  severity: string | null;
  status: string | null;
  isActive: boolean | null;
  alertAt: string | null;
  resolvedAt: string | null;
  locationName: string | null;
  category: string | null;
}

export interface SafeCubeData {
  id: string;
  vesselName: string | null;
  vesselImo: number | null;
  vesselCallSign: string | null;
  vesselFlag: string | null;
  liveLat: number | null;
  liveLng: number | null;
  livePositionUpdatedAt: string | null;
  aisStatus: string | null;
  currentLocationName: string | null;
  currentLocationAt: string | null;
  currentLocationLat: number | null;
  currentLocationLng: number | null;
  currentLocationCountry: string | null;
  currentEventDescription: string | null;
  scheduleStatus: string | null;
  delayDays: number | null;
  etaAt: string | null;
  etaLabel: string | null;
  shippingStatus: string | null;

  prepodName: string | null;
  prepodLocode: string | null;
  prepodLat: number | null;
  prepodLng: number | null;
  prepodAt: string | null;
  prepodActual: boolean | null;
  prepodPredictiveEta: string | null;

  polName: string | null;
  polLocode: string | null;
  polLat: number | null;
  polLng: number | null;
  polAt: string | null;
  polActual: boolean | null;
  polPredictiveEta: string | null;

  podName: string | null;
  podLocode: string | null;
  podLat: number | null;
  podLng: number | null;
  podAt: string | null;
  podActual: boolean | null;
  podPredictiveEta: string | null;

  postpodName: string | null;
  postpodLocode: string | null;
  postpodLat: number | null;
  postpodLng: number | null;
  postpodAt: string | null;
  postpodActual: boolean | null;
  postpodPredictiveEta: string | null;

  containers: SafeCubeContainer[];
  events: SafeCubeEvent[];
  alerts: SafeCubeAlert[];
}

export function useSafeCubeTracking(shipmentId: string) {
  const [data, setData]       = useState<SafeCubeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ ok: boolean; data: SafeCubeData | null; error?: string }>(
        `/api/shipments/${shipmentId}/safecube`,
      );
      if (res.ok) {
        setData(res.data);
      } else {
        setError(res.error ?? 'Failed to fetch tracking data');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}
