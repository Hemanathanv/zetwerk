import { useEffect, useMemo } from 'react'
import L, { type LatLngBoundsExpression } from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { BreadcrumbPoint, RouteNode, StopPoint, VesselMapProps } from '../utils/safeCubeMapAdapter'
import { resolvePortCoords } from '../utils/mapProjection'

const TEAL = '#1D9E75'
const AMBER = '#D97706'
const WHITE_DIM = 'rgba(255,255,255,0.55)'
const WHITE_FULL = 'rgba(255,255,255,0.92)'

function fmtDate(d: string | null, isActual: boolean): string {
  if (!d) return ''
  const f = new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return isActual ? f : `~${f}`
}

function aisLabel(status: string | null): string {
  if (!status) return ''
  const m: Record<string, string> = {
    UNDERWAY_USING_ENGINE: 'Underway',
    AT_ANCHOR: 'At anchor',
    MOORED: 'Moored',
    UNDERWAY_SAILING: 'Under sail',
    NOT_UNDER_COMMAND: 'Not under command',
    RESTRICTED_MANOEUVRABILITY: 'Restricted',
  }
  return m[status] ?? status.replace(/_/g, ' ').toLowerCase()
}

function scheduleColor(s: string | null): string {
  if (!s) return WHITE_DIM
  if (s.toLowerCase().includes('delay')) return AMBER
  if (s.toLowerCase().includes('early')) return TEAL
  return WHITE_DIM
}

function deriveHeading(breadcrumb: { lat: number; lng: number }[]): number {
  if (breadcrumb.length < 2) return 0
  const last = breadcrumb[breadcrumb.length - 1]
  const prev = breadcrumb[breadcrumb.length - 2]
  return (Math.atan2(last.lng - prev.lng, last.lat - prev.lat) * 180 / Math.PI + 360) % 360
}

function nodeRingColor(node: RouteNode): string {
  if (node.cleared) return TEAL
  if (node.isActual) return AMBER
  return 'rgba(255,255,255,0.25)'
}

function dedupBreadcrumb(pts: BreadcrumbPoint[]): BreadcrumbPoint[] {
  const out: BreadcrumbPoint[] = []
  for (const p of pts) {
    if (out.length === 0) {
      out.push(p)
      continue
    }
    const prev = out[out.length - 1]
    if (Math.abs(p.lat - prev.lat) > 0.4 || Math.abs(p.lng - prev.lng) > 0.4) {
      out.push(p)
    }
  }
  return out
}

function createDivIcon(html: string, className: string, size: [number, number], anchor: [number, number]) {
  return L.divIcon({
    html,
    className,
    iconSize: size,
    iconAnchor: anchor,
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function portIcon(node: RouteNode) {
  const ring = nodeRingColor(node)
  const label = escapeHtml(node.locode ?? node.name.split(' ').slice(0, 2).join(' '))
  const date = escapeHtml(fmtDate(node.at, node.isActual))
  const glow = node.cleared
    ? `<span class="ewms-port-glow"></span>`
    : ''
  const dateHtml = date
    ? `<span class="ewms-port-date" style="color:${node.isActual ? TEAL : AMBER}">${date}</span>`
    : ''

  return createDivIcon(
    `<span class="ewms-port-marker">
      ${glow}
      <span class="ewms-port-ring" style="background:${ring};border-color:${node.cleared ? TEAL : 'rgba(255,255,255,0.2)'}">
        <span style="background:${node.cleared ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)'}"></span>
      </span>
      <span class="ewms-port-label" style="color:${node.cleared ? WHITE_FULL : WHITE_DIM}">${label}</span>
      ${dateHtml}
    </span>`,
    'ewms-leaflet-div-icon',
    [92, 56],
    [46, 8],
  )
}

function stopIcon(stop: StopPoint) {
  const label = escapeHtml(stop.locode ?? stop.name?.split(' ').slice(0, 2).join(' ') ?? 'Stop')
  return createDivIcon(
    `<span class="ewms-stop-marker">
      <span class="ewms-stop-dot"></span>
      <span class="ewms-stop-label">${label}</span>
    </span>`,
    'ewms-leaflet-div-icon',
    [72, 34],
    [36, 7],
  )
}

function vesselIcon(heading: number) {
  return createDivIcon(
    `<span class="ewms-vessel-marker">
      <span class="ewms-vessel-pulse"></span>
      <span class="ewms-vessel-ship" style="transform:translate(-50%, -50%) rotate(${heading}deg)">
        <svg width="32" height="32" viewBox="-16 -16 32 32" aria-hidden="true">
          <rect x="-10" y="-4" width="20" height="8" rx="3" fill="#E6F1FB" />
          <rect x="-5" y="-9" width="10" height="6" rx="2" fill="#B5D4F4" />
          <rect x="-1" y="-13" width="2" height="5" fill="#378ADD" />
          <rect x="0" y="-13" width="6" height="3" rx="1" fill="#378ADD" opacity="0.55" />
          <rect x="-11" y="3" width="22" height="2.5" rx="1.2" fill="#0F6E56" opacity="0.45" />
        </svg>
      </span>
    </span>`,
    'ewms-leaflet-div-icon',
    [36, 36],
    [18, 18],
  )
}

function FitBounds({ bounds }: { bounds?: LatLngBoundsExpression }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 8 })
  }, [bounds, map])
  return null
}

export default function VesselRouteMap({
  liveLat,
  liveLng,
  livePositionUpdatedAt,
  aisStatus,
  vesselName,
  vesselImo,
  vesselFlag,
  routeNodes,
  routePoints,
  breadcrumb,
  stops,
  currentLocationName,
  etaAt,
  etaLabel,
  scheduleStatus,
}: VesselMapProps) {
  const portCoords = useMemo(() =>
    routeNodes
      .map(node => {
        const c = node.lat != null && node.lng != null
          ? { lat: node.lat, lng: node.lng }
          : resolvePortCoords(node.locode, node.name)
        return c ? { ...node, lat: c.lat, lng: c.lng } : null
      })
      .filter(Boolean) as Array<RouteNode & { lat: number; lng: number }>
  , [routeNodes])

  const dedupedBreadcrumb = useMemo(() => dedupBreadcrumb(breadcrumb), [breadcrumb])

  const portLine = useMemo(() =>
    portCoords.map(p => [p.lat, p.lng] as [number, number])
  , [portCoords])

  const seaRouteLine = useMemo(() =>
    routePoints.map(p => [p.lat, p.lng] as [number, number])
  , [routePoints])

  const stopCoords = useMemo(() =>
    stops.map(p => [p.lat, p.lng] as [number, number])
  , [stops])

  const breadcrumbLine = useMemo(() =>
    dedupedBreadcrumb.map(p => [p.lat, p.lng] as [number, number])
  , [dedupedBreadcrumb])

  const bounds = useMemo((): LatLngBoundsExpression | undefined => {
    const all: [number, number][] = [
      ...seaRouteLine,
      ...portLine,
      ...stopCoords,
      ...(liveLat != null && liveLng != null ? [[liveLat, liveLng] as [number, number]] : []),
    ]
    if (all.length === 0) return undefined
    return all
  }, [seaRouteLine, portLine, stopCoords, liveLat, liveLng])

  const heading = useMemo(() => deriveHeading(dedupedBreadcrumb), [dedupedBreadcrumb])
  const etaDisplay = etaLabel ?? (etaAt ? new Date(etaAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

  if (portCoords.length === 0 && seaRouteLine.length === 0 && liveLat == null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 320, borderRadius: 14, background: '#071e32', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0 }}>Awaiting tracking data</p>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>Vessel position will appear once SafeCube sync runs</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes vessel-pulse {
          0% { transform: scale(0.8); opacity: 0.6; }
          70% { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(0.8); opacity: 0; }
        }
        .ewms-vessel-route-map .leaflet-container {
          width: 100%;
          height: 100%;
          background: #071e32;
          font-family: inherit;
        }
        .ewms-vessel-route-map .leaflet-control-attribution {
          display: none;
        }
        .ewms-leaflet-div-icon {
          background: transparent;
          border: 0;
        }
        .ewms-port-marker {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: auto;
          width: 92px;
        }
        .ewms-port-glow {
          position: absolute;
          top: -3px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: ${TEAL};
          opacity: 0.18;
        }
        .ewms-port-ring {
          position: relative;
          z-index: 1;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1.5px solid rgba(255,255,255,0.2);
          box-shadow: 0 0 6px ${TEAL}55;
        }
        .ewms-port-ring > span {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          transform: translate(-50%, -50%);
        }
        .ewms-port-label,
        .ewms-port-date {
          margin-top: 5px;
          max-width: 92px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: center;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9);
        }
        .ewms-port-label {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
        }
        .ewms-port-date {
          margin-top: 2px;
          font-size: 8.5px;
          font-weight: 500;
        }
        .ewms-vessel-marker {
          position: relative;
          display: block;
          width: 36px;
          height: 36px;
        }
        .ewms-vessel-pulse {
          position: absolute;
          top: 4px;
          left: 4px;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1.5px solid ${TEAL};
          animation: vessel-pulse 2.2s ease-out infinite;
        }
        .ewms-vessel-ship {
          position: absolute;
          top: 50%;
          left: 50%;
          transform-origin: center;
        }
        .ewms-stop-marker {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 72px;
        }
        .ewms-stop-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.88);
          border: 2px solid ${TEAL};
          box-shadow: 0 0 0 3px rgba(29,158,117,0.16);
        }
        .ewms-stop-label {
          margin-top: 4px;
          max-width: 72px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: rgba(255,255,255,0.78);
          font-size: 8px;
          font-weight: 600;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0,0,0,0.9);
        }
      `}</style>

      <div className="ewms-vessel-route-map" style={{ position: 'relative', height: 320, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
        <MapContainer
          center={liveLat != null && liveLng != null ? [liveLat, liveLng] : [25, 90]}
          zoom={liveLat != null && liveLng != null ? 5 : 2}
          scrollWheelZoom
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <FitBounds bounds={bounds} />

          {portLine.length >= 2 && seaRouteLine.length < 2 && (
            <Polyline
              positions={portLine}
              pathOptions={{ color: 'rgba(255,255,255,0.42)', weight: 2, dashArray: '6 6' }}
            />
          )}

          {seaRouteLine.length >= 2 && (
            <Polyline
              positions={seaRouteLine}
              pathOptions={{ color: TEAL, weight: 3, opacity: 0.88 }}
            />
          )}

          {seaRouteLine.length < 2 && breadcrumbLine.length >= 2 && (
            <Polyline
              positions={breadcrumbLine}
              pathOptions={{ color: TEAL, weight: 3, opacity: 0.88 }}
            />
          )}

          {stops.map(stop => (
            <Marker
              key={stop.id}
              position={[stop.lat, stop.lng]}
              icon={stopIcon(stop)}
            >
              <Popup>
                <strong>{stop.name || stop.locode || 'Ship stop'}</strong>
                {stop.locode ? <div>{stop.locode}</div> : null}
                {stop.description ? <div>{stop.description}</div> : null}
                {stop.eventAt ? <div>{new Date(stop.eventAt).toLocaleString()}</div> : null}
              </Popup>
            </Marker>
          ))}

          {dedupedBreadcrumb.map(point => (
            <CircleMarker
              key={`${point.sequenceNo}-${point.lat}-${point.lng}`}
              center={[point.lat, point.lng]}
              radius={3}
              pathOptions={{ color: 'rgba(7,30,50,0.8)', weight: 1, fillColor: TEAL, fillOpacity: 0.75 }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                {point.locationName || point.description || 'Tracking event'}
              </Tooltip>
            </CircleMarker>
          ))}

          {portCoords.map(node => (
            <Marker
              key={node.type}
              position={[node.lat, node.lng]}
              icon={portIcon(node)}
            >
              <Popup>
                <strong>{node.name}</strong>
                {node.locode ? <div>{node.locode}</div> : null}
                {node.at ? <div>{fmtDate(node.at, node.isActual)}</div> : null}
              </Popup>
            </Marker>
          ))}

          {liveLat != null && liveLng != null && (
            <Marker position={[liveLat, liveLng]} icon={vesselIcon(heading)}>
              <Popup>
                <strong>{vesselName || 'Vessel'}</strong>
                {currentLocationName ? <div>{currentLocationName}</div> : null}
              </Popup>
            </Marker>
          )}
        </MapContainer>

        {aisStatus && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 500,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(7,30,50,0.88)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            fontSize: 10, fontWeight: 500, color: WHITE_FULL,
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
            {aisLabel(aisStatus)}
            {vesselFlag && <span style={{ marginLeft: 2, opacity: 0.55 }}>{vesselFlag}</span>}
          </div>
        )}

        {currentLocationName && !aisStatus && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 500,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(7,30,50,0.88)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            fontSize: 10, color: WHITE_DIM,
            backdropFilter: 'blur(4px)',
          }}>
            {currentLocationName.length > 28 ? `${currentLocationName.slice(0, 28)}...` : currentLocationName}
          </div>
        )}

        {etaDisplay && (
          <div style={{
            position: 'absolute', top: 10, right: 10, zIndex: 500,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(7,30,50,0.88)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            fontSize: 10, fontWeight: 500,
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: WHITE_DIM }}>ETA</span>
            <span style={{ color: WHITE_FULL }}>{etaDisplay}</span>
            {scheduleStatus && (
              <span style={{ color: scheduleColor(scheduleStatus) }}>- {scheduleStatus}</span>
            )}
          </div>
        )}

        {vesselName && (
          <div style={{
            position: 'absolute', bottom: 10, left: 10, zIndex: 500,
            fontSize: 10, color: WHITE_DIM,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}>
            <span style={{ fontWeight: 600, color: WHITE_FULL }}>{vesselName}</span>
            {vesselImo && <span style={{ marginLeft: 6, opacity: 0.45 }}>IMO {vesselImo}</span>}
          </div>
        )}

        {livePositionUpdatedAt && (
          <div style={{
            position: 'absolute', bottom: 10, right: 10, zIndex: 500,
            fontSize: 10, color: 'rgba(255,255,255,0.28)',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}>
            AIS {new Date(livePositionUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </>
  )
}
