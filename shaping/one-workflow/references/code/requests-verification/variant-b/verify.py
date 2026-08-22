#!/usr/bin/env python3
"""Verify meeting documents against the transcripts they quote.

Every verbatim quote in a meeting's index.html is checked fragment by fragment
against the transcript that covers the moment it cites: the words must be
literal, spoken by the person the quote credits, said without a break the quote
does not mark, and found where the quote's timestamp says they were said.

A meeting has two kinds of transcript, and a quote is checked against whichever
one covers it. A recording part with a Whisper transcript in meeting.json is
verified against that part's VTT, cue by cue, with the Gemini notes still holding
the quote's attribution. Everywhere else — every part with no Whisper transcript,
and every meeting that has none at all — the Gemini notes are the verbatim source
and the check runs turn by turn against them.

The document is also checked against itself: the entry count agrees everywhere it
is stated (header meta, section heading, meeting.json, the rollup), and every
relative link resolves — anchors to ids in this document, cross-meeting links to a
sibling file that carries the id, everything else to a file that exists.

Usage:
    python3 requests-from-meetings/verify.py 2026-08-05-software-review
    python3 requests-from-meetings/verify.py --all

Exit codes: 0 clean, 1 verification failures, 2 setup error (missing config,
missing transcript, a transcript whose sha256 no longer matches its
meeting.json, or a Whisper decode that degenerated into a loop).
"""

import argparse
import hashlib
import html
import json
import re
import sys
import unicodedata
from bisect import bisect_right
from pathlib import Path

MEETINGS_DIR = Path(__file__).resolve().parent
CONFIG_PATH = MEETINGS_DIR / "config.local.json"
ROLLUP_PATH = MEETINGS_DIR / "index.html"

FRAGMENT_WIDTH = 110
SNIPPET_WIDTH = 70
MAX_EVIDENCE_LINES = 8

ALLOWED_BRACKETS = ("[…]", "[unclear]")

# A Whisper cue break is a decoder artifact, not a pause: cues this close together
# are one uninterrupted stretch of speech, and a verbatim may run across them.
CUE_GAP_SECONDS = 0.5
# How far a cite may sit from the cue it names. Part offsets are calibrated to a
# second or two, so the window is a minute — as forgiving as a scaffold block.
CITE_TOLERANCE_SECONDS = 60
# A decode that loops repeats one cue far past anything speech does.
MAX_IDENTICAL_CUES = 5

SUMMARY_FORMAT = (
    "%-30s %3d quotes · %3d fragments · %3d passed · %3d failed"
    " · %3d from Whisper · %2d findings · %2d warnings"
)

FOLD_TABLE = str.maketrans(
    {
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u2032": "'",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\u2212": "-",
        "\u00a0": " ",
        "\u2007": " ",
        "\u2009": " ",
        "\u202f": " ",
        "\u200b": "",
        "\ufeff": "",
    }
)

TAG_RE = re.compile(r"<[^>]+>")
BACKSLASH_ESCAPE_RE = re.compile(r"\\([^0-9A-Za-z\s])")
WHITESPACE_RE = re.compile(r"\s+")
ALPHANUMERIC_RE = re.compile(r"[0-9A-Za-zÀ-ÿ]")

BLOCK_RE = re.compile(r"^###\s+\*\*(\d{1,2}:\d{2}:\d{2})\*\*$")
TURN_RE = re.compile(r"^\*\*([^*]+?):\*\*\s*(.*)$")
CUE_RE = re.compile(r"^(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})")
PART_CITE_RE = re.compile(r"\bPart\s+(\d+)\b")
BLANK_LINE_RE = re.compile(r"\n\s*\n")

ENTRY_RE = re.compile(r'<article\b(?=[^>]*\bclass="entry")[^>]*\bid="([^"]+)"')
HEADER_COUNT_RE = re.compile(r"<div><dt>Entries</dt><dd>(\d+)</dd></div>")
SECTION_COUNT_RE = re.compile(r'Entries\s*<span class="section-count">·\s*(\d+)</span>')
ROLLUP_COUNT_RE = re.compile(r'<span class="count">(\d+) entries</span>')
HREF_RE = re.compile(r'href="([^"]+)"')
ID_RE = re.compile(r'\bid="([^"]+)"')
QUOTE_RE = re.compile(r'<blockquote class="quote">(.*?)</blockquote>', re.S)
SOURCE_RE = re.compile(r'<p class="quote-source">(.*?)</p>', re.S)
WHO_RE = re.compile(r'<span class="who">(.*?)</span>', re.S)
VERBATIM_RE = re.compile(r'<p class="verbatim"[^>]*>(.*?)</p>', re.S)
TRANSLATION_RE = re.compile(r'<p class="translation"')
CLOCK_RE = re.compile(r"\d{1,2}:\d{2}:\d{2}")
BRACKET_RE = re.compile(r"\[[^\]]*\]")
FRAGMENT_SPLIT_RE = re.compile(r"\[\s*…\s*\]|\[unclear\]|…")
PROSE_SPAN_RE = re.compile(r'<span[^>]*lang="pt-BR"[^>]*>(.*?)</span>', re.S)
ROLLUP_LINK_RE = re.compile(r'href="([^"/]+)/index\.html"')


class SetupError(Exception):
    """Something the run needs is missing, or no longer matches its record."""


def normalize(text):
    text = TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = unicodedata.normalize("NFC", text)
    text = BACKSLASH_ESCAPE_RE.sub(r"\1", text)
    text = text.translate(FOLD_TABLE)
    return WHITESPACE_RE.sub(" ", text).strip()


def to_seconds(clock):
    hours, minutes, seconds = (int(part) for part in clock.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def cue_seconds(clock):
    stamp, _, fraction = clock.replace(",", ".").partition(".")
    return to_seconds(stamp) + int(fraction or 0) / 1000


def as_clock(seconds):
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    return "%s%d:%02d:%02d" % (sign, seconds // 3600, seconds % 3600 // 60, seconds % 60)


def shorten(text, width):
    return text if len(text) <= width else text[: width - 1].rstrip() + "…"


class Turn:
    def __init__(self, block, speaker, text):
        self.block = block
        self.speaker = speaker
        self.text = text
        self.lowered = text.lower()

    def read(self, folded):
        return self.lowered if folded else self.text


class Transcript:
    """The transcript as a stream of speaker turns — never one flat blob.

    Flattening is the whole hazard this script exists to close: a quote welded
    together from two turns is a substring of the flattened text, so it passes
    silently, and the document ships a sentence nobody said in one breath.
    """

    def __init__(self, raw):
        self.blocks = []
        self.turns = []
        block = None
        for line in raw.split("\n"):
            header = BLOCK_RE.match(line.strip())
            if header:
                self.blocks.append(header.group(1))
                block = len(self.blocks) - 1
                continue
            turn = TURN_RE.match(line.strip())
            if turn and block is not None:
                self.turns.append(Turn(block, turn.group(1).strip(), normalize(turn.group(2))))
        self.block_seconds = [to_seconds(header) for header in self.blocks]
        self.speakers = sorted({turn.speaker for turn in self.turns})
        self.whole = {folded: self._stream(range(len(self.turns)), folded) for folded in (False, True)}
        self.per_speaker = {
            folded: {
                speaker: self._stream(
                    [i for i, turn in enumerate(self.turns) if turn.speaker == speaker], folded
                )
                for speaker in self.speakers
            }
            for folded in (False, True)
        }

    def _stream(self, indexes, folded):
        parts, spans, position = [], [], 0
        for index in indexes:
            text = self.turns[index].read(folded)
            if not text:
                continue
            if parts:
                parts.append(" ")
                position += 1
            spans.append((position, position + len(text), index))
            parts.append(text)
            position += len(text)
        return "".join(parts), spans

    def block_for(self, seconds):
        return max(0, bisect_right(self.block_seconds, seconds) - 1)

    def header(self, block):
        return self.blocks[block] if 0 <= block < len(self.blocks) else "??:??:??"

    def header_of(self, turn_index):
        return self.header(self.turns[turn_index].block)

    def turns_containing(self, fragment, folded=False):
        needle = fragment.lower() if folded else fragment
        return [index for index, turn in enumerate(self.turns) if needle in turn.read(folded)]

    def _locate(self, stream, fragment):
        text, spans = stream
        at = text.find(fragment)
        if at < 0:
            return []
        end = at + len(fragment)
        return [index for start, stop, index in spans if start < end and stop > at]

    def stitched_turns(self, fragment, speaker, folded=False):
        """Turns a fragment welds together — the speaker's own first, then anyone's."""
        needle = fragment.lower() if folded else fragment
        own = self.per_speaker[folded].get(speaker)
        across_own_turns = self._locate(own, needle) if own else []
        return across_own_turns or self._locate(self.whole[folded], needle)


class WhisperTranscript:
    """One recording part's Whisper transcript, read as runs of unbroken speech.

    Whisper does not diarize, so a run — cues that follow one another with no
    audible pause between them — is the closest thing a VTT has to a turn, and it
    carries the same rule. A verbatim may cross cue boundaries inside a run,
    because a cue break is the decoder segmenting, not the speaker stopping. It
    never crosses a pause without a marker: what stands between two ellipses is
    one uninterrupted stretch of speech, exactly as the audio has it.
    """

    def __init__(self, raw, name):
        self.name = name
        self.cues = []
        for block in BLANK_LINE_RE.split(raw):
            lines = block.split("\n")
            for index, line in enumerate(lines):
                header = CUE_RE.match(line.strip())
                if not header:
                    continue
                text = normalize(" ".join(lines[index + 1 :]))
                if text:
                    self.cues.append(
                        (cue_seconds(header.group(1)), cue_seconds(header.group(2)), text)
                    )
                break
        self.runs = []
        for index, (start, _, _) in enumerate(self.cues):
            if self.runs and start - self.cues[index - 1][1] <= CUE_GAP_SECONDS:
                self.runs[-1].append(index)
            else:
                self.runs.append([index])
        self.streams = {folded: [self._join(run, folded) for run in self.runs] for folded in (False, True)}
        self.whole = {folded: self._join(range(len(self.cues)), folded) for folded in (False, True)}

    def _join(self, indexes, folded):
        parts, spans, position = [], [], 0
        for index in indexes:
            text = self.cues[index][2]
            text = text.lower() if folded else text
            if parts:
                parts.append(" ")
                position += 1
            spans.append((position, position + len(text), index))
            parts.append(text)
            position += len(text)
        return "".join(parts), spans

    def longest_repeat(self):
        """The longest run of identical cues — how a looping decode announces itself."""
        longest = run = 1 if self.cues else 0
        for previous, cue in zip(self.cues, self.cues[1:]):
            run = run + 1 if cue[2] == previous[2] else 1
            longest = max(longest, run)
        return longest

    def cues_containing(self, fragment, folded=False):
        """The cue each run starts this fragment in — empty when it crosses a pause."""
        needle = fragment.lower() if folded else fragment
        found = []
        for text, spans in self.streams[folded]:
            at = text.find(needle)
            if at >= 0:
                found.append(next(index for start, stop, index in spans if start <= at < stop))
        return found

    def stitched_cues(self, fragment, folded=False):
        """The cues a fragment welds together across a pause."""
        needle = fragment.lower() if folded else fragment
        text, spans = self.whole[folded]
        at = text.find(needle)
        if at < 0:
            return []
        end = at + len(needle)
        return [index for start, stop, index in spans if start < end and stop > at]

    def spoken_at(self, index):
        return as_clock(self.cues[index][0])

    def run_holding(self, index):
        for run, (text, _) in zip(self.runs, self.streams[False]):
            if index in run:
                return text
        return ""


class Part:
    """A recording part: its window on the meeting timeline, and its transcript."""

    def __init__(self, number, source, whisper):
        self.number = number
        self.file = source["file"]
        self.offset = source.get("timelineOffsetSeconds", 0)
        self.duration = source.get("durationSeconds", 0)
        self.whisper = whisper

    def holds(self, seconds):
        return self.offset <= seconds < self.offset + self.duration

    @property
    def before_the_clock(self):
        return self.offset < 0


class Quote:
    def __init__(self, entry, body):
        self.entry = entry
        source = SOURCE_RE.search(body)
        cite = source.group(1) if source else body
        who = WHO_RE.search(cite)
        self.speaker = normalize(who.group(1)) if who else ""
        self.timestamps = CLOCK_RE.findall(normalize(cite))
        part = PART_CITE_RE.search(normalize(cite))
        self.part = int(part.group(1)) if part else None
        verbatim = VERBATIM_RE.search(body)
        self.verbatim = normalize(verbatim.group(1)).strip('"').strip() if verbatim else None
        self.has_translation = bool(TRANSLATION_RE.search(body))

    @property
    def cite(self):
        return "%s @ %s" % (self.speaker or "(no speaker)", " ".join(self.timestamps) or "(no timestamp)")

    def fragments(self):
        pieces = (piece.strip().strip('"').strip() for piece in FRAGMENT_SPLIT_RE.split(self.verbatim))
        return [piece for piece in pieces if ALPHANUMERIC_RE.search(piece)]

    def stray_brackets(self):
        groups = BRACKET_RE.findall(self.verbatim)
        stray = [group for group in groups if group not in ALLOWED_BRACKETS]
        if self.verbatim.count("[") > len(groups):
            stray.append("[ — unclosed")
        return stray


class Failure:
    def __init__(self, location, cite, kind, subject, evidence=()):
        self.location = location
        self.cite = cite
        self.kind = kind
        self.subject = subject
        self.evidence = list(evidence)

    @classmethod
    def in_quote(cls, meeting, quote, kind, subject, evidence=()):
        return cls("%s#%s" % (meeting, quote.entry), quote.cite, kind, subject, evidence)

    def render(self):
        lines = [
            "FAIL %-17s %s | %s | %s"
            % (self.kind, self.location, self.cite, shorten(self.subject, FRAGMENT_WIDTH))
        ]
        lines += ["        %s" % line for line in self.evidence[:MAX_EVIDENCE_LINES]]
        if len(self.evidence) > MAX_EVIDENCE_LINES:
            lines.append("        … and %d more turns" % (len(self.evidence) - MAX_EVIDENCE_LINES))
        return lines


class Result:
    def __init__(self, meeting):
        self.meeting = meeting
        self.quotes = 0
        self.fragments = 0
        self.whisper_fragments = 0
        self.bad_fragments = 0
        self.failures = []
        self.warnings = []

    def summary(self):
        return SUMMARY_FORMAT % (
            self.meeting,
            self.quotes,
            self.fragments,
            self.fragments - self.bad_fragments,
            self.bad_fragments,
            self.whisper_fragments,
            len(self.failures),
            len(self.warnings),
        )


def read_config():
    if not CONFIG_PATH.exists():
        raise SetupError(
            'missing %s — write it with {"meetingsFolder": "/path/to/your/meetings"}' % CONFIG_PATH
        )
    folder = json.loads(CONFIG_PATH.read_text(encoding="utf-8")).get("meetingsFolder")
    if not folder:
        raise SetupError('%s has no "meetingsFolder" key' % CONFIG_PATH)
    path = Path(folder).expanduser()
    if not path.is_dir():
        raise SetupError("meetings folder %s does not exist" % path)
    return path


def read_manifest(meeting):
    manifest_path = MEETINGS_DIR / meeting / "meeting.json"
    if not manifest_path.exists():
        raise SetupError("missing %s" % manifest_path)
    return manifest_path, json.loads(manifest_path.read_text(encoding="utf-8"))


def read_source(source, manifest_path, meetings_folder):
    """A source file's bytes, refused unless they still hash to what was parsed."""
    path = meetings_folder / source["file"]
    if not path.exists():
        raise SetupError("missing %s (named by %s)" % (path, manifest_path))
    if not source.get("sha256"):
        raise SetupError("%s records no sha256 for %s" % (manifest_path, source["file"]))
    raw = path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != source["sha256"]:
        raise SetupError(
            "%s changed since it was parsed: meeting.json records %s, the file is %s"
            % (source["file"], source["sha256"], actual)
        )
    return raw


def load_scaffold(manifest, manifest_path, meetings_folder):
    sources = [source for source in manifest.get("sources", []) if source.get("role") == "transcript"]
    if not sources:
        raise SetupError('%s lists no source with role "transcript"' % manifest_path)
    raw = read_source(sources[0], manifest_path, meetings_folder)
    scaffold = Transcript(raw.decode("utf-8"))
    if not scaffold.turns:
        raise SetupError("no speaker turns parsed out of %s" % sources[0]["file"])
    return scaffold


def load_parts(manifest, manifest_path, meetings_folder):
    """The recording parts in filename order, each with its Whisper transcript if it has one."""
    whispers = {}
    for source in manifest.get("sources", []):
        if source.get("role") != "whisper":
            continue
        transcribes = source.get("transcribes")
        if not transcribes:
            raise SetupError('%s: whisper source %s names no "transcribes"' % (manifest_path, source["file"]))
        raw = read_source(source, manifest_path, meetings_folder)
        transcript = WhisperTranscript(raw.decode("utf-8"), source["file"])
        if not transcript.cues:
            raise SetupError("no cues parsed out of %s" % source["file"])
        repeat = transcript.longest_repeat()
        if repeat > MAX_IDENTICAL_CUES:
            raise SetupError(
                "%s repeats one cue %d times in a row — the decode degenerated into a loop;"
                " re-decode that part with the VAD configuration and reship the transcript"
                % (source["file"], repeat)
            )
        whispers[transcribes] = transcript
    parts = [source for source in manifest.get("sources", []) if source.get("role") == "recording"]
    unmatched = set(whispers) - {source["file"] for source in parts}
    if unmatched:
        raise SetupError(
            "%s: whisper sources transcribe %s, which no recording source names"
            % (manifest_path, ", ".join(sorted(unmatched)))
        )
    return [
        Part(number, source, whispers.get(source["file"]))
        for number, source in enumerate(parts, start=1)
    ]


def entry_locator(document):
    entries = [(match.start(), match.group(1)) for match in ENTRY_RE.finditer(document)]
    starts = [start for start, _ in entries]

    def locate(position):
        index = bisect_right(starts, position) - 1
        return entries[index][1] if index >= 0 else "(outside any entry)"

    return locate


def describe_turns(transcript, indexes, quoted):
    return [
        "%-7s [%s] %s: %s"
        % (
            "quoted" if index in quoted else "BETWEEN",
            transcript.header_of(index),
            transcript.turns[index].speaker,
            shorten(transcript.turns[index].text, SNIPPET_WIDTH),
        )
        for index in indexes
    ]


def stitch_evidence(transcript, stitched, note):
    walk = range(min(stitched), max(stitched) + 1)
    headline = "joins %d turns with no marker%s:" % (len(stitched), note)
    return [headline] + describe_turns(transcript, walk, set(stitched))


def match_fragment(transcript, quote, fragment, accepted, cursor, folded=False):
    """Resolve one fragment to a turn, or to the reason it cannot be resolved.

    Returns (turn index, None) on success and (None, (kind, evidence)) otherwise.
    """
    note = " (and its casing differs from the transcript)" if folded else ""
    spoken = transcript.turns_containing(fragment, folded)
    mine = [index for index in spoken if transcript.turns[index].speaker == quote.speaker]
    if mine:
        if folded:
            actual = transcript.turns[mine[0]].text
            offset = actual.lower().find(fragment.lower())
            return None, (
                "case-mismatch",
                ['transcript has "%s"' % shorten(actual[offset : offset + len(fragment)], FRAGMENT_WIDTH)],
            )
        headers = ", ".join(sorted({transcript.header_of(index) for index in mine}))
        if cursor < 0:
            opening = [index for index in mine if transcript.turns[index].block in accepted]
            if not opening:
                return None, (
                    "wrong-block",
                    ["the quote claims %s, this is spoken in %s" % (transcript.header(accepted.start), headers)],
                )
            return min(opening), None
        continuing = [index for index in mine if index >= cursor]
        if not continuing:
            return None, (
                "out-of-order",
                [
                    "runs backwards: this sits in %s, before the previous fragment in %s"
                    % (headers, transcript.header_of(cursor))
                ],
            )
        return min(continuing), None
    if spoken:
        return None, (
            "wrong-speaker",
            [
                "spoken by %s in %s%s"
                % (
                    ", ".join(sorted({transcript.turns[index].speaker for index in spoken})),
                    ", ".join(sorted({transcript.header_of(index) for index in spoken})),
                    note,
                )
            ],
        )
    stitched = transcript.stitched_turns(fragment, quote.speaker, folded)
    if stitched:
        return None, ("stitch", stitch_evidence(transcript, stitched, note))
    if folded:
        return None, ("not-in-transcript", [])
    return match_fragment(transcript, quote, fragment, accepted, cursor, folded=True)


def whisper_stitch_evidence(whisper, stitched, note):
    quoted = set(stitched)
    headline = "joins %d cues across a pause with no marker%s:" % (len(stitched), note)
    return [headline] + [
        "%-7s [%s] %s"
        % (
            "quoted" if index in quoted else "BETWEEN",
            whisper.spoken_at(index),
            shorten(whisper.cues[index][2], SNIPPET_WIDTH),
        )
        for index in range(min(stitched), max(stitched) + 1)
    ]


def match_whisper_fragment(whisper, fragment, claimed, cursor, folded=False):
    """Resolve one fragment to a cue in a part's Whisper transcript, or to why it cannot be."""
    note = " (and its casing differs from the transcript)" if folded else ""
    spoken = whisper.cues_containing(fragment, folded)
    if spoken:
        heard = ", ".join(sorted({whisper.spoken_at(index) for index in spoken}))
        if folded:
            actual = whisper.run_holding(spoken[0])
            offset = actual.lower().find(fragment.lower())
            return None, (
                "case-mismatch",
                ['transcript has "%s"' % shorten(actual[offset : offset + len(fragment)], FRAGMENT_WIDTH)],
            )
        if cursor < 0:
            near = [
                index
                for index in spoken
                if abs(whisper.cues[index][0] - claimed) <= CITE_TOLERANCE_SECONDS
            ]
            if not near:
                return None, (
                    "wrong-cue",
                    ["the quote claims %s, this is spoken at %s" % (as_clock(claimed), heard)],
                )
            return min(near), None
        continuing = [index for index in spoken if index >= cursor]
        if not continuing:
            return None, (
                "out-of-order",
                [
                    "runs backwards: this sits at %s, before the previous fragment at %s"
                    % (heard, whisper.spoken_at(cursor))
                ],
            )
        return min(continuing), None
    stitched = whisper.stitched_cues(fragment, folded)
    if stitched:
        return None, ("stitch", whisper_stitch_evidence(whisper, stitched, note))
    if folded:
        return None, ("not-in-transcript", [])
    return match_whisper_fragment(whisper, fragment, claimed, cursor, folded=True)


def check_attribution(scaffold, quote, timeline, result, meeting):
    """Whisper hears words, not people — the scaffold's turns are what stands behind a name.

    Where the notes never reached, nothing here can stand behind it, and the
    record carries its own account of how the attribution was established.
    """
    if timeline < 0 or not scaffold.block_seconds:
        return
    if timeline > scaffold.block_seconds[-1] + CITE_TOLERANCE_SECONDS:
        return
    window = range(
        scaffold.block_for(timeline - CITE_TOLERANCE_SECONDS),
        scaffold.block_for(timeline + CITE_TOLERANCE_SECONDS) + 1,
    )
    if any(turn.speaker == quote.speaker and turn.block in window for turn in scaffold.turns):
        return
    result.failures.append(
        Failure.in_quote(
            meeting,
            quote,
            "speaker-scaffold",
            quote.speaker,
            ["has no turn within a minute of %s in the notes transcript" % as_clock(timeline)],
        )
    )


def check_whisper_quote(part, scaffold, quote, claimed, result, meeting):
    cursor = -1
    for fragment in quote.fragments():
        result.fragments += 1
        result.whisper_fragments += 1
        found, problem = match_whisper_fragment(part.whisper, fragment, claimed, cursor)
        if problem:
            result.bad_fragments += 1
            result.failures.append(Failure.in_quote(meeting, quote, problem[0], fragment, problem[1]))
            continue
        if cursor < 0:
            timeline = part.offset + part.whisper.cues[found][0]
            check_attribution(scaffold, quote, timeline, result, meeting)
        cursor = found


def check_scaffold_quote(scaffold, quote, claimed, result, meeting):
    accepted = range(scaffold.block_for(min(claimed)), scaffold.block_for(max(claimed)) + 1)
    cursor = -1
    for fragment in quote.fragments():
        result.fragments += 1
        found, problem = match_fragment(scaffold, quote, fragment, accepted, cursor)
        if problem:
            result.bad_fragments += 1
            result.failures.append(Failure.in_quote(meeting, quote, problem[0], fragment, problem[1]))
        else:
            cursor = found


def cited_part(quote, parts, claimed):
    """The part a cite points into — named outright, or the one whose window holds its time."""
    if quote.part is not None:
        return next((part for part in parts if part.number == quote.part), None)
    return next((part for part in parts if part.holds(claimed)), None)


def check_quote(scaffold, parts, quote, result, meeting):
    result.quotes += 1
    if quote.verbatim is None:
        result.failures.append(Failure.in_quote(meeting, quote, "no-verbatim", "the quote has no verbatim paragraph"))
        return
    if not quote.has_translation:
        result.failures.append(
            Failure.in_quote(meeting, quote, "no-translation", shorten(quote.verbatim, FRAGMENT_WIDTH))
        )
    for bracket in quote.stray_brackets():
        result.failures.append(
            Failure.in_quote(
                meeting,
                quote,
                "bracket-in-verbatim",
                bracket,
                ["a mangled term stays mangled here and is resolved in the translation"],
            )
        )
    if not quote.speaker or not quote.timestamps:
        result.failures.append(
            Failure.in_quote(meeting, quote, "malformed-cite", shorten(quote.verbatim, FRAGMENT_WIDTH))
        )
        return
    claimed = [to_seconds(clock) for clock in quote.timestamps]
    part = cited_part(quote, parts, min(claimed))
    if quote.part is not None:
        if part is None:
            result.failures.append(
                Failure.in_quote(meeting, quote, "unknown-part", "this meeting has no part %d" % quote.part)
            )
            return
        if not part.before_the_clock:
            result.failures.append(
                Failure.in_quote(
                    meeting,
                    quote,
                    "part-cite-on-clock",
                    "part %d sits on the meeting clock — cite it in meeting time" % part.number,
                )
            )
            return
        if part.whisper is None:
            result.failures.append(
                Failure.in_quote(
                    meeting, quote, "no-whisper-source", "part %d has no Whisper transcript" % part.number
                )
            )
            return
    if part is not None and part.whisper is not None:
        local = min(claimed) if quote.part is not None else min(claimed) - part.offset
        check_whisper_quote(part, scaffold, quote, local, result, meeting)
        return
    check_scaffold_quote(scaffold, quote, claimed, result, meeting)


def check_prose(scaffold, parts, document, result, meeting):
    locate = entry_locator(document)
    whispers = [part.whisper for part in parts if part.whisper]
    for match in PROSE_SPAN_RE.finditer(document):
        span = normalize(match.group(1)).strip('"').strip()
        if len(span.split()) < 2 or scaffold.turns_containing(span):
            continue
        if any(whisper.cues_containing(span) for whisper in whispers):
            continue
        result.warnings.append(
            'WARN prose-fragment   %s#%s | "%s" is in no single turn — quote it properly or reword it'
            % (meeting, locate(match.start()), shorten(span, FRAGMENT_WIDTH))
        )


def first_number(pattern, document):
    match = pattern.search(document)
    return int(match.group(1)) if match else None


def rollup_counts():
    """What the rollup claims each meeting holds, by folder — empty until it lists any."""
    if not ROLLUP_PATH.exists():
        return {}
    counts = {}
    for item in ROLLUP_PATH.read_text(encoding="utf-8").split("<li>"):
        link = ROLLUP_LINK_RE.search(item)
        count = ROLLUP_COUNT_RE.search(item)
        if link and count:
            counts[link.group(1)] = int(count.group(1))
    return counts


def check_counts(manifest, document, result, meeting):
    """The entries are counted once and stated four times — every statement has to agree."""
    entries = len(ENTRY_RE.findall(document))
    claims = [
        ("header meta", first_number(HEADER_COUNT_RE, document)),
        ("section heading", first_number(SECTION_COUNT_RE, document)),
        ("meeting.json entryCount", manifest.get("entryCount")),
    ]
    listed = rollup_counts()
    if meeting in listed:
        claims.append(("rollup index.html", listed[meeting]))
    else:
        result.warnings.append(
            "WARN rollup-unlisted  %s | not linked from %s yet — its rollup count is unchecked"
            % (meeting, ROLLUP_PATH.name)
        )
    for cite, claimed in claims:
        if claimed is None:
            result.failures.append(
                Failure(meeting, cite, "missing-count", "states no entry count; the document has %d" % entries)
            )
        elif claimed != entries:
            result.failures.append(
                Failure(meeting, cite, "entry-count", "says %s; the document has %d entries" % (claimed, entries))
            )


def relative_to_meetings(path):
    try:
        return str(path.relative_to(MEETINGS_DIR))
    except ValueError:
        return str(path)


def ids_in(path, cache):
    if path not in cache:
        cache[path] = set(ID_RE.findall(path.read_text(encoding="utf-8", errors="ignore")))
    return cache[path]


def check_links(document, result, meeting):
    """Every relative link the document makes has to land on something that exists."""
    locate = entry_locator(document)
    folder = MEETINGS_DIR / meeting
    own_ids = set(ID_RE.findall(document))
    sibling_ids = {}
    seen = set()
    for match in HREF_RE.finditer(document):
        href = html.unescape(match.group(1))
        if href in seen or href.startswith(("http://", "https://")):
            continue
        seen.add(href)
        location = "%s#%s" % (meeting, locate(match.start()))
        cite = 'href="%s"' % shorten(href, SNIPPET_WIDTH)
        path, _, anchor = href.partition("#")
        if not path:
            if anchor not in own_ids:
                result.failures.append(
                    Failure(location, cite, "dead-anchor", 'nothing in this document has id="%s"' % anchor)
                )
            continue
        target = (folder / path).resolve()
        if not target.exists():
            result.failures.append(
                Failure(location, cite, "dead-link", "%s does not exist" % relative_to_meetings(target))
            )
        elif anchor and anchor not in ids_in(target, sibling_ids):
            result.failures.append(
                Failure(
                    location,
                    cite,
                    "dead-cross-anchor",
                    'nothing in %s has id="%s"' % (relative_to_meetings(target), anchor),
                )
            )


def verify_meeting(meeting, meetings_folder):
    document_path = MEETINGS_DIR / meeting / "index.html"
    if not document_path.exists():
        raise SetupError("missing %s" % document_path)
    manifest_path, manifest = read_manifest(meeting)
    scaffold = load_scaffold(manifest, manifest_path, meetings_folder)
    parts = load_parts(manifest, manifest_path, meetings_folder)
    document = document_path.read_text(encoding="utf-8")
    locate = entry_locator(document)
    result = Result(meeting)
    for match in QUOTE_RE.finditer(document):
        check_quote(scaffold, parts, Quote(locate(match.start()), match.group(1)), result, meeting)
    check_prose(scaffold, parts, document, result, meeting)
    check_counts(manifest, document, result, meeting)
    check_links(document, result, meeting)
    return result


def meetings_from_rollup():
    if not ROLLUP_PATH.exists():
        raise SetupError("missing %s" % ROLLUP_PATH)
    listed = []
    for folder in ROLLUP_LINK_RE.findall(ROLLUP_PATH.read_text(encoding="utf-8")):
        if folder not in listed and (MEETINGS_DIR / folder / "meeting.json").exists():
            listed.append(folder)
    if not listed:
        raise SetupError("%s links no parsed meeting folder" % ROLLUP_PATH)
    return listed


def total_line(results):
    return SUMMARY_FORMAT % (
        "TOTAL",
        sum(result.quotes for result in results),
        sum(result.fragments for result in results),
        sum(result.fragments - result.bad_fragments for result in results),
        sum(result.bad_fragments for result in results),
        sum(result.whisper_fragments for result in results),
        sum(len(result.failures) for result in results),
        sum(len(result.warnings) for result in results),
    )


def main():
    parser = argparse.ArgumentParser(
        description="Verify meeting documents against the transcripts they quote.",
        epilog="Exit codes: 0 clean, 1 verification failures, 2 setup error.",
    )
    parser.add_argument("meetings", nargs="*", help="meeting folder, e.g. 2026-08-05-software-review")
    parser.add_argument("--all", action="store_true", help="verify every meeting listed in the rollup")
    arguments = parser.parse_args()

    try:
        meetings_folder = read_config()
        wanted = [Path(name.rstrip("/")).name for name in arguments.meetings]
        if arguments.all:
            wanted = meetings_from_rollup()
        if not wanted:
            parser.error("name a meeting folder or pass --all")
        results = [verify_meeting(meeting, meetings_folder) for meeting in wanted]
    except SetupError as error:
        print("verify.py: %s" % error, file=sys.stderr)
        return 2

    for result in results:
        print(result.summary())
    if len(results) > 1:
        print(total_line(results))

    failures = [line for result in results for failure in result.failures for line in failure.render()]
    warnings = [line for result in results for line in result.warnings]
    if failures:
        print("\n" + "\n".join(failures))
    if warnings:
        print("\n" + "\n".join(warnings))
        print("(warnings do not fail the run)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
