import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, Film } from "lucide-react";
import { useReducedMotionPreference } from "devignerui/hooks";
import { cn } from "cn";

// A 9:16 frame for a Short that is still being made. A still hex grid of tiny
// dots stands in for it, with one halftone lens that swells the dots and parts
// them around it. The pointer holds the lens and a press sends a ripple; on its
// own the lens drifts, faster while rendering, when the dots also take the
// colours of the uploaded clip. On done the dots grow into each other and fade
// as the video sharpens in. Every dot keeps one home on the grid; only the lens
// and ripples push it off.

export type FrameState = "idle" | "uploading" | "queued" | "rendering" | "done" | "error";

export interface GenerationFrameProps {
  state: FrameState;
  /** Object URL of the first uploaded clip/photo; its colours tint the dots. */
  tintSrc?: string;
  tintKind?: "image" | "video";
  /** Where the Short opens zoomed in (0-1); the tint is cropped around it. */
  focus?: [number, number];
  /** The finished video. */
  videoSrc?: string;
  /** File name offered by the download button. */
  downloadName?: string;
  className?: string;
  children?: React.ReactNode;
}

/** Grid spacing, CSS px. */
const S = 9;
const ROW = S * 0.866;
/** Dot radius at rest and the most a lens adds. */
const BASE_R = 0.75;
const GROW_R = 2.9;
/** Lens radius as a share of the frame's short side. */
const LENS = 0.36;
/** Auto drift: amplitude (share of frame) and speed (rad/s) per state. */
const DRIFT: Record<FrameState, [number, number]> = {
  idle: [0.18, 0.25],
  uploading: [0.24, 0.45],
  queued: [0.24, 0.45],
  rendering: [0.32, 0.8],
  done: [0, 0],
  error: [0.08, 0.15],
};
const ERROR_RGB = "rgb(255 99 99)";
const WHITE = "rgb(244 244 245)";
const ACCENT = "rgb(255 214 10)";

type Dot = { hx: number; hy: number; ox: number; oy: number; rgb: string; lum: number };
type Ripple = { x: number; y: number; t0: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const smooth = (f: number) => f * f * (3 - 2 * f);

/** Loads the tint source and returns a function that reads its colour at a
 *  point of the frame (0-1), cropped like object-fit: cover around `focus`. */
async function loadSampler(src: string, kind: "image" | "video", aspect: number, focus: [number, number]) {
  const el = await new Promise<HTMLImageElement | HTMLVideoElement>((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
      return;
    }
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) * 0.3);
    };
    v.onseeked = () => resolve(v);
    v.onerror = reject;
    v.src = src;
  });
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  // small offscreen copy in the frame's aspect, cropped around focus
  const cw = 54;
  const ch = Math.round(cw / aspect);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const s = Math.max(cw / w, ch / h);
  const dw = w * s;
  const dh = h * s;
  const dx = clamp(cw / 2 - focus[0] * dw, cw - dw, 0);
  const dy = clamp(ch / 2 - focus[1] * dh, ch - dh, 0);
  ctx.drawImage(el, dx, dy, dw, dh);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  return (u: number, v: number) => {
    const i = (Math.min(ch - 1, Math.floor(v * ch)) * cw + Math.min(cw - 1, Math.floor(u * cw))) * 4;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    // lift dark pixels a little so the swarm never goes black
    const lift = (x: number) => Math.min(255, Math.round(70 + x * 0.9));
    return { rgb: `rgb(${lift(r)} ${lift(g)} ${lift(b)})`, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
  };
}

export function GenerationFrame({
  state,
  tintSrc,
  tintKind = "image",
  focus = [0.5, 0.5],
  videoSrc,
  downloadName = "short.mp4",
  className,
  children,
}: GenerationFrameProps) {
  const reduced = useReducedMotionPreference();
  const box = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [videoReady, setVideoReady] = React.useState(false);
  // live values the animation loop reads without restarting
  const live = React.useRef({ state, pointer: null as null | { x: number; y: number }, doneAt: 0 });
  // set during render, so the loop never sees "done" with a stale start time
  if (state === "done" && live.current.state !== "done") live.current.doneAt = performance.now();
  live.current.state = state;
  const sampler = React.useRef<null | ((u: number, v: number) => { rgb: string; lum: number })>(null);
  const [tintVersion, setTintVersion] = React.useState(0);

  React.useEffect(() => {
    if (state !== "done") setVideoReady(false);
  }, [state]);

  // focus moves on every click in the picker; resample only once it settles
  const [fx, fy] = focus;
  const [settled, setSettled] = React.useState<[number, number]>([fx, fy]);
  React.useEffect(() => {
    const t = setTimeout(() => setSettled([fx, fy]), 350);
    return () => clearTimeout(t);
  }, [fx, fy]);

  React.useEffect(() => {
    if (!tintSrc) {
      sampler.current = null;
      setTintVersion((v) => v + 1);
      return;
    }
    // the old colours stay until the new ones are ready
    let alive = true;
    loadSampler(tintSrc, tintKind, 9 / 16, settled)
      .then((fn) => {
        if (!alive) return;
        sampler.current = fn;
        setTintVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tintSrc, tintKind, settled]);

  React.useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!el || !cv || !ctx) return;
    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let frame = 0;
    let visible = true;
    let last = 0;
    let t = 0;
    const lens = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    const ripples: Ripple[] = [];

    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = [];
      const rows = Math.ceil(h / ROW) + 1;
      const cols = Math.ceil(w / S) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // homes snapped to whole pixels so the still grid stays crisp
          const hx = Math.round(c * S + (r % 2 ? S / 2 : 0));
          const hy = Math.round(r * ROW);
          const tint = sampler.current?.(hx / w, hy / h);
          dots.push({ hx, hy, ox: 0, oy: 0, rgb: tint?.rgb ?? WHITE, lum: tint?.lum ?? 0.6 });
        }
      }
    };

    const draw = (dt: number, now: number) => {
      const { state: st, pointer, doneAt } = live.current;
      t += dt;
      const short = Math.min(w, h);
      // lens target: the pointer, else a slow Lissajous drift
      const [amp, spd] = reduced ? [0, 0] : DRIFT[st];
      const tx = pointer ? pointer.x / w : 0.5 + Math.sin(t * spd) * amp;
      const ty = pointer ? pointer.y / h : 0.5 + Math.sin(t * spd * 0.73 + 1.3) * amp * 0.9;
      // critically-damped-ish follow
      const k = pointer ? 14 : 3;
      lens.vx += ((tx - lens.x) * k * k - lens.vx * 2 * k) * dt;
      lens.vy += ((ty - lens.y) * k * k - lens.vy * 2 * k) * dt;
      lens.x += lens.vx * dt;
      lens.y += lens.vy * dt;
      const lx = lens.x * w;
      const ly = lens.y * h;
      const pulse = st === "rendering" && !reduced ? 1 + 0.06 * Math.sin(t * 3.2) : 1;
      const R = short * LENS * pulse * (st === "error" ? 0.7 : 1);
      const tinted = st === "rendering" || st === "uploading" || st === "queued" || (st === "idle" && !!sampler.current);
      const done = st === "done" ? clamp((now - doneAt) / 900, 0, 1) : 0;
      const fadeOut = smooth(done);

      for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 > 1300) ripples.splice(i, 1);

      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        const dx = d.hx - lx;
        const dy = d.hy - ly;
        const dist = Math.hypot(dx, dy) || 1;
        const f = clamp(1 - dist / R, 0, 1);
        const s = smooth(f);
        // part around the lens: strongest mid-ring, none at centre or edge
        let push = f * (1 - f) * S * 1.6;
        let extraA = 0;
        let extraR = 0;
        for (const rp of ripples) {
          const age = (now - rp.t0) / 1000;
          const rr = age * short * 1.4;
          const rd = Math.hypot(d.hx - rp.x, d.hy - rp.y);
          const g = Math.exp(-(((rd - rr) / 22) ** 2)) * (1 - age / 1.3);
          if (g > 0.01) {
            push += g * 7;
            extraA += g * 0.5;
            extraR += g * 1.4;
          }
        }
        const tx2 = (dx / dist) * push;
        const ty2 = (dy / dist) * push;
        d.ox += (tx2 - d.ox) * Math.min(1, dt * 12);
        d.oy += (ty2 - d.oy) * Math.min(1, dt * 12);

        const halftone = tinted ? 0.55 + 0.45 * d.lum : 1;
        let r = BASE_R + s * GROW_R * halftone + extraR;
        let a = (tinted ? 0.3 : 0.14) + s * 0.75 + extraA;
        if (done) {
          // grow into each other, then fade
          r += fadeOut * S * 0.75;
          a *= 1 - fadeOut;
        }
        if (a <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillStyle = st === "error" ? ERROR_RGB : tinted ? d.rgb : s > 0.55 ? ACCENT : WHITE;
        ctx.beginPath();
        ctx.arc(d.hx + d.ox, d.hy + d.oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      draw(dt, now);
      frame = visible ? requestAnimationFrame(tick) : 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // touch scrolls; only a tap ripples
      const b = el.getBoundingClientRect();
      live.current.pointer = { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const onLeave = () => {
      live.current.pointer = null;
    };
    const onDown = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      ripples.push({ x: e.clientX - b.left, y: e.clientY - b.top, t0: performance.now() });
      if (reduced || !frame) draw(0, performance.now());
    };

    seed();
    const ro = new ResizeObserver(() => {
      seed();
      if (reduced) draw(0, performance.now()); // no loop to repaint the cleared canvas
    });
    ro.observe(el);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);

    if (reduced) {
      draw(0, performance.now());
      return () => {
        ro.disconnect();
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerleave", onLeave);
        el.removeEventListener("pointerdown", onDown);
      };
    }
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    });
    io.observe(el);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
    };
    // tintVersion: reseed so dots pick up the new colours; under reduced motion
    // there is no loop, so a state change re-runs this for one fresh frame
  }, [reduced, tintVersion, reduced ? state : null]);

  const showVideo = state === "done" && !!videoSrc;

  return (
    <div
      ref={box}
      className={cn(
        "relative isolate aspect-[9/16] w-full overflow-hidden rounded-[28px] bg-[#0c0c0f]",
        "shadow-[0_0_0_1px_var(--border),0_30px_80px_-20px_rgb(0_0_0/0.8)]",
        className,
      )}
    >
      <canvas ref={canvas} aria-hidden className="absolute inset-0" />
      {/* soft vignette so the edge dots recede */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.55))" }}
      />

      <AnimatePresence>
        {showVideo && (
          <motion.video
            key={videoSrc}
            src={videoSrc}
            className="absolute inset-0 h-full w-full bg-black object-cover"
            controls
            playsInline
            loop
            onLoadedData={() => setVideoReady(true)}
            initial={{ opacity: 0, filter: "blur(14px) saturate(0.6)", scale: 1.04 }}
            animate={
              videoReady
                ? { opacity: 1, filter: "blur(0px) saturate(1)", scale: 1 }
                : { opacity: 0, filter: "blur(14px) saturate(0.6)", scale: 1.04 }
            }
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.9, ease: [0.22, 1, 0.36, 1], delay: reduced ? 0 : 0.25 }}
          />
        )}
      </AnimatePresence>

      {showVideo && (
        <a
          href={videoSrc}
          download={downloadName}
          aria-label="Download MP4"
          title="Download MP4"
          className="absolute top-3 right-3 z-10 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition hover:bg-black/75 active:scale-95"
        >
          <Download className="size-[18px]" />
        </a>
      )}

      {state === "idle" && !tintSrc && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2.5 rounded-full bg-black/70 py-2 pr-4 pl-2.5 ring-1 ring-white/10 backdrop-blur-md">
            <span className="grid size-7 place-items-center rounded-full bg-white/10">
              <Film className="size-3.5 text-foreground" />
            </span>
            <p className="text-[13px] font-bold whitespace-nowrap text-foreground/90">Your Short appears here</p>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
