const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MANIFEST_PATH = path.join(__dirname, '../config/admin_manifest.json');

if (!OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set in .env');
    process.exit(1);
}

async function setupAdminAssistant() {
    try {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        console.log(`Reading manifest from ${MANIFEST_PATH}...`);

        // Check if we already have an ID to update, or create new
        const existingId = process.env.ADMIN_ASSISTANT_ID;
        let assistant;

        if (existingId) {
            console.log(`Updating existing assistant: ${existingId}`);
            assistant = await callOpenAI(`/v1/assistants/${existingId}`, 'POST', manifest);
            console.log('Successfully updated Admin Assistant.');
        } else {
            console.log('Creating NEW Admin Assistant...');
            assistant = await callOpenAI('/v1/assistants', 'POST', manifest);
            console.log('Successfully created Admin Assistant.');
            console.log(`\n>>> IMPORTANT: Add this ID to your .env file:\nADMIN_ASSISTANT_ID=${assistant.id}\n`);
        }

        console.log('Assistant Details:', {
            id: assistant.id,
            name: assistant.name,
            model: assistant.model
        });

    } catch (err) {
        console.error('Setup failed:', err);
    }
}

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

setupAdminAssistant();
