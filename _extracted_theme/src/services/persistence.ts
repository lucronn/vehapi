const STORAGE_KEY = 'torque-persisted-vehicle';

export interface PersistedVehicle {
  vehicleId: string;
  contentSource: string;
  name: string;
}

export function saveVehicle(vehicle: PersistedVehicle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicle));
  } catch (e) {
    console.warn('Failed to persist vehicle:', e);
  }
}

export function getVehicle(): PersistedVehicle | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data) as PersistedVehicle;
  } catch (e) {
    return null;
  }
}

export function clearVehicle(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear vehicle:', e);
  }
}
