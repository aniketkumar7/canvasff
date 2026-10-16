"""NoCopyrightSounds catalogue: phonk tracks + their required credit text, scraped from ncs.io and cached.

NCS lets creators use its music for free if the credit block is in the video description.
Only tracks found in NCS's own listing can be fetched, and only from NCS's own file host,
so a request can't point the server at an arbitrary URL.
"""
import html, re, threading, time, urllib.parse, urllib.request

GENRES = {"phonk": 16, "brazilian": 26}  # ncs.io genre ids
SITE = "https://ncs.io"
FILE_HOST = "ncsmusic.s3.eu-west-1.amazonaws.com"
TTL = 12 * 3600
MAX_PAGES = 15
UA = {"User-Agent": "Mozilla/5.0 (CanvasFF personal Shorts tool)"}

_lock = threading.Lock()
_lists: dict[str, tuple[float, list[dict]]] = {}
_credits: dict[str, str] = {}

ROW = re.compile(r"<tr>(.*?)</tr>", re.S)
PLAY = re.compile(r'class="player-play"(.*?)><i', re.S)  # data-artist holds HTML, so no [^>]
ATTR = re.compile(r'data-(url|artistraw|track|cover|genre)="([^"]*)"')
SLUG = re.compile(r'<a href="/([A-Za-z0-9_-]+)">\s*<p>')
CREDIT = re.compile(r'<p class="p-copy"[^>]*>(.*?)</p>', re.S)


def _get(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _parse(page: str, genre: str) -> list[dict]:
    out = []
    for row in ROW.findall(page):
        play, slug = PLAY.search(row), SLUG.search(row)
        if not play or not slug:
            continue
        a = {k: html.unescape(v) for k, v in ATTR.findall(play.group(1))}
        if urllib.parse.urlparse(a.get("url", "")).hostname != FILE_HOST:
            continue
        out.append({"id": slug.group(1), "title": a.get("track", ""), "artist": a.get("artistraw", ""),
                    "genre": a.get("genre", genre), "cover": a.get("cover", ""), "url": a["url"]})
    return out


def tracks(genre: str) -> list[dict]:
    """Every track of a genre (newest first), cached for TTL."""
    with _lock:
        hit = _lists.get(genre)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
    items, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        rows = _parse(_get(f"{SITE}/music-search?genre={GENRES[genre]}&page={page}"), genre)
        rows = [r for r in rows if r["id"] not in seen]
        if not rows:
            break
        seen.update(r["id"] for r in rows)
        items += rows
    with _lock:
        _lists[genre] = (time.time(), items)
    return items


def find(slug: str) -> dict | None:
    for g in GENRES:
        for t in tracks(g):
            if t["id"] == slug:
                return t
    return None


def credit(slug: str) -> str:
    """The exact credit block NCS asks for, from the track's page."""
    if slug not in _credits:
        m = CREDIT.search(_get(f"{SITE}/{urllib.parse.quote(slug)}"))
        text = re.sub(r"<br\s*/?>", "\n", m.group(1)) if m else ""
        _credits[slug] = "\n".join(l.strip() for l in html.unescape(re.sub(r"<[^>]+>", "", text)).splitlines() if l.strip())
    return _credits[slug]


def download(track: dict, dest, limit: int):
    if urllib.parse.urlparse(track["url"]).hostname != FILE_HOST:
        raise ValueError("not an NCS file")
    size = 0
    with urllib.request.urlopen(urllib.request.Request(track["url"], headers=UA), timeout=60) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            size += len(chunk)
            if size > limit:
                raise ValueError("song file too big")
            f.write(chunk)
