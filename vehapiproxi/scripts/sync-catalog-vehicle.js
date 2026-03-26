#!/usr/bin/env node
/**
 * Trigger catalog sync for one vehicle: GET articles/v2 with torqueCatalogSync=1.
 * Requires vehapiproxi running (e.g. node src/index.js) so Motor session + background_worker apply.
 *
 * Usage:
 *   node scripts/sync-catalog-vehicle.js --vehicle=81596:10217 --source=GeneralMotors
 *   node scripts/sync-catalog-vehicle.js --vehicle=... --source=... --base=https://api.example.com
 *
 * Env: SYNC_BASE_URL (default http://localhost:3001), SYNC_AUTH_BEARER (optional JWT)
 */
import process from 'node:process';

function arg(name) {
    const p = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(p));
    return hit ? hit.slice(p.length) : process.env[`SYNC_${name.toUpperCase()}`] || '';
}

const vehicle = arg('vehicle') || process.env.SYNC_VEHICLE_ID;
const source = arg('source') || process.env.SYNC_CONTENT_SOURCE || 'GeneralMotors';
const base = (arg('base') || process.env.SYNC_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const token = arg('token') || process.env.SYNC_AUTH_BEARER || '';

if (!vehicle) {
    console.error('Missing --vehicle=ID (e.g. 81596:10217)');
    process.exit(1);
}

const path = `/api/source/${encodeURIComponent(source)}/vehicle/${encodeURIComponent(vehicle)}/articles/v2?torqueCatalogSync=1`;
const url = `${base}${path}`;

const headers = {
    Accept: 'application/json',
    'X-Vehapi-Verify': '1'
};
if (token) headers.Authorization = `Bearer ${token}`;

let res;
let text;
try {
    res = await fetch(url, { headers });
    text = await res.text();
} catch (e) {
    console.error(`Fetch failed (${e.cause?.code || e.message}). Is vehapiproxi listening on ${base}?`);
    console.error(`  cd vehapiproxi && npm start`);
    process.exit(1);
}
if (!res.ok) {
    console.error(`HTTP ${res.status} ${url}\n${text.slice(0, 2000)}`);
    process.exit(1);
}
let body;
try {
    body = JSON.parse(text);
} catch {
    console.error('Response was not JSON:', text.slice(0, 500));
    process.exit(1);
}
const n = body?.body?.articleDetails?.length ?? 0;
console.log(`OK ${res.status} — catalog articles in response: ${n}`);
console.log('Background worker should upsert articles + content_item; watch proxy logs if counts stay 0.');
