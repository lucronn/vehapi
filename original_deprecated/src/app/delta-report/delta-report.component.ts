import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import { VehicleDeltaReport as VehicleDeltaReportDto } from '~/generated/api/models/vehicle-delta-report';
import { TrackChangeApi } from '~/generated/api/services';

export type VehicleDeltaReportView = {
  serialNumber?: number;
  year: number | null;
  make: string;
  model: string;
  publishedDate: Date | null;
  processedQuarter: string;
  actionState: string;
};

@Component({
  selector: 'mtr-delta-report',
  templateUrl: './delta-report.component.html',
  styleUrls: ['./delta-report.component.scss'],
})
export class DeltaReportComponent implements OnInit {
  constructor(private trackChangesService: TrackChangeApi, private router: Router, private route: ActivatedRoute) {}
  pageNumber: number = 1;
  quarters$!: Observable<Array<string>>;
  reportBase$!: Observable<Array<VehicleDeltaReportDto>>;
  report$!: Observable<Array<VehicleDeltaReportView>>;
  filteredReport$!: Observable<Array<VehicleDeltaReportView>>;

  selectedQuarter?: string;

  // modal state
  showCompareModal = false;
  compareContext?: VehicleDeltaReportView;

  // dropdown state
  allQuarters: Array<string> = [];
  allQuartersSorted: Array<string> = [];
  sourceQuarterSel?: string;
  targetQuarterSel?: string;
  adjacentOptions: Array<string> = [];
  private quarterSelection$ = new BehaviorSubject('');
  private filterTerm$ = new BehaviorSubject('');

  ngOnInit(): void {
    // quarters list
    this.quarters$ = this.trackChangesService.getProcessingQuarters().pipe(
      map((r) => [...(r.body ?? [])]),
      tap((quarters) => {
        this.allQuarters = quarters ?? [];
        this.allQuartersSorted = [...this.allQuarters].sort((a, b) => this.compareQuarters(a, b));

        if (!this.selectedQuarter && quarters.length) {
          this.selectedQuarter = quarters[0];
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.reportBase$ = this.quarterSelection$.pipe(
      switchMap((quarter) =>
        quarter ? this.trackChangesService.getVehicleDeltaReport({ quarter }) : this.trackChangesService.getVehicleDeltaReport()
      ),
      map((r) => r.body ?? []),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.report$ = this.reportBase$.pipe(
      map((rows) =>
        rows.map((dto) => ({
          serialNumber: Number(dto.serialNumber) ?? undefined,
          year: dto.year ? Number(dto.year) : null,
          make: dto.make ?? '',
          model: dto.model ?? '',
          publishedDate: dto.publishedDate ? new Date(dto.publishedDate as any) : null,
          processedQuarter: dto.processedQuarter ?? '',
          actionState: dto.actionState ?? '',
        }))
      )
    );

    this.filteredReport$ = combineLatest([
      this.report$.pipe(startWith([] as Array<VehicleDeltaReportView>)),
      this.filterTerm$.pipe(
        debounceTime(150),
        map((s) => (s ?? '').trim().toLowerCase()),
        distinctUntilChanged()
      ),
    ]).pipe(
      map(([rows, q]) => {
        if (!q) return rows;
        this.pageNumber = 1;
        const tokens = (q.match(/"([^"]+)"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, '').toLowerCase());

        return rows.filter((r) => {
          const dateStr = r.publishedDate ? new Date(r.publishedDate).toLocaleDateString('en-US') : '';
          const searchableItems = [r.year ?? '', r.make ?? '', r.model ?? '', r.processedQuarter ?? '', r.actionState ?? '', dateStr]
            .join(' ')
            .toLowerCase();

          return tokens.every((tok) => searchableItems.includes(tok));
        });
      })
    );

    this.quarterSelection$.next('');
  }

  compareQuarters(a: string, b: string): number {
    const [ay, aq] = a.split('-Q').map(Number);
    const [by, bq] = b.split('-Q').map(Number);
    return ay - by || aq - bq;
  }

  fetchDeltaReport(quarter?: string) {
    this.selectedQuarter = quarter;
    this.quarterSelection$.next(quarter ?? '');
  }

  onFilterChange(term: string) {
    this.filterTerm$.next(term ?? '');
  } 
  
  openCompareModal(row: VehicleDeltaReportView) {
    this.compareContext = row;

    this.sourceQuarterSel = this.selectedQuarter;
    this.targetQuarterSel = undefined;

    this.updateAdjacentOptions();
    this.showCompareModal = true;
  }

  closeCompareModal() {
    this.showCompareModal = false;
    this.compareContext = undefined;
    this.sourceQuarterSel = undefined;
    this.targetQuarterSel = undefined;
    this.adjacentOptions = [];
  }

  onSourceQuarterChange(q?: string) {
    this.sourceQuarterSel = q;
    this.targetQuarterSel = undefined;
    this.updateAdjacentOptions();
  }
  onCompareOk() {
    if (!this.compareContext || !this.sourceQuarterSel || !this.targetQuarterSel) return;

    const v = this.compareContext;
    const vehicleId = `${v.year}:${v.make}:${v.model}`;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        vehicleId,
        contentSource: 'ToyotaDelta',
        sourceQuarter: this.sourceQuarterSel,
        targetQuarter: this.targetQuarterSel,
      },
      queryParamsHandling: 'merge',
    });

    this.closeCompareModal();
  }

  private updateAdjacentOptions() {
    if (!this.sourceQuarterSel || !this.allQuartersSorted.length) {
      this.adjacentOptions = [];
      return;
    }

    const list = this.allQuartersSorted;
    const idx = list.indexOf(this.sourceQuarterSel);

    const neighbors: Array<string> = [];
    if (idx > 0) neighbors.push(list[idx - 1]);
    if (idx < list.length - 1) neighbors.push(list[idx + 1]);

    this.adjacentOptions = neighbors;
  }
}
