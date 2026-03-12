import { describe, it, expect, beforeEach, mock, spyOn, afterEach, beforeAll, afterAll } from 'bun:test';
import { saveVehicle, getVehicle, clearVehicle, PersistedVehicle } from './persistence';

const STORAGE_KEY = 'torque-persisted-vehicle';

describe('Persistence Service', () => {
  const mockVehicle: PersistedVehicle = {
    vehicleId: '123',
    contentSource: 'test',
    name: 'Test Vehicle',
  };

  const store: Record<string, string> = {};
  const originalLocalStorage = global.localStorage;

  beforeAll(() => {
    // Mock localStorage
    global.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key in store) {
          delete store[key];
        }
      },
      key: (index: number) => null,
      length: 0,
    } as Storage;
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    mock.restore();
  });

  // Clean up global mock
  afterAll(() => {
    global.localStorage = originalLocalStorage;
  });

  describe('saveVehicle', () => {
    it('should save vehicle to localStorage', () => {
      saveVehicle(mockVehicle);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(mockVehicle));
    });

    it('should log error if localStorage.setItem throws', () => {
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
      const setItemSpy = spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('Storage full');
      });

      saveVehicle(mockVehicle);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to persist vehicle:', expect.any(Error));
      expect(setItemSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('getVehicle', () => {
    it('should return null if no vehicle in localStorage', () => {
      expect(getVehicle()).toBeNull();
    });

    it('should return vehicle from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockVehicle));
      expect(getVehicle()).toEqual(mockVehicle);
    });

    it('should log error and return null if JSON parse fails', () => {
      const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem(STORAGE_KEY, 'invalid json');

      expect(getVehicle()).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to retrieve vehicle:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });
  });

  describe('clearVehicle', () => {
    it('should remove vehicle from localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockVehicle));
      clearVehicle();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('should log error if localStorage.removeItem throws', () => {
        const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
        const removeItemSpy = spyOn(localStorage, 'removeItem').mockImplementation(() => {
            throw new Error('Storage error');
        });

        clearVehicle();

        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to clear vehicle:', expect.any(Error));
        expect(removeItemSpy).toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
        removeItemSpy.mockRestore();
    });
  });
});
