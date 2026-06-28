# Theme-System & „vital"-Theme nach StyleGuide — Design

**Datum:** 2026-06-28
**Status:** Freigegeben (Brainstorming abgeschlossen)
**Quelle StyleGuide:** `../NutritionTracker Designsprache/Designsprache.dc.html` (Variant „vital", Light/Dark)

## Ziel

Ein erweiterbares Theme-System mit zwei Achsen — **Brand-Variant** (`vital`, künftig weitere) × **Mode** (`light`/`dark`) — vom Nutzer umschaltbar, Default folgt der OS-Einstellung. Das erste Theme `vital` bildet die StyleGuide-Designsprache exakt ab (Farben, Makro-Differenzierung, Manrope-Font).

## Getroffene Entscheidungen

| Achse | Entscheidung |
|---|---|
| Scope | Volles System: mehrere Brand-Themes × Light/Dark, umschaltbar |
| Token-Naming | **Hybrid** — bestehende shadcn-Tokens auf StyleGuide-Werte mappen + fehlende StyleGuide-Tokens ergänzen |
| Anwendung | **Ansatz A** — CSS-Token-Blöcke per `data-theme` + `.dark`, schlanke TS-Registry nur für die UI |
| Font | Manrope **self-hosted** (offline-fest) + JetBrains Mono für Zahlen |
| Theme-UX | Mode (Hell/Dunkel/System) + Brand-Theme-Auswahl im Profil, Default = System |

## Nicht-Ziele (YAGNI)

- Keine zweite Brand-Variante in diesem Scope (Architektur trägt sie; nur `vital` wird angelegt).
- Keine Umstellung der Radius-/Spacing-Skala.
- Keine Übernahme der StyleGuide-Animations-Tokens.
- Kein Tailwind-Color-Mapping-Umbau (HSL-Tripel-Mechanik bleibt erhalten).

---

## Architektur

### Zwei Achsen am `<html>`

```html
<html data-theme="vital" class="dark">
```

- `data-theme` = aktive Brand-Variante.
- `.dark`-Klasse = aufgelöster Mode (aus `light | dark | system`; bei `system` via `matchMedia('(prefers-color-scheme: dark)')`).

### Token-Auflösung per CSS-Kaskade

```css
[data-theme="vital"]      { /* light-Tokens (Default) */ }
[data-theme="vital"].dark { /* dark-Overrides */ }
```

Keine JS-Farb-Logik zur Laufzeit — JS toggelt nur Attribut + Klasse. Neues Theme = ein CSS-Blockpaar + ein Registry-Eintrag.

---

## Token-Plan (Hybrid)

**Konvertierung:** Solid-Farben werden aus StyleGuide-HEX zu **HSL-Tripeln** konvertiert (Format `H S% L%`), damit `hsl(var(--token))` und Tailwind-Opacity-Modifier (`bg-primary/10`, 16× genutzt) erhalten bleiben. Komposit-Werte (Gradient, Glow, Soft-Tint) bleiben **rohe** Vars.

### Mapping bestehender shadcn-Tokens → StyleGuide-Quelle

| shadcn-Token | ← StyleGuide-Quelle |
|---|---|
| `--background` | neutral `bg` |
| `--foreground` | neutral `text` |
| `--card` / `--card-foreground` | `surface` / `text` |
| `--primary` | brand `primary` |
| `--primary-foreground` | `#FFFFFF` (beide Modi) |
| `--secondary` / `--secondary-foreground` | `surface2` / `text2` |
| `--muted` | `surface2` |
| `--muted-foreground` | `text2` (sekundärer Text, 62× genutzt) |
| `--accent` / `--accent-foreground` | brand `accent` / `#FFFFFF` |
| `--destructive` | semantic `error` |
| `--success` / `--warning` | semantic `success` / `warning` |
| `--border` | neutral `border` |
| `--input` | neutral `borderStrong` |
| `--ring` | brand `primary` |
| `--radius` | unverändert (`1rem`) |

### Neue Tokens

Solids (HSL-Tripel, als Tailwind-Color-Keys): `--canvas`, `--surface-2`, `--surface-3`, `--border-strong`, `--text-3`, `--primary-fill`, `--ring-track`, `--skeleton-base`, `--skeleton-hi`, `--protein`, `--carbs`, `--fat`.

Komposite (rohe Vars, eigene Tailwind-Keys): `--primary-soft`, `--grad` (→ `bg-brand-gradient`), `--glow`, `--shadow-sm/md/lg`, `--shadow-glow` (→ `shadow-*`).

### Konkrete StyleGuide-Werte (Referenz, HEX)

**Neutral light:** canvas `#E7EAF0`, bg `#F6F7F9`, surface `#FFFFFF`, surface2 `#F1F3F7`, surface3 `#E6EAF0`, border `#E6E9EF`, borderStrong `#D2D8E2`, text `#0F172A`, text2 `#4B5666`, text3 `#94A0B0`, ringTrack `#EBEEF3`, skelBase `#ECEFF3`, skelHi `#F9FAFC`.
shadowSm `0 1px 2px rgba(16,24,40,.06)`, shadowMd `0 6px 18px rgba(16,24,40,.08)`, shadowLg `0 22px 48px rgba(16,24,40,.16)`.

**Neutral dark:** canvas `#05080E`, bg `#0A0E16`, surface `#141A24`, surface2 `#1C2430`, surface3 `#27313F`, border `#28313D`, borderStrong `#3A4654`, text `#F1F5F9`, text2 `#AAB4C2`, text3 `#69768A`, ringTrack `#222C39`, skelBase `#1A222E`, skelHi `#27313F`.
shadowSm `0 1px 2px rgba(0,0,0,.4)`, shadowMd `0 8px 24px rgba(0,0,0,.45)`, shadowLg `0 26px 54px rgba(0,0,0,.6)`.

**Semantic light:** protein `#F43F5E`, carbs `#F59E0B`, fat `#8B5CF6`, success `#16A34A`, warning `#D97706`, error `#DC2626`.
**Semantic dark:** protein `#FB7185`, carbs `#FBBF24`, fat `#A78BFA`, success `#34D399`, warning `#FBBF24`, error `#F87171`.

**Brand „vital" light:** primary `#10B981`, fill `#059669`, soft `#E6F8F0`, accent `#06B6D4`, grad `linear-gradient(135deg,#10B981 0%,#06B6D4 100%)`, glow `rgba(16,185,129,.30)`.
**Brand „vital" dark:** primary `#34D399`, fill `#059669`, soft `rgba(52,211,153,.14)`, accent `#22D3EE`, grad `linear-gradient(135deg,#10B981 0%,#06B6D4 100%)`, glow `rgba(16,185,129,.42)`.

> Anmerkung `--primary-soft`: in light solide (`#E6F8F0`), in dark `rgba` → als vollständiger Farbwert-Var gespeichert, Tailwind-Key ohne `hsl()`-Wrapper.

---

## Dateien & Komponenten

| Datei | Aktion | Zweck |
|---|---|---|
| `src/styles/themes.css` | neu | Token-Blöcke je Theme×Mode; in `index.css` per `@import` eingebunden |
| `src/lib/themes.ts` | neu | Registry + Typen (siehe unten) |
| `src/lib/theme.tsx` | rewrite (war `theme.ts`) | `ThemeProvider` + `useThemeControls()` |
| `src/App.tsx` | edit | `ThemeProvider` umschließt App |
| `index.html` | edit | Pre-Paint-Bootstrap-Script + Font-Preload |
| `public/fonts/` | neu | `manrope-*.woff2`, `jetbrainsmono-*.woff2` |
| `scripts/fetch-fonts.mjs` | neu | Lädt die Woff2-Dateien reproduzierbar |
| `src/index.css` | edit | `@font-face`, `@import` der Theme-CSS |
| `tailwind.config.js` | edit | `fontFamily.sans→Manrope`, `mono→JetBrains Mono`, neue Color-/Shadow-/Gradient-Keys |
| `src/pages/Profile.tsx` | edit | Mond-Toggle → Theme-Sektion |
| `src/lib/macroColor.ts` | neu | `macroColor(key) → 'bg-protein'|'bg-carbs'|'bg-fat'` |
| `src/pages/Today.tsx` | edit | Makro-Balken nutzen `macroColor` |
| `src/i18n/locales/de.json` | edit | Theme-UI-Strings |
| `src/lib/theme.test.ts` | neu | Mode-Auflösung, Persistenz, DOM-Anwendung |
| `src/lib/themes.test.ts` | neu | Registry-Vollständigkeit |

### Registry (`src/lib/themes.ts`)

```ts
export type ThemeMode = 'light' | 'dark' | 'system'
export type BrandTheme = 'vital'

export interface ThemeMeta {
  id: BrandTheme
  label: string
  swatch: { primary: string; accent: string } // HEX für UI-Punkte
}

export const THEMES: ThemeMeta[] = [
  { id: 'vital', label: 'Vital', swatch: { primary: '#10B981', accent: '#06B6D4' } },
]
```

### Provider-API (`src/lib/theme.tsx`)

```ts
useThemeControls(): {
  mode: ThemeMode            // 'light' | 'dark' | 'system'
  setMode(m: ThemeMode): void
  variant: BrandTheme
  setVariant(v: BrandTheme): void
  resolvedMode: 'light' | 'dark'  // system → aufgelöst
}
```

- Persistenz-Keys: `nt-theme-mode`, `nt-theme-variant` (Migration: alter Key `nt-theme` mit `'dark'`/`'light'` wird einmalig in `nt-theme-mode` übernommen, falls vorhanden).
- `matchMedia`-Listener aktiv, solange `mode === 'system'` → Live-Update bei OS-Wechsel.
- Effekt setzt `documentElement.dataset.theme = variant` und `classList.toggle('dark', resolvedMode === 'dark')`.

### FOUC-Bootstrap (`index.html`, vor `#root`)

```html
<script>
  (function () {
    try {
      var m = localStorage.getItem('nt-theme-mode')
        || (localStorage.getItem('nt-theme') === 'light' ? 'light' : null)
        || 'system'
      var v = localStorage.getItem('nt-theme-variant') || 'vital'
      var dark = m === 'dark' || (m === 'system' &&
        matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = v
      document.documentElement.classList.toggle('dark', dark)
    } catch (e) {}
  })()
</script>
```

### Profile-UI

Ersetzt die bestehende Toggle-Card durch eine Card mit zwei Zeilen:

1. **Darstellung** — Segmented Control `Hell · Dunkel · System` (bindet `mode`/`setMode`).
2. **Theme** — horizontale Swatch-Karten aus `THEMES.map(...)`: zwei Farbpunkte (primary/accent), Label, Häkchen bei `variant === t.id`. Bei nur einem Theme trotzdem korrekt dargestellt; weitere Themes erscheinen automatisch.

### Makro-Tokenisierung

`src/lib/macroColor.ts`:

```ts
export function macroColor(key: 'protein' | 'carbs' | 'fat'): string {
  return key === 'protein' ? 'bg-protein' : key === 'carbs' ? 'bg-carbs' : 'bg-fat'
}
```

In `Today.tsx` ersetzt `bg-primary` an den drei Makro-Balken durch `macroColor(m.key)`. Eng begrenzt; KCal-Ring bleibt `primary`.

### Font (self-hosted)

- `scripts/fetch-fonts.mjs` lädt Manrope (400/500/600/700/800) + JetBrains Mono (400/500/600) als Woff2 nach `public/fonts/`.
- `@font-face`-Deklarationen in `index.css` mit `font-display: swap`.
- Preload der wichtigsten Gewichte (Manrope 600/700) in `index.html`.
- `tailwind.config.js`: `fontFamily.sans = ['Manrope', 'system-ui', 'sans-serif']`, `fontFamily.mono = ['"JetBrains Mono"', 'ui-monospace', 'monospace']`.

---

## Datenfluss

1. Erststart: Bootstrap-Script liest localStorage (leer) → `mode='system'`, `variant='vital'` → setzt `data-theme="vital"` + ggf. `.dark` aus OS, **vor** dem Paint.
2. React mountet, `ThemeProvider` liest dieselben Keys, abonniert `matchMedia`.
3. Nutzer wählt im Profil `Dunkel` → `setMode('dark')` → Persistenz + DOM-Klasse → CSS-Kaskade liefert dark-Tokens → alle `hsl(var())`-Klassen aktualisieren sofort.
4. Nutzer wechselt Theme → `setVariant(...)` → `data-theme` ändert sich → andere Brand-Token-Werte.

## Fehlerbehandlung

- Bootstrap in `try/catch` (Private-Mode / blockiertes localStorage) → Fallback `system`/`vital`.
- Unbekannter persistierter Wert → Fallback auf Defaults (Registry-Validierung in `setVariant`).
- `matchMedia` evtl. nicht vorhanden (alte WebViews) → Guard, Fallback `light`.

## Tests

- `theme.test.ts` (vitest + jsdom, `window.matchMedia` gemockt):
  - `system` löst gemäß `matchMedia` zu `light`/`dark` auf.
  - `setMode`/`setVariant` schreiben Persistenz-Keys.
  - Effekt setzt `data-theme` + `.dark` korrekt.
  - Migration alter `nt-theme`-Key.
- `themes.test.ts`: jedes `THEMES`-Element hat `id`, `label`, `swatch.primary`, `swatch.accent`.

## Verifikation (manuell)

`npm run dev` → Profil: Hell/Dunkel/System schalten, Reload ohne Flash, OS-Wechsel bei „System" live; Makro-Balken zeigen rot/amber/violett; Manrope sichtbar (offline, Netzwerk-Tab ohne Google-Request). `npm run typecheck`, `npm run lint`, `npm test` grün.
