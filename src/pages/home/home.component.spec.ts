import '@angular/compiler';
import { of } from "rxjs";

const { mockInject, signal, computed, toSignal } = vi.hoisted(() => {
    const signal = (initialValue: any) => {
        let value = initialValue;
        const s = () => value;
        s.set = (v: any) => { value = v; };
        s.update = (fn: any) => { value = fn(value); };
        s.asReadonly = () => s;
        return s;
    };

    const computed = (fn: any) => {
        return () => fn();
    };

    const toSignal = (obs: any, options: any) => {
        return signal(options?.initialValue);
    };

    const mockInject = vi.fn();

    return { mockInject, signal, computed, toSignal };
});

beforeAll(() => {
  if (typeof MouseEvent === 'undefined') {
    global.MouseEvent = class {
      constructor(type: string) {}
      preventDefault() {}
      stopPropagation() {}
    } as any;
  }
});

mockInject.mockImplementation((token: any) => {
  const tokenName = token?.name || token?.toString() || '';

  if (tokenName.includes('MotorApiService')) {
    return {
      getYears: () => of({ body: [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010] }),
      getMakes: () => of({ body: [] }),
      getModels: () => of({ body: { models: [] } }),
      getEngines: () => of({ body: [] }),
      decodeVin: () => of({ body: {} }),
    };
  }
  if (tokenName.includes('VehiclePersistenceService')) {
    return {
      getVehicle: () => null,
      clearVehicle: () => {},
      saveVehicle: () => {},
    };
  }
  if (tokenName.includes('Router')) {
    return {
      navigate: vi.fn(),
    };
  }
  if (tokenName.includes('DestroyRef')) {
    return {
      onDestroy: vi.fn(),
    };
  }
  if (tokenName.includes('ChangeDetectorRef')) {
    return {
      detectChanges: vi.fn(),
    };
  }
  if (tokenName.includes('PageTitleService')) {
    return {
      set: vi.fn(),
    };
  }
  if (tokenName.includes('CommandPalette')) {
    return {
      setItems: vi.fn(),
      openPalette: vi.fn(),
      closePalette: vi.fn(),
      togglePalette: vi.fn(),
    };
  }
  if (tokenName.includes('DataSyncService')) {
    return {};
  }
  if (tokenName.includes('AuthService')) {
    return {
      user: () => null,
      userId: () => null,
      isAuthenticated: () => false,
    };
  }
  if (tokenName.includes('CreditsService')) {
    return {
      hasAccess: () => false,
      balance: () => 0,
    };
  }
  if (tokenName.includes('LoggerService')) {
    return {
      debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    };
  }

  return {};
});

vi.mock('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  inject: mockInject,
  signal: signal,
  computed: computed,
  effect: () => {},
  ChangeDetectionStrategy: { OnPush: 0 },
  Component: () => () => {},
  Directive: () => () => {},
  ViewChild: () => () => {},
  HostListener: () => () => {},
  OnInit: class {},
  DestroyRef: class {},
  ChangeDetectorRef: class {},
  ElementRef: class {},
  output: () => ({}),
  input: () => ({}),
}));

vi.mock('@angular/core/rxjs-interop', () => ({
  toSignal: toSignal,
  takeUntilDestroyed: () => (source: any) => source,
}));

vi.mock('@angular/router', () => ({
  Router: class {},
  RouterModule: class {},
}));

vi.mock('@angular/common', () => ({
  CommonModule: class {},
}));

vi.mock('@angular/forms', () => ({
  FormsModule: class {},
}));

vi.mock('lucide-angular', () => ({
  LucideAngularModule: class {},
  Search: {},
  X: {},
  ArrowRight: {},
  ArrowUpRight: {},
  ArrowLeft: {},
}));

vi.mock('../../services/motor-api.service', () => ({
  MotorApiService: class {}
}));

vi.mock('../../services/vehicle-persistence.service', () => ({
  VehiclePersistenceService: class {}
}));

vi.mock('../../services/command-palette.service', () => ({
  CommandPaletteService: class {
    setItems = vi.fn();
    openPalette = vi.fn();
    closePalette = vi.fn();
    togglePalette = vi.fn();
  },
}));

vi.mock('../../components/logo/logo.component', () => ({
  LogoComponent: class {}
}));

vi.mock('../../components/theme-toggle/theme-toggle.component', () => ({
  ThemeToggleComponent: class {}
}));

const { HomeComponent } = await import('./home.component');

describe('HomeComponent modelRoutingId', () => {
  let component: any;

  beforeEach(() => {
    component = new HomeComponent();
  });

  test('uses baseVehicleId when present', () => {
    const model = { id: '3398', baseVehicleId: '192168', model: 'Rogue' };
    expect(component['modelRoutingId'](model)).toBe('192168');
  });

  test('falls back to model.id when baseVehicleId is absent', () => {
    const model = { id: '370', model: 'Escalade' };
    expect(component['modelRoutingId'](model)).toBe('370');
  });

  test('falls back to model.id when baseVehicleId is empty string', () => {
    const model = { id: '370', baseVehicleId: '  ', model: 'Escalade' };
    expect(component['modelRoutingId'](model)).toBe('370');
  });

  test('returns empty string when model is null', () => {
    expect(component['modelRoutingId'](null)).toBe('');
  });
});

describe('HomeComponent resolveEnginesOrAutoSelect', () => {
  let component: any;

  beforeEach(() => {
    component = new HomeComponent();
    component.ngOnInit();
  });

  test('sets vehicleId as baseVehicleId:engineId when single engine', () => {
    const model = { id: '3398', baseVehicleId: '192168', model: 'Rogue', engines: [{ id: '7835', name: '2.5L' }] };
    component['resolveEnginesOrAutoSelect'](model);
    expect(component.selectedVehicle().vehicleId).toBe('192168:7835');
  });

  test('uses model.id as fallback when baseVehicleId missing', () => {
    const model = { id: '3398', model: 'Rogue', engines: [{ id: '7835', name: '2.5L' }] };
    component['resolveEnginesOrAutoSelect'](model);
    expect(component.selectedVehicle().vehicleId).toBe('3398:7835');
  });

  test('does not double-wrap already composite engineId', () => {
    const model = { id: '3398', baseVehicleId: '192168', model: 'Rogue', engines: [{ id: '192168:7835', name: '2.5L' }] };
    component['resolveEnginesOrAutoSelect'](model);
    // engineId already contains ':' → pass through as-is
    expect(component.selectedVehicle().vehicleId).toBe('192168:7835');
  });

  test('sets vehicleId to routingId when no engines', () => {
    const model = { id: '3398', baseVehicleId: '192168', model: 'Rogue', engines: [] };
    component['resolveEnginesOrAutoSelect'](model);
    expect(component.selectedVehicle().vehicleId).toBe('192168');
  });

  test('populates engine step when multiple engines exist', () => {
    const model = {
      id: '3398', baseVehicleId: '192168', model: 'Rogue',
      engines: [{ id: '7835', name: '2.5L' }, { id: '7836', name: '3.5L' }]
    };
    component['resolveEnginesOrAutoSelect'](model);
    expect(component.engines().length).toBe(2);
    expect(component.selectedVehicle()).toBeNull();
  });
});

describe('HomeComponent closeMobileWizard', () => {
  let component: any;

  beforeEach(() => {
    component = new HomeComponent();
    component.ngOnInit();
  });

  test('should close wizard if nothing selected', () => {
    component.showSuggestions.set(true);
    component.selectedYear.set(null);
    component.selectedMake.set(null);
    component.selectedModel.set(null);

    component.closeMobileWizard();

    expect(component.showSuggestions()).toBe(false);
  });

  test('should go back to Year selection if Year is selected', () => {
    component.showSuggestions.set(true);
    component.selectedYear.set(2023);
    component.selectedMake.set(null);
    component.selectedModel.set(null);

    expect(component.selectedYear()).toBe(2023);

    component.closeMobileWizard();

    expect(component.selectedYear()).toBe(null);
    expect(component.showSuggestions()).toBe(true);
  });

  test('should go back to Make selection if Make is selected', () => {
    component.showSuggestions.set(true);
    component.selectedYear.set(2023);
    component.selectedMake.set({ makeName: 'Ford', id: 1 });
    component.selectedModel.set(null);

    expect(component.selectedMake()).not.toBe(null);

    component.closeMobileWizard();

    expect(component.selectedMake()).toBe(null);
    expect(component.selectedYear()).toBe(2023);
    expect(component.showSuggestions()).toBe(true);
  });

  test('should go back to Model selection if Model is selected', () => {
    component.showSuggestions.set(true);
    component.selectedYear.set(2023);
    component.selectedMake.set({ makeName: 'Ford', id: 1 });
    component.selectedModel.set({ model: 'F-150', id: '123' });

    expect(component.selectedModel()).not.toBe(null);

    component.closeMobileWizard();

    expect(component.selectedModel()).toBe(null);
    expect(component.selectedMake()).not.toBe(null);
    expect(component.selectedYear()).toBe(2023);
    expect(component.showSuggestions()).toBe(true);
  });
});
