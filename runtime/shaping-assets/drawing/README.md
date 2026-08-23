# ShapingDrawing

The drawing library for shaping documents. It renders lo-fi, hand-drawn SVG in the style of the
sketches in _Shape Up_ — breadboards, fat marker sketches, and marker drawing over a screenshot.

The hand-drawn look is the point. When a reader can see a drawing was made by hand, they know it is
not a finished design and they give feedback on the idea instead of the pixels. Nothing here should
ever be made to look neat.

## Loading it

A document at `shaping/<project-title>/index.html` loads the library with two plain tags:

```html
<link rel="stylesheet" href="../assets/drawing/drawing.css">
<script src="../assets/drawing/shaping-drawing.js"></script>
```

No modules, no build step, no bundler, no network at render time. The script defines one global,
`ShapingDrawing`. The stylesheet declares the handwriting face and the callout list styles.

## The seed contract

**Every drawing takes an explicit seed, and the same calls with the same seed produce byte-identical
SVG.** `sketch()`, `breadboard()` and `annotate()` all throw if you leave the seed out.

- Randomness is derived per call: call _n_ of a sketch draws from a stream seeded with
  `<sketch seed>/call-<n>`. Adding a call at the end never disturbs the calls before it.
- Pass `seed:` on an individual call to pin that shape's stream by name instead of by position, so it
  keeps its exact wobble even when you insert a call above it. Component internals do this already.
- Coordinates are rounded to two decimals on the way out, which keeps output stable across
  JavaScript engines as well as across renders.
- Seeds are strings or numbers. Use something readable and stable: `'autopay-breadboard'`, not
  `Date.now()`. A seed that changes on every load throws the guarantee away.

Verify with `node scripts/check_drawing_determinism.mjs`, which builds every scene in `demo.js` twice
and byte-compares the SVG.

## Colours

Three CSS custom properties, resolved at render time in the browser:

| Property | Default | What it is |
| --- | --- | --- |
| `--shaping-ink` | `CanvasText` | The main marker colour |
| `--shaping-accent` | `#d93a2b` | The one accent — revisions, call-outs, emphasis |
| `--shaping-paper` | `Canvas` | The background the ink sits on, used for numerals inside filled callouts |

Ink and paper follow the page's own canvas rather than the operating system's colour scheme, so a
light document on a dark-mode machine still gets black marker on white paper. Override any of the
three in the document's own CSS to theme the drawings.

In the API, `color: 'ink'`, `color: 'accent'` and `color: 'paper'` resolve to those properties. Any
other value is passed through as a CSS colour. **Two colours is the whole palette** — the fat marker
convention is one ink plus one accent, and a drawing with more colours stops reading as a sketch.

## Narrow screens

A drawing fills its column, and scales down with it, until it would get too small to read. Past that
it scrolls sideways instead of shrinking, so a breadboard on a phone stays legible rather than
becoming an unreadable smudge.

The scroll floor is absolute — `min(natural width, 34rem)` — so a phone shows roughly the left
540px of any drawing at whatever scale that implies. Keep a drawing's natural width near 900 units
and put its point on the left side; a 1,300-unit breadboard renders its handwriting at ~9px on a
phone, which no scroll can save.

That needs a scrolling parent. `figure()` gives you one. If you mount a drawing on its own, mount it
into an element with the class `shaping-drawing-frame`:

```html
<div class="shaping-drawing-frame" id="solution"></div>
```

Every drawing carries its natural width as `--shaping-natural-width` on the `<svg>`, which is what
stops a small drawing being blown up to the scroll threshold. Set `--shaping-natural-width` yourself
only if you know better than the drawing does.

## `ShapingDrawing.sketch(options) → Sketch`

The canvas everything is drawn on.

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | — | **Required.** String or number. |
| `width`, `height` | `900`, `400` | The viewBox, in user units. |
| `style` | `'ink'` | `'ink'` for pen-weight lines, `'marker'` for fat marker. Per-call `style:` overrides it. |
| `ink`, `accent`, `paper` | the CSS properties above | Override the palette for this sketch only. |
| `label` | `''` | Becomes `<title>` and `aria-label`. Write it — a drawing with no label is unreadable to a screen reader. |
| `class` | `''` | Extra classes on the `<svg>`, added after `shaping-drawing`. |

Output:

- `sketch.toSVG()` → the SVG as a string. Works in Node.
- `sketch.toHTML()` → the same string. Every drawable in this library has `toHTML()`.
- `sketch.toElement()` → a parsed `SVGElement`. Browser only.
- `sketch.mount(target)` → parses and appends; `target` is an element or a CSS selector. Returns the
  appended node.

### Stroke options

Every primitive takes these. Defaults come from the sketch's `style` unless the call overrides it.

| Option | `ink` | `marker` | Meaning |
| --- | --- | --- | --- |
| `color` | `'ink'` | `'ink'` | `'ink'`, `'accent'`, `'paper'`, or a CSS colour. |
| `width` | `2.6` | `9` | Stroke width in user units. |
| `roughness` | `1` | `1.15` | How much the line wobbles off course. `0.25` is a steady hand, `2.5` a shaky one. |
| `bowing` | `1` | `1.15` | How much each straight run bows. Each side of a box bows on its own. |
| `pressure` | `0.16` | `0.3` | How much the nib width breathes along the stroke. `0` gives a plain constant-width path. |
| `taper` | `0.3` | `0.16` | How much the stroke thins at its two ends. |
| `passes` | `1` | `1` | Draw the shape this many times. `2` is the classic sketchy double-stroke overdraw. |
| `overshoot` | `1` | `1` | On closed shapes, how far the pen runs past where it started. `0` closes cleanly. |
| `opacity` | — | — | Passed through. |
| `seed` | — | — | Pin this call's randomness by name. |
| `class` | — | — | Extra class on the emitted `<path>`. |

### Fill options

Pass `fill:` to fill a closed shape. Fills are drawn before the outline.

| Option | Default | Meaning |
| --- | --- | --- |
| `fill` | — | `'ink'`, `'accent'`, `'paper'`, or a CSS colour. Presence of this key turns filling on. |
| `fillStyle` | `'hachure'` | `'hachure'`, `'cross-hatch'`, `'zigzag'`, `'dots'`, `'solid'`, `'none'`. |
| `fillGap` | `9` | Distance between hachure lines. |
| `fillAngle` | `-41` | Hachure angle in degrees. |
| `fillWeight` | `1.5` | Hachure line width. |
| `fillRoughness` | `1.1` | Roughness of the hachure lines. |
| `fillOpacity` | — | Passed through. |

Sub-paths are filled even-odd, so a shape with a hole in it fills as a shape with a hole in it.

### Primitives

```js
const sketch = ShapingDrawing.sketch({ seed: 'elements', width: 640, height: 300 })

sketch.line(x1, y1, x2, y2, options)
sketch.polyline([[x, y], …], options)              // open
sketch.polygon([[x, y], …], options)               // closed, with a pen overshoot at the start
sketch.rect(x, y, width, height, options)
sketch.ellipse(cx, cy, rx, ry, options)
sketch.circle(cx, cy, radius, options)
sketch.path('M … C … A … Z', options)              // any SVG path data
sketch.squiggle(x, y, length, options)             // the zigzag that stands in for a line of text
sketch.brace(x, top, bottom, options)              // a curly brace
sketch.arrow(from, to, options)                    // a curved connection with a head
sketch.callout(number, cx, cy, options)            // a filled circle with a numeral in it
sketch.image(href, x, y, width, height, options)   // a raster or data URI behind the drawing
sketch.text(content, x, y, options)                // handwriting; returns a box, not the sketch
```

`path()` accepts the full grammar — `M L H V C S Q T A Z`, absolute and relative, multiple
sub-paths. Curves and arcs are flattened, roughened, and redrawn; the engine roughens whatever
geometry you hand it, so anything you can express as a path you can draw by hand.

Extra options:

- `squiggle`: `wavelength` (`17`), `amplitude` (`7`).
- `brace`: `reach` (`16`) — how far the point sticks out; `facing` (`'right'`) or `'left'`.
- `arrow`: `curve` (`'s'`, `'arc'`, `'straight'`), `bow` (`0.45`), `headSize` (`14` ink / `22`
  marker), `head: false` to leave the head off, `controls: [[x, y], [x, y]]` to place the two cubic
  control points yourself. The head always aligns with the curve's real arrival tangent.
- `callout`: `radius` (`19`), `color` (`'ink'`), `numberColor` (`'paper'`).

Everything except `text()` returns the sketch, so calls chain.

### `text(content, x, y, options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `size` | `22` | Font size in user units. |
| `weight` | `400` | `400`–`800`. Metrics are baked at 400, 500, 600, 700 and 800; anything else snaps to the nearest. |
| `caps` | `false` | Upper-case the content. Breadboards are all caps. |
| `align` | `'start'` | `'start'`, `'middle'`, `'end'` — `x` is the anchor. |
| `baseline` | `'alphabetic'` | `'alphabetic'`, `'top'` (`y` is the cap top), `'middle'` (`y` is the block's middle). |
| `letterSpacing` | `0.045` | In em. |
| `lineHeight` | `1.35` | In em. A `\n` in the content starts a new line. |
| `underline` | `false` | `true`, or `{ pad, drop, width, color, roughness, bowing }`. |
| `strike` | `false` | `true`, or `{ width, color }`. Defaults to the accent colour. |
| `color`, `opacity`, `class`, `seed` | — | As elsewhere. |

It returns the laid-out box rather than the sketch, so you can position things against it:

```js
const heading = sketch.text('Set up Autopay', 40, 60, { size: 30, caps: true, underline: true })
sketch.arrow([heading.x + heading.width + 12, heading.baseline], [400, 120])
// → { x, y, width, height, baseline, capHeight, lines, underlineY? }
```

Widths come from an advance-width table baked into the library from the vendored font, so a label
measures the same in Node as in a browser and an underline always fits its word. Kerning is switched
off in both the measurement and the rendered text so the two agree exactly.

## `ShapingDrawing.breadboard(spec) → Sketch`

Chapter 4's notation and nothing else: **places** written as underlined names, **affordances** listed
beneath the place they are found at, and **connection lines** from an affordance to the place it
takes you to. Words for everything — never a picture of a UI.

```js
const board = ShapingDrawing.breadboard({
  seed: 'autopay-breadboard',
  places: [
    { name: 'Invoice', affordances: [{ text: 'Turn on Autopay', struck: true }, { text: 'Pay', accent: true }] },
    { name: 'Pay Invoice', accent: true, affordances: ['CC fields', 'ACH fields', 'Submit'] },
    { name: 'Confirm', affordances: ['Print receipt', 'Thank you message'] }
  ],
  connections: [
    { from: 'Invoice/Pay', to: 'Pay Invoice', accent: true },
    { from: 'Pay Invoice/Submit', to: 'Confirm' }
  ]
})
board.mount('#solution')
```

- **Places** are laid out left to right in the order given, all on one baseline. `accent: true`
  colours the name and its rule; `dy` nudges one place down.
- **Affordances** are strings, or `{ text, accent, struck }`. `struck: true` draws the cross-out you
  use when the breadboard has moved on from an idea.
- **Connections** are `{ from, to }`. `from` is `'Place/Affordance'` or `[placeIndex,
  affordanceIndex]`; `to` is a place name or index. `accent: true` colours the line, `controls` lets
  you route it by hand. Lines are routed clear of the column they leave, so they never cross the
  affordances above them.
- Layout knobs, all optional: `nameSize` (`26`), `nameWeight` (`500`), `affordanceSize` (`21`),
  `affordanceWeight` (`400`), `columnGap` (`108`), `rowGap` (`1.62`, in affordance sizes), `padding`
  (`26`), `indent` (`0.7`, in name sizes). `width` and `height` are computed from the content unless
  you give them.
- `ink`, `accent`, `paper`, `label`, `class` behave as on `sketch()`.

The return value is a plain `Sketch`, so you can keep drawing on it — an extra note, a question mark,
a circle around the part under debate.

## Fat marker sketches

There is no `fatMarker()` function, because a fat marker sketch is just the sketch with the nib
turned up. The three conventions:

1. **`style: 'marker'`** on the sketch (or `style: 'marker'` on a call) — thick strokes with real
   pressure variation and nib-shaped ends, broad enough that detail is impossible.
2. **Two colours** — `color: 'ink'` for the material parts of the drawing, `color: 'accent'` for the
   labels and marks that talk _about_ the drawing.
3. **`callout(n, x, y)`** — the hand-drawn circled numeral. Pair it with `figure()` so a numbered
   list underneath explains each one.

```js
const sketch = ShapingDrawing.sketch({ seed: 'todo-groups', width: 900, height: 470, style: 'marker' })
sketch.squiggle(150, 60, 300, { amplitude: 9, width: 11 })   // the list's name
sketch.rect(150, 90, 34, 34, { width: 7 })                   // a checkbox
sketch.squiggle(210, 107, 190, { width: 7 })                 // the item's words
sketch.brace(640, 88, 196, { reach: 22, width: 7 })
sketch.text('Loose', 690, 142, { size: 34, weight: 700, caps: true, baseline: 'middle' })
sketch.callout(1, 74, 140, { radius: 24 })

ShapingDrawing.figure({
  drawing: sketch,
  callouts: ['Items above the first divider stay loose.'],
  caption: 'Two kinds of item in one list'
}).mount('#solution')
```

## `ShapingDrawing.figure(options) → Figure`

Wraps a drawing in a `<figure>` with an optional numbered list and caption. The list's markers are
styled to match `callout()`, so item _n_ reads as the explanation of circle _n_.

| Option | Meaning |
| --- | --- |
| `drawing` | Any sketch. |
| `callouts` | Array of strings, one per numbered circle, in order. |
| `caption` | A `<figcaption>` under the list. |
| `class` | Extra classes on the `<figure>`. |

`figure.toHTML()`, `figure.toElement()` and `figure.mount(target)` mirror the sketch API.

## `ShapingDrawing.annotate(spec) → Sketch`

Chapter 6's move: fat marker drawing over a real screenshot, so a reader can see where a new thing
goes without you having to draw the whole screen. Marks are placed in the screenshot's own pixel
coordinates.

```js
ShapingDrawing.annotate({
  seed: 'dashboard-annotation',
  src: 'shot.png',              // any URL the document can reach, or a data URI
  width: 880, height: 470,      // required: the image's pixel size
  alt: 'The dashboard with the new panel drawn on it',
  marks: [
    { type: 'box', x: 214, y: 74, width: 636, height: 162 },
    { type: 'label', text: 'Payment form preview\nand links go here', x: 532, y: 104, size: 34, align: 'middle' },
    { type: 'arrow', from: [330, 306], to: [246, 244] },
    { type: 'circle', cx: 92, cy: 118, rx: 80, ry: 32 },
    { type: 'callout', number: 1, cx: 92, cy: 194 }
  ]
}).mount('#solution')
```

Mark types and their own keys:

| `type` | Keys |
| --- | --- |
| `box` | `x`, `y`, `width`, `height` |
| `circle` | `cx`, `cy`, `rx`, `ry` (defaults to `rx`) |
| `arrow` | `from`, `to`, `curve`, `bow`, `headSize` |
| `line` | `points` |
| `path` | `d` |
| `label` | `text`, `x`, `y`, `size` (`34`), `weight` (`600`), `align`, `baseline` (`'top'`), `caps` (`true`), `underline` |
| `callout` | `number`, `cx`, `cy`, `radius` |

Every mark also takes `color` (default `'accent'`), `stroke` (line width, default `markWidth`),
`roughness`, `bowing`, `passes` and `seed`. Sketch-level `color`, `markWidth` (`5`) and `style`
(`'marker'`) set the defaults for all of them.

Two rules for the screenshot itself: it has to be reachable without the network at render time — a
file beside the document or a `data:` URI — and it has to be a real screen of the real product,
never a mock-up dressed as one. The one exception is a document with no product behind it — a
worked example, or a demo like `demo.html` — which uses a wordless generated placeholder instead
and says so in the figure's caption.

## Files

| File | What it is |
| --- | --- |
| `shaping-drawing.js` | The whole library. One file, one global, no dependencies. |
| `drawing.css` | The `@font-face`, the palette properties, the figure and callout-list styles, and print rules. |
| `fonts/ShantellSans-Latin-VariableWeight.woff2` | The handwriting face. |
| `fonts/OFL.txt` | Its licence. |
| `fonts/measure-metrics.html` | Regenerates the baked advance-width table if the font is ever replaced. |
| `demo.html`, `demo.js` | Every capability, rendered. Also the determinism fixture. |

## The handwriting face

**Shantell Sans**, by Shantell Martin and ArrowType, under the SIL Open Font License 1.1. The
vendored file is the Latin subset as a variable-weight woff2; `fonts/OFL.txt` carries the full
licence text. The font declares no Reserved Font Name, so a subset can be redistributed under its own
name without qualification.

Three faces were compared against the lettering in the book's sketches — all-caps, condensed, drawn
with a felt tip:

- **Architects Daughter** — a hand-printed architect's face. Too light: at breadboard weight its
  strokes are thinner than the rules under the place names, and the sketch stops reading as one
  hand.
- **Caveat Brush** — a brush marker. Right weight for fat-marker labels, but its brush terminals and
  narrow counters make sentence-case captions hard to read below about 18px, and a shaping document
  sets a lot of small text.
- **Shantell Sans** — a felt-tip marker face with a variable weight axis. The one file gives both
  the breadboard's medium lettering and the fat-marker sketch's bold labels, so a document with both
  looks like one person drew it. Legible in sentence case at 16px. Chosen.

`drawing.css` exposes it as the family `Shaping Hand`, falling back to Bradley Hand and Comic Sans MS
if the woff2 is ever missing — both of which still read as handwriting rather than silently
collapsing to a system sans.

### Why the metrics are baked

Layout has to be identical in a browser and in Node, and Node has no font engine. So the advance
widths of every character from space to tilde, at each of the five weights, were measured once in
Chrome with kerning off and written into `shaping-drawing.js` as a table in 1/1000 em. That is what
makes an underline fit its word and a breadboard column know how wide it is, in both environments,
without measuring anything at render time.

If the vendored font is ever replaced, open `fonts/measure-metrics.html` in a browser, copy the JSON
it prints, and rewrite the `METRICS` constant at the top of `shaping-drawing.js`.

## Why this is its own engine and not rough.js

rough.js is the obvious thing to reach for: MIT, seedable, one vendorable file. Both directions were
prototyped and drawn side by side before choosing.

What decided it:

- **A marker has pressure; rough.js has `stroke-width`.** Its output is `<path>` elements with a
  constant stroke width, so a thick line is a uniform extrusion with the same weight from end to end.
  The strokes in the book swell and thin along their length and end in a nib shape. This engine
  builds thick strokes as filled ribbons whose width breathes along the centre line, which is the
  single biggest reason its output reads as a Sharpie rather than as a wireframe tool.
- **Corners.** rough.js draws a rectangle as four clean-cornered sides. A marker turns at a corner
  and runs past where it started. This engine gives a closed shape a real turned corner and a pen
  overshoot.
- **Everything above the engine needs text metrics, and rough.js has no text at all.** Breadboards
  are words — the underline has to fit the name, the column has to know its width, the connection has
  to leave from the end of an affordance. That measurement layer had to be built either way, and it
  is most of the work.
- **rough.js output cannot be post-processed into any of that.** It hands back finished path data,
  not the roughened polyline, so a pressure layer on top would mean re-parsing its own output.
- **Size.** rough.js's bundled build is 27 KB and this library would still have to sit on top of it.
  This file is about 63 KB unminified, including the whole font metrics table, and carries no
  third-party licence.

What rough.js is better at: its hachure engine is more sophisticated, with proper edge intersection
handling for concave shapes. The scan-line fill here is simpler. Fills are a small part of this style
— the book's sketches are almost entirely line work — so that trade was worth making.

Determinism and print fidelity came out level. Both seed their randomness; both emit plain SVG paths
that print crisp at any size.
