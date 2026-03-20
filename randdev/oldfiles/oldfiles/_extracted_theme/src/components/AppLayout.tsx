import React, { useState, useCallback } from 'react';
import HomePage from './torque/HomePage';
import Dashboard from './torque/Dashboard';

type View = 'home' | 'dashboard';

interface VehicleState {
  contentSource: string;
  vehicleId: string;
  name: string;
}

const AppLayout: React.FC = () => {
  const [view, setView] = useState<View>('home');
  const [vehicle, setVehicle] = useState<VehicleState | null>(null);

  const handleVehicleSelect = useCallback((contentSource: string, vehicleId: string, name: string) => {
    setVehicle({ contentSource, vehicleId, name });
    setView('dashboard');
  }, []);

  const handleExit = useCallback(() => {
    setView('home');
    setVehicle(null);
  }, []);

  if (view === 'dashboard' && vehicle) {
    return (
      <Dashboard
        contentSource={vehicle.contentSource}
        vehicleId={vehicle.vehicleId}
        vehicleName={vehicle.name}
        onExit={handleExit}
      />
    );
  }

  return <HomePage onVehicleSelect={handleVehicleSelect} />;
};

export default AppLayout;
