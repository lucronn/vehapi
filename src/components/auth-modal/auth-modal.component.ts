import { Component, signal, inject, output, input, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { FocusDepthDirective } from '../../directives/focus-depth.directive';
import { LucideAngularModule, Mail, Lock, Eye, EyeOff, X, Chrome, UserCheck, Loader } from 'lucide-angular';

type AuthMode = 'signin' | 'signup' | 'reset';

@Component({
    selector: 'app-auth-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, FocusDepthDirective],
    template: `
    <div class="modal-backdrop modal-backdrop-blur" appFocusDepth (click)="onBackdropClick($event)">
      <div class="modal-panel modal-panel-shadow" (click)="$event.stopPropagation()">

        <!-- Close Button -->
        <button class="modal-close" (click)="close.emit()">
          <lucide-angular [img]="icons.X" size="16" />
        </button>

        <!-- Header -->
        <div class="modal-header">
          <div class="modal-logo">⚡</div>
          <h2 class="modal-title">
            @if (mode() === 'signin') { Sign In }
            @else if (mode() === 'signup') { Create Account }
            @else { Reset Password }
          </h2>
          <p class="modal-subtitle">
            @if (mode() === 'signin') { Access your vehicle data and credits }
            @else if (mode() === 'signup') { Get started with free credits }
            @else { We'll send you a reset link }
          </p>
        </div>

        <!-- Error / Success -->
        @if (errorMessage()) {
          <div class="alert alert-error">{{ errorMessage() }}</div>
        }
        @if (successMessage()) {
          <div class="alert alert-success">{{ successMessage() }}</div>
        }

        <!-- Form -->
        <form class="auth-form" (ngSubmit)="onSubmit()">
          <div class="form-field">
            <label class="field-label">Email</label>
            <div class="input-wrapper">
              <lucide-angular [img]="icons.Mail" size="16" class="input-icon" />
              <input
                type="email"
                class="form-input"
                [(ngModel)]="email"
                name="email"
                placeholder="you@example.com"
                required
                autocomplete="email"
              />
            </div>
          </div>

          @if (mode() !== 'reset') {
            <div class="form-field">
              <label class="field-label">Password</label>
              <div class="input-wrapper">
                <lucide-angular [img]="icons.Lock" size="16" class="input-icon" />
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  class="form-input"
                  [(ngModel)]="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  autocomplete="current-password"
                />
                <button type="button" class="password-toggle" (click)="toggleShowPassword()">
                  <lucide-angular [img]="showPassword() ? icons.EyeOff : icons.Eye" size="14" />
                </button>
              </div>
            </div>
          }

          <button type="submit" class="btn-primary" [disabled]="loading()">
            @if (loading()) {
              <lucide-angular [img]="icons.Loader" size="14" class="spin" /> Loading...
            } @else if (mode() === 'signin') {
              <lucide-angular [img]="icons.UserCheck" size="14" /> Sign In
            } @else if (mode() === 'signup') {
              Create Account
            } @else {
              Send Reset Link
            }
          </button>
        </form>

        @if (mode() !== 'reset') {
          <div class="divider"><span>or</span></div>
          <button class="btn-google" (click)="signInWithGoogle()" [disabled]="loading()">
            <lucide-angular [img]="icons.Chrome" size="16" />
            Continue with Google
          </button>
        }

        <!-- Footer Links -->
        <div class="modal-footer">
          @if (mode() === 'signin') {
            <button class="link-btn" (click)="setMode('reset')">Forgot password?</button>
            <span class="footer-sep">·</span>
            <button class="link-btn" (click)="setMode('signup')">Create account</button>
          } @else if (mode() === 'signup') {
            <button class="link-btn" (click)="setMode('signin')">Already have an account? Sign in</button>
          } @else {
            <button class="link-btn" (click)="setMode('signin')">← Back to Sign In</button>
          }
        </div>
      </div>
    </div>
  `,
    styles: [`
    .modal-backdrop {
      position: fixed; inset: 0; z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      padding: calc(1rem + env(safe-area-inset-top, 0px)) 1rem calc(1rem + env(safe-area-inset-bottom, 0px));
      animation: backdropIn 0.2s ease;
      overflow: auto;
    }
    @keyframes backdropIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .modal-panel {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
      width: 100%;
      max-width: 420px;
      position: relative;
      animation: modalIn 0.25s ease;
      max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
      overflow: auto;
    }
    @keyframes modalIn {
      from { opacity: 0; transform: scale(0.95) translateY(-8px); }
      to { opacity: 1; transform: none; }
    }
    .modal-close {
      position: absolute; top: 1rem; right: 1rem;
      background: none; border: none; cursor: pointer;
      color: var(--text-muted);
      padding: 6px; border-radius: 8px;
      transition: color 0.2s, background 0.2s;
      min-width: 36px; min-height: 36px;
    }
    .modal-close:hover { color: var(--text-primary); background: var(--bg-hover); }
    .modal-header { text-align: center; margin-bottom: 1.5rem; }
    .modal-logo { font-size: 2rem; margin-bottom: 0.5rem; }
    .modal-title { font-size: 1.4rem; font-weight: 700; color: white; margin: 0 0 0.25rem; }
    .modal-subtitle { font-size: 0.85rem; color: hsl(220, 10%, 55%); margin: 0; }
    .alert {
      padding: 0.6rem 0.85rem; border-radius: 8px; font-size: 0.83rem;
      margin-bottom: 1rem;
    }
    .alert-error { background: hsl(0,60%,15%); border: 1px solid hsl(0,60%,30%); color: hsl(0,80%,75%); }
    .alert-success { background: hsl(140,40%,12%); border: 1px solid hsl(140,40%,25%); color: hsl(140,60%,65%); }
    .auth-form { display: flex; flex-direction: column; gap: 1rem; }
    .form-field { display: flex; flex-direction: column; gap: 0.4rem; }
    .field-label { font-size: 0.8rem; font-weight: 600; color: hsl(220, 10%, 65%); letter-spacing: 0.04em; }
    .input-wrapper { position: relative; display: flex; align-items: center; }
    .input-icon {
      position: absolute; left: 0.75rem;
      color: hsl(220, 10%, 45%); pointer-events: none;
    }
    .form-input {
      width: 100%; padding: 0.6rem 0.75rem 0.6rem 2.25rem;
      background: hsl(220, 16%, 14%);
      border: 1px solid hsl(220, 16%, 22%);
      border-radius: 8px; color: white; font-size: 0.9rem;
      outline: none; transition: border-color 0.2s;
      box-sizing: border-box;
    }
    .form-input:focus { border-color: var(--primary); outline: none; }
    .form-input::placeholder { color: hsl(220,10%,35%); }
    .password-toggle {
      position: absolute; right: 0.6rem;
      background: none; border: none; cursor: pointer;
      color: hsl(220,10%,45%); padding: 4px;
    }
    .password-toggle:hover { color: white; }
    .btn-primary {
      margin-top: 0.25rem; padding: 0.75rem;
      background: var(--primary);
      border: none; border-radius: var(--radius-sm);
      color: var(--primary-text); font-weight: 600; font-size: 0.9rem;
      cursor: pointer; transition: background 0.2s, box-shadow 0.2s;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    }
    .btn-primary:hover:not(:disabled) { background: var(--primary-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .divider {
      display: flex; align-items: center; gap: 0.75rem;
      margin: 1rem 0; color: hsl(220,10%,40%); font-size: 0.8rem;
    }
    .divider::before, .divider::after {
      content: ''; flex: 1; height: 1px;
      background: hsl(220,16%,20%);
    }
    .btn-google {
      width: 100%; padding: 0.65rem;
      background: hsl(220, 16%, 16%);
      border: 1px solid hsl(220, 16%, 24%);
      border-radius: 8px; color: white;
      font-size: 0.88rem; font-weight: 500;
      cursor: pointer; transition: background 0.2s;
      display: flex; align-items: center; justify-content: center; gap: 0.6rem;
    }
    .btn-google:hover:not(:disabled) { background: hsl(220, 16%, 22%); }
    .btn-google:disabled { opacity: 0.5; cursor: not-allowed; }
    .modal-footer {
      margin-top: 1.25rem; display: flex; align-items: center;
      justify-content: center; gap: 0.5rem; flex-wrap: wrap;
    }
    .link-btn {
      background: none; border: none; cursor: pointer;
      color: var(--primary); font-size: 0.82rem;
      padding: 0; text-decoration: underline; text-underline-offset: 2px;
    }
    .link-btn:hover { color: var(--primary-hover); }
    .footer-sep { color: hsl(220,10%,40%); }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (min-width: 640px) {
      .modal-panel {
        padding: 2rem;
      }
    }
  `]
})
export class AuthModalComponent {
    close = output<void>();
    /** When provided, open in this mode (e.g. 'signup' for registration). */
    startMode = input<AuthMode>('signin');

    private authService = inject(AuthService);

    readonly icons = { Mail, Lock, Eye, EyeOff, X, Chrome, UserCheck, Loader };

    email = '';
    password = '';
    mode = signal<AuthMode>('signin');

    constructor() {
        effect(() => this.mode.set(this.startMode()));
    }
    loading = signal(false);
    showPassword = signal(false);

    toggleShowPassword() {
        this.showPassword.update(v => !v);
    }
    errorMessage = signal('');
    successMessage = signal('');

    setMode(newMode: AuthMode) {
        this.mode.set(newMode);
        this.errorMessage.set('');
        this.successMessage.set('');
    }

    @HostListener('document:keydown.escape')
    onEscape() {
        this.close.emit();
    }

    onBackdropClick(e: MouseEvent) {
        if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
            this.close.emit();
        }
    }

    async onSubmit() {
        this.errorMessage.set('');
        this.successMessage.set('');
        this.loading.set(true);

        try {
            if (this.mode() === 'signin') {
                await this.authService.signInWithEmail(this.email, this.password);
                this.close.emit();
            } else if (this.mode() === 'signup') {
                await this.authService.signUpWithEmail(this.email, this.password);
                this.successMessage.set('Account created! Check your email to confirm.');
            } else {
                await this.authService.resetPassword(this.email);
                this.successMessage.set('Reset link sent! Check your email.');
            }
        } catch (err: any) {
            this.errorMessage.set(err.message || 'An error occurred. Please try again.');
        } finally {
            this.loading.set(false);
        }
    }

    async signInWithGoogle() {
        this.loading.set(true);
        this.errorMessage.set('');
        try {
            await this.authService.signInWithGoogle();
            // Redirect happens automatically
        } catch (err: any) {
            this.errorMessage.set(err.message || 'Google sign-in failed.');
            this.loading.set(false);
        }
    }
}
