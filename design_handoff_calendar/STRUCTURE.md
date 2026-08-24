# Calendar structure contract

`club-sunday.css` is transcribed from `Club Sunday Console - Soft v4.dc.html`.
It only works against the DOM below. Two values it cannot compute must come
from the component.

## 1. Chip geometry — this is what was overlapping

```js
// week view
const ROW_H = 64, DAY_START = 540;   // 09:00
// day view
const ROW_H = 72, DAY_START = 540;

const GAP = 4;   // the visual gap between stacked chips — do not omit it

const top = ((startMinutes - DAY_START) / 60) * ROW_H;
const h   = (durationMinutes / 60) * ROW_H - GAP;

<button
  className={`cs-chip cs-chip--${family}`}
  style={{ '--top': top, '--h': h, '--lane': lane, '--lanes': lanes }}
>
```

Worked examples, verified against the design:

| View | Time | Duration | `--top` | `--h` |
| --- | --- | --- | --- | --- |
| Week | 10:00 | 60 min | 64 | 60 |
| Week | 12:00 | 90 min | 192 | 92 |
| Week | 10:30 | 120 min | 96 | 124 |
| Day | 09:00 | 60 min | 0 | 68 |
| Day | 09:30 | 75 min | 36 | 86 |
| Day | 13:30 | 105 min | 324 | 122 |

Dropping `GAP` makes every chip touch the one below it — the design has a
4px breath between them.

Unitless numbers — the stylesheet multiplies by 1px. A chip rendered without
`--top` falls to `top: 0` and every appointment in that column stacks in the
same rect. That is the overlap bug, every time.

`--lane` / `--lanes` handle concurrent bookings: group a column's appointments
into overlap clusters, `lanes = cluster.length`, `lane = index in cluster`.
Defaults are `0` / `1`; omit when nothing overlaps.

`.cs-hatch`, `.cs-slot` and `.cs-now` take the same `--top` / `--h`.

## 2. Provider count (day view)

```jsx
<div className="cs-board cs-board--day"
     style={{ '--provider-count': providers.length }}>
```

Add `cs-board--scroll` when `providers.length > 6` — that one grid then scrolls
horizontally with a sticky time gutter; the page still does not.

`.cs-board--day` also overrides `--cs-row-h: 72px`, `--cs-hours: 7`,
`--cs-gutter: 76px` and the roomier chip type. Do not set those yourself.

## 3. Week board markup

```html
<div class="cs-desk">
  <div class="cs-shell">

    <aside class="cs-sidebar">
      <div class="cs-brand">
        <div class="cs-brand__name">Club <em>Sunday</em></div>
        <div class="cs-brand__site">Studio One</div>
      </div>
      <nav class="cs-nav">
        <a class="cs-nav__item cs-nav__item--active"><svg …></svg><span class="cs-nav__label">Today</span></a>
        <a class="cs-nav__item"><svg …></svg><span class="cs-nav__label">Calendar</span></a>
      </nav>
      <div class="cs-minical">…</div>
      <div class="cs-legend">…</div>
    </aside>

    <main class="cs-main">
      <div class="cs-topbar">…</div>

      <div class="cs-toolbar">
        <div class="cs-toolbar__title-group">
          <div class="cs-range">24 – 30 August</div>
          <div class="cs-stepper">
            <button>‹</button><button class="cs-today">Today</button><button>›</button>
          </div>
        </div>
        <div class="cs-toolbar__controls">
          <button class="cs-select">
            <span class="cs-select__label">Availability for</span>
            <span class="cs-select__value">Any service</span>
            <span class="cs-select__caret">▾</span>
          </button>
          <div class="cs-viewswitch">
            <button>Day</button><button aria-pressed="true">Week</button>
          </div>
          <button class="cs-cta">New booking<span class="cs-cta__plus">+</span></button>
        </div>
      </div>

      <!-- exactly ONE board in the DOM -->
      <div class="cs-boardcard">
        <div class="cs-board">

          <div class="cs-board__head">
            <div></div>                                  <!-- gutter spacer -->
            <div class="cs-daylabel">                    <!-- ×7 -->
              <div class="cs-daylabel__dow">Mon</div>
              <div class="cs-daylabel__date">24</div>
            </div>
            <div class="cs-daylabel cs-daylabel--today">…</div>
          </div>

          <div class="cs-board__body">
            <div class="cs-gutter">
              <div class="cs-gutter__hour">09:00</div>    <!-- ×9 -->
            </div>

            <div class="cs-col">                          <!-- ×7 -->
              <button class="cs-chip cs-chip--facial" style="--top:64;--h:60">
                <span class="cs-chip__time">10:00</span>
                <span class="cs-chip__client">Ivy Chen</span>
                <span class="cs-chip__treatment">Sunday Glow</span>
              </button>
            </div>

            <div class="cs-col cs-col--today">
              <button class="cs-chip cs-chip--inprogress" style="--top:64;--h:92">
                <span class="cs-chip__live"><span></span><span>IN ROOM</span></span>
                <span class="cs-chip__client">Hana Ito</span>
                <span class="cs-chip__treatment">Microneedling</span>
              </button>
              <div class="cs-now" style="--top:141"></div>
            </div>

            <div class="cs-col cs-col--closed">
              <div class="cs-col__notice cs-col__notice--vertical">Studio closed</div>
            </div>
          </div>

        </div>
      </div>

      <div class="cs-boardfoot">
        <div class="cs-boardfoot__stats">
          <div class="cs-boardfoot__now">Now, 11:12</div>
          <div class="cs-boardfoot__meta">31 appointments this week · 4 open slots</div>
        </div>
        <div class="cs-boardfoot__cue">Click any empty slot to book →</div>
      </div>
    </main>

  </div>
</div>
```

Head and body are two grids sharing `--cs-cols`. Both need the same child
count: **1 gutter cell + 7 day cells**. A missing head spacer shifts every
column label by one.

Chip children are `<span>` — `.cs-chip` is `display:block`, the spans stack.

## 4. Day board differences

```html
<div class="cs-board cs-board--day" style="--provider-count:3">
  <div class="cs-board__head">
    <div></div>
    <div class="cs-provider">
      <span class="cs-provider__avatar" style="background:#DFEBE1"></span>
      <div>
        <div class="cs-provider__name">Amara O.</div>
        <div class="cs-provider__role">Lead therapist</div>
      </div>
    </div>
  </div>
  <div class="cs-board__body">
    <div class="cs-gutter">…7 hours…</div>
    <div class="cs-col">
      <button class="cs-chip cs-chip--facial" style="--top:0;--h:68">
        <span class="cs-chip__row">
          <span class="cs-chip__time">09:00 – 10:00</span>
          <span class="cs-chip__time">Paid</span>
        </span>
        <span class="cs-chip__client">Zoe Adeyemi</span>
        <span class="cs-chip__treatment">The Sunday Glow</span>
      </button>
      <div class="cs-hatch" style="--top:184;--h:32">Turnover 15 min</div>
      <button class="cs-slot" style="--top:360;--h:68">
        <span class="cs-slot__when">Open 14:00 – 15:00</span>
        <span class="cs-slot__cue">Click to book →</span>
      </button>
    </div>
  </div>
</div>
```

In-progress chip with progress bar:

```html
<button class="cs-chip cs-chip--inprogress" style="--top:72;--h:104">
  <span class="cs-chip__live"><span></span><span>IN ROOM · 18 MIN LEFT</span></span>
  <span class="cs-chip__client">Hana Ito</span>
  <span class="cs-chip__treatment">Microneedling + LED</span>
  <span class="cs-chip__bar"><i style="width:72%"></i></span>
</button>
```

Needs-attention chip: add `cs-chip--selected` and a `.cs-chip__flag`
(`!`) plus a `.cs-chip__badge` ("Intake unsigned").

## 5. Week ⇄ day switching

Mutually exclusive. Unmount the inactive board or `display: none` it — never
stack them, never absolutely position one over the other.

```js
console.assert(document.querySelectorAll('.cs-board').length === 1);
```

Two boards in the DOM is the "overlapping calendars" symptom.

## 6. Drawers

`.cs-scrim` + `.cs-drawer` render at the end of `<body>` via portal, never
inside `.cs-shell`. They are `position: fixed` and must not add document width.

Booking drawer = `.cs-drawer__inner` containing `.cs-drawer__head`, `.cs-seg`,
`.cs-input` + `.cs-choice` list, `.cs-tag` row, three `.cs-stat` cards,
a `.cs-panel--credit` with `.cs-toggle`, and `.cs-actions` with
`.cs-btn` + `.cs-btn--primary`.

Details drawer = `.cs-pill` kicker, `.cs-panel` time row with `.cs-btn--sm`
actions, `.cs-panel--tint` consent warning, client row + `.cs-note`,
`.cs-money` rows ending in `.cs-money--total`, `.cs-actions`.

## 7. Acceptance checks

`proof.html` in this folder is a working reference render of the week board,
the day board and every chip state, built only from the classes documented
here. Open it next to the app — if the app doesn't match it, the app's markup
has drifted from this contract. It is also the fastest way to check a change
to `club-sunday.css` before shipping it.

Nav labels must be wrapped in `<span class="cs-nav__label">` — the collapsed
sidebar below 1024px hides that span, and a bare text node cannot be hidden.

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```
true at 1280, 1440, 1728px.

```js
document.querySelectorAll('.cs-chip:not([style*="--top"])').length === 0
document.querySelectorAll('.cs-board').length === 1
```

No `opacity` on any element containing text. No `box-shadow` outside `.cs-menu`
and the `.cs-chip--selected` ring. `#E8896F` only on `.cs-now` and
`.cs-boardfoot__now`.
