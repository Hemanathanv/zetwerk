"""SafeCube/Sinay tracking client for containers, bill of lading numbers, and booking IDs.

Usage:
    python safecube.py MSKU0496560
    python safecube.py BOL1234567
    python safecube.py EBKG14546986
    python safecube.py MSKU0496560 --sealine MAEU --output tracking.json
    python safecube.py MSKU0496560 --map-output tracking_map.html
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR.parent
SAFECUBE_SHIPMENT_URL = "https://api.sinay.ai/container-tracking/api/v2/shipment"
CONTAINER_NUMBER_PREFIXES = (
    "MSKU",
    "MAEU",
    "CMAU",
    "TGHU",
    "TRLU",
    "TEMU",
    "HLCU",
    "SEKU",
    "OOLU",
    "GESU",
    "FSCU",
    "GLDU",
    "MEDU",
    "ONEY",
    "APZU",
    "MRKU",
    "BMOU",
    "DRYU",
    "CXRU",
    "TXGU",
    "TQEB",
    "TRHU",
)

CONTAINER_NUMBER_PATTERN = re.compile(r"^[A-Z]{4}\d{7}$")


class SafeCubeError(RuntimeError):
    """Raised when SafeCube cannot return a successful shipment response."""


def load_safecube_api_key() -> str:
    """Load SAFECUBE_API_KEY from Backend/.env or the current environment."""
    load_dotenv(BACKEND_DIR / ".env", override=False)
    load_dotenv(override=False)

    api_key = os.getenv("SAFECUBE_API_KEY")
    if not api_key:
        raise SafeCubeError("SAFECUBE_API_KEY is missing. Add it to Backend/.env.")
    return api_key


def _normalize_reference(reference: str) -> str:
    """Uppercase and strip punctuation so B/L, BL, and BOL compare consistently."""
    return re.sub(r"[^A-Z0-9]+", "", reference.upper())


def looks_like_container_reference(reference: str) -> bool:
    """Return True for common container numbers like MSKU0496560."""
    compact = _normalize_reference(reference)
    return bool(len(compact) == 11 and CONTAINER_NUMBER_PATTERN.match(compact))


def looks_like_booking_reference(reference: str) -> bool:
    """Return True for booking IDs such as EBKG14546986 or explicit booking refs."""
    raw = reference.strip().upper()
    compact = _normalize_reference(reference)
    return bool(
        re.search(r"\bBOOKING\b", raw)
        or re.search(r"\bBKG\b", raw)
        or compact.startswith("BK")
        or compact.startswith("EBKG")
    )


def looks_like_bol_reference(reference: str) -> bool:
    """Return True for bill-of-lading references such as BL, BOL, MBL, or HBL numbers."""
    raw = reference.strip().upper()
    compact = _normalize_reference(reference)
    return bool(
        re.search(r"\bBILL\s*OF\s*LADING\b", raw)
        or re.search(r"\bB/?L\b", raw)
        or re.search(r"\bBOL\b", raw)
        or compact.startswith("BL")
        or compact.startswith("BOL")
        or compact.startswith("MBL")
        or compact.startswith("HBL")
    )


def infer_shipment_type(reference: str) -> str:
    """Infer SafeCube shipment type from a container, bill of lading, or booking reference."""
    if looks_like_container_reference(reference):
        return "CT"
    if looks_like_booking_reference(reference):
        return "BK"
    if looks_like_bol_reference(reference):
        return "BL"
    return "BL"


def get_container_tracking_details(
    tracking_reference: str,
    *,
    shipment_type: str | None = None,
    sealine: str | None = None,
    route: bool = True,
    ais: bool = True,
    timeout: int = 60,
) -> dict[str, Any]:
    """Fetch tracking details and location data for a container, BOL, or booking ID.

    SafeCube's endpoint accepts CT (container), BL (bill of lading), or BK
    (booking) references. This helper auto-detects CT vs BL vs BK unless overridden.
    """
    tracking_reference = tracking_reference.strip()
    if not tracking_reference:
        raise ValueError("tracking_reference cannot be empty.")

    shipment_type = (shipment_type or infer_shipment_type(tracking_reference)).upper()
    if shipment_type not in {"CT", "BL", "BK"}:
        raise ValueError("shipment_type must be one of: CT, BL, BK.")

    params: dict[str, Any] = {
        "shipmentNumber": tracking_reference,
        "shipmentType": shipment_type,
        "route": str(route).lower(),
        "ais": str(ais).lower(),
    }
    if sealine:
        params["sealine"] = sealine.strip().upper()

    url = f"{SAFECUBE_SHIPMENT_URL}?{parse.urlencode(params)}"
    safe_request = request.Request(
        url,
        headers={
            "API_KEY": load_safecube_api_key(),
            "Accept": "application/json",
            "User-Agent": "EWMS/1.0",
        },
        method="GET",
    )

    try:
        with request.urlopen(safe_request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8")
            return json.loads(response_text)
    except error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(response_text)
        except ValueError:
            payload = {"message": response_text}
        message = payload.get("message") if isinstance(payload, dict) else None
        raise SafeCubeError(
            f"SafeCube request failed ({exc.code}): {message or exc.reason}"
        ) from exc
    except error.URLError as exc:
        raise SafeCubeError(f"SafeCube request failed: {exc.reason}") from exc
    except ValueError as exc:
        raise SafeCubeError("SafeCube returned a non-JSON response.") from exc


def _latest_container_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    latest_event: dict[str, Any] | None = None

    for container in payload.get("containers") or []:
        for event in container.get("events") or []:
            if not event.get("isActual"):
                continue
            event_date = str(event.get("date", ""))
            latest_date = str(latest_event.get("date", "")) if latest_event else ""
            if latest_event is None or event_date > latest_date:
                latest_event = event

    return latest_event


def _as_point(value: Any) -> dict[str, float] | None:
    """Normalize a lat/lng-like object into {lat, lng}."""
    if not isinstance(value, dict):
        return None

    lat = value.get("lat")
    lng = value.get("lng")
    if lat is None or lng is None:
        return None

    try:
        return {"lat": float(lat), "lng": float(lng)}
    except (TypeError, ValueError):
        return None


def _collect_route_points(route_data: dict[str, Any]) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []

    for segment in route_data.get("routeSegments") or []:
        for point in segment.get("path") or []:
            normalized = _as_point(point)
            if normalized:
                points.append(normalized)

    return points


def _collect_marker_points(payload: dict[str, Any]) -> list[dict[str, Any]]:
    markers: list[dict[str, Any]] = []
    seen: set[tuple[float, float, str]] = set()

    def add_marker(label: str, value: Any, *, color: str, kind: str) -> None:
        point = _as_point(value)
        if not point:
            return
        key = (point["lat"], point["lng"], kind)
        if key in seen:
            return
        seen.add(key)
        markers.append({"label": label, "color": color, "kind": kind, **point})

    route = payload.get("route") or {}
    route_data = payload.get("routeData") or {}

    add_marker("Live vessel position", route_data.get("coordinates"), color="#e11d48", kind="live")

    for location in payload.get("locations") or []:
        add_marker(
            location.get("name") or "Location",
            location.get("coordinates"),
            color="#2563eb",
            kind="location",
        )

    for route_key, label, color in [
        ("prepol", "Pre-POL", "#64748b"),
        ("pol", "POL", "#16a34a"),
        ("pod", "POD", "#f59e0b"),
        ("postpod", "Destination", "#7c3aed"),
    ]:
        route_node = route.get(route_key) or {}
        location = route_node.get("location") or {}
        add_marker(
            label,
            location.get("coordinates"),
            color=color,
            kind=f"route-{route_key}",
        )

    for facility in payload.get("facilities") or []:
        add_marker(
            facility.get("name") or "Facility",
            facility.get("coordinates"),
            color="#0f766e",
            kind="facility",
        )

    return markers


def build_route_map_html(payload: dict[str, Any], *, title: str = "SafeCube Container Route") -> str:
    """Render a standalone HTML map with route lines and live location markers."""
    route_data = payload.get("routeData") or {}
    route_points = _collect_route_points(route_data)
    markers = _collect_marker_points(payload)
    live_point = route_data.get("coordinates")

    data = {
        "routePoints": route_points,
        "markers": markers,
        "livePoint": _as_point(live_point),
        "title": title,
        "metadata": payload.get("metadata") or {},
    }

    data_json = json.dumps(data, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body {{
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0f172a;
      color: #e2e8f0;
      font-family: Arial, sans-serif;
    }}
    #map {{
      width: 100%;
      height: 100vh;
    }}
    .legend {{
      position: absolute;
      top: 16px;
      left: 72px;
      z-index: 1000;
      background: rgba(15, 23, 42, 0.92);
      color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
      max-width: 320px;
    }}
    .legend h1 {{
      font-size: 16px;
      margin: 0 0 8px;
    }}
    .legend p {{
      margin: 4px 0;
      font-size: 13px;
      line-height: 1.35;
    }}
    .swatch {{
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 8px;
      vertical-align: middle;
    }}
  </style>
</head>
<body>
  <div class="legend">
    <h1>SafeCube container tracking</h1>
    <p><span class="swatch" style="background:#e11d48"></span>Live vessel position</p>
    <p><span class="swatch" style="background:#2563eb"></span>Known locations</p>
    <p><span class="swatch" style="background:#16a34a"></span>POL</p>
    <p><span class="swatch" style="background:#f59e0b"></span>POD</p>
  </div>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const data = {data_json};
    const map = L.map('map', {{ worldCopyJump: true }});
    map.zoomControl.setPosition('topright');
    L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }}).addTo(map);

    const bounds = [];

    function addPoint(point, options) {{
      if (!point || point.lat === undefined || point.lng === undefined) return;
      bounds.push([point.lat, point.lng]);
      return L.marker([point.lat, point.lng], options).addTo(map);
    }}

    if (Array.isArray(data.routePoints) && data.routePoints.length > 1) {{
      const routeLatLngs = data.routePoints.map((p) => [p.lat, p.lng]);
      routeLatLngs.forEach((pt) => bounds.push(pt));
      L.polyline(routeLatLngs, {{ color: '#60a5fa', weight: 4, opacity: 0.9 }}).addTo(map);
    }}

    if (data.livePoint) {{
      const liveIcon = L.divIcon({{
        className: 'live-point',
        html: '<div style="width:16px;height:16px;border-radius:50%;background:#e11d48;border:3px solid white;box-shadow:0 0 0 4px rgba(225,29,72,0.18)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }});
      addPoint(data.livePoint, {{ icon: liveIcon }})?.bindPopup('Live vessel position');
    }}

    if (Array.isArray(data.markers)) {{
      data.markers.forEach((marker) => {{
        const icon = L.divIcon({{
          className: 'marker-dot',
          html: `<div style="width:12px;height:12px;border-radius:50%;background:${{marker.color}};border:2px solid white;box-shadow:0 0 0 3px rgba(15,23,42,0.18)"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        }});
        const instance = addPoint(marker, {{ icon }});
        if (instance) {{
          const label = marker.label || marker.kind || 'Point';
          instance.bindPopup(label);
        }}
      }});
    }}

    if (bounds.length > 0) {{
      map.fitBounds(bounds, {{ padding: [40, 40] }});
    }} else {{
      map.setView([20, 0], 2);
    }}
  </script>
</body>
</html>"""


def write_route_map(payload: dict[str, Any], output_path: Path) -> Path:
    html = build_route_map_html(payload)
    output_path.write_text(html, encoding="utf-8")
    return output_path.resolve()


def summarize_tracking(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the most useful tracking fields while preserving the raw payload."""
    route_data = payload.get("routeData") or {}
    coordinates = route_data.get("coordinates")
    ais = route_data.get("ais")
    latest_event = _latest_container_event(payload)

    current_location = None
    if latest_event:
        current_location = {
            "source": "latest_actual_container_event",
            "date": latest_event.get("date"),
            "description": latest_event.get("description"),
            "eventCode": latest_event.get("eventCode"),
            "status": latest_event.get("status"),
            "location": latest_event.get("location"),
            "facility": latest_event.get("facility"),
        }
    elif coordinates:
        current_location = {
            "source": "route_coordinates",
            "coordinates": coordinates,
        }

    return {
        "metadata": payload.get("metadata"),
        "currentLocation": current_location,
        "liveCoordinates": coordinates,
        "ais": ais,
        "route": payload.get("route"),
        "locations": payload.get("locations"),
        "vessels": payload.get("vessels"),
        "containers": payload.get("containers"),
        "raw": payload,
    }


def track_container(
    tracking_reference: str,
    *,
    shipment_type: str | None = None,
    sealine: str | None = None,
    include_summary: bool = True,
) -> dict[str, Any]:
    """Fetch container tracking and return a summary+raw payload or raw payload."""
    payload = get_container_tracking_details(
        tracking_reference,
        shipment_type=shipment_type,
        sealine=sealine,
    )
    if include_summary:
        return summarize_tracking(payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Get SafeCube container details, events, route, and location."
    )
    parser.add_argument(
        "tracking_reference",
        nargs="?",
        help=(
            "Optional tracking reference, for example MSKU0496560, a bill of lading "
            "number, or a booking ID such as EBKG14546986."
        ),
    )
    parser.add_argument(
        "--shipment-type",
        choices=["CT", "BL", "BK"],
        help="Override the inferred SafeCube shipment type. Use CT for container, BL for B/L, BK for booking.",
    )
    parser.add_argument(
        "--sealine",
        help="Optional 4-letter SCAC code, for example MAEU. Recommended by SafeCube.",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print only the raw SafeCube response instead of summary + raw payload.",
    )
    parser.add_argument(
        "--map-output",
        help=(
            "Optional path to write an HTML map with the route and live location. "
            "Defaults to safecube_map.html if omitted."
        ),
    )
    parser.add_argument(
        "--refresh-seconds",
        type=int,
        default=0,
        help="If set, keep re-hitting SafeCube every N seconds for fresh current location data.",
    )
    parser.add_argument("--output", help="Optional path to save the JSON response.")
    args = parser.parse_args()

    tracking_reference = args.tracking_reference
    if not tracking_reference:
        try:
            tracking_reference = input("Enter the container number, BOL, or booking ID: ").strip()
        except EOFError as exc:
            raise SystemExit(
                "tracking_reference is required. Run the script again and enter it when prompted, "
                "or pass it as an argument like: python safecube.py MSKU0496560"
            ) from exc

    if not tracking_reference:
        raise SystemExit(
            "tracking_reference is required. Run the script again and enter it when prompted, "
            "or pass it as an argument like: python safecube.py MSKU0496560"
        )

    shipment_type = args.shipment_type or infer_shipment_type(tracking_reference)
    map_output = args.map_output or "safecube_map.html"

    while True:
        raw_payload = get_container_tracking_details(
            tracking_reference,
            shipment_type=shipment_type,
            sealine=args.sealine,
        )
        result = summarize_tracking(raw_payload) if not args.raw else raw_payload
        map_path = write_route_map(raw_payload, Path(map_output))
        print(f"Map saved to: {map_path}")
        if isinstance(result, dict):
            result["mapPath"] = str(map_path)

        formatted = json.dumps(result, indent=2, ensure_ascii=False)
        if args.output:
            output_path = Path(args.output)
            output_path.write_text(formatted + "\n", encoding="utf-8")
            print(f"Saved tracking details to {output_path}")
        else:
            print(formatted)

        if args.refresh_seconds <= 0:
            break

        print(f"Refreshing in {args.refresh_seconds} seconds...")
        time.sleep(args.refresh_seconds)


if __name__ == "__main__":
    main()
