"""Supabase REST helpers for vehicle normalization row counts (service role)."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import httpx


def _read_headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Accept": "application/json",
    }


def _count_headers(service_key: str) -> dict[str, str]:
    return {**_read_headers(service_key), "Prefer": "count=exact"}


async def count_rows(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    table: str,
    vehicle_col: str,
    vehicle_id: str,
) -> int:
    """Return exact row count for vehicle_id (PostgREST Content-Range with count=exact)."""
    base = supabase_url.rstrip("/")
    enc_vid = quote(vehicle_id, safe="")
    url = f"{base}/rest/v1/{table}?{vehicle_col}=eq.{enc_vid}&select=id"
    h = {**_count_headers(service_key), "Range": "0-0"}
    r = await client.get(url, headers=h)
    if r.status_code >= 400:
        return -1
    cr = r.headers.get("content-range") or ""
    # e.g. 0-0/357
    if "/" in cr:
        part = cr.split("/")[-1].strip()
        if part.isdigit():
            return int(part)
    return -1


async def fetch_vehicle_normalized(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    vehicle_id: str,
) -> bool | None:
    enc = quote(vehicle_id, safe="")
    url = f"{supabase_url.rstrip('/')}/rest/v1/vehicles?external_id=eq.{enc}&select=is_normalized"
    r = await client.get(url, headers=_read_headers(service_key))
    if r.status_code != 200:
        return None
    rows = r.json()
    if not rows:
        return None
    return bool(rows[0].get("is_normalized"))


async def fetch_all_stats(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    vehicle_id: str,
) -> dict[str, Any]:
    """Aggregate counts used in the TUI dashboard."""
    tables_vehicle_id = [
        "articles",
        "procedures",
        "tsbs",
        "dtcs",
        "specifications",
        "maintenance_schedules",
        "maintenance_task",
        "parts",
    ]
    out: dict[str, Any] = {}
    for t in tables_vehicle_id:
        out[t] = await count_rows(client, supabase_url, service_key, t, "vehicle_id", vehicle_id)

    out["content_item"] = await count_rows(
        client, supabase_url, service_key, "content_item", "vehicle_external_id", vehicle_id
    )
    out["is_normalized"] = await fetch_vehicle_normalized(
        client, supabase_url, service_key, vehicle_id
    )
    return out


async def proxy_health(proxy_base: str) -> tuple[int, str]:
    """GET /health on vehapiproxi."""
    base = proxy_base.rstrip("/")
    url = f"{base}/health"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
            body = (r.text or "")[:500]
            return r.status_code, body
    except Exception as e:
        return -1, str(e)


def load_env(repo_root: str) -> None:
    """Load vehapiproxi/.env then repo .env (same as Node scripts)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(os.path.join(repo_root, "vehapiproxi", ".env"))
    load_dotenv(os.path.join(repo_root, ".env"))


def env_config(repo_root: str) -> dict[str, str]:
    load_env(repo_root)
    return {
        "supabase_url": (os.environ.get("SUPABASE_URL") or "").rstrip("/"),
        "service_key": os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "",
        "proxy_url": (
            os.environ.get("NORM_PROXY_URL")
            or os.environ.get("SYNC_BASE_URL")
            or "http://localhost:3001"
        ).rstrip("/"),
        "content_source": os.environ.get("CONTENT_SOURCE") or os.environ.get("SYNC_CONTENT_SOURCE") or "MOTOR",
        "vehicle_id": os.environ.get("VEHICLE_ID") or os.environ.get("SYNC_VEHICLE_ID") or "",
    }
