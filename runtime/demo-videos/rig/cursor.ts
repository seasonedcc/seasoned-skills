import type { BrowserContext, Page } from '@playwright/test'

/** Fully percent-encoded, quotes included. This string is interpolated into a
 *  script that is itself a string, and a bare quote of either kind would end a
 *  literal three levels down and take the whole overlay with it. */
const CURSOR_SVG =
  'data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2728%27%20height=%2728%27%20viewBox=%270%200%2028%2028%27%3E%3Cpath%20d=%27M6%203.2%2021.4%2013.9l-6.6.6%203.6%207.6-2.9%201.4-3.6-7.6-4.6%204.8z%27%20fill=%27%23111827%27%20stroke=%27%23ffffff%27%20stroke-width=%271.6%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E'

/** Chromium paints no pointer into a recording, so the rig draws one. It rides
 *  the real mouse events Playwright dispatches rather than being told where to
 *  go, which means the drawn cursor cannot drift from the one the page is
 *  actually reacting to.
 *
 *  It is installed as an init script, so it comes back on every navigation, and
 *  it remembers its last position through sessionStorage so a fresh document
 *  does not open with the pointer missing. */
const OVERLAY_SOURCE = `(() => {
  const KEY = 'demo-rig-cursor'
  const install = () => {
    if (document.getElementById('demo-rig-cursor')) return
    const style = document.createElement('style')
    style.textContent = [
      '#demo-rig-cursor{position:fixed;left:0;top:0;width:28px;height:28px;',
      'pointer-events:none;z-index:2147483647;will-change:transform;',
      'background-image:url("${CURSOR_SVG}");background-size:28px 28px;',
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}',
      '#demo-rig-ring{position:fixed;left:0;top:0;width:34px;height:34px;',
      'margin:-17px 0 0 -17px;border-radius:9999px;pointer-events:none;',
      'z-index:2147483646;border:2px solid rgba(37,99,235,.9);opacity:0;',
      'transform:scale(.3)}',
      '#demo-rig-ring.demo-rig-press{animation:demo-rig-press .5s ease-out}',
      '@keyframes demo-rig-press{0%{opacity:.9;transform:scale(.3)}',
      '100%{opacity:0;transform:scale(1.15)}}',
      '#demo-rig-clapper{position:fixed;left:0;top:0;width:48px;height:48px;',
      'background:#000;pointer-events:none;z-index:2147483647}',
      '[aria-label="Report a bug"]{display:none!important}',
    ].join('')
    document.documentElement.appendChild(style)

    const pointer = document.createElement('div')
    pointer.id = 'demo-rig-cursor'
    const ring = document.createElement('div')
    ring.id = 'demo-rig-ring'
    document.documentElement.appendChild(ring)
    document.documentElement.appendChild(pointer)

    const place = (x, y) => {
      pointer.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    }
    const remembered = sessionStorage.getItem(KEY)
    if (remembered) {
      const [x, y] = remembered.split(',').map(Number)
      place(x, y)
    } else {
      pointer.style.opacity = '0'
      ring.style.opacity = '0'
    }

    addEventListener(
      'mousemove',
      (event) => {
        pointer.style.opacity = '1'
        place(event.clientX, event.clientY)
        sessionStorage.setItem(KEY, event.clientX + ',' + event.clientY)
      },
      true
    )
    addEventListener(
      'mousedown',
      () => {
        ring.classList.remove('demo-rig-press')
        void ring.offsetWidth
        ring.classList.add('demo-rig-press')
      },
      true
    )
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install)
  } else {
    install()
  }
  window.__demoRigClapper = (visible) => {
    const existing = document.getElementById('demo-rig-clapper')
    if (!visible) {
      existing?.remove()
      return
    }
    if (existing) return
    const clapper = document.createElement('div')
    clapper.id = 'demo-rig-clapper'
    document.documentElement.appendChild(clapper)
  }
})()`

export async function installCursor(context: BrowserContext) {
  await context.addInitScript(OVERLAY_SOURCE)
}

/** The overlay is a script built by interpolation, so it can break without
 *  anything else breaking — and a take filmed with no cursor in it looks
 *  finished until someone watches it. Every scene checks before it rolls. */
export async function assertCursorDrawn(page: Page) {
  const drawn = await page.evaluate(
    'Boolean(document.getElementById("demo-rig-cursor")) && typeof window.__demoRigClapper === "function"'
  )
  if (!drawn) {
    throw new Error(
      'The cursor overlay is not on the page, so this take would have no pointer in it. Check the injected script in rig/cursor.ts.'
    )
  }
}
