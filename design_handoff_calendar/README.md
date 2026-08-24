# Handoff: Operator Calendar (Club Sunday console)

## Overview

A visual redesign of the operator-facing calendar in `apps/dashboard` — week view, day view, and the two drawers the calendar opens (book-from-slot, appointment details), plus the staff/service filter menus. The IA and workflow rules are unchanged from the existing `calendar-page.tsx`; this is a new visual language, not new functionality.

## About the design files

`Club Sunday Console - Soft v4.dc.html` in this bundle is a **design reference written in HTML** — a prototype showing intended look and behaviour. It is **not production code to copy**.

The task is to **recreate these designs inside the existing dashboard app**: React 18 + Vite + TypeScript, routed with `react-router-dom`, styled with vanilla CSS / CSS Modules per `apps/dashboard/AGENTS.md`. Keep business logic in the backend APIs and typed contracts in `packages/shared-types`; only the presentation layer changes.

The prototype uses inline styles because of how it was authored. **Do not port inline styles.** Translate them into the app's CSS conventions — extend `apps/dashboard/src/styles.css` (or add CSS Modules) and put the tokens below in `packages/ui-components/src/tokens.css` so the storefront can share them later.

Note: `docs/ui-design-system.md` §0 currently specifies a light-mint + amber dashboard palette. This design supersedes it. Update that doc as part of the change, per its own drift-control rule.

## Fidelity

**High fidelity.** Colours, type, spacing, radii and states below are final. Recreate pixel-accurately using the app's own patterns.

## How to read the prototype

Open the HTML file in a browser. It is a design canvas — scroll horizontally. Options are labelled with a badge in the top-left of each frame:

| Badge | Screen |
| --- | --- |
| 2a | Week view (default landing screen) |
| 2e | Staff filter and "Availability for" menus, open |
| 2b | Day view (board only) |
| 2c | Empty slot → book from calendar context |
| 2d | Appointment → details drawer |

Frames below these (1a–1d) are earlier explorations of other screens — out of scope for this handoff.

---

## Design tokens

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#14110F` | Primary text, primary button fill, "in progress" appointment fill |
| `--ink-secondary` | `rgba(20,17,15,.62)` | Chip times and treatment names, block-chip text, secondary body copy |
| `--label` | `#6E6862` | Uppercase micro-labels, time-gutter hours, carets, counts |
| `--ground` | `#E9E6E3` | Desk background behind the app shell |
| `--surface` | `#FFFFFF` | Cards, sidebar, board |
| `--canvas` | `#FBFAF9` | Main content area behind the cards |
| `--hairline` | `rgba(20,17,15,.07)` | Dividers, hour rules |
| `--peach` | `#F6DFCE` | Active nav item, today in the month rail, accents |
| `--mint` | `#DFEBE1` | Treatment family: Facials |
| `--lilac` | `#E8E3F5` | Treatment family: Advanced / needling |
| `--pink` | `#F7E0E4` | Treatment family: Laser & peels; also alert badges |
| `--blue` | `#DEE7F3` | Treatment family: Consults |
| `--grey` | `#F0EDEA` | Checked out / completed |
| `--block` | `#EDEAE6` | Time blocks, lunch, cancelled hatch base |
| `--now` | `#E8896F` | Current-time indicator only |

All text colours above clear WCAG AA (≥4.5:1) on every ground they appear on. Do not lighten them.

### Type

`Plus Jakarta Sans` 400/500/600/700/800 (Google Fonts) for everything. `Instrument Serif` italic is used for one word in the brand mark only.

| Role | Spec |
| --- | --- |
| Page title | 800 24px, letter-spacing −.035em |
| Card title | 700 15px, −.02em |
| Body | 500 12–13px |
| Chip client name | 600 12px |
| Chip time / meta | 700 10px / 500 10px |
| Micro-label | 700 10px, letter-spacing .10–.14em, uppercase, `--label` |
| Day number | 700 19px, −.03em |

### Geometry

- Radii: `36px` desk shell · `28px` app panel and drawers · `24px` cards · `20px` inner panels · `16px` day-view chips · `14px` week-view chips and nav items · `999px` all buttons, pills and inputs.
- No shadows except menus: `0 12px 40px rgba(20,17,15,.14)`.
- Sidebar width `244px`. Main padding `22px 24px 24px`. Card gap `16px`.
- `box-sizing: border-box` globally.

---

## Screens

### 2a — Week view (default)

Two-column shell: `grid-template-columns: 244px 1fr`, white, radius 28, sitting on the `--ground` desk with 18px inset.

**Sidebar** (`244px`, `border-right: 1px solid var(--hairline)`, padding `26px 18px`, 22px gap)

1. Brand block — "Club *Sunday*" 800 19px with the second word in Instrument Serif italic 23px; "STUDIO ONE" micro-label under it.
2. Month rail — `--canvas` fill, radius 20, padding `16px 14px`. Header row: "August 2026" 700 13px + two 22px circular ‹ › buttons. Then a `repeat(7,1fr)` grid, 2px gap, centred: weekday initials at 600 10px `--label`, then date cells at 500 11px. Out-of-month dates at `rgba(20,17,15,.22)`. **The displayed week is filled `--peach`** with 8px radius on the row's outer corners, and **today is a black pill** (`--ink`, white text, 8px radius). Week starts Monday in this build; the real app is Sunday-first — follow the app.
3. Nav — 4px gap. Each row: `display:flex; gap:12px; padding:12px 14px; border-radius:14px`. Active row `background: var(--peach)`, 600 13px. Inactive 500 13px at `rgba(20,17,15,.6)`, hover `background:#F5F3F1; color: var(--ink)`. Each row leads with an **18×18 inline SVG icon, 1.5px stroke, round caps, `stroke="currentColor"`** so it inherits the row's text colour. Items: Calendar, Clients, Treatments, Team, Forms (badge 4), Payments (badge 2), Settings. Badges: 700 10px on `--pink`, radius 999, padding `3px 8px`.
4. Legend (bottom, `margin-top:auto`) — "Treatment families" micro-label, then a swatch + name per family: 10px rounded square in the family colour, label 500 11px.

**Main** (`--canvas`, `padding: 22px 24px 24px`, 16px gap, `min-width:0`)

Toolbar — one flex row, `justify-content: space-between`:

- Left: title 800 24px ("24 – 30 August"), then a 6px-gap group of ‹ (32px circle), "Today" pill (`padding:8px 16px`, 600 12px), › (32px circle). All white on the canvas, hover `#F0EDEA`.
- Right: 10px-gap row of four controls, all 37–39px tall so they align:
  1. **Availability-for select** — white pill, `padding:11px 16px 11px 20px`, containing the micro-label "AVAILABILITY FOR", the value "Any service" at 600 12px, and a ▾ at 10px `--label`.
  2. **Staff select** — white pill with "All staff" 600 12px, the count "13" at 500 11px `--label`, and a ▾.
  3. **Day / Week toggle** — white pill container `padding:5px`; each option `padding:8px 18px; border-radius:999px`. Selected option is `--ink` with white text; the other is `rgba(20,17,15,.55)`.
  4. **New booking** — `--ink` pill, white 600 12px, `padding:10px 10px 10px 20px`, with a 24px circle `rgba(255,255,255,.16)` holding a `+`. Hover `#2E2825`.

Board — white card, radius 24, `padding: 6px 14px 14px`. Two sibling grids, both `grid-template-columns: 88px repeat(7, minmax(0,1fr))`:

- Header grid, `align-items:end`. Empty first cell, then per day: weekday abbreviation 600 10px `--label` uppercase, day number 700 19px. **Today's number is a 34px black circle** with white text. Non-trading days at `opacity:.4`.
- Body grid, `border-top: 1px solid var(--hairline)`, `padding-top:6px`.
  - Time gutter: nine 64px rows, right-aligned, `padding-right:14px`, 600 11px `--label`, labelled 09:00–17:00.
  - Day columns: `position:relative; height:576px; padding:0 3px`, hour rules drawn with `repeating-linear-gradient(to bottom, transparent 0 63px, var(--hairline) 63px 64px)`. Columns 2–7 add `border-left: 1px solid rgba(20,17,15,.05)`. A non-trading column gets a `#F7F5F3` fill and a rotated "Studio closed" caption.

Appointment chip — absolutely positioned, `left:3px; right:3px`, `top = (startMinutes − 540) / 60 × 64`, `height = durationMinutes / 60 × 64`, radius 14, `padding: 8px 10px`. Content: start time 700 10px `--ink-secondary`, client name 600 12px `--ink`, treatment 500 10px `--ink-secondary`. Hover `filter: brightness(.97)`.

Chip state overrides (status wins over treatment colour, and every state is also labelled in text — never colour alone):

| State | Treatment |
| --- | --- |
| Booked | Fill = treatment family colour |
| In progress / checked in | Fill `--ink`; a 5px `--peach` dot + "IN ROOM" at 700 10px `--peach`; client name white, meta `rgba(255,255,255,.6)` |
| Checked out / completed | Fill `--grey`, all text `--ink-secondary` |
| Cancelled / no-show | `repeating-linear-gradient(135deg,#EDEAE6 0 5px,#DDD8D2 5px 10px)`, client name `line-through` |
| Needs attention | 18px `--ink` circle with a white `!`, top-right; plus a white-on-fill pill for the reason ("Intake unsigned", "$95 due") |
| Selected | `box-shadow: 0 0 0 2px var(--ink)` |
| Time block / lunch | Fill `--block`, or a 135° hatch of `rgba(20,17,15,.04)` / `rgba(20,17,15,.08)` |
| Open slot | `1.5px dashed rgba(20,17,15,.2)`, no fill; hover `border-color: var(--ink)` |

Current-time indicator — a 2px `--now` bar across today's column at the same top calculation, with an 8px `--now` circle at its left edge.

Footer — one row under the board: an 8px `--now` dot + "Now, 11:12", the day summary at 500 11px `--label`, and "Click any empty slot to book →" at 600 12px right-aligned.

### 2e — Filter menus, open

Menu panel: white, radius 20, `padding:8px`, `box-shadow: 0 12px 40px rgba(20,17,15,.14)`, anchored under its trigger; the trigger flips to `--ink` fill with a ▴ while open.

- **Staff** — a multi-select. Row: 18px checkbox (radius 6; checked = `--ink` fill with a white ✓; unchecked = `1.5px solid rgba(20,17,15,.2)`), a 24px avatar circle in the person's colour, the name at 500 12px, and today's count right-aligned at 500 11px `--label`. Rows are `padding:10px 12px; border-radius:14px`, hover `#F5F3F1`; the selected row keeps `#F5F3F1`. "All staff" sits at the top without an avatar; a hairline separates "Unassigned & blocks" at the bottom.
- **Availability for** — single-select. Same row geometry; each service leads with a 9px rounded square in its treatment-family colour and ends with its duration at 500 11px `--label`. "Any service" is the default at the top.

### 2b — Day view (board only)

Same board card, but `grid-template-columns: 76px repeat(N, minmax(0,1fr))` where N is the number of visible providers, and the hour height is **72px** (`height: 504px` for 09:00–16:00).

Column headers are the provider: 32px avatar circle in their colour, name 700 13px, role 500 10px `--label`.

Chips are taller so they carry more: time range and a status word on one line at 700 10px, client name 700 14px, treatment 500 11px, then an optional pill. The in-progress chip adds a progress bar — 5px track `rgba(255,255,255,.16)` with a `--peach` fill at elapsed/total. Open slots render as a dashed 16px-radius box reading "Open 14:00 – 15:00" with "Click to book →".

### 2c — Book from slot

Drawer, 440px, white, radius 28, `padding: 24px 24px 22px`, 18px gap. Opens from clicking an empty slot; the slot's date, time, provider and room are the header — booking always starts from calendar context.

1. Header — "NEW BOOKING" micro-label, "Wed 26 Aug · 14:00" 800 21px, then "Priya R. · Room 3 · slot held 9:52" 500 12px `--label`. 32px circular close button top-right.
2. Segmented control — `#F5F3F1` pill, `padding:4px`; "Appointment" (selected, `--ink`) / "Time block".
3. Client — a search input (white pill) and a results list. Each result: 34px avatar, name 600 13px, meta 500 11px. The highlighted result is filled `--peach`. Last row is "New client" with a dashed 34px circle and a `+`.
4. Treatment — a wrapping row of pills; the selected one is filled with its treatment-family colour, the rest `#F5F3F1`; last pill is "Browse all ›". Below, three read-outs on `--canvas` radius-16 tiles: Duration, Ends, Price.
5. Member credit — a `--mint` panel, radius 20, with a 44×26 toggle (`--ink` when on, 20px white knob).
6. Notes — `--canvas` panel, radius 18, min-height 64px, placeholder "Add context for this client or appointment." (verbatim from the current app).
7. Footer — "Cancel" on `#F5F3F1`, then a full-width `--ink` "Book & send confirmation".

### 2d — Appointment details

Drawer, 440px, same shell.

1. Header — treatment-family pill ("Laser & peels") in the family colour, client name 800 22px, then "treatment · provider · room" 500 12px `--label`.
2. When — `--canvas` panel: "TODAY" micro-label and "13:00 – 14:30" 700 18px on the left; "Reschedule" and "Check in" white pills on the right.
3. Blocking alert — `--pink` panel, radius 20. 18px `--ink` circle with `!`, headline 700 13px, explanation 500 12px, then "Review form" (`--ink`) and "Resend link" (white). Show only when a required form is unsigned or flagged.
4. Client — 44px avatar tile radius 16, name 600 14px, meta 500 11px, "Profile" pill. Below it, staff-only notes in a `--canvas` panel, italic.
5. Payment — line items 500 13px with amounts 600; credits in `#5E8F6E`; a hairline, then "Due at checkout" with the amount at 800 22px.
6. Footer — "Cancel" muted, then `--ink` "Complete & check out".

---

## Interactions

- Clicking an **empty slot** opens 2c pre-filled with that slot's date, time and provider, and holds the slot (countdown shown in the header). Never offer a booking entry point that has no time context.
- Clicking an **appointment** opens 2d; the chip takes the 2px `--ink` selected ring.
- **Complete & check out** leads to the checkout step, which must make the payment outcome explicit — collect later, cash, external POS, member credit, already paid, or none due — and must block underpayment when a balance is due on external POS.
- Completion offers a **rebook** path back into calendar context.
- **Day/Week** toggle and the date stepper both re-fetch availability. Week is the default.
- **Staff** filter is multi-select and shows/hides columns in day view, chips in week view. **Availability for** filters the grid to slots that can actually take the chosen service.
- Hover: chips `brightness(.97)`; pills and menu rows to `#F5F3F1`; `--ink` buttons to `#2E2825`.
- Focus: give every control a visible focus ring — `outline: 2px solid var(--ink); outline-offset: 2px`. The prototype does not show this; it is required.
- Transitions: 150–200ms ease on background and filter only. No movement on hover.

## State

Reuse what `calendar-page.tsx` already holds — `viewMode` (`"day" | "week"`), `focusedDate`, provider filter, calendar fetch state, the slot-action drawer, the appointment-details drawer, and the checkout panel. New state needed: the service filter ("availability for"), and open/closed for the two toolbar menus.

Empty, loading and error states are not drawn in the prototype. Keep the app's current handling; style the containers with the tokens above.

## Assets

Fonts are Google Fonts (`Plus Jakarta Sans`, `Instrument Serif`) — self-host or import per the app's convention. All icons are inline SVG defined in the prototype's sidebar; lift the paths directly, or swap for the app's icon library at the same 18px / 1.5px stroke / `currentColor` spec. No images.

## Files

- `Club Sunday Console - Soft v4.dc.html` — the design reference (open in a browser, scroll horizontally).

Target files in the repo:

- `apps/dashboard/src/calendar-page.tsx` — week/day board, drawers, checkout panel
- `apps/dashboard/src/App.tsx` — sidebar, month rail slot, top bar
- `apps/dashboard/src/styles.css` — `.schedule-board__*`, `.appointment-details-drawer*`, `.slot-action-*`, `.view-mode-toggle*`, `.month-rail`
- `packages/ui-components/src/tokens.css` — token definitions
- `docs/ui-design-system.md` — update §0 to this palette
