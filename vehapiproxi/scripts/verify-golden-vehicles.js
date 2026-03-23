#!/usr/bin/env node
/**
 * Run a repeatable golden-vehicle verification matrix and emit a markdown report.
 *
 * Each case runs the existing verify-evidence-links script with a representative
 * vehicle/source pair. Defaults are intentionally conservative and should be
 * overridden per environment with GOLDEN_VEHICLES_JSON or --cases.
 *
 * Usage:
 *   cd vehapiproxi && npm run verify:golden-vehicles -- --local
 *   GOLDEN_VEHICLES_JSON='[{"vehicle":"2854","source":"GeneralMotors","label":"GM"}]' npm run verify:golden-vehicles -- --local
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const verifyScript = path.join(__dirname, 'verify-evidence-links-one-article.js');
const reportDir = path.join(repoRoot, 'documentation', 'release-artifacts');

function parseArgs(argv) {
    const out = { local: false, cases: '' };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--local') {
            out.local = true;
        } else if (arg.startsWith('--cases=')) {
            out.cases = arg.slice('--cases='.length);
        } else if (arg === '--cases' && argv[i + 1]) {
            out.cases = argv[++i];
        }
    }
    return out;
}

function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function defaultCases() {
    return [
        { vehicle: '2854', source: 'GeneralMotors', label: 'GM representative' }
    ];
}

function parseCases(raw) {
    if (!raw) return defaultCases();
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : defaultCases();
    } catch {
        return defaultCases();
    }
}

function runCase(testCase, useLocal) {
    const args = [verifyScript, '--vehicle', String(testCase.vehicle)];
    if (testCase.source) {
        args.push('--source', String(testCase.source));
    }
    if (testCase.article) {
        args.push('--article', String(testCase.article));
    }
    if (useLocal) {
        args.push('--local');
    }

    const result = spawnSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '..'),
        env: process.env,
        encoding: 'utf8'
    });

    return {
        ...testCase,
        ok: result.status === 0,
        status: result.status ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };
}

function writeReport(results, useLocal) {
    fs.mkdirSync(reportDir, { recursive: true });
    const file = path.join(reportDir, `golden-vehicle-verification-${timestamp()}.md`);

    const lines = [
        '# Golden vehicle verification',
        '',
        `- Run mode: ${useLocal ? 'local proxy' : 'remote/deployed proxy'}`,
        `- Generated at: ${new Date().toISOString()}`,
        '',
        '| Case | Vehicle | Source | Result |',
        '|------|---------|--------|--------|'
    ];

    for (const result of results) {
        lines.push(
            `| ${result.label || 'unnamed'} | \`${result.vehicle}\` | \`${result.source || 'auto'}\` | ${result.ok ? 'PASS' : 'FAIL'} |`
        );
    }

    for (const result of results) {
        lines.push('');
        lines.push(`## ${result.label || `${result.vehicle} / ${result.source || 'auto'}`}`);
        lines.push('');
        lines.push(`- Vehicle: \`${result.vehicle}\``);
        lines.push(`- Source: \`${result.source || 'auto'}\``);
        lines.push(`- Exit status: \`${result.status}\``);
        lines.push(`- Result: ${result.ok ? 'PASS' : 'FAIL'}`);
        lines.push('');
        lines.push('```text');
        lines.push((result.stdout || result.stderr || '').trim() || '(no output)');
        lines.push('```');
    }

    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    return file;
}

function main() {
    const args = parseArgs(process.argv);
    const cases = parseCases(args.cases || process.env.GOLDEN_VEHICLES_JSON);
    const results = cases.map((testCase) => runCase(testCase, args.local));
    const reportPath = writeReport(results, args.local);

    console.log(`Golden vehicle report: ${reportPath}`);
    for (const result of results) {
        console.log(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.label || result.vehicle}`);
    }

    if (results.some((result) => !result.ok)) {
        process.exit(1);
    }
}

main();
