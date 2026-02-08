import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { MotorApiService } from '../../../../../services/motor-api.service';
import { Part } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, Package, Search } from 'lucide-angular';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

/**
 * Displays vehicle parts with search functionality
 */
@Component({
    selector: 'app-parts-section',
    templateUrl: './parts-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class PartsSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;

    private motorApi = inject(MotorApiService);
    private destroyRef = inject(DestroyRef);

    parts = signal<Part[]>([]);
    isLoading = signal(false);

    // Search state
    searchTerm = signal('');
    private searchSubject = new Subject<string>();

    readonly icons = { Package, Search };

    ngOnInit() {
        // Initial load
        this.loadParts();

        // Setup search debounce with automatic cleanup
        this.searchSubject.pipe(
            debounceTime(500),
            distinctUntilChanged(),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(term => {
            this.loadParts(term);
        });
    }

    onSearch(term: string) {
        this.searchTerm.set(term);
        this.searchSubject.next(term);
    }

    private loadParts(term: string = '') {
        this.isLoading.set(true);
        this.motorApi.getParts(this.contentSource, this.vehicleId, term).subscribe({
            next: (res) => {
                this.parts.set(res.body?.data || []);
                this.isLoading.set(false);
            },
            error: (err) => {
                console.error('Failed to load parts', err);
                this.isLoading.set(false);
                this.parts.set([]);
            }
        });
    }
}
