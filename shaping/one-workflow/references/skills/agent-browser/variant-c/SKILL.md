---
name: agent-browser
description: Automate browser interactions using the agent-browser CLI. Use when navigating pages, clicking elements, filling forms, taking screenshots, extracting page data, running browser tests, or verifying UI behavior. Use when the user mentions browser, agent-browser, test in browser, navigate, click, screenshot, interact with page, or automate.
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

Always use `--session <name>` to isolate browser sessions. Always close sessions when done.

```bash
agent-browser open https://example.com --session my-test
# ... interactions ...
agent-browser close --session my-test
```

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

Snapshot options:
- `-i` / `--interactive` — only interactive elements (preferred)
- `-c` / `--compact` — remove empty structural elements
- `-d <n>` / `--depth <n>` — limit tree depth
- `-s <sel>` / `--selector <sel>` — scope to CSS selector

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

## Key Commands

### Navigation
```bash
agent-browser open <url>          # navigate to URL
agent-browser back                # go back
agent-browser forward             # go forward
agent-browser reload              # reload page
```

### Interaction
```bash
agent-browser click <sel>         # click element
agent-browser type <sel> <text>   # type into element (appends)
agent-browser fill <sel> <text>   # clear and fill element
agent-browser press <key>         # press key (Enter, Tab, Escape)
agent-browser hover <sel>         # hover element
agent-browser select <sel> <val>  # select dropdown option
agent-browser check <sel>         # check checkbox
agent-browser uncheck <sel>       # uncheck checkbox
agent-browser scroll <direction>  # scroll up/down/left/right
```

### Get Information
```bash
agent-browser get text <sel>      # get text content
agent-browser get html <sel>      # get innerHTML
agent-browser get value <sel>     # get input value
agent-browser get attr <sel> <n>  # get attribute
agent-browser get title           # get page title
agent-browser get url             # get current URL
agent-browser get count <sel>     # count matching elements
```

### Check State
```bash
agent-browser is visible <sel>    # check visibility
agent-browser is enabled <sel>    # check if enabled
agent-browser is checked <sel>    # check if checked
```

### Capture
```bash
agent-browser screenshot [path]   # take screenshot
agent-browser screenshot --full   # full page screenshot
agent-browser pdf <path>          # save as PDF
```

### Waiting
```bash
agent-browser wait <sel>          # wait for element to appear
agent-browser wait 2000           # wait N milliseconds
```

### Debug
```bash
agent-browser console --session s1          # view console logs
agent-browser console --clear --session s1  # clear console buffer
agent-browser errors --session s1           # view page errors
agent-browser highlight <sel> --session s1  # highlight element
```

## Common Patterns

### Verify page content after navigation
```bash
agent-browser open http://localhost:4001/path --session test
agent-browser get text "h1" --session test
agent-browser screenshot --session test
agent-browser close --session test
```

### Fill a form and submit
```bash
agent-browser open http://localhost:4001/login --session test
agent-browser snapshot -i --session test
agent-browser fill @e2 "user@example.com" --session test
agent-browser fill @e3 "password123" --session test
agent-browser click @e4 --session test
agent-browser wait ".dashboard" --session test
agent-browser close --session test
```

### Extract structured data from a page
```bash
agent-browser open http://localhost:4001/page --session test
agent-browser eval "JSON.stringify({
  title: document.title,
  h1: document.querySelector('h1')?.textContent,
  links: document.querySelectorAll('a').length,
})" --session test
agent-browser close --session test
```

### Filter snapshot to find specific elements
```bash
agent-browser snapshot -i --session s1 2>&1 | grep "Submit"
```

### Wait for dynamic content then interact
```bash
agent-browser open http://localhost:4001/page --session test
agent-browser wait ".loaded-indicator" --session test
agent-browser snapshot -i --session test
# Now interact with dynamically loaded elements
agent-browser close --session test
```

## Authentication

### Basic login flow
```bash
agent-browser open https://app.example.com/login --session auth
agent-browser snapshot -i --session auth
agent-browser fill @e1 "user@example.com" --session auth
agent-browser fill @e2 "password123" --session auth
agent-browser click @e3 --session auth
agent-browser wait --load networkidle --session auth
agent-browser get url --session auth  # verify redirect to dashboard
```

### Save and restore auth state
```bash
# After logging in, save state for reuse
agent-browser state save ./auth-state.json --session auth

# Later, skip login by loading saved state
agent-browser state load ./auth-state.json --session auth
agent-browser open https://app.example.com/dashboard --session auth
```

For advanced patterns (OAuth, 2FA, cookies, token refresh), see [references/authentication.md](references/authentication.md).

## Known failure modes — rule these out before blaming the app

These automation artifacts reliably mimic real application bugs and have each burned significant debugging time:

- **Below-fold clicks silently miss.** A center-click on an element outside the viewport (common in tall dialogs/drawers) can land on the backdrop — dismissing the dialog instead of pressing its button. Scroll the target into view first, and treat any click that produces no DOM/network change as a suspected miss, not an app bug.
- **`fill("")` doesn't reliably clear a scripted input.** A handler that manages the field's value can swallow the programmatic clear, and Cmd+A doesn't select inside number inputs. Clear with trusted keystrokes: click into the field, press `End`, then `Backspace` repeatedly.
- **Programmatic value changes fire no events, so the page's handlers never run.** Assigning a field's value dispatches nothing, leaving any `change`/`input` listener — and the validation it gates — silent, so the submit no-ops with zero feedback. Pointer commands (`check`, `select`) can also trip an overlay's outside-click dismiss, and some widgets open on `pointerdown` rather than `click`. Drive the element as a user would; when that fails, use `eval` with a native value setter plus a dispatched event, submit via `form.requestSubmit()`, or POST the endpoint directly with the session cookie — and document the deviation.
- **Proof of a write is the POST plus the resulting row — never a screenshot.** A filled-in form can render perfectly and still be unsubmittable (an unregistered field cancels the submit with zero feedback). Confirm the mutation landed by re-fetching the page or checking the database.
- **`press Enter` for implicit form submission is unreliable.** It has left the field's value in place with no navigation, and has navigated the tab to `about:blank` and dropped the session cookies — reproduced against a minimal control form, so the tool, not the page, was the variable. Submit by clicking the form's submit button, or fall back to `eval` with `form.requestSubmit()`.
- **A 404/empty page in a multi-account app is often account scoping.** A fresh session's active account may not own the data under test — switch accounts before treating it as a bug.
- **Don't edit files the dev server watches while a browser session runs against it.** Django's `runserver` autoreloader restarts on any touched Python file, and a restart mid-run invalidates the session's state and poisons its results — queue the edits or give the browser run an isolated worktree.

## Anti-Patterns

- **Don't use `console` to extract data** — it's noisy and mixed with app logs. Use `eval` instead.
- **Don't forget to close sessions** — leaked sessions keep browser processes running.
- **Don't interact without snapshotting first** — refs change between page loads; always get fresh refs.
- **Don't use `--headed` in automated workflows** — headless is the default and preferred for agent use.

For the full CLI reference, see [references/cli-reference.md](references/cli-reference.md).
For authentication patterns, see [references/authentication.md](references/authentication.md).
