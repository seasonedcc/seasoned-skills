/*!
 * ShapingDrawing demo scenes.
 *
 * Every scene is a pure `build()` that returns a drawing. demo.html mounts
 * them; scripts/check_drawing_determinism.mjs builds each one twice and
 * byte-compares the SVG, so this file is both the visual fixture and the
 * determinism fixture. Nothing here touches the DOM.
 */
;(function (global) {
  'use strict'

  var Drawing = global.ShapingDrawing

  /**
   * A neutral stand-in for a product screenshot: plain grey boxes, no words
   * anyone could mistake for a real interface. Built as an SVG data URI so the
   * demo stays a single self-contained page with nothing to fetch.
   */
  function placeholderScreen() {
    var markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="880" height="470" viewBox="0 0 880 470">' +
      '<rect width="880" height="470" fill="#f4f5f7"/>' +
      '<rect x="0" y="0" width="880" height="52" fill="#ffffff"/>' +
      '<rect x="20" y="18" width="120" height="16" rx="4" fill="#c9ced6"/>' +
      '<rect x="0" y="52" width="188" height="418" fill="#ffffff"/>' +
      '<rect x="20" y="80" width="120" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="20" y="112" width="96" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="20" y="144" width="110" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="20" y="176" width="84" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="20" y="208" width="104" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="216" y="80" width="300" height="150" rx="8" fill="#ffffff"/>' +
      '<rect x="240" y="104" width="120" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="240" y="136" width="220" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="240" y="162" width="180" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="240" y="188" width="200" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="548" y="80" width="300" height="150" rx="8" fill="#ffffff"/>' +
      '<rect x="572" y="104" width="120" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="572" y="136" width="200" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="572" y="162" width="240" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="572" y="188" width="150" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="216" y="262" width="632" height="184" rx="8" fill="#ffffff"/>' +
      '<rect x="240" y="286" width="160" height="12" rx="4" fill="#dfe3e8"/>' +
      '<rect x="240" y="322" width="584" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="240" y="352" width="584" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="240" y="382" width="584" height="10" rx="4" fill="#eceef1"/>' +
      '<rect x="240" y="412" width="360" height="10" rx="4" fill="#eceef1"/>' +
      '</svg>'
    return 'data:image/svg+xml,' + encodeURIComponent(markup)
  }

  var scenes = [
    {
      id: 'primitives',
      title: 'Rough primitives',
      note: 'Every shape the engine draws, at the default ink weight. Each is one call.',
      build: function () {
        var sketch = Drawing.sketch({ seed: 'primitives', width: 900, height: 460, label: 'The primitive shapes ShapingDrawing can draw' })
        function caption(text, x, y) {
          sketch.text(text, x, y, { size: 15, weight: 500, color: 'ink', opacity: 0.65, align: 'middle' })
        }

        sketch.line(40, 60, 220, 60)
        caption('line', 130, 92)

        sketch.polyline([[270, 70], [312, 34], [354, 74], [396, 38], [438, 66]])
        caption('polyline', 354, 100)

        sketch.rect(500, 30, 150, 52)
        caption('rect', 575, 108)

        sketch.polygon([[720, 78], [750, 26], [800, 26], [830, 78], [775, 96]])
        caption('polygon', 775, 122)

        sketch.circle(96, 200, 44)
        caption('circle', 96, 262)

        sketch.ellipse(250, 200, 74, 42)
        caption('ellipse', 250, 262)

        sketch.arrow([380, 224], [520, 168], { bow: 0.55 })
        caption('arrow', 450, 262)

        sketch.brace(600, 158, 244)
        caption('brace', 626, 262)

        sketch.squiggle(700, 200, 170)
        caption('squiggle', 785, 262)

        sketch.callout(1, 66, 350, { radius: 20 })
        sketch.callout(2, 122, 350, { radius: 20, color: 'accent' })
        caption('callout', 94, 396)

        sketch.rect(200, 312, 120, 76, { fill: 'accent', fillStyle: 'hachure' })
        caption('hachure', 260, 412)

        sketch.rect(356, 312, 120, 76, { fill: 'accent', fillStyle: 'cross-hatch' })
        caption('cross-hatch', 416, 412)

        sketch.rect(512, 312, 120, 76, { fill: 'accent', fillStyle: 'zigzag' })
        caption('zigzag', 572, 412)

        sketch.rect(668, 312, 120, 76, { fill: 'accent', fillStyle: 'dots' })
        caption('dots', 728, 412)

        return sketch
      }
    },

    {
      id: 'dials',
      title: 'Roughness, overdraw and the marker nib',
      note: 'The same rectangle under different settings. Left to right: a steady hand, the default, a shaky one; then the double-stroke overdraw; then the marker nib with its pressure turned up.',
      build: function () {
        var sketch = Drawing.sketch({ seed: 'dials', width: 900, height: 260, label: 'The same rectangle drawn with different roughness, overdraw and nib settings' })
        var labels = [
          { x: 30, options: { roughness: 0.25, bowing: 0.25 }, text: 'roughness 0.25' },
          { x: 208, options: {}, text: 'roughness 1' },
          { x: 386, options: { roughness: 2.2, bowing: 2 }, text: 'roughness 2.2' },
          { x: 564, options: { passes: 2 }, text: 'passes 2' },
          { x: 742, options: { style: 'marker', pressure: 0.5 }, text: 'marker' }
        ]
        labels.forEach(function (entry, index) {
          sketch.rect(entry.x, 40, 128, 96, entry.options)
          sketch.text(entry.text, entry.x + 64, 186, { size: 16, weight: 500, align: 'middle', opacity: 0.7 })
          if (index === 4) {
            sketch.text('pressure 0.5', entry.x + 64, 210, { size: 16, weight: 500, align: 'middle', opacity: 0.7 })
          }
        })
        return sketch
      }
    },

    {
      id: 'freeform',
      title: 'Arbitrary geometry',
      note: 'One free-form path, given as SVG path data with cubics, smooth cubics, quadratics and an elliptical arc. The engine roughens whatever geometry it is handed.',
      build: function () {
        var sketch = Drawing.sketch({ seed: 'freeform', width: 900, height: 340, label: 'A free-form path roughened by the engine' })
        sketch.path(
          'M 60 250 C 120 90, 210 90, 250 190 S 330 300, 400 210 Q 452 138, 520 190 ' +
            'T 640 200 A 60 60 0 0 0 745 168 L 840 168',
          { width: 3 }
        )
        sketch.path(
          'M 60 300 c 90 -40, 180 40, 270 0 s 180 -60, 270 -20 t 120 -30',
          { color: 'accent', width: 3 }
        )
        sketch.path('M 120 60 h 160 v 60 h -160 Z M 150 80 h 100 v 20 h -100 Z', {
          width: 2.4,
          fill: 'accent',
          fillStyle: 'hachure',
          fillGap: 7
        })
        sketch.text('one path, two sub-paths, an even-odd hachure', 300, 96, { size: 17, weight: 500, opacity: 0.7 })
        return sketch
      }
    },

    {
      id: 'breadboard',
      title: 'Breadboard',
      note: 'Chapter 4 notation: places as underlined names, affordances beneath them, connection lines from an affordance to the place it takes you to. Words for everything.',
      build: function () {
        return Drawing.breadboard({
          seed: 'autopay-breadboard',
          places: [
            { name: 'Invoice', affordances: [{ text: 'Turn on Autopay', struck: true }, { text: 'Pay', accent: true }] },
            {
              name: 'Pay Invoice',
              accent: true,
              affordances: ['CC fields', 'ACH fields', 'FI logo', { text: 'Autopay in future?', accent: true }, 'Submit']
            },
            { name: 'Confirm', affordances: ['Print receipt', 'Thank you message', 'Confirm Autopay'] }
          ],
          connections: [
            { from: 'Invoice/Pay', to: 'Pay Invoice', accent: true },
            { from: 'Pay Invoice/Submit', to: 'Confirm' }
          ]
        })
      }
    },

    {
      id: 'fat-marker',
      title: 'Fat marker sketch with callouts',
      note: 'Thick marker strokes, two colours, and numbered circles the caption list refers to.',
      build: function () {
        var sketch = Drawing.sketch({
          seed: 'todo-groups',
          width: 900,
          height: 470,
          style: 'marker',
          label: 'A fat marker sketch of a list split into loose and grouped items'
        })

        sketch.squiggle(150, 60, 300, { amplitude: 9, wavelength: 24, width: 11 })

        var rows = [110, 168, 258, 316, 406]
        rows.forEach(function (y, index) {
          sketch.rect(150, y - 20, 34, 34, { width: 7 })
          sketch.squiggle(210, y - 3, 190 + (index % 3) * 46, { amplitude: 7, wavelength: 20, width: 7 })
        })

        sketch.line(140, 214, 300, 214, { width: 8 })
        sketch.squiggle(312, 214, 90, { amplitude: 7, wavelength: 20, width: 7 })
        sketch.line(416, 214, 560, 214, { width: 8 })

        sketch.line(140, 362, 300, 362, { width: 8 })
        sketch.squiggle(312, 362, 90, { amplitude: 7, wavelength: 20, width: 7 })
        sketch.line(416, 362, 560, 362, { width: 8 })

        sketch.brace(640, 88, 196, { reach: 22, width: 7 })
        sketch.text('Loose', 690, 142, { size: 34, weight: 700, caps: true, baseline: 'middle' })

        sketch.brace(640, 236, 434, { reach: 22, width: 7 })
        sketch.text('Grouped', 690, 335, { size: 34, weight: 700, caps: true, baseline: 'middle' })

        sketch.callout(1, 74, 140, { radius: 24 })
        sketch.callout(2, 74, 214, { radius: 24, color: 'accent' })
        sketch.callout(3, 74, 335, { radius: 24 })

        return Drawing.figure({
          drawing: sketch,
          callouts: [
            'Items above the first divider stay loose — they belong straight to the list.',
            'A divider carries its own name and splits what follows into a group.',
            'Everything below a divider belongs to that group until the next one.'
          ],
          caption: 'Two kinds of item in one list'
        })
      }
    },

    {
      id: 'annotation',
      title: 'Annotation over a screenshot',
      note: 'Chapter 6 embeds fat marker drawing over a real screen. The screen here is a neutral placeholder generated by the demo — never a real product screenshot.',
      build: function () {
        return Drawing.annotate({
          seed: 'dashboard-annotation',
          src: placeholderScreen(),
          width: 880,
          height: 470,
          alt: 'A placeholder screen with hand-drawn annotations over it',
          marks: [
            { type: 'box', x: 214, y: 74, width: 636, height: 162 },
            { type: 'label', text: 'Payment form preview\nand links go here', x: 532, y: 104, size: 34, align: 'middle' },
            { type: 'arrow', from: [330, 306], to: [246, 244], bow: 0.5, stroke: 5 },
            { type: 'label', text: 'this row moves down', x: 340, y: 306, size: 22, weight: 500, baseline: 'middle' },
            { type: 'circle', cx: 92, cy: 118, rx: 80, ry: 32 },
            { type: 'callout', number: 1, cx: 92, cy: 194, radius: 22 },
            { type: 'callout', number: 2, cx: 838, cy: 40, radius: 22 }
          ]
        })
      }
    },

    {
      id: 'handwriting',
      title: 'Handwriting labels',
      note: 'Text is set in the vendored handwriting face. Widths come from a baked metrics table, so an underline fits its word identically in a browser and in Node.',
      build: function () {
        var sketch = Drawing.sketch({ seed: 'handwriting', width: 900, height: 400, label: 'Handwriting labels at several sizes and weights' })
        sketch.text('Set up Autopay', 40, 62, { size: 34, weight: 500, caps: true, underline: true })
        sketch.text('Thank you message', 40, 132, { size: 24, weight: 400, caps: true })
        sketch.text('Turn on Autopay', 40, 186, { size: 24, weight: 400, caps: true, strike: true })
        sketch.text('Loose', 40, 258, { size: 40, weight: 700, caps: true, color: 'accent' })
        sketch.text('Grouped', 200, 258, { size: 40, weight: 800, caps: true })
        sketch.text('centred on 450', 450, 320, { size: 20, weight: 500, align: 'middle' })
        sketch.text('right-aligned on 860', 860, 320, { size: 20, weight: 500, align: 'end' })
        sketch.text('Sentence case reads fine at small sizes too.', 40, 366, { size: 18, weight: 400, opacity: 0.8 })
        return sketch
      }
    }
  ]

  global.ShapingDemo = { scenes: scenes, placeholderScreen: placeholderScreen }
})(typeof globalThis !== 'undefined' ? globalThis : this)
