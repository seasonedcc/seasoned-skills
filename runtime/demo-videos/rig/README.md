# The recording rig

Films a screenplay. The narration half — turning a line into a WAV spoken by the
rig's narrator — lives one directory up and is documented in
[`../README.md`](../README.md); this half performs the scene in a browser, cuts
the footage to the narration, and assembles the video.

```bash
# Serve a production build of the product over HTTP in one terminal, then:
pnpm run demo:video rig-sample proof
```

`demo:video` is the project's script for
`tsx .claude/skills/demo-videos/scripts/rig/run.ts` — the rig is generated into
`.claude/skills/demo-videos/scripts/`, and everything here is written from that
location.

`rig-sample/proof` is the test card: three scenes, about eighty seconds,
against the seeded development product. Watch it before trusting a change to
anything here.

## Where a video lives

Source is committed under the project root's `demo-videos/<slug>/`:

```
demo-videos/rig-sample/
  production.ts     the product commit, resolution, pacing, engine and model pin
  proof.ts          a screenplay — one per cut, named by the cut
  SCOPE.md          what is in scope, where it came from, the narrative decisions
  DEMO-STATE.md     the demo state every scene needs, and how to reproduce it
```

Everything the rig makes is derived and gitignored, under
`.claude/skills/demo-videos/scripts/out/<slug>/<cut>/`: `footage/` (raw takes), `narration/`
(WAVs and the record of what each was spoken from), `cuts/` (each scene synced
to its narration), `frames/` (stills for the self-review), the finished `.mp4`,
and `report.json`.

Every time a cut is assembled, the finished video is copied back beside the
screenplay it was filmed from, so the video is where its source is:

```
demo-videos/rig-sample/2026-08-18-rig-sample-proof.mp4
```

That copy is gitignored too, and it is the one to hand over. It is named for
somebody who will only ever see the file — the day it was assembled, the
project, the cut — because a video sent to a colleague travels without the
folder that explained it. Assembling again the same day replaces that day's
file; assembling on a later day writes a new one and leaves the earlier days
where they are.

`report.json` is the run's account of itself: every move, the second its cue
falls on, the second it actually started, and the drift between them.

## The session module

The rig signs the actor in directly — no login is ever filmed — and how to sign
in is the product's to say, not the rig's. The project commits one small module
beside its screenplays, at `demo-videos/session.ts`, and the rig loads it from
there by path. Its contract:

- **Default export** — an async function taking the screenplay's actor,
  `{ userEmail: string; companyName: string }` (the `Actor` type in
  [`screenplay.ts`](screenplay.ts)), and returning one cookie for Playwright's
  `context.addCookies`: the product's session, signed the way the product signs
  it (the `SessionCookie` type in [`session.ts`](session.ts)).
- **Optional named export `close`** — an async function called once after the
  run, for a module that opened a database connection to look the actor up.

```ts
// demo-videos/session.ts — owned by the project, committed with the screenplays
import type { Actor } from '../.claude/skills/demo-videos/scripts/rig/screenplay'

export default async function sessionCookie(actor: Actor) {
  // Look the actor's user and company up; fail loudly when they are missing,
  // pointing at the project's DEMO-STATE.md — the screenplay author needs to
  // know what state the demo database is supposed to be in.
  // Then build the session the way the product does and return its cookie:
  return {
    name: '_app_session',
    value: 'whatever the product session machinery signed',
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  }
}
```

The module runs inside the rig's process, so it loads its own configuration;
the rig loads the project root's `.env` first when there is one. When an actor
is not in the database, throw a message that names what is missing and points
at `DEMO-STATE.md` — the errors are how a screenplay author finds out what
state the demo needs.

## The screenplay format

A screenplay is a TypeScript module exporting one `defineScreenplay({…})` as its
default. The types are in [`screenplay.ts`](screenplay.ts), which is the place to
read before writing one.

```ts
export default defineScreenplay({
  slug: 'rig-sample',
  cut: 'proof',
  title: 'Recording rig — test card',
  language: 'en',
  actor: { userEmail: 'dev@example.test', companyName: 'Acme Foods' },
  closingAsk: 'Tell me whether the pacing reads as human…',
  scenes: [ … ],
})
```

`closingAsk` is checked: the last scene's narration has to contain it, so a
video cannot ship without naming what feedback would help.

### A scene

```ts
{
  id: 'scene-02-search',
  beat: 'Show the cursor and the typing doing what a hand does.',
  narration: 'Search narrows the list as the letters land, with no button to press. …',
  delivery: 'colleague',
  needs: ['Two recipes match "Teriyaki".'],
  open: { path: '/app/production/recipes' },
  warm: ['/app/production/recipes/import'],
  choreography: [ … ],
  tail: 1.6,
}
```

- **`id`** names this scene's footage, narration and cut on disk, so a retake
  finds them again. Keep it stable.
- **`narration`** is what the narrator says. Spell alphanumeric identifiers out
  phonetically — `revision vee seventeen`, never `V17`. This is the rig's
  weakest point and it bites in every language; the parent README has the
  measurements.
- **`needs`** is the demo state this scene depends on, in prose, for a person to
  check against `DEMO-STATE.md`. Nothing verifies it. An empty list is a claim
  that the scene needs nothing the seed does not already give it.
- **`open.path`** is where the scene starts. The rig signs the actor in
  directly; no login is ever filmed. `open.as` overrides the screenplay's actor
  for one scene.
- **`warm`** lists routes the scene navigates into, opened once off camera
  before the take. Only matters against a dev server.
- **`tail`** is how long the footage holds after the narration ends, so a cut
  does not land on the last syllable.

### Moves

Choreography is written in the order the story is told, not the order a test
would click.

| Move | What it does |
| --- | --- |
| `{ do: 'point', at, hold? }` | Travels the cursor to something and rests on it |
| `{ do: 'click', at }` | Travels, waits a beat, clicks |
| `{ do: 'type', into, text }` | Clicks into a field and types it one key at a time |
| `{ do: 'press', key }` | A keystroke |
| `{ do: 'scroll', to }` | Smooth-scrolls something into the middle of the screen |
| `{ do: 'hold', seconds }` | Stays still |
| `{ do: 'expect', until }` | Waits for something to appear; moves no cursor |

Targets are `{ role, name }`, `{ text }`, `{ label }`, `{ placeholder }` or
`{ css }`, plus `nth` when more than one thing matches. Prefer the first four:
they survive a redesign that a CSS selector does not, and when they stop
matching it is because the product moved, which is what a refresh run wants to
be told.

`expect` is worth using after anything that navigates or mutates. It proves the
product actually did the thing, and it costs no screen time.

### Sync

Every move can say when it happens:

- **`cue: 'search it by name'`** — a verbatim fragment of this scene's
  narration. The move lands as the narrator reaches it. A cue that is not in the
  narration fails the run rather than being ignored.
- **`atSecond: 12.5`** — a hard offset from the top of the scene, for the rare
  move no phrase describes.
- **neither** — it follows the move before it.

Narration leads and footage follows. The take is spoken before the camera rolls,
so the rig knows exactly how long the scene is and what second each cue falls
on; a move that is early waits, and a move that runs long makes the ones after
it late rather than being dropped. A `point` with no explicit `hold` rests on
what it is showing until the narrator reaches the next cue, which is what a hand
does.

**Read the drift in `report.json` and fix the screenplay, not the rig.** Drift is
the report that a scene's choreography cannot keep up with its own narration —
usually three things named in one breath with a second and a half of travel
between them. Lengthen the sentence or drop a move.

## Retakes

```bash
pnpm run demo:video rig-sample proof --scene scene-02-search   # one scene, then reassemble
pnpm run demo:video rig-sample proof --assemble                # reassemble what is on disk
pnpm run demo:video rig-sample proof --check                   # listen back to every scene
pnpm run demo:video rig-sample proof --refresh-narration       # speak every scene again
```

A retake reuses the narration when the words have not changed — the take is
fingerprinted by its text, language, delivery, voice, engine and seed — which is
the difference between a ninety-second retake and a five-minute one. It re-films
only the named scene and assembles the whole cut again from the cuts on disk, so
the other scenes are not re-encoded from scratch.

`--check` transcribes every scene back and compares it to the screenplay. It is
the gate in the self-review: narration that does not come back as its line is a
retake, not a judgement call. It listens to the audio on disk, so it first holds
every scene's take fingerprint against the screenplay as it stands now — a scene
edited since it was last spoken refuses to be checked, rather than passing on
the line it used to have.

## How the sync is actually measured

Chromium will not say when it started recording — the video begins somewhere
inside the first few hundred milliseconds of a browser context's life. Rather
than estimate it, the performer flashes a black square in the corner of the page
just before it starts moving, and ffmpeg finds the frame where that square stops
being black. That frame is the top of the scene: the narration is muxed from
there and everything before it is cut away. A take whose clapper cannot be found
fails rather than being guessed at.

## Things that will bite

- **The cursor is drawn by an injected script, and that script is a string.** A
  stray quote three levels down breaks the whole overlay and the take films with
  no pointer in it — which looks finished until someone watches it. Every scene
  checks the overlay is on the page before it rolls; keep that check.
- **Serve the build over HTTP.** Many products redirect to HTTPS under their
  production configuration, and then the browser cannot connect; run the build
  in whatever mode keeps it on plain HTTP (`NODE_ENV=test`, typically).
- **A dev server compiles routes lazily.** The wait lands in the middle of a
  take. Use `warm`, or film a build.
- **The rig writes to two places, and both stay out of git.** Everything it
  makes goes under its own `out/`, inside the generated
  `.claude/skills/demo-videos/scripts/` tree, which the project gitignores as a
  whole; the finished video is copied to `demo-videos/<slug>/`, and that `.mp4`
  is the project's to gitignore beside its screenplays. Anything the rig writes
  anywhere else is a bug to report, not a file to commit.
- **The narrator's pace can clamp.** When a take reads too far off the
  delivery's target to be pulled all the way back, the run says so. Next to an
  unclamped scene the pace changes audibly; shorten the line or retake at
  another seed.
