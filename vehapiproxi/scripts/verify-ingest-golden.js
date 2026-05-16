#!/usr/bin/env node
/**
 * Smoke-parse golden JSON under testdata/ingest-golden (no network).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'testdata', 'ingest-golden');
const files = ['catalog-snippet.example.json', 'minimal-tracker.example.json'];

for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
        console.error(`Missing ${p}`);
        process.exit(1);
    }
    JSON.parse(fs.readFileSync(p, 'utf8'));
}

const catPath = path.join(dir, 'catalog-snippet.example.json');
const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
const details = cat?.body?.articleDetails;
if (!Array.isArray(details)) {
    console.error('catalog-snippet: missing body.articleDetails array');
    process.exit(1);
}
const ids = new Set(details.map((d) => (d && d.id != null ? String(d.id).trim() : '')).filter(Boolean));
if (ids.size !== 1 || !ids.has('P123')) {
    console.error('catalog-snippet: expected one unique id P123');
    process.exit(1);
}

const tr = JSON.parse(fs.readFileSync(path.join(dir, 'minimal-tracker.example.json'), 'utf8'));
if (tr.version !== 1 || tr.catalog?.deduped_article_count == null) {
    console.error('minimal-tracker.example: expected version=1 and catalog.deduped_article_count');
    process.exit(1);
}

console.log(`verify-ingest-golden: OK (${files.length} files + assertions)`);