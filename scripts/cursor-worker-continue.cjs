#!/usr/bin/env node
/**
 * Copies the standard worker "continue" prompt to the clipboard (one keystroke in Cursor chat).
 * Run from repo root: node scripts/cursor-worker-continue.cjs
 *
 * Windows: uses PowerShell Set-Clipboard
 * macOS: pbcopy
 * Linux: xclip or wl-copy if available
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const msg =
    process.env.VEHAPI_AUTO_CONTINUE_MESSAGE ||
    'continue — keep the worker-progress loop going: read PROGRESS.md, advance work without asking the user, invoke worker-progress-orchestrator Task if appropriate, until blocked by missing credentials or external systems.';

function main() {
    if (process.platform === 'win32') {
        const tmp = path.join(os.tmpdir(), `cursor-continue-${Date.now()}.txt`);
        try {
            fs.writeFileSync(tmp, msg, 'utf8');
            const r = spawnSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-Command',
                    `Get-Content -LiteralPath '${tmp.replace(/'/g, "''")}' -Raw | Set-Clipboard`
                ],
                { encoding: 'utf8' }
            );
            if (r.status !== 0) {
                console.error(r.stderr || r.stdout || 'Set-Clipboard failed');
                process.exit(1);
            }
            console.log('Copied to clipboard. Paste into Cursor chat (Ctrl+V).');
        } finally {
            try {
                fs.unlinkSync(tmp);
            } catch {
                /* ignore */
            }
        }
        return;
    }
    if (process.platform === 'darwin') {
        const r = spawnSync('pbcopy', { input: msg, encoding: 'utf8' });
        if (r.error || r.status !== 0) {
            console.error(r.error || 'pbcopy failed');
            process.exit(1);
        }
        console.log('Copied to clipboard. Paste into Cursor chat (Cmd+V).');
        return;
    }
    for (const [cmd, args] of [
        ['wl-copy', []],
        ['xclip', ['-selection', 'clipboard']]
    ]) {
        const r = spawnSync(cmd, args, { input: msg, encoding: 'utf8' });
        if (!r.error && r.status === 0) {
            console.log(`Copied via ${cmd}. Paste into Cursor chat.`);
            return;
        }
    }
    console.error('No clipboard helper found (install wl-copy or xclip). Message:\n\n' + msg);
    process.exit(1);
}

main();
