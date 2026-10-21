"""NoCopyrightSounds catalogue: phonk tracks + their required credit text, scraped from ncs.io and cached.

NCS lets creators use its music for free if the credit block is in the video description.
Only tracks found in NCS's own listing can be fetched, and only from NCS's own file host,
so a request can't point the server at an arbitrary URL.
"""
import html, re, threading, time, urllib.parse, urllib.request

GENRES = {  # ncs.io genre ids that suit car edits (label shown in the web app)
    "phonk": (16, "Phonk"), "brazilian": (26, "Brazilian Phonk"), "trap": (14, "Trap"), "futuretrap": (57, "Future Trap"),
    "bass": (1, "Bass"), "basshouse": (18, "Bass House"), "midtempo": (22, "Midtempo Bass"), "dnb": (3, "Drum & Bass"),
    "dubstep": (5, "Dubstep"), "edm": (6, "EDM"), "electronic": (7, "Electronic"), "futurebass": (17, "Future Bass"),
    "hardstyle": (9, "Hardstyle"), "house": (10, "House"),
}
SITE = "https://ncs.io"
FILE_HOST = "ncsmusic.s3.eu-west-1.amazonaws.com"
TTL = 12 * 3600
NCS_PAGE = 20  # rows per ncs.io listing page
PAGE = 10      # rows per page we hand to the web app (more load as the user scrolls)
UA = {"User-Agent": "Mozilla/5.0 (CanvasFF personal Shorts tool)"}

_lock = threading.Lock()
_lists: dict[str, tuple[float, list[dict]]] = {}
_credits: dict[str, str] = {}
_index: dict[str, dict] = {}  # every track we've listed, by slug: only these can be credited/downloaded

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
    with _lock:
        _index.update((t["id"], t) for t in out)
    return out


def _ncs_page(query: str, n: int, genre: str) -> list[dict]:
    """One ncs.io music-search page (20 rows, newest first), cached for TTL."""
    key = f"{query}&page={n}"
    with _lock:
        hit = _lists.get(key)
        if hit and time.time() - hit[0] < TTL:
            return hit[1]
    rows = _parse(_get(f"{SITE}/music-search?{key}"), genre)
    with _lock:
        _lists[key] = (time.time(), rows)
    return rows


def _paged(query: str, page: int, genre: str) -> dict:
    """Our page (10 rows) of a listing: fetches only the one ncs.io page it falls in."""
    start = max(page, 0) * PAGE
    rows = _ncs_page(query, start // NCS_PAGE + 1, genre)
    off = start % NCS_PAGE
    return {"items": rows[off:off + PAGE], "more": len(rows) > off + PAGE or len(rows) == NCS_PAGE}


def tracks(genre: str, page: int = 0) -> dict:
    """{items, more}: the newest tracks of a genre, 10 at a time."""
    return _paged(f"genre={GENRES[genre][0]}", page, GENRES[genre][1])


def search(q: str, page: int = 0) -> dict:
    """{items, more}: tracks whose title or artist matches q (ncs.io's own search), 10 at a time."""
    return _paged(urllib.parse.urlencode({"q": " ".join(q.split())[:60]}), page, "")


TRACK_ATTR = re.compile(r'data-(url|artist|track|genre)="([^"]*)"')


def find(slug: str) -> dict | None:
    """A track the picker listed, or (after a server restart) read straight from its own ncs.io page.
    Either way the file must live on NCS's own host."""
    with _lock:
        if slug in _index:
            return _index[slug]
    attrs: dict[str, str] = {}
    for k, v in TRACK_ATTR.findall(_get(f"{SITE}/{urllib.parse.quote(slug)}")):
        attrs.setdefault(k, html.unescape(v))  # first match = the track's own player, not later widgets
    if urllib.parse.urlparse(attrs.get("url", "")).hostname != FILE_HOST or "/tracks/" not in attrs["url"]:
        return None
    track = {"id": slug, "title": attrs.get("track", ""), "artist": attrs.get("artist", ""),
             "genre": attrs.get("genre", ""), "cover": "", "url": attrs["url"]}
    with _lock:
        _index[slug] = track
    return track


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
