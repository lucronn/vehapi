import express from 'express';
import logger from '../logger.js';
import {
    createCheckoutSession,
    createBillingPortalSession,
    handleWebhook,
    verifyAndFulfillSession
} from '../stripe.js';
import { getTransactions, getUserData, unlockModule } from '../credits.js';

export function registerCreditsEndpoints(app, secureAuthMiddleware) {
    app.get('/api/credits/balance', secureAuthMiddleware, async (req, res) => {
        try {
            const userData = await getUserData(req.userId);
            res.json({
                credits: userData.credits || 0,
                unlocks: userData.unlocks || {}
            });
        } catch (error) {
            logger.error('Error fetching balance:', error);
            res.status(500).json({ error: 'Failed to fetch balance' });
        }
    });

    app.post('/api/credits/checkout', express.json(), secureAuthMiddleware, async (req, res) => {
        try {
            const { amount, origin } = req.body;
            if (!amount || amount < 1000) {
                return res.status(400).json({ error: 'Minimum purchase is 1000 credits ($10)' });
            }
            const sessionUrl = await createCheckoutSession(req.userId, amount, origin || req.headers.origin);
            logger.info(`Checkout session created for user ${req.userId}, amount ${amount}`);
            res.json({ url: sessionUrl });
        } catch (error) {
            logger.error('Error creating checkout session:', error);
            res.status(500).json({ error: error.message || 'Failed to create checkout session' });
        }
    });

    app.post('/api/credits/portal', express.json(), secureAuthMiddleware, async (req, res) => {
        try {
            const userData = await getUserData(req.userId);
            const customerId = userData.stripe_customer_id || null;
            const origin = req.body?.origin || req.headers.origin || '';
            const returnUrl = `${origin}/#/credits`;
            const sessionUrl = await createBillingPortalSession(customerId, returnUrl);
            logger.info(`Billing portal session created for user ${req.userId}`);
            res.json({ url: sessionUrl });
        } catch (error) {
            logger.error('Error creating billing portal session:', error);
            res.status(400).json({ error: error.message || 'Unable to open billing. Make a purchase first to manage payment methods.' });
        }
    });

    app.post('/api/credits/unlock', express.json(), secureAuthMiddleware, async (req, res) => {
        try {
            const { vehicleId, vehicleName, moduleType, cost } = req.body;
            const userData = await unlockModule(req.userId, vehicleId, vehicleName || vehicleId, moduleType, cost);
            res.json({
                success: true,
                credits: userData.credits,
                unlocks: userData.unlocks
            });
        } catch (error) {
            logger.error('Error unlocking module:', error);
            res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/credits/transactions', secureAuthMiddleware, async (req, res) => {
        try {
            const limit = parseInt(req.query.limit, 10) || 50;
            const txns = await getTransactions(req.userId, limit);
            res.json({ transactions: txns });
        } catch (error) {
            logger.error('Error fetching transactions:', error);
            res.status(500).json({ error: 'Failed to fetch transaction history' });
        }
    });

    app.post('/api/credits/verify-session', express.json(), secureAuthMiddleware, async (req, res) => {
        try {
            const { sessionId } = req.body;
            if (!sessionId || typeof sessionId !== 'string') {
                return res.status(400).json({ error: 'sessionId is required' });
            }
            const result = await verifyAndFulfillSession(sessionId, req.userId);
            res.json(result);
        } catch (error) {
            logger.error('Error verifying checkout session:', error);
            res.status(500).json({ error: error.message || 'Failed to verify session' });
        }
    });

    app.post('/api/credits/webhook', express.raw({ type: 'application/json' }), handleWebhook);
}
