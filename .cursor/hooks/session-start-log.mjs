#!/usr/bin/env node
/**
 * Cursor sessionStart hook — proves hooks are loaded for this workspace.
 * Appends one line to .cursor/hooks/hooks-smoke.log when a composer session starts.
 */
import { appendFileSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const LOG = path.join(repoRoot, '.cursor', 'hooks', 'hooks-smoke.log');

function readStdin() {
    try {
        return readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

try {
    const raw = readStdin();
    let mode = '';
    try {
        const j = JSON.parse(raw || '{}');
        mode = String(j.composer_mode || j.mode || '');
    } catch {
        /* ignore */
    }
    appendFileSync(
        LOG,
        `${new Date().toISOString()} sessionStart composer_mode=${mode || 'unknown'} bytes=${raw.length}\n`,
        'utf8'
    );
} catch (e) {
    appendFileSync(LOG, `${new Date().toISOString()} sessionStart ERROR ${e.message}\n`, 'utf8');
}

console.log(JSON.stringify({}));
