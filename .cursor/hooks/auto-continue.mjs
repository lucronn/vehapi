#!/usr/bin/env node
/**
 * Cursor Agent hooks: auto-submit "continue" after agent / subagent stops.
 * Default ON when hooks are registered; opt out with `.cursor/worker-loop.disabled`
 * (optional `.cursor/worker-loop.enabled` still forces ON if both files exist). See `WORKER_LOOP.md`.
 *
 * stdin: JSON per Cursor hooks spec (stop or subagentStop).
 * stdout: JSON { "followup_message": "..." } or {}
 */
import { appendFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const ENABLE_FLAG = path.join(repoRoot, '.cursor', 'worker-loop.enabled');
const DISABLE_FLAG = path.join(repoRoot, '.cursor', 'worker-loop.disabled');
const LOG_PATH = path.join(repoRoot, '.cursor', 'hooks', 'auto-continue.log');

function readStdin() {
    try {
        return readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

function main() {
    const rawStdin = readStdin();
    try {
        appendFileSync(
            LOG_PATH,
            `${new Date().toISOString()} INVOKED bytes=${rawStdin.length} head=${JSON.stringify(rawStdin.slice(0, 120))}\n`,
            'utf8'
        );
    } catch {
        /* ignore */
    }

    // Default ON when hooks are installed; explicit local opt-out with worker-loop.disabled.
    // Back-compat: worker-loop.enabled still works, but is no longer required.
    const explicitlyDisabled = existsSync(DISABLE_FLAG);
    const explicitlyEnabled = existsSync(ENABLE_FLAG);
    if (explicitlyDisabled && !explicitlyEnabled) {
        console.log(JSON.stringify({}));
        return;
    }

    let input = {};
    try {
        input = JSON.parse(rawStdin || '{}');
    } catch (e) {
        try {
            appendFileSync(
                LOG_PATH,
                `${new Date().toISOString()} JSON_PARSE_FAIL ${e.message}\n`,
                'utf8'
            );
        } catch {
            /* ignore */
        }
        console.log(JSON.stringify({}));
        return;
    }
    try {
        appendFileSync(
            LOG_PATH,
            `${new Date().toISOString()} stop=${String(input.status || '')} subagent=${String(
                input.subagent_type || ''
            )} loop=${String(input.loop_count ?? '')}\n`,
            'utf8'
        );
    } catch {
        // Logging is best-effort only.
    }

    const isSubagentStop =
        typeof input.subagent_type === 'string' || typeof input.subagent_id === 'string';

    if (isSubagentStop) {
        const status = input.status;
        if (status && status !== 'completed') {
            console.log(JSON.stringify({}));
            return;
        }
        const task = String(input.task || '');
        const summary = String(input.summary || '');
        const hay = `${task}\n${summary}`;
        const workerish =
            /worker-progress|worker.progress|orchestrator|supervis|PROGRESS\.md|background_worker|normalization/i.test(
                hay
            );
        if (!workerish) {
            console.log(JSON.stringify({}));
            return;
        }
    } else {
        const status = input.status;
        if (status === 'error' || status === 'aborted') {
            console.log(JSON.stringify({}));
            return;
        }
    }

    const loopCount = Number(input.loop_count ?? 0);
    const max = Number(process.env.VEHAPI_AUTO_CONTINUE_MAX || 200);
    if (Number.isFinite(max) && max > 0 && loopCount >= max) {
        console.error(
            `[auto-continue] loop_count ${loopCount} >= VEHAPI_AUTO_CONTINUE_MAX (${max}); stopping follow-ups.`
        );
        console.log(JSON.stringify({}));
        return;
    }

    const msg =
        process.env.VEHAPI_AUTO_CONTINUE_MESSAGE ||
        'continue — keep the worker-progress loop going: read PROGRESS.md, advance work without asking the user, invoke worker-progress-orchestrator Task if appropriate, until blocked by missing credentials or external systems.';

    console.log(JSON.stringify({ followup_message: msg }));
}

main();
