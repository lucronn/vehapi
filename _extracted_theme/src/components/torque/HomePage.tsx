import React, { useState, useEffect, useRef } from 'react';
import { getYears, getMakes, getModels, decodeVin, Make, Model, Engine, ModelsResponse } from '@/services/api';
import { getVehicle, clearVehicle, PersistedVehicle } from '@/services/persistence';
import { SearchIcon, XIcon, ArrowRightIcon, ChevronRightIcon } from './Icons';
import { LoadingSpinner } from './LoadingStates';
const HERO_IMAGE = 'https://d64gsuwffb70l.cloudfront.net/698d9bcdff02f190d5f3d224_1770888253924_9ff9e688.jpg';
type SearchStep = 'year' | 'make' | 'model' | 'engine' | 'done';
interface HomePageProps {
  onVehicleSelect: (contentSource: string, vehicleId: string, name: string) => void;
}
const HomePage: React.FC<HomePageProps> = ({
  onVehicleSelect
}) => {
  const [persisted, setPersisted] = useState<PersistedVehicle | null>(null);
  const [step, setStep] = useState<SearchStep>('year');
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [yearsLoaded, setYearsLoaded] = useState(false);
  const [years, setYears] = useState<number[]>([]);
  const [makes, setMakes] = useState<Make[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [contentSource, setContentSource] = useState('');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMake, setSelectedMake] = useState<Make | null>(null);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const v = getVehicle();
    if (v) setPersisted(v);
    loadYears();
  }, []);
  const loadYears = async () => {
    try {
      setLoading(true);
      const data = await getYears();
      setYears(data.sort((a, b) => b - a));
      setYearsLoaded(true);
    } catch (e) {
      setError('Failed to connect to vehicle database');
    } finally {
      setLoading(false);
    }
  };
  const loadMakes = async (year: number) => {
    try {
      setLoading(true);
      setError('');
      const data = await getMakes(year);
      setMakes(data);
      setStep('make');
      setInputValue('');
      setShowDropdown(true);
    } catch (e) {
      setError('Failed to load manufacturers');
    } finally {
      setLoading(false);
    }
  };
  const loadModels = async (year: number, makeId: number) => {
    try {
      setLoading(true);
      setError('');
      const data: ModelsResponse = await getModels(year, makeId);
      setModels(data.models || []);
      setContentSource(data.contentSource || '');
      setStep('model');
      setInputValue('');
      setShowDropdown(true);
    } catch (e) {
      setError('Failed to load models');
    } finally {
      setLoading(false);
    }
  };
  const selectYear = (year: number) => {
    setSelectedYear(year);
    setSelectedMake(null);
    setSelectedModel(null);
    loadMakes(year);
  };
  const selectMake = (make: Make) => {
    setSelectedMake(make);
    setSelectedModel(null);
    if (selectedYear) loadModels(selectedYear, make.makeId);
  };
  const selectModel = (model: Model) => {
    setSelectedModel(model);
    if (model.engines && model.engines.length > 1) {
      setStep('engine');
      setInputValue('');
      setShowDropdown(true);
    } else {
      const vid = model.engines?.[0]?.id || model.id;
      const name = `${selectedYear} ${selectedMake?.makeName} ${model.model}`;
      onVehicleSelect(contentSource, vid, name);
    }
  };
  const selectEngine = (engine: Engine) => {
    const name = `${selectedYear} ${selectedMake?.makeName} ${selectedModel?.model} ${engine.name}`;
    onVehicleSelect(contentSource, engine.id, name);
  };
  const handleVinDecode = async (vin: string) => {
    try {
      setLoading(true);
      setError('');
      const result = await decodeVin(vin);
      const name = `${result.year} ${result.make} ${result.model}`;
      onVehicleSelect(result.contentSource, result.vehicleId, name);
    } catch (e) {
      setError('VIN not recognized. Please verify and try again.');
    } finally {
      setLoading(false);
    }
  };
  const isVin = (val: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(val.replace(/\s/g, ''));
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setError('');
    if (!showDropdown) setShowDropdown(true);

    // Smart year detection: if user types a 4-digit year
    if (step === 'year' && /^\d{4}$/.test(val.trim())) {
      const yearNum = parseInt(val.trim());
      if (years.includes(yearNum)) {
        selectYear(yearNum);
        return;
      }
    }
  };
  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (isVin(trimmed)) {
      handleVinDecode(trimmed);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') setShowDropdown(false);
  };
  const removePill = (type: string) => {
    if (type === 'year') {
      setSelectedYear(null);
      setSelectedMake(null);
      setSelectedModel(null);
      setStep('year');
      setMakes([]);
      setModels([]);
    } else if (type === 'make') {
      setSelectedMake(null);
      setSelectedModel(null);
      setStep('make');
      setModels([]);
    } else if (type === 'model') {
      setSelectedModel(null);
      setStep('model');
    }
    setInputValue('');
    setShowDropdown(true);
  };
  const getPlaceholder = () => {
    switch (step) {
      case 'year':
        return 'Enter VIN or select Year...';
      case 'make':
        return 'Search Make...';
      case 'model':
        return 'Search Model...';
      case 'engine':
        return 'Select Engine...';
      default:
        return 'Search...';
    }
  };
  const getFilteredYears = () => {
    if (!inputValue) return years;
    return years.filter(y => String(y).includes(inputValue));
  };
  const getFilteredMakes = () => {
    if (!inputValue) return makes;
    return makes.filter(m => m.makeName.toLowerCase().includes(inputValue.toLowerCase()));
  };
  const getFilteredModels = () => {
    if (!inputValue) return models;
    return models.filter(m => m.model.toLowerCase().includes(inputValue.toLowerCase()));
  };
  const handleResetSession = () => {
    clearVehicle();
    setPersisted(null);
  };
  const handleResume = () => {
    if (persisted) onVehicleSelect(persisted.contentSource, persisted.vehicleId, persisted.name);
  };
  const getStepLabel = () => {
    switch (step) {
      case 'year':
        return 'SELECT YEAR';
      case 'make':
        return 'SELECT MAKE';
      case 'model':
        return 'SELECT MODEL';
      case 'engine':
        return 'SELECT ENGINE';
      default:
        return '';
    }
  };

  // ---- WELCOME BACK STATE ----
  if (persisted && step === 'year' && !selectedYear) {
    return <div className="min-h-screen flex flex-col relative bg-[hsl(230,35%,7%)]">
        <div className="mesh-gradient" />
        <div className="scanline-overlay" />
        <header className="relative z-10 flex items-center justify-between px-6 py-5">
          <Logo />
          <button onClick={handleResetSession} className="btn-glass text-xs font-mono tracking-wider">RESET SESSION</button>
        </header>
        <div className="flex-1 flex items-center justify-center relative z-10 px-4">
          <div className="max-w-lg w-full animate-fade-in-up" style={{
          animationFillMode: 'both'
        }}>
            <h1 className="text-4xl md:text-5xl font-heading font-bold text-white mb-3 tracking-tight">
              System Ready<span className="text-[hsl(191,97%,50%)]">.</span>
            </h1>
            <p className="text-[hsl(215,20%,65%)] mb-8 text-lg">
              Welcome back. Your vehicle session is currently active and synchronized.
            </p>
            <div className="glass-card neon-border-cyan p-6 relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)]">Active Vehicle</span>
                <ArrowRightIcon className="w-4 h-4 text-[hsl(191,97%,50%)]" />
              </div>
              <h2 className="text-2xl font-heading font-bold text-white mb-6">{persisted.name}</h2>
              <button onClick={handleResume} className="btn-primary w-full py-4 text-base font-heading tracking-wide">
                Initialize Dashboard
              </button>
              {/* Animated scan line */}
              <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
                <div className="h-full w-full bg-gradient-to-r from-transparent via-[hsl(191,97%,50%)]/60 to-transparent animate-scan" />
              </div>
            </div>
            <button onClick={handleResetSession} className="mt-4 text-sm text-[hsl(215,16%,47%)] hover:text-[hsl(191,97%,50%)] transition-colors w-full text-center">
              Switch to another vehicle
            </button>
          </div>
        </div>
        <Footer />
      </div>;
  }

  // ---- FRESH SEARCH STATE ----
  return <div className="min-h-screen flex flex-col relative bg-[hsl(230,35%,7%)]">
      <div className="mesh-gradient" />
      <div className="scanline-overlay" />

      {/* Hero background image (subtle) */}
      <div className="fixed inset-0 z-0 opacity-[0.06] bg-cover bg-center pointer-events-none" style={{
      backgroundImage: `url(${HERO_IMAGE})`
    }} />

      {/* Ambient Orbs */}
      <div className="fixed top-[-100px] left-[-100px] w-[400px] h-[400px] bg-[hsl(191,97%,50%)] opacity-[0.04] rounded-full blur-[120px] animate-glow-pulse pointer-events-none" />
      <div className="fixed bottom-[-100px] right-[-100px] w-[400px] h-[400px] bg-[hsl(263,83%,58%)] opacity-[0.04] rounded-full blur-[120px] animate-glow-pulse pointer-events-none" style={{
      animationDelay: '2s'
    }} />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Logo />
        <div className="flex items-center gap-3">
          {persisted && <button onClick={handleResetSession} className="btn-glass text-xs font-mono tracking-wider">RESET SESSION</button>}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center relative z-10 px-4 pb-20">
        <div className="max-w-[900px] w-full">
          {/* Heading */}
          <div className="text-center mb-10 animate-fade-in-up" style={{
          animationFillMode: 'both'
        }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/5 mb-6">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(215,20%,65%)]">{yearsLoaded ? 'Database Connected' : 'Connecting...'}DATABASES ONLINE</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-heading font-bold text-white mb-4 tracking-tight leading-[1.1]">
              Professional <span className="text-transparent bg-clip-text bg-gradient-to-r from-[hsl(191,97%,50%)] to-[hsl(263,83%,58%)]">Intelligence</span>
              <br className="hidden sm:block" /> for your vehicle.
            </h1>
            <p className="text-[hsl(215,20%,65%)] text-base md:text-lg max-w-xl mx-auto leading-relaxed">
              Access manufacturer specs, diagrams, and AI-powered troubleshooting instantly.
            </p>
          </div>

          {/* Selection Breadcrumbs */}
          {(selectedYear || selectedMake || selectedModel) && <div className="flex flex-wrap gap-2 mb-4 justify-center animate-fade-in">
              {selectedYear && <Pill label={String(selectedYear)} onRemove={() => removePill('year')} color="cyan" />}
              {selectedMake && <Pill label={selectedMake.makeName} onRemove={() => removePill('make')} color="cyan" />}
              {selectedModel && <Pill label={selectedModel.model} onRemove={() => removePill('model')} color="green" />}
            </div>}

          {/* Step indicator */}
          {step !== 'year' && <div className="text-center mb-3 animate-fade-in">
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)]">{getStepLabel()}</span>
            </div>}

          {/* Search Console */}
          <div className="relative animate-fade-in-up stagger-2" style={{
          animationFillMode: 'both'
        }}>
            {/* Gradient glow border */}
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r from-[hsl(191,97%,50%)]/20 via-transparent to-[hsl(263,83%,58%)]/20 pointer-events-none z-0" />

            <div className="glass-card relative z-[1]">
              <div className="p-2">
                <div className="flex items-center gap-3 px-4 py-2">
                  <SearchIcon className="w-5 h-5 text-[hsl(215,16%,47%)] flex-shrink-0" />
                  <input ref={inputRef} type="text" value={inputValue} onChange={handleInputChange} onFocus={() => setShowDropdown(true)} onKeyDown={handleKeyDown} placeholder={getPlaceholder()} className="flex-1 bg-transparent text-white text-lg font-heading placeholder-[hsl(215,16%,47%)] outline-none min-w-0" autoComplete="off" />
                  {inputValue && isVin(inputValue.trim()) && <button onClick={handleSubmit} className="btn-primary px-6 py-2.5 text-sm flex-shrink-0">
                      Initialize
                    </button>}
                </div>

                {/* Dropdown */}
                {showDropdown && !loading && <div className="border-t border-white/5 max-h-[400px] overflow-y-auto">
                    {error && <div className="px-6 py-4 text-red-400 text-sm font-mono">{error}</div>}
                    {step === 'year' && <YearGrid years={getFilteredYears()} onSelect={selectYear} />}
                    {step === 'make' && <ListItems items={getFilteredMakes().map(m => ({
                  id: m.makeId,
                  label: m.makeName
                }))} onSelect={id => {
                  const make = makes.find(m => m.makeId === id);
                  if (make) selectMake(make);
                }} />}
                    {step === 'model' && <ListItems items={getFilteredModels().map(m => ({
                  id: m.id || m.model,
                  label: m.model
                }))} onSelect={id => {
                  const model = models.find(m => (m.id || m.model) === id);
                  if (model) selectModel(model);
                }} />}
                    {step === 'engine' && selectedModel?.engines && <ListItems items={selectedModel.engines.map(e => ({
                  id: e.id,
                  label: e.name
                }))} onSelect={id => {
                  const engine = selectedModel.engines?.find(e => e.id === id);
                  if (engine) selectEngine(engine);
                }} />}
                  </div>}

                {loading && <div className="border-t border-white/5">
                    <LoadingSpinner text="Synchronizing Data..." />
                  </div>}
              </div>
            </div>
          </div>

          {/* VIN hint */}
          {step === 'year' && !loading && <p className="text-center text-xs text-[hsl(215,16%,47%)] mt-4 font-mono opacity-0 animate-fade-in stagger-3" style={{
          animationFillMode: 'forwards'
        }}>
              TIP: Enter a 17-character VIN for instant vehicle identification
            </p>}

          {/* Feature badges */}
          <div className="flex flex-wrap justify-center gap-3 mt-8 opacity-0 animate-fade-in stagger-4" style={{
          animationFillMode: 'forwards'
        }}>
            {['Specifications', 'Wiring Diagrams', 'DTCs', 'Service Bulletins', 'Procedures', 'Maintenance'].map(feature => <span key={feature} className="text-[10px] font-mono uppercase tracking-wider text-[hsl(215,16%,47%)] px-3 py-1.5 rounded-full border border-white/5 bg-white/[0.02]">
                {feature}
              </span>)}
          </div>
        </div>
      </div>

      <Footer />
    </div>;
};

// ---- Sub-components ----

const Logo: React.FC = () => <div className="flex items-center gap-0.5">
    <span className="text-xl font-heading font-bold tracking-tight text-white">TORQUE</span>
    <span className="text-xl font-heading font-bold tracking-tight text-[hsl(191,97%,50%)]">.</span>
    <span className="text-xl font-heading font-bold tracking-tight text-white">AI</span>
  </div>;
const Footer: React.FC = () => <footer className="relative z-10 py-6 text-center">
    <div className="flex items-center justify-center gap-3">
      <div className="h-px w-16 bg-gradient-to-r from-transparent to-white/10" />
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(215,16%,47%)]">
        Powered by Gemini & MOTOR® Data
      </span>
      <div className="h-px w-16 bg-gradient-to-l from-transparent to-white/10" />
    </div>
  </footer>;
const Pill: React.FC<{
  label: string;
  onRemove: () => void;
  color: 'cyan' | 'green';
}> = ({
  label,
  onRemove,
  color
}) => <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono tracking-wider border transition-all ${color === 'cyan' ? 'border-[hsl(191,97%,50%)]/30 text-[hsl(191,97%,50%)] bg-[hsl(191,97%,50%)]/5' : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'}`}>
    {label}
    <button onClick={onRemove} className="hover:opacity-70 transition-opacity ml-0.5">
      <XIcon className="w-3 h-3" />
    </button>
  </span>;
const YearGrid: React.FC<{
  years: number[];
  onSelect: (y: number) => void;
}> = ({
  years,
  onSelect
}) => {
  if (years.length === 0) {
    return <div className="px-6 py-8 text-center text-sm font-mono text-[hsl(215,16%,47%)]">No metadata matches found.</div>;
  }
  return <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[350px] overflow-y-auto">
      {years.map(year => <button key={year} onClick={() => onSelect(year)} className="px-3 py-2.5 rounded-xl text-sm font-mono text-white/80 hover:text-white bg-white/[0.03] hover:bg-[hsl(191,97%,50%)]/10 border border-white/5 hover:border-[hsl(191,97%,50%)]/30 transition-all duration-200 hover:shadow-[0_0_10px_rgba(0,212,255,0.1)]">
          {year}
        </button>)}
    </div>;
};
const ListItems: React.FC<{
  items: {
    id: string | number;
    label: string;
  }[];
  onSelect: (id: string | number) => void;
}> = ({
  items,
  onSelect
}) => {
  if (items.length === 0) {
    return <div className="px-6 py-8 text-center text-sm font-mono text-[hsl(215,16%,47%)]">No metadata matches found.</div>;
  }
  return <div className="py-2 max-h-[350px] overflow-y-auto">
      {items.map(item => <button key={item.id} onClick={() => onSelect(item.id)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.04] transition-all group text-left">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-white/5 to-white/[0.02] flex items-center justify-center text-xs font-mono text-[hsl(191,97%,50%)] flex-shrink-0 border border-white/5">
            {String(item.label).charAt(0).toUpperCase()}
          </span>
          <span className="flex-1 text-sm text-white/80 group-hover:text-white font-medium transition-colors">{item.label}</span>
          <ChevronRightIcon className="w-4 h-4 text-white/10 group-hover:text-[hsl(191,97%,50%)] transition-all group-hover:translate-x-0.5" />
        </button>)}
    </div>;
};
export default HomePage;