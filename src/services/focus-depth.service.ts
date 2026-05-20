import { Injectable, computed, signal } from '@angular/core';

/** Global “deep space” backdrop when modals, palettes, or focused overlays are open. */
@Injectable({ providedIn: 'root' })
export class FocusDepthService {
  private readonly stack = signal<string[]>([]);

  readonly active = computed(() => this.stack().length > 0);
  readonly depth = computed(() => this.stack().length);

  /** Normalized pointer 0–1 for particle reactivity. */
  readonly pointer = signal({ x: 0.5, y: 0.5 });

  activate(id: string): void {
    this.stack.update((s) => (s.includes(id) ? s : [...s, id]));
    if (typeof document !== 'undefined') {
      document.body.classList.add('focus-depth-active');
    }
  }

  deactivate(id: string): void {
    this.stack.update((s) => s.filter((x) => x !== id));
    if (typeof document !== 'undefined' && this.stack().length === 0) {
      document.body.classList.remove('focus-depth-active');
    }
  }

  setPointer(x: number, y: number): void {
    this.pointer.set({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  }
}
