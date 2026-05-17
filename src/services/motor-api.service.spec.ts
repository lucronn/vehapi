import { of, throwError } from 'rxjs';

const { mockGet, mockPost, MockMotorHtmlProcessorService, MockHttpClient } = vi.hoisted(() => {
    const mockGet = vi.fn();
    const mockPost = vi.fn();
    class MockMotorHtmlProcessorService {
        processHtmlContent = vi.fn(() => 'MOCKED');
    }
    class MockHttpClient { }
    return { mockGet, mockPost, MockMotorHtmlProcessorService, MockHttpClient };
});

mockGet.mockImplementation((url: string, options: any) => of({ body: { data: 'test' }, status: 200, statusText: 'OK', headers: new Map() }));
mockPost.mockImplementation((url: string, body: any, options: any) => of({ body: { data: 'test_post' }, status: 200, statusText: 'OK', headers: new Map() }));

vi.mock('./motor-html-processor.service', () => ({
  MotorHtmlProcessorService: MockMotorHtmlProcessorService
}));

vi.mock('@angular/common/http', () => ({
  HttpClient: MockHttpClient,
  HttpParams: class {
    private params = new Map<string, string>();
    set(key: string, value: string) {
      const newParams = new (this.constructor as any)();
      this.params.forEach((v, k) => newParams.params.set(k, v));
      newParams.params.set(key, value);
      return newParams;
    }
    get(key: string) { return this.params.get(key); }
  },
  HttpRequest: class { },
  HttpEvent: class { }
}));

vi.mock('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  inject: (token: any) => {
    if (token === MockMotorHtmlProcessorService || (token && token.name === 'MockMotorHtmlProcessorService') || token?.name === 'MotorHtmlProcessorService') {
      return new MockMotorHtmlProcessorService();
    }
    if (token === MockHttpClient || (token && token.name === 'HttpClient')) {
      return {
        get: mockGet,
        post: mockPost
      };
    }
    return {};
  },
  Component: () => (target: any) => target,
  Input: () => (target: any, key: string) => { },
  Output: () => (target: any, key: string) => { },
  EventEmitter: class { emit() { } }
}));

vi.mock('../components/orientation-selector-modal/orientation-selector-modal.component', () => ({
  OrientationSelectorModalComponent: class { },
}));

describe('MotorApiService Integration Methods', () => {
  let MotorApiService: any;
  let service: any;

  beforeEach(async () => {
    mockGet.mockClear();
    mockPost.mockClear();
    mockGet.mockImplementation((url: string, options: any) => of({ body: { data: 'test' }, status: 200, statusText: 'OK', headers: new Map() }));
    mockPost.mockImplementation((url: string, body: any, options: any) => of({ body: { data: 'test_post' }, status: 200, statusText: 'OK', headers: new Map() }));
    const module = await import('./motor-api.service');
    MotorApiService = module.MotorApiService;
    service = new MotorApiService();

    vi.spyOn(console, 'group').mockImplementation(() => { });
    vi.spyOn(console, 'groupEnd').mockImplementation(() => { });
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  test('decodeVin calls correct URL', async () => {
    const res = await new Promise(resolve => service.decodeVin('12345').subscribe(resolve));
    expect(mockGet).toHaveBeenCalled();
    const args = mockGet.mock.calls[0];
    expect(args[0]).toContain('/api/vin/12345/vehicle');
    expect(res).toEqual({ data: 'test' });
  });

  test('getYears calls correct URL', async () => {
    const res = await new Promise(resolve => service.getYears().subscribe(resolve));
    expect(mockGet).toHaveBeenCalled();
    const args = mockGet.mock.calls[0];
    expect(args[0]).toContain('/api/db/years');
    expect(res).toEqual({ data: 'test' });
  });

  test('getMakes calls correct URL', async () => {
    const res = await new Promise(resolve => service.getMakes(2020).subscribe(resolve));
    expect(mockGet).toHaveBeenCalled();
    const args = mockGet.mock.calls[0];
    expect(args[0]).toContain('/api/db/year/2020/makes');
    expect(res).toEqual({ data: 'test' });
  });

  test('getModels calls correct URL', async () => {
    const res = await new Promise(resolve => service.getModels(2020, 'FORD').subscribe(resolve));
    expect(mockGet).toHaveBeenCalled();
    const args = mockGet.mock.calls[0];
    expect(args[0]).toContain('/api/db/year/2020/make/FORD/models');
    expect(res).toEqual({ data: 'test' });
  });

  test('getMotorVehicles calls correct URL', async () => {
    const res = await new Promise(resolve => service.getMotorVehicles('MOTOR', 'V123').subscribe(resolve));
    expect(mockGet).toHaveBeenCalled();
    const args = mockGet.mock.calls[0];
    expect(args[0]).toContain('/api/source/MOTOR/V123/motorvehicles');
    expect(res).toEqual({ data: 'test' });
  });

  test('searchArticles caches results and handles parameters', async () => {
    mockGet.mockImplementationOnce(() => of({
      body: { data: 'test1', header: { statusCode: 200 } },
      status: 200,
      statusText: 'OK',
      headers: new Map()
    }));
    const res1 = await new Promise(resolve => service.searchArticles('MOTOR', 'V123', 'Brakes').subscribe(resolve));
    expect(mockGet).toHaveBeenCalledTimes(1);
    const args = mockGet.mock.calls[0];
    expect(args[0]).toContain('/api/source/MOTOR/vehicle/V123/articles/v2');
    expect((args[1].params as any)['searchTerm']).toBe('Brakes');

    mockGet.mockImplementationOnce(() => of({
      body: { data: 'test2', header: { statusCode: 200 } },
      status: 200,
      statusText: 'OK',
      headers: new Map()
    }));

    const res2 = await new Promise(resolve => service.searchArticles('MOTOR', 'V124', '').subscribe(resolve));
    expect(mockGet).toHaveBeenCalledTimes(2);

    const res3 = await new Promise(resolve => service.searchArticles('MOTOR', 'V124', '').subscribe(resolve));
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(res3).toEqual({ data: 'test2', header: { statusCode: 200 } });
  });

  test('error handling via getWithLogging', async () => {
    mockGet.mockImplementation(() => throwError(() => new Error('API Error')));

    let errRes: any;
    try {
      await new Promise((resolve, reject) => {
        service.getYears().subscribe({
          next: () => reject(new Error('Should have failed')),
          error: (err: any) => {
            errRes = err;
            resolve(true);
          }
        });
      });
    } catch (e) {
      errRes = e;
    }

    expect(errRes).toBeDefined();
    expect(errRes.message).toBe('API Error');
  });
});
