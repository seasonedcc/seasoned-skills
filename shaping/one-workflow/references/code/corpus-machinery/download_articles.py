#!/usr/bin/env python3
"""Download Ryan Singer's posts from ryansinger.co into sources/articles/ as raw HTML.

The post index is fetched first and is the list's only authority: every post it links,
and nothing else, is downloaded beside it.
"""

import argparse
import datetime
import html.parser
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = REPO_ROOT / "sources" / "articles"
INDEX_PATH = SOURCES_DIR / "index.html"
RETRIEVED_PATH = SOURCES_DIR / "retrieved.json"

SITE_ROOT = "https://www.ryansinger.co"
INDEX_URL = SITE_ROOT + "/posts/"
INDEX_KEY = "index"
USER_AGENT = "shaping-skill corpus builder (+https://github.com/seasonedcc/shaping-skill)"
REQUEST_DELAY_SECONDS = 1.5


class PostIndexReader(html.parser.HTMLParser):
    """Collect the index's post links: an entry is a list item holding a link and a date."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.slugs = []
        self.depth = 0
        self.entry = None

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "li":
            self.depth += 1
            if self.depth == 1:
                self.entry = {}
        elif self.entry is None:
            return
        elif tag == "a" and "href" in attributes:
            self.entry.setdefault("href", attributes["href"])
        elif tag == "time" and "datetime" in attributes:
            self.entry.setdefault("dated", True)

    def handle_endtag(self, tag):
        if tag != "li" or self.depth == 0:
            return
        self.depth -= 1
        if self.depth:
            return
        entry, self.entry = self.entry, None
        if entry.get("dated") and "href" in entry:
            self.slugs.append(entry["href"].strip("/"))


def read_index(index_html):
    reader = PostIndexReader()
    reader.feed(index_html)
    reader.close()
    slugs = sorted(reader.slugs)
    if not slugs:
        raise ValueError("the post index lists no posts")
    if len(set(slugs)) != len(slugs):
        raise ValueError("the post index lists a slug twice")
    for slug in slugs:
        if "/" in slug or not slug:
            raise ValueError(f"the post index links something that is not a post: {slug!r}")
    return slugs


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-download posts that are already present",
    )
    arguments = parser.parse_args()

    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    retrieved = json.loads(RETRIEVED_PATH.read_text(encoding="utf-8")) if RETRIEVED_PATH.exists() else {}
    today = datetime.date.today().isoformat()

    try:
        index_html = fetch(INDEX_URL)
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        print(f"ERROR    the post index: {error}", file=sys.stderr)
        return 1
    INDEX_PATH.write_text(index_html, encoding="utf-8")
    retrieved[INDEX_KEY] = today
    slugs = read_index(index_html)
    print(f"index    {len(slugs)} posts listed ({len(index_html):,} bytes)")

    downloaded = 0
    skipped = 0
    for slug in slugs:
        destination = SOURCES_DIR / f"{slug}.html"
        if destination.exists() and slug in retrieved and not arguments.force:
            print(f"skip     {slug} (already downloaded)")
            skipped += 1
            continue

        time.sleep(REQUEST_DELAY_SECONDS)
        try:
            post_html = fetch(f"{SITE_ROOT}/{slug}/")
        except (urllib.error.URLError, urllib.error.HTTPError) as error:
            print(f"ERROR    {slug}: {error}", file=sys.stderr)
            return 1

        destination.write_text(post_html, encoding="utf-8")
        retrieved[slug] = today
        downloaded += 1
        print(f"download {slug} ({len(post_html):,} bytes)")

    listed = set(slugs) | {INDEX_KEY}
    for stale in sorted(SOURCES_DIR.glob("*.html")):
        if stale.stem not in listed:
            stale.unlink()
            retrieved.pop(stale.stem, None)
            print(f"prune    {stale.stem} (no longer listed on the index)")

    RETRIEVED_PATH.write_text(json.dumps(retrieved, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\n{downloaded} downloaded, {skipped} already present, {len(slugs)} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
