import { useState, useEffect, useCallback } from 'react';
import { getAuthToken } from '@/lib/api';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {};
}

export interface GateProgressItem {
  gateNumber: number;
  gateName: string;
  status: string;
}

export interface AttentionItem {
  severity: 'danger' | 'warning' | 'info';
  type: string;
  title: string;
  body: string;
  shipmentRef: string | null;
  metaLabel: string | null;
  shipmentId: string | null;
}

export interface ShipmentRow {
  id: string;
  shipmentNumber: string | null;
  vesselName: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  status: string;
  gateProgress: GateProgressItem[];
  docApproved: number;
  docTotal: number;
  docPendingReview: number;
  inventoryKg: number | null;
  inventoryQt: number | null;
  inventoryUom: string | null;
  inventoryLocationLabel: string | null;
  etaAt: string | null;
  etaLabel: string | null;
  scheduleStatus: string | null;
  shippingStatus: string | null;
  dndAccruedUsd: number | null;
}

export interface ProjectDetailData {
  project: {
    id: string;
    projectCode: string;
    projectName: string | null;
    customerName: string | null;
    buyerOrgName: string | null;
    status: string;
    notes: string | null;
    createdAt: string;
  };
  summary: {
    totalShipments: number;
    deliveredShipments: number;
    totalDocuments: number;
    approvedDocuments: number;
    pendingReviewDocuments: number;
    totalInventoryKg: number | null;
    totalInventoryUom: string | null;
    totalInventoryQt: number | null;
    deliveredInventoryKg: number | null;
    inTransitInventoryKg: number | null;
    totalDndAccruedUsd: number;
    activeDndContainerCount: number;
    activeDndLfds: string[];
    totalApApprovedUsd: number;
    totalApOverdueCount: number;
    totalFreightUsd: number | null;
    totalDndUsd: number;
  };
  attentionItems: AttentionItem[];
  shipments: ShipmentRow[];
  financials: {
    contractValueUsd: number | null;
    apInvoicesUsd: number | null;
    apApprovedCount: number;
    apOverdueCount: number;
    freightCostsUsd: number | null;
    dndAccruedUsd: number;
    revenueRecognisedUsd: number | null;
    outstandingUsd: number | null;
  };
}

export function useProjectDetail(projectId: string | undefined) {
  const [data, setData]     = useState<ProjectDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/detail`, { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
      } else {
        setError(json.error ?? 'Failed to load project');
      }
    } catch {
      setError('Network error — could not load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}
