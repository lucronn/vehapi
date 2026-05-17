#!/usr/bin/env node
/**
 * Drive EBSCO's "prompted" login flow end-to-end for a (custId, libraryCard)
 * pair, capture the resulting sites.motor.com session cookies, and write them
 * into sessions.json under the given session name.
 *
 * Flow stages:
 *   1. GET  login.ebsco.com?custId=...&groupId=...&profId=...      → captures osano/session cookies + parses authRequest JWT
 *   2. POST login.ebsco.com/api/login/v1/prompted/next-step        → returns a redirect URL with auth code
 *   3. GET  redirectUri (eventually → search.ebscohost.com/.../PromptedCallback.aspx)
 *   4. Follow all redirects until we land on sites.motor.com/m1/* and capture cookies
 *
 * Usage:
 *   node scripts/refresh-ebsco-session.mjs --custId=ns145344 --card=02940 --name=trial-ns145344
 *   node scripts/refresh-ebsco-session.mjs --custId=s5672256 --card=<card> --name=trial-s5672256
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_PATH = path.join(__dirname, '..', 'sessions.json');

const arg = (n, def) => {
    const hit = process.argv.find(a => a.startsWith(`--${n}=`));
    return hit ? hit.split('=').slice(1).join('=') : def;
};
const CUST_ID = arg('custId');
const CARD    = arg('card');
const NAME    = arg('name', `trial-${CUST_ID}`);
const GROUP   = arg('groupId', 'main');
const PROF    = arg('profId', 'autorepso');
const ACTION  = arg('action', 'signin');     // 'signin' (cpid,uid) or 'continue' (uid only)
const ACR     = arg('acr',    'cpid,uid');   // EBSCO acr_values: 'cpid,uid' or 'uid'

if (!CUST_ID || !CARD) {
    console.error('Usage: --custId=<id> --card=<library_card> [--name=<sessionName>]');
    process.exit(1);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

// ─── Cookie jar ──────────────────────────────────────────────────────────────
class Jar {
    constructor() { this.cookies = new Map(); } // key: host+name → { value, domain }
    setFromHeaders(setCookies, hostname) {
        for (const c of setCookies) {
            const [first, ...rest] = c.split(';');
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            const name = first.slice(0, eq).trim();
            const value = first.slice(eq + 1).trim();
            let domain = hostname;
            for (const part of rest) {
                const [k, v] = part.split('=').map(s => s.trim());
                if (k?.toLowerCase() === 'domain' && v) domain = v.replace(/^\./, '');
            }
            this.cookies.set(`${domain}|${name}`, { value, domain });
        }
    }
    headerFor(hostname) {
        const out = [];
        for (const [, { value, domain }] of this.cookies) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                // include name + value
            }
        }
        // simpler: walk again so we get the names
        const entries = [];
        for (const [key, { value, domain }] of this.cookies) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                const name = key.split('|').slice(1).join('|');
                entries.push(`${name}=${value}`);
            }
        }
        return entries.join('; ');
    }
    forDomain(domain) {
        const out = [];
        for (const [key, val] of this.cookies) {
            if (val.domain === domain) {
                out.push(`${key.split('|').slice(1).join('|')}=${val.value}`);
            }
        }
        return out.join('; ');
    }
}

// fetch wrapper that auto-handles redirects + cookies
async function get(jar, url, extraHeaders = {}, maxRedirects = 12) {
    let current = url;
    let lastRes = null;
    for (let i = 0; i < maxRedirects; i++) {
        const u = new URL(current);
        const cookieHeader = jar.headerFor(u.hostname);
        const res = await fetch(current, {
            method: 'GET',
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': UA,
                ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                ...extraHeaders,
            },
            redirect: 'manual',
        });
        const setCookies = res.headers.getSetCookie?.() || [];
        if (setCookies.length) jar.setFromHeaders(setCookies, u.hostname);
        console.log(`  [${res.status}] ${u.hostname}${u.pathname}${u.search ? '?…' : ''}  (cookies: ${setCookies.length ? setCookies.map(c => c.split('=')[0]).join(',') : '-'})`);
        lastRes = res;
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location');
            if (!loc) break;
            current = new URL(loc, current).toString();
            continue;
        }
        break;
    }
    return { res: lastRes, finalUrl: current };
}

// ─── Stage 1: get login page, extract authRequest JWT ────────────────────────
const jar = new Jar();
const loginUrl = `https://login.ebsco.com/?custId=${CUST_ID}&groupId=${GROUP}&profId=${PROF}&acrValues=${encodeURIComponent(ACR)}`;
console.log(`\n=== Stage 1: GET login page (custId=${CUST_ID}) ===`);
const stage1 = await get(jar, loginUrl);
const html = await stage1.res.text();
// The authRequest JWT lives in the URL after a redirect, OR in a hidden config script
let authRequest = new URL(stage1.finalUrl).searchParams.get('authRequest');
let requestIdentifier = new URL(stage1.finalUrl).searchParams.get('requestIdentifier');
let redirectUri = new URL(stage1.finalUrl).searchParams.get('redirect_uri');
if (!authRequest) {
    // Try to extract from page HTML (sometimes it's embedded in config JSON)
    const m = html.match(/authRequest["':\s]+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/);
    if (m) authRequest = m[1];
}
if (!requestIdentifier) {
    const m = html.match(/requestIdentifier["':\s]+([a-f0-9\-]{36})/i);
    if (m) requestIdentifier = m[1];
}
if (!authRequest || !requestIdentifier) {
    console.error('\n✗ Could not extract authRequest / requestIdentifier from login page.');
    console.error('  finalUrl:', stage1.finalUrl);
    process.exit(2);
}
console.log(`  ✓ authRequest JWT captured (${authRequest.length} chars)`);
console.log(`  ✓ requestIdentifier: ${requestIdentifier}`);

// ─── Stage 2: POST next-step with library card ───────────────────────────────
console.log(`\n=== Stage 2: POST next-step (card=${CARD}) ===`);
const nextStepBody = {
    action: ACTION,
    context: {
        original: {
            authType: ACR,
            customerId: CUST_ID,
            groupId: GROUP,
            profId: PROF,
            opid: null,
            language: '',
            requestIdentifier,
            redirectUri: redirectUri || 'https://logon.ebsco.zone/api/dispatcher/continue/prompted',
            showonlyspecifiedtypes: false,
            isSimplified: false,
            authRequest,
            authToken: '',
        },
    },
    values: { prompt: CARD, passwordPrompt: '' },
};
const loginHost = 'login.ebsco.com';
const ns = await fetch('https://login.ebsco.com/api/login/v1/prompted/next-step', {
    method: 'POST',
    headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Cookie: jar.forDomain(loginHost),
        Referer: stage1.finalUrl,
    },
    body: JSON.stringify(nextStepBody),
});
const nsSetCookies = ns.headers.getSetCookie?.() || [];
if (nsSetCookies.length) jar.setFromHeaders(nsSetCookies, loginHost);
const nsJson = await ns.json().catch(() => null);
console.log(`  [${ns.status}] next-step | cookies: ${nsSetCookies.map(c => c.split('=')[0]).join(',') || '-'}`);
if (!nsJson) {
    console.error('  ✗ no JSON body'); process.exit(3);
}
console.log('  response keys:', Object.keys(nsJson));
const nextUrl = nsJson.nextUrl || nsJson.redirectUrl || nsJson.continueUrl || nsJson.url
    || nsJson.context?.redirectUri || nsJson.context?.continueUrl;
if (!nextUrl) {
    console.error('  ✗ no redirect url in response:', JSON.stringify(nsJson).slice(0, 400));
    process.exit(4);
}
console.log(`  ✓ next URL: ${nextUrl.slice(0, 100)}...`);

// ─── Stage 3: follow the redirect chain into Motor ───────────────────────────
console.log(`\n=== Stage 3: follow redirect chain into sites.motor.com ===`);
let stage3 = await get(jar, nextUrl, { Referer: 'https://login.ebsco.com/' });

// If we landed on Community.aspx (user has multiple profiles) — append the
// profid params to auto-route into the autorepso (Motor) profile.
if (/Community\.aspx/i.test(stage3.finalUrl) && !stage3.finalUrl.includes('profid=')) {
    const sep = stage3.finalUrl.includes('?') ? '&' : '?';
    const directUrl = `${stage3.finalUrl}${sep}authpid=${PROF}&profid=${PROF}`;
    console.log(`\n  Community.aspx landing — re-routing to profile ${PROF}`);
    stage3 = await get(jar, directUrl, { Referer: stage3.finalUrl });
}

// ─── Verify: look for motor.com session cookies ──────────────────────────────
const motorCookies = jar.forDomain('sites.motor.com');
console.log(`\n=== Verification ===`);
console.log(`  motor cookies length: ${motorCookies.length}`);
if (!motorCookies || !motorCookies.includes('.AspNetCore.Cookies') || !motorCookies.includes('AuthUserInfo')) {
    console.error('  ✗ did not capture full Motor session (missing .AspNetCore.Cookies or AuthUserInfo)');
    console.error('  final URL was:', stage3.finalUrl);
    process.exit(5);
}

// Smoke-test the new session
const testRes = await fetch('https://sites.motor.com/m1/api/source/MOTOR/vehicle/240542:15305/articles/v2', {
    headers: {
        Accept: 'application/json',
        Cookie: motorCookies,
        Origin: 'https://sites.motor.com',
        Referer: 'https://sites.motor.com/m1/',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': UA,
    },
});
console.log(`  smoke test → ${testRes.status}`);
if (testRes.status !== 200) {
    console.error('  ✗ session captured but Motor rejected it');
    process.exit(6);
}

// ─── Write to sessions.json ──────────────────────────────────────────────────
const cfg = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
const existing = cfg.sessions.findIndex(s => s.name === NAME);
const entry = { name: NAME, cookie: motorCookies };
if (existing >= 0) cfg.sessions[existing] = entry;
else cfg.sessions.push(entry);
fs.writeFileSync(SESSIONS_PATH, JSON.stringify(cfg, null, 2));
console.log(`\n✓ Wrote session "${NAME}" to sessions.json (${motorCookies.length} chars)`);
