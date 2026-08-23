"""Alert when a dynamic workflow's agent fills too much of its context window.

Usage:
    python3 scripts/orchestration/watchdog.py <transcript-dir> [<transcript-dir>...]

Sweeps every agent transcript (*.jsonl, journal files excluded) in the given
directories every 20 minutes, computes each agent's last-turn context
occupancy, and exits 1 — printing the offenders — as soon as a still-fresh
transcript passes 280,000 tokens. The non-zero exit is the alert: run the
watchdog in the background so its exit fires a notification.

At least one transcript directory is required, and each must exist. A launch
that names no directory sweeps nothing and reports nothing, so it is refused.

Set WATCHDOG_IGNORE to a comma-separated list of transcript filenames to skip
agents already ruled on.
"""

import glob
import json
import os
import sys
import time

THRESHOLD = 280_000
SWEEP_SECONDS = 1200
IGNORE = {name for name in os.environ.get('WATCHDOG_IGNORE', '').split(',') if name}


def last_context(path):
    last = 0
    try:
        with open(path) as transcript:
            for line in transcript:
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                message = entry.get('message')
                usage = message.get('usage') if isinstance(message, dict) else None
                if not usage and isinstance(entry.get('usage'), dict):
                    usage = entry['usage']
                if not usage:
                    continue
                context = (
                    usage.get('input_tokens', 0)
                    + usage.get('cache_creation_input_tokens', 0)
                    + usage.get('cache_read_input_tokens', 0)
                )
                if context:
                    last = context
    except Exception:
        return 0
    return last


def sweep(directories):
    alerts = []
    for directory in directories:
        for path in sorted(glob.glob(os.path.join(directory, '*.jsonl'))):
            name = os.path.basename(path)
            if 'journal' in name or name in IGNORE:
                continue
            age = time.time() - os.path.getmtime(path)
            if age >= SWEEP_SECONDS * 2:
                continue
            context = last_context(path)
            if context > THRESHOLD:
                alerts.append(
                    f'{path}: last-turn context {context:,} > {THRESHOLD:,} '
                    f'(fresh, age {int(age)}s)'
                )
    return alerts


def main(directories):
    while True:
        alerts = sweep(directories)
        if alerts:
            print('WATCHDOG ALERT — builder context past threshold:')
            for alert in alerts:
                print(' ', alert)
            return 1
        time.sleep(SWEEP_SECONDS)


if __name__ == '__main__':
    given = sys.argv[1:]
    if not given:
        sys.stderr.write(__doc__)
        raise SystemExit(2)
    unknown = [directory for directory in given if not os.path.isdir(directory)]
    if unknown:
        sys.stderr.write(f'watchdog: not a directory: {", ".join(unknown)}\n')
        raise SystemExit(2)
    raise SystemExit(main(given))
