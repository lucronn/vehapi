import { Injectable, inject } from '@angular/core';
import { PersistedVehicle } from '../models/motor.models';
import { LoggerService } from './logger.service';

const STORAGE_KEY = 'torque-persisted-vehicle';

@Injectable({ providedIn: 'root' })
export class VehiclePersistenceService {
  private logger = inject(LoggerService);

  saveVehicle(vehicle: PersistedVehicle): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicle));
    } catch (e) {
      this.logger.error('Error saving vehicle to local storage', e);
    }
  }

  getVehicle(): PersistedVehicle | null {
    try {
      const storedVehicle = localStorage.getItem(STORAGE_KEY);
      return storedVehicle ? JSON.parse(storedVehicle) : null;
    } catch (e) {
      this.logger.error('Error getting vehicle from local storage', e);
      return null;
    }
  }

  clearVehicle(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      this.logger.error('Error clearing vehicle from local storage', e);
    }
  }
}
