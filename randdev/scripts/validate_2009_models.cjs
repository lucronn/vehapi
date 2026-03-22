const fs = require('fs');
const { execSync } = require('child_process');

const BASE_URL = 'https://vehapiproxi.vercel.app';
const YEAR = 2009;

// Helper to fetch using curl
function get(url) {
    try {
        // console.log(`Fetching: ${url}`);
        // Use timeout of 10s
        const stdout = execSync(`curl -s --max-time 10 "${url}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return JSON.parse(stdout);
    } catch (err) {
        // console.error(`Curl failed for ${url}: ${err.message}`);
        throw err;
    }
}

async function validateVehicle(contentSource, vehicleId) {
    const url = `${BASE_URL}/api/source/${contentSource}/${vehicleId}/name`;
    try {
        const json = get(url);
        // Check if body is valid string or object
        return { success: true, name: json.body || 'Unknown' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function run() {
    console.log(`Starting validation for Year ${YEAR}...`);
    const results = [];

    try {
        // 1. Get Makes
        console.log(`Fetching makes for ${YEAR}...`);
        const makesRes = get(`${BASE_URL}/api/year/${YEAR}/makes`);
        const makes = makesRes.body;

        if (!makes || makes.length === 0) {
            console.error('No makes found!');
            return;
        }

        console.log(`Found ${makes.length} makes.`);

        // 2. Loop Makes
        for (const make of makes) {
            // console.log(`\nProcessing Make: ${make.makeName}...`); // Less verbose
            process.stdout.write(`Processing ${make.makeName}... `);

            try {
                const modelsRes = get(`${BASE_URL}/api/year/${YEAR}/make/${encodeURIComponent(make.makeName)}/models`);
                const modelsData = modelsRes.body;
                const models = modelsData.models;
                const contentSource = modelsData.contentSource || 'MOTOR';

                if (!models || models.length === 0) {
                    console.log(`NO MODELS`);
                    results.push({ make: make.makeName, status: 'NO_MODELS' });
                    continue;
                }

                // 3. Pick First Model
                const model = models[0];
                let vehicleId = model.id;
                let vehicleDisplayName = model.model;

                // Check engines
                if (model.engines && model.engines.length > 0) {
                    const engine = model.engines[0];
                    vehicleId = engine.id;
                    vehicleDisplayName = `${model.model} - ${engine.name}`;
                }

                // 4. Validate
                const validation = await validateVehicle(contentSource, vehicleId);

                const resultEntry = {
                    make: make.makeName,
                    model: vehicleDisplayName,
                    vehicleId: vehicleId,
                    contentSource: contentSource,
                    status: validation.success ? 'PASS' : 'FAIL',
                    details: validation.name || validation.error
                };

                results.push(resultEntry);
                console.log(`${resultEntry.status}`);

                // Small delay to be nice to API
                // await new Promise(r => setTimeout(r, 200)); 
                // execSync('sleep 0.1'); // Sync sleep if needed

            } catch (err) {
                console.log(`ERROR: ${err.message}`);
                results.push({ make: make.makeName, status: 'ERROR', details: err.message });
            }
        }

        // 5. Write Report
        console.log('\nGenerating Report...');
        let md = `# Vehicle Validation Report - ${YEAR}\n\n`;
        md += `**Total Makes:** ${makes.length}\n`;
        md += `**Passed:** ${results.filter(r => r.status === 'PASS').length}\n`;
        md += `**Failed:** ${results.filter(r => r.status !== 'PASS').length}\n\n`;

        md += `| Make | Model | Vehicle ID | Status | Details |\n`;
        md += `|---|---|---|---|---|\n`;

        for (const r of results) {
            md += `| ${r.make} | ${r.model || '-'} | ${r.vehicleId || '-'} | ${r.status === 'PASS' ? '✅ PASS' : '❌ ' + r.status} | ${r.details || ''} |\n`;
        }

        fs.writeFileSync('validation_results_2009.md', md);
        console.log('Report saved to validation_results_2009.md');

    } catch (err) {
        console.error('Fatal Error:', err);
    }
}

run();
