/**
 * Async write queue for catalog DB writes.
 *
 * Workers call enqueueRows() which returns immediately.
 * A background interval flushes batched rows with bulk upserts,
 * eliminating per-vehicle DB round-trips and connection pool contention.
 */
import logger from './logger.js';
import { dbQuery, isDbConfigured } from './db.js';

// ---------------------------------------------------------------------------
// Mirror the subset of db.service helpers needed here (avoid circular import)
// ---------------------------------------------------------------------------

const UPSERT_CONFLICT_COLUMNS = {
    articles:      ['vehicle_id', 'original_id'],
    content_item:  ['vehicle_external_id', 'motor_article_id', 'content_source'],
    dtcs:          ['vehicle_id', 'code'],
};

const ARTICLES_UPSERT_EXTENDED =
    String(process.env.ARTICLES_UPSERT_EXTENDED || 'true').toLowerCase() !== 'false' &&
    process.env.ARTICLES_UPSERT_EXTENDED !== '0';

const ARTICLES_MINIMAL_COLS = new Set([
    'vehicle_id', 'original_id', 'title', 'content_source', 'bucket', 'parent_bucket',
]);
const ARTICLES_EXTENDED_COLS = new Set([
    'subtitle', 'description', 'code', 'thumbnail_href', 'bulletin_number',
    'release_date', 'sort', 'original_content', 'enhanced_content', 'source',
]);

function filterArticleRow(row) {
    const out = {};
    for (const k of Object.keys(row)) {
        if (ARTICLES_MINIMAL_COLS.has(k) || (ARTICLES_UPSERT_EXTENDED && ARTICLES_EXTENDED_COLS.has(k))) {
            out[k] = row[k];
        }
    }
    return out;
}

function dedupeByKey(rows, keyFn) {
    const map = new Map();
    for (const r of rows) map.set(keyFn(r), r);
    return [...map.values()];
}

function buildUpsertSql(table, rows, conflictCols) {
    const cols = Object.keys(rows[0]);
    const flatValues = [];
    const valueSets = rows.map((row) => {
        const placeholders = cols.map((col) => {
            const val = row[col];
            if (Array.isArray(val)) {
                flatValues.push(`[${val.join(',')}]`);
                return `$${flatValues.length}::vector`;
            }
            flatValues.push(
                val !== null && typeof val === 'object' ? JSON.stringify(val) : (val ?? null)
            );
            return `$${flatValues.length}`;
        });
        return `(${placeholders.join(', ')})`;
    });

    const colList = cols.map((c) => `"${c}"`).join(', ');
    let sql = `INSERT INTO "${table}" (${colList}) VALUES ${valueSets.join(', ')}`;

    if (conflictCols && conflictCols.length > 0) {
        const conflictSet = new Set(conflictCols);
        const conflictList = conflictCols.map((c) => `"${c}"`).join(', ');
        const updateCols = cols.filter((c) => !conflictSet.has(c));
        if (updateCols.length > 0) {
            sql += ` ON CONFLICT (${conflictList}) DO UPDATE SET ${updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`;
        } else {
            sql += ` ON CONFLICT (${conflictList}) DO NOTHING`;
        }
    }

    return { sql, values: flatValues };
}

// ---------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------

/** @type {Map<string, object[]>} */
const queues = new Map();
let flushTimer = null;
let flushing = false;

const FLUSH_INTERVAL_MS = parseInt(process.env.WRITE_QUEUE_INTERVAL_MS || '2000', 10);
const FLUSH_BATCH_SIZE  = parseInt(process.env.WRITE_QUEUE_BATCH_SIZE  || '400',  10);

/**
 * Add rows to the write queue. Returns immediately — DB write is async.
 * @param {'articles'|'content_item'|'dtcs'} table
 * @param {object[]} rows
 */
export function enqueueRows(table, rows) {
    if (!rows || rows.length === 0) return;
    if (!queues.has(table)) queues.set(table, []);
    queues.get(table).push(...rows);
}

async function flushTable(table, rows) {
    if (rows.length === 0) return;

    let processed = rows;

    if (table === 'articles') {
        processed = processed.map(filterArticleRow);
        processed = dedupeByKey(processed, (r) => `${r.vehicle_id}|${r.original_id}`);
    }
    if (table === 'content_item') {
        processed = dedupeByKey(processed, (r) => `${r.vehicle_external_id}|${r.motor_article_id}|${r.content_source}`);
    }
    if (table === 'dtcs') {
        processed = dedupeByKey(processed, (r) => `${r.vehicle_id}|${r.code}`);
    }

    if (processed.length === 0) return;

    // Flush in FLUSH_BATCH_SIZE chunks to avoid huge parameterized queries
    for (let i = 0; i < processed.length; i += FLUSH_BATCH_SIZE) {
        const chunk = processed.slice(i, i + FLUSH_BATCH_SIZE);
        try {
            const conflictCols = UPSERT_CONFLICT_COLUMNS[table] || null;
            const { sql, values } = buildUpsertSql(table, chunk, conflictCols);
            await dbQuery(sql, values);
            logger.info(`[write-queue] flushed ${chunk.length} rows → ${table}`);
        } catch (err) {
            logger.error(`[write-queue] flush failed for ${table}: ${err.message}`);
            // Re-queue failed rows so they're retried next flush
            enqueueRows(table, chunk);
        }
    }
}

export async function flushAll() {
    if (!isDbConfigured()) return;
    if (flushing) return;
    flushing = true;
    try {
        for (const [table, rows] of queues) {
            if (rows.length === 0) continue;
            queues.set(table, []);
            await flushTable(table, rows);
        }
    } finally {
        flushing = false;
    }
}

/** Start the background flush interval. Call once at process start. */
export function startWriteQueue() {
    if (flushTimer) return;
    flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
    if (flushTimer.unref) flushTimer.unref(); // don't block process exit
    logger.info(`[write-queue] started (interval=${FLUSH_INTERVAL_MS}ms, batch=${FLUSH_BATCH_SIZE})`);
}

export function stopWriteQueue() {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
}

/** Depth of queued rows by table — for health checks. */
export function writeQueueDepth() {
    const out = {};
    for (const [t, rows] of queues) out[t] = rows.length;
    return out;
}
