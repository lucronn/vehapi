
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import logger from './logger.js';

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
    initializeApp();
}

const db = getFirestore();
const USERS_COLLECTION = 'users';

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

        const userRef = db.collection(USERS_COLLECTION).doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            const newUser = {
                userId,
                credits: 0,
                createdAt: new Date().toISOString(),
                unlocks: {} // { vehicleId: ['specs', 'procedures', ...] }
            };
            await userRef.set(newUser);
            // Update cache
            userCache.set(userId, { data: newUser, timestamp: Date.now() });
            return newUser;
        }

        const data = doc.data();
        // Update cache
        userCache.set(userId, { data, timestamp: Date.now() });
        return data;
    } catch (error) {
        logger.error('Error fetching user data:', error);
        throw error;
    }
}

/**
 * Unlock a specific module for a vehicle
 */
export async function unlockModule(userId, vehicleId, moduleType, cost) {
    const userRef = db.collection(USERS_COLLECTION).doc(userId);

    try {
        const result = await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                throw new Error('User not found');
            }

            const userData = doc.data();
            const currentCredits = userData.credits || 0;

            // Check if already unlocked
            const currentUnlocks = userData.unlocks?.[vehicleId] || [];
            if (currentUnlocks.includes(moduleType) || currentUnlocks.includes('full')) {
                return userData; // Already unlocked
            }

            if (currentCredits < cost) {
                throw new Error('Insufficient credits');
            }

            // Deduct credits and add unlock
            const newUnlocks = { ...userData.unlocks };
            if (!newUnlocks[vehicleId]) {
                newUnlocks[vehicleId] = [];
            }
            newUnlocks[vehicleId].push(moduleType);

            t.update(userRef, {
                credits: currentCredits - cost,
                unlocks: newUnlocks
            });

            return {
                ...userData,
                credits: currentCredits - cost,
                unlocks: newUnlocks
            };
        });

        // Update cache with new state
        userCache.set(userId, { data: result, timestamp: Date.now() });

        return result;
    } catch (error) {
        logger.error('Error unlocking module:', error);
        throw error;
    }
}

/**
 * Add credits to user
 */
export async function addCredits(userId, amount) {
    const userRef = db.collection(USERS_COLLECTION).doc(userId);

    try {
        const result = await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);

            if (!doc.exists) {
                // Create user if they don't exist yet (e.g. first purchase)
                const newUser = {
                    userId,
                    credits: amount,
                    createdAt: new Date().toISOString(),
                    unlocks: {}
                };
                t.set(userRef, newUser);
                return newUser;
            } else {
                const userData = doc.data();
                const newCredits = (userData.credits || 0) + amount;
                t.update(userRef, {
                    credits: newCredits
                });
                return {
                    ...userData,
                    credits: newCredits
                };
            }
        });

        // Update cache
        userCache.set(userId, { data: result, timestamp: Date.now() });

        return result;
    } catch (error) {
        logger.error('Error adding credits:', error);
        throw error;
    }
}
