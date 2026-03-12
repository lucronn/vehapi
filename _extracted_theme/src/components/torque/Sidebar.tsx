import React from 'react';
import { ArticlesResponse } from '@/services/api';
import {
  ArrowLeftIcon, WarningIcon, DocumentIcon, BoltIcon,
  WrenchIcon, ClipboardIcon, MapPinIcon, CalendarIcon,
  CubeIcon, DatabaseIcon
} from './Icons';

export type Section =
  | 'overview' | 'dtcs' | 'tsbs' | 'diagrams'
  | 'procedures' | 'specifications' | 'components'
  | 'maintenance' | 'parts' | 'alldata';

interface NavItem {
  id: Section;
  label: string;
  icon: React.ReactNode;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dtcs', label: 'FAULT CODES', icon: <WarningIcon className="w-4 h-4" />, group: 'DIAGNOSTICS' },
  { id: 'tsbs', label: 'SERVICE BULLETINS', icon: <DocumentIcon className="w-4 h-4" />, group: 'DIAGNOSTICS' },
  { id: 'diagrams', label: 'WIRING DIAGRAMS', icon: <BoltIcon className="w-4 h-4" />, group: 'SERVICE DATA' },
  { id: 'procedures', label: 'PROCEDURES', icon: <WrenchIcon className="w-4 h-4" />, group: 'SERVICE DATA' },
  { id: 'specifications', label: 'SPECIFICATIONS', icon: <ClipboardIcon className="w-4 h-4" />, group: 'SERVICE DATA' },
  { id: 'components', label: 'COMPONENT LOCATIONS', icon: <MapPinIcon className="w-4 h-4" />, group: 'SERVICE DATA' },
  { id: 'maintenance', label: 'MAINTENANCE', icon: <CalendarIcon className="w-4 h-4" />, group: 'SERVICE DATA' },
  { id: 'parts', label: 'PARTS CATALOG', icon: <CubeIcon className="w-4 h-4" />, group: 'REFERENCE' },
  { id: 'alldata', label: 'ALL DATA', icon: <DatabaseIcon className="w-4 h-4" />, group: 'REFERENCE' },
];

interface SidebarProps {
  vehicleName: string;
  vehicleLoading: boolean;
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  onExit: () => void;
  articlesData: ArticlesResponse | null;
}

const Sidebar: React.FC<SidebarProps> = ({
  vehicleName, vehicleLoading, activeSection, onSectionChange, onExit, articlesData
}) => {
  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const hasData = (section: Section): boolean => {
    if (!articlesData) return true; // show all while loading
    if (section === 'alldata' || section === 'overview') return true;
    if (section === 'specifications' || section === 'maintenance' || section === 'parts') return true;
    // Check if articles exist for this section
    const tabMap: Record<string, string> = {
      dtcs: 'diagnostic',
      tsbs: 'bulletin',
      diagrams: 'diagram',
      procedures: 'procedure',
      components: 'component',
    };
    const keyword = tabMap[section];
    if (!keyword) return true;
    return articlesData.filterTabs?.some(
      t => t.name?.toLowerCase().includes(keyword)
    ) ?? false;
  };

  return (
    <aside className="w-64 flex-shrink-0 h-screen sticky top-0 flex flex-col bg-[hsl(230,35%,9%)]/80 backdrop-blur-xl border-r border-white/5">
      {/* Header */}
      <div className="p-5 border-b border-white/5">
        <button
          onClick={onExit}
          className="flex items-center gap-2 text-xs text-[hsl(215,16%,47%)] hover:text-white transition-colors mb-4 group"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          <span className="font-mono tracking-wider">EXIT SESSION</span>
        </button>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3 bg-[hsl(191,97%,50%)] rounded-full" />
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)]">Active Vehicle</span>
        </div>
        {vehicleLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-5 w-3/4 bg-white/5 rounded" />
            <div className="h-4 w-1/2 bg-white/5 rounded" />
          </div>
        ) : (
          <h2 className="text-lg font-heading font-bold text-white leading-tight">{vehicleName}</h2>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {/* Overview button */}
        <button
          onClick={() => onSectionChange('overview')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 border-l-2 ${
            activeSection === 'overview'
              ? 'border-[hsl(191,97%,50%)] bg-gradient-to-r from-[hsl(191,97%,50%)]/10 to-transparent text-white'
              : 'border-transparent text-[hsl(215,20%,65%)] hover:text-white hover:bg-white/[0.03]'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase">OVERVIEW</span>
        </button>

        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[hsl(215,16%,47%)] px-3 mb-1 block">
              {group}
            </span>
            {items.filter(item => hasData(item.id)).map(item => (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 border-l-2 ${
                  activeSection === item.id
                    ? 'border-[hsl(191,97%,50%)] bg-gradient-to-r from-[hsl(191,97%,50%)]/10 to-transparent text-white'
                    : 'border-transparent text-[hsl(215,20%,65%)] hover:text-white hover:bg-white/[0.03]'
                }`}
              >
                {item.icon}
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] font-mono text-[hsl(215,16%,47%)] tracking-wider">Connected</span>
        <span className="ml-auto text-[10px] font-mono text-[hsl(215,16%,47%)]">V2.4.0</span>
      </div>
    </aside>
  );
};

export default Sidebar;
