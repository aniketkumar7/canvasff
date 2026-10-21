"""Free car photos: search Unsplash, Pexels, Pixabay and Wikimedia Commons, 10 per page.

API keys come from the environment (UNSPLASH_KEY, PEXELS_KEY, PIXABAY_KEY); a source without its key is
simply not offered. Wikimedia needs no key; only licences that allow commercial use and edits are shown.

Picking a photo sends just (source, id). The server looks the photo up again by id and downloads it only
from that source's own image host, so a request can never point the server at an arbitrary URL.
"""
import json, os, re, time, urllib.parse, urllib.request

PAGE = 10
TTL = 3600
UA = {"User-Agent": "CanvasFF/1.0 (personal Shorts tool)"}
HOSTS = {  # where each source's image files live
    "unsplash": {"images.unsplash.com"},
    "pexels": {"images.pexels.com"},
    "pixabay": {"pixabay.com", "cdn.pixabay.com"},
    "wikimedia": {"upload.wikimedia.org", "thumb.wikimedia.org"},  # resized copies come from thumb.
}
LABELS = {"unsplash": "Unsplash", "pexels": "Pexels", "pixabay": "Pixabay", "wikimedia": "Wikimedia"}
FREE_LICENSE = re.compile(r"^(cc0|cc by(-sa)?( [\d.]+)?( [a-z]+)?|public domain|pd)$", re.I)  # no NC / ND

_cache: dict[str, tuple[float, dict]] = {}


def _key(source: str) -> str:
    return os.environ.get(f"{source.upper()}_KEY", "")


def sources() -> list[dict]:
    return [{"id": s, "label": LABELS[s]} for s in LABELS if s == "wikimedia" or _key(s)]


def _json(url: str, headers: dict | None = None) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _item(source, id_, thumb, full, w, h, author, license_, page_url):
    credit = f"Photo: {author}, {license_}, via {LABELS[source]}" if source == "wikimedia" else f"Photo: {author} on {LABELS[source]}"
    return {"source": source, "id": str(id_), "thumb": thumb, "full": full, "width": w, "height": h,
            "author": author, "license": license_, "credit": credit, "page": page_url}


# ---------- per source: search(q, page) -> (items, more) and get(id) -> item ----------

def _unsplash(q=None, page=0, id_=None):
    auth = {"Authorization": f"Client-ID {_key('unsplash')}", "Accept-Version": "v1"}
    conv = lambda p: {**_item("unsplash", p["id"], p["urls"]["small"], p["urls"]["regular"].replace("w=1080", "w=2400"),
                              p["width"], p["height"], p["user"]["name"], "Unsplash License", p["links"]["html"]),
                      "_track": p["links"]["download_location"]}
    if id_:
        return conv(_json(f"https://api.unsplash.com/photos/{urllib.parse.quote(id_)}", auth))
    d = _json(f"https://api.unsplash.com/search/photos?{urllib.parse.urlencode({'query': q, 'page': page + 1, 'per_page': PAGE, 'orientation': 'landscape'})}", auth)
    return [conv(p) for p in d["results"]], page + 1 < d.get("total_pages", 0)


def _pexels(q=None, page=0, id_=None):
    auth = {"Authorization": _key("pexels")}
    conv = lambda p: _item("pexels", p["id"], p["src"]["medium"], p["src"]["large2x"], p["width"], p["height"],
                           p["photographer"], "Pexels License", p["url"])
    if id_:
        return conv(_json(f"https://api.pexels.com/v1/photos/{urllib.parse.quote(id_)}", auth))
    d = _json(f"https://api.pexels.com/v1/search?{urllib.parse.urlencode({'query': q, 'page': page + 1, 'per_page': PAGE})}", auth)
    return [conv(p) for p in d["photos"]], bool(d.get("next_page"))


def _pixabay(q=None, page=0, id_=None):
    base = {"key": _key("pixabay"), "image_type": "photo", "safesearch": "true"}
    conv = lambda p: _item("pixabay", p["id"], p["webformatURL"], p["largeImageURL"], p["imageWidth"], p["imageHeight"],
                           p["user"], "Pixabay Content License", p["pageURL"])
    if id_:
        hits = _json(f"https://pixabay.com/api/?{urllib.parse.urlencode({**base, 'id': id_})}")["hits"]
        return conv(hits[0]) if hits else None
    d = _json(f"https://pixabay.com/api/?{urllib.parse.urlencode({**base, 'q': q, 'page': page + 1, 'per_page': PAGE})}")
    return [conv(p) for p in d["hits"]], (page + 1) * PAGE < d.get("totalHits", 0)


def _wikimedia(q=None, page=0, id_=None):
    def query(params):
        params = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|size|extmetadata",
                  "iiurlwidth": 2400, "iiextmetadatafilter": "LicenseShortName|Artist", **params}
        return _json(f"https://commons.wikimedia.org/w/api.php?{urllib.parse.urlencode(params)}")

    def conv(p):
        ii = p["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if not FREE_LICENSE.match(lic.strip()):
            return None
        author = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()[:80] or "Unknown"
        thumb = ii.get("thumburl", ii["url"]).replace("2400px-", "480px-")
        return _item("wikimedia", p["title"], thumb, ii.get("thumburl", ii["url"]), ii["width"], ii["height"],
                     author, lic, ii.get("descriptionurl", ""))

    if id_:
        pages = query({"titles": id_}).get("query", {}).get("pages", {})
        return next((conv(p) for p in pages.values() if "imageinfo" in p), None)
    d = query({"generator": "search", "gsrsearch": f"{q} filetype:bitmap", "gsrnamespace": 6, "gsrlimit": PAGE,
               "gsroffset": page * PAGE})
    pages = sorted(d.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    return [i for i in (conv(p) for p in pages if "imageinfo" in p) if i], "continue" in d


SOURCES = {"unsplash": _unsplash, "pexels": _pexels, "pixabay": _pixabay, "wikimedia": _wikimedia}


def search(source: str, q: str, page: int = 0) -> dict:
    """{items, more}: 10 photos for q from one source, cached for an hour."""
    q = " ".join(q.split())[:80]
    key = f"{source}:{q.lower()}:{page}"
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    items, more = SOURCES[source](q=q, page=page)
    res = {"items": [{k: v for k, v in i.items() if not k.startswith("_")} for i in items], "more": more}
    _cache[key] = (time.time(), res)
    return res


def download(source: str, id_: str, dest, limit: int = 25 << 20) -> dict:
    """Look the photo up again by id, download it from the source's own host, return its item (for the credit)."""
    item = SOURCES[source](id_=id_)
    if not item or urllib.parse.urlparse(item["full"]).hostname not in HOSTS[source]:
        raise ValueError(f"unknown {LABELS[source]} photo")
    if "_track" in item:  # Unsplash asks apps to report each use of a photo
        try:
            _json(item["_track"], {"Authorization": f"Client-ID {_key('unsplash')}"})
        except OSError:
            pass  # reporting is best effort, the download itself still counts
    size = 0
    with urllib.request.urlopen(urllib.request.Request(item["full"], headers=UA), timeout=60) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 20):
            size += len(chunk)
            if size > limit:
                raise ValueError("photo too big")
            f.write(chunk)
    return item
