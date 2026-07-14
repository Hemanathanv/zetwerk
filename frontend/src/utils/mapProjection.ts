// Projects geographic lat/lng into SVG pixel coordinates.
// Bounding box: lat 0°–55°N, lng 60°E–290°E (60°E eastward to 70°W via date line)
// SVG viewBox: "0 0 1000 300"

const BOUNDS = {
  latMin:  0,
  latMax:  55,
  lngMin:  60,
  lngMax:  290,
}

const SVG_W = 1000
const SVG_H = 300

export function projectToSvg(lat: number, lng: number): [number, number] {
  let normLng = lng
  if (normLng < 0) normLng += 360

  const x = ((normLng - BOUNDS.lngMin) / (BOUNDS.lngMax - BOUNDS.lngMin)) * SVG_W
  const y = ((BOUNDS.latMax - lat) / (BOUNDS.latMax - BOUNDS.latMin)) * SVG_H

  return [
    Math.max(0, Math.min(SVG_W, x)),
    Math.max(0, Math.min(SVG_H, y)),
  ]
}

export const PORT_COORDS_BY_LOCODE: Record<string, { lat: number; lng: number; label: string }> = {
  'INMUN': { lat: 22.74,  lng: 69.73,   label: 'Mundra' },
  'INNSA': { lat: 18.95,  lng: 72.95,   label: 'JNPT / Nhava Sheva' },
  'INMAA': { lat: 13.08,  lng: 80.27,   label: 'Chennai' },
  'INVTZ': { lat: 17.69,  lng: 83.30,   label: 'Vizag' },
  'INCCU': { lat: 22.57,  lng: 88.36,   label: 'Kolkata' },
  'INPAV': { lat: 20.79,  lng: 71.00,   label: 'Pipavav' },
  'INKND': { lat: 23.00,  lng: 70.21,   label: 'Kandla' },

  'LKCMB': { lat: 6.94,   lng: 79.86,   label: 'Colombo' },
  'SGSIN': { lat: 1.26,   lng: 103.82,  label: 'Singapore' },
  'MYPKG': { lat: 3.00,   lng: 101.40,  label: 'Port Klang' },
  'AEJEA': { lat: 25.01,  lng: 55.06,   label: 'Jebel Ali' },
  'EGPSD': { lat: 29.87,  lng: 32.55,   label: 'Suez' },

  'USNYC': { lat: 40.66,  lng: -74.04,  label: 'New York / Newark' },
  'USEWR': { lat: 40.68,  lng: -74.14,  label: 'Newark' },
  'USSAV': { lat: 32.08,  lng: -81.10,  label: 'Savannah' },
  'USBLT': { lat: 39.27,  lng: -76.61,  label: 'Baltimore' },
  'USHOU': { lat: 29.76,  lng: -95.37,  label: 'Houston' },
  'USLGB': { lat: 33.75,  lng: -118.22, label: 'Long Beach' },
  'USLAX': { lat: 33.74,  lng: -118.26, label: 'Los Angeles' },
  'USOAK': { lat: 37.80,  lng: -122.28, label: 'Oakland' },
  'USSEA': { lat: 47.60,  lng: -122.33, label: 'Seattle' },

  'USCHI': { lat: 41.88,  lng: -87.63,  label: 'Chicago' },
  'USDAL': { lat: 32.78,  lng: -96.80,  label: 'Dallas' },
}

export function resolvePortCoords(
  locode: string | null,
  name: string | null
): { lat: number; lng: number } | null {
  if (locode && PORT_COORDS_BY_LOCODE[locode]) {
    const c = PORT_COORDS_BY_LOCODE[locode]
    return { lat: c.lat, lng: c.lng }
  }
  if (name) {
    const key = Object.keys(PORT_COORDS_BY_LOCODE).find(k =>
      PORT_COORDS_BY_LOCODE[k].label.toLowerCase().includes(name.toLowerCase())
    )
    if (key) return { lat: PORT_COORDS_BY_LOCODE[key].lat, lng: PORT_COORDS_BY_LOCODE[key].lng }
  }
  return null
}
