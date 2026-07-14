export interface RouteNode {
  type: 'prepol' | 'pol' | 'pod' | 'postpod'
  name: string
  locode: string | null
  at: string | null
  isActual: boolean
  cleared: boolean
}

export interface BreadcrumbPoint {
  lat: number
  lng: number
  sequenceNo: number
  eventAt: string | null
  description: string | null
  locationName: string | null
}

export interface VesselMapProps {
  liveLat: number | null
  liveLng: number | null
  livePositionUpdatedAt: string | null
  aisStatus: string | null

  vesselName: string | null
  vesselImo: number | null
  vesselFlag: string | null

  routeNodes: RouteNode[]
  breadcrumb: BreadcrumbPoint[]

  currentLocationName: string | null
  currentLocationDescription: string | null
  currentLocationAt: string | null
  currentLocationLat: number | null
  currentLocationLng: number | null
  currentLocationCountry: string | null

  etaAt: string | null
  etaLabel: string | null
  scheduleStatus: string | null
  shippingStatus: string | null

  segmentState: {
    prepolCleared: boolean
    polCleared: boolean
    podCleared: boolean
    postpodCleared: boolean
  }
}

export function adaptSafeCubeToMapProps(
  shipment: {
    liveLat: any
    liveLng: any
    livePositionUpdatedAt: string | null
    aisStatus: string | null
    vesselName: string | null
    vesselImo: number | null
    vesselFlag: string | null

    prepodName: string | null
    prepodLocode: string | null
    prepodAt: string | null
    prepodActual: boolean | null
    prepodPredictiveEta: string | null

    polName: string | null
    polLocode: string | null
    polAt: string | null
    polActual: boolean | null
    polPredictiveEta: string | null

    podName: string | null
    podLocode: string | null
    podAt: string | null
    podActual: boolean | null
    podPredictiveEta: string | null

    postpodName: string | null
    postpodLocode: string | null
    postpodAt: string | null
    postpodActual: boolean | null
    postpodPredictiveEta: string | null

    currentLocationName: string | null
    currentEventDescription: string | null
    currentLocationAt?: string | null
    currentLocationLat?: any
    currentLocationLng?: any
    currentLocationCountry?: string | null

    etaAt: string | null
    etaLabel?: string | null
    scheduleStatus: string | null
    shippingStatus: string | null
  },
  events: Array<{
    sequenceNo: number
    isActual: boolean | null
    locationLat: any
    locationLng: any
    eventAt: string | null
    description: string | null
    locationName: string | null
  }>
): VesselMapProps {

  const routeNodes: RouteNode[] = []

  if (shipment.prepodName) {
    routeNodes.push({
      type: 'prepol',
      name: shipment.prepodName,
      locode: shipment.prepodLocode,
      at: shipment.prepodAt ?? shipment.prepodPredictiveEta,
      isActual: !!shipment.prepodActual,
      cleared: !!shipment.prepodAt,
    })
  }
  if (shipment.polName) {
    routeNodes.push({
      type: 'pol',
      name: shipment.polName,
      locode: shipment.polLocode,
      at: shipment.polAt ?? shipment.polPredictiveEta,
      isActual: !!shipment.polActual,
      cleared: !!shipment.polAt,
    })
  }
  if (shipment.podName) {
    routeNodes.push({
      type: 'pod',
      name: shipment.podName,
      locode: shipment.podLocode,
      at: shipment.podAt ?? shipment.podPredictiveEta,
      isActual: !!shipment.podActual,
      cleared: !!shipment.podAt,
    })
  }
  if (shipment.postpodName) {
    routeNodes.push({
      type: 'postpod',
      name: shipment.postpodName,
      locode: shipment.postpodLocode,
      at: shipment.postpodAt ?? shipment.postpodPredictiveEta,
      isActual: !!shipment.postpodActual,
      cleared: !!shipment.postpodAt,
    })
  }

  const breadcrumb: BreadcrumbPoint[] = events
    .filter(e => e.isActual === true && e.locationLat != null && e.locationLng != null)
    .sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map(e => ({
      lat: Number(e.locationLat),
      lng: Number(e.locationLng),
      sequenceNo: e.sequenceNo,
      eventAt: e.eventAt,
      description: e.description,
      locationName: e.locationName,
    }))

  const liveLat = shipment.liveLat != null ? Number(shipment.liveLat) : null
  const liveLng = shipment.liveLng != null ? Number(shipment.liveLng) : null

  const currentLocationLat = shipment.currentLocationLat != null
    ? Number(shipment.currentLocationLat) : null
  const currentLocationLng = shipment.currentLocationLng != null
    ? Number(shipment.currentLocationLng) : null

  return {
    liveLat,
    liveLng,
    livePositionUpdatedAt: shipment.livePositionUpdatedAt,
    aisStatus: shipment.aisStatus,
    vesselName: shipment.vesselName,
    vesselImo: shipment.vesselImo,
    vesselFlag: shipment.vesselFlag,
    routeNodes,
    breadcrumb,
    currentLocationName: shipment.currentLocationName,
    currentLocationDescription: shipment.currentEventDescription,
    currentLocationAt: shipment.currentLocationAt ?? null,
    currentLocationLat,
    currentLocationLng,
    currentLocationCountry: shipment.currentLocationCountry ?? null,
    etaAt: shipment.etaAt,
    etaLabel: shipment.etaLabel ?? null,
    scheduleStatus: shipment.scheduleStatus,
    shippingStatus: shipment.shippingStatus,
    segmentState: {
      prepolCleared: !!shipment.prepodAt,
      polCleared: !!shipment.polAt,
      podCleared: !!shipment.podAt,
      postpodCleared: !!shipment.postpodAt,
    },
  }
}
