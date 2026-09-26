# Design — Ptrainer

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

The system is **Coral** from the Hallmark catalog. Because this is one product
rather than a set of unrelated pages, Hallmark's diversification rule is
**inverted here**: views must share the system, not differ from each other. A
view that drifts from this file is a defect.

> **This file replaced the Aurora system** (cool cyan on near-black, dark-first,
> `app/aurora.css`) in the 2026-09-25 redesign. The brief was that the app read
> as generated, confusing and dashboard-shaped. The three findings behind the
> replacement, and what each one cost, are in § Why the system changed. Aurora's
> reasoning is preserved there rather than deleted, because two of its four
> documented deviations were right and survive into Coral.

## Genre

`modern-minimal` — the *"Stripe-not-Linear warmth"* register. Chosen over
Aurora's `atmospheric` because the product is a daily companion a client opens
between sets, not a late-night tool. Atmospheric's vocabulary — canvas blooms,
accent emission on cards, a dark canonical drop — actively worked against the
brief: a light everyday theme, calm surfaces, and one warm signal colour.

Playful was the near miss. Hallmark's own guidance settles it: *"for the
quieter, more restrained end of friendly — 'friendly but soft' rather than
'alive' — reach instead for modern-minimal (Coral)."* That is this product.

## Macrostructure family

- **Entry pages** — Marquee Hero. The signed-out screen: title-left, form card
  right, and **no canvas** (see § Deviations).
- **App pages** — **Index-First.** A view states its purpose, offers one action,
  and lists the real things underneath. Hairline rows inside one container, not
  a grid of summary cards. This replaced Workbench, which is a *marketing*
  shape about annotated screenshots and never fit a signed-in view.
- **The session logger** — **Narrative Workflow.** The one genuine sequence in
  the product: exercise 1, then 2, then 3. It is also the only screen used
  one-handed and out of breath, so it takes the whole viewport, large targets,
  and a footer that does not move.
- **Content pages** — Long Document. Privacy notice and terms modals.

## Theme — Coral, two drops

Full token set in [`app/tokens.css`](app/tokens.css). Day is canonical; Night
holds the same hue and moves only lightness and chroma.

| | Day (`:root`, default) | Night (`html[data-theme="dark"]`) |
|---|---|---|
| `--color-paper` | `oklch(99.4% 0.0025 23)` reads white | `oklch(13.5% 0.008 23)` near-black |
| `--color-paper-2` | `oklch(97.8% 0.006 23)` off-white | `oklch(18% 0.010 23)` |
| `--color-ink` | `oklch(21.5% 0.022 23)` charcoal | `oklch(96% 0.008 23)` off-white |
| `--color-brand` | `oklch(67.8% 0.172 23)` = `#ef6464` | `oklch(70% 0.170 23)` |
| `--color-accent` | `oklch(56.3% 0.192 23)` deep coral | `oklch(72% 0.165 23)` |
| `--color-rule` | `oklch(90.5% 0.009 23)` | `oklch(29% 0.013 23)` |
| `--color-focus` | `oklch(56.3% 0.192 23)` | `oklch(72% 0.165 23)` |

**Surfaces stack in opposite directions in the two drops.** In Day the page is
white and each surface set on it is a shade warmer — a card recedes. In Night
the page is near-black and each surface rises. `--color-paper-2` therefore means
"a surface distinct from the page", not "lighter"; the direction follows the
drop. Anything that assumes raised-means-lighter will be wrong in Day.

### Why the coral has two tokens

This is the single most important rule in the file, and it is measured, not a
preference.

The brand colour is `#ef6464`. In OKLCH that is `oklch(67.8% 0.172 23)`, and on
this paper it measures **3.09:1** — and **3.15:1** with white text on top of it.
It fails WCAG AA for text (4.5:1) in *both* directions. There is no lightness
for a coral this soft that carries text on white.

So the system splits the colour by job:

| Token | Value in Day | Measures | Job |
|---|---|---|---|
| `--color-brand` | `oklch(67.8% 0.172 23)` | 3.09:1 on paper | Marks and fills. The active-nav bar, progress fills, chart bars, the today card's mark. **Never text.** |
| `--color-accent` | `oklch(56.3% 0.192 23)` | 4.98:1 on paper | Text, links, focus rings, the primary button's fill. |

Both sit at hue 23, so they read as one colour family rather than two accents.
**Do not "restore" the soft coral onto text.** It was measured and it fails.
[`work/contrast-check.mjs`](work/contrast-check.mjs) holds both numbers.

### Why the error colour is not the brand

With a red accent, "is this an error or is this the brand?" is a real question,
and a contrast ratio cannot answer it: two colours of equal lightness measure
1.00:1 against each other however different their hue. So `--color-critical`
sits at hue 16 and a much lower lightness, and the separation is asserted as an
**OKLab distance** instead — dE 0.20 in Day, 0.09 in Night, against a floor of
0.05. That check is in `contrast-check.mjs` alongside the ratios.

Colour is still never the only signal. An error is a glyph plus a sentence:
`.form-error` carries a `⚠` through `::before` and appears as text, never as a
coloured fill.

**Aurora's teal chord is gone entirely.** It carried *positive / complete*, and
`--color-positive` now does that job under its own name. There is no
`--color-accent-2`; a token whose name says "second accent" while meaning
"green" was only ever going to mislead.

**Accent discipline.** Accent and brand together mark the active nav item, the
primary CTA, focus rings, progress fills, links, and the small square mark on
the today card. Nothing else. The ceiling is 3% of the viewport.

**No asymmetric stripe on a card.** A thick coloured border down one edge is a
2018-SaaS tell. A card that needs to read as focal gets a hairline like every
other card, a lift from `--shadow-card`, and a small accent mark beside its
label. The today card is the only focal card in the app and that is how it is
built.

## Typography

One family plus a mono, both self-hosted. See § Fonts are self-hosted.

- **Display** — Geist 600, `letter-spacing: -0.028em`
- **Body** — Geist 400
- **Machine labels** — Geist Mono 500, 12px, `letter-spacing: 0.08em`,
  UPPERCASE. Table headers, status chips, set numbers, group headings.
- **Sentence case throughout.** No italic anywhere, headings included.

**Eyebrows are off.** The previous build carried **thirty** uppercase mono
kickers — one above nearly every heading, every panel, and every modal: `INBOX`
over "Notifications", `ASSIGN` over "Assign a workout". A kicker on every
section is the most reliable generated-page tell there is, and it was the
largest single contributor to the app reading as machine-made. All thirty are
gone. The `.eyebrow` class survives, restyled to sentence case and quiet, for a
future use that earns it. A new one needs a reason in the commit message.

**The micro tier is 11px and there is nothing below it.** The previous build
scattered 8px, 9px and 10px across eighty-odd rules with no tier behind them.
`--text-2xs` (11px) is the floor; `--text-xs` (12px) carries anything that is a
label rather than a caption.

## Spacing and shape

4-point named scale in `tokens.css` (`--space-3xs` … `--space-4xl`). Views use
named tokens, never raw px. `--radius-card: 10px`, `--radius-input: 8px`,
`--radius-chip: 6px`, `--radius-pill: 999px`. Buttons are pills.

Radii stepped down from Aurora's 12px. "Oversized rounded cards" was a named
complaint in the brief; 10px on a card reads composed rather than soft.

**`--page-measure` is 62rem** and every app view is capped at it and centred.
Past that a list row becomes a scan across empty space, which is most of what
made the old build feel like a dashboard on a wide screen. The two exceptions
are the calendar month grid and the message thread, at 76rem.

## Navigation

- **Desktop** — N3 side rail, 228px, hairline edge. The active item carries
  three signals: a 3px coral bar, a coral icon, and ink-weight text.
- **Mobile (≤720px)** — a **bottom tab bar** with the five destinations a person
  uses daily. The side rail hides and the hamburger drawer keeps the rest
  (settings, subscription, help, sign out).

The tab bar's breakpoint is **720px in pixels, matching `styles.css`**, not
45rem. A rem breakpoint drifts against a px one under a non-default root font
size and can open a viewport with the rail already hidden and the bar not yet
shown — no navigation at all.

Each role sees exactly five tabs; the other role's items are `display: none` and
leave the grid entirely. [`work/accessibility-check.mjs`](work/accessibility-check.mjs)
asserts the count for both roles, because a regression here is invisible on a
desktop viewport.

Icons are text glyphs, never an icon library — this app has two runtime
dependencies and that is a feature. The rail and the tab bar must use the **same
glyph for the same destination**; two sets for one product is its own tell.

## Motion

- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`, plus `--ease-press`
  `cubic-bezier(0.2, 0.7, 0.3, 1)` for the button press. Never the default `ease`.
- Durations: `--dur-press` 70ms, `--dur-micro` 120ms, `--dur-short` 200ms,
  `--dur-long` 380ms.
- One orchestrated entrance per view — opacity + 6px translate, 50ms stagger,
  capped at 4 steps.
- Only `transform` and `opacity` are animated.
- Reduced-motion collapses everything to ≤150ms **and drops the press-down**,
  which is a transform and therefore motion.

## Microinteractions stance

- Silent success. Toasts only for failures and async work with no visible effect.
- Focus rings appear **instantly** — never transitioned.
- Cards lift 2px on hover behind `@media (hover: hover) and (pointer: fine)`.
  No hover-only affordances.
- Touch targets ≥44px under `@media (pointer: coarse)`; tab items ≥48px; the
  set-complete checkbox ≥32px.
- The drawer closes on Escape and on a tap outside it, not only on the button
  that opened it.

## CTA voice

- **Primary** — coral fill, pill, sentence case. In Day that is
  `--color-accent` with white text (5.07:1); in Night `--color-brand` with
  near-black text (7.32:1). **Never near-white text on the soft coral** — that
  pair measures 3.15:1.
- **Secondary** — transparent with a `--color-rule-2` hairline; border warms to
  `--color-accent-line` on hover.
- **Ghost / text** — accent text, underline on hover.
- **Danger** — `--color-critical` outline on transparent, never a red fill.
- Every clickable label carries `white-space: nowrap`. Shorten the label rather
  than letting it wrap.

## Per-page allowances

- **No canvas, no blooms, no washes, anywhere.** See § Deviations.
- App pages get **no enrichment**. Function carries the page.
- Every text surface must resolve to a flat token.

## What views MUST share

- The wordmark and the coral mark.
- The two coral tokens and their jobs, and the ≤3% placement.
- Geist + Geist Mono, and the sentence-case / UPPERCASE-mono split.
- The CTA voice (pill, radius, padding rhythm).
- The lede: one `h1`, one sentence, one primary action, a hairline under it.
- Hairline cards on flat paper.
- `font-variant-numeric: tabular-nums` anywhere a number appears.
- The same glyph for the same destination in both navigations.

## What views MAY differ on

- Macrostructure within their family.
- Panel composition and grid rhythm.
- Whether a figure row appears — only if the numbers are real.

## Honesty rules

- **Never invent a metric.** Placeholders render as `—` until the API fills them.
- **Never ship a person who does not exist.** The previous build had four
  invented clients and their invented workouts in `index.html`, visible until
  the fetch landed: Jordan Lee, Sarah Kim, Daniel Moore, Amelia Park. They are
  gone, replaced by the loading state the lists already knew how to render.
- **Never ship a control that does nothing.** Two `.date-button` filters ("This
  week", "Last 8 weeks") had no handler in any of the three scripts. Removed.
  The topbar search promised "Search clients, workouts…" and filtered only
  clients; its label now says what it does.
- **Do not show one number twice.** The trainer dashboard showed completion rate
  in the focus card and again in the figure row. The focus card is about one
  action and now carries only that.
- **The auth figure row is real data** — 198 movements, 15 muscle groups, 36
  equipment kinds, counted from
  [`app/exercise-catalog.mjs`](app/exercise-catalog.mjs). If the catalog
  changes, update those three numbers or drop the row.

## Why the system changed

Three findings, from reading the shipped app rather than from taste:

1. **Every view was a dashboard.** Eight signed-in views all opened with a
   welcome row, then a grid of one-number cards with decorated icon tiles, then
   panels of panels. A client opening the app to train had to read four
   summaries before finding the workout. Fixed by Index-First plus the today
   card: the trainee's landing view now leads with the session and a button that
   starts it.
2. **On a phone, every destination was behind a hamburger.** The rail hid at
   720px and nothing replaced it, so "go to my workouts" was a menu tap, a
   scan, and a guess. Fixed by the tab bar.
3. **The tells were countable.** Thirty uppercase kickers, eight fabricated
   client names, two dead filter buttons, a search box whose label overpromised,
   one metric printed twice, and eighty-odd rules of 8–10px text. None of these
   is a taste question.

## Documented deviations

1. **Body is Geist, not a serif.** Aurora's stock body face is Sentient; Coral's
   is Geist throughout, which is also what the content wants — these are numeric
   tables, and a serif under that reading load hurts legibility. Carried over
   from the Aurora build unchanged.
2. **No canvas at all.** Aurora allowed two blooms on the entry screen and one
   faint wash on `main`; both are removed. A soft coral cloud behind a sign-in
   form is the most recognisable generated-page background there is, and a wash
   behind a data table makes contrast *positional* — the same text passes or
   fails depending on where it lands. Flat tokens keep contrast a fixed,
   checkable number.
3. **Both drops ship, and Day is canonical.** Coral is a light theme first;
   Night is a full peer, not an afterthought, and the toggle persists.
4. **Press-down feedback** — `translateY(2px)`, 70ms, on `:active` for primary
   actions and the set-complete checkbox. Physical confirmation matters for a
   tap taken mid-set. Dropped under `prefers-reduced-motion`. Carried over from
   the Aurora build.

Aurora's *big tabular counters* deviation did **not** survive. `--text-counter`
still exists but is much smaller, and the counter role is now `--text-xl`: a
number that fills the screen is the dashboard reflex this redesign removes.

Functional status colours (`--color-positive`, `--color-caution`,
`--color-critical`) sit outside the one-accent rule. They appear only on small
surfaces and always alongside a glyph, never as colour alone.

## Fonts are self-hosted — do not switch to a CDN

The app ships a strict CSP (`default-src 'self'`, `style-src 'self'`) from
`app/server.mjs`. A Google Fonts `<link>` is blocked by it, and loosening the
policy would disclose every viewer's IP to a third party on a product handling
personal health information — a launch-blocking concern under CLAUDE.md §6.
Geist and Geist Mono are downloaded into `app/assets/fonts/` (latin +
latin-ext, 10 woff2 files, ~208 KB total, fetched per `unicode-range`) and
declared in [`app/fonts.css`](app/fonts.css). Both are SIL Open Font License 1.1.

For the same reason **no inline `style` attributes are allowed.** Data-driven
sizes ride on `data-w` / `data-h` and are applied through CSSOM by
`applyBarSizes()` in `app.js`.

## Where the system lives

| File | Role |
|---|---|
| [`app/tokens.css`](app/tokens.css) | The palette, type scale, spacing, radii, motion. Single source. |
| [`app/theme.css`](app/theme.css) | The Coral signature layer. Loads **last**, so it settles disagreements with `styles.css`. Was `aurora.css`. |
| [`app/styles.css`](app/styles.css) | Layout inherited from earlier builds. Dense and minified; edit surgically. |
| [`work/contrast-check.mjs`](work/contrast-check.mjs) | Computes every ratio this file claims, plus the brand/error distance. |
| [`work/accessibility-check.mjs`](work/accessibility-check.mjs) | Structural invariants, including the tab bar count per role. |

## Exports

### tokens.css

The live token set is [`app/tokens.css`](app/tokens.css) — the single source,
linked directly by `app/index.html`. Copy that file to port the system; the
mappings below are for other toolchains.

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:    oklch(99.4% 0.0025 23);
  --color-paper-2:  oklch(97.8% 0.006 23);
  --color-ink:      oklch(21.5% 0.022 23);
  --color-brand:    oklch(67.8% 0.172 23);   /* #ef6464 — marks and fills */
  --color-accent:   oklch(56.3% 0.192 23);   /* text, links, focus */
  --color-rule:     oklch(90.5% 0.009 23);
  --font-display:   "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-body:      "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono:      "Geist Mono", ui-monospace, monospace;
  --spacing-md:     1rem;
  --text-md:        1.0625rem;
  --ease-out:       cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":  { "$value": "oklch(99.4% 0.0025 23)", "$type": "color" },
    "ink":    { "$value": "oklch(21.5% 0.022 23)",  "$type": "color" },
    "brand":  { "$value": "oklch(67.8% 0.172 23)",  "$type": "color" },
    "accent": { "$value": "oklch(56.3% 0.192 23)",  "$type": "color" }
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
  --background:         99.4% 0.0025 23;
  --foreground:         21.5% 0.022  23;
  --primary:            56.3% 0.192  23;
  --primary-foreground: 100%  0      23;
  --muted:              95.8% 0.008  23;
  --muted-foreground:   47%   0.020  23;
  --border:             90.5% 0.009  23;
  --input:              90.5% 0.009  23;
  --ring:               56.3% 0.192  23;
  --radius:             10px;
}
```
