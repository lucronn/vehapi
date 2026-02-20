import { expect, test, describe, beforeEach, mock } from 'bun:test';

// Mock dependencies
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
}));

mock.module('../environments/environment', () => ({
    environment: {
        firebaseConfig: {
            apiKey: 'test-api-key',
            authDomain: 'test.firebaseapp.com',
        }
    }
}));

const mockApp = { name: '[DEFAULT]' };
const mockDb = { type: 'firestore' };
const mockAuth = { type: 'auth' };

// Create spies
const initializeAppSpy = mock(() => mockApp);
const getAppSpy = mock(() => mockApp);
const getAppsSpy = mock(() => []);
const getFirestoreSpy = mock(() => mockDb);
const getAuthSpy = mock(() => mockAuth);
const signInAnonymouslySpy = mock(() => Promise.resolve({ user: { uid: 'test-user' } }));

mock.module('firebase/app', () => ({
    initializeApp: initializeAppSpy,
    getApp: getAppSpy,
    getApps: getAppsSpy,
    FirebaseApp: class {}
}));

mock.module('firebase/firestore', () => ({
    getFirestore: getFirestoreSpy,
    doc: () => ({}),
    getDoc: async () => ({ exists: () => false }),
    setDoc: async () => {},
    Firestore: class {}
}));

mock.module('firebase/auth', () => ({
    getAuth: getAuthSpy,
    signInAnonymously: signInAnonymouslySpy
}));

describe('FirebaseService', () => {
    let FirebaseService: any;

    beforeEach(async () => {
        // Dynamic import to apply mocks
        const module = await import('./firebase.service');
        FirebaseService = module.FirebaseService;

        // Reset spies
        initializeAppSpy.mockClear();
        getAppSpy.mockClear();
        getAppsSpy.mockClear();
        getFirestoreSpy.mockClear();
        getAuthSpy.mockClear();
        signInAnonymouslySpy.mockClear();
    });

    test('should initialize auth and sign in anonymously', async () => {
        const service = new FirebaseService();
        expect(service).toBeDefined();

        // Verify that getAuth and signInAnonymously are called
        // Since the constructor is synchronous and calls async functions without await,
        // we can't easily wait for the promise unless we expose it or wait a bit.
        // However, the calls themselves happen synchronously in the constructor (the promise creation).

        // Wait for next tick to ensure promises might have started?
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(getAuthSpy).toHaveBeenCalled();
        expect(signInAnonymouslySpy).toHaveBeenCalled();
    });
});
