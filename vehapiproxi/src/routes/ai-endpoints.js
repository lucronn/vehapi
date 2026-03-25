import express from 'express';
import logger from '../logger.js';
import { getNemotronApiKey } from '../nemotron_client.js';

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
                    'If you set NVIDIA_API_KEY on Vercel, redeploy after adding env vars; ensure deps are installed (e.g. zod).',
                code: 'AI_MODULE_LOAD_FAILED'
            });
        }
        if (!getNemotronApiKey()) {
            return res.status(503).json({
                error:
                    'AI rewriting unavailable — no NVIDIA / LLM API key in process.env. ' +
                    'In Vercel: Project → Settings → Environment Variables → add NVIDIA_API_KEY or LLM_API_KEY for Production, then Redeploy. ' +
                    'Uploading a local .env file to the repo does not set Vercel runtime env.',
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
                    'AI tutorial generation unavailable — set NVIDIA_API_KEY or LLM_API_KEY on the server (Vercel env + Redeploy).',
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
    // Body: { vehicleMetadata: { vehicleName: string } }
    app.post('/api/common-issues/generate', express.json(), async (req, res) => {
        const { vehicleMetadata } = req.body || {};
        const vehicleName = vehicleMetadata?.vehicleName;

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
                        'AI common issues unavailable — set NVIDIA_API_KEY or LLM_API_KEY on the server (Vercel env + Redeploy).',
                    code: 'MISSING_LLM_KEY'
                });
            }
            const issues = await generateCommonIssues(vehicleName);
            res.json({ issues }); // Return { issues: [...] } as expected by frontend
        } catch (err) {
            logger.error('AI common issues generation error:', err);
            res.status(500).json({ error: 'Common issues generation failed', message: err.message });
        }
    });
}
