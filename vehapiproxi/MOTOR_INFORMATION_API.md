# Motor Information API (`api.motor.com`)

**Separate** from the Torque proxy’s **`sites.motor.com/m1`** session (library barcode / EBSCO / cookies). The [Information API](https://api.motor.com/v1/documentation) uses **PublicKey / PrivateKey** query authentication (see your Motor DaaS contract).

## Environment (vehapiproxi)

| Variable | Purpose |
|----------|---------|
| `MOTOR_INFORMATION_PUBLIC_KEY` | Information API public key |
| `MOTOR_INFORMATION_PRIVATE_KEY` | Information API private key |
| `MOTOR_INFORMATION_BASE_URL` | Optional; default `https://api.motor.com` |
| `MOTOR_INFORMATION_CULTURE` | Optional; default `en-US` (sent as `Culture` query param) |

Never commit real keys. Use Vercel / host secrets.

## Endpoints implemented in vehapiproxi

### 1. Fluids (same path as M1-shaped API)

`GET /api/source/:contentSource/vehicle/:vehicleId/fluids`

**When** `MOTOR_INFORMATION_PUBLIC_KEY` and `MOTOR_INFORMATION_PRIVATE_KEY` are set **and** the client sends:

- `baseVehicleId` (or `motorBaseVehicleId`) — Motor **BaseVehicleID** from YMME  
- `engineId` (or `EN` or `motorEngineId`) — engine id used as `EN` on RecommendedFluids  

…the proxy calls **Motor Information** (`RecommendedFluids`) and returns JSON in the same shape as the Torque `FluidListResponse` (`header` + `body.data[]`).

If the env vars are missing or the query params are missing, the request **falls through** to the existing `sites.motor.com` proxy (same behavior as before).

Response headers:

- `x-data-source: motor-information-api`
- `x-motor-information: recommended-fluids`

### 2. YMME helpers (Supabase JWT required)

Both require `Authorization: Bearer <supabase_access_token>`.

| Route | Query params | Response |
|-------|----------------|----------|
| `GET /api/motor-information/ymme/base-vehicle` | `year`, `make`, `model` | `{ baseVehicleId, year, make, model }` |
| `GET /api/motor-information/ymme/engines` | `year`, `make`, `model` | `{ engines: [{ id, name, raw }], year, make, model }` |

Use these to obtain `baseVehicleId` and an engine `id` for the fluids `/fluids` call. The **vehicle wizard** can later persist YMME + engine so the dashboard can pass query params without an extra round-trip.

## Reference path templates (no secrets)

See `vehapiproxi/fluidscfg.example.json` for URI templates (RecommendedFluids, BaseVehicle, Engines). Keys belong in **environment variables**, not in the repo.

## Relation to `sites.motor.com`

- **Proxy** (`sites.motor.com/m1`): article catalog, M1-shaped silos, HTML — **library session** cookies.  
- **Information API** (`api.motor.com/v1/Information/...`): **recommended fluids**, YMME **base vehicle**, **engines**, and other documented resources — **DaaS keys** only.

## App wiring (Torque)

- **Home wizard** saves `PersistedVehicle` with `year`, `makeName`, `modelName`, and `motorEngineId` (M1 `Engine.id` when an engine was selected).
- **Vehicle dashboard** (signed-in user) calls `GET /api/motor-information/ymme/base-vehicle` once per vehicle+YMME and stores `motorBaseVehicleId` in `localStorage` persistence.
- **`VehicleDataService` / `DataSyncService`** pass `baseVehicleId` + `engineId` on `/fluids` when both `motorBaseVehicleId` and `motorEngineId` are present for the current vehicle.

**Gaps:** VIN-only entry or deep links without the home wizard do not have YMME — fluids keep using the M1 proxy until the user re-selects via YMME or a future flow fills persistence.

Future work: surface **engine / base vehicle** metadata in the UI; optional manual engine pick when `motorEngineId` is missing.
