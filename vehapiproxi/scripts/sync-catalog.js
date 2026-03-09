import fetch from 'node-fetch';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import fs from 'fs';

// Load env vars
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use our own proxy to fetch data so it handles proxy auth + caching logic built-in
// or we can hit the motor API directly if we have a valid cookie.
// Given this runs locally or alongside the proxy, we'll hit our own proxy endpoints
// so that the proxy handles inserting into Supabase!

const PROXY_URL = 'http://localhost:3000'; // Make sure the proxy is running!
// We need to pass the proxy debug key if we are bypassing auth, but our caching endpoints
// currently require `authMiddleware`.
// To make this simple, we'll actually just script hitting the Motor API and inserting via Supabase REST directly here.

const MOTOR_API_BASE = 'https://api.motor.com/m1'; // Replace with actual base if different, currently from config.motorApiBase

// IMPORTANT: You MUST get a valid cookie from your browser session to the Motor API
const MOTOR_COOKIE = process.env.MOTOR_COOKIE || '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY');
    process.exit(1);
}

if (!MOTOR_COOKIE) {
    console.error('Missing MOTOR_COOKIE in environment variables. Run with MOTOR_COOKIE="..." node scripts/sync-catalog.js');
    process.exit(1);
}

const limit = pLimit(5); // Process up to 5 concurrent requests to Motor API

async function motorFetch(path) {
    const url = `${MOTOR_API_BASE}${path}`;
    const res = await fetch(url, {
        headers: {
            'Cookie': MOTOR_COOKIE,
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
            'Origin': 'https://sites.motor.com',
            'Referer': 'https://sites.motor.com/m1/'
        }
    });

    if (!res.ok) {
        throw new Error(`Motor API returned ${res.status} for ${path}`);
    }

    const data = await res.json();
    return data.body || data;
}

async function supabaseQuery(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,resolution=merge-duplicates'
        }
    };
    if (body) {
        opts.body = JSON.stringify(body);
        if (method === 'POST') {
            // Return minimal on bulk insert to save bandwidth
            opts.headers['Prefer'] = 'return=minimal,resolution=merge-duplicates';
        }
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Supabase returned ${res.status} for ${path}: ${errText}`);
    }

    if (method === 'GET' || opts.headers['Prefer'].includes('return=representation')) {
        return await res.json();
    }
    return null;
}

async function syncYears() {
    console.log('Fetching Years from Motor API...');
    const years = await motorFetch('/api/years');

    if (!years || years.length === 0) {
        throw new Error('No years returned from Motor API');
    }

    console.log(`Found ${years.length} years. Upserting to Supabase...`);
    const payload = years.map(y => ({ year: y.year }));
    await supabaseQuery('vehicle_years', 'POST', payload);
    return years.map(y => y.year);
}

async function syncMakesForYear(year) {
    try {
        console.log(`[${year}] Fetching makes...`);
        const makes = await motorFetch(`/api/year/${year}/makes`);

        if (!makes || makes.length === 0) {
            console.log(`[${year}] No makes found.`);
            return [];
        }

        const payload = makes.map(m => ({
            year: year,
            make_name: m.makeName,
            make_id: m.makeId || null
        }));

        await supabaseQuery('vehicle_makes', 'POST', payload);

        // Fetch back from DB to get the auto-incremented IDs to link models
        const savedMakes = await supabaseQuery(`vehicle_makes?year=eq.${year}&select=id,make_name`);
        return savedMakes;
    } catch (err) {
        console.error(`[${year}] Error fetching makes:`, err.message);
        return [];
    }
}

async function syncModelsForMake(year, makeObj) {
    try {
        console.log(`[${year} - ${makeObj.make_name}] Fetching models...`);
        const models = await motorFetch(`/api/year/${year}/make/${encodeURIComponent(makeObj.make_name)}/models`);

        if (!models || models.length === 0) {
            return;
        }

        const payload = models.map(m => ({
            make_id: makeObj.id,
            model_name: m.modelName,
            model_id: m.modelId || null
        }));

        await supabaseQuery('vehicle_models', 'POST', payload);
    } catch (err) {
        console.error(`[${year} - ${makeObj.make_name}] Error fetching models:`, err.message);
    }
}

async function runSync() {
    try {
        console.log('Starting full catalog sync...');

        const years = await syncYears();

        for (const year of years) {
            const makes = await limit(() => syncMakesForYear(year));

            if (!makes || makes.length === 0) continue;

            const modelPromises = makes.map(make => limit(() => syncModelsForMake(year, make)));
            await Promise.all(modelPromises);
        }

        console.log('✅ Full catalog sync complete.');
    } catch (err) {
        console.error('❌ Sync failed:', err);
    }
}

runSync();
