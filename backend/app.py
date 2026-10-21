"""CanvasFF API (Render). Stores uploads, triggers the GitHub Actions render, serves the result.

Flow: web POST /jobs -> GitHub workflow_dispatch -> worker GETs /jobs/{id}/input.zip, renders,
POSTs /jobs/{id}/result -> web polls GET /jobs/{id} and plays /jobs/{id}/video.mp4

Env: GH_REPO (owner/repo), GH_TOKEN (fine-grained PAT, Actions: read+write), WORKER_TOKEN (shared with
the workflow), FRONTEND_ORIGIN (Vercel URL, default *), DATA_DIR (default /tmp/canvasff).
Render's free disk is wiped on restart/deploy, so download your video once it's done.
"""
import hmac, json, os, pathlib, re, shutil, time, urllib.request, uuid, zipfile

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import ncs
import photos

DATA = pathlib.Path(os.environ.get("DATA_DIR", "/tmp/canvasff"))
GH_REPO, GH_TOKEN = os.environ.get("GH_REPO", ""), os.environ.get("GH_TOKEN", "")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
MEDIA = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".mkv", ".webm"}
SONGS = {".mp3", ".wav", ".m4a"}
MAX_FILE = 200 << 20  # per upload
MAX_ACTIVE = 3        # queued + rendering at once (each costs GitHub Actions minutes)
STALE = 40 * 60       # no word from the worker for this long -> error (run never started / died)
KEEP = 6 * 3600       # delete jobs older than this (Render's free disk is small)

app = FastAPI(title="CanvasFF")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("FRONTEND_ORIGIN", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


def job_dir(job_id):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id) or not (DATA / job_id).is_dir():
        raise HTTPException(404, "job not found (the server may have restarted)")
    return DATA / job_id


def state(d, **update):
    f = d / "job.json"
    s = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    if not update and s.get("status") in ("queued", "rendering") and time.time() - s["updated"] > STALE:
        update = {"status": "error", "error": f"No word from the GitHub worker for {STALE // 60} min. "
                                              f"Check https://github.com/{GH_REPO}/actions"}
    if update:
        s.update(update, updated=time.time())
        f.write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
    return s


def worker(token):
    if not WORKER_TOKEN or not hmac.compare_digest(token or "", WORKER_TOKEN):
        raise HTTPException(401, "bad worker token")


def save(upload, dest, limit=MAX_FILE):
    size = 0
    with dest.open("wb") as f:
        while chunk := upload.file.read(1 << 20):
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, f"{upload.filename} is over {limit >> 20} MB")
            f.write(chunk)


def sweep():
    """Drop old jobs; return how many are still queued/rendering."""
    active = 0
    for d in DATA.glob("*/"):
        s = state(d)
        if time.time() - s.get("created", 0) > KEEP:
            shutil.rmtree(d, ignore_errors=True)
        elif s.get("status") in ("queued", "rendering"):
            active += 1
    return active


def dispatch(job_id):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{GH_REPO}/actions/workflows/render.yml/dispatches",
        data=json.dumps({"ref": "main", "inputs": {"job_id": job_id}}).encode(), method="POST",
        headers={"Authorization": f"Bearer {GH_TOKEN}", "Accept": "application/vnd.github+json"})
    urllib.request.urlopen(req, timeout=15).close()


@app.api_route("/health", methods=["GET", "HEAD"])  # Uptime Robot checks with HEAD
def health():
    return {"ok": True}


STYLE = {  # allowed style picks from the web app (same names as OPTIONS in make_short.py)
    "mechanic": {"zoom", "glass", "pixel", "spotlight", "tiles", "silhouette"},
    "reveal": {"slam", "scramble", "stamp", "split"},
    "dropFx": {"flash", "zoomThrough", "glitch", "whip", "shatter"},
    "cut": {"punch", "whip", "spin", "zoom", "flash"},
    "look": {"clean", "neon", "tealOrange", "film", "night", "mono2color"},
    "hook": {"pop", "words", "type", "glitch", "marker"},
    "font": {"montserrat", "anton", "bebas"},
    "accent": {"#FFD400", "#00E5FF", "#FF2D55", "#B6FF00", "#FF7A00"},
    "ramp": {"on", "off"},
    "bars": {"on", "off"},
    "choices": {"on", "off"},
}


def parse_style(raw: str) -> dict:
    """Web-app style JSON -> only known keys with allowed values; on/off become booleans. Anything else = 422."""
    if not raw.strip():
        return {}
    try:
        s = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "style must be JSON")
    if not isinstance(s, dict) or any(k not in STYLE or v not in STYLE[k] for k, v in s.items()):
        raise HTTPException(422, "unknown style option")
    return {k: (v == "on") if v in ("on", "off") else v for k, v in s.items()}


def parse_picked(raw: str) -> list[tuple[str, str]]:
    """Photos picked in the web app's search: JSON [{source, id}] -> [(source, id)], at most 5, sources we offer."""
    if not raw.strip():
        return []
    try:
        items = json.loads(raw)
        picks = [(str(p["source"]), str(p["id"])[:300]) for p in items]
    except (ValueError, TypeError, KeyError):
        raise HTTPException(422, "picked must be JSON [{source, id}]")
    offered = {s["id"] for s in photos.sources()}
    if len(picks) > 5 or any(s not in offered for s, _ in picks):
        raise HTTPException(422, "pick up to 5 photos from the offered sources")
    return picks


@app.get("/photos/sources")
def photo_sources():
    return photos.sources()


@app.get("/photos")
def photo_search(source: str, q: str = Query(..., min_length=2, max_length=80), page: int = Query(0, ge=0, le=50)):
    """10 free photos per page from one source; the web app asks for more as you scroll."""
    if source not in {s["id"] for s in photos.sources()}:
        raise HTTPException(422, "unknown or unconfigured photo source")
    try:
        return photos.search(source, q, page)
    except (OSError, ValueError, KeyError) as e:
        raise HTTPException(502, f"couldn't search {photos.LABELS[source]}: {e}")


@app.post("/jobs")
def create_job(name: str = Form(..., max_length=40), kind: str = Form("car"), length: float = Form(10),
               focus: str = Form(""), credit: str = Form("", max_length=600),
               media: list[UploadFile] | None = File(None), song: UploadFile | None = File(None),
               song_ncs: str = Form("", max_length=80), style: str = Form("", max_length=600),
               picked: str = Form("", max_length=2000)):
    name = name.strip()
    media = media or []
    style_pick = parse_style(style)
    picks = parse_picked(picked)
    credit = credit.replace("\r\n", "\n")  # browsers send textarea lines as CRLF
    if not name or kind not in ("car", "plane") or not 8 <= length <= 30:
        raise HTTPException(422, "need a name, kind car/plane and length 8-30s")
    if not 1 <= len(media) + len(picks) <= 10:
        raise HTTPException(422, "add 1-10 clips or photos")
    track = None
    if song_ncs:  # a track from the NCS library: the server fetches it itself
        try:
            track = ncs.find(song_ncs)
        except OSError:
            raise HTTPException(502, "couldn't reach ncs.io, try again or upload the song")
        if not track:
            raise HTTPException(422, "unknown NCS track")
        song_ext = ".mp3"
    elif song:
        song_ext = pathlib.Path(song.filename or "").suffix.lower()
        if song_ext not in SONGS:
            raise HTTPException(422, "song must be mp3, wav or m4a")
    else:
        raise HTTPException(422, "pick an NCS track or upload a song")
    exts = [pathlib.Path(m.filename or "").suffix.lower() for m in media]
    if any(e not in MEDIA for e in exts):
        raise HTTPException(422, "clips/photos must be jpg, png, webp, mp4, mov, mkv or webm")
    try:
        fx, fy = (min(max(float(v), 0), 1) for v in focus.split(",")) if focus else (0.5, 0.5)
    except ValueError:
        raise HTTPException(422, "focus must be 'x,y' between 0 and 1")

    DATA.mkdir(parents=True, exist_ok=True)
    if sweep() >= MAX_ACTIVE:
        raise HTTPException(429, f"{MAX_ACTIVE} Shorts are already rendering, wait for one to finish")

    job_id = uuid.uuid4().hex
    d = DATA / job_id
    (d / "media").mkdir(parents=True)
    state(d, id=job_id, name=name, status="uploading", created=time.time())  # so sweep() keeps it
    try:
        for i, (m, e) in enumerate(zip(media, exts)):
            save(m, d / "media" / f"{i}{e}")
        photo_credits = []
        for j, (src, pid) in enumerate(picks):  # searched photos: the server fetches them from the source itself
            try:
                photo_credits.append(photos.download(src, pid, d / "media" / f"p{j}.jpg")["credit"])
            except (OSError, ValueError, KeyError) as e:
                raise HTTPException(502, f"couldn't get a {photos.LABELS[src]} photo: {e}")
        if track:
            ncs.download(track, d / "song.mp3", 50 << 20)
            credit = credit.strip() or ncs.credit(track["id"])
        else:
            save(song, d / f"song{song_ext}", 50 << 20)
    except (OSError, ValueError) as e:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(502, f"couldn't get the NCS song: {e}")
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    if photo_credits:  # photo credits go under the music credit in the description
        credit = "\n".join([credit.strip(), *dict.fromkeys(photo_credits)]).strip()
    (d / "meta.json").write_text(json.dumps(
        {"name": name, "kind": kind, "length": length, "focus": [fx, fy],
         "song": f"{track['artist']} - {track['title']}" if track else pathlib.Path(song.filename).stem,
         "credit": credit.strip(), "style": style_pick}, ensure_ascii=False), encoding="utf-8")
    state(d, status="queued")
    try:
        dispatch(job_id)
    except Exception as e:  # surfaced to the page instead of a job stuck on "queued"
        state(d, status="error", error=f"could not start GitHub render: {e}")
    return state(d)


@app.get("/music")
def music(genre: str = "phonk", q: str = Query("", max_length=60), page: int = Query(0, ge=0, le=200)):
    """NCS tracks for the song picker (free to use with the credit in the description): a genre or a search,
    10 per page as {items, more}; the web app asks for the next page when the list is scrolled to the end."""
    if not q.strip() and genre not in ncs.GENRES:
        raise HTTPException(422, f"genre must be one of {', '.join(ncs.GENRES)}")
    try:
        return ncs.search(q, page) if q.strip() else ncs.tracks(genre, page)
    except OSError as e:
        raise HTTPException(502, f"couldn't reach ncs.io: {e}")


@app.get("/music/genres")
def music_genres():
    return [{"id": k, "label": label} for k, (_, label) in ncs.GENRES.items()]


@app.get("/music/{slug}/credit")
def music_credit(slug: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", slug):
        raise HTTPException(422, "bad track id")
    try:
        if not ncs.find(slug):  # only catalogue tracks, so this can't be used to hit arbitrary ncs.io pages
            raise HTTPException(404, "unknown NCS track")
        return {"credit": ncs.credit(slug)}
    except OSError as e:
        raise HTTPException(502, f"couldn't reach ncs.io: {e}")


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    return state(job_dir(job_id))


@app.get("/jobs/{job_id}/video.mp4")
def video(job_id: str):
    f = job_dir(job_id) / "out.mp4"
    if not f.exists():
        raise HTTPException(404, "not rendered yet")
    return FileResponse(f, media_type="video/mp4", filename=f"{state(f.parent).get('name', 'short')}.mp4")


# ---- worker (GitHub Actions) endpoints ----

@app.get("/jobs/{job_id}/input.zip")
def job_input(job_id: str, x_worker_token: str = Header(None)):
    worker(x_worker_token)
    d = job_dir(job_id)
    z = d / "input.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_STORED) as zf:
        for f in [d / "meta.json", *d.glob("song.*"), *(d / "media").iterdir()]:
            zf.write(f, f.relative_to(d))
    return FileResponse(z)


@app.post("/jobs/{job_id}/status")
def job_status(job_id: str, status: str = Form(...), error: str = Form(""), log: str = Form(""),
               x_worker_token: str = Header(None)):
    worker(x_worker_token)
    if status not in ("rendering", "error"):
        raise HTTPException(422, "status must be rendering or error")
    return state(job_dir(job_id), status=status, error=error, log=log)


@app.post("/jobs/{job_id}/result")
def job_result(job_id: str, video: UploadFile = File(...), meta: str = Form(...),
               x_worker_token: str = Header(None)):
    worker(x_worker_token)
    d = job_dir(job_id)
    try:
        upload = json.loads(meta)
    except ValueError:
        raise HTTPException(422, "meta must be JSON")
    save(video, d / "out.mp4", 500 << 20)
    shutil.rmtree(d / "media", ignore_errors=True)  # free the small Render disk
    (d / "input.zip").unlink(missing_ok=True)
    return state(d, status="done", upload=upload)
