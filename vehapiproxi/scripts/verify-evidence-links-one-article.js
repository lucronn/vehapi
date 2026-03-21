#!/usr/bin/env node
/**
 * Verifies phase-1 traceability for one article:
 * - content_item enrichment fields are updated from parsed content
 * - evidence_ingest row exists for the article payload
 * - evidence_link rows connect that evidence to normalized entities
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PROXY_URL (default https://vehapiproxi.vercel.app — production API; override for local proxy)
 *   VEHICLE_ID (required) — or pass --vehicle=2854 (recommended; npm may not forward VAR=value)
 *   CONTENT_SOURCE (required in practice; default MOTOR) — or --source=GeneralMotors
 *   ARTICLE_ID (optional; if not set, picks first article from catalog) — or --article=...
 *   PROXY_URL — or --proxy=http://localhost:3000
 *   AUTH_TOKEN (optional) — bearer token for protected article HTML routes on deployed proxy
 */
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/**
 * npm run often does not forward `VAR=value` into the Node child; prefer
 * `npm run verify:evidence-links -- --vehicle=2854` or `export VEHICLE_ID=2854` first.
 */
function parseCliArgs(argv) {
    const out = { vehicle: '', article: '', source: '', proxy: '', token: '' };
    const rest = argv.slice(2);
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith('--vehicle=')) {
            out.vehicle = a.slice('--vehicle='.length);
        } else if (a === '--vehicle' && rest[i + 1]) {
            out.vehicle = rest[++i];
        } else if (a === '-v' && rest[i + 1]) {
            out.vehicle = rest[++i];
        } else if (a.startsWith('--article=')) {
            out.article = a.slice('--article='.length);
        } else if (a === '--article' && rest[i + 1]) {
            out.article = rest[++i];
        } else if (a.startsWith('--source=')) {
            out.source = a.slice('--source='.length);
        } else if (a === '--source' && rest[i + 1]) {
            out.source = rest[++i];
        } else if (a.startsWith('--proxy=')) {
            out.proxy = a.slice('--proxy='.length);
        } else if (a === '--proxy' && rest[i + 1]) {
            out.proxy = rest[++i];
        } else if (a.startsWith('--token=')) {
            out.token = a.slice('--token='.length);
        } else if (a === '--token' && rest[i + 1]) {
            out.token = rest[++i];
        }
    }
    return out;
}

const cli = parseCliArgs(process.argv);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
/** Same origin as `src/utils/motor-api.constants.ts` — hits `/api/*` on Vercel. */
const DEFAULT_PROXY_URL = 'https://vehapiproxi.vercel.app';

const PROXY_URL = (
    cli.proxy ||
    process.env.PROXY_URL ||
    DEFAULT_PROXY_URL
).replace(/\/$/, '');
const CONTENT_SOURCE = cli.source || process.env.CONTENT_SOURCE || 'MOTOR';
const VEHICLE_ID = String(cli.vehicle || process.env.VEHICLE_ID || '').trim();
const ARTICLE_ID_INPUT = String(cli.article || process.env.ARTICLE_ID || '').trim();
const AUTH_TOKEN = String(cli.token || process.env.AUTH_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
if (!VEHICLE_ID) {
    console.error(
        'Missing VEHICLE_ID. Use one of:\n' +
            '  npm run verify:evidence-links -- --vehicle=2854\n' +
            '  export VEHICLE_ID=2854 && npm run verify:evidence-links\n' +
            '  env VEHICLE_ID=2854 npm run verify:evidence-links'
    );
    process.exit(1);
}

const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
};

async function sbGet(pathQs) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, { headers: sbHeaders });
    if (!res.ok) {
        throw new Error(`Supabase GET failed [${res.status}] ${pathQs}: ${await res.text()}`);
    }
    return res.json();
}

async function pickArticleId() {
    if (ARTICLE_ID_INPUT) return ARTICLE_ID_INPUT;
    const url = `${PROXY_URL}/api/source/${CONTENT_SOURCE}/vehicle/${encodeURIComponent(VEHICLE_ID)}/articles/v2`;
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        if (res.status >= 500) {
            // Helpful hint for the common case where vehicle id is valid but content source is wrong.
            const probeSources = ['MOTOR', 'GeneralMotors', 'Ford', 'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia'];
            const candidateSources = [];
            for (const source of probeSources) {
                if (source === CONTENT_SOURCE) continue;
                const probeUrl = `${PROXY_URL}/api/source/${source}/vehicle/${encodeURIComponent(VEHICLE_ID)}/articles/v2`;
                try {
                    const probeRes = await fetch(probeUrl);
                    if (probeRes.ok) candidateSources.push(source);
                } catch (e) {
                    // Ignore probe errors; we'll still return original failure.
                }
            }
            const sourceHint = candidateSources.length
                ? ` Try --source=${candidateSources[0]} (also valid: ${candidateSources.join(', ')}).`
                : '';
            throw new Error(`Catalog request failed [${res.status}] for CONTENT_SOURCE=${CONTENT_SOURCE}.${sourceHint} Body: ${body}`);
        }
        throw new Error(`Catalog request failed [${res.status}]: ${body}`);
    }
    const data = await res.json();
    const first = data?.body?.articleDetails?.[0];
    if (!first?.id) {
        throw new Error('No articleDetails in catalog response');
    }
    return String(first.id);
}

async function triggerArticle(articleId) {
    const url = `${PROXY_URL}/api/source/${CONTENT_SOURCE}/vehicle/${encodeURIComponent(VEHICLE_ID)}/article/${encodeURIComponent(articleId)}/html`;
    const headers = { Accept: 'text/html,application/json' };
    if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text();
        if (res.status === 401 || res.status === 403) {
            throw new Error(
                `Article fetch failed [${res.status}] (auth required on deployed proxy). ` +
                    `Pass --token=<supabase_access_token> (or AUTH_TOKEN env), or run with --proxy=http://localhost:3000. Body: ${body}`
            );
        }
        throw new Error(`Article fetch failed [${res.status}]: ${body}`);
    }
    return res.text();
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function verify(articleId) {
    const vehicleEq = encodeURIComponent(VEHICLE_ID);
    const articleEq = encodeURIComponent(articleId);
    const sourceEq = encodeURIComponent(CONTENT_SOURCE);

    const contentItems = await sbGet(
        `content_item?vehicle_external_id=eq.${vehicleEq}&motor_article_id=eq.${articleEq}&content_source=eq.${sourceEq}` +
            '&select=id,display_description,search_text,enrichment_source,enrichment_version,enriched_at'
    );

    const evidenceRows = await sbGet(
        `evidence_ingest?vehicle_external_id=eq.${vehicleEq}&url_path=ilike.%25article%2F${articleEq}%25` +
            '&select=id,fetched_at,source_label,sha256&order=fetched_at.desc&limit=3'
    );

    const links = evidenceRows.length
        ? await sbGet(
              `evidence_link?evidence_id=eq.${encodeURIComponent(evidenceRows[0].id)}` +
                  '&select=id,entity_type,entity_id,extractor_version&limit=20'
          )
        : [];

    const ci = contentItems[0] || null;
    const hasCiEnrichment = Boolean(ci && (ci.display_description || ci.search_text));
    const hasEvidence = evidenceRows.length > 0;
    const hasLinks = links.length > 0;

    console.log('--- Verification Result ---');
    console.log(`vehicle_id: ${VEHICLE_ID}`);
    console.log(`article_id: ${articleId}`);
    console.log(`content_item_found: ${Boolean(ci)}`);
    console.log(`content_item_enrichment_present: ${hasCiEnrichment}`);
    console.log(`evidence_ingest_rows: ${evidenceRows.length}`);
    console.log(`evidence_link_rows_for_latest_evidence: ${links.length}`);

    if (!ci || !hasCiEnrichment || !hasEvidence || !hasLinks) {
        process.exitCode = 2;
        console.error('\nFAIL: One or more verification checks did not pass.');
    } else {
        console.log('\nPASS: content_item enrichment + evidence_ingest + evidence_link verified.');
    }
}

async function main() {
    console.log(`Proxy base: ${PROXY_URL} (override with PROXY_URL or --proxy for local)`);
    const articleId = await pickArticleId();
    console.log(`Using article: ${articleId}`);
    await triggerArticle(articleId);
    console.log('Triggered article fetch; waiting 12s for background processing...');
    await sleep(12000);
    await verify(articleId);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});

