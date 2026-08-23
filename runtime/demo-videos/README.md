# The narration rig

Turns narration text into a WAV spoken by the rig's narrator. It is the voice
half of `/demo-videos`, which produces a highlights cut and a full-length demo
for a scope of work. The half that films is [`rig/`](rig/README.md), and it is
what you want if you are writing a screenplay rather than debugging a voice.

Apple Silicon only — the speech and transcription models run on the Mac's GPU
through MLX. `ffmpeg` is also required, from Homebrew or anywhere on `PATH`.

## Setup

```bash
./setup.sh
```

Builds a virtualenv, installs the pinned dependencies, downloads about 3 GB of
model weights into `./models`, and checks the narrator voice against its pinned
checksum. Everything it creates is gitignored; re-run it any time.

## Narrating

```bash
./narrate.sh --text "This is the recipe list." --out out/scene-01.wav
./narrate.sh --text-file screenplay/scene-04.txt --language pt \
    --delivery precise --out out/scene-04.wav --json
```

`--delivery` picks how the narrator speaks: `colleague` (the default, 160 wpm),
`precise` for passages dense with numbers, `engaged` for the highlights cut.

`--json` prints the result for a person to read. Anything calling this from code
wants `--report <file>` instead: the speech model writes its own lines to stdout,
so stdout is not parseable. `--report` writes the same JSON to a file, and
`transcribe.sh` takes it too.

The `/demo-videos` language rule — the language explicitly asked for, else the
language the request was written in, else English — is settled before anything
reaches here, so `--language` is always explicit and defaults to English.

## Checking

```bash
./transcribe.sh --audio out/scene-01.wav --expect-file screenplay/scene-01.txt
```

Transcribes the narration back and compares it to what the screenplay asked
for. This is the gate in the skill's self-review: narration that does not
transcribe back to its line is a retake, not a judgement call. Pass
`--language pt` so spelled-out numbers compare rather than reading as errors.

```bash
./test.sh
```

Runs the rig's own tests — the comparator's reduction rules, no models, no
audio, under a second.

## How it fits together

`narration/engine.py` is the seam. An engine's whole job is `speak(request) ->
Speech`: text and a language in, a waveform out. Chunking long passages belongs
to the engine, because token ceilings differ between models. Everything after
that — retiming to one speaking rate, levelling, writing the file — happens once
in `narrate()`, so every scene of every video lands at the same pace and the
same loudness no matter which model spoke it.

`narration/chatterbox.py` is the engine we ship: Resemble AI's Chatterbox
Multilingual V3 (MIT, 23 languages, zero-shot voice cloning) through
Blaizzy/mlx-audio's Apple Silicon port. Qwen3-TTS is the named fallback — it
would arrive as one more module beside that one plus a line in `engines.py`.

`voices/emily.wav` is the narrator. It ships with the rig rather than being
downloaded so every video a project renders speaks with one voice, this year
and next. `voices/VOICE.md` records where it comes from and under what licence.

## What to know before you trust it

**Spell alphanumeric identifiers out in the screenplay.** This is the rig's
weakest point by a distance, and it bites in every language. Given the literal
string `V17`, three of eight English takes said something else — "B17", "V117"
— and every Portuguese take failed, producing "vezeti", "vê de sete", "VID7".
Written phonetically instead — "revision vee seventeen", "run P R seven",
"revisão vê dezessete" — eight of eight takes landed it. The transcriber then
writes what it hears back as `V17`, so the check reports a cosmetic difference
on that token. Read it and move on; that is the expected shape.

**Chatterbox occasionally repeats itself.** A take can run past the end of its
text and say a clause twice, which the transcript shows as a duplicated
sentence. It is stochastic, so a retake at a different `--seed` clears it. This
is exactly what the transcribe check is for; do not skip it.

**Pace is set here, not by the model.** Chatterbox reads at around 200 wpm and
wanders ±12% between takes, which is audible across a cut. The seam retimes
every take onto the delivery's target with ffmpeg's WSOLA stretch, clamped to
0.78–1.15x so a badly mismatched take is flagged rather than mangled. A take
that hits the clamp lands away from the target and says so: the report carries
`clamped: true` alongside `wordsPerMinute` and `targetWordsPerMinute`, and the
recording rig prints it. Next to an unclamped scene the pace change is audible,
so shorten or lengthen the line, or retake at another seed.

**Budget about 90 seconds of compute per minute of speech** on an M-series Mac,
varying between 60 and 120. A five-minute highlights cut is roughly eight
minutes of narration compute, and the first generation after loading is the
slowest.
