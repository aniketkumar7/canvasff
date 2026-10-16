# CanvasFF Studio

"Guess the car" YouTube Shorts: drop clips + a song, get a beat-synced 1080×1920 Short with the answer revealed on the drop.

```
web/ (Vercel)  ──upload──▶  backend/ (Render free)  ──workflow_dispatch──▶  GitHub Actions (renders)
     ▲  polls GET /jobs/{id}        ▲  stores files, job status        │  make_short.py --job + Remotion
     └──────── plays video.mp4 ─────┴──────── POST /jobs/{id}/result ◀─┘
```

Render's free plan (0.1 CPU, 512 MB) can't render video, so it only stores files and the GitHub runner does the rendering (~5–8 min, free 2,000 min/month on a private repo).

## Local (no cloud)
```
python make_short.py              # batch: every input/car/<Name>/ or input/car/<Name>.mp4 -> output/
```
Optional zoom start in the name: `BMW M4@0.25,0.5`. Songs in `music/` (YouTube Audio Library or NCS; Pixabay gets claimed).

## Deploy

**1. GitHub** (private repo, this folder)
- Settings → Secrets and variables → Actions → add secrets:
  - `API_URL` = your Render URL, e.g. `https://canvasff-api.onrender.com` (no trailing slash)
  - `WORKER_TOKEN` = any long random string (same value as on Render)
- Create a fine-grained token: github.com/settings/personal-access-tokens → only this repo → permission **Actions: Read and write**. Used by Render as `GH_TOKEN`.

**2. Render** (backend)
- New → Blueprint → pick the repo (uses `render.yaml`), or New → Web Service with root dir `backend`, build `pip install -r requirements.txt`, start `uvicorn app:app --host 0.0.0.0 --port $PORT`.
- Env vars: `GH_REPO` = `owner/repo`, `GH_TOKEN`, `WORKER_TOKEN`, `FRONTEND_ORIGIN` = your Vercel URL.
- Uptime Robot: monitor `https://<render-url>/health` every 5 min.

**3. Vercel** (frontend)
- Import the repo, **Root Directory = `web`**, framework "Other", no build command.
- Edit `web/config.js` → `window.CANVASFF_API = "https://<render-url>"`, commit.

## Limits
- Download each video when it's done: Render's free disk is wiped on restart/deploy, and jobs are deleted after 6 h.
- Max 3 renders at once, 200 MB per clip, 50 MB per song.
- No login. Anyone with the Render URL can start renders (uses your Actions minutes), so keep the URL private.
