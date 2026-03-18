
import { Component, inject, computed, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CreditsService, Transaction } from '../../services/credits.service';
import { AuthService } from '../../services/auth.service';
import {
  LucideAngularModule,
  CreditCard, ArrowLeft, Car, Receipt, User,
  Check, Clock, ChevronRight, Sparkles, Home, Lock,
  LayoutDashboard, Settings, LogIn, UserPlus, LogOut, X, AlertCircle
} from 'lucide-angular';
import { AuthModalComponent } from '../../components/auth-modal/auth-modal.component';

type Tab = 'overview' | 'vehicles' | 'receipts';

// Module display labels
const MODULE_LABELS: Record<string, string> = {
  specs: 'Specifications',
  fluids: 'Fluids',
  maintenance: 'Maintenance',
  dtcs: 'Diagnostic Codes',
  tsbs: 'TSBs',
  procedures: 'Procedures',
  diagrams: 'Wiring Diagrams',
  parts: 'Parts',
  full: 'Full Access',
};

@Component({
  selector: 'app-credits-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, AuthModalComponent],
  template: `
    <div class="min-h-screen bg-[#0a0a0f] text-white font-sans">
      <!-- Ambient Background -->
      <div class="fixed inset-0 pointer-events-none">
        <div class="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-b from-torque-cyan/4 to-transparent"></div>
        <div class="absolute bottom-0 right-0 w-[600px] h-[600px] bg-torque-purple/4 rounded-full blur-[120px]"></div>
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-torque-cyan/2 rounded-full blur-[200px]"></div>
      </div>

      <div class="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-10"
        style="padding-left: calc(1rem + env(safe-area-inset-left, 0px)); padding-right: calc(1rem + env(safe-area-inset-right, 0px)); padding-top: calc(2.5rem + env(safe-area-inset-top, 0px)); padding-bottom: calc(2.5rem + env(safe-area-inset-bottom, 0px));">

        <!-- Back Nav -->
        <a routerLink="/" class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-torque-cyan transition-colors mb-8 group">
          <lucide-icon [img]="icons.ArrowLeft" class="w-4 h-4 group-hover:-translate-x-1 transition-transform"></lucide-icon>
          Back to Home
        </a>

        <!-- Header -->
        <header class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <p class="text-xs text-torque-cyan uppercase tracking-widest font-semibold mb-1">Account</p>
            <h1 class="text-3xl sm:text-4xl font-bold">
              {{ authService.user()?.email ?? 'My Account' }}
            </h1>
          </div>
          <div class="flex items-center gap-2 sm:gap-3 flex-wrap">
            @if (authService.user(); as user) {
              <button (click)="signOut()" class="flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl border border-white/10 hover:border-red-400/40 hover:bg-red-400/10 transition-colors text-sm text-gray-400 hover:text-red-300 touch-manipulation">
                <lucide-icon [img]="icons.LogOut" class="w-4 h-4"></lucide-icon>
                Sign out
              </button>
              <button (click)="openBillingPortal()" [disabled]="creditsService.portalLoading()"
                class="flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl border border-white/10 hover:border-torque-cyan/40 hover:bg-white/[0.04] transition-colors text-sm text-gray-400 hover:text-white disabled:opacity-50 touch-manipulation">
                <lucide-icon [img]="icons.Settings" class="w-4 h-4"></lucide-icon>
                {{ creditsService.portalLoading() ? 'Opening…' : 'Payment methods' }}
              </button>
              <div class="flex items-center gap-3 bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-3">
                <lucide-icon [img]="icons.CreditCard" class="w-5 h-5 text-torque-cyan"></lucide-icon>
                <div>
                  <p class="text-xs text-gray-400">Credits</p>
                  <p class="text-2xl font-mono font-bold text-white">{{ creditsService.balance() }}</p>
                </div>
              </div>
            } @else {
              <div class="flex items-center gap-2">
                <button (click)="openAuthModal('signin')" class="flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl bg-white/[0.06] border border-white/10 hover:border-torque-cyan/40 text-sm text-white font-medium touch-manipulation">
                  <lucide-icon [img]="icons.LogIn" class="w-4 h-4"></lucide-icon>
                  Sign in
                </button>
                <button (click)="openAuthModal('signup')" class="flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-xl bg-torque-cyan/20 border border-torque-cyan/40 text-torque-cyan hover:bg-torque-cyan/30 text-sm font-medium touch-manipulation">
                  <lucide-icon [img]="icons.UserPlus" class="w-4 h-4"></lucide-icon>
                  Create account
                </button>
              </div>
            }
          </div>
        </header>

        <!-- Auth Modal -->
        @if (showAuthModal()) {
        <app-auth-modal [startMode]="authModalStartMode()" (close)="showAuthModal.set(false)" />
        }

        <!-- Processing purchase (immediate feedback on redirect) -->
        @if (processingPurchase()) {
        <div class="mb-6 flex items-center gap-3 bg-torque-cyan/10 border border-torque-cyan/30 rounded-xl px-5 py-4 text-torque-cyan">
          <span class="inline-block w-5 h-5 border-2 border-torque-cyan/30 border-t-torque-cyan rounded-full animate-spin" aria-hidden="true"></span>
          <span class="font-medium">Completing your purchase…</span>
        </div>
        }

        <!-- Purchase success banner -->
        @if (purchaseSuccess()) {
        <div class="mb-6 flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-4 text-emerald-400">
          <lucide-icon [img]="icons.Check" class="w-5 h-5 flex-shrink-0"></lucide-icon>
          <span class="font-medium">Payment successful! Your credits have been added.</span>
        </div>
        }

        <!-- Error banner -->
        @if (creditsService.lastError(); as err) {
        <div class="mb-6 flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 text-red-400">
          <lucide-icon [img]="icons.AlertCircle" class="w-5 h-5 flex-shrink-0"></lucide-icon>
          <span class="font-medium flex-1">{{ err }}</span>
          <button (click)="creditsService.lastError.set(null)" class="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors" aria-label="Dismiss">
            <lucide-icon [img]="icons.X" class="w-4 h-4"></lucide-icon>
          </button>
        </div>
        }

        <!-- Tabs: min 44px tap targets, scroll on narrow screens -->
        <div class="flex gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1.5 mb-8 overflow-x-auto -mx-1 sm:mx-0" style="-webkit-overflow-scrolling: touch;">
          @for (tab of tabs; track tab.id) {
          <button
            (click)="activeTab.set(tab.id)"
            [class.bg-white]="activeTab() === tab.id"
            [class.text-black]="activeTab() === tab.id"
            [class.font-semibold]="activeTab() === tab.id"
            class="flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-lg text-sm whitespace-nowrap transition-all duration-200 text-gray-400 hover:text-white touch-manipulation">
            <lucide-icon [img]="tab.icon" class="w-4 h-4 flex-shrink-0"></lucide-icon>
            {{ tab.label }}
          </button>
          }
        </div>

        <!-- ══════════════════════ OVERVIEW TAB ══════════════════════ -->
        @if (activeTab() === 'overview') {
        <div class="space-y-6 animate-fade-in-up">

          <!-- Stats row -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 sm:p-5">
              <p class="text-xs text-gray-500 mb-1">Balance</p>
              <p class="text-2xl font-mono font-bold text-torque-cyan">{{ creditsService.balance() }}</p>
              <p class="text-xs text-gray-600 mt-1">credits</p>
            </div>
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 sm:p-5">
              <p class="text-xs text-gray-500 mb-1">Vehicles</p>
              <p class="text-2xl font-mono font-bold">{{ unlockedVehicleCount() }}</p>
              <p class="text-xs text-gray-600 mt-1">unlocked</p>
            </div>
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 sm:p-5">
              <p class="text-xs text-gray-500 mb-1">Purchases</p>
              <p class="text-2xl font-mono font-bold">{{ purchaseCount() }}</p>
              <p class="text-xs text-gray-600 mt-1">transactions</p>
            </div>
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 sm:p-5">
              <p class="text-xs text-gray-500 mb-1">Total Spent</p>
              <p class="text-2xl font-mono font-bold">\${{ totalSpent() }}</p>
              <p class="text-xs text-gray-600 mt-1">lifetime</p>
            </div>
          </div>

          <!-- Quick buy: responsive grid, touch-friendly buttons -->
          <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 sm:p-6">
            <h2 class="font-semibold text-gray-300 mb-4">Top Up Credits</h2>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              @for (pack of creditPacks; track pack.credits) {
              <button
                (click)="purchase(pack.credits)"
                [disabled]="creditsService.isLoading()"
                class="group relative overflow-hidden bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.08] hover:border-torque-cyan/40 rounded-xl p-5 min-h-[100px] transition-all duration-200 text-left touch-manipulation disabled:opacity-50">
                <p class="text-sm text-gray-400 mb-1">{{ pack.label }}</p>
                <p class="text-xl font-mono font-bold text-torque-cyan">{{ pack.credits | number }}</p>
                <p class="text-xs text-gray-500 mt-1">\${{ pack.price }}</p>
              </button>
              }
            </div>
            <p class="text-xs text-gray-500 mt-4">
              <button (click)="openBillingPortal()" [disabled]="creditsService.portalLoading()"
                class="text-torque-cyan hover:underline disabled:opacity-50">Manage payment methods and invoices</button>
            </p>
            <!-- Credit usage reference -->
            <div class="mt-6 pt-4 border-t border-white/[0.06]">
              <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Credit Usage</h3>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                @for (item of costItems; track item.label) {
                <div class="text-center py-2 rounded-lg bg-white/[0.02]">
                  <p class="text-sm font-mono font-bold text-torque-cyan">{{ item.cost }} CR</p>
                  <p class="text-[10px] text-gray-500 mt-0.5">{{ item.label }}</p>
                </div>
                }
              </div>
            </div>
          </div>

          <!-- Recent transactions preview -->
          @if (creditsService.transactions().length > 0) {
          <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-semibold text-gray-300">Recent Activity</h2>
              <button (click)="activeTab.set('receipts')" class="text-xs text-torque-cyan hover:underline">View All</button>
            </div>
            <div class="space-y-3">
              @for (txn of recentTransactions(); track txn.id) {
              <div class="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                <div class="flex items-center gap-3">
                  <div [class]="txn.amount > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-orange-500/10 text-orange-400'"
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold">
                    {{ txn.amount > 0 ? '+' : '−' }}
                  </div>
                  <div>
                    <p class="text-sm font-medium">{{ txnLabel(txn) }}</p>
                    <p class="text-xs text-gray-500">{{ txn.created_at | date:'MMM d, y' }}</p>
                  </div>
                </div>
                <span [class]="txn.amount > 0 ? 'text-emerald-400' : 'text-orange-400'" class="font-mono text-sm font-semibold">
                  {{ txn.amount > 0 ? '+' : '' }}{{ txn.amount }} CR
                </span>
              </div>
              }
            </div>
          </div>
          }
        </div>
        }

        <!-- ══════════════════════ MY VEHICLES TAB ══════════════════════ -->
        @if (activeTab() === 'vehicles') {
        <div class="animate-fade-in-up">
          @if (unlockedVehicles().length === 0) {
          <div class="flex flex-col items-center justify-center py-20 text-center">
            <div class="w-16 h-16 bg-white/[0.04] rounded-2xl flex items-center justify-center mb-4">
              <lucide-icon [img]="icons.Car" class="w-8 h-8 text-gray-500"></lucide-icon>
            </div>
            <h3 class="text-lg font-semibold mb-2">No vehicles unlocked yet</h3>
            <p class="text-gray-500 text-sm max-w-xs mb-6">
              Vehicles you unlock will appear here.
            </p>
            <a routerLink="/" class="px-5 py-2 bg-torque-cyan text-black text-sm font-bold rounded-full hover:bg-torque-cyan/90 transition-colors">
              Search Vehicles
            </a>
          </div>
          } @else {
          <div class="space-y-4">
            @for (vehicle of unlockedVehicles(); track vehicle.vehicleId) {
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 hover:border-white/[0.12] transition-colors">
              <div class="flex items-start justify-between gap-4">
                <div class="flex items-center gap-4">
                  <div class="w-10 h-10 bg-torque-cyan/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <lucide-icon [img]="icons.Car" class="w-5 h-5 text-torque-cyan"></lucide-icon>
                  </div>
                  <div>
                    <p class="font-semibold">{{ vehicle.vehicleName || vehicle.vehicleId }}</p>
                    <p class="text-xs text-gray-500 mt-0.5">ID: {{ vehicle.vehicleId }}</p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 justify-end">
                  @for (mod of vehicle.modules; track mod) {
                  <span class="text-xs bg-torque-cyan/10 text-torque-cyan border border-torque-cyan/20 px-2.5 py-1 rounded-full font-medium">
                    {{ moduleLabel(mod) }}
                  </span>
                  }
                </div>
              </div>
            </div>
            }
          </div>
          }
        </div>
        }

        <!-- ══════════════════════ HISTORY TAB (purchases + credit usage) ══════════════════════ -->
        @if (activeTab() === 'receipts') {
        <div class="animate-fade-in-up">
          <p class="text-xs text-gray-500 mb-4">Purchases and usage history.</p>
          @if (creditsService.transactionsLoading()) {
          <div class="space-y-3">
            @for (i of [1,2,3,4,5]; track i) {
            <div class="h-16 bg-white/[0.03] rounded-xl animate-pulse"></div>
            }
          </div>
          } @else if (creditsService.transactions().length === 0) {
          <div class="flex flex-col items-center justify-center py-20 text-center">
            <div class="w-16 h-16 bg-white/[0.04] rounded-2xl flex items-center justify-center mb-4">
              <lucide-icon [img]="icons.Receipt" class="w-8 h-8 text-gray-500"></lucide-icon>
            </div>
            <h3 class="text-lg font-semibold mb-2">No transactions yet</h3>
            <p class="text-gray-500 text-sm">Your transactions will appear here.</p>
          </div>
          } @else {
          <!-- Mobile: card layout -->
          <div class="sm:hidden space-y-3">
            @for (txn of creditsService.transactions(); track txn.id) {
            <div class="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 touch-manipulation">
              <div class="flex justify-between items-start gap-3">
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-white">{{ txnLabel(txn) }}</p>
                  <p class="text-xs text-gray-500 mt-1">{{ txn.created_at | date:'MMM d, y' }}</p>
                </div>
                <span [class.text-emerald-400]="txn.amount > 0" [class.text-orange-400]="txn.amount < 0"
                  class="font-mono font-semibold text-sm flex-shrink-0">
                  {{ txn.amount > 0 ? '+' : '' }}{{ txn.amount }} CR
                </span>
              </div>
              <div class="flex items-center gap-2 mt-2">
                <span [class]="txn.type === 'purchase' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'"
                  class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded">
                  {{ txn.type === 'purchase' ? 'Purchase' : 'Usage' }}
                </span>
                @if (txn.usd_cents) {
                <span class="text-xs text-gray-500">\${{ txn.usd_cents / 100 | number:'1.2-2' }}</span>
                }
              </div>
            </div>
            }
          </div>
          <!-- Desktop: table -->
          <div class="hidden sm:block bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-white/[0.06]">
                  <th class="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Date</th>
                  <th class="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Type</th>
                  <th class="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Description</th>
                  <th class="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Amount</th>
                  <th class="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3">USD</th>
                </tr>
              </thead>
              <tbody>
                @for (txn of creditsService.transactions(); track txn.id) {
                <tr class="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <td class="px-5 py-4 text-gray-400 whitespace-nowrap">{{ txn.created_at | date:'MMM d, y' }}</td>
                  <td class="px-5 py-4">
                    <span [class]="txn.type === 'purchase' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-orange-500/20 text-orange-400'" class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded">
                      {{ txn.type === 'purchase' ? 'Purchase' : 'Usage' }}
                    </span>
                  </td>
                  <td class="px-5 py-4">
                    <p class="font-medium text-white">{{ txnLabel(txn) }}</p>
                    @if (txn.stripe_session_id) {
                    <p class="text-xs text-gray-600 mt-0.5 font-mono truncate max-w-[200px]">{{ txn.stripe_session_id }}</p>
                    }
                  </td>
                  <td class="px-5 py-4 text-right font-mono font-semibold whitespace-nowrap"
                    [class.text-emerald-400]="txn.amount > 0"
                    [class.text-orange-400]="txn.amount < 0">
                    {{ txn.amount > 0 ? '+' : '' }}{{ txn.amount }} CR
                  </td>
                  <td class="px-5 py-4 text-right text-gray-400 whitespace-nowrap">
                    {{ txn.usd_cents ? ('$' + (txn.usd_cents / 100 | number:'1.2-2')) : '—' }}
                  </td>
                </tr>
                }
              </tbody>
            </table>
          </div>
          }
        </div>
        }

      </div>
    </div>
  `
})
export class CreditsDashboardComponent implements OnInit {
  readonly creditsService = inject(CreditsService);
  readonly authService = inject(AuthService);
  readonly route = inject(ActivatedRoute);

  readonly icons = { CreditCard, ArrowLeft, Car, Receipt, User, Check, Clock, ChevronRight, Sparkles, Home, Lock, LayoutDashboard, Settings, LogIn, UserPlus, LogOut, X, AlertCircle };

  activeTab = signal<Tab>('overview');
  processingPurchase = signal(false);
  purchaseSuccess = signal(false);
  showAuthModal = signal(false);
  authModalStartMode = signal<'signin' | 'signup'>('signin');

  readonly tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: LayoutDashboard },
    { id: 'vehicles' as Tab, label: 'My Vehicles', icon: Car },
    { id: 'receipts' as Tab, label: 'History', icon: Receipt },
  ];

  readonly creditPacks = [
    { credits: 1000, price: '10.00', label: 'Starter' },
    { credits: 2500, price: '25.00', label: 'Standard' },
    { credits: 5000, price: '50.00', label: 'Pro' },
  ];

  readonly costItems = [
    { cost: 5, label: 'Specs / Fluids' },
    { cost: 5, label: 'DTCs / TSBs' },
    { cost: 10, label: 'Procedures' },
    { cost: 10, label: 'Diagrams / Parts' },
    { cost: 25, label: 'Full Vehicle Access' },
  ];

  // Computed unlocked vehicles list
  unlockedVehicles = computed(() => {
    const txns = this.creditsService.transactions();
    const unlocks = this.creditsService.unlocks();
    // Build name lookup from transactions
    const vehicleNames: Record<string, string> = {};
    txns.forEach(t => {
      if (t.vehicle_id && t.vehicle_name) {
        vehicleNames[t.vehicle_id] = t.vehicle_name;
      }
    });
    return Object.entries(unlocks).map(([vehicleId, modules]) => ({
      vehicleId,
      vehicleName: vehicleNames[vehicleId] || '',
      modules: modules as string[]
    }));
  });

  unlockedVehicleCount = computed(() => this.unlockedVehicles().length);

  purchaseCount = computed(() =>
    this.creditsService.transactions().filter(t => t.type === 'purchase').length
  );

  totalSpent = computed(() => {
    const cents = this.creditsService.transactions()
      .filter(t => t.type === 'purchase' && t.usd_cents)
      .reduce((sum, t) => sum + (t.usd_cents ?? 0), 0);
    return (cents / 100).toFixed(2);
  });

  recentTransactions = computed(() => this.creditsService.transactions().slice(0, 5));

  ngOnInit() {
    const snapshot = this.route.snapshot;
    const purchase = snapshot.queryParams['purchase'];
    const sessionId = snapshot.queryParams['session_id'];
    if (purchase === 'success') {
      this.processingPurchase.set(true);
    }

    this.route.queryParams.subscribe(async params => {
      if (params['purchase'] === 'success') {
        const sid = params['session_id'];
        let verified = false;
        if (sid) {
          verified = await this.creditsService.verifySession(sid);
        }
        this.processingPurchase.set(false);
        if (verified) {
          this.purchaseSuccess.set(true);
          setTimeout(() => this.purchaseSuccess.set(false), 8000);
        } else if (sid && !this.authService.user()) {
          this.creditsService.lastError.set('Please sign in to complete your purchase. Your payment is saved and credits will be added after sign-in.');
          this.openAuthModal('signin');
        } else if (sid) {
          this.creditsService.lastError.set('Credit fulfillment failed. Please contact support if credits are missing.');
        }
        this.creditsService.refreshBalance();
        this.creditsService.fetchTransactions();
      }
    });

    this.creditsService.fetchTransactions();
  }

  async purchase(amount: number) {
    if (!this.authService.user()) {
      this.authModalStartMode.set('signin');
      this.showAuthModal.set(true);
      return;
    }
    const result = await this.creditsService.startCheckout(amount);
    if (!result.success) {
      this.creditsService.lastError.set(result.error ?? 'Checkout failed');
    }
  }

  openBillingPortal() {
    this.creditsService.openBillingPortal();
  }

  openAuthModal(mode: 'signin' | 'signup') {
    this.authModalStartMode.set(mode);
    this.showAuthModal.set(true);
  }

  async signOut() {
    await this.authService.signOut();
  }

  moduleLabel(mod: string): string {
    return MODULE_LABELS[mod] ?? mod;
  }

  txnLabel(txn: Transaction): string {
    if (txn.type === 'purchase') {
      return `Purchased ${txn.amount.toLocaleString()} Credits`;
    }
    if (txn.type === 'unlock') {
      const mod = MODULE_LABELS[txn.module_type ?? ''] ?? txn.module_type ?? 'Module';
      const veh = txn.vehicle_name || txn.vehicle_id || 'Vehicle';
      return `Unlocked ${mod} — ${veh}`;
    }
    return txn.type.charAt(0).toUpperCase() + txn.type.slice(1);
  }
}
