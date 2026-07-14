import { useRef, useMemo } from 'react'
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapRef, LngLatBoundsLike } from 'react-map-gl/maplibre'
import type { VesselMapProps, RouteNode } from '../utils/safeCubeMapAdapter'
import { resolvePortCoords } from '../utils/mapProjection'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

const TEAL      = '#1D9E75'
const AMBER     = '#D97706'
const WHITE_DIM = 'rgba(255,255,255,0.55)'
const WHITE_FULL= 'rgba(255,255,255,0.92)'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null, isActual: boolean): string {
  if (!d) return ''
  const f = new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return isActual ? f : `~${f}`
}

function aisLabel(status: string | null): string {
  if (!status) return ''
  const m: Record<string, string> = {
    UNDERWAY_USING_ENGINE:      'Underway',
    AT_ANCHOR:                  'At anchor',
    MOORED:                     'Moored',
    UNDERWAY_SAILING:           'Under sail',
    NOT_UNDER_COMMAND:          'Not under command',
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
  if (node.cleared)  return TEAL
  if (node.isActual) return AMBER
  return 'rgba(255,255,255,0.25)'
}

// Deduplicate breadcrumb: drop points within 0.4° of the previous kept point
// so multiple events at the same port don't create micro-zigzags.
function dedupBreadcrumb(pts: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = []
  for (const p of pts) {
    if (out.length === 0) { out.push(p); continue }
    const prev = out[out.length - 1]
    if (Math.abs(p.lat - prev.lat) > 0.4 || Math.abs(p.lng - prev.lng) > 0.4) {
      out.push(p)
    }
  }
  return out
}

// ── Port marker component ─────────────────────────────────────────────────────
function PortMarker({ node }: { node: RouteNode & { lat: number; lng: number } }) {
  const ring  = nodeRingColor(node)
  const label = node.locode ?? node.name.split(' ').slice(0, 2).join(' ')
  const date  = fmtDate(node.at, node.isActual)

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
      {/* Glow behind cleared nodes */}
      {node.cleared && (
        <div style={{
          position: 'absolute', top: -3, left: -3,
          width: 18, height: 18, borderRadius: '50%',
          background: TEAL, opacity: 0.18,
        }} />
      )}
      {/* Ring */}
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        background: ring,
        border: `1.5px solid ${node.cleared ? TEAL : 'rgba(255,255,255,0.2)'}`,
        boxShadow: node.cleared ? `0 0 6px ${TEAL}88` : 'none',
        position: 'relative', zIndex: 1,
      }}>
        {/* Centre pip */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 4, height: 4, borderRadius: '50%',
          background: node.cleared ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)',
        }} />
      </div>
      {/* Label */}
      <div style={{ marginTop: 5, textAlign: 'center', lineHeight: 1.3 }}>
        <div style={{
          fontSize: 9, fontWeight: 600, letterSpacing: '0.06em',
          color: node.cleared ? WHITE_FULL : WHITE_DIM,
          textTransform: 'uppercase',
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </div>
        {date && (
          <div style={{
            fontSize: 8.5, fontWeight: 500,
            color: node.isActual ? TEAL : AMBER,
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
            whiteSpace: 'nowrap',
          }}>
            {date}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Vessel icon component ─────────────────────────────────────────────────────
function VesselIcon({ heading }: { heading: number }) {
  return (
    <div style={{ position: 'relative', width: 0, height: 0 }}>
      {/* Pulse ring */}
      <div style={{
        position: 'absolute', top: -14, left: -14,
        width: 28, height: 28, borderRadius: '50%',
        border: `1.5px solid ${TEAL}`,
        animation: 'vessel-pulse 2.2s ease-out infinite',
      }} />
      {/* Ship SVG rotated by heading */}
      <div style={{ transform: `translate(-50%, -50%) rotate(${heading}deg)`, position: 'absolute' }}>
        <svg width="32" height="32" viewBox="-16 -16 32 32">
          {/* Hull */}
          <rect x={-10} y={-4} width={20} height={8} rx={3} fill="#E6F1FB" />
          {/* Superstructure */}
          <rect x={-5} y={-9} width={10} height={6} rx={2} fill="#B5D4F4" />
          {/* Mast */}
          <rect x={-1} y={-13} width={2} height={5} fill="#378ADD" />
          {/* Boom */}
          <rect x={0} y={-13} width={6} height={3} rx={1} fill="#378ADD" opacity={0.55} />
          {/* Waterline shadow */}
          <rect x={-11} y={3} width={22} height={2.5} rx={1.2} fill="#0F6E56" opacity={0.45} />
        </svg>
      </div>
    </div>
  )
}

// ── MapLibre layer paint configs ──────────────────────────────────────────────
const routeSpineLayer: any = {
  id: 'route-spine',
  type: 'line',
  paint: {
    'line-color': 'rgba(255,255,255,0.22)',
    'line-width': 1.5,
    'line-dasharray': [5, 4],
  },
  layout: { 'line-join': 'round', 'line-cap': 'round' },
}

const breadcrumbLayer: any = {
  id: 'breadcrumb',
  type: 'line',
  paint: {
    'line-color': TEAL,
    'line-width': 2.5,
    'line-opacity': 0.85,
  },
  layout: { 'line-join': 'round', 'line-cap': 'round' },
}

const breadcrumbDotsLayer: any = {
  id: 'breadcrumb-dots',
  type: 'circle',
  paint: {
    'circle-radius': 3,
    'circle-color': TEAL,
    'circle-opacity': 0.7,
    'circle-stroke-color': 'rgba(7,30,50,0.8)',
    'circle-stroke-width': 1,
  },
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VesselRouteMap({
  liveLat,
  liveLng,
  livePositionUpdatedAt,
  aisStatus,
  vesselName,
  vesselImo,
  vesselFlag,
  routeNodes,
  breadcrumb,
  currentLocationName,
  etaAt,
  etaLabel,
  scheduleStatus,
}: VesselMapProps) {

  const mapRef = useRef<MapRef>(null)

  // ── Resolve port coordinates ────────────────────────────────────────────────
  const portCoords = useMemo(() =>
    routeNodes.map(node => {
      const c = resolvePortCoords(node.locode, node.name)
      return c ? { ...node, lat: c.lat, lng: c.lng } : null
    }).filter(Boolean) as Array<RouteNode & { lat: number; lng: number }>
  , [routeNodes])

  // ── Route spine GeoJSON ────────────────────────────────────────────────────
  const routeGeoJSON = useMemo(() => {
    if (portCoords.length < 2) return null
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: portCoords.map(p => [p.lng, p.lat]) },
        properties: {},
      }],
    }
  }, [portCoords])

  // ── Breadcrumb GeoJSON ─────────────────────────────────────────────────────
  const crumbGeoJSON = useMemo(() => {
    const deduped = dedupBreadcrumb(breadcrumb)
    if (deduped.length === 0) return null
    const coords = deduped.map(b => [b.lng, b.lat])
    return {
      type: 'FeatureCollection' as const,
      features: [
        ...(coords.length >= 2 ? [{
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: coords },
          properties: {},
        }] : []),
        ...coords.map(c => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: c },
          properties: {},
        })),
      ],
    }
  }, [breadcrumb])

  // ── Camera bounds ───────────────────────────────────────────────────────────
  const initialBounds = useMemo((): LngLatBoundsLike | undefined => {
    const all: [number, number][] = [
      ...portCoords.map(p => [p.lng, p.lat] as [number, number]),
      ...breadcrumb.map(b => [b.lng, b.lat] as [number, number]),
      ...(liveLat != null && liveLng != null ? [[liveLng, liveLat] as [number, number]] : []),
    ]
    if (all.length === 0) return undefined
    const lngs = all.map(c => c[0])
    const lats = all.map(c => c[1])
    const pad = 8
    return [
      [Math.min(...lngs) - pad, Math.min(...lats) - pad],
      [Math.max(...lngs) + pad, Math.max(...lats) + pad],
    ]
  }, [portCoords, breadcrumb, liveLat, liveLng])

  const heading = useMemo(() => deriveHeading(breadcrumb), [breadcrumb])
  const etaDisplay = etaLabel ?? (etaAt ? new Date(etaAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

  // ── Empty guard ─────────────────────────────────────────────────────────────
  if (portCoords.length === 0 && liveLat == null) {
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
      {/* Pulse keyframe — injected once */}
      <style>{`
        @keyframes vessel-pulse {
          0%   { transform: scale(0.8); opacity: 0.6; }
          70%  { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(0.8); opacity: 0; }
        }
      `}</style>

      <div style={{ position: 'relative', height: 320, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>

        {/* ── MapLibre map ──────────────────────────────────────────────── */}
        <Map
          ref={mapRef}
          mapStyle={MAP_STYLE}
          initialViewState={
            initialBounds
              ? { bounds: initialBounds, fitBoundsOptions: { padding: 48, maxZoom: 8 } }
              : { longitude: 90, latitude: 25, zoom: 2 }
          }
          style={{ width: '100%', height: '100%' }}
          scrollZoom
          dragPan
          attributionControl={false}
        >
          {/* Planned route spine */}
          {routeGeoJSON && (
            <Source id="route-spine-src" type="geojson" data={routeGeoJSON}>
              <Layer {...routeSpineLayer} />
            </Source>
          )}

          {/* Sailed breadcrumb line + dots */}
          {crumbGeoJSON && (
            <Source id="crumb-src" type="geojson" data={crumbGeoJSON}>
              <Layer {...breadcrumbLayer} filter={['==', '$type', 'LineString']} />
              <Layer {...breadcrumbDotsLayer} filter={['==', '$type', 'Point']} />
            </Source>
          )}

          {/* Port node markers */}
          {portCoords.map(node => (
            <Marker
              key={node.type}
              longitude={node.lng}
              latitude={node.lat}
              anchor="top"
              offset={[0, -6]}
            >
              <PortMarker node={node} />
            </Marker>
          ))}

          {/* Live vessel */}
          {liveLat != null && liveLng != null && (
            <Marker longitude={liveLng} latitude={liveLat} anchor="center">
              <VesselIcon heading={heading} />
            </Marker>
          )}
        </Map>

        {/* ── HUD overlays (above the map) ─────────────────────────────── */}

        {/* Top-left: AIS status */}
        {aisStatus && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 10,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(7,30,50,0.88)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            fontSize: 10, fontWeight: 500, color: WHITE_FULL,
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            {aisLabel(aisStatus)}
            {vesselFlag && <span style={{ marginLeft: 2, opacity: 0.55 }}>{vesselFlag}</span>}
          </div>
        )}

        {/* Current location label (near top-left, below AIS badge if both present) */}
        {currentLocationName && !aisStatus && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 10,
            padding: '4px 10px', borderRadius: 99,
            background: 'rgba(7,30,50,0.88)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            fontSize: 10, color: WHITE_DIM,
            backdropFilter: 'blur(4px)',
          }}>
            {currentLocationName.length > 28 ? currentLocationName.slice(0, 28) + '…' : currentLocationName}
          </div>
        )}

        {/* Top-right: ETA chip */}
        {etaDisplay && (
          <div style={{
            position: 'absolute', top: 10, right: 10, zIndex: 10,
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
              <span style={{ color: scheduleColor(scheduleStatus) }}>· {scheduleStatus}</span>
            )}
          </div>
        )}

        {/* Bottom-left: vessel identity */}
        {vesselName && (
          <div style={{
            position: 'absolute', bottom: 10, left: 10, zIndex: 10,
            fontSize: 10, color: WHITE_DIM,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}>
            <span style={{ fontWeight: 600, color: WHITE_FULL }}>{vesselName}</span>
            {vesselImo && <span style={{ marginLeft: 6, opacity: 0.45 }}>IMO {vesselImo}</span>}
          </div>
        )}

        {/* Bottom-right: last AIS update */}
        {livePositionUpdatedAt && (
          <div style={{
            position: 'absolute', bottom: 10, right: 10, zIndex: 10,
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
