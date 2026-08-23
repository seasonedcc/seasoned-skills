"""Reduce written text to what a listener actually hears.

A demo of this product is dense with yields, costs, revisions and run numbers,
and a transcriber writes those back as digits no matter how the screenplay
spelled them. Comparing raw strings would flag every correct number as a
mismatch, and a check that cries wolf on the common case is a check nobody
reads. So both sides are reduced to one spoken form first: numbers become
digits, identifiers lose their hyphens, punctuation and casing disappear.

Numerals are spelled out per language. English and Portuguese are covered
because those are the languages we narrate in. A language with no lexicon here
still compares — casing, punctuation and identifiers are handled for every
language — but its numbers read as differences for a person to judge, which is
noisy rather than wrong. Adding a language is one entry in `NUMERALS`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SYMBOLS = {
    '%': ' percent ', '€': ' euros ', '$': ' dollars ', '£': ' pounds ',
    '&': ' and ', '°': ' degrees ', '+': ' plus ', '=': ' equals ',
}


@dataclass(frozen=True)
class Numerals:
    units: dict[str, int]
    tens: dict[str, int]
    hundreds: dict[str, int]
    scales: dict[str, int]
    connector: str
    decimal_word: str
    hundred_multiplies: bool
    half_word: str = ''
    words: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self):
        object.__setattr__(
            self,
            'words',
            frozenset(self.units) | frozenset(self.tens) | frozenset(self.hundreds) | frozenset(self.scales),
        )


ENGLISH = Numerals(
    units={
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11,
        'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
        'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
    },
    tens={
        'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
        'seventy': 70, 'eighty': 80, 'ninety': 90,
    },
    hundreds={'hundred': 100},
    scales={'thousand': 1_000, 'million': 1_000_000, 'billion': 1_000_000_000},
    connector='and',
    decimal_word='point',
    hundred_multiplies=True,
)

PORTUGUESE = Numerals(
    units={
        'zero': 0, 'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'três': 3,
        'quatro': 4, 'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9,
        'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13, 'catorze': 14,
        'quatorze': 14, 'quinze': 15, 'dezesseis': 16, 'dezasseis': 16,
        'dezessete': 17, 'dezassete': 17, 'dezoito': 18, 'dezenove': 19,
        'dezanove': 19,
    },
    tens={
        'vinte': 20, 'trinta': 30, 'quarenta': 40, 'cinquenta': 50,
        'cinqüenta': 50, 'sessenta': 60, 'setenta': 70, 'oitenta': 80,
        'noventa': 90,
    },
    hundreds={
        'cem': 100, 'cento': 100, 'duzentos': 200, 'duzentas': 200,
        'trezentos': 300, 'trezentas': 300, 'quatrocentos': 400,
        'quatrocentas': 400, 'quinhentos': 500, 'quinhentas': 500,
        'seiscentos': 600, 'seiscentas': 600, 'setecentos': 700,
        'setecentas': 700, 'oitocentos': 800, 'oitocentas': 800,
        'novecentos': 900, 'novecentas': 900,
    },
    scales={
        'mil': 1_000, 'milhão': 1_000_000, 'milhões': 1_000_000,
        'bilhão': 1_000_000_000, 'bilhões': 1_000_000_000,
    },
    connector='e',
    decimal_word='vírgula',
    hundred_multiplies=False,
    half_word='meio',
)

NUMERALS = {'en': ENGLISH, 'pt': PORTUGUESE}


def _clean(text: str) -> list[str]:
    text = text.lower()
    for symbol, word in SYMBOLS.items():
        text = text.replace(symbol, word)
    # A transcriber writes decimals with the locale's separator.
    text = re.sub(r'(?<=\d),(?=\d)', '.', text)
    # PR-7 and 7-day are one spoken token; thirty-one is two.
    text = re.sub(r'(?<=[a-zà-ÿ])-(?=\d)|(?<=\d)-(?=[a-zà-ÿ])', '', text)
    text = re.sub(r"[^a-z0-9à-ÿ'. ]+", ' ', text)
    text = re.sub(r'(?<!\d)\.|\.(?!\d)', ' ', text)
    return text.split()


def _consume_number(tokens: list[str], start: int, numerals: Numerals):
    """Read one spelled-out number starting at `start`, if there is one."""
    total, group, seen, index = 0, 0, False, start
    while index < len(tokens):
        token = tokens[index]
        if token in numerals.units:
            group += numerals.units[token]
        elif token in numerals.tens:
            group += numerals.tens[token]
        elif token in numerals.hundreds:
            hundred = numerals.hundreds[token]
            group = (group or 1) * 100 if numerals.hundred_multiplies else group + hundred
        elif token in numerals.scales:
            total += (group or 1) * numerals.scales[token]
            group = 0
        elif (
            token == numerals.connector
            and seen
            and index + 1 < len(tokens)
            and tokens[index + 1] in numerals.words
        ):
            index += 1
            continue
        else:
            break
        seen = True
        index += 1

    if not seen:
        return None

    whole = total + group
    if index < len(tokens) and tokens[index] == numerals.decimal_word:
        digits, cursor = '', index + 1
        while cursor < len(tokens) and numerals.units.get(tokens[cursor], 10) < 10:
            digits += str(numerals.units[tokens[cursor]])
            cursor += 1
        if digits:
            return f'{whole}.{digits.rstrip("0") or "0"}', cursor

    # "um e meio" is 1.5. A half that trails its unit — "quilos e meio" — is
    # left alone: unpicking it would swallow the unit. Screenplays write those
    # as "vírgula cinco".
    if (
        numerals.half_word
        and index + 1 < len(tokens)
        and tokens[index] == numerals.connector
        and tokens[index + 1] == numerals.half_word
    ):
        return f'{whole}.5', index + 2
    return str(whole), index


def spoken_words(text: str, language: str = 'en') -> list[str]:
    numerals = NUMERALS.get(language)
    tokens = _clean(text)
    if numerals is None:
        return tokens

    spoken: list[str] = []
    index = 0
    while index < len(tokens):
        number = _consume_number(tokens, index, numerals)
        if number is None:
            spoken.append(tokens[index])
            index += 1
            continue
        value, index = number
        spoken.append(value)
    return spoken
