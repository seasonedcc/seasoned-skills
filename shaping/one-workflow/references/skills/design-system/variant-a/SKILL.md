---
name: design-system
description: Follow the app's design system when building or changing UI. Use when creating pages, lists, forms, drawers, modals, badges, buttons, empty states, headings, or status indicators, when choosing icons or copy, or when the user mentions design system, UI patterns, visual consistency, typography, or UX canon.
---

# Design System

The app's design system is not a component library — it is the set of patterns below, extracted from the app's best screens. When a screen disagrees with this file, the screen is wrong. Tokens live in `app/app.css`; shared components live in `app/ui/`.

## Voice and tone

The product is a calm, professional clinical tool. Flat surfaces (`--depth: 0`), hairline borders, one accent at a time, no decoration for its own sake. Every state the user sees must be honest: a disabled button says why, a blocked client shows the reason, and the UI never claims something the server hasn't confirmed (optimistic UI is fine — it declares intent, not results).

## Tokens (app/app.css)

- daisyUI 5, single `light` theme. Primary `#3d3c78` (brand violet), secondary `#cc8430`, accent `#d4808e`. Semantic: info/success/warning/error.
- Text tiers: `text-heading` (#181818), `text-muted` (#5d5d5d), `text-faint` (#8e8e8e). Metadata lines are `text-faint text-xs`; real secondary content is `text-muted text-sm`.
- Brand ramp `brand-{violet,rose,amber,sky,coral,teal}` (+`-mid/-light/-bg`) — reserved for data visualization (score scales in care-results). Do not use it for chrome; chrome uses daisyUI semantic classes.
- Radii: buttons are pills; inputs, selects, textareas, and `btn-square`/`btn-circle` are `0.5rem` (overridden in `@layer base`); boxes are `rounded-box` (0.75rem). Never `rounded-md`/`rounded-2xl` for cards.
- Surface recipe: `rounded-box border border-base-content/5 bg-base-100`. The `/5` tint is canonical — never `/10`.

## Typography

Use the `@utility` heading classes — never ad-hoc `font-semibold text-lg` and friends:

| Tier | Utility | Use |
|---|---|---|
| Page title | `h1` | one per page |
| Overlay title | `h2` | drawer/modal titles |
| Section heading | `h3` | sections within a page or drawer (`<h2 className="h3">`) |
| Card title | `h4` | titles inside dense cards |
| Group label | `h5` | eyebrow over a group of list rows ("Em atendimento · 3") |

`h6` does not exist. Numbers that align vertically (times, timers, counters) get `tabular-nums`.

## Page anatomy

**List page** (reference: `app/routes/lab/protocols.tsx`):

```tsx
<>
  <MetaTags title="Protocolos" layout="lab" />
  <div className="flex flex-col gap-6">
    <div className="flex items-center gap-4">
      <h1 className="h1 flex-1">Protocolos</h1>
      <Link to={href('/lab/protocols/new')} preventScrollReset className="btn btn-primary btn-sm">Novo</Link>
    </div>
    {items.length > 0 ? <ul className="list …">…</ul> : <div className="empty">Nenhum protocolo encontrado.</div>}
    <Pagination {...pagination} />
  </div>
  <Outlet />
</>
```

**Detail page** (reference: `app/routes/venues/operate-rooms/room-stay.tsx`): header is `flex flex-row-reverse items-start gap-8 sm:flex-row sm:items-center` containing `BackLink`, then a `flex-1` block with the `h1` title and a `text-faint text-xs` subtitle, then badges/actions. Secondary actions are `btn btn-outline btn-sm`, the primary is `btn btn-primary btn-sm`.

Page containers are `flex flex-col gap-6`. The layout's `<main>` provides padding — pages never add outer padding.

## Lists

The collection element is the daisyUI list, not a table:

- Container: `ul.list rounded-box border border-base-content/5 bg-base-100`
- Row: `li.group flex list-row items-center`; the main link fills it (`flex-1`), first line plain, second line `text-faint text-xs` with parts joined by `·` (middle dot — never `•`).
- Row links on paginated lists use `SearchParamsLink` (preserves `?page=`).
- Hover-revealed row actions: `btn btn-ghost btn-sm btn-square opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` — always include `group-focus-within` so keyboard users can reach them. Icons `size-4`.
- Group labels above row groups use `h5` ("Concluída · 4"). A row inside a labeled group does not repeat the group's status as a badge.
- Empty state: `<div className="empty">Nenhum X encontrado.</div>` — the `empty` utility, as the ternary alternative to the list.

## Status vocabulary

Exactly four idioms — pick one, never invent a fifth:

1. **`SlaPulse`** (`app/ui/sla-pulse.tsx`) for anything SLA-related.
2. **Colored badge**: `badge badge-sm` + a per-state color map (`badge-ghost|primary|success|warning|error`). Badges are never colorless.
3. **Dot + badge**: leading `status status-{color}` dot cell, trailing `badge badge-sm badge-outline hidden sm:block` (dot alone on mobile).
4. **Callout**: daisyUI `alert alert-warning|alert-error` for banners; a callout row may carry its remediation action inline as a button.

Never: text glyphs (`✓`/`○` — use lucide `CheckCircle2Icon`/`CircleDashedIcon`), colored plain-text status words, or custom tinted panels (`border-warning/30 bg-warning/5`).

## Buttons and verbs

- Primary `btn btn-primary btn-sm` · secondary `btn btn-outline btn-sm` · row icon `btn btn-ghost btn-sm btn-square`.
- Destructive trigger: `btn btn-ghost btn-sm text-error`. Inside a confirm dialog: `btn btn-error` beside a plain `btn` "Cancelar".
- Verbs: header CTA "Novo/Nova" (gender-matched); modal titles "Novo X"/"Editar X"; submit "Criar" (new), "Salvar" (edit), "Adicionar" (attach); completing a step is "Concluir".

## Destructive actions

Deleting a named **entity** (venue, role, user, shift, protocol, locker bank…) requires the shared confirm dialog. Removing a trivially recreatable **association or config row** (schedule, block, membership, staffing toggle, sequence step) is instant, with optimistic UI. Never hand-roll a confirm dialog.

When the act requires a justification (skip, no-show, pause, desistência), pass `reasonLabel` to `ConfirmDialog` (`app/ui/confirm-dialog.tsx`): it renders a required textarea labeled with it, posts the value as `reason`, and keeps the confirm button disabled while empty.

## Overlays

- **Modal** (`app/ui/modal.tsx`): create/edit forms and small pickers — the lab CRUD canon. Body starts `<div className="relative flex flex-col gap-6">` + `ModalBackLink` + `<h2 className="h2">`.
- **RouteDrawer** (`app/ui/route-drawer.tsx`): operational flows and browsable sub-entities — the venue-shell canon. Don't mix: a flow launched from a drawer stays in a drawer.
- **SidePanel** (`app/ui/side-panel.tsx`): the monitoring lens — PANEL-ONLY. The Painel de Operações renders its children through `<Outlet />` as a non-modal right-docked column: no backdrop, no focus trap, close X + Escape, and the room map stays visible and polling while it is open. Never use it outside the panel; RouteDrawer stays canon everywhere else.
- Confirm dialogs are inline components, not routes.

## Forms

`SchemaForm` (`app/ui/schema-form.tsx`) is the form canon; labels `block font-medium text-muted`. Inline quick-add micro-forms are allowed for repetitive rows; their micro-labels are `span.text-faint text-xs`.

Auto-saving fields (blur/change commit) must show a transient saved indicator and reject invalid values visibly (revert + anchored `text-error text-sm` message) — never swallow input silently.

Mutations follow the optimistic-ui skill: deterministic action-only routes, `useSubmit`/`useFetchers`, `?respond-with-json`. Live screens use `usePollingRevalidation`; drawers over live data poll too.

## Flow design

**Editing idiom** — how a value gets edited:

- **In-place click-to-edit** (blur-commit + "Salvo HH:MM" stamp; on rejection, revert + anchored error) ONLY for a single scalar field, edited frequently, where the surrounding context must stay visible (prompt name, SLA minutes).
- **Overlay** (modal/drawer) for multi-field or cross-validated clusters — a schedule (date + time + room) is decided together.
- **Own route** for tasks with a lifecycle the user leaves and comes back to.
- Never in-place for destructive or hard-to-reverse acts.

**Feedback idiom** — how a mutation acknowledges:

- **Optimistic** for reversible, high-frequency, stay-put flips (presence, checklist ticks, activate/deactivate).
- **Navigation + flash** when the act changes the user's context (create → detail, conclude → worklist) or the server computes the outcome (verdicts, slot assignment).
- Severity axis: where a silently-failed optimistic update could mislead a clinical operator, prefer the round-trip.

Flow rules:

- **One grammar for exceptional acts with a reason** (skip, no-show, terminate, desistência, pause). If the act's only input is the reason: `ConfirmDialog` with `reasonLabel` — tone `error` for irreversible acts, `primary` for recoverable ones. If the act needs further choices (dates, slots, people): a drawer.
- **No silent writes.** Every mutation acknowledges on the screen where it happened: optimistic flip, in-flight pending state on the control, "Salvo HH:MM" stamp for blur-commit fields (set AFTER the response, never before), or navigation + flash. `navigate: false` + `?respond-with-json` with no UI echo is banned. Errors anchor to the control, not only a global flash.
- **Monitoring surfaces get lenses, task surfaces get drawers.** RouteDrawer (blurred modal overlay) stays canon for task flows. On a monitoring surface (the panel), overlays are non-blocking right-docked side panels — no backdrop blur, the page stays visible and live (polling continues) — because the operator acts while watching.
- **Remediation links carry a return path.** Cross-surface remediation (late → reschedule, banner → room details → assign) uses a validated same-origin `return-to` search param honored by close/cancel/success. No teleports without a way back; deep links carry the client/visit context.
- **Sticky action footer for leaf task screens.** Full-page operational leaves (room-stay) get a sticky bottom action bar inside the content column: verdict/reason text + the single primary CTA. Exceptional acts do NOT sit in the footer — they follow the exceptional-act grammar, visually quiet.

## Motion

Motion is platform-aware and canonical — follow these timings on new surfaces rather than inventing your own. Everything below collapses under `prefers-reduced-motion: reduce`.

- **Stack navigation.** In the shell, page transitions are stack pushes and pops keyed off the `data-nav-direction` attribute: iOS is a 400ms `cubic-bezier(0.32, 0.72, 0, 1)` slide with the outgoing page held back at −33% parallax; Android a 300ms `cubic-bezier(0.2, 0, 0, 1)` short slide + fade; plain web keeps a 150ms cross-fade. Persistent chrome (`.navbar`, `.dock`) carries its own `view-transition-name`, so it never slides while the content transitions.
- **Overlays.** `Drawer` (vaul) is a draggable bottom sheet below `sm` (400ms settle) and a right panel at `sm`+ (200ms). `RouteDrawer` and `Modal` hold the settle-then-navigate contract — the exit animation finishes before the URL changes. `Modal` enters `scale(0.96)`→`1` + fade over 200ms and exits over 150ms.
- **Touch feedback.** Under `(pointer: coarse)`, controls get pressed physics: `.btn` scales to 0.97, dock items to 0.92, and nav/menu/list rows flash their background. Haptics fire through `useHaptics()` — `selection` on dock taps, `notification-*` on flash messages, `impact-medium` on destructive confirms. New interactive surfaces follow both conventions.
- **Perceived speed.** Prefetch in tiers: `prefetch="viewport"` on persistent nav and mobile list rows, `prefetch="intent"` on other prominent links, never on mutating/action links.

## Shells and navigation

Three app shells — lab, venue, care — stay three layout files. No shared AppShell: the venue shell carries a header the others don't, and divergence is deliberate.

- **Sidebar groups.** Sidebar links are `nav-item`/`nav-item-active`, grouped under `h5` eyebrows when a shell has more than a handful of sections (the lab taxonomy: Atendimento · Catálogo · Inteligência · Hubs · Administração). Groups are permission-filtered; a group with no visible items disappears entirely — never render an orphan eyebrow.
- **Dock rules.** Every shell has a mobile dock, and its contents are a rule, never a slice: lab dock = the Atendimento group, permission-filtered; venue dock = all (≤4) permitted section items; care dock = all 3 items. If the rule yields nothing, the dock disappears.
- **The venue target device.** The venue shell's reference device is the **iPad Mini** (744×1133 logical pixels) — venue staff carry one all day to conduct patients' exams, so it is the primary device for QAing venue-shell UX. Design and verify venue surfaces at that viewport first; desktop and phone are secondary checks, not the baseline.
- **The venue header.** The venue shell — and only it — carries a slim persistent header: hub name as the you-are-here (spec: "nome do hub sempre visível"), the `PresenceControl` status chip (`app/ui/presence-control.tsx`) opening a popover, and a user menu (identity, "Outras áreas" targets, Sair). No clock: the target device already shows the OS clock, and a ticking client clock is hydration-sensitive chrome with no operational job.
- **"Outras áreas".** Cross-shell links (Lab, Área do cliente, venue targets via `VenueSwitcher`) never masquerade as sections. They sit under an `h5` "Outras áreas" eyebrow after a hairline separator — at the bottom of every sidebar, in every mobile menu, and in the venue header's user menu (`app/ui/other-areas.tsx`). The eyebrow renders whenever at least one target exists.
- **The chooser.** `/` hard-redirects single-surface users; anyone with two or more surfaces gets the chooser, grouped under the same eyebrow grammar: Lab · Operação · Minha saúde.
- **Index redirects.** A section index route redirects to the first menu item the user is permitted to see (`lab/index.ts`, `venues/venue-index.ts`) — never to a hardcoded section.
- **Breadcrumbs.** Pages three or more levels deep in a funnel (reference: protocol → sequence → step CMS) render `Breadcrumbs` (`app/ui/breadcrumbs.tsx`) directly above the detail header: `text-faint text-xs`, `›` separators, linked ancestors, unlinked current node. One or two levels deep, `BackLink` alone is the idiom — breadcrumbs there are noise. Cross-reference jumps that leave the funnel (e.g. room-type → step CMS) carry a validated `return-to` (`app/framework/return-to.ts`) honored by the `BackLink`, so the jump is a round trip; breadcrumbs still show the ancestry of the destination, not the journey taken.

## Icons

lucide-react only, `size-4` inline (`size-5` in navbars/docks). No heroicons, no hand-rolled SVGs.

## Datetimes

Format in SQL with `to_char`, per the formatting-datetimes skill. No `new Date(...).toLocale*` in components, no timezone constants in route files, no client-clock comparisons. Display names (first + last name with email fallback) are computed in SQL too.

## Copy

pt-BR with correct accents. The venue-operational surface calls a venue "hub" (the company's word); the lab config area lists "Locais". The company is referred to by its feminine-gendered product name ("a <Empresa>", "pela <Empresa>"). Pluralize properly ("1 cliente", "3 clientes") — never "cliente(s)". Status strings describe state ("Aguardando Triagem · Técnico ocupado"); they never issue commands.

## What NOT to copy

- `app/routes/design-system.tsx` was a stock daisyUI catalog unrelated to these patterns; it has been deleted. Do not resurrect generic daisyUI variants (`btn-soft`, `stat`, `hero`, native `<dialog>` modals, daisyUI `dropdown`/`tooltip`) — the app deliberately doesn't use them.
- daisyUI 4 classes are dead in v5: `input-bordered`, `select-bordered`, `textarea-bordered`, `form-control`, `label-text`, `rounded-btn`.
