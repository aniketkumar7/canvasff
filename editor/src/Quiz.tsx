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
import { loadFont } from "@remotion/google-fonts/Montserrat";

const { fontFamily } = loadFont("normal", { weights: ["900"] });
const YELLOW = "#FFD400";
const FG_W = 1.3; // landscape clips: 130% width (crop sides) so the subject fills more of the frame

export type Clip = {
  src: string;
  /** pre-blurred low-res background (make_short.py); without it the background is blurred live, which is slow */
  bg?: string;
  /** contrast/saturation already baked in by ffmpeg, so skip the per-frame CSS filter */
  graded?: boolean;
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
};

type Segment = { from: number; to: number; clip: Clip; offset: number; rate: number; mirror: boolean; i: number };

// ---------- timing helpers ----------

/** Sum of exponential decays from each hit time before t. */
const decay = (t: number, hits: number[], amp: number, k: number) =>
  hits.reduce((s, b) => (b <= t && t - b < 0.8 ? s + amp * Math.exp(-(t - b) * k) : s), 0);

function buildSegments({ clips, plan }: QuizProps): Segment[] {
  const { drop, length, downbeats, beats } = plan;
  const slowFrom = drop - 0.9;
  const guessCuts = downbeats.filter((t) => t > 0.8 && t < slowFrom - 0.6);
  const post = beats.filter((t) => t > drop + 0.2 && t < length - 0.3);
  const postCuts = post.filter((_, i) => i < 8 || i % 2 === 0); // every beat, then every 2nd
  const bounds = [0, ...guessCuts, slowFrom, drop, ...postCuts, length];
  return bounds.slice(0, -1).map((from, i) => {
    const to = bounds[i + 1];
    const clip = clips[i % clips.length];
    const rate = from >= slowFrom && from < drop ? 0.35 : 1;
    const room = Math.max(0, (clip.duration ?? 0) - (to - from) * rate - 0.05);
    return { from, to, clip, rate, offset: random(`off${i}`) * room, mirror: from >= drop && i % 3 === 2, i };
  });
}

// ---------- footage ----------

const Media = ({ seg, fit, src = seg.clip.src }: { seg: Segment; fit: "cover" | "contain"; src?: string }) => {
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

/** Footage with RGB-split when `split` px > 0 (three channel copies, screen-blended). */
const SplitFootage = ({ segments, split }: { segments: Segment[]; split: number }) => {
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

// ---------- text ----------

const textBase = (size: number, color: string): CSSProperties => ({
  fontFamily,
  fontWeight: 900,
  fontSize: size,
  color,
  lineHeight: 1,
  WebkitTextStroke: `${Math.round(size / 9)}px black`,
  paintOrder: "stroke fill",
  textShadow: "0 8px 24px rgba(0,0,0,0.6)",
  letterSpacing: -1,
});

/** Letters spring in one by one. `slam` = drop in from big + blurred. */
const Letters = ({ text, start, size, color, stagger = 1.5, slam = false, glow = false }: {
  text: string; start: number; size: number; color: string; stagger?: number; slam?: boolean; glow?: boolean;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", justifyContent: "center", whiteSpace: "pre" }}>
      {[...text].map((ch, i) => {
        const s = spring({ frame: frame - start * fps - i * stagger, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } });
        const style: CSSProperties = slam
          ? { transform: `scale(${interpolate(s, [0, 1], [2.8, 1])})`, opacity: Math.min(1, s * 3), filter: `blur(${(1 - Math.min(s, 1)) * 14}px)` }
          : { transform: `translateY(${(1 - s) * 60}px) scale(${s})`, opacity: Math.min(1, s * 2) };
        return (
          <span
            key={i}
            style={{
              ...textBase(size, color),
              ...style,
              display: "inline-block",
              textShadow: glow ? `0 0 40px ${YELLOW}AA, 0 8px 24px rgba(0,0,0,0.6)` : textBase(size, color).textShadow,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
};

const PopIn = ({ start, children, style }: { start: number; children: ReactNode; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - start * fps, fps, config: { damping: 9, stiffness: 180, mass: 0.7 } });
  return <div style={{ ...style, transform: `${style?.transform ?? ""} translateY(${(1 - s) * 200}px) scale(${s})`, opacity: Math.min(1, s * 2) }}>{children}</div>;
};

// ---------- main ----------

export const Quiz = (props: QuizProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const { plan, answer, hook, emoji, music } = props;
  const { drop, length, beats, downbeats, strong } = plan;
  if (!props.clips.length) return <AbsoluteFill style={{ background: "#111" }} />;

  const segments = buildSegments(props);
  const after = t >= drop;
  const beatPulse = decay(t, beats, 1, 9);

  // camera: slow zoom-out during guess, punches on beats, shake on hits
  const guessZoom = interpolate(t, [0, drop - 1], [2.4, 1.0], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const punch = after ? decay(t, beats, 0.05, 12) + decay(t, [drop], 0.18, 6) : decay(t, downbeats, 0.06, 7);
  const zoom = (after ? 1.06 : guessZoom) + punch;
  const shakeAmp = decay(t, [drop], 38, 7) + decay(t, strong, 14, 12) + (after ? decay(t, downbeats, 8, 12) : 0);
  const sx = (random(`sx${frame}`) - 0.5) * 2 * shakeAmp;
  const sy = (random(`sy${frame}`) - 0.5) * 2 * shakeAmp;
  const rot = (random(`r${frame}`) - 0.5) * shakeAmp * 0.06;
  const split = decay(t, [drop], 28, 6) + decay(t, strong, 10, 14);
  const flash = Math.min(1, decay(t, [drop], 1, 10) + (after ? decay(t.valueOf(), downbeats.filter((b) => b > drop + 0.3), 0.3, 14) : 0));

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
  const ansSize = Math.min(170, Math.floor(980 / (0.74 * answer.length)));

  return (
    <AbsoluteFill style={{ background: "black", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate(${sx}px, ${sy}px) rotate(${rot}deg) scale(${zoom})`,
          transformOrigin: `${originX}px ${originY}px`,
          filter: props.clips.every((c) => c.graded) ? undefined : "contrast(1.12) saturate(1.25)",
        }}
      >
        <SplitFootage segments={segments} split={split} />
      </AbsoluteFill>

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
                background: YELLOW,
                boxShadow: `0 0 ${12 + beatPulse * 30}px ${YELLOW}`,
              }}
            />
          </div>
          <div style={{ position: "absolute", top: 270, width: "100%", opacity: hookExit, transform: `scale(${1 + beatPulse * 0.05 + (1 - hookExit) * 0.3})` }}>
            <Letters text={hook[0]} start={0.1} size={92} color="white" />
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 18, marginTop: 6 }}>
              <Letters text={hook[1]} start={0.1 + hook[0].length * 0.05} size={140} color={YELLOW} />
              <PopIn start={0.6} style={{ fontSize: 120 }}>{emoji}</PopIn>
            </div>
          </div>
        </>
      )}

      {/* reveal on the drop */}
      {after && (
        <>
          <div style={{ position: "absolute", top: ansY - 150, width: "100%", transform: `scale(${ansScale})`, transformOrigin: "50% 150px" }}>
            <div style={{ opacity: 1 - moveUp }}>
              <Letters text="IT'S A" start={drop} size={78} color="white" stagger={1} />
            </div>
            <div style={{ marginTop: 18, transform: `scale(${1 + beatPulse * 0.04})` }}>
              <Letters text={answer.toUpperCase()} start={drop + 0.08} size={ansSize} color={YELLOW} stagger={1.2} slam glow />
            </div>
          </div>
          <PopIn start={drop + 3} style={{ position: "absolute", bottom: 360, width: "100%", display: "flex", justifyContent: "center" }}>
            <div
              style={{
                ...textBase(58, "black"),
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
