const targetUrl = 'https://vehapiproxi.vercel.app/api/source/MOTOR/vehicle/66966:2600/article/P:163980302';

async function testCache() {
    console.log("Fetching article...");
    // Include user-id header to bypass auth middleware properly if it's strictly enforced, though it should be options/referer protected mostly.
    const res = await fetch(targetUrl, {
        headers: {
            'x-user-id': 'test-user-123'
        }
    });

    console.log(`Status: ${res.status}`);
    const data = await res.json();
    console.log("Is from cache?", data.header?.fromCache);
    if (!data.header?.fromCache) {
        console.log("Wait a few seconds for background worker to parse and cache, then run again.");
    } else {
        console.log("SUCCESS! Served from AI Cache.");
    }
}

testCache();
