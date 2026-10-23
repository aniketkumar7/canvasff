import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, Clock, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "cn";
import { GenerationFrame, type FrameState } from "./components/GenerationFrame";
import { MediaDrop, FocusPicker, Segmented, SongDrop, isVideo, useObjectUrl } from "./components/Form";
import { RecentList, StatusLine, UploadFields } from "./components/Result";
import { MusicLibrary } from "./components/MusicLibrary";
import { DEFAULT_STYLE, StylePicker, lookLabel, styleForForm, type StyleChoice } from "./components/StylePicker";
import { PhotoSearch } from "./components/PhotoSearch";
import { createJob, getCredit, getJob, JobGone, videoUrl, type Job, type NcsTrack, type Photo } from "./lib/api";
import { CURRENT, RECENT, remember, store, type Recent } from "./lib/store";

const POLL_MS = 5000;

const STEPS = [
  { title: "Which car is it?", help: "This is the answer revealed on the drop. Use the full model name." },
  { title: "Add photos", help: "Pick 1–3 free photos or upload your own. Each photo becomes several moving shots." },
  { title: "Pick the music", help: "Free NoCopyrightSounds tracks. The best part is cut to the drop for you." },
  { title: "Choose a look", help: "How the car is hidden before the reveal. Colours, fonts and cuts change by themselves every time." },
  { title: "Ready to generate", help: "Check everything once. The Short renders in the cloud in about 3–5 minutes." },
] as const;

/** Why Next is disabled, per step (shown on the button). */
const NEEDS = ["Type the car's name", "Add at least 1 photo", "Pick a song", "", ""] as const;
const label = "mb-2 block text-[13px] font-medium text-muted-foreground";
const SEEN = "canvasff-seen-welcome";

/** First visit only: what this does, in one glance, and one way in. */
function Welcome({ onStart }: { onStart: () => void }) {
  return (
    // sits right under the header with a little air; short enough to never scroll
    <div className="flex flex-col pt-6 sm:pt-12">
      <h1 className="max-w-[18ch] text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] [text-wrap:balance] sm:text-[2.5rem]">
        Turn a car name into a <span className="text-accent">Short</span>.
      </h1>
      <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-muted-foreground">
        Pick a few free photos and a song. CanvasFF cuts them to the beat, hides the car until the drop, and writes the
        title, description and tags for you.
      </p>
      <div className="mt-8 flex items-start gap-5">
      <ol className="flex min-w-0 flex-1 flex-col gap-3 text-[15px]">
        {[
          ["Name the car", "the answer viewers guess"],
          ["Add photos and music", "free, safe for monetized channels"],
          ["Generate", "a 10-second vertical Short in about 3–5 minutes"],
        ].map(([what, detail], i) => (
          <li key={what} className="flex items-baseline gap-3">
            <span className="w-4 shrink-0 text-[13px] font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
            <span>
              <span className="font-medium">{what}</span>
              <span className="text-muted-foreground"> · {detail}</span>
            </span>
          </li>
        ))}
      </ol>
        {/* a 3-second loop of a real result, GIF-style (muted, no controls) but ~10x smaller than a GIF */}
        <figure className="w-[104px] shrink-0 sm:w-[132px]">
          <video
            src="/example.mp4"
            poster="/example.jpg"
            autoPlay
            muted
            loop
            playsInline
            aria-label="Example Short: a Porsche 911 GT3 RS revealed on the drop"
            className="aspect-[9/16] w-full rounded-xl bg-card object-cover ring-1 ring-border"
          />
          <figcaption className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            Example · photo Alexander-93, CC BY-SA 4.0
          </figcaption>
        </figure>
      </div>
      <button
        type="button"
        onClick={onStart}
        autoFocus
        className="mt-10 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-foreground transition-[filter] hover:brightness-105 active:brightness-95 sm:w-auto sm:self-start sm:px-8"
      >
        <Sparkles className="size-4" /> Make a Short
      </button>
    </div>
  );
}

function Header({ recentCount, onRecent, onHome }: { recentCount: number; onRecent: () => void; onHome: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[600px] items-center justify-between px-4">
        <button type="button" onClick={onHome} className="flex items-center gap-2 rounded-lg py-1 pr-2">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="font-[Montserrat] text-[15px] font-extrabold tracking-tight">CanvasFF</span>
        </button>
        <button
          type="button"
          onClick={onRecent}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
        >
          <Clock className="size-4" />
          Recent{recentCount ? <span className="tabular-nums text-foreground">{recentCount}</span> : null}
        </button>
      </div>
    </header>
  );
}

function Progress({ step, onGo, reachable }: { step: number; onGo: (i: number) => void; reachable: (i: number) => boolean }) {
  return (
    <div className="mb-6">
      <p className="mb-2.5 text-[13px] font-medium text-muted-foreground tabular-nums">
        Step {step + 1} of {STEPS.length}
      </p>
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={`Go to step ${i + 1}: ${s.title}`}
            disabled={!reachable(i)}
            onClick={() => onGo(i)}
            className="group h-6 flex-1 disabled:cursor-default"
          >
            <span
              className={cn(
                "block h-1 rounded-full transition-colors duration-200",
                i <= step ? "bg-accent" : "bg-white/10 group-enabled:group-hover:bg-white/20",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Review row: what was chosen, with a jump back to change it. */
function Row({ name, value, onEdit }: { name: string; value: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">{name}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{value}</span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Change ${name.toLowerCase()}`}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
      >
        <Pencil className="size-4" />
      </button>
    </div>
  );
}

export default function App() {
  const reduce = useReducedMotion();
  const [media, setMedia] = React.useState<File[]>([]);
  const [focus, setFocus] = React.useState<[number, number]>([0.5, 0.5]);
  const [song, setSong] = React.useState<File | null>(null);
  const [source, setSource] = React.useState<"ncs" | "file">("ncs");
  const [ncs, setNcs] = React.useState<NcsTrack | null>(null);
  /** the credit text we filled in for the picked track, so a hand-edited credit is never overwritten */
  const autoCredit = React.useRef("");
  const [credit, setCredit] = React.useState("");
  const [editCredit, setEditCredit] = React.useState(false);
  const [name, setName] = React.useState("");
  const [length, setLength] = React.useState("10");
  const [style, setStyle] = React.useState<StyleChoice>(DEFAULT_STYLE);
  const [picked, setPicked] = React.useState<Photo[]>([]);
  const [footage, setFootage] = React.useState<"search" | "upload">("search");
  const [step, setStep] = React.useState(0);
  const [showRecent, setShowRecent] = React.useState(false);
  const [welcome, setWelcome] = React.useState(() => !store.get(SEEN, false));

  const [job, setJob] = React.useState<Job | null>(null);
  const [upload, setUpload] = React.useState(0);
  const [error, setError] = React.useState<{ msg: string; log?: string } | null>(null);
  const [recent, setRecent] = React.useState<Recent[]>(() => store.get(RECENT, []));
  const [refresh, setRefresh] = React.useState(0);
  /** bumped after a failed poll so the effect re-arms (Render waking up, a network blip) */
  const [retry, setRetry] = React.useState(0);

  const first = media[0];
  const firstUrl = useObjectUrl(first);
  // a new opening shot starts centred
  React.useEffect(() => {
    setFocus([0.5, 0.5]);
  }, [first]);

  const view = job || error ? "render" : showRecent ? "recent" : welcome ? "welcome" : "wizard";
  const start = () => {
    store.set(SEEN, true);
    setWelcome(false);
  };
  // every screen change starts at the top
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [step, view, reduce]);

  const busy = !error && (job?.status === "uploading" || job?.status === "queued" || job?.status === "rendering");
  const frameState: FrameState = error ? "error" : job ? job.status : "idle";

  const fail = (msg: string, log?: string) => {
    store.set(CURRENT, null);
    setError({ msg, log });
    setRefresh((n) => n + 1);
  };

  const open = React.useCallback((id: string) => {
    setError(null);
    setShowRecent(false);
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
  const footageCount = media.length + picked.length;
  const done = [!!name.trim(), footageCount > 0, hasSong, true, true];
  const reachable = (i: number) => i <= step || done.slice(0, i).every(Boolean);
  const brandOnly = !!name.trim() && name.trim().split(/\s+/).length < 2;

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
    if (!done.slice(0, 3).every(Boolean) || busy) return;
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("kind", "car");
    fd.append("length", length);
    fd.append("focus", focus.join(","));
    fd.append("credit", credit);
    fd.append("style", JSON.stringify(styleForForm(style)));
    fd.append("picked", JSON.stringify(picked.map((p) => ({ source: p.source, id: p.id }))));
    media.forEach((f) => fd.append("media", f));
    if (source === "ncs") fd.append("song_ncs", ncs!.id);
    else fd.append("song", song!);
    setError(null);
    setUpload(0);
    setJob({ id: "", name: name.trim(), status: "uploading", created: Date.now() / 1000, updated: 0 });
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

  const leaveRender = () => {
    setJob(null);
    setError(null);
    history.replaceState(null, "", location.pathname);
    setRefresh((n) => n + 1);
  };
  /** "Make another": new car and photos; the music and style stay. */
  const makeAnother = () => {
    setName("");
    setMedia([]);
    setPicked([]);
    setStep(0);
    leaveRender();
  };
  /** Logo: back to the welcome screen (unless a Short is rendering). */
  const goHome = () => {
    setShowRecent(false);
    if (busy) return;
    leaveRender();
    setWelcome(true);
  };

  const screen = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, x: -16 },
    transition: { duration: 0.2, ease: [0.25, 1, 0.5, 1] as const },
  };

  return (
    <>
      <Header recentCount={recent.length} onRecent={() => setShowRecent(true)} onHome={goHome} />
      {/* room for the fixed Back/Continue bar only on wizard steps */}
      <main className={cn("mx-auto max-w-[600px] px-4 pt-6", view === "wizard" ? "pb-36" : "pb-8")}>
        <AnimatePresence mode="wait" initial={false}>
          {view === "welcome" && (
            <motion.section key="welcome" {...screen}>
              <Welcome onStart={start} />
            </motion.section>
          )}

          {view === "recent" && (
            <motion.section key="recent" {...screen}>
              <button type="button" onClick={() => setShowRecent(false)} className="mb-5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" /> Back
              </button>
              <h1 className="mb-1 text-2xl font-semibold tracking-tight">Recent Shorts</h1>
              <p className="mb-5 text-[15px] text-muted-foreground">Shorts stay available for 6 hours after rendering. Download the ones you keep.</p>
              <RecentList items={recent} activeId={job?.id} refreshKey={refresh} onOpen={open} />
            </motion.section>
          )}

          {view === "render" && (
            <motion.section key="render" {...screen} className="mx-auto max-w-[400px]">
              <h1 className="mb-1 text-2xl font-semibold tracking-tight [text-wrap:balance]">
                {error ? "Something went wrong" : job?.status === "done" ? "Your Short is ready" : "Making your Short"}
              </h1>
              <p className="mb-5 text-[15px] text-muted-foreground">
                {error ? "Nothing was lost. You can edit and try again." : job?.status === "done" ? "Download it, then copy the upload text below." : "You can close this tab and come back later."}
              </p>
              <GenerationFrame
                state={frameState}
                tintSrc={firstUrl ?? picked[0]?.thumb}
                tintKind={first && isVideo(first) ? "video" : "image"}
                focus={focus}
                videoSrc={job?.status === "done" ? videoUrl(job.id) : undefined}
                downloadName={`${job?.name ?? "short"}.mp4`}
              />
              {error ? (
                <div className="mt-4 rounded-xl bg-danger/[0.08] p-4">
                  <p className="text-[14px] break-words text-foreground/90">
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
                  {error.log && <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/40 p-2.5 text-[11px] text-muted-foreground">{error.log}</pre>}
                </div>
              ) : (
                job && <StatusLine status={job.status} name={job.name} created={job.created || undefined} upload={upload} />
              )}
              {job?.status === "done" && job.upload && <UploadFields upload={job.upload} />}
              {(job?.status === "done" || error) && (
                <div className="mt-6 flex flex-col gap-2.5">
                  <button type="button" onClick={makeAnother} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-foreground transition-[filter] hover:brightness-105 active:brightness-95">
                    <RotateCcw className="size-4" /> Make another
                  </button>
                  <button type="button" onClick={leaveRender} className="h-12 rounded-xl text-[15px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground">
                    {error ? "Edit and try again" : "Back to this Short's settings"}
                  </button>
                </div>
              )}
            </motion.section>
          )}

          {view === "wizard" && (
            <motion.section key={`step-${step}`} {...screen}>
              <Progress step={step} onGo={setStep} reachable={reachable} />
              <h1 className="text-2xl font-semibold tracking-tight [text-wrap:balance]">{STEPS[step].title}</h1>
              <p className="mt-1.5 mb-6 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{STEPS[step].help}</p>

              {step === 0 && (
                <div>
                  <label htmlFor="answer" className={label}>
                    Car name
                  </label>
                  <input
                    id="answer"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && done[0] && setStep(1)}
                    maxLength={40}
                    autoFocus
                    autoComplete="off"
                    placeholder="e.g. Porsche 911 GT3 RS"
                    className="h-14 w-full rounded-xl border border-border bg-card px-4 text-[17px] font-medium outline-none transition-colors placeholder:text-muted-foreground focus:border-accent/70"
                  />
                  {brandOnly && (
                    <p className="mt-2.5 text-[13px] leading-relaxed text-accent">
                      Add the model too, like "{name.trim()} 911 GT3". A brand alone is too vague for a quiz.
                    </p>
                  )}
                </div>
              )}

              {step === 1 && (
                <div>
                  <Segmented
                    id="footage"
                    value={footage}
                    onChange={setFootage}
                    options={[
                      { value: "search", label: `Free photos${picked.length ? ` · ${picked.length}` : ""}` },
                      { value: "upload", label: `My files${media.length ? ` · ${media.length}` : ""}` },
                    ]}
                  />
                  <div className="mt-4">
                    {footage === "search" ? (
                      <PhotoSearch initialQuery={name.trim()} picked={picked} onChange={setPicked} />
                    ) : (
                      <>
                        <MediaDrop files={media} onChange={setMedia} />
                        {first && (
                          <div className="mt-5">
                            <span className={label}>Tap where the opening close-up should start</span>
                            <FocusPicker file={first} focus={focus} onChange={setFocus} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <Segmented
                    id="source"
                    value={source}
                    onChange={setSource}
                    options={[
                      { value: "ncs", label: "Music library" },
                      { value: "file", label: "My file" },
                    ]}
                  />
                  <div className="mt-4">
                    {source === "ncs" ? <MusicLibrary value={ncs} onChange={pickNcs} /> : <SongDrop song={song} onChange={setSong} />}
                  </div>
                  {source === "ncs" && !editCredit ? (
                    ncs && (
                      <p className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
                        <Check className="size-4 text-ok" /> Credit added to the description for you.
                        <button type="button" onClick={() => setEditCredit(true)} className="font-medium text-foreground underline-offset-2 hover:underline">
                          Edit
                        </button>
                      </p>
                    )
                  ) : (
                    <div className="mt-5">
                      <label htmlFor="credit" className={label}>
                        Music credit {source === "file" && "(paste what the song's site asks for)"}
                      </label>
                      <textarea
                        id="credit"
                        value={credit}
                        onChange={(e) => setCredit(e.target.value)}
                        rows={3}
                        className="w-full resize-y rounded-xl border border-border bg-card px-3.5 py-3 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus:border-accent/70"
                      />
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div>
                  <StylePicker value={style} onChange={setStyle} />
                  <div className="mt-6">
                    <span className={label}>Length</span>
                    <Segmented
                      id="length"
                      value={length}
                      onChange={setLength}
                      options={[
                        { value: "9", label: "9s" },
                        { value: "10", label: "10s · best" },
                        { value: "12", label: "12s" },
                      ]}
                    />
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="divide-y divide-border/70 border-y border-border/70">
                  <Row name="Car" value={name.trim()} onEdit={() => setStep(0)} />
                  <Row
                    name="Photos"
                    value={[picked.length && `${picked.length} free photo${picked.length > 1 ? "s" : ""}`, media.length && `${media.length} file${media.length > 1 ? "s" : ""}`].filter(Boolean).join(" + ")}
                    onEdit={() => setStep(1)}
                  />
                  <Row name="Music" value={source === "ncs" ? `${ncs?.artist} – ${ncs?.title}` : song?.name} onEdit={() => setStep(2)} />
                  <Row name="Look" value={`${lookLabel(style.mechanic)} · ${length}s`} onEdit={() => setStep(3)} />
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {view === "wizard" && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-[600px] gap-2.5 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                aria-label="Back"
                className="grid size-12 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
              >
                <ArrowLeft className="size-5" />
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!done[step]}
                className="h-12 flex-1 rounded-xl bg-accent text-[15px] font-semibold text-accent-foreground transition-[filter,background-color,color] hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:hover:brightness-100"
              >
                {done[step] ? "Continue" : NEEDS[step]}
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-foreground transition-[filter] hover:brightness-105 active:brightness-95 disabled:opacity-60"
              >
                <Sparkles className="size-4" /> Generate Short
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
