import '@angular/compiler';

import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';

import { AppComponent } from './src/app.component';
import { HomeComponent } from './src/pages/home/home.component';
import { VehicleDashboardComponent } from './src/pages/vehicle-dashboard/vehicle-dashboard.component';
import { ArticleViewerComponent } from './src/pages/article-viewer/article-viewer.component';
import { CreditsDashboardComponent } from './src/pages/credits-dashboard/credits-dashboard.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch()),
    provideRouter([
      { path: '', component: HomeComponent },
      { path: 'credits', component: CreditsDashboardComponent },
      { path: 'account', component: CreditsDashboardComponent },
      { path: 'vehicle/:contentSource/:vehicleId', component: VehicleDashboardComponent },
      { path: 'vehicle/:contentSource/:vehicleId/article/:articleId', component: ArticleViewerComponent },
      { path: '**', redirectTo: '', pathMatch: 'full' }
    ], withHashLocation())
  ]
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
