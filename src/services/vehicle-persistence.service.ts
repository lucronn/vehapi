import { Injectable } from '@angular/core';
import { PersistedVehicle } from '../models/motor.models';

const STORAGE_KEY = 'torque-persisted-vehicle';

@Injectable({ providedIn: 'root' })
export class VehiclePersistenceService {

  saveVehicle(vehicle: PersistedVehicle): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicle));
    } catch (e) {
      console.error('Error saving vehicle to local storage', e);
    }
  }

  getVehicle(): PersistedVehicle | null {
    try {
      const storedVehicle = localStorage.getItem(STORAGE_KEY);
      return storedVehicle ? JSON.parse(storedVehicle) : null;
    } catch (e) {
      console.error('Error getting vehicle from local storage', e);
      return null;
    }
  }

  clearVehicle(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Error clearing vehicle from local storage', e);
    }
  }
}
