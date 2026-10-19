"""Batch 'Guess the model' Shorts: beat-synced Remotion edit, answer revealed on the song's drop.

Folders (next to this script):
  input/car/BMW M4/          <- one folder per car: 1-5 clips or photos (more = more cuts). FOLDER NAME = answer
  input/car/Porsche 911.mp4  <- a single file also works; FILE NAME = answer
  input/plane/Boeing 747/
  music/*.mp3                <- royalty-free songs; best part (drop) picked automatically
  output/                    <- finished Shorts + .txt with title/description/tags

Run:  python make_short.py            (every item in input/ not yet in output/)
      python make_short.py --len 15
      python make_short.py --job DIR  (one web-app job; see backend/ and .github/workflows/render.yml)

Optional zoom focus in the name:  "BMW M4@0.25,0.5"  (x,y of the detail to start on, 0-1).
"""
import argparse, json, os, pathlib, random, shutil, subprocess

from analyze import analyze

ROOT = pathlib.Path(__file__).parent
EDITOR = ROOT / "editor"
JOB = EDITOR / "public" / "job"
IMG = {".jpg", ".jpeg", ".png", ".webp"}
VID = {".mp4", ".mov", ".mkv", ".webm"}
SONGS = {".mp3", ".wav", ".m4a"}

HOOKS = {
    "car": [("GUESS THE", "CAR", "👀"), ("NAME THIS", "CAR", "🤔"), ("ONLY CAR FANS", "GET THIS", "😳"), ("WHICH CAR", "IS THIS?", "🔍")],
    "plane": [("GUESS THE", "PLANE", "✈️"), ("NAME THIS", "PLANE", "🤔"), ("ONLY PILOTS", "GET THIS", "😳"), ("WHICH PLANE", "IS THIS?", "🔍")],
}
TITLES = {
    "car": ["Guess this car before the drop 👀", "Only real car fans get this one 😳", "Name this car in 5 seconds 🔍"],
    "plane": ["Guess this plane before the drop ✈️", "Only aviation fans get this one 😳", "Name this plane in 5 seconds 🔍"],
}
TAGS = {"car": "#cars #guessthecar #carquiz", "plane": "#aviation #planes #guessthemodel"}


def probe(path):
    out = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", str(path)]))
    v = next(s for s in out["streams"] if s["codec_type"] == "video")
    return int(v["width"]), int(v["height"]), float(out["format"].get("duration", 0))


GRADE = "eq=contrast=1.12:saturation=1.25"


def prep(src, fg, bg):
    """Do the expensive per-frame work once with ffmpeg instead of in the browser on every frame:
    colour grade baked in, foreground capped at 2160px wide, background pre-blurred at 1/4 size."""
    still = ["-frames:v", "1", "-q:v", "2"] if fg.suffix == ".jpg" else ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                                                                   "-bf", "0", "-g", "30"]  # no B-frames: Remotion seeks reliably
    for out, vf in ((fg, f"scale='min(iw,2160)':-2,{GRADE}"),
                    (bg, f"scale=270:480:force_original_aspect_ratio=increase,crop=270:480,{GRADE},"
                         "colorchannelmixer=rr=.8:gg=.8:bb=.8,gblur=sigma=10")):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", vf, *still, str(out)], check=True)


def build_for(length):
    """Seconds before the answer. Analytics: viewers leave after ~5s, so reveal early (10s Short -> ~4s)."""
    return round(min(9.0, max(3.5, length * 0.42)), 1)


def song_plan(song, length):
    build = build_for(length)
    cache = song.with_suffix(f".plan{length:g}-{build:g}.json")
    if cache.exists():
        return json.loads(cache.read_text())
    plan = analyze(song, length, build)
    cache.write_text(json.dumps(plan))
    return plan


def upload_text(name, kind, song_title, credit=""):
    """Title/description/tags for YouTube. The answer stays out of title+description (they'd spoil the quiz);
    it goes only in the hidden tags."""
    brand = name.split()[0].lower()
    tags = [f"guess the {kind}", f"{kind} quiz", f"guess the {kind} challenge", f"{kind} trivia", f"name the {kind}",
            brand, name.lower(), f"{kind} edit", f"phonk {kind} edit", f"{kind} shorts", f"{kind} lovers", f"{kind} game"]
    return {
        "title": f"{random.choice(TITLES[kind])} #shorts",
        "description": f"Can you name this {kind} before the drop? 👀\nComment your guess BEFORE watching the reveal 👇\n"
                       f"No spoilers in the comments!\n\nWhat {kind} should I do next? Tell me below\n\n"
                       f"{credit or f'🎵 Music: {song_title}'}\n\n{TAGS[kind]}",
        "tags": ", ".join(dict.fromkeys(tags)),
        "pin": "Drop your guess 👇 1 try only!",
    }


def make(files, name, focus, kind, length, song, out, song_title=None, credit=""):
    """Render one Short to `out` (.mp4) and write its upload text next to it (.txt + .json)."""
    files = sorted(f for f in files if f.suffix.lower() in IMG | VID)
    if not files:
        return print("  skip (no clips/photos):", name)

    shutil.rmtree(JOB, ignore_errors=True)
    JOB.mkdir(parents=True, exist_ok=True)  # Windows: folder may survive rmtree if something has it open
    clips = []
    for i, f in enumerate(files):
        w, h, d = probe(f)
        ext = ".jpg" if f.suffix.lower() in IMG else ".mp4"
        prep(f, JOB / f"clip{i}{ext}", JOB / f"clip{i}.bg{ext}")
        clips.append({"src": f"job/clip{i}{ext}", "bg": f"job/clip{i}.bg{ext}", "graded": True,
                      "kind": "image" if ext == ".jpg" else "video", "width": w, "height": h, "duration": d, "focus": focus})

    plan = song_plan(song, length)
    if plan["drop"] is None:  # no clear drop: reveal where the build-up would end
        plan["drop"] = build_for(length)
    shutil.copy(song, JOB / f"song{song.suffix.lower()}")
    l1, l2, emoji = random.choice(HOOKS[kind])
    props = {"answer": name, "hook": [l1, l2], "emoji": emoji, "clips": clips,
             "plan": {k: plan[k] for k in ("length", "drop", "beats", "downbeats", "strong", "energy")},
             "music": {"src": f"job/song{song.suffix.lower()}", "start": plan["start"]}}
    (JOB / "props.json").write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")

    r = subprocess.run(f'npx remotion render src/index.ts Quiz "{out}" --props=public/job/props.json --log=error '
                       + os.environ.get("RENDER_FLAGS", ""),  # worker: --concurrency=$(nproc)
                       cwd=EDITOR, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise SystemExit(f"render failed for {name}:\n{(r.stderr or r.stdout)[-2000:]}")

    meta = upload_text(name, kind, song_title or song.stem, credit)
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    out.with_suffix(".txt").write_text(
        f"TITLE:\n{meta['title']}\n\nDESCRIPTION:\n{meta['description']}\n\nTAGS:\n{meta['tags']}\n\n"
        f"PIN COMMENT:\n{meta['pin']}\n", encoding="utf-8")


def parse_name(stem):
    name, _, focus = stem.partition("@")
    return name, [float(v) for v in focus.split(",")] if focus else [0.5, 0.5]


def run_job(job):
    """Cloud worker mode: job/meta.json {name, kind, length, focus}, job/media/*, job/song.* -> job/out.mp4 + out.json"""
    job = job.resolve()  # remotion renders with cwd=editor/, so a relative out path lands in the wrong place
    m = json.loads((job / "meta.json").read_text(encoding="utf-8"))
    song = next(f for f in job.glob("song.*") if f.suffix.lower() in SONGS)
    make(list((job / "media").iterdir()), m["name"], m.get("focus") or [0.5, 0.5], m["kind"],
         float(m.get("length", 10)), song, job / "out.mp4", m.get("song"), m.get("credit", ""))
    if not (job / "out.mp4").exists():
        raise SystemExit(f"no video at {job / 'out.mp4'} (no usable clip/photo, or render wrote elsewhere)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--len", type=float, default=10, help="Short length in seconds (9-12 works best)")
    p.add_argument("--job", type=pathlib.Path, help="render one uploaded job folder (used by the GitHub Actions worker)")
    a = p.parse_args()
    if a.job:
        return run_job(a.job)

    songs = [f for f in (ROOT / "music").glob("*") if f.suffix.lower() in SONGS and ".preview" not in f.name]
    if not songs:
        raise SystemExit("put at least one royalty-free song in music/")
    (ROOT / "output").mkdir(exist_ok=True)
    for kind in HOOKS:
        for item in sorted((ROOT / "input" / kind).glob("*")):
            out = ROOT / "output" / ((item.stem if item.is_file() else item.name).partition("@")[0] + ".mp4")
            if out.exists() or (item.is_file() and item.suffix.lower() not in IMG | VID):
                continue
            song = random.choice(songs)
            print(f"making {out.name}  (song: {song.name})", flush=True)
            name, focus = parse_name(item.stem if item.is_file() else item.name)
            make(list(item.iterdir()) if item.is_dir() else [item], name, focus, kind, a.len, song, out)
    print("done ->", ROOT / "output")


if __name__ == "__main__":
    for d in ("input/car", "input/plane", "music"):
        (ROOT / d).mkdir(parents=True, exist_ok=True)
    main()
