"""
Extract API endpoint patterns from the M1 Blazor app.
Uses authenticated session to fetch blazor.boot.json and dotnet.*.js,
then searches for API path patterns.
"""
import asyncio
import json
import logging
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

from auth import get_authenticated_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

BASE_URL = "https://sites.motor.com/m1"
OUTPUT_FILE = "m1_endpoints.json"

# Headers that mimic browser/app requests (M1 may require these)
REQUEST_HEADERS = {
    "Accept": "application/json, */*; q=0.01",
    "Referer": "https://sites.motor.com/m1/",
    "X-Requested-With": "XMLHttpRequest",
}

# Known endpoints from client.py (used as base when static files aren't accessible)
KNOWN_ENDPOINTS = [
    "/api/years",
    "/api/year/{year}/makes",
    "/api/year/{year}/make/{make}/models",
    "/api/source/{source}/vehicle/{vehicle_id}/articles/v2",
    "/api/source/{source}/vehicle/{vehicle_id}/fluids",
    "/api/source/{source}/vehicle/{vehicle_id}/parts",
    "/api/source/{source}/vehicle/{vehicle_id}/maintenanceSchedules/frequency",
    "/api/source/{source}/vehicle/{vehicle_id}/maintenanceSchedules/intervals",
]

# Patterns to search for in JS: API paths, source/, vehicle/, etc.
ENDPOINT_PATTERNS = [
    r'["\']/(api/[^"\'?\s]+)["\']',
    r'["\']/(source/[^"\'?\s]+)["\']',
    r'["\']/(vehicle/[^"\'?\s]+)["\']',
    r'`/(api/[^`]+)`',
    r'`/(source/[^`]+)`',
    r'`/(vehicle/[^`]+)`',
    r'["\']([^"\']*/(?:api|source|vehicle)/[^"\'?\s]*)["\']',
    r'url\s*[=:]\s*["\']([^"\']+)["\']',
    r'fetch\s*\(\s*["\']([^"\']+)["\']',
    r'["\'](/[a-zA-Z0-9_/-]+(?:api|source|vehicle)[a-zA-Z0-9_/-]*)["\']',
    r'["\'](/m1/api/[^"\']+)["\']',
    r'["\'](/m1/source/[^"\']+)["\']',
    r'["\'](/m1/vehicle/[^"\']+)["\']',
]


def extract_assembly_names(boot_json: dict) -> list[str]:
    """Parse blazor.boot.json for assembly names."""
    assemblies = []
    resources = boot_json.get("resources", {}) or {}
    assembly_res = resources.get("assembly", {}) or {}
    assemblies.extend(assembly_res.keys())
    top_assemblies = boot_json.get("assemblies", {}) or {}
    if isinstance(top_assemblies, dict):
        assemblies.extend(top_assemblies.keys())
    elif isinstance(top_assemblies, list):
        assemblies.extend(str(a) for a in top_assemblies)
    for key in ("mainAssemblyName", "entryAssemblyName"):
        if boot_json.get(key):
            assemblies.append(boot_json[key])
    return list(dict.fromkeys(assemblies))


def find_endpoint_patterns(text: str) -> set[str]:
    """Search text for API endpoint-like patterns."""
    found = set()
    for pattern in ENDPOINT_PATTERNS:
        for m in re.finditer(pattern, text):
            path = m.group(1) if m.lastindex else m.group(0)
            path = path.strip().rstrip("/")
            if path and any(x in path for x in ("/api", "source", "vehicle")):
                # Normalize: remove /m1 prefix if present (we use /api/... convention)
                if path.startswith("/m1/"):
                    path = path[4:]  # keep leading /
                found.add(path)
    for m in re.finditer(r'["\']([^"\']*(?:/api/|/source/|/vehicle/)[^"\']*)["\']', text):
        p = m.group(1).strip().rstrip("/")
        if p.startswith("/m1/"):
            p = p[4:]
        found.add(p)
    return found


def parse_script_urls(html: str, base: str) -> list[str]:
    """Extract script src URLs from HTML."""
    urls = []
    # src="..." or src='...'
    for m in re.finditer(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I):
        urls.append(m.group(1))
    # Also blazor.boot.json in autostart or link
    for m in re.finditer(r'["\']([^"\']*blazor\.boot[^"\']*\.json)["\']', html):
        urls.append(m.group(1))
    # Resolve relative URLs
    resolved = []
    for u in urls:
        if u.startswith("http"):
            resolved.append(u)
        elif u.startswith("//"):
            resolved.append("https:" + u)
        elif u.startswith("/"):
            resolved.append("https://sites.motor.com" + u)
        else:
            resolved.append(urljoin(base, u))
    return resolved


async def main():
    client = await get_authenticated_client()
    assemblies = []
    boot_json = None
    all_endpoints = set(KNOWN_ENDPOINTS)

    try:
        # 1. Fetch index page first
        logger.info("Fetching index: %s/", BASE_URL)
        index_resp = await client.get(f"{BASE_URL}/", headers=REQUEST_HEADERS)
        if index_resp.status_code != 200:
            logger.error("Index fetch failed: %s", index_resp.status_code)
            return None

        html = index_resp.text
        # If we got a login page, auth may have failed
        if "MOTOR Login" in html or "login" in html.lower()[:500]:
            logger.warning("Got login page - auth may have expired. Using known endpoints only.")

        # 2. Parse script URLs and try to fetch blazor.boot.json
        script_urls = parse_script_urls(html, f"{BASE_URL}/")
        logger.info("Found script/config URLs: %s", script_urls[:10])

        for url in script_urls:
            if "blazor.boot" in url and url.endswith(".json"):
                r = await client.get(url, headers=REQUEST_HEADERS)
                if r.status_code == 200:
                    try:
                        boot_json = r.json()
                        assemblies = extract_assembly_names(boot_json)
                        logger.info("Parsed blazor.boot.json, assemblies: %s", assemblies[:8])
                        break
                    except json.JSONDecodeError:
                        pass

        # 3. If no boot.json from scripts, try direct URL
        if not boot_json:
            boot_url = f"{BASE_URL}/_framework/blazor.boot.json"
            r = await client.get(boot_url, headers=REQUEST_HEADERS)
            if r.status_code == 200:
                try:
                    boot_json = r.json()
                    assemblies = extract_assembly_names(boot_json)
                    logger.info("Parsed blazor.boot.json (direct), assemblies: %s", assemblies[:8])
                except json.JSONDecodeError:
                    logger.info("blazor.boot.json returned non-JSON (likely SPA fallback)")

        # 4. Fetch all .js files (dotnet.*.js and app scripts)
        js_content = ""
        for url in script_urls:
            if ".js" in url and "blazor.boot" not in url:
                r = await client.get(url, headers=REQUEST_HEADERS)
                if r.status_code == 200 and "text/html" not in r.headers.get("content-type", ""):
                    js_content += r.text
                    logger.info("Fetched JS: %s (%d bytes)", url[:60], len(r.text))

        # 5. Try common dotnet.*.js paths if we didn't get them from scripts
        framework_base = f"{BASE_URL}/_framework"
        for name in ["dotnet.js", "dotnet.6.0.js", "dotnet.7.0.js", "dotnet.8.0.js"]:
            r = await client.get(f"{framework_base}/{name}", headers=REQUEST_HEADERS)
            if r.status_code == 200 and len(r.text) > 100 and "<!DOCTYPE" not in r.text[:50]:
                js_content += r.text
                logger.info("Fetched %s (%d bytes)", name, len(r.text))
                break

        # 6. Fetch app assemblies from boot.json if we have it
        if boot_json and assemblies:
            for asm_name in assemblies[:5]:
                asm_url = f"{framework_base}/{asm_name}.dll"
                r = await client.get(asm_url, headers=REQUEST_HEADERS)
                if r.status_code == 200 and len(r.content) < 2_000_000:
                    try:
                        strings = r.content.decode("utf-8", errors="ignore")
                        all_endpoints.update(find_endpoint_patterns(strings))
                    except Exception:
                        pass

        # 7. Search JS content for endpoint patterns
        all_endpoints.update(find_endpoint_patterns(js_content))

        # 8. Normalize and dedupe
        normalized = []
        seen = set()
        for ep in sorted(all_endpoints):
            ep_clean = ep.strip().rstrip("/")
            # Skip template literals (${...}) and malformed
            if "${" in ep_clean or not ep_clean or " " in ep_clean:
                continue
            # Normalize: ensure leading slash, treat api/... and /api/... as same
            ep_norm = ep_clean if ep_clean.startswith("/") else f"/{ep_clean}"
            if ep_norm not in seen:
                seen.add(ep_norm)
                normalized.append(ep_norm)

        result = {
            "assemblies": assemblies,
            "endpoints": normalized,
            "source": "main.js + polyfills + known client.py endpoints",
        }

        out_path = Path(__file__).parent / OUTPUT_FILE
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        logger.info("Saved %d endpoints to %s", len(normalized), out_path)
        return result
    finally:
        await client.aclose()


if __name__ == "__main__":
    result = asyncio.run(main())
    if result:
        print("\n--- Extracted endpoints ---")
        for ep in result.get("endpoints", [])[:60]:
            print(f"  {ep}")
        if len(result.get("endpoints", [])) > 60:
            print(f"  ... and {len(result['endpoints']) - 60} more (see {OUTPUT_FILE})")
