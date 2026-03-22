import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test';

// Mock @angular/core before importing the service
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    // Provide basic mocks for other Angular features to avoid conflicts with other tests
    signal: (val: any) => ({ set: () => { }, update: () => { }, asReadonly: () => { } }),
    computed: () => ({}),
    inject: () => ({}),
    WritableSignal: class { }
}));

describe('UserIdService', () => {
    let UserIdService: any;
    let localStorageStore: Record<string, string> = {};
    const STORAGE_KEY = 'torque_user_id';
    const originalCrypto = global.crypto;

    afterEach(() => {
        global.crypto = originalCrypto;
    });

    beforeEach(async () => {
        const module = await import('./user-id.service');
        UserIdService = module.UserIdService;
        localStorageStore = {};

        // Mock global localStorage
        global.localStorage = {
            getItem: (key: string) => localStorageStore[key] || null,
            setItem: (key: string, value: string) => { localStorageStore[key] = value.toString(); },
            removeItem: (key: string) => { delete localStorageStore[key]; },
            clear: () => { localStorageStore = {}; },
            key: (index: number) => Object.keys(localStorageStore)[index] || null,
            length: Object.keys(localStorageStore).length,
        } as Storage;

        // Mock global crypto
        global.crypto = {
            randomUUID: () => 'test-uuid-1234'
        } as any;
    });

    test('should generate and save a new ID if none exists in localStorage', () => {
        const service = new UserIdService();
        const userId = service.getUserId();

        expect(userId).toBe('test-uuid-1234');
        expect(localStorageStore[STORAGE_KEY]).toBe('test-uuid-1234');
    });

    test('should retrieve existing ID from localStorage if it exists', () => {
        const existingId = 'existing-user-5678';
        localStorageStore[STORAGE_KEY] = existingId;

        const service = new UserIdService();
        const userId = service.getUserId();

        expect(userId).toBe(existingId);
    });

    test('should return the same ID on multiple calls to getUserId', () => {
        const service = new UserIdService();
        const firstCall = service.getUserId();
        const secondCall = service.getUserId();

        expect(firstCall).toBe(secondCall);
    });

    test('should fallback to manual generation if crypto.randomUUID is not available', () => {
        // Remove randomUUID from crypto
        global.crypto = {} as any;

        const service = new UserIdService();
        const userId = service.getUserId();

        expect(userId).toStartWith('user_');
        expect(userId.length).toBeGreaterThan(10);
        expect(localStorageStore[STORAGE_KEY]).toBe(userId);
    });

    test('should handle environment where crypto is completely undefined', () => {
        // @ts-ignore
        global.crypto = undefined;

        const service = new UserIdService();
        const userId = service.getUserId();

        expect(userId).toStartWith('user_');
        expect(localStorageStore[STORAGE_KEY]).toBe(userId);
    });
});
