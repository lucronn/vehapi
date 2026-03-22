import React, { useState, useEffect, useCallback } from 'react';
import { getVehicleName, searchArticles, ArticlesResponse } from '@/services/api';
import { saveVehicle } from '@/services/persistence';
import Sidebar, { Section } from './Sidebar';
import GlobalSearch from './GlobalSearch';
import ArticleViewer from './ArticleViewer';
import { Skeleton } from './LoadingStates';
import { MenuIcon, XIcon, ArrowLeftIcon } from './Icons';

// Section components
import Overview from './sections/Overview';
import FaultCodes from './sections/FaultCodes';
import Bulletins from './sections/Bulletins';
import Diagrams from './sections/Diagrams';
import Procedures from './sections/Procedures';
import Specifications from './sections/Specifications';
import ComponentLocations from './sections/ComponentLocations';
import Maintenance from './sections/Maintenance';
import Parts from './sections/Parts';
import AllData from './sections/AllData';

interface DashboardProps {
  contentSource: string;
  vehicleId: string;
  vehicleName: string;
  onExit: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ contentSource, vehicleId, vehicleName: initialName, onExit }) => {
  const [vehicleName, setVehicleName] = useState(initialName);
  const [vehicleLoading, setVehicleLoading] = useState(!initialName);
  const [articlesData, setArticlesData] = useState<ArticlesResponse | null>(null);
  const [articlesLoading, setArticlesLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Load vehicle name
      if (!initialName) {
        try {
          setVehicleLoading(true);
          const name = await getVehicleName(contentSource, vehicleId);
          setVehicleName(name);
        } catch (e) {
          setVehicleName('Unknown Vehicle');
        } finally {
          setVehicleLoading(false);
        }
      }

      // Load articles
      try {
        setArticlesLoading(true);
        const data = await searchArticles(contentSource, vehicleId);
        setArticlesData(data);
      } catch (e) {
        console.error('Failed to load articles:', e);
      } finally {
        setArticlesLoading(false);
      }

      // Persist vehicle
      saveVehicle({
        vehicleId,
        contentSource,
        name: initialName || 'Vehicle',
      });
    };
    load();
  }, [contentSource, vehicleId, initialName]);

  // Update persisted name once loaded
  useEffect(() => {
    if (vehicleName && vehicleName !== 'Unknown Vehicle') {
      saveVehicle({ vehicleId, contentSource, name: vehicleName });
    }
  }, [vehicleName, vehicleId, contentSource]);

  const handleArticleSelect = useCallback((articleId: string) => {
    setActiveArticleId(articleId);
  }, []);

  const handleArticleBack = useCallback(() => {
    setActiveArticleId(null);
  }, []);

  const handleSectionChange = useCallback((section: Section) => {
    setActiveSection(section);
    setActiveArticleId(null);
    setMobileMenuOpen(false);
  }, []);

  const renderSection = () => {
    if (activeArticleId) {
      return (
        <ArticleViewer
          contentSource={contentSource}
          vehicleId={vehicleId}
          articleId={activeArticleId}
          onBack={handleArticleBack}
          onArticleNavigate={handleArticleSelect}
        />
      );
    }

    if (articlesLoading) {
      return <Skeleton type="grid" count={6} />;
    }

    switch (activeSection) {
      case 'overview':
        return <Overview contentSource={contentSource} vehicleId={vehicleId} articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'dtcs':
        return <FaultCodes articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'tsbs':
        return <Bulletins contentSource={contentSource} articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'diagrams':
        return <Diagrams contentSource={contentSource} articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'procedures':
        return <Procedures articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'specifications':
        return <Specifications contentSource={contentSource} vehicleId={vehicleId} articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'components':
        return <ComponentLocations contentSource={contentSource} articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'maintenance':
        return <Maintenance contentSource={contentSource} vehicleId={vehicleId} />;
      case 'parts':
        return <Parts articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      case 'alldata':
        return <AllData articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
      default:
        return <Overview contentSource={contentSource} vehicleId={vehicleId} articlesData={articlesData} onArticleSelect={handleArticleSelect} />;
    }
  };

  return (
    <div className="min-h-screen flex relative">
      <div className="mesh-gradient" />
      <div className="scanline-overlay" />

      {/* Desktop Sidebar */}
      <div className="hidden lg:block relative z-20">
        <Sidebar
          vehicleName={vehicleName}
          vehicleLoading={vehicleLoading}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
          onExit={onExit}
          articlesData={articlesData}
        />
      </div>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-[hsl(230,35%,9%)]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={onExit} className="p-1.5 text-[hsl(215,16%,47%)] hover:text-white">
              <ArrowLeftIcon className="w-5 h-5" />
            </button>
            <div>
              <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)] block">ACTIVE</span>
              <span className="text-sm font-heading font-bold text-white truncate max-w-[200px] block">{vehicleName}</span>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-[hsl(215,20%,65%)] hover:text-white"
          >
            {mobileMenuOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-20 bg-[hsl(230,35%,7%)]/95 backdrop-blur-xl pt-16">
          <div className="p-4 grid grid-cols-2 gap-3">
            {([
              { id: 'overview', label: 'Overview' },
              { id: 'dtcs', label: 'Fault Codes' },
              { id: 'tsbs', label: 'Bulletins' },
              { id: 'diagrams', label: 'Diagrams' },
              { id: 'procedures', label: 'Procedures' },
              { id: 'specifications', label: 'Specifications' },
              { id: 'components', label: 'Components' },
              { id: 'maintenance', label: 'Maintenance' },
              { id: 'parts', label: 'Parts' },
              { id: 'alldata', label: 'All Data' },
            ] as { id: Section; label: string }[]).map(item => (
              <button
                key={item.id}
                onClick={() => handleSectionChange(item.id)}
                className={`glass-card p-4 text-center transition-all ${
                  activeSection === item.id ? 'neon-border-cyan' : ''
                }`}
              >
                <span className="text-xs font-mono uppercase tracking-wider text-white">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 relative z-10 min-h-screen lg:min-h-0">
        {/* Decorative blur */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[hsl(191,97%,50%)] opacity-[0.02] rounded-full blur-[150px] pointer-events-none" />

        <div className="pt-16 lg:pt-0 p-4 lg:p-8 max-w-6xl mx-auto">
          {/* Global Search */}
          <div className="mb-6">
            <GlobalSearch articlesData={articlesData} onArticleSelect={handleArticleSelect} />
          </div>

          {/* Section Content */}
          <div className="animate-fade-in">
            {renderSection()}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
