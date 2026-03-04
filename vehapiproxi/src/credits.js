import logger from './logger.js';

function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error("Missing Supabase credentials in environment");
    }
    return { url, key };
}

async function fetchSupabase(endpoint, options = {}) {
    const cfg = getSupabaseConfig();

    const headers = {
        'Content-Type': 'application/json',
        'apikey': cfg.key,
        'Authorization': `Bearer ${cfg.key}`,
        'Prefer': 'return=representation',
        ...(options.headers || {})
    };

    const response = await fetch(`${cfg.url}/rest/v1/${endpoint}`, {
        ...options,
        headers
    });

    if (!response.ok) {
        let errorText = await response.text();
        throw new Error(`Supabase API Error [${response.status}]: ${errorText}`);
    }

    if (response.status !== 204) {
        return response.json();
    }
    return null;
}

// Simple in-memory cache
const userCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Get user data or create if not exists
 */
export async function getUserData(userId) {
    try {
        // Check cache first
        const cached = userCache.get(userId);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            return cached.data;
        }

        const users = await fetchSupabase(`users?id=eq.${userId}&select=*`);

        if (!users || users.length === 0) {
            const newUser = {
                id: userId,
                credits: 0,
                unlocks: {}
            };

            const inserted = await fetchSupabase(`users`, {
                method: 'POST',
                body: JSON.stringify(newUser)
            });

            const result = inserted[0];
            userCache.set(userId, { data: result, timestamp: Date.now() });
            return result;
        }

        const result = users[0];
        userCache.set(userId, { data: result, timestamp: Date.now() });
        return result;
    } catch (error) {
        logger.error('Error fetching user data from Supabase:', error);
        throw error;
    }
}

/**
 * Log a transaction (purchase or unlock)
 */
export async function logTransaction(userId, { amount, type, stripeSessionId, stripePaymentIntent, usdCents, vehicleId, vehicleName, moduleType }) {
    try {
        await fetchSupabase(`transactions`, {
            method: 'POST',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({
                user_id: userId,
                amount,
                type,
                stripe_session_id: stripeSessionId || null,
                stripe_payment_intent: stripePaymentIntent || null,
                usd_cents: usdCents || null,
                vehicle_id: vehicleId || null,
                vehicle_name: vehicleName || null,
                module_type: moduleType || null
            })
        });
    } catch (error) {
        // Non-fatal — don't fail the main operation if logging fails
        logger.error('Failed to log transaction:', error);
    }
}

/**
 * Get user transaction history
 */
export async function getTransactions(userId, limit = 50) {
    try {
        const rows = await fetchSupabase(
            `transactions?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&select=*`
        );
        return rows || [];
    } catch (error) {
        logger.error('Error fetching transactions:', error);
        throw error;
    }
}

/**
 * Unlock a specific module for a vehicle
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
        if (!newUnlocks[vehicleId]) {
            newUnlocks[vehicleId] = [];
        }
        newUnlocks[vehicleId].push(moduleType);

        const updated = await fetchSupabase(`users?id=eq.${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                credits: currentCredits - cost,
                unlocks: newUnlocks
            })
        });

        // Log the unlock transaction (non-fatal)
        await logTransaction(userId, {
            amount: -cost,
            type: 'unlock',
            vehicleId,
            vehicleName,
            moduleType
        });

        const result = updated[0];
        userCache.set(userId, { data: result, timestamp: Date.now() });
        return result;
    } catch (error) {
        logger.error('Error unlocking module:', error);
        throw error;
    }
}

/**
 * Add credits to user. Idempotent when stripeSessionId is provided —
 * skips if a purchase transaction for that session already exists.
 */
export async function addCredits(userId, amount, { stripeSessionId, stripePaymentIntent, usdCents } = {}) {
    try {
        if (stripeSessionId) {
            const existing = await fetchSupabase(
                `transactions?user_id=eq.${userId}&stripe_session_id=eq.${stripeSessionId}&type=eq.purchase&select=id&limit=1`
            );
            if (existing && existing.length > 0) {
                logger.info(`Skipping duplicate addCredits for session ${stripeSessionId}`);
                const userData = await getUserData(userId);
                return userData;
            }
        }

        const userData = await getUserData(userId);
        const currentCredits = userData.credits || 0;

        const updated = await fetchSupabase(`users?id=eq.${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                credits: currentCredits + amount
            })
        });

        await logTransaction(userId, {
            amount,
            type: 'purchase',
            stripeSessionId,
            stripePaymentIntent,
            usdCents
        });

        const result = updated[0];
        userCache.set(userId, { data: result, timestamp: Date.now() });
        return result;
    } catch (error) {
        logger.error('Error adding credits:', error);
        throw error;
    }
}

/**
 * Store stripe_customer_id on user record
 */
export async function setStripeCustomerId(userId, stripeCustomerId) {
    try {
        await fetchSupabase(`users?id=eq.${userId}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ stripe_customer_id: stripeCustomerId })
        });
    } catch (error) {
        logger.error('Error setting stripe_customer_id:', error);
    }
}
