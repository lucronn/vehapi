#!/usr/bin/env node
/**
 * Assemble subagent prompts from a plan markdown + templates in docs/plans/subagent-prompts/.
 *
 * Usage:
 *   node scripts/subagent-prompt.mjs --list-tasks --plan docs/plans/2026-03-21-production-readiness-paid-plus-l2.md
 *   node scripts/subagent-prompt.mjs --plan docs/plans/...md --task 5 --role implementer --clipboard
 *   node scripts/subagent-prompt.mjs --plan docs/plans/...md --task 5 --role spec --report report.txt --clipboard
 *   node scripts/subagent-prompt.mjs --plan docs/plans/...md --task 5 --role quality --report report.txt --base-sha abc --head-sha def
 *
 * npm:
 *   npm run plan:prompt -- --list-tasks --plan docs/plans/2026-03-21-production-readiness-paid-plus-l2.md
 *   npm run plan:prompt -- --task 1 --role implementer --clipboard
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
    const out = {
        help: false,
        listTasks: false,
        plan: null,
        task: null,
        role: 'implementer',
        context: 'Torque: Angular 19 app in src/, proxy in vehapiproxi/. See AGENTS.md.',
        cwd: REPO_ROOT,
        clipboard: false,
        report: null,
        baseSha: '',
        headSha: ''
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') out.help = true;
        else if (a === '--list-tasks') out.listTasks = true;
        else if (a === '--clipboard' || a === '-c') out.clipboard = true;
        else if (a === '--plan') out.plan = path.resolve(REPO_ROOT, argv[++i]);
        else if (a === '--task') out.task = parseInt(argv[++i], 10);
        else if (a === '--role') out.role = argv[++i];
        else if (a === '--context') out.context = argv[++i];
        else if (a === '--cwd') out.cwd = path.resolve(argv[++i]);
        else if (a === '--report') out.report = path.resolve(REPO_ROOT, argv[++i]);
        else if (a === '--base-sha') out.baseSha = argv[++i];
        else if (a === '--head-sha') out.headSha = argv[++i];
    }
    return out;
}

function listTasks(md) {
    const re = /^### Task (\d+):\s*(.*)$/gm;
    const rows = [];
    let m;
    while ((m = re.exec(md)) !== null) {
        rows.push({ num: parseInt(m[1], 10), title: m[2].trim() });
    }
    return rows;
}

function extractTaskSection(md, taskNum) {
    const re = /^### Task (\d+):\s*(.*)$/gm;
    const matches = [...md.matchAll(re)];
    const idx = matches.findIndex((x) => x[1] === String(taskNum));
    if (idx < 0) return null;
    const start = matches[idx].index;
    const next = matches[idx + 1];
    const end = next ? next.index : md.length;
    const fullSection = md.slice(start, end).trim();
    const title = matches[idx][2].trim();
    const lines = fullSection.split(/\r?\n/);
    const body = lines.slice(1).join('\n').trim();
    return { title, body, fullSection };
}

function yamlIndentBlock(s, spaces) {
    const pad = ' '.repeat(spaces);
    return s
        .split(/\r?\n/)
        .map((line) => pad + line)
        .join('\n');
}

function buildImplementerPrompt({ taskNum, title, body, context, workdir }) {
    const bodyYaml = yamlIndentBlock(body, 4);
    const ctx = yamlIndentBlock(context, 4);
    return `Task tool (general-purpose):
  description: "Implement Task ${taskNum}: ${title}"
  prompt: |
    You are implementing Task ${taskNum}: ${title}

    ## Task Description

${bodyYaml}

    ## Context

${ctx}

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions
    - Anything unclear in the task description

    **Ask them now.** Raise any concerns before starting work.

    ## Your Job

    Once you're clear on requirements:
    1. Implement exactly what the task specifies
    2. Write tests (following TDD if task says to)
    3. Verify implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Report back

    Work from: ${workdir.replace(/\\/g, '/')}

    **While you work:** If you encounter something unexpected or unclear, **ask questions**.
    It's always OK to pause and clarify. Don't guess or make assumptions.

    ## Code Organization

    You reason best about code you can hold in context at once, and your edits are more
    reliable when files are focused. Keep this in mind:
    - Follow the file structure defined in the plan
    - Each file should have one clear responsibility with a well-defined interface
    - If a file you're creating is growing beyond the plan's intent, stop and report
      it as DONE_WITH_CONCERNS — don't split files on your own without plan guidance
    - If an existing file you're modifying is already large or tangled, work carefully
      and note it as a concern in your report
    - In existing codebases, follow established patterns. Improve code you're touching
      the way a good developer would, but don't restructure things outside your task.

    ## When You're in Over Your Head

    It is always OK to stop and say "this is too hard for me." Bad work is worse than
    no work. You will not be penalized for escalating.

    **STOP and escalate when:**
    - The task requires architectural decisions with multiple valid approaches
    - You need to understand code beyond what was provided and can't find clarity
    - You feel uncertain about whether your approach is correct
    - The task involves restructuring existing code in ways the plan didn't anticipate
    - You've been reading file after file trying to understand the system without progress

    **How to escalate:** Report back with status BLOCKED or NEEDS_CONTEXT. Describe
    specifically what you're stuck on, what you've tried, and what kind of help you need.

    ## Before Reporting Back: Self-Review

    Review your work with fresh eyes. Ask yourself:

    **Completeness:** Did I fully implement everything in the spec? Edge cases?

    **Quality:** Names, clarity, maintainability?

    **Discipline:** YAGNI — only what was requested?

    **Testing:** Real behavior verification?

    ## Report Format

    When done, report:
    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented (or what you attempted, if blocked)
    - What you tested and test results
    - Files changed
    - Self-review findings (if any)
    - Any issues or concerns
`;
}

function buildSpecPrompt({ taskNum, title, body, implementerReport }) {
    const req = yamlIndentBlock(body, 4);
    const rep = yamlIndentBlock(implementerReport, 4);
    return `Task tool (general-purpose):
  description: "Review spec compliance for Task ${taskNum}: ${title}"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

${req}

    ## What Implementer Claims They Built

${rep}

    ## CRITICAL: Do Not Trust the Report

    The implementer may be incomplete or optimistic. You MUST verify everything independently.

    **DO:** Read the actual code. Compare to requirements line by line.

    ## Your Job

    **Missing requirements:** Anything skipped or only claimed, not built?

    **Extra work:** Anything not in spec?

    **Misunderstandings:** Wrong problem or wrong shape?

    **Verify by reading code, not by trusting report.**

    Report:
    - ✅ Spec compliant (after code inspection)
    - ❌ Issues found: [what's missing or extra, file:line references]
`;
}

function buildQualityPrompt({ planPath, taskNum, title, body, report, baseSha, headSha }) {
    const sum = report.trim() || '(paste implementer report + file list here)';
    const req = body.trim();
    const shaLines = [baseSha ? `BASE_SHA: ${baseSha}` : null, headSha ? `HEAD_SHA: ${headSha}` : null]
        .filter(Boolean)
        .join('\n');
    return `You are doing a code quality review (not spec — spec already passed).

## Change summary
${sum}

## Task / plan
Task ${taskNum}: ${title}

${req}

Plan file: ${path.relative(REPO_ROOT, planPath)}
${shaLines ? `\n${shaLines}` : ''}

## Requirements
Read the diff or files and report:
- Strengths
- Issues: Critical / Important / Minor (with file:line)
- Suggestions for follow-up (optional)

Focus on: correctness risks, tests, naming, edge cases, security/sensitive data, and fit with existing Torque patterns (Angular standalone, vehapiproxi CommonJS, etc.).
`;
}

function copyToClipboard(text) {
    const tmp = path.join(os.tmpdir(), `subagent-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tmp, text, 'utf8');
    try {
        if (process.platform === 'win32') {
            const lit = tmp.replace(/'/g, "''");
            execSync(`powershell -NoProfile -Command "Get-Content -Raw -LiteralPath '${lit}' | Set-Clipboard"`, {
                stdio: 'inherit'
            });
        } else {
            try {
                execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'pipe', 'inherit'] });
            } catch {
                execSync('pbcopy', { input: text, stdio: ['pipe', 'pipe', 'inherit'] });
            }
        }
        console.error('[plan:prompt] Copied to clipboard.');
    } finally {
        try {
            fs.unlinkSync(tmp);
        } catch {
            /* ignore */
        }
    }
}

function printHelp() {
    console.log(`Usage:
  node scripts/subagent-prompt.mjs --list-tasks --plan <file>
  node scripts/subagent-prompt.mjs --plan <file> --task <n> --role implementer|spec|quality [options]

Options:
  --context <text>   Scene-setting for implementer (default: short Torque hint)
  --cwd <dir>        Work directory line in prompt (default: repo root)
  --report <file>    Implementer report (required for spec; optional for quality)
  --clipboard, -c    Copy output to clipboard (Windows / macOS / Linux with xclip)
  --base-sha --head-sha   Optional for quality review

Examples:
  npm run plan:prompt -- --list-tasks --plan docs/plans/2026-03-21-production-readiness-paid-plus-l2.md
  npm run plan:prompt -- --plan docs/plans/2026-03-21-production-readiness-paid-plus-l2.md --task 5 --role implementer --clipboard
`);
}

const args = parseArgs(process.argv);

if (args.help) {
    printHelp();
    process.exit(0);
}

const defaultPlan = path.join(
    REPO_ROOT,
    'docs',
    'plans',
    '2026-03-21-production-readiness-paid-plus-l2.md'
);
const planPath = args.plan || defaultPlan;

if (!fs.existsSync(planPath)) {
    console.error('Plan file not found:', planPath);
    process.exit(1);
}

const md = fs.readFileSync(planPath, 'utf8');

if (args.listTasks) {
    const tasks = listTasks(md);
    if (tasks.length === 0) {
        console.log('No ### Task N: sections found in', planPath);
    } else {
        console.log('Tasks in', path.relative(REPO_ROOT, planPath), '\n');
        for (const t of tasks) {
            console.log(`  ${t.num}. ${t.title}`);
        }
    }
    process.exit(0);
}

if (!args.task || Number.isNaN(args.task)) {
    console.error('Provide --task <number> (or use --list-tasks to see task numbers)');
    printHelp();
    process.exit(1);
}

const extracted = extractTaskSection(md, args.task);
if (!extracted) {
    console.error(`Task ${args.task} not found in plan`);
    process.exit(1);
}

const { title, body } = extracted;
let out = '';

if (args.role === 'implementer' || args.role === 'impl') {
    out = buildImplementerPrompt({
        taskNum: args.task,
        title,
        body,
        context: args.context,
        workdir: args.cwd
    });
} else if (args.role === 'spec') {
    let report = '(paste implementer report here)';
    if (args.report && fs.existsSync(args.report)) {
        report = fs.readFileSync(args.report, 'utf8');
    }
    out = buildSpecPrompt({
        taskNum: args.task,
        title,
        body,
        implementerReport: report
    });
} else if (args.role === 'quality' || args.role === 'code') {
    let report = '';
    if (args.report && fs.existsSync(args.report)) {
        report = fs.readFileSync(args.report, 'utf8');
    }
    out = buildQualityPrompt({
        planPath,
        taskNum: args.task,
        title,
        body,
        report,
        baseSha: args.baseSha,
        headSha: args.headSha
    });
} else {
    console.error('Unknown --role. Use: implementer | spec | quality');
    process.exit(1);
}

process.stdout.write(out);
if (!process.stdout.isTTY) {
    /* piped */
} else {
    console.error('\n---');
    console.error(`[plan:prompt] Task ${args.task} (${args.role}) — ${out.split('\n').length} lines`);
}

if (args.clipboard) {
    copyToClipboard(out);
}
