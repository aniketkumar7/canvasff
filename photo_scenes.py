"""Vertical (1080x1920) shots from one car photo, so photos fill the Short instead of sitting in a letterbox.

  python photo_scenes.py photo.jpg OUTDIR   -> pan, detail1, detail2, hero, drive, sil (.mp4)

Uses photo_prep's car mask + depth map. All CPU, a few seconds per shot.
  pan      9:16 window glides across the car with 3D depth (near moves more than far)
  detail   close-ups found from the cut-out: brightest lights, wheel area; slow push-in
  hero     the cut-out car on a generated background + floor reflection + a light sweep over the body
  drive    the cut-out car with road bounce over a streaking background
  sil      the hero shot with the car as a black shape with a glowing rim (silhouette quiz mode)
"""
import pathlib, sys

import cv2
import numpy as np

from photo_prep import prep
from photo_shots import writer

OW, OH, FPS = 1080, 1920, 30


def load_full(photo: pathlib.Path, max_side: int = 3200):
    """Photo, mask and depth at (up to) full resolution, floats 0-1 for mask/depth."""
    m, d = prep(photo)
    rgb = cv2.cvtColor(cv2.imread(str(photo)), cv2.COLOR_BGR2RGB)
    s = min(1.0, max_side / max(rgb.shape[:2]))
    if s < 1:
        rgb = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    h, w = rgb.shape[:2]
    m = cv2.resize(m, (w, h)).astype(np.float32) / 255
    d = cv2.GaussianBlur(cv2.resize(d, (w, h)), (0, 0), 3).astype(np.float32) / 255
    return rgb, m, d


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask > 0.5)
    if not xs.size:
        h, w = mask.shape
        return 0, 0, w, h
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def ease(k: float) -> float:
    return 0.5 - 0.5 * np.cos(np.pi * min(max(k, 0.0), 1.0))


def crop_frame(rgb, cx, cy, ch, depth=None, dx=0.0):
    """9:16 crop of height ch centred at (cx, cy), resized to 1080x1920. dx>0 adds depth parallax."""
    h, w = rgb.shape[:2]
    ch = min(ch, h, w * 16 / 9)
    cw = ch * 9 / 16
    cx = min(max(cx, cw / 2), w - cw / 2)
    cy = min(max(cy, ch / 2), h - ch / 2)
    u, v = np.meshgrid(np.arange(OW, dtype=np.float32), np.arange(OH, dtype=np.float32))
    mx = (cx - cw / 2 + u * (cw / OW)).astype(np.float32)  # numpy float64 scalars would upcast the maps
    my = (cy - ch / 2 + v * (ch / OH)).astype(np.float32)
    if depth is not None and dx:
        rel = cv2.remap(depth, mx, my, cv2.INTER_LINEAR) - float(np.median(depth))
        mx = mx - float(dx) * rel
    return cv2.remap(rgb, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def run(out, n, make_frame):
    p = writer(out, OW, OH)
    for i in range(n):
        p.stdin.write(np.clip(make_frame(i, i / max(n - 1, 1)), 0, 255).astype(np.uint8).tobytes())
    p.stdin.close()
    p.wait()
    return out


# ---------- shots straight from the photo ----------

def pan(rgb, mask, depth, out, seconds=3.0):
    x0, y0, x1, y1 = bbox(mask)
    ch = min(rgb.shape[0], (y1 - y0) * 1.7)
    cw = ch * 9 / 16
    cy = (y0 + y1) / 2
    a, b = x0 + cw * 0.45, x1 - cw * 0.45  # sweep from one end of the car to the other
    if b < a:
        a = b = (x0 + x1) / 2
    swing = 0.04 * cw
    return run(out, int(seconds * FPS), lambda i, k: crop_frame(rgb, a + (b - a) * ease(k), cy, ch * (1 - 0.06 * k), depth, swing * (ease(k) - 0.5) * 2))


def detail_points(rgb, mask):
    """Close-up targets: the brightest light cluster on the car, then the lower wheel area on the other side."""
    x0, y0, x1, y1 = bbox(mask)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    bright = ((hsv[..., 2] > 215) & (mask > 0.5)).astype(np.uint8)
    pts = []
    n, _, stats, cents = cv2.connectedComponentsWithStats(bright)
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        if stats[big, cv2.CC_STAT_AREA] > 40:
            pts.append(tuple(cents[big]))
    if not pts:
        pts.append((x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.45))
    lx = pts[0][0]
    wheel_x = x1 - (x1 - x0) * 0.2 if lx < (x0 + x1) / 2 else x0 + (x1 - x0) * 0.2
    pts.append((wheel_x, y1 - (y1 - y0) * 0.22))
    return pts


def detail(rgb, mask, out, point, seconds=1.6):
    x0, y0, x1, y1 = bbox(mask)
    ch = max((y1 - y0) * 0.75, 200)
    cx, cy = point
    return run(out, int(seconds * FPS), lambda i, k: crop_frame(rgb, cx + (k - 0.5) * ch * 0.05, cy, ch * (1 - 0.14 * ease(k))))


# ---------- generated backgrounds ----------

BACKGROUNDS = ("bokeh", "tunnel", "studio")


def background(kind: str, seed: int):
    """Returns f(k) -> 1920x1080x3 float32 frame for progress k in 0..1 (animated)."""
    rng = np.random.default_rng(seed)
    yy = np.linspace(0, 1, OH, dtype=np.float32)[:, None, None]
    if kind == "studio":
        xx = np.linspace(-1, 1, OW, dtype=np.float32)[None, :, None]
        spot = np.exp(-(xx**2 * 1.6 + (yy - 0.45) ** 2 * 6))
        floor = np.clip((yy - 0.62) * 3, 0, 1)
        base = 12 + 70 * spot * (1 - floor) + 28 * floor * np.exp(-xx**2 * 2)
        img = np.broadcast_to(base, (OH, OW, 1)) * np.float32([1.0, 1.02, 1.08])
        return lambda k: img
    if kind == "tunnel":
        base = (np.float32([4, 4, 10]) + np.float32([10, 0, 30]) * (1 - yy)).astype(np.float32) * np.ones((1, OW, 1), np.float32)
        rays = [(rng.uniform(0, 2 * np.pi), (255, 40, 200) if rng.random() < 0.5 else (0, 220, 255)) for _ in range(46)]

        def f(k):
            glow = np.zeros((OH, OW, 3), np.float32)
            for j, (ang, col) in enumerate(rays):
                r = ((k * 2.2 + j * 0.137) % 1.0) ** 2 * 1400  # streaks rush outward, faster near the edge
                p0 = (int(540 + np.cos(ang) * r), int(820 + np.sin(ang) * r))
                p1 = (int(540 + np.cos(ang) * (r + 60 + r * 0.25)), int(820 + np.sin(ang) * (r + 60 + r * 0.25)))
                cv2.line(glow, p0, p1, col, 3 + int(r / 300))
            return base + cv2.GaussianBlur(glow, (0, 0), 4) * 0.9 + glow * 0.5
        return f
    # bokeh: dark city-night gradient with soft out-of-focus lights drifting up
    base = (np.float32([5, 7, 14]) + np.float32([16, 22, 48]) * yy).astype(np.float32) * np.ones((1, OW, 1), np.float32)
    dots = [(rng.uniform(0, OW), rng.uniform(0, OH * 0.75), rng.uniform(18, 70),
             (255, 170, 70) if rng.random() < 0.55 else (90, 160, 255), rng.uniform(0.25, 0.7)) for _ in range(38)]

    def f(k):
        layer = np.zeros((OH, OW, 3), np.float32)
        for x, y, r, col, a in dots:
            cv2.circle(layer, (int(x), int(y - k * r * 1.5)), int(r), [c * a for c in col], -1)
        return base + cv2.GaussianBlur(layer, (0, 0), 9)
    return f


# ---------- the cut-out car on its own ----------

def car_layer(rgb, mask, width_frac=0.96, max_h_frac=0.42):
    """Car pixels + alpha cropped to its box and scaled for a vertical frame."""
    x0, y0, x1, y1 = bbox(mask)
    car, a = rgb[y0:y1 + 1, x0:x1 + 1].astype(np.float32), mask[y0:y1 + 1, x0:x1 + 1]
    s = min(OW * width_frac / car.shape[1], OH * max_h_frac / car.shape[0])
    size = (max(1, int(car.shape[1] * s)), max(1, int(car.shape[0] * s)))
    return cv2.resize(car, size, interpolation=cv2.INTER_AREA), cv2.resize(a, size, interpolation=cv2.INTER_AREA)


def paste(frame, car, a, cx, bottom, reflect=True):
    """Alpha-composite the car centred at cx with its wheels on `bottom`; optional floor reflection + shadow."""
    h, w = a.shape
    x, y = int(cx - w / 2), int(bottom - h)
    shadow = np.zeros(frame.shape[:2], np.float32)
    cv2.ellipse(shadow, (int(cx), int(bottom)), (int(w * 0.48), max(10, h // 12)), 0, 0, 360, 0.6, -1)
    frame *= 1 - cv2.GaussianBlur(shadow, (0, 0), 18)[..., None]

    def blit(img, al, top):
        fy0, fy1 = max(top, 0), min(top + img.shape[0], OH)
        fx0, fx1 = max(x, 0), min(x + w, OW)
        if fy1 <= fy0 or fx1 <= fx0:
            return
        sl = (slice(fy0 - top, fy1 - top), slice(fx0 - x, fx1 - x))
        al3 = al[sl][..., None]
        frame[fy0:fy1, fx0:fx1] = frame[fy0:fy1, fx0:fx1] * (1 - al3) + img[sl] * al3

    if reflect:
        fade = np.linspace(0.32, 0, h, dtype=np.float32)[:, None]
        blit(car[::-1], a[::-1] * fade, y + h)
    blit(car, a, y)
    return frame


def zoom(frame, z, cx, cy):
    m = np.float32([[z, 0, cx * (1 - z)], [0, z, cy * (1 - z)]])
    return cv2.warpAffine(frame, m, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def sweep(car, a, k):
    """A diagonal band of light crossing the body once (only where the car is)."""
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    c = (-0.3 + 1.6 * min(max((k - 0.2) / 0.55, 0), 1)) * (w + h)
    band = np.exp(-(((xx + yy * 0.6) - c) / (w * 0.07)) ** 2) * a
    return np.clip(car + band[..., None] * 140, 0, 255)


def hero(rgb, mask, out, bg_kind, seed, seconds=3.0, silhouette=False):
    car, a = car_layer(rgb, mask, width_frac=0.94)  # whole car visible: the silhouette needs its full outline
    bg = background(bg_kind, seed)
    bottom = OH * 0.64
    cy = bottom - a.shape[0] / 2
    if silhouette:  # black shape + bright glowing rim, same framing as the hero shot
        edge = np.clip(cv2.dilate(a, np.ones((15, 15), np.uint8)) - cv2.erode(a, np.ones((5, 5), np.uint8)), 0, 1)
        rim = np.clip(cv2.GaussianBlur(edge, (0, 0), 5) * 2.2, 0, 1)
        car = np.full_like(car, 8) * (1 - rim[..., None]) + rim[..., None] * np.float32([170, 240, 255])
        a = np.clip(a + rim, 0, 1)

    def frame(i, k):
        f = bg(k).copy()
        c = car if silhouette else sweep(car, a, k)
        f = paste(f, c, a, OW / 2, bottom, reflect=not silhouette)
        return zoom(f, 1 + 0.08 * ease(k), OW / 2, cy)
    return run(out, int(seconds * FPS), frame)


def drive(rgb, mask, out, seconds=3.0, direction=1):
    """Vertical driving shot: streaked background from the photo itself, car bouncing on the road."""
    h, w = mask.shape
    hole = cv2.dilate((mask > 0.1).astype(np.uint8), np.ones((31, 31), np.uint8))
    small = cv2.inpaint(cv2.resize(rgb, (w // 4, h // 4)), cv2.resize(hole, (w // 4, h // 4)), 9, cv2.INPAINT_TELEA)
    bg = np.where(hole[..., None] > 0, cv2.resize(small, (w, h)), rgb)
    x0, _, x1, _ = bbox(mask)
    bgv = crop_frame(bg, (x0 + x1) / 2, h / 2, h).astype(np.float32)
    bgv = cv2.filter2D(bgv, -1, np.full((1, 161), 1 / 161, np.float32))
    strip = np.concatenate([bgv, bgv[:, ::-1]], axis=1)
    car, a = car_layer(rgb, mask, width_frac=1.12, max_h_frac=0.5)
    speed = int(OW * 0.06) * direction

    def frame(i, k):
        f = np.roll(strip, -(i * speed) % (2 * OW), axis=1)[:, :OW].copy()
        dy = 3 * np.sin(i * 2 * np.pi / 7) + 1.5 * np.sin(i * 2 * np.pi / 3.1)
        return paste(f, car, a, OW / 2, OH * 0.74 + dy, reflect=False)
    return run(out, int(seconds * FPS), frame)


def photo_video(photo: pathlib.Path, outdir: pathlib.Path, tag: str) -> list[tuple[pathlib.Path, dict]]:
    """All vertical shots for one photo, as (mp4, extra clip fields). The hero shot carries its silhouette twin."""
    rgb, mask, depth = load_full(photo)
    seed = sum(map(ord, tag + photo.name))
    bg_kind = BACKGROUNDS[seed % len(BACKGROUNDS)]
    p = lambda name: outdir / f"{tag}.{name}.mp4"
    shots = [(pan(rgb, mask, depth, p("pan")), {})]
    shots += [(detail(rgb, mask, p(f"detail{j}"), pt), {}) for j, pt in enumerate(detail_points(rgb, mask))]
    sil = hero(rgb, mask, p("sil"), bg_kind, seed, silhouette=True)
    shots.append((hero(rgb, mask, p("hero"), bg_kind, seed), {"sil": sil}))
    shots.append((drive(rgb, mask, p("drive"), direction=1 if seed % 2 else -1), {}))
    return shots


if __name__ == "__main__":
    photo, outdir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    for path, extra in photo_video(photo, outdir, "t"):
        print(path.name, extra)
