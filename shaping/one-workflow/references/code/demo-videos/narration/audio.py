"""Waveform handling shared by every engine adapter."""

from __future__ import annotations

import io
import re
import subprocess

import numpy as np
import soundfile

SILENCE_FLOOR = 0.006
_SENTENCE_END = re.compile(r'(?<=[.!?…])\s+|(?<=[.!?…]["”’])\s+')
_CLAUSE_END = re.compile(r'(?<=[,;:—–])\s+')


def _fit(sentence: str, character_budget: int) -> list[str]:
    """Break a sentence that is too long to say in one go.

    Clause boundaries first, because a comma is somewhere a person breathes.
    Only when a single clause still will not fit does this fall back to counting
    words, which is where the seam starts to be audible.
    """
    if len(sentence) <= character_budget:
        return [sentence]

    pieces: list[str] = []
    for clause in _CLAUSE_END.split(sentence):
        if pieces and len(pieces[-1]) + 1 + len(clause) <= character_budget:
            pieces[-1] = f'{pieces[-1]} {clause}'
        else:
            pieces.append(clause)

    fitted: list[str] = []
    for piece in pieces:
        while len(piece) > character_budget:
            cut = piece.rfind(' ', 0, character_budget)
            if cut <= 0:
                break
            fitted.append(piece[:cut])
            piece = piece[cut + 1 :]
        fitted.append(piece)
    return fitted


def split_for_synthesis(text: str, character_budget: int) -> list[str]:
    """Group sentences into chunks a speech model can hold in one breath.

    Speech models have a token ceiling well short of a minute of narration, and
    they degrade before they reach it. Splitting on sentence ends keeps every
    seam at a place a human would pause anyway.
    """
    collapsed = ' '.join(text.split())
    if not collapsed:
        return []

    chunks: list[str] = []
    for sentence in _SENTENCE_END.split(collapsed):
        for piece in _fit(sentence.strip(), character_budget):
            if not piece:
                continue
            if chunks and len(chunks[-1]) + 1 + len(piece) <= character_budget:
                chunks[-1] = f'{chunks[-1]} {piece}'
            else:
                chunks.append(piece)
    return chunks


def trim_silence(waveform: np.ndarray, sample_rate: int) -> np.ndarray:
    """Cut the dead air a speech model leaves at both ends of a chunk.

    Left in, it accumulates across chunks until the narration drags.
    """
    if waveform.size == 0:
        return waveform

    window = max(1, sample_rate // 100)
    padded = np.pad(waveform, (0, (-waveform.size) % window))
    frames = padded.reshape(-1, window)
    loud = np.abs(frames).max(axis=1) > SILENCE_FLOOR
    if not loud.any():
        return waveform[:0]

    first, last = int(np.argmax(loud)), int(len(loud) - np.argmax(loud[::-1]))
    keep = max(1, sample_rate // 50)
    start = max(0, first * window - keep)
    end = min(waveform.size, last * window + keep)
    return waveform[start:end]


def join_with_breath(
    chunks: list[np.ndarray], sample_rate: int, gap_seconds: float
) -> np.ndarray:
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    gap = np.zeros(int(sample_rate * gap_seconds), dtype=np.float32)
    joined: list[np.ndarray] = []
    for index, chunk in enumerate(chunks):
        if index:
            joined.append(gap)
        joined.append(chunk)
    return np.concatenate(joined)


def normalize_peak(waveform: np.ndarray, target: float = 0.89) -> np.ndarray:
    """Land every narration file at the same headroom so scenes cut together."""
    peak = float(np.abs(waveform).max()) if waveform.size else 0.0
    if peak <= 0:
        return waveform
    return (waveform * (target / peak)).astype(np.float32)


def retime(waveform: np.ndarray, sample_rate: int, tempo: float) -> np.ndarray:
    """Stretch narration to a target pace without moving its pitch.

    ffmpeg's `atempo` is a WSOLA stretch; between roughly 0.75x and 1.25x it is
    transparent, which is the only range the seam ever asks for.
    """
    if waveform.size == 0 or abs(tempo - 1.0) < 0.01:
        return waveform

    source = io.BytesIO()
    soundfile.write(source, waveform, sample_rate, format='WAV', subtype='FLOAT')
    stretched = subprocess.run(
        [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-i', 'pipe:0', '-filter:a', f'atempo={tempo:.4f}',
            '-f', 'wav', '-c:a', 'pcm_f32le', 'pipe:1',
        ],
        input=source.getvalue(),
        capture_output=True,
        check=True,
    ).stdout
    retimed, _ = soundfile.read(io.BytesIO(stretched), dtype='float32')
    return retimed
