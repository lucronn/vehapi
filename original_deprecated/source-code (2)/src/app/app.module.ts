import { HttpClientModule } from '@angular/common/http';
import { APP_INITIALIZER, ErrorHandler, NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserModule, Title } from '@angular/platform-browser';
import { AkitaNgRouterStoreModule } from '@datorama/akita-ng-router-store';
import { AkitaNgDevtools } from '@datorama/akita-ngdevtools';
import { NgbAccordionModule, NgbModule, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import { NgSelectModule } from '@ng-select/ng-select';
import { LazyLoadImageModule } from 'ng-lazyload-image';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';
import { environment } from '~/environment';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ArticleModalComponent } from './core/components/article-modal/article-modal.component';
import { ArticleToolboxComponent } from './core/components/article-toolbox/article-toolbox.component';
import { BannerComponent } from './core/components/banner/banner.component';
import { DynamicArticleHtmlIframeComponent } from './core/components/dynamic-html-iframe/dynamic-article-html-iframe.component';
import { DynamicArticleHtmlComponent } from './core/components/dynamic-html/dynamic-article-html.component';
import { ErrorComponent } from './core/components/error/error.component';
import { FilterTabsComponent } from './core/components/filter-tabs/filter-tabs.component';
import { GeoBlockingModalComponent } from './core/components/geo-blocking-modal/geo-blocking-modal.component';
import { HorizontalCirclesLoaderComponent } from './core/components/horizontal-circles-loader/horizontal-circles-loader.component';
import { LayoutComponent } from './core/components/layout/layout.component';
import { NavHeaderComponent } from './core/components/nav-header/nav-header.component';
import { GlobalErrorHandler } from './core/error-handling.ts/global-error-handler';
import { UserSettingsService } from './core/user-settings/user-settings.service';
import { DeltaReportComponent } from './delta-report/delta-report.component';
import { HrefRoutingDirective } from './directives/href-routing.directive';
import { ZoomPanSVGDirective } from './directives/zoom-pan-svg.directive';
import { ZoomableImagesDirective } from './directives/zoomable-images.directive';
import { ApiModule } from './generated/api/api.module';
import { LaborOperationComponent } from './labor-operation/labor-operation.component';
import { MaintenanceSchedulesComponent } from './maintenance-schedules/components/maintenance-schedules.component';
import { SafeHtmlPipe } from './pipes/safe-html-pipe';
import { SearchFormComponent } from './search/components/search-form/search-form.component';
import { SearchResultsItemComponent } from './search/components/search-results-item/search-results-item.component';
import { SearchResultsPanelComponent } from './search/components/search-results-panel/search-results-panel.component';
import { YearMakeModelComponent } from './vehicle-selection/components/year-make-model/year-make-model.component';

@NgModule({
  declarations: [
    AppComponent,
    HrefRoutingDirective,
    ZoomPanSVGDirective,
    ZoomableImagesDirective,
    SearchFormComponent,
    LayoutComponent,
    FilterTabsComponent,
    ArticleModalComponent,
    DynamicArticleHtmlComponent,
    DynamicArticleHtmlIframeComponent,
    SearchResultsPanelComponent,
    HorizontalCirclesLoaderComponent,
    SearchResultsItemComponent,
    ArticleToolboxComponent,
    SafeHtmlPipe,
    YearMakeModelComponent,
    ErrorComponent,
    MaintenanceSchedulesComponent,
    BannerComponent,
    NavHeaderComponent,
    LaborOperationComponent,
    GeoBlockingModalComponent,
    DeltaReportComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    NgbPopoverModule,
    NgbAccordionModule,
    FormsModule,
    ReactiveFormsModule,
    NgxExtendedPdfViewerModule,
    ApiModule.forRoot({ rootUrl: '.' }),
    AkitaNgRouterStoreModule,
    LazyLoadImageModule,
    environment.production ? [] : AkitaNgDevtools.forRoot({ sortAlphabetically: true, name: 'Unabridged Service' }),
    NgbModule,
    NgSelectModule,
    NgxExtendedPdfViewerModule
  ],
  providers: [
    Title,
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Force the UserSettingsService to load when the application first starts to set the page title
    { provide: APP_INITIALIZER, useFactory: () => () => {}, deps: [UserSettingsService], multi: true },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
