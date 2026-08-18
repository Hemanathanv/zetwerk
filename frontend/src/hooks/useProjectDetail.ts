import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

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
  blNumber?: string | null;
  bolNumber?: string | null;
  hblNumber?: string | null;
  mblNumber?: string | null;
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
  const query = useQuery({
    queryKey: ['projects', 'detail', projectId ?? ''],
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) throw new Error('Project id is required');
      const json = await apiGet<{ ok: boolean; data: ProjectDetailData; error?: string }>(
        '/api/projects/' + projectId + '/detail',
      );
      if (!json.ok) throw new Error(json.error ?? 'Failed to load project');
      return json.data;
    },
    placeholderData: previousData => previousData,
    staleTime: 60_000,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
