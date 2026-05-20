import { Injectable, signal } from '@angular/core';

export interface CommandPaletteItem {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  readonly open = signal(false);
  readonly query = signal('');
  readonly items = signal<CommandPaletteItem[]>([]);
  readonly placeholder = signal('Search commands…');

  setItems(items: CommandPaletteItem[], placeholder?: string): void {
    this.items.set(items);
    if (placeholder) this.placeholder.set(placeholder);
  }

  openPalette(prefill = ''): void {
    this.query.set(prefill);
    this.open.set(true);
  }

  closePalette(): void {
    this.open.set(false);
    this.query.set('');
  }

  togglePalette(): void {
    if (this.open()) this.closePalette();
    else this.openPalette();
  }
}
