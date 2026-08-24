---
name: agent-browser
description: Automate browser interactions using the agent-browser CLI, and keep its sessions and processes from leaking. Use when navigating pages, clicking elements, filling forms, taking screenshots, extracting page data, running browser tests, verifying UI behavior, or cleaning up leftover browser processes. Use when the user mentions browser, agent-browser, test in browser, navigate, click, screenshot, interact with page, automate, leaked or runaway browsers, Chrome eating memory, or killing processes.
---

# Agent Browser

Browser automation CLI for AI agents. Installed globally as `agent-browser`.

## Core Workflow

Every browser automation session follows this pattern:

```bash
agent-browser open <url> --session <name>
agent-browser snapshot -i --session <name>       # get interactive elements
agent-browser click @e5 --session <name>          # act on refs
agent-browser eval "document.title" --session <name>  # extract data
agent-browser close --session <name>              # always clean up
```

## Session Management

Run every command with `--session <name>`. Use ONE session for the whole run, named after the lane it belongs to, reused across every navigation and interaction — not a session per step or per surface. Close it before reporting results, so the report describes a machine already cleaned up.

```bash
agent-browser open https://example.com --session lane-7
# ... every interaction of the run ...
agent-browser close --session lane-7
```

A session left open keeps its Chrome processes and the agent-browser daemon alive for days, and they accumulate across runs until they exhaust the machine's memory. Long before that they poison unrelated test runs with timeouts. There is no cap on how many browser sessions may run at once — verified teardown, not rationing, is what keeps the machine healthy.

When a browser process must die outside `agent-browser close` — a leaked session, a wedged daemon — go through the workflow's browser sweep — `seasoned-skills sweep --browsers`, with `--kill` to act — which lists survivors and kills each one by its exact process id. Never kill by pattern: `pkill -f` and its relatives fire at processes nobody inspected, and a pattern that reads as narrowly scoped — a lane name, a server filename, a browser name — routinely matches unrelated long-running processes on the machine.

## Snapshot-First Pattern

Before interacting with any element, take a snapshot to get ref IDs:

```bash
# Get only interactive elements (buttons, links, inputs, etc.)
agent-browser snapshot -i --session s1

# Output example:
# - button "Submit" [ref=e3]
# - link "Home" [ref=e5]
# - combobox "Search" [ref=e7]

# Then act on refs
agent-browser click @e3 --session s1
agent-browser fill @e7 "search query" --session s1
```

> **Refs go stale after sleep/wait:** If a snapshot is taken, then a `sleep` or `wait` occurs, the refs may no longer be valid because the browser's internal element mapping drifts. Always take a fresh `snapshot -i` immediately before acting on refs.

> **A click can report "✓ Done" without acting.** On elements far below the fold in a long page (measured on nodes at y≈4,500 and y≈6,600), `click` returns success while nothing happens — in both the `@ref` and CSS-selector forms — even though the element's own handlers are attached and fire on a native `element.click()`. The exit status is therefore not evidence the interaction happened. Scroll the target into view first (`agent-browser eval "document.querySelector('<sel>').scrollIntoView()"`, then a fresh `snapshot -i`), and verify every click by its observable effect — the URL changed, `is checked` flipped, the expected element appeared — never by the ✓ alone.

Snapshot options:
- `-i` / `--interactive` — only interactive elements (preferred)
- `-c` / `--compact` — remove empty structural elements
- `-d <n>` / `--depth <n>` — limit tree depth
- `-s <sel>` / `--selector <sel>` — scope to CSS selector

Filter a long snapshot down to the elements you care about:

```bash
agent-browser snapshot -i --session s1 2>&1 | grep "Submit"
```

## Data Extraction with eval

**Always prefer `eval` over `console` for extracting data from pages.** `eval` returns structured data directly to stdout. `console` output is noisy and mixed with unrelated application logs.

```bash
# Get structured data
agent-browser eval "JSON.stringify(someObject)" --session s1

# Get text content
agent-browser eval "document.querySelector('h1').textContent" --session s1

# Run async code (return a Promise)
agent-browser eval "
  new Promise(resolve => {
    setTimeout(() => resolve('done'), 1000)
  })
" --session s1

# Query window globals
agent-browser eval "JSON.stringify(window.__WEB_VITALS__)" --session s1
```

## Element Selection

Three ways to select elements (in order of preference):

1. **Refs from snapshot** — `@e3` (most reliable after a snapshot)
2. **CSS selectors** — `button.submit`, `#login-form input[type=email]`
3. **Find locators** — `agent-browser find role button click --name Submit`

## Command reference

The full command surface lives in [references/cli-reference.md](references/cli-reference.md) — navigation, interaction, `get`, `is`, capture, waiting, find locators, mouse control, viewport and device settings, network interception, cookies and storage, tabs, tracing and recording, and every global flag. Read a command's shape there instead of guessing at it.

Login flows live in [references/authentication.md](references/authentication.md) — filling a login form, saving and restoring authenticated state with `state save` and `state load`, OAuth and SSO redirects, two-factor prompts, HTTP basic auth, cookie auth, token refresh, and the handling rules for credentials and state files. Always pass `state save`/`state load` an **absolute path in the scratchpad directory** — never a relative one. Relative paths resolve against the CLI's own working directory, not yours, and have landed state files full of session cookies inside repository checkouts.

## Known failure modes — rule these out before blaming the app

These automation artifacts reliably mimic real application bugs and have each burned significant debugging time:

- **Below-fold clicks silently miss — the costliest artifact on this list.** The default viewport is only 1280×577 and `click` never scrolls: it dispatches at the target's viewport-relative centre, so an element further down the page receives nothing and the event lands on `<html>` instead. Every probe an agent would reach for lies about it — the CLI prints `✓ Done`, `is visible` and `is enabled` both answer `true`, a full-page screenshot shows the button plainly, and the event is even `isTrusted: true`. Refs, CSS selectors, and `find role button click` all miss alike. Scroll first — `agent-browser scroll down 2000`, or `eval "document.querySelector('…').scrollIntoView({ block: 'center' })"` — then click, and confirm the target is genuinely under the cursor with `document.elementFromPoint` before believing a null result. Inside a dialog the same miss lands on the backdrop and dismisses it.
- **A failed submit moves the submit button.** Client validation errors render up among the fields, growing the page beneath them, so a button that was barely reachable drops below the fold and the retry misses too. Re-scroll before every retry rather than repeating the click.
- **"The submit button does nothing" is almost never the form.** Before suspecting the form library or the dev bundle: scroll the button into view and confirm `elementFromPoint` returns it; fill every required field, including ones inside repeated rows that an interactive snapshot lists without their `required` flag; and read the form's validation-error text across the whole form, not just near the button. `form.requestSubmit()` is a sound escape hatch and runs exactly the same validation — if it also does nothing, the form is telling you it is invalid, not that it is broken. This class of failure is identical on a dev server and a production build; a dev-only explanation is a sign the real cause has been missed.
- **`fill("")` doesn't reliably clear a scripted input.** A handler that manages the field's value can swallow the programmatic clear, and Cmd+A doesn't select inside number inputs. Clear with trusted keystrokes: click into the field, press `End`, then `Backspace` repeatedly.
- **`fill` doesn't fire the events debounced fields listen to.** `fill <sel> <text>` sets the value, but a debounced change handler (search boxes and kin) never sees a keystroke, so nothing submits — the field looks filled while the page never updates. Drive such fields with `type` (real key events), clearing any previous value first with the keystroke ritual above.
- **Programmatic value changes fire no events, so the page's handlers never run.** Assigning a field's value dispatches nothing, leaving any `change`/`input` listener — and the validation it gates — silent, so the submit no-ops with zero feedback. Pointer commands (`check`, `select`) can also trip an overlay's outside-click dismiss, and some widgets open on `pointerdown` rather than `click`. Drive the element as a user would; when that fails, use `eval` with a native value setter plus a dispatched event, submit via `form.requestSubmit()`, or POST the endpoint directly with the session cookie — and document the deviation.
- **Proof of a write is the POST plus the resulting row — never a screenshot.** A filled-in form can render perfectly and still be unsubmittable (an unregistered field cancels the submit with zero feedback). Confirm the mutation landed by re-fetching the page or checking the database.
- **`press Enter` for implicit form submission is unreliable.** It has left the field's value in place with no navigation, and has navigated the tab to `about:blank` and dropped the session cookies — reproduced against a minimal control form, so the tool, not the page, was the variable. Submit by clicking the form's submit button, or fall back to `eval` with `form.requestSubmit()`.
- **A 404 or empty page often means the record belongs to a different access scope than the session, not a broken route.** A fresh session's active account may not own the data under test — verify the record is in scope for the current session before treating it as a bug.
- **Don't edit HMR-watched files while a browser session runs against a dev server.** A reload mid-run invalidates the session's state and poisons its results — queue the edits or give the browser run an isolated worktree.
- **`set viewport` doesn't survive a later `open`.** Navigating resets the session to the default viewport, so a size-matrix sweep that sets the viewport before `open` silently measures every size at desktop dimensions. Set the viewport after each navigation, and re-set it after any further `open`.
- **`upload` into a hidden file input can report success while nothing is posted.** Both the CLI's `upload` and a hand-rolled `DataTransfer` + `change` dispatch have claimed success as the form submitted no file. An upload is a write like any other: prove it by the POST plus the stored document, never by the tool's exit status.

## Anti-Patterns

- **Don't use `console` to extract data** — it's noisy and mixed with app logs. Use `eval` instead.
- **Don't leave a session open, and don't kill browsers by pattern** — see Session Management.
- **Don't interact without snapshotting first** — refs change between page loads; always get fresh refs.
- **Don't trust a click's ✓ on deep-page elements** — scroll into view first and verify the effect; see the Snapshot-First callout.
- **Don't use `--headed` in automated workflows** — headless is the default and preferred for agent use.

## Where lessons go

Project-empirical lessons about this skill land in `workflow-content/agent-browser.md` through a pull request on the project — never by editing this file, which is regenerated on every upgrade. A lesson that turns out to be true of every project travels as an issue on the workflow package instead.
