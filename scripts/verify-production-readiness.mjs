#!/usr/bin/env node
/**
 * Local CI for production-readiness changes: Angular build + syntax-check critical vehapiproxi modules.
 * Does not call Supabase or Motor (use `cd vehapiproxi && npm run verify:evidence-links` separately).
 *
 *   npm run verify:prod-readiness
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('[verify:prod-readiness] npm run build');
execSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });

const files = [
    'vehapiproxi/src/index.js',
    'vehapiproxi/src/function.js',
    'vehapiproxi/src/background_worker.js',
    'vehapiproxi/src/supabase.js',
    'vehapiproxi/src/l2_retrieval.js',
    'vehapiproxi/src/rate_limit.js',
    'vehapiproxi/src/stripe.js',
    'vehapiproxi/src/motor_information_api.js',
    'vehapiproxi/src/routes/motor-information.js'
];

for (const f of files) {
    const fp = path.join(root, f);
    console.log(`[verify:prod-readiness] node --check ${f}`);
    execSync(`node --check "${fp}"`, { stdio: 'inherit', shell: true });
}

console.log('[verify:prod-readiness] OK');
