import express from 'express';
import logger from '../logger.js';
import { getNemotronApiKey } from '../nemotron_client.js';
import { dbQuery, isDbConfigured } from '../db.js';

const CONTEXT_TOKEN_CAP = 2000;

async function buildVehicleContext(vehicleId) {
    if (!vehicleId || !isDbConfigured()) return null;

    async function query(table, cols, limit = 20) {
        try {
            const colList = cols.split(',').map(c => `"${c.trim()}"`).join(', ');
            const { rows } = await dbQuery(
                `SELECT ${colList} FROM "${table}" WHERE vehicle_id = $1 LIMIT $2`,
                [vehicleId, limit]
            );
            return rows;
        } catch { return []; }
    }

    const [dtcs, tsbs, procedures, specs, maintenance] = await Promise.all([
        query('dtcs', 'code,description,symptoms', 15),
        query('tsbs', 'bulletin_number,title,summary', 10),
        query('procedures', 'title,description', 15),
        query('specifications', 'category,name,value,unit', 20),
        query('maintenance_task', 'interval_value,action,item,description', 15),
    ]);

    const sections = [];
    let charCount = 0;
    const cap = CONTEXT_TOKEN_CAP * 4;

    function addSection(label, rows, formatter) {
        if (!rows?.length || charCount > cap) return;
        const items = rows.map(formatter).filter(Boolean);
        if (!items.length) return;
        const block = `[${label}]\n${items.join('\n')}`;
        charCount += block.length;
        sections.push(block);
    }

    addSection('Known DTCs', dtcs, r => `- ${r.code}: ${(r.description || '').slice(0, 120)}`);
    addSection('Technical Service Bulletins', tsbs, r => `- ${r.bulletin_number || ''}: ${(r.title || r.summary || '').slice(0, 120)}`);
    addSection('Repair Procedures', procedures, r => `- ${(r.title || '').slice(0, 100)}`);
    addSection('Specifications', specs, r => `- ${r.category}/${r.name}: ${r.value}${r.unit ? ' ' + r.unit : ''}`);
    addSection('Maintenance', maintenance, r => `- ${r.action || r.item || ''}: ${(r.description || '').slice(0, 100)} (${r.interval_value || ''})`);

    return sections.length ? sections.join('\n\n') : null;
}

export function registerAiEndpoints(app, getAiFunctions) {
    // POST /api/rewrite — rewrites article HTML text content via Nemotron (NVIDIA)
    // Body: { html: string, title?: string }
    // Returns: { html: string } or error
    app.post('/api/rewrite', express.json({ limit: '256kb' }), async (req, res) => {
        const { html, title } = req.body || {};
        if (!html || typeof html !== 'string') {
            return res.status(400).json({ error: 'html field is required' });
        }

        const { rewriteArticleHtml } = await getAiFunctions();
        if (!rewriteArticleHtml) {
            return res.status(503).json({
                error:
                    'AI rewriting unavailable — the AI module failed to load (see server logs). ' +
                    'Ensure GOOGLE_CLOUD_PROJECT is set and the Cloud Run service account has Vertex AI access.',
                code: 'AI_MODULE_LOAD_FAILED'
            });
        }
        if (!getNemotronApiKey()) {
            return res.status(503).json({
                error:
                    'AI rewriting unavailable — set GOOGLE_CLOUD_PROJECT and ensure the service account has the Vertex AI User role.',
                code: 'MISSING_LLM_KEY'
            });
        }

        try {
            const rewritten = await rewriteArticleHtml(html, title || '');
            res.json({ html: rewritten });
        } catch (err) {
            logger.error('AI rewrite error:', err);
            res.status(500).json({ error: 'AI rewrite failed', message: err.message });
        }
    });

    // POST /api/tutorials/generate — generates tutorial steps from article HTML via Nemotron (NVIDIA)
    // Body: { html: string, title?: string }
    // Returns: { steps: TutorialStep[] } or error
    app.post('/api/tutorials/generate', express.json({ limit: '256kb' }), async (req, res) => {
        const { html, title } = req.body || {};
        if (!html || typeof html !== 'string') {
            return res.status(400).json({ error: 'html field is required' });
        }

        const { generateTutorialSteps } = await getAiFunctions();
        if (!generateTutorialSteps) {
            return res.status(503).json({
                error: 'AI tutorial generation unavailable — AI module failed to load (see server logs).',
                code: 'AI_MODULE_LOAD_FAILED'
            });
        }
        if (!getNemotronApiKey()) {
            return res.status(503).json({
                error:
                    'AI tutorial generation unavailable — set GOOGLE_CLOUD_PROJECT and ensure the service account has the Vertex AI User role.',
                code: 'MISSING_LLM_KEY'
            });
        }

        try {
            const steps = await generateTutorialSteps(html, title || '');
            res.json({ steps });
        } catch (err) {
            logger.error('AI tutorial generation error:', err);
            res.status(500).json({ error: 'Tutorial generation failed', message: err.message });
        }
    });

    // POST /api/common-issues/generate — generates common issues via Nemotron (NVIDIA)
    // Body: { vehicleMetadata: { vehicleName: string, vehicleId?: string } }
    app.post('/api/common-issues/generate', express.json(), async (req, res) => {
        const { vehicleMetadata } = req.body || {};
        const vehicleName = vehicleMetadata?.vehicleName;
        const vehicleId = vehicleMetadata?.vehicleId;

        if (!vehicleName) {
            return res.status(400).json({ error: 'vehicleName field is required inside vehicleMetadata' });
        }

        try {
            const { generateCommonIssues } = await getAiFunctions();
            if (!generateCommonIssues) {
                return res.status(503).json({
                    error: 'AI common issues unavailable — AI module failed to load (see server logs).',
                    code: 'AI_MODULE_LOAD_FAILED'
                });
            }
            if (!getNemotronApiKey()) {
                return res.status(503).json({
                    error:
                        'AI common issues unavailable — set GOOGLE_CLOUD_PROJECT and ensure the service account has the Vertex AI User role.',
                    code: 'MISSING_LLM_KEY'
                });
            }
            let vehicleContext = null;
            if (vehicleId) {
                try { vehicleContext = await buildVehicleContext(vehicleId); }
                catch (e) { logger.warn('buildVehicleContext failed, continuing without context:', e.message); }
            }
            const issues = await generateCommonIssues(vehicleName, vehicleContext);
            res.json({ issues });
        } catch (err) {
            logger.error('AI common issues generation error:', err);
            res.status(500).json({ error: 'Common issues generation failed', message: err.message });
        }
    });
}
