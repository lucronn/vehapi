/**
 * Motor DaaS (api.motor.com) — Chek-Chart YMME client.
 * Completely separate from sites.motor.com proxy. Uses PublicKey/PrivateKey query auth.
 *
 * Configured via MOTOR_FLUIDS_PUBLIC_KEY and MOTOR_FLUIDS_PRIVATE_KEY env vars.
 */

const BASE = 'https://api.motor.com/v1';

export function getChekChartConfig() {
    const publicKey = (process.env.MOTOR_FLUIDS_PUBLIC_KEY || '').trim();
    const privateKey = (process.env.MOTOR_FLUIDS_PRIVATE_KEY || '').trim();
    return {
        enabled: Boolean(publicKey && privateKey),
        publicKey,
        privateKey,
    };
}

async function chekChartGet(path) {
    const cfg = getChekChartConfig();
    if (!cfg.enabled) throw new Error('Chek-Chart API not configured');
    const url = new URL(BASE + path);
    url.searchParams.set('PublicKey', cfg.publicKey);
    url.searchParams.set('PrivateKey', cfg.privateKey);
    url.searchParams.set('Culture', 'en-US');
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const json = await res.json();
    if (json.Header?.StatusCode !== 200 && json.header?.statusCode !== 200) {
        const msg = json.Header?.Messages?.[0]?.LongDescription || json.header?.messages?.[0]?.longDescription || `HTTP ${res.status}`;
        throw new Error(`Chek-Chart API error: ${msg}`);
    }
    return json.Body ?? json.body ?? [];
}

/** Returns array of year numbers in descending order. */
export async function fetchChekChartYears() {
    const items = await chekChartGet('/Information/Chek-Chart/Years');
    const years = items.map(y => y.Year ?? y.year).filter(Boolean).sort((a, b) => b - a);
    return {
        header: { status: 'OK', statusCode: 200, dataSource: 'chek-chart' },
        body: years,
    };
}

/** Returns makes for a year: [{ makeId, makeName, make_id, make_name }] */
export async function fetchChekChartMakes(year) {
    const items = await chekChartGet(`/Information/Chek-Chart/Years/${year}/Makes`);
    const body = items.map(m => ({
        makeId: m.MakeCode ?? m.makeCode,
        makeName: m.MakeName ?? m.makeName,
        make_id: m.MakeCode ?? m.makeCode,
        make_name: m.MakeName ?? m.makeName,
    }));
    return {
        header: { status: 'OK', statusCode: 200, dataSource: 'chek-chart' },
        body,
    };
}

/**
 * Returns models for year+make, with engines nested in each model.
 * make can be a display name ("GMC") or a MakeCode ("GM") — we resolve via makes list.
 */
export async function fetchChekChartModels(year, makeName) {
    // Resolve MakeCode from name
    const makesItems = await chekChartGet(`/Information/Chek-Chart/Years/${year}/Makes`);
    const makeEntry = makesItems.find(m =>
        (m.MakeName ?? '').toLowerCase() === makeName.toLowerCase() ||
        (m.MakeCode ?? '').toLowerCase() === makeName.toLowerCase()
    );
    if (!makeEntry) {
        throw new Error(`Make "${makeName}" not found for year ${year}`);
    }
    const makeCode = makeEntry.MakeCode ?? makeEntry.makeCode;

    // Fetch models
    const modelItems = await chekChartGet(`/Information/Chek-Chart/Years/${year}/Makes/${makeCode}/Models`);

    // Fetch engines for each model in parallel (cap at 10 concurrent)
    const CHUNK = 10;
    const withEngines = [];
    for (let i = 0; i < modelItems.length; i += CHUNK) {
        const chunk = modelItems.slice(i, i + CHUNK);
        const settled = await Promise.allSettled(
            chunk.map(async m => {
                const modelCode = m.ModelCode ?? m.modelCode;
                let engines = [];
                try {
                    const engItems = await chekChartGet(
                        `/Information/Chek-Chart/Years/${year}/Makes/${makeCode}/Models/${modelCode}/Engines`
                    );
                    engines = engItems.map(e => ({
                        id: e.EngineCode ?? e.engineCode,
                        name: buildEngineName(e),
                        displayName: buildEngineName(e),
                    }));
                } catch { /* engines unavailable — return empty */ }
                return {
                    id: modelCode,
                    model: m.ModelName ?? m.modelName,
                    model_name: m.ModelName ?? m.modelName,
                    make_id: makeCode,
                    engines,
                };
            })
        );
        settled.forEach(r => { if (r.status === 'fulfilled') withEngines.push(r.value); });
    }

    return {
        header: { status: 'OK', statusCode: 200, dataSource: 'chek-chart' },
        body: withEngines,
    };
}

function buildEngineName(e) {
    const parts = [];
    if (e.Cylinders) parts.push(`${e.Cylinders}-Cyl`);
    if (e.Liters) parts.push(`${e.Liters}L`);
    if (e.Fuel && e.Fuel !== 'GAS') parts.push(e.Fuel);
    if (e.Induct && e.Induct !== 'NA') parts.push(e.Induct);
    const name = parts.join(' ') || e.EngineName || e.EngineCode || 'Engine';
    return name;
}
