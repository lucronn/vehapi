import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { NgbAccordionConfig, NgbPanelChangeEvent } from '@ng-bootstrap/ng-bootstrap';
import { combineLatest, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { AssetsFacade } from '~/assets/state/assets.facade';
import { LayoutFacade } from '~/core/state/layout.facade';
import { IntervalType, MaintenanceScheduleApp, MaintenanceScheduleSeverity, Note } from '~/generated/api/models';
import { VehicleSelectionFacade } from '~/vehicle-selection/state/state/vehicle-selection.facade';
import { ExpandCollapse } from '../expand-collapse';
import { FilterBy } from '../filter-by';
import { MaintenanceSchedulesFacade } from '../state/maintenance-schedules.facade';
import { MaintenanceSchedulesByIndicatorStore, MaintenanceSchedulesByIntervalStore } from '../state/maintenance-schedules.store';

@Component({
  selector: 'mtr-maintenance-schedules',
  templateUrl: './maintenance-schedules.component.html',
  styleUrls: ['./maintenance-schedules.component.scss'],
  providers: [NgbAccordionConfig],
})
export class MaintenanceSchedulesComponent implements OnInit, OnDestroy {
  constructor(
    public assetsFacade: AssetsFacade,
    public layoutFacade: LayoutFacade,
    public vehicleSelectionFacade: VehicleSelectionFacade,
    public maintenanceSchedulesFacade: MaintenanceSchedulesFacade,
    private cd: ChangeDetectorRef,
    private config: NgbAccordionConfig,
    private pmsstByIntervalStore: MaintenanceSchedulesByIntervalStore,
    private pmsstByIndicatorStore: MaintenanceSchedulesByIndicatorStore
  ) {
    this.config.type = 'primary';
  }
  filterBy: FilterBy = FilterBy.Miles;
  severity: MaintenanceScheduleSeverity = MaintenanceScheduleSeverity.Normal;
  interval?: number;
  selectedIntervalType: string = '';
  maintenanceSchedulesFound: boolean = true;
  maintenanceSchedulesByFrequency: { [frequency: string]: Array<MaintenanceScheduleApp> } = {};
  maintenanceSchedulesAppsByFrequency: Array<MaintenanceScheduleApp> = [];
  subscriptions: Array<Subscription> = [];
  formErrors = { interval: { required: false, max: false, min: false } };
  hasErrors = false;
  expandOrCollapseAllLabel: ExpandCollapse = ExpandCollapse.ExpandAll;
  searchCompleted: boolean = false;
  isSearchByFrequencyFCompleted: boolean = false;
  isSearchByFrequencyNCompleted: boolean = false;
  isSearchByFrequencyRCompleted: boolean = false;
  isSearchByIndicatorCompleted: boolean = false;
  isSearchByIntervalCompleted: boolean = false;

  intervalsPanelActiveIds: Array<string> = [];
  intervalPanelCloseOthers = true;
  intervalsCount: number = 0;

  intervalPanelIdPrefix = 'intervalsPanel_';

  indicatorsPanelActiveIds: Array<string> = [];
  indicatorPanelCloseOthers = true;
  indicatorsCount: number = 0;

  indicatorPanelIdPrefix = 'indicatorsPanel_';

  frequenciesPanelActiveIds: Array<string> = [];
  frequencyPanelCloseOthers = true;
  frequenciesCount: number = 0;

  frequencyPanelIdPrefix = 'frequenciesPanel_';

  frequencyTypeIndexMapping: { [key: string]: number } = {
    ['F']: 0,
    ['N']: 1,
    ['R']: 2,
  };

  shouldDisplayModelSelector$: Observable<boolean> = this.vehicleSelectionFacade.vehicleIdChoices$.pipe(
    map((vehicleIdChoices) => !!vehicleIdChoices),
    distinctUntilChanged()
  );
  ngOnInit(): void {
    this.subscriptions.push(
      this.maintenanceSchedulesFacade.maintenanceSchedulesByIndicator$.subscribe((indicators) => {
        this.indicatorsCount = indicators ? indicators.length : 0;
        this.isSearchByIndicatorCompleted = true;
      })
    );

    this.subscriptions.push(
      this.maintenanceSchedulesFacade.maintenanceSchedulesByInterval$.subscribe((intervals) => {
        this.intervalsCount = intervals && intervals.length ? intervals[0].intervals!.length : 0;
        this.isSearchByIntervalCompleted = true;
      })
    );

    this.subscriptions.push(
      this.maintenanceSchedulesFacade.maintenanceSchedulesByFrequency$.subscribe((frequencies) => {
        this.updateMaintenanceSchedulesByFrequency(frequencies!);
      })
    );

    this.subscriptions.push(
      combineLatest([
        this.maintenanceSchedulesFacade.maintenanceSchedulesByIndicator$,
        this.maintenanceSchedulesFacade.maintenanceSchedulesByInterval$,
        this.maintenanceSchedulesFacade.maintenanceSchedulesByFrequency$,
      ]).subscribe(() => {
        const isFilterByIndicator = this.filterBy === FilterBy.Indicator;
        if (isFilterByIndicator) {
          if (
            this.isSearchByIndicatorCompleted &&
            this.isSearchByFrequencyFCompleted &&
            this.isSearchByFrequencyNCompleted &&
            this.isSearchByFrequencyRCompleted
          ) {
            this.searchCompleted = true;
            this.maintenanceSchedulesFound = !(this.indicatorsCount === 0 && this.frequenciesCount === 0);
          }
        } else {
          if (
            this.isSearchByIntervalCompleted &&
            this.isSearchByFrequencyFCompleted &&
            this.isSearchByFrequencyNCompleted &&
            this.isSearchByFrequencyRCompleted
          ) {
            this.searchCompleted = true;
            this.maintenanceSchedulesFound = !(this.intervalsCount === 0 && this.frequenciesCount === 0);
          }
        }
        this.cd.detectChanges();
      })
    );
  }

  ngOnDestroy() {
    this.pmsstByIndicatorStore.reset();
    this.pmsstByIntervalStore.reset();
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
  }

  onSubmit() {
    this.initializeForm();
    this.validateForm();

    if (this.hasErrors) {
      return;
    }

    const isFilterByIndicator = this.filterBy === FilterBy.Indicator;

    this.selectedIntervalType = this.filterBy;

    const intervalMapping: { [key: string]: IntervalType } = {
      [FilterBy.Miles]: IntervalType.Miles,
      [FilterBy.Months]: IntervalType.Months,
      [FilterBy.Kilometers]: IntervalType.Kilometers,
    };

    if (isFilterByIndicator) {
      this.interval = undefined;
      this.getMaintenanceSchedulesByFrequency();
      this.maintenanceSchedulesFacade.searchByIndicators(this.severity);
    } else {
      this.getMaintenanceSchedulesByFrequency();
      this.maintenanceSchedulesFacade.searchByInterval(intervalMapping[this.filterBy], this.interval, this.severity);
    }
  }

  initializeForm() {
    this.searchCompleted = false;
    this.maintenanceSchedulesFound = true;
    this.indicatorsCount = 0;
    this.intervalsCount = 0;
    this.frequenciesCount = 0;
    this.frequenciesPanelActiveIds = [];
    this.intervalsPanelActiveIds = [];
    this.indicatorsPanelActiveIds = [];
    this.expandOrCollapseAllLabel = ExpandCollapse.ExpandAll;
    this.maintenanceSchedulesByFrequency = {};
    this.isSearchByIndicatorCompleted = false;
    this.isSearchByIntervalCompleted = false;
    this.isSearchByFrequencyFCompleted = false;
    this.isSearchByFrequencyNCompleted = false;
    this.isSearchByFrequencyRCompleted = false;
  }

  removeItemFromArray(items: Array<string>, value: string) {
    const index = items.indexOf(value);
    if (index !== -1) {
      items.splice(index, 1);
    }
    return items;
  }

  beforePanelChange($event: NgbPanelChangeEvent, type: string) {
    if (type === 'indicator') {
      this.indicatorsPanelActiveIds = this.removeItemFromArray(this.indicatorsPanelActiveIds, $event.panelId);
    } else if (type === 'interval') {
      this.intervalsPanelActiveIds = this.removeItemFromArray(this.intervalsPanelActiveIds, $event.panelId);
    } else if (type === 'frequency') {
      this.frequenciesPanelActiveIds = this.removeItemFromArray(this.frequenciesPanelActiveIds, $event.panelId);
    }

    if (
      !$event.nextState &&
      this.frequenciesPanelActiveIds.length === 0 &&
      this.intervalsPanelActiveIds.length === 0 &&
      this.indicatorsPanelActiveIds.length === 0
    ) {
      this.expandOrCollapseAllLabel = ExpandCollapse.ExpandAll;
      this.frequencyPanelCloseOthers = true;
      this.indicatorPanelCloseOthers = true;
      this.intervalPanelCloseOthers = true;
    }
  }

  updateMaintenanceSchedulesByFrequency(frequencies: { [key: string]: Array<MaintenanceScheduleApp> }) {
    this.maintenanceSchedulesByFrequency = { ...this.maintenanceSchedulesByFrequency, ...frequencies };

    if (frequencies.F) {
      if (frequencies.F.length) {
        this.frequenciesCount++;
      }
      this.isSearchByFrequencyFCompleted = true;
    }

    if (frequencies.N) {
      if (frequencies.N.length) {
        this.frequenciesCount++;
      }
      this.isSearchByFrequencyNCompleted = true;
    }

    if (frequencies.R) {
      if (frequencies.R.length) {
        this.frequenciesCount++;
      }
      this.isSearchByFrequencyRCompleted = true;
    }
  }

  expandCollapseAll() {
    if (this.expandOrCollapseAllLabel === ExpandCollapse.ExpandAll) {
      this.expandOrCollapseAllLabel = ExpandCollapse.CollapseAll;
      switch (this.filterBy) {
        case FilterBy.Miles:
        case FilterBy.Kilometers:
        case FilterBy.Months:
          this.expandOrCollapseIntervalPanels(true);
          break;
        case FilterBy.Indicator:
          this.expandOrCollapseIndicatorPanels(true);
          break;
        default:
          break;
      }
      this.expandOrCollapseFrequencyPanels(true);
    } else {
      this.expandOrCollapseAllLabel = ExpandCollapse.ExpandAll;
      switch (this.filterBy) {
        case FilterBy.Miles:
        case FilterBy.Kilometers:
        case FilterBy.Months:
          this.expandOrCollapseIntervalPanels(false);
          break;
        case FilterBy.Indicator:
          this.expandOrCollapseIndicatorPanels(false);
          break;
        default:
          break;
      }
      this.expandOrCollapseFrequencyPanels(false);
    }
  }

  expandOrCollapseIntervalPanels(expand: boolean) {
    this.intervalsPanelActiveIds = [];

    if (expand) {
      for (let index = 0; index < this.intervalsCount; index++) {
        this.intervalsPanelActiveIds.push(`${this.intervalPanelIdPrefix}${index}`);
      }
    }
    this.intervalPanelCloseOthers = !expand;
  }

  expandOrCollapseIndicatorPanels(expand: boolean) {
    this.indicatorsPanelActiveIds = [];

    if (expand) {
      for (let index = 0; index < this.indicatorsCount; index++) {
        this.indicatorsPanelActiveIds.push(`${this.indicatorPanelIdPrefix}${index}`);
      }
    }
    this.indicatorPanelCloseOthers = !expand;
  }

  expandOrCollapseFrequencyPanels(expand: boolean) {
    this.frequenciesPanelActiveIds = [];

    if (expand) {
      Object.entries(this.maintenanceSchedulesByFrequency).forEach(([key, val]) => {
        if (val.length) {
          this.frequenciesPanelActiveIds.push(`${this.frequencyPanelIdPrefix}${this.frequencyTypeIndexMapping[key]}`);
        }
      });
    }
    this.frequencyPanelCloseOthers = !expand;
  }

  getMaintenanceSchedulesByFrequency() {
    this.maintenanceSchedulesFacade.searchByFrequency('F', this.severity);
    this.maintenanceSchedulesFacade.searchByFrequency('N', this.severity);
    this.maintenanceSchedulesFacade.searchByFrequency('R', this.severity);
  }

  getNotes(notes: Array<Note>) {
    return notes
      .map((e) => e.text)
      .join('  ')
      .trim();
  }

  validateForm() {
    let hasErrors = false;
    this.formErrors = { interval: { required: false, max: false, min: false } };
    if ([FilterBy.Miles, FilterBy.Kilometers, FilterBy.Months].includes(this.filterBy)) {
      if (isNaN(+this.interval!)) {
        this.formErrors.interval.required = true;
        hasErrors = true;
      } else {
        if (this.interval! < 0) {
          this.formErrors.interval.min = true;
          hasErrors = true;
        }
        if (this.filterBy === FilterBy.Months && this.interval! > 240) {
          this.formErrors.interval.max = true;
          hasErrors = true;
        }
      }
    }
    this.hasErrors = hasErrors;
    return hasErrors;
  }
}
