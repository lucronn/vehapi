import asyncio
import logging
from urllib.parse import quote, unquote

import httpx

from auth import USER_AGENT
from error_log import log_error

logger = logging.getLogger(__name__)


def resolve_vehicle_id(model: dict, year: int, source: str) -> str | None:
    """
    Resolve the vehicle ID for API calls from model data.
    M1 uses two formats:
    - Ford/Chevrolet etc.: model.id is year:make:model (may be URL-encoded)
    - MOTOR (Toyota etc.): model has engines[]; vehicle_id is engines[0].id (modelId:engineId)
    - GeneralMotors: model.id is model ID (path); use motorvehicles for motorVehicleId (query)
    """
    # MOTOR content source: use engine ID when engines exist
    engines = model.get("engines") or []
    if engines:
        return engines[0].get("id")
    # Ford-style: model.id is the full vehicle ID
    vid = model.get("id")
    if vid:
        return vid
    # Fallback: construct from year:source:modelName
    model_name = model.get("model") or model.get("modelName") or ""
    if model_name:
        return f"{year}:{source}:{model_name}"
    return None


def requires_motor_vehicle_id(source: str) -> bool:
    """True if this content source uses model ID in path + motorVehicleId in query (e.g. GM)."""
    return source == "GeneralMotors"


class M1Client:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self.base_url = "https://sites.motor.com/m1"
        self.headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Referer": "https://sites.motor.com/m1/",
            "X-Requested-With": "XMLHttpRequest"
        }

    async def get_json(
        self,
        path: str,
        params: dict | None = None,
        *,
        accept_404: bool = False,
        accept_5xx: bool = False,
        retry_5xx: bool = False,
    ):
        """
        Fetch JSON from path. Optionally accept 404 (log WARNING), accept 5xx (no ERROR),
        or retry once on 5xx.
        """
        url = f"{self.base_url}{path}"
        for attempt in range(2 if retry_5xx else 1):
            response = await self.client.get(url, headers=self.headers, params=params)
            if response.status_code == 200:
                try:
                    data = response.json()
                    if data is None:
                        log_error("empty_response", "Empty JSON response", path=path, url=url)
                        logger.warning("Empty JSON response: %s", path)
                    return data
                except Exception as e:
                    log_error("parse_error", str(e), path=path, url=url, extra={"exception": type(e).__name__})
                    logger.error("Failed to parse JSON from %s: %s", url, e)
                    return None

            if response.status_code == 404 and accept_404:
                log_error("http_404", "Not found", path=path, url=url, status_code=404, params=params)
                logger.debug("No data (404): %s", path)
                return None

            if response.status_code >= 500 and accept_5xx:
                log_error("http_5xx", "Server error", path=path, url=url, status_code=response.status_code, params=params)
                logger.debug("No data (5xx): %s", path)
                return None

            if response.status_code >= 500 and retry_5xx and attempt == 0:
                await asyncio.sleep(2.0)
                continue

            log_error(
                "http_error",
                f"Request failed: {response.status_code}",
                path=path,
                url=url,
                status_code=response.status_code,
                params=params,
            )
            logger.error(
                "Request failed: %s - %s | path=%s",
                url,
                response.status_code,
                path,
            )
            return None
        return None

    async def get_years(self):
        data = await self.get_json("/api/years")
        return data.get("body") if data else None

    async def get_makes(self, year: int):
        data = await self.get_json(f"/api/year/{year}/makes")
        return data.get("body") if data else None

    async def get_models(self, year: int, make: str):
        # URL-encode make for path segments (e.g. "Land Rover" -> "Land%20Rover")
        make_encoded = quote(str(make), safe="")
        data = await self.get_json(f"/api/year/{year}/make/{make_encoded}/models")
        return data.get("body") if data else None

    def _encode_vehicle_id(self, vehicle_id: str) -> str:
        """Encode vehicle_id for URL path. Unquote first to handle pre-encoded IDs (Ford)."""
        raw = unquote(str(vehicle_id))
        return quote(raw, safe="")

    def _params_with_motor_vehicle_id(
        self, params: dict | None, motor_vehicle_id: str | None
    ) -> dict | None:
        """Add motorVehicleId to params if provided."""
        if not motor_vehicle_id:
            return params
        p = dict(params) if params else {}
        p["motorVehicleId"] = motor_vehicle_id
        return p

    @staticmethod
    def _params_with_search_term(
        params: dict | None, search_term: str | None
    ) -> dict | None:
        """
        M1 generated client / UI sends searchTerm on many vehicle routes (often '').
        Omit the key entirely when search_term is None.
        See vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md (articles, parts, maintenance, labor).
        """
        if search_term is None:
            return params
        p = dict(params) if params else {}
        p["searchTerm"] = search_term
        return p

    async def get_motorvehicles(self, source: str, vehicle_id: str):
        """Fetch motor vehicle details (trims/engines) for GM. Swagger: getMotorVehicleDetails."""
        vid = self._encode_vehicle_id(vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/{vid}/motorvehicles",
            accept_404=True,
        )

    async def get_articles_v2(
        self,
        source: str,
        vehicle_id: str,
        motor_vehicle_id: str | None = None,
        *,
        search_term: str = "",
    ):
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_search_term(None, search_term)
        params = self._params_with_motor_vehicle_id(params, motor_vehicle_id)
        return await self.get_json(f"/api/source/{source}/vehicle/{vid}/articles/v2", params=params)

    async def get_fluids(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/fluids",
            params=params,
            accept_404=True,
        )

    async def get_parts(
        self,
        source: str,
        vehicle_id: str,
        motor_vehicle_id: str | None = None,
        *,
        search_term: str = "",
    ):
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_search_term(None, search_term)
        params = self._params_with_motor_vehicle_id(params, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/parts",
            params=params,
            accept_5xx=True,
            retry_5xx=True,
        )

    async def get_maintenance_frequency(
        self,
        source: str,
        vehicle_id: str,
        motor_vehicle_id: str | None = None,
        *,
        frequency_type_code: str | None = None,
        search_term: str = "",
    ):
        """
        M1 UI passes frequencyTypeCode per call ('F', 'N', 'R'). See vehapiproxi/API_CONSUMPTION_DOCUMENTATION.md.
        When frequency_type_code is None, no code is sent (legacy single request).
        """
        vid = self._encode_vehicle_id(vehicle_id)
        params: dict = {}
        if frequency_type_code is not None:
            params["frequencyTypeCode"] = frequency_type_code
        params = self._params_with_search_term(params, search_term)
        params = self._params_with_motor_vehicle_id(params, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/maintenanceSchedules/frequency",
            params=params,
            accept_5xx=True,
            retry_5xx=True,
        )

    async def get_maintenance_intervals(
        self,
        source: str,
        vehicle_id: str,
        interval_type: str = "Miles",
        interval: int | None = None,
        motor_vehicle_id: str | None = None,
        *,
        search_term: str = "",
    ):
        """Fetch maintenance intervals. M1 requires intervalType and interval (e.g. 5000)."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = {"intervalType": interval_type}
        if interval is not None:
            params["interval"] = interval
        params = self._params_with_search_term(params, search_term)
        params = self._params_with_motor_vehicle_id(params, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/maintenanceSchedules/intervals",
            params=params,
            accept_5xx=True,
            retry_5xx=True,
        )

    async def get_labor(
        self,
        source: str,
        vehicle_id: str,
        article_id: str,
        motor_vehicle_id: str | None = None,
        search_term: str = "",
    ):
        """Fetch labor data for an article. M1 expects searchTerm param (even if empty)."""
        vid = self._encode_vehicle_id(vehicle_id)
        aid = quote(str(article_id), safe="")
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id) or {}
        params["searchTerm"] = search_term
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/labor/{aid}",
            params=params,
            accept_404=True,
            accept_5xx=True,
            retry_5xx=True,
        )

    async def get_vehicle_name(self, source: str, vehicle_id: str):
        """Fetch display name for vehicle. Returns None on 404."""
        vid = self._encode_vehicle_id(vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/name",
            accept_404=True,
        )

    async def get_maintenance_indicators(
        self,
        source: str,
        vehicle_id: str,
        motor_vehicle_id: str | None = None,
        *,
        search_term: str = "",
    ):
        """Fetch maintenance schedule indicators. Swagger: MaintenanceSchedules/Indicators."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_search_term(None, search_term)
        params = self._params_with_motor_vehicle_id(params, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/maintenanceSchedules/indicators",
            params=params,
            accept_404=True,
            accept_5xx=True,
            retry_5xx=True,
        )

    # --- Swagger-defined asset endpoints (from oldfiles/documentation/vehapiproxi/swagger.yaml) ---

    async def get_procedures(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getProcedures. Dedicated procedures endpoint."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/procedures",
            params=params,
            accept_404=True,
        )

    async def get_diagrams(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getDiagrams. Wiring + component location diagrams."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/diagrams",
            params=params,
            accept_404=True,
        )

    async def get_specs(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getSpecs."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/specs",
            params=params,
            accept_404=True,
        )

    async def get_wiring(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getWiring. Wiring diagrams only."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/wiring",
            params=params,
            accept_404=True,
        )

    async def get_components(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getComponents. Component locations only."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/components",
            params=params,
            accept_404=True,
        )

    async def get_tsbs(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getTsbs. Technical Service Bulletins."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/tsbs",
            params=params,
            accept_404=True,
        )

    async def get_dtcs(
        self, source: str, vehicle_id: str, motor_vehicle_id: str | None = None
    ):
        """Swagger: getDtcs. Diagnostic Trouble Codes."""
        vid = self._encode_vehicle_id(vehicle_id)
        params = self._params_with_motor_vehicle_id(None, motor_vehicle_id)
        return await self.get_json(
            f"/api/source/{source}/vehicle/{vid}/dtcs",
            params=params,
            accept_404=True,
        )
