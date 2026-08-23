"""The narration seam.

Everything upstream of this module — screenplays, the assembly rig, the skill —
knows only what is declared here: narration text and a language go in, a WAV
comes out, spoken by the one pinned narrator voice.

An engine's whole job is to turn text into a waveform. Pacing, levels, and
writing the file happen here, once, so that every scene of every video lands at
the same speaking rate and the same loudness no matter which model spoke it.
Swapping the speech model — Chatterbox today, Qwen3-TTS named as the fallback —
means writing one adapter with one `speak` method and registering it in
`engines.py`. Nothing else in the rig moves.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np
import soundfile

from .audio import normalize_peak, retime

RIG_ROOT = Path(__file__).resolve().parent.parent
PINNED_VOICE = RIG_ROOT / 'voices' / 'emily.wav'


@dataclass(frozen=True)
class Delivery:
    """How the narrator speaks.

    The defaults are tuned for a colleague talking you through a screen they
    know well: present, a little warm, never announcing.

    `exaggeration`, `cfg_weight`, `temperature`, `repetition_penalty`, `min_p`
    and `top_p` are sampling knobs an engine interprets. `words_per_minute` is
    not: Chatterbox reads at around 200 wpm and wanders by ±12% between takes,
    which is audible across a cut, so the seam retimes every take to land on one
    rate. 160 wpm is unhurried explanation — the pace of someone thinking about
    what they are showing you.
    """

    exaggeration: float = 0.35
    cfg_weight: float = 0.3
    temperature: float = 0.7
    repetition_penalty: float = 1.2
    min_p: float = 0.05
    top_p: float = 1.0
    chunk_character_budget: int = 280
    chunk_gap_seconds: float = 0.22
    words_per_minute: float = 160.0
    slowest: float = 0.78
    fastest: float = 1.15


DELIVERIES = {
    # The house voice.
    'colleague': Delivery(),
    # For dense passages of numbers and identifiers, where clarity beats colour.
    'precise': Delivery(
        exaggeration=0.25, temperature=0.6, words_per_minute=148.0
    ),
    # For the highlights cut, where the story wants a little more lift.
    'engaged': Delivery(
        exaggeration=0.5, temperature=0.8, words_per_minute=172.0
    ),
}


@dataclass(frozen=True)
class NarrationRequest:
    text: str
    language: str
    output_path: Path
    voice_reference: Path = PINNED_VOICE
    delivery: Delivery = Delivery()
    seed: int = 20260817

    def with_delivery(self, delivery: Delivery) -> NarrationRequest:
        return replace(self, delivery=delivery)


@dataclass(frozen=True)
class NarrationResult:
    output_path: Path
    duration_seconds: float
    sample_rate: int
    engine: str
    model: str
    chunks: int
    generation_seconds: float
    words_per_minute: float
    target_words_per_minute: float
    retimed_by: float
    #: The take was further from the delivery's pace than the retimer is allowed
    #: to pull it, so it lands at `words_per_minute` rather than the target. A
    #: cut with a clamped scene next to an unclamped one changes pace audibly.
    clamped: bool

    @property
    def realtime_factor(self) -> float:
        if self.generation_seconds <= 0:
            return 0.0
        return self.duration_seconds / self.generation_seconds


@dataclass(frozen=True)
class Speech:
    """What an engine hands back: raw audio and how many pieces it took."""

    waveform: np.ndarray
    sample_rate: int
    chunks: int


@runtime_checkable
class NarrationEngine(Protocol):
    """The whole contract an engine has to satisfy."""

    name: str
    model: str

    def languages(self) -> frozenset[str]:
        """ISO 639-1 codes this engine can speak."""

    def speak(self, request: NarrationRequest) -> Speech:
        """Say `request.text` in `request.language` as the reference voice."""


class UnsupportedLanguageError(ValueError):
    def __init__(self, engine: NarrationEngine, language: str):
        spoken = ', '.join(sorted(engine.languages()))
        super().__init__(
            f'{engine.name} does not speak {language!r}. It speaks: {spoken}.'
        )


def narrate(engine: NarrationEngine, request: NarrationRequest) -> NarrationResult:
    if request.language not in engine.languages():
        raise UnsupportedLanguageError(engine, request.language)
    if not request.voice_reference.exists():
        raise FileNotFoundError(
            f'Narrator reference audio missing: {request.voice_reference}'
        )

    delivery = request.delivery
    started = time.monotonic()
    speech = engine.speak(request)
    generation_seconds = time.monotonic() - started

    spoken = speech.waveform.size / speech.sample_rate
    words = len(request.text.split())
    wanted = words / delivery.words_per_minute * 60 if words else spoken
    asked = spoken / wanted if wanted else 1.0
    tempo = min(max(asked, delivery.slowest), delivery.fastest)

    narration = normalize_peak(retime(speech.waveform, speech.sample_rate, tempo))
    request.output_path.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(
        request.output_path, narration, speech.sample_rate, subtype='PCM_16'
    )

    duration = narration.size / speech.sample_rate
    return NarrationResult(
        output_path=request.output_path,
        duration_seconds=duration,
        sample_rate=speech.sample_rate,
        engine=engine.name,
        model=engine.model,
        chunks=speech.chunks,
        generation_seconds=generation_seconds,
        words_per_minute=words / duration * 60 if duration else 0.0,
        target_words_per_minute=delivery.words_per_minute,
        retimed_by=tempo,
        clamped=abs(tempo - asked) > 1e-6,
    )
