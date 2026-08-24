#!/usr/bin/env python3
"""Convert the downloaded posts into markdown at skill/references/03-articles/.

Parsing is deterministic: the same source HTML always produces byte-identical markdown.
Every post is reconciled against its source HTML before the run is allowed to succeed, so
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
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = REPO_ROOT / "sources" / "articles"
INDEX_PATH = SOURCES_DIR / "index.html"
RETRIEVED_PATH = SOURCES_DIR / "retrieved.json"
OUTPUT_DIR = REPO_ROOT / "skill" / "references" / "03-articles"
IMAGES_DIR = OUTPUT_DIR / "images"

SITE_ROOT = "https://www.ryansinger.co"
POST_URL = SITE_ROOT + "/{slug}/"
POST_HOSTS = {"www.ryansinger.co", "ryansinger.co"}

# Posts republished from Ryan's former site link to their siblings under the old domain's
# numbered paths. When the target sits in this corpus, the reader gets the corpus copy —
# the old URLs no longer resolve to the articles.
FORMER_SITE_HOSTS = {"feltpresence.com", "www.feltpresence.com"}
FORMER_SITE_ARTICLE = re.compile(r"^articles/\d+-(?P<slug>.+?)/?$")
METHOD = "scripts/parse_articles.py"
USER_AGENT = "seasoned-skills corpus builder (+https://github.com/seasonedcc/seasoned-skills)"
REQUEST_DELAY_SECONDS = 0.5

VOID_TAGS = {"area", "base", "br", "col", "hr", "img", "input", "link", "meta", "source"}
BLOCK_TAGS = {
    "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "ul",
}
CHROME_TAGS = {"button", "footer", "form", "header", "nav", "script", "style", "svg", "template"}
EMPHASIS_MARKERS = {"em": "*", "i": "*", "strong": "**", "b": "**", "code": "`"}
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z“\"(])")

# Ghost serves post images from its own storage and, for posts imported from Medium, from
# Medium's CDN. The path after each host's prefix names the file within the corpus.
IMAGE_PATH_PREFIXES = {
    "storage.ghost.io": re.compile(r"^/.*?/content/images/"),
    "miro.medium.com": re.compile(r"^/v2/(?:[a-z]+:[a-z]+:\d+/)?"),
}
UNSAFE_FILENAME_CHARACTERS = re.compile(r"[^A-Za-z0-9._-]+")

# Ghost embeds are players, not prose. Each becomes a labeled link so nothing vanishes.
EMBED_HOSTS = {"www.youtube.com", "player.vimeo.com"}
EMBED_LABEL = "Embedded video"

PUBLISHED_PROPERTY = "article:published_time"
PUBLISHED_TIMESTAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})T")


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
    """Copy an element with the site's chrome removed, leaving only the post's own prose."""
    body = Element(element.tag, element.attributes)
    for child in element.children:
        if isinstance(child, str):
            body.children.append(child)
        elif child.tag in CHROME_TAGS:
            continue
        else:
            body.children.append(article_body(child))
    return body


def collapse(text):
    return re.sub(r"\s+", " ", text)


def image_filename(source):
    parsed = urllib.parse.urlsplit(source)
    prefix = IMAGE_PATH_PREFIXES.get(parsed.netloc.lower())
    if prefix is None:
        raise ValueError(f"image from an unhandled host: {source}")
    match = prefix.match(parsed.path)
    if match is None:
        raise ValueError(f"unexpected image path: {source}")
    return UNSAFE_FILENAME_CHARACTERS.sub("-", parsed.path[match.end():])


def embed_label(element):
    source = element.attributes.get("src", "")
    if urllib.parse.urlsplit(source).netloc.lower() not in EMBED_HOSTS:
        raise ValueError(f"embed from an unhandled host: {source}")
    title = collapse(element.attributes.get("title") or "").strip()
    return f"{EMBED_LABEL}: {title or source}", source


def wrap(text, marker):
    """Mark up text, leaving it alone when the marker is already the whole span.

    Some posts carry redundant nesting from their import into Ghost — <strong> around a
    <strong> around the same words. Emphasis does not nest in markdown, where `****bold****`
    reads as four literal asterisks, so the second marker is dropped.
    """
    stripped = text.strip()
    if not stripped:
        return text
    inner = stripped[len(marker):-len(marker)]
    if stripped.startswith(marker) and stripped.endswith(marker) and marker not in inner:
        return text
    leading = " " if text[:1].isspace() else ""
    trailing = " " if text[-1:].isspace() else ""
    return f"{leading}{marker}{stripped}{marker}{trailing}"


class MarkdownRenderer:
    def __init__(self, link_targets):
        self.link_targets = link_targets
        self.images = {}
        self.links_outside_the_corpus = []

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

    def render_text(self, nodes):
        """Render inline nodes as a block's text, with no space stranded against a break."""
        return re.sub(r"[ \t]*\n[ \t]*", "\n", self.render_inline(nodes)).strip()

    def flush(self, nodes):
        text = self.render_text(nodes)
        return [text] if text else []

    def render_block(self, element):
        tag = element.tag
        if tag == "hr":
            return ["---"]
        if tag == "p":
            text = self.render_text(element.children)
            return [text] if text else []
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            text = self.render_text(element.children)
            return ["#" * int(tag[1]) + " " + text] if text else []
        if tag in ("ul", "ol"):
            return [self.render_list(element)]
        if tag == "blockquote":
            inner = "\n\n".join(self.render_blocks(element))
            quoted = "\n".join(f"> {line}".rstrip() for line in inner.split("\n"))
            return [quoted] if inner else []
        if tag == "figcaption":
            return [wrap(block, "*") for block in self.render_blocks(element)]
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

    def render_inline(self, nodes):
        """Render inline nodes, marking each run of touching emphasis up only once.

        Posts imported into Ghost sometimes carry a phrase split across neighbouring
        <strong> elements. Marking each one separately would close and reopen the emphasis
        mid-phrase ("**concept****.**"), which markdown renders as literal asterisks.
        """
        parts = []
        index = 0
        while index < len(nodes):
            node = nodes[index]
            marker = EMPHASIS_MARKERS.get(node.tag) if isinstance(node, Element) else None
            if marker is None:
                parts.append(self.render_node(node))
                index += 1
                continue
            run = []
            while (
                index < len(nodes)
                and isinstance(nodes[index], Element)
                and EMPHASIS_MARKERS.get(nodes[index].tag) == marker
            ):
                run.extend(nodes[index].children)
                index += 1
            parts.append(wrap(self.render_inline(run), marker))
        return "".join(parts)

    def render_node(self, node):
        if isinstance(node, str):
            return collapse(node)
        if node.tag == "img":
            return self.render_image(node)
        if node.tag == "iframe":
            return self.render_embed(node)
        if node.tag == "br":
            return "\n"
        if node.tag == "a":
            return self.render_link(node)
        if node.tag in ("sub", "sup"):
            return f"<{node.tag}>{self.render_inline(node.children)}</{node.tag}>"
        return self.render_inline(node.children)

    def render_image(self, element):
        source = element.attributes.get("src", "")
        filename = image_filename(source)
        if self.images.setdefault(filename, source) != source:
            raise ValueError(f"two images share the filename {filename}: {source}")
        alt = collapse(element.attributes.get("alt") or "").strip()
        return f"![{alt}](images/{filename})"

    def render_embed(self, element):
        label, source = embed_label(element)
        return f"[{label}]({source})"

    def render_link(self, element):
        href = element.attributes.get("href", "")
        text = self.render_inline(element.children)
        stripped = text.strip()
        if not stripped:
            return text
        leading = " " if text[:1].isspace() else ""
        trailing = " " if text[-1:].isspace() else ""
        return f"{leading}[{stripped}]({self.resolve(href)}){trailing}"

    def resolve(self, href):
        parsed = urllib.parse.urlsplit(href)
        if parsed.scheme not in ("http", "https", "mailto"):
            raise ValueError(f"unhandled link: {href}")
        if parsed.netloc.lower() in FORMER_SITE_HOSTS:
            match = FORMER_SITE_ARTICLE.match(parsed.path.strip("/"))
            if match and match.group("slug") in self.link_targets:
                return self.link_targets[match.group("slug")] + (
                    f"#{parsed.fragment}" if parsed.fragment else ""
                )
            return href
        if parsed.netloc.lower() not in POST_HOSTS:
            return href
        slug = parsed.path.strip("/")
        if slug not in self.link_targets:
            self.links_outside_the_corpus.append(href)
            return href
        return self.link_targets[slug] + (f"#{parsed.fragment}" if parsed.fragment else "")


def post_title(document):
    heading = find_element(document, "h1", "font-headline")
    if heading is None:
        raise ValueError("post has no title")
    title = "".join(
        child if isinstance(child, str) else plain_text(child)
        for child in heading.children
        if isinstance(child, str) or child.tag != "p"
    )
    title = collapse(title).strip()
    if not title:
        raise ValueError("post has an empty title")
    return title


def published_date(document):
    """Read the post's own publication date from its Ghost metadata, or refuse to guess."""
    for meta in find_meta_elements(document):
        if meta.attributes.get("property") != PUBLISHED_PROPERTY:
            continue
        timestamp = PUBLISHED_TIMESTAMP.match(meta.attributes.get("content", ""))
        if timestamp is None:
            raise ValueError(f"unreadable {PUBLISHED_PROPERTY}: {meta.attributes.get('content')!r}")
        return timestamp.group(1)
    raise ValueError(f"post carries no {PUBLISHED_PROPERTY} metadata")


def find_meta_elements(element):
    for child in element.children:
        if not isinstance(child, Element):
            continue
        if child.tag == "meta":
            yield child
        else:
            yield from find_meta_elements(child)


def plain_text(element):
    """Reduce an element to the words it shows, for the fidelity diff.

    Ghost writes blocks with no whitespace between them, so every block boundary and line
    break has to become one here — otherwise a paragraph's last word and the next one's
    first word would reduce to a single word the markdown could never match.
    """
    parts = []
    position = 0
    for child in element.children:
        if isinstance(child, str):
            parts.append(child)
        elif child.tag == "img":
            parts.append(" " + (child.attributes.get("alt") or "") + " ")
        elif child.tag == "iframe":
            parts.append(" " + embed_label(child)[0] + " ")
        elif child.tag == "br":
            parts.append(" ")
        elif child.tag == "li":
            position += 1
            marker = f"{position}. " if element.tag == "ol" else "- "
            parts.append(f" {marker}{plain_text(child)} ")
        elif child.tag in BLOCK_TAGS:
            parts.append(" " + plain_text(child) + " ")
        else:
            parts.append(plain_text(child))
    return "".join(parts)


def reduce_to_prose(text):
    """Reduce text to the prose words it carries, for the fidelity diff.

    Both sides of the diff go through this same reduction. Ryan writes literal asterisks,
    backticks and bracketed asides in his prose, so a character has to fall out of the
    source and the markdown alike — otherwise his own punctuation would read as a marker
    on one side and as prose on the other. Markers become nothing rather than whitespace,
    so that emphasis hugging punctuation ("*shaping*.") does not split into two words.
    """
    body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
    body = re.sub(r"^\s*---\s*$", " ", body, flags=re.M)
    body = re.sub(r"^\s*#{1,6}\s+", " ", body, flags=re.M)
    body = re.sub(r"^\s*>\s?", " ", body, flags=re.M)
    body = re.sub(r"!?\[([^\[\]]*)\]\([^)]*\)", r"\1", body)
    body = re.sub(r"</?[a-z]+>", "", body)
    return body.replace("*", "").replace("`", "")


def reconcile(slug, title, content, markdown):
    source_words = reduce_to_prose(title + " " + plain_text(content)).split()
    output_words = reduce_to_prose(markdown).split()
    findings = []

    matcher = difflib.SequenceMatcher(None, source_words, output_words, autojunk=False)
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            continue
        findings.append(
            f"  {slug}: {opcode} at word {i1}\n"
            f"    source:   {' '.join(source_words[i1:i2])[:300]!r}\n"
            f"    markdown: {' '.join(output_words[j1:j2])[:300]!r}"
        )

    normalized_output = " ".join(output_words)
    sentences = [s for s in SENTENCE_BOUNDARY.split(" ".join(source_words)) if s.strip()]
    dropped = [s for s in sentences if s not in normalized_output]
    for sentence in dropped:
        findings.append(f"  {slug}: dropped sentence {sentence[:300]!r}")

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

    if not INDEX_PATH.exists() or not RETRIEVED_PATH.exists():
        print(f"ERROR: no post index in {SOURCES_DIR}; run download_articles.py first", file=sys.stderr)
        return 2
    retrieved = json.loads(RETRIEVED_PATH.read_text(encoding="utf-8"))

    slugs = sorted(path.stem for path in SOURCES_DIR.glob("*.html") if path != INDEX_PATH)
    missing = [slug for slug in slugs if slug not in retrieved]
    if not slugs or missing:
        print(f"ERROR: {SOURCES_DIR} is incomplete; run download_articles.py first", file=sys.stderr)
        return 2

    documents = {slug: parse_document((SOURCES_DIR / f"{slug}.html").read_text(encoding="utf-8")) for slug in slugs}
    link_targets = {slug: f"{slug}.md" for slug in slugs}

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUTPUT_DIR.glob("*.md"):
        stale.unlink()

    images = {}
    findings = []
    notes = []
    for slug in slugs:
        wrapper = find_element(documents[slug], "div", "prose")
        if wrapper is None:
            print(f"ERROR: {slug} has no article body", file=sys.stderr)
            return 2
        content = article_body(wrapper)
        title = post_title(documents[slug])

        renderer = MarkdownRenderer(link_targets)
        body = renderer.render(content)
        for filename, source in renderer.images.items():
            if images.setdefault(filename, source) != source:
                raise ValueError(f"two images share the filename {filename}: {source}")
        notes.extend(f"  {slug}: links to {href}, which is not a post in the corpus"
                     for href in renderer.links_outside_the_corpus)

        front_matter = (
            "---\n"
            f"source: {POST_URL.format(slug=slug)}\n"
            f"published: {published_date(documents[slug])}\n"
            f"retrieved: {retrieved[slug]}\n"
            f"method: {METHOD}\n"
            "---\n"
        )
        markdown = f"{front_matter}\n# {title}\n\n{body}\n"
        (OUTPUT_DIR / link_targets[slug]).write_text(markdown, encoding="utf-8")

        source_words, output_words, sentences, post_findings = reconcile(slug, title, content, markdown)
        findings.extend(post_findings)
        status = "OK" if not post_findings else "MISMATCH"
        print(
            f"{status:8} {link_targets[slug]:62} "
            f"{source_words:5} words / {sentences:4} sentences reconciled"
        )

    try:
        fetched = download_images(images)
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        print(f"ERROR: fetching images failed: {error}", file=sys.stderr)
        return 2
    print(f"\n{len(slugs)} posts, {len(images)} images ({fetched} newly downloaded)")

    if notes:
        print(f"\nLINKS LEFT ABSOLUTE ({len(notes)}):")
        for note in notes:
            print(note)

    if findings:
        sys.stdout.flush()
        print(f"\nFIDELITY FAILURES ({len(findings)}):", file=sys.stderr)
        for finding in findings:
            print(finding, file=sys.stderr)
        return 1

    print("Fidelity: every post's markdown reproduces its source word-for-word.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
