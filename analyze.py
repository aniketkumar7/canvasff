"""Find the best part of a song for a Short + its beat grid.

  python analyze.py music/song.mp3 [--len 17] [--build 9]

Picks the strongest DROP (big energy jump on a downbeat) and starts the window `--build` seconds
before it, so the guess phase plays over the build-up and the answer lands on the drop.
Writes <song>.plan.json (times relative to the window) and <song>.preview.mp3 to listen to.
"""
import argparse, json, pathlib, subprocess

import librosa
import numpy as np


def smooth(x, n):
    return np.convolve(x, np.ones(n) / n, mode="same")


def analyze(path, length=17.0, build=9.0):
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 512
    fps = sr / hop
    dur = len(y) / sr

    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, units="frames")
    beat_t = librosa.frames_to_time(beats, sr=sr, hop_length=hop)

    # downbeats: assume 4/4, pick the phase whose beats hit hardest
    phase = max(range(4), key=lambda p: onset[beats[p::4]].sum())
    down_t = beat_t[phase::4]

    # energy = loudness + bass (808s / kicks), smoothed over ~0.5s, normalised 0-1
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=hop, n_mels=64, fmax=8000)
    bass = mel[:4].mean(axis=0)
    n = min(len(rms), len(bass))
    energy = smooth(rms[:n] / rms.max() + bass[:n] / bass.max(), int(fps / 2))
    energy /= energy.max()

    def mean_e(t0, t1):
        a, b = int(max(0, t0) * fps), int(min(dur, t1) * fps)
        return energy[a:b].mean() if b > a else 0.0

    # score each downbeat as a drop: jump in energy and loud afterwards
    best, best_score = None, -1.0
    for t in down_t:
        if t - build < 0 or t + (length - build) > dur:
            continue
        before, after = mean_e(t - 4, t), mean_e(t, t + 4)
        score = (after - before) * 2 + after
        if score > best_score:
            best, best_score = t, score

    if best is None:  # song too short for a build-up: just take the loudest window
        starts = np.arange(0, max(0.01, dur - length), 0.5)
        start = max(starts, key=lambda s: mean_e(s, s + length))
        drop = None
    else:
        start, drop = best - build, best

    end = start + length
    strength = onset[beats] / onset[beats].max()
    rel = lambda ts: [round(float(t - start), 3) for t in ts if start <= t < end]
    in_win = (beat_t >= start) & (beat_t < end)
    return {
        "song": str(path),
        "start": round(float(start), 3),
        "length": length,
        "tempo": round(float(np.atleast_1d(tempo)[0]), 1),
        "drop": round(float(drop - start), 3) if drop is not None else None,
        "beats": rel(beat_t),
        "downbeats": rel(down_t),
        "strong": [round(float(t - start), 3) for t, s in zip(beat_t[in_win], strength[in_win]) if s > 0.6],
        "energy": [round(float(mean_e(start + i * 0.25, start + i * 0.25 + 0.25)), 3)
                   for i in range(int(length * 4))],  # every 0.25s, for beat-reactive effects
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("song")
    p.add_argument("--len", type=float, default=17)
    p.add_argument("--build", type=float, default=9, help="seconds of build-up before the drop")
    a = p.parse_args()
    song = pathlib.Path(a.song)
    plan = analyze(song, a.len, a.build)
    out = song.with_suffix(".plan.json")
    out.write_text(json.dumps(plan, indent=1))
    preview = song.with_suffix(".preview.mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(plan["start"]), "-t", str(a.len), "-i", str(song),
                    "-af", f"afade=t=in:d=0.3,afade=t=out:st={a.len - 1}:d=1", str(preview)], check=True)
    m, s = divmod(plan["start"], 60)
    print(f"tempo {plan['tempo']} BPM | best part starts {int(m)}:{s:04.1f} | drop at +{plan['drop']}s "
          f"| {len(plan['beats'])} beats, {len(plan['strong'])} strong\n-> {out.name}, {preview.name}")


if __name__ == "__main__":
    main()
