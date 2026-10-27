"""Groundwork for photo shots: car mask + depth map, cached next to the photo.

  python photo_prep.py photo.jpg   -> photo.mask.png (white = car), photo.depth.png (white = near)
"""
import pathlib, sys

import cv2
import numpy as np

_seg = None
_depth = None


def car_mask(rgb: np.ndarray) -> np.ndarray:
    """0-255 mask of the main subject; only the biggest blob is kept so parked cars behind drop out."""
    global _seg
    from rembg import new_session, remove

    # BiRefNet keeps thin parts (wings, mirrors, spokes) that isnet dropped; lite = workable on CPU
    _seg = _seg or new_session("birefnet-general-lite")
    m = remove(rgb, session=_seg, only_mask=True)
    m = np.asarray(m, dtype=np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((m > 127).astype(np.uint8))
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        m = np.where(lab == big, m, 0).astype(np.uint8)
    return m


def depth_map(rgb: np.ndarray) -> np.ndarray:
    """0-255 relative depth (Depth Anything V2 Small, ONNX on CPU). 255 = nearest."""
    global _depth
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download

    if _depth is None:
        path = hf_hub_download("onnx-community/depth-anything-v2-small", "onnx/model.onnx")
        _depth = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    x = cv2.resize(rgb, (518, 518), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    d = _depth.run(None, {_depth.get_inputs()[0].name: x})[0].squeeze()
    d = cv2.resize(d, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC)
    d = (d - d.min()) / max(float(d.max() - d.min()), 1e-6)
    return (d * 255).astype(np.uint8)


def trim_by_depth(m: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Drop mask parts clearly further back than the car itself (e.g. a parked car touching it in the photo)."""
    inside = d[m > 127]
    if inside.size == 0:
        return m
    # only cut what is far behind the car's near side; the old cut (60th pct * 0.72) ate the far end of 3/4 views
    keep = (d >= np.percentile(inside, 90) * 0.4).astype(np.uint8)
    keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))  # cut thin bridges between blobs
    m = (m * keep).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((m > 127).astype(np.uint8))
    if n > 1:
        m = np.where(lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])), m, 0).astype(np.uint8)
    return cv2.GaussianBlur(m, (5, 5), 0)  # soft edge


def prep(photo: pathlib.Path) -> tuple[np.ndarray, np.ndarray]:
    """Mask + depth for a photo, computed once and cached as PNGs beside it."""
    mp, dp = photo.with_suffix(".mask.png"), photo.with_suffix(".depth.png")
    if mp.exists() and dp.exists():
        return cv2.imread(str(mp), 0), cv2.imread(str(dp), 0)
    rgb = cv2.cvtColor(cv2.imread(str(photo)), cv2.COLOR_BGR2RGB)
    m, d = car_mask(rgb), depth_map(rgb)
    m = trim_by_depth(m, d)
    cv2.imwrite(str(mp), m)
    cv2.imwrite(str(dp), d)
    return m, d


if __name__ == "__main__":
    for p in sys.argv[1:]:
        prep(pathlib.Path(p))
        print("ok", p)
