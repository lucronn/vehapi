import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { LucideAngularModule, Sun, Moon, CreditCard } from 'lucide-angular';
import { CreditsService } from '../../services/credits.service';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule, CommonModule, RouterLink],
  template: `
    <div class="flex items-center gap-3">
      <!-- Credits Display -->
      <a routerLink="/credits" class="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/10 hover:bg-white/10 transition-colors group" title="Account &amp; Credits">
        <lucide-icon [img]="CreditCard" class="w-3.5 h-3.5 text-torque-cyan"></lucide-icon>
        <span class="text-xs font-mono text-white">{{ creditsService.balance() }} CR</span>
        <span class="ml-1 sm:ml-2 text-[10px] font-bold text-torque-cyan group-hover:text-white transition-colors uppercase tracking-wider">
          ADD
        </span>
      </a>

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
    </div>
  `
})
export class ThemeToggleComponent {
  readonly themeService = inject(ThemeService);
  readonly creditsService = inject(CreditsService);
  readonly Sun = Sun;
  readonly Moon = Moon;
  readonly CreditCard = CreditCard;
}

