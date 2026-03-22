import { expect, test, mock, beforeEach, afterEach, describe, beforeAll } from "bun:test";
import { of } from "rxjs";

beforeAll(() => {
  if (typeof MouseEvent === 'undefined') {
    global.MouseEvent = class {
      constructor(type: string) {}
      preventDefault() {}
      stopPropagation() {}
    } as any;
  }
});

// Mock @angular/core
const mockInject = mock((token: any) => {
  // Check token name or toString to identify service
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
      navigate: mock(() => {}),
    };
  }
  if (tokenName.includes('DestroyRef')) {
    return {
      onDestroy: mock(() => {}),
    };
  }
  if (tokenName.includes('ChangeDetectorRef')) {
    return {
      detectChanges: mock(() => {}),
    };
  }

  return {};
});

// Mock signal
const signal = (initialValue: any) => {
  let value = initialValue;
  const s = () => value;
  s.set = (v: any) => { value = v; };
  s.update = (fn: any) => { value = fn(value); };
  s.asReadonly = () => s;
  return s;
};

// Mock computed
const computed = (fn: any) => {
  return () => fn();
};

// Mock toSignal
const toSignal = (obs: any, options: any) => {
  return signal(options?.initialValue);
};

// Mock dependencies
mock.module('@angular/core', () => ({
  inject: mockInject,
  signal: signal,
  computed: computed,
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

mock.module('@angular/core/rxjs-interop', () => ({
  toSignal: toSignal,
  takeUntilDestroyed: () => (source: any) => source,
}));

mock.module('@angular/router', () => ({
  Router: class {},
  RouterModule: class {},
}));

mock.module('@angular/common', () => ({
  CommonModule: class {},
}));

mock.module('@angular/forms', () => ({
  FormsModule: class {},
}));

mock.module('lucide-angular', () => ({
  LucideAngularModule: class {},
  Search: {},
  X: {},
  ArrowRight: {},
  ArrowUpRight: {},
  ArrowLeft: {},
}));

mock.module('../../services/motor-api.service', () => ({
  MotorApiService: class {}
}));

mock.module('../../services/vehicle-persistence.service', () => ({
  VehiclePersistenceService: class {}
}));

mock.module('../../components/logo/logo.component', () => ({
  LogoComponent: class {}
}));

mock.module('../../components/theme-toggle/theme-toggle.component', () => ({
  ThemeToggleComponent: class {}
}));

// Import the component AFTER mocking
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

    // Initial state check
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

    // Initial state check
    expect(component.selectedMake()).not.toBe(null);

    component.closeMobileWizard();

    expect(component.selectedMake()).toBe(null);
    expect(component.selectedYear()).toBe(2023); // Year should remain
    expect(component.showSuggestions()).toBe(true);
  });

  test('should go back to Model selection if Model is selected', () => {
    component.showSuggestions.set(true);
    component.selectedYear.set(2023);
    component.selectedMake.set({ makeName: 'Ford', id: 1 });
    component.selectedModel.set({ model: 'F-150', id: '123' });

    // Initial state check
    expect(component.selectedModel()).not.toBe(null);

    component.closeMobileWizard();

    expect(component.selectedModel()).toBe(null);
    expect(component.selectedMake()).not.toBe(null); // Make should remain
    expect(component.selectedYear()).toBe(2023); // Year should remain
    expect(component.showSuggestions()).toBe(true);
  });
});
