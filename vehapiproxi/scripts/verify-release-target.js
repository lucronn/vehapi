#!/usr/bin/env node
/**
 * Verify target DB state for release readiness.
 *
 * Checks:
 * - required additive normalization/L2 tables exist
 * - pgvector extension exists
 * - match_content_chunks RPC exists and service_role can execute it
 * - broad "Allow all ..." policies are absent on server-only tables
 *
 * Usage:
 *   cd vehapiproxi && npm run verify:release-target
 */
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

function resolveDbUrl() {
    let dbUrl = process.env.SUPABASE_DB_URL;
    if (dbUrl && dbUrl.startsWith('postgres')) {
        return dbUrl;
    }

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_PASS;
    const match = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match && dbPassword) {
        const projectRef = match[1];
        return `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`;
    }

    return '';
}

const dbUrl = resolveDbUrl();
if (!dbUrl) {
    console.error('Missing Postgres URL. Set SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD.');
    process.exit(1);
}

const requiredTables = [
    'content_item',
    'spec_fact',
    'maintenance_task',
    'procedure_step',
    'procedure_tool',
    'procedure_part',
    'diagram_document',
    'component_location_document',
    'labor_operation',
    'media_asset',
    'content_chunk'
];

const serverOnlyTables = [
    'evidence_ingest',
    'evidence_link',
    'ai_processing_logs',
    'failed_extractions',
    'common_issues_cache',
    'diagram_document',
    'component_location_document',
    'labor_operation',
    'media_asset',
    'content_chunk'
];

function printResult(ok, label, details = '') {
    const icon = ok ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${label}${details ? ` - ${details}` : ''}`);
}

async function queryValue(client, sql, params = []) {
    const res = await client.query(sql, params);
    return res.rows[0];
}

async function main() {
    const client = new pg.Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    const failures = [];

    try {
        await client.connect();

        const dbRow = await queryValue(
            client,
            `select current_database() as db, current_user as user, current_schema() as schema`
        );
        console.log(`Target DB: ${dbRow.db} (user=${dbRow.user}, schema=${dbRow.schema})`);

        const vectorRow = await queryValue(
            client,
            `select exists (select 1 from pg_extension where extname = 'vector') as ok`
        );
        printResult(vectorRow.ok, 'pgvector extension installed');
        if (!vectorRow.ok) failures.push('pgvector extension missing');

        for (const table of requiredTables) {
            const row = await queryValue(
                client,
                `select exists (
                    select 1
                    from information_schema.tables
                    where table_schema = 'public' and table_name = $1
                ) as ok`,
                [table]
            );
            printResult(row.ok, `table public.${table} exists`);
            if (!row.ok) failures.push(`missing table: ${table}`);
        }

        const rpcRow = await queryValue(
            client,
            `select
                to_regprocedure('public.match_content_chunks(vector(1024), text, integer)') is not null as exists,
                coalesce(
                    case
                        when to_regprocedure('public.match_content_chunks(vector(1024), text, integer)') is not null
                        then has_function_privilege(
                            'service_role',
                            'public.match_content_chunks(vector(1024), text, integer)',
                            'EXECUTE'
                        )
                        else false
                    end,
                    false
                ) as service_role_can_execute`
        );
        printResult(rpcRow.exists, 'RPC public.match_content_chunks exists');
        if (!rpcRow.exists) failures.push('missing RPC: match_content_chunks');
        printResult(
            rpcRow.service_role_can_execute,
            'service_role can execute public.match_content_chunks'
        );
        if (!rpcRow.service_role_can_execute) {
            failures.push('service_role missing EXECUTE on match_content_chunks');
        }

        for (const table of serverOnlyTables) {
            const row = await queryValue(
                client,
                `select count(*)::int as count
                 from pg_policies
                 where schemaname = 'public'
                   and tablename = $1
                   and policyname ilike 'Allow all %'`,
                [table]
            );
            const ok = row.count === 0;
            printResult(ok, `no broad "Allow all" policy remains on public.${table}`, `count=${row.count}`);
            if (!ok) failures.push(`broad RLS policy still present on ${table}`);
        }

        if (failures.length > 0) {
            console.error('\nRelease target verification failed:');
            for (const failure of failures) {
                console.error(`- ${failure}`);
            }
            process.exit(1);
        }

        console.log('\nRelease target verification passed.');
    } catch (err) {
        console.error(err?.stack || err?.message || String(err));
        process.exit(1);
    } finally {
        await client.end().catch(() => {});
    }
}

main();
