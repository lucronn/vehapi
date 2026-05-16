import logger from './logger.js';
import { dbQuery, isDbConfigured } from './db.js';

// Simple in-memory cache
const userCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Get user data or create if not exists.
 * @param {string} userId
 * @param {{ skipCache?: boolean }} [options]
 */
export async function getUserData(userId, options = {}) {
    try {
        const skipCache = options.skipCache === true;
        if (!skipCache) {
            const cached = userCache.get(userId);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                return cached.data;
            }
        }

        const { rows } = await dbQuery(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);

        if (rows.length === 0) {
            const { rows: inserted } = await dbQuery(
                `INSERT INTO users (id, credits, unlocks) VALUES ($1, 0, '{}'::jsonb)
                 ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
                 RETURNING *`,
                [userId]
            );
            const result = inserted[0];
            userCache.set(userId, { data: result, timestamp: Date.now() });
            return result;
        }

        const result = rows[0];
        userCache.set(userId, { data: result, timestamp: Date.now() });
        return result;
    } catch (error) {
        logger.error('Error fetching user data:', error);
        throw error;
    }
}

/**
 * Log a transaction (purchase or unlock).
 */
export async function logTransaction(userId, { amount, type, stripeSessionId, stripePaymentIntent, usdCents, vehicleId, vehicleName, moduleType }) {
    try {
        await dbQuery(
            `INSERT INTO transactions
             (user_id, amount, type, stripe_session_id, stripe_payment_intent, usd_cents, vehicle_id, vehicle_name, module_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                userId,
                amount,
                type,
                stripeSessionId || null,
                stripePaymentIntent || null,
                usdCents || null,
                vehicleId || null,
                vehicleName || null,
                moduleType || null,
            ]
        );
    } catch (error) {
        // Non-fatal
        logger.error('Failed to log transaction:', error);
    }
}

/**
 * Get user transaction history.
 */
export async function getTransactions(userId, limit = 50) {
    try {
        const { rows } = await dbQuery(
            `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [userId, limit]
        );
        return rows;
    } catch (error) {
        logger.error('Error fetching transactions:', error);
        throw error;
    }
}

/**
 * Unlock a specific module for a vehicle.
 */
export async function unlockModule(userId, vehicleId, vehicleName, moduleType, cost) {
    try {
        const userData = await getUserData(userId);
        const currentCredits = userData.credits || 0;

        const currentUnlocks = userData.unlocks?.[vehicleId] || [];
        if (currentUnlocks.includes(moduleType) || currentUnlocks.includes('full')) {
            return userData;
        }

        if (currentCredits < cost) {
            throw new Error('Insufficient credits');
        }

        const newUnlocks = { ...userData.unlocks };
        if (!newUnlocks[vehicleId]) newUnlocks[vehicleId] = [];
        newUnlocks[vehicleId].push(moduleType);

        const { rows: updated } = await dbQuery(
            `UPDATE users SET credits = $1, unlocks = $2::jsonb WHERE id = $3 RETURNING *`,
            [currentCredits - cost, JSON.stringify(newUnlocks), userId]
        );

        await logTransaction(userId, { amount: -cost, type: 'unlock', vehicleId, vehicleName, moduleType });

        const result = updated[0];
        userCache.set(userId, { data: result, timestamp: Date.now() });
        return result;
    } catch (error) {
        logger.error('Error unlocking module:', error);
        throw error;
    }
}

/**
 * Add credits to user. Idempotent when stripeSessionId is provided.
 */
export async function addCredits(userId, amount, { stripeSessionId, stripePaymentIntent, usdCents } = {}) {
    try {
        if (stripeSessionId) {
            const { rows: existing } = await dbQuery(
                `SELECT id FROM transactions WHERE user_id = $1 AND stripe_session_id = $2 AND type = 'purchase' LIMIT 1`,
                [userId, stripeSessionId]
            );
            if (existing.length > 0) {
                logger.info(`Skipping duplicate addCredits for session ${stripeSessionId}`);
                return getUserData(userId);
            }
        }

        const userData = await getUserData(userId);
        const currentCredits = userData.credits || 0;

        const { rows: updated } = await dbQuery(
            `UPDATE users SET credits = $1 WHERE id = $2 RETURNING *`,
            [currentCredits + amount, userId]
        );

        await logTransaction(userId, { amount, type: 'purchase', stripeSessionId, stripePaymentIntent, usdCents });

        const result = updated[0];
        userCache.set(userId, { data: result, timestamp: Date.now() });
        return result;
    } catch (error) {
        logger.error('Error adding credits:', error);
        throw error;
    }
}

/**
 * Store stripe_customer_id on user record.
 */
export async function setStripeCustomerId(userId, stripeCustomerId) {
    try {
        await dbQuery(
            `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
            [stripeCustomerId, userId]
        );
    } catch (error) {
        logger.error('Error setting stripe_customer_id:', error);
    }
}
