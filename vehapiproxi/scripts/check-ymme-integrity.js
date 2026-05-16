#!/usr/bin/env node
/**
 * YMME data integrity: ensure Supabase `vehicle_metadata` paths cover everything Motor exposes
 * for the catalog index (years → per-year makes → per-make models JSON, including embedded engines).
 *
 * Shallow (default): Motor calls = 1 + (#years). Builds expected paths from each year's /makes list
 * (same keys as seed-ymme). Compares to a paginated full read of `vehicle_metadata.path`.
 *
 * Deep (--deep): Also GETs every /models URL (like a full seed pass) to confirm each endpoint is 200;
 * optionally compares model+engine fingerprints vs Supabase `data` when --verify-bodies is set.
 *
 * Usage:
 *   cd vehapiproxi && node scripts/check-ymme-integrity.js
 *   node scripts/check-ymme-integrity.js --base=https://vehapi.vercel.app
 *   node scripts/check-ymme-integrity.js --deep
 *   node scripts/check-ymme-integrity.js --from-year=2010 --to-year=2020
 *
 * Progress: By default `--deep` streams one line per /models request on stderr (use `--quiet` to turn off).
 * Add `--verbose` for shallow runs too (per-year /makes lines). Use `stderr` so stdout stays summary-only when piped.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHECK_YMME_BASE | SEED_YMME_BASE_URL (proxy URL)
 */

import process from 'node:process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

function arg(name) {
    const p = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length) : '';
}

const hasFlag = (f) => process.argv.includes(f);

/** Set true at start of `main()` via `useVerbose()`. */
let verboseProgress = false;

/** Live progress on stderr (line-buffered in TTY; avoids silence on long `--deep` runs). */
function progress(msg) {
    if (!verboseProgress) return;
    process.stderr.write(`${msg}\n`);
}

function useVerbose() {
    if (hasFlag('--quiet')) return false;
    return hasFlag('--verbose') || hasFlag('-v') || hasFlag('--deep');
}

const base = (
    arg('base') ||
    process.env.CHECK_YMME_BASE ||
    process.env.SEED_YMME_BASE_URL ||
    'http://localhost:3001'
).replace(/\/$/, '');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const MOTOR_HEADERS = {
    Accept: 'application/json',
    'x-metadata-refresh-bypass': '1'
};

let requestCount = 0;
const MAX_REQUESTS_PER_SESSION = 4800;

async function bumpSessionMaybe() {
    if (requestCount < MAX_REQUESTS_PER_SESSION) return;
    console.warn(`[check-ymme] Session limit (${requestCount}). POST /auth/reset …`);
    try {
        await fetch(`${base}/auth/reset`, { method: 'POST' });
        await delay(10000);
    } catch (e) {
        console.error('[check-ymme] /auth/reset failed:', e?.message || e);
    }
    requestCount = 0;
}

async function fetchJsonMotor(urlPath) {
    await bumpSessionMaybe();
    requestCount++;
    const res = await fetch(`${base}/api${urlPath}`, { headers: MOTOR_HEADERS });
    const text = await res.text();
    if (!res.ok) {
        return { ok: false, status: res.status, body: null, text: text.slice(0, 500) };
    }
    try {
        return { ok: true, status: res.status, body: JSON.parse(text), text: null };
    } catch {
        return { ok: false, status: res.status, body: null, text: text.slice(0, 200) };
    }
}

/** @returns {Promise<Set<string>>} */
async function loadSupabasePaths(supabase, verbose) {
    const paths = new Set();
    let offset = 0;
    const limit = 1000;
    let page = 0;
    while (true) {
        const { data, error } = await supabase.from('vehicle_metadata').select('path').range(offset, offset + limit - 1);
        if (error) throw new Error(`Supabase: ${error.message}`);
        if (!data?.length) break;
        page += 1;
        for (const row of data) {
            if (row.path) paths.add(row.path);
        }
        if (verbose) {
            progress(`[check-ymme] Supabase paths page ${page}: +${data.length} rows (total ${paths.size})`);
        }
        offset += limit;
        if (data.length < limit) break;
    }
    return paths;
}

function isYmmePath(p) {
    if (p === '/years') return true;
    if (/^\/year\/\d+\/makes$/.test(p)) return true;
    if (/^\/year\/\d+\/make\/[^/]+\/models$/.test(p)) return true;
    return false;
}

function normalizeMakeName(entry) {
    return entry.make_name || entry.makeName || '';
}

function fingerprintModelsPayload(payload) {
    const models = payload?.body?.models;
    if (!Array.isArray(models)) return 'empty';
    const rows = models
        .map((m) => {
            const engines = Array.isArray(m.engines)
                ? m.engines.map((e) => `${e.id ?? ''}:${e.name ?? ''}`).sort().join('|')
                : '';
            return `${m.id ?? ''}\t${m.model ?? ''}\t${engines}`;
        })
        .sort();
    return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
}

async function main() {
    const deep = hasFlag('--deep');
    const verifyBodies = hasFlag('--verify-bodies');
    verboseProgress = useVerbose();

    let fromYear = Number(arg('from-year')) || null;
    let toYear = Number(arg('to-year')) || null;

    const urlEnv = process.env.SUPABASE_URL;
    const keyEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!urlEnv || !keyEnv) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    console.log(
        `[check-ymme] base=${base} shallow=${!deep}${deep ? ` verifyBodies=${verifyBodies}` : ''} verbose=${verboseProgress}`
    );

    const supabase = createClient(urlEnv, keyEnv);

    console.log('[check-ymme] Loading Supabase vehicle_metadata paths…');
    const sbPaths = await loadSupabasePaths(supabase, verboseProgress);

    console.log('[check-ymme] Fetching /years from Motor…');
    progress(`[check-ymme] Motor GET /years (bypass cache) …`);
    const yearsRes = await fetchJsonMotor('/years');
    if (!yearsRes.ok || !yearsRes.body?.body) {
        console.error('[check-ymme] /years failed:', yearsRes.status, yearsRes.text);
        process.exit(1);
    }

    let years = Array.isArray(yearsRes.body.body) ? [...yearsRes.body.body] : [];
    years.sort((a, b) => a - b);

    if (fromYear != null) years = years.filter((y) => y >= fromYear);
    if (toYear != null) years = years.filter((y) => y <= toYear);

    const expected = new Set(['/years']);

    console.log(`[check-ymme] Scanning ${years.length} model years (${years[0]}…${years[years.length - 1]})…`);

    const missingMotor = []; // expected path Motor would have but we skip / fail
    const motorModelsFetchFailed = [];

    let yearIndex = 0;
    let modelsDeepCount = 0;

    for (const y of years) {
        yearIndex += 1;
        const makesPath = `/year/${y}/makes`;
        progress(
            `[check-ymme] year ${yearIndex}/${years.length} ${y} GET /makes …`
        );

        const tMakes = Date.now();
        const mRes = await fetchJsonMotor(makesPath);
        const msMakes = Date.now() - tMakes;
        await delay(Number(arg('delay')) || 80);

        if (!mRes.ok || !Array.isArray(mRes.body?.body)) {
            progress(`[check-ymme] year ${y} /makes FAIL ${msMakes}ms HTTP ${mRes.status} ${mRes.text || ''}`);
            missingMotor.push({ path: makesPath, reason: `HTTP ${mRes.status} ${mRes.text || ''}` });
            continue;
        }

        expected.add(makesPath);
        const makesArr = mRes.body.body;
        progress(
            `[check-ymme] year ${y} /makes OK ${msMakes}ms (${makesArr.length} makes)`
        );

        let makeIndex = 0;
        for (const m of makesArr) {
            const makeName = normalizeMakeName(m);
            if (!makeName) continue;
            makeIndex += 1;
            const modelsPath = `/year/${y}/make/${encodeURIComponent(makeName)}/models`;
            expected.add(modelsPath);

            if (deep) {
                modelsDeepCount += 1;
                progress(
                    `[check-ymme] models #${modelsDeepCount} year ${y} make ${makeIndex}/${makesArr.length} ${makeName} GET …`
                );
                const t0 = Date.now();
                const modRes = await fetchJsonMotor(modelsPath);
                const ms = Date.now() - t0;
                await delay(Number(arg('delay')) || 120);
                if (!modRes.ok) {
                    progress(`[check-ymme] models #${modelsDeepCount} FAIL ${ms}ms HTTP ${modRes.status} ${modelsPath}`);
                    motorModelsFetchFailed.push({ path: modelsPath, status: modRes.status, detail: modRes.text });
                    continue;
                }
                const nModels = Array.isArray(modRes.body?.body?.models) ? modRes.body.body.models.length : 0;
                progress(`[check-ymme] models #${modelsDeepCount} OK ${ms}ms ${nModels} trims ${modelsPath}`);
                if (verifyBodies && sbPaths.has(modelsPath)) {
                    const { data: row } = await supabase
                        .from('vehicle_metadata')
                        .select('data')
                        .eq('path', modelsPath)
                        .maybeSingle();
                    const hMotor = fingerprintModelsPayload(modRes.body);
                    const hSb = fingerprintModelsPayload(row?.data);
                    if (hMotor !== hSb) {
                        progress(`[check-ymme] models #${modelsDeepCount} FINGERPRINT MISMATCH ${modelsPath}`);
                        motorModelsFetchFailed.push({
                            path: modelsPath,
                            reason: `body fingerprint mismatch motor=${hMotor.slice(0, 12)}… sb=${hSb.slice(0, 12)}…`
                        });
                    }
                }
            }
        }
    }

    const missingInSb = [...expected].filter((p) => !sbPaths.has(p)).sort();
    const extraYmmeInSb = [...sbPaths].filter((p) => isYmmePath(p) && !expected.has(p)).sort();

    console.log('');
    console.log(`[check-ymme] Expected YMME paths (from Motor): ${expected.size}`);
    console.log(`[check-ymme] Supabase total rows: ${sbPaths.size}`);
    console.log(`[check-ymme] Missing in Supabase: ${missingInSb.length}`);
    console.log(`[check-ymme] Extra YMME paths in SB (not in current Motor walk): ${extraYmmeInSb.length}`);
    if (deep) console.log(`[check-ymme] Motor /models fetch failures / mismatches: ${motorModelsFetchFailed.length}`);

    if (missingMotor.length) {
        console.warn(`\n[check-ymme] WARN: Motor /makes unavailable for ${missingMotor.length} year(s) (partial Motor walk)`);
        for (const row of missingMotor.slice(0, 8)) console.warn(`  ${row.path} ${row.reason}`);
        if (missingMotor.length > 8) console.warn(`  … +${missingMotor.length - 8} more`);
    }

    if (missingInSb.length) {
        console.error('\n[check-ymme] FAIL — Missing in Supabase (sample):');
        for (const p of missingInSb.slice(0, 40)) console.error(`  ${p}`);
        if (missingInSb.length > 40) console.error(`  … +${missingInSb.length - 40} more`);
    }

    if (extraYmmeInSb.length && hasFlag('--warn-extra')) {
        console.warn('\n[check-ymme] Extra paths in SB (sample):');
        for (const p of extraYmmeInSb.slice(0, 20)) console.warn(`  ${p}`);
        if (extraYmmeInSb.length > 20) console.warn(`  … +${extraYmmeInSb.length - 20} more`);
    }

    if (deep && motorModelsFetchFailed.length) {
        console.error('\n[check-ymme] FAIL — Deep check issues (sample):');
        for (const row of motorModelsFetchFailed.slice(0, 30)) console.error(`  ${row.path}`, row.status || row.reason || '');
        if (motorModelsFetchFailed.length > 30) console.error(`  … +${motorModelsFetchFailed.length - 30} more`);
    }

    const fail =
        missingInSb.length > 0 ||
        missingMotor.length > 0 ||
        (deep && motorModelsFetchFailed.length > 0);

    console.log(fail ? '\n[check-ymme] OUTCOME: FAIL' : '\n[check-ymme] OUTCOME: OK');
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
