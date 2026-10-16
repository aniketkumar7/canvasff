"use client";

import * as React from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
  type Transition,
} from "motion/react";
import { cn } from "cn";
import { useReducedMotionPreference } from "devignerui/hooks";
import {
  DRIFT_DUST,
  SPRING_LAYOUT,
  SPRING_MOUSE,
  SPRING_PRESS,
  SPRING_RETRACT,
  SPRING_TRAVEL,
} from "devignerui/motion";
import { useControllableState } from "devignerui/hooks";

// A card with a label, a rolling readout and a pill track. The fill is a
// gradient that fades in from the start, with a slow drift of glowing dust
// inside it and a soft handle near its end that firms up when grabbed and
// stretches with the speed of the drag. Horizontal (either direction) or
// vertical, in three sizes, in a card or bare.

/** Track thickness per size, px. Every other measure derives from it. */
const SIZES = { sm: 44, md: 54, lg: 64 } as const;
type Size = keyof typeof SIZES;

/** The track, fill, handle and mark measures for one size. At md: a 54px
 *  track, the fill 6px inside it, a 7 by 20px handle 10px in from the
 *  fill's end, which keeps a 10px corner until it rounds out near max. */
function geometry(size: Size) {
  const track = SIZES[size];
  const k = track / SIZES.md;
  const inset = Math.round(6 * k);
  const fill = track - inset * 2;
  const edge = Math.round(10 * k);
  const gap = Math.round(10 * k);
  const handleW = Math.round(7 * k);
  const handleH = Math.round(20 * k);
  const lead = gap + handleW / 2;
  // The fill's length at min: a slim socket hugging the handle, so an empty
  // slider doesn't read as a sliver of value. Never shorter than its round
  // start plus its end corner, or the browser would shrink the radii and the
  // start would stop being a full half circle.
  const minFill = Math.max(lead * 2, fill / 2 + edge);
  return {
    track,
    inset,
    fill,
    edge,
    gap,
    handleW,
    handleH,
    lead,
    minFill,
    /** Where the handle's centre stops, in from the track's start and end:
     *  at min the fill is minFill long, at max it reaches the padding. */
    start: inset + minFill - lead,
    end: inset + lead,
    /** Mark length: about two thirds of the fill, so the faded tips end
     *  well inside it. */
    mark: Math.round((fill * 2) / 3),
    /** Pull radius of a detent, px along the track. */
    magnet: Math.round(10 * k),
  };
}

/** Literal classes per size, so Tailwind sees each one. */
const CARD = {
  sm: "w-[320px] p-3 text-sm",
  md: "w-[372px] p-[15px] text-base",
  lg: "w-[420px] p-[18px] text-lg",
} as const;
const BARE = { sm: "w-[296px]", md: "w-[342px]", lg: "w-[384px]" } as const;
/** Vertical tracks take their length from a class, so className or
 *  classNames.track can override it. */
const LENGTH = { sm: "h-48", md: "h-56", lg: "h-64" } as const;

/** The track's bevel, the same as Nav Notch's: a lit top edge, a shaded
 *  bottom, a hairline rim and a soft drop. */
const TRACK_SHADOW = [
  "inset 0 1px 0 color-mix(in oklab, var(--foreground) 10%, transparent)",
  "inset 0 -2px 3px color-mix(in oklab, var(--background) 45%, transparent)",
  "inset 0 0 0 1px color-mix(in oklab, var(--foreground) 6%, transparent)",
  "0 1px 2px color-mix(in oklab, var(--background) 60%, transparent)",
].join(", ");
/** From this ratio on, the fill's end rounds out, reaching a full half
 *  circle at max. */
const ROUND_FROM = 0.85;
/** Over the first part of the range the color fades in: at min the fill is
 *  a neutral socket around the handle, so it reads as empty, not as a
 *  sliver of value. */
const COLOR_IN = 0.08;
/** Drag speed (track lengths a second) at which the handle is widest. */
const FULL_SPEED = 2.5;
/** Height of one digit cell in the readout, em: the header row's line
 *  height, so a digit at rest sits exactly where plain text would. */
const CELL = 1.5;
/** Motion blur on a rolling digit: px per digit-step a second, and the most
 *  it ever gets, so a fast roll softens without turning to fog. */
const BLUR_GAIN = 0.035;
const MAX_BLUR = 1.2;
/** The blur moves in quarter-pixel steps, so its style changes only when
 *  it crosses one, not on every frame of a roll. */
const BLUR_STEP = 4;
/** Dust motes per px of track. */
const DENSITY = 0.2;
/** The dust gathers toward the handle, as stretches of the fill (0 at its
 *  start, 1 at its end) and the share of the motes each one holds: sparse
 *  at the dark start, fuller along the middle, densest around the handle. */
const DUST_ZONES = [
  { lo: 0, hi: 0.3, share: 0.08 },
  { lo: 0.3, hi: 0.8, share: 0.42 },
  { lo: 0.8, hi: 1, share: 0.5 },
] as const;
/** Marks as ratios of the track, measured off the original design. */
const DEFAULT_MARKS = [0, 0.3, 0.7, 1];
/** A percent, the way the locale writes it: 28% in en-US, 28 % in de-DE. */
const PERCENT: Intl.NumberFormatOptions = { style: "unit", unit: "percent" };

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

/** Decimal places of a step, so 0.1 steps don't show 0.30000000000000004. */
const decimals = (step: number) => {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};

/** Where a digit column stands for a value, as a continuous digit (4.5 is
 *  halfway from 4 to 5). The ones column turns with the value; every higher
 *  column holds still and turns only while the column below it rolls from 9
 *  over to 0, like an odometer, so at rest each one sits on a whole digit. */
const columnAt = (s: number, place: number) => {
  if (place === 0) return s;
  const unit = 10 ** place;
  return Math.floor(s / unit) + clamp((s % unit) - (unit - 1), 0, 1);
};

/** A spring's last few hundredths of a digit, snapped to the digit, so the
 *  slow tail of the settle never leaves a digit a sub-pixel off the line. */
const settle = (s: number) => {
  const r = Math.round(s);
  return Math.abs(s - r) < 0.05 ? r : s;
};

/** How far into view a leading column is: 0 while it would show a zero,
 *  1 once the value has rolled into it. */
const shownAt = (s: number, place: number) =>
  clamp(s - (10 ** place - 1), 0, 1);

/** Fades a column's top and bottom, so digits roll in and out of view
 *  instead of being cut off at a hard edge. */
const COLUMN_MASK =
  "linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)";
/** 0 to 9 and 0 again, so a roll from 9 over to 0 keeps going down. */
const STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const CELL_STYLE = { height: `${CELL}em`, lineHeight: `${CELL}em` };

/** One digit column of the readout: a strip of digits slid by the trailing
 *  value on transforms only, blurred a little in proportion to its speed. A
 *  leading column (the tens of 7) folds to no width while it would show a
 *  zero and unfolds as the value rolls into it, so the suffix never jumps.
 *  Memoized: its props never change, the value reaches it as motion. */
const Column = React.memo(function Column({
  trail,
  speed,
  place,
  scale,
  leading,
}: {
  trail: MotionValue<number>;
  speed: MotionValue<number>;
  place: number;
  scale: number;
  leading: boolean;
}) {
  const unit = 10 ** place;
  const y = useTransform(
    trail,
    (v) => `${-(columnAt(settle(Math.abs(v) * scale), place) % 10) * CELL}em`,
  );
  const filter = useTransform(speed, (v) => {
    const raw = Math.min((Math.abs(v) * scale * BLUR_GAIN) / unit, MAX_BLUR);
    const b = Math.round(raw * BLUR_STEP) / BLUR_STEP;
    return b === 0 ? "none" : `blur(${b}px)`;
  });
  const shown = useTransform(trail, (v) =>
    leading ? shownAt(Math.abs(v) * scale, place) : 1,
  );
  const width = useTransform(shown, (k) => `${k}ch`);
  return (
    <motion.span
      className="relative inline-block overflow-hidden"
      style={{
        height: `${CELL}em`,
        width,
        opacity: shown,
        maskImage: COLUMN_MASK,
      }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        style={{ y, filter }}
      >
        {STRIP.map((d, i) => (
          <span key={i} className="block text-center" style={CELL_STYLE}>
            {d}
          </span>
        ))}
      </motion.span>
    </motion.span>
  );
});

/** A group separator (the comma of 1,250): folds away with the column to
 *  its left, so 999 never shows as ,999. */
const Separator = React.memo(function Separator({
  trail,
  place,
  scale,
  char,
}: {
  trail: MotionValue<number>;
  place: number;
  scale: number;
  char: string;
}) {
  const shown = useTransform(trail, (v) => shownAt(Math.abs(v) * scale, place));
  const maxWidth = useTransform(shown, (k) => `${k}em`);
  return (
    <motion.span
      className="inline-block overflow-hidden"
      style={{ opacity: shown, maxWidth }}
    >
      {char}
    </motion.span>
  );
});

/** What the readout shows: rolling digit columns with fixed text around
 *  them, or plain text when the format changes the number itself (1.2k). */
type Readout =
  | { roll: false; text: string }
  | {
      roll: true;
      text: string;
      before: string;
      after: string;
      decimal: string;
      group: string;
      /** Integer places a group separator follows (3 in 1,250). */
      seps: Set<number>;
      /** Integer digit columns, from the widest value in range. */
      int: number;
      /** Fraction digit columns. */
      frac: number;
    };

function readoutFor(
  value: number,
  widest: number,
  frac: number,
  format: ((value: number) => string) | undefined,
  nf: Intl.NumberFormat,
): Readout {
  const abs = Math.abs(value).toFixed(frac);
  const [intDigits, fracDigits = ""] = abs.split(".");
  const int = Math.max(String(Math.trunc(widest)).length, 1);
  if (format) {
    const text = format(value);
    const at = text.indexOf(abs);
    if (at < 0) return { roll: false, text };
    return {
      roll: true,
      text,
      before: text.slice(0, at),
      after: text.slice(at + abs.length),
      decimal: ".",
      group: "",
      seps: new Set(),
      int,
      frac,
    };
  }
  const parts = nf.formatToParts(value);
  const text = parts.map((p) => p.value).join("");
  const num = new Set(["integer", "group", "decimal", "fraction"]);
  const of = (type: string) =>
    parts
      .filter((p) => p.type === type)
      .map((p) => p.value)
      .join("");
  // Rolls only when Intl wrote the very digits of the value: not for compact
  // notation (1.2K) or a numbering system with other digits.
  if (of("integer") !== intDigits || of("fraction") !== fracDigits) {
    return { roll: false, text };
  }
  const first = parts.findIndex((p) => num.has(p.type));
  let last = first;
  parts.forEach((p, i) => {
    if (num.has(p.type)) last = i;
  });
  // Where the locale groups digits, read off the widest whole number.
  const template = nf.formatToParts(10 ** int - 1);
  const seps = new Set<number>();
  let count = 0;
  for (let i = template.length - 1; i >= 0; i--) {
    const p = template[i];
    if (p.type === "integer") count += p.value.length;
    else if (p.type === "group" && count > 0) seps.add(count);
  }
  return {
    roll: true,
    text,
    before: parts
      .slice(0, first)
      .map((p) => p.value)
      .join(""),
    after: parts
      .slice(last + 1)
      .map((p) => p.value)
      .join(""),
    decimal: template.find((p) => p.type === "decimal")?.value ??
      parts.find((p) => p.type === "decimal")?.value ??
      ".",
    group: template.find((p) => p.type === "group")?.value ?? ",",
    seps,
    int,
    frac,
  };
}

/** Maps values to positions along the track and back, as 0 to 1. */
export type StardustSliderScale =
  | "linear"
  | "log"
  | {
      toRatio: (value: number, min: number, max: number) => number;
      fromRatio: (ratio: number, min: number, max: number) => number;
    };

function scaleFns(scale: StardustSliderScale, min: number, max: number) {
  if (typeof scale === "object") {
    return {
      to: (v: number) => scale.toRatio(v, min, max),
      from: (r: number) => scale.fromRatio(r, min, max),
    };
  }
  const span = max > min ? max - min : 1;
  // Log needs a positive range; anything else falls back to linear.
  if (scale === "log" && min > 0 && max > min) {
    const lo = Math.log(min);
    const w = Math.log(max) - lo;
    return {
      to: (v: number) => (Math.log(Math.max(v, min)) - lo) / w,
      from: (r: number) => Math.exp(lo + r * w),
    };
  }
  return {
    to: (v: number) => (v - min) / span,
    from: (r: number) => min + r * span,
  };
}

type Mote = {
  /** The stretch of the fill this mote drifts in, as 0 to 1 of its length,
   *  wrapping at the ends, so the dense and sparse zones keep their share
   *  however long it runs and wherever the fill ends. */
  lo: number;
  hi: number;
  /** Where it is in that stretch, 0 to 1 of the fill. */
  u: number;
  /** Shown while the fill covers at least this share of the track, so a
   *  short fill shows fewer motes and the density stays the same. */
  rank: number;
  /** Across the fill, px. */
  c: number;
  vu: number;
  vc: number;
  r: number;
  a: number;
  ph: number;
};

export interface StardustSliderMark {
  value: number;
  /** Text under the mark (beside it, vertical). */
  label?: React.ReactNode;
}

export interface StardustSliderClassNames {
  label?: string;
  value?: string;
  track?: string;
  fill?: string;
  handle?: string;
  mark?: string;
  markLabel?: string;
}

export interface StardustSliderProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue" | "color" | "dir"
> {
  /** Controlled value. */
  value?: number;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Fires with the new value while dragging and on every key press. */
  onValueChange?: (value: number) => void;
  /** Fires once when the handle is let go, on each key press that changes
   *  the value, and when a typed value is committed. */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  /** Arrow key step and the grid values round to. */
  step?: number;
  /** "steps" moves the fill stop to stop; "marks" pulls it onto a mark
   *  when the pointer comes near one, like a detent. */
  snap?: "steps" | "marks" | false;
  /** How values map onto the track: linear, log (min above 0), or your own
   *  toRatio and fromRatio. */
  scale?: StardustSliderScale;
  /** Text above the track, also the slider's accessible name. */
  label?: React.ReactNode;
  /** Values where a faint mark is drawn, as numbers or { value, label }.
   *  Defaults to 0%, 30%, 70% and 100% of the track; pass [] for none. */
  marks?: (number | StardustSliderMark)[];
  /** Turns the value into text for the readout and screen readers. When
   *  set, it wins over locale and formatOptions. */
  format?: (value: number) => string;
  /** Locale for the number, e.g. "de-DE". Defaults to the browser's. */
  locale?: string;
  /** Intl.NumberFormat options, e.g. { style: "currency", currency: "USD" }.
   *  Defaults to a percent. Fraction digits follow step unless set here. */
  formatOptions?: Intl.NumberFormatOptions;
  /** Replaces the rolling number on the right of the header. */
  readout?: React.ReactNode;
  /** Click the number to type an exact value. Enter or leaving the field
   *  commits it, Escape cancels. */
  editable?: boolean;
  /** Fill color, any CSS color. The gradient fades it in from the start. */
  color?: string;
  /** Track thickness: sm 44px, md 54px, lg 64px. The card, text and
   *  handle scale with it. */
  size?: Size;
  /** Vertical fills bottom to top, with the header above the track. */
  orientation?: "horizontal" | "vertical";
  /** Right-to-left fills from the right. Read from the page when unset. */
  dir?: "ltr" | "rtl";
  /** "bare" drops the card and header and renders the track alone. */
  variant?: "card" | "bare";
  disabled?: boolean;
  /** Submitted with a form, like an input. */
  name?: string;
  classNames?: StardustSliderClassNames;
}

export const StardustSlider = React.forwardRef<
  HTMLDivElement,
  StardustSliderProps
>(function StardustSlider(
  {
    value,
    defaultValue = 0,
    onValueChange,
    onValueCommit,
    min = 0,
    max = 100,
    step = 1,
    snap = false,
    scale = "linear",
    label,
    marks,
    format,
    locale,
    formatOptions,
    readout,
    editable = true,
    color = "#365ee9",
    size = "md",
    orientation = "horizontal",
    dir,
    variant = "card",
    disabled = false,
    name,
    classNames,
    className,
    style,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    ...rest
  },
  ref,
) {
  const g = React.useMemo(() => geometry(size), [size]);
  const vertical = orientation === "vertical";
  const hi = Math.max(min, max);
  const inc = step > 0 ? step : 1;
  const places = decimals(inc);
  const span = hi > min ? hi - min : 1;
  const fit = (v: number) =>
    +clamp(min + Math.round((v - min) / inc) * inc, min, hi).toFixed(places);
  const map = React.useMemo(() => scaleFns(scale, min, hi), [scale, min, hi]);

  const [raw, setRaw] = useControllableState({
    value,
    defaultValue,
    onValueChange,
  });
  const current = clamp(raw, min, hi);
  const ratio = clamp(map.to(current), 0, 1);

  const reduced = useReducedMotionPreference();
  const labelId = React.useId();
  const track = React.useRef<HTMLDivElement>(null);
  const fill = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [pressed, setPressed] = React.useState(false);
  // Right-to-left, from the prop or else the page; horizontal only.
  const [pageRtl, setPageRtl] = React.useState(false);
  React.useLayoutEffect(() => {
    if (dir || !track.current) return;
    setPageRtl(getComputedStyle(track.current).direction === "rtl");
  }, [dir]);
  const rtl = !vertical && (dir ? dir === "rtl" : pageRtl);
  /** The pointer that owns the drag, the pointer ratio minus the handle
   *  ratio at grab (so the handle doesn't jump), the track's box read once
   *  per press, and the value at the start and now, for onValueCommit. */
  const drag = React.useRef<{
    id: number;
    offset: number;
    box: DOMRect;
    start: number;
    latest: number;
  } | null>(null);

  const to = React.useCallback(
    (mv: MotionValue<number>, target: number, transition: Transition) => {
      if (reduced) mv.jump(target);
      else animate(mv, target, transition);
    },
    [reduced],
  );

  // The fill's position, 0 to 1, written straight to --p on the fill. Its
  // length, corners and color are all CSS worked out from --p, so nothing
  // re-renders and nothing is measured. The fill itself never changes size:
  // a clip-path shows the first part of it and the handle rides a transform,
  // so a drag repaints but never re-lays out the page.
  const pos = useMotionValue(ratio);
  // The first --p goes in the markup, so the very first frame (server
  // rendered, or before any effect runs) is already the right shape and
  // color. Fixed after that, so a re-render never fights the animation.
  const [firstP] = React.useState(ratio);
  useMotionValueEvent(pos, "change", (p) =>
    fill.current?.style.setProperty("--p", String(p)),
  );
  React.useLayoutEffect(() => {
    // Under the pointer the fill is painted from the pointer itself; a click,
    // a key or a new controlled value glides there.
    if (!drag.current) to(pos, ratio, SPRING_LAYOUT);
  }, [ratio, pos, to]);

  // The handle: dim and slim at rest, firmer and longer while held, and
  // longer along the track and a little thinner the faster it moves.
  const press = useMotionValue(0);
  React.useEffect(() => {
    to(press, pressed ? 1 : 0, pressed ? SPRING_PRESS : SPRING_RETRACT);
  }, [pressed, press, to]);
  const speed = useVelocity(pos);
  const rush = useSpring(
    useTransform(speed, (v) =>
      reduced ? 0 : Math.min(Math.abs(v) / FULL_SPEED, 1),
    ),
    SPRING_MOUSE,
  );
  const handleAlong = useTransform(
    () => g.handleW * (1 + 0.3 * press.get() + 0.9 * rush.get()),
  );
  const handleAcross = useTransform(
    () => g.handleH * (1 + 0.2 * press.get() - 0.17 * rush.get()),
  );
  // The see-through lives in the color, not in opacity: opacity on the
  // handle would fade its backdrop blur along with it, leaving the dust
  // behind it sharp. White on the color, the text color on the empty
  // socket, so it stays visible on a light track too.
  const handleBg = useTransform(
    () =>
      `color-mix(in oklab, color-mix(in oklab, white calc(var(--ramp) * 100%), var(--foreground)) ${25 + 30 * press.get()}%, transparent)`,
  );

  // The readout trails the value on a spring that keeps its speed when the
  // target moves, and its digit columns read it every frame without a render.
  const trail = useSpring(current, SPRING_TRAVEL);
  React.useEffect(() => {
    if (reduced) trail.jump(current);
    else trail.set(current);
  }, [current, trail, reduced]);
  const trailSpeed = useVelocity(trail);

  // Dust: motes on a canvas the size of the fill, clipped with it. Each one
  // dims toward the fill's dark start.
  React.useEffect(() => {
    const el = track.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!el || !cv || !ctx) return;
    let motes: Mote[] = [];
    /** The fill's length and thickness, px. */
    let along = 0;
    let across = 0;
    let frame = 0;
    let lastT = 0;
    let visible = true;
    // The glow, drawn once and stamped: cheaper than a second, softer
    // circle per mote per frame.
    const glow = document.createElement("canvas");
    const gctx = glow.getContext("2d");

    const seed = () => {
      const dpr = window.devicePixelRatio || 1;
      along = (vertical ? el.clientHeight : el.clientWidth) - g.inset * 2;
      across = g.fill;
      const cw = vertical ? across : along;
      const ch = vertical ? along : across;
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
      cv.style.width = `${cw}px`;
      cv.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gctx) {
        const gs = Math.ceil(16 * dpr);
        glow.width = glow.height = gs;
        const grad = gctx.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2);
        grad.addColorStop(0, "rgb(255 255 255 / 0.5)");
        grad.addColorStop(1, "rgb(255 255 255 / 0)");
        gctx.fillStyle = grad;
        gctx.fillRect(0, 0, gs, gs);
      }

      motes = Array.from({ length: Math.round(along * DENSITY) }, () => {
        let pick = Math.random();
        const zone =
          DUST_ZONES.find((z) => (pick -= z.share) < 0) ?? DUST_ZONES[2];
        const { lo, hi } = zone;
        return {
          lo,
          hi,
          u: lo + Math.random() * (hi - lo),
          rank: Math.random(),
          c: Math.random() * across,
          vu: (Math.random() - 0.5) * 2 * DRIFT_DUST.speed,
          vc: (Math.random() - 0.5) * DRIFT_DUST.speed,
          r: 0.5 + Math.random() ** 3 * 1.4,
          a: 0.3 + Math.random() * 0.7,
          ph: Math.random() * Math.PI * 2,
        };
      });
    };

    const draw = (k: number) => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      const p = pos.get();
      // The fill's end in canvas px, the same formula as len.
      const end = clamp(
        p * (along + g.inset * 2 - g.start - g.end) + g.minFill,
        g.minFill,
        along,
      );
      // At min the color layer is fully faded, so the dust can't be seen:
      // keep it drifting, skip the drawing.
      const hidden = p <= 0;
      // One color for the whole frame, with each mote's strength in
      // globalAlpha: no color strings built per mote per frame.
      ctx.fillStyle = "#fff";
      for (const m of motes) {
        const zone = m.hi - m.lo;
        // Drift in px, so motes keep their speed whatever the fill's length.
        m.u = m.lo + ((m.u - m.lo + (m.vu * k) / end + zone) % zone);
        m.c = (m.c + m.vc * k + across) % across;
        m.ph += DRIFT_DUST.twinkle * k * (0.5 + m.a);
        if (hidden || m.rank > end / along) continue;
        const a = m.u * end;
        const x = vertical ? m.c : a;
        const y = vertical ? along - a : m.c;
        const alpha = m.a * (0.6 + 0.4 * Math.sin(m.ph)) * (0.25 + 0.75 * m.u);
        if (m.r > 1 && gctx) {
          ctx.globalAlpha = alpha;
          const s = m.r * 4;
          ctx.drawImage(glow, x - s / 2, y - s / 2, s, s);
        }
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (t: number) => {
      // Frame units at 60fps, capped so a background tab doesn't teleport.
      const k = lastT ? Math.min((t - lastT) / (1000 / 60), 3) : 1;
      lastT = t;
      draw(k);
      frame = visible ? requestAnimationFrame(tick) : 0;
    };

    seed();
    const ro = new ResizeObserver(() => {
      seed();
      if (reduced) draw(0);
    });
    ro.observe(el);
    // Still dust under reduced motion: one frame, redrawn as the fill moves.
    if (reduced) {
      draw(0);
      const off = pos.on("change", () => draw(0));
      return () => {
        off();
        ro.disconnect();
      };
    }
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) {
        lastT = 0;
        frame = requestAnimationFrame(tick);
      }
    });
    io.observe(el);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, [pos, reduced, vertical, g]);

  // Marks, as values with their place on the track.
  const markList = React.useMemo(
    () =>
      (marks
        ? marks.map(
            (m): StardustSliderMark => (typeof m === "number" ? { value: m } : m),
          )
        : DEFAULT_MARKS.map((r): StardustSliderMark => ({ value: fit(map.from(r)) }))
      )
        .map((m) => ({ ...m, r: map.to(m.value) }))
        .filter((m) => m.r >= -1e-9 && m.r <= 1 + 1e-9),
    // fit reads min, hi, inc and places.
    [marks, map, min, hi, inc, places],
  );

  /** Pointer position as a ratio of the handle's travel, unclamped. */
  const ratioAt = (e: React.PointerEvent, box: DOMRect) => {
    const len = (vertical ? box.height : box.width) - g.start - g.end;
    const at = vertical
      ? box.bottom - e.clientY
      : rtl
        ? box.right - e.clientX
        : e.clientX - box.left;
    return len > 0 ? (at - g.start) / len : 0;
  };

  /** The value and fill position for a pointer ratio, with snapping. */
  const pick = (r: number, box: DOMRect) => {
    const at = clamp(r, 0, 1);
    if (snap === "marks") {
      const travel = (vertical ? box.height : box.width) - g.start - g.end;
      let best: (typeof markList)[number] | undefined;
      for (const m of markList) {
        const d = Math.abs(m.r - at) * travel;
        if (d < g.magnet && (!best || d < Math.abs(best.r - at) * travel)) {
          best = m;
        }
      }
      if (best) return { v: fit(best.value), r: best.r, glide: true };
    }
    const v = fit(map.from(at));
    if (snap === "steps") return { v, r: clamp(map.to(v), 0, 1), glide: true };
    return { v, r: at, glide: false };
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPressed(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // On release the fill glides onto the value's step or mark.
    to(pos, clamp(map.to(d.latest), 0, 1), SPRING_LAYOUT);
    if (d.latest !== d.start) onValueCommit?.(d.latest);
  };

  const commit = (v: number) => {
    setRaw(v);
    if (v !== current) onValueCommit?.(v);
  };

  const page = Math.max(inc, span / 10);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Right-to-left, the horizontal arrows follow the fill: left raises.
    // Shift moves ten steps at a time.
    const by = e.shiftKey ? inc * 10 : inc;
    const up = current + by;
    const down = current - by;
    const next = {
      ArrowUp: up,
      ArrowDown: down,
      ArrowRight: rtl ? down : up,
      ArrowLeft: rtl ? up : down,
      PageUp: current + page,
      PageDown: current - page,
      Home: min,
      End: hi,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    commit(fit(next));
  };

  // The readout: the number from format, or from Intl in the locale, rolls
  // when its digits can be told apart from the text around them.
  const optionsKey = JSON.stringify(formatOptions ?? null);
  const nf = React.useMemo(() => {
    const opts = formatOptions ?? PERCENT;
    const fd =
      opts.maximumFractionDigits ?? opts.minimumFractionDigits ?? places;
    return new Intl.NumberFormat(locale, {
      ...opts,
      minimumFractionDigits: fd,
      maximumFractionDigits: fd,
    });
    // optionsKey stands in for formatOptions, which is often a new object.
  }, [locale, optionsKey, places]);
  const frac = format ? places : (nf.resolvedOptions().maximumFractionDigits ?? places);
  const widest = Math.max(Math.abs(min), Math.abs(hi));
  const shown = readoutFor(current, widest, frac, format, nf);
  const text = shown.text;

  const [editing, setEditing] = React.useState<string | null>(null);
  /** Set once an edit ends, so the blur that follows Enter or Escape (focus
   *  going back to the track) doesn't end it a second time. */
  const editDone = React.useRef(false);
  /** The value when the field opened: Escape returns to it, and a commit
   *  is reported only when the value ends up different from it. */
  const editStart = React.useRef(current);
  const parseDraft = (draft: string) =>
    parseFloat(draft.replace(/[^\d.,-]/g, "").replace(",", "."));
  const startEdit = () => {
    editDone.current = false;
    editStart.current = current;
    setEditing(current.toFixed(places));
  };
  const finishEdit = (keep: boolean) => {
    if (editing === null || editDone.current) return;
    editDone.current = true;
    setEditing(null);
    const n = parseDraft(editing);
    const v = keep && Number.isFinite(n) ? fit(n) : editStart.current;
    setRaw(v);
    if (v !== editStart.current) onValueCommit?.(v);
  };
  /** Arrow Up and Down in the field step the number, ten steps with Shift,
   *  and the fill follows as it changes. */
  const stepDraft = (dir: 1 | -1, shift: boolean) => {
    if (editing === null) return;
    const n = parseDraft(editing);
    const v = fit((Number.isFinite(n) ? n : current) + dir * (shift ? inc * 10 : inc));
    setEditing(v.toFixed(places));
    setRaw(v);
  };

  const scaleCols = 10 ** (shown.roll ? shown.frac : 0);
  const number = shown.roll ? (
    <>
      {shown.before}
      {/* Highest place first; the decimal mark sits before the fraction
          columns, group separators after their integer place. */}
      {Array.from({ length: shown.int + shown.frac }, (_, i) => {
        const place = shown.int + shown.frac - 1 - i;
        const intPlace = place - shown.frac;
        return (
          <React.Fragment key={place}>
            {shown.frac > 0 && place === shown.frac - 1 && shown.decimal}
            <Column
              trail={trail}
              speed={trailSpeed}
              place={place}
              scale={scaleCols}
              leading={place > shown.frac}
            />
            {intPlace > 0 && shown.seps.has(intPlace) && (
              <Separator
                trail={trail}
                place={place}
                scale={scaleCols}
                char={shown.group}
              />
            )}
          </React.Fragment>
        );
      })}
      {shown.after}
    </>
  ) : (
    text
  );

  const valueClass = cn(
    // Numbers read left to right in every layout.
    "flex shrink-0 items-center justify-end whitespace-pre tabular-nums",
    classNames?.value,
  );
  // Editing happens in place: the digits give way to a borderless field
  // exactly as wide as what is typed, in the same font and line, between the
  // same text (a %, a currency sign), so nothing moves when it opens.
  const field =
    editing !== null ? (
      <span dir="ltr" className={valueClass}>
        {shown.roll && shown.before}
        <input
          autoFocus
          aria-label="Type a value"
          inputMode="decimal"
          value={editing}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              stepDraft(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
            } else if (e.key === "Enter") {
              finishEdit(true);
              track.current?.focus();
            } else if (e.key === "Escape") {
              finishEdit(false);
              track.current?.focus();
            }
          }}
          onBlur={() => finishEdit(true)}
          className="m-0 appearance-none border-0 bg-transparent p-0 text-right text-inherit caret-current outline-none [font:inherit]"
          // Inline, so a page's global :focus-visible outline can't win.
          style={{
            outline: "none",
            width: `${Math.max(editing.length, 1)}ch`,
            height: `${CELL}em`,
            lineHeight: `${CELL}em`,
          }}
        />
        {shown.roll && shown.after}
      </span>
    ) : null;

  const header =
    variant === "card" ? (
      <div
        className={cn(
          "flex items-center",
          // Vertical cards are narrow: the label sits small above the
          // number, both centred over the track.
          vertical
            ? "flex-col justify-center gap-0.5 text-center"
            : "justify-between gap-4",
        )}
        style={{
          height: vertical ? undefined : `${CELL}em`,
          marginBottom: vertical ? "1em" : "0.75em",
        }}
      >
        <span
          id={labelId}
          className={cn(
            "truncate font-medium text-muted-foreground",
            vertical && "max-w-full text-[0.8em]",
            classNames?.label,
          )}
        >
          {label}
        </span>
        {readout !== undefined ? (
          <span className={valueClass}>{readout}</span>
        ) : field ? (
          field
        ) : editable && !disabled ? (
          <button
            type="button"
            dir="ltr"
            aria-label={`Type a value, now ${text}`}
            onClick={startEdit}
            className={cn(valueClass, "cursor-text")}
            style={{ outline: "none" }}
          >
            <span aria-hidden className="contents">
              {number}
            </span>
          </button>
        ) : (
          <span aria-hidden dir="ltr" className={valueClass}>
            {number}
          </span>
        )}
      </div>
    ) : null;

  // Fill shape: the start follows the track's round end; the end keeps a
  // tight corner and rounds out over the last stretch to max. Corners go
  // top-left, top-right, bottom-right, bottom-left.
  const R = `${g.fill / 2}px`;
  const corners = vertical
    ? `var(--edge) var(--edge) ${R} ${R}`
    : `${R} var(--edge) var(--edge) ${R}`;
  // The fill's visible length, as a share of the fill's own length (100%):
  // minFill at min, the whole fill at max. Every place that reads it is
  // sized to the fill, so its % always means the same length.
  const len = `clamp(${g.minFill}px, calc(var(--p) * (100% + ${g.inset * 2 - g.start - g.end}px) + ${g.minFill}px), 100%)`;
  const clip = vertical
    ? `inset(calc(100% - ${len}) 0 0 0 round ${corners})`
    : `inset(0 calc(100% - ${len}) 0 0 round ${corners})`;
  const along = (r: number) =>
    `calc(${g.start}px + ${r} * (100% - ${g.start + g.end}px))`;
  const hasLabels = markList.some((m) => m.label !== undefined);

  const trackEl = (
    <div
      ref={track}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-labelledby={
        ariaLabel
          ? undefined
          : (ariaLabelledBy ??
            (label && variant === "card" ? labelId : undefined))
      }
      aria-valuemin={min}
      aria-valuemax={hi}
      aria-valuenow={current}
      aria-valuetext={text}
      aria-orientation={orientation}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        // One pointer at a time: a second finger doesn't take over the drag.
        if (e.button !== 0 || disabled || drag.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        // focusVisible: false, or Chrome rings a script focus like a Tab.
        e.currentTarget.focus({ preventScroll: true, focusVisible: false });
        const box = e.currentTarget.getBoundingClientRect();
        const r = ratioAt(e, box);
        const travel = (vertical ? box.height : box.width) - g.start - g.end;
        // Grabbed near the handle, it keeps its offset; anywhere else the
        // fill glides to the pointer.
        const near = Math.abs(r - ratio) * travel < 18;
        const hit = pick(r, box);
        drag.current = {
          id: e.pointerId,
          offset: near ? r - ratio : 0,
          box,
          start: current,
          latest: near ? current : hit.v,
        };
        setPressed(true);
        if (!near) {
          to(pos, hit.r, SPRING_LAYOUT);
          setRaw(hit.v);
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const hit = pick(ratioAt(e, d.box) - d.offset, d.box);
        // Free, the fill chases the pointer on a follow spring; snapped, it
        // glides from stop to stop.
        to(pos, hit.r, hit.glide ? SPRING_LAYOUT : SPRING_MOUSE);
        d.latest = hit.v;
        setRaw(hit.v);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        [vertical ? "width" : "height"]: g.track,
        boxShadow: TRACK_SHADOW,
        background:
          "color-mix(in oklab, var(--foreground) 9%, var(--background))",
      }}
      className={cn(
        "relative shrink-0 touch-none overflow-hidden rounded-full outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        vertical && LENGTH[size],
        pressed ? "cursor-grabbing" : "cursor-grab",
        classNames?.track,
      )}
    >
      {/* Mirrored right-to-left: the fill, its dust, the handle and the
          marks all run from the right with no geometry of their own. */}
      <div
        className="absolute inset-0"
        style={{ scale: rtl ? "-1 1" : undefined }}
      >
        <div
          ref={fill}
          aria-hidden
          className={cn("absolute", classNames?.fill)}
          style={{
            inset: g.inset,
            clipPath: clip,
            ["--p" as string]: firstP,
            ["--edge" as string]: `calc(${g.edge}px + clamp(0, (var(--p) - ${ROUND_FROM}) / ${1 - ROUND_FROM}, 1) * ${g.fill / 2 - g.edge}px)`,
            ["--ramp" as string]: `clamp(0, var(--p) / ${COLOR_IN}, 1)`,
            background:
              "color-mix(in oklab, var(--foreground) 8%, transparent)",
          }}
        >
          <div
            className="absolute inset-0 bg-no-repeat"
            style={{
              opacity: "var(--ramp)",
              // Sized to the visible length, so the gradient compresses with
              // the fill and its end is always the brightest point.
              backgroundSize: vertical ? `100% ${len}` : `${len} 100%`,
              backgroundPosition: vertical ? "bottom" : "left",
              backgroundImage: `linear-gradient(to ${vertical ? "top" : "right"}, transparent, color-mix(in oklab, var(--stardust) 45%, transparent) 45%, var(--stardust))`,
            }}
          >
            <canvas ref={canvas} className="absolute top-0 left-0" />
          </div>
          {/* A fill-sized layer slid so its far edge sits on the fill's end:
              its translate % is the fill's own length, the same base as
              len, so the handle moves on transforms only. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              translate: vertical
                ? `0 calc(100% - ${len})`
                : `calc(${len} - 100%) 0`,
            }}
          >
            <motion.span
              className={cn(
                "absolute rounded-full backdrop-blur-xs",
                vertical ? "left-1/2 -translate-x-1/2" : "top-1/2 -translate-y-1/2",
                classNames?.handle,
              )}
              style={{
                // Its far edge g.gap inside the fill's end.
                [vertical ? "top" : "right"]: g.gap,
                width: vertical ? handleAcross : handleAlong,
                height: vertical ? handleAlong : handleAcross,
                backgroundColor: handleBg,
              }}
            />
          </div>
        </div>
        {markList.map((m) => (
          <span
            key={m.value}
            aria-hidden
            className={cn(
              // A hairline that fades out at both ends, like the fade-divide
              // separators: var(--border) in the middle, clear at the tips.
              "pointer-events-none absolute from-transparent via-border to-transparent",
              vertical
                ? "left-1/2 h-px -translate-x-1/2 translate-y-1/2 bg-linear-to-r"
                : "top-1/2 w-px -translate-1/2 bg-linear-to-b",
              classNames?.mark,
            )}
            style={
              vertical
                ? { width: g.mark, bottom: along(m.r) }
                : { height: g.mark, left: along(m.r) }
            }
          />
        ))}
      </div>
    </div>
  );

  // Mark labels sit under a horizontal track and beside a vertical one,
  // outside the mirror so their text still reads the right way round.
  /** The widest label, in ch of the labels' own text. */
  const labelCh = Math.max(
    0,
    ...markList.map((m) =>
      m.label === undefined ? 0 : typeof m.label === "string" ? m.label.length : 4,
    ),
  );
  const labelEls = hasLabels ? (
    <div
      aria-hidden
      className={cn(
        "text-[0.75em] text-muted-foreground",
        // Vertical, the labels hang beside the track without taking part in
        // centring it.
        vertical ? "absolute inset-y-0" : "relative mt-2",
      )}
      style={
        vertical
          ? { left: `calc(50% + ${g.track / 2}px + 0.5rem)`, width: `${labelCh}ch` }
          : { height: "1.25em" }
      }
    >
      {markList.map(
        (m) =>
          m.label !== undefined && (
            <span
              key={m.value}
              className={cn(
                "absolute whitespace-nowrap leading-none",
                vertical ? "left-0 translate-y-1/2" : "top-0",
                !vertical && (rtl ? "translate-x-1/2" : "-translate-x-1/2"),
                classNames?.markLabel,
              )}
              style={
                vertical
                  ? { bottom: along(m.r) }
                  : rtl
                    ? { right: along(m.r) }
                    : { left: along(m.r) }
              }
            >
              {m.label}
            </span>
          ),
      )}
    </div>
  ) : null;

  // Vertical, the track is centred under the header, with room kept on
  // both sides for the labels so the card stays balanced.
  const body = vertical ? (
    <div
      className="relative flex justify-center"
      style={
        hasLabels
          ? { paddingInline: `calc(${labelCh * 0.75}ch + 0.5rem)` }
          : undefined
      }
    >
      {trackEl}
      {labelEls}
    </div>
  ) : (
    <>
      {trackEl}
      {labelEls}
    </>
  );

  return (
    <div
      {...rest}
      ref={ref}
      dir={dir}
      style={{ "--stardust": color, ...style } as React.CSSProperties}
      className={cn(
        "max-w-full select-none",
        variant === "card"
          ? cn(
              "rounded-2xl bg-card text-card-foreground",
              CARD[size],
              vertical && "inline-block w-auto",
            )
          : vertical
            ? "inline-block"
            : BARE[size],
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {header}
      {body}
      {name !== undefined && (
        <input type="hidden" name={name} value={current} disabled={disabled} />
      )}
    </div>
  );
});

StardustSlider.displayName = "StardustSlider";
