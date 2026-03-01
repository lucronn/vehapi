import { expect, test, describe, beforeEach, mock } from 'bun:test';
import { of } from 'rxjs';

// Define MockHtmlProcessingService first
const mockProcessHtmlContent = mock((html: string, baseUrl: string, contentSource?: string, vehicleId?: string) => 'MOCKED_RESULT');

class MockHtmlProcessingService {
  processHtmlContent = mockProcessHtmlContent;
}

export const mockHttpGet = mock((url: string, options: any) => {
  return of({
    body: { data: 'mocked_get_response' },
    status: 200,
    statusText: 'OK',
    headers: {
      keys: () => ['content-type'],
      get: (key: string) => 'application/json'
    }
  });
});

export const mockHttpPost = mock((url: string, body: any, options: any) => {
  return of({
    body: { data: 'mocked_post_response' },
    status: 200,
    statusText: 'OK',
    headers: {
      keys: () => ['content-type'],
      get: (key: string) => 'application/json'
    }
  });
});

export class MockHttpClient {
  get = mockHttpGet;
  post = mockHttpPost;
}

// Mock HtmlProcessingService module
mock.module('./html-processing.service', () => ({
  HtmlProcessingService: MockHtmlProcessingService
}));

// Mock @angular/core
mock.module('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  inject: (token: any) => {
    // If injecting HtmlProcessingService (which is mocked to MockHtmlProcessingService)
    if (token === MockHtmlProcessingService || (token && token.name === 'MockHtmlProcessingService')) {
      return new MockHtmlProcessingService();
    }
    if (token && token.name === 'HttpClient') {
      return new MockHttpClient();
    }

    // Return a dummy object for injected dependencies (like HttpClient)
    return new MockHttpClient();
  },
  Component: () => (target: any) => target,
  Input: () => (target: any, key: string) => {},
  Output: () => (target: any, key: string) => {},
  EventEmitter: class { emit() {} }
}));

// Mock @angular/common/http
mock.module('@angular/common/http', () => ({
  HttpClient: MockHttpClient,
  HttpParams: class { },
  HttpRequest: class { },
  HttpEvent: class { }
}));

// Mock the component to avoid loading it (it has Angular dependencies)
mock.module('../components/orientation-selector-modal/orientation-selector-modal.component', () => ({
    OrientationSelectorModalComponent: class {},
    // OrientationOption is an interface, so we don't need to export it for runtime
}));

describe('MotorApiService', () => {
  let MotorApiService: any;
  let service: any;

  beforeEach(async () => {
    mockProcessHtmlContent.mockClear();
    mockHttpGet.mockClear();
    mockHttpPost.mockClear();
    // Import the service dynamically to ensure mocks are applied
    const module = await import('./motor-api.service');
    MotorApiService = module.MotorApiService;
    if (MotorApiService) {
      service = new MotorApiService();
    }
  });

  test('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('decodeVin', () => {
    test('should call correct endpoint to decode VIN', async () => {
      const vin = '1HGCM82633A004XXX';
      const result$ = service.decodeVin(vin);

      let receivedData: any;
      result$.subscribe((data: any) => { receivedData = data; });

      expect(mockHttpGet).toHaveBeenCalledTimes(1);
      const args = mockHttpGet.mock.calls[0];
      expect(args[0]).toBe(`${service.baseUrl}/api/vin/${vin}/vehicle`);
      expect(args[1].observe).toBe('response');

      expect(receivedData).toEqual({ data: 'mocked_get_response' });
    });
  });

  describe('getYears', () => {
    test('should call correct endpoint for years', async () => {
      const result$ = service.getYears();

      let receivedData: any;
      result$.subscribe((data: any) => { receivedData = data; });

      expect(mockHttpGet).toHaveBeenCalledTimes(1);
      const args = mockHttpGet.mock.calls[0];
      expect(args[0]).toBe(`${service.baseUrl}/api/years`);
      expect(args[1].observe).toBe('response');

      expect(receivedData).toEqual({ data: 'mocked_get_response' });
    });
  });

  describe('getMakes', () => {
    test('should call correct endpoint for makes by year', async () => {
      const year = 2020;
      const result$ = service.getMakes(year);

      let receivedData: any;
      result$.subscribe((data: any) => { receivedData = data; });

      expect(mockHttpGet).toHaveBeenCalledTimes(1);
      const args = mockHttpGet.mock.calls[0];
      expect(args[0]).toBe(`${service.baseUrl}/api/year/${year}/makes`);
      expect(args[1].observe).toBe('response');

      expect(receivedData).toEqual({ data: 'mocked_get_response' });
    });
  });

  describe('getModels', () => {
    test('should call correct endpoint for models by year and make', async () => {
      const year = 2020;
      const make = 'Honda';
      const result$ = service.getModels(year, make);

      let receivedData: any;
      result$.subscribe((data: any) => { receivedData = data; });

      expect(mockHttpGet).toHaveBeenCalledTimes(1);
      const args = mockHttpGet.mock.calls[0];
      expect(args[0]).toBe(`${service.baseUrl}/api/year/${year}/make/${make}/models`);
      expect(args[1].observe).toBe('response');

      expect(receivedData).toEqual({ data: 'mocked_get_response' });
    });
  });
});
