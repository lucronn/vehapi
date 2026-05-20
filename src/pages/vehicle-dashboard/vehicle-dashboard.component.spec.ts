import '@angular/compiler';
import { of } from 'rxjs';

const { mockMotorApi, mockSearchResultsState, mockVehicleData, mockWindowManager, MockComponent } = vi.hoisted(() => {
    const mockMotorApi = {
        getArticleOrientations: vi.fn(() => of({ header: { statusCode: 200 }, body: { orientations: [{ id: 'test-id', displayName: 'Test Engine' }], total: 1 } })),
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

    const MockComponent = class {};

    return { mockMotorApi, mockSearchResultsState, mockVehicleData, mockWindowManager, MockComponent };
});

vi.mock('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  Component: () => (target: any) => target,
  Directive: () => () => {},
  Input: () => (target: any, key: string) => {},
  Output: () => (target: any, key: string) => {},
  HostListener: () => (target: any, key: string) => {},
  EventEmitter: class { emit() {} subscribe() { return { unsubscribe: () => {} }; } },
  ViewChild: () => () => {},
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

vi.mock('@angular/core/rxjs-interop', () => ({
  toSignal: (obs: any, options: any) => {
      return () => new Map([['contentSource', 'MOTOR'], ['vehicleId', '123']]);
  }
}));

vi.mock('@angular/router', () => ({
  ActivatedRoute: class {},
  Router: class {},
  RouterModule: class {}
}));

vi.mock('@angular/common', () => ({
  CommonModule: class {}
}));

vi.mock('lucide-angular', () => ({
  LucideAngularModule: class {},
  Menu: {}, X: {}, House: {}, TriangleAlert: {}, FileText: {}, Wrench: {}, Package: {}, Lightbulb: {}, CreditCard: {}
}));

vi.mock('./components/layout/dashboard-sidebar/dashboard-sidebar.component', () => ({ DashboardSidebarComponent: MockComponent }));
vi.mock('./components/layout/dashboard-search/dashboard-search.component', () => ({ DashboardSearchComponent: MockComponent }));
vi.mock('./components/sections/specs-fluids-section/specs-fluids-section.component', () => ({ SpecsFluidsSectionComponent: MockComponent }));
vi.mock('./components/sections/dtc-section/dtc-section.component', () => ({ DtcSectionComponent: MockComponent }));
vi.mock('./components/sections/tsb-section/tsb-section.component', () => ({ TsbSectionComponent: MockComponent }));
vi.mock('./components/sections/procedures-section/procedures-section.component', () => ({ ProceduresSectionComponent: MockComponent }));
vi.mock('./components/sections/diagrams-section/diagrams-section.component', () => ({ DiagramsSectionComponent: MockComponent }));
vi.mock('./components/sections/component-locations-section/component-locations-section.component', () => ({ ComponentLocationsSectionComponent: MockComponent }));
vi.mock('./components/sections/maintenance-section/maintenance-section.component', () => ({ MaintenanceSectionComponent: MockComponent }));
vi.mock('./components/sections/parts-section/parts-section.component', () => ({ PartsSectionComponent: MockComponent }));
vi.mock('./components/sections/common-issues-section/common-issues-section.component', () => ({ CommonIssuesSectionComponent: MockComponent }));
vi.mock('../../components/logo/logo.component', () => ({ LogoComponent: MockComponent }));
vi.mock('../../components/orientation-selector-modal/orientation-selector-modal.component', () => ({ OrientationSelectorModalComponent: MockComponent }));
vi.mock('../../components/theme-toggle/theme-toggle.component', () => ({ ThemeToggleComponent: MockComponent }));
vi.mock('../article-viewer/article-viewer.component', () => ({ ArticleViewerComponent: MockComponent }));

vi.mock('../../services/motor-api.service', () => ({ MotorApiService: class {} }));
vi.mock('../../services/search-results.state', () => ({ SearchResultsState: class {} }));
vi.mock('../../services/vehicle-data.service', () => ({ VehicleDataService: class {} }));
vi.mock('../../services/window-manager.service', () => ({ WindowManagerService: class {} }));


describe('VehicleDashboardComponent Integration', () => {
  let VehicleDashboardComponent: any;
  let component: any;

  beforeEach(async () => {
    const module = await import('./vehicle-dashboard.component');
    VehicleDashboardComponent = module.VehicleDashboardComponent;
    component = new VehicleDashboardComponent();

    mockMotorApi.getArticleOrientations.mockClear();
  });

  test('loadOrientationOptions should call API and update options', () => {
    (component as any).loadOrientationOptions('article-123');

    expect(mockMotorApi.getArticleOrientations).toHaveBeenCalledTimes(1);
    expect(mockMotorApi.getArticleOrientations).toHaveBeenCalledWith('MOTOR', '123', 'article-123');

    const options = component.orientationOptions();
    expect(options.length).toBe(1);
    expect(options[0].id).toBe('test-id');
    expect(options[0].displayName).toBe('Test Engine');

    expect(component.showOrientationModal()).toBe(true);
    expect(component.pendingArticleId()).toBe('article-123');
  });
});
