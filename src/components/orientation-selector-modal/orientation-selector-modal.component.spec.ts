vi.mock('@angular/core', () => ({
  Component: () => (target: any) => target,
  Directive: () => () => {},
  Injectable: () => () => {},
  inject: () => ({ activate: () => {}, deactivate: () => {} }),
  OnInit: class {},
  OnDestroy: class {},
  EventEmitter: class {
    private listeners: any[] = [];
    emit(value?: any) {
      this.listeners.forEach(fn => fn(value));
    }
    subscribe(fn: any) {
      this.listeners.push(fn);
      return { unsubscribe: () => {
        this.listeners = this.listeners.filter(l => l !== fn);
      }};
    }
  },
  Input: () => (target: any, propertyKey: string) => {},
  Output: () => (target: any, propertyKey: string) => {},
  HostListener: () => (target: any, propertyKey: string) => {},
}));

vi.mock('@angular/common', () => ({
  CommonModule: class {}
}));

vi.mock('lucide-angular', () => ({
  LucideAngularModule: class {},
  X: {},
  ChevronRight: {}
}));

describe('OrientationSelectorModalComponent', () => {
  let component: any;

  beforeEach(async () => {
    const module = await import('./orientation-selector-modal.component');
    component = new module.OrientationSelectorModalComponent();
  });

  test('should initialize with empty options array', () => {
    expect(component.options).toEqual([]);
  });

  test('onClose should emit close event', () => {
    let emitted = false;
    component.close.subscribe(() => {
      emitted = true;
    });

    component.onClose();
    expect(emitted).toBe(true);
  });

  test('onSelectOption should emit selectOrientation event with correct option', () => {
    const testOption = { id: '1', displayName: 'Test Option', qualifier: 'Test Qualifier' };
    let emittedOption: any = null;

    component.selectOrientation.subscribe((option: any) => {
      emittedOption = option;
    });

    component.onSelectOption(testOption);
    expect(emittedOption).toEqual(testOption);
  });
});
