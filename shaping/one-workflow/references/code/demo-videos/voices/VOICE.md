# The narrator

`emily.wav` is the one voice every demo video in this repo speaks with. It is
committed rather than downloaded so that a video rendered next year sounds like
a video rendered today, and so that the whole library sounds like one colleague
rather than a rotating cast.

## Where it comes from

| | |
|---|---|
| File | `voices/Emily.wav` in [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server) |
| Why this one | It is that project's `default_voice_id` — the voice the most widely used Chatterbox distribution (~1.4k stars) speaks with out of the box |
| Kind | A curated **synthetic** voice, per the project's own description of its `voices/` library. It is not a recording of an identifiable person, so no performer's likeness or right of publicity is in play |
| Licence | MIT, © 2025 devnen — the repository licence, with no separate notice carving the audio out. Copy, modify, and redistribution are all permitted with the notice retained; `LICENSE-emily.txt` beside this file carries it |
| Clip | 9.49 s, 44.1 kHz, mono, PCM 16-bit, unmodified upstream bytes |
| SHA-256 | `f1f7a7ded6a42051aab7de9a914b4e03498e226a642eda5135e2f4a7f7f1195b` |

Verify the file still matches upstream at any time:

```bash
shasum -a 256 voices/emily.wav
curl -sL https://raw.githubusercontent.com/devnen/Chatterbox-TTS-Server/main/voices/Emily.wav | shasum -a 256
```

## What we measured

Chatterbox clones from this clip, so the clip decides how the narrator sounds.
Measured over the sample: median f₀ 159 Hz, tracked with YIN — roughly 50 Hz
above the unmistakably male voices in the same library (Michael 109 Hz, Thomas
111 Hz). Chatterbox's own built-in default voice, the one baked into `conds.pt`,
is male, which is why a reference clip is not optional for us.

Numbers only go so far: pitch alone does not sort every voice in that library
cleanly, and nobody picks a narrator off a spectrogram. The pin is settled by
listening to the samples the rig produces. `voices/Olivia.wav` (160 Hz) and
`voices/Elena.wav` (197 Hz) from the same library are the alternates if this one
ever stops fitting — swapping means replacing this file and re-rendering, since
every existing video carries the old voice inside its rendered audio.
