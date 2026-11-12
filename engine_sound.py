"""Find a free, licensed engine recording for a car (Openverse: Freesound, Wikimedia, ...; no API key).

  python engine_sound.py "input/car/Porsche 911 GT3 RS"      -> engine.mp3 + engine.credit.txt in that folder

Only CC0 and CC BY are accepted (both allow monetized use; BY needs the credit, which goes in the description).
Only recordings whose title mentions the engine side of the car are taken (no door slams), 4-120 s long.
ALWAYS listen before posting: a quiz with the wrong car's engine is worse than no quiz.
"""
import json, pathlib, re, sys, urllib.parse, urllib.request

API = "https://api.openverse.org/v1/audio/"
UA = {"User-Agent": "CanvasFF/1.0 (personal Shorts tool)"}
ENGINE = re.compile(r"engine|exhaust|rev|idle|accelerat|start[- ]?up|cold start|launch|flyby|fly-by|drive.?by|v8|v10|v12|turbo", re.I)
NOT = re.compile(r"door|horn|alarm|interior|wiper|radio|seat", re.I)
HOSTS = {"cdn.freesound.org", "freesound.org", "upload.wikimedia.org"}


def search(car: str) -> list[dict]:
    q = urllib.parse.urlencode({"q": f"{car} engine", "license": "cc0,by", "page_size": 20})
    with urllib.request.urlopen(urllib.request.Request(f"{API}?{q}", headers=UA), timeout=30) as r:
        results = json.loads(r.read())["results"]
    words = [w.lower() for w in car.split() if len(w) > 1]
    keep = []
    for x in results:
        title = x.get("title") or ""
        dur = (x.get("duration") or 0) / 1000
        host = urllib.parse.urlparse(x.get("url", "")).hostname
        if not ENGINE.search(title) or NOT.search(title) or not 4 <= dur <= 120 or host not in HOSTS:
            continue
        # prefer titles naming more of the car ("porsche 911 gt3" beats "porsche")
        score = sum(w in title.lower() for w in words)
        keep.append((score, x))
    keep.sort(key=lambda s: -s[0])
    return [x for s, x in keep if s > 0]


def fetch(folder: pathlib.Path, car: str | None = None) -> pathlib.Path | None:
    """Download the best match into `folder`; `car` defaults to the folder name (minus any @x,y focus)."""
    car = car or folder.name.partition("@")[0]
    hits = search(car)
    if not hits:
        print(f"no licensed engine recording found for {car!r}; add engine.mp3 yourself (Freesound, CC0/CC BY)")
        return None
    x = hits[0]
    ext = ".ogg" if x.get("filetype") in ("ogg", "ogx", "oga") else ".mp3"
    dest = folder / f"engine{ext}"
    with urllib.request.urlopen(urllib.request.Request(x["url"], headers=UA), timeout=60) as r:
        dest.write_bytes(r.read())
    lic = f"CC {x['license'].upper()} {x.get('license_version') or ''}".replace("CC CC0", "CC0").strip()
    credit = f"Engine sound: \"{x['title']}\" by {x.get('creator') or 'unknown'} ({lic}), {x.get('foreign_landing_url') or x['url']}"
    (folder / "engine.credit.txt").write_text(credit, encoding="utf-8")
    print(f"saved {dest.name}: {x['title']} [{lic}] - LISTEN before posting")
    return dest


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        fetch(pathlib.Path(arg))
