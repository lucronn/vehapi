import asyncio
import json
import logging
import os
import random
from datetime import datetime

from auth import get_authenticated_client
from client import M1Client, resolve_vehicle_id, requires_motor_vehicle_id
from error_log import ERROR_LOG_FILE, log_error
from tqdm.asyncio import tqdm

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATA_DIR = "data"


def _setup_error_log():
    """Add file handler to append errors to crawler_errors.log."""
    fh = logging.FileHandler(ERROR_LOG_FILE, mode="a", encoding="utf-8")
    fh.setLevel(logging.WARNING)
    fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s"))
    logging.getLogger().addHandler(fh)


_setup_error_log()


def _resolve_content_source(models_data: dict, make_name: str) -> str | None:
    """
    Resolve contentSource from the models API response. Source must come from the API.
    Checks: top-level, nested body, then first model. Never defaults to MOTOR or make_name.
    """
    if not models_data or not isinstance(models_data, dict):
        return None
    # Top-level (normal response)
    source = models_data.get("contentSource")
    if source:
        return source
    # Nested body (some API variants)
    body = models_data.get("body")
    if isinstance(body, dict):
        source = body.get("contentSource")
        if source:
            return source
    # Per-model (ModelAndVehicleIdListResponse style)
    models_list = models_data.get("models") or (body.get("models") if isinstance(body, dict) else []) or []
    if models_list and isinstance(models_list[0], dict):
        source = models_list[0].get("contentSource")
        if source:
            return source
    log_error("missing_content_source", "No contentSource in models response; skipping", make=make_name)
    logger.warning(
        "No contentSource in models response for %s; skipping (API must provide it)",
        make_name,
    )
    return None


class M1Crawler:
    def __init__(self, client_wrapper: M1Client):
        self.client = client_wrapper
        # Stricter concurrency and delays to avoid rate limiting
        self.semaphore = asyncio.Semaphore(2)
        self.delay_between_requests = 1.5  # seconds
        self.output_dir = DATA_DIR
        self.max_labor_per_vehicle = 1  # 1 per vehicle for data mapping
        os.makedirs(self.output_dir, exist_ok=True)

    @staticmethod
    def _extract_silos_from_articles(articles_resp: dict) -> dict:
        """Extract procedures, wiring_diagrams, component_locations from articles_v2 body."""
        body = articles_resp.get("body") or {}
        details = body.get("articleDetails") or []
        result = {"procedures": [], "wiring_diagrams": [], "component_locations": []}
        for a in details:
            b = (a.get("bucket") or "").lower()
            p = (a.get("parentBucket") or "").lower()
            combined = f"{b} {p}"
            if "procedure" in combined or "labor" in combined:
                result["procedures"].append(a)
            elif "component location" in combined:
                result["component_locations"].append(a)
            elif "wiring" in combined or "diagram" in combined:
                result["wiring_diagrams"].append(a)
        return result

    def save_json(self, path_parts, filename, data):
        target_dir = os.path.join(self.output_dir, *path_parts)
        os.makedirs(target_dir, exist_ok=True)
        file_path = os.path.join(target_dir, filename)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)

    async def _safe_delay(self):
        # random jitter between 0.5 and 1.5x delay
        wait = self.delay_between_requests * (0.5 + random.random())
        await asyncio.sleep(wait)

    async def _resolve_motor_vehicle_id(self, source: str, vehicle_id: str) -> str | None:
        """For GM: fetch motorvehicles and return first motor vehicle ID for query param."""
        if not requires_motor_vehicle_id(source):
            return None
        mv = await self.client.get_motorvehicles(source, vehicle_id)
        if not mv or not isinstance(mv, dict):
            return None
        # API may return { body: { items } }, { body: [...] }, or { items } (ModelAndVehicleIdListResponse)
        body = mv.get("body")
        items = None
        if isinstance(body, dict):
            items = body.get("items")
        elif isinstance(body, list):
            items = body
        if not items:
            items = mv.get("items")
        items = items or []
        if not items:
            return None
        first = items[0]
        if not isinstance(first, dict):
            return None
        # vehicleId is the engine/trim ID (e.g. 79612:3016) required for GM parts/maintenance
        return first.get("vehicleId") or first.get("id")

    async def crawl_vehicle_data(self, year, make_name, model, source):
        async with self.semaphore:
            model_name = model.get("model") or model.get("modelName")
            # Resolve vehicle_id: engine ID for MOTOR, model.id for Ford/GM
            vehicle_id = resolve_vehicle_id(model, year, source)
            if not vehicle_id:
                logger.warning(f"Skipping {make_name} {model_name}: no vehicle ID")
                return

            # GM: use model ID in path + motorVehicleId in query (swagger §motorVehicleId)
            motor_vehicle_id = None
            if requires_motor_vehicle_id(source):
                await self._safe_delay()
                motor_vehicle_id = await self._resolve_motor_vehicle_id(source, vehicle_id)
                if motor_vehicle_id:
                    logger.debug(f"GM motorVehicleId: {motor_vehicle_id}")
                else:
                    log_error(
                        "gm_no_motor_vehicle_id",
                        "No motorVehicleId from motorvehicles; parts/maintenance may 500",
                        source=source,
                        vehicle_id=vehicle_id,
                    )
                    logger.warning(
                        "GM %s: no motorVehicleId from motorvehicles; parts/maintenance may 500",
                        vehicle_id,
                    )

            # Fetch various silos sequentially with delays to be polite
            logger.info(f"Crawling: {vehicle_id} (Source: {source})")

            # 1. Articles V2
            await self._safe_delay()
            articles = await self.client.get_articles_v2(
                source, vehicle_id, motor_vehicle_id
            )
            if articles:
                self.save_json(
                    [str(year), make_name, model_name], "articles_v2.json", articles
                )
                silos = self._extract_silos_from_articles(articles)
                if silos["procedures"]:
                    self.save_json(
                        [str(year), make_name, model_name],
                        "procedures.json",
                        silos["procedures"],
                    )
                if silos["wiring_diagrams"]:
                    self.save_json(
                        [str(year), make_name, model_name],
                        "wiring_diagrams.json",
                        silos["wiring_diagrams"],
                    )
                if silos["component_locations"]:
                    self.save_json(
                        [str(year), make_name, model_name],
                        "component_locations.json",
                        silos["component_locations"],
                    )
                labor_results = []
                # Labor endpoint only works for L: (Labor bucket) articles; P: (Procedure) IDs are different
                labor_articles = [a for a in silos["procedures"] if str(a.get("id") or "").upper().startswith("L:")]
                for proc in labor_articles[: self.max_labor_per_vehicle]:
                    aid = proc.get("id")
                    if not aid or aid in ("-999", "-998"):
                        continue
                    await self._safe_delay()
                    labor = await self.client.get_labor(
                        source, vehicle_id, aid, motor_vehicle_id
                    )
                    if labor:
                        labor_results.append(
                            {"articleId": aid, "title": proc.get("title"), "labor": labor}
                        )
                if labor_results:
                    self.save_json(
                        [str(year), make_name, model_name], "labor.json", labor_results
                    )

            # 2. Fluids
            await self._safe_delay()
            fluids = await self.client.get_fluids(
                source, vehicle_id, motor_vehicle_id
            )
            if fluids:
                self.save_json(
                    [str(year), make_name, model_name], "fluids.json", fluids
                )

            # 3. Parts
            await self._safe_delay()
            parts = await self.client.get_parts(
                source, vehicle_id, motor_vehicle_id
            )
            if parts:
                self.save_json(
                    [str(year), make_name, model_name], "parts.json", parts
                )

            # 4. Maintenance (Frequency & Intervals)
            await self._safe_delay()
            freq = await self.client.get_maintenance_frequency(
                source, vehicle_id, motor_vehicle_id
            )
            if freq:
                self.save_json(
                    [str(year), make_name, model_name],
                    "maintenance_frequency.json",
                    freq,
                )

            await self._safe_delay()
            # 1 interval for data mapping
            intervals = await self.client.get_maintenance_intervals(
                source, vehicle_id, interval=5000, motor_vehicle_id=motor_vehicle_id
            )
            if intervals:
                self.save_json(
                    [str(year), make_name, model_name],
                    "maintenance_intervals.json",
                    intervals,
                )

    async def run(self, max_years=None, max_makes_per_year=None):
        logger.info("Starting crawl...")
        years_list = await self.client.get_years()
        if not years_list:
            logger.error("No years found. Crawl aborted.")
            return

        # Sort years descending
        years = []
        for y in years_list:
            if isinstance(y, dict):
                years.append(y.get("year"))
            else:
                years.append(y)
        
        years = sorted([y for y in years if y], reverse=True)
        if max_years:
            years = years[:max_years]

        for year in years:
            logger.info(f"Processing year: {year}")
            makes = await self.client.get_makes(year)
            if not makes:
                continue

            if max_makes_per_year:
                makes = makes[:max_makes_per_year]

            for make in tqdm(makes, desc=f"Makes in {year}"):
                if isinstance(make, dict):
                    make_name = make.get("makeName")
                else:
                    make_name = make
                
                models_data = await self.client.get_models(year, make_name)
                
                if models_data:
                    source = _resolve_content_source(models_data, make_name)
                    models_list = models_data.get("models") or (models_data.get("body") or {}).get("models") or []
                    
                    if source and models_list:
                        # For format exploration, we only need a few samples per make
                        # Sampling the first model
                        sample_model = models_list[0]
                        await self.crawl_vehicle_data(year, make_name, sample_model, source)
                        
                        # Save basic metadata
                        self.save_json([str(year), make_name], "models_list.json", models_data)
            
            # Save makes list for the year
            self.save_json([str(year)], "makes_list.json", makes)

async def main():
    try:
        with open(ERROR_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n--- Crawl run started {datetime.now().isoformat()} ---\n")
        http_client = await get_authenticated_client()
        m1_client = M1Client(http_client)
        crawler = M1Crawler(m1_client)
        
        # Map a single vehicle from every make in 2010
        target_years = [2010]
        
        for year in target_years:
            logger.info(f"Explicitly targeting year: {year}")
            makes = await m1_client.get_makes(year)
            if makes:
                # Limit to first few makes for a quick verification run if needed, 
                # but user wants "every make of vehicle"
                # To keep it manageable, we'll let it run for all makes by default
                await crawler.run_for_year(year, makes)
            else:
                logger.warning(f"No makes found for year {year}")
        
        await http_client.aclose()
        logger.info("Crawl completed successfully.")
    except Exception as e:
        log_error("crawl_failed", str(e), extra={"exception": type(e).__name__})
        logger.error(f"Crawl failed with error: {e}", exc_info=True)

if __name__ == "__main__":
    # Add a helper for running a single year
    M1Crawler.run_for_year = lambda self, y, m: self.run_custom(y, m)
    
    async def run_custom(self, year, makes):
        for make in tqdm(makes, desc=f"Makes in {year}"):
            if isinstance(make, dict):
                make_name = make.get("makeName")
            else:
                make_name = make
            
            await self._safe_delay()
            models_data = await self.client.get_models(year, make_name)
            if models_data:
                source = _resolve_content_source(models_data, make_name)
                models_list = models_data.get("models") or (models_data.get("body") or {}).get("models") or []
                
                if source and models_list:
                    # Sample the first model
                    sample_model = models_list[0]
                    await self.crawl_vehicle_data(year, make_name, sample_model, source)
                    
                    # Store model metadata
                    self.save_json([str(year), make_name], "models_list.json", models_data)
        
        # Save makes metadata
        self.save_json([str(year)], "makes_list.json", makes)

    M1Crawler.run_custom = run_custom
    asyncio.run(main())
