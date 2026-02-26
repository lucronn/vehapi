import { expect, test, describe, beforeEach, afterEach, mock } from 'bun:test';
import { PersistedVehicle } from '../models/motor.models';

// Mock @angular/core
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
}));

describe('VehiclePersistenceService', () => {
    let VehiclePersistenceService: any;
    let localStorageStore: Record<string, string> = {};
    const STORAGE_KEY = 'torque-persisted-vehicle';

    // Test data
    const mockVehicle: PersistedVehicle = {
        vehicleId: 'test-vehicle-123',
        contentSource: 'MOTOR',
        name: '2023 BMW X5'
    };

    beforeEach(async () => {
        // Reset storage before each test
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

        // Import service after mocking dependencies
        const module = await import('./vehicle-persistence.service');
        VehiclePersistenceService = module.VehiclePersistenceService;
    });

    afterEach(() => {
        // Clean up global mocks if necessary
        // In this case, we're redefining global.localStorage in beforeEach,
        // so strictly speaking we might not need to restore it if other tests
        // also set it up, but it's good practice.
        // However, since we don't have the original reference easily accessible
        // without storing it outside, and other tests seem to overwrite it too,
        // we'll leave it as is for now or could restore if we saved it.
    });

    test('should be created', () => {
        const service = new VehiclePersistenceService();
        expect(service).toBeDefined();
    });

    describe('saveVehicle', () => {
        test('should save vehicle to local storage', () => {
            const service = new VehiclePersistenceService();
            service.saveVehicle(mockVehicle);

            const storedValue = localStorageStore[STORAGE_KEY];
            expect(storedValue).toBeDefined();
            expect(JSON.parse(storedValue)).toEqual(mockVehicle);
        });

        test('should handle errors during save', () => {
            const service = new VehiclePersistenceService();
            // Force setItem to throw
            global.localStorage.setItem = () => { throw new Error('Storage full'); };

            // Should not throw
            expect(() => service.saveVehicle(mockVehicle)).not.toThrow();
        });
    });

    describe('getVehicle', () => {
        test('should return null when storage is empty', () => {
            const service = new VehiclePersistenceService();
            const result = service.getVehicle();
            expect(result).toBeNull();
        });

        test('should return vehicle when storage has data', () => {
            const service = new VehiclePersistenceService();
            localStorageStore[STORAGE_KEY] = JSON.stringify(mockVehicle);

            const result = service.getVehicle();
            expect(result).toEqual(mockVehicle);
        });

        test('should handle JSON parse errors', () => {
            const service = new VehiclePersistenceService();
            localStorageStore[STORAGE_KEY] = 'invalid-json';

            // Should not throw and return null (or handle as implementation dictates)
            // Implementation catches error and returns null?
            // Let's check implementation:
            // catch (e) { console.error(...); return null; } -> Yes.

            // Note: JSON.parse('invalid-json') throws SyntaxError

            expect(() => service.getVehicle()).not.toThrow();
            expect(service.getVehicle()).toBeNull();
        });
    });

    describe('clearVehicle', () => {
        test('should remove vehicle from local storage', () => {
            const service = new VehiclePersistenceService();
            localStorageStore[STORAGE_KEY] = JSON.stringify(mockVehicle);

            service.clearVehicle();
            expect(localStorageStore[STORAGE_KEY]).toBeUndefined();
        });

        test('should handle errors during clear', () => {
            const service = new VehiclePersistenceService();
            localStorageStore[STORAGE_KEY] = JSON.stringify(mockVehicle);

            // Force removeItem to throw
            global.localStorage.removeItem = () => { throw new Error('Access denied'); };

            // Should not throw
            expect(() => service.clearVehicle()).not.toThrow();
        });
    });
});
