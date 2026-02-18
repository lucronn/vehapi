import { expect, test, describe, beforeEach, beforeAll, mock } from 'bun:test';
import { Window } from 'happy-dom';

// Create a mock for MotorApiService
const mockMotorApi = {
    searchArticles: () => ({ subscribe: () => {} }),
    getFluids: () => ({ pipe: () => {} }),
    getArticleContent: () => ({ pipe: () => {} }),
    getMaintenanceByIntervals: () => ({ subscribe: () => {} })
};

// Mock @angular/core
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: (token: any) => {
        return mockMotorApi;
    },
    WritableSignal: () => {},
    signal: () => {},
    computed: () => {}
}));

// Mock services
mock.module('./motor-api.service', () => ({
    MotorApiService: class {},
}));
mock.module('./firebase.service', () => ({
    FirebaseService: class {},
}));

describe('VehicleDataService.parseSpecTable', () => {
    let VehicleDataService: any;

    beforeAll(() => {
        // Setup happy-dom environment for DOMParser
        const window = new Window();
        const document = window.document;
        // @ts-ignore
        global.DOMParser = window.DOMParser;
        // @ts-ignore
        global.document = document;
        // @ts-ignore
        global.window = window;
    });

    beforeEach(async () => {
        const module = await import('./vehicle-data.service');
        VehicleDataService = module.VehicleDataService;
    });

    test('should parse simple table correctly', () => {
        const service = new VehicleDataService();
        const html = `
            <table>
                <tr><td>Engine Oil</td><td>5W-30</td></tr>
                <tr><td>Capacity</td><td>4.5 Quarts</td></tr>
            </table>
        `;
        const result = service.parseSpecTable(html);
        expect(result).toContain('Engine Oil: 5W-30');
        expect(result).toContain('Capacity: 4.5 Quarts');
    });

    test('should parse complex table with headers and attributes', () => {
        const service = new VehicleDataService();
        const html = `
            <table class="foo">
                <thead>
                    <tr><th>Specification</th><th>Value</th></tr>
                </thead>
                <tbody>
                    <tr><td>  Engine Type  </td><td>  V6  </td></tr>
                </tbody>
            </table>
        `;
        const result = service.parseSpecTable(html);
        // Normalized whitespace
        expect(result).toContain('Specification: Value');
        expect(result).toContain('Engine Type: V6');
    });

    test('should handle entities like &nbsp;', () => {
        const service = new VehicleDataService();
        const html = `
            <table>
                <tr><td>Torque</td><td>260&nbsp;lb-ft</td></tr>
            </table>
        `;
        const result = service.parseSpecTable(html);
        // "Torque: 260 lb-ft"
        expect(result).toContain('Torque: 260 lb-ft');
    });

    test('should return empty string for empty input', () => {
        const service = new VehicleDataService();
        expect(service.parseSpecTable('')).toBe('');
        // @ts-ignore
        expect(service.parseSpecTable(null)).toBe('');
    });
});
