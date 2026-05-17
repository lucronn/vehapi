import { Component, inject, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CreditsService } from '../../services/credits.service';
import { AuthService } from '../../services/auth.service';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, CreditCard, RefreshCw, X, LogIn, UserPlus, AlertCircle, Check } from 'lucide-angular';
import { AuthModalComponent } from '../auth-modal/auth-modal.component';
import { WindowManagerService } from '../../services/window-manager.service';

@Component({
  selector: 'app-credits-modal',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, AuthModalComponent],
  template: `
    <div class="p-5 sm:p-6 text-ink">
      @if (showAuthModal()) {
        <app-auth-modal [startMode]="authModalStartMode()" (close)="showAuthModal.set(false)" />
      } @else {
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-bold">Get Credits</h2>
          @if (windowId) {
            <button (click)="closeModal()" class="p-2 rounded-lg hover:bg-surface-soft transition-colors" aria-label="Close">
              <lucide-icon [img]="icons.X" class="w-5 h-5"></lucide-icon>
            </button>
          }
        </div>

        @if (!authService.user()) {
          <div class="space-y-4">
            <p class="text-sm text-faint">Sign in to purchase credits.</p>
            <div class="flex gap-2">
              <button (click)="openAuthModal('signin')" class="flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl bg-[var(--bg-hover)] border border-hairline text-sm font-medium">
                <lucide-icon [img]="icons.LogIn" class="w-4 h-4"></lucide-icon>
                Sign in
              </button>
              <button (click)="openAuthModal('signup')" class="flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl bg-accent-soft border border-accent/40 text-accent text-sm font-medium">
                <lucide-icon [img]="icons.UserPlus" class="w-4 h-4"></lucide-icon>
                Create account
              </button>
            </div>
          </div>
        } @else {
          <!-- Balance + Refresh -->
          <div class="flex items-center justify-between gap-4 mb-6 p-4 rounded-xl bg-[var(--bg-hover)] border border-hairline">
            <div class="flex items-center gap-3">
              <lucide-icon [img]="icons.CreditCard" class="w-5 h-5 text-accent"></lucide-icon>
              <div>
                <p class="text-xs text-faint">Balance</p>
                <p class="text-xl font-mono font-bold">{{ creditsService.balance() }} credits</p>
              </div>
            </div>
            <button (click)="refresh()" [disabled]="creditsService.isLoading()"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-surface-soft disabled:opacity-50 transition-colors">
              <lucide-icon [img]="icons.RefreshCw" class="w-4 h-4" [class.animate-spin]="creditsService.isLoading()"></lucide-icon>
              Refresh
            </button>
          </div>

          @if (purchaseSuccess()) {
            <div class="mb-4 flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 text-emerald-400">
              <lucide-icon [img]="icons.Check" class="w-5 h-5 flex-shrink-0"></lucide-icon>
              <span class="text-sm font-medium">Payment successful! Credits added.</span>
            </div>
          }

          @if (creditsService.lastError(); as err) {
            <div class="mb-4 flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400">
              <lucide-icon [img]="icons.AlertCircle" class="w-5 h-5 flex-shrink-0"></lucide-icon>
              <span class="text-sm flex-1">{{ err }}</span>
              <button (click)="creditsService.lastError.set(null)" class="p-1.5 rounded hover:bg-red-500/20">×</button>
            </div>
          }

          <!-- Credit packs -->
          <div class="space-y-3">
            <h3 class="text-sm font-semibold text-gray-300">Top Up Credits</h3>
            <div class="grid grid-cols-3 gap-2">
              @for (pack of creditPacks; track pack.credits) {
                <button
                  (click)="purchase(pack.credits)"
                  [disabled]="creditsService.isLoading()"
                  class="flex flex-col items-center justify-center py-4 px-3 rounded-xl bg-surface-soft hover:bg-[var(--bg-hover)] border border-hairline hover:border-accent/40 transition-all min-h-[80px] disabled:opacity-50">
                  <p class="text-[10px] text-faint uppercase tracking-wider">{{ pack.label }}</p>
                  <p class="text-lg font-mono font-bold text-accent">{{ pack.credits | number }}</p>
                  <p class="text-xs text-faint">\${{ pack.price }}</p>
                </button>
              }
            </div>
          </div>

          <p class="text-xs text-faint mt-4">
            <a [routerLink]="['/credits']" class="text-accent hover:underline">Full account & history</a>
          </p>
        }
      }
    </div>
  `,
})
export class CreditsModalComponent {
  readonly creditsService = inject(CreditsService);
  readonly authService = inject(AuthService);
  private windowManager = inject(WindowManagerService);

  @Input() windowId?: string;

  readonly icons = { CreditCard, RefreshCw, X, LogIn, UserPlus, AlertCircle, Check };
  showAuthModal = signal(false);
  authModalStartMode = signal<'signin' | 'signup'>('signin');
  purchaseSuccess = signal(false);

  readonly creditPacks = [
    { credits: 1000, price: '10.00', label: 'Starter' },
    { credits: 2500, price: '25.00', label: 'Standard' },
    { credits: 5000, price: '50.00', label: 'Pro' },
  ];

  closeModal() {
    if (this.windowId) {
      this.windowManager.closeWindow(this.windowId);
    }
  }

  openAuthModal(mode: 'signin' | 'signup') {
    this.authModalStartMode.set(mode);
    this.showAuthModal.set(true);
  }

  async refresh() {
    await this.creditsService.refreshBalance();
  }

  async purchase(amount: number) {
    this.purchaseSuccess.set(false);
    this.creditsService.lastError.set(null);
    const result = await this.creditsService.startCheckoutPopup(amount);
    if (result.success) {
      this.purchaseSuccess.set(true);
      setTimeout(() => this.purchaseSuccess.set(false), 5000);
      await this.creditsService.refreshBalance();
    } else if (result.error) {
      this.creditsService.lastError.set(result.error);
    }
  }
}
