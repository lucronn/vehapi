import { Component, inject } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
import { LucideAngularModule, Sun, Moon, CreditCard } from 'lucide-angular';
import { CreditsService } from '../../services/credits.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule, CommonModule],
  template: `
    <div class="flex items-center gap-3">
      <!-- Credits Display -->
      <div class="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/10">
        <lucide-icon [img]="CreditCard" class="w-3.5 h-3.5 text-torque-cyan"></lucide-icon>
        <span class="text-xs font-mono text-white">{{ creditsService.balance() }} CR</span>
        <button (click)="buyCredits()" class="ml-2 text-[10px] font-bold text-torque-cyan hover:text-white transition-colors uppercase tracking-wider">
          BUY
        </button>
      </div>

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

  buyCredits() {
    if (confirm('Purchase 50 Credits for $5.00?')) {
      this.creditsService.startCheckout(50);
    }
  }
}

