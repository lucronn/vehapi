#!/usr/bin/env node
/**
 * Verifies phase-1 traceability for one article (content_item, evidence_ingest, evidence_link).
 *
 * Easy path (local, no user JWT):
 *   1. In vehapiproxi/.env: NODE_ENV=development (or unset), SKIP_ARTICLE_ACCESS_AUTH=true
 *   2. Terminal A: cd vehapiproxi && node src/index.js   (port 3001)
 *   3. (Optional) npm run dev on 3000 for the SPA — verify defaults to PROXY_URL=http://localhost:3001
 *   4: cd vehapiproxi && npm run verify:evidence-links -- --local --vehicle=2854
 *      Sends X-Vehapi-Verify: 1 so the proxy skips Supabase-only caches (Motor fetch → background enqueue).
 *      If default CONTENT_SOURCE=MOTOR returns M1 SPA shell HTML for the article, auto-tries GeneralMotors (etc.).
 *      Polls Supabase up to VERIFY_POLL_MS (default 120s). Needs NVIDIA_API_KEY / LLM_API_KEY for enrichment.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in vehapiproxi/.env or repo root .env
 *
 * Production / Vercel: omit --local; pass user access_token: --token=... (same Supabase project as proxy)
 *
 * npm: flags for the script must follow `--`: npm run verify:evidence-links -- --local --vehicle=2854
 */
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

function parseCliArgs(argv) {
    const out = { vehicle: '', article: '', source: '', proxy: '', token: '', local: false };
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
        } else if (a === '--local') {
            out.local = true;
        }
    }
    return out;
}

const cli = parseCliArgs(process.argv);

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_PROXY_URL = 'https://vehapiproxi.vercel.app';
/** Direct to vehapiproxi (Express) avoids Angular dev-server proxy quirks; still works with ng serve on 3000 via --proxy=http://localhost:3000 */
const LOCAL_DEFAULT_PROXY = 'http://localhost:3001';

const useLocal =
    cli.local || String(process.env.VERIFY_USE_LOCAL_PROXY || '').toLowerCase() === 'true';

let PROXY_URL = (cli.proxy || process.env.PROXY_URL || (useLocal ? LOCAL_DEFAULT_PROXY : DEFAULT_PROXY_URL)).replace(
    /\/$/,
    ''
);

// Default MOTOR is wrong for many OEM catalogs (e.g. GM uses GeneralMotors). Prefer --source= from models JSON.
const initialContentSource = String(cli.source || process.env.CONTENT_SOURCE || 'MOTOR').trim();
let contentSource = initialContentSource;

/** Motor often returns 200 + M1 app shell HTML when the path uses the wrong contentSource shard. */
function isMotorSpaShellPayload(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trimStart();
    if (t.startsWith('{')) {
        try {
            const j = JSON.parse(text);
            const inner = j?.body?.html ?? j?.body?.content ?? j?.html ?? '';
            if (typeof inner === 'string' && inner.length > 0) {
                return isMotorSpaShellPayload(inner);
            }
        } catch {
            return false;
        }
        return false;
    }
    const head = text.slice(0, 12000);
    return (
        head.includes('<title>Vehicle Information</title>') &&
        (head.includes('base href="/m1/"') || head.includes("base href='/m1/'"))
    );
}

/** Order after user/env source — used when upstream returns SPA shell for article fetch. */
const ARTICLE_SOURCE_FALLBACKS = [
    'GeneralMotors',
    'MOTOR',
    'Ford',
    'Toyota',
    'Honda',
    'Nissan',
    'Stellantis',
    'Hyundai',
    'Kia'
];

function uniqueSourceOrder(primary) {
    const out = [];
    const seen = new Set();
    for (const s of [primary, ...ARTICLE_SOURCE_FALLBACKS]) {
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}
const VEHICLE_ID = String(cli.vehicle || process.env.VEHICLE_ID || '').trim();
const ARTICLE_ID_INPUT = String(cli.article || process.env.ARTICLE_ID || '').trim();
// --local: omit env JWTs (stale SUPABASE_ACCESS_TOKEN → 401 invalid token if sent).
const AUTH_TOKEN = (() => {
    if (cli.token) return String(cli.token).trim();
    if (useLocal) return '';
    return String(process.env.AUTH_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || '').trim();
})();

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
if (!VEHICLE_ID) {
    console.error(
        'Missing VEHICLE_ID.\n' +
            '  Easy: npm run verify:evidence-links -- --local --vehicle=2854\n' +
            '  Or:   export VEHICLE_ID=2854 && npm run verify:evidence-links -- --local'
    );
    process.exit(1);
}

const sbHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
};

/** Matches `function.js` cache bypass — forces Motor fetch + background enqueue (not Supabase-only cache). */
const VERIFY_PROXY_HEADERS = { 'X-Vehapi-Verify': '1' };

async function sbGet(pathQs) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, { headers: sbHeaders });
    if (!res.ok) {
        throw new Error(`Supabase GET failed [${res.status}] ${pathQs}: ${await res.text()}`);
    }
    return res.json();
}

async function fetchCatalog(source) {
    const url = `${PROXY_URL}/api/source/${source}/vehicle/${encodeURIComponent(VEHICLE_ID)}/articles/v2`;
    const res = await fetch(url, { headers: VERIFY_PROXY_HEADERS });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        /* ignore */
    }
    return { ok: res.ok, status: res.status, json, text };
}

async function probeWorkingSources() {
    const probeSources = ['MOTOR', 'GeneralMotors', 'Ford', 'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia'];
    const working = [];
    for (const source of probeSources) {
        if (source === contentSource) continue;
        const { ok: good } = await fetchCatalog(source);
        if (good) working.push(source);
    }
    return working;
}

const MAX_CATALOG_ARTICLES_TO_TRY = 40;

/**
 * @returns {{ articleIds: string[], contentSource: string, catalogJson?: object }}
 */
async function pickArticleCandidates() {
    if (ARTICLE_ID_INPUT) {
        return { articleIds: [ARTICLE_ID_INPUT], contentSource };
    }

    let attemptSource = contentSource;
    let { ok, status, json, text } = await fetchCatalog(attemptSource);

    if (!ok && status >= 500) {
        const candidates = await probeWorkingSources();
        if (candidates.length > 0) {
            attemptSource = candidates[0];
            console.log(`Catalog [500] for ${contentSource}; auto-switching CONTENT_SOURCE to ${attemptSource}`);
            contentSource = attemptSource;
            ({ ok, status, json, text } = await fetchCatalog(contentSource));
        }
    }

    if (!ok) {
        const npmHint =
            ' Put script args after `--`. Or: export CONTENT_SOURCE=GeneralMotors';
        throw new Error(`Catalog request failed [${status}] for vehicle=${VEHICLE_ID} source=${contentSource}.${npmHint} Body: ${text.slice(0, 800)}`);
    }

    const details = json?.body?.articleDetails;
    if (!Array.isArray(details) || details.length === 0) {
        throw new Error('No articleDetails in catalog response');
    }
    const articleIds = [
        ...new Set(details.map((a) => a?.id).filter((id) => id != null && id !== '').map((id) => String(id)))
    ].slice(0, MAX_CATALOG_ARTICLES_TO_TRY);

    if (articleIds.length === 0) {
        throw new Error('No article ids in catalog response');
    }
    return { articleIds, contentSource, catalogJson: json };
}

/**
 * Same path as Angular `MotorApiService.getArticleContent` — GET `/article/:id` only (no `/html` suffix).
 * `/article/:id/html` often returns the M1 SPA shell with HTTP 200, which is useless for verify and doubles traffic.
 * 200 + M1 SPA shell on the canonical path is treated as failure so we can try another contentSource shard.
 * @param {string} articleId
 * @param {string} [source] — defaults to module `contentSource`
 * @returns {Promise<{ ok: boolean, body?: string, status: number, err?: string, spaShell?: boolean }>}
 */
async function tryFetchArticleVariants(articleId, source) {
    const src = source != null ? source : contentSource;
    const headers = { Accept: 'application/json, text/html', ...VERIFY_PROXY_HEADERS };
    if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    const url = `${PROXY_URL}/api/source/${src}/vehicle/${encodeURIComponent(VEHICLE_ID)}/article/${encodeURIComponent(articleId)}`;

    const res = await fetch(url, { headers });
    const body = await res.text();
    const lastStatus = res.status;
    const lastBody = body;

    if (res.ok) {
        if (isMotorSpaShellPayload(body)) {
            return {
                ok: false,
                status: res.status,
                err: 'M1 SPA shell HTML (wrong contentSource for this vehicle/article)',
                spaShell: true,
                body: body.slice(0, 200)
            };
        }
        return { ok: true, body, status: res.status };
    }
    if (res.status === 401 || res.status === 403) {
        const hint = useLocal
            ? ' For local dev add SKIP_ARTICLE_ACCESS_AUTH=true to vehapiproxi/.env (NODE_ENV must not be production) and restart the proxy.'
            : ' Pass --token=<user access_token from same Supabase project as proxy>, or use --local with local proxy + SKIP_ARTICLE_ACCESS_AUTH.';
        throw new Error(`Article fetch failed [${res.status}]. ${hint} Body: ${body.slice(0, 400)}`);
    }
    return { ok: false, status: lastStatus, err: lastBody.slice(0, 700) };
}

/**
 * Walk contentSource shards then catalog article ids until we get real article payload (not M1 SPA shell).
 */
async function triggerArticleFetchFirstWorking(articleIds) {
    const sourcesToTry = uniqueSourceOrder(contentSource);
    const failures = [];
    for (const src of sourcesToTry) {
        for (let i = 0; i < articleIds.length; i++) {
            const id = articleIds[i];
            const r = await tryFetchArticleVariants(id, src);
            if (r.ok) {
                const switched = src !== contentSource;
                contentSource = src;
                if (switched) {
                    console.log(
                        `Auto-switched CONTENT_SOURCE to ${src} (was ${initialContentSource} — got real article body, not M1 SPA shell).`
                    );
                }
                if (i > 0) {
                    console.log(`Note: earlier article id(s) failed for source ${src}; using article ${id}.`);
                }
                return { articleId: id, body: r.body };
            }
            failures.push(`${src}/${id} [${r.status}]${r.spaShell ? ' SPA' : ''}: ${(r.err || '').slice(0, 100)}`);
        }
    }
    throw new Error(
        `Could not fetch real article HTML/JSON for any shard in [${sourcesToTry.join(', ')}] ` +
            `(tried ${articleIds.length} catalog article id(s) at GET .../article/:id only).\n` +
            `Sample errors:\n${failures.slice(0, 8).join('\n')}\n` +
            `Tip: pass --source= from the models API (e.g. GeneralMotors), or another --vehicle.`
    );
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function runChecks(articleId) {
    const vehicleEq = encodeURIComponent(VEHICLE_ID);
    const articleEq = encodeURIComponent(articleId);

    // Do not filter content_source: worker preserves Motor path casing; legacy rows may be uppercase.
    const contentItems = await sbGet(
        `content_item?vehicle_external_id=eq.${vehicleEq}&motor_article_id=eq.${articleEq}` +
            '&select=id,content_source,display_description,search_text,enrichment_source,enrichment_version,enriched_at,updated_at' +
            '&limit=10'
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

    const ci =
        contentItems.find((row) => Boolean(row && (row.display_description || row.search_text))) ||
        contentItems
            .slice()
            .sort((a, b) => String(b?.updated_at || '').localeCompare(String(a?.updated_at || '')))[0] ||
        null;
    const hasCiEnrichment = Boolean(ci && (ci.display_description || ci.search_text));
    const hasEvidence = evidenceRows.length > 0;
    const hasLinks = links.length > 0;
    const pass = Boolean(ci && hasCiEnrichment && hasEvidence && hasLinks);

    return {
        pass,
        ci,
        hasCiEnrichment,
        evidenceRows,
        links,
        hasEvidence
    };
}

function printResult(articleId, r, ok) {
    console.log('--- Verification Result ---');
    console.log(`vehicle_id: ${VEHICLE_ID}`);
    console.log(`catalog_content_source: ${contentSource}`);
    console.log(`content_item.content_source: ${r.ci?.content_source ?? '(none)'}`);
    console.log(`article_id: ${articleId}`);
    console.log(`content_item_found: ${Boolean(r.ci)}`);
    console.log(`content_item_enrichment_present: ${r.hasCiEnrichment}`);
    console.log(`evidence_ingest_rows: ${r.evidenceRows.length}`);
    console.log(`evidence_link_rows_for_latest_evidence: ${r.links.length}`);
    if (ok) {
        console.log('\nPASS: content_item enrichment + evidence_ingest + evidence_link verified.');
    } else {
        console.error('\nFAIL: One or more verification checks did not pass.');
    }
}

async function main() {
    if (useLocal) {
        console.log(
            `Local proxy: ${PROXY_URL} (default :3001 = Express; use PROXY_URL=http://localhost:3000 for ng serve). ` +
                `vehapiproxi/.env: SKIP_ARTICLE_ACCESS_AUTH=true, NODE_ENV not production. Restart proxy after code changes.`
        );
    } else {
        console.log(`Proxy base: ${PROXY_URL} (use --local for http://localhost:3000)`);
    }

    const picked = await pickArticleCandidates();
    contentSource = picked.contentSource;
    const { articleId } = await triggerArticleFetchFirstWorking(picked.articleIds);

    console.log(`Using article: ${articleId}`);

    const maxMs = Number(process.env.VERIFY_POLL_MS || 120000) || 120000;
    const interval = Number(process.env.VERIFY_POLL_INTERVAL_MS || 5000) || 5000;
    console.log(
        `Polling Supabase (up to ${maxMs / 1000}s, interval ${interval / 1000}s). ` +
            `Ensure vehapiproxi is running and NVIDIA_API_KEY / LLM_API_KEY is set for AI parse.`
    );

    const t0 = Date.now();
    let last = await runChecks(articleId);
    while (!last.pass && Date.now() - t0 < maxMs) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  ... not ready (${elapsed}s): content_item=${Boolean(last.ci)} enrich=${last.hasCiEnrichment} evidence=${last.evidenceRows.length} links=${last.links.length}`
        );
        await sleep(interval);
        last = await runChecks(articleId);
    }

    printResult(articleId, last, last.pass);
    if (!last.pass) {
        process.exitCode = 2;
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
