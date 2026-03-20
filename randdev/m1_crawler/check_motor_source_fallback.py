"""
Probe whether parts (and optionally maintenance) resolve under contentSource=MOTOR
when using the *same* vehicle_id as the catalog returned by /api/year/{y}/make/{m}/models.

Expected outcome for Ford / GeneralMotors / Nissan IDs: MOTOR path does not resolve
(M1 uses separate ID spaces per contentSource). Run against live M1 to confirm.

Usage (from repo root or randdev/m1_crawler):
  cd randdev/m1_crawler && python check_motor_source_fallback.py
  python randdev/m1_crawler/check_motor_source_fallback.py --year 2010
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from urllib.parse import quote, unquote

import httpx

from auth import USER_AGENT, get_authenticated_client
from client import M1Client, requires_motor_vehicle_id, resolve_vehicle_id

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Makes that had missing parts/maintenance in the 2010 sample crawl (first model only).
DEFAULT_MAKES_2010 = [
    "Buick",
    "Cadillac",
    "Chevrolet",
    "Ford",
    "GMC",
    "Hummer",
    "Lincoln",
    "Mercury",
    "Nissan",
    "Pontiac",
    "Saturn",
]


def _encode_vehicle_id(vehicle_id: str) -> str:
    raw = unquote(str(vehicle_id))
    return quote(raw, safe="")


async def probe_endpoint(
    client: httpx.AsyncClient,
    source: str,
    vehicle_id: str,
    motor_vehicle_id: str | None,
    suffix: str,
) -> tuple[int, int | None]:
    """
    GET /api/source/{source}/vehicle/{vid}/{suffix}
    Returns (status_code, json_body_length_or_None).
    """
    vid = _encode_vehicle_id(vehicle_id)
    url = f"https://sites.motor.com/m1/api/source/{source}/vehicle/{vid}/{suffix}"
    params: dict[str, str] = {}
    if motor_vehicle_id:
        params["motorVehicleId"] = motor_vehicle_id
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Referer": "https://sites.motor.com/m1/",
        "X-Requested-With": "XMLHttpRequest",
    }
    resp = await client.get(url, headers=headers, params=params or None)
    n = None
    if resp.status_code == 200:
        try:
            data = resp.json()
            n = len(json.dumps(data, ensure_ascii=False))
        except Exception:
            n = len(resp.content or b"")
    return resp.status_code, n


async def resolve_motor_vehicle_id(m1: M1Client, source: str, vehicle_id: str) -> str | None:
    if not requires_motor_vehicle_id(source):
        return None
    mv = await m1.get_motorvehicles(source, vehicle_id)
    if not mv or not isinstance(mv, dict):
        return None
    body = mv.get("body")
    items = None
    if isinstance(body, dict):
        items = body.get("items")
    elif isinstance(body, list):
        items = body
    if not items:
        items = mv.get("items")
    items = items or []
    if not items or not isinstance(items[0], dict):
        return None
    first = items[0]
    return first.get("vehicleId") or first.get("id")


async def run(year: int, makes: list[str], data_dir: str, with_control: bool) -> int:
    http = await get_authenticated_client()
    m1 = M1Client(http)
    try:
        print(
            f"{'Make':<12} {'Catalog':<14} {'Model (sample)':<28} {'native /parts':<18} {'MOTOR /parts':<18} {'note'}"
        )
        print("-" * 118)
        if with_control:
            ctrl_path = os.path.join(data_dir, str(year), "Toyota", "models_list.json")
            if os.path.isfile(ctrl_path):
                with open(ctrl_path, encoding="utf-8") as f:
                    cdata = json.load(f)
                csrc = cdata.get("contentSource")
                cmodels = cdata.get("models") or []
                if csrc and cmodels:
                    cm = cmodels[0]
                    cname = cm.get("model") or "?"
                    cvid = resolve_vehicle_id(cm, year, csrc)
                    if cvid:
                        st_n, ln = await probe_endpoint(http, csrc, cvid, None, "parts")
                        st_m, lm = await probe_endpoint(http, "MOTOR", cvid, None, "parts")
                        ns = f"{st_n}" + (f" (~{ln}b)" if ln else "")
                        ms = f"{st_m}" + (f" (~{lm}b)" if lm else "")
                        print(
                            f"{'Toyota':<12} {str(csrc):<14} {str(cname)[:28]:<28} "
                            f"{ns:<18} {ms:<18} "
                            f"control: valid MOTOR-style vehicle id"
                        )
                        print("-" * 118)
            await asyncio.sleep(0.4)
        for make in makes:
            ml_path = os.path.join(data_dir, str(year), make, "models_list.json")
            if not os.path.isfile(ml_path):
                print(f"{make:<12} {'(no file)':<14}")
                continue
            with open(ml_path, encoding="utf-8") as f:
                data = json.load(f)
            source = data.get("contentSource")
            models = data.get("models") or []
            if not source or not models:
                print(f"{make:<12} {'?':<14} {'':<28} {'skip':<14}")
                continue
            model = models[0]
            model_name = model.get("model") or model.get("modelName") or "?"
            vid = resolve_vehicle_id(model, year, source)
            if not vid:
                print(f"{make:<12} {str(source):<14} {str(model_name):<28} {'no vid':<14}")
                continue
            mvid = await resolve_motor_vehicle_id(m1, source, vid)

            st_native, len_native = await probe_endpoint(
                http, source, vid, mvid, "parts"
            )
            st_motor, len_motor = await probe_endpoint(
                http, "MOTOR", vid, None, "parts"
            )

            note = ""
            if source == "MOTOR":
                note = "already MOTOR catalog"
            elif st_native == st_motor and st_native >= 400:
                note = (
                    f"same status native vs MOTOR ({st_native}) - "
                    "not a crosswalk; OEM IDs do not map to MOTOR catalog via path alone"
                )
            elif st_motor == 200 and len_motor:
                note = "MOTOR returned body with foreign ID — inspect collision / unexpected"
            elif st_motor in (404, 400):
                note = "MOTOR rejected ID (expected for Ford/Nissan/GM path IDs)"
            elif st_motor >= 500:
                note = f"MOTOR HTTP {st_motor}"
            else:
                note = f"MOTOR HTTP {st_motor}"

            nat_s = f"{st_native}" + (f" (~{len_native}b)" if len_native else "")
            mot_s = f"{st_motor}" + (f" (~{len_motor}b)" if len_motor else "")

            print(
                f"{make:<12} {str(source):<14} {str(model_name)[:28]:<28} {nat_s:<18} {mot_s:<18} {note}"
            )
            await asyncio.sleep(0.4)
        return 0
    finally:
        await http.aclose()


def main() -> None:
    p = argparse.ArgumentParser(description="Compare native contentSource vs MOTOR for /parts")
    p.add_argument("--year", type=int, default=2010)
    p.add_argument(
        "--makes",
        type=str,
        default=",".join(DEFAULT_MAKES_2010),
        help="Comma-separated make names (must match models_list.json folder names)",
    )
    p.add_argument(
        "--data-dir",
        type=str,
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"),
        help="Crawler data root (contains {year}/{Make}/models_list.json)",
    )
    p.add_argument(
        "--with-control",
        action="store_true",
        help="First print a Toyota (MOTOR catalog) row to verify MOTOR /parts works for valid IDs",
    )
    args = p.parse_args()
    makes = [m.strip() for m in args.makes.split(",") if m.strip()]
    if not os.path.isdir(os.path.join(args.data_dir, str(args.year))):
        logger.error("No data for year %s under %s", args.year, args.data_dir)
        sys.exit(1)
    asyncio.run(run(args.year, makes, args.data_dir, args.with_control))


if __name__ == "__main__":
    main()
