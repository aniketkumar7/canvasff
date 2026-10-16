import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pause, Play, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { getMusic, type NcsGenre, type NcsTrack } from "../lib/api";
import { Segmented, SongPlayer } from "./Form";

/** Preview starts this far in, past most intros, so you hear the beat. */
const PREVIEW_FROM = 30;

/** Picker over NoCopyrightSounds phonk: browse, preview, pick. The server
 *  fetches the picked track itself and adds its required credit. */
export function MusicLibrary({ value, onChange }: { value: NcsTrack | null; onChange: (t: NcsTrack | null) => void }) {
  const [genre, setGenre] = React.useState<NcsGenre>("phonk");
  const [lists, setLists] = React.useState<Partial<Record<NcsGenre, NcsTrack[]>>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (lists[genre]) return;
    let alive = true;
    setError(null);
    getMusic(genre)
      .then((l) => alive && setLists((s) => ({ ...s, [genre]: l })))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [genre, attempt, lists]);

  // one shared preview player; stop it when leaving
  React.useEffect(() => () => audio.current?.pause(), []);
  const preview = (t: NcsTrack) => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPreviewing(null);
    }
    const a = audio.current;
    if (previewing === t.id) {
      a.pause();
      setPreviewing(null);
      return;
    }
    a.src = t.url;
    a.onloadedmetadata = () => {
      if (a.duration > PREVIEW_FROM * 2) a.currentTime = PREVIEW_FROM;
    };
    a.play().catch(() => setPreviewing(null));
    setPreviewing(t.id);
  };
  const pick = (t: NcsTrack) => {
    audio.current?.pause();
    setPreviewing(null);
    onChange(t);
  };

  if (value)
    return (
      <SongPlayer
        src={value.url}
        title={value.title}
        subtitle={value.artist}
        badge="NCS · SAFE"
        onRemove={() => onChange(null)}
      />
    );

  const list = lists[genre];
  const q = query.trim().toLowerCase();
  const shown = list?.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q));

  return (
    <div>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="sm:w-[260px]">
          <Segmented
            id="genre"
            value={genre}
            onChange={setGenre}
            options={[
              { value: "phonk", label: "Phonk" },
              { value: "brazilian", label: "Brazilian" },
            ]}
          />
        </div>
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or artist"
            className="h-full w-full rounded-2xl border border-border bg-background/60 py-2.5 pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
          />
        </label>
      </div>

      <div className="mt-3 max-h-[340px] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background/40 p-1.5 [scrollbar-color:var(--border)_transparent]">
        {error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-bold hover:bg-white/10"
            >
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        ) : !shown ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <div className="size-11 animate-pulse rounded-lg bg-white/[0.06]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-2/5 animate-pulse rounded bg-white/[0.06]" />
                <div className="h-2.5 w-1/4 animate-pulse rounded bg-white/[0.04]" />
              </div>
            </div>
          ))
        ) : shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tracks match "{query}"</p>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {shown.map((t) => {
                const on = previewing === t.id;
                return (
                  <motion.li key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className={cn("group flex items-center gap-3 rounded-xl p-1.5 pr-2 transition", on ? "bg-accent/[0.08]" : "hover:bg-white/[0.04]")}>
                      <button
                        type="button"
                        onClick={() => preview(t)}
                        aria-label={on ? `Stop ${t.title}` : `Preview ${t.title}`}
                        className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-muted"
                      >
                        {t.cover && <img src={t.cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        <span
                          className={cn(
                            "absolute inset-0 grid place-items-center bg-black/50 text-white transition",
                            on ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          {on ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
                        </span>
                      </button>
                      <button type="button" onClick={() => pick(t)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-bold">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{t.artist}</p>
                      </button>
                      {on && (
                        <span aria-hidden className="flex h-4 items-end gap-[3px]">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="w-[3px] rounded-full bg-accent"
                              animate={{ height: ["30%", "100%", "45%", "80%", "30%"] }}
                              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                            />
                          ))}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => pick(t)}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-extrabold transition hover:bg-accent hover:text-accent-foreground"
                      >
                        <Check className="size-3.5" /> Use
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <p className="mt-2.5 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-ok" />
        NoCopyrightSounds: free for Shorts as long as the credit is in the description. It's added for you.
      </p>
    </div>
  );
}
