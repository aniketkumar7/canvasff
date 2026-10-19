import type { CSSProperties, ReactNode } from "react";
import { interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fitSize, fontOf, type Style } from "./style";

export const textBase = (style: Style, size: number, color: string): CSSProperties => ({
  fontFamily: fontOf(style),
  fontWeight: 900,
  fontSize: size,
  color,
  lineHeight: 1,
  WebkitTextStroke: `${Math.round(size / 9)}px black`,
  paintOrder: "stroke fill",
  textShadow: "0 8px 24px rgba(0,0,0,0.6)",
  letterSpacing: style.font === "montserrat" ? -1 : 1,
});

const row: CSSProperties = { display: "flex", justifyContent: "center", whiteSpace: "pre" };
const SPRING = { damping: 11, stiffness: 220, mass: 0.6 };

/** Letters spring in one by one. `slam` = drop in from big + blurred. */
export const Letters = ({ style, text, start, size, color, stagger = 1.5, slam = false, glow = false }: {
  style: Style; text: string; start: number; size: number; color: string; stagger?: number; slam?: boolean; glow?: boolean;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={row}>
      {[...text].map((ch, i) => {
        const s = spring({ frame: frame - start * fps - i * stagger, fps, config: SPRING });
        const anim: CSSProperties = slam
          ? { transform: `scale(${interpolate(s, [0, 1], [2.8, 1])})`, opacity: Math.min(1, s * 3), filter: `blur(${(1 - Math.min(s, 1)) * 14}px)` }
          : { transform: `translateY(${(1 - s) * 60}px) scale(${s})`, opacity: Math.min(1, s * 2) };
        const base = textBase(style, size, color);
        return (
          <span key={i} style={{ ...base, ...anim, display: "inline-block", textShadow: glow ? `0 0 40px ${color}AA, ${base.textShadow}` : base.textShadow }}>
            {ch}
          </span>
        );
      })}
    </div>
  );
};

export const PopIn = ({ start, children, style }: { start: number; children: ReactNode; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - start * fps, fps, config: { damping: 9, stiffness: 180, mass: 0.7 } });
  return <div style={{ ...style, transform: `${style?.transform ?? ""} translateY(${(1 - s) * 200}px) scale(${s})`, opacity: Math.min(1, s * 2) }}>{children}</div>;
};

// ---------- hook (guess phase) ----------

/** One hook line in the reel's hook style. */
const HookLine = ({ style, text, start, size, color }: { style: Style; text: string; start: number; size: number; color: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps - start;
  const base = textBase(style, size, color);

  if (style.hook === "words") {
    return (
      <div style={{ ...row, gap: size * 0.25 }}>
        {text.split(" ").map((w, i) => {
          const s = spring({ frame: frame - (start + i * 0.12) * fps, fps, config: SPRING });
          return <span key={i} style={{ ...base, display: "inline-block", transform: `translateY(${(1 - s) * 120}px) rotate(${(1 - s) * -8}deg)`, opacity: Math.min(1, s * 2) }}>{w}</span>;
        })}
      </div>
    );
  }
  if (style.hook === "type") {
    const n = Math.max(0, Math.min(text.length, Math.floor(t * 22)));
    const cursor = t >= 0 && n < text.length; // only while typing
    return (
      <div style={row}>
        <span style={base}>{text.slice(0, n)}</span>
        <span style={{ ...base, opacity: cursor ? 1 : 0 }}>|</span>
      </div>
    );
  }
  if (style.hook === "glitch") {
    const burst = random(`g${Math.floor(frame / 3)}`) > 0.72; // a twitch every so often
    const dx = burst ? (random(`gx${frame}`) - 0.5) * 24 : 0;
    const shadow = `${-4 - Math.abs(dx) / 2}px 0 0 rgba(255,0,60,0.85), ${4 + Math.abs(dx) / 2}px 0 0 rgba(0,229,255,0.85), ${base.textShadow}`;
    return (
      <div style={{ ...row, opacity: t < 0 ? 0 : 1 }}>
        <span style={{ ...base, textShadow: shadow, transform: `translateX(${dx}px) skewX(${burst ? dx / 3 : 0}deg)` }}>{text}</span>
      </div>
    );
  }
  if (style.hook === "marker") {
    const s = spring({ frame: frame - start * fps, fps, config: { damping: 20, stiffness: 90 } });
    return (
      <div style={row}>
        <span style={{ position: "relative", padding: `0 ${size * 0.2}px` }}>
          <span style={{ position: "absolute", inset: `${size * 0.08}px 0`, background: style.accent, transformOrigin: "left", transform: `scaleX(${s}) skewX(-8deg)`, borderRadius: 8 }} />
          <span style={{ ...base, position: "relative", color: color === style.accent ? "black" : color, WebkitTextStroke: color === style.accent ? "0px" : base.WebkitTextStroke }}>{text}</span>
        </span>
      </div>
    );
  }
  return <Letters style={style} text={text} start={start} size={size} color={color} stagger={0} />;
};

export const Hook = ({ style, hook, emoji }: { style: Style; hook: [string, string]; emoji: string }) => (
  <>
    <HookLine style={style} text={hook[0]} start={-0.2} size={fitSize(style, hook[0], 92)} color="white" />
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 18, marginTop: 6 }}>
      <HookLine style={style} text={hook[1]} start={style.hook === "type" ? 0.4 : -0.15} size={fitSize(style, hook[1], 140)} color={style.accent} />
      <PopIn start={0.15} style={{ fontSize: 120 }}>{emoji}</PopIn>
    </div>
  </>
);

// ---------- answer reveal (on the drop) ----------

const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789#$%&";

export const Reveal = ({ style, text, start }: { style: Style; text: string; start: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = fitSize(style, text, 170);
  const color = style.accent;
  const base = textBase(style, size, color);
  const glow = `0 0 40px ${color}AA, ${base.textShadow}`;
  const f = frame - start * fps;

  if (style.reveal === "scramble") {
    // each letter flickers through random glyphs, then locks left to right
    return (
      <div style={row}>
        {[...text].map((ch, i) => {
          const lock = 6 + i * 2;
          const shown = ch === " " || f >= lock ? ch : GLYPHS[Math.floor(random(`s${i}-${frame}`) * GLYPHS.length)];
          return <span key={i} style={{ ...base, display: "inline-block", textShadow: glow, opacity: f < 0 ? 0 : 1, color: f >= lock ? color : "white" }}>{shown}</span>;
        })}
      </div>
    );
  }
  if (style.reveal === "stamp") {
    const s = spring({ frame: f, fps, config: { damping: 8, stiffness: 260, mass: 0.8 } });
    return (
      <div style={{ ...row, transform: `rotate(-7deg) scale(${interpolate(s, [0, 1], [3, 1])})`, opacity: Math.min(1, s * 4) }}>
        <span style={{ ...base, textShadow: glow, border: `10px solid ${color}`, borderRadius: 18, padding: `${size * 0.12}px ${size * 0.25}px`, background: "rgba(0,0,0,0.35)" }}>{text}</span>
      </div>
    );
  }
  if (style.reveal === "split") {
    // top half slides in from the left, bottom half from the right, they lock together
    const s = spring({ frame: f, fps, config: { damping: 15, stiffness: 160 } });
    const off = (1 - s) * 900;
    const half = (clip: string, dx: number) => (
      <span style={{ ...base, textShadow: glow, position: "absolute", inset: 0, textAlign: "center", clipPath: clip, transform: `translateX(${dx}px)` }}>{text}</span>
    );
    return (
      <div style={{ position: "relative", height: size, width: "100%", opacity: f < 0 ? 0 : 1 }}>
        {half("inset(0 0 50% 0)", -off)}
        {half("inset(50% 0 0 0)", off)}
      </div>
    );
  }
  return <Letters style={style} text={text} start={start} size={size} color={color} stagger={1.2} slam glow />;
};
