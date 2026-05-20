/**
 * Batch queue for Supabase REST upserts — accumulates rows per table and
 * flushes when a threshold is reached or on explicit flush().
 * Reduces HTTP overhead during bulk ingest (e.g. --with-articles).
 */
import { insertParsedData } from './db.service.js';
import logger from './logger.js';

const DEFAULT_THRESHOLD = 50;

export class SupabaseBatchQueue {
    constructor({ threshold = DEFAULT_THRESHOLD } = {}) {
        this._threshold = Math.max(1, threshold);
        /** @type {Map<string, { rows: object[], options: object }>} */
        this._queues = new Map();
        this._flushResults = [];
    }

    /**
     * Enqueue rows for a table. Automatically flushes when threshold is reached.
     * @param {string} table
     * @param {object|object[]} data
     * @param {{ returnRepresentation?: boolean }} [options]
     */
    async enqueue(table, data, options = {}) {
        const rows = Array.isArray(data) ? data : [data];
        if (rows.length === 0) return;

        if (!this._queues.has(table)) {
            this._queues.set(table, { rows: [], options });
        }
        const q = this._queues.get(table);
        q.rows.push(...rows);

        if (q.rows.length >= this._threshold) {
            await this._flushTable(table);
        }
    }

    async _flushTable(table) {
        const q = this._queues.get(table);
        if (!q || q.rows.length === 0) return { success: true };

        const rows = q.rows.splice(0);
        const result = await insertParsedData(table, rows, q.options);
        this._flushResults.push({ table, count: rows.length, success: result.success, error: result.error });
        if (!result.success) {
            logger.warn(`[batch] flush ${table} (${rows.length} rows) failed: ${result.error}`);
        }
        return result;
    }

    /**
     * Flush all pending rows across all tables.
     * @returns {Promise<Array<{ table: string, count: number, success: boolean }>>}
     */
    async flush() {
        const keys = [...this._queues.keys()];
        const results = [];
        for (const key of keys) {
            const q = this._queues.get(key);
            if (q && q.rows.length > 0) {
                const r = await this._flushTable(key);
                results.push(r);
            }
        }
        return results;
    }

    /** Number of rows currently buffered across all tables. */
    get pendingCount() {
        let n = 0;
        for (const q of this._queues.values()) {
            n += q.rows.length;
        }
        return n;
    }

    /** Summary of all flush results since creation. */
    get results() {
        return this._flushResults;
    }
}
