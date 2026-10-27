import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadBebas } from "@remotion/google-fonts/BebasNeue";

/** How the car is hidden while viewers guess. */
export const MECHANICS = ["zoom", "glass", "pixel", "spotlight", "tiles", "silhouette", "assemble", "sketch"] as const;
/** How the answer text lands on the drop. */
export const REVEALS = ["slam", "scramble", "stamp", "split"] as const;
/** The hit on the drop itself. "shatter" only pairs with the glass mechanic. */
export const DROP_FX = ["flash", "zoomThrough", "glitch", "whip"] as const;
/** Transition on every beat cut after the drop. */
export const CUTS = ["punch", "whip", "spin", "zoom", "flash"] as const;
/** Colour look (baked in by ffmpeg in make_short.py) + overlays here. */
export const LOOKS = ["clean", "neon", "tealOrange", "film", "night", "mono2color"] as const;
export const HOOKS = ["pop", "words", "type", "glitch", "marker"] as const;
export const FONTS = ["inter", "montserrat", "anton", "bebas"] as const;
export const ACCENTS = ["#FFD400", "#00E5FF", "#FF2D55", "#B6FF00", "#FF7A00"] as const;

export type Style = {
  mechanic: (typeof MECHANICS)[number];
  reveal: (typeof REVEALS)[number];
  dropFx: (typeof DROP_FX)[number] | "shatter";
  cut: (typeof CUTS)[number];
  look: (typeof LOOKS)[number];
  hook: (typeof HOOKS)[number];
  font: (typeof FONTS)[number];
  accent: string;
  /** fast/slow speed ramps on the post-drop cuts */
  ramp: boolean;
  /** cinematic black bars */
  bars: boolean;
};

export const DEFAULT_STYLE: Style = {
  mechanic: "zoom",
  reveal: "slam",
  dropFx: "flash",
  cut: "punch",
  look: "clean",
  hook: "pop",
  font: "inter",
  accent: "#FFD400",
  ramp: false,
  bars: false,
};

const FAMILY = {
  inter: loadInter("normal", { weights: ["600", "800"] }).fontFamily,
  montserrat: loadMontserrat("normal", { weights: ["900"] }).fontFamily,
  anton: loadAnton().fontFamily,
  bebas: loadBebas().fontFamily,
};
/** Rough average glyph width / font size, to fit long answers on one line. */
const WIDTH = { inter: 0.62, montserrat: 0.74, anton: 0.5, bebas: 0.46 };

export const fontOf = (s: Style): string => FAMILY[s.font];
export const fitSize = (s: Style, text: string, max: number): number =>
  Math.min(max, Math.floor(980 / (WIDTH[s.font] * Math.max(text.length, 1))));
