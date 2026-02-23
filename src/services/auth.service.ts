import { Injectable, signal, computed } from '@angular/core';
import { initializeApp, getApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, User, onAuthStateChanged, Auth } from 'firebase/auth';
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private app: FirebaseApp;
  private auth: Auth;

  // Signals for user state
  readonly user = signal<User | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly isAuthenticated = computed(() => !!this.user());

  constructor() {
    // Initialize Firebase if needed
    if (getApps().length === 0) {
      this.app = initializeApp(environment.firebaseConfig);
    } else {
      this.app = getApp();
    }

    this.auth = getAuth(this.app);

    // Subscribe to auth state changes
    onAuthStateChanged(this.auth, (user) => {
      this.user.set(user);
      this.isLoading.set(false);
    });
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(this.auth, provider);
    } catch (error) {
      console.error('Google sign-in failed:', error);
      throw error;
    }
  }

  async signOut(): Promise<void> {
    try {
      await signOut(this.auth);
    } catch (error) {
      console.error('Sign-out failed:', error);
      throw error;
    }
  }

  async getIdToken(): Promise<string | null> {
    const currentUser = this.auth.currentUser;
    if (currentUser) {
      return currentUser.getIdToken();
    }
    return null;
  }
}
