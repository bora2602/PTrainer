# Design — Ptrainer

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

The system is **Aurora** from the Hallmark catalog. Because this is one product
rather than a set of unrelated pages, Hallmark's diversification rule is
**inverted here**: views must share the system, not differ from each other. A
view that drifts from this file is a defect.

## Genre

`atmospheric` — specifically Aurora's *"Linear/Vercel-after-dark register"*.
Chosen because the product is measurement-shaped (sets, loads, macros,
completion rates) and Aurora's token set is app-grade out of the box: a
four-step ink ladder, two rule steps, 12px card radii. Cool cyan reads
naturally for training — recovery, energy, freshness.

## Macrostructure family

- **Entry pages** — Marquee Hero. Currently the auth screen: quiet title-left,
  form card right, two canvas blooms.
- **App pages** — Workbench. All eight signed-in views (dashboard, clients,
  workouts, progress, nutrition, messages, builder, settings). Function carries
  the page; no enrichment.
- **Content pages** — Long Document. Privacy notice and terms modals.

## Theme — Aurora, two drops

Full token set in [`app/tokens.css`](app/tokens.css). Night is canonical
Aurora; Day is derived at the same hue so the app keeps its toggle.

| | Night (`:root`, default) | Day (`html[data-theme="light"]`) |
|---|---|---|
| `--color-paper` | `oklch(11% 0.025 200)` blue-green near-black | `oklch(97% 0.010 200)` cool bone |
| `--color-ink` | `oklch(96% 0.010 200)` | `oklch(18% 0.020 200)` |
| `--color-accent` | `oklch(72% 0.170 200)` cyan | `oklch(48% 0.160 200)` deep teal |
| `--color-accent-2` | `oklch(64% 0.150 175)` teal-green | `oklch(46% 0.130 175)` |
| `--color-rule` | `oklch(28% 0.022 200)` | `oklch(88% 0.012 200)` |
| `--color-focus` | `oklch(72% 0.170 200)` | `oklch(48% 0.160 200)` |

**Why Day's accent is darker.** Night's cyan at 72% lightness measures 3.7:1 on
a bone ground — it fails. At 48% it measures 5.0:1 on paper and 5.3:1 reversed.
Do not "restore" the brighter cyan on the light drop.

**Accent discipline.** Accent occupies **1.5–1.9%** of the viewport, measured.
Ceiling is 3%. It marks the active nav item, the primary CTA, focus rings,
progress fills, and links. Nothing else.

**The chord.** `--color-accent-2` sits 25° from the accent, so it reads as
harmony rather than a second accent. It carries *positive / complete* — which
means the palette needs fewer invented status colours.

## Typography

Two families. Aurora's stock body face is Sentient; this build uses Geist
instead — see § Deviations.

- **Display** — Geist 600, `letter-spacing: -0.035em`
- **Body** — Geist 400
- **Machine labels** — Geist Mono 400/500, 11px, `letter-spacing: 0.10em`,
  UPPERCASE. Eyebrows, table headers, status chips, meta rows, stat labels.
- **Aurora is sentence case throughout.** No lowercase register, no italic
  anywhere. The one accent-coloured word in the auth headline is carried by
  colour alone.

Fonts are **self-hosted** in `app/assets/fonts/` and declared in
[`app/fonts.css`](app/fonts.css) — see § Fonts are self-hosted.

## Spacing and shape

4-point named scale in `tokens.css` (`--space-3xs` … `--space-4xl`). Views use
named tokens, never raw px. `--radius-card: 12px`, `--radius-input: 8px`,
`--radius-chip: 6px`, `--radius-pill: 999px`. Buttons are pills.

## Motion

- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`, plus `--ease-press`
  `cubic-bezier(0.2, 0.7, 0.3, 1)` for the button press. Never the default `ease`.
- Durations: `--dur-press` 70ms, `--dur-micro` 120ms, `--dur-short` 220ms,
  `--dur-long` 420ms.
- One orchestrated entrance per view — opacity + 8px translate, 60ms stagger,
  capped at 4 steps.
- **Blooms never animate.** They are fixed-attachment canvas, not motion.
- Only `transform` and `opacity` are animated.
- Reduced-motion collapses everything to ≤150ms.

## Microinteractions stance

- Silent success. Toasts only for failures and async work with no visible effect.
- Focus rings appear **instantly** — never transitioned.
- Cards lift 2px on hover behind `@media (hover: hover)`. No hover-only affordances.
- Touch targets ≥44px under `@media (pointer: coarse)`; the set-complete
  checkbox gets ≥32px.

## CTA voice

- **Primary** — accent fill, `--color-accent-ink` text, pill, sentence case.
  Never near-white text on the accent fill (that combination measures 1.95:1).
- **Secondary** — transparent with a `--color-rule-2` hairline; border warms to
  `--color-accent-line` on hover.
- **Ghost / text** — accent text, underline on hover.
- Every clickable label carries `white-space: nowrap`. Shorten the label rather
  than letting it wrap.

## Per-page allowances

- Entry pages MAY use the two canvas blooms.
- App pages get **one faint wash** on `main` and nothing more. Every text
  surface must resolve to a flat token.
- **No apparatus, no orbs, no decorative rings.** The canvas carries the mood.

## What views MUST share

- The wordmark and the cyan mark.
- The accent colour and its ≤3% placement.
- Geist + Geist Mono, and the sentence-case / UPPERCASE-mono split.
- The CTA voice (pill, radius, padding rhythm).
- Hairline cards on flat surfaces — the accent glow is for focal surfaces only.
- `font-variant-numeric: tabular-nums` anywhere a number appears.

## What views MAY differ on

- Macrostructure within their family.
- Panel composition and grid rhythm.
- Whether a stat row appears — only if the numbers are real.

## Honesty rules

- **Never invent a metric.** Placeholders render as `—` until the API fills
  them. The dashboard's previous hardcoded `↗ 2 this month`,
  `↗ 14% vs last week`, `33 of 38 assigned` and `↗ 6 this week` were removed
  for this reason.
- **The auth figure row is real data** — 198 movements, 15 muscle groups, 36
  equipment kinds, all counted from
  [`app/exercise-catalog.mjs`](app/exercise-catalog.mjs). If the catalog
  changes, update those three numbers or drop the row.

## Documented deviations

Four, each deliberate:

1. **Body is Geist, not Sentient.** Aurora's stock body face is a serif. The
   content here is numeric tables — sets, reps, load, macros — and a serif under
   the reading load hurts legibility. Geist is Aurora's own declared fallback
   (`--font-body: "Sentient", "Geist", …`), so this stays inside the theme and
   drops a family rather than adding one.
2. **Blooms are entry-canvas only.** Aurora places two blooms behind the
   content. Behind a data table that makes contrast *positional* — the same text
   passes or fails depending on where it lands. App views get one faint wash on
   `main`, sitting behind opaque cards only, so every text surface resolves to a
   flat token and contrast stays a fixed, checkable number.
3. **A Day drop exists.** Aurora ships dark-only; this app ships a light/dark
   toggle and removing it would be a regression.
4. **Two functional borrowings from Hum**, neither needing Hum's palette:
   - **Big tabular counters** (`--text-counter`) for streaks, completion rate
     and macro totals — the numbers the trainee opens the app to see.
   - **Press-down feedback** — `translateY(2px)`, 70ms, on `:active` for
     primary actions and the set-complete checkbox. Physical confirmation
     matters for a tap taken mid-set.

Functional status colours (`--color-caution`, `--color-critical`) also sit
outside the one-accent rule. They appear only on small surfaces and always
alongside a glyph, never as colour alone.

## Fonts are self-hosted — do not switch to a CDN

The app ships a strict CSP (`default-src 'self'`, `style-src 'self'`) from
`app/server.mjs`. A Google Fonts `<link>` is blocked by it, and loosening the
policy would disclose every viewer's IP to a third party on a product handling
personal health information — a launch-blocking concern under CLAUDE.md §6.
Geist and Geist Mono are downloaded into `app/assets/fonts/` (latin +
latin-ext, 10 woff2 files, ~208 KB total, fetched per `unicode-range`) and
declared in `app/fonts.css`. Both are SIL Open Font License 1.1.

For the same reason **no inline `style` attributes are allowed.** Data-driven
sizes ride on `data-w` / `data-h` and are applied through CSSOM by
`applyBarSizes()` in `app.js`.

## Exports

### tokens.css

The live token set is [`app/tokens.css`](app/tokens.css) — the single source,
linked directly by `app/index.html`. Copy that file to port the system; the
mappings below are for other toolchains.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:    oklch(11% 0.025 200);
  --color-ink:      oklch(96% 0.010 200);
  --color-accent:   oklch(72% 0.170 200);
  --color-accent-2: oklch(64% 0.150 175);
  --color-rule:     oklch(28% 0.022 200);
  --font-display:   "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-body:      "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono:      "Geist Mono", ui-monospace, monospace;
  --spacing-md:     1rem;
  --text-md:        1.125rem;
  --ease-out:       cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":  { "$value": "oklch(11% 0.025 200)", "$type": "color" },
    "ink":    { "$value": "oklch(96% 0.010 200)", "$type": "color" },
    "accent": { "$value": "oklch(72% 0.170 200)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Geist",      "$type": "fontFamily" },
    "body":    { "$value": "Geist",      "$type": "fontFamily" },
    "mono":    { "$value": "Geist Mono", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background:         11%  0.025 200;
  --foreground:         96%  0.010 200;
  --primary:            72%  0.170 200;
  --primary-foreground: 11%  0.025 200;
  --muted:              18%  0.030 200;
  --muted-foreground:   74%  0.014 200;
  --border:             28%  0.022 200;
  --input:              28%  0.022 200;
  --ring:               72%  0.170 200;
  --radius:             12px;
}
```
