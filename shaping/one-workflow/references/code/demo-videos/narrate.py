"""Speak a line of narration in the repo's narrator voice.

    ./narrate.sh --text "Here is the recipe list." --out scene-01.wav
    ./narrate.sh --text-file scene-04.txt --language pt --delivery precise \
        --out scene-04.wav

The language rule the /demo-videos skill follows: the language explicitly asked
for, else the language the request was written in, else English. This CLI only
sees the answer, so `--language` is always explicit and defaults to English.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from narration import DELIVERIES, PINNED_VOICE, NarrationRequest, load_engine, narrate
from narration.engines import DEFAULT_ENGINE


def parse_arguments(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--text', help='Narration text to speak.')
    source.add_argument(
        '--text-file', type=Path, help='File holding the narration text.'
    )
    parser.add_argument('--out', type=Path, required=True, help='WAV to write.')
    parser.add_argument(
        '--language', default='en', help='ISO 639-1 code. Defaults to English.'
    )
    parser.add_argument(
        '--delivery',
        default='colleague',
        choices=sorted(DELIVERIES),
        help='How the narrator speaks. Defaults to colleague.',
    )
    parser.add_argument(
        '--voice',
        type=Path,
        default=PINNED_VOICE,
        help='Narrator reference audio. Defaults to the pinned voice.',
    )
    parser.add_argument('--engine', default=DEFAULT_ENGINE)
    parser.add_argument('--seed', type=int, default=20260817)
    parser.add_argument(
        '--json', action='store_true', help='Report the result as JSON on stdout.'
    )
    parser.add_argument(
        '--report',
        type=Path,
        help=(
            'Write the JSON report to this file. The model loader prints to '
            'stdout, so anything reading this programmatically wants a file.'
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    text = (
        arguments.text
        if arguments.text is not None
        else arguments.text_file.read_text(encoding='utf-8')
    )

    result = narrate(
        load_engine(arguments.engine),
        NarrationRequest(
            text=text,
            language=arguments.language,
            output_path=arguments.out,
            voice_reference=arguments.voice,
            delivery=DELIVERIES[arguments.delivery],
            seed=arguments.seed,
        ),
    )

    report = {
        'output': str(result.output_path),
        'seconds': round(result.duration_seconds, 2),
        'sampleRate': result.sample_rate,
        'engine': result.engine,
        'model': result.model,
        'chunks': result.chunks,
        'wordsPerMinute': round(result.words_per_minute, 1),
        'targetWordsPerMinute': result.target_words_per_minute,
        'retimedBy': round(result.retimed_by, 3),
        'clamped': result.clamped,
        'generationSeconds': round(result.generation_seconds, 2),
        'realTimeFactor': round(result.realtime_factor, 2),
    }
    if arguments.report is not None:
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, indent=2), encoding='utf-8')

    if arguments.json:
        print(json.dumps(report, indent=2))
    else:
        print(
            f'{report["output"]} — {report["seconds"]}s at '
            f'{report["wordsPerMinute"]} wpm, generated in '
            f'{report["generationSeconds"]}s ({report["realTimeFactor"]}x realtime, '
            f'{report["chunks"]} chunk(s))'
        )
    return 0


if __name__ == '__main__':
    sys.exit(main())
