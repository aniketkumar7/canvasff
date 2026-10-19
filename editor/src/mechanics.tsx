import type { CSSProperties } from "react";
import { AbsoluteFill, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { textBase } from "./text";
import type { Style } from "./style";

const W = 1080;
const H = 1920;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// ---------- glass: frosted pane that cracks on the beats and shatters on the drop ----------

type Shard = { pts: [number, number][]; cx: number; cy: number };

const shardsFor = (): Shard[] => {
  const cols = 4;
  const rows = 7;
  const p = (c: number, r: number): [number, number] => {
    const edge = c === 0 || r === 0 || c === cols || r === rows;
    const j = edge ? 0 : 0.35;
    return [((c + (random(`px${c}-${r}`) - 0.5) * j) / cols) * W, ((r + (random(`py${c}-${r}`) - 0.5) * j) / rows) * H];
  };
  const out: Shard[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const [a, b, cc, d] = [p(c, r), p(c + 1, r), p(c + 1, r + 1), p(c, r + 1)];
      for (const tri of random(`d${c}-${r}`) > 0.5 ? [[a, b, cc], [a, cc, d]] : [[a, b, d], [b, cc, d]]) {
        out.push({ pts: tri as [number, number][], cx: (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy: (tri[0][1] + tri[1][1] + tri[2][1]) / 3 });
      }
    }
  return out;
};
const SHARDS = shardsFor();

export const Glass = ({ drop, strong }: { drop: number; strong: number[] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const dt = t - drop;
  if (dt > 0.9) return null;
  // cracks spread over the last ~2s, jumping forward on each strong beat
  const hits = strong.filter((b) => b > drop - 2.2 && b < drop && b <= t).length;
  const crackShare = t >= drop ? 1 : Math.min(1, interpolate(t, [drop - 2.2, drop], [0, 0.55], clamp) + hits * 0.15);
  const edges = SHARDS.flatMap((s, i) => (i / SHARDS.length < crackShare ? [s] : []));
  return (
    <AbsoluteFill>
      {SHARDS.map((s, i) => {
        const dx = s.cx - W / 2;
        const dy = s.cy - H / 2;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 900 + random(`sp${i}`) * 900;
        const fly = dt > 0 ? dt : 0;
        const x = (dx / len) * speed * fly;
        const y = (dy / len) * speed * fly + 2200 * fly * fly;
        const rot = (random(`rt${i}`) - 0.5) * 720 * fly;
        const style: CSSProperties = {
          position: "absolute",
          inset: 0,
          clipPath: `polygon(${s.pts.map(([px, py]) => `${px}px ${py}px`).join(",")})`,
          background: `linear-gradient(${120 + i * 7}deg, rgba(255,255,255,0.32), rgba(255,255,255,0.12) 45%, rgba(200,230,255,0.26))`,
          transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`,
          transformOrigin: `${s.cx}px ${s.cy}px`,
          opacity: interpolate(dt, [0, 0.9], [1, 0], clamp),
        };
        return <div key={i} style={style} />;
      })}
      {dt <= 0 && (
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          {edges.map((s, i) => (
            <polygon key={i} points={s.pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={3} />
          ))}
        </svg>
      )}
    </AbsoluteFill>
  );
};

// ---------- tiles: a grid of covers, one flips away per beat ----------

export const Tiles = ({ style, drop, beats }: { style: Style; drop: number; beats: number[] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cols = 3;
  const rows = 5;
  const n = cols * rows;
  const order = [...Array(n).keys()].sort((a, b) => random(`tile${a}`) - random(`tile${b}`));
  // reveal ~60% before the drop, one tile per beat; the rest go on the drop
  const early = beats.filter((b) => b > 0.6 && b < drop - 0.3).slice(0, Math.floor(n * 0.6));
  const goAt = (i: number) => early[order.indexOf(i)] ?? drop + order.indexOf(i) * 0.02;
  if (t > drop + 0.8) return null;
  return (
    <AbsoluteFill style={{ perspective: 1400 }}>
      {[...Array(n).keys()].map((i) => {
        const at = goAt(i);
        const s = spring({ frame: frame - at * fps, fps, config: { damping: 14, stiffness: 200 } });
        const c = i % cols;
        const r = Math.floor(i / cols);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: (c * W) / cols + 4,
              top: (r * H) / rows + 4,
              width: W / cols - 8,
              height: H / rows - 8,
              borderRadius: 18,
              background: "linear-gradient(145deg, #15151c, #07070a)",
              border: `3px solid ${style.accent}55`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `rotateY(${s * 90}deg) scale(${1 - s * 0.2})`,
              opacity: 1 - s,
            }}
          >
            <span style={{ ...textBase(style, 110, style.accent), WebkitTextStroke: "0px", opacity: 0.35 }}>?</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------- spotlight: darkness with a wandering hole that grows ----------

export const Spotlight = ({ style, drop }: { style: Style; drop: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const open = spring({ frame: frame - drop * fps, fps, config: { damping: 18, stiffness: 90 } });
  if (open > 0.995) return null;
  const x = W / 2 + Math.sin(t * 1.3) * 260 + Math.sin(t * 0.7 + 1) * 120;
  const y = H / 2 + Math.cos(t * 1.1) * 340 + Math.sin(t * 0.5) * 160;
  const r = interpolate(t, [0, drop], [150, 330], clamp) + open * 1800;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, ${style.accent}88 ${r + 6}px, rgba(0,0,0,0.95) ${r + 40}px)`,
      }}
    />
  );
};

// ---------- A/B/C choices ----------

export const Choices = ({ style, choices, answer, drop }: { style: Style; choices: string[]; answer: string; drop: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const out = interpolate(t, [drop + 2.2, drop + 2.6], [1, 0], clamp);
  if (out <= 0) return null;
  return (
    <div style={{ position: "absolute", bottom: 300, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 22, opacity: out }}>
      {choices.map((c, i) => {
        const s = spring({ frame: frame - (0.5 + i * 0.15) * fps, fps, config: { damping: 12, stiffness: 180 } });
        const right = c === answer;
        const done = t >= drop;
        const hit = spring({ frame: frame - (drop + 0.15) * fps, fps, config: { damping: 9, stiffness: 220 } });
        const shake = done && !right ? Math.sin(frame * 2.2) * 10 * Math.max(0, 1 - (t - drop) * 3) : 0;
        return (
          <div
            key={c}
            style={{
              ...textBase(style, 52, done && right ? "black" : "white"),
              WebkitTextStroke: "0px",
              display: "flex",
              alignItems: "center",
              gap: 20,
              width: 760,
              padding: "20px 28px",
              borderRadius: 999,
              background: done ? (right ? "#22C55E" : "rgba(40,0,0,0.75)") : "rgba(0,0,0,0.6)",
              border: `4px solid ${done ? (right ? "#22C55E" : "#FF2D55") : "rgba(255,255,255,0.35)"}`,
              boxShadow: done && right ? "0 0 50px #22C55E" : "0 10px 30px rgba(0,0,0,0.5)",
              transform: `translateX(${(1 - s) * (i % 2 ? 900 : -900) + shake}px) scale(${done && right ? 1 + hit * 0.08 : 1})`,
              opacity: done && !right ? 0.45 : 1,
              textDecoration: done && !right ? "line-through" : undefined,
            }}
          >
            <span style={{ width: 64, height: 64, borderRadius: 32, background: style.accent, color: "black", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {"ABC"[i]}
            </span>
            {c.toUpperCase()}
          </div>
        );
      })}
    </div>
  );
};

// ---------- look overlays ----------

export const LookOverlays = ({ style, downbeats }: { style: Style; downbeats: number[] }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const grain = style.look === "film" || style.look === "night" || style.look === "mono2color";
  const leak = style.look === "film" || style.look === "tealOrange";
  const pulse = downbeats.reduce((s, b) => (b <= t && t - b < 0.6 ? s + Math.exp(-(t - b) * 6) : s), 0);
  const bars = spring({ frame, fps, config: { damping: 20, stiffness: 80 } });
  return (
    <>
      {leak && (
        <AbsoluteFill
          style={{
            mixBlendMode: "screen",
            opacity: 0.22 + pulse * 0.12,
            background: `radial-gradient(circle at ${20 + Math.sin(t * 0.6) * 25}% ${15 + Math.cos(t * 0.4) * 10}%, #ff8a3d 0%, transparent 45%), radial-gradient(circle at ${85 + Math.cos(t * 0.5) * 10}% ${80 + Math.sin(t * 0.7) * 10}%, #ff3d8a 0%, transparent 40%)`,
          }}
        />
      )}
      {style.look === "neon" && (
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.18 + pulse * 0.1, background: "linear-gradient(180deg, #7b2dff 0%, transparent 35%, transparent 65%, #00e5ff 100%)" }} />
      )}
      {grain && (
        <AbsoluteFill
          style={{
            backgroundImage: `url(${staticFile("noise.png")})`,
            backgroundPosition: `${Math.floor(random(`nx${frame}`) * 256)}px ${Math.floor(random(`ny${frame}`) * 256)}px`,
            mixBlendMode: "overlay",
            opacity: 0.16,
          }}
        />
      )}
      {style.bars && (
        <>
          <div style={{ position: "absolute", top: 0, width: "100%", height: 150 * bars, background: "black" }} />
          <div style={{ position: "absolute", bottom: 0, width: "100%", height: 150 * bars, background: "black" }} />
        </>
      )}
    </>
  );
};
