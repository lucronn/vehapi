#!/usr/bin/env node
/**
 * run-stack.mjs — starts the full ingest stack in one command:
 *   1. proxy-aggregator  (port 3848, --probe by default)
 *   2. N proxy servers   (src/index.js, ports 3001..3001+backends-1)
 *   3. M ingest workers  (distributed round-robin across backends)
 *
 * Usage:
 *   node scripts/run-stack.mjs [options]
 *
 * Options:
 *   --no-probe               skip liveness probing in aggregator (faster startup)
 *   --no-worker              start aggregator + proxy server(s) only
 *   --metadata-only          pass --metadata-only to workers
 *   --concurrency=N          articles per worker (default: 1)
 *   --workers=N              number of worker processes (default: 1)
 *   --backends=N             number of independent proxy backends (default: 1)
 *   --agg-port=N             aggregator port (default: 3848)
 *   --delay-ms=N             inter-scope delay in workers (default: 0)
 *   --session-budget=N       Motor requests per session before rotation
 *   --loop-gap-ms=N          gap between CSV passes (default: 5000)
 *   --csv=PATH               vehicles CSV file path
 *   --auto-reset-failed      pass --auto-reset-failed to workers
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const hasFlag = (f) => process.argv.includes(`--${f}`);
const getVal  = (f, def) => {
    const eq = process.argv.find(a => a.startsWith(`--${f}=`));
    if (eq) return eq.slice(f.length + 3);
    return def;
};

const probe       = !hasFlag('no-probe');
const noWorker    = hasFlag('no-worker');
const metaOnly    = hasFlag('metadata-only');
const concurrency      = getVal('concurrency', '1');
const numWorkers       = Math.max(1, parseInt(getVal('workers', '1'), 10) || 1);
const numBackends      = Math.max(1, parseInt(getVal('backends', '1'), 10) || 1);
const delayMs          = getVal('delay-ms', '0');
const sessionBudget    = getVal('session-budget', '');
const loopGapMs        = getVal('loop-gap-ms', '5000');
const vehiclesCsv      = getVal('csv', '');
const autoResetFailed  = hasFlag('auto-reset-failed');
const aggPort          = getVal('agg-port', '3848');
const BASE_PORT        = 3001;

// ---------------------------------------------------------------------------
// Process registry
// ---------------------------------------------------------------------------
const procs = [];
let stopping = false;

function stopAll(signal = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    console.error('\n[stack] Stopping all processes…');
    for (const { name, proc } of procs) {
        if (proc.exitCode === null) {
            console.error(`[stack] → ${name} (pid ${proc.pid})`);
            proc.kill(signal);
        }
    }
}

process.on('SIGINT',  () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------
function launch(name, cmd, args, { waitForLine = null, color = '', env = null } = {}) {
    return new Promise((resolve, reject) => {
        const RESET = '\x1b[0m';
        const PREFIX = color ? `${color}[${name}]${RESET} ` : `[${name}] `;

        console.error(`${PREFIX}Starting: ${cmd} ${args.join(' ')}`);

        const proc = spawn(cmd, args, {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: env || { ...process.env },
        });

        procs.push({ name, proc });

        const onLine = (chunk) => {
            const lines = String(chunk).split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                process.stderr.write(`${PREFIX}${line}\n`);
                if (waitForLine && line.includes(waitForLine)) {
                    resolve(proc);
                }
            }
        };

        proc.stdout.on('data', onLine);
        proc.stderr.on('data', onLine);

        proc.on('exit', (code) => {
            process.stderr.write(`${PREFIX}exited (code ${code ?? '?'})\n`);
            if (!stopping && code !== 0) {
                stopAll();
            }
        });

        proc.on('error', (err) => {
            process.stderr.write(`${PREFIX}error: ${err.message}\n`);
            reject(err);
        });

        // If no waitForLine, resolve immediately after spawn
        if (!waitForLine) resolve(proc);
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    console.error('[stack] ━━━ vehapi full ingest stack ━━━');
    console.error(`[stack] probe=${probe} backends=${numBackends} workers=${noWorker ? 0 : numWorkers} metadata-only=${metaOnly} concurrency=${concurrency}`);

    // 1. Proxy aggregator
    const aggArgs = [`scripts/proxy-aggregator.mjs`, `--port=${aggPort}`];
    if (probe) aggArgs.push('--probe');

    await launch('agg', 'node', aggArgs, {
        waitForLine: 'Listening on',
        color: '\x1b[36m',   // cyan
    });
    console.error('[stack] ✓ Proxy aggregator ready');

    // 2. Kill anything on ports 3001..3001+numBackends-1, then start backend(s)
    for (let bi = 0; bi < numBackends; bi++) {
        const port = BASE_PORT + bi;
        try {
            const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
            for (const pid of pids) {
                process.stderr.write(`[stack] Killing existing process on :${port} (pid ${pid})\n`);
                try { execSync(`kill -9 ${pid}`); } catch { /* already gone */ }
            }
            if (pids.length) await new Promise(r => setTimeout(r, 300));
        } catch { /* no process on port */ }

        const backendLabel = numBackends > 1 ? `proxy-${bi + 1}` : 'proxy';
        const backendEnv = { ...process.env, PORT: String(port), PROXY_PORT: String(port) };
        await launch(backendLabel, 'node', ['src/index.js'], {
            waitForLine: 'Proxy server listening',
            color: '\x1b[33m',
            env: backendEnv,
        });
        console.error(`[stack] ✓ Backend ${backendLabel} ready on :${port}`);
    }

    // 3. Ingest workers (optional)
    if (!noWorker) {
        const workerColors = ['\x1b[32m', '\x1b[35m', '\x1b[96m', '\x1b[93m', '\x1b[91m', '\x1b[94m', '\x1b[92m', '\x1b[95m'];
        for (let i = 0; i < numWorkers; i++) {
            const backendPort = BASE_PORT + (i % numBackends);
            const workerArgs = [
                'scripts/worker-ingest-vehicles-full.js',
                '--resume',
                '--continuous',
                `--base=http://localhost:${backendPort}`,
                `--concurrency=${concurrency}`,
                `--loop-gap-ms=${loopGapMs}`,
            ];
            if (delayMs && delayMs !== '0') workerArgs.push(`--delay-ms=${delayMs}`);
            if (sessionBudget) workerArgs.push(`--session-budget=${sessionBudget}`);
            if (vehiclesCsv) workerArgs.push(`--csv=${vehiclesCsv}`);
            if (autoResetFailed) workerArgs.push('--auto-reset-failed');
            if (metaOnly) workerArgs.push('--metadata-only');
            if (numWorkers > 1) workerArgs.push(`--shard=${i}/${numWorkers}`);
            const label = numWorkers > 1 ? `worker-${i + 1}` : 'worker';
            const color = workerColors[i % workerColors.length];
            await launch(label, 'node', workerArgs, { color });
            console.error(`[stack] ✓ Ingest ${label} started → backend :${backendPort}`);
            // Stagger workers so they don't all auth simultaneously
            if (i < numWorkers - 1) await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.error('[stack] ━━━ All services running. Ctrl+C to stop. ━━━');
}

main().catch(err => {
    console.error('[stack] fatal:', err.message);
    stopAll();
    process.exitCode = 1;
});
