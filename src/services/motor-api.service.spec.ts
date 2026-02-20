import { expect, test, describe, beforeEach, mock } from 'bun:test';

// Define MockHtmlProcessingService first
const mockProcessHtmlContent = mock((html: string, baseUrl: string, contentSource?: string, vehicleId?: string) => 'MOCKED_RESULT');

class MockHtmlProcessingService {
  processHtmlContent = mockProcessHtmlContent;
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

    // Return a dummy object for injected dependencies (like HttpClient)
    return {
      get: () => ({ pipe: () => { } }),
      post: () => ({ pipe: () => { } })
    };
  },
  Component: () => (target: any) => target,
  Input: () => (target: any, key: string) => {},
  Output: () => (target: any, key: string) => {},
  EventEmitter: class { emit() {} }
}));

// Mock @angular/common/http
mock.module('@angular/common/http', () => ({
  HttpClient: class { },
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
});
