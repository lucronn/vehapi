#!/usr/bin/env node
/**
 * Compare vehicle_metadata.models (Supabase) vs live Motor response for a few year/makes.
 * Motor is fetched via vehapiproxi with x-metadata-refresh-bypass: 1 so we hit upstream Motor, not SB cache.
 *
 * Usage: cd vehapiproxi && node scripts/compare-ymme-supabase-vs-motor.js
 * Env: SUPABASE_* (same as seed), COMPARE_YMME_BASE (default https://vehapi.vercel.app)
 */
import process from 'node:process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

const base = (process.env.COMPARE_YMME_BASE || 'https://vehapi.vercel.app').replace(/\/$/, '');

/** @type {Array<{ year: number, make: string }>} */
const SAMPLES = [
    { year: 2015, make: 'Toyota' },
    { year: 2020, make: 'Ford' },
    { year: 2018, make: 'BMW' },
    { year: 2012, make: 'Honda' },
    { year: 2007, make: 'Chevrolet' }
];

function ymmePath(year, make) {
    return `/year/${year}/make/${encodeURIComponent(make)}/models`;
}

/** Stable representation for diff (model ids + trims + engines). */
function extractModels(payload) {
    const models = payload?.body?.models;
    if (!Array.isArray(models)) return [];
    return models
        .map((m) => {
            const engines = Array.isArray(m.engines)
                ? [...m.engines].map((e) => ({
                      id: String(e.id ?? ''),
                      name: String(e.name ?? '')
                  }))
                : [];
            engines.sort((a, b) => a.id.localeCompare(b.id));
            return {
                id: String(m.id ?? ''),
                model: String(m.model ?? ''),
                engines
            };
        })
        .sort((a, b) => a.id.localeCompare(b.id));
}

function onlyIds(list) {
    return new Set(list.map((x) => x.id));
}

function describeDiff(sb, motor) {
    const sIds = onlyIds(sb);
    const mIds = onlyIds(motor);
    const onlySb = [...sIds].filter((id) => !mIds.has(id)).sort();
    const onlyMotor = [...mIds].filter((id) => !sIds.has(id)).sort();

    /** @type {Array<{ id: string, issue: string }>} */
    const engineMismatches = [];
    const sbMap = Object.fromEntries(sb.map((x) => [x.id, x]));
    const mMap = Object.fromEntries(motor.map((x) => [x.id, x]));

    for (const id of [...sIds].filter((id) => mIds.has(id))) {
        const a = sbMap[id];
        const b = mMap[id];
        const ae = JSON.stringify(a.engines);
        const be = JSON.stringify(b.engines);
        if (ae !== be) {
            engineMismatches.push({ id, issue: 'engines differ' });
        }
        if ((a.model || '') !== (b.model || '')) {
            engineMismatches.push({ id, issue: `trim name differs: "${a.model}" vs "${b.model}"` });
        }
    }

    return { onlySb, onlyMotor, engineMismatches };
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient(url, key);
    console.log(`base=${base} (Motor via proxy with cache bypass)`);
    console.log('');

    for (const { year, make } of SAMPLES) {
        const canonicalPath = ymmePath(year, make);
        const apiUrl = `${base}/api${canonicalPath}`;

        const { data: row, error: sbErr } = await supabase
            .from('vehicle_metadata')
            .select('path,data,updated_at')
            .eq('path', canonicalPath)
            .maybeSingle();

        if (sbErr) {
            console.error(`[Supabase error] ${canonicalPath}:`, sbErr.message);
            continue;
        }

        let motorJson = null;
        let motorErr = null;
        try {
            const res = await fetch(apiUrl, {
                headers: {
                    Accept: 'application/json',
                    'x-metadata-refresh-bypass': '1'
                }
            });
            if (!res.ok) {
                motorErr = `HTTP ${res.status} ${await res.text().catch(() => '')}`;
            } else {
                motorJson = await res.json();
            }
        } catch (e) {
            motorErr = e?.message || String(e);
        }

        const sbModels = extractModels(row?.data);
        const mModels = motorJson ? extractModels(motorJson) : [];

        console.log(`--- ${year} ${make} ---`);
        console.log(`path: ${canonicalPath}`);
        if (!row?.data) console.log('Supabase row: MISSING');
        else console.log(`Supabase: ${sbModels.length} models (stored path: ${row.path})`);

        if (motorErr) {
            console.log(`Motor (live): ERROR ${motorErr}`);
        } else {
            console.log(`Motor (live): ${mModels.length} models (x-data-source: ${motorJson?.header ? 'upstream' : '?'})`);
        }

        if (!motorJson || !row?.data) {
            console.log('');
            continue;
        }

        const { onlySb, onlyMotor, engineMismatches } = describeDiff(sbModels, mModels);
        const match =
            onlySb.length === 0 &&
            onlyMotor.length === 0 &&
            engineMismatches.length === 0;

        console.log(match ? 'Match: catalogs align (same model ids + engines).' : 'Differences detected:');

        if (onlySb.length) console.log(`  Only in Supabase (${onlySb.length}):`, onlySb.slice(0, 15).join(', ') + (onlySb.length > 15 ? '…' : ''));
        if (onlyMotor.length)
            console.log(`  Only in Motor (${onlyMotor.length}):`, onlyMotor.slice(0, 15).join(', ') + (onlyMotor.length > 15 ? '…' : ''));
        if (engineMismatches.length)
            console.log(`  Detail mismatches (${engineMismatches.length}):`, engineMismatches.slice(0, 10));

        console.log('');
    }

    console.log('Done.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
