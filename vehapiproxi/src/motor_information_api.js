/**
 * Direct calls to Motor **Information** API (`api.motor.com/v1/Information/...`).
 * Uses **separate** credentials from the `sites.motor.com/m1` proxy session (LIBRARY_BARCODE / EBSCO).
 *
 * Auth priority:
 *   1. MOTOR_FLUIDS_PUBLIC_KEY + MOTOR_FLUIDS_PRIVATE_KEY → HMAC Shared Key (Scheme=Shared)
 *   2. MOTOR_INFORMATION_PUBLIC_KEY + MOTOR_INFORMATION_PRIVATE_KEY → plain query params (legacy)
 *
 * @see `vehapiproxi/MOTOR_INFORMATION_API.md`
 * @see https://api.motor.com/v1/documentation
 */
import crypto from 'crypto';
import logger from './logger.js';

const DEFAULT_BASE = 'https://api.motor.com';

export function getMotorInformationConfig() {
    // Prefer DaaS HMAC keys if available
    const daasPublicKey = String(process.env.MOTOR_FLUIDS_PUBLIC_KEY || '').trim();
    const daasPrivateKey = String(process.env.MOTOR_FLUIDS_PRIVATE_KEY || '').trim();
    if (daasPublicKey && daasPrivateKey) {
        return {
            enabled: true,
            authMode: 'hmac',
            publicKey: daasPublicKey,
            privateKey: daasPrivateKey,
            baseUrl: DEFAULT_BASE,
            culture: 'en-US',
        };
    }
    const publicKey = String(process.env.MOTOR_INFORMATION_PUBLIC_KEY || '').trim();
    const privateKey = String(process.env.MOTOR_INFORMATION_PRIVATE_KEY || '').trim();
    const baseUrl = String(process.env.MOTOR_INFORMATION_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, '');
    const culture = String(process.env.MOTOR_INFORMATION_CULTURE || 'en-US').trim();
    return {
        enabled: Boolean(publicKey && privateKey),
        authMode: 'plain',
        publicKey,
        privateKey,
        baseUrl,
        culture,
    };
}

function buildHmacUrl(baseUrl, path, queryParams, cfg) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const msg = `${cfg.publicKey}\nGET\n${ts}\n${path}`;
    const sig = crypto.createHmac('sha256', cfg.privateKey).update(msg).digest('base64');
    const u = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(queryParams)) {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
    u.searchParams.set('Scheme', 'Shared');
    u.searchParams.set('ApiKey', cfg.publicKey);
    u.searchParams.set('Xdate', ts);
    u.searchParams.set('Sig', sig);
    return u.toString();
}

export function withMotorInformationAuth(urlString, cfg) {
    const u = new URL(urlString);
    u.searchParams.set('PublicKey', cfg.publicKey);
    u.searchParams.set('PrivateKey', cfg.privateKey);
    if (cfg.culture) u.searchParams.set('Culture', cfg.culture);
    return u.toString();
}

/**
 * GET JSON from Information API (throws on non-OK or non-JSON).
 */
export async function motorInformationGetJson(pathWithLeadingSlash, query = {}) {
    const cfg = getMotorInformationConfig();
    if (!cfg.enabled) {
        throw new Error('Motor Information API not configured (set MOTOR_FLUIDS_PUBLIC_KEY / MOTOR_FLUIDS_PRIVATE_KEY)');
    }
    let url;
    if (cfg.authMode === 'hmac') {
        url = buildHmacUrl(cfg.baseUrl, pathWithLeadingSlash, query, cfg);
    } else {
        const u = new URL(cfg.baseUrl + pathWithLeadingSlash);
        for (const [k, v] of Object.entries(query)) {
            if (v != null && v !== '') u.searchParams.set(k, String(v));
        }
        url = withMotorInformationAuth(u.toString(), cfg);
    }
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'vehapiproxi/1.0' } });
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
 * Resolves year/make(name)/model(name) → BaseVehicleID via the YMME ID-based API.
 * With HMAC keys: looks up MakeID then ModelID, then fetches BaseVehicle.
 * Falls back to name-in-path (legacy plain-key API).
 */
export async function fetchBaseVehicleId(year, make, model) {
    const cfg = getMotorInformationConfig();
    if (cfg.authMode === 'hmac') {
        // YMME API requires numeric IDs — resolve make name → MakeID
        const makesData = await motorInformationGetJson(
            `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes`,
            { WithRel: 'RecommendedFluids', AttributeStandard: 'MOTOR' }
        );
        const makeItems = makesData?.Body ?? makesData?.body ?? (Array.isArray(makesData) ? makesData : []);
        const makeEntry = makeItems.find(m =>
            String(m.MakeName || m.makeName || '').toLowerCase() === String(make).toLowerCase()
        );
        if (!makeEntry) throw new Error(`Make "${make}" not found for year ${year}`);
        const makeId = makeEntry.MakeID ?? makeEntry.makeId;

        // Resolve model name → ModelID
        const modelsData = await motorInformationGetJson(
            `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${makeId}/Models`,
            { WithRel: 'RecommendedFluids', AttributeStandard: 'MOTOR' }
        );
        const modelItems = modelsData?.Body ?? modelsData?.body ?? (Array.isArray(modelsData) ? modelsData : []);
        const modelEntry = modelItems.find(m =>
            String(m.ModelName || m.modelName || '').toLowerCase() === String(model).toLowerCase()
        );
        if (!modelEntry) throw new Error(`Model "${model}" not found for ${year} ${make}`);
        const modelId = modelEntry.ModelID ?? modelEntry.modelId;

        const bvData = await motorInformationGetJson(
            `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${makeId}/Models/${modelId}/BaseVehicle`,
            { AttributeStandard: 'MOTOR' }
        );
        const bvBody = bvData?.Body ?? bvData?.body ?? bvData;
        const id = bvBody?.BaseVehicleID ?? bvBody?.baseVehicleId;
        if (id == null) throw new Error('BaseVehicle response missing BaseVehicleID');
        return Number(id);
    }
    // Legacy: name-in-path
    const path = `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${ymmeSeg(make)}/Models/${ymmeSeg(model)}/BaseVehicle`;
    const data = await motorInformationGetJson(path, { AttributeStandard: 'MOTOR' });
    const id = data?.baseVehicleId ?? data?.BaseVehicleId ?? data?.baseVehicleID ?? data?.id;
    if (id == null || id === '') throw new Error('Motor Information BaseVehicle response missing baseVehicleId');
    return Number(id);
}

/**
 * Engines for YMME (engine `id` values are used as `EN` on RecommendedFluids).
 */
export async function fetchEngines(year, make, model) {
    const cfg = getMotorInformationConfig();
    let data;
    if (cfg.authMode === 'hmac') {
        // Need numeric IDs — resolve make/model names first
        const makesData = await motorInformationGetJson(
            `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes`,
            { WithRel: 'RecommendedFluids', AttributeStandard: 'MOTOR' }
        );
        const makeItems = makesData?.Body ?? (Array.isArray(makesData) ? makesData : []);
        const makeEntry = makeItems.find(m => String(m.MakeName || '').toLowerCase() === String(make).toLowerCase());
        if (!makeEntry) return [];
        const makeId = makeEntry.MakeID;
        const modelsData = await motorInformationGetJson(
            `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${makeId}/Models`,
            { WithRel: 'RecommendedFluids', AttributeStandard: 'MOTOR' }
        );
        const modelItems = modelsData?.Body ?? (Array.isArray(modelsData) ? modelsData : []);
        const modelEntry = modelItems.find(m => String(m.ModelName || '').toLowerCase() === String(model).toLowerCase());
        if (!modelEntry) return [];
        const modelId = modelEntry.ModelID;
        data = await motorInformationGetJson(
            `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${makeId}/Models/${modelId}/Engines`,
            { WithRel: 'RecommendedFluids', AttributeStandard: 'MOTOR' }
        );
    } else {
        const path = `/v1/Information/YMME/Years/${ymmeSeg(year)}/Makes/${ymmeSeg(make)}/Models/${ymmeSeg(model)}/Engines`;
        data = await motorInformationGetJson(path, { WithRel: 'RecommendedFluids', AttributeStandard: 'MOTOR' });
    }
    const arr = data?.Body ?? data?.body ?? data?.engines ?? (Array.isArray(data) ? data : []);
    if (!Array.isArray(arr)) return [];
    return arr.map((e) => ({
        id: e.EngineID ?? e.engineId ?? e.id,
        name: e.Description ?? e.engineName ?? e.name ?? '',
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
    const data = await motorInformationGetJson(path, { EN: String(engineId), AttributeStandard: 'MOTOR' });
    // HMAC response wraps in Body; plain response may be direct
    return data?.Body ?? data;
}

/**
 * Map Motor DaaS or legacy Information API fluids response → Torque FluidListResponse shape.
 * DaaS returns: { Applications: [{ Items: [{ FluidID, Brand, RecommendedProducts, TempRangeF, ... }] }] }
 * Legacy returns: { fluids/Fluids/items/data: [...] }
 */
export function normalizeRecommendedFluidsToTorqueShape(raw) {
    // DaaS Applications[].Items[] shape
    if (raw?.Applications || raw?.applications) {
        const applications = raw.Applications ?? raw.applications ?? [];
        const data = [];
        applications.forEach((app, appIdx) => {
            const items = app.Items ?? app.items ?? [];
            items.forEach((item, itemIdx) => {
                const products = item.RecommendedProducts ?? item.recommendedProducts ?? [];
                const brand = item.Brand?.Description ?? item.brand?.description ?? '';
                const tempRange = item.TempRangeF ?? item.tempRangeF ?? '';
                const extraParams = item.ExtendedParameters ?? item.extendedParameters ?? [];
                const maxMileage = extraParams.find(p => p.Name === 'Max Mileage' || p.name === 'Max Mileage')?.Value ?? '';
                products.forEach((prod, prodIdx) => {
                    const viscosity = prod.ProductType ?? prod.productType ?? '';
                    const productName = prod.Product ?? prod.product ?? viscosity;
                    data.push({
                        id: String(item.FluidID ?? item.fluidId ?? `${appIdx}-${itemIdx}-${prodIdx}`),
                        bucket: 'Engine Oil',
                        title: productName || `${brand} ${viscosity}`.trim() || 'Recommended Fluid',
                        brand,
                        viscosity,
                        tempRangeF: tempRange,
                        maxMileage,
                        capacity: '',
                        specification: viscosity,
                    });
                });
                // If no products listed, include the fluid entry itself
                if (products.length === 0) {
                    data.push({
                        id: String(item.FluidID ?? item.fluidId ?? `${appIdx}-${itemIdx}`),
                        bucket: 'Engine Oil',
                        title: `${brand} Recommended Fluid`.trim() || 'Recommended Fluid',
                        brand,
                        viscosity: '',
                        tempRangeF: tempRange,
                        maxMileage,
                        capacity: '',
                        specification: '',
                    });
                }
            });
        });
        return { header: { status: 'OK', statusCode: 200 }, body: { total: data.length, data } };
    }

    // Legacy flat list
    const list =
        raw?.fluids ?? raw?.Fluids ?? raw?.items ?? raw?.Items ??
        raw?.data ?? raw?.Data ?? raw?.recommendedFluids ?? raw?.body?.data ??
        (Array.isArray(raw) ? raw : []);
    const arr = Array.isArray(list) ? list : [];
    const data = arr.map((item, i) => {
        const o = item && typeof item === 'object' ? item : {};
        const title = String(o.title ?? o.Title ?? o.name ?? o.Name ?? o.fluidName ?? o.FluidName ?? o.description ?? o.Description ?? '').trim() || `Fluid ${i + 1}`;
        const capacity = String(o.capacity ?? o.Capacity ?? o.volume ?? o.Volume ?? '').trim();
        const specification = String(o.specification ?? o.Specification ?? o.spec ?? o.viscosity ?? o.Notes ?? '').trim();
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
