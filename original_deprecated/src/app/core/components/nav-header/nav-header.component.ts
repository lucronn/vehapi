import { Component, Input, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { BehaviorSubject, combineLatest, forkJoin, Observable, of, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, first, map, switchMap, take, takeUntil } from 'rxjs/operators';
import { UserSettingsService } from '~/core/user-settings/user-settings.service';
import { ContentSource, Feedback, FilterTab } from '~/generated/api/models';
import { UiApi } from '~/generated/api/services/ui-api';
import { SearchResultsFacade } from '~/search/state/search-results.facade';
import { filterNullish } from '~/utilities';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';

@Component({
  selector: 'mtr-nav-header',
  templateUrl: './nav-header.component.html',
  styleUrls: ['./nav-header.component.scss'],
})
export class NavHeaderComponent implements OnInit, OnDestroy {
  constructor(
    private modalService: NgbModal,
    public userSettingsService: UserSettingsService,
    private fb: FormBuilder,
    private uiApiService: UiApi,
    private searchResultsFacade: SearchResultsFacade,
    private vehicleSelectionFacade: VehicleSelectionFacade,
    private router: Router
  ) {
    this.selectedVehicle = '';
  }
  modelSelector$: Observable<string | null | undefined> = of('');
  buckets$: Observable<Array<string>> = of([]);
  oemModalRef?: NgbModalRef;
  feedbackForm?: FormGroup;
  selectedVehicle: string;
  showFeedbackModal?: Subject<boolean> = new Subject();
  showConfirmFeedbackModal?: Subject<boolean> = new Subject();
  feedbackFormTitle: string = 'Feedback';
  feedbackConfirmModalTitle: string = 'Feedback Submitted';
  feedbackFormJSON: Array<{ [key: string]: any }> = [];
  searchTerm: string = '';
  buckets: Array<string> = [];
  userId: string = '';
  isVehicleEnabled: boolean = false;
  isUserIdEnabled: boolean = false;
  destroy = new Subject<void>();

  @ViewChild('oemlicensecontent') templateRef?: TemplateRef<any>;

  ngOnInit(): void {
    this.modelSelector$ = combineLatest([
      this.vehicleSelectionFacade.activeVehicleId$.pipe(filterNullish()),
      this.vehicleSelectionFacade.contentSource$.pipe(filterNullish()),
      this.vehicleSelectionFacade.vehicleVin$,
    ]).pipe(
      debounceTime(0),
      switchMap(([vehicleId, contentSource, vin]) =>
        this.vehicleSelectionFacade
          .getVehicleYMM(contentSource, vehicleId)
          .pipe(map((vehicleName) => (vin ? `${vehicleName} - ${vin}` : vehicleName)))
      ),
      distinctUntilChanged(),
      takeUntil(this.destroy)
    );
    this.searchResultsFacade.searchTerm$.pipe(takeUntil(this.destroy)).subscribe((data) => {
      this.searchTerm = data;
    });
    this.userSettingsService.userId$.pipe(takeUntil(this.destroy)).subscribe((data) => {
      this.userId = data ?? '';
    });

    this.buckets$ = this.searchResultsFacade.filterTabs$.pipe(
      map((filterTabs) => {
        const bucketNames: Set<string> = new Set<string>();

        filterTabs.forEach((filterTab) => {
          if (filterTab.articlesCount! > 0 && filterTab.isCountUnknown === false && filterTab.filterTabType !== 'All') {
            filterTab.buckets?.forEach((bucket) => {
              bucketNames.add(bucket.name!);
            });
          }
        });

        return [...bucketNames].sort();
      }),
      takeUntil(this.destroy)
    );
  }

  ngOnDestroy(): void {
    this.destroy.next();
    this.destroy.complete();
    this.showFeedbackModal?.complete();
    this.showConfirmFeedbackModal?.complete();
  }

  openFeedback() {
    forkJoin({
      vehicleName: this.modelSelector$.pipe(take(1)),
      feedbackConfig: this.uiApiService.getFeedbackConfigurations().pipe(take(1)),
    })
      .pipe(takeUntil(this.destroy))
      .subscribe(({ vehicleName, feedbackConfig }) => {
        this.selectedVehicle = vehicleName || '';
        const data = feedbackConfig;
        this.feedbackFormTitle = data.body?.title!;
        this.isUserIdEnabled = data.body?.userID === 'Enabled';
        this.isVehicleEnabled = data.body?.vehicle === 'Enabled';
        this.feedbackFormJSON = [
          {
            type: 'text',
            label: 'Company Name',
            name: 'companyName',
            placeholder: 'Enter company name',
            required: data.body?.companyNameRequired === 'Yes',
            isEnabled: data.body?.companyName === 'Enabled',
            hidden: false,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 100,
          },
          {
            type: 'text',
            label: 'Contact Name',
            name: 'contactName',
            placeholder: 'Enter contact name',
            required: data.body?.contactNameRequired === 'Yes',
            isEnabled: data.body?.contactName === 'Enabled',
            hidden: false,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 100,
          },
          {
            type: 'text',
            label: 'Contact Phone',
            name: 'contactNumber',
            placeholder: 'Enter contact phone',
            required: data.body?.contactNumberRequired === 'Yes',
            isEnabled: data.body?.contactNumber === 'Enabled',
            hidden: false,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 15,
          },
          {
            type: 'email',
            label: 'Email Address',
            name: 'contactEmail',
            placeholder: 'Enter email address',
            required: data.body?.emailAddressRequired === 'Yes',
            isEnabled: data.body?.emailAddress === 'Enabled',
            hidden: false,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 100,
          },
          {
            type: 'dropdown',
            label: 'What is your Feedback About?',
            name: 'feedbackType',
            required: false,
            options: ['Content', 'Search Accuracy and Relevance', 'Other'],
            isEnabled: true,
            hidden: false,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
          },
          {
            type: 'text',
            label: 'Search Term:',
            name: 'searchTerm',
            placeholder: 'Enter search term',
            required: false,
            option: 'Search Accuracy and Relevance',
            hidden: true,
            isEnabled: data.body?.feedbackSearchTerm === 'Enabled',
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 200,
          },
          {
            type: 'checkbox',
            label: 'Click to auto populate search term',
            name: 'autoPopulateSearchTerm',
            required: false,
            option: 'Search Accuracy and Relevance',
            hidden: true,
            isEnabled: true,
            labelClass: 'col-sm-4 right-align search-term-label',
            fieldClass: 'col-sm-1',
          },
          {
            type: 'childdropdown',
            label: 'Content Related To?',
            name: 'contentRelatedTo',
            required: false,
            options: [],
            option: 'Content',
            isEnabled: data.body?.feedbackContentRelatedTo === 'Enabled',
            hidden: true,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
          },
          {
            type: 'text',
            label: 'Article Title',
            name: 'articleTitle',
            placeholder: 'Enter article title',
            required: false,
            option: 'Content',
            isEnabled: data.body?.feedbackArticleTitle === 'Enabled',
            hidden: true,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 200,
          },
          {
            type: 'textarea',
            label: `${data.body?.commentLabel}`,
            name: 'comment',
            placeholder: 'Enter your comment',
            required: data.body?.commentRequired === 'Yes',
            isEnabled: data.body?.comment === 'Enabled',
            hidden: false,
            labelClass: 'col-sm-4 right-align',
            fieldClass: 'col-sm-6',
            maxlength: 500,
          },
        ];
        const formControls: Record<string, AbstractControl> = {};

        this.feedbackFormJSON.forEach((field) => {
          const validators =
            field.type === 'email' && field.required ? [Validators.required, Validators.email] : field.required ? [Validators.required] : [];
          formControls[field.name] = new FormControl('', validators);
        });

        this.feedbackForm = this.fb.group(formControls);
        this.feedbackForm.controls.feedbackType.setValue('Select', { onlySelf: true });
        this.feedbackForm.controls.contentRelatedTo.setValue('Select', { onlySelf: true });
        this.showFeedbackModal?.next(true);
      });
  }

  closeFeedback() {
    this.showFeedbackModal?.next(false);
  }

  closeFeedbackConfirm() {
    this.showConfirmFeedbackModal?.next(false);
  }

  onCheckboxChange(event: Event): void {
    const isChecked: boolean = (event.target as HTMLInputElement).checked;
    if (isChecked) {
      this.feedbackForm?.get('searchTerm')?.setValue(this.searchTerm);
    } else {
      this.feedbackForm?.get('searchTerm')?.setValue('');
    }
  }

  onDropdownChange(event: Event): void {
    const selectedOption = (event.target as HTMLSelectElement).value;

    if (selectedOption) {
      this.feedbackFormJSON.forEach((x) => {
        if (selectedOption === x.option) {
          x.hidden = false;
        } else {
          if (x.option !== undefined && x.hidden === false) {
            x.hidden = true;
          }
        }
      });
    }
    this.feedbackForm?.get('searchTerm')?.setValue('');
    this.feedbackForm?.updateValueAndValidity();
  }

  saveFeedback(): void {
    if (this.feedbackForm?.valid) {
      let contentSource: ContentSource | undefined;
      this.vehicleSelectionFacade.contentSource$.pipe(take(1)).subscribe((v) => (contentSource = v));
      const feedbackTypeValue = this.feedbackForm?.get('feedbackType')?.value as string;
      const contentRelatedToValue = this.feedbackForm?.get('contentRelatedTo')?.value as string;
      const baseUrl = window.location.origin;
      const currentPath = this.router.url;

      const feedback: Feedback = {};
      feedback.articleTitle = this.feedbackForm?.get('articleTitle')?.value as string || null;
      feedback.comment = this.feedbackForm?.get('comment')?.value as string || null;
      feedback.companyName = this.feedbackForm?.get('companyName')?.value as string || null;
      feedback.contactEmail = this.feedbackForm?.get('contactEmail')?.value as string || null;
      feedback.contactName = this.feedbackForm?.get('contactName')?.value as string || null;
      feedback.contactNumber = this.feedbackForm?.get('contactNumber')?.value as string || null;
      feedback.contentRelatedTo = contentRelatedToValue === 'Select' ? null : contentRelatedToValue;
      feedback.feedbackType = feedbackTypeValue === 'Select' ? null : feedbackTypeValue;
      feedback.searchTerm = ((this.feedbackForm?.get('searchTerm')?.value as string) || this.searchTerm) || null;
      feedback.vehicle = this.selectedVehicle;
      feedback.userID = this.userId || null;
      feedback.contentSource = contentSource;
      feedback.url = `${baseUrl}${currentPath}`;

      this.uiApiService.saveFeedback({ body: feedback }).subscribe((data) => {
        this.closeFeedback();
        this.showConfirmFeedbackModal?.next(true);
      });
    }
  }

  openOEMAgreement() {
    this.oemModalRef = this.modalService.open(this.templateRef, { size: 'xl' });
  }

  closeOEMModal() {
    this.oemModalRef?.close();
  }

  logout() {
    document.location.href = `/logout`;
  }

  logoutApiUser() {
    sessionStorage.setItem('apiUserLogOutData', '{"apiUserLoggedOut":true}');
    this.userSettingsService.apiUserLogoutURL$.subscribe((url) => {
      document.location.href = url!;
    });
  }
}
