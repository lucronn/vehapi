"""
Headless browser-based endpoint mapper for Motor M1.

Uses Playwright to click through the actual M1 interface for every make (year 2010),
captures all API requests/responses, and maps endpoints per content source
(MOTOR, GeneralMotors, Ford, etc.) so all content sources are documented.

Usage:
  1. pip install playwright && playwright install chromium
  2. python browser_mapper.py

Env:
  BROWSER_HEADED=1       Show browser (debugging).
  BROWSER_MAX_MAKES=N   Limit to first N makes; default 0 = all makes.

Outputs (in data/browser_mapped/):
  capture_<ts>.jsonl          Raw request/response log
  endpoints_<ts>.json         Endpoints + by_content_source index
  content_sources_<ts>.md      Per-source endpoint list for crawler reference
"""
import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Same auth URL as auth.py - credentials in URL for EBSCO
EBSCO_LOGIN_URL = os.environ.get(
    "EBSCO_LOGIN_URL",
    "https://search.ebscohost.com/login.aspx?authtype=uid&user=pl7321r&password=PL%3F7321R&profile=autorepso&groupid=remote",
)
MOTOR_BASE = "https://sites.motor.com/m1"
OUTPUT_DIR = Path(__file__).parent / "data" / "browser_mapped"


def is_api_url(url: str) -> bool:
    """True if URL looks like an M1 API call (sites.motor.com only)."""
    if "sites.motor.com" not in url:
        return False
    return "/api/" in url or "/source/" in url


async def run_browser_mapper(headed: bool = False, max_makes: int = 5):
    """
    Launch headless browser, authenticate, navigate M1 UI, capture API traffic.
    """
    captured = []
    seen_urls = set()

    def on_request(request):
        url = request.url
        if is_api_url(url):
            key = (request.method, url)
            if key not in seen_urls:
                seen_urls.add(key)
                captured.append({
                    "type": "request",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "method": request.method,
                    "url": url,
                    "headers": dict(request.headers),
                })

    async def on_response(response):
        url = response.url
        if not is_api_url(url):
            return
        entry = {
            "type": "response",
            "ts": datetime.now(timezone.utc).isoformat(),
            "url": url,
            "status": response.status,
            "request_url": response.request.url,
        }
        # Optionally capture response body for API calls (for data mapping)
        try:
            ct = response.headers.get("content-type", "")
            if "json" in ct and response.status == 200:
                body = await response.json()
                if body is not None and len(json.dumps(body)) < 500_000:  # skip huge payloads
                    entry["body"] = body
        except Exception:
            pass
        captured.append(entry)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not headed)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720},
        )
        page = await context.new_page()

        page.on("request", on_request)
        page.on("response", on_response)

        logger.info("Navigating to EBSCO login (will redirect to Motor)...")
        await page.goto(EBSCO_LOGIN_URL, wait_until="networkidle", timeout=60000)

        final_url = page.url
        if "motor.com" not in final_url:
            logger.warning("Did not reach motor.com. Auth may have failed. Final URL: %s", final_url)
        else:
            logger.info("✓ Authenticated, reached: %s", final_url)

        # Go to vehicles / main app
        logger.info("Navigating to M1 vehicles...")
        await page.goto(f"{MOTOR_BASE}/vehicles", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)

        year_cb = page.get_by_role("combobox", name="Select Vehicle Year")
        make_cb = page.get_by_role("combobox", name="Select Vehicle Make")
        model_cb = page.get_by_role("combobox", name="Select Vehicle Model")
        target_year = "2010"

        async def select_combobox(locator, value: str):
            try:
                await locator.select_option(label=value)
                return True
            except Exception:
                pass
            try:
                await locator.click()
                await page.wait_for_timeout(500)
                await page.get_by_role("option", name=value).click()
                return True
            except Exception:
                return False

        # Select year once and get list of all makes
        logger.info("Selecting year: %s", target_year)
        await select_combobox(year_cb, target_year)
        await page.wait_for_timeout(2500)

        make_opts = make_cb.locator("option")
        n_make_opts = await make_opts.count()
        makes = []
        for i in range(n_make_opts):
            label = (await make_opts.nth(i).text_content() or "").strip()
            if label and "select" not in label.lower():
                makes.append(label)
        logger.info("Found %d makes for year %s", len(makes), target_year)

        if max_makes > 0:
            makes = makes[: max_makes]
            logger.info("Limiting to first %d makes", len(makes))

        for make_index, make_name in enumerate(makes):
            logger.info("--- Make %d/%d: %s ---", make_index + 1, len(makes), make_name)

            # If not first make, go back to vehicles and re-select year
            if make_index > 0:
                await page.goto(f"{MOTOR_BASE}/vehicles", wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(1500)
                await select_combobox(year_cb, target_year)
                await page.wait_for_timeout(2000)

            # Select this make
            async with page.expect_response(lambda r: "/models" in r.url and r.status == 200) as models_resp:
                await select_combobox(make_cb, make_name)
            try:
                await models_resp.value
            except Exception:
                pass
            await page.wait_for_timeout(2000)

            # Select first model (keyboard)
            try:
                await model_cb.wait_for(state="visible", timeout=8000)
                await model_cb.click(timeout=10000)
                await page.wait_for_timeout(800)
                await page.keyboard.press("ArrowDown")
                await page.wait_for_timeout(200)
                await page.keyboard.press("Enter")
                logger.info("Selected first model for %s", make_name)
                await page.wait_for_timeout(4000)
            except Exception as e:
                logger.warning("Model selection for %s: %s", make_name, e)
                continue

            # Wait for vehicle dashboard
            try:
                await page.wait_for_selector("a:has-text('All'), a:has-text('Procedures')", timeout=15000)
            except Exception:
                pass
            await page.wait_for_timeout(2000)

            # Skip if we didn't land on docs (e.g. no models)
            if "docs/" not in page.url and "/vehicle" not in page.url:
                logger.warning("Did not reach docs for %s; skipping click-through", make_name)
                continue

            # Click through ALL data category tabs
            category_tabs = [
                "All",
                "Procedures",
                "Diagrams",
                "Service Bulletins",
                "Diagnostic Codes",
                "Maint. Schedules",
                "Specs",
                "Other",
            ]
            for category in category_tabs:
                try:
                    link = page.get_by_role("link", name=re.compile(re.escape(category)))
                    await link.first.scroll_into_view_if_needed()
                    await link.first.click(timeout=5000)
                    logger.info("  [%s] %s", make_name, category)
                    await page.wait_for_timeout(2000)
                    for h in await page.get_by_role("heading").all():
                        try:
                            if await h.is_visible():
                                await h.scroll_into_view_if_needed()
                                await h.click(timeout=1500)
                                await page.wait_for_timeout(600)
                        except Exception:
                            pass
                    for btn in await page.get_by_role("button", name=re.compile(r"Show all \d+")).all():
                        try:
                            if await btn.is_visible():
                                await btn.scroll_into_view_if_needed()
                                await btn.click(timeout=1500)
                                await page.wait_for_timeout(1200)
                        except Exception:
                            pass
                except Exception as e:
                    logger.debug("Category %s: %s", category, e)

            # Maint. Schedules: enter interval
            try:
                await page.get_by_role("link", name=re.compile("Maint. Schedules")).first.click()
                await page.wait_for_timeout(3000)
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(500)
                interval_input = page.get_by_role("spinbutton", name=re.compile("Interval"))
                await interval_input.wait_for(state="visible", timeout=5000)
                await interval_input.fill("5000")
                await page.wait_for_timeout(2500)
            except Exception:
                pass

            # Back to All: expand sections and Show all
            try:
                await page.get_by_role("link", name=re.compile("All")).first.click()
                await page.wait_for_timeout(2500)
                for _ in range(2):
                    for h in await page.get_by_role("heading", level=6).all():
                        try:
                            if await h.is_visible():
                                await h.scroll_into_view_if_needed()
                                await h.click(timeout=2000)
                                await page.wait_for_timeout(800)
                        except Exception:
                            pass
                    for btn in await page.get_by_role("button", name=re.compile(r"Show all \d+")).all():
                        try:
                            if await btn.is_visible():
                                await btn.scroll_into_view_if_needed()
                                await btn.click(timeout=2000)
                                await page.wait_for_timeout(1500)
                        except Exception:
                            pass
            except Exception:
                pass

            await page.wait_for_timeout(1500)

        await context.close()
        await browser.close()

    return captured


def _content_source_from_path(path: str) -> str | None:
    """Extract content source from path like /api/source/MOTOR/... or /api/source/GeneralMotors/..."""
    m = re.search(r"/source/([^/]+)/", path)
    return m.group(1) if m else None


def extract_endpoints_from_captured(captured: list) -> tuple[dict, dict]:
    """
    Build endpoint map and content-source index from captured requests.
    Returns (endpoints, by_content_source).
    """
    endpoints = {}
    by_content_source = {}
    for entry in captured:
        if entry.get("type") != "request":
            continue
        url = entry.get("url", "")
        if "sites.motor.com" not in url:
            continue
        parsed = urlparse(url)
        path = parsed.path
        if "/m1" in path:
            path = path.split("/m1", 1)[-1] or "/"
        if path.startswith("/api") or "/source/" in path:
            params = parse_qs(parsed.query) if parsed.query else {}
            source = _content_source_from_path(path)
            key = f"{entry.get('method', 'GET')} {path}"
            if key not in endpoints:
                ep = {
                    "method": entry.get("method"),
                    "path": path,
                    "params": list(params.keys()),
                    "sample_url": url,
                }
                if source:
                    ep["content_source"] = source
                endpoints[key] = ep
                if source:
                    by_content_source.setdefault(source, []).append(key)
    return endpoints, by_content_source


async def main():
    headed = os.environ.get("BROWSER_HEADED", "").lower() in ("1", "true", "yes")
    # 0 = all makes (document all content sources); set BROWSER_MAX_MAKES to limit
    max_makes = int(os.environ.get("BROWSER_MAX_MAKES", "0"))

    logger.info("Starting browser mapper (headed=%s, max_makes=%s)...", headed, max_makes or "all")
    captured = await run_browser_mapper(headed=headed, max_makes=max_makes)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # Save raw capture
    raw_path = OUTPUT_DIR / f"capture_{ts}.jsonl"
    with open(raw_path, "w", encoding="utf-8") as f:
        for entry in captured:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    logger.info("Saved %d entries to %s", len(captured), raw_path)

    # Save extracted endpoints and content-source index
    endpoints, by_content_source = extract_endpoints_from_captured(captured)
    ep_path = OUTPUT_DIR / f"endpoints_{ts}.json"
    with open(ep_path, "w", encoding="utf-8") as f:
        json.dump({
            "endpoints": endpoints,
            "by_content_source": by_content_source,
            "source": "browser_mapper",
            "capture_file": str(raw_path),
        }, f, indent=2)
    logger.info("Saved %d endpoints to %s", len(endpoints), ep_path)

    # Save content-source consumption doc for crawler reference
    doc_path = OUTPUT_DIR / f"content_sources_{ts}.md"
    with open(doc_path, "w", encoding="utf-8") as f:
        f.write("# M1 Content Sources (from browser capture)\n\n")
        f.write("Endpoints observed per content source. Use for crawler path/param patterns.\n\n")
        for source in sorted(by_content_source.keys()):
            f.write(f"## {source}\n\n")
            for key in sorted(by_content_source[source]):
                ep = endpoints.get(key, {})
                f.write(f"- `{ep.get('method', 'GET')} {ep.get('path', '')}`")
                if ep.get("params"):
                    f.write(f"  params={ep['params']}")
                f.write("\n")
            f.write("\n")
    logger.info("Saved content-source doc to %s", doc_path)

    # Print summary
    print("\n--- Content sources ---")
    for source in sorted(by_content_source.keys()):
        print(f"  {source}: {len(by_content_source[source])} endpoint(s)")
    print("\n--- Captured API endpoints (sample) ---")
    for k, v in sorted(endpoints.items())[:40]:
        src = v.get("content_source", "")
        extra = f"  [{src}]" if src else ""
        print(f"  {v['method']} {v['path']}  params={v['params']}{extra}")
    if len(endpoints) > 40:
        print(f"  ... and {len(endpoints) - 40} more (see {ep_path})")


if __name__ == "__main__":
    asyncio.run(main())
