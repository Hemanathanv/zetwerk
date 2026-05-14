import os
import sys
import json
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("TERMINAL_49_API_KEY")
BASE_URL = "https://api.terminal49.com/v2"

HEADERS = {
    "Authorization": f"Token {API_KEY}",
    "Content-Type": "application/vnd.api+json",
}

PREFIX_TO_SCAC = {
    "MSK": "MAEU",
    "MSC": "MSCU",
    "CMA": "CMDU",
    "HLC": "HLCU",
    "ONE": "ONEY",
    "EVR": "EVRG",
    "EMC": "EMCU",
    "YML": "YMLU",
    "HMM": "HDMU",
    "ZIM": "ZIMU",
    "PIL": "PILU",
    "WHL": "WHLC",
    "ANL": "ANNU",
    "APL": "APLU",
    "HAP": "HPAS",
    "NYK": "NYKS",
    "MOL": "MOLU",
    "KLC": "KKLU",
    "SAF": "SAFM",
    "COL": "COSU",
}

def guess_request_type(number: str) -> str:
    n = number.upper().strip()
    if len(n) == 11 and n[:4].isalpha() and n[4:].isdigit():
        return "container"
    if n.isdigit():
        return "booking_number"
    return "bill_of_lading"

def resolve_scac(number: str) -> str | None:
    prefix = number[:3].upper()
    return PREFIX_TO_SCAC.get(prefix)

def create_tracking_request(number: str, scac: str | None, request_type: str) -> dict:
    attributes = {
        "request_type": request_type,
        "request_number": number,
    }

    # Only include SCAC if valid
    if scac:
        attributes["scac"] = scac

    payload = {
        "data": {
            "type": "tracking_request",
            "attributes": attributes,
        }
    }

    r = requests.post(f"{BASE_URL}/tracking_requests", json=payload, headers=HEADERS)

    if r.status_code == 422:
        errors = r.json().get("errors", [])
        for err in errors:
            if err.get("code") == "duplicate":
                existing_id = err.get("meta", {}).get("tracking_request_id")
                return {
                    "tracking_request_id": existing_id,
                    "status": "already_exists"
                }
        scac_errors = [e for e in errors if e.get("source", {}).get("pointer") == "/data/attributes/scac"]
        if scac_errors:
            details = "; ".join(e.get("detail", "") for e in scac_errors)
            raise ValueError(
                f"Terminal49 rejected the SCAC (carrier code): {details}. "
                f"Pass the correct SCAC with --scac <CODE> (e.g. MAEU, MSCU, CMDU, HLCU, ONEY)."
            )

    r.raise_for_status()

    data = r.json()["data"]
    return {
        "tracking_request_id": data["id"],
        "status": data["attributes"]["status"]
    }

def prompt_scac(number: str) -> str:
    print(f"Could not auto-detect SCAC from prefix '{number[:3]}'.", file=sys.stderr)
    scac = input("Enter carrier SCAC code (e.g. MAEU, MSCU, CMDU, HLCU, ONEY): ").strip()
    if not scac:
        raise ValueError("SCAC is required but was not provided.")
    return scac

def track(number: str, scac_override: str | None = None) -> dict:
    request_type = guess_request_type(number)
    scac = scac_override or resolve_scac(number)

    print(f"Detected type: {request_type}", file=sys.stderr)
    print(f"Detected SCAC: {scac}", file=sys.stderr)

    if not scac:
        scac = prompt_scac(number)

    try:
        result = create_tracking_request(number, scac, request_type)
    except ValueError as e:
        if "rejected the SCAC" in str(e):
            print(f"SCAC '{scac}' was rejected. Try again.", file=sys.stderr)
            scac = prompt_scac(number)
            result = create_tracking_request(number, scac, request_type)
        else:
            raise

    return {
        "input_number": number,
        "request_type": request_type,
        "scac_used": scac,
        "tracking_request": result,
        "note": "Free API only creates tracking request. No live tracking data available."
    }

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Track a shipment via Terminal49")
    parser.add_argument("number", nargs="?", help="Container / BOL / booking number")
    parser.add_argument("--scac", help="Carrier SCAC code (required for bill_of_lading if not auto-detected)")
    args = parser.parse_args()

    number = args.number or input("Enter container / BOL / booking number: ").strip()

    try:
        result = track(number, scac_override=args.scac)
        print(json.dumps(result, indent=2))
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.HTTPError as e:
        print(f"API error {e.response.status_code}: {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)