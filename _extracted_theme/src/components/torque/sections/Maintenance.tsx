import React, { useState, useEffect } from 'react';
import { getMaintenanceByFrequency, getMaintenanceByIntervals, MaintenanceItem } from '@/services/api';
import { Skeleton, EmptyState } from '../LoadingStates';

interface MaintenanceProps {
  contentSource: string;
  vehicleId: string;
}

const Maintenance: React.FC<MaintenanceProps> = ({ contentSource, vehicleId }) => {
  const [frequency, setFrequency] = useState<any>(null);
  const [intervals, setIntervals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'frequency' | 'miles' | 'months'>('frequency');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [freq, miles] = await Promise.allSettled([
          getMaintenanceByFrequency(contentSource, vehicleId),
          getMaintenanceByIntervals(contentSource, vehicleId, 'Miles'),
        ]);
        if (freq.status === 'fulfilled') setFrequency(freq.value);
        if (miles.status === 'fulfilled') setIntervals(miles.value);
      } catch {
        // Maintenance data unavailable, UI will show empty state
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [contentSource, vehicleId]);

  const tabs = [
    { id: 'frequency' as const, label: 'By Frequency' },
    { id: 'miles' as const, label: 'By Mileage' },
    { id: 'months' as const, label: 'By Months' },
  ];

  const renderScheduleData = (data: any) => {
    if (!data) return <EmptyState message="No Data" submessage="Schedule data not available for this view." />;
    
    const schedules = Array.isArray(data) ? data : data?.schedules || data?.data || [];
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return <EmptyState message="No Schedules" submessage="No maintenance schedules found." />;
    }

    return (
      <div className="space-y-3">
        {schedules.map((schedule: any, i: number) => (
          <div key={i} className="glass-card p-4">
            <h4 className="text-sm font-semibold text-white mb-2">
              {schedule.name || schedule.description || schedule.title || `Schedule ${i + 1}`}
            </h4>
            {schedule.items && Array.isArray(schedule.items) && (
              <div className="space-y-2 mt-3">
                {schedule.items.map((item: MaintenanceItem, j: number) => (
                  <div key={j} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-[hsl(191,97%,50%)]/50 mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-white/80">{item.name || item.description || item.title || JSON.stringify(item)}</p>
                      {item.interval && (
                        <span className="text-[10px] font-mono text-[hsl(215,16%,47%)]">{item.interval}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {schedule.intervals && Array.isArray(schedule.intervals) && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left text-[10px] font-mono uppercase tracking-wider text-[hsl(215,16%,47%)] pb-2">Service</th>
                      <th className="text-left text-[10px] font-mono uppercase tracking-wider text-[hsl(215,16%,47%)] pb-2">Interval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.intervals.map((item: MaintenanceItem, j: number) => (
                      <tr key={j} className="border-t border-white/5">
                        <td className="py-2 text-white/80">{item.name || item.description}</td>
                        <td className="py-2 font-mono text-[hsl(191,97%,50%)] text-xs">{item.value || item.interval}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] mb-1 block">MAINTENANCE</span>
        <h2 className="text-xl font-heading font-bold text-white">Maintenance Schedules</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-xs font-mono tracking-wider whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-[hsl(191,97%,50%)]/10 text-[hsl(191,97%,50%)] border border-[hsl(191,97%,50%)]/30'
                : 'bg-white/5 text-[hsl(215,20%,65%)] border border-white/5 hover:border-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton type="list" count={4} />
      ) : (
        <>
          {activeTab === 'frequency' && renderScheduleData(frequency)}
          {activeTab === 'miles' && renderScheduleData(intervals)}
          {activeTab === 'months' && (
            <EmptyState message="Monthly Intervals" submessage="Switch to frequency or mileage view for available data." />
          )}
        </>
      )}
    </div>
  );
};

export default Maintenance;
