import '@angular/compiler';

import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { authHeaderInterceptor } from './src/interceptors/auth-header.interceptor';
import { provideRouter, withHashLocation } from '@angular/router';
import { ErrorHandler, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { GlobalErrorHandler } from './src/services/global-error-handler';

import { AppComponent } from './src/app.component';
import { HomeComponent } from './src/pages/home/home.component';
import { VehicleDashboardComponent } from './src/pages/vehicle-dashboard/vehicle-dashboard.component';
import { ArticleViewerComponent } from './src/pages/article-viewer/article-viewer.component';
import { CreditsDashboardComponent } from './src/pages/credits-dashboard/credits-dashboard.component';
import { NotFoundComponent } from './src/pages/not-found/not-found.component';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideExperimentalZonelessChangeDetection(),
    provideHttpClient(withFetch(), withInterceptors([authHeaderInterceptor])),
    provideRouter([
      { path: '', component: HomeComponent },
      { path: 'credits', component: CreditsDashboardComponent },
      { path: 'account', component: CreditsDashboardComponent },
      { path: 'vehicle/:contentSource/:vehicleId', component: VehicleDashboardComponent },
      { path: 'vehicle/:contentSource/:vehicleId/article/:articleId', component: ArticleViewerComponent },
      { path: '**', component: NotFoundComponent }
    ], withHashLocation())
  ]
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
