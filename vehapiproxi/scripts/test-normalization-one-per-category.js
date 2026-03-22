#!/usr/bin/env node
/**
 * Test normalization: clear one vehicle from Supabase, then trigger normalization
 * for exactly ONE article per category (bucket). Does not run multiple articles
 * per category to avoid flooding the API.
 *
 * Requires:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 *   - PROXY_URL (default http://localhost:3000) — proxy must be running and able to reach Motor API
 *   - VEHICLE_ID (e.g. 2854 or 2013:Ford:Explorer), CONTENT_SOURCE (default MOTOR)
 *
 * Run from repo root:
 *   VEHICLE_ID=2854 node vehapiproxi/scripts/test-normalization-one-per-category.js
 *
 * Or from vehapiproxi with .env:
 *   node scripts/test-normalization-one-per-category.js
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROXY_URL = (process.env.PROXY_URL || 'http://localhost:3000').replace(/\/$/, '');
const CONTENT_SOURCE = process.env.CONTENT_SOURCE || 'MOTOR';
const VEHICLE_ID = process.env.VEHICLE_ID;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}
if (!VEHICLE_ID) {
    console.error('Set VEHICLE_ID (e.g. 2854 or 2013:Ford:Explorer). Example: VEHICLE_ID=2854 node vehapiproxi/scripts/test-normalization-one-per-category.js');
    process.exit(1);
}

const headers = (extra = {}) => ({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
});

async function supabaseDelete(table, filter) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
    const res = await fetch(url, { method: 'DELETE', headers: headers() });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${table} DELETE ${res.status}: ${text}`);
    }
    const range = res.headers.get('content-range');
    return range ? range.split('/')[1] : '0';
}

async function supabaseGet(table, filter) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=id`;
    const res = await fetch(url, { method: 'GET', headers: headers() });
    if (!res.ok) throw new Error(`${table} GET ${res.status}`);
    return res.json();
}

async function clearVehicleFromSupabase(vehicleId) {
    const enc = encodeURIComponent(vehicleId);
    const tables = [
        'common_issues_cache',
        'maintenance_schedules',
        'parts',
        'specifications',
        'dtcs',
        'tsbs',
        'procedures',
        'articles'
    ];
    for (const table of tables) {
        const n = await supabaseDelete(table, `vehicle_id=eq.${enc}`);
        console.log(`  Deleted ${table}: ${n} row(s)`);
    }
    // ai_processing_logs has source_file (URL path), not vehicle_id — delete rows whose path contains this vehicle
    const allLogsUrl = `${SUPABASE_URL}/rest/v1/ai_processing_logs?select=id,source_file`;
    const logsRes = await fetch(allLogsUrl, { method: 'GET', headers: headers() });
    if (logsRes.ok) {
        const allLogs = await logsRes.json();
        const vehicleEnc = vehicleId.replace(/:/g, '%3A');
        const toDelete = Array.isArray(allLogs) ? allLogs.filter(l => (l.source_file || '').includes(vehicleId) || (l.source_file || '').includes(vehicleEnc)) : [];
        for (const row of toDelete) {
            await supabaseDelete('ai_processing_logs', `id=eq.${row.id}`);
        }
        console.log(`  Deleted ai_processing_logs: ${toDelete.length} row(s)`);
    } else {
        console.log('  ai_processing_logs: skip (GET failed)');
    }
    // Remove vehicle row so we start fresh; it will be re-created when articles/v2 is cached
    await supabaseDelete('vehicles', `external_id=eq.${enc}`);
    console.log('  Deleted vehicles row');
}

async function ensureVehicleRow(vehicleId, vehicleName = '') {
    const parts = String(vehicleName).trim().split(/\s+/).filter(Boolean);
    const year = parseInt(parts[0], 10) || 0;
    const make = parts[1] || '';
    const model = parts.slice(2).join(' ') || '';
    const url = `${SUPABASE_URL}/rest/v1/vehicles?on_conflict=external_id`;
    const res = await fetch(url, {
        method: 'POST',
        headers: headers({ Prefer: 'return=minimal,resolution=merge-duplicates' }),
        body: JSON.stringify({
            external_id: vehicleId,
            content_source: CONTENT_SOURCE,
            year,
            make,
            model,
            updated_at: new Date().toISOString()
        })
    });
    if (!res.ok) throw new Error(`vehicles upsert ${res.status}: ${await res.text()}`);
}

async function fetchArticlesCatalog() {
    const url = `${PROXY_URL}/api/source/${CONTENT_SOURCE}/vehicle/${encodeURIComponent(VEHICLE_ID)}/articles/v2`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`articles/v2 ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const details = data?.body?.articleDetails || data?.articleDetails || [];
    return details;
}

/** Pick one article per bucket (parent_bucket + bucket) so we don't flood the API. */
function oneArticlePerBucket(articleDetails) {
    const byBucket = new Map();
    for (const a of articleDetails) {
        const bucket = [a.parentBucket || '', a.bucket || ''].filter(Boolean).join(' | ') || 'Uncategorized';
        if (!byBucket.has(bucket)) {
            byBucket.set(bucket, { id: a.id, title: a.title, bucket: a.bucket, parentBucket: a.parentBucket });
        }
    }
    return Array.from(byBucket.values());
}

async function fetchArticleHtml(articleId) {
    const url = `${PROXY_URL}/api/source/${CONTENT_SOURCE}/vehicle/${encodeURIComponent(VEHICLE_ID)}/article/${encodeURIComponent(articleId)}/html`;
    const res = await fetch(url, { headers: { Accept: 'text/html,application/json' } });
    if (!res.ok) throw new Error(`article/html ${res.status}: ${await res.text()}`);
    return res.text();
}

async function countVehicleRows(vehicleId) {
    const enc = encodeURIComponent(vehicleId);
    const tables = ['articles', 'procedures', 'tsbs', 'dtcs', 'specifications'];
    const counts = {};
    for (const table of tables) {
        const url = `${SUPABASE_URL}/rest/v1/${table}?vehicle_id=eq.${enc}&select=id`;
        const res = await fetch(url, { method: 'GET', headers: headers({ Prefer: 'count=exact' }) });
        const range = res.headers.get('content-range');
        counts[table] = range ? parseInt(range.split('/')[1], 10) || 0 : (res.ok ? (await res.json()).length : -1);
    }
    return counts;
}

async function main() {
    console.log('--- Test: one article per category normalization ---');
    console.log(`Vehicle: ${VEHICLE_ID}, Source: ${CONTENT_SOURCE}, Proxy: ${PROXY_URL}\n`);

    console.log('1. Clearing vehicle from Supabase...');
    await clearVehicleFromSupabase(VEHICLE_ID);

    console.log('\n2. Ensuring vehicle row exists (required for FK when catalog is cached)...');
    await ensureVehicleRow(VEHICLE_ID);

    console.log('3. Fetching articles catalog (articles/v2)...');
    const articleDetails = await fetchArticlesCatalog();
    console.log(`   Total articles in catalog: ${articleDetails.length}`);

    const onePerBucket = oneArticlePerBucket(articleDetails);
    console.log(`   Unique buckets: ${onePerBucket.length}. Will request 1 article per bucket (${onePerBucket.length} requests).\n`);

    console.log('4. Requesting article HTML for one article per bucket (triggers proxy → background normalization)...');
    const delayMs = 3500;
    for (let i = 0; i < onePerBucket.length; i++) {
        const a = onePerBucket[i];
        const bucketLabel = [a.parentBucket, a.bucket].filter(Boolean).join(' / ') || 'Uncategorized';
        try {
            await fetchArticleHtml(a.id);
            console.log(`   [${i + 1}/${onePerBucket.length}] ${bucketLabel} → article ${a.id} (${(a.title || '').slice(0, 40)}...)`);
        } catch (e) {
            console.warn(`   [${i + 1}/${onePerBucket.length}] ${bucketLabel} → article ${a.id} FAILED: ${e.message}`);
        }
        if (i < onePerBucket.length - 1) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    console.log('\n5. Waiting 35s for background normalization jobs...');
    await new Promise(r => setTimeout(r, 35000));

    console.log('6. Row counts for this vehicle in Supabase:');
    const counts = await countVehicleRows(VEHICLE_ID);
    for (const [table, n] of Object.entries(counts)) {
        console.log(`   ${table}: ${n}`);
    }
    console.log('\nDone.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
