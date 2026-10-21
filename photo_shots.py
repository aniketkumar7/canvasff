"""Short video 'shots' from one photo, using photo_prep's mask + depth map.

  python photo_shots.py photo.jpg OUTDIR   -> OUTDIR/<stem>.orbit.mp4 ...
"""
import pathlib, subprocess, sys

import cv2
import numpy as np

from photo_prep import prep

FPS = 30
WIDTH = 1620  # editor shows landscape clips at 130% of 1080


def writer(path: pathlib.Path, w: int, h: int) -> subprocess.Popen:
    """ffmpeg reading raw RGB frames on stdin -> H.264 the editor can seek (no B-frames)."""
    return subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "30", str(path)],
        stdin=subprocess.PIPE,
    )


def load(photo: pathlib.Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Photo, mask and depth at the working width, as float32 (depth/mask 0-1)."""
    m, d = prep(photo)
    rgb = cv2.cvtColor(cv2.imread(str(photo)), cv2.COLOR_BGR2RGB)
    h = round(rgb.shape[0] * WIDTH / rgb.shape[1] / 2) * 2
    fit = lambda a: cv2.resize(a, (WIDTH, h), interpolation=cv2.INTER_AREA)
    return fit(rgb), fit(m).astype(np.float32) / 255, cv2.GaussianBlur(fit(d), (0, 0), 3).astype(np.float32) / 255


def orbit(photo: pathlib.Path, out: pathlib.Path, seconds: float = 3.0, swing: float = 0.035, push: float = 0.08) -> None:
    """2.5D camera glide: each pixel shifts by (depth - focus) so near and far move apart, plus a slow push-in."""
    rgb, _, depth = load(photo)
    h, w = depth.shape
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    rel = depth - np.median(depth)  # the car's plane stays roughly put, the rest slides around it
    p = writer(out, w, h)
    n = int(seconds * FPS)
    for i in range(n):
        k = i / max(n - 1, 1)
        ease = 0.5 - 0.5 * np.cos(np.pi * k)
        dx = (ease - 0.5) * 2 * swing * w  # left -> right
        dy = (ease - 0.5) * swing * 0.4 * h
        z = 1 + push * ease
        cx, cy = w / 2, h / 2
        mx = (xs - cx) / z + cx - dx * rel
        my = (ys - cy) / z + cy - dy * rel
        frame = cv2.remap(rgb, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        p.stdin.write(frame.tobytes())
    p.stdin.close()
    p.wait()


def drive(photo: pathlib.Path, out: pathlib.Path, seconds: float = 3.0, speed: float = 0.045, direction: int = -1) -> None:
    """Car stays put (small road bounce + shadow) while a filled-in, motion-blurred background scrolls past."""
    rgb, alpha, _ = load(photo)
    h, w = alpha.shape
    # background without the car: fill the hole at 1/4 size (it gets smeared anyway), then streak it sideways
    hole = cv2.dilate((alpha > 0.1).astype(np.uint8), np.ones((25, 25), np.uint8))
    small = cv2.inpaint(cv2.resize(rgb, (w // 4, h // 4)), cv2.resize(hole, (w // 4, h // 4)), 9, cv2.INPAINT_TELEA)
    bg = np.where(hole[..., None] > 0, cv2.resize(small, (w, h)), rgb)
    k = np.zeros((1, 181), np.float32)
    k[0, :] = 1 / 181
    bg = cv2.filter2D(bg, -1, k)
    strip = np.concatenate([bg, bg[:, ::-1]], axis=1)  # mirrored pair loops without a seam
    # soft shadow under the car
    ys, xs = np.nonzero(alpha > 0.5)
    shadow = np.zeros((h, w), np.float32)
    if ys.size:
        cv2.ellipse(shadow, (int(xs.mean()), int(ys.max())), (int((xs.max() - xs.min()) * 0.48), max(8, h // 40)), 0, 0, 360, 0.55, -1)
        shadow = cv2.GaussianBlur(shadow, (0, 0), 15)
    a3 = alpha[..., None]
    p = writer(out, w, h)
    n = int(seconds * FPS)
    for i in range(n):
        off = int(i * speed * w * direction) % (2 * w)
        back = np.roll(strip, -off, axis=1)[:, :w].astype(np.float32) * (1 - shadow[..., None])
        dy = 2.5 * np.sin(i * 2 * np.pi / 7) + 1.2 * np.sin(i * 2 * np.pi / 3.1)  # road bounce
        shift = np.float32([[1, 0, 0], [0, 1, dy]])
        car = cv2.warpAffine(rgb, shift, (w, h), borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
        a = cv2.warpAffine(a3[..., 0], shift, (w, h))[..., None]
        frame = back * (1 - a) + car * a
        p.stdin.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())
    p.stdin.close()
    p.wait()


def photo_video(photo: pathlib.Path, outdir: pathlib.Path, tag: str) -> list[pathlib.Path]:
    """All shots for one photo -> list of mp4s (used by make_short.py)."""
    out = [outdir / f"{tag}.orbit.mp4", outdir / f"{tag}.drive.mp4"]
    orbit(photo, out[0])
    drive(photo, out[1], direction=-1 if hash(tag) % 2 else 1)
    return out


if __name__ == "__main__":
    photo, outdir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    orbit(photo, outdir / f"{photo.stem}.orbit.mp4")
    drive(photo, outdir / f"{photo.stem}.drive.mp4")
    print("ok", outdir)
