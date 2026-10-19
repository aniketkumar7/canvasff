import * as React from "react";
import { Dices } from "lucide-react";
import { cn } from "cn";
import { Segmented } from "./Form";

/** Every style option the renderer knows (keep in sync with OPTIONS in make_short.py and STYLE in backend/app.py). */
export const STYLE_OPTIONS = {
  mechanic: { label: "Hide the car", options: { zoom: "Zoom out", glass: "Frosted glass", pixel: "Pixelated", spotlight: "Spotlight", tiles: "Tiles" } },
  reveal: { label: "Answer reveal", options: { slam: "Slam", scramble: "Decode", stamp: "Stamp", split: "Split" } },
  dropFx: { label: "Drop hit", options: { flash: "Flash", zoomThrough: "Zoom through", glitch: "Glitch", whip: "Whip pan", shatter: "Shatter (glass)" } },
  cut: { label: "Beat cuts", options: { punch: "Punch", whip: "Whip", spin: "Spin", zoom: "Zoom", flash: "Flash" } },
  look: { label: "Look", options: { clean: "Clean", neon: "Neon", tealOrange: "Teal & orange", film: "Film", night: "Night", mono2color: "B&W → colour" } },
  hook: { label: "Hook text", options: { pop: "Pop", words: "Word by word", type: "Typewriter", glitch: "Glitch", marker: "Marker" } },
  font: { label: "Font", options: { montserrat: "Montserrat", anton: "Anton", bebas: "Bebas" } },
  accent: { label: "Colour", options: { "#FFD400": "Yellow", "#00E5FF": "Cyan", "#FF2D55": "Red", "#B6FF00": "Lime", "#FF7A00": "Orange" } },
  ramp: { label: "Speed ramps", options: { on: "On", off: "Off" } },
  bars: { label: "Cinematic bars", options: { on: "On", off: "Off" } },
  choices: { label: "A/B/C choices", options: { on: "On", off: "Off" } },
} as const;

export type StyleKey = keyof typeof STYLE_OPTIONS;
/** "random" (or a missing key) leaves that part to the renderer's no-repeat picker. */
export type StyleChoice = Partial<Record<StyleKey, string>>;

const KEYS = Object.keys(STYLE_OPTIONS) as StyleKey[];

/** Only the parts that were actually chosen, for the form. */
export const styleForForm = (s: StyleChoice): StyleChoice =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v && v !== "random"));

export function StylePicker({ value, onChange }: { value: StyleChoice; onChange: (s: StyleChoice) => void }) {
  const [mode, setMode] = React.useState<"random" | "custom">(Object.keys(styleForForm(value)).length ? "custom" : "random");

  const setMode2 = (m: "random" | "custom") => {
    setMode(m);
    if (m === "random") onChange({});
  };
  const shuffle = () =>
    onChange(
      Object.fromEntries(
        KEYS.map((k) => {
          const opts = Object.keys(STYLE_OPTIONS[k].options);
          return [k, opts[Math.floor(Math.random() * opts.length)]];
        }),
      ),
    );

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Segmented
            id="style-mode"
            value={mode}
            onChange={setMode2}
            options={[
              { value: "random", label: "Surprise me" },
              { value: "custom", label: "Pick it" },
            ]}
          />
        </div>
        {mode === "custom" && (
          <button
            type="button"
            onClick={shuffle}
            title="Shuffle every option"
            className="grid w-12 place-items-center rounded-2xl border border-border bg-muted/60 text-muted-foreground transition hover:text-foreground"
          >
            <Dices className="size-5" />
          </button>
        )}
      </div>

      {mode === "random" ? (
        <p className="mt-3 text-[13px] text-muted-foreground">A fresh mix every Short. The hiding effect, reveal and look never repeat your last 3.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {KEYS.map((k) => {
            const { label, options } = STYLE_OPTIONS[k];
            const cur = value[k] ?? "random";
            const disabled = k === "dropFx" && value.mechanic && value.mechanic !== "glass" ? "shatter" : null;
            return (
              <div key={k}>
                <span className="mb-1.5 block text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">{label}</span>
                <div className="flex flex-wrap gap-1.5">
                  {[["random", "Random"] as const, ...Object.entries(options)].map(([v, text]) => (
                    <button
                      key={v}
                      type="button"
                      disabled={v === disabled}
                      aria-pressed={cur === v}
                      onClick={() => onChange({ ...value, [k]: v })}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors disabled:opacity-30",
                        cur === v ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {k === "accent" && v !== "random" && <span className="size-3 rounded-full ring-1 ring-black/30" style={{ background: v }} />}
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
