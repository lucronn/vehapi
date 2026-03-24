/**
 * Direct calls to Motor **Information** API (`api.motor.com/v1/Information/...`).
 * Uses **separate** credentials from the `sites.motor.com/m1` proxy session (LIBRARY_BARCODE / EBSCO).
 *
 * @see `vehapiproxi/MOTOR_INFORMATION_API.md`
 * @see https://api.motor.com/v1/documentation
 */
import logger from './logger.js';

const DEFAULT_BASE = 'https://api.motor.com';

export function getMotorInformationConfig() {
    const publicKey = String(process.env.MOTOR_INFORMATION_PUBLIC_KEY || '').trim();
    const privateKey = String(process.env.MOTOR_INFORMATION_PRIVATE_KEY || '').trim();
    const baseUrl = String(process.env.MOTOR_INFORMATION_BASE_URL || DEFAULT_BASE)
        .trim()
        .replace(/\/+$/, '');
    const culture = String(process.env.MOTOR_INFORMATION_CULTURE || 'en-US').trim();
    return {
        enabled: Boolean(publicKey && privateKey),
        publicKey,
        privateKey,
        baseUrl,
        culture
    };
}

/**
 * Append Motor DaaS-style query auth. Parameter names match Motor Information API docs.
 */
export function withMotorInformationAuth(urlString, cfg) {
    const u = new URL(urlString);
    u.searchParams.set('PublicKey', cfg.publicKey);
    u.searchParams.set('PrivateKey', cfg.privateKey);
    if (cfg.culture) {
        u.searchParams.set('Culture', cfg.culture);
    }
    return u.toString();
}

/**
 * GET JSON from Information API (throws on non-OK or non-JSON).
 */
export async function motorInformationGetJson(pathWithLeadingSlash, query = {}) {
    const cfg = getMotorInformationConfig();
    if (!cfg.enabled) {
        throw new Error('Motor Information API not configured (set MOTOR_INFORMATION_PUBLIC_KEY, MOTOR_INFORMATION_PRIVATE_KEY)');
    }
    const u = new URL(cfg.baseUrl + pathWithLeadingSlash);
    for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') {
            u.searchParams.set(k, String(v));
        }
    }
    const url = withMotorInformationAuth(u.toString(), cfg);
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'vehapiproxi/1.0 motor-information'
        }
    });
    const text = await res.text();
    if (!res.ok) {
        logger.warn(`Motor Information GET ${pathWithLeadingSlash} failed: ${res.status} ${text.slice(0, 400)}`);
        throw new Error(`Motor Information HTTP ${res.status}`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        logger.warn(`Motor Information non-JSON response for ${pathWithLeadingSlash}: ${text.slice(0, 200)}`);
        throw new Error('Motor Information response was not JSON');
    }
}

/** YMME segment encoding for path (not query). */
function ymmeSeg(s) {
    return encodeURIComponent(String(s || '').trim());
}

/**
 * `/v1/Information/YMME/Years/{year}/Makes/{make}/Models/{model}/BaseVehicle?AttributeStandard=MOTOR`
 */
export async function fetchBaseVehicleId(year, make, model) {
    const path = `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${ymmeSeg(make)}/Models/${ymmeSeg(model)}/BaseVehicle`;
    const data = await motorInformationGetJson(path, { AttributeStandard: 'MOTOR' });
    const id =
        data?.baseVehicleId ??
        data?.BaseVehicleId ??
        data?.baseVehicleID ??
        data?.vehicleId ??
        data?.VehicleId ??
        data?.id ??
        data?.body?.baseVehicleId;
    if (id == null || id === '') {
        throw new Error('Motor Information BaseVehicle response missing baseVehicleId');
    }
    return Number(id);
}

/**
 * Engines for YMME (engine `id` values are used as `EN` on RecommendedFluids).
 */
export async function fetchEngines(year, make, model) {
    const path = `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${ymmeSeg(make)}/Models/${ymmeSeg(model)}/Engines`;
    const data = await motorInformationGetJson(path, {
        WithRel: 'RecommendedFluids',
        AttributeStandard: 'MOTOR'
    });
    const arr =
        data?.engines ??
        data?.Engines ??
        data?.items ??
        data?.Items ??
        data?.body ??
        (Array.isArray(data) ? data : []);
    if (!Array.isArray(arr)) {
        return [];
    }
    return arr.map((e) => ({
        id: e.engineId ?? e.EngineId ?? e.id ?? e.Id,
        name: e.engineName ?? e.EngineName ?? e.name ?? e.Name ?? e.description ?? '',
        raw: e
    }));
}

/**
 * Recommended fluids for a base vehicle + engine.
 * @param {string|number} baseVehicleId — Motor BaseVehicleID
 * @param {string|number} engineId — `EN` query parameter
 */
export async function fetchRecommendedFluidsRaw(baseVehicleId, engineId) {
    const path = `/v1/Information/Vehicles/Attributes/BaseVehicleID/${encodeURIComponent(String(baseVehicleId))}/Content/Summaries/Of/RecommendedFluids`;
    return motorInformationGetJson(path, {
        EN: String(engineId),
        AttributeStandard: 'MOTOR'
    });
}

/**
 * Map arbitrary Motor Information JSON to Torque `FluidListResponse`-shaped body.
 */
export function normalizeRecommendedFluidsToTorqueShape(raw) {
    const list =
        raw?.fluids ??
        raw?.Fluids ??
        raw?.items ??
        raw?.Items ??
        raw?.data ??
        raw?.Data ??
        raw?.recommendedFluids ??
        raw?.body?.data ??
        (Array.isArray(raw) ? raw : []);
    const arr = Array.isArray(list) ? list : [];
    const data = arr.map((item, i) => {
        const o = item && typeof item === 'object' ? item : {};
        const title =
            String(
                o.title ?? o.Title ?? o.name ?? o.Name ?? o.fluidName ?? o.FluidName ?? o.description ?? o.Description ?? ''
            ).trim() || `Fluid ${i + 1}`;
        const capacity = String(o.capacity ?? o.Capacity ?? o.volume ?? o.Volume ?? '').trim();
        const specification = String(
            o.specification ?? o.Specification ?? o.spec ?? o.viscosity ?? o.Notes ?? ''
        ).trim();
        const bucket = String(o.bucket ?? o.Bucket ?? 'Fluids').trim() || 'Fluids';
        const id = String(o.id ?? o.Id ?? o.fluidId ?? o.FluidId ?? i);
        return {
            id,
            bucket,
            title,
            capacity,
            specification
        };
    });
    return {
        header: { status: 'OK', statusCode: 200 },
        body: {
            total: data.length,
            data
        }
    };
}
