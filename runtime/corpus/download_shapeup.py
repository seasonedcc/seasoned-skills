#!/usr/bin/env python3
"""Download the Shape Up web book's pages into sources/shapeup/ as raw HTML."""

import argparse
import datetime
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = REPO_ROOT / "sources" / "shapeup"
RETRIEVED_PATH = SOURCES_DIR / "retrieved.json"

BASE_URL = "https://basecamp.com/shapeup"
USER_AGENT = "seasoned-skills corpus builder (+https://github.com/seasonedcc/seasoned-skills)"
REQUEST_DELAY_SECONDS = 1.5

PAGES = [
    "0.1-foreword",
    "0.2-acknowledgements",
    "0.3-chapter-01",
    "1.1-chapter-02",
    "1.2-chapter-03",
    "1.3-chapter-04",
    "1.4-chapter-05",
    "1.5-chapter-06",
    "2.1-chapter-07",
    "2.2-chapter-08",
    "2.3-chapter-09",
    "3.1-chapter-10",
    "3.2-chapter-11",
    "3.3-chapter-12",
    "3.4-chapter-13",
    "3.5-chapter-14",
    "3.6-chapter-15",
    "3.7-conclusion",
    "4.0-appendix-01",
    "4.1-appendix-02",
    "4.2-appendix-03",
    "4.5-appendix-06",
    "4.6-appendix-07",
]


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-download pages that are already present",
    )
    arguments = parser.parse_args()

    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    retrieved = json.loads(RETRIEVED_PATH.read_text(encoding="utf-8")) if RETRIEVED_PATH.exists() else {}
    today = datetime.date.today().isoformat()

    downloaded = 0
    skipped = 0
    for page in PAGES:
        destination = SOURCES_DIR / f"{page}.html"
        if destination.exists() and page in retrieved and not arguments.force:
            print(f"skip     {page} (already downloaded)")
            skipped += 1
            continue

        if downloaded:
            time.sleep(REQUEST_DELAY_SECONDS)

        try:
            page_html = fetch(f"{BASE_URL}/{page}")
        except (urllib.error.URLError, urllib.error.HTTPError) as error:
            print(f"ERROR    {page}: {error}", file=sys.stderr)
            return 1

        destination.write_text(page_html, encoding="utf-8")
        retrieved[page] = today
        downloaded += 1
        print(f"download {page} ({len(page_html):,} bytes)")

    RETRIEVED_PATH.write_text(json.dumps(retrieved, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\n{downloaded} downloaded, {skipped} already present, {len(PAGES)} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
