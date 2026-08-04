export interface RouteNode {
  type: 'prepol' | 'pol' | 'pod' | 'postpod'
  name: string
  locode: string | null
  lat: number | null
  lng: number | null
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

export interface StopPoint {
  id: string
  name: string | null
  locode: string | null
  lat: number
  lng: number
  country: string | null
  eventAt: string | null
  description: string | null
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
  routePoints: Array<{ lat: number; lng: number }>
  breadcrumb: BreadcrumbPoint[]
  stops: StopPoint[]

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
    prepodLat?: any
    prepodLng?: any
    prepodAt: string | null
    prepodActual: boolean | null
    prepodPredictiveEta: string | null

    polName: string | null
    polLocode: string | null
    polLat?: any
    polLng?: any
    polAt: string | null
    polActual: boolean | null
    polPredictiveEta: string | null

    podName: string | null
    podLocode: string | null
    podLat?: any
    podLng?: any
    podAt: string | null
    podActual: boolean | null
    podPredictiveEta: string | null

    postpodName: string | null
    postpodLocode: string | null
    postpodLat?: any
    postpodLng?: any
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
    routePoints?: Array<{ lat: any; lng: any }>
    locations?: Array<{
      id?: string
      name?: string | null
      locode?: string | null
      lat?: any
      lng?: any
      country?: string | null
    }>
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
      lat: shipment.prepodLat != null ? Number(shipment.prepodLat) : null,
      lng: shipment.prepodLng != null ? Number(shipment.prepodLng) : null,
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
      lat: shipment.polLat != null ? Number(shipment.polLat) : null,
      lng: shipment.polLng != null ? Number(shipment.polLng) : null,
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
      lat: shipment.podLat != null ? Number(shipment.podLat) : null,
      lng: shipment.podLng != null ? Number(shipment.podLng) : null,
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
      lat: shipment.postpodLat != null ? Number(shipment.postpodLat) : null,
      lng: shipment.postpodLng != null ? Number(shipment.postpodLng) : null,
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

  const routePoints = (shipment.routePoints ?? [])
    .map(point => ({
      lat: Number(point.lat),
      lng: Number(point.lng),
    }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))

  const stopMap = new Map<string, StopPoint>()
  const addStop = (stop: StopPoint) => {
    const key = `${stop.lat.toFixed(4)}:${stop.lng.toFixed(4)}`
    const existing = stopMap.get(key)
    if (!existing) {
      stopMap.set(key, stop)
      return
    }
    stopMap.set(key, {
      ...existing,
      name: existing.name ?? stop.name,
      locode: existing.locode ?? stop.locode,
      country: existing.country ?? stop.country,
      eventAt: existing.eventAt ?? stop.eventAt,
      description: existing.description ?? stop.description,
    })
  }

  routeNodes.forEach(node => {
    if (node.lat == null || node.lng == null) return
    addStop({
      id: node.type,
      name: node.name,
      locode: node.locode,
      lat: node.lat,
      lng: node.lng,
      country: null,
      eventAt: node.at,
      description: node.type.toUpperCase(),
    })
  })

  ;(shipment.locations ?? []).forEach((location, index) => {
    if (location.lat == null || location.lng == null) return
    addStop({
      id: location.id ?? `location-${index + 1}`,
      name: location.name ?? null,
      locode: location.locode ?? null,
      lat: Number(location.lat),
      lng: Number(location.lng),
      country: location.country ?? null,
      eventAt: null,
      description: 'SafeCube stop',
    })
  })

  breadcrumb.forEach((event, index) => {
    addStop({
      id: `event-${event.sequenceNo || index + 1}`,
      name: event.locationName,
      locode: null,
      lat: event.lat,
      lng: event.lng,
      country: null,
      eventAt: event.eventAt,
      description: event.description,
    })
  })

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
    routePoints,
    breadcrumb,
    stops: Array.from(stopMap.values()).sort((a, b) => {
      if (!a.eventAt && !b.eventAt) return 0
      if (!a.eventAt) return -1
      if (!b.eventAt) return 1
      return new Date(a.eventAt).getTime() - new Date(b.eventAt).getTime()
    }),
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
