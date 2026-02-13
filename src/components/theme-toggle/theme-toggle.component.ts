import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { LucideAngularModule, Sun, Moon } from 'lucide-angular';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button
      (click)="themeService.toggleTheme()"
      class="btn-glass p-2 rounded-lg"
      [attr.aria-label]="themeService.theme() === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
      type="button">
      @if (themeService.theme() === 'light') {
        <lucide-icon [img]="Moon" class="w-5 h-5"></lucide-icon>
      } @else {
        <lucide-icon [img]="Sun" class="w-5 h-5"></lucide-icon>
      }
    </button>
  `
})
export class ThemeToggleComponent {
  readonly themeService = inject(ThemeService);
  readonly Sun = Sun;
  readonly Moon = Moon;
}
