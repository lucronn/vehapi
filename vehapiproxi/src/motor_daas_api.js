/**
 * Motor DaaS API client — api.motor.com YMME + Fluids + Parts.
 * Auth: HMAC-SHA256 Shared Key (Scheme=Shared&ApiKey&Xdate&Sig).
 * Completely separate from sites.motor.com proxy.
 *
 * Env vars:
 *   MOTOR_FLUIDS_PUBLIC_KEY    — per-culture or single key (en-US)
 *   MOTOR_FLUIDS_PRIVATE_KEY   — per-culture or single key (en-US)
 *   MOTOR_FLUIDS_PUBLIC_KEY_CA / MOTOR_FLUIDS_PRIVATE_KEY_CA  (optional, en-CA/fr-CA)
 */
import crypto from 'crypto';
import logger from './logger.js';

const BASE = 'https://api.motor.com';
const CULTURE = 'en-US';

export function getDaasConfig(culture = CULTURE, useSandbox = false) {
    const prefix = useSandbox ? 'MOTOR_SANDBOX' : 'MOTOR_FLUIDS';
    const pk = (process.env[`${prefix}_PUBLIC_KEY`] || '').trim();
    const sk = (process.env[`${prefix}_PRIVATE_KEY`] || '').trim();
    return {
        enabled: Boolean(pk && sk),
        publicKey: pk,
        secretKey: sk,
        culture,
        sandbox: useSandbox,
    };
}

function buildSignedUrl(path, queryString, cfg) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const msg = `${cfg.publicKey}\nGET\n${ts}\n${path}`;
    const sig = crypto.createHmac('sha256', cfg.secretKey).update(msg).digest('base64');
    const qs = queryString ? `${queryString}&` : '';
    return `${BASE}${path}?${qs}Scheme=Shared&ApiKey=${cfg.publicKey}&Xdate=${ts}&Sig=${encodeURIComponent(sig)}`;
}

async function daasGet(path, queryString = '', useSandbox = false, attempt = 0) {
    const cfg = getDaasConfig(CULTURE, useSandbox);
    if (!cfg.enabled) {
        const prefix = useSandbox ? 'MOTOR_SANDBOX' : 'MOTOR_FLUIDS';
        throw new Error(`${prefix}_PUBLIC_KEY / ${prefix}_PRIVATE_KEY not set`);
    }
    const url = buildSignedUrl(path, queryString, cfg);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (json.Header?.StatusCode !== 200) {
        const msg = json.Header?.Messages?.[0]?.LongDescription || `HTTP ${res.status}`;
        const isRateLimit = /rate limit/i.test(msg) || res.status === 429;
        const isTransient = isRateLimit || res.status >= 500;

        if (isRateLimit) {
            // Use Motor's x-rate-limit-reset (unix seconds) if present, else exponential backoff capped at 5min
            const resetHeader = res.headers.get('x-rate-limit-reset');
            let delayMs;
            if (resetHeader && /^\d+$/.test(resetHeader)) {
                const resetMs = Number(resetHeader) * 1000;
                delayMs = Math.max(resetMs - Date.now(), 5000) + 1000 + Math.random() * 1000;
            } else {
                delayMs = Math.min(30_000 * Math.pow(2, attempt), 300_000) + Math.random() * 2000;
            }
            const waitSec = Math.round(delayMs / 1000);
            logger.warn(`[daas] rate-limit on ${path} — waiting ${waitSec}s for quota reset (attempt ${attempt + 1})`);
            await new Promise(r => setTimeout(r, delayMs));
            return daasGet(path, queryString, useSandbox, attempt + 1);  // unlimited retries on rate-limit
        }
        if (isTransient && attempt < 5) {
            const delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 500;
            logger.warn(`[daas] ${msg} on ${path} — retry ${attempt + 1}/5 in ${Math.round(delayMs)}ms`);
            await new Promise(r => setTimeout(r, delayMs));
            return daasGet(path, queryString, useSandbox, attempt + 1);
        }
        throw new Error(`Motor DaaS error on ${path}: ${msg}`);
    }
    return json.Body;
}

// ─── YMME ────────────────────────────────────────────────────────────────────

/**
 * Returns years list (numbers, descending).
 * Filtered to vehicles that have RecommendedFluids data.
 */
export async function fetchDaasYears(useSandbox = false) {
    const items = await daasGet(
        '/v1/Information/YMME/Years',
        'WithRel=RecommendedFluids&AttributeStandard=MOTOR',
        useSandbox
    );
    const body = items.map(y => y.Year).filter(Boolean).sort((a, b) => b - a);
    const src = useSandbox ? 'motor-daas-sandbox' : 'motor-daas';
    return { header: { status: 'OK', statusCode: 200, dataSource: src }, body };
}

/**
 * Returns makes for a year.
 * Response shape: [{ makeId, makeName, make_id, make_name }]
 */
export async function fetchDaasMakes(year, useSandbox = false) {
    const items = await daasGet(
        `/v1/Information/YMME/Years/${year}/Makes`,
        'WithRel=RecommendedFluids&AttributeStandard=MOTOR'
    );
    const body = items.map(m => ({
        makeId: m.MakeID,
        makeName: m.MakeName,
        make_id: m.MakeID,
        make_name: m.MakeName,
    }));
    const src = useSandbox ? 'motor-daas-sandbox' : 'motor-daas';
    return { header: { status: 'OK', statusCode: 200, dataSource: src }, body };
}

/**
 * Returns models for year+makeId, with engines nested and BaseVehicleID attached.
 * make can be a display name (we resolve MakeID first) or a numeric MakeID.
 */
export async function fetchDaasModels(year, makeIdentifier, useSandbox = false) {
    // Resolve MakeID
    let makeId;
    let makeName;
    if (/^\d+$/.test(String(makeIdentifier))) {
        makeId = makeIdentifier;
    } else {
        const makesItems = await daasGet(
            `/v1/Information/YMME/Years/${year}/Makes`,
            'WithRel=RecommendedFluids&AttributeStandard=MOTOR',
            useSandbox
        );
        const found = makesItems.find(m =>
            m.MakeName?.toLowerCase() === String(makeIdentifier).toLowerCase()
        );
        if (!found) throw new Error(`Make "${makeIdentifier}" not found for year ${year}`);
        makeId = found.MakeID;
        makeName = found.MakeName;
    }

    const modelItems = await daasGet(
        `/v1/Information/YMME/Years/${year}/Makes/${makeId}/Models`,
        'WithRel=RecommendedFluids&AttributeStandard=MOTOR',
        useSandbox
    );

    if (!makeName) makeName = String(makeIdentifier);

    const CHUNK = 8;
    const withEngines = [];
    for (let i = 0; i < modelItems.length; i += CHUNK) {
        const chunk = modelItems.slice(i, i + CHUNK);
        const settled = await Promise.allSettled(
            chunk.map(async m => {
                const engHref = m.Links?.find(l => l.Rel === 'VehicleEngines')?.Href;
                const bvHref = m.Links?.find(l => l.Rel === 'BaseVehicleDetails')?.Href;
                let engines = [];
                let baseVehicleId = null;
                const [engResult, bvResult] = await Promise.allSettled([
                    engHref ? daasGet(engHref, 'WithRel=RecommendedFluids&AttributeStandard=MOTOR', useSandbox) : Promise.resolve([]),
                    bvHref ? daasGet(bvHref, 'AttributeStandard=MOTOR', useSandbox) : Promise.resolve(null),
                ]);
                if (engResult.status === 'fulfilled') {
                    engines = (engResult.value || []).map(e => ({
                        id: e.EngineID,
                        name: e.Description || buildEngineName(e),
                        displayName: e.Description || buildEngineName(e),
                        engineId: e.EngineID,
                        cylinders: e.Cylinders,
                        liters: e.CylinderLiter,
                        fuelType: e.FuelType,
                        designation: e.Designation,
                    }));
                }
                if (bvResult.status === 'fulfilled' && bvResult.value) {
                    baseVehicleId = bvResult.value?.BaseVehicleID ?? null;
                }
                return {
                    id: m.ModelID,
                    model: m.ModelName,
                    model_name: m.ModelName,
                    make_id: makeId,
                    make_name: makeName,
                    type: m.Type?.Type,
                    baseVehicleId,
                    engines,
                };
            })
        );
        settled.forEach(r => { if (r.status === 'fulfilled') withEngines.push(r.value); });
    }

    const src = useSandbox ? 'motor-daas-sandbox' : 'motor-daas';
    return { header: { status: 'OK', statusCode: 200, dataSource: src }, body: withEngines };
}

// ─── Fluids ──────────────────────────────────────────────────────────────────

export async function fetchDaasFluids(baseVehicleId, engineId, useSandbox = false) {
    const body = await daasGet(
        `/v1/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Summaries/Of/RecommendedFluids`,
        `EN=${engineId}&AttributeStandard=MOTOR`,
        useSandbox
    );
    const src = useSandbox ? 'motor-daas-sandbox' : 'motor-daas';
    return { header: { status: 'OK', statusCode: 200, dataSource: src }, body };
}

// ─── Parts ───────────────────────────────────────────────────────────────────

export async function fetchDaasParts(baseVehicleId, engineId, useSandbox = false) {
    const body = await daasGet(
        `/v1/Information/Vehicles/Attributes/BaseVehicleID/${baseVehicleId}/Content/Summaries/Of/Parts`,
        `Include=CurrentPricing&EN=${engineId}&AttributeStandard=MOTOR`,
        useSandbox
    );
    const src = useSandbox ? 'motor-daas-sandbox' : 'motor-daas';
    return { header: { status: 'OK', statusCode: 200, dataSource: src }, body };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildEngineName(e) {
    const parts = [];
    if (e.CylinderLiter) parts.push(`${e.CylinderLiter}L`);
    if (e.Cylinders) parts.push(`L${e.Cylinders}`);
    if (e.FuelType) parts.push(e.FuelType);
    return parts.join(' ') || e.Designation || String(e.EngineID);
}
