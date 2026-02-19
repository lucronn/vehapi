
import { expect, test, describe, beforeEach, mock, spyOn } from 'bun:test';
import { of } from 'rxjs';

// Mock dependencies
const mockMotorApi = {
  getArticleOrientations: mock(() => of({ header: { statusCode: 200 }, body: { orientations: [{ id: 'test-id', displayName: 'Test Engine' }], total: 1 } })),
  getVehicleName: () => of({ body: 'Test Vehicle' }),
  getMotorVehicles: () => of({ body: [] }),
};

const mockSearchResultsState = {
  search: () => {},
  articleDetails: () => [],
  filterTabsAndTheirFullBuckets: () => [],
};

const mockVehicleData = {
  getAvailableSections: () => of(null),
};

const mockWindowManager = {
  openWindow: () => {},
};

// Mock @angular/core
mock.module('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  Component: () => (target: any) => target,
  inject: (token: any) => {
    if (token === 'MotorApiService' || token.name === 'MotorApiService') return mockMotorApi;
    if (token === 'SearchResultsState' || token.name === 'SearchResultsState') return mockSearchResultsState;
    if (token === 'VehicleDataService' || token.name === 'VehicleDataService') return mockVehicleData;
    if (token === 'WindowManagerService' || token.name === 'WindowManagerService') return mockWindowManager;
    if (token.name === 'ActivatedRoute') return { paramMap: of(new Map([['contentSource', 'MOTOR'], ['vehicleId', '123']])) };
    if (token.name === 'Router') return { navigate: () => {} };
    return {};
  },
  signal: (initialValue: any) => {
    let value = initialValue;
    const s = (newValue?: any) => {
      if (newValue !== undefined) value = newValue;
      return value;
    };
    s.set = (v: any) => { value = v; };
    s.update = (fn: any) => { value = fn(value); };
    return s;
  },
  computed: (fn: any) => {
    return () => fn();
  },
  effect: () => {},
  ChangeDetectionStrategy: { OnPush: 0 }
}));

mock.module('@angular/core/rxjs-interop', () => ({
  toSignal: (obs: any, options: any) => {
      // Mock returning a ParamMap with expected values
      return () => new Map([['contentSource', 'MOTOR'], ['vehicleId', '123']]);
  }
}));

mock.module('@angular/router', () => ({
  ActivatedRoute: class {},
  Router: class {},
  RouterModule: class {}
}));

mock.module('@angular/common', () => ({
  CommonModule: class {}
}));

mock.module('lucide-angular', () => ({
  LucideAngularModule: class {},
  Menu: {}, X: {}, House: {}, TriangleAlert: {}, FileText: {}, Wrench: {}, Package: {}
}));

// Mock Child Components
const MockComponent = class {};
mock.module('./components/layout/dashboard-sidebar/dashboard-sidebar.component', () => ({ DashboardSidebarComponent: MockComponent }));
mock.module('./components/layout/dashboard-search/dashboard-search.component', () => ({ DashboardSearchComponent: MockComponent }));
mock.module('./components/sections/specs-fluids-section/specs-fluids-section.component', () => ({ SpecsFluidsSectionComponent: MockComponent }));
mock.module('./components/sections/dtc-section/dtc-section.component', () => ({ DtcSectionComponent: MockComponent }));
mock.module('./components/sections/tsb-section/tsb-section.component', () => ({ TsbSectionComponent: MockComponent }));
mock.module('./components/sections/procedures-section/procedures-section.component', () => ({ ProceduresSectionComponent: MockComponent }));
mock.module('./components/sections/diagrams-section/diagrams-section.component', () => ({ DiagramsSectionComponent: MockComponent }));
mock.module('./components/sections/component-locations-section/component-locations-section.component', () => ({ ComponentLocationsSectionComponent: MockComponent }));
mock.module('./components/sections/maintenance-section/maintenance-section.component', () => ({ MaintenanceSectionComponent: MockComponent }));
mock.module('./components/sections/parts-section/parts-section.component', () => ({ PartsSectionComponent: MockComponent }));
mock.module('./components/sections/common-issues-section/common-issues-section.component', () => ({ CommonIssuesSectionComponent: MockComponent }));
mock.module('../../components/logo/logo.component', () => ({ LogoComponent: MockComponent }));
mock.module('../../components/orientation-selector-modal/orientation-selector-modal.component', () => ({ OrientationSelectorModalComponent: MockComponent }));
mock.module('../../components/theme-toggle/theme-toggle.component', () => ({ ThemeToggleComponent: MockComponent }));
mock.module('../article-viewer/article-viewer.component', () => ({ ArticleViewerComponent: MockComponent }));

// Mock Services
mock.module('../../services/motor-api.service', () => ({ MotorApiService: class {} }));
mock.module('../../services/search-results.state', () => ({ SearchResultsState: class {} }));
mock.module('../../services/vehicle-data.service', () => ({ VehicleDataService: class {} }));
mock.module('../../services/window-manager.service', () => ({ WindowManagerService: class {} }));


describe('VehicleDashboardComponent Integration', () => {
  let VehicleDashboardComponent: any;
  let component: any;

  beforeEach(async () => {
    const module = await import('./vehicle-dashboard.component');
    VehicleDashboardComponent = module.VehicleDashboardComponent;
    component = new VehicleDashboardComponent();

    // Reset mocks
    mockMotorApi.getArticleOrientations.mockClear();
  });

  test('loadOrientationOptions should call API and update options', () => {
    // Access private method
    (component as any).loadOrientationOptions('article-123');

    // Verify API call
    expect(mockMotorApi.getArticleOrientations).toHaveBeenCalledTimes(1);
    expect(mockMotorApi.getArticleOrientations).toHaveBeenCalledWith('MOTOR', '123', 'article-123');

    // Verify state update
    const options = component.orientationOptions();
    expect(options.length).toBe(1);
    expect(options[0].id).toBe('test-id');
    expect(options[0].displayName).toBe('Test Engine');

    expect(component.showOrientationModal()).toBe(true);
    expect(component.pendingArticleId()).toBe('article-123');
  });
});
