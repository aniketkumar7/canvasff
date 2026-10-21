import * as React from "react";
import { Check, ExternalLink, RefreshCw, Search } from "lucide-react";
import { cn } from "cn";
import { getPhotoSources, searchPhotos, type Photo, type PhotoSource } from "../lib/api";

const FALLBACK: PhotoSource[] = [{ id: "wikimedia", label: "Wikimedia" }];
const MAX = 5;

/** Search free photos across sources, 10 at a time (more load on scroll); tap to pick up to 5. */
export function PhotoSearch({ initialQuery, picked, onChange }: { initialQuery: string; picked: Photo[]; onChange: (p: Photo[]) => void }) {
  const [sources, setSources] = React.useState<PhotoSource[]>(FALLBACK);
  const [source, setSource] = React.useState("wikimedia");
  const [query, setQuery] = React.useState(initialQuery);
  const [debounced, setDebounced] = React.useState(initialQuery.trim());
  const [lists, setLists] = React.useState<Record<string, { items: Photo[]; next: number; more: boolean; loading: boolean }>>({});
  const [error, setError] = React.useState<string | null>(null);
  const sentinel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    getPhotoSources()
      .then((s) => {
        setSources(s);
        if (s.length && !s.some((x) => x.id === "wikimedia")) setSource(s[0].id);
      })
      .catch(() => {});
  }, []);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 450);
    return () => clearTimeout(t);
  }, [query]);

  const key = `${source}:${debounced.toLowerCase()}`;
  const cur = lists[key];
  const loadMore = React.useCallback(() => {
    if (debounced.length < 2) return;
    const s = lists[key];
    if (s && (s.loading || !s.more)) return;
    const page = s?.next ?? 0;
    setError(null);
    setLists((all) => ({ ...all, [key]: { items: s?.items ?? [], next: page, more: true, loading: true } }));
    searchPhotos(source, debounced, page)
      .then((r) =>
        setLists((all) => {
          const prev = all[key]?.items ?? [];
          const seen = new Set(prev.map((p) => p.id));
          return { ...all, [key]: { items: [...prev, ...r.items.filter((p) => !seen.has(p.id))], next: page + 1, more: r.more, loading: false } };
        }),
      )
      .catch((e: Error) => {
        setError(e.message);
        setLists((all) => ({ ...all, [key]: { ...(all[key] ?? { items: [], next: page, more: true }), loading: false } }));
      });
  }, [lists, key, source, debounced]);

  React.useEffect(() => {
    if (!lists[key]) loadMore();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- first page per source/query only

  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const isPicked = (p: Photo) => picked.some((x) => x.source === p.source && x.id === p.id);
  const toggle = (p: Photo) =>
    onChange(isPicked(p) ? picked.filter((x) => !(x.source === p.source && x.id === p.id)) : picked.length < MAX ? [...picked, p] : picked);

  return (
    <div>
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a car, e.g. Porsche 911 GT3"
          className="w-full rounded-2xl border border-border bg-background/60 py-2.5 pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
        />
      </label>
      <div className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={source === s.id}
            onClick={() => setSource(s.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
              source === s.id ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto shrink-0 self-center pr-1 text-xs font-semibold text-muted-foreground">
          {picked.length}/{MAX} picked
        </span>
      </div>

      <div className="mt-3 max-h-[420px] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background/40 p-1.5">
        {debounced.length < 2 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Type a car name to see free photos.</p>
        ) : error && !cur?.items.length ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button type="button" onClick={loadMore} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-bold hover:bg-white/10">
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        ) : cur && !cur.items.length && !cur.loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No photos for "{debounced}" here. Try another source.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {(cur?.items ?? []).map((p) => {
                const on = isPicked(p);
                return (
                  <button
                    key={`${p.source}:${p.id}`}
                    type="button"
                    onClick={() => toggle(p)}
                    aria-pressed={on}
                    className={cn("group relative aspect-[4/3] overflow-hidden rounded-xl bg-muted ring-2 transition", on ? "ring-accent" : "ring-transparent hover:ring-white/20")}
                  >
                    <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pt-4 pb-1.5 text-left text-[10px] font-semibold text-white/90">
                      {p.author} · {p.license}
                    </span>
                    {on && (
                      <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-accent text-accent-foreground">
                        <Check className="size-3.5" />
                      </span>
                    )}
                    <a
                      href={p.page}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Open the photo's page"
                      className="absolute top-1.5 left-1.5 hidden size-6 place-items-center rounded-full bg-black/60 text-white group-hover:grid"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </button>
                );
              })}
              {cur?.loading &&
                Array.from({ length: cur.items.length ? 3 : 6 }, (_, i) => <div key={`s${i}`} className="aspect-[4/3] animate-pulse rounded-xl bg-white/[0.06]" />)}
            </div>
            {cur?.more && <div ref={sentinel} className="h-8" />}
          </>
        )}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        Only free licences that allow monetized videos. Credits are added to the description for you.
      </p>
    </div>
  );
}
