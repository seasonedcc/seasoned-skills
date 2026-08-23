#!/usr/bin/env python3
"""Check the corpus under skill/references/ for the invariants the skill relies on.

Exit codes: 0 no findings, 1 findings, 2 the corpus is not set up to be checked.
"""

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REFERENCES_DIR = REPO_ROOT / "skill" / "references"
INDEX_PATH = REFERENCES_DIR / "INDEX.md"

FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)
FIELD = re.compile(r"^([a-z]+):\s*(\S.*)$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)")
INDEX_ENTRY = re.compile(r"^- \[[^\]]+\]\(([^)]+)\) — (\S+) — (.+)$", re.M)
REQUIRED_FIELDS = ("source", "published", "retrieved", "method")
PUBLICATION_DATE = re.compile(r"^\d{4}(-\d{2}){0,2}$")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}

INDEX_HEADER = """# Corpus index

Every document in this skill's corpus, with where it came from. Regenerate with
`python3 scripts/verify.py --write-index`.
"""


def documents():
    return sorted(
        path for path in REFERENCES_DIR.rglob("*.md") if path != INDEX_PATH
    )


def read_front_matter(path):
    match = FRONT_MATTER.match(path.read_text(encoding="utf-8"))
    if match is None:
        return None
    fields = {}
    for line in match.group(1).split("\n"):
        field = FIELD.match(line)
        if field is None:
            return None
        fields[field.group(1)] = field.group(2).strip()
    return fields


def relative(path):
    return path.relative_to(REFERENCES_DIR).as_posix()


def title_of(path):
    text = path.read_text(encoding="utf-8")
    heading = re.search(r"^# (.+)$", text, re.M)
    return heading.group(1).strip() if heading else path.stem


def write_index():
    lines = [INDEX_HEADER]
    collection = None
    for path in documents():
        if path.parent != collection:
            collection = path.parent
            lines.append(f"\n## {collection.name}\n")
        fields = read_front_matter(path) or {}
        lines.append(
            f"- [{title_of(path)}]({relative(path)}) — {fields.get('published', '?')}"
            f" — {fields.get('source', 'provenance missing')}"
        )
    INDEX_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def check_front_matter(findings):
    for path in documents():
        fields = read_front_matter(path)
        if fields is None:
            findings.append(f"{relative(path)}: missing or malformed front matter")
            continue
        for field in REQUIRED_FIELDS:
            if field not in fields:
                findings.append(f"{relative(path)}: front matter has no `{field}`")
        if "retrieved" in fields and not ISO_DATE.match(fields["retrieved"]):
            findings.append(f"{relative(path)}: `retrieved` is not an ISO date: {fields['retrieved']}")
        if "published" in fields and not PUBLICATION_DATE.match(fields["published"]):
            findings.append(
                f"{relative(path)}: `published` is not a year or ISO date: {fields['published']}"
            )


def check_index(findings):
    listed = {
        target: (published, source)
        for target, published, source in INDEX_ENTRY.findall(INDEX_PATH.read_text(encoding="utf-8"))
    }
    for path in documents():
        target = relative(path)
        if target not in listed:
            findings.append(f"{target}: not listed in INDEX.md")
            continue
        fields = read_front_matter(path) or {}
        if listed[target] != (fields.get("published"), fields.get("source")):
            findings.append(
                f"{target}: INDEX.md provenance does not match the document's `published`/`source`"
            )
    for target in listed:
        if not (REFERENCES_DIR / target).is_file():
            findings.append(f"INDEX.md lists {target}, which does not exist")


def check_links(findings):
    linked_images = {}
    for path in documents():
        for target in MARKDOWN_LINK.findall(path.read_text(encoding="utf-8")):
            if target.startswith("/"):
                findings.append(f"{relative(path)}: absolute path in link: {target}")
                continue
            if "://" in target or target.startswith("mailto:"):
                continue
            resolved = (path.parent / target.split("#")[0]).resolve()
            if not resolved.is_file():
                findings.append(f"{relative(path)}: link does not resolve: {target}")
            elif resolved.suffix.lower() in IMAGE_SUFFIXES:
                linked_images.setdefault(resolved, set()).add(path)
    return linked_images


def check_images(findings, linked_images):
    for image in sorted(REFERENCES_DIR.rglob("*")):
        if not image.is_file() or image.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        if image.resolve() not in linked_images:
            findings.append(f"{relative(image)}: no document links to this image")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write-index",
        action="store_true",
        help="regenerate INDEX.md from the corpus before checking it",
    )
    arguments = parser.parse_args()

    if not REFERENCES_DIR.is_dir():
        print(f"ERROR: {REFERENCES_DIR} does not exist", file=sys.stderr)
        return 2
    if not documents():
        print(f"ERROR: no documents under {REFERENCES_DIR}", file=sys.stderr)
        return 2
    if arguments.write_index:
        write_index()
    if not INDEX_PATH.is_file():
        print(f"ERROR: {INDEX_PATH} does not exist; run with --write-index", file=sys.stderr)
        return 2

    findings = []
    check_front_matter(findings)
    check_index(findings)
    check_images(findings, check_links(findings))

    corpus = documents()
    collections = sorted({path.parent.name for path in corpus})
    images = [path for path in REFERENCES_DIR.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES]
    print(f"{len(corpus)} documents in {len(collections)} collections: {', '.join(collections)}")
    print(f"{len(images)} images")

    if findings:
        sys.stdout.flush()
        print(f"\nFINDINGS ({len(findings)}):", file=sys.stderr)
        for finding in findings:
            print(f"  {finding}", file=sys.stderr)
        return 1

    print(
        "verify: clean — front matter complete, every document indexed with matching "
        "provenance, every link relative and resolving, no unlinked images"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
