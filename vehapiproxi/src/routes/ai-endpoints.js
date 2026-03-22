import express from 'express';
import logger from '../logger.js';

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
            return res.status(503).json({ error: 'AI rewriting unavailable — set NVIDIA_API_KEY or LLM_API_KEY' });
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
            return res.status(503).json({ error: 'AI tutorial generation unavailable — set NVIDIA_API_KEY or LLM_API_KEY' });
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
                return res.status(503).json({ error: 'AI common issues unavailable — set NVIDIA_API_KEY or LLM_API_KEY' });
            }
            const issues = await generateCommonIssues(vehicleName);
            res.json({ issues }); // Return { issues: [...] } as expected by frontend
        } catch (err) {
            logger.error('AI common issues generation error:', err);
            res.status(500).json({ error: 'Common issues generation failed', message: err.message });
        }
    });
}
