"""Listen back to narration and check it against what the screenplay asked for.

The /demo-videos self-review runs this on every rendered scene: a narration file
that transcribes back to something other than its screenplay line is a retake,
not a judgement call.

    ./transcribe.sh --audio scene-01.wav --expect-file scene-01.txt
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

from narration.spoken import spoken_words

STT_MODEL = 'mlx-community/whisper-large-v3-turbo-asr-fp16'


def compare(expected: str, heard: str, language: str = 'en'):
    expected_words = spoken_words(expected, language)
    heard_words = spoken_words(heard, language)
    matcher = difflib.SequenceMatcher(None, expected_words, heard_words)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    differences = [
        {
            'expected': ' '.join(expected_words[i1:i2]),
            'heard': ' '.join(heard_words[j1:j2]),
        }
        for tag, i1, i2, j1, j2 in matcher.get_opcodes()
        if tag != 'equal'
    ]
    return {
        'expectedWords': len(expected_words),
        'heardWords': len(heard_words),
        'wordAccuracy': round(matched / len(expected_words), 4)
        if expected_words
        else 0.0,
        'differences': differences,
    }


def parse_arguments(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    expectation = parser.add_mutually_exclusive_group()
    expectation.add_argument('--expect', help='Text the narration should say.')
    expectation.add_argument('--expect-file', type=Path)
    parser.add_argument(
        '--language',
        default='en',
        help='Language the narration is in, so spelled-out numbers compare.',
    )
    parser.add_argument('--model', default=STT_MODEL)
    parser.add_argument('--json', action='store_true')
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
    from mlx_audio.stt import load

    heard = load(arguments.model).generate(str(arguments.audio)).text.strip()
    report = {'audio': str(arguments.audio), 'heard': heard}

    expected = arguments.expect
    if arguments.expect_file is not None:
        expected = arguments.expect_file.read_text(encoding='utf-8')
    if expected is not None:
        report['check'] = compare(expected, heard, arguments.language)

    if arguments.report is not None:
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8'
        )

    if arguments.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    print(f'heard: {heard}')
    if 'check' in report:
        check = report['check']
        print(f'word accuracy: {check["wordAccuracy"]:.1%}')
        for difference in check['differences']:
            print(f'  expected {difference["expected"]!r} — heard {difference["heard"]!r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
