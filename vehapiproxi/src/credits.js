
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import logger from './logger.js';

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
    initializeApp();
}

const db = getFirestore();
const USERS_COLLECTION = 'users';

/**
 * Get user data or create if not exists
 */
export async function getUserData(userId) {
    try {
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
            return newUser;
        }

        return doc.data();
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
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                throw new Error('User not found');
            }

            const userData = doc.data();
            const currentCredits = userData.credits || 0;

            // Check if already unlocked
            const currentUnlocks = userData.unlocks?.[vehicleId] || [];
            if (currentUnlocks.includes(moduleType) || currentUnlocks.includes('full')) {
                return; // Already unlocked
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
        });

        return await getUserData(userId);
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
        await db.runTransaction(async (t) => {
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
            } else {
                const userData = doc.data();
                t.update(userRef, {
                    credits: (userData.credits || 0) + amount
                });
            }
        });

        return await getUserData(userId);
    } catch (error) {
        logger.error('Error adding credits:', error);
        throw error;
    }
}
