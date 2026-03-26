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
      getYears: () => of({ body: [] }),
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

vi.mock('../../components/logo/logo.component', () => ({
  LogoComponent: class {}
}));

vi.mock('../../components/theme-toggle/theme-toggle.component', () => ({
  ThemeToggleComponent: class {}
}));

const { HomeComponent } = await import('./home.component');

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
