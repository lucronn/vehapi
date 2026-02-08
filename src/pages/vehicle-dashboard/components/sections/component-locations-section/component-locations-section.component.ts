import { Component, Input, OnInit, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VehicleDataService } from '../../../../../services/vehicle-data.service';
import { ComponentLocation } from '../../../../../models/motor.models';
import { LoadingSkeletonComponent } from '../../../../../components/loading-skeleton/loading-skeleton.component';
import { EmptyStateComponent } from '../../../../../components/empty-state/empty-state.component';
import { LucideAngularModule, TriangleAlert, MapPin, Image } from 'lucide-angular';
import { MotorApiService } from '../../../../../services/motor-api.service';

/**
 * Displays Component Locations
 */
@Component({
    selector: 'app-component-locations-section',
    templateUrl: './component-locations-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, RouterModule, LoadingSkeletonComponent, EmptyStateComponent, LucideAngularModule],
    standalone: true
})
export class ComponentLocationsSectionComponent implements OnInit {
    @Input({ required: true }) contentSource!: string;
    @Input({ required: true }) vehicleId!: string;
    @Input() motorVehicleId?: string;

    private vehicleData = inject(VehicleDataService);
    private motorApi = inject(MotorApiService); // For graphic URL if needed

    locations = signal<ComponentLocation[]>([]);
    isLoading = signal(false);
    readonly icons = { TriangleAlert, MapPin, Image };

    ngOnInit() {
        this.loadData();
    }

    private loadData() {
        if (this.locations().length > 0) return;

        this.vehicleData.loadSectionData(
            'component-locations',
            this.contentSource,
            this.vehicleId,
            this.motorVehicleId,
            this.isLoading,
            (data) => this.locations.set(data as ComponentLocation[]),
            (error) => {
                console.error('Failed to load component locations', error);
                this.isLoading.set(false);
            }
        );
    }

    trackById(index: number, item: ComponentLocation): string {
        return item.id || index.toString();
    }

    getThumbnailUrl(thumbnailHref: string | undefined): string {
        if (!thumbnailHref) return '';
        // If it's already a full URL, return as is (although getGraphicUrl also checks this, 
        // it's good practice to have the same logic or precise delegation)
        if (thumbnailHref.startsWith('http')) return thumbnailHref;
        return this.motorApi.getGraphicUrl(thumbnailHref);
    }
}
