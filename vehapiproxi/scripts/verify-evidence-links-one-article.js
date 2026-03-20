#!/usr/bin/env node
/**
 * Verifies phase-1 traceability for one article:
 * - content_item enrichment fields are updated from parsed content
 * - evidence_ingest row exists for the article payload
 * - evidence_link rows connect that evidence to normalized entities
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PROXY_URL (default http://localhost:3000)
 *   VEHICLE_ID (required)
 *   CONTENT_SOURCE (default MOTOR)
 *   ARTICLE_ID (optional; if not set, picks first article from catalog)
 */
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PROXY_URL = (process.env.PROXY_URL || 'http://localhost:3000').replace(/\/$/, '');
const CONTENT_SOURCE = process.env.CONTENT_SOURCE || 'MOTOR';
const VEHICLE_ID = process.env.VEHICLE_ID || '';
const ARTICLE_ID_INPUT = process.env.ARTICLE_ID || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
if (!VEHICLE_ID) {
    console.error('Missing VEHICLE_ID');
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
        throw new Error(`Catalog request failed [${res.status}]: ${await res.text()}`);
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
    const res = await fetch(url, { headers: { Accept: 'text/html,application/json' } });
    if (!res.ok) {
        throw new Error(`Article fetch failed [${res.status}]: ${await res.text()}`);
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

