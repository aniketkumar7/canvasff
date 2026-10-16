import { motion } from "motion/react";
import { AudioWaveform, Check, History, ShieldCheck, Timer, Zap } from "lucide-react";
import { cn } from "cn";
import { SPRING_SWAP } from "devignerui/motion";

const YT_PATH =
  "M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.8 15.1V8.9l5.4 3.1z";

export type Step = { label: string; done: boolean };

/** Sticky frosted bar: brand, form progress, recent Shorts, channel. */
export function TopBar({ steps, recentCount, onRecent }: { steps: Step[]; recentCount: number; onRecent: () => void }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[10px] bg-accent text-accent-foreground shadow-[0_0_24px_rgb(255_214_10/0.35)]">
            <svg viewBox="0 0 24 24" className="size-3.5 translate-x-px fill-current" aria-hidden>
              <path d="M7 4.5v15l12-7.5z" />
            </svg>
          </span>
          <span className="text-[15px] font-black tracking-tight">
            Canvas<span className="text-accent">FF</span>
            <span className="ml-1.5 rounded-md bg-white/[0.07] px-1.5 py-0.5 align-[2px] text-[10px] font-extrabold tracking-wider text-muted-foreground uppercase">
              Studio
            </span>
          </span>
        </a>

        {/* form progress */}
        <ol className="mx-auto hidden items-center gap-2 md:flex" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              {i > 0 && <span className={cn("h-px w-6 transition-colors", steps[i - 1].done ? "bg-accent/60" : "bg-white/10")} />}
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs font-bold transition-colors",
                  s.done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[10px] font-black transition-colors",
                    s.done ? "bg-accent text-accent-foreground" : "bg-white/[0.07]",
                  )}
                >
                  {s.done ? <Check className="size-3" strokeWidth={3.5} /> : i + 1}
                </span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          {recentCount > 0 && (
            <button
              type="button"
              onClick={onRecent}
              className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
            >
              <History className="size-4" />
              <span className="max-sm:hidden">Recent</span>
              <span className="grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-4 font-black text-accent-foreground">
                {recentCount}
              </span>
            </button>
          )}
          <a
            href="https://www.youtube.com/@CanvasFFyt/shorts"
            target="_blank"
            rel="noreferrer"
            aria-label="CanvasFF on YouTube"
            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition hover:border-white/20 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="size-4 fill-[#ff3b30]" aria-hidden>
              <path d={YT_PATH} />
            </svg>
            <span className="max-sm:hidden">@CanvasFFyt</span>
          </a>
        </div>
      </div>
      {/* phone: progress as a thin segmented bar under the header */}
      <div className="flex gap-1 px-4 pb-2 md:hidden" aria-hidden>
        {steps.map((s) => (
          <span key={s.label} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <motion.span
              className="block h-full rounded-full bg-accent"
              initial={false}
              animate={{ width: s.done ? "100%" : "0%" }}
              transition={SPRING_SWAP}
            />
          </span>
        ))}
      </div>
      <span className="sr-only">{`${done} of ${steps.length} steps done`}</span>
    </div>
  );
}

const CHIPS = [
  { icon: AudioWaveform, label: "Beat-synced cuts" },
  { icon: Zap, label: "Answer on the drop" },
  { icon: ShieldCheck, label: "Claim-safe music" },
  { icon: Timer, label: "~3 min render" },
];

export function Hero() {
  return (
    <section className="mb-7">
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.07] px-3 py-1 text-[11px] font-extrabold tracking-wide text-accent"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
        </span>
        GUESS-THE-CAR SHORTS
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="text-[clamp(32px,6vw,52px)] leading-[1.02] font-black tracking-[-0.035em] text-balance"
      >
        Drop the footage.
        <br />
        <span className="bg-gradient-to-r from-white/45 to-white/25 bg-clip-text text-transparent">We cut it to the </span>
        <span className="relative isolate text-accent">
          beat.
          <span aria-hidden className="absolute -inset-x-1 bottom-1 -z-10 h-3 rounded-full bg-accent/20 blur-md" />
        </span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground"
      >
        Add clips or photos, pick a safe phonk track, and get a 1080×1920 Short that reveals the answer right on the drop.
      </motion.p>
      <motion.ul
        initial="hide"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } }}
        className="mt-5 flex flex-wrap gap-2"
      >
        {CHIPS.map(({ icon: Icon, label }) => (
          <motion.li
            key={label}
            variants={{ hide: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs font-bold text-foreground/85"
          >
            <Icon className="size-3.5 text-accent" />
            {label}
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
