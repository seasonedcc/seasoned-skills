#!/usr/bin/env python3
"""Convert the downloaded Shape Up pages into markdown at skill/references/01-shape-up/.

Parsing is deterministic: the same source HTML always produces byte-identical markdown.
Every page is reconciled against its source HTML before the run is allowed to succeed, so
the parser cannot silently drop prose.
"""

import argparse
import difflib
import html.parser
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = REPO_ROOT / "sources" / "shapeup"
RETRIEVED_PATH = SOURCES_DIR / "retrieved.json"
OUTPUT_DIR = REPO_ROOT / "skill" / "references" / "01-shape-up"
IMAGES_DIR = OUTPUT_DIR / "images"

SITE_ROOT = "https://basecamp.com"
PAGE_URL = SITE_ROOT + "/shapeup/{page}"
IMAGE_PATH_PREFIX = "/assets/images/books/shapeup/"
METHOD = "scripts/parse_shapeup.py"
BOOK_PUBLISHED = "2019"
USER_AGENT = "shaping-skill corpus builder (+https://github.com/seasonedcc/shaping-skill)"
REQUEST_DELAY_SECONDS = 0.5

VOID_TAGS = {"area", "base", "br", "col", "hr", "img", "input", "link", "meta", "source"}
BLOCK_TAGS = {
    "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "ul",
}
CHROME_TAGS = {"button", "footer", "form", "header", "nav", "script", "style", "svg", "template"}
CHROME_CLASSES = {"page-break"}
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z“\"(])")


class Element:
    __slots__ = ("tag", "attributes", "children")

    def __init__(self, tag, attributes):
        self.tag = tag
        self.attributes = attributes
        self.children = []


class DocumentBuilder(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element("root", {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attributes):
        element = Element(tag, dict(attributes))
        self.stack[-1].children.append(element)
        if tag not in VOID_TAGS:
            self.stack.append(element)

    def handle_startendtag(self, tag, attributes):
        self.stack[-1].children.append(Element(tag, dict(attributes)))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse_document(source):
    builder = DocumentBuilder()
    builder.feed(source)
    builder.close()
    return builder.root


def find_element(element, tag, css_class):
    if element.tag == tag and css_class in element.attributes.get("class", "").split():
        return element
    for child in element.children:
        if isinstance(child, Element):
            found = find_element(child, tag, css_class)
            if found is not None:
                return found
    return None


def article_body(element):
    """Copy an element with the site's chrome removed, leaving only the book's own prose."""
    body = Element(element.tag, element.attributes)
    for child in element.children:
        if isinstance(child, str):
            body.children.append(child)
        elif child.tag in CHROME_TAGS:
            continue
        elif CHROME_CLASSES & set(child.attributes.get("class", "").split()):
            continue
        else:
            body.children.append(article_body(child))
    return body


def collapse(text):
    return re.sub(r"\s+", " ", text)


def slugify(title):
    slug = title.lower().replace("’", "").replace("'", "")
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def image_filename(source):
    if not source.startswith(IMAGE_PATH_PREFIX):
        raise ValueError(f"unexpected image source: {source}")
    return source[len(IMAGE_PATH_PREFIX):].replace("/", "-")


def wrap(text, marker):
    stripped = text.strip()
    if not stripped:
        return text
    leading = " " if text[:1].isspace() else ""
    trailing = " " if text[-1:].isspace() else ""
    return f"{leading}{marker}{stripped}{marker}{trailing}"


class MarkdownRenderer:
    def __init__(self, link_targets):
        self.link_targets = link_targets
        self.images = {}

    def render(self, element):
        return "\n\n".join(self.render_blocks(element))

    def render_blocks(self, element):
        blocks = []
        inline = []
        for child in element.children:
            if isinstance(child, Element) and child.tag in BLOCK_TAGS:
                blocks.extend(self.flush(inline))
                inline = []
                blocks.extend(self.render_block(child))
            else:
                inline.append(child)
        blocks.extend(self.flush(inline))
        return blocks

    def flush(self, nodes):
        text = self.render_inline(nodes).strip()
        return [text] if text else []

    def render_block(self, element):
        tag = element.tag
        if tag == "hr":
            return ["---"]
        if tag == "p":
            text = self.render_inline(element.children).strip()
            return [text] if text else []
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            text = self.render_inline(element.children).strip()
            return ["#" * int(tag[1]) + " " + text] if text else []
        if tag in ("ul", "ol"):
            return [self.render_list(element)]
        if tag == "blockquote":
            inner = "\n\n".join(self.render_blocks(element))
            quoted = "\n".join(f"> {line}".rstrip() for line in inner.split("\n"))
            return [quoted] if inner else []
        if tag == "figcaption":
            return [wrap(block, "*") for block in self.render_blocks(element)]
        if tag == "dl":
            return [self.render_definition_list(element)]
        return self.render_blocks(element)

    def render_list(self, element):
        ordered = element.tag == "ol"
        lines = []
        position = 0
        for child in element.children:
            if not (isinstance(child, Element) and child.tag == "li"):
                continue
            position += 1
            marker = f"{position}. " if ordered else "- "
            body = "\n\n".join(self.render_blocks(child)).split("\n")
            lines.append(marker + body[0])
            lines.extend(" " * len(marker) + line if line else "" for line in body[1:])
        return "\n".join(lines)

    def render_definition_list(self, element):
        lines = []
        for child in element.children:
            if not isinstance(child, Element):
                continue
            if child.tag == "dt":
                if lines:
                    lines.append("")
                lines.append(self.render_inline(child.children).strip())
            elif child.tag == "dd":
                lines.append(": " + self.render_inline(child.children).strip())
        return "\n".join(lines)

    def render_inline(self, nodes):
        parts = []
        for node in nodes:
            if isinstance(node, str):
                parts.append(collapse(node))
            elif node.tag == "img":
                parts.append(self.render_image(node))
            elif node.tag == "br":
                parts.append("\n")
            elif node.tag in ("em", "i"):
                parts.append(wrap(self.render_inline(node.children), "*"))
            elif node.tag in ("strong", "b"):
                parts.append(wrap(self.render_inline(node.children), "**"))
            elif node.tag == "code":
                parts.append(wrap(self.render_inline(node.children), "`"))
            elif node.tag == "a":
                parts.append(self.render_link(node))
            elif node.tag in ("sub", "sup"):
                parts.append(f"<{node.tag}>{self.render_inline(node.children)}</{node.tag}>")
            else:
                parts.append(self.render_inline(node.children))
        return "".join(parts)

    def render_image(self, element):
        source = element.attributes.get("src", "")
        filename = image_filename(source)
        self.images[filename] = SITE_ROOT + source
        alt = collapse(element.attributes.get("alt", "")).strip()
        return f"![{alt}](images/{filename})"

    def render_link(self, element):
        href = element.attributes.get("href", "")
        text = self.render_inline(element.children)
        if href.startswith("/assets/"):
            return text
        stripped = text.strip()
        if not stripped:
            return text
        leading = " " if text[:1].isspace() else ""
        trailing = " " if text[-1:].isspace() else ""
        return f"{leading}[{stripped}]({self.resolve(href)}){trailing}"

    def resolve(self, href):
        if href.startswith("/shapeup/"):
            page, _, fragment = href[len("/shapeup/"):].partition("#")
            if page not in self.link_targets:
                raise ValueError(f"link to a page outside the corpus: {href}")
            return self.link_targets[page] + (f"#{fragment}" if fragment else "")
        if href.startswith("/"):
            raise ValueError(f"unhandled absolute link: {href}")
        return href


def page_title(document):
    masthead = find_element(document, "p", "intro__masthead")
    heading = find_element(document, "h1", "intro__title")
    if heading is None:
        raise ValueError("page has no title")
    title = collapse(plain_text(heading)).strip()
    if masthead is None:
        return title, title
    return f"{collapse(plain_text(masthead)).strip()} {title}", title


def plain_text(element):
    parts = []
    for child in element.children:
        if isinstance(child, str):
            parts.append(child)
        elif child.tag == "img":
            parts.append(" " + child.attributes.get("alt", "") + " ")
        else:
            parts.append(plain_text(child))
    return "".join(parts)


def strip_markdown(text):
    """Reduce generated markdown back to the prose it carries, for the fidelity diff.

    Structural markers become nothing rather than whitespace, so that emphasis or code
    spans hugging punctuation ("`cycles`.") do not split into separate words.
    """
    body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
    body = re.sub(r"^\s*---\s*$", " ", body, flags=re.M)
    body = re.sub(r"^\s*#{1,6}\s+", " ", body, flags=re.M)
    body = re.sub(r"^\s*>\s?", " ", body, flags=re.M)
    body = re.sub(r"^\s*(?:[-*+]|\d+\.|:)\s+", " ", body, flags=re.M)
    body = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", body)
    body = re.sub(r"</?[a-z]+>", "", body)
    return body.replace("*", "").replace("`", "")


def reconcile(page, title_line, content, markdown):
    source_words = (title_line + " " + plain_text(content)).split()
    output_words = strip_markdown(markdown).split()
    findings = []

    matcher = difflib.SequenceMatcher(None, source_words, output_words, autojunk=False)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue
        findings.append(
            f"  {page}: {opcode} at word {i1}\n"
            f"    source:   {' '.join(source_words[i1:i2])[:300]!r}\n"
            f"    markdown: {' '.join(output_words[j1:j2])[:300]!r}"
        )

    normalized_output = " ".join(output_words)
    sentences = [s for s in SENTENCE_BOUNDARY.split(" ".join(source_words)) if s.strip()]
    dropped = [s for s in sentences if s not in normalized_output]
    for sentence in dropped:
        findings.append(f"  {page}: dropped sentence {sentence[:300]!r}")

    return len(source_words), len(output_words), len(sentences), findings


def download_images(images):
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    fetched = 0
    for filename in sorted(images):
        destination = IMAGES_DIR / filename
        if destination.exists():
            continue
        if fetched:
            time.sleep(REQUEST_DELAY_SECONDS)
        request = urllib.request.Request(images[filename], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            destination.write_bytes(response.read())
        fetched += 1
        print(f"image    {filename}")
    for existing in sorted(IMAGES_DIR.iterdir()):
        if existing.name not in images:
            existing.unlink()
            print(f"prune    {existing.name}")
    return fetched


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()

    pages = sorted(path.stem for path in SOURCES_DIR.glob("*.html"))
    if not pages:
        print(f"ERROR: no sources in {SOURCES_DIR}; run download_shapeup.py first", file=sys.stderr)
        return 2
    if not RETRIEVED_PATH.exists():
        print(f"ERROR: {RETRIEVED_PATH} is missing; run download_shapeup.py first", file=sys.stderr)
        return 2
    retrieved = json.loads(RETRIEVED_PATH.read_text(encoding="utf-8"))

    documents = {page: parse_document((SOURCES_DIR / f"{page}.html").read_text(encoding="utf-8")) for page in pages}
    titles = {page: page_title(documents[page]) for page in pages}
    link_targets = {
        page: f"{index:02d}-{slugify(titles[page][1])}.md" for index, page in enumerate(pages)
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUTPUT_DIR.glob("*.md"):
        stale.unlink()

    images = {}
    findings = []
    for page in pages:
        wrapper = find_element(documents[page], "div", "content")
        if wrapper is None:
            print(f"ERROR: {page} has no article body", file=sys.stderr)
            return 2
        content = article_body(wrapper)

        renderer = MarkdownRenderer(link_targets)
        body = renderer.render(content)
        images.update(renderer.images)

        title_line, _ = titles[page]
        front_matter = (
            "---\n"
            f"source: {PAGE_URL.format(page=page)}\n"
            f"published: {BOOK_PUBLISHED}\n"
            f"retrieved: {retrieved[page]}\n"
            f"method: {METHOD}\n"
            "---\n"
        )
        markdown = f"{front_matter}\n# {title_line}\n\n{body}\n"
        (OUTPUT_DIR / link_targets[page]).write_text(markdown, encoding="utf-8")

        source_words, output_words, sentences, page_findings = reconcile(page, title_line, content, markdown)
        findings.extend(page_findings)
        status = "OK" if not page_findings else "MISMATCH"
        print(
            f"{status:8} {link_targets[page]:44} "
            f"{source_words:5} words / {sentences:4} sentences reconciled"
        )

    try:
        fetched = download_images(images)
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        print(f"ERROR: fetching images failed: {error}", file=sys.stderr)
        return 2
    print(f"\n{len(pages)} chapters, {len(images)} images ({fetched} newly downloaded)")

    if findings:
        sys.stdout.flush()
        print(f"\nFIDELITY FAILURES ({len(findings)}):", file=sys.stderr)
        for finding in findings:
            print(finding, file=sys.stderr)
        return 1

    print("Fidelity: every page's markdown reproduces its source word-for-word.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
