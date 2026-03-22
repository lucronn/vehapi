/**
 * Hammer GET /api/source/.../vehicle/.../article/... and expect 429 after ARTICLE_RATE_LIMIT_MAX
 * in the same window. Run proxy with tight limits, e.g.:
 *   set ARTICLE_RATE_LIMIT_MAX=5&& set ARTICLE_RATE_LIMIT_WINDOW_MS=60000&& node src/index.js
 * Then:
 *   node scripts/test-article-rate-limit.js
 */
import http from 'node:http';

const port = Number.parseInt(process.env.PROXY_PORT || '3001', 10);
const path =
    process.env.RATE_LIMIT_TEST_PATH ||
    '/api/source/MOTOR/vehicle/test%3Avehicle/article/testArticle/html';
const max = Number.parseInt(process.env.ARTICLE_RATE_LIMIT_MAX || '120', 10);
const want = max + 5;

function requestOnce() {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: '127.0.0.1', port, path, method: 'GET' },
            (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            }
        );
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    let saw429 = false;
    for (let i = 1; i <= want; i++) {
        const code = await requestOnce();
        if (code === 429) {
            saw429 = true;
            console.log(`Request ${i}: ${code} (rate limited)`);
            break;
        }
        console.log(`Request ${i}: ${code}`);
    }
    if (!saw429) {
        console.error(
            `Expected 429 within ${want} requests (ARTICLE_RATE_LIMIT_MAX=${max}). Is the proxy running on port ${port}?`
        );
        process.exit(1);
    }
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
