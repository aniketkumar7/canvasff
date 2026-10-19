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


def probe(path):
    out = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", str(path)]))
    v = next(s for s in out["streams"] if s["codec_type"] == "video")
    return int(v["width"]), int(v["height"]), float(out["format"].get("duration", 0))


GRADES = {  # colour look baked in once by ffmpeg (cheaper than CSS filters on every frame)
    "clean": "eq=contrast=1.12:saturation=1.25",
    "neon": "eq=contrast=1.2:saturation=1.45,colorbalance=bs=.15:bm=.08:rh=.05",
    "tealOrange": "colorbalance=rs=-.1:bs=.12:rh=.12:bh=-.1,eq=contrast=1.15:saturation=1.2",
    "film": "eq=contrast=1.08:saturation=0.9,colorbalance=rh=.06:gh=.03:bs=-.04",
    "night": "eq=brightness=-0.06:contrast=1.22:saturation=0.85,colorbalance=bs=.12:bm=.06",
    "mono2color": "eq=contrast=1.15:saturation=1.3",
}
OPTIONS = {
    "mechanic": ["zoom", "glass", "pixel", "spotlight", "tiles"],
    "reveal": ["slam", "scramble", "stamp", "split"],
    "dropFx": ["flash", "zoomThrough", "glitch", "whip"],
    "cut": ["punch", "whip", "spin", "zoom", "flash"],
    "look": list(GRADES),
    "hook": ["pop", "words", "type", "glitch", "marker"],
    "font": ["montserrat", "anton", "bebas"],
    "accent": ["#FFD400", "#00E5FF", "#FF2D55", "#B6FF00", "#FF7A00"],
}
DECOYS = {
    "car": ["BMW M3", "BMW M5", "Audi RS6", "Audi R8", "Mercedes AMG GT", "Mercedes C63", "Porsche 911", "Porsche Taycan",
            "Nissan GT-R", "Toyota Supra", "Lamborghini Huracan", "Ferrari 488", "Ford Mustang", "Chevrolet Camaro",
            "Dodge Challenger", "McLaren 720S", "Honda NSX", "Lexus LFA", "Aston Martin Vantage", "Corvette C8"],
    "plane": ["Boeing 737", "Boeing 747", "Boeing 777", "Boeing 787", "Airbus A320", "Airbus A350", "Airbus A380",
              "F-16", "F-22 Raptor", "F-35", "Su-57", "Eurofighter Typhoon", "Rafale", "C-130 Hercules"],
}
HISTORY = ROOT / "output" / ".style-history.json"


def pick_style(override=None):
    """A fresh mix of effects per reel. Mechanic, reveal and look never repeat the last 3 reels."""
    hist = json.loads(HISTORY.read_text()) if HISTORY.exists() else []
    style = {}
    for key, opts in OPTIONS.items():
        recent = {h.get(key) for h in hist[-3:]} if key in ("mechanic", "reveal", "look") else set()
        style[key] = random.choice([o for o in opts if o not in recent] or opts)
    if style["mechanic"] == "glass" and random.random() < 0.7:
        style["dropFx"] = "shatter"
    style["ramp"] = random.random() < 0.5
    style["bars"] = random.random() < 0.3
    style["choices"] = random.random() < 0.4  # A/B/C on ~40% of reels
    style.update({k: v for k, v in (override or {}).items() if v not in (None, "", "random")})
    try:
        HISTORY.parent.mkdir(exist_ok=True)
        HISTORY.write_text(json.dumps((hist + [style])[-10:]))
    except OSError:
        pass  # history is a nicety, never block a render
    return style


def choices_for(name, kind):
    """A/B/C: the answer + 2 decoys (same brand first, so it isn't too easy), shuffled."""
    pool = [d for d in DECOYS[kind] if d.lower() != name.lower()]
    brand = name.split()[0].lower()
    same = [d for d in pool if d.lower().startswith(brand)]
    picks = random.sample(same, min(1, len(same))) + random.sample([d for d in pool if d not in same], 2)
    opts = [name, *picks[:2]]
    random.shuffle(opts)
    return opts


HIDDEN = {  # pre-made copies for the guess phase (Chrome won't blur/pixelate scaled images for us)
    "blur": "scale=iw/8:-2,gblur=sigma=4,scale=iw*8:-2",
    "pix1": "scale=iw/40:-2:flags=neighbor,scale=iw*40:-2:flags=neighbor",
    "pix2": "scale=iw/14:-2:flags=neighbor,scale=iw*14:-2:flags=neighbor",
}


def prep_hidden(fg, kinds):
    """blur / pix1 (coarse) / pix2 (medium) copies of an already-prepped clip -> {kind: path}."""
    still = ["-frames:v", "1", "-q:v", "2"] if fg.suffix == ".jpg" else ["-an", "-c:v", "libx264", "-preset", "veryfast",
                                                                   "-crf", "23", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "30"]
    out = {}
    for k in kinds:
        dst = fg.with_name(f"{fg.stem}.{k}{fg.suffix}")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(fg), "-vf", HIDDEN[k], *still, str(dst)], check=True)
        out[k] = dst
    return out


def prep(src, fg, bg, grade=GRADES["clean"]):
    """Do the expensive per-frame work once with ffmpeg instead of in the browser on every frame:
    colour grade baked in, foreground capped at 2160px wide, background pre-blurred at 1/4 size."""
    still = ["-frames:v", "1", "-q:v", "2"] if fg.suffix == ".jpg" else ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                                                                   "-bf", "0", "-g", "30"]  # no B-frames: Remotion seeks reliably
    for out, vf in ((fg, f"scale='min(iw,2160)':-2,{grade}"),
                    (bg, f"scale=270:480:force_original_aspect_ratio=increase,crop=270:480,{grade},"
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


TITLE_POOL = {  # {k} = car/plane. Never the answer: it would spoil the quiz.
    "any": ["Only real {k} fans get this one 😳", "Name this {k} in 5 seconds 🔍", "Guess this {k} before the drop 👀",
            "99% get this {k} wrong 😬", "Can you name this {k}? 🤔", "Be honest, did you get it? 👀",
            "This {k} fools almost everyone 😳", "{K} experts only 🧠", "Rate your {k} knowledge: guess this 👇",
            "Hardest {k} quiz yet? 😤", "Bet you can't name this {k} 😏", "Guess it before the reveal 🔥"],
    "zoom": ["Guess the {k} before it zooms out 🔍", "Name it from one detail 👀"],
    "glass": ["Name this {k} before the glass breaks 💥", "Guess before it shatters 🧊"],
    "pixel": ["Can you name this pixelated {k}? 👾", "Guess the {k} before it gets clear 👾"],
    "spotlight": ["Only a spotlight. Name the {k} 🔦", "Guess the {k} in the dark 🔦"],
    "tiles": ["Guess the {k} before all tiles flip 🧩", "Name it with half the picture 🧩"],
    "choices": ["A, B or C? Guess the {k} 🤔", "Pick one: which {k} is it? 👇", "3 options, 1 right answer. Which {k}? 🎯"],
}
DESC_OPEN = ["Can you name this {k} before the drop? 👀", "How fast can you name this {k}? ⏱️", "One look. One guess. What {k} is this? 🎯",
             "Real {k} fans get this in 3 seconds. Do you? 😏", "Pause, guess, then watch the reveal 👀"]
DESC_ASK = ["Comment your guess BEFORE the reveal 👇", "Drop your answer below, no editing it after 😤",
            "Got it right? Comment 'easy'. Wrong? Comment 'next' 👇", "Write your guess, then check the reveal 👇"]
DESC_NEXT = ["What {k} should I do next? Tell me below", "Suggest the next {k} in the comments, I read them all",
             "Want a harder one? Comment a {k} to stump everyone", "Follow for a new {k} quiz every day"]
PINS = ["Drop your guess 👇 1 try only!", "First guess counts, no editing 😤", "How many seconds did it take you? ⏱️",
        "Too easy or too hard? 🤔", "Next {k}? Best suggestion gets picked 👇"]
TAG_POOL = {
    "car": ["guess the car", "car quiz", "guess the car challenge", "car trivia", "name the car", "car shorts",
            "car lovers", "car game", "car edit", "phonk car edit", "car spotting", "car enthusiast",
            "car challenge", "cars daily", "dream car", "car guess"],  # generic only: no jdm/supercar etc. that may not fit
    "plane": ["guess the plane", "plane quiz", "aviation quiz", "aircraft quiz", "name the plane", "aviation shorts",
              "plane spotting", "avgeek", "aviation lovers", "aircraft", "pilot life", "aviation"],
}
HASHTAGS = {"car": ["#cars", "#guessthecar", "#carquiz", "#carshorts", "#carlovers", "#carspotting"],
            "plane": ["#aviation", "#planes", "#guessthemodel", "#avgeek", "#planespotting", "#aviationlovers"]}


def upload_text(name, kind, song_title, credit="", style=None):
    """Title/description/tags/pin for YouTube, different every Short and matched to its style.
    The answer stays out of title + description (it would spoil the quiz); it goes only in the hidden tags."""
    style = style or {}
    fill = lambda s: s.format(k=kind, K=kind.capitalize())
    titles = TITLE_POOL["any"] + TITLE_POOL.get(style.get("mechanic"), []) * 2  # style-matched titles twice as likely
    if style.get("choices"):
        titles = TITLE_POOL["choices"] * 3 + titles
    words = name.lower().split()
    tags = [name.lower(), words[0], *(" ".join(words[:2]),) * (len(words) > 2)] + random.sample(TAG_POOL[kind], 9)
    hashtags = random.sample(HASHTAGS[kind], 3)
    desc = "\n".join([fill(random.choice(DESC_OPEN)), fill(random.choice(DESC_ASK)), "No spoilers in the comments!", "",
                      fill(random.choice(DESC_NEXT)), "", credit or f"🎵 Music: {song_title}", "", " ".join(hashtags)])
    return {
        "title": f"{fill(random.choice(titles))} #shorts",
        "description": desc,
        "tags": ", ".join(dict.fromkeys(tags)),
        "pin": fill(random.choice(PINS)),
    }


def make(files, name, focus, kind, length, song, out, song_title=None, credit="", style=None):
    """Render one Short to `out` (.mp4) and write its upload text next to it (.txt + .json)."""
    files = sorted(f for f in files if f.suffix.lower() in IMG | VID)
    if not files:
        return print("  skip (no clips/photos):", name)
    style = pick_style(style)
    print("  style:", ", ".join(f"{k}={v}" for k, v in style.items()), flush=True)

    shutil.rmtree(JOB, ignore_errors=True)
    JOB.mkdir(parents=True, exist_ok=True)  # Windows: folder may survive rmtree if something has it open
    clips = []
    for i, f in enumerate(files):
        w, h, d = probe(f)
        ext = ".jpg" if f.suffix.lower() in IMG else ".mp4"
        prep(f, JOB / f"clip{i}{ext}", JOB / f"clip{i}.bg{ext}", GRADES[style["look"]])
        clip = {"src": f"job/clip{i}{ext}", "bg": f"job/clip{i}.bg{ext}", "graded": True,
                "kind": "image" if ext == ".jpg" else "video", "width": w, "height": h, "duration": d, "focus": focus}
        need = {"glass": ["blur"], "pixel": ["pix1", "pix2"]}.get(style["mechanic"], [])
        for k, p in prep_hidden(JOB / f"clip{i}{ext}", need).items():
            clip[k] = f"job/{p.name}"
        clips.append(clip)

    plan = song_plan(song, length)
    if plan["drop"] is None:  # no clear drop: reveal where the build-up would end
        plan["drop"] = build_for(length)
    shutil.copy(song, JOB / f"song{song.suffix.lower()}")
    l1, l2, emoji = random.choice(HOOKS[kind])
    props = {"answer": name, "hook": [l1, l2], "emoji": emoji, "clips": clips,
             "plan": {k: plan[k] for k in ("length", "drop", "beats", "downbeats", "strong", "energy")},
             "music": {"src": f"job/song{song.suffix.lower()}", "start": plan["start"]}, "style": style}
    if style["choices"]:
        props["choices"] = choices_for(name, kind)
    (JOB / "props.json").write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")

    r = subprocess.run(f'npx remotion render src/index.ts Quiz "{out}" --props=public/job/props.json --log=error '
                       + os.environ.get("RENDER_FLAGS", ""),  # worker: --concurrency=$(nproc)
                       cwd=EDITOR, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise SystemExit(f"render failed for {name}:\n{(r.stderr or r.stdout)[-2000:]}")

    meta = upload_text(name, kind, song_title or song.stem, credit, style)
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
         float(m.get("length", 10)), song, job / "out.mp4", m.get("song"), m.get("credit", ""), m.get("style"))
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
