import { expect, test, describe, beforeEach, mock } from 'bun:test';
import { of, firstValueFrom } from 'rxjs';

// Mocks
const mockSearchArticles = mock(() => of({ body: { articleDetails: [], filterTabs: [] } }));
const mockGetPartsForVehicle = mock(() => of({ body: { items: [] } }));
const mockGetMaintenanceByIntervals = mock(() => of({ body: { schedules: [] } }));
const mockGetFluids = mock(() => of({ body: { data: [] } }));
const mockGetArticleContent = mock(() => of({ body: { html: '' } }));

class MockMotorApiService {
    searchArticles = mockSearchArticles;
    getPartsForVehicle = mockGetPartsForVehicle;
    getMaintenanceByIntervals = mockGetMaintenanceByIntervals;
    getFluids = mockGetFluids;
    getArticleContent = mockGetArticleContent;
}

// Mock @angular/core
mock.module('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: (token: any) => {
        // Simple check for class name
        // Since we mocked MotorApiService, the token is likely MockMotorApiService
        if (token && (token.name === 'MotorApiService' || token.name === 'MockMotorApiService')) {
            return new MockMotorApiService();
        }
        return {};
    },
    WritableSignal: class {},
}));

// Mock MotorApiService module
mock.module('./motor-api.service', () => ({
    MotorApiService: MockMotorApiService
}));

// Mock FirebaseService
mock.module('./firebase.service', () => ({
    FirebaseService: class {}
}));

describe('VehicleDataService', () => {
    let VehicleDataService: any;
    let service: any;

    beforeEach(async () => {
        // Reset mocks
        mockSearchArticles.mockReset();
        mockGetPartsForVehicle.mockReset();
        mockGetMaintenanceByIntervals.mockReset();
        mockGetFluids.mockReset();
        mockGetArticleContent.mockReset();

        // Default behavior
        mockSearchArticles.mockReturnValue(of({ body: { articleDetails: [], filterTabs: [] } }));
        mockGetPartsForVehicle.mockReturnValue(of({ body: { items: [] } }));

        // Re-import service to ensure mocks are applied
        // In bun test, modules are cached, so we might need a workaround if tests run in parallel or sequence
        // But let's try direct import
        const module = await import('./vehicle-data.service');
        VehicleDataService = module.VehicleDataService;
        service = new VehicleDataService();
    });

    describe('getAvailableSections', () => {
        test('should return all false if no data found', async () => {
             const obs = service.getAvailableSections('MOTOR', '123');
             const result = await firstValueFrom(obs);
             expect(result.hasDtcs).toBe(false);
             expect(result.hasTsbs).toBe(false);
             expect(result.hasDiagrams).toBe(false);
             expect(result.hasProcedures).toBe(false);
             expect(result.hasSpecs).toBe(false);
             expect(result.hasComponentLocations).toBe(false);
             expect(result.hasParts).toBe(false);
             expect(result.hasMaintenance).toBe(false);
        });

        test('should detect sections from filter tabs', async () => {
            mockSearchArticles.mockReturnValue(of({
                body: {
                    articleDetails: [],
                    filterTabs: [
                        { name: 'Diagnostic Trouble Codes', type: 'DTCs' },
                        { name: 'Technical Service Bulletins', type: 'TSBs' },
                        { name: 'Wiring Diagrams', type: 'Diagrams' },
                        { name: 'Procedures', type: 'Procedures' },
                        { name: 'Component Locations', type: 'Component Locations' },
                        { name: 'Maintenance', type: 'Maintenance' },
                        { name: 'Specifications', type: 'Specs' }
                    ]
                }
            }));

            const obs = service.getAvailableSections('MOTOR', '123');
            const result = await firstValueFrom(obs);

            expect(result.hasDtcs).toBe(true);
            expect(result.hasTsbs).toBe(true);
            expect(result.hasDiagrams).toBe(true);
            expect(result.hasProcedures).toBe(true);
            expect(result.hasComponentLocations).toBe(true);
            expect(result.hasMaintenance).toBe(true);
            expect(result.hasSpecs).toBe(true);
        });

         test('should detect parts from parts API', async () => {
            mockGetPartsForVehicle.mockReturnValue(of({
                body: {
                    items: [{ partNumber: '123' }]
                }
            }));

            const obs = service.getAvailableSections('MOTOR', '123');
            const result = await firstValueFrom(obs);
            expect(result.hasParts).toBe(true);
        });
    });

    describe('parseSpecTable', () => {
        test('should return empty string for empty input', () => {
            expect(service.parseSpecTable('')).toBe('');
            expect(service.parseSpecTable(null as any)).toBe('');
            expect(service.parseSpecTable(undefined as any)).toBe('');
        });

        test('should parse a simple table with one row', () => {
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
            const html = `
                <table>
                    <tr><td>Make</td><td>Ford</td></tr>
                    <tr><td>Model</td><td>Mustang</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Make: Ford | Model: Mustang');
        });

        test('should limit to top 3 rows per table', () => {
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
            const html = `
                <table>
                    <tr><td>Header Only</td></tr>
                    <tr><td>Key</td><td>Value</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html)).toBe('Key: Value');
        });

        test('should join extra cells into the value', () => {
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
            expect(service.parseSpecTable(html)).toBe('Parameter: Value | Speed: 100');
        });

        test('should remove trailing colon from keys', () => {
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
