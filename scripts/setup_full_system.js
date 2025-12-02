const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set in .env');
    process.exit(1);
}

const ASSISTANTS = [
    { key: 'ADMIN_ASSISTANT_ID', manifest: 'admin_manifest.json' },
    { key: 'SEARCH_ASSISTANT_ID', manifest: 'search_manifest.json' },
    { key: 'ANALYZE_ASSISTANT_ID', manifest: 'analyze_manifest.json' },
    { key: 'CALC_ASSISTANT_ID', manifest: 'calc_manifest.json' }
];

async function setupAssistant(envKey, manifestFile) {
    const manifestPath = path.join(__dirname, `../config/${manifestFile}`);
    if (!fs.existsSync(manifestPath)) {
        console.error(`Manifest not found: ${manifestFile}`);
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const existingId = process.env[envKey];

    console.log(`\nProcessing ${manifest.name} (${envKey})...`);

    try {
        let assistant;
        if (existingId) {
            console.log(`Updating existing assistant: ${existingId}`);
            assistant = await callOpenAI(`/v1/assistants/${existingId}`, 'POST', manifest);
            console.log(`Updated: ${assistant.name}`);
        } else {
            console.log(`Creating NEW assistant...`);
            assistant = await callOpenAI('/v1/assistants', 'POST', manifest);
            console.log(`Created: ${assistant.name}`);
            console.log(`>>> ADD TO .ENV: ${envKey}=${assistant.id}`);
        }
    } catch (err) {
        console.error(`Failed to process ${manifest.name}:`, err);
    }
}

async function run() {
    for (const item of ASSISTANTS) {
        await setupAssistant(item.key, item.manifest);
    }
}

run();

function callOpenAI(pathname, method, payload) {
    const data = payload ? JSON.stringify(payload) : null;
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(`https://api.openai.com${pathname}`, options, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (!body) {
                    body = '{}';
                }
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch (err) {
                    return reject(new Error(`Failed to parse response: ${body}`));
                }
                if (res.statusCode >= 400) {
                    return reject(new Error(`OpenAI API error (${res.statusCode}): ${body}`));
                }
                resolve(parsed);
            });
        });
        req.on('error', reject);
        if (data) {
            req.write(data);
        }
        req.end();
    });
}
