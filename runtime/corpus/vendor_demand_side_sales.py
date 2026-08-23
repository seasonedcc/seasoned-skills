#!/usr/bin/env python3
"""Vendor the compiled Demand-Side Sales 101 book into skill/references/02-demand-side-sales-101/.

The source book is already markdown, so nothing here rewrites prose: files are copied
byte for byte and only gain a front matter block when they do not already carry one.
"""

import argparse
import datetime
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "skill" / "references" / "02-demand-side-sales-101"
IMAGES_DIR = OUTPUT_DIR / "images"

METHOD = "scripts/vendor_demand_side_sales.py"
PROVENANCE_NOTE = "compiled from the print/ebook by its own pipeline"
PUBLISHED = "2020"
CHAPTER_PATTERN = "[0-9][0-9]-*.md"
FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n", re.S)
IMAGE_LINK = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
RETRIEVED_FIELD = re.compile(r"^retrieved: (\d{4}-\d{2}-\d{2})$", re.M)


def front_matter(source, retrieved):
    return (
        "---\n"
        f"source: {source} ({PROVENANCE_NOTE})\n"
        f"published: {PUBLISHED}\n"
        f"retrieved: {retrieved}\n"
        f"method: {METHOD}\n"
        "---\n\n"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="path to the book/ directory of the compiled book")
    arguments = parser.parse_args()

    source_dir = Path(arguments.source).expanduser().resolve()
    chapters = sorted(source_dir.glob(CHAPTER_PATTERN))
    source_images = source_dir / "images"
    if not chapters:
        print(f"ERROR: no numbered markdown files in {source_dir}", file=sys.stderr)
        return 2
    if not source_images.is_dir():
        print(f"ERROR: no images directory in {source_dir}", file=sys.stderr)
        return 2

    previous_documents = {
        path.name: path.read_text(encoding="utf-8")
        for path in OUTPUT_DIR.glob(CHAPTER_PATTERN)
    } if OUTPUT_DIR.exists() else {}
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    IMAGES_DIR.mkdir(parents=True)

    today = datetime.date.today().isoformat()
    provenance_root = f"{source_dir.parent.name}/{source_dir.name}"
    carried_own = 0
    referenced = set()
    for chapter in chapters:
        body = chapter.read_text(encoding="utf-8")
        if FRONT_MATTER.match(body):
            carried_own += 1
            document = body
        else:
            retrieved = today
            previous = previous_documents.get(chapter.name)
            if previous and FRONT_MATTER.sub("", previous, count=1).lstrip("\n") == body.lstrip("\n"):
                match = RETRIEVED_FIELD.search(previous)
                if match:
                    retrieved = match.group(1)
            document = front_matter(f"{provenance_root}/{chapter.name}", retrieved) + body
        (OUTPUT_DIR / chapter.name).write_text(document, encoding="utf-8")
        referenced.update(IMAGE_LINK.findall(document))
        print(f"vendor   {chapter.name}")

    for image in sorted(source_images.iterdir()):
        if image.name.startswith("."):
            continue
        shutil.copy2(image, IMAGES_DIR / image.name)

    vendored = {f"images/{image.name}" for image in IMAGES_DIR.iterdir()}
    print(f"\n{len(chapters)} chapters ({carried_own} already carried front matter), {len(vendored)} images")

    findings = [f"  broken image link: {link}" for link in sorted(referenced - vendored)]
    findings += [f"  image nothing links to: {image}" for image in sorted(vendored - referenced)]
    if findings:
        sys.stdout.flush()
        print(f"\nIMAGE LINK FAILURES ({len(findings)}):", file=sys.stderr)
        for finding in findings:
            print(finding, file=sys.stderr)
        return 1

    print(f"Image links: all {len(referenced)} references resolve inside images/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
