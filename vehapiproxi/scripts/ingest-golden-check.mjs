#!/usr/bin/env node
/**
 * Minimal shape check for testdata/ingest-golden/*.json (no test runner required).
 * Run: cd vehapiproxi && node scripts/ingest-golden-check.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'testdata', 'ingest-golden');

let failed = false;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(dir, name);
    try {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        if (j.body && j.body.articleDetails !== undefined && !Array.isArray(j.body.articleDetails)) {
            throw new Error('catalog snippet: body.articleDetails must be array');
        }
    } catch (e) {
        console.error(`FAIL ${name}:`, e.message);
        failed = true;
    }
}
if (failed) process.exit(1);
console.log('ingest-golden-check: OK');
