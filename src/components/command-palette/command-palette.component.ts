import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommandPaletteService } from '../../services/command-palette.service';
import { FocusDepthDirective } from '../../directives/focus-depth.directive';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FocusDepthDirective],
  template: `
    @if (palette.open()) {
    <div class="cmd-shell" appFocusDepth>
    <button type="button" class="cmd-backdrop" aria-label="Close command palette" (click)="palette.closePalette()"></button>
    <div class="cmd-panel" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="cmd-input-wrap">
        <span class="cmd-kbd">⌘K</span>
        <input
          type="search"
          class="cmd-input"
          [value]="palette.query()"
          (input)="onQuery($event)"
          [placeholder]="palette.placeholder()"
          autocomplete="off"
          spellcheck="false"
          aria-label="Command search" />
      </div>
      <ul class="cmd-list" role="listbox">
        @for (item of filtered(); track item.id; let i = $index) {
        <li>
          <button
            type="button"
            class="cmd-item"
            [class.cmd-item-active]="i === activeIndex()"
            (click)="run(item)"
            (mouseenter)="activeIndex.set(i)">
            @if (item.group) {
            <span class="cmd-group">{{ item.group }}</span>
            }
            <span class="cmd-label">{{ item.label }}</span>
            @if (item.hint) {
            <span class="cmd-hint">{{ item.hint }}</span>
            }
          </button>
        </li>
        } @empty {
        <li class="cmd-empty">No matching commands</li>
        }
      </ul>
      <p class="cmd-footer">
        <span>↑↓ navigate</span>
        <span>↵ run</span>
        <span>esc close</span>
      </p>
    </div>
    </div>
    }
  `,
  styles: [`
    .cmd-shell {
      position: fixed;
      inset: 0;
      z-index: 200;
    }
    .cmd-backdrop {
      position: absolute;
      inset: 0;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
    }
    .cmd-panel {
      position: fixed;
      z-index: 201;
      left: 50%;
      top: max(12vh, 4rem);
      transform: translateX(-50%);
      width: min(560px, calc(100vw - 2rem));
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      animation: cmd-in 0.18s ease-out;
    }
    @keyframes cmd-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    .cmd-input-wrap {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border-bottom: 1px solid var(--hairline);
    }
    .cmd-kbd {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.625rem;
      padding: 0.2rem 0.45rem;
      border-radius: 0.25rem;
      border: 1px solid var(--hairline);
      color: var(--faint);
    }
    .cmd-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 1rem;
      color: var(--ink);
      outline: none;
    }
    .cmd-input::placeholder { color: var(--faint); }
    .cmd-list {
      max-height: min(50vh, 360px);
      overflow-y: auto;
      margin: 0;
      padding: 0.35rem;
      list-style: none;
    }
    .cmd-item {
      width: 100%;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 0.5rem 0.75rem;
      align-items: center;
      text-align: left;
      padding: 0.65rem 0.75rem;
      border-radius: var(--radius);
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--ink);
      font-size: 0.875rem;
    }
    .cmd-item:hover,
    .cmd-item-active {
      background: var(--accent-soft);
    }
    .cmd-group {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.625rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--faint);
    }
    .cmd-label { font-weight: 500; }
    .cmd-hint {
      font-size: 0.75rem;
      color: var(--muted);
    }
    .cmd-empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--faint);
      font-size: 0.875rem;
    }
    .cmd-footer {
      display: flex;
      gap: 1rem;
      padding: 0.5rem 1rem 0.75rem;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 0.625rem;
      color: var(--faint);
      border-top: 1px solid var(--hairline-soft);
    }
  `],
})
export class CommandPaletteComponent {
  readonly palette = inject(CommandPaletteService);
  readonly activeIndex = signal(0);

  readonly filtered = computed(() => {
    const q = this.palette.query().trim().toLowerCase();
    const items = this.palette.items();
    if (!q) return items;
    return items.filter((item) => {
      const hay = `${item.label} ${item.group ?? ''} ${item.keywords ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  constructor() {
    effect(() => {
      this.palette.query();
      this.palette.items();
      this.activeIndex.set(0);
    });

    effect(() => {
      if (this.palette.open()) {
        queueMicrotask(() => {
          document.querySelector<HTMLInputElement>('.cmd-input')?.focus();
        });
      }
    });
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKey(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.palette.togglePalette();
      return;
    }
    if (!this.palette.open()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.palette.closePalette();
      return;
    }
    const list = this.filtered();
    if (!list.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update((i) => (i + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update((i) => (i - 1 + list.length) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = list[this.activeIndex()];
      if (item) this.run(item);
    }
  }

  onQuery(event: Event): void {
    this.palette.query.set((event.target as HTMLInputElement).value);
  }

  run(item: { run: () => void }): void {
    this.palette.closePalette();
    item.run();
  }
}
