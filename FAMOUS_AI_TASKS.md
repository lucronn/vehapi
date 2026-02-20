# TORQUE.AI — Professional Vehicle Intelligence App

> **Reference Implementation:** `vehicle-intelligence-diagnostics` codebase  
> **Stack:** Vite + React 18 + TypeScript + TailwindCSS 3 + shadcn/ui + Radix UI  
> **Data Source:** `https://vehapiproxi.vercel.app` (Auth Proxy → MOTOR® API)

---

## Design System (MANDATORY — use exactly as specified)

### Tech Stack & Dependencies

```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.26.2",
  "@tanstack/react-query": "^5.56.2",
  "tailwindcss": "^3.4.11",
  "tailwindcss-animate": "^1.0.7",
  "@tailwindcss/typography": "^0.5.16",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "tailwind-merge": "^2.5.2",
  "lucide-react": "^0.462.0",
  "sonner": "^1.5.0",
  "vaul": "^0.9.3",
  "@radix-ui/react-tabs": "^1.1.0",
  "@radix-ui/react-accordion": "^1.2.0",
  "@radix-ui/react-dialog": "^1.1.2",
  "@radix-ui/react-scroll-area": "^1.1.0",
  "@radix-ui/react-tooltip": "^1.1.4",
  "@radix-ui/react-progress": "^1.1.0"
}
```

### Fonts (loaded in index.html)

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

### Tailwind Config

```ts
// tailwind.config.ts
darkMode: ["class"],
theme: {
  extend: {
    colors: {
      torque: {
        bg: 'hsl(230, 35%, 7%)',        // Deep navy background
        card: 'hsl(230, 35%, 12%)',      // Card surface
        cyan: 'hsl(191, 97%, 50%)',      // Primary accent — actions, active states, links
        violet: 'hsl(263, 83%, 58%)',    // Secondary accent — premium indicators, gradients
        'text-secondary': 'hsl(215, 20%, 65%)',  // Body text
        'text-muted': 'hsl(215, 16%, 47%)',      // Labels, hints, timestamps
      }
    },
    fontFamily: {
      heading: ['Outfit', 'sans-serif'],       // All headings, nav labels
      sans: ['Inter', 'sans-serif'],           // Body text
      mono: ['JetBrains Mono', 'monospace'],   // DTC codes, labels, badges, hints
    },
    keyframes: {
      'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      'fade-in-up': { from: { opacity: '0', transform: 'translateY(20px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      'slide-in': { from: { transform: 'translateY(10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      'scan': { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100vh)' } },
      'mesh-drift': { '0%, 100%': { transform: 'translate(0, 0) scale(1)' }, '25%': { transform: 'translate(5%, -3%) scale(1.05)' }, '50%': { transform: 'translate(-3%, 5%) scale(0.95)' }, '75%': { transform: 'translate(3%, 2%) scale(1.02)' } },
      'glow-pulse': { '0%, 100%': { opacity: '0.4' }, '50%': { opacity: '0.8' } },
      'shine-sweep': { '0%': { transform: 'translateX(-100%) skewX(-15deg)' }, '100%': { transform: 'translateX(200%) skewX(-15deg)' } },
    },
    animation: {
      'fade-in': 'fade-in 0.5s ease-out forwards',
      'fade-in-up': 'fade-in-up 0.6s ease-out forwards',
      'slide-in': 'slide-in 0.3s ease-out',
      'scan': 'scan 8s linear infinite',
      'mesh-drift': 'mesh-drift 60s ease-in-out infinite',
      'glow-pulse': 'glow-pulse 4s ease-in-out infinite',
      'shine-sweep': 'shine-sweep 0.6s ease-out',
    },
  }
}
```

### CSS Variables & Global Styles (index.css)

```css
@layer base {
  :root, .dark {
    --background: 230 35% 7%;
    --foreground: 0 0% 100%;
    --card: 230 35% 12%;
    --card-foreground: 0 0% 100%;
    --popover: 230 35% 10%;
    --popover-foreground: 0 0% 100%;
    --primary: 191 97% 50%;             /* Cyan */
    --primary-foreground: 230 35% 7%;
    --secondary: 263 83% 58%;           /* Violet */
    --secondary-foreground: 0 0% 100%;
    --muted: 230 35% 15%;
    --muted-foreground: 215 16% 47%;
    --accent: 263 83% 58%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 100%;
    --border: 230 20% 18%;
    --input: 230 20% 18%;
    --ring: 191 97% 50%;
    --radius: 0.75rem;
    --sidebar-background: 230 35% 9%;
    --sidebar-foreground: 0 0% 100%;
    --sidebar-primary: 191 97% 50%;
    --sidebar-border: 230 20% 18%;
  }
  body {
    font-family: 'Inter', sans-serif;
    background: hsl(230, 35%, 7%);
    color: white;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }
  /* Custom thin scrollbar */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 9999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
}
```

### Component Classes (index.css @layer components)

```css
/* Glass Card — used for EVERY card surface in the app */
.glass-card {
  background: hsla(230, 35%, 12%, 0.6);
  backdrop-filter: blur(40px);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 1rem;
  position: relative; overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
}
.glass-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  border-color: rgba(255,255,255,0.08);
}
/* Shine sweep on hover */
.glass-card::before {
  content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent);
  transform: skewX(-15deg); transition: left 0.6s ease; pointer-events: none; z-index: 1;
}
.glass-card:hover::before { left: 200%; }

/* Primary Button — cyan→violet gradient */
.btn-primary {
  @apply relative px-6 py-3 rounded-xl font-semibold text-sm tracking-wide;
  background: linear-gradient(135deg, hsl(191,97%,50%), hsl(263,83%,58%));
  color: white; transition: all 0.3s ease; overflow: hidden;
}
.btn-primary:hover {
  box-shadow: 0 0 20px rgba(0,212,255,0.4), 0 0 40px rgba(0,212,255,0.1);
  transform: translateY(-1px);
}
.btn-primary:active { transform: scale(0.95); }

/* Glass Button — subtle transparent */
.btn-glass {
  @apply px-4 py-2 rounded-xl text-sm font-medium;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.8);
}
.btn-glass:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); color: white; }

/* Neon Borders — used for active/selected states */
.neon-border-cyan { border: 1px solid hsla(191,97%,50%,0.5); box-shadow: 0 0 15px hsla(191,97%,50%,0.15), inset 0 0 15px hsla(191,97%,50%,0.05); }
.neon-border-violet { border: 1px solid hsla(263,83%,58%,0.5); box-shadow: 0 0 15px hsla(263,83%,58%,0.15), inset 0 0 15px hsla(263,83%,58%,0.05); }

/* Mesh Gradient Background — fixed behind entire app */
.mesh-gradient { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.mesh-gradient::before {
  content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
  background:
    radial-gradient(ellipse 600px 600px at 20% 20%, hsla(191,97%,50%,0.08), transparent),
    radial-gradient(ellipse 500px 500px at 80% 80%, hsla(263,83%,58%,0.08), transparent),
    radial-gradient(ellipse 400px 400px at 60% 30%, hsla(300,76%,52%,0.04), transparent);
  animation: mesh-drift 60s ease-in-out infinite;
}

/* Scanline Overlay — subtle CRT effect */
.scanline-overlay {
  position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 4px);
}

/* Stagger Delays */
.stagger-1 { animation-delay: 100ms; }
.stagger-2 { animation-delay: 200ms; }
.stagger-3 { animation-delay: 300ms; }
.stagger-4 { animation-delay: 400ms; }
.stagger-5 { animation-delay: 500ms; }

/* Motor Prose — article HTML rendering */
.motor-prose h2 { @apply text-xl font-bold text-white border-b border-white/10 pb-3 mt-8 mb-4; }
.motor-prose h3 { @apply text-lg font-semibold text-white mt-6 mb-3; }
.motor-prose p { @apply text-[hsl(215,20%,65%)] leading-relaxed mb-4; }
.motor-prose ul, .motor-prose ol { @apply ml-6 mb-4 space-y-2; }
.motor-prose li { @apply text-[hsl(215,20%,65%)]; }
.motor-prose table { @apply w-full border-collapse mb-6; }
.motor-prose table th { @apply text-left text-xs uppercase tracking-wider text-[hsl(215,16%,47%)] bg-white/5 px-4 py-3 font-semibold; }
.motor-prose table td { @apply px-4 py-3 text-sm text-[hsl(215,20%,65%)] border-b border-white/5; }
.motor-prose table tr:hover td { @apply bg-white/[0.02]; }
.motor-prose img { @apply rounded-2xl border border-white/10 my-4 max-w-full transition-transform hover:scale-[1.02]; }
.motor-prose .warning, .motor-prose [class*="warning"], .motor-prose [class*="caution"] {
  @apply p-4 rounded-xl mb-4 border-l-4 border-red-500/60; background: rgba(239,68,68,0.08);
}
.motor-prose .note, .motor-prose [class*="note"], .motor-prose [class*="info"] {
  @apply p-4 rounded-xl mb-4 border-l-4 border-blue-500/60; background: rgba(59,130,246,0.08);
}
.motor-prose a { @apply text-[hsl(191,97%,50%)] hover:underline; }
.motor-prose strong { @apply text-white font-semibold; }
```

### Utility Classes

```css
.text-torque-cyan { color: hsl(191, 97%, 50%); }
.text-torque-violet { color: hsl(263, 83%, 58%); }
.text-torque-secondary { color: hsl(215, 20%, 65%); }
.text-torque-muted { color: hsl(215, 16%, 47%); }
.bg-torque-bg { background: hsl(230, 35%, 7%); }
.bg-torque-card { background: hsla(230, 35%, 12%, 0.6); }
```

---

## Design Patterns (MANDATORY — replicate these exactly)

### Label Pattern
All section headers and sub-labels use this pattern:
```html
<span class="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)]">SECTION LABEL</span>
```

### Status Indicator Pattern
```html
<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/5">
  <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
  <span class="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(215,20%,65%)]">DATABASE CONNECTED</span>
</div>
```

### Breadcrumb Pill Pattern
```html
<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono tracking-wider border border-[hsl(191,97%,50%)]/30 text-[hsl(191,97%,50%)] bg-[hsl(191,97%,50%)]/5">
  {label}
  <button class="hover:opacity-70"><XIcon class="w-3 h-3" /></button>
</span>
```

### List Item Pattern (Make/Model/Engine selection)
```html
<button class="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.04] transition-all group text-left">
  <span class="w-8 h-8 rounded-lg bg-gradient-to-br from-white/5 to-white/[0.02] flex items-center justify-center text-xs font-mono text-[hsl(191,97%,50%)] border border-white/5">
    {firstLetter}
  </span>
  <span class="flex-1 text-sm text-white/80 group-hover:text-white font-medium">{label}</span>
  <ChevronRightIcon class="w-4 h-4 text-white/10 group-hover:text-[hsl(191,97%,50%)] group-hover:translate-x-0.5" />
</button>
```

### Year Grid Pattern
```html
<div class="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
  <button class="px-3 py-2.5 rounded-xl text-sm font-mono text-white/80 hover:text-white bg-white/[0.03] hover:bg-[hsl(191,97%,50%)]/10 border border-white/5 hover:border-[hsl(191,97%,50%)]/30 hover:shadow-[0_0_10px_rgba(0,212,255,0.1)]">
    {year}
  </button>
</div>
```

### Sidebar Nav Item Pattern
```html
<button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left border-l-2
  /* active */ border-[hsl(191,97%,50%)] bg-gradient-to-r from-[hsl(191,97%,50%)]/10 to-transparent text-white
  /* inactive */ border-transparent text-[hsl(215,20%,65%)] hover:text-white hover:bg-white/[0.03]">
  <Icon class="w-4 h-4" />
  <span class="text-[10px] font-bold tracking-[0.15em] uppercase">{LABEL}</span>
</button>
```

### Ambient Orbs (background decoration)
```html
<div class="fixed top-[-100px] left-[-100px] w-[400px] h-[400px] bg-[hsl(191,97%,50%)] opacity-[0.04] rounded-full blur-[120px] animate-glow-pulse pointer-events-none" />
<div class="fixed bottom-[-100px] right-[-100px] w-[400px] h-[400px] bg-[hsl(263,83%,58%)] opacity-[0.04] rounded-full blur-[120px] animate-glow-pulse pointer-events-none" style="animation-delay: 2s" />
```

---

## App Architecture

### Entry Point

```
index.html → main.tsx → App.tsx → ThemeProvider(dark) → QueryClientProvider → BrowserRouter
```

**App.tsx** wraps everything in:
- `ThemeProvider` (default: "dark", persists to localStorage)
- `QueryClientProvider` (React Query)
- `TooltipProvider` + `Toaster` + `Sonner`
- `BrowserRouter` with routes

### Page Views

| View | Route | Component |
|---|---|---|
| Home / Vehicle Selection | `/` | `HomePage` |
| Vehicle Dashboard | viewed as state, not route | `Dashboard` |

`AppLayout.tsx` manages view state (`'home' | 'dashboard'`) and passes `onVehicleSelect` / `onExit` callbacks.

### Logo Component
```html
<span class="text-xl font-heading font-bold tracking-tight text-white">TORQUE</span>
<span class="text-xl font-heading font-bold tracking-tight text-[hsl(191,97%,50%)]">.</span>
<span class="text-xl font-heading font-bold tracking-tight text-white">AI</span>
```

### Footer Component
```html
<footer class="relative z-10 py-6 text-center">
  <div class="flex items-center justify-center gap-3">
    <div class="h-px w-16 bg-gradient-to-r from-transparent to-white/10" />
    <span class="text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(215,16%,47%)]">
      Powered by Gemini & MOTOR® Data
    </span>
    <div class="h-px w-16 bg-gradient-to-l from-transparent to-white/10" />
  </div>
</footer>
```

---

## API Service Layer

### Base Config

```ts
const BASE_URL = 'https://vehapiproxi.vercel.app';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',  // MANDATORY
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`API Error ${res.status}`);
  const data = await res.json();
  // Unwrap header/body wrapper when present
  if (data?.header && data?.body !== undefined) return data.body as T;
  return data as T;
}
```

### Interfaces

```ts
interface Make { makeId: number; makeName: string; }
interface Engine { id: string; name: string; }
interface Model { model: string; id: string; engines?: Engine[]; }
interface ModelsResponse { contentSource: string; models: Model[]; }
interface VinDecodeResult { vin: string; vehicleId: string; contentSource: string; year: number; make: string; model: string; }
interface Article { id: string; title: string; code?: string; bulletinNumber?: string; releaseDate?: string; thumbnailHref?: string; }
interface Bucket { name: string; articles?: Article[]; children?: Bucket[]; count?: number; }
interface FilterTab { name: string; count?: number; buckets?: Bucket[]; }
interface ArticlesResponse { articleDetails: Article[]; filterTabs: FilterTab[]; }
interface Fluid { id: string; title: string; capacity?: string; specification?: string; }
interface ArticleContent { html: string; content?: string; id: string; title: string; }
```

### Endpoints

| Function | Method | Path | Returns |
|---|---|---|---|
| `getYears()` | GET | `/api/years` | `number[]` |
| `getMakes(year)` | GET | `/api/year/{year}/makes` | `Make[]` |
| `getModels(year, makeId)` | GET | `/api/year/{year}/make/{makeId}/models` | `ModelsResponse` (proxy resolves ID→name) |
| `decodeVin(vin)` | GET | `/api/vin/{vin}/vehicle` | `VinDecodeResult` |
| `getVehicleName(src, vid)` | GET | `/api/source/{src}/{vid}/name` | `string` |
| `searchArticles(src, vid)` | GET | `/api/source/{src}/vehicle/{vid}/articles/v2` | `ArticlesResponse` — **CACHE this per vehicle** |
| `getArticleContent(src, vid, aid)` | GET | `/api/source/{src}/vehicle/{vid}/article/{aid}` | `ArticleContent` |
| `getFluids(src, vid)` | GET | `/api/source/{src}/vehicle/{vid}/fluids` | `FluidsResponse` |
| `getMaintenanceByFrequency(src, vid)` | GET | `/api/source/{src}/vehicle/{vid}/maintenanceSchedules/frequency` | Maintenance data |
| `getGraphicUrl(src, id)` | — | `/api/source/{src}/graphic/{id}` | Image URL |

### Article HTML Processing

```ts
function processArticleHtml(html: string, src: string): string {
  let processed = html;
  processed = processed.replace(/src="\/api\//g, `src="${BASE_URL}/api/`);
  processed = processed.replace(/href="\/api\//g, `href="${BASE_URL}/api/`);
  processed = processed.replace(/src="\.\.\/graphic\//g, `src="${BASE_URL}/api/source/${src}/graphic/`);
  // Convert <mtr-image id="X"> to <img>
  processed = processed.replace(/<mtr-image\s+id="([^"]+)"[^>]*>/g,
    `<img src="${BASE_URL}/api/source/${src}/graphic/$1" class="max-w-full rounded-xl border border-white/10" />`);
  processed = processed.replace(/<\/mtr-image>/g, '');
  // Convert <mtr-doc-link> to clickable links
  processed = processed.replace(/<mtr-doc-link\s+id="([^"]+)"[^>]*>(.*?)<\/mtr-doc-link>/g,
    `<a href="#article:$1" class="text-cyan-400 hover:underline cursor-pointer" data-article-id="$1">$2</a>`);
  return processed;
}
```

### Article Filtering Helpers

```ts
// Get flat array of articles from a tab by keyword
function getArticlesFromTab(data: ArticlesResponse | null, tabName: string): Article[] {
  const tab = data?.filterTabs?.find(t => t.name?.toLowerCase().includes(tabName.toLowerCase()));
  if (!tab?.buckets) return [];
  const articles: Article[] = [];
  const collect = (buckets: Bucket[]) => {
    for (const b of buckets) {
      if (b.articles) articles.push(...b.articles);
      if (b.children) collect(b.children);
    }
  };
  collect(tab.buckets);
  return articles;
}

// Get articles grouped by their parent bucket name
function getArticlesGroupedByBucket(data: ArticlesResponse | null, tabName: string): Record<string, Article[]> { /* recursive collect, keyed by bucket.name */ }
```

### Persistence Service

```ts
const STORAGE_KEY = 'torque-persisted-vehicle';
interface PersistedVehicle { vehicleId: string; contentSource: string; name: string; }
function saveVehicle(v: PersistedVehicle): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); }
function getVehicle(): PersistedVehicle | null { /* parse from localStorage */ }
function clearVehicle(): void { localStorage.removeItem(STORAGE_KEY); }
```

---

## Task 1: Project Setup

1. Initialize Vite + React + TypeScript project
2. Install all dependencies from the stack above
3. Configure `tailwind.config.ts` exactly as documented (colors, fonts, keyframes, animations)
4. Create `index.css` with all CSS variables, component classes, and utility classes exactly as documented
5. Set up `index.html` with font preconnects, meta tags, and `class="dark"` on `<html>`
6. Create `ThemeProvider` component (persists to localStorage, defaults to dark)
7. Create `App.tsx` with `ThemeProvider` → `QueryClientProvider` → `TooltipProvider` → `Toaster` → `Sonner` → `BrowserRouter`

---

## Task 2: Services & State

1. Create `services/api.ts` with `apiFetch` wrapper, all interfaces, all endpoint functions, article cache, HTML processing, and filtering helpers — exactly as documented above
2. Create `services/persistence.ts` with `saveVehicle`, `getVehicle`, `clearVehicle`
3. Create `contexts/AppContext.tsx` — global context providing vehicle state

---

## Task 3: Icons & Loading States

### Icons Component (`Icons.tsx`)
All icons are inline SVG wrappers with `fill="none"`, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth={1.5}`. Required icons:
`SearchIcon`, `ArrowLeftIcon`, `ArrowRightIcon`, `ChevronRightIcon`, `XIcon`, `MenuIcon`, `WarningIcon`, `DocumentIcon`, `BoltIcon`, `WrenchIcon`, `ClipboardIcon`, `MapPinIcon`, `CalendarIcon`, `CubeIcon`, `DatabaseIcon`, `BeakerIcon`, `PhotoIcon`, `CogIcon`, `FileIcon`

### Loading States Component (`LoadingStates.tsx`)
- `LoadingSpinner` — centered spinner with text label, uses mono font, muted color
- `Skeleton` — shimmer placeholder with `type` prop (`"grid"` | `"list"` | `"text"`) and `count`
- `EmptyState` — icon + message + submessage, muted styling

---

## Task 4: HomePage — Vehicle Selection

### Layout Structure
```
<div class="min-h-screen flex flex-col relative bg-[hsl(230,35%,7%)]">
  <div class="mesh-gradient" />
  <div class="scanline-overlay" />
  <!-- Hero bg image (6% opacity) -->
  <!-- Ambient Orbs (cyan top-left, violet bottom-right) -->
  <header> Logo + Reset Session </header>
  <main> Heading + Search Console + Feature Badges </main>
  <Footer />
</div>
```

### States

**1. Welcome Back (persisted vehicle exists):**
- Glass card with `neon-border-cyan`, shows vehicle name
- "Initialize Dashboard" button (`btn-primary`)
- Animated scan line at bottom of card
- "Switch to another vehicle" link beneath

**2. Fresh Search (no persisted vehicle):**
- Hero heading: `Professional <gradient>Intelligence</gradient> for your vehicle.`
- Status indicator: "DATABASE CONNECTED" with green pulse dot
- Sub-text: "Access manufacturer specs, diagrams, and AI-powered troubleshooting instantly."
- Search Console (glass-card with gradient glow border)
- Selection breadcrumb pills
- Feature badges row: `Specifications`, `Wiring Diagrams`, `DTCs`, `Service Bulletins`, `Procedures`, `Maintenance`

### Search Wizard Flow

```
Step 1: Year   → Year Grid (3 cols mobile, 6 cols desktop), newest first
Step 2: Make   → ListItems with first-letter avatar, filtered by input
Step 3: Model  → ListItems, filtered by input
Step 4: Engine → (only if model.engines.length > 1) ListItems
```

- Input auto-detects VIN (17-char alphanumeric `[A-HJ-NPR-Z0-9]{17}`)
- Input auto-detects 4-digit year and triggers selection
- Step indicator label: `text-[10px] font-mono uppercase tracking-[0.2em] text-[hsl(191,97%,50%)]`
- Each step shows `setShowDropdown(true)` and filters list by input value
- VIN hint shown below search: `TIP: Enter a 17-character VIN for instant vehicle identification`

---

## Task 5: Dashboard — Layout & Navigation

### Layout
```
<div class="min-h-screen flex relative">
  <div class="mesh-gradient" />
  <div class="scanline-overlay" />
  <!-- Desktop: Sidebar (hidden lg:block, w-64, sticky top-0) -->
  <!-- Mobile: Fixed top header bar + fullscreen overlay menu -->
  <main class="flex-1 pt-16 lg:pt-0 p-4 lg:p-8 max-w-6xl mx-auto">
    <GlobalSearch />
    {renderSection()}
  </main>
</div>
```

### Desktop Sidebar (`Sidebar.tsx`)
- `w-64`, sticky, `bg-[hsl(230,35%,9%)]/80 backdrop-blur-xl`, `border-r border-white/5`
- Header: EXIT SESSION button → vehicle name
- Nav groups: `DIAGNOSTICS` (Fault Codes, Service Bulletins), `SERVICE DATA` (Diagrams, Procedures, Specifications, Components, Maintenance), `REFERENCE` (Parts, All Data)
- Active item: `border-[hsl(191,97%,50%)]` left border + `from-[hsl(191,97%,50%)]/10` gradient bg
- Footer: green pulse dot + "Connected" + version

### Mobile Header
- Fixed top, `bg-[hsl(230,35%,9%)]/90 backdrop-blur-xl`, `border-b border-white/5`
- Back arrow → vehicle name badge → hamburger menu
- Overlay: fullscreen grid of `glass-card` nav buttons (2 cols), active item gets `neon-border-cyan`

### Sections (10 total)
`overview`, `dtcs`, `tsbs`, `diagrams`, `procedures`, `specifications`, `components`, `maintenance`, `parts`, `alldata`

Auto-hide sidebar nav items that have no data (check `filterTabs` for matching keywords).

### Section Data Sources

| Section | Tab Keyword | Data Source |
|---|---|---|
| Overview | `spec`, `diagnostic`, `bulletin` | Fluids API + articles |
| Fault Codes | `diagnostic` | filterTabs |
| Service Bulletins | `bulletin` | filterTabs |
| Diagrams | `diagram` | filterTabs |
| Procedures | `procedure` | filterTabs |
| Specifications | `spec` | filterTabs + Fluids API |
| Components | `component` | filterTabs |
| Maintenance | — | Maintenance Schedule API |
| Parts | — | filterTabs |
| All Data | — | All articleDetails |

---

## Task 6: Dashboard Sections — Overview

- Section header: `TACTICAL OVERVIEW` (cyan label)
- **System Specifications**: grid of glass-cards from `spec` tab articles, each shows article title + chevron
- **Fluid Capacities**: grid of glass-cards from `getFluids()`, each shows title (violet label), capacity (white bold), specification (muted)
- **Common Issues**: summary cards for DTC count (amber border-l) and TSB count (blue border-l)

---

## Task 7: Dashboard Sections — All Content Sections

Each section follows this pattern:
1. Section header label (cyan/violet `text-[10px] font-mono uppercase`)
2. Optional search filter input
3. Content grid or list of `glass-card` items
4. Article tapping → opens `ArticleViewer`

**ArticleViewer:**
- Back button header
- Renders processed HTML inside `.motor-prose` container
- Intercepts `data-article-id` link clicks for internal navigation
- Images load from proxy graphic URL

---

## Task 8: Global Search

- Glass-card input with search icon
- Debounced 300ms
- Searches across all `articleDetails` by title
- Results as `glass-card` list items with chevron
- Max 20 results displayed
- Empty state with message

---

## Task 9: Monetization Layer (Credit System)

### Storage Key: `diy-mechanic-state`
```json
{
  "credits": 50,
  "garage": [],
  "unlocks": {}
}
```

### Pricing
| Tier | Cost |
|---|---|
| Free | Basic vehicle ID, fluid specs, search |
| Individual Module | 5 Credits |
| Full Vehicle Unlock | 20 Credits |

### Components to Add
- **CreditBadge** — always visible in header, pill showing credit balance, tapping adds 10 mock credits
- **LockedOverlay** — over locked content, padlock + "Unlock for X Credits"
- **PurchaseModal** — confirmation dialog for spending credits
- Module grid cards show lock/unlock state based on `hasAccess(vehicleId, moduleKey)`

---

## Task 10: QA & Verification

**Design Verification:**
- [ ] Dark mode default applied
- [ ] Mesh gradient background visible on all pages
- [ ] Scanline overlay visible
- [ ] Glass cards have blur, border, and hover shine sweep
- [ ] Primary buttons have cyan→violet gradient and glow on hover
- [ ] Neon borders applied on active sidebar items
- [ ] All text uses correct font families (Outfit for headings, Inter for body, JetBrains Mono for labels)
- [ ] Ambient orbs visible and pulsing
- [ ] All animations working (fade-in, fade-in-up, slide-in, glow-pulse)

**Functionality Verification:**
- [ ] Year → Make → Model → Engine flow works end-to-end
- [ ] VIN decode works and navigates to dashboard
- [ ] All 10 dashboard sections render their data
- [ ] Article viewer processes HTML correctly (images, links, tables)
- [ ] Global search filters articles
- [ ] Vehicle persisted to localStorage and welcome-back state works
- [ ] Mobile menu overlay works

**API Verification:**
- [ ] All requests include `credentials: 'include'`
- [ ] Article cache prevents duplicate requests
- [ ] Error states show meaningful messages

---

## Execution Order

```
Task 1  → Project Setup & Design System
Task 2  → Services & State
Task 3  → Icons & Loading States
Task 4  → HomePage (Vehicle Selection)
Task 5  → Dashboard Layout & Navigation
Task 6  → Overview Section
Task 7  → All Content Sections + Article Viewer
Task 8  → Global Search
Task 9  → Monetization Layer
Task 10 → QA & Verification
```
