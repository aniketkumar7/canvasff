import { Check } from "lucide-react";
import { cn } from "cn";

/** The openings you can pick, each with a short looping preview from public/styles/<id>.mp4.
 *  Keep ids in sync with OPTIONS in make_short.py and STYLE in backend/app.py.
 *  Everything else (colour look, font, cuts, hook text) is mixed automatically per Short. */
export const LOOKS = [
  { id: "assemble", label: "Assemble", note: "Pieces fly together on the beat", photos: true },
  { id: "silhouette", label: "Silhouette", note: "Glowing outline, colour on the drop", photos: true },
  { id: "sketch", label: "Sketch", note: "Chalk lines draw the car on the beat", photos: true },
  { id: "zoom", label: "Zoom out", note: "Starts on one detail, pulls back" },
  { id: "glass", label: "Frosted glass", note: "Cracks, then shatters on the drop" },
  { id: "pixel", label: "Pixelated", note: "Blocks clear up beat by beat" },
  { id: "spotlight", label: "Spotlight", note: "A light wanders in the dark" },
  { id: "tiles", label: "Tiles", note: "Covers flip away on each beat" },
] as const;

export type LookId = (typeof LOOKS)[number]["id"];
/** What the form sends: just the chosen opening; the server picks the rest. */
export type StyleChoice = { mechanic: LookId };
export const DEFAULT_STYLE: StyleChoice = { mechanic: "assemble" };
export const styleForForm = (s: StyleChoice): StyleChoice => s;
export const lookLabel = (id: LookId) => LOOKS.find((l) => l.id === id)?.label ?? id;

export function StylePicker({ value, onChange }: { value: StyleChoice; onChange: (s: StyleChoice) => void }) {
  return (
    <>
    <div role="radiogroup" aria-label="Opening style" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {LOOKS.map((l) => {
        const on = value.mechanic === l.id;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange({ mechanic: l.id })}
            className="group text-left"
          >
            <span
              className={cn(
                "relative block aspect-[9/16] overflow-hidden rounded-xl bg-card ring-2 transition-[box-shadow,transform] duration-200",
                on ? "ring-accent" : "ring-transparent group-hover:ring-white/20",
              )}
            >
              {/* GIF-style loop: muted, inline, no controls; only metadata loads until it scrolls into view */}
              <video
                src={`/styles/${l.id}.mp4`}
                poster={`/styles/${l.id}.jpg`}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-hidden
                className="h-full w-full object-cover"
              />
              {on && (
                <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-accent text-accent-foreground">
                  <Check className="size-3.5" />
                </span>
              )}
            </span>
            <span className="mt-2 block text-[14px] font-medium">{l.label}</span>
            <span className="block text-[12px] leading-snug text-muted-foreground">
              {l.note}
              {"photos" in l && l.photos ? " · photos only" : ""}
            </span>
          </button>
        );
      })}
    </div>
    {/* the previews are made from a CC BY-SA photo, which requires this credit */}
    <p className="mt-4 text-[11px] text-muted-foreground">Previews: photo by Alexander-93, CC BY-SA 4.0, via Wikimedia Commons</p>
    </>
  );
}
