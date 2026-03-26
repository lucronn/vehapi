import { PersistedVehicle } from '../models/motor.models';

vi.mock('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

describe('VehiclePersistenceService', () => {
    let VehiclePersistenceService: any;
    let localStorageStore: Record<string, string> = {};
    const STORAGE_KEY = 'torque-persisted-vehicle';

    const mockVehicle: PersistedVehicle = {
        vehicleId: 'test-vehicle-123',
        contentSource: 'MOTOR',
        name: '2023 BMW X5'
    };

    beforeEach(async () => {
        localStorageStore = {};

        global.localStorage = {
            getItem: (key: string) => localStorageStore[key] || null,
            setItem: (key: string, value: string) => { localStorageStore[key] = value.toString(); },
            removeItem: (key: string) => { delete localStorageStore[key]; },
            clear: () => { localStorageStore = {}; },
            key: (index: number) => Object.keys(localStorageStore)[index] || null,
            length: Object.keys(localStorageStore).length,
        } as Storage;

        const module = await import('./vehicle-persistence.service');
        VehiclePersistenceService = module.VehiclePersistenceService;
    });

    afterEach(() => {
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
            global.localStorage.setItem = () => { throw new Error('Storage full'); };

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

            global.localStorage.removeItem = () => { throw new Error('Access denied'); };

            expect(() => service.clearVehicle()).not.toThrow();
        });
    });
});
