---
name: design-system
description: Follow the project's design system when building or changing UI. Use when creating pages, lists, forms, drawers, modals, badges, buttons, empty states, headings, or status indicators, when choosing icons, copy, button sizes, or breakpoints, when making a surface work on phones, tablets, or paper, or when the user mentions design system, UI patterns, visual consistency, typography, responsiveness, mobile, printing, or UX canon.
---

# Design System

The design system is not a component library — it is the set of patterns below. When a screen disagrees with these guidelines, the screen is wrong.

This file carries the design doctrine every project on this workflow shares: token discipline, the typography tiers, the closed status vocabulary, flow design, the responsive canon, print, motion, and the navigation shell. The project's own guidelines — its palette, its typeface, its component library, its concrete idioms, and where its tokens and shared components live — are in the project specifics below. How a specific idiom renders (how a status presents on a phone, for instance) is adjudicated in the project's guidelines, within the bounds of the doctrine here.

The app typeface is self-hosted and version-pinned, first in the font token with a metrics-matched fallback — never load a font from an external host, and never let a surface hardcode another family.

## Voice and tone

The app is a calm, professional tool for people doing their work. Quiet, restrained elevation — the project's guidelines set the exact border and shadow treatment — one accent at a time, no decoration for its own sake. Every state the user sees must be honest: a disabled button says why, a blocked record shows the reason, and the UI never claims something the server hasn't confirmed (optimistic UI is fine — it declares intent, not results).

## Token discipline

- Every color, radius, and elevation comes from the project's design tokens — never an ad-hoc value. The palette itself (primary, semantic colors, base ramp) is a project fact; every solid color pair must clear WCAG AA.
- Chrome uses the semantic token classes only.
- Text tiers: `text-heading` (headings differ by weight, not color), `text-muted`, `text-faint`. Metadata lines are `text-faint text-xs`; real secondary content is `text-muted text-sm`.
- Data visualization gets its own ramp, derived from the brand palette alongside the first chart — chrome never borrows it, and charts never borrow chrome's semantic classes.
- Radii come from the theme's tokens. Never `rounded-md`/`rounded-2xl` for cards.
- One surface recipe — the project's canonical border, background, and shadow combination — is used for every raised surface; dividers and non-raised hairlines drop the shadow.

## Typography

Use the `@utility` heading classes — never ad-hoc `font-semibold text-lg` and friends:

| Tier | Utility | Use |
|---|---|---|
| Page title | `h1` | one per page |
| Overlay title | `h2` | drawer/modal titles |
| Section heading | `h3` | sections within a page or drawer (`<h2 className="h3">`) |
| Card title | `h4` | titles inside dense cards |
| Group label | `h5` | eyebrow over a group of list rows ("Active · 3") |

`h6` does not exist. Numbers that align vertically (times, timers, counters, quantities) are tabular (`tabular-nums`), so they line up column-for-column and never change width as their value changes — check the project's guidelines for whether the body sets this globally.

**Marketing surfaces** (the signed-out landing page and future site pages) are the one place display type is allowed: heroes may use ad-hoc `font-bold text-4xl sm:text-5xl` scales and section headings `font-bold text-2xl`, and decorative card icons may be `size-5`. Everything else — tokens, surfaces, radii, copy rules — still applies. App chrome never uses display type.

## Page anatomy

**List page**: a title row — one `h1` with the page title taking `flex-1`, the header CTA (a link styled `btn btn-primary xl:btn-sm`) at its right — then the collection or its empty state, then pagination, then the `<Outlet />` for nested overlays.

**Detail page**: header is `flex flex-row-reverse flex-wrap items-start gap-4 sm:flex-row sm:items-center sm:gap-8` containing the back link, then a `min-w-48 flex-1` block with the `h1` title and a `text-faint text-xs` subtitle, then badges and in-row actions grouped in ONE cluster: `flex basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto`. Secondary actions are `btn btn-outline xl:btn-sm`, the primary is `btn btn-primary xl:btn-sm`. The `min-w-48` floor and the single cluster are both load-bearing: a basis-0 `flex-1` title block never triggers `flex-wrap` (content slides under the buttons instead), and ungrouped action siblings climb onto the title line — rendering left of the title — in the ~400–639px band.

Page containers are `flex flex-col gap-6`. The layout's `<main>` provides padding — pages never add outer padding.

## Lists

The collection element is the daisyUI list, not a table:

- Container: `ul.list` wrapped in the project's surface recipe.
- Row: `li.group flex list-row items-center`; the main link fills it (`flex-1`), first line plain, second line `text-faint text-xs` with parts joined by `·` (middle dot — never `•`).
- Row links on paginated lists preserve the current search params (`?page=`) — use the project's search-params-preserving link component.
- Hover-revealed row actions: `btn btn-ghost btn-sm btn-square opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` — always include `group-focus-within` so keyboard users can reach them. Icons `size-4`.
- Group labels above row groups use `h5` ("Completed · 4"). A row inside a labeled group does not repeat the group's status as a badge.
- Empty state: `<div className="empty">No X found.</div>` — the `empty` utility, as the ternary alternative to the list.

## Status vocabulary

Exactly four idioms — pick one, never invent a fifth:

1. **SLA pulse badge** for anything SLA-related (build a shared SLA-pulse component alongside the first SLA feature — a `badge badge-sm` colored by pulse state with a shared label map).
2. **Colored badge**: `badge badge-sm` + a per-state color map (semantic colors, `badge-ghost` for drafts/neutral states) — whether badges render soft or solid is the project's call, made once and held everywhere. Badges are never colorless.
3. **Dot + badge**: leading `status status-{color}` dot cell, trailing `badge badge-sm badge-outline`. The badge stays visible at every width — on phones fold it into a wrapping title or meta line; hiding it below `sm` is not a mobile treatment.
4. **Callout**: daisyUI `alert alert-warning|alert-error` for banners; a callout row may carry its remediation action inline as a button.

Never: text glyphs (`✓`/`○` — use lucide `CheckCircle2Icon`/`CircleDashedIcon`), colored plain-text status words, or custom tinted panels (`border-warning/30 bg-warning/5`).

Badges never wrap internally (a global `.badge` nowrap rule). The one sanctioned exception: a badge whose label is a long condition phrase gets `h-auto whitespace-normal` so the label wraps as a unit instead of overflowing.

Status renders a state the server derived — the UI vocabulary above presents it; it never invents client-side state.

## Buttons and verbs

- Primary `btn btn-primary xl:btn-sm` · secondary `btn btn-outline xl:btn-sm` · row icon `btn btn-ghost btn-sm btn-square`.
- `xl:btn-sm` is the sizing canon: in-flow and header CTAs render full-size (~40px) below the `xl` breakpoint so they look tappable on phones, compact at `xl+`. It applies app-wide — shared components included, so a sweep scoped to routes alone is incomplete. Controls sharing a row stay height-uniform: an outline or ghost sibling beside an `xl:btn-sm` primary gets `xl:btn-sm` too. Utility actions (list-row icons, danger-zone deletes, field-level picker triggers beside their input) stay `btn-sm` at every size; square icon buttons keep ~44px hit areas via one global rule — never add per-button hit-area hacks.
- Destructive trigger: `btn btn-ghost btn-sm text-error`. Inside a confirm dialog: `btn btn-error` beside a plain `btn` "Cancel".
- Verbs: header CTA "New"; modal titles "New X"/"Edit X"; submit "Create" (new), "Save" (edit), "Add" (attach); completing a step is "Complete".

## Destructive actions

Deleting a named **entity** (a record with an identity of its own — a user, a product, an order…) requires the shared confirm dialog. Removing a trivially recreatable **association or config row** (a schedule row, a membership, a sequence step) is instant, with optimistic UI. Never hand-roll a confirm dialog.

When the act requires a justification (skip, no-show, termination), the shared confirm dialog takes a reason label: it renders a required textarea labeled with it, posts the value as the reason, and keeps the confirm button disabled while empty.

## Overlays

- **Modal**: create/edit forms and small pickers — the CRUD canon. Its title component reserves the close-button corner — never a bare `h2`.
- **Modal width tiers** match content: the default (`max-w-xl`) fits standard single-column forms; confirms, label dialogs, and single-field forms get `sm:max-w-md`; multi-section forms get `sm:max-w-2xl`, with short sibling fields two-up (`grid gap-6 sm:grid-cols-2`) inside the wide tiers. The card's width is viewport-derived and definite at every breakpoint — content never sets it — so a caller only ever passes the tier's `sm:max-w-*` cap, never a width floor.
- **No buttons in a modal's title row** — the back/close control owns the top-right corner. A modal's primary action lives in a bottom `flex justify-end` row after the content.
- **Route drawer**: operational flows and browsable sub-entities. Don't mix: a flow launched from a drawer stays in a drawer.
- Confirm dialogs are inline components, not routes.

## Forms

The project's schema-driven form component is the form canon; labels `block font-medium text-muted`. Inline quick-add micro-forms are allowed for repetitive rows; their micro-labels are `span.text-faint text-xs`.

An isolated auto-saving field (blur/change commit, standing alone on a form) shows a transient saved indicator and rejects invalid values visibly (revert + anchored `text-error text-sm` message) — never swallow input silently. An **editable grid** — a table of values a person types straight into — follows the opposite discipline; see the editing idiom below.

Mutations follow the project's optimistic-UI conventions: deterministic action-only routes, submitted through the framework's fetchers. Live screens poll for revalidation; drawers over live data poll too.

## Flow design

**Editing idiom** — how a value gets edited:

- **In-place click-to-edit**, in two shapes:
  - A *single scalar field* (a name, SLA minutes), edited frequently, where the surrounding context must stay visible: blur-commit + "Saved HH:MM" stamp; on rejection, revert + anchored error.
  - An *editable grid* — a table of values a person works down, row after row — built from the project's editable-cell components inside one shared provider. It is fully optimistic: no saving indicator and no saved stamp anywhere on the grid, because the new value is the feedback and failure is the only event worth announcing. A refusal anchors to the cell that failed, never a toast, and never discards what was typed. Writes retry quietly against deterministic action-only routes built for safe repeats, Tab flows from cell to cell, and the caret lands on the character clicked. An idle cell is plain text — a borderless control wearing the page's typography — and a value the person may not change is plain text for real, never a fake-clickable control.
- **Overlay** (modal/drawer) for multi-field or cross-validated clusters — a schedule (date + time + location) is decided together.
- **Own route** for tasks with a lifecycle the user leaves and comes back to.
- Never in-place for destructive or hard-to-reverse acts.

**Feedback idiom** — how a mutation acknowledges:

- **Optimistic** for reversible, high-frequency, stay-put flips (presence, checklist ticks, activate/deactivate).
- **Navigation + flash** when the act changes the user's context (create → detail, complete → worklist) or the server computes the outcome (verdicts, slot assignment).
- Severity axis: where a silently-failed optimistic update could mislead an operator into a decision with real consequences, prefer the round-trip.

Flow rules:

- **One grammar for exceptional acts with a reason** (skip, no-show, terminate, waste, pause). If the act's only input is the reason: the shared confirm dialog with a reason label — tone `error` for irreversible acts, `primary` for recoverable ones. If the act needs further choices (dates, slots, people): a drawer.
- **No silent writes.** Every mutation acknowledges on the screen where it happened: optimistic flip, in-flight pending state on the control, "Saved HH:MM" stamp for blur-commit fields (set AFTER the response, never before), or navigation + flash. The one sanctioned exception is the editable grid, whose acknowledgement is the typed value itself. `navigate: false` + `?respond-with-json` with no UI echo is banned. Errors anchor to the control, not only a global flash.
- **Monitoring surfaces get lenses, task surfaces get drawers.** The route drawer (blurred modal overlay) stays canon for task flows. On a monitoring surface (a dashboard), overlays are non-blocking right-docked side panels — no backdrop blur, the page stays visible and live (polling continues) — because the operator acts while watching.
- **Remediation links carry a return path.** Cross-surface remediation uses a validated same-origin `return-to` search param honored by close/cancel/success. No teleports without a way back; deep links carry the record context.
- **Sticky action footer for leaf task screens.** Full-page operational leaves get a sticky bottom action bar inside the content column: verdict/reason text + the single primary CTA. Exceptional acts do NOT sit in the footer — they follow the exceptional-act grammar, visually quiet. The footer must clear the mobile bottom dock: `bottom-[calc(4rem+env(safe-area-inset-bottom))] xl:bottom-0`, never a plain `fixed bottom-0` — and verify at a narrow viewport (390×844) before calling it done.

## Responsive canon

Every surface holds this bar at 360×740, 375×667, 768×1024, 1024×768, 1280×800, 1440×900, and the ÷1.5 emulations of the phone/tablet sizes (240×493, 250×445, 512×683, 683×512 — how 150% browser zoom lays out). The bar is outcomes, not screenshots: a phone user completes the task without being worse off than on desktop.

- **Geometry floor**: `document.documentElement.scrollWidth === window.innerWidth` EXACTLY at every size. Popovers, dropdowns, and menus clamp on-canvas. Wide content scrolls only inside its own `overflow-x-auto` container — and a container wrapping a table with sticky cells also gets `isolate`, so the cells' z-index stays caged below the app chrome instead of painting over it and stealing its taps. `sr-only` text is absolutely positioned, so inside an element with no positioned ancestor it resolves against the page and silently widens `scrollWidth` — give the element it lives in `relative`; only the numeric probe catches this, never a screenshot.
- **Nothing hidden on phones**: mobile never amputates content that desktop shows. Rows wrap or stack; they never squeeze into word-per-line columns.
- **Bars break into deliberate rows**: when a header or toolbar must wrap below `sm`, design the resulting rows — anchor (logo, title) on one, ALL its peer controls together on the next — never a mix where flex-wrap strands some controls beside the anchor and drops the rest below. Group the controls in one `basis-full sm:basis-auto` wrapper so they travel as a unit.
- **Data lists stack below `sm`**: a table that is really a data list renders as a table at `sm+` (`hidden sm:block`) and stacked cards below (`sm:hidden`). Contained sideways scroll is reserved for true calendar/matrix/print surfaces. An **editable grid** is the exception: a table a person types down keeps its table shape at every size — its identifying line (name, quantity, unit) never stacks — and sheds secondary columns by priority, within a tap's reach, because a stack of cards cannot be worked down.
- **List rows carrying ≥2 icon actions stack below `sm`**: row `flex-col gap-2 sm:flex-row sm:items-center`, icons grouped in one `flex items-center gap-1` cluster, text block keeps `min-w-0 flex-1`.
- **Intrinsic floors, not `min-w-0`, when a flex sibling must wrap**: `min-w-0` lets a text block shrink under its own nowrap children (a badge), so the sibling stays inline and paints over them. Give the block a floor — `min-w-48` in page headers, `min-w-36` inside cards — so the flex line genuinely overflows and the sibling wraps below (add `ml-auto` to keep a wrapped action right-aligned). The failure band is often mid-range (~360–512px), not the narrowest size: probe there too.
- **No hover-only information on touch**: anything a `title=` tooltip or hover reveal carries must open on tap — use a click-toggle popover or make the value itself the trigger (dotted underline). `kbd` shortcut hints (⌘K) hide on coarse pointers.
- **Wrapping**: human names and titles wrap at word boundaries (`break-words`); `break-all` is reserved for identifiers (emails, lot codes, keys).
- **Alerts**: icon-led alerts stack with `alert-vertical sm:alert-horizontal`; text-first alerts use `grid-flow-row justify-items-start sm:grid-flow-col`. (daisyUI's `.alert:has(:nth-child(2))` two-column template pins a leading icon otherwise.)
- **Narrow dialogs list values as stacked labeled lines** — per item, a name line plus a `flex flex-wrap gap-x-3 text-xs tabular-nums` line of inline-labeled values — never fixed-width columns, which cannot fit a 400px confirm card, let alone a phone.
- **Keyboard proxy**: every form works at ~55% of the phone viewport height (e.g. 360×407) — what the on-screen keyboard leaves visible.
- **Grids inside `.list-row`**: daisyUI forces list-row children onto grid row 1, shattering any nested grid — give the nested grid `*:row-start-auto`.
- **Inputs are 16px** (`text-base` on form controls) so iOS never auto-zooms a focused field.
- **Icon-only controls** carry an accessible name (`aria-label` or `sr-only`) AND a mirrored `title` — except triggers already wrapped in the shared Radix Tooltip, where a `title` would double the tooltip.
- **Long values in native selects** need `appearance-none!`: daisyUI 5's `.select` uses `appearance: base-select` on Chromium, which ignores `text-overflow` and padding, hiding the value's tail under the built-in arrow.
- **Collapsible navigation closes on navigate**: key an uncontrolled `<details>` menu on the pathname (remount closes it) plus an `onClick` close for same-page hash taps, which never remount.
- **Breadcrumbs** render separators between items only — never a trailing one.

## Print

Paper is a rendering mode of a screen surface, never a surface of its own.

- **The page prints itself.** The route that shows the record is the route that prints it — never a parallel print route or a second render of the same content for paper. A `Print` action is a secondary button calling `window.print()`; app chrome drops through a page-level `@media print` block and sections shed their card frame (`print:border-0 print:p-0 print:shadow-none`).
- **Controls, actions, and helper text are `print:hidden`** — buttons, row actions, filters, hints, alerts, and every other invitation to act. What is left on the paper is the record.
- **An editor's printed face equals its viewer's.** Beside a `print:hidden` control, render the read-only face in a `hidden print:inline` twin: an unset editable cell prints the viewer's em-dash, never its placeholder invitation (an invite like "Describe this item" belongs on the screen, not on a document a customer reads), and an editable checkbox prints `Yes`/`No` rather than an empty box. A reader must not be able to tell the copy came off an editable screen.
- **Media prints as what it is.** A video prints the word "Video", not a black rectangle of transport controls; its name stays with the row that already carries it.

## Motion

Motion is platform-aware and canonical — follow these timings on new surfaces rather than inventing your own. Everything below collapses under `prefers-reduced-motion: reduce`.

- **Stack navigation.** In the shell, page transitions are stack pushes and pops keyed off the navigation direction: iOS is a 400ms `cubic-bezier(0.32, 0.72, 0, 1)` slide with the outgoing page held back at −33% parallax; Android a 300ms `cubic-bezier(0.2, 0, 0, 1)` short slide + fade; plain web keeps a 150ms cross-fade. Persistent chrome (navbar, dock) carries its own `view-transition-name`, so it never slides while the content transitions.
- **Overlays.** The drawer is a draggable bottom sheet below `sm` (400ms settle) and a right panel at `sm`+ (200ms). Route drawers and modals hold the settle-then-navigate contract — the exit animation finishes before the URL changes. A modal enters `scale(0.96)`→`1` + fade over 200ms and exits over 150ms.
- **Touch feedback.** Under `(pointer: coarse)`, controls get pressed physics: buttons scale to 0.97, dock items to 0.92, and nav/menu/list rows flash their background. Haptics fire through the shared haptics hook — selection on dock taps, notification on flash messages, medium impact on destructive confirms. New interactive surfaces follow both conventions.
- **Perceived speed.** Prefetch in tiers: `prefetch="viewport"` on persistent nav and mobile list rows, `prefetch="intent"` on other prominent links, never on mutating/action links.

## Shells and navigation

- **Sidebar groups.** Sidebar links are grouped under `h5` eyebrows when a shell has more than a handful of sections. Groups are permission-filtered; a group with no visible items disappears entirely — never render an orphan eyebrow.
- **Dock rules.** A shell's mobile dock contents are a rule, never a slice — a named sidebar group, or all permitted section items — permission-filtered like the sidebar. If the rule yields nothing, the dock disappears.
- **Cross-shell links never masquerade as sections.** Links to the app's other surfaces sit under their own `h5` eyebrow after a hairline separator — at the bottom of every sidebar and in every mobile menu. The eyebrow renders whenever at least one target exists.
- **The chooser.** `/` hard-redirects single-surface users; anyone with two or more surfaces gets a chooser, grouped under the same eyebrow grammar.
- **Index redirects.** A section index route redirects to the first menu item the user is permitted to see — never to a hardcoded section.
- **Breadcrumbs.** Pages three or more levels deep in a funnel render breadcrumbs directly above the detail header: `text-faint text-xs`, `›` separators, linked ancestors, unlinked current node. One or two levels deep, the back link alone is the idiom — breadcrumbs there are noise. Cross-reference jumps that leave the funnel carry a validated same-origin `return-to` honored by the back link, so the jump is a round trip; breadcrumbs still show the ancestry of the destination, not the journey taken.

## Icons

lucide-react only, `size-4` inline (`size-5` in navbars/docks). No heroicons, no hand-rolled SVGs.

## Datetimes

Format datetimes on the server, in the query or loader that produces them. No `new Date(...).toLocale*` in components, no timezone constants in route files, no client-clock comparisons. Display names (first + last name with email fallback) are computed server-side too.

## Copy

Write in the product's language and locale — a project fact — with correct spelling and accents. Use the product's established domain vocabulary: each term has one name, used everywhere, and the codebase is its source. Pluralize properly ("1 product", "3 products") — never "product(s)". Status strings describe state ("Awaiting review · Line busy"); they never issue commands.

Validation messages speak the user's language — "Choose an employee", "Enter an expected delivery date" — never schema-speak ("Invalid UUID", "Invalid ISO date"). Give user-facing zod fields explicit messages: `z.string().uuid('Choose an employee')`, `z.iso.date({ error: 'Enter an expected delivery date' })`.

## What NOT to copy

- Do not import a component library's stock variants the app deliberately doesn't use (`btn-soft`, `stat`, `hero`, native `<dialog>` modals, off-the-shelf `dropdown`/`tooltip` widgets) — absence from the codebase is a decision, not an oversight.
- daisyUI 4 classes are dead in v5: `input-bordered`, `select-bordered`, `textarea-bordered`, `form-control`, `label-text`, `rounded-btn`.
