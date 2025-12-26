import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ErrorComponent } from './core/components/error/error.component';
import { LayoutComponent } from './core/components/layout/layout.component';
import { DeltaReportComponent } from './delta-report/delta-report.component';
import { APIUserLogoutGuard } from './guards/api-user-logout-guard';
import { DeltaReportGuard } from './guards/delta-report.guard';
import { MaintenanceSchedulesComponent } from './maintenance-schedules/components/maintenance-schedules.component';
import { PathParameters } from './url-parameters';
import { YearMakeModelComponent } from './vehicle-selection/components/year-make-model/year-make-model.component';

const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: `vehicles`,
  },
  {
    path: `maintenance-schedules`,
    component: MaintenanceSchedulesComponent,
    canActivate: [APIUserLogoutGuard],
  },
  {
    path: `docs/:${PathParameters.filterTab}`,
    component: LayoutComponent,
    canActivate: [APIUserLogoutGuard],
  },
  {
    path: 'vehicles',
    component: YearMakeModelComponent,
    canActivate: [APIUserLogoutGuard],
  },
  {
    path: `delta-report`,
    component: DeltaReportComponent,
    canActivate: [DeltaReportGuard],
  },
  {
    path: '**',
    component: ErrorComponent,
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      anchorScrolling: 'enabled',
      scrollPositionRestoration: 'enabled',
      relativeLinkResolution: 'corrected',
      paramsInheritanceStrategy: 'always',
      initialNavigation: 'enabled',
    }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}
