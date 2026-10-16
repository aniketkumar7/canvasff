import * as React from "react";
import { motion } from "motion/react";
import { Sparkles, RotateCcw } from "lucide-react";
import { cn } from "cn";
import { StardustSlider } from "./components/StardustSlider";
import { GenerationFrame, type FrameState } from "./components/GenerationFrame";
import { FocusPicker, MediaDrop, Section, Segmented, SongDrop, isVideo, useObjectUrl } from "./components/Form";
import { RecentList, StatusLine, UploadFields } from "./components/Result";
import { MusicLibrary } from "./components/MusicLibrary";
import { Hero, TopBar } from "./components/Header";
import { createJob, getCredit, getJob, JobGone, videoUrl, type Job, type NcsTrack } from "./lib/api";
import { CURRENT, RECENT, remember, store, type Recent } from "./lib/store";

type Kind = "car" | "plane";
const POLL_MS = 5000;

export default function App() {
  const [media, setMedia] = React.useState<File[]>([]);
  const [focus, setFocus] = React.useState<[number, number]>([0.5, 0.5]);
  const [song, setSong] = React.useState<File | null>(null);
  const [source, setSource] = React.useState<"ncs" | "file">("ncs");
  const [ncs, setNcs] = React.useState<NcsTrack | null>(null);
  /** the credit text we filled in for the picked track, so a hand-edited credit is never overwritten */
  const autoCredit = React.useRef("");
  const [credit, setCredit] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("car");
  const [length, setLength] = React.useState(17);

  const [job, setJob] = React.useState<Job | null>(null);
  const [upload, setUpload] = React.useState(0);
  const [error, setError] = React.useState<{ msg: string; log?: string } | null>(null);
  const [recent, setRecent] = React.useState<Recent[]>(() => store.get(RECENT, []));
  const [refresh, setRefresh] = React.useState(0);
  const frameRef = React.useRef<HTMLDivElement>(null);
  /** bumped after a failed poll so the effect re-arms (Render waking up, a network blip) */
  const [retry, setRetry] = React.useState(0);

  const first = media[0];
  const firstUrl = useObjectUrl(first);
  // a new opening shot starts centred
  React.useEffect(() => setFocus([0.5, 0.5]), [first]);

  const busy = !error && (job?.status === "uploading" || job?.status === "queued" || job?.status === "rendering");
  const frameState: FrameState = error ? "error" : job ? job.status : "idle";

  const fail = (msg: string, log?: string) => {
    store.set(CURRENT, null);
    setError({ msg, log });
    setRefresh((n) => n + 1);
  };

  const open = React.useCallback((id: string) => {
    setError(null);
    setJob({ id, name: "Loading…", status: "queued", created: 0, updated: 0 });
  }, []);

  // poll the job until it's done or failed
  React.useEffect(() => {
    if (!job?.id || job.status === "done" || job.status === "error" || job.status === "uploading") return;
    let alive = true;
    const t = setTimeout(
      async () => {
        try {
          const j = await getJob(job.id);
          if (!alive) return;
          setJob(j);
          if (j.status === "error") fail(j.error || "Render failed", j.log);
          if (j.status === "done") {
            store.set(CURRENT, null);
            remember({ id: j.id, name: j.name, created: j.created });
            setRecent(store.get(RECENT, []));
            setRefresh((n) => n + 1);
          }
        } catch (e) {
          if (!alive) return;
          if (e instanceof JobGone) fail("This Short is gone: the server restarted or it's older than 6 hours.");
          else setRetry((n) => n + 1); // transient: try again on the next tick
        }
      },
      job.created || retry ? POLL_MS : 0, // opened from a link: fetch right away
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [job, retry]);

  // resume the job in progress, or open one by link (?job=<id>)
  React.useEffect(() => {
    const id = new URLSearchParams(location.search).get("job") || store.get<string | null>(CURRENT, null);
    if (id) open(id);
  }, [open]);

  const hasSong = source === "ncs" ? !!ncs : !!song;
  const missing = [!media.length && "clips", !hasSong && "a song", !name.trim() && "the answer"].filter(Boolean) as string[];

  const pickNcs = (t: NcsTrack | null) => {
    setNcs(t);
    const canFill = !credit.trim() || credit === autoCredit.current;
    if (!t) {
      if (canFill) setCredit((autoCredit.current = ""));
      return;
    }
    if (!canFill) return;
    getCredit(t.id)
      .then((c) => {
        setCredit((cur) => (!cur.trim() || cur === autoCredit.current ? (autoCredit.current = c) : cur));
      })
      .catch(() => {}); // the server adds the credit anyway when the field is empty
  };

  const submit = async () => {
    if (missing.length || busy) return;
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("kind", kind);
    fd.append("length", String(length));
    fd.append("focus", focus.join(","));
    fd.append("credit", credit);
    media.forEach((f) => fd.append("media", f));
    if (source === "ncs") fd.append("song_ncs", ncs!.id);
    else fd.append("song", song!);
    setError(null);
    setUpload(0);
    setJob({ id: "", name: name.trim(), status: "uploading", created: Date.now() / 1000, updated: 0 });
    if (window.matchMedia("(max-width: 767px)").matches) frameRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const j = await createJob(fd, setUpload);
      if (j.status === "error") return fail(j.error || "Couldn't start the render");
      store.set(CURRENT, j.id);
      remember({ id: j.id, name: j.name, created: j.created });
      setRecent(store.get(RECENT, []));
      setJob(j);
    } catch (e) {
      fail((e as Error).message);
    }
  };

  const reset = () => {
    setJob(null);
    setError(null);
    history.replaceState(null, "", location.pathname);
    setRefresh((n) => n + 1);
  };

  return (
    <>
    <TopBar
      steps={[
        { label: "Footage", done: media.length > 0 },
        { label: "Sound", done: hasSong },
        { label: "Details", done: !!name.trim() },
      ]}
      recentCount={recent.length}
      onRecent={() => document.getElementById("recent")?.scrollIntoView({ behavior: "smooth", block: "center" })}
    />
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 lg:pt-10">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_300px] md:gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <div className="min-w-0 space-y-4">
          <Hero />

          <Section step={1} title="Footage" hint={media.length ? `${media.length}/10` : undefined}>
            <MediaDrop files={media} onChange={setMedia} />
          </Section>

          {first && (
            <Section step={2} title="Opening shot" hint={`${Math.round(focus[0] * 100)}, ${Math.round(focus[1] * 100)}`}>
              <FocusPicker file={first} focus={focus} onChange={setFocus} />
            </Section>
          )}

          <Section step={first ? 3 : 2} title="Soundtrack">
            <div className="mb-3">
              <Segmented
                id="source"
                value={source}
                onChange={setSource}
                options={[
                  { value: "ncs", label: "NCS library" },
                  { value: "file", label: "My file" },
                ]}
              />
            </div>
            {source === "ncs" ? <MusicLibrary value={ncs} onChange={pickNcs} /> : <SongDrop song={song} onChange={setSong} />}
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">
                Music credit <span className="font-semibold normal-case tracking-normal">(optional)</span>
              </span>
              <textarea
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                rows={3}
                placeholder={source === "ncs" ? "Filled in when you pick a track." : "Paste the credit text the Audio Library asks for. It goes into the description."}
                className="w-full resize-y rounded-xl border border-border bg-background/60 px-3 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-accent/60"
              />
            </label>
          </Section>

          <Section step={first ? 4 : 3} title="Details">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Answer</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder={kind === "car" ? "Lamborghini SC18" : "Boeing 747"}
                  className="w-full rounded-2xl border border-border bg-background/60 px-4 py-3 text-[17px] font-extrabold tracking-tight outline-none placeholder:font-semibold placeholder:text-muted-foreground/60 focus:border-accent/60"
                />
              </label>
              <div>
                <span className="mb-1.5 block text-[11px] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Type</span>
                <Segmented
                  id="kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "car", label: "Car" },
                    { value: "plane", label: "Plane" },
                  ]}
                />
              </div>
            </div>
            <StardustSlider
              className="mt-5 bg-muted/50! ring-1 ring-border"
              style={{ width: "100%" }}
              label="Length"
              value={length}
              onValueChange={setLength}
              min={15}
              max={20}
              step={1}
              snap="steps"
              format={(v) => `${v}s`}
              marks={[
                { value: 15, label: "15s" },
                { value: 17, label: "17s · best" },
                { value: 20, label: "20s" },
              ]}
              color="#ffd60a"
              classNames={{ value: "font-black text-accent", label: "font-extrabold text-[13px] tracking-wide uppercase" }}
            />
          </Section>

          <div className="pt-2 max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-4 max-md:bg-gradient-to-t max-md:from-background max-md:via-background/95 max-md:to-transparent max-md:px-4 max-md:pt-6 max-md:pb-[calc(12px+env(safe-area-inset-bottom))]">
            <motion.button
              type="button"
              onClick={submit}
              disabled={missing.length > 0 || busy}
              whileHover={missing.length || busy ? undefined : { y: -2 }}
              whileTap={missing.length || busy ? undefined : { scale: 0.98 }}
              className={cn(
                "group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-accent px-6 py-4 text-[17px] font-black text-accent-foreground",
                "shadow-[0_12px_40px_-12px_rgb(255_214_10/0.6)] transition-colors disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:ring-1 disabled:ring-border",
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/40 opacity-0 blur-md transition-all duration-700 group-hover:left-[110%] group-hover:opacity-100 group-disabled:hidden"
              />
              <Sparkles className="size-5" />
              {busy ? "Generating…" : "Generate Short"}
            </motion.button>
            <p className="mt-2.5 text-center text-xs font-medium text-muted-foreground">
              {missing.length ? `Add ${missing.join(", ")}` : "Renders on GitHub · about 3 min"}
            </p>
          </div>
        </div>

        <aside ref={frameRef} className="min-w-0 scroll-mt-20 md:sticky md:top-20 md:self-start">
          <div className="mx-auto w-full max-w-[420px] md:max-w-none">
            <GenerationFrame
              state={frameState}
              tintSrc={firstUrl}
              tintKind={first && isVideo(first) ? "video" : "image"}
              focus={focus}
              videoSrc={job?.status === "done" ? videoUrl(job.id) : undefined}
              downloadName={`${job?.name ?? "short"}.mp4`}
              className={frameState === "idle" ? "max-md:aspect-auto max-md:h-40" : undefined}
            />

            {error ? (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 rounded-2xl border border-danger/30 bg-danger/[0.07] p-4"
              >
                <p className="text-sm font-bold text-danger">Something went wrong</p>
                <p className="mt-1 text-[13px] break-words text-foreground/80">
                  {error.msg.split(/(https?:\/\/\S+)/).map((part, i) =>
                    /^https?:\/\//.test(part) ? (
                      <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        open the log
                      </a>
                    ) : (
                      part
                    ),
                  )}
                </p>
                {error.log && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/40 p-2.5 text-[11px] text-muted-foreground">{error.log}</pre>
                )}
              </motion.div>
            ) : job ? (
              <StatusLine status={job.status} name={job.name} created={job.created || undefined} upload={upload} />
            ) : (
              <p className="mt-4 text-center text-xs font-medium text-muted-foreground">
                Rendering runs on GitHub, so you can close this tab and come back.
              </p>
            )}

            {job?.status === "done" && job.upload && <UploadFields upload={job.upload} />}

            {(job?.status === "done" || error) && (
              <button
                type="button"
                onClick={reset}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3 text-sm font-extrabold transition hover:border-white/20 hover:bg-white/[0.03]"
              >
                <RotateCcw className="size-4" /> Make another
              </button>
            )}

            <RecentList items={recent} activeId={job?.id} refreshKey={refresh} onOpen={job?.status === "uploading" && !error ? () => {} : open} />
          </div>
        </aside>
      </div>
    </main>
    </>
  );
}
