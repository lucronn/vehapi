const STORAGE_KEY = 'torque-persisted-vehicle';

export interface PersistedVehicle {
  vehicleId: string;
  contentSource: string;
  name: string;
}

/**
 * Saves a vehicle to local storage.
 * @param vehicle The vehicle to save.
 */
export function saveVehicle(vehicle: PersistedVehicle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicle));
  } catch (e) {
    console.error('Failed to persist vehicle:', e);
  }
}

/**
 * Retrieves the persisted vehicle from local storage.
 * @returns The persisted vehicle or null if not found or an error occurred.
 */
export function getVehicle(): PersistedVehicle | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data) as PersistedVehicle;
  } catch (e) {
    console.error('Failed to retrieve vehicle:', e);
    return null;
  }
}

/**
 * Clears the persisted vehicle from local storage.
 */
export function clearVehicle(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear vehicle:', e);
  }
}
