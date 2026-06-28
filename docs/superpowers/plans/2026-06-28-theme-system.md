# Theme-System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein erweiterbares Zwei-Achsen-Theme-System (Brand-Variant × Light/Dark) bauen, vom Nutzer umschaltbar, mit dem StyleGuide-Theme „vital" als erstem Theme.

**Architecture:** `<html data-theme="vital" class="dark">` trägt beide Achsen. Token-Werte liefert die CSS-Kaskade (`[data-theme="vital"]` / `…​.dark`). Ein React-`ThemeProvider` toggelt nur Attribut + Klasse und persistiert die Wahl; ein Inline-Bootstrap in `index.html` setzt beides vor dem ersten Paint (kein FOUC). Default-Mode folgt der OS-Einstellung.

**Tech Stack:** React 18 + TypeScript (strict), Vite 5, Tailwind 3 (`darkMode: 'class'`, `hsl(var(--token))`), Vitest + jsdom + Testing Library.

## Global Constraints

- TypeScript strict, ES Modules, Functional Components + Hooks, **named exports** bevorzugt, kein `any` ohne Grund (CLAUDE.md / typescript-react rules).
- Tailwind-Solid-Farben laufen über `hsl(var(--token))` mit **HSL-Tripeln** (`H S% L%`) — diese Mechanik **nicht** umbauen.
- Komposit-Werte (Gradient, Glow, Soft-Tint, Shadows) bleiben **rohe** CSS-Vars (kein `hsl()`-Wrapper).
- Persistenz-Keys: `nt-theme-mode` (`light|dark|system`), `nt-theme-variant` (`vital`). Alter Key `nt-theme` wird einmalig migriert.
- Font: Manrope (sans) + JetBrains Mono (mono), **self-hosted** in `public/fonts/`, `font-display: swap`.
- Nach Code-Änderungen Gate: `npm run typecheck` (= `tsc -b --noEmit` via `tsc -b`), `npm run lint`, `npm test` grün.
- DRY, YAGNI, TDD, häufige Commits. Branch: `feat/theme-system` (bereits aktiv).

---

### Task 1: Theme-Token-CSS & Tailwind-Mapping

Legt die Token-Werte für `vital` (Light/Dark) an und macht die neuen Tokens als Tailwind-Klassen verfügbar. Ersetzt die alten `:root`/`.dark`-Blöcke. Kein Unit-Test (reine CSS/Config); Gate = Typecheck + Lint + Build.

**Files:**
- Create: `src/styles/themes.css`
- Modify: `src/index.css` (alte `:root`/`.dark`-Blöcke entfernen, `@import` ergänzen)
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces: CSS-Custom-Properties unter `[data-theme='vital']` und `[data-theme='vital'].dark`; Tailwind-Color-Keys `protein`, `carbs`, `fat`, `canvas`, `surface-2`, `surface-3`, `border-strong`, `text-3`, `primary-fill`, `primary-soft`, `ring-track`, `skeleton-base`, `skeleton-hi`, `destructive-foreground`; `boxShadow.{sm,md,lg,glow}`; `backgroundImage.brand-gradient`; `fontFamily.{sans,mono}`.

- [ ] **Step 1: `src/styles/themes.css` anlegen**

```css
/* Theme-Tokens — Brand-Variant × Mode.
   Solids als HSL-Tripel (H S% L%) für hsl(var(--token)).
   Komposite (grad/glow/soft/shadows) als rohe Werte. */

[data-theme='vital'] {
  /* shadcn-kompatibel (auf StyleGuide-Werte gemappt) */
  --background: 220 20% 97%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --primary: 160 84% 39%;
  --primary-foreground: 0 0% 100%;
  --secondary: 220 27% 96%;
  --secondary-foreground: 216 15% 35%;
  --muted: 220 27% 96%;
  --muted-foreground: 216 15% 35%;
  --accent: 189 94% 43%;
  --accent-foreground: 0 0% 100%;
  --success: 142 76% 36%;
  --warning: 32 95% 44%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 22% 92%;
  --input: 218 22% 85%;
  --ring: 160 84% 39%;
  --radius: 1rem;

  /* StyleGuide-Solids (HSL-Tripel) */
  --canvas: 220 23% 92%;
  --surface-2: 220 27% 96%;
  --surface-3: 216 25% 92%;
  --border-strong: 218 22% 85%;
  --text-3: 214 15% 64%;
  --primary-fill: 161 94% 30%;
  --ring-track: 217 25% 94%;
  --skeleton-base: 214 23% 94%;
  --skeleton-hi: 220 33% 98%;
  --protein: 350 89% 60%;
  --carbs: 38 92% 50%;
  --fat: 258 90% 66%;

  /* StyleGuide-Komposite (rohe Werte) */
  --primary-soft: #e6f8f0;
  --grad: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  --glow: rgba(16, 185, 129, 0.3);
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06);
  --shadow-md: 0 6px 18px rgba(16, 24, 40, 0.08);
  --shadow-lg: 0 22px 48px rgba(16, 24, 40, 0.16);
  --shadow-glow: 0 12px 30px rgba(16, 185, 129, 0.3);

  color-scheme: light;
}

[data-theme='vital'].dark {
  --background: 220 38% 6%;
  --foreground: 210 40% 96%;
  --card: 218 29% 11%;
  --card-foreground: 210 40% 96%;
  --primary: 158 64% 52%;
  --primary-foreground: 220 47% 4%;
  --secondary: 216 26% 15%;
  --secondary-foreground: 215 16% 71%;
  --muted: 216 26% 15%;
  --muted-foreground: 215 16% 71%;
  --accent: 188 86% 53%;
  --accent-foreground: 220 47% 4%;
  --success: 158 64% 52%;
  --warning: 43 96% 56%;
  --destructive: 0 91% 71%;
  --destructive-foreground: 220 47% 4%;
  --border: 214 21% 20%;
  --input: 212 18% 28%;
  --ring: 158 64% 52%;

  --canvas: 220 47% 4%;
  --surface-2: 216 26% 15%;
  --surface-3: 215 24% 20%;
  --border-strong: 212 18% 28%;
  --text-3: 216 14% 48%;
  --primary-fill: 161 94% 30%;
  --ring-track: 214 25% 18%;
  --skeleton-base: 216 28% 14%;
  --skeleton-hi: 215 24% 20%;
  --protein: 351 95% 71%;
  --carbs: 43 96% 56%;
  --fat: 255 92% 76%;

  --primary-soft: rgba(52, 211, 153, 0.14);
  --grad: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
  --glow: rgba(16, 185, 129, 0.42);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 26px 54px rgba(0, 0, 0, 0.6);
  --shadow-glow: 0 12px 30px rgba(16, 185, 129, 0.42);

  color-scheme: dark;
}
```

- [ ] **Step 2: `src/index.css` umbauen**

Die allererste Zeile der Datei muss der Import sein (CSS-`@import` vor allen anderen Regeln). Den kompletten alten `:root { … }`- und `.dark { … }`-Block aus `@layer base` **entfernen** (die Token-Definitionen leben jetzt in `themes.css`). `@layer base` behält nur die `*`-, `html/body`-, `body`-Regeln und die `prefers-reduced-motion`-Regel. Ergebnis (oberer Teil):

```css
@import './styles/themes.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    @apply border-border;
  }

  html,
  body,
  #root {
    height: 100%;
  }

  body {
    @apply bg-background text-foreground antialiased;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
    overscroll-behavior-y: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: `tailwind.config.js` erweitern**

Innerhalb von `theme.extend`: den `colors`-Block um die neuen Keys ergänzen, `boxShadow`, `backgroundImage` neu hinzufügen, `fontFamily` ersetzen. Vollständiger `extend`-Block:

```js
extend: {
  colors: {
    border: 'hsl(var(--border))',
    input: 'hsl(var(--input))',
    ring: 'hsl(var(--ring))',
    background: 'hsl(var(--background))',
    foreground: 'hsl(var(--foreground))',
    primary: {
      DEFAULT: 'hsl(var(--primary))',
      foreground: 'hsl(var(--primary-foreground))',
      fill: 'hsl(var(--primary-fill))',
    },
    secondary: {
      DEFAULT: 'hsl(var(--secondary))',
      foreground: 'hsl(var(--secondary-foreground))',
    },
    muted: {
      DEFAULT: 'hsl(var(--muted))',
      foreground: 'hsl(var(--muted-foreground))',
    },
    accent: {
      DEFAULT: 'hsl(var(--accent))',
      foreground: 'hsl(var(--accent-foreground))',
    },
    card: {
      DEFAULT: 'hsl(var(--card))',
      foreground: 'hsl(var(--card-foreground))',
    },
    destructive: {
      DEFAULT: 'hsl(var(--destructive))',
      foreground: 'hsl(var(--destructive-foreground))',
    },
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    canvas: 'hsl(var(--canvas))',
    'surface-2': 'hsl(var(--surface-2))',
    'surface-3': 'hsl(var(--surface-3))',
    'border-strong': 'hsl(var(--border-strong))',
    'text-3': 'hsl(var(--text-3))',
    'ring-track': 'hsl(var(--ring-track))',
    'skeleton-base': 'hsl(var(--skeleton-base))',
    'skeleton-hi': 'hsl(var(--skeleton-hi))',
    protein: 'hsl(var(--protein))',
    carbs: 'hsl(var(--carbs))',
    fat: 'hsl(var(--fat))',
    'primary-soft': 'var(--primary-soft)',
  },
  borderRadius: {
    lg: 'var(--radius)',
    md: 'calc(var(--radius) - 4px)',
    sm: 'calc(var(--radius) - 8px)',
  },
  fontFamily: {
    sans: ['Manrope', 'system-ui', 'sans-serif'],
    mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
  },
  boxShadow: {
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)',
    glow: 'var(--shadow-glow)',
  },
  backgroundImage: {
    'brand-gradient': 'var(--grad)',
  },
},
```

> Hinweis: `boxShadow.sm/md/lg` überschreiben bewusst Tailwinds Defaults durch die themed Shadows — das ist gewollt. `primary-soft` und `brand-gradient` laufen ohne `hsl()`, da Komposit-Werte.

- [ ] **Step 4: Gate ausführen**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build`
Expected: Alle drei ohne Fehler. Build erzeugt `dist/` mit eingebundener `themes.css` (Vite inlined das `@import`).

- [ ] **Step 5: Commit**

```bash
git add src/styles/themes.css src/index.css tailwind.config.js
git commit -m "feat: add vital theme tokens and tailwind mapping"
```


### Task 2: Theme-Registry & Typen

Die Single-Source für verfügbare Themes + Mode-Typen, die die UI (Task 7) konsumiert. Reines TS → TDD.

**Files:**
- Create: `src/lib/themes.ts`
- Test: `src/lib/themes.test.ts`

**Interfaces:**
- Produces:
  - `type ThemeMode = 'light' | 'dark' | 'system'`
  - `type BrandTheme = 'vital'`
  - `interface ThemeMeta { id: BrandTheme; label: string; swatch: { primary: string; accent: string } }`
  - `const THEMES: ThemeMeta[]`
  - `const DEFAULT_MODE: ThemeMode` (= `'system'`)
  - `const DEFAULT_VARIANT: BrandTheme` (= `'vital'`)
  - `function isBrandTheme(v: unknown): v is BrandTheme`
  - `function isThemeMode(v: unknown): v is ThemeMode`

- [ ] **Step 1: Failing Test schreiben — `src/lib/themes.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  THEMES,
  DEFAULT_MODE,
  DEFAULT_VARIANT,
  isBrandTheme,
  isThemeMode,
} from './themes'

describe('themes registry', () => {
  it('hat mindestens das vital-Theme mit vollständigem Swatch', () => {
    const vital = THEMES.find((t) => t.id === 'vital')
    expect(vital).toBeDefined()
    expect(vital?.label).toBeTruthy()
    expect(vital?.swatch.primary).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(vital?.swatch.accent).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('jedes Theme hat eindeutige id und vollständige Felder', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of THEMES) {
      expect(t.label).toBeTruthy()
      expect(t.swatch.primary).toBeTruthy()
      expect(t.swatch.accent).toBeTruthy()
    }
  })

  it('Defaults sind gültig', () => {
    expect(DEFAULT_MODE).toBe('system')
    expect(isThemeMode(DEFAULT_MODE)).toBe(true)
    expect(isBrandTheme(DEFAULT_VARIANT)).toBe(true)
  })

  it('Guards lehnen Fremdwerte ab', () => {
    expect(isThemeMode('neon')).toBe(false)
    expect(isBrandTheme('forest')).toBe(false)
    expect(isBrandTheme(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- src/lib/themes.test.ts`
Expected: FAIL — `Cannot find module './themes'`.

- [ ] **Step 3: `src/lib/themes.ts` implementieren**

```ts
export type ThemeMode = 'light' | 'dark' | 'system'
export type BrandTheme = 'vital'

export interface ThemeMeta {
  id: BrandTheme
  label: string
  swatch: { primary: string; accent: string }
}

export const THEMES: ThemeMeta[] = [
  { id: 'vital', label: 'Vital', swatch: { primary: '#10b981', accent: '#06b6d4' } },
]

export const DEFAULT_MODE: ThemeMode = 'system'
export const DEFAULT_VARIANT: BrandTheme = 'vital'

const MODES: ThemeMode[] = ['light', 'dark', 'system']

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (MODES as string[]).includes(v)
}

export function isBrandTheme(v: unknown): v is BrandTheme {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- src/lib/themes.test.ts`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes.ts src/lib/themes.test.ts
git commit -m "feat: add theme registry and type guards"
```


### Task 3: ThemeProvider & `useThemeControls`

Verwaltet beide Achsen, persistiert, verfolgt die OS-Präferenz live und wendet `data-theme` + `.dark` an. Ersetzt die alte `src/lib/theme.ts`. TDD mit gemocktem `matchMedia`.

**Files:**
- Create: `src/lib/theme-provider.tsx`
- Test: `src/lib/theme-provider.test.tsx`
- (Distinkter Modulname, damit das neue Modul konfliktfrei neben der alten `src/lib/theme.ts` existiert — `./theme` und `./theme-provider` sind eindeutig. `theme.ts` wird erst in Task 7 gelöscht, sobald `Profile.tsx` umgestellt ist. So bleibt der Build in jedem Task grün.)

**Interfaces:**
- Consumes (Task 2): `ThemeMode`, `BrandTheme`, `DEFAULT_MODE`, `DEFAULT_VARIANT`, `isThemeMode`, `isBrandTheme`.
- Produces:
  - `resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark'`
  - `readStoredMode(): ThemeMode`, `readStoredVariant(): BrandTheme`
  - `<ThemeProvider>{children}</ThemeProvider>`
  - `useThemeControls(): { mode, setMode, variant, setVariant, resolvedMode }`

- [ ] **Step 1: Failing Test schreiben — `src/lib/theme-provider.test.tsx`**

```tsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ThemeProvider,
  resolveMode,
  readStoredMode,
  useThemeControls,
} from './theme-provider'

function mockMatchMedia(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
)

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
  mockMatchMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveMode', () => {
  it('löst system anhand der OS-Präferenz auf', () => {
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('system', false)).toBe('light')
  })
  it('gibt expliziten Mode unverändert zurück', () => {
    expect(resolveMode('light', true)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
  })
})

describe('readStoredMode', () => {
  it('migriert den alten nt-theme-Key', () => {
    localStorage.setItem('nt-theme', 'dark')
    expect(readStoredMode()).toBe('dark')
  })
  it('bevorzugt nt-theme-mode', () => {
    localStorage.setItem('nt-theme', 'dark')
    localStorage.setItem('nt-theme-mode', 'light')
    expect(readStoredMode()).toBe('light')
  })
  it('fällt bei Fremdwert auf system zurück', () => {
    localStorage.setItem('nt-theme-mode', 'neon')
    expect(readStoredMode()).toBe('system')
  })
})

describe('ThemeProvider', () => {
  it('setzt data-theme und dark-Klasse (system + OS dunkel)', () => {
    mockMatchMedia(true)
    renderHook(() => useThemeControls(), { wrapper })
    expect(document.documentElement.dataset.theme).toBe('vital')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setMode("light") entfernt dark und persistiert', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useThemeControls(), { wrapper })
    act(() => result.current.setMode('light'))
    expect(result.current.resolvedMode).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('nt-theme-mode')).toBe('light')
  })

  it('setVariant persistiert die Brand-Variante', () => {
    const { result } = renderHook(() => useThemeControls(), { wrapper })
    act(() => result.current.setVariant('vital'))
    expect(localStorage.getItem('nt-theme-variant')).toBe('vital')
    expect(document.documentElement.dataset.theme).toBe('vital')
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- src/lib/theme-provider.test.tsx`
Expected: FAIL — `Cannot find module './theme-provider'`.

- [ ] **Step 3: `src/lib/theme-provider.tsx` implementieren**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_MODE,
  DEFAULT_VARIANT,
  isBrandTheme,
  isThemeMode,
  type BrandTheme,
  type ThemeMode,
} from './themes'

const MODE_KEY = 'nt-theme-mode'
const VARIANT_KEY = 'nt-theme-variant'
const LEGACY_KEY = 'nt-theme'

export function resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (isThemeMode(stored)) return stored
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'light' || legacy === 'dark') return legacy
  } catch {
    /* localStorage blockiert */
  }
  return DEFAULT_MODE
}

export function readStoredVariant(): BrandTheme {
  try {
    const stored = localStorage.getItem(VARIANT_KEY)
    if (isBrandTheme(stored)) return stored
  } catch {
    /* localStorage blockiert */
  }
  return DEFAULT_VARIANT
}

function applyToDom(variant: BrandTheme, resolved: 'light' | 'dark') {
  const el = document.documentElement
  el.dataset.theme = variant
  el.classList.toggle('dark', resolved === 'dark')
}

interface ThemeControls {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  variant: BrandTheme
  setVariant: (v: BrandTheme) => void
  resolvedMode: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeControls | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [variant, setVariantState] = useState<BrandTheme>(readStoredVariant)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  // OS-Präferenz live verfolgen
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  const resolvedMode = resolveMode(mode, systemDark)

  useEffect(() => {
    applyToDom(variant, resolvedMode)
  }, [variant, resolvedMode])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* localStorage blockiert */
    }
  }, [])

  const setVariant = useCallback((v: BrandTheme) => {
    setVariantState(v)
    try {
      localStorage.setItem(VARIANT_KEY, v)
    } catch {
      /* localStorage blockiert */
    }
  }, [])

  const value = useMemo<ThemeControls>(
    () => ({ mode, setMode, variant, setVariant, resolvedMode }),
    [mode, setMode, variant, setVariant, resolvedMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeControls(): ThemeControls {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeControls must be used within a ThemeProvider')
  return ctx
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- src/lib/theme-provider.test.tsx`
Expected: PASS (8 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme-provider.tsx src/lib/theme-provider.test.tsx
git commit -m "feat: add ThemeProvider with mode/variant axes and persistence"
```

> `theme.ts` bleibt unverändert; `Profile.tsx` kompiliert weiter über den alten `useTheme`. Umstellung + Löschung in Task 7.


### Task 4: App-Integration & FOUC-Bootstrap

`ThemeProvider` umschließt die App; ein Inline-Script in `index.html` setzt `data-theme` + `.dark` vor dem ersten Paint. Gate = Build + manuelle Sichtprüfung (kein Flash).

**Files:**
- Modify: `src/App.tsx`
- Modify: `index.html`

**Interfaces:**
- Consumes (Task 3): `ThemeProvider`.

- [ ] **Step 1: `src/App.tsx` — Provider einhängen**

Import ergänzen (zu den bestehenden Imports):

```tsx
import { ThemeProvider } from '@/lib/theme-provider'
```

`App()` umschließen:

```tsx
export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}
```

- [ ] **Step 2: `index.html` — hartkodiertes `class="dark"` entfernen**

Die `<html>`-Zeile ändern von:

```html
<html lang="de" class="dark">
```

zu:

```html
<html lang="de">
```

- [ ] **Step 3: `index.html` — Bootstrap-Script in den `<head>`**

Direkt vor `</head>` einfügen (läuft synchron, bevor `#root` rendert):

```html
    <script>
      ;(function () {
        try {
          var m =
            localStorage.getItem('nt-theme-mode') ||
            (localStorage.getItem('nt-theme') === 'light' ? 'light' : null) ||
            'system'
          var v = localStorage.getItem('nt-theme-variant') || 'vital'
          var dark =
            m === 'dark' ||
            (m === 'system' &&
              window.matchMedia &&
              window.matchMedia('(prefers-color-scheme: dark)').matches)
          var el = document.documentElement
          el.setAttribute('data-theme', v)
          el.classList.toggle('dark', !!dark)
        } catch (e) {}
      })()
    </script>
```

- [ ] **Step 4: Gate — Build & Sichtprüfung**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: kein Fehler.

Run: `npm run dev`, im Browser laden.
Expected: App startet ohne hell→dunkel-Flash; `<html>` trägt `data-theme="vital"` und (bei OS-Dunkel) `class="dark"`. Bei OS = Hell startet die App hell.

> Transitions-Hinweis: Bis Task 7 läuft zusätzlich der alte `useTheme` in `Profile.tsx`. Beide setzen die `dark`-Klasse — auf der Profil-Seite kann der alte Toggle den Provider-Zustand kurz überschreiben. Wird in Task 7 aufgelöst.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx index.html
git commit -m "feat: wrap app in ThemeProvider and add pre-paint theme bootstrap"
```


### Task 5: Self-hosted Fonts (Manrope + JetBrains Mono)

Lädt die Woff2-Dateien deterministisch über die `@fontsource`-Pakete nach `public/fonts/`, deklariert `@font-face`, preloadet die Hauptgewichte. Gate = Build + manuelle Offline-Prüfung. Tailwind-`fontFamily` wurde bereits in Task 1 gesetzt.

**Files:**
- Modify: `package.json` (devDeps + `fonts`-Script)
- Create: `scripts/copy-fonts.mjs`
- Create: `public/fonts/*.woff2` (durch Script erzeugt, committet)
- Modify: `src/index.css` (`@font-face`)
- Modify: `index.html` (Preload)

- [ ] **Step 1: Fontsource-Pakete installieren**

Run: `npm i -D @fontsource/manrope @fontsource/jetbrains-mono`
Expected: beide Pakete in `devDependencies`.

- [ ] **Step 2: `scripts/copy-fonts.mjs` anlegen**

```js
import { cp, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const OUT = join(process.cwd(), 'public', 'fonts')
await mkdir(OUT, { recursive: true })

const JOBS = [
  { pkg: '@fontsource/manrope', prefix: 'manrope', weights: [400, 500, 600, 700, 800] },
  { pkg: '@fontsource/jetbrains-mono', prefix: 'jetbrains-mono', weights: [400, 500, 600] },
]

for (const job of JOBS) {
  const first = require.resolve(
    `${job.pkg}/files/${job.prefix}-latin-${job.weights[0]}-normal.woff2`,
  )
  const dir = dirname(first)
  for (const w of job.weights) {
    const name = `${job.prefix}-latin-${w}-normal.woff2`
    await cp(join(dir, name), join(OUT, name))
  }
}

console.log('Fonts kopiert nach public/fonts')
```

- [ ] **Step 3: `package.json` — `fonts`-Script ergänzen**

Im `scripts`-Block ergänzen:

```json
"fonts": "node scripts/copy-fonts.mjs",
```

- [ ] **Step 4: Script ausführen**

Run: `npm run fonts`
Expected: `public/fonts/` enthält `manrope-latin-{400,500,600,700,800}-normal.woff2` und `jetbrains-mono-latin-{400,500,600}-normal.woff2` (8 Dateien).
Verify: `ls public/fonts`

- [ ] **Step 5: `src/index.css` — `@font-face` ergänzen**

Direkt nach der `@import './styles/themes.css';`-Zeile (vor `@tailwind base;`) einfügen:

```css
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/manrope-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/manrope-latin-500-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/manrope-latin-600-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/fonts/manrope-latin-700-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 800;
  font-display: swap;
  src: url('/fonts/manrope-latin-800-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/jetbrains-mono-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/jetbrains-mono-latin-500-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/jetbrains-mono-latin-600-normal.woff2') format('woff2');
}
```

- [ ] **Step 6: `index.html` — Preload der Hauptgewichte**

Im `<head>` (vor dem Bootstrap-Script) einfügen:

```html
    <link
      rel="preload"
      href="/fonts/manrope-latin-600-normal.woff2"
      as="font"
      type="font/woff2"
      crossorigin
    />
    <link
      rel="preload"
      href="/fonts/manrope-latin-700-normal.woff2"
      as="font"
      type="font/woff2"
      crossorigin
    />
```

- [ ] **Step 7: Gate — Build & Offline-Sichtprüfung**

Run: `npm run build`
Expected: kein Fehler; `dist/fonts/` enthält die Woff2-Dateien.

Run: `npm run dev`, Browser → DevTools Network.
Expected: Text rendert in Manrope; **kein** Request an `fonts.googleapis.com`/`fonts.gstatic.com`; Font-Requests gehen an `/fonts/...`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/copy-fonts.mjs public/fonts src/index.css index.html
git commit -m "feat: self-host Manrope and JetBrains Mono fonts"
```


### Task 6: Makro-Farb-Tokenisierung

Macht die drei Makro-Balken in `Today.tsx` distinkt (Protein/Kohlenh./Fett) statt einheitlich grün — über einen getesteten Helper. TDD.

**Files:**
- Create: `src/lib/macroColor.ts`
- Test: `src/lib/macroColor.test.ts`
- Modify: `src/pages/Today.tsx`

**Interfaces:**
- Produces: `function macroColor(key: 'protein' | 'carbs' | 'fat'): string`
- Consumes: Tailwind-Keys `protein`/`carbs`/`fat` (Task 1).

- [ ] **Step 1: Failing Test — `src/lib/macroColor.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { macroColor } from './macroColor'

describe('macroColor', () => {
  it('mappt jeden Makro-Key auf seine Token-Klasse', () => {
    expect(macroColor('protein')).toBe('bg-protein')
    expect(macroColor('carbs')).toBe('bg-carbs')
    expect(macroColor('fat')).toBe('bg-fat')
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- src/lib/macroColor.test.ts`
Expected: FAIL — `Cannot find module './macroColor'`.

- [ ] **Step 3: `src/lib/macroColor.ts` implementieren**

```ts
export type MacroKey = 'protein' | 'carbs' | 'fat'

/** Tailwind-Hintergrundklasse je Makronährstoff (Token-basiert, theme-fähig). */
export function macroColor(key: MacroKey): string {
  return key === 'protein' ? 'bg-protein' : key === 'carbs' ? 'bg-carbs' : 'bg-fat'
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- src/lib/macroColor.test.ts`
Expected: PASS.

- [ ] **Step 5: `src/pages/Today.tsx` — Balken einfärben**

Import ergänzen (zu den bestehenden Imports):

```tsx
import { macroColor } from '@/lib/macroColor'
```

Am Makro-Balken die `className` der `motion.div` ändern von:

```tsx
                <motion.div
                  className="h-full rounded-full bg-primary"
```

zu:

```tsx
                <motion.div
                  className={`h-full rounded-full ${macroColor(m.key)}`}
```

(`m.key` ist bereits `'protein' | 'carbs' | 'fat'` durch das `as const` am `macros`-Array. Der KCal-`ProgressRing` bleibt unverändert `primary`.)

- [ ] **Step 6: Gate**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: alle grün.

Run: `npm run dev` → Heute-Seite.
Expected: Protein-Balken rot, Kohlenhydrate amber, Fett violett (Light & Dark).

- [ ] **Step 7: Commit**

```bash
git add src/lib/macroColor.ts src/lib/macroColor.test.ts src/pages/Today.tsx
git commit -m "feat: color macro bars by nutrient token"
```


### Task 7: Profile-UI & Abschluss

Ersetzt den Mond-Toggle durch eine Theme-Sektion (Mode-Segmented + Brand-Theme-Auswahl), in eine eigene fokussierte Komponente ausgelagert. Stellt `Profile.tsx` auf `useThemeControls` um und entfernt zum Schluss die alte `theme.ts`. Gate = voller Typecheck + Lint + Tests + manuelle Prüfung.

**Files:**
- Create: `src/components/ThemeSettings.tsx`
- Modify: `src/pages/Profile.tsx`
- Modify: `src/i18n/locales/de.json`
- Delete: `src/lib/theme.ts`

**Interfaces:**
- Consumes (Task 2/3): `useThemeControls`, `THEMES`, `ThemeMode`.

- [ ] **Step 1: i18n-Keys ergänzen — `src/i18n/locales/de.json`**

Im `profile`-Objekt ergänzen (vorhandenes `"theme"` wird nicht mehr referenziert, kann bleiben):

```json
    "appearance": "Darstellung",
    "modeLight": "Hell",
    "modeDark": "Dunkel",
    "modeSystem": "System",
    "brandTheme": "Farbwelt",
```

- [ ] **Step 2: `src/components/ThemeSettings.tsx` anlegen**

```tsx
import { useTranslation } from 'react-i18next'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useThemeControls } from '@/lib/theme-provider'
import { THEMES, type ThemeMode } from '@/lib/themes'
import { Card } from '@/components/ui/Card'

const MODE_OPTIONS: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'profile.modeLight' },
  { value: 'dark', icon: Moon, labelKey: 'profile.modeDark' },
  { value: 'system', icon: Monitor, labelKey: 'profile.modeSystem' },
]

export function ThemeSettings() {
  const { t } = useTranslation()
  const { mode, setMode, variant, setVariant } = useThemeControls()

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('profile.appearance')}</h2>
        <div
          role="radiogroup"
          aria-label={t('profile.appearance')}
          className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const active = mode === opt.value
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={active}
                onClick={() => setMode(opt.value)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <Icon size={16} />
                {t(opt.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('profile.brandTheme')}</h2>
        <div className="flex gap-2 overflow-x-auto">
          {THEMES.map((th) => {
            const active = variant === th.id
            return (
              <button
                key={th.id}
                aria-pressed={active}
                onClick={() => setVariant(th.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                  active ? 'border-primary' : 'border-border'
                }`}
              >
                <span className="flex">
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: th.swatch.primary }}
                  />
                  <span
                    className="-ml-1 h-4 w-4 rounded-full"
                    style={{ background: th.swatch.accent }}
                  />
                </span>
                <span className="font-medium">{th.label}</span>
                {active && <Check size={16} className="text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: `src/pages/Profile.tsx` umstellen**

Import-Zeile 4 ändern (Moon entfernen):

```tsx
import { Download, Upload, RefreshCw, Droplets, Candy } from 'lucide-react'
```

Zeile 9 ersetzen — statt `import { useTheme } from '@/lib/theme'`:

```tsx
import { ThemeSettings } from '@/components/ThemeSettings'
```

Zeile 17 entfernen:

```tsx
  const { theme, toggle } = useTheme()
```

Den kompletten Mond-Toggle-Block ersetzen — von:

```tsx
      <Card className="divide-y divide-border">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <span className="flex items-center gap-3">
            <Moon size={20} className="text-muted-foreground" />
            {t('profile.theme')}
          </span>
          <span className="text-sm text-muted-foreground">{theme === 'dark' ? 'An' : 'Aus'}</span>
        </button>
      </Card>
```

zu:

```tsx
      <ThemeSettings />
```

- [ ] **Step 4: Alte `theme.ts` löschen**

```bash
git rm src/lib/theme.ts
```

- [ ] **Step 5: Gate — voller Lauf**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`
Expected: alle grün (keine verbleibenden `@/lib/theme`-Importe).

Run: `npm run dev` → Profil.
Expected: Segmented Hell/Dunkel/System schaltet sofort um; aktives Theme „Vital" mit Häkchen; Reload behält die Wahl; bei „System" folgt die App dem OS und wechselt live bei OS-Umstellung.

- [ ] **Step 6: Commit**

```bash
git add src/components/ThemeSettings.tsx src/pages/Profile.tsx src/i18n/locales/de.json
git rm src/lib/theme.ts
git commit -m "feat: replace dark toggle with theme mode and brand selector"
```


---

## Self-Review: Spec-Coverage

| Spec-Abschnitt | Task(s) |
|---|---|
| §1 Architektur (`data-theme` + `.dark`) | T1 (Selektoren), T3 (Anwendung), T4 (Bootstrap) |
| §2 Token-Plan (Mapping + neue Tokens + Werte) | T1 |
| §3 Dateien (alle) | T1–T7 (s. jeweilige Files-Blöcke) |
| §4 React-API, FOUC, Persistenz, Migration, matchMedia | T3 + T4 |
| §5 Profile-UI (Segmented + Swatch-Karten) | T7 |
| §6 Makro-Tokenisierung | T6 |
| §7 Font self-hosted | T5 |
| Tests (theme, themes) | T2, T3 (+ macroColor T6) |
| Verifikation manuell | Gates in T4/T5/T6/T7 |

### Bewusste Abweichungen von der Spec (mit Begründung)

1. **`theme.tsx` → `theme-provider.tsx`:** Distinkter Modulname, damit das neue Modul konfliktfrei neben der alten `theme.ts` existieren kann (sonst mehrdeutige Auflösung von `./theme`). Alte Datei wird in T7 gelöscht.
2. **`scripts/fetch-fonts.mjs` → `scripts/copy-fonts.mjs` via `@fontsource`:** Deterministisch und offline-reproduzierbar (keine Laufzeit-Abhängigkeit von der Google-Fonts-CSS-API / User-Agent-Sniffing).

### Type-Konsistenz geprüft

- `ThemeMode`, `BrandTheme`, `ThemeMeta` einheitlich über T2/T3/T7.
- `useThemeControls()` liefert `{ mode, setMode, variant, setVariant, resolvedMode }` (T3), konsumiert in T7.
- `macroColor(key: MacroKey)` — `MacroKey` deckt sich mit dem `as const`-Literal-Union von `m.key` in `Today.tsx`.
- Typecheck-Befehl `npx tsc --noEmit -p tsconfig.app.json` valide (kein composite, `noEmit` bereits aktiv).

## Abschluss-Verifikation (nach Task 7)

- [ ] `npx tsc --noEmit -p tsconfig.app.json` — grün
- [ ] `npm run lint` — grün
- [ ] `npm test` — alle Suites grün (themes, theme-provider, macroColor + Bestand)
- [ ] `npm run build` — grün, `dist/fonts/` vorhanden
- [ ] Manuell: Hell/Dunkel/System schalten, Reload ohne Flash, OS-Live-Wechsel bei „System", Makro-Balken farbig, Manrope offline (kein Google-Request)

