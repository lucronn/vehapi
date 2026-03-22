#!/usr/bin/env node
/**
 * Apply additive L1 spec_fact DDL.
 * File: documentation/migrations/20260320_l1_spec_fact.sql
 *
 *   cd vehapiproxi && npm run migrate:l1-spec-fact
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

let SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL || !SUPABASE_DB_URL.startsWith('postgres')) {
    const SUPABASE_URL = process.env.SUPABASE_URL || '';
    const SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
    const match = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match && SUPABASE_DB_PASSWORD) {
        const projectRef = match[1];
        SUPABASE_DB_URL = `postgresql://postgres:${encodeURIComponent(SUPABASE_DB_PASSWORD)}@db.${projectRef}.supabase.co:5432/postgres`;
    }
}

if (!SUPABASE_DB_URL || !SUPABASE_DB_URL.startsWith('postgres')) {
    console.error('Missing Postgres URL. Set SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD.');
    process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const sqlPath = path.join(repoRoot, 'documentation', 'migrations', '20260320_l1_spec_fact.sql');
if (!fs.existsSync(sqlPath)) {
    console.error('Migration file not found:', sqlPath);
    process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

async function run() {
    const client = new pg.Client({
        connectionString: SUPABASE_DB_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        await client.connect();
        console.log('Applying L1 spec_fact migration (additive)...');
        await client.query(sql);
        console.log('L1 spec_fact migration completed.');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
