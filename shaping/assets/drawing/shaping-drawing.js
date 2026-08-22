/*!
 * ShapingDrawing — deterministic hand-drawn SVG for shaping documents.
 *
 * Load with a plain script tag. No modules, no build step, no network.
 *
 *   <link rel="stylesheet" href="../assets/drawing/drawing.css">
 *   <script src="../assets/drawing/shaping-drawing.js"></script>
 *
 * Every sketch takes an explicit seed. The same calls with the same seed
 * produce byte-identical SVG. See README.md for the authoring API.
 */
;(function (global) {
  'use strict'

  var SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  var XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

  var INK = 'var(--shaping-ink, #1b1b1b)'
  var ACCENT = 'var(--shaping-accent, #d93a2b)'
  var PAPER = 'var(--shaping-paper, #ffffff)'

  var FONT_FAMILY = "'Shaping Hand', 'Bradley Hand', 'Comic Sans MS', cursive"

  /* ------------------------------------------------------------------ font metrics
   * Advance widths of Shantell Sans, measured once in Chrome at 1000px with
   * kerning off and baked in so layout is identical in a browser and in Node.
   * Units are 1/1000 em; index is charCode - 32 (space through tilde).
   * Regenerate with fonts/measure-metrics.html when the vendored font changes.
   */
  var METRICS = {
    unitsPerEm: 1000,
    weights: {
      400: { advances: '341,273.8,444.8,950.4,700,923.8,622.6,263.4,436.6,408.4,487.2,700,251.6,483,257,355,700,417.4,700,700,700,613,700,700,700,700,280,279.6,700,700,700,461.8,863.2,726.4,589.8,612.6,660.2,625.8,566,754.8,731.8,550.6,596.8,646,552,958.8,763.4,720.4,581.2,721.6,687.2,554.8,617,668.2,674.8,959.4,644,603.6,606.8,464.2,355,465,610,700,358,621.6,589.4,503.8,634.4,566.2,362.6,614.4,625.4,283.6,265.8,574,300.6,861.6,612.4,606.4,562,582.8,474,495.4,436.6,578.2,555.4,869,521,575,607.4,520.2,288.2,521,700', capHeight: 709, ascent: 1020, descent: 320, xHeight: 502.6 },
      500: { advances: '342,282.6,470.6,963.8,700,941.6,645.2,267.8,452.2,429.8,494.4,700,269.2,495,275,380,700,429.8,700,700,700,617,700,700,700,700,290,289.2,700,700,700,481.6,878.4,739.8,600.6,613.2,675.4,638.6,573,770.6,727.6,554.2,609.6,658,548,981.6,772.8,726.8,596.4,737.2,704.4,560.6,619,673.4,684.6,970.8,651,609.2,617.6,476.4,380,477,610,700,356,642.2,600.8,512.6,652.8,577.4,376.2,625.8,639.8,291.2,274.6,600,316.2,878.2,629.8,620.8,574,597.6,495,505.8,453.2,597.4,572.8,881,538,587,611.8,528.4,303.4,529,700', capHeight: 709, ascent: 1020, descent: 320, xHeight: 508.2 },
      600: { advances: '343,291.4,496.4,977.2,700,959.4,667.8,272.2,467.8,451.2,501.6,700,286.8,507,293,405,700,442.2,700,700,700,621,700,700,700,700,300,298.8,700,700,700,501.4,893.6,753.2,611.4,613.8,690.6,651.4,580,786.4,723.4,557.8,622.4,670,544,1004.4,782.2,733.2,611.6,752.8,721.6,566.4,621,678.6,694.4,982.2,658,614.8,628.4,488.6,405,489,610,700,354,662.8,612.2,521.4,671.2,588.6,389.8,637.2,654.2,298.8,283.4,626,331.8,894.8,647.2,635.2,586,612.4,516,516.2,469.8,616.6,590.2,893,555,599,616.2,536.6,318.6,537,700', capHeight: 709, ascent: 1020, descent: 320, xHeight: 513.8 },
      700: { advances: '344,300.2,522.2,990.6,700,977.2,690.4,276.6,483.4,472.6,508.8,700,304.4,519,311,430,700,454.6,700,700,700,625,700,700,700,700,310,308.4,700,700,700,521.2,908.8,766.6,622.2,614.4,705.8,664.2,587,802.2,719.2,561.4,635.2,682,540,1027.2,791.6,739.6,626.8,768.4,738.8,572.2,623,683.8,704.2,993.6,665,620.4,639.2,500.8,430,501,610,700,352,683.4,623.6,530.2,689.6,599.8,403.4,648.6,668.6,306.4,292.2,652,347.4,911.4,664.6,649.6,598,627.2,537,526.6,486.4,635.8,607.6,905,572,611,620.6,544.8,333.8,545,700', capHeight: 709, ascent: 1020, descent: 320, xHeight: 519.4 },
      800: { advances: '345,309,548,1004,700,995,713,281,499,494,516,700,322,531,329,455,700,467,700,700,700,629,700,700,700,700,320,318,700,700,700,541,924,780,633,615,721,677,594,818,715,565,648,694,536,1050,801,746,642,784,756,578,625,689,714,1005,672,626,650,513,455,513,610,700,350,704,635,539,708,611,417,660,683,314,301,678,363,928,682,664,610,642,558,537,503,655,625,917,589,623,625,553,349,553,700', capHeight: 709, ascent: 1020, descent: 320, xHeight: 525 }
    }
  }

  var METRIC_WEIGHTS = [400, 500, 600, 700, 800]

  Object.keys(METRICS.weights).forEach(function (weight) {
    var record = METRICS.weights[weight]
    record.advances = record.advances.split(',').map(Number)
  })

  function metricsFor(weight) {
    var chosen = METRIC_WEIGHTS[0]
    for (var index = 0; index < METRIC_WEIGHTS.length; index++) {
      if (Math.abs(METRIC_WEIGHTS[index] - weight) < Math.abs(chosen - weight)) chosen = METRIC_WEIGHTS[index]
    }
    return METRICS.weights[chosen]
  }

  /** Width of `text` in user units. Deterministic in every environment. */
  function measureText(text, size, weight, letterSpacing) {
    var record = metricsFor(weight === undefined ? 400 : weight)
    var spacing = letterSpacing === undefined ? 0 : letterSpacing
    var total = 0
    for (var index = 0; index < text.length; index++) {
      var code = text.charCodeAt(index) - 32
      var advance = code >= 0 && code < record.advances.length ? record.advances[code] : record.advances[88]
      total += advance / METRICS.unitsPerEm
    }
    return total * size + spacing * size * text.length
  }

  /* ------------------------------------------------------------------ randomness */

  function hashString(text) {
    var hash = 2166136261
    for (var index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  var NOISE_TABLE_SIZE = 64
  var NOISE_CHANNELS = 4

  function makeRandom(seedText) {
    var state = hashString(seedText) || 1
    function next() {
      state = (state + 0x6d2b79f5) | 0
      var value = Math.imul(state ^ (state >>> 15), 1 | state)
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
    var tables = []
    for (var channel = 0; channel < NOISE_CHANNELS; channel++) {
      var table = new Array(NOISE_TABLE_SIZE)
      for (var slot = 0; slot < NOISE_TABLE_SIZE; slot++) table[slot] = next() * 2 - 1
      tables.push(table)
    }
    return {
      next: next,
      between: function (low, high) {
        return low + next() * (high - low)
      },
      /** Smooth, periodic 1-D noise in [-1, 1]. Pure arithmetic, so it is stable. */
      noise: function (channel, position) {
        var table = tables[((channel % NOISE_CHANNELS) + NOISE_CHANNELS) % NOISE_CHANNELS]
        var wrapped = position % NOISE_TABLE_SIZE
        if (wrapped < 0) wrapped += NOISE_TABLE_SIZE
        var lower = Math.floor(wrapped)
        var fraction = wrapped - lower
        var start = table[lower]
        var end = table[(lower + 1) % NOISE_TABLE_SIZE]
        var eased = fraction * fraction * (3 - 2 * fraction)
        return start + (end - start) * eased
      }
    }
  }

  /* ------------------------------------------------------------------ numbers */

  function round2(value) {
    var rounded = Math.round(value * 100) / 100
    return rounded === 0 ? 0 : rounded
  }

  function formatNumber(value) {
    return String(round2(value))
  }

  function point(x, y) {
    return formatNumber(x) + ' ' + formatNumber(y)
  }

  function distance(from, to) {
    var dx = to[0] - from[0]
    var dy = to[1] - from[1]
    return Math.sqrt(dx * dx + dy * dy)
  }

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value
  }

  /* ------------------------------------------------------------------ geometry */

  function flattenCubic(target, from, control1, control2, to) {
    var chord = distance(from, control1) + distance(control1, control2) + distance(control2, to)
    var steps = clamp(Math.ceil(chord / 4), 6, 240)
    for (var step = 1; step <= steps; step++) {
      var t = step / steps
      var inverse = 1 - t
      var a = inverse * inverse * inverse
      var b = 3 * inverse * inverse * t
      var c = 3 * inverse * t * t
      var d = t * t * t
      target.push([
        a * from[0] + b * control1[0] + c * control2[0] + d * to[0],
        a * from[1] + b * control1[1] + c * control2[1] + d * to[1]
      ])
    }
  }

  function quadraticToCubic(from, control, to) {
    return [
      [from[0] + (2 / 3) * (control[0] - from[0]), from[1] + (2 / 3) * (control[1] - from[1])],
      [to[0] + (2 / 3) * (control[0] - to[0]), to[1] + (2 / 3) * (control[1] - to[1])]
    ]
  }

  /** Endpoint-parameterised elliptical arc to a list of cubic segments. */
  function arcToCubics(from, radiusX, radiusY, rotationDegrees, largeArc, sweep, to) {
    var segments = []
    var rx = Math.abs(radiusX)
    var ry = Math.abs(radiusY)
    if (rx === 0 || ry === 0) return [[from, from, to, to]]
    var angle = (rotationDegrees * Math.PI) / 180
    var cosAngle = Math.cos(angle)
    var sinAngle = Math.sin(angle)
    var dx = (from[0] - to[0]) / 2
    var dy = (from[1] - to[1]) / 2
    var x1 = cosAngle * dx + sinAngle * dy
    var y1 = -sinAngle * dx + cosAngle * dy
    var lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if (lambda > 1) {
      var scale = Math.sqrt(lambda)
      rx *= scale
      ry *= scale
    }
    var numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    var denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
    var factor = Math.sqrt(Math.max(0, numerator / denominator))
    if (largeArc === sweep) factor = -factor
    var cx1 = (factor * rx * y1) / ry
    var cy1 = (-factor * ry * x1) / rx
    var cx = cosAngle * cx1 - sinAngle * cy1 + (from[0] + to[0]) / 2
    var cy = sinAngle * cx1 + cosAngle * cy1 + (from[1] + to[1]) / 2
    var startAngle = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx)
    var endAngle = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx)
    var sweepAngle = endAngle - startAngle
    if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI
    if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI
    var count = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)))
    var delta = sweepAngle / count
    var alpha = (4 / 3) * Math.tan(delta / 4)
    var currentAngle = startAngle
    var current = from
    for (var index = 0; index < count; index++) {
      var nextAngle = currentAngle + delta
      var cosStart = Math.cos(currentAngle)
      var sinStart = Math.sin(currentAngle)
      var cosEnd = Math.cos(nextAngle)
      var sinEnd = Math.sin(nextAngle)
      var endPoint = [
        cosAngle * rx * cosEnd - sinAngle * ry * sinEnd + cx,
        sinAngle * rx * cosEnd + cosAngle * ry * sinEnd + cy
      ]
      var derivativeStart = [
        -rx * cosAngle * sinStart - ry * sinAngle * cosStart,
        -rx * sinAngle * sinStart + ry * cosAngle * cosStart
      ]
      var derivativeEnd = [
        -rx * cosAngle * sinEnd - ry * sinAngle * cosEnd,
        -rx * sinAngle * sinEnd + ry * cosAngle * cosEnd
      ]
      segments.push([
        current,
        [current[0] + alpha * derivativeStart[0], current[1] + alpha * derivativeStart[1]],
        [endPoint[0] - alpha * derivativeEnd[0], endPoint[1] - alpha * derivativeEnd[1]],
        endPoint
      ])
      current = endPoint
      currentAngle = nextAngle
    }
    return segments
  }

  var PATH_COMMAND = /([astvzqmhlc])([^astvzqmhlc]*)/gi
  var PATH_NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi

  /** Parse SVG path data into flattened sub-paths: [{ points, closed }]. */
  function flattenPathData(data) {
    var subpaths = []
    var points = null
    var closed = false
    var current = [0, 0]
    var start = [0, 0]
    var lastControl = null
    var lastQuadratic = null

    function begin(at) {
      finish()
      points = [[at[0], at[1]]]
      closed = false
    }
    function finish() {
      if (points && points.length > 1) subpaths.push({ points: points, closed: closed })
      points = null
    }

    var match
    PATH_COMMAND.lastIndex = 0
    while ((match = PATH_COMMAND.exec(data)) !== null) {
      var command = match[1]
      var upper = command.toUpperCase()
      var relative = command !== upper
      var numbers = (match[2].match(PATH_NUMBER) || []).map(Number)
      var index = 0
      if (upper === 'Z') {
        if (points && points.length > 1) {
          closed = true
          points.push([start[0], start[1]])
        }
        current = [start[0], start[1]]
        lastControl = null
        lastQuadratic = null
        continue
      }
      if (numbers.length === 0) continue
      while (index < numbers.length) {
        var base = relative ? current : [0, 0]
        if (upper === 'M') {
          current = [numbers[index++] + base[0], numbers[index++] + base[1]]
          start = [current[0], current[1]]
          begin(current)
          upper = 'L'
          command = relative ? 'l' : 'L'
        } else if (upper === 'L') {
          current = [numbers[index++] + base[0], numbers[index++] + base[1]]
          if (points) points.push([current[0], current[1]])
        } else if (upper === 'H') {
          current = [numbers[index++] + (relative ? current[0] : 0), current[1]]
          if (points) points.push([current[0], current[1]])
        } else if (upper === 'V') {
          current = [current[0], numbers[index++] + (relative ? current[1] : 0)]
          if (points) points.push([current[0], current[1]])
        } else if (upper === 'C' || upper === 'S') {
          var control1
          if (upper === 'C') {
            control1 = [numbers[index++] + base[0], numbers[index++] + base[1]]
          } else {
            control1 = lastControl
              ? [2 * current[0] - lastControl[0], 2 * current[1] - lastControl[1]]
              : [current[0], current[1]]
          }
          var control2 = [numbers[index++] + base[0], numbers[index++] + base[1]]
          var end = [numbers[index++] + base[0], numbers[index++] + base[1]]
          if (points) flattenCubic(points, current, control1, control2, end)
          lastControl = control2
          lastQuadratic = null
          current = end
          continue
        } else if (upper === 'Q' || upper === 'T') {
          var quadraticControl
          if (upper === 'Q') {
            quadraticControl = [numbers[index++] + base[0], numbers[index++] + base[1]]
          } else {
            quadraticControl = lastQuadratic
              ? [2 * current[0] - lastQuadratic[0], 2 * current[1] - lastQuadratic[1]]
              : [current[0], current[1]]
          }
          var quadraticEnd = [numbers[index++] + base[0], numbers[index++] + base[1]]
          var cubics = quadraticToCubic(current, quadraticControl, quadraticEnd)
          if (points) flattenCubic(points, current, cubics[0], cubics[1], quadraticEnd)
          lastQuadratic = quadraticControl
          lastControl = null
          current = quadraticEnd
          continue
        } else if (upper === 'A') {
          var rx = numbers[index++]
          var ry = numbers[index++]
          var rotation = numbers[index++]
          var largeArc = numbers[index++] !== 0
          var sweep = numbers[index++] !== 0
          var arcEnd = [numbers[index++] + base[0], numbers[index++] + base[1]]
          var arcSegments = arcToCubics(current, rx, ry, rotation, largeArc, sweep, arcEnd)
          for (var segment = 0; segment < arcSegments.length; segment++) {
            var piece = arcSegments[segment]
            if (points) flattenCubic(points, piece[0], piece[1], piece[2], piece[3])
          }
          current = arcEnd
          lastControl = null
          lastQuadratic = null
          continue
        } else {
          break
        }
        lastControl = null
        lastQuadratic = null
      }
    }
    finish()
    return subpaths
  }

  var KAPPA = 0.5522847498307936

  function ellipsePathData(cx, cy, rx, ry) {
    var ox = rx * KAPPA
    var oy = ry * KAPPA
    return (
      'M ' + point(cx, cy - ry) +
      ' C ' + point(cx + ox, cy - ry) + ' ' + point(cx + rx, cy - oy) + ' ' + point(cx + rx, cy) +
      ' C ' + point(cx + rx, cy + oy) + ' ' + point(cx + ox, cy + ry) + ' ' + point(cx, cy + ry) +
      ' C ' + point(cx - ox, cy + ry) + ' ' + point(cx - rx, cy + oy) + ' ' + point(cx - rx, cy) +
      ' C ' + point(cx - rx, cy - oy) + ' ' + point(cx - ox, cy - ry) + ' ' + point(cx, cy - ry) +
      ' Z'
    )
  }

  /* ------------------------------------------------------------------ resampling */

  var CORNER_COSINE = Math.cos((32 * Math.PI) / 180)

  function findCorners(points, closed) {
    var corners = new Array(points.length)
    for (var index = 0; index < points.length; index++) corners[index] = false
    corners[0] = true
    corners[points.length - 1] = true
    for (var vertex = 1; vertex < points.length - 1; vertex++) {
      var before = points[vertex - 1]
      var here = points[vertex]
      var after = points[vertex + 1]
      var ax = here[0] - before[0]
      var ay = here[1] - before[1]
      var bx = after[0] - here[0]
      var by = after[1] - here[1]
      var lengthA = Math.sqrt(ax * ax + ay * ay)
      var lengthB = Math.sqrt(bx * bx + by * by)
      if (lengthA < 0.0001 || lengthB < 0.0001) continue
      var cosine = (ax * bx + ay * by) / (lengthA * lengthB)
      if (cosine < CORNER_COSINE) corners[vertex] = true
    }
    if (closed) corners[0] = true
    return corners
  }

  /** Even-spacing resample that keeps corner vertices exactly where they are. */
  function resample(points, spacing) {
    var corners = findCorners(points, false)
    var result = [points[0]]
    var hard = [true]
    var anchor = 0
    for (var index = 1; index < points.length; index++) {
      if (!corners[index]) continue
      var run = points.slice(anchor, index + 1)
      var runLength = 0
      for (var step = 1; step < run.length; step++) runLength += distance(run[step - 1], run[step])
      var pieces = Math.max(1, Math.round(runLength / spacing))
      var walked = 0
      var cursor = 1
      for (var piece = 1; piece <= pieces; piece++) {
        var target = (runLength * piece) / pieces
        while (cursor < run.length && walked + distance(run[cursor - 1], run[cursor]) < target) {
          walked += distance(run[cursor - 1], run[cursor])
          cursor++
        }
        if (cursor >= run.length) {
          result.push(run[run.length - 1])
        } else {
          var segmentLength = distance(run[cursor - 1], run[cursor])
          var ratio = segmentLength < 0.0001 ? 0 : (target - walked) / segmentLength
          result.push([
            run[cursor - 1][0] + (run[cursor][0] - run[cursor - 1][0]) * ratio,
            run[cursor - 1][1] + (run[cursor][1] - run[cursor - 1][1]) * ratio
          ])
        }
        hard.push(piece === pieces)
      }
      anchor = index
    }
    return { points: result, hard: hard }
  }

  /* ------------------------------------------------------------------ roughening */

  var WOBBLE_WAVELENGTH = 46
  var BOW_WAVELENGTH = 380

  /**
   * Push a polyline off its true course the way a hand does: a slow bow across
   * the whole stroke, a faster wobble along it, and a little drift along the
   * direction of travel.
   */
  function roughen(points, hard, random, options, phase) {
    var roughness = options.roughness
    var bowing = options.bowing
    var arcLength = [0]
    for (var index = 1; index < points.length; index++) {
      arcLength.push(arcLength[index - 1] + distance(points[index - 1], points[index]))
    }
    // Each run between corners bows on its own, so a box's four sides each
    // bulge instead of the whole outline swinging once around.
    var runStart = new Array(points.length)
    var runEnd = new Array(points.length)
    var anchor = 0
    for (var mark = 1; mark < points.length; mark++) {
      if (!hard[mark] && mark !== points.length - 1) continue
      for (var member = anchor; member <= mark; member++) {
        runStart[member] = arcLength[anchor]
        runEnd[member] = arcLength[mark]
      }
      anchor = mark
    }
    var wobbleAmount = roughness * 1.35
    var driftAmount = roughness * 1.1
    var result = []
    for (var sample = 0; sample < points.length; sample++) {
      var here = points[sample]
      var before = points[Math.max(0, sample - 1)]
      var after = points[Math.min(points.length - 1, sample + 1)]
      var tx = after[0] - before[0]
      var ty = after[1] - before[1]
      var tangentLength = Math.sqrt(tx * tx + ty * ty) || 1
      tx /= tangentLength
      ty /= tangentLength
      var nx = -ty
      var ny = tx
      var walked = arcLength[sample]
      var runLength = (runEnd[sample] || 0) - (runStart[sample] || 0)
      var ends = runLength > 0 ? Math.sin((Math.PI * (walked - runStart[sample])) / runLength) : 0
      var bowAmount = bowing * clamp(runLength * 0.03, 0.8, 12)
      var bow = random.noise(0, walked / BOW_WAVELENGTH + phase) * bowAmount * ends
      var wobble = random.noise(1, walked / WOBBLE_WAVELENGTH + phase * 3.7) * wobbleAmount
      var drift = random.noise(2, walked / (WOBBLE_WAVELENGTH * 1.6) + phase * 2.3) * driftAmount
      result.push([
        here[0] + nx * (bow + wobble) + tx * drift,
        here[1] + ny * (bow + wobble) + ty * drift
      ])
    }
    return result
  }

  /** Catmull-Rom through every sample, breaking to a straight line at corners. */
  function smoothPathData(points, hard, skipMove) {
    if (points.length === 0) return ''
    if (points.length === 1) return skipMove ? '' : 'M ' + point(points[0][0], points[0][1])
    var data = skipMove ? '' : 'M ' + point(points[0][0], points[0][1])
    for (var index = 0; index < points.length - 1; index++) {
      var current = points[index]
      var next = points[index + 1]
      if (hard[index] && hard[index + 1]) {
        data += ' L ' + point(next[0], next[1])
        continue
      }
      var previous = points[index - 1] || current
      var following = points[index + 2] || next
      var control1 = [current[0] + (next[0] - previous[0]) / 6, current[1] + (next[1] - previous[1]) / 6]
      var control2 = [next[0] - (following[0] - current[0]) / 6, next[1] - (following[1] - current[1]) / 6]
      data += ' C ' + point(control1[0], control1[1]) + ' ' + point(control2[0], control2[1]) + ' ' + point(next[0], next[1])
    }
    return data
  }

  /**
   * Turn a centre line into a filled ribbon whose width breathes along the
   * stroke — the part a constant `stroke-width` can never give you.
   */
  function ribbonPathData(points, hard, random, options, phase) {
    var arcLength = [0]
    for (var index = 1; index < points.length; index++) {
      arcLength.push(arcLength[index - 1] + distance(points[index - 1], points[index]))
    }
    var total = arcLength[points.length - 1] || 1
    var baseWidth = options.width
    var pressure = options.pressure
    var taper = options.taper
    var last = points.length - 1
    var left = []
    var right = []
    var edges = []
    var firstHalf = 0
    var lastHalf = 0

    function offsetAt(sample, tx, ty, isEdge) {
      var tangentLength = Math.sqrt(tx * tx + ty * ty) || 1
      var ux = tx / tangentLength
      var uy = ty / tangentLength
      var nx = -uy
      var ny = ux
      var walked = arcLength[sample]
      var fraction = walked / total
      var reach = Math.min(fraction, 1 - fraction) / 0.16
      var taperFactor = 1 - taper * (1 - clamp(reach, 0, 1))
      var breathe = 1 + random.noise(3, walked / 90 + phase * 5.1) * pressure
      var half = (baseWidth * taperFactor * breathe) / 2
      var here = points[sample]
      left.push([here[0] + nx * half, here[1] + ny * half])
      right.push([here[0] - nx * half, here[1] - ny * half])
      edges.push(isEdge)
      if (sample === 0) firstHalf = half
      if (sample === last) lastHalf = half
    }

    for (var sample = 0; sample <= last; sample++) {
      var before = points[Math.max(0, sample - 1)]
      var after = points[Math.min(last, sample + 1)]
      if (sample > 0 && sample < last && hard[sample]) {
        // A corner gets two offsets — one for the stroke coming in, one for
        // the stroke going out — so the nib turns instead of rounding off.
        offsetAt(sample, points[sample][0] - before[0], points[sample][1] - before[1], true)
        offsetAt(sample, after[0] - points[sample][0], after[1] - points[sample][1], true)
      } else {
        offsetAt(sample, after[0] - before[0], after[1] - before[1], false)
      }
    }

    var capEnd = capPoints(points[last], points[Math.max(0, last - 1)], lastHalf, false)
    var capStart = capPoints(points[0], points[Math.min(last, 1)], firstHalf, true)
    var backward = right.slice().reverse()
    var backwardEdges = edges.slice().reverse()
    var data = smoothPathData(left, edges, false)
    for (var capIndex = 0; capIndex < capEnd.length; capIndex++) {
      data += ' L ' + point(capEnd[capIndex][0], capEnd[capIndex][1])
    }
    data += ' L ' + point(backward[0][0], backward[0][1]) + smoothPathData(backward, backwardEdges, true)
    for (var startIndex = 0; startIndex < capStart.length; startIndex++) {
      data += ' L ' + point(capStart[startIndex][0], capStart[startIndex][1])
    }
    return data + ' Z'
  }

  /** A round-ish nib end: five sampled points around the half-circle. */
  function capPoints(tip, neighbour, half, atStart) {
    var dx = tip[0] - neighbour[0]
    var dy = tip[1] - neighbour[1]
    var length = Math.sqrt(dx * dx + dy * dy) || 1
    var tx = (dx / length) * (atStart ? -1 : 1)
    var ty = (dy / length) * (atStart ? -1 : 1)
    var nx = -ty
    var ny = tx
    var points = []
    for (var step = 1; step <= 4; step++) {
      var angle = (Math.PI * step) / 5
      var alongNormal = Math.cos(angle) * half
      var alongTangent = Math.sin(angle) * half
      points.push([tip[0] + nx * alongNormal + tx * alongTangent, tip[1] + ny * alongNormal + ty * alongTangent])
    }
    return points
  }

  /* ------------------------------------------------------------------ hachure */

  function rotatePoint(x, y, cosine, sine) {
    return [x * cosine - y * sine, x * sine + y * cosine]
  }

  /** Parallel scan lines clipped to a polygon, in the polygon's own space. */
  function hachureSegments(polygons, angleDegrees, gap) {
    var angle = (angleDegrees * Math.PI) / 180
    var cosine = Math.cos(-angle)
    var sine = Math.sin(-angle)
    var backCosine = Math.cos(angle)
    var backSine = Math.sin(angle)
    var rotated = polygons.map(function (polygon) {
      return polygon.map(function (vertex) {
        return rotatePoint(vertex[0], vertex[1], cosine, sine)
      })
    })
    var minimum = Infinity
    var maximum = -Infinity
    rotated.forEach(function (polygon) {
      polygon.forEach(function (vertex) {
        if (vertex[1] < minimum) minimum = vertex[1]
        if (vertex[1] > maximum) maximum = vertex[1]
      })
    })
    var segments = []
    if (!isFinite(minimum)) return segments
    var lineCount = Math.floor((maximum - minimum) / gap)
    for (var line = 0; line <= lineCount; line++) {
      var y = minimum + gap * (line + 0.5)
      if (y >= maximum) break
      var crossings = []
      rotated.forEach(function (polygon) {
        for (var index = 0; index < polygon.length; index++) {
          var from = polygon[index]
          var to = polygon[(index + 1) % polygon.length]
          if (from[1] === to[1]) continue
          var low = Math.min(from[1], to[1])
          var high = Math.max(from[1], to[1])
          if (y < low || y >= high) continue
          crossings.push(from[0] + ((y - from[1]) / (to[1] - from[1])) * (to[0] - from[0]))
        }
      })
      crossings.sort(function (a, b) {
        return a - b
      })
      for (var pair = 0; pair + 1 < crossings.length; pair += 2) {
        if (crossings[pair + 1] - crossings[pair] < gap * 0.25) continue
        segments.push([
          rotatePoint(crossings[pair], y, backCosine, backSine),
          rotatePoint(crossings[pair + 1], y, backCosine, backSine)
        ])
      }
    }
    return segments
  }

  /* ------------------------------------------------------------------ serialising */

  function escapeText(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function serialiseNode(node) {
    var markup = '<' + node.tag
    Object.keys(node.attributes).forEach(function (name) {
      var value = node.attributes[name]
      if (value === null || value === undefined || value === '') return
      markup += ' ' + name + '="' + escapeText(value) + '"'
    })
    if (node.text === undefined && (!node.children || node.children.length === 0)) return markup + '/>'
    markup += '>'
    if (node.text !== undefined) markup += escapeText(node.text)
    if (node.children) markup += node.children.map(serialiseNode).join('')
    return markup + '</' + node.tag + '>'
  }

  /* ------------------------------------------------------------------ options */

  var STYLE_DEFAULTS = {
    ink: { width: 2.6, roughness: 1, bowing: 1, pressure: 0.16, taper: 0.3, passes: 1 },
    marker: { width: 9, roughness: 1.15, bowing: 1.15, pressure: 0.3, taper: 0.16, passes: 1 }
  }

  function Sketch(options) {
    options = options || {}
    if (options.seed === undefined || options.seed === null || options.seed === '') {
      throw new Error('ShapingDrawing: sketch() needs an explicit seed — determinism depends on it')
    }
    this.seed = String(options.seed)
    this.width = options.width === undefined ? 900 : options.width
    this.height = options.height === undefined ? 400 : options.height
    this.style = options.style === 'marker' ? 'marker' : 'ink'
    this.ink = options.ink || INK
    this.accent = options.accent || ACCENT
    this.paper = options.paper === undefined ? null : options.paper
    this.label = options.label || ''
    this.className = options.class || ''
    this.nodes = []
    this.callCount = 0
  }

  Sketch.prototype.resolveColor = function (color) {
    if (!color || color === 'ink') return this.ink
    if (color === 'accent') return this.accent
    if (color === 'paper') return PAPER
    return color
  }

  Sketch.prototype.randomFor = function (options) {
    var salt = options && options.seed !== undefined ? String(options.seed) : 'call-' + this.callCount
    this.callCount += 1
    return makeRandom(this.seed + '/' + salt)
  }

  Sketch.prototype.strokeOptions = function (options) {
    options = options || {}
    var style = options.style === 'marker' || options.style === 'ink' ? options.style : this.style
    var defaults = STYLE_DEFAULTS[style]
    return {
      style: style,
      width: options.width === undefined ? defaults.width : options.width,
      roughness: options.roughness === undefined ? defaults.roughness : options.roughness,
      bowing: options.bowing === undefined ? defaults.bowing : options.bowing,
      pressure: options.pressure === undefined ? defaults.pressure : options.pressure,
      taper: options.taper === undefined ? defaults.taper : options.taper,
      passes: options.passes === undefined ? defaults.passes : options.passes,
      color: this.resolveColor(options.color),
      opacity: options.opacity,
      className: options.class || ''
    }
  }

  Sketch.prototype.push = function (node) {
    this.nodes.push(node)
    return this
  }

  /**
   * The one place strokes are made. Everything else in this library reduces to
   * a call to this: a list of sub-paths, roughened and drawn `passes` times.
   */
  Sketch.prototype.strokeSubpaths = function (subpaths, random, settings) {
    var spacing = clamp(settings.width * 1.7, 7, 20)
    var solid = settings.pressure < 0.02 && settings.taper < 0.02
    for (var pass = 0; pass < settings.passes; pass++) {
      var data = ''
      for (var index = 0; index < subpaths.length; index++) {
        var subpath = subpaths[index]
        if (subpath.points.length < 2) continue
        var sampled = resample(subpath.points, spacing)
        var phase = pass * 11.3 + index * 3.9
        var jittered = roughen(sampled.points, sampled.hard, random, settings, phase)
        if (solid) {
          data += (data ? ' ' : '') + smoothPathData(jittered, sampled.hard, false)
        } else {
          data += (data ? ' ' : '') + ribbonPathData(jittered, sampled.hard, random, settings, phase)
        }
      }
      if (!data) continue
      var attributes = { d: data }
      if (solid) {
        attributes.fill = 'none'
        attributes.stroke = settings.color
        attributes['stroke-width'] = formatNumber(settings.width)
        attributes['stroke-linecap'] = 'round'
        attributes['stroke-linejoin'] = 'round'
      } else {
        attributes.fill = settings.color
        attributes['fill-rule'] = 'nonzero'
        attributes.stroke = 'none'
      }
      if (settings.opacity !== undefined) attributes.opacity = formatNumber(settings.opacity)
      if (settings.className) attributes['class'] = settings.className
      this.push({ tag: 'path', attributes: attributes })
    }
    return this
  }

  Sketch.prototype.fillSubpaths = function (subpaths, random, options) {
    var fillStyle = options.fillStyle || 'hachure'
    if (fillStyle === 'none') return this
    var color = this.resolveColor(options.fill)
    var polygons = subpaths
      .filter(function (subpath) {
        return subpath.points.length > 2
      })
      .map(function (subpath) {
        return subpath.points
      })
    if (polygons.length === 0) return this

    if (fillStyle === 'solid') {
      var data = polygons
        .map(function (polygon) {
          return (
            'M ' +
            polygon
              .map(function (vertex) {
                return point(vertex[0], vertex[1])
              })
              .join(' L ') +
            ' Z'
          )
        })
        .join(' ')
      return this.push({
        tag: 'path',
        attributes: { d: data, fill: color, 'fill-rule': 'evenodd', stroke: 'none', opacity: options.fillOpacity === undefined ? null : formatNumber(options.fillOpacity) }
      })
    }

    var gap = options.fillGap === undefined ? 9 : options.fillGap
    var angle = options.fillAngle === undefined ? -41 : options.fillAngle
    var weight = options.fillWeight === undefined ? 1.5 : options.fillWeight
    var lines = hachureSegments(polygons, angle, gap)
    if (fillStyle === 'cross-hatch') {
      lines = lines.concat(hachureSegments(polygons, angle + 90, gap))
    }

    var settings = this.strokeOptions({
      style: 'ink',
      width: weight,
      color: options.fill,
      roughness: options.fillRoughness === undefined ? 1.1 : options.fillRoughness,
      bowing: 0.9,
      pressure: 0,
      taper: 0,
      passes: 1,
      opacity: options.fillOpacity
    })

    if (fillStyle === 'dots') {
      var dots = []
      for (var line = 0; line < lines.length; line++) {
        var from = lines[line][0]
        var to = lines[line][1]
        var length = distance(from, to)
        var count = Math.max(1, Math.floor(length / gap))
        for (var dot = 0; dot < count; dot++) {
          var ratio = (dot + 0.5) / count
          var cx = from[0] + (to[0] - from[0]) * ratio + random.noise(0, line * 3 + dot) * gap * 0.22
          var cy = from[1] + (to[1] - from[1]) * ratio + random.noise(1, line * 3 + dot) * gap * 0.22
          var radius = weight * (0.75 + random.next() * 0.5)
          dots.push('M ' + point(cx - radius, cy) + ' a ' + formatNumber(radius) + ' ' + formatNumber(radius) + ' 0 1 0 ' + formatNumber(radius * 2) + ' 0 a ' + formatNumber(radius) + ' ' + formatNumber(radius) + ' 0 1 0 ' + formatNumber(-radius * 2) + ' 0')
        }
      }
      return this.push({ tag: 'path', attributes: { d: dots.join(' '), fill: color, stroke: 'none' } })
    }

    if (fillStyle === 'zigzag') {
      var chain = []
      for (var index = 0; index < lines.length; index++) {
        var segment = index % 2 === 0 ? lines[index] : [lines[index][1], lines[index][0]]
        chain.push(segment[0], segment[1])
      }
      if (chain.length < 2) return this
      return this.strokeSubpaths([{ points: chain, closed: false }], random, settings)
    }

    var subpathList = lines.map(function (segment, index) {
      var from = segment[0]
      var to = segment[1]
      var dx = to[0] - from[0]
      var dy = to[1] - from[1]
      var length = Math.sqrt(dx * dx + dy * dy) || 1
      var head = (random.noise(0, index * 1.7) * gap) / 2.6
      var tail = (random.noise(1, index * 1.7) * gap) / 2.6
      return {
        points: [
          [from[0] - (dx / length) * head, from[1] - (dy / length) * head],
          [to[0] + (dx / length) * tail, to[1] + (dy / length) * tail]
        ],
        closed: false
      }
    })
    return this.strokeSubpaths(subpathList, random, settings)
  }

  Sketch.prototype.drawSubpaths = function (subpaths, options, fillShape) {
    var random = this.randomFor(options)
    if (options && options.fill) this.fillSubpaths(fillShape || subpaths, random, options)
    var settings = this.strokeOptions(options)
    if (settings.width > 0) this.strokeSubpaths(subpaths, random, settings)
    return this
  }

  /** Walk on past the start of a closed shape, the way a pen loops around. */
  function addOvershoot(points, amount) {
    if (amount <= 0 || points.length < 2) return points
    var extended = points.slice()
    var walked = 0
    for (var index = 1; index < points.length && walked < amount; index++) {
      var step = distance(points[index - 1], points[index])
      if (walked + step <= amount) {
        extended.push([points[index][0], points[index][1]])
        walked += step
        continue
      }
      var ratio = step < 0.0001 ? 0 : (amount - walked) / step
      extended.push([
        points[index - 1][0] + (points[index][0] - points[index - 1][0]) * ratio,
        points[index - 1][1] + (points[index][1] - points[index - 1][1]) * ratio
      ])
      break
    }
    return extended
  }

  function overshootAmount(options, style) {
    var factor = options && options.overshoot !== undefined ? options.overshoot : 1
    var width = options && options.width !== undefined ? options.width : STYLE_DEFAULTS[style].width
    return factor * clamp(width * 1.7, 4, 16)
  }

  /* ------------------------------------------------------------------ primitives */

  Sketch.prototype.path = function (data, options) {
    return this.drawSubpaths(flattenPathData(data), options)
  }

  Sketch.prototype.line = function (x1, y1, x2, y2, options) {
    return this.drawSubpaths([{ points: [[x1, y1], [x2, y2]], closed: false }], options)
  }

  Sketch.prototype.polyline = function (points, options) {
    return this.drawSubpaths([{ points: points.slice(), closed: false }], options)
  }

  Sketch.prototype.polygon = function (points, options) {
    var style = options && (options.style === 'marker' || options.style === 'ink') ? options.style : this.style
    var loop = points.slice()
    loop.push([points[0][0], points[0][1]])
    var stroke = addOvershoot(loop, overshootAmount(options, style))
    return this.drawSubpaths([{ points: stroke, closed: true }], options, [{ points: loop, closed: true }])
  }

  Sketch.prototype.rect = function (x, y, width, height, options) {
    return this.polygon([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], options)
  }

  Sketch.prototype.ellipse = function (cx, cy, rx, ry, options) {
    var style = options && (options.style === 'marker' || options.style === 'ink') ? options.style : this.style
    var outline = flattenPathData(ellipsePathData(cx, cy, rx, ry))
    var stroke = outline.map(function (subpath) {
      return { points: addOvershoot(subpath.points, overshootAmount(options, style)), closed: true }
    })
    return this.drawSubpaths(stroke, options, outline)
  }

  Sketch.prototype.circle = function (cx, cy, radius, options) {
    return this.ellipse(cx, cy, radius, radius, options)
  }

  /**
   * The zigzag that stands in for a line of text in a fat marker sketch —
   * peaks, not a sine wave, the way a marker actually scribbles.
   */
  Sketch.prototype.squiggle = function (x, y, length, options) {
    options = options || {}
    var wavelength = options.wavelength === undefined ? 17 : options.wavelength
    var amplitude = options.amplitude === undefined ? 7 : options.amplitude
    var peaks = Math.max(2, Math.round((length / wavelength) * 2))
    var shape = makeRandom(this.seed + '/squiggle-' + this.callCount)
    var points = [[x, y]]
    for (var peak = 1; peak <= peaks; peak++) {
      var vary = 1 + shape.noise(0, peak * 1.9) * 0.3
      var slip = shape.noise(1, peak * 1.3) * wavelength * 0.14
      points.push([
        x + (length * peak) / peaks + slip,
        y + (peak % 2 === 0 ? amplitude : -amplitude) * vary
      ])
    }
    points.push([x + length, y])
    return this.polyline(points, mergeOptions(options, { bowing: options.bowing === undefined ? 0.3 : options.bowing }))
  }

  /** A curly brace whose spine sits on `x` and whose point faces `facing`. */
  Sketch.prototype.brace = function (x, top, bottom, options) {
    options = options || {}
    var facing = options.facing === 'left' ? -1 : 1
    var reach = (options.reach === undefined ? 16 : options.reach) * facing
    var middle = (top + bottom) / 2
    var data =
      'M ' + point(x, top) +
      ' C ' + point(x + reach * 0.7, top + (middle - top) * 0.18) +
      ' ' + point(x + reach * 0.55, middle - (middle - top) * 0.35) +
      ' ' + point(x + reach, middle - (middle - top) * 0.12) +
      ' L ' + point(x + reach * 1.5, middle) +
      ' L ' + point(x + reach, middle + (bottom - middle) * 0.12) +
      ' C ' + point(x + reach * 0.55, middle + (bottom - middle) * 0.35) +
      ' ' + point(x + reach * 0.7, bottom - (bottom - middle) * 0.18) +
      ' ' + point(x, bottom)
    return this.path(data, options)
  }

  Sketch.prototype.arrow = function (from, to, options) {
    options = options || {}
    var control = arrowControlPoints(from, to, options)
    var data =
      'M ' + point(from[0], from[1]) +
      ' C ' + point(control[0][0], control[0][1]) + ' ' + point(control[1][0], control[1][1]) + ' ' + point(to[0], to[1])
    this.path(data, options)
    if (options.head === false) return this
    var incoming = [to[0] - control[1][0], to[1] - control[1][1]]
    var length = Math.sqrt(incoming[0] * incoming[0] + incoming[1] * incoming[1]) || 1
    var ux = incoming[0] / length
    var uy = incoming[1] / length
    var size = options.headSize === undefined ? (options.style === 'marker' || (!options.style && this.style === 'marker') ? 22 : 14) : options.headSize
    var spread = 0.44
    var cos = Math.cos(spread)
    var sin = Math.sin(spread)
    var leftX = to[0] - size * (ux * cos - uy * sin)
    var leftY = to[1] - size * (uy * cos + ux * sin)
    var rightX = to[0] - size * (ux * cos + uy * sin)
    var rightY = to[1] - size * (uy * cos - ux * sin)
    var headOptions = mergeOptions(options, { bowing: 0.25, roughness: 0.6 })
    if (options.seed !== undefined) headOptions.seed = options.seed + '-head'
    return this.polyline([[leftX, leftY], [to[0], to[1]], [rightX, rightY]], headOptions)
  }

  function arrowControlPoints(from, to, options) {
    if (options.controls) return options.controls
    var dx = to[0] - from[0]
    var dy = to[1] - from[1]
    var curve = options.curve === undefined ? 's' : options.curve
    if (curve === 'straight') {
      return [[from[0] + dx / 3, from[1] + dy / 3], [from[0] + (dx * 2) / 3, from[1] + (dy * 2) / 3]]
    }
    var bow = options.bow === undefined ? 0.45 : options.bow
    if (curve === 'arc') {
      var midX = (from[0] + to[0]) / 2
      var midY = (from[1] + to[1]) / 2
      var offsetX = -dy * bow * 0.5
      var offsetY = dx * bow * 0.5
      return [[midX + offsetX, midY + offsetY], [midX + offsetX, midY + offsetY]]
    }
    // Both control points stay between the ends, so the arrival tangent always
    // points the way the arrow is travelling however the two points are placed.
    return [
      [from[0] + dx * bow, from[1] - dy * 0.05],
      [to[0] - dx * bow * 0.7, to[1] - dy * 0.3]
    ]
  }

  /* ------------------------------------------------------------------ text */

  Sketch.prototype.text = function (content, x, y, options) {
    options = options || {}
    var value = options.caps ? String(content).toUpperCase() : String(content)
    var lines = value.split('\n')
    var size = options.size === undefined ? 22 : options.size
    var weight = options.weight === undefined ? 400 : options.weight
    var letterSpacing = options.letterSpacing === undefined ? 0.045 : options.letterSpacing
    var lineHeight = (options.lineHeight === undefined ? 1.35 : options.lineHeight) * size
    var record = metricsFor(weight)
    var widths = lines.map(function (line) {
      return measureText(line, size, weight, letterSpacing)
    })
    var width = Math.max.apply(null, widths)
    var capHeight = (record.capHeight / METRICS.unitsPerEm) * size
    var align = options.align || 'start'
    var baselineMode = options.baseline || 'alphabetic'
    var block = capHeight + lineHeight * (lines.length - 1)
    var baseline = y
    if (baselineMode === 'top') baseline = y + capHeight
    else if (baselineMode === 'middle') baseline = y + capHeight / 2 - (block - capHeight) / 2
    function leftOf(lineWidth) {
      if (align === 'middle') return x - lineWidth / 2
      if (align === 'end') return x - lineWidth
      return x
    }
    var left = leftOf(width)

    var attributes = {
      x: formatNumber(leftOf(widths[0])),
      y: formatNumber(baseline),
      'font-family': FONT_FAMILY,
      'font-size': formatNumber(size),
      'font-weight': String(weight),
      'letter-spacing': formatNumber(letterSpacing * size),
      'font-kerning': 'none',
      fill: this.resolveColor(options.color),
      'xml:space': 'preserve'
    }
    if (options.opacity !== undefined) attributes.opacity = formatNumber(options.opacity)
    if (options.class) attributes['class'] = options.class
    if (lines.length === 1) {
      this.push({ tag: 'text', attributes: attributes, text: value })
    } else {
      this.push({
        tag: 'text',
        attributes: attributes,
        children: lines.map(function (line, index) {
          return {
            tag: 'tspan',
            attributes: {
              x: formatNumber(leftOf(widths[index])),
              y: formatNumber(baseline + lineHeight * index)
            },
            text: line
          }
        })
      })
    }

    var box = {
      x: left,
      y: baseline - capHeight,
      width: width,
      height: block,
      baseline: baseline + lineHeight * (lines.length - 1),
      capHeight: capHeight,
      lines: lines.length
    }
    var lastWidth = widths[widths.length - 1]
    var lastLeft = leftOf(lastWidth)
    if (options.underline) {
      var underlineOptions = typeof options.underline === 'object' ? options.underline : {}
      var pad = underlineOptions.pad === undefined ? size * 0.12 : underlineOptions.pad
      var drop = underlineOptions.drop === undefined ? size * 0.3 : underlineOptions.drop
      this.line(lastLeft - pad, box.baseline + drop, lastLeft + lastWidth + pad, box.baseline + drop, {
        style: underlineOptions.style || 'ink',
        width: underlineOptions.width === undefined ? Math.max(2.4, size * 0.13) : underlineOptions.width,
        color: underlineOptions.color === undefined ? options.color : underlineOptions.color,
        roughness: underlineOptions.roughness === undefined ? 0.7 : underlineOptions.roughness,
        bowing: underlineOptions.bowing === undefined ? 1.1 : underlineOptions.bowing,
        seed: options.seed === undefined ? undefined : options.seed + '-underline'
      })
      box.underlineY = box.baseline + drop
    }
    if (options.strike) {
      var strikeOptions = typeof options.strike === 'object' ? options.strike : {}
      this.line(lastLeft - size * 0.16, box.baseline - capHeight * 0.42, lastLeft + lastWidth + size * 0.16, box.baseline - capHeight * 0.42, {
        style: 'ink',
        width: strikeOptions.width === undefined ? Math.max(2.2, size * 0.11) : strikeOptions.width,
        color: strikeOptions.color === undefined ? 'accent' : strikeOptions.color,
        roughness: 0.8,
        bowing: 1,
        seed: options.seed === undefined ? undefined : options.seed + '-strike'
      })
    }
    return box
  }

  Sketch.prototype.callout = function (number, cx, cy, options) {
    options = options || {}
    var radius = options.radius === undefined ? 19 : options.radius
    var random = this.randomFor(options)
    var blob = []
    var steps = 16
    for (var step = 0; step < steps; step++) {
      var angle = (step / steps) * Math.PI * 2
      var wobble = 1 + random.noise(0, (step / steps) * 8) * 0.075
      blob.push([cx + Math.cos(angle) * radius * wobble, cy + Math.sin(angle) * radius * wobble * 0.98])
    }
    var data =
      'M ' +
      blob
        .map(function (vertex) {
          return point(vertex[0], vertex[1])
        })
        .join(' L ') +
      ' Z'
    this.push({
      tag: 'path',
      attributes: { d: data, fill: this.resolveColor(options.color), stroke: 'none', 'class': options.class || '' }
    })
    this.text(String(number), cx, cy, {
      size: radius * 1.25,
      weight: 700,
      align: 'middle',
      baseline: 'middle',
      letterSpacing: 0,
      color: options.numberColor || 'paper',
      seed: options.seed
    })
    return this
  }

  Sketch.prototype.image = function (href, x, y, width, height, options) {
    options = options || {}
    var attributes = {
      href: href,
      x: formatNumber(x),
      y: formatNumber(y),
      width: formatNumber(width),
      height: formatNumber(height),
      preserveAspectRatio: options.preserveAspectRatio || 'xMidYMid meet'
    }
    attributes['xlink:href'] = href
    if (options.class) attributes['class'] = options.class
    return this.push({ tag: 'image', attributes: attributes })
  }

  /* ------------------------------------------------------------------ output */

  Sketch.prototype.toSVG = function () {
    var attributes = {
      xmlns: SVG_NAMESPACE,
      'xmlns:xlink': XLINK_NAMESPACE,
      viewBox: '0 0 ' + formatNumber(this.width) + ' ' + formatNumber(this.height),
      width: formatNumber(this.width),
      height: formatNumber(this.height),
      style: '--shaping-natural-width:' + formatNumber(this.width) + 'px',
      'class': ('shaping-drawing ' + this.className).trim(),
      role: 'img'
    }
    if (this.label) attributes['aria-label'] = this.label
    var children = []
    if (this.label) children.push({ tag: 'title', attributes: {}, text: this.label })
    if (this.paper) {
      children.push({
        tag: 'rect',
        attributes: { x: 0, y: 0, width: formatNumber(this.width), height: formatNumber(this.height), fill: this.resolveColor(this.paper) }
      })
    }
    children = children.concat(this.nodes)
    return serialiseNode({ tag: 'svg', attributes: attributes, children: children })
  }

  Sketch.prototype.toHTML = function () {
    return this.toSVG()
  }

  Sketch.prototype.toElement = function () {
    return parseSVG(this.toSVG())
  }

  Sketch.prototype.mount = function (target) {
    return mount(target, this)
  }

  function parseSVG(markup) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('ShapingDrawing: toElement() needs a browser; use toSVG() outside one')
    }
    var parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    return parsed.documentElement
  }

  function resolveTarget(target) {
    if (typeof target === 'string') {
      if (typeof document === 'undefined') throw new Error('ShapingDrawing: mount() needs a browser')
      var found = document.querySelector(target)
      if (!found) throw new Error('ShapingDrawing: no element matches ' + target)
      return found
    }
    return target
  }

  function mount(target, drawing) {
    var host = resolveTarget(target)
    var node = drawing.toElement()
    host.appendChild(node)
    return node
  }

  /* ------------------------------------------------------------------ figure */

  function Figure(options) {
    this.drawing = options.drawing
    this.caption = options.caption || ''
    this.callouts = options.callouts || []
    this.className = options.class || ''
  }

  Figure.prototype.toHTML = function () {
    var markup = '<figure class="' + escapeText(('shaping-figure ' + this.className).trim()) + '">'
    markup += this.drawing.toHTML()
    if (this.callouts.length) {
      markup += '<ol class="shaping-callout-list">'
      this.callouts.forEach(function (entry) {
        markup += '<li>' + escapeText(entry) + '</li>'
      })
      markup += '</ol>'
    }
    if (this.caption) markup += '<figcaption>' + escapeText(this.caption) + '</figcaption>'
    return markup + '</figure>'
  }

  Figure.prototype.toElement = function () {
    if (typeof document === 'undefined') throw new Error('ShapingDrawing: toElement() needs a browser')
    var figure = document.createElement('figure')
    figure.setAttribute('class', ('shaping-figure ' + this.className).trim())
    figure.appendChild(this.drawing.toElement())
    if (this.callouts.length) {
      var list = document.createElement('ol')
      list.setAttribute('class', 'shaping-callout-list')
      this.callouts.forEach(function (entry) {
        var item = document.createElement('li')
        item.textContent = entry
        list.appendChild(item)
      })
      figure.appendChild(list)
    }
    if (this.caption) {
      var caption = document.createElement('figcaption')
      caption.textContent = this.caption
      figure.appendChild(caption)
    }
    return figure
  }

  Figure.prototype.mount = function (target) {
    var host = resolveTarget(target)
    var node = this.toElement()
    host.appendChild(node)
    return node
  }

  /* ------------------------------------------------------------------ breadboard */

  var BREADBOARD_DEFAULTS = {
    nameSize: 26,
    nameWeight: 500,
    affordanceSize: 21,
    affordanceWeight: 400,
    columnGap: 108,
    rowGap: 1.62,
    padding: 26,
    indent: 0.7
  }

  function normaliseAffordance(entry) {
    if (typeof entry === 'string') return { text: entry }
    return entry
  }

  function findPlace(places, reference) {
    if (typeof reference === 'number') return places[reference]
    for (var index = 0; index < places.length; index++) {
      if (places[index].name.toLowerCase() === String(reference).toLowerCase()) return places[index]
    }
    throw new Error('ShapingDrawing: breadboard has no place named ' + reference)
  }

  function findPlaceOf(places, reference) {
    return findPlace(places, Array.isArray(reference) ? reference[0] : String(reference).split('/')[0])
  }

  function findAffordance(places, reference) {
    if (Array.isArray(reference)) {
      var place = findPlace(places, reference[0])
      return place.affordances[reference[1]]
    }
    var parts = String(reference).split('/')
    var named = findPlace(places, parts[0])
    for (var index = 0; index < named.affordances.length; index++) {
      if (named.affordances[index].text.toLowerCase() === parts[1].toLowerCase()) return named.affordances[index]
    }
    throw new Error('ShapingDrawing: breadboard has no affordance ' + reference)
  }

  /**
   * Chapter 4 notation, and nothing more: places as underlined names,
   * affordances listed beneath them, connection lines from an affordance to
   * the place it takes you to. Words for everything, no pictures of UI.
   */
  function breadboard(spec) {
    var settings = {}
    Object.keys(BREADBOARD_DEFAULTS).forEach(function (key) {
      settings[key] = spec[key] === undefined ? BREADBOARD_DEFAULTS[key] : spec[key]
    })
    var letterSpacing = 0.06
    var indent = settings.nameSize * settings.indent
    var nameCap = (metricsFor(settings.nameWeight).capHeight / METRICS.unitsPerEm) * settings.nameSize
    var affordanceLead = settings.affordanceSize * settings.rowGap

    var places = spec.places.map(function (place) {
      var affordances = (place.affordances || []).map(normaliseAffordance)
      var name = String(place.name).toUpperCase()
      var nameWidth = measureText(name, settings.nameSize, settings.nameWeight, letterSpacing)
      var widest = 0
      affordances.forEach(function (affordance) {
        affordance.label = String(affordance.text).toUpperCase()
        affordance.width = measureText(affordance.label, settings.affordanceSize, settings.affordanceWeight, letterSpacing)
        if (affordance.width > widest) widest = affordance.width
      })
      return {
        name: name,
        source: place,
        accent: !!place.accent,
        dy: place.dy || 0,
        affordances: affordances,
        nameWidth: nameWidth,
        blockWidth: Math.max(nameWidth, indent + widest)
      }
    })

    var cursor = settings.padding
    var deepest = 0
    places.forEach(function (place) {
      place.x = cursor
      place.baseline = settings.padding + nameCap + place.dy
      place.underlineY = place.baseline + settings.nameSize * 0.3
      place.affordances.forEach(function (affordance, index) {
        affordance.x = place.x + indent
        affordance.baseline = place.underlineY + affordanceLead * (index + 1)
      })
      var lowest = place.affordances.length
        ? place.affordances[place.affordances.length - 1].baseline
        : place.underlineY
      if (lowest > deepest) deepest = lowest
      cursor += place.blockWidth + settings.columnGap
    })

    var width = spec.width === undefined ? cursor - settings.columnGap + settings.padding : spec.width
    var height = spec.height === undefined ? deepest + settings.padding + settings.affordanceSize * 0.5 : spec.height

    var sketch = new Sketch({
      seed: spec.seed,
      width: width,
      height: height,
      style: 'ink',
      ink: spec.ink,
      accent: spec.accent,
      paper: spec.paper,
      label: spec.label || 'Breadboard: ' + places.map(function (place) { return place.source.name }).join(' → '),
      class: 'shaping-breadboard ' + (spec.class || '')
    })

    places.forEach(function (place, placeIndex) {
      sketch.text(place.name, place.x, place.baseline, {
        size: settings.nameSize,
        weight: settings.nameWeight,
        letterSpacing: letterSpacing,
        color: place.accent ? 'accent' : 'ink',
        seed: 'place-' + placeIndex
      })
      sketch.line(place.x - settings.nameSize * 0.14, place.underlineY, place.x + place.nameWidth + settings.nameSize * 0.4, place.underlineY, {
        width: Math.max(2.8, settings.nameSize * 0.13),
        color: place.accent ? 'accent' : 'ink',
        roughness: 0.7,
        bowing: 1.2,
        seed: 'rule-' + placeIndex
      })
      place.affordances.forEach(function (affordance, affordanceIndex) {
        var box = sketch.text(affordance.label, affordance.x, affordance.baseline, {
          size: settings.affordanceSize,
          weight: settings.affordanceWeight,
          letterSpacing: letterSpacing,
          color: affordance.accent ? 'accent' : 'ink',
          seed: 'affordance-' + placeIndex + '-' + affordanceIndex
        })
        affordance.box = box
        if (affordance.struck) {
          sketch.line(box.x - 8, box.y + box.height + 3, box.x + box.width + 8, box.y - 3, {
            width: 3.2,
            color: 'accent',
            roughness: 0.9,
            bowing: 0.7,
            seed: 'struck-' + placeIndex + '-' + affordanceIndex
          })
        }
      })
    })

    ;(spec.connections || []).forEach(function (connection, index) {
      var origin = findPlaceOf(places, connection.from)
      var affordance = findAffordance(places, connection.from)
      var target = findPlace(places, connection.to)
      var from = [affordance.box.x + affordance.box.width + 14, affordance.box.baseline - affordance.box.capHeight * 0.28]
      var to = [target.x - 16, target.baseline - nameCap - 4]
      var dx = to[0] - from[0]
      var dy = to[1] - from[1]
      // Run right past the widest word in the column before climbing, so the
      // line never crosses the affordances it is leaving behind.
      var clear = Math.max(from[0] + 30, origin.x + origin.blockWidth + 34)
      sketch.arrow(from, to, {
        color: connection.accent ? 'accent' : 'ink',
        width: connection.width === undefined ? 2.6 : connection.width,
        controls: connection.controls || [
          [clear, from[1]],
          [to[0] - dx * 0.14, to[1] - dy * 0.42]
        ],
        roughness: 0.85,
        bowing: 0.8,
        headSize: 15,
        seed: 'connection-' + index
      })
    })

    return sketch
  }

  /* ------------------------------------------------------------------ annotate */

  /**
   * Chapter 6's move: a real screenshot with fat-marker drawing on top of it.
   * Marks are laid out in the screenshot's own pixel coordinates.
   */
  function annotate(spec) {
    var width = spec.width
    var height = spec.height
    if (!width || !height) throw new Error('ShapingDrawing: annotate() needs the image width and height')
    var sketch = new Sketch({
      seed: spec.seed,
      width: width,
      height: height,
      style: spec.style || 'marker',
      ink: spec.ink,
      accent: spec.accent,
      label: spec.label || spec.alt || '',
      class: 'shaping-annotation ' + (spec.class || '')
    })
    sketch.image(spec.src, 0, 0, width, height, { class: 'shaping-annotation-image' })
    var defaultColor = spec.color || 'accent'
    var defaultWidth = spec.markWidth === undefined ? 5 : spec.markWidth

    ;(spec.marks || []).forEach(function (mark, index) {
      var options = {
        color: mark.color === undefined ? defaultColor : mark.color,
        width: mark.stroke === undefined ? defaultWidth : mark.stroke,
        roughness: mark.roughness === undefined ? 1 : mark.roughness,
        bowing: mark.bowing === undefined ? 1 : mark.bowing,
        passes: mark.passes,
        seed: mark.seed === undefined ? 'mark-' + index : mark.seed
      }
      if (mark.type === 'box') {
        sketch.rect(mark.x, mark.y, mark.width, mark.height, options)
      } else if (mark.type === 'circle') {
        sketch.ellipse(mark.cx, mark.cy, mark.rx, mark.ry === undefined ? mark.rx : mark.ry, options)
      } else if (mark.type === 'arrow') {
        sketch.arrow(mark.from, mark.to, mergeOptions(options, { curve: mark.curve, bow: mark.bow, headSize: mark.headSize }))
      } else if (mark.type === 'line') {
        sketch.polyline(mark.points, options)
      } else if (mark.type === 'path') {
        sketch.path(mark.d, options)
      } else if (mark.type === 'label') {
        sketch.text(mark.text, mark.x, mark.y, {
          size: mark.size === undefined ? 34 : mark.size,
          weight: mark.weight === undefined ? 600 : mark.weight,
          align: mark.align,
          baseline: mark.baseline === undefined ? 'top' : mark.baseline,
          caps: mark.caps === undefined ? true : mark.caps,
          color: options.color,
          underline: mark.underline,
          seed: options.seed
        })
      } else if (mark.type === 'callout') {
        sketch.callout(mark.number, mark.cx, mark.cy, {
          radius: mark.radius,
          color: mark.color === undefined ? 'ink' : mark.color,
          seed: options.seed
        })
      } else {
        throw new Error('ShapingDrawing: unknown annotation mark type ' + mark.type)
      }
    })
    return sketch
  }

  function mergeOptions(base, extra) {
    var merged = {}
    Object.keys(base).forEach(function (key) {
      merged[key] = base[key]
    })
    Object.keys(extra).forEach(function (key) {
      if (extra[key] !== undefined) merged[key] = extra[key]
    })
    return merged
  }

  /* ------------------------------------------------------------------ exports */

  global.ShapingDrawing = {
    version: '1.0.0',
    sketch: function (options) {
      return new Sketch(options)
    },
    breadboard: breadboard,
    annotate: annotate,
    figure: function (options) {
      return new Figure(options)
    },
    render: function (target, drawing) {
      return drawing.mount(target)
    },
    measureText: measureText,
    fontMetrics: METRICS,
    Sketch: Sketch,
    Figure: Figure
  }
})(typeof globalThis !== 'undefined' ? globalThis : this)
