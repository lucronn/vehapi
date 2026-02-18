import { expect, test, describe, beforeEach, mock } from 'bun:test';

// Mock @angular/core
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: (token: any) => {
        // Simple mock returning an empty object for any injection
        return {};
    },
    WritableSignal: class {},
}));

// Mock MotorApiService
mock.module('./motor-api.service', () => ({
    MotorApiService: class {}
}));

// Mock FirebaseService
mock.module('./firebase.service', () => ({
    FirebaseService: class {}
}));

describe('VehicleDataService', () => {
    let VehicleDataService: any;
    let service: any;

    beforeEach(async () => {
        // Re-import to ensure fresh mocks if needed, though usually module cache might persist.
        // In bun test, mocks should be applied if defined before import.
        const module = await import('./vehicle-data.service');
        VehicleDataService = module.VehicleDataService;
        service = new VehicleDataService();
    });

    describe('parseSpecTable', () => {
        test('should return empty string for empty input', () => {
            expect(service.parseSpecTable('')).toBe('');
            expect(service.parseSpecTable(null)).toBe('');
            expect(service.parseSpecTable(undefined)).toBe('');
        });

        test('should parse a simple table', () => {
            const html = `
                <table>
                    <tr>
                        <td>Capacity</td>
                        <td>5.0L</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Capacity: 5.0L');
        });

        test('should handle th tags', () => {
            const html = `
                <table>
                    <tr>
                        <th>Type</th>
                        <td>V8</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Type: V8');
        });

        test('should limit output to top 3 rows', () => {
             const html = `
                <table>
                    <tr><td>R1</td><td>V1</td></tr>
                    <tr><td>R2</td><td>V2</td></tr>
                    <tr><td>R3</td><td>V3</td></tr>
                    <tr><td>R4</td><td>V4</td></tr>
                </table>
            `;
            const result = service.parseSpecTable(html);
            // It uses " | " as separator
            expect(result).toBe('R1: V1 | R2: V2 | R3: V3');
        });

        test('should join multiple tables with newline', () => {
            const html = `
                <table><tr><td>T1</td><td>V1</td></tr></table>
                <div>Separator</div>
                <table><tr><td>T2</td><td>V2</td></tr></table>
            `;
            const result = service.parseSpecTable(html);
            expect(result).toBe('T1: V1\nT2: V2');
        });

        test('should strip HTML tags from content', () => {
            const html = `
                <table>
                    <tr>
                        <td><b>Weight</b></td>
                        <td><span>2000</span> lbs</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Weight: 2000 lbs');
        });

        test('should handle HTML entities', () => {
             const html = `
                <table>
                    <tr>
                        <td>Name&nbsp;1</td>
                        <td>Value&amp;2</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Name 1: Value&2');
        });

        test('should ignore rows with less than 2 cells', () => {
             const html = `
                <table>
                    <tr><td>HeaderOnly</td></tr>
                    <tr><td>Key</td><td>Value</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Key: Value');
        });

        test('should join extra cells', () => {
            const html = `
                <table>
                    <tr>
                        <td>Dimensions</td>
                        <td>10x10</td>
                        <td>inches</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Dimensions: 10x10 inches');
        });

         test('should normalize whitespace', () => {
            const html = `
                <table>
                    <tr>
                        <td>  Spaced   Key  </td>
                        <td>  Value  </td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Spaced Key: Value');
        });

        test('should handle partial table tags if regex is robust enough or fail gracefully', () => {
             // The regex is /<table[^>]*>([\s\S]*?)<\/table>/gi
             // If table tag is broken, it shouldn't match
             const html = `
                <table
                    <tr><td>K</td><td>V</td></tr>
             `;
             // Missing closing > of table or closing tag
             expect(service.parseSpecTable(html)).toBe('');
        });
    });
});
