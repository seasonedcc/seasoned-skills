"""Chatterbox Multilingual V3 on MLX — the narration engine we ship with.

Resemble AI's Chatterbox is MIT-licensed and clones a voice from a few seconds
of reference audio, which is how every video in this repo ends up speaking with
the same narrator. Blaizzy/mlx-audio carries the Apple Silicon port, so this
runs on the Mac's GPU with no PyTorch in the tree.
"""

from __future__ import annotations

import mlx.core as mx
import numpy as np

from .audio import join_with_breath, split_for_synthesis, trim_silence
from .engine import NarrationRequest, Speech

MODEL = 'mlx-community/chatterbox-multilingual-v3'


class ChatterboxEngine:
    name = 'chatterbox-multilingual-v3-mlx'

    def __init__(self, model: str = MODEL):
        self.model = model
        self._loaded = None

    def languages(self) -> frozenset[str]:
        from mlx_audio.tts.models.chatterbox.chatterbox import SUPPORTED_LANGUAGES

        return frozenset(SUPPORTED_LANGUAGES)

    def _weights(self):
        if self._loaded is None:
            from mlx_audio.tts.utils import load_model

            self._loaded = load_model(self.model)
        return self._loaded

    def speak(self, request: NarrationRequest) -> Speech:
        delivery = request.delivery
        chunks = split_for_synthesis(request.text, delivery.chunk_character_budget)
        if not chunks:
            raise ValueError('Nothing to narrate: the request carries no text.')

        model = self._weights()
        waveforms: list[np.ndarray] = []
        sample_rate = 0

        for index, chunk in enumerate(chunks):
            mx.random.seed(request.seed + index)
            for result in model.generate(
                text=chunk,
                ref_audio=str(request.voice_reference),
                lang_code=request.language,
                exaggeration=delivery.exaggeration,
                cfg_weight=delivery.cfg_weight,
                temperature=delivery.temperature,
                repetition_penalty=delivery.repetition_penalty,
                min_p=delivery.min_p,
                top_p=delivery.top_p,
                verbose=False,
            ):
                sample_rate = result.sample_rate
                audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
                waveforms.append(trim_silence(audio, sample_rate))

        if not sample_rate:
            raise RuntimeError(
                f'{self.model} returned no audio for {len(chunks)} chunk(s) of text.'
            )

        return Speech(
            waveform=join_with_breath(
                waveforms, sample_rate, delivery.chunk_gap_seconds
            ),
            sample_rate=sample_rate,
            chunks=len(chunks),
        )
