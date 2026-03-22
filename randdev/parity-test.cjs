/**
 * Data Parity Test: Proxy vs sites.motor.com/m1
 * Compares API responses between local proxy and direct Motor API
 */

const https = require('https');

// Configuration
const PROXY_BASE = 'https://us-central1-vehapi-torque.cloudfunctions.net/motorApiAuthProxy';
const DIRECT_BASE = 'https://sites.motor.com/m1/connector';

// Endpoints to test
const TEST_ENDPOINTS = [
    '/api/years',
    '/api/year/2023/makes',
    '/api/year/2023/make/BMW/models',
];

// Helper to make HTTP GET requests
function httpGet(url, cookies = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
            }
        };

        if (cookies) {
            options.headers['Cookie'] = cookies;
        }

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data,
                        parseError: true
                    });
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// Get auth status and cookies from proxy
async function getAuthStatus() {
    console.log('\n📡 Fetching auth status from proxy...');
    const response = await httpGet(`${PROXY_BASE}/auth/status`);
    console.log(`   Status: ${response.body.status}`);
    console.log(`   Session Valid: ${response.body.sessionValid}`);
    console.log(`   Last Auth: ${new Date(response.body.lastAuth).toISOString()}`);

    // Extract set-cookie headers for direct API calls
    const cookies = response.headers['set-cookie'];
    return { authStatus: response.body, cookies };
}

// Compare two objects deeply
function deepCompare(obj1, obj2, path = '') {
    const differences = [];

    if (typeof obj1 !== typeof obj2) {
        differences.push({ path, type: 'type_mismatch', proxy: typeof obj1, direct: typeof obj2 });
        return differences;
    }

    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) {
            differences.push({ path, type: 'array_length', proxy: obj1.length, direct: obj2.length });
        }
        // Compare first few elements structure
        const compareCount = Math.min(3, obj1.length, obj2.length);
        for (let i = 0; i < compareCount; i++) {
            differences.push(...deepCompare(obj1[i], obj2[i], `${path}[${i}]`));
        }
        return differences;
    }

    if (typeof obj1 === 'object' && obj1 !== null && obj2 !== null) {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        const allKeys = new Set([...keys1, ...keys2]);

        for (const key of allKeys) {
            if (!(key in obj1)) {
                differences.push({ path: `${path}.${key}`, type: 'missing_in_proxy' });
            } else if (!(key in obj2)) {
                differences.push({ path: `${path}.${key}`, type: 'missing_in_direct' });
            } else {
                differences.push(...deepCompare(obj1[key], obj2[key], `${path}.${key}`));
            }
        }
        return differences;
    }

    if (obj1 !== obj2) {
        differences.push({ path, type: 'value_mismatch', proxy: obj1, direct: obj2 });
    }

    return differences;
}

// Test a single endpoint
async function testEndpoint(endpoint, cookies) {
    console.log(`\n🔍 Testing: ${endpoint}`);

    // Call proxy
    console.log('   Calling proxy...');
    const proxyResponse = await httpGet(`${PROXY_BASE}${endpoint}`);

    // Call direct API
    console.log('   Calling direct API...');
    const directResponse = await httpGet(`${DIRECT_BASE}${endpoint}`, cookies);

    // Compare
    const result = {
        endpoint,
        proxy: { status: proxyResponse.status, hasBody: !!proxyResponse.body },
        direct: { status: directResponse.status, hasBody: !!directResponse.body },
        match: false,
        differences: []
    };

    if (proxyResponse.status !== directResponse.status) {
        result.differences.push({
            type: 'status_mismatch',
            proxy: proxyResponse.status,
            direct: directResponse.status
        });
    }

    if (!proxyResponse.parseError && !directResponse.parseError) {
        const diffs = deepCompare(proxyResponse.body, directResponse.body);
        result.differences.push(...diffs);
        result.match = diffs.length === 0 && proxyResponse.status === directResponse.status;
    }

    // Display result
    if (result.match) {
        console.log(`   ✅ MATCH - Responses are identical`);
    } else {
        console.log(`   ❌ DIFFERENCES FOUND:`);
        result.differences.slice(0, 5).forEach(d => {
            console.log(`      - ${d.type}: ${d.path || ''} (proxy: ${d.proxy}, direct: ${d.direct})`);
        });
        if (result.differences.length > 5) {
            console.log(`      ... and ${result.differences.length - 5} more`);
        }
    }

    return result;
}

// Main execution
async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   DATA PARITY TEST: Proxy vs sites.motor.com/m1');
    console.log('═══════════════════════════════════════════════════════════');

    try {
        // Get auth
        const { authStatus, cookies } = await getAuthStatus();

        if (!authStatus.sessionValid) {
            console.log('\n⚠️  Session not valid - direct API calls may fail');
        }

        // Test each endpoint
        const results = [];
        for (const endpoint of TEST_ENDPOINTS) {
            const result = await testEndpoint(endpoint, cookies);
            results.push(result);
        }

        // Summary
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('   SUMMARY');
        console.log('═══════════════════════════════════════════════════════════');

        const passed = results.filter(r => r.match).length;
        const failed = results.filter(r => !r.match).length;

        console.log(`   ✅ Passed: ${passed}`);
        console.log(`   ❌ Failed: ${failed}`);
        console.log(`   Total: ${results.length}`);

        if (failed === 0) {
            console.log('\n🎉 All tests passed! Data parity confirmed.');
        } else {
            console.log('\n⚠️  Some tests failed. Check differences above.');
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

main();
