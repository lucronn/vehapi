import '@angular/compiler';
import { of } from 'rxjs';

const { mockSearchArticles, MockMotorApiService } = vi.hoisted(() => {
    const mockSearchArticles = vi.fn();
    const MockMotorApiService = class {
        searchArticles = mockSearchArticles;
    };
    return { mockSearchArticles, MockMotorApiService };
});

mockSearchArticles.mockImplementation(() => of({ body: { articleDetails: [], filterTabs: [] } }));

vi.mock('./motor-api.service', () => ({
    MotorApiService: MockMotorApiService
}));

vi.mock('@angular/core', () => ({
    Injectable: () => (target: any) => target,
    inject: (token: any) => {
        if (token && token.name === 'MotorApiService') {
            return new MockMotorApiService();
        }
        if (token && token.name === 'DataSyncService') {
            return { checkNormalizationStatus: vi.fn(() => Promise.resolve(false)) };
        }
        if (token && token.name === 'ApiDataService') {
            const emptyQuery = () => Promise.resolve({ data: [], count: null, error: null });
            return {
                from: () => ({
                    select: () => ({
                        eq: () => emptyQuery(),
                    }),
                }),
            };
        }
        if (token && token.name === 'LoggerService') {
            return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        }
        if (token && token.name === 'VehiclePersistenceService') {
            return { getVehicle: vi.fn(() => null) };
        }
        return {};
    },
    WritableSignal: class {},
}));

describe('VehicleDataService', () => {
    let VehicleDataService: any;
    let service: any;

    beforeEach(async () => {
        mockSearchArticles.mockClear();
        mockSearchArticles.mockImplementation(() => of({ body: { articleDetails: [], filterTabs: [] } }));
        const module = await import('./vehicle-data.service');
        VehicleDataService = module.VehicleDataService;
        service = new VehicleDataService();
        (service as any).motorApi = new MockMotorApiService();
    });

    describe('loadSectionData', () => {
        test('should load DTCs correctly', async () => {
            mockSearchArticles.mockReturnValue(of({
                body: {
                    articleDetails: [
                        { id: '1', bucket: 'Diagnostic Trouble Codes', code: 'P0101', title: 'MAF Sensor', description: 'Mass Air Flow' }
                    ],
                    filterTabs: [{ type: 'DTCs', name: 'Diagnostic Trouble Codes' }]
                }
            }));

            const loadingSignal = { set: vi.fn() };
            const updateState = vi.fn();

            service.loadSectionData('dtcs', 'MOTOR', '123', undefined, loadingSignal, updateState);

            await new Promise(process.nextTick);

            expect(updateState).toHaveBeenCalled();
            const calledArg = updateState.mock.calls[0][0];
            expect(calledArg).toHaveLength(1);
            expect(calledArg[0]).toEqual({
                id: '1',
                code: 'P0101',
                description: 'Mass Air Flow',
                bucket: 'Diagnostic Trouble Codes'
            });
        });

        test('should load TSBs correctly', async () => {
            mockSearchArticles.mockReturnValue(of({
                body: {
                    articleDetails: [
                        { id: '2', bucket: 'Technical Service Bulletins', bulletinNumber: 'TSB-001', title: 'Engine Noise', releaseDate: '2023-01-01' }
                    ],
                    filterTabs: [{ type: 'TSBs', name: 'Technical Service Bulletins' }]
                }
            }));

            const loadingSignal = { set: vi.fn() };
            const updateState = vi.fn();

            service.loadSectionData('tsbs', 'MOTOR', '123', undefined, loadingSignal, updateState);

            await new Promise(process.nextTick);

            expect(updateState).toHaveBeenCalled();
            const calledArg = updateState.mock.calls[0][0];
            expect(calledArg).toHaveLength(1);
            expect(calledArg[0]).toEqual({
                id: '2',
                bulletinNumber: 'TSB-001',
                title: 'Engine Noise',
                releaseDate: '2023-01-01',
                description: '',
                thumbnailHref: undefined
            });
        });

        test('should load Procedures correctly', async () => {
            mockSearchArticles.mockReturnValue(of({
                body: {
                    articleDetails: [
                        { id: '3', bucket: 'Procedures', title: 'Replace Oil', subtitle: 'Step by step' }
                    ],
                    filterTabs: [{ type: 'Procedures', name: 'Procedures' }]
                }
            }));

            const loadingSignal = { set: vi.fn() };
            const updateState = vi.fn();

            service.loadSectionData('procedures', 'MOTOR', '123', undefined, loadingSignal, updateState);

            await new Promise(process.nextTick);

            expect(updateState).toHaveBeenCalled();
            const calledArg = updateState.mock.calls[0][0];
            expect(calledArg).toHaveLength(1);
            expect(calledArg[0]).toEqual({
                id: '3',
                bucket: 'Procedures',
                title: 'Replace Oil',
                subtitle: 'Step by step',
                parentBucket: ''
            });
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
            expect(service.parseSpecTable(html).trim()).toBe('Engine Type: V8');
        });

        test('should parse multiple rows and join them with " | "', () => {
            const html = `
                <table>
                    <tr><td>Make</td><td>Ford</td></tr>
                    <tr><td>Model</td><td>Mustang</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html).replace(/ +\| /g, ' | ').trim()).toBe('Make: Ford | Model: Mustang');
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
            const result = service.parseSpecTable(html).replace(/ +\| /g, ' | ').trim();
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
            const result = service.parseSpecTable(html).split('\n').map(s => s.trim()).join('\n');
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
            expect(service.parseSpecTable(html).trim()).toBe('Weight: 1500 kg');
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
            expect(service.parseSpecTable(html).trim()).toBe('Make Name: Ford&Co');
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
            expect(service.parseSpecTable(html).trim()).toBe('Key One: Value One');
        });

        test('should ignore rows with less than 2 cells', () => {
            const html = `
                <table>
                    <tr><td>Header Only</td></tr>
                    <tr><td>Key</td><td>Value</td></tr>
                </table>
            `;
            expect(service.parseSpecTable(html).trim()).toBe('Key: Value');
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
            expect(service.parseSpecTable(html).trim()).toBe('Dimension: 10 20 30');
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
            expect(service.parseSpecTable(html).replace(/ +\| /g, ' | ').trim()).toBe('Parameter: Value | Speed: 100');
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
             expect(service.parseSpecTable(html).trim()).toBe('Engine: V6');
        });
    });
});
