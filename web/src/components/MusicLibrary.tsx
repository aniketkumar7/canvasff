import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Pause, Play, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { getGenres, getMusic, searchMusic, type NcsGenre, type NcsGenreOption, type NcsTrack } from "../lib/api";
import { SongPlayer } from "./Form";

/** Preview starts this far in, past most intros, so you hear the beat. */
const PREVIEW_FROM = 30;
/** Typing this many letters searches the whole NCS catalogue instead of filtering the genre list. */
const SEARCH_FROM = 3;
const FALLBACK_GENRES: NcsGenreOption[] = [
  { id: "phonk", label: "Phonk" },
  { id: "brazilian", label: "Brazilian Phonk" },
];

/** Picker over NoCopyrightSounds: browse genres or search everything, preview, pick. The server
 *  fetches the picked track itself and adds its required credit. */
export function MusicLibrary({ value, onChange }: { value: NcsTrack | null; onChange: (t: NcsTrack | null) => void }) {
  const [genres, setGenres] = React.useState<NcsGenreOption[]>(FALLBACK_GENRES);
  const [genre, setGenre] = React.useState<NcsGenre>("phonk");
  /** per genre/search: tracks loaded so far, next page number, whether more exist, a request in flight */
  const [lists, setLists] = React.useState<Record<string, { items: NcsTrack[]; next: number; more: boolean; loading: boolean }>>({});
  const sentinel = React.useRef<HTMLLIElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    getGenres().then(setGenres).catch(() => {}); // keep the two built-in genres if this fails
  }, []);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const searching = debounced.length >= SEARCH_FROM;
  const key = searching ? `q:${debounced.toLowerCase()}` : `g:${genre}`;
  const cur = lists[key];
  // load the next 10 for the current genre/search (first page on open, then whenever the list end scrolls into view)
  const loadMore = React.useCallback(() => {
    const s = lists[key];
    if (s && (s.loading || !s.more)) return;
    const page = s?.next ?? 0;
    setError(null);
    setLists((all) => ({ ...all, [key]: { items: s?.items ?? [], next: page, more: true, loading: true } }));
    (searching ? searchMusic(debounced, page) : getMusic(genre, page))
      .then((r) =>
        setLists((all) => {
          const prev = all[key]?.items ?? [];
          const seen = new Set(prev.map((t) => t.id));
          return { ...all, [key]: { items: [...prev, ...r.items.filter((t) => !seen.has(t.id))], next: page + 1, more: r.more, loading: false } };
        }),
      )
      .catch((e: Error) => {
        setError(e.message);
        setLists((all) => ({ ...all, [key]: { ...(all[key] ?? { items: [], next: page, more: true }), loading: false } }));
      });
  }, [lists, key, searching, debounced, genre]);

  React.useEffect(() => {
    if (!lists[key]) loadMore();
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- first page per genre/search only

  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

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

  const list = cur && (cur.items.length || !cur.loading) ? cur.items : undefined;
  const q = query.trim().toLowerCase();
  // short queries filter the loaded genre right away; longer ones show the catalogue-wide search results
  const shown = searching ? list : list?.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q));

  return (
    <div>
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all NCS songs (title or artist)"
          className="w-full rounded-2xl border border-border bg-background/60 py-2.5 pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
        />
      </label>
      {!searching && (
        <div className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {genres.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={genre === g.id}
              onClick={() => setGenre(g.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                genre === g.id ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 max-h-[340px] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background/40 p-1.5 [scrollbar-color:var(--border)_transparent]">
        {error ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => (cur ? loadMore() : setAttempt((n) => n + 1))}
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
            {/* reaching this loads the next 10 */}
            {cur?.more && (
              <li ref={sentinel} className="flex items-center justify-center gap-2 py-3 text-xs font-semibold text-muted-foreground">
                {cur.loading && <RefreshCw className="size-3.5 animate-spin" />}
                {cur.loading ? "Loading more…" : "Scroll for more"}
              </li>
            )}
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
