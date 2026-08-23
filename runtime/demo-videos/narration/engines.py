"""The engine registry.

Chatterbox Multilingual V3 is what we narrate with. Qwen3-TTS is the named
fallback: if Chatterbox stops being maintained, or a language it cannot speak
becomes load-bearing, the change is one new module beside `chatterbox.py` that
satisfies `NarrationEngine`, plus one line here. Callers keep asking for a name.
"""

from __future__ import annotations

from .engine import NarrationEngine

DEFAULT_ENGINE = 'chatterbox'


def load_engine(name: str = DEFAULT_ENGINE) -> NarrationEngine:
    if name == 'chatterbox':
        from .chatterbox import ChatterboxEngine

        return ChatterboxEngine()
    raise ValueError(f'Unknown narration engine {name!r}. Known engines: chatterbox.')
