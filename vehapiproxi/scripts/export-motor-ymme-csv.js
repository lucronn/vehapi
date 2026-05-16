#!/usr/bin/env node
/**
 * Stream Motor YMME catalog to a CSV file as each /models response is fetched (via vehapiproxi
 * with cache bypass so rows reflect live Motor, not Supabase cache).
 *
 * One row per trim + engine. Models with no engines still emit one row with empty engine fields.
 *
 * Usage:
 *   cd vehapiproxi && node scripts/export-motor-ymme-csv.js --out=motor-ymme.csv
 *   node scripts/export-motor-ymme-csv.js --base=https://vehapi.vercel.app --out=/tmp/motor-ymme.csv
 *   node scripts/export-motor-ymme-csv.js --from-year=2015 --to-year=2020 --quiet
 *
 * Env: SEED_YMME_BASE_URL | EXPORT_YMME_BASE (proxy URL, default http://localhost:3001)
 */

import process from 'node:process';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config();

function arg(name) {
    const p = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length) : '';
}

const hasFlag = (f) => process.argv.includes(f);

const base = (
    arg('base') ||
    process.env.EXPORT_YMME_BASE ||
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

function progress(msg) {
    if (!hasFlag('--quiet')) {
        process.stderr.write(`${msg}\n`);
    }
}

async function bumpSessionMaybe() {
    if (requestCount < MAX_REQUESTS_PER_SESSION) return;
    progress(`[export-ymme-csv] Session limit (${requestCount}); POST /auth/reset …`);
    try {
        await fetch(`${base}/auth/reset`, { method: 'POST' });
        await delay(10000);
    } catch (e) {
        console.error('[export-ymme-csv] /auth/reset failed:', e?.message || e);
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

function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function writeLine(stream, cells) {
    return new Promise((resolve, reject) => {
        stream.write(cells.map(csvEscape).join(',') + '\n', (err) => (err ? reject(err) : resolve()));
    });
}

function normalizeMakeName(entry) {
    return entry.make_name || entry.makeName || '';
}

async function main() {
    const outPath = arg('out') || 'motor-ymme.csv';
    const fromYear = Number(arg('from-year')) || null;
    const toYear = Number(arg('to-year')) || null;

    const stream = createWriteStream(outPath, { flags: 'w' });

    const header = [
        'year',
        'make',
        'model_id',
        'model_name',
        'engine_id',
        'engine_name',
        'content_source',
        'motor_models_path'
    ];
    await writeLine(stream, header);

    progress(`[export-ymme-csv] base=${base} out=${path.resolve(outPath)}`);

    const yearsRes = await fetchJsonMotor('/years');
    if (!yearsRes.ok || !Array.isArray(yearsRes.body?.body)) {
        console.error('[export-ymme-csv] /years failed:', yearsRes.status, yearsRes.text);
        stream.end();
        process.exit(1);
    }

    let years = [...yearsRes.body.body].sort((a, b) => a - b);
    if (fromYear != null) years = years.filter((y) => y >= fromYear);
    if (toYear != null) years = years.filter((y) => y <= toYear);

    let rowCount = 0;
    let modelsOk = 0;
    let modelsFail = 0;

    let yi = 0;
    for (const y of years) {
        yi += 1;
        const makesPath = `/year/${y}/makes`;
        progress(`[export-ymme-csv] year ${yi}/${years.length} ${y} GET /makes …`);

        const mRes = await fetchJsonMotor(makesPath);
        await delay(Number(arg('delay')) || 80);

        if (!mRes.ok || !Array.isArray(mRes.body?.body)) {
            progress(`[export-ymme-csv] FAIL ${makesPath} HTTP ${mRes.status}`);
            continue;
        }

        const makesArr = mRes.body.body;
        let mi = 0;
        for (const mk of makesArr) {
            const makeName = normalizeMakeName(mk);
            if (!makeName) continue;
            mi += 1;
            const modelsPath = `/year/${y}/make/${encodeURIComponent(makeName)}/models`;
            progress(`[export-ymme-csv] GET ${modelsPath} (${mi}/${makesArr.length} makes)`);

            const modRes = await fetchJsonMotor(modelsPath);
            await delay(Number(arg('delay')) || 120);

            if (!modRes.ok) {
                modelsFail++;
                progress(`[export-ymme-csv] FAIL ${modelsPath} HTTP ${modRes.status}`);
                continue;
            }

            modelsOk++;
            const body = modRes.body?.body;
            const cs = body?.contentSource ?? body?.content_source ?? '';

            const models = Array.isArray(body?.models) ? body.models : [];
            if (models.length === 0) {
                await writeLine(stream, [y, makeName, '', '', '', '', cs, modelsPath]);
                rowCount++;
            } else {
                for (const m of models) {
                    const mid = m.id != null ? String(m.id) : '';
                    const mname = m.model != null ? String(m.model) : '';
                    const engines = Array.isArray(m.engines) ? m.engines : [];
                    if (engines.length === 0) {
                        await writeLine(stream, [y, makeName, mid, mname, '', '', cs, modelsPath]);
                        rowCount++;
                    } else {
                        for (const e of engines) {
                            const eid = e.id != null ? String(e.id) : '';
                            const ename = e.name != null ? String(e.name) : '';
                            await writeLine(stream, [y, makeName, mid, mname, eid, ename, cs, modelsPath]);
                            rowCount++;
                        }
                    }
                }
            }
        }
    }

    await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())));

    progress(
        `[export-ymme-csv] done rows=${rowCount} modelsEndpointsOk=${modelsOk} modelsEndpointsFail=${modelsFail} → ${path.resolve(outPath)}`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
