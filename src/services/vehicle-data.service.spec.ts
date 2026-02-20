import { expect, test, describe, beforeEach, mock } from 'bun:test';

// Mock @angular/core before importing the service
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: (token: any) => {
        // Return a dummy object for injected services
        // Since we are only testing parseSpecTable which is a pure function
        // relying on no external state, we don't need fully functional mocks.
        return {};
    },
    WritableSignal: class {},
}));

// Mock MotorApiService just in case it's imported and causes issues
mock.module('./motor-api.service', () => ({
    MotorApiService: class {}
}));

// Mock FirebaseService just in case it's imported and causes issues
mock.module('./firebase.service', () => ({
    FirebaseService: class {}
}));

describe('VehicleDataService', () => {
    let VehicleDataService: any;

    beforeEach(async () => {
        const module = await import('./vehicle-data.service');
        VehicleDataService = module.VehicleDataService;
    });

    describe('parseSpecTable', () => {
        test('should return empty string for empty input', () => {
            const service = new VehicleDataService();
            expect(service.parseSpecTable('')).toBe('');
            expect(service.parseSpecTable(null as any)).toBe('');
            expect(service.parseSpecTable(undefined as any)).toBe('');
        });

        test('should parse a simple table with one row', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr>
                        <td>Engine Type</td>
                        <td>V8</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Engine Type: V8');
        });

        test('should parse multiple rows and join them with " | "', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr><td>Make</td><td>Ford</td></tr>
                    <tr><td>Model</td><td>Mustang</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Make: Ford | Model: Mustang');
        });

        test('should limit to top 3 rows per table', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr><td>R1</td><td>V1</td></tr>
                    <tr><td>R2</td><td>V2</td></tr>
                    <tr><td>R3</td><td>V3</td></tr>
                    <tr><td>R4</td><td>V4</td></tr>
                </table>
            `;
            const result = service.parseSpecTable(html);
            expect(result).toBe('R1: V1 | R2: V2 | R3: V3');
            expect(result).not.toContain('R4');
        });

        test('should handle multiple tables separated by newline', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr><td>T1R1</td><td>V1</td></tr>
                </table>
                <div>Some text</div>
                <table>
                    <tr><td>T2R1</td><td>V2</td></tr>
                </table>
            `;
            const result = service.parseSpecTable(html);
            expect(result).toBe('T1R1: V1\nT2R1: V2');
        });

        test('should strip HTML tags from keys and values', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr>
                        <td><b>Weight</b></td>
                        <td><span>1500 kg</span></td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Weight: 1500 kg');
        });

        test('should decode HTML entities &nbsp; and &amp;', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr>
                        <td>Make&nbsp;Name</td>
                        <td>Ford&amp;Co</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Make Name: Ford&Co');
        });

        test('should normalize whitespace', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr>
                        <td>  Key   One  </td>
                        <td>  Value   One  </td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Key One: Value One');
        });

        test('should ignore rows with less than 2 cells', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr><td>Header Only</td></tr>
                    <tr><td>Key</td><td>Value</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Key: Value');
        });

        test('should join extra cells into the value', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr>
                        <td>Dimension</td>
                        <td>10</td>
                        <td>20</td>
                        <td>30</td>
                    </tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Dimension: 10 20 30');
        });

        test('should handle th tags as cells', () => {
            const service = new VehicleDataService();
            const html = `
                <table>
                    <tr>
                        <th>Parameter</th>
                        <th>Value</th>
                    </tr>
                    <tr>
                        <td>Speed</td>
                        <td>100</td>
                    </tr>
                </table>
            `;
            // Note: The logic treats th just like td, so it will include headers if they are in a tr
            // Since th are usually headers, they might be included as the first "row"
            expect(service.parseSpecTable(html)).toBe('Parameter: Value | Speed: 100');
        });

        test('should remove trailing colon from keys', () => {
             const service = new VehicleDataService();
             const html = `
                 <table>
                     <tr>
                         <td>Engine:</td>
                         <td>V6</td>
                     </tr>
                 </table>
             `;
             expect(service.parseSpecTable(html)).toBe('Engine: V6');
        });
    });
});
