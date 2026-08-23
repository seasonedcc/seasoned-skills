/* Shaping document behaviour: the technical toggle, the goal character count, the copy
   button, and opening every technical note before the page is printed.
   Loaded by shaping/<project-title>/index.html as ../assets/document.js — in the head and
   without defer, so the technical state is settled before the first paint. */

;(() => {
  const root = document.documentElement
  const GOAL_LIMIT = 4000
  const STORAGE_KEY = 'shaping-document-technical'

  const readStored = () => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }

  const remember = (state) => {
    try {
      localStorage.setItem(STORAGE_KEY, state)
    } catch {}
    try {
      const url = new URL(location.href)
      if (state === 'on') url.searchParams.delete('technical')
      else url.searchParams.set('technical', 'off')
      history.replaceState(null, '', url)
    } catch {}
  }

  const requested = new URLSearchParams(location.search).get('technical')

  root.classList.add('js')
  root.dataset.technical =
    requested === 'off' || (!requested && readStored() === 'off') ? 'off' : 'on'

  const wireToggle = () => {
    const toggle = document.querySelector('[data-technical-toggle]')
    if (!toggle) return
    const reflect = () => toggle.setAttribute('aria-checked', String(root.dataset.technical === 'on'))
    reflect()
    toggle.addEventListener('click', () => {
      root.dataset.technical = root.dataset.technical === 'on' ? 'off' : 'on'
      reflect()
      remember(root.dataset.technical)
    })
  }

  const wireGoal = () => {
    const goal = document.querySelector('[data-goal]')
    if (!goal) return

    const text = goal.querySelector('[data-goal-text]')
    const count = goal.querySelector('[data-goal-count]')
    const fill = goal.querySelector('[data-goal-meter-fill]')
    const copy = goal.querySelector('[data-goal-copy]')
    const number = (value) => value.toLocaleString('en-US')
    const goalText = () => text.innerText.replace(/\r\n/g, '\n').trim()

    const render = () => {
      const length = goalText().length
      const over = length - GOAL_LIMIT
      goal.classList.toggle('is-over', over > 0)
      count.textContent =
        over > 0
          ? `${number(length)} / ${number(GOAL_LIMIT)} characters — ${number(over)} over`
          : `${number(length)} / ${number(GOAL_LIMIT)} characters`
      fill.style.width = `${Math.min(100, (length / GOAL_LIMIT) * 100)}%`
    }

    render()

    if (!copy) return

    let restore
    const flash = (label) => {
      clearTimeout(restore)
      copy.textContent = label
      restore = setTimeout(() => {
        copy.textContent = 'Copy'
      }, 1600)
    }

    const copyByCommand = (value) => {
      const field = document.createElement('textarea')
      field.value = value
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.top = '0'
      field.style.opacity = '0'
      document.body.append(field)
      field.select()
      const copied = document.execCommand('copy')
      field.remove()
      return copied
    }

    copy.addEventListener('click', () => {
      const value = goalText()
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(
          () => flash('Copied'),
          () => flash(copyByCommand(value) ? 'Copied' : 'Copy failed')
        )
        return
      }
      flash(copyByCommand(value) ? 'Copied' : 'Copy failed')
    })
  }

  const wirePrinting = () => {
    const notes = () => Array.from(document.querySelectorAll('details.technical'))

    addEventListener('beforeprint', () => {
      for (const note of notes()) {
        if (note.open) continue
        note.dataset.openedForPrint = 'true'
        note.open = true
      }
    })

    addEventListener('afterprint', () => {
      for (const note of notes()) {
        if (!note.dataset.openedForPrint) continue
        delete note.dataset.openedForPrint
        note.open = false
      }
    })
  }

  const start = () => {
    wireToggle()
    wireGoal()
    wirePrinting()
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start)
  else start()
})()
