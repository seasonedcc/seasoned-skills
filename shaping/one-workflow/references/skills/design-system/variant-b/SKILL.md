---
name: design-system
description: Follow the app design system when building or changing UI. Use when creating pages, lists, forms, drawers, modals, badges, buttons, empty states, headings, or status indicators, when choosing icons, copy, button sizes, or breakpoints, when making a surface work on phones, tablets, or paper, or when the user mentions design system, UI patterns, visual consistency, typography, responsiveness, mobile, printing, or UX canon.
---

# Design System

The app design system is not a component library — it is the set of patterns below. When a screen disagrees with this file, the screen is wrong. Tokens live in `app/app.css`; shared components live in `app/ui/`.

The palette is blue-600 interactivity and Tailwind-gray chrome with tinted pill badges. The mark is a lowercase letterform whose bowl is a vessel with a lot settled inside it — the promise that you can always see what is in the building. It is generated programmatically by `scripts/generateIcons.mts` (`pnpm run icons` regenerates `public/favicon.svg`, the PNG favicons, `public/logo.svg`, and `app/ui/app-logo.tsx` from one geometry — never hand-edit those outputs). Brand blue equals `primary` (#2563eb); the wordmark is the `text-logo` utility (lowercase, semibold, tight tracking) via `LogoLink`.

The app typeface is **Inter**, self-hosted and version-pinned via `@fontsource-variable/inter` and first in the `--font-sans` token with a metrics-matched Arial fallback — never load a font from an external host, and never let a surface hardcode another family. The pin is load-bearing beyond looks: identical font metrics on every machine keep docs-screenshot annotation placement deterministic. One deliberate exception: the thermal label sticker (`app/ui/label-sticker.tsx`) keeps Helvetica because its header-size heuristic is calibrated to Helvetica's character widths — re-derive that constant against real printed labels before ever re-pointing it.

## Voice and tone

The app is a calm, professional operations tool for people running their business. Quiet elevation (hairline `base-300` borders plus `shadow-sm` on raised surfaces, `--depth: 0` so controls stay flat), one accent at a time, no decoration for its own sake. Every state the user sees must be honest: a disabled button says why, a blocked record shows the reason, and the UI never claims something the server hasn't confirmed (optimistic UI is fine — it declares intent, not results).

## Tokens (app/app.css)

- daisyUI 5, single `light` theme. Primary `#2563eb` (blue-600 — the interactive color: CTAs, links, active nav, selection), neutral `#171717` (near-black), secondary `#9333ea` (purple-600), accent `#c2410c` (orange-700), info `#0369a1` (sky-700), success `#15803d` (green-700), warning `#b45309` (amber-700), error `#dc2626` (red-600). All content colors are white; every solid pair clears WCAG AA.
- Bases are the Tailwind gray ramp: white surfaces, `base-200` `#f9fafb` panels, `base-300` `#e5e7eb` borders, `base-content` `#111827`.
- Text tiers: `text-heading` (#111827 — headings differ by weight, not color), `text-muted` (#4b5563), `text-faint` (#6b7280). Metadata lines are `text-faint text-xs`; real secondary content is `text-muted text-sm`.
- There is no data-visualization ramp yet — derive one from the brand palette alongside the first chart. Chrome uses daisyUI semantic classes only.
- Radii come from the theme: fields are `0.5rem`, boxes are `rounded-box` (0.875rem), selectors (badges) are pills. The one override: checkboxes are squared (`0.25rem` in `@layer base`) so they don't read as radios. Never `rounded-md`/`rounded-2xl` for cards.
- Surface recipe: `rounded-box border border-base-300 bg-base-100 shadow-sm`. Dividers and non-raised hairlines are `border-base-300` without the shadow.

## Typography

Use the `@utility` heading classes — never ad-hoc `font-semibold text-lg` and friends:

| Tier | Utility | Use |
|---|---|---|
| Page title | `h1` | one per page |
| Overlay title | `h2` | drawer/modal titles |
| Section heading | `h3` | sections within a page or drawer (`<h2 className="h3">`) |
| Card title | `h4` | titles inside dense cards |
| Group label | `h5` | eyebrow over a group of list rows ("In production · 3") |

`h6` does not exist. Digits are tabular everywhere by default — `body` carries `font-variant-numeric: tabular-nums` in `app/app.css`, so every quantity, time, and code lines up column-for-column and never changes width as its value changes; never add a `tabular-nums` utility to get that, and never opt a surface out of it.

**Marketing surfaces** (the signed-out landing page and future site pages) are the one place display type is allowed: heroes may use ad-hoc `font-bold text-4xl sm:text-5xl` scales and section headings `font-bold text-2xl`, and decorative card icons may be `size-5`. Everything else — tokens, surfaces, radii, copy rules — still applies. App chrome never uses display type.

## Page anatomy

**List page**:

```tsx
<>
  <MetaTags title="Products" layout="app" />
  <div className="flex flex-col gap-6">
    <div className="flex items-center gap-4">
      <h1 className="h1 flex-1">Products</h1>
      <Link to={href('/app/products/new')} preventScrollReset className="btn btn-primary xl:btn-sm">New</Link>
    </div>
    {items.length > 0 ? <ul className="list …">…</ul> : <div className="empty">No products found.</div>}
    <Pagination {...pagination} />
  </div>
  <Outlet />
</>
```

**Detail page**: header is `flex flex-row-reverse flex-wrap items-start gap-4 sm:flex-row sm:items-center sm:gap-8` containing `BackLink`, then a `min-w-48 flex-1` block with the `h1` title and a `text-faint text-xs` subtitle, then badges and in-row actions grouped in ONE cluster: `flex basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto`. Secondary actions are `btn btn-outline xl:btn-sm`, the primary is `btn btn-primary xl:btn-sm`. The `min-w-48` floor and the single cluster are both load-bearing: a basis-0 `flex-1` title block never triggers `flex-wrap` (content slides under the buttons instead), and ungrouped action siblings climb onto the title line — rendering left of the title — in the ~400–639px band.

Page containers are `flex flex-col gap-6`. The layout's `<main>` provides padding — pages never add outer padding.

## Lists

The collection element is the daisyUI list, not a table:

- Container: `ul.list rounded-box border border-base-300 bg-base-100 shadow-sm`
- Row: `li.group flex list-row items-center`; the main link fills it (`flex-1`), first line plain, second line `text-faint text-xs` with parts joined by `·` (middle dot — never `•`).
- Row links on paginated lists use `SearchParamsLink` (preserves `?page=`).
- Hover-revealed row actions: `btn btn-ghost btn-sm btn-square opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` — always include `group-focus-within` so keyboard users can reach them. Icons `size-4`.
- Group labels above row groups use `h5` ("Completed · 4"). A row inside a labeled group does not repeat the group's status as a badge.
- Empty state: `<div className="empty">No X found.</div>` — the `empty` utility, as the ternary alternative to the list.

## Status vocabulary

Exactly four idioms — pick one, never invent a fifth:

1. **SLA pulse badge** for anything SLA-related (build an `SlaPulse` component alongside the first SLA feature — a `badge badge-sm` colored by pulse state with a shared label map).
2. **Colored badge**: `badge badge-sm badge-soft` + a per-state color map (`badge-primary|secondary|accent|info|success|warning|error`, `badge-ghost` for drafts/neutral states). Soft tinted pills are the canon — colored text on a tint of the same hue. Badges are never colorless, and solid badges are reserved for the SLA pulse.
3. **Dot + badge**: leading `status status-{color}` dot cell, trailing `badge badge-sm badge-outline`. The badge stays visible at every width — on phones fold it into a wrapping title or meta line; hiding it below `sm` is not a mobile treatment.
4. **Callout**: daisyUI `alert alert-warning|alert-error` for banners; a callout row may carry its remediation action inline as a button.

Never: text glyphs (`✓`/`○` — use lucide `CheckCircle2Icon`/`CircleDashedIcon`), colored plain-text status words, or custom tinted panels (`border-warning/30 bg-warning/5`).

Badges never wrap internally (a global `.badge` nowrap rule in `app/app.css`). The one sanctioned exception: a badge whose label is a long condition phrase gets `h-auto whitespace-normal` so the label wraps as a unit instead of overflowing.

Status is always derived from event rows (see the database-design skill) — the UI vocabulary above renders those derivations; it never invents client-side state.

## Buttons and verbs

- Primary `btn btn-primary xl:btn-sm` · secondary `btn btn-outline xl:btn-sm` · row icon `btn btn-ghost btn-sm btn-square`.
- `xl:btn-sm` is the sizing canon: in-flow and header CTAs render full-size (~40px) below the `xl` breakpoint so they look tappable on phones, compact at `xl+`. It applies app-wide — `app/ui` shared components included, so a sweep scoped to routes alone is incomplete. Controls sharing a row stay height-uniform: an outline or ghost sibling beside an `xl:btn-sm` primary gets `xl:btn-sm` too. Utility actions (list-row icons, danger-zone deletes, field-level picker triggers beside their input) stay `btn-sm` at every size; square icon buttons keep ~44px hit areas via a global `app/app.css` rule — never add per-button hit-area hacks.
- Destructive trigger: `btn btn-ghost btn-sm text-error`. Inside a confirm dialog: `btn btn-error` beside a plain `btn` "Cancel".
- Verbs: header CTA "New"; modal titles "New X"/"Edit X"; submit "Create" (new), "Save" (edit), "Add" (attach); completing a step is "Complete".

## Destructive actions

"Deleting" always means appending a discard/archival event — the record stays in history (see the database-design skill). The UI grammar is unchanged: discarding a named **entity** (product, recipe, purchase order, user…) requires the shared confirm dialog. Removing a trivially recreatable **association or config row** (a schedule row, a membership, a sequence step) is instant, with optimistic UI. Never hand-roll a confirm dialog.

When the act requires a justification (skip, no-show, waste, termination), pass `reasonLabel` to `ConfirmDialog` (`app/ui/confirm-dialog.tsx`): it renders a required textarea labeled with it, posts the value as `reason`, and keeps the confirm button disabled while empty.

## Overlays

- **Modal** (`app/ui/modal.tsx`): create/edit forms and small pickers — the CRUD canon. Body starts `<div className="relative flex flex-col gap-6">` + `ModalBackLink` + `ModalTitle` (which reserves the close-button corner — never a bare `h2`).
- **Modal width tiers** match content: the default (`max-w-xl`) fits standard single-column forms; confirms, label dialogs, and single-field forms get `sm:max-w-md`; multi-section forms get `sm:max-w-2xl`, with short sibling fields two-up (`grid gap-6 sm:grid-cols-2`) inside the wide tiers. The card's width is viewport-derived and definite at every breakpoint — content never sets it — so a caller only ever passes the tier's `sm:max-w-*` cap, never a width floor.
- **No buttons in a modal's title row** — `ModalBackLink` owns the top-right corner. A modal's primary action lives in a bottom `flex justify-end` row after the content.
- **RouteDrawer** (`app/ui/route-drawer.tsx`): operational flows and browsable sub-entities. Don't mix: a flow launched from a drawer stays in a drawer.
- Confirm dialogs are inline components, not routes.

## Forms

`SchemaForm` (`app/ui/schema-form.tsx`) is the form canon; labels `block font-medium text-muted`. Inline quick-add micro-forms are allowed for repetitive rows; their micro-labels are `span.text-faint text-xs`.

An isolated auto-saving field (blur/change commit, standing alone on a form) shows a transient saved indicator and rejects invalid values visibly (revert + anchored `text-error text-sm` message) — never swallow input silently. An **editable grid** — a table of values a person types straight into — follows the opposite discipline; see the editing idiom below.

Mutations follow the optimistic-ui skill: deterministic action-only routes, `useSubmit`/`useFetchers`, `?respond-with-json`. Live screens use `usePollingRevalidation`; drawers over live data poll too.

## Flow design

**Editing idiom** — how a value gets edited:

- **In-place click-to-edit**, in two shapes:
  - A *single scalar field* (a name, SLA minutes), edited frequently, where the surrounding context must stay visible: blur-commit + "Saved HH:MM" stamp; on rejection, revert + anchored error.
  - An *editable grid* — a table of values a person works down, like a recipe's ingredients — built from `EditableValue`/`EditableSelect` (`app/ui/editable-value.tsx`) inside one `EditableValueProvider`. It is fully optimistic: no saving indicator and no saved stamp anywhere on the grid, because the new value is the feedback and failure is the only event worth announcing. A refusal anchors to the cell that failed, never a toast, and never discards what was typed. Writes retry quietly against deterministic action-only routes built for safe repeats, Tab flows from cell to cell, and the caret lands on the character clicked. An idle cell is plain text — a borderless control wearing the page's typography — and a value the person may not change is plain text for real, never a fake-clickable control.
- **Overlay** (modal/drawer) for multi-field or cross-validated clusters — a schedule (date + time + location) is decided together.
- **Own route** for tasks with a lifecycle the user leaves and comes back to.
- Never in-place for destructive or hard-to-reverse acts.

**Feedback idiom** — how a mutation acknowledges:

- **Optimistic** for reversible, high-frequency, stay-put flips (presence, checklist ticks, activate/deactivate).
- **Navigation + flash** when the act changes the user's context (create → detail, complete → worklist) or the server computes the outcome (verdicts, slot assignment).
- Severity axis: where a silently-failed optimistic update could mislead an operator making food-safety or inventory decisions, prefer the round-trip.

Flow rules:

- **One grammar for exceptional acts with a reason** (skip, no-show, terminate, waste, pause). If the act's only input is the reason: `ConfirmDialog` with `reasonLabel` — tone `error` for irreversible acts, `primary` for recoverable ones. If the act needs further choices (dates, slots, people): a drawer.
- **No silent writes.** Every mutation acknowledges on the screen where it happened: optimistic flip, in-flight pending state on the control, "Saved HH:MM" stamp for blur-commit fields (set AFTER the response, never before), or navigation + flash. The one sanctioned exception is the editable grid, whose acknowledgement is the typed value itself. `navigate: false` + `?respond-with-json` with no UI echo is banned. Errors anchor to the control, not only a global flash.
- **Monitoring surfaces get lenses, task surfaces get drawers.** RouteDrawer (blurred modal overlay) stays canon for task flows. On a monitoring surface (a dashboard), overlays are non-blocking right-docked side panels — no backdrop blur, the page stays visible and live (polling continues) — because the operator acts while watching.
- **Remediation links carry a return path.** Cross-surface remediation uses a validated same-origin `return-to` search param honored by close/cancel/success. No teleports without a way back; deep links carry the record context.
- **Sticky action footer for leaf task screens.** Full-page operational leaves get a sticky bottom action bar inside the content column: verdict/reason text + the single primary CTA. Exceptional acts do NOT sit in the footer — they follow the exceptional-act grammar, visually quiet. The footer must clear the mobile bottom dock: `bottom-[calc(4rem+env(safe-area-inset-bottom))] xl:bottom-0`, never a plain `fixed bottom-0` — and verify at a narrow viewport (390×844) before calling it done.

## Responsive canon

Every surface holds this bar at 360×740, 375×667, 768×1024, 1024×768, 1280×800, 1440×900, and the ÷1.5 emulations of the phone/tablet sizes (240×493, 250×445, 512×683, 683×512 — how 150% browser zoom lays out). The bar is outcomes, not screenshots: a phone user completes the task without being worse off than on desktop.

- **Geometry floor**: `document.documentElement.scrollWidth === window.innerWidth` EXACTLY at every size. Popovers, dropdowns, and menus clamp on-canvas. Wide content scrolls only inside its own `overflow-x-auto` container — and a container wrapping a table with sticky cells also gets `isolate`, so the cells' z-index stays caged below the app chrome instead of painting over it and stealing its taps. `sr-only` text is absolutely positioned, so inside an element with no positioned ancestor it resolves against the page and silently widens `scrollWidth` — give the element it lives in `relative`; only the numeric probe catches this, never a screenshot.
- **Nothing hidden on phones**: mobile never amputates content that desktop shows. Rows wrap or stack; they never squeeze into word-per-line columns.
- **Bars break into deliberate rows**: when a header or toolbar must wrap below `sm`, design the resulting rows — anchor (logo, title) on one, ALL its peer controls together on the next — never a mix where flex-wrap strands some controls beside the anchor and drops the rest below. Group the controls in one `basis-full sm:basis-auto` wrapper so they travel as a unit; the visitor site header (`app/ui/site-shell.tsx`) is the reference.
- **Data lists stack below `sm`**: a table that is really a data list renders as a table at `sm+` (`hidden sm:block`) and stacked cards below (`sm:hidden`) — `inventory/counts/adjust.tsx` is the reference. Contained sideways scroll is reserved for true calendar/matrix/print surfaces. An **editable grid** is the exception: a table a person types down keeps its table shape at every size — its identifying line (name, quantity, unit) never stacks — and sheds secondary columns by priority, within a tap's reach, because a stack of cards cannot be worked down.
- **List rows carrying ≥2 icon actions stack below `sm`**: row `flex-col gap-2 sm:flex-row sm:items-center`, icons grouped in one `flex items-center gap-1` cluster, text block keeps `min-w-0 flex-1`.
- **Intrinsic floors, not `min-w-0`, when a flex sibling must wrap**: `min-w-0` lets a text block shrink under its own nowrap children (a badge), so the sibling stays inline and paints over them. Give the block a floor — `min-w-48` in page headers, `min-w-36` inside cards — so the flex line genuinely overflows and the sibling wraps below (add `ml-auto` to keep a wrapped action right-aligned). The failure band is often mid-range (~360–512px), not the narrowest size: probe there too.
- **No hover-only information on touch**: anything a `title=` tooltip or hover reveal carries must open on tap — use the click-toggle popover (`app/ui/column-help.tsx`) or make the value itself the trigger (dotted underline). `kbd` shortcut hints (⌘K) hide on coarse pointers.
- **Wrapping**: human names and titles wrap at word boundaries (`break-words`); `break-all` is reserved for identifiers (emails, lot codes, keys).
- **Alerts**: icon-led alerts stack with `alert-vertical sm:alert-horizontal`; text-first alerts use `grid-flow-row justify-items-start sm:grid-flow-col`. (daisyUI's `.alert:has(:nth-child(2))` two-column template pins a leading icon otherwise.)
- **Narrow dialogs list values as stacked labeled lines** — per item, a name line plus a `flex flex-wrap gap-x-3 text-xs tabular-nums` line of inline-labeled values — never fixed-width columns, which cannot fit a 400px confirm card, let alone a phone.
- **Keyboard proxy**: every form works at ~55% of the phone viewport height (e.g. 360×407) — what the on-screen keyboard leaves visible.
- **Grids inside `.list-row`**: daisyUI forces list-row children onto grid row 1, shattering any nested grid — give the nested grid `*:row-start-auto`.
- **Inputs are 16px** (`text-base` on SchemaForm controls) so iOS never auto-zooms a focused field.
- **Icon-only controls** carry an accessible name (`aria-label` or `sr-only`) AND a mirrored `title` — except triggers already wrapped in the shared Radix Tooltip, where a `title` would double the tooltip.
- **Long values in native selects** need `appearance-none!`: daisyUI 5's `.select` uses `appearance: base-select` on Chromium, which ignores `text-overflow` and padding, hiding the value's tail under the built-in arrow.
- **Collapsible navigation closes on navigate**: key an uncontrolled `<details>` menu on the pathname (remount closes it) plus an `onClick` close for same-page hash taps, which never remount.
- **Breadcrumbs** render separators between items only — never a trailing one.

## Print

Paper is a rendering mode of a screen surface, never a surface of its own.

- **The page prints itself.** The route that shows the record is the route that prints it — never a parallel print route or a second render of the same content for paper. A `Print` action is a secondary button calling `window.print()`; app chrome drops through a page-level `@media print` block and sections shed their card frame (`print:border-0 print:p-0 print:shadow-none`).
- **Controls, actions, and helper text are `print:hidden`** — buttons, row actions, filters, hints, alerts, and every other invitation to act. What is left on the paper is the record.
- **An editor's printed face equals its viewer's.** Beside a `print:hidden` control, render the read-only face in a `hidden print:inline` twin: an unset editable cell prints the viewer's em-dash, never its placeholder invitation (an invite like "Say what this recipe is" belongs on the screen, not on a customer's spec sheet), and an editable checkbox prints `Yes`/`No` rather than an empty box. A reader must not be able to tell the copy came off an editable screen.
- **Media prints as what it is.** A video prints the word "Video", not a black rectangle of transport controls; its name stays with the row that already carries it.

## Icons

lucide-react only, `size-4` inline (`size-5` in navbars/docks). No heroicons, no hand-rolled SVGs.

## Datetimes

Format in SQL with `to_char`, per the formatting-datetimes skill. No `new Date(...).toLocale*` in components, no timezone constants in route files, no client-clock comparisons. Display names (first + last name with email fallback) are computed in SQL too.

## Copy

US English. Use the product's established domain vocabulary — each term has one name, used everywhere, and the codebase is its source. Pluralize properly ("1 product", "3 products") — never "product(s)". Status strings describe state ("Awaiting QC · Line busy"); they never issue commands.

Validation messages speak the user's language — "Choose an employee", "Enter an expected delivery date" — never schema-speak ("Invalid UUID", "Invalid ISO date"). Give user-facing zod fields explicit messages: `z.string().uuid('Choose an employee')`, `z.iso.date({ error: 'Enter an expected delivery date' })`.

## What NOT to copy

- Do not resurrect generic daisyUI variants (`btn-soft`, `stat`, `hero`, native `<dialog>` modals, daisyUI `dropdown`/`tooltip`) — the app deliberately doesn't use them.
- daisyUI 4 classes are dead in v5: `input-bordered`, `select-bordered`, `textarea-bordered`, `form-control`, `label-text`, `rounded-btn`.
