import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { DEFAULT_STYLE, type Style } from "./style";
import { Hook, Letters, PopIn, Reveal, textBase } from "./text";
import { Choices, Glass, LookOverlays, Spotlight, Tiles } from "./mechanics";

const clampX = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const FG_W = 1.3; // landscape clips: 130% width (crop sides) so the subject fills more of the frame

export type Clip = {
  src: string;
  /** pre-blurred low-res background (make_short.py); without it the background is blurred live, which is slow */
  bg?: string;
  /** contrast/saturation already baked in by ffmpeg, so skip the per-frame CSS filter */
  graded?: boolean;
  /** pre-made hidden copies for the guess phase: blurred (glass), coarse / medium pixels (pixel) */
  blur?: string;
  pix1?: string;
  pix2?: string;
  kind: "video" | "image";
  width: number;
  height: number;
  duration?: number;
  focus?: [number, number];
};

export type Plan = {
  length: number;
  drop: number;
  beats: number[];
  downbeats: number[];
  strong: number[];
  energy: number[];
};

export type QuizProps = {
  answer: string;
  hook: [string, string];
  emoji: string;
  clips: Clip[];
  plan: Plan;
  music?: { src: string; start: number };
  /** Which effects this reel uses (make_short.py picks a fresh mix per reel). Missing keys = defaults. */
  style?: Partial<Style>;
  /** A/B/C options incl. the answer; shown when set. */
  choices?: string[];
};

type Segment = { from: number; to: number; clip: Clip; src: string; offset: number; rate: number; mirror: boolean; i: number };

// ---------- timing helpers ----------

/** Sum of exponential decays from each hit time before t. */
const decay = (t: number, hits: number[], amp: number, k: number) =>
  hits.reduce((s, b) => (b <= t && t - b < 0.8 ? s + amp * Math.exp(-(t - b) * k) : s), 0);

function buildSegments({ clips, plan }: QuizProps, style: Style): Segment[] {
  const { drop, length, downbeats, beats } = plan;
  const slowFrom = drop - Math.min(0.9, drop * 0.18); // short build-ups get a shorter slow-mo
  const guessCuts = downbeats.filter((t) => t > 0.8 && t < slowFrom - 0.6);
  const post = beats.filter((t) => t > drop + 0.2 && t < length - 0.3);
  const postCuts = post.filter((_, i) => i < 8 || i % 2 === 0); // every beat, then every 2nd
  const bounds = [0, ...guessCuts, slowFrom, drop, ...postCuts, length];
  return bounds.slice(0, -1).map((from, i) => {
    const to = bounds[i + 1];
    const clip = clips[i % clips.length];
    // speed ramp: after the drop alternate fast / slow-mo cuts
    const rate = from >= slowFrom && from < drop ? 0.35 : style.ramp && from >= drop ? (i % 2 ? 1.7 : 0.5) : 1;
    const room = Math.max(0, (clip.duration ?? 0) - (to - from) * rate - 0.05);
    // before the drop, glass shows the blurred copy and pixel the coarse then medium blocks
    const hidden =
      from >= drop ? undefined : style.mechanic === "glass" ? clip.blur : style.mechanic === "pixel" ? (from < drop / 2 ? clip.pix1 : clip.pix2) : undefined;
    return { from, to, clip, src: hidden ?? clip.src, rate, offset: random(`off${i}`) * room, mirror: from >= drop && i % 3 === 2, i };
  });
}

// ---------- footage ----------

const Media = ({ seg, fit, src = seg.src }:{ seg: Segment; fit: "cover" | "contain"; src?: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style: CSSProperties = { width: "100%", height: "100%", objectFit: fit };
  if (seg.clip.kind === "image") {
    // slow drift so stills never sit dead
    const dir = random(`dir${seg.i}`) > 0.5 ? 1 : -1;
    const drift = interpolate(frame, [0, (seg.to - seg.from) * fps], [0, 40 * dir]);
    return <Img src={staticFile(src)} style={{ ...style, transform: `translateX(${drift}px) scale(1.06)` }} />;
  }
  return (
    <OffthreadVideo
      src={staticFile(src)}
      muted
      trimBefore={Math.round(seg.offset * fps)}
      playbackRate={seg.rate}
      style={style}
    />
  );
};

const Footage = ({ segments }: { segments: Segment[] }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {segments.map((seg) => {
        const from = Math.round(seg.from * fps);
        const dur = Math.max(1, Math.round(seg.to * fps) - from);
        const landscape = seg.clip.width > seg.clip.height;
        return (
          <Sequence key={seg.i} from={from} durationInFrames={dur} layout="absolute-fill">
            <AbsoluteFill style={{ transform: seg.mirror ? "scaleX(-1)" : undefined }}>
              {landscape ? (
                <>
                  <AbsoluteFill style={{ filter: seg.clip.bg ? undefined : "blur(40px) brightness(0.8)", transform: "scale(1.2)" }}>
                    <Media seg={seg} fit="cover" src={seg.clip.bg} />
                  </AbsoluteFill>
                  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
                    <div style={{ width: `${FG_W * 100}%`, flexShrink: 0, aspectRatio: `${seg.clip.width} / ${seg.clip.height}` }}>
                      <Media seg={seg} fit="cover" />
                    </div>
                  </AbsoluteFill>
                </>
              ) : (
                <Media seg={seg} fit="cover" />
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
};

const CHANNELS = { r: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", g: "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0", b: "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" };

/** Footage with RGB split (`split` px) or glitch slices (`glitch` 0-1). Short bursts only: each copy costs decode time. */
const FxFootage = ({ segments, split, glitch }: { segments: Segment[]; split: number; glitch: number }) => {
  const frame = useCurrentFrame();
  if (glitch > 0.15) {
    const n = 7;
    return (
      <AbsoluteFill style={{ background: "black" }}>
        {[...Array(n).keys()].map((i) => (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${(i / n) * 100}% 0 ${100 - ((i + 1) / n) * 100}% 0)`,
              transform: `translateX(${(random(`gl${i}-${Math.floor(frame / 2)}`) - 0.5) * 260 * glitch}px)`,
            }}
          >
            <Footage segments={segments} />
          </AbsoluteFill>
        ))}
      </AbsoluteFill>
    );
  }
  if (split < 1) return <Footage segments={segments} />;
  return (
    <AbsoluteFill style={{ background: "black", isolation: "isolate" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        {Object.entries(CHANNELS).map(([k, v]) => (
          <filter key={k} id={`ch-${k}`}>
            <feColorMatrix type="matrix" values={v} />
          </filter>
        ))}
      </svg>
      {(["r", "g", "b"] as const).map((c, i) => (
        <AbsoluteFill
          key={c}
          style={{ filter: `url(#ch-${c})`, mixBlendMode: "screen", transform: `translate(${(i - 1) * split}px, ${(1 - i) * split * 0.3}px)` }}
        >
          <Footage segments={segments} />
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

// ---------- main ----------

export const Quiz = (props: QuizProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const { plan, answer, hook, emoji, music, choices } = props;
  const style: Style = { ...DEFAULT_STYLE, ...props.style };
  if (style.dropFx === "shatter" && style.mechanic !== "glass") style.dropFx = "flash";
  const { drop, length, beats, downbeats, strong } = plan;
  if (!props.clips.length) return <AbsoluteFill style={{ background: "#111" }} />;

  const segments = buildSegments(props, style);
  const after = t >= drop;
  const dt = t - drop;
  const beatPulse = decay(t, beats, 1, 9);

  // camera: the zoom mechanic starts tight and pulls out; the others push in gently
  const guessZoom =
    style.mechanic === "zoom"
      ? interpolate(t, [0, drop - 1], [2.4, 1.0], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) })
      : interpolate(t, [0, drop], [1.0, 1.12], clampX);
  let punch = after ? decay(t, [drop], 0.18, 6) : decay(t, downbeats, 0.06, 7);
  let shakeAmp = decay(t, [drop], 38, 7) + decay(t, strong, 14, 12) + (after ? decay(t, downbeats, 8, 12) : 0);
  let turn = 0;
  let whipX = 0;
  let flash = 0;

  // the hit on the drop
  if (style.dropFx === "flash" || style.dropFx === "shatter") flash += decay(t, [drop], 1, 10);
  if (style.dropFx === "zoomThrough") punch += decay(t, [drop], 1.4, 9);
  if (style.dropFx === "whip" && after) whipX += width * 0.9 * Math.exp(-dt * 13);
  if (style.dropFx === "shatter") shakeAmp += decay(t, [drop], 20, 6);
  const glitch = style.dropFx === "glitch" ? Math.max(after && dt < 0.4 ? 1 - dt / 0.4 : 0, decay(t, strong, 0.6, 18)) : 0;

  // transition on each beat cut after the drop
  const cuts = segments.filter((s) => s.from > drop + 0.01).map((s) => s.from);
  const lastCut = [...cuts].reverse().find((c) => c <= t);
  if (lastCut !== undefined) {
    const e = Math.exp(-(t - lastCut) * 12);
    const dir = cuts.indexOf(lastCut) % 2 ? 1 : -1;
    if (style.cut === "punch") punch += 0.06 * e;
    if (style.cut === "zoom") punch += 0.3 * e;
    if (style.cut === "spin") {
      turn += dir * 12 * e;
      punch += 0.15 * e;
    }
    if (style.cut === "whip") whipX += dir * width * 0.5 * Math.exp(-(t - lastCut) * 18);
    if (style.cut === "flash") flash += 0.45 * Math.exp(-(t - lastCut) * 16);
  }

  const zoom = (after ? 1.06 : guessZoom) + punch;
  const sx = (random(`sx${frame}`) - 0.5) * 2 * shakeAmp + whipX;
  const sy = (random(`sy${frame}`) - 0.5) * 2 * shakeAmp;
  const rot = (random(`r${frame}`) - 0.5) * shakeAmp * 0.06 + turn;
  const split = glitch > 0.15 ? 0 : decay(t, [drop], 28, 6) + decay(t, strong, 10, 14);
  const blurX = Math.min(60, Math.abs(whipX) * 0.08); // directional motion blur while whipping
  flash = Math.min(1, flash);

  const mono = style.look === "mono2color" && !after;

  // zoom pivots on the focus point (mapped into the letterboxed frame for landscape clips)
  const c0 = props.clips[0];
  const [fx, fy] = c0.focus ?? [0.5, 0.5];
  const land = c0.width > c0.height;
  const fgW = land ? width * FG_W : width;
  const fgH = land ? (fgW * c0.height) / c0.width : height;
  const originX = (width - fgW) / 2 + fx * fgW;
  const originY = (height - fgH) / 2 + fy * fgH;

  // reveal choreography
  const moveUp = spring({ frame: frame - (drop + 2.4) * fps, fps, config: { damping: 14, stiffness: 120 } });
  const ansY = interpolate(moveUp, [0, 1], [880, 330]);
  const ansScale = interpolate(moveUp, [0, 1], [1, 0.62]);
  const dim = interpolate(t, [drop, drop + 0.1, drop + 2.4, drop + 2.9], [0, 0.55, 0.55, 0.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const hookExit = interpolate(t, [drop - 0.12, drop], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const filters = [
    props.clips.every((c) => c.graded) ? "" : "contrast(1.12) saturate(1.25)",
    mono ? "grayscale(1)" : "",
    blurX > 1 ? "url(#whipblur)" : "",
  ].join(" ").trim();

  return (
    <AbsoluteFill style={{ background: "black", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate(${sx}px, ${sy}px) rotate(${rot}deg) scale(${zoom})`,
          transformOrigin: `${originX}px ${originY}px`,
          filter: filters || undefined,
        }}
      >
        <FxFootage segments={segments} split={split} glitch={glitch} />
      </AbsoluteFill>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <filter id="whipblur">
          <feGaussianBlur stdDeviation={`${blurX} 0`} />
        </filter>
      </svg>

      {/* hiding layers */}
      {style.mechanic === "glass" && <Glass drop={drop} strong={strong} />}
      {style.mechanic === "tiles" && <Tiles style={style} drop={drop} beats={beats} />}
      {style.mechanic === "spotlight" && <Spotlight style={style} drop={drop} />}
      <LookOverlays style={style} downbeats={downbeats} />

      {/* vignette + dim + flash */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.65) 100%)" }} />
      <AbsoluteFill style={{ background: "black", opacity: dim }} />
      <AbsoluteFill style={{ background: "white", opacity: flash }} />

      {/* guess phase: progress bar + hook */}
      {!after && (
        <>
          <div style={{ position: "absolute", top: 210, left: 160, width: 760, height: 16, borderRadius: 8, background: "rgba(255,255,255,0.25)" }}>
            <div
              style={{
                width: `${Math.min(1, t / drop) * 100}%`,
                height: "100%",
                borderRadius: 8,
                background: style.accent,
                boxShadow: `0 0 ${12 + beatPulse * 30}px ${style.accent}`,
              }}
            />
          </div>
          <div style={{ position: "absolute", top: 270, width: "100%", opacity: hookExit, transform: `scale(${1 + beatPulse * 0.05 + (1 - hookExit) * 0.3})` }}>
            <Hook style={style} hook={hook} emoji={emoji} />
          </div>
        </>
      )}

      {/* reveal on the drop */}
      {after && (
        <>
          <div style={{ position: "absolute", top: ansY - 150, width: "100%", transform: `scale(${ansScale})`, transformOrigin: "50% 150px" }}>
            <div style={{ opacity: 1 - moveUp }}>
              <Letters style={style} text="IT'S A" start={drop} size={78} color="white" stagger={1} />
            </div>
            <div style={{ marginTop: 18, transform: `scale(${1 + beatPulse * 0.04})` }}>
              <Reveal style={style} text={answer.toUpperCase()} start={drop + 0.08} />
            </div>
          </div>
          <PopIn start={drop + 3} style={{ position: "absolute", bottom: 360, width: "100%", display: "flex", justifyContent: "center" }}>
            <div
              style={{
                ...textBase(style, 58, "black"),
                WebkitTextStroke: "0px",
                background: "white",
                padding: "22px 44px",
                borderRadius: 999,
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                transform: `scale(${1 + beatPulse * 0.06})`,
              }}
            >
              GOT IT? COMMENT 👇
            </div>
          </PopIn>
        </>
      )}

      {choices && choices.length > 1 && <Choices style={style} choices={choices} answer={answer} drop={drop} />}

      {music && (
        <Audio
          src={staticFile(music.src)}
          trimBefore={Math.round(music.start * fps)}
          volume={(f) => interpolate(f / fps, [0, 0.3, length - 0.8, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      )}
    </AbsoluteFill>
  );
};
