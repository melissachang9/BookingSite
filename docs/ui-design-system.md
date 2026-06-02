# UI Design System

The visual language for the storefront and operator dashboard. Built to match the cinematic, warm, editorial vibe established in `mockups/preview.html`. Engineers should treat this file as the source of truth for color, type, spacing, and component recipes. The reference mockup at `mockups/preview.html` is the visual anchor — if a question isn't answered here, open that file and read the corresponding CSS rule.

---

## 1. Design Principles

1. **Warm, cinematic, editorial.** Deep espresso surfaces, cream cards floating in soft amber light. Think golden-hour lamplight on dark wood, not sterile SaaS dashboards.
2. **High contrast where it matters.** Body type sits at weight 400+ on cream surfaces. Interactive elements get strong fills so customers never guess "is this clickable?"
3. **Generous space, large radii.** Cards use `28px` radius, hero panels float with `60–80px` shadows. Resist filling whitespace.
4. **One accent at a time.** Amber is the single attention color. Avoid green/blue/red on storefront unless reserved for status semantics on the dashboard.
5. **Type is the brand.** Avenir Next, wide letter-spacing on labels (`.18–.30em`), restrained display weights. Headings should breathe.

---

## 2. Color Tokens

Drop these CSS custom properties at the root of every app (`apps/storefront/app/globals.css`, `apps/dashboard/src/styles.css`).

```css
:root {
  /* Core palette */
  --espresso:    #2a1d18; /* primary dark surface, CTA fills */
  --cocoa:       #4a3429; /* mid brown — labels, secondary text */
  --bronze:      #6b4a36; /* warm accent, ink-soft, category labels */
  --amber:       #c89968; /* attention color — active states, highlights */
  --amber-deep:  #a47744; /* amber border / hover */
  --cream:       #efe6d8; /* card surface, body text on dark */
  --ivory:       #f5efe2; /* lightest surface — primary booking card */
  --sand:        #d9c9b3; /* warm muted — date pills, secondary chips */
  --taupe:       #a8968f; /* neutral metadata */
  --taupe-soft:  #c6b9b2; /* borders, dividers */
  --charcoal:    #1a110e; /* deepest shadow tone, body background */

  /* Semantic aliases */
  --ink:         var(--espresso); /* default text on light */
  --ink-soft:    var(--bronze);   /* secondary text on light */
  --surface-dark:  var(--espresso);
  --surface-light: var(--cream);
  --surface-card:  var(--ivory);

  /* Radii */
  --r-sm:   10px;
  --r-md:   18px;
  --r-lg:   28px;
  --r-pill: 999px;

  /* Shadows (warm-tinted) */
  --shadow-sm: 0 1px 2px rgba(26,17,14,.22);
  --shadow-md: 0 14px 34px rgba(26,17,14,.42);
  --shadow-lg: 0 30px 80px rgba(26,17,14,.60);
}
```

### Usage rules

| Token | Use for | Do NOT use for |
| --- | --- | --- |
| `--espresso` | Page background, primary CTA fill (`Book now`, `Pay`), active date pill | Body text — too low contrast on cream |
| `--cocoa` / `--bronze` | Secondary text, image gradients, hover states | Large display headings |
| `--amber` | Active time slot, selected-state accent bar, single-focus highlight | Body text, large fills |
| `--cream` | Text on espresso, mid-tier card surface | Background of a card sitting on `--ivory` (no contrast) |
| `--ivory` | Top-most floating cards (booking card, drawer) | Page background |
| `--sand` | Inactive date pills, secondary chips, divider tints | Primary CTA |

### Status semantics (dashboard only)

```css
--status-ok:    #d4dcc4; /* confirmed / submitted */
--status-warn:  #d9c0a5; /* awaiting / pending */
--status-info:  var(--amber);
--status-error: #c0635a;
```

---

## 3. Typography

### Font stack

```css
font-family: "Avenir Next", "Avenir", "Nunito Sans", "Helvetica Neue", system-ui, sans-serif;
```

Load Avenir Next via the host's system font or self-host the variable family. Fall back to Nunito Sans as a free open-source proxy.

### Base

- `body { font-weight: 400; }` — never lighter than 400 on light surfaces.
- Antialiased: `-webkit-font-smoothing: antialiased;`
- Default body color on cream: `var(--ink)`. On dark surfaces: `var(--cream)`.

### Type scale

| Token | Size | Weight | Letter-spacing | Use |
| --- | --- | --- | --- | --- |
| `--t-display`  | `clamp(48px, 8vw, 96px)` | 300 | .18em | Hero headline only |
| `--t-h1`       | 44px | 400 | .04em | Page title |
| `--t-h2`       | 36px | 400 | .04em | Section heading |
| `--t-h3`       | 22px | 500 | .02em | Card heading, service name |
| `--t-body`     | 16px | 400 | normal | Default body |
| `--t-meta`     | 14px | 400 | normal | Subtext, service meta |
| `--t-label`    | 11px | 500 | .26em UPPERCASE | Section labels, eyebrows |
| `--t-micro`    | 10px | 500 | .22em UPPERCASE | Tiny chips, field labels |

### Rules

- Uppercase tracking labels (`.18–.30em`) are the editorial signature — use them on category eyebrows, button labels, and field captions.
- Headings never go below weight 300.
- Numbers (prices, dates) always weight 500.
- Italic is reserved for customer notes / quotes only.

---

## 4. Spacing & Layout

- Container max width: `1200px`, side padding `32px`.
- Section vertical rhythm: `80px` top/bottom.
- Card padding: `40px` (booking card), `22px` (drawer/list cards).
- Card-to-card gap inside a stack: `28px`.
- Grid gap on service rows: `28px` columns, `0` rows (use bottom borders instead).
- Floating cards always have a margin from the page edge (`32px`) — never edge-to-edge.

---

## 5. Surfaces & Layering

Three layers, always in this order:

1. **Page** — `--charcoal` or `--espresso`. Sets the cinematic mood.
2. **Light band** — `--cream` rounded panel (`.section--light`) with `margin: 0 32px; border-radius: 28px; padding: 80px 0;`. All customer-facing content (services, booking card, footer) lives inside one of these bands.
3. **Floating card** — `--ivory` with `var(--shadow-md)`. Booking card, drawer, dashboard panels.

> Never put dark text directly on the dark page background. If content needs to sit outside a light band, switch text to `--cream`.

---

## 6. Components

### 6.1 Pills / Buttons

```css
.pill {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 14px 26px;
  border-radius: var(--r-pill);
  font-size: 13px; font-weight: 500; letter-spacing: .18em; text-transform: uppercase;
  border: 0; cursor: pointer;
  transition: transform .2s ease, background .2s ease;
}
.pill:hover { transform: translateY(-1px); }

.pill-primary { background: var(--ivory); color: var(--espresso); }       /* on dark hero */
.pill-ghost   { background: transparent; color: var(--cream); border: 1px solid rgba(245,239,226,.45); }
.pill-dark    { background: var(--espresso); color: var(--cream); }       /* primary CTA on light */
```

**Hierarchy on a booking card**: primary action is `.pill-dark`. Secondary actions are text links or `.pill-ghost`.

### 6.2 Hero

```css
.hero {
  background:
    linear-gradient(180deg, rgba(26,17,14,.15) 0%, rgba(26,17,14,.85) 100%),
    radial-gradient(120% 80% at 25% 25%, #8a5a36 0%, #4a3429 45%, #1a110e 100%);
  border-radius: var(--r-lg);
  padding: 64px;
  color: var(--cream);
  box-shadow: var(--shadow-lg);
}
/* Amber lamplight glow */
.hero::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(45% 45% at 72% 30%, rgba(200,153,104,.28), transparent 70%),
    radial-gradient(30% 30% at 28% 65%, rgba(239,230,216,.10), transparent 70%);
}
```

### 6.3 Service list row

```css
.service {
  display: grid; grid-template-columns: 160px 1fr auto; gap: 28px; align-items: center;
  padding: 28px 0;
  border-bottom: 1px solid rgba(107,74,54,.22);
  color: var(--ink);
}
.service .img   { width: 160px; height: 110px; border-radius: var(--r-md);
                  background: linear-gradient(135deg, #8a5a36, var(--espresso)); }
.service .cat   { font: 500 11px/1 var(--font); letter-spacing: .28em; text-transform: uppercase; color: var(--bronze); }
.service .name  { font-weight: 500; font-size: 22px; margin: 6px 0; color: var(--ink); }
.service .meta  { font-weight: 400; font-size: 14px; color: var(--ink-soft); }
.service .price { font-weight: 500; font-size: 24px; color: var(--ink); }
```

### 6.4 Customer-facing date / time selector

```css
/* Date pills */
.date {
  min-width: 64px; padding: 12px 0; text-align: center;
  background: var(--sand);
  color: var(--ink);
  border: 1px solid rgba(107,74,54,.18);
  border-radius: var(--r-md);
  cursor: pointer;
}
.date .d { font-size: 18px; font-weight: 500; }
.date .w { font-size: 10px; font-weight: 500; letter-spacing: .2em; text-transform: uppercase;
           color: var(--bronze); margin-top: 4px; }
.date:hover  { background: #cbb89d; }
.date.active { background: var(--espresso); color: var(--cream);
               border-color: var(--amber);
               box-shadow: inset 0 -3px 0 var(--amber); }
.date.active .w { color: var(--amber); }

/* Time slots */
.time {
  padding: 14px; border-radius: var(--r-pill);
  background: var(--cream);
  border: 1px solid var(--amber-deep);
  color: var(--cocoa);
  font-size: 14px; font-weight: 500; letter-spacing: .08em; text-align: center;
  cursor: pointer;
}
.time:hover  { background: #f1dcbe; color: var(--espresso); }
.time.active { background: var(--amber); color: var(--espresso);
               border-color: var(--amber-deep); font-weight: 600; }
```

### 6.5 Booking card

```css
.booking-card {
  background: var(--ivory);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-md);
  padding: 40px;
  color: var(--ink);
}
.booking-card h3  { font-weight: 500; font-size: 22px; }
.booking-card .sub { font-weight: 400; font-size: 13px; color: var(--ink-soft); }
.booking-card .footer {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 28px; padding-top: 20px;
  border-top: 1px solid rgba(107,74,54,.25);
}
```

### 6.6 Operator calendar appointment blocks

Warm cream tints with cocoa text — visually distinct from customer-facing CTAs.

```css
.appt {
  position: absolute; left: 6px; right: 6px;
  border-radius: 12px; padding: 8px 10px;
  font-size: 11px; line-height: 1.3;
  border: 1px solid rgba(255,255,255,.5);
  box-shadow: var(--shadow-sm);
}
.appt .t { font: 500 9px/1 var(--font); letter-spacing: .18em; text-transform: uppercase; opacity: .8; }
.appt .n { font-weight: 500; font-size: 11px; }
.appt .s { font-size: 10px; opacity: .85; margin-top: 2px; }

.a-rose  { background: #e7d2c2; color: #4a3429; }
.a-sage  { background: #ddd0b8; color: #2a1d18; }
.a-gold  { background: #e8d6b8; color: #6b4a36; }
.a-blush { background: #d9c0a5; color: #4a3429; }
.a-block { background: repeating-linear-gradient(135deg, #d6c8b0 0 6px, #c4b298 6px 12px); color: #2a1d18; }
.a-active { outline: 2px solid var(--amber); }
```

### 6.7 Drawer / right rail (operator appointment details)

- Surface: `--ivory`, left border 1px `rgba(107,74,54,.35)`, padding 22px.
- Section heading: `.t-label` style.
- Field rows: 80px label column / value / action; bottom dashed divider `rgba(107,74,54,.3)`.
- Status chip background: cream/sand pill with cocoa text; amber dot for active.

### 6.8 Form status chips

```css
.st-ok   { background: #d4dcc4; color: var(--cocoa); }
.st-wait { background: #d9c0a5; color: var(--bronze); }
.st-error{ background: #f0c7c1; color: #6a2a22; }
```

---

## 7. Iconography & Imagery

- Line icons, 1.5px stroke, rounded caps. Color inherits from text.
- Photography: warm-toned, natural light, shallow depth-of-field. Avoid cold/blue casts.
- Service swatch placeholders use warm gradients only (`bronze→espresso`, `amber→cocoa`, `taupe→espresso`).

---

## 8. Motion

- Easing: `cubic-bezier(.2,.7,.2,1)` for entrances, `ease` for hover.
- Hover lift on pills: `translateY(-1px)`, 200ms.
- Drawer slide-in: 240ms `cubic-bezier(.2,.7,.2,1)`, opacity + 12px X offset.
- Avoid bounce, avoid color-shifting transitions longer than 250ms.

---

## 9. Accessibility

- Minimum contrast: `--ink` on `--ivory` = 11.4:1 ✓, `--ink-soft` on `--cream` = 5.6:1 ✓, `--cream` on `--espresso` = 12.1:1 ✓.
- Active-state amber on espresso: amber `#C89968` on espresso `#2A1D18` = 6.2:1 ✓ — safe for label text but never thinner than weight 500.
- Focus ring: `outline: 2px solid var(--amber); outline-offset: 2px;`. Do not remove for mouse users.
- Tap targets ≥ 44px on touch (the date pill at 64×60 and time pill at 14px padding both pass).

---

## 10. Implementation Notes

- **Token source**: define tokens once in `packages/ui-components/src/tokens.css` and import from both apps. Do not redefine palette in component files.
- **No tailwind palette overrides**: this system uses raw CSS variables and CSS modules. If introducing Tailwind, map these tokens to the theme — do not invent parallel color names.
- **Reference mockup**: when uncertain about a recipe, open `mockups/preview.html` in a browser and inspect the rule. The mockup IS the spec.
- **Drift control**: PRs that introduce new colors, fonts, or radii must update this file. Reject one-off hex values in component CSS.

---

## 11. Quick Reference Card

```
Surfaces:     espresso → cream → ivory  (dark → light → lightest)
Text on dark: cream
Text on cream: ink (espresso), ink-soft (bronze)
Primary CTA:  espresso pill, cream text
Active slot:  amber pill, espresso text
Active date:  espresso pill, cream text, amber underline accent
Eyebrow:      11px / 500 / .26em uppercase / bronze
Heading:      400–500, generous tracking, never below 300
Body:         400 minimum
```
