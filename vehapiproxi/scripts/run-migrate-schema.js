#!/usr/bin/env node
/**
 * Run Supabase schema migration (wipe + recreate vehicle/content tables).
 *
 * Requires a direct Postgres connection string — the service role key alone
 * cannot run raw SQL. Use the Database connection URI from Supabase:
 *
 *   1. Dashboard → Project Settings → Database
 *   2. Under "Connection string" choose "URI"
 *   3. Copy the URI and replace [YOUR-PASSWORD] with your database password
 *   4. Set SUPABASE_DB_URL in .env (or pass as env when running)
 *
 * Run from repo root:
 *   node vehapiproxi/scripts/run-migrate-schema.js
 *
 * Or from vehapiproxi with .env present:
 *   node scripts/run-migrate-schema.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from vehapiproxi or repo root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

let SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

// Fallback: build direct connection from SUPABASE_URL + SUPABASE_DB_PASSWORD (avoids pooler "Tenant or user not found")
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
    console.error(`
Missing or invalid database connection.

Use either:

  A) SUPABASE_DB_URL (full Postgres URI)
     1. Dashboard → Project Settings → Database → Connection string → URI
     2. Copy and replace [YOUR-PASSWORD]. Use "Direct connection" (port 5432) to avoid pooler issues.
     3. In .env: SUPABASE_DB_URL="postgresql://..."

  B) SUPABASE_URL + SUPABASE_DB_PASSWORD (script builds direct connection)
     You already have SUPABASE_URL in .env. Add:
     SUPABASE_DB_PASSWORD=your_database_password
     (Dashboard → Project Settings → Database → Database password)

Then run: node vehapiproxi/scripts/run-migrate-schema.js
`);
    process.exit(1);
}

// Schema file at repo root
const repoRoot = path.resolve(__dirname, '..', '..');
const schemaPath = path.join(repoRoot, 'supabase_schema.sql');

if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    process.exit(1);
}

const sql = fs.readFileSync(schemaPath, 'utf8');

async function run() {
    const client = new pg.Client({
        connectionString: SUPABASE_DB_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        await client.connect();
        console.log('Connected to Supabase Postgres.');
        console.log('Running migration (drop + create vehicle/content tables)...');
        await client.query(sql);
        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
